# Mzizi AI

Practice spoken Swahili with an in-character AI. Pick a scenario (market,
taxi, clinic…), the AI speaks the opening line, you reply by voice, and it
transcribes, continues in character, and grades your reply — with corrections,
scores, and `ku-li-a`-style word breakdowns for deep vocabulary learning.

```
frontend/   Next.js 16 (voice UI)          backend/   FastAPI (STT + LLM + stemmer)
docs/       architecture, model, API docs
```

## Quick start

Backend:

```bash
cd backend
cp .env.example .env        # add MISTRAL_API_KEY (LLM). OPENAI_API_KEY for cloud STT / OpenAI fallback
uv sync
uv run uvicorn app.main:app --reload      # http://127.0.0.1:8000  (docs at /docs)

# Streamlit showcase (drives the real backend pipeline, no API server needed)
uv run streamlit run showcase/app.py
```

Frontend (on hold for now — use the showcase instead):

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                               # http://localhost:3000
```

First run of the backend downloads the model from `LOCAL_WHISPER_MODEL`
(default `base`, ~145 MB, works on a modest laptop CPU). `tiny` is the fallback
for constrained hardware. Interactive API docs land at `http://127.0.0.1:8000/docs`.

Without an LLM key the turn endpoints return a clear `503`; you can still use
the scenario picker, `/api/stem`, and run the test suite:

```bash
cd backend && uv run pytest
```

## Product loop

1. Scenario + difficulty chosen → AI opens in character (e.g. a market vendor).
2. You reply out loud.
3. Whisper-based STT transcribes (local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) or cloud OpenAI API).
4. An LLM reacts in character and returns structured feedback (score,
   comprehension / grammar / enunciation, concrete corrections).
5. Your words are segmented for morphology (`ninakula` → `ni-na-ku-la`,
   `alilia` → `a-li-li-a`) and the conversation continues for a few turns.

## Model notes (short version)

- **STT**: `faster-whisper` (CTranslate2, int8) default with `base` model —
  4-8× faster/leaner than stock Whisper. Cloud OpenAI Whisper API behind the
  `STT_ENGINE=cloud` switch. Google STT, whisper.cpp, Vosk, WhisperX are
  documented as swap-ins.
- **LLM**: Mistral by default via LlamaIndex (`llama-index-llms-mistralai`),
  OpenAI-compatible (`gpt-4o-mini`) fallback. JSON-mode structured feedback,
  hard `max_tokens` cap, tenacity backoff on rate limits, and LlamaIndex
  `ChatMemoryBuffer` + summarization for conversation memory.
- **Grammar diagnostics**: a deterministic stemmer pre-pass flags tense
  errors before the LLM call and only injects a compact note when needed.
- **AI voice**: browser SpeechSynthesis (Swahili) today; `edge-tts` documented
  as the quality upgrade.

Full tradeoffs and roadmap in [`docs/models.md`](docs/models.md).

## Layout

| Path | What |
| --- | --- |
| [`backend/app/services/stt/`](backend/app/services/stt/) | pluggable STT (local/cloud) |
| [`backend/app/services/llm.py`](backend/app/services/llm.py) | scenario dialogue + graded feedback |
| [`backend/app/services/stemmer/swahili.py`](backend/app/services/stemmer/swahili.py) | Swahili morphological segmenter |
| [`backend/app/models/scenarios.py`](backend/app/models/scenarios.py) | seeded scenario pack |
| [`frontend/app/page.tsx`](frontend/app/page.tsx) | scenario picker + live conversation |
| [`docs/`](docs/) | architecture, models, API, stemmer notes |