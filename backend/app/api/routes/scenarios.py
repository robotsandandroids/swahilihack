from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import Difficulty, Scenario, StemAnalysis
from app.models.scenarios import get_scenario, list_scenarios
from app.services.stemmer.diagnostic import analyze_sentence
from app.services.stemmer.swahili import analyze_swahili_word, breakdown_batch

router = APIRouter(prefix="/api", tags=["scenarios"])


@router.get("/scenarios", response_model=list[Scenario])
def get_scenarios(
    difficulty: Difficulty | None = Query(default=None),
) -> list[Scenario]:
    items = list_scenarios()
    if difficulty is not None:
        items = [s for s in items if s.difficulty == difficulty]
    return items


@router.get("/scenarios/{scenario_id}", response_model=Scenario)
def get_scenario_detail(scenario_id: str) -> Scenario:
    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


@router.get("/stem", response_model=StemAnalysis)
def stem_word(word: str = Query(min_length=1)) -> StemAnalysis:
    return analyze_swahili_word(word)


@router.post("/stem/batch", response_model=list[StemAnalysis])
def stem_batch(words: list[str]) -> list[StemAnalysis]:
    if not words or len(words) > 100:
        raise HTTPException(status_code=422, detail="Provide 1-100 words")
    return breakdown_batch(words)


@router.post("/stem/sentence", response_model=dict)
def stem_sentence(body: dict) -> dict:
    """Sentence-level diagnostic (deterministic, no LLM): tense-marker checks."""
    sentence = (body.get("sentence") or "").strip()
    if not sentence:
        raise HTTPException(status_code=422, detail="Provide a sentence")
    diagnostic = analyze_sentence(sentence)
    return {
        "sentence": sentence,
        **diagnostic.compact(),
        "has_error": diagnostic.has_error,
    }