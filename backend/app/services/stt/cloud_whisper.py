from __future__ import annotations

import base64
import io
import logging

from app.models.schemas import Transcript
from app.services.stt.base import SpeechToText, SpeechToTextError

logger = logging.getLogger(__name__)


class CloudWhisperSTT(SpeechToText):
    """Cloud STT via the OpenAI Whisper API (``whisper-1``).

    Zero local compute, but every request is uploaded to the API. A natural
    fallback when the local model is too small or the device is a phone.
    """

    engine = "openai-whisper"

    def __init__(self, api_key: str | None, model: str = "whisper-1") -> None:
        if not api_key:
            raise SpeechToTextError("OPENAI_API_KEY is not set (cloud STT).")
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key)
        self.model = model

    def transcribe(self, audio: bytes, language: str = "sw") -> Transcript:
        try:
            transcript = self._client.audio.transcriptions.create(
                model=self.model,
                file=("audio.webm", io.BytesIO(audio), "audio/webm"),
                language=language,
                response_format="json",
            )
        except Exception as exc:  # pragma: no cover - network dependent
            raise SpeechToTextError(f"OpenAI Whisper API failed: {exc}") from exc

        text = transcript.text.strip()
        if not text:
            raise SpeechToTextError("No speech detected in the audio.")
        return Transcript(text=text, language=language, engine=self.engine)