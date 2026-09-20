from __future__ import annotations

import io
import logging

from app.core.config import Settings, get_settings
from app.models.schemas import Transcript
from app.services.stt.base import SpeechToText, SpeechToTextError

logger = logging.getLogger(__name__)


class FasterWhisperSTT(SpeechToText):
    """Local, on-device STT via faster-whisper (CTranslate2).

    Hugely more efficient than openai-whisper (4-8x faster on CPU, much lower
    RAM). Choose model size to match your hardware:

      - ``tiny``  : ~75 MB, ~1 GB RAM. Fast but rough for accents.
      - ``base``  : ~145 MB, still light and a good default on modest CPUs.
      - ``small`` : ~460 MB, the best accuracy/speed tradeoff if you have 4 GB+.
      - ``medium``/``large-v3``: only sensible with a GPU or a lot of patience.
    """

    engine = "faster-whisper"

    def __init__(self, model_name: str | None = None) -> None:
        settings: Settings = get_settings()
        self.model_name = model_name or settings.local_whisper_model
        self.device = settings.local_whisper_device
        self.compute_type = settings.local_whisper_compute_type
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            logger.info(
                "Loading faster-whisper model=%s device=%s compute=%s",
                self.model_name,
                self.device,
                self.compute_type,
            )
            self._model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe(self, audio: bytes, language: str = "sw") -> Transcript:
        try:
            model = self._ensure_model()
            segments, info = model.transcribe(
                io.BytesIO(audio),
                language=language,
                vad_filter=True,
                beam_size=5,
                best_of=5,
                temperature=0.0,
                condition_on_previous_text=False,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        except Exception as exc:  # pragma: no cover - env-dependent
            raise SpeechToTextError(f"faster-whisper failed: {exc}") from exc

        if not text:
            raise SpeechToTextError("No speech detected in the audio.")
        return Transcript(text=text, language=info.language, engine=self.engine)