from __future__ import annotations

import json
import logging
import random
import re
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


def _parse_llm_json(content: str) -> dict:
    """Parse JSON from LLM output, extracting from markdown fences or surrounding prose if needed."""
    cleaned = content.strip()
    try:
        res = json.loads(cleaned)
        if isinstance(res, dict):
            return res
    except json.JSONDecodeError:
        pass

    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
    if fence_match:
        try:
            res = json.loads(fence_match.group(1).strip())
            if isinstance(res, dict):
                return res
        except json.JSONDecodeError:
            pass

    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            res = json.loads(cleaned[first_brace : last_brace + 1])
            if isinstance(res, dict):
                return res
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError("Could not extract JSON from LLM response", content, 0)


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
        if primary == "gemini":
            if not (settings.gemini_api_key or settings.mistral_api_key or settings.openai_api_key or settings.llm_base_url):
                raise RuntimeError(
                    "No LLM configured: set GEMINI_API_KEY (MISTRAL_API_KEY "
                    "works as an automatic fallback)."
                )
            return
        if primary == "mistral":
            if not (settings.mistral_api_key or settings.gemini_api_key or settings.openai_api_key or settings.llm_base_url):
                raise RuntimeError(
                    "No LLM configured: set MISTRAL_API_KEY (GEMINI_API_KEY "
                    "works as an automatic fallback)."
                )
            return
        if not (
            settings.openai_api_key or settings.llm_base_url or settings.gemini_api_key or settings.mistral_api_key
        ):
            raise RuntimeError(
                "No LLM configured: set GEMINI_API_KEY, MISTRAL_API_KEY, "
                "or OPENAI_API_KEY in .env."
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

        Primary provider first (default: Gemini); Mistral is appended as an
        automatic fallback whenever its key is configured (so Gemini rate-limits
        or outages degrade gracefully instead of failing the turn). The two
        callables let :meth:`chat` pick patience (full Retry-After backoff)
        when this is the only provider, or fast fail-over when a fallback
        exists.
        """
        settings = self._settings
        chain: list[tuple[str, Any, Any]] = []
        primary = settings.llm_provider.strip().lower()
        if primary == "gemini" and settings.gemini_api_key:
            chain.append(("gemini", self._gemini_call, self._chat_gemini_once))
        elif primary == "mistral" and settings.mistral_api_key:
            chain.append(("mistral", self._mistral_call, self._chat_mistral_once))
        elif primary == "openai" and (settings.openai_api_key or settings.llm_base_url):
            chain.append(("openai", self._chat_openai, self._chat_openai))

        fallback_order = (
            ["mistral", "openai"] if primary == "gemini" else ["gemini", "mistral", "openai"]
        )
        for prov in fallback_order:
            if prov in [n for n, _, _ in chain]:
                continue
            if prov == "gemini" and settings.gemini_api_key:
                chain.append(("gemini", self._gemini_call, self._chat_gemini_once))
            elif prov == "mistral" and settings.mistral_api_key:
                chain.append(("mistral", self._mistral_call, self._chat_mistral_once))
            elif prov == "openai" and (settings.openai_api_key or settings.llm_base_url):
                chain.append(("openai", self._chat_openai, self._chat_openai))
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
            data = _parse_llm_json(content) if isinstance(content, str) else content
        except Exception:
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
