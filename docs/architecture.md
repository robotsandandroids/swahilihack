# Architecture

SemaAI is a monorepo with two deployables plus docs:

```
swahilihack/
├── frontend/    Next.js 16 (App Router, Tailwind CSS v4) — voice UI
├── backend/     FastAPI service — STT, LLM orchestration, feedback, stemmer
└── docs/        architecture, model & API docs
```

## Core loop

1. **Scenario pick** — the client fetches `GET /api/scenarios` and the user
   picks one. Each scenario bundles a context, difficulty, opening line,
   hints and key vocabulary.
2. **Session start** — `POST /api/sessions` creates an in-memory session and
   returns the AI `opening_line` (the vendor speaks first).
3. **User replies by voice** — the browser records a WebM blob (MediaRecorder)
   and uploads it to `POST /api/sessions/{id}/turns` as multipart form data.
   A plain-text transcript can be sent instead (JSON body) for fast testing.
4. **Transcribe** — the STT engine (faster-whisper locally, or the OpenAI
   Whisper API) converts the audio to Swahili text.
5. **LLM grades + replies in character** — the LLM receives the scenario,
   difficulty, session history and the learner transcript, and returns a
   single JSON payload: the AI's next in-character Swahili line, its English
   gloss, and structured feedback (overall score, comprehension/grammar/
   enunciation subscores, corrections, good points, suggested next move).
6. **Morphology enrichment** — the learner's words are run through the
   Swahili segmenter (`ku-li-a` style breakdowns) and attached to feedback.
7. **Render** — the client shows the new AI line (optionally spoken with the
   browser TTS) plus a feedback card. The loop repeats until
   `SESSION_MAX_TURNS` is reached.

```
Browser (Next.js)                    FastAPI
   │  GET /api/scenarios  ───────────▶│  scenario pack
   │  POST /api/sessions  ───────────▶│  store session, opening line
   │★★Voice (Multipart)★★            │
   │  POST /api/sessions/{id}/turns  ▶│  STT (local f-whisper / cloud)
   │                                  │      │ transcript
   │                                  │      ▼
   │                                  │  LLM in-character reply + JSON feedback
   │                                  │      │
   │  ◀────────── turn response ──────│  stemmer enriches learner vocab
   │  render bubble + feedback card   │
```

## Backend layout

| Path | Responsibility |
| --- | --- |
| `app/core/config.py` | pydantic-settings; STT/LLM model selection, keys |
| `app/models/schemas.py` | request/response Pydantic models |
| `app/models/scenarios.py` | seeded scenario pack (Swahili content) |
| `app/services/stt/` | `faster_whisper` local + OpenAI cloud, behind an ABC |
| `app/services/stt/factory.py` | engine selection from `STT_ENGINE` |
| `app/services/llm.py` | conversation prompt + structured JSON feedback |
| `app/services/stemmer/swahili.py` | rule-based morphological segmenter |
| `app/services/store.py` | in-memory sessions (dev only) |
| `app/api/routes/scenarios.py` | scenarios + `/api/stem` endpoints |
| `app/api/routes/sessions.py` | session lifecycle + turn orchestration |

The STT layer is deliberately a narrow interface so you can swap Google STT,
`whisper.cpp`, or WhisperX in without touching the rest of the pipeline.

## Frontend

- `app/page.tsx` — state machine: scenario grid → live conversation.
- `lib/api.ts` — typed client for the backend.
- `lib/useRecorder.ts` — MediaRecorder wrapper (WebM, pauses tracks on stop).
- AI lines are spoken via the browser `SpeechSynthesis` API (`sw-KE`). No
  server-side TTS dependency today; swap for edge-tts/gTTS later if the
  browser voices underperform.

## Session & state model

Sessions are in-memory (`app/services/store.py`) and intentionally lossy:
- Single process only; add Postgres/Redis when you deploy.
- A session stores `history` (alternating assistant/user messages) which is
  re-sent to the LLM each turn, so the AI keeps character across turns.

## Configuration

Backend: `.env` (see `backend/.env.example`). Frontend: `NEXT_PUBLIC_API_URL`.

Run locally:

```bash
# backend
cd backend
cp .env.example .env        # set OPENAI_API_KEY for LLM + cloud STT
uv sync
uv run uvicorn app.main:app --reload

# frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Next steps / gaps

- Persistent session store (Postgres/Redis), auth, user progress.
- Pronunciation scoring beyond heuristic `enunciation` (forced alignment
  with e.g. WhisperX + Montreal Forced Aligner would be a real upgrade).
- Server-side or higher-quality TTS.
- Streaming (websocket) turns so audio can close over while grading runs.