from __future__ import annotations

import json
import logging

from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)
from llama_index.core.llms import ChatMessage, MessageRole

from app.core.config import get_settings
from app.models.schemas import (
    Feedback,
    Scenario,
    StemAnalysis,
    TurnResponse,
)
from app.services.memory import SummarizingMemory
from app.services.stemmer.diagnostic import StemDiagnostic
from app.services.stemmer.swahili import analyze_swahili_word

logger = logging.getLogger(__name__)

SYSTEM_TEMPLATE = """\
Unacheza nafasi ya {character} katika mazoezi ya Kiswahili. Mazoezi ni kuhusu: {scenario_title}.

DJALOZI HUFANYIKA HAPA: {context}

MADHUMUNI YAKO:
- Ongelea mwanafunzi ukiwa katika {character} angani ya {location}, kwa Kiswahili cha asili kikamilifu.
- Baada ya kila jibu la mwanafunzi toa: 1) jibu lako la pili la Kiswahili (ukiwa bado katika nafasi yako), 2) tafsiri ya kiingereza la jibu lako, 3) DRUMHA: alama na mrejesho wa jibu la mwanafunzi.
- Jibu la mwanafunzi linapokosea kisarufi, onyesha marekebisho halisi (wrong -> correct).
- Dumisha mazungumzo hadi suala litulie; usijirudie.

STRUCTURED DIAGNOSTIC (stemmer note):
- Kila ujumbe wa mwanafunzi UNAWEZA kuwa na block ya "[diagnostic: ...]" — matokeo ya
  analysis ya deterministic (si LLM) ya sarufi moja (tense marker vs time cue).
- Ikiwa "[diagnostic: ...]" ipo:
    * eleza rule katika sentensi moja au mbili kwa Kiingereza rahisi, ukijumuisha
      Swahili (e.g. "li = past; with 'jana' (yesterday) use li, not ta").
    * ya "repeat_error=true" inamaanisha mwanafunzi anarudia kosa hilohilo: jibu fupi
      la ukumbusho wa MSTA MOJA tu, usieleze tena kwa undani.
- Ikiwa hakuna "[diagnostic: ...]", sentensi inaonekana sawa kwenye axis hiyo:
  USIZULIE marekebisho ya tense; endelea mazungumzo tu.

MAJIBU YAKO NI JSON muundo huu (when the mwanafunzi anasema):
{{
  "ai_text": "kiswahili reply in character",
  "ai_translation": "english gloss of ai_text",
  "feedback": {{
    "headline": "very short phrase in English (e.g. 'Great job!')",
    "score": 0-100 overall,
    "comprehension": 0-100,
    "grammar": 0-100,
    "enunciation": 0-100,
    "corrections": [{{"original": "wrong swahili, or ''", "corrected": "correct swahili", "reason": "short english explanation"}}],
    "good_points": ["what the learner did well, english"],
    "suggestion": "one short english cue for the next reply"
  }}
}}

RULES:
- Score fairly for level {difficulty}.
- If learner message is empty, keep score low and prompt them to speak.
- corrections must be concrete and grammatical; empty list when no errors.
- ALWAYS speak Kiswahili in ai_text, keep it short (1-2 sentences).
- WEKA max_tokens: fupi na sahihi. Usirudie yale uliyosema.
"""


def _is_retryable(exc: BaseException) -> bool:
    """Retry on rate limits, 5xx and timeouts; never spam 4xx errors."""
    code = _status_code(exc)
    if code is not None:
        return code == 429 or code >= 500
    return isinstance(exc, TimeoutError)


def _status_code(exc: BaseException) -> int | None:
    if hasattr(exc, "status_code"):
        return exc.status_code
    if hasattr(exc, "status"):
        return exc.status
    response = getattr(exc, "response", None)
    if hasattr(response, "status_code"):
        return response.status_code
    return None


def render_user_content(
    transcript: str,
    diagnostic: StemDiagnostic | None,
    is_repeat: bool = False,
) -> str:
    """Build the user turn, injecting a compact diagnostic only on error.

    Cost rule from part_2.md: for correct Swahili we skip the diagnostic
    entirely (no prompt tokens paid for a null note); what we do inject is a
    tiny structured dict, never a prose paragraph.
    """
    content = transcript or "(silence)"
    if diagnostic is not None and diagnostic.has_error:
        db = diagnostic.compact()
        content = (
            f"{content}\n[diagnostic: root='{db['root']}', "
            f"given_marker='{db['given_marker']}', "
            f"expected_marker='{db['expected_marker']}', cue='{db['cue']}', "
            f"error_type='{db['error_type']}', repeat_error={str(is_repeat).lower()}]"
        )
    return content


class LLMService:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._openai_client = None
        self._mistral_llm = None
        self._mistral_call = retry(
            wait=wait_exponential(
                multiplier=1,
                min=self._settings.llm_backoff_min_seconds,
                max=self._settings.llm_backoff_max_seconds,
            ),
            stop=stop_after_attempt(self._settings.llm_max_attempts),
            retry=retry_if_exception(_is_retryable),
            reraise=True,
        )(self._chat_mistral_once)

    # --- provider clients -------------------------------------------------
    def _ensure_client(self):
        if self._openai_client is None:
            settings = self._settings
            if not settings.openai_api_key and not settings.llm_base_url:
                raise RuntimeError(
                    "No LLM configured: set MISTRAL_API_KEY or OPENAI_API_KEY "
                    "(+ LLM_BASE_URL for a local endpoint)."
                )
            from openai import OpenAI

            kwargs: dict = {
                "api_key": settings.openai_api_key,
                "timeout": settings.llm_timeout_seconds,
                "max_retries": settings.llm_max_retries,
            }
            if settings.llm_base_url:
                kwargs["base_url"] = settings.llm_base_url
            self._openai_client = OpenAI(**kwargs)
        return self._openai_client

    def _ensure_mistral(self):
        if self._mistral_llm is None:
            from llama_index.llms.mistralai import MistralAI

            if not self._settings.mistral_api_key:
                raise RuntimeError(
                    "No LLM configured: set MISTRAL_API_KEY for the Mistral provider."
                )
            self._mistral_llm = MistralAI(
                model=self._settings.mistral_model,
                api_key=self._settings.mistral_api_key,
                timeout=self._settings.llm_timeout_seconds,
                max_retries=0,  # we handle rate-limit backoff ourselves (tenacity)
            )
        return self._mistral_llm

    def _require_configured(self) -> None:
        settings = self._settings
        if settings.llm_uses_mistral and not settings.mistral_api_key:
            raise RuntimeError("No LLM configured: set MISTRAL_API_KEY.")
        if not settings.llm_uses_mistral and not (
            settings.openai_api_key or settings.llm_base_url
        ):
            raise RuntimeError(
                "No LLM configured: set OPENAI_API_KEY (or LLM_BASE_URL + key)."
            )

    # --- public chat / complete ------------------------------------------
    def chat(
        self,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> str:
        """One provider call, capped at max_tokens (hard ceiling)."""
        settings = self._settings
        tokens = max_tokens or settings.llm_max_tokens
        if settings.llm_uses_mistral:
            return self._mistral_call(messages, tokens)
        return self._chat_openai(messages, tokens)

    def complete(self, prompt: str, max_tokens: int = 120) -> str:
        """Raw completion used by memory summarization (same backoff policy)."""
        messages = [ChatMessage(role=MessageRole.USER, content=prompt)]
        return self._mistral_call(messages, max_tokens) if self._settings.llm_uses_mistral else self._chat_openai(messages, max_tokens)

    def _chat_openai(self, messages: list[ChatMessage], max_tokens: int) -> str:
        client = self._ensure_client()
        payload = [{"role": m.role.value, "content": m.content} for m in messages]
        response = client.chat.completions.create(
            model=self._settings.llm_model,
            messages=payload,
            temperature=0.7,
            max_tokens=max_tokens,
            response_format=(
                {"type": "json_object"} if self._settings.llm_json_mode else None
            ),
        )
        return response.choices[0].message.content or "{}"

    def _chat_mistral_once(self, messages: list[ChatMessage], max_tokens: int) -> str:
        """Mistral call (backoff applied via tenacity in __init__).

        No retry-storm on 429s: each attempt waits longer, and we only retry
        rate limits / 5xx / timeouts.
        """
        llm = self._ensure_mistral()
        response = llm.chat(messages, max_tokens=max_tokens)
        return response.message.content or "{}"

    # --- high level turn -------------------------------------------------
    def play_scenario_turn(
        self,
        scenario: Scenario,
        memory: SummarizingMemory,
        transcript: str,
        diagnostic: StemDiagnostic | None = None,
        is_repeat: bool = False,
    ) -> TurnResponse:
        self._require_configured()

        system = SYSTEM_TEMPLATE.format_map({
            "character": _character_for(scenario),
            "scenario_title": scenario.title,
            "context": scenario.context,
            "location": scenario.location,
            "difficulty": scenario.difficulty.value,
        })

        memory.put(ChatMessage(role=MessageRole.USER, content=render_user_content(
            transcript, diagnostic, is_repeat
        )))
        messages = [
            ChatMessage(role=MessageRole.SYSTEM, content=system),
            *memory.get(),
        ]

        content = self.chat(messages)

        try:
            data = json.loads(content) if isinstance(content, str) else content
        except json.JSONDecodeError:
            logger.warning("LLM returned non-JSON; coercing: %s", content[:200])
            data = {"ai_text": content, "ai_translation": "", "feedback": {}}

        ai_text = data.get("ai_text", "") or content
        feedback = self._clean_feedback(data.get("feedback") or {}, transcript, ai_text)

        memory.put(ChatMessage(role=MessageRole.ASSISTANT, content=ai_text))

        return TurnResponse(
            ai_text=ai_text,
            ai_translation=data.get("ai_translation", ""),
            feedback=feedback,
        )

    def _clean_feedback(self, raw: dict, transcript: str, ai_text: str) -> Feedback:
        try:
            feedback = Feedback.model_validate(raw)
        except Exception:
            logger.warning("Invalid feedback from LLM: %s", str(raw)[:300])
            feedback = Feedback()

        # If the model dropped ai_text into feedback (or nothing at all),
        # keep a usable default so the UI never breaks.
        if feedback.vocab:
            fb_words = {v.word for v in feedback.vocab}
            stems = {w: analyze_swahili_word(w) for w in fb_words}
            feedback.vocab = [self._note_from_stem(v.word, v.note, stems) for v in feedback.vocab]
        else:
            words = [w.strip(" .?,!") for w in transcript.split() if w.strip(" .?,!")]
            stems = {w: analyze_swahili_word(w) for w in words if w.isalpha()}
            feedback.vocab = [self._note_from_stem(w, "", stems) for w in stems]
        return feedback

    @staticmethod
    def _note_from_stem(
        word: str, note: str, stems: dict[str, StemAnalysis]
    ) -> "VocabNote":
        from app.models.schemas import VocabNote

        stem = stems.get(word)
        return VocabNote(
            word=word,
            breakdown=stem.breakdown if stem else "",
            note=note or "Word from your reply to review.",
        )


def _character_for(scenario: Scenario) -> str:
    mapping = {
        "market": "a market vendor selling produce (mhuzaaji)",
        "taxi": "a friendly but stubborn taxi driver (dereva)",
        "restaurant": "a waiter at a small restaurant (mhudumu)",
        "neighbourhood": "an elderly neighbour (mjomba)",
        "clinic": "a nurse at the clinic (muuguzi)",
        "bank": "a bank officer (afisa benki)",
        "town": "a passer-by helping with directions",
        "phone_shop": "a phone repair technician (fundi wa simu)",
        "office": "an interviewer (mhoji)",
        "real_estate": "a landlord (mkodishaji)",
    }
    return mapping.get(scenario.location, "a local speaker (mzungumzaji)")