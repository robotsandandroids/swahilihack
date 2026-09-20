from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Difficulty(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class Scenario(BaseModel):
    id: str
    title: str
    title_sw: str
    context: str
    location: str = "market"
    difficulty: Difficulty
    opening_line: str
    hint_sw: str | None = None
    hint_en: str | None = None
    key_vocab: list[str] = Field(default_factory=list)


class SessionStatus(str, Enum):
    active = "active"
    completed = "completed"


class Session(BaseModel):
    id: str
    scenario_id: str
    difficulty: Difficulty
    status: SessionStatus = SessionStatus.active
    turn: int = 0
    history: list[dict] = Field(default_factory=list)


class StartSessionRequest(BaseModel):
    scenario_id: str
    difficulty: Difficulty | None = None


class TurnRequest(BaseModel):
    session_id: str | None = None
    transcript: str | None = None
    audio_base64: str | None = None
    # Optionally skip STT even when audio is attached (client-side ASR)
    skip_stt: bool = False


class Correction(BaseModel):
    original: str = ""
    corrected: str = ""
    reason: str = ""


class VocabNote(BaseModel):
    word: str = ""
    breakdown: str = ""
    note: str = ""


class Feedback(BaseModel):
    score: int = Field(default=0, ge=0, le=100)
    comprehension: int = Field(default=0, ge=0, le=100)
    grammar: int = Field(default=0, ge=0, le=100)
    enunciation: int = Field(default=0, ge=0, le=100)
    headline: str = ""
    corrections: list[Correction] = Field(default_factory=list)
    good_points: list[str] = Field(default_factory=list)
    vocab: list[VocabNote] = Field(default_factory=list)
    suggestion: str = ""


class TurnResponse(BaseModel):
    ai_text: str = ""
    ai_translation: str = ""
    feedback: Feedback | None = None
    session_status: SessionStatus = SessionStatus.active
    turn: int = 0
    turns_left: int = 0


class Transcript(BaseModel):
    text: str
    language: str = "sw"
    engine: str = ""

    @property
    def normalized(self) -> str:
        return " ".join(self.text.lower().split())


class StemSegment(BaseModel):
    segment: str
    kind: str  # subject | tense | object | negation | verb_stem | infinitive | final_vowel | nominal | unknown
    gloss: str = ""


class StemAnalysis(BaseModel):
    word: str
    breakdown: str  # e.g. "ku-li-a"
    segments: list[StemSegment]
    lemma: str = ""
    is_swahili: bool = False
    confidence: float = 0.0