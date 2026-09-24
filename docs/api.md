# API reference

Base URL: `http://localhost:8000` (FastAPI auto-docs at `/docs`, OpenAPI at `/openapi.json`).

## Scenarios & sessions

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/scenarios?difficulty={beginner\|intermediate\|advanced}` | — | `Scenario[]` |
| GET | `/api/scenarios/{id}` | — | `Scenario` |
| POST | `/api/sessions` | `{"scenario_id": "...", "difficulty"?: "..."}` | `{session_id, scenario, opening_line, opening_line_en, difficulty, max_turns}` |
| GET | `/api/sessions/{session_id}` | — | `Session` |
| POST | `/api/sessions/{session_id}/turns` | multipart **or** JSON, see below | `TurnResponse` |

### Turn payload — the main loop

Send **either**:

```json
// JSON: pre-transcribed text (fastest to test)
{ "session_id": "...", "transcript": "Nyanya ngapi?" }
```

**or** multipart form-data:

```
audio   : <webm/mp4 blob>
```

### TurnResponse

```json
{
  "ai_text": "Hizi nyanya ni laki moja, unaweza kupewa...",
  "ai_translation": "These tomatoes are one thousand, you can get...",
  "feedback": {
    "score": 82,
    "comprehension": 90,
    "grammar": 75,
    "enunciation": 85,
    "headline": "Mazuri sana!",
    "corrections": [
      {"original": "nyanya ngapi", "corrected": "nyanya hizi zina bei gani",
        "reason": "more natural word order for asking price"}
    ],
    "good_points": ["You used the right object agreement."],
    "vocab": [
      {"word": "ninakula", "breakdown": "ni-na-ku-la", "note": "from your reply"}
    ],
    "suggestion": "Ask how much the mangoes cost next."
  },
  "session_status": "active",
  "turn": 2,
  "turns_left": 8
}
```

`feedback` is `null` for the opening move only (the AI speaks first; there is
nothing to grade yet).

## Language tools

| Method | Path | Body / Query | Returns |
| --- | --- | --- | --- |
| GET | `/api/stem?word=ninakula` | `word` | `StemAnalysis` |
| POST | `/api/stem/batch` | `["kulia", "alilia", ...]` (1-100) | `StemAnalysis[]` |
| POST | `/api/stem/sentence` | `{"sentence": "atalia jana"}` | sentence diagnostic |

`StemAnalysis`:

```json
{
  "word": "alilia",
  "breakdown": "a-li-li-a",
  "segments": [
    {"segment": "a", "kind": "subject", "gloss": "3sg subject (he/she)"},
    {"segment": "li", "kind": "tense", "gloss": "past (-ed)"},
    {"segment": "li", "kind": "verb_stem", "gloss": "verb root"},
    {"segment": "a", "kind": "final_vowel", "gloss": "final vowel (a/e/i)"}
  ],
  "lemma": "lia",
  "is_swahili": true,
  "confidence": 0.9
}
```

`POST /api/stem/sentence` is the deterministic pre-LLM diagnostic (Option B):
it checks a verb's tense marker against the sentence's time cue and returns a
compact structured result (empty fields when the sentence is clean):

```json
{
  "sentence": "atalia jana",
  "root": "lia",
  "given_marker": "ta",
  "expected_marker": "li",
  "cue": "jana",
  "error_type": "tense_marker",
  "has_error": true
}
```

## System

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{status, app, stt_engine, llm_model}` |

## Error handling

FastAPI problem-style responses: `{"detail": "..."}` with status codes
`400` (empty transcript / completed session), `404` (unknown scenario/session),
`413` (audio too large), `422` (STT found no speech), `503` (LLM not configured).