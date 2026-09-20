from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.services.stt.base import SpeechToText
from app.services.stt.cloud_whisper import CloudWhisperSTT
from app.services.stt.local_faster_whisper import FasterWhisperSTT


@lru_cache
def get_stt() -> SpeechToText:
    settings = get_settings()
    if settings.stt_is_cloud:
        return CloudWhisperSTT(
            api_key=settings.openai_api_key,
            model=settings.whisper_cloud_model,
        )
    return FasterWhisperSTT()