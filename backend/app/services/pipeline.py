"""Shared single-turn production pipeline.

The canonical sequence every entry point uses — FastAPI routes
(``app/api/routes/sessions.py``) and the Streamlit showcase
(``showcase/app.py``) both funnel through :func:`run_turn` so the UI
exercises byte-for-byte the same path as the API:

    transcript -> (deterministic) stemmer diagnostic -> LlamaIndex memory
    (ChatMemoryBuffer + summarization) -> error cache (repeat_error) ->
    Mistral/OpenAI tutor (Swahili reply + structured feedback) -> persist

The LLM/client object is injected so the showcase can swap in a demo
stand-in without a key; memory, error cache, summarization and the stemmer
optimizations all stay identical either way.

The AST/STT step (``audio bytes -> transcript``) deliberately lives in the
callers: the FastAPI route decodes the upload/JSON payload and the showcase
reads ``st.audio_input``, then both hand a plain ``transcript`` string here.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.models.scenarios import Scenario
from app.models.schemas import Session, SessionStatus, TurnResponse
from app.services.memory import MemoryRegistry
from app.services.stemmer.diagnostic import StemDiagnostic, analyze_sentence
from app.services.store import store


@dataclass
class TurnOutcome:
    """What happened during one pipeline turn (raw + instrumentation)."""

    reply: TurnResponse
    transcript: str
    diagnostic: StemDiagnostic
    is_repeat: bool


def run_turn(
    session: Session,
    scenario: Scenario,
    transcript: str,
    *,
    llm,
    registry: MemoryRegistry | None = None,
    max_turns: int | None = None,
) -> TurnOutcome:
    """Run the production turn pipeline and persist the updated session.

    ``llm`` is required (an ``LLMService`` or a demo stand-in exposing
    ``play_scenario_turn``/``complete``). ``registry`` defaults to a
    per-session ``MemoryRegistry`` over the global ``store``.
    """
    settings: Settings = get_settings()
    if registry is None:
        registry = MemoryRegistry(store)
    if max_turns is None:
        max_turns = settings.session_max_turns

    memory = registry.memory_for(session.id, llm)

    # Deterministic stemmer pre-pass: only error diagnostics get injected, so
    # correct sentences pay no extra prompt tokens. Repeated mistakes get a
    # repeat_error flag so the model keeps the reminder to one line.
    diagnostic: StemDiagnostic = StemDiagnostic()
    is_repeat = False
    if settings.stemmer_diagnostics:
        diagnostic = analyze_sentence(transcript)
        if diagnostic.has_error:
            error_cache = registry.error_cache_for(session.id)
            is_repeat = error_cache.check_and_record(
                diagnostic.error_type or "unknown", diagnostic.root
            )

    # Mistral/OpenAI tutor: one call returns the Swahili reply + feedback.
    reply = llm.play_scenario_turn(
        scenario, memory, transcript, diagnostic, is_repeat
    )

    # Persist the structured snapshot (rebuildable via SummarizingMemory).
    session.history = memory.to_history()
    session.turn += 1
    if session.turn >= max_turns:
        session.status = SessionStatus.completed
    store.save(session)

    return TurnOutcome(
        reply=TurnResponse(
            ai_text=reply.ai_text,
            ai_translation=reply.ai_translation,
            feedback=reply.feedback,
            session_status=session.status,
            turn=session.turn,
            turns_left=max(max_turns - session.turn, 0),
        ),
        transcript=transcript,
        diagnostic=diagnostic,
        is_repeat=is_repeat,
    )