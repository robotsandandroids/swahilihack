from __future__ import annotations

import json
import logging
import random
from typing import Any

from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
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

- Ongea na mwanafunzi ukiwa katika nafasi ya {character} katika mazingira ya {location}, kwa Kiswahili cha asili na sahihi.
- Katika mazungumzo, jibu mwanafunzi kwa Kiswahili pekee.
- Dumisha tabia, mazingira, na muktadha wa scenario wakati wote.
- Jibu kwa njia ya kawaida na ya mazungumzo, kana kwamba mwanafunzi anaongea na mtu halisi.
- Usibadilishe mazungumzo kuwa somo la sarufi isipokuwa feedback inahitajika.
- Baada ya kila jibu la mwanafunzi, toa:
    1) jibu lako la Kiswahili ndani ya "ai_text",
    2) tafsiri ya Kiingereza ndani ya "ai_translation",
    3) alama na mrejesho ndani ya "feedback".
- Jibu la mwanafunzi linapokosea kisarufi, onyesha marekebisho halisi ndani ya "feedback".
- Dumisha mazungumzo hadi suala litulie; usijirudie.

LANGUAGE FIREWALL — STRICT:

Kuna sehemu mbili tofauti kabisa katika jibu lako:

MODE 1 — CONVERSATION:

"ai_text" ndiyo sehemu ya mazungumzo ya moja kwa moja na mwanafunzi.

"ai_text" LAZIMA iwe Kiswahili 100%.

"ai_text" HAIPASWI kuwa na:
- maneno ya Kiingereza;
- sentensi za Kiingereza;
- tafsiri;
- maelezo ya sarufi;
- maelezo ya parser;
- taarifa za diagnostic;
- maelezo ya kamusi;
- maelezo ya morphology;
- code-switching;
- mabano yenye maelezo ya Kiingereza.

Jibu katika "ai_text" kana kwamba wewe ni mhusika halisi anayezungumza
Kiswahili katika scenario.

Ikiwa dhana fulani kwa kawaida huonyeshwa kwa neno la Kiingereza,
tafuta usemi rahisi na wa asili wa Kiswahili badala ya kukopa neno hilo,
isipokuwa neno hilo limekuwa matumizi ya kawaida na muhimu katika
muktadha wa Kiswahili.

MODE 2 — ANALYSIS:

"ai_translation" na "feedback" ni sehemu za uchambuzi na msaada kwa
mwanafunzi.

Kiingereza kinaruhusiwa katika:
- "ai_translation";
- "feedback.headline";
- "feedback.reason";
- "feedback.good_points";
- "feedback.suggestion".

USICHANGANYE MODE 1 NA MODE 2.

Taarifa kutoka "ai_translation" au "feedback" HAIRUHUSIWI kuingia ndani
ya "ai_text".

Kabla ya kutoa "ai_text", hakikisha kwamba jibu hilo lina Kiswahili
pekee na halina code-switching.

STRUCTURED DIAGNOSTIC:

- Kila ujumbe wa mwanafunzi UNAWEZA kuwa na block ya
  "[diagnostic: ...]".
- Block hii ni matokeo ya analysis ya deterministic, si matokeo ya LLM.
- Diagnostic inaweza kueleza tatizo moja la kisarufi, kwa mfano
  tense marker dhidi ya time cue.
- Diagnostic ni taarifa ya ndani ya uchambuzi. SI sehemu ya mazungumzo.

Ikiwa "[diagnostic: ...]" ipo:

1. Tumia diagnostic kuelewa tatizo lililotambuliwa.
2. Eleza rule katika sentensi moja au mbili kwa Kiingereza rahisi ndani
   ya "feedback".
3. Ikiwa kuna kosa, toa correction halisi ndani ya "feedback.corrections".
4. Usitaje parser, diagnostic, metadata, au internal analysis ndani ya
   "ai_text".
5. Usirudie maelezo marefu kwa kosa lilelile.

Mfano:

"li = past; with 'jana' (yesterday), use li rather than ta."

Ikiwa "repeat_error=true":

- Mwanafunzi anarudia kosa lilelile.
- Toa ukumbusho mfupi wa mara moja tu ndani ya feedback.
- Usirudie maelezo marefu ya rule.
- Endelea na mazungumzo.

Ikiwa hakuna "[diagnostic: ...]":

- Usibuni tatizo la tense.
- Usilazimishe correction ya tense.
- Endelea na mazungumzo kwa kawaida.

MAJIBU YAKO NI JSON PEKEE katika muundo huu:

{{
  "ai_text": "Kiswahili safi pekee. Hakuna Kiingereza wala code-switching.",
  "ai_translation": "English translation of ai_text only.",
  "feedback": {{
    "headline": "Very short English phrase.",
    "score": 0,
    "comprehension": 0,
    "grammar": 0,
    "enunciation": 0,
    "corrections": [
      {{
        "original": "Wrong Swahili sentence or phrase.",
        "corrected": "Correct Swahili sentence or phrase.",
        "reason": "Short English explanation."
      }}
    ],
    "good_points": [
      "What the learner did well, in English."
    ],
    "suggestion": "One short English cue for the next reply."
  }}
}}

MAJUKUMU YA KILA SEHEMU YA JSON:

- "ai_text":
    Hii ndiyo sehemu ya mazungumzo.
    Ina Kiswahili pekee.
    Usitumie Kiingereza, tafsiri, maelezo ya sarufi, parser information,
    diagnostic information, au code-switching hapa.
    Jibu kama mhusika wa scenario.

- "ai_translation":
    Hii ni tafsiri ya Kiingereza ya "ai_text" pekee.
    Usiongeze taarifa ambazo hazipo katika "ai_text".
    Usibadilishe maana ya "ai_text".

- "feedback":
    Hii ni sehemu ya kumsaidia mwanafunzi kuelewa kosa au mafanikio yake.
    Tumia Kiingereza katika sehemu za feedback zilizoainishwa.

- "corrections":
    "original" lazima iwe Kiswahili cha mwanafunzi.
    "corrected" lazima iwe Kiswahili sahihi.
    "reason" lazima iwe maelezo mafupi ya Kiingereza.
    Tofautisha kosa la spelling na kosa la grammar inapowezekana.

LANGUAGE AND CORRECTION RULES:

- NEVER code-switch inside "ai_text".
- "ai_text" MUST contain Kiswahili only.
- DO NOT put English words, explanations, translations, grammar notes,
  parser information, diagnostic information, or dictionary information
  inside "ai_text".
- English is allowed ONLY in "ai_translation" and the specified English
  feedback fields.
- Do not translate the learner's sentence inside "ai_text".
- Do not explain why a sentence is correct or incorrect inside "ai_text".
- If a correction is necessary, put the correction in "feedback".
- corrections must be concrete and grammatical.
- Use an empty corrections list when there is no clear error.
- Do not invent errors simply to provide feedback.
- Do not correct a word merely because it is unfamiliar.
- Preserve the intended meaning of the learner's sentence when correcting it.
- Score fairly for level {difficulty}.
- If the learner message is empty, keep the score low and prompt them to speak.
- Keep "ai_text" short: normally 1-2 sentences.
- Do not unnecessarily repeat what you have already said.
- Keep responses natural and conversational.
- Do not expose internal reasoning or analysis.
- Return valid JSON only. Do not add Markdown, comments, or text outside
  the JSON object.
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


def _retry_after_seconds(retry_state) -> float | None:
    """Honour the provider's ``Retry-After`` header (secs) when present.

    Mistral and OpenAI rate-limit responses frequently include one; blindly
    re-polling before it elapses just burns attempts and keeps tripping the
    limiter. ``None`` when the server gave no hint.
    """
    if retry_state.outcome is None or not retry_state.outcome.failed:
        return None
    exc = retry_state.outcome.exception()
    headers = getattr(exc, "headers", None) or {}
    value = headers.get("retry-after")
    if value is None:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    return max(seconds, 0.0)


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
        self._gemini_llm = None
        self._mistral_call = self._retried(self._chat_mistral_once)
        self._gemini_call = self._retried(self._chat_gemini_once)

    def _retried(self, fn):
        """tenacity policy shared by every provider we call directly."""
        return retry(
            wait=self._wait,
            stop=stop_after_attempt(self._settings.llm_max_attempts),
            retry=retry_if_exception(_is_retryable),
            reraise=True,
        )(fn)

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

    def _ensure_gemini(self):
        if self._gemini_llm is None:
            from llama_index.llms.gemini import Gemini

            if not self._settings.gemini_api_key:
                raise RuntimeError(
                    "Gemini is not configured: set GEMINI_API_KEY in .env."
                )
            model = self._settings.gemini_model
            if not model.startswith("models/"):
                model = f"models/{model}"
            self._gemini_llm = Gemini(
                model=model,
                api_key=self._settings.gemini_api_key,
                temperature=0.7,
                max_tokens=self._settings.llm_max_tokens,
            )
        return self._gemini_llm

    def _require_configured(self) -> None:
        settings = self._settings
        primary = settings.llm_provider.strip().lower()
        if primary == "mistral":
            if not (settings.mistral_api_key or settings.gemini_api_key):
                raise RuntimeError(
                    "No LLM configured: set MISTRAL_API_KEY (GEMINI_API_KEY "
                    "works as an automatic fallback)."
                )
            return
        if primary == "gemini":
            if not settings.gemini_api_key:
                raise RuntimeError(
                    "No LLM configured: set GEMINI_API_KEY (or switch "
                    "LLM_PROVIDER back to mistral)."
                )
            return
        if not settings.llm_uses_mistral and not (
            settings.openai_api_key or settings.llm_base_url or settings.gemini_api_key
        ):
            raise RuntimeError(
                "No LLM configured: set OPENAI_API_KEY (or LLM_BASE_URL + key), "
                "or GEMINI_API_KEY as a fallback."
            )

    # --- public chat / complete ------------------------------------------
    def _wait(self, retry_state) -> float:
        """Wait for the next retry: Retry-After if given, else jittered exp.

        Jitter prevents bursts colliding; ``Retry-After`` is capped at
        ``llm_max_wait_seconds`` so a pathological value can't stall a demo.
        """
        settings = self._settings
        base = settings.llm_backoff_min_seconds * (
            2 ** (retry_state.attempt_number - 1)
        )
        backoff = min(base * (1 + random.uniform(0, 0.2)), settings.llm_backoff_max_seconds)
        server = _retry_after_seconds(retry_state)
        if server is None:
            return backoff
        return min(server, settings.llm_max_wait_seconds)

    def _provider_chain(self) -> list[tuple[str, Any, Any]]:
        """Ordered (name, retried_call, quick_call) providers for this call.

        Primary provider first; Gemini is appended as an automatic fallback
        whenever its key is configured (so Mistral/OpenAI rate-limit or
        outages degrade gracefully instead of failing the turn). The two
        callables let :meth:`chat` pick patience (full Retry-After backoff)
        when this is the only provider, or fast fail-over when a fallback
        exists.
        """
        settings = self._settings
        chain: list[tuple[str, Any, Any]] = []
        primary = settings.llm_provider.strip().lower()
        if primary == "mistral" and settings.mistral_api_key:
            chain.append(("mistral", self._mistral_call, self._chat_mistral_once))
        elif primary == "openai" and (settings.openai_api_key or settings.llm_base_url):
            chain.append(("openai", self._chat_openai, self._chat_openai))
        elif primary == "gemini":
            chain.append(("gemini", self._gemini_call, self._chat_gemini_once))

        if settings.gemini_api_key and "gemini" not in [n for n, _, _ in chain]:
            chain.append(("gemini", self._gemini_call, self._chat_gemini_once))
        return chain

    def chat(
        self,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> str:
        """One call through the provider chain, capped at max_tokens.

        With a fallback configured the primary gets one quick attempt then
        fails over immediately (a 429 must not stall the turn); alone, the
        provider retries with full Retry-After-aware backoff.
        """
        settings = self._settings
        tokens = max_tokens or settings.llm_max_tokens
        chain = self._provider_chain()
        if not chain:
            raise RuntimeError(
                "No LLM configured: set MISTRAL_API_KEY, OPENAI_API_KEY, "
                "or GEMINI_API_KEY in .env."
            )
        patient = len(chain) == 1
        last_error: Exception | None = None
        for name, retried, quick in chain:
            try:
                return (retried if patient else quick)(messages, tokens)
            except Exception as exc:  # try the next provider in the chain
                logger.warning("LLM provider '%s' failed: %s", name, exc)
                last_error = exc
        assert last_error is not None
        raise last_error

    def complete(self, prompt: str, max_tokens: int = 120) -> str:
        """Raw completion used by memory summarization (same fallback chain)."""
        messages = [ChatMessage(role=MessageRole.USER, content=prompt)]
        return self.chat(messages, max_tokens)

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
        """Mistral call (retry/backoff applied via tenacity in __init__).

        No retry-storm on 429s: each attempt waits longer (honouring the
        provider's Retry-After), and we only retry rate limits / 5xx / timeouts.
        """
        llm = self._ensure_mistral()
        response = llm.chat(messages, max_tokens=max_tokens)
        return response.message.content or "{}"

    def _chat_gemini_once(self, messages: list[ChatMessage], max_tokens: int) -> str:
        """Gemini call — used directly (LLM_PROVIDER=gemini) or as the
        automatic fallback when Mistral/OpenAI fail. Output is forced into
        the same JSON-ish contract via prompt; the parser coerce-guards it.
        """
        llm = self._ensure_gemini()
        response = llm.chat(messages)
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

        try:
            content = self.chat(messages)
        except Exception as exc:
            # Surface provider errors (rate limit, quota, timeouts) as a
            # friendly RuntimeError so the API layer (->503) and the showcase
            # (st.error) can present them without crashing the UI.
            detail = _status_code(exc)
            raise RuntimeError(
                f"Tutor LLM unavailable (provider {'HTTP ' + str(detail) if detail else 'error'}): "
                f"{type(exc).__name__}: {exc}. "
                "If you hit a rate limit, wait a bit and retry."
            ) from exc

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
