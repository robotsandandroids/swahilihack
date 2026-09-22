Option B — Stemmer as deterministic pre-processing (cheaper, more predictable)
Run the stemmer on every user utterance before the LLM call, regardless of whether the LLM ends up using it. Feed the structured breakdown into the prompt/context as a system-injected note, and let the ChatEngine's memory + this context shape the response:

User said: "atalia jana"
Stemmer output: root=lia, given_marker=ta (future), expected_marker=li (past),
                context_clue="jana" (yesterday) → past tense required

Then Mistral just has to turn that into a natural explanation — cheaper on tokens/latency since it's one call, not two, and you're not relying on Mistral's function-calling reliability at all. This fits well as a custom retriever or a NodePostprocessor-like step feeding a ContextChatEngine, even though there's no real "document corpus" — you're using the retrieval slot for structured linguistic context instead of vector search.

My take given rate limits: go with B. It's one deterministic Mistral call per turn instead of a variable number, it's fully predictable, and stemming is rule-based anyway — no reason to make the LLM decide whether to invoke it when you can just always compute it and conditionally include it in the prompt (e.g. only inject the stemmer output when it actually detects a mismatch, skip it for correct sentences).

Memory (ChatMemoryBuffer) still sits underneath either option the same way — tracking the conversation so Mistral can reference "the atalia example we discussed" later.

One thing worth deciding now: is the stemmer meant to catch errors across arbitrary free-form user speech, or is this more drill/exercise-based (user attempts a specific sentence, tool checks it)? That affects whether you need it running on every turn or only on flagged "practice" turns.

Given you're locked into Mistral's free/lower tiers, here's where the real savings come from, roughly in order of impact:

1. Trim memory aggressively, don't just cap by token count
ChatMemoryBuffer.from_defaults(token_limit=...) truncates but keeps raw turns. Better: use ChatMemoryBuffer with a fairly low token_limit (e.g. 1500-2000) and periodically summarize old turns instead of dropping them wholesale — LlamaIndex has summarization-based memory patterns, or you can roll your own: every N turns, collapse older history into a 2-3 sentence summary node and keep only recent turns verbatim. Cuts steady-state token cost a lot in long sessions.

2. Only inject stemmer output when there's actually an error
You already planned this — worth reinforcing: for correct Swahili, skip the retrieval/context injection step entirely and just send memory + message. Don't pay prompt tokens for a null diagnostic every turn.

3. Keep the stemmer's structured output compact, not prose
Feed Mistral something like {root: lia, error: ta→li, cue: jana} rather than a paragraph explanation generated separately. Let Mistral do the explaining in one pass instead of you generating text twice (once for diagnostics, once for the chat response).

4. Cache repeated corrections
Swahili learners tend to repeat the same class of mistake (tense markers, noun class agreement, etc.). Keep a local dict/cache keyed by (error_type, root) — if the stemmer flags the same pattern as a previous turn, you can either skip the LLM call and reuse a templated/cached explanation, or pass a flag like "repeat_error": true so Mistral gives a shorter response ("same mistake as before — remember, li not ta").

5. Use a SimpleChatStore snapshot instead of re-embedding history
Since you're not doing vector retrieval over documents (your "retrieval" is the stemmer, not a corpus), there's no embedding cost to worry about there — good, that's one whole cost category avoided. Just persist the chat store to disk/DB rather than re-sending full transcripts to reconstruct state across sessions.

6. Batch STT before LLM calls, not per-word
If Whisper/Google STT segments audio in small chunks, buffer into full utterances before hitting Mistral — one coherent sentence per LLM call, not fragments that each trigger a round trip.

7. Set a hard max_tokens on Mistral responses
Especially for correction explanations — cap output tokens (e.g. 150-200) so Mistral doesn't ramble, since correction explanations don't need much length to be useful.

8. Backoff + queue, not retry-storm
Wrap the Mistral LLM call with exponential backoff (tenacity library works well) so rate-limit errors don't cascade into repeated failed calls burning your quota window.

Want me to sketch the actual ChatMemoryBuffer + summarization + conditional-stemmer-injection code as a working loop? That's probably the fastest way to see how points 1-3 compose together.

### Sample code.
```python
"""
Swahili conversational tutor loop.

Architecture:
  STT text -> stemmer analysis (always run, cheap/local) -> conditional context
  injection -> ChatMemoryBuffer (with periodic summarization) -> Mistral via
  LlamaIndex -> response

Install:
  pip install llama-index-core llama-index-llms-mistralai tenacity
"""

import os
from dataclasses import dataclass
from typing import Optional

from llama_index.core.memory import ChatMemoryBuffer
from llama_index.core.llms import ChatMessage, MessageRole
from llama_index.llms.mistralai import MistralAI
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type


# ---------------------------------------------------------------------------
# 1. Stemmer stub — replace with your minimal Snowball implementation
# ---------------------------------------------------------------------------

@dataclass
class StemResult:
    root: str
    given_marker: Optional[str]
    expected_marker: Optional[str]
    cue: Optional[str]
    has_error: bool
    error_type: Optional[str]  # e.g. "tense_marker", "noun_class_agreement"


def analyze_swahili(sentence: str) -> StemResult:
    """
    Placeholder for your real stemmer. Keep this fully deterministic and
    local — no LLM call here. This is the whole point of doing it outside
    the token budget.
    """
    # --- your snowball stemmer / rule logic goes here ---
    # Toy example matching your "atalia jana" case:
    if "atalia" in sentence.split() and "jana" in sentence:
        return StemResult(
            root="lia",
            given_marker="ta",
            expected_marker="li",
            cue="jana",
            has_error=True,
            error_type="tense_marker",
        )
    return StemResult(
        root="", given_marker=None, expected_marker=None,
        cue=None, has_error=False, error_type=None,
    )


# ---------------------------------------------------------------------------
# 2. Repeat-error cache — skip re-explaining the same mistake class at length
# ---------------------------------------------------------------------------

class ErrorCache:
    def __init__(self):
        self._seen: dict[tuple[str, str], int] = {}

    def check_and_record(self, error_type: str, root: str) -> bool:
        """Returns True if this (error_type, root) pair was seen before."""
        key = (error_type, root)
        is_repeat = key in self._seen
        self._seen[key] = self._seen.get(key, 0) + 1
        return is_repeat


# ---------------------------------------------------------------------------
# 3. Memory with periodic summarization (collapse old turns, don't just drop)
# ---------------------------------------------------------------------------

class SummarizingMemory:
    """
    Wraps ChatMemoryBuffer. Every `summarize_every` user turns, collapses
    everything older than the last `keep_recent` turns into one short
    summary message, so long sessions don't keep paying full token cost
    for early history.
    """

    def __init__(self, llm, token_limit=1800, summarize_every=6, keep_recent=4):
        self.llm = llm
        self.buffer = ChatMemoryBuffer.from_defaults(token_limit=token_limit)
        self.turn_count = 0
        self.summarize_every = summarize_every
        self.keep_recent = keep_recent
        self._summary: Optional[str] = None

    def put(self, message: ChatMessage):
        self.buffer.put(message)
        if message.role == MessageRole.USER:
            self.turn_count += 1
            if self.turn_count % self.summarize_every == 0:
                self._maybe_summarize()

    def _maybe_summarize(self):
        history = self.buffer.get()
        if len(history) <= self.keep_recent * 2:
            return  # not enough to bother summarizing yet

        old, recent = history[:-self.keep_recent * 2], history[-self.keep_recent * 2:]
        old_text = "\n".join(f"{m.role.value}: {m.content}" for m in old)

        prompt = (
            "Summarize this Swahili-tutoring conversation in 2-3 short "
            "sentences. Note any recurring grammar mistakes the learner "
            "made and topics covered. Be terse.\n\n" + old_text
        )
        summary_resp = self.llm.complete(prompt, max_tokens=120)
        self._summary = str(summary_resp)

        # rebuild buffer: summary note + recent turns only
        self.buffer.reset()
        if self._summary:
            self.buffer.put(ChatMessage(
                role=MessageRole.SYSTEM,
                content=f"Earlier conversation summary: {self._summary}",
            ))
        for m in recent:
            self.buffer.put(m)

    def get(self):
        return self.buffer.get()


# ---------------------------------------------------------------------------
# 4. LLM call with backoff (avoid retry-storms burning rate limit windows)
# ---------------------------------------------------------------------------

@retry(
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(4),
    retry=retry_if_exception_type(Exception),  # narrow to Mistral's rate-limit exception in production
)
def call_mistral(llm, messages, max_tokens=180):
    return llm.chat(messages, max_tokens=max_tokens)


# ---------------------------------------------------------------------------
# 5. Main turn handler
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are a friendly Swahili tutor. Keep corrections short and clear. "
    "If given a grammar diagnostic, explain the specific rule (e.g. tense "
    "marker) in one or two sentences, in simple English with the Swahili "
    "terms inline. If no diagnostic is given, just respond conversationally "
    "in Swahili, correcting nothing."
)


def handle_turn(user_text: str, memory: SummarizingMemory, error_cache: ErrorCache, llm) -> str:
    stem = analyze_swahili(user_text)

    content = user_text
    if stem.has_error:
        is_repeat = error_cache.check_and_record(stem.error_type, stem.root)
        diagnostic = (
            f"[diagnostic: root='{stem.root}', given_marker='{stem.given_marker}', "
            f"expected_marker='{stem.expected_marker}', cue='{stem.cue}', "
            f"repeat_error={is_repeat}]"
        )
        content = f"{user_text}\n{diagnostic}"
        # repeat_error=True signals the LLM (via SYSTEM_PROMPT convention you
        # can extend) to keep the explanation to one short reminder line
        # instead of a full re-teach.

    user_msg = ChatMessage(role=MessageRole.USER, content=content)
    memory.put(user_msg)

    messages = [ChatMessage(role=MessageRole.SYSTEM, content=SYSTEM_PROMPT)] + memory.get()
    response = call_mistral(llm, messages, max_tokens=180)

    reply_text = str(response)
    memory.put(ChatMessage(role=MessageRole.ASSISTANT, content=reply_text))
    return reply_text


# ---------------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    llm = MistralAI(model="mistral-small-latest", api_key=os.environ["MISTRAL_API_KEY"])
    memory = SummarizingMemory(llm)
    error_cache = ErrorCache()

    for user_text in [
        "Habari",
        "Nilikuwa naenda dukani jana",
        "Atalia jana",          # triggers diagnostic
        "Atalia tena leo",      # different context, still ta/li pattern -> repeat_error=True
    ]:
        reply = handle_turn(user_text, memory, error_cache, llm)
        print(f"User: {user_text}\nTutor: {reply}\n")
```
