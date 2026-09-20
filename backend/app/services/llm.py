from __future__ import annotations

import json
import logging

from app.core.config import get_settings
from app.models.schemas import (
    Feedback,
    Scenario,
    StemAnalysis,
    TurnResponse,
)
from app.services.stemmer.swahili import analyze_swahili_word

logger = logging.getLogger(__name__)

SYSTEM_TEMPLATE = """\
Unacheza nafasi ya {character} katika mazoezi ya Kiswahili. Mazoezi ni kuhusu: {scenario_title}.

DJALOZI HUFANYIKA HAPA: {context}

MADHUMUNI AURO:
- Ongelea mwanafunzi ukiwa katika {character} angani ya {location}, kwa Kiswahili cha asili kikamilifu.
- Baada ya kila jibu la mwanafunzi toa: 1) jibu lako la pili la Kiswahili (ukiwa bado katika nafasi yako), 2) tafsiri ya kiingereza ya jibu lako, 3) DRUMHA: alama na mrejesho wa jibu la mwanafunzi.
- Jibu la mwanafunzi linapokosea kisarufi, onyesha marekebisho halisi ({{wrong}} -> {{correct}}).
- Dumisha mazungumzo hadi suala litatulia; usimalize mazungumzo baadaye kunako kuzima = usijirudie.

MAJIBU YAJALIZ MUUNDO WA JSON when the mwanafunzi anasema, kwa namna hii:
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
"""


class LLMService:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None

    def _ensure_client(self):
        if self._client is None:
            settings = self._settings
            if not settings.openai_api_key and not settings.llm_base_url:
                raise RuntimeError(
                    "No LLM configured: set OPENAI_API_KEY or LLM_BASE_URL (+ key)."
                )
            from openai import OpenAI

            kwargs: dict = {"api_key": settings.openai_api_key, "timeout": settings.llm_timeout_seconds}
            if settings.llm_base_url:
                kwargs["base_url"] = settings.llm_base_url
            self._client = OpenAI(**kwargs)
        return self._client

    # --- high level turn -------------------------------------------------
    def play_scenario_turn(
        self,
        scenario: Scenario,
        history: list[dict],
        learner_transcript: str,
    ) -> TurnResponse:
        system = SYSTEM_TEMPLATE.format_map({
            "character": _character_for(scenario),
            "scenario_title": scenario.title,
            "context": scenario.context,
            "location": scenario.location,
            "difficulty": scenario.difficulty.value,
        })
        messages = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": learner_transcript or "(silence)"})

        content = self._chat_json(messages)

        try:
            data = json.loads(content) if isinstance(content, str) else content
        except json.JSONDecodeError:
            logger.warning("LLM returned non-JSON; coercing: %s", content[:200])
            data = {"ai_text": content, "ai_translation": "", "feedback": {}}

        fb = data.get("feedback") or {}
        feedback = self._clean_feedback(fb, learner_transcript)

        return TurnResponse(
            ai_text=data.get("ai_text", ""),
            ai_translation=data.get("ai_translation", ""),
            feedback=feedback,
        )

    def _chat_json(self, messages: list[dict]) -> str:
        client = self._ensure_client()
        response = client.chat.completions.create(
            model=self._settings.llm_model,
            messages=messages,
            temperature=0.7,
            max_tokens=700,
            response_format={"type": "json_object"} if self._settings.llm_json_mode else None,
        )
        return response.choices[0].message.content or "{}"

    def _clean_feedback(self, raw: dict, transcript: str) -> Feedback:
        try:
            feedback = Feedback.model_validate(raw)
        except Exception:
            logger.warning("Invalid feedback from LLM: %s", str(raw)[:300])
            feedback = Feedback()

        # enrich with morphological breakdowns for the learner + their words
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