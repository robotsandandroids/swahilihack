from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import Response
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.models.schemas import (
    Difficulty,
    Scenario,
    Session,
    SessionStatus,
    StartSessionRequest,
    TurnRequest,
    TurnResponse,
)
from app.models.scenarios import get_scenario
from app.services.llm import LLMService
from app.services.memory import MemoryRegistry
from app.services.pipeline import run_turn
from app.services.store import store
from app.services.stt.base import SpeechToTextError
from app.services.stt.factory import get_stt
from app.services.tts import synthesize

router = APIRouter(prefix="/api", tags=["sessions"])

_llm = LLMService()
_registry = MemoryRegistry(store)


def _pick_difficulty(scenario: Scenario, requested: Difficulty | None) -> Difficulty:
    if requested is not None:
        return requested
    return scenario.difficulty


@router.post("/sessions", response_model=dict)
def start_session(body: StartSessionRequest) -> dict:
    scenario = get_scenario(body.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")

    session = Session(
        id=uuid.uuid4().hex[:12],
        scenario_id=scenario.id,
        difficulty=_pick_difficulty(scenario, body.difficulty),
        history=[
            {"role": "assistant", "content": scenario.opening_line},
        ],
    )
    store.save(session)

    return {
        "session_id": session.id,
        "scenario": scenario.model_dump(),
        "opening_line": scenario.opening_line,
        "opening_line_en": scenario.title,
        "difficulty": session.difficulty.value,
        "max_turns": _max_turns(),
    }


def _max_turns() -> int:
    return get_settings().session_max_turns


def _scripts_turn(
    session: Session,
    scenario: Scenario,
    transcript: str,
    max_turns: int,
) -> TurnResponse:
    try:
        outcome = run_turn(
            session,
            scenario,
            transcript,
            llm=_llm,
            registry=_registry,
            max_turns=max_turns,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return outcome.reply


@router.post("/sessions/{session_id}/turns", response_model=TurnResponse)
async def play_turn(
    session_id: str,
    request: Request,
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),
    skip_stt: bool = Form(default=False),
) -> TurnResponse:
    settings: Settings = get_settings()
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.completed:
        raise HTTPException(status_code=400, detail="Session already completed")

    scenario = get_scenario(session.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")

    # Support either JSON body or multipart form.
    json_body = None
    if request.headers.get("content-type", "").startswith("application/json"):
        import json

        raw = await request.body()
        json_body = TurnRequest.model_validate_json(raw or b"{}")
        if json_body.transcript is None and json_body.audio_base64:
            import base64

            audio_bytes = base64.b64decode(json_body.audio_base64)
            if not json_body.skip_stt:
                transcript = _transcribe(settings, audio_bytes)
            else:
                transcript = ""
            skip_stt = json_body.skip_stt

    if json_body is not None and json_body.transcript is not None:
        transcript = json_body.transcript

    if transcript is not None and not transcript.strip() and not skip_stt:
        raise HTTPException(status_code=400, detail="Empty transcript")

    if transcript is None or (skip_stt and audio is not None):
        if audio is not None:
            audio_bytes = await audio.read()
            if len(audio_bytes) > settings.max_audio_bytes:
                raise HTTPException(status_code=413, detail="Audio too large")
            transcript = _transcribe(settings, audio_bytes)
        else:
            raise HTTPException(status_code=400, detail="Provide audio or transcript")

    transcript = transcript.strip()
    return _scripts_turn(session, scenario, transcript, _max_turns())


def _transcribe(settings: Settings, audio_bytes: bytes) -> str:
    try:
        result = get_stt().transcribe(audio_bytes, language="sw")
        return result.text
    except SpeechToTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=Session)
def get_session(session_id: str) -> Session:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/tts")
@router.get("/tts")
async def text_to_speech(
    request: Request,
    text: str | None = Form(default=None),
) -> Response:
    """Synthesize speech (MP3) for a Swahili string (edge-tts, no key)."""
    input_text = text
    if not input_text and request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
            if isinstance(body, dict):
                input_text = body.get("text")
        except Exception:
            pass
    if not input_text:
        input_text = request.query_params.get("text")
    if not input_text or not input_text.strip():
        raise HTTPException(status_code=400, detail="Text is required for TTS")
    audio = synthesize(input_text.strip())
    if not audio:
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )