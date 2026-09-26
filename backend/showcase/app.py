"""Mzizi AI backend showcase (Streamlit).

Drives the SAME production pipeline as the FastAPI turn endpoint; the
``showcase`` imports :func:`app.services.pipeline.run_turn` directly so every
turn exercises byte-for-byte the real path (no API server needed):

    audio (ASR) / text -> (deterministic) stemmer diagnostic -> LlamaIndex
    memory (ChatMemoryBuffer + summarization) -> error cache (repeat_error)
    -> Mistral/OpenAI tutor (Swahili reply + structured feedback) ->
    edge-tts speech + rendered text

Run:

    cd backend
    uv run streamlit run showcase/app.py

Toggle ``Demo mode`` in the sidebar to explore the UI without a Mistral/OpenAI
key (edge-tts still speaks the replies — it needs no key).
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/ on path

from app.core.config import get_settings  # noqa: E402
from app.models.schemas import Session, SessionStatus  # noqa: E402
from app.models.scenarios import get_scenario, list_scenarios  # noqa: E402
from app.services.llm import LLMService  # noqa: E402
from app.services.memory import MemoryRegistry  # noqa: E402
from app.services.pipeline import run_turn  # noqa: E402
from app.services.store import store  # noqa: E402
from app.services.stt.base import SpeechToTextError  # noqa: E402
from app.services.stt.factory import get_stt  # noqa: E402
from app.services.tts import synthesize  # noqa: E402

st.set_page_config(page_title="Mzizi AI Backend Showcase", layout="wide")

settings = get_settings()
llm = LLMService()
registry = MemoryRegistry(store)

TAM_LABEL = {
    "na": "present continuous (-ing)",
    "li": "past (-ed)",
    "me": "perfect (have/has -ed)",
    "ta": "future (will)",
    "ka": "consecutive (and then)",
    "nge": "conditional (would)",
    "ja": "not yet (haven't yet)",
}


class FakeLLM:
    """Deterministic stand-in so the UI is explorable without an API key."""

    def complete(self, prompt: str, max_tokens: int = 120) -> str:
        return "Demo mode: learner practised market vocabulary and tenses."

    def play_scenario_turn(
        self, scenario, memory, transcript, diagnostic=None, is_repeat=False
    ):
        from app.models.schemas import Correction, Feedback, TurnResponse

        feedback = Feedback(
            score=85, comprehension=90, grammar=70, enunciation=88,
            headline="Vizuri sana!",
            corrections=[],
            good_points=["You responded in character."],
            suggestion="Try asking the price of the mangoes next.",
        )
        ai_text = "Uh, sawa! Hizi bepari nyingine ziko laki moja. Unataka?"
        if diagnostic is not None and diagnostic.has_error:
            feedback = Feedback(
                score=60, comprehension=90, grammar=55, enunciation=88,
                headline="Karibu sana! Fikiria wakati (tense).",
                corrections=[Correction(
                    original=transcript.strip(),
                    corrected="nilikula jana" if diagnostic.expected_marker == "li" else "nitakula kesho",
                    reason=(
                        f"'{diagnostic.cue}' (yesterday/tomorrow) needs the "
                        f"{TAM_LABEL.get(diagnostic.expected_marker, diagnostic.expected_marker)} "
                        f"marker '{diagnostic.expected_marker}', not '{diagnostic.given_marker}'."
                    ),
                )],
                good_points=["Good attempt at speaking!"],
                suggestion="Retry with the corrected tense marker.",
            )
            if is_repeat:
                ai_text = "Sawa! Kumbuka: li, si ta, kwa 'jana'."
        return TurnResponse(
            ai_text=ai_text,
            ai_translation="Okay! These other mangoes are a hundred thousand. You want?",
            feedback=feedback,
        )


# --- sidebar ---------------------------------------------------------------

st.sidebar.title("Mzizi AI backend")
st.sidebar.caption("Gemini + LlamaIndex memory + deterministic stemmer")

has_key = (
    settings.gemini_api_key
    or settings.mistral_api_key
    or settings.openai_api_key
    or settings.llm_base_url
)
demo = st.sidebar.toggle("Demo mode (no API key)", value=not has_key)

fallback_label = "none"
if settings.llm_uses_gemini and settings.mistral_api_key:
    fallback_label = f"mistral ({settings.mistral_model})"
elif settings.gemini_api_key:
    fallback_label = f"gemini ({settings.gemini_model})"
elif settings.mistral_api_key:
    fallback_label = f"mistral ({settings.mistral_model})"

st.sidebar.subheader("Runtime")
st.sidebar.json({
    "provider": settings.llm_provider,
    "model": settings.llm_active_model,
    "fallback": fallback_label,
    "stt": settings.stt_engine,
    "tts": f"{settings.tts_engine} ({settings.tts_voice})",
    "max_tokens": settings.llm_max_tokens,
    "backoff": f"{settings.llm_backoff_min_seconds}-{settings.llm_backoff_max_seconds}s "
               f"x{settings.llm_max_attempts}",
})
st.sidebar.subheader("Memory (ChatMemoryBuffer)")
st.sidebar.json({
    "token_limit": settings.memory_token_limit,
    "summarize_every": f"{settings.memory_summarize_every} turns",
    "keep_recent": settings.memory_keep_recent,
})
st.sidebar.subheader("Stemmer diagnostic")
st.sidebar.json({
    "enabled": settings.stemmer_diagnostics,
    "cues": {"jana": "li", "kesho": "ta"},
    "inject": "only on error",
})

if st.sidebar.button("Reset session"):
    for key in ("session", "last_turn", "_output_audio"):
        st.session_state.pop(key, None)
    st.rerun()


# --- scenario / session ----------------------------------------------------

st.title("Psst! Practice spoken Swahili")
st.caption("Pick a scenario, the AI vendor speaks first, you reply by voice or text.")

col_l, col_r = st.columns([2, 2])

with col_l:
    scenario_id = st.selectbox(
        "Scenario",
        [s.id for s in list_scenarios()],
        format_func=lambda sid: f"{get_scenario(sid).title}  ({get_scenario(sid).difficulty.value})",
    )
    scenario = get_scenario(scenario_id)

if "session" not in st.session_state or st.session_state.get("scenario_id") != scenario_id:
    st.session_state.scenario_id = scenario_id
    snapshot = Session(
        id=uuid.uuid4().hex[:12],
        scenario_id=scenario.id,
        difficulty=scenario.difficulty,
        history=[{"role": "assistant", "content": scenario.opening_line}],
    )
    store.save(snapshot)
    registry.drop(snapshot.id)
    st.session_state.session = snapshot
    st.session_state.pop("last_turn", None)
    st.session_state.pop("_output_audio", None)

session: Session = st.session_state.session
memory = registry.memory_for(session.id, FakeLLM() if demo else llm)
cache = registry.error_cache_for(session.id)

with col_l:
    st.subheader("Conversation")
    for m in memory.to_history():
        if m["role"] == "assistant":
            st.chat_message("assistant").write(m["content"])
        else:
            st.chat_message("user").write(m["content"])

    if session.status == SessionStatus.completed:
        st.info(f"Session complete ({session.turn}/{settings.session_max_turns} turns used).")

    with st.form("turn", clear_on_submit=True):
        text = st.text_input("Reply in Swahili (text)", key="reply_text")
        audio = st.audio_input("Or record your reply", key="_audio_input")
        submitted = st.form_submit_button(
            f"Send reply (turn {session.turn + 1}/{settings.session_max_turns})", type="primary"
        )

if submitted and (text.strip() or audio is not None):
    transcript = text.strip()
    used_audio = audio is not None
    if used_audio:
        audio_bytes = audio.getvalue()
        if len(audio_bytes) > settings.max_audio_bytes:
            st.error(
                f"Audio too large ({len(audio_bytes)} bytes; "
                f"max {settings.max_audio_bytes}). Send text instead."
            )
            transcript = ""
        else:
            with st.spinner("Transcribing (local faster-whisper)…"):
                try:
                    transcript = get_stt().transcribe(
                        audio_bytes, language="sw"
                    ).text
                except SpeechToTextError as exc:  # model download / engine error
                    st.error(f"STT failed: {exc}. Send text instead.")
                    transcript = ""

    if transcript:
        with col_l:
            with st.spinner("Diagnosing + calling the tutor LLM…"):
                try:
                    # Same production pipeline as the FastAPI turn endpoint:
                    # stemmer diagnostic -> memory -> Mistral/OpenAI tutor.
                    outcome = run_turn(
                        session,
                        scenario,
                        transcript,
                        llm=FakeLLM() if demo else llm,
                        registry=registry,
                        max_turns=settings.session_max_turns,
                    )
                except RuntimeError as exc:
                    st.error(f"Tutor LLM failed: {exc}")
                    outcome = None
                except Exception as exc:  # never let a provider escape crash the UI
                    st.error(f"Unexpected pipeline error: {type(exc).__name__}: {exc}")
                    outcome = None

            if outcome is not None:
                # Speak the tutor's Swahili reply (edge-tts; empty if disabled).
                st.session_state.last_turn = (outcome, used_audio)
                if settings.tts_enabled:
                    with st.spinner("Synthesizing reply speech (edge-tts)…"):
                        st.session_state._output_audio = synthesize(
                            outcome.reply.ai_text
                        )
                else:
                    st.session_state._output_audio = None
                st.rerun()


# --- right column: feedback + under the hood --------------------------------

with col_r:
    last = st.session_state.get("last_turn")
    if last:
        outcome, used_audio = last
        reply = outcome.reply
        diag = outcome.diagnostic
        is_repeat = outcome.is_repeat
        transcript = outcome.transcript
        fb = reply.feedback

        st.subheader("Tutor reply (Swahili & speech)")
        st.markdown(reply.ai_text)
        if reply.ai_translation:
            st.caption(reply.ai_translation)
        reply_audio = st.session_state.get("_output_audio")
        if reply_audio:
            st.audio(reply_audio, format="audio/mp3", autoplay=True)
        elif settings.tts_enabled:
            st.warning("Speech synthesis returned no audio (offline?). Text shown above.")
        if used_audio:
            st.info(f":microphone: **Heard (STT):** `{transcript}`")
        elif transcript:
            st.caption(f"Reply received as text: `{transcript}`")

        if fb:
            st.subheader("Feedback")
            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Overall", f"{fb.score}")
            m2.metric("Grammar", f"{fb.grammar}")
            m3.metric("Comprehension", f"{fb.comprehension}")
            m4.metric("Enunciation", f"{fb.enunciation}")
            if fb.headline:
                st.write(f"**{fb.headline}**")
            for c in fb.corrections:
                st.warning(
                    f":fontawesome-solid-language: "
                    f"**{c.original or '—'}** -> **{c.corrected}** — {c.reason}"
                )
            for g in fb.good_points:
                st.success(g)
            if fb.suggestion:
                st.info(f"Next: {fb.suggestion}")
            if fb.vocab:
                st.markdown("**Vocabulary breakdown**")
                for v in fb.vocab:
                    if v.breakdown:
                        st.code(f"{v.word}: {v.breakdown}", language="text")
                        st.caption(v.note)

        st.divider()
        with st.expander("Under the hood (cost/rate-limit view)", expanded=True):
            if diag.has_error:
                st.markdown(
                    f"**Stemmer diagnostic** (injected into prompt): "
                    f"`{diag.compact()}`"
                )
                st.write(
                    f"root `{diag.root}` uses `{diag.given_marker}` "
                    f"({TAM_LABEL.get(diag.given_marker, '?')}) but cue "
                    f"`{diag.cue}` requires `{diag.expected_marker}` "
                    f"({TAM_LABEL.get(diag.expected_marker, '?')})."
                )
                st.write(
                    f":repeat: **repeat_error={is_repeat}** — "
                    + ("model keeps this to a one-line reminder." if is_repeat else "full re-teach.")
                )
            else:
                st.write("**Stemmer diagnostic:** *skipped* (sentence clean — no prompt tokens wasted).")
            if memory.summary():
                st.write(f"**Memory summary:** {memory.summary()}")
            st.write(f"**Turn count:** {memory.turn_count} user turns")
            if cache.counts():
                st.write(
                    "**Error cache:** "
                    + ", ".join(
                        f"`{t}/{r}` x{n}" for (t, r), n in sorted(cache.counts().items())
                    )
                )
            st.caption(
                f"Max output tokens capped at {settings.llm_max_tokens}; backoff "
                f"{'active' if not demo else '(demo)'} on 429/5xx."
            )

st.sidebar.caption("Leave the Next.js app alone — this is the backend showcase.")