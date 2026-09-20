from __future__ import annotations

from abc import ABC, abstractmethod

from app.models.schemas import Transcript


class SpeechToTextError(Exception):
    pass


class SpeechToText(ABC):
    engine = "base"

    @abstractmethod
    def transcribe(self, audio: bytes, language: str = "sw") -> Transcript:
        raise NotImplementedError