# Architecture

SemaAI is a monorepo with two deployables plus docs:

```
swahilihack/
├── frontend/    Next.js 16 (App Router, Tailwind CSS v4) — voice UI (unused for now)
├── backend/     FastAPI service — STT, LLM orchestration, feedback, stemmer
│                + showcase/  Streamlit UI that drives the backend pipeline
└── docs/        architecture, model & API docs
```

## Core loop

1. **Scenario pick** — the client fetches `GET /api/scenarios` and the user
   picks one. Each scenario bundles a context, difficulty, opening line,
   hints and key vocabulary.
2. **Session start** — `POST /api/sessions` creates a session and returns the AI
   `opening_line` (the vendor speaks first).
3. **User replies by voice** — the browser records a WebM blob (MediaRecorder)
   and uploads it to `POST /api/sessions/{id}/turns` as multipart form data.
   A plain-text transcript can be sent instead (JSON body) for fast testing.
4. **Transcribe** — the STT engine (faster-whisper locally, or the OpenAI
   Whisper API) converts audio to Swahili text in one whole-utterance call
   (never per-word fragments).
5. **Deterministic stemmer diagnostic** — the learner's sentence is analysed
   locally (zero tokens) for a tense-marker/time-cue mismatch. Only when an
   error is found is a compact structured note (`root`, `given_marker`,
   `expected_marker`, `cue`, `error_type`, `repeat_error`) injected into the
   prompt. Correct sentences inject nothing — no tokens wasted.
6. **LlamaIndex memory** — the turn is stored in a `ChatMemoryBuffer`; every N
   user turns, older history is collapsed into a short summary instead of
   being trimmed/dropped. Repeated mistake patterns are remembered in an
   `ErrorCache` and flagged `repeat_error=true` so the model gives a one-line
   reminder.
7. **LLM grades + replies in character** — Mistral (via `llama-index-llms-mistralai`,
   OpenAI-compatible client as fallback) returns a single JSON payload: the
   AI's in-character Swahili line, its English gloss, and structured feedback.
   The call is capped at a hard `max_tokens` and wrapped in exponential
   backoff for 429/5xx (no retry-storms on free-tier rate limits).
8. **Morphology enrichment** — the learner's words are run through the
   Swahili segmenter (`ku-li-a` style breakdowns) and attached to feedback.
9. **Render** — the client shows the new AI line (optionally spoken with the
   browser TTS) plus a feedback card. The loop repeats until
   `SESSION_MAX_TURNS` is reached.

```
Browser (Next.js) / Streamlit showcase          FastAPI
   │  GET /api/scenarios          ───────────▶│  scenario pack
   │  POST /api/sessions          ───────────▶│  store session, opening line
   │★★Voice (Multipart)★★                    │
   │  POST /api/sessions/{id}/turns  ────────▶│  STT (local f-whisper / cloud)
   │                                          │      │ transcript
   │                                          │      ▼
   │                                          │  stemmer diagnostic (local, free)
   │                                          │      │ only-on-error note
   │                                          │      ▼
   │                                          │  LlamaIndex ChatMemoryBuffer
   │                                          │  (+ summarize old turns, ErrorCache)
   │                                          │      ▼
   │                                          │  Mistral (backoff + max_tokens)
   │                                          │      │ JSON reply + feedback
   │  ◀────────── turn response ─────────────│  stemmer enriches learner vocab
   │  render bubble + feedback card           │
```

## Backend layout

| Path | Responsibility |
| --- | --- |
| `app/core/config.py` | pydantic-settings; STT/LLM selection, keys, memory/backoff limits |
| `app/models/schemas.py` | request/response Pydantic models |
| `app/models/scenarios.py` | seeded scenario pack (Swahili content) |
| `app/services/stt/` | `faster_whisper` local + OpenAI cloud, behind an ABC |
| `app/services/stt/factory.py` | engine selection from `STT_ENGINE` |
| `app/services/llm.py` | Mistral/OpenAI providers, backoff, max_tokens, diagnostic injection |
| `app/services/memory.py` | LlamaIndex `SummarizingMemory` + `ErrorCache` + per-session registry |
| `app/services/stemmer/diagnostic.py` | deterministic sentence-level tense-check (Option B) |
| `app/services/stemmer/swahili.py` | rule-based morphological segmenter |
| `app/services/store.py` | in-memory sessions (dev only); history = rebuildable snapshot |
| `app/api/routes/scenarios.py` | scenarios + `/api/stem*` endpoints |
| `app/api/routes/sessions.py` | session lifecycle + turn orchestration |
| `showcase/app.py` | Streamlit UI that drives the backend pipeline directly |

The STT layer is deliberately a narrow interface so you can swap Google STT,
`whisper.cpp`, or WhisperX in without touching the rest of the pipeline.

## Streamlit showcase

`backend/showcase/app.py` is a self-contained UI for testing the backend without
the Next.js app or an API server:

```bash
cd backend
uv sync
uv run streamlit run showcase/app.py      # demo mode works with no API key
```

It exposes the full pipeline (text or recorded audio → diagnostic → memory →
LLM → feedback) plus an "under the hood" panel showing the stemmer diagnostic,
`repeat_error` flag, memory summary/count and the error cache — the cost controls
in action. Set `MISTRAL_API_KEY` (or `OPENAI_API_KEY`) in `.env` to switch from
demo mode to the real Mistral backend.

## Frontend

- `app/page.tsx` — state machine: scenario grid → live conversation.
- `lib/api.ts` — typed client for the backend.
- `lib/useRecorder.ts` — MediaRecorder wrapper (WebM, pauses tracks on stop).
- AI lines are spoken via the browser `SpeechSynthesis` API (`sw-KE`). No
  server-side TTS dependency today; swap for edge-tts/gTTS later if the
  browser voices underperform.

> The Next.js app is on hold for now — the Streamlit showcase is the current
> way to exercise the backend.

## Session & state model

Sessions are in-memory (`app/services/store.py`) and intentionally lossy:
- Single process only; add Postgres/Redis when you deploy.
- The live state lives in a per-session `SummarizingMemory`
  (LlamaIndex `ChatMemoryBuffer`) plus an `ErrorCache`, owned by
  `app/services/memory.py::MemoryRegistry`.
- `session.history` is a structured snapshot that is **rebuilt into the
  memory buffer** on demand (`SummarizingMemory.from_history`) — a
  SimpleChatStore-style restore over messages, not re-sent raw transcripts.
  Old turns are collapsed into a 2-3 sentence summary every N user turns
  instead of being dropped, so long sessions stop paying full token cost for
  early history (bounded also by `MEMORY_TOKEN_LIMIT`).

## Cost & rate-limit controls (from part_2.md)

| Control | Where |
| --- | --- |
| Summarizing memory (don't just truncate) | `app/services/memory.py` |
| Inject stemmer note only on error | `stemmer/diagnostic.py` + `render_user_content` |
| Compact structured diagnostic (no prose) | `StemDiagnostic.compact()` |
| Repeat-error cache → `repeat_error=true` | `ErrorCache` |
| Snapshot restore instead of re-embedding | `SummarizingMemory.from_history` |
| STT batched per utterance (not per fragment) | STT layer returns whole-turn text |
| Hard `max_tokens` cap on replies | `LLM_MAX_TOKENS` |
| Exponential backoff on 429/5xx | tenacity in `app/services/llm.py` |

## Configuration

Backend: `.env` (see `backend/.env.example`). Frontend: `NEXT_PUBLIC_API_URL`.

Run locally:

```bash
# backend
cd backend
cp .env.example .env        # set MISTRAL_API_KEY (LLM). OPENAI_API_KEY for cloud STT / OpenAI LLM fallback
uv sync
uv run uvicorn app.main:app --reload

# backend showcase (no API server needed)
uv run streamlit run showcase/app.py

# frontend (on hold)
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
- Extend the stemmer diagnostic beyond tense markers (noun-class agreement,
  object-infix errors) and add a hand-curated frequency lexicon.