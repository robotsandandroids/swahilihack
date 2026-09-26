# Mzizi AI — Session integration summary

Status of the backend work driven by [`docs/part_2.md`](part_2.md) (the
Mistral + LlamaIndex + cost-controls spec). Frontend (Next.js) was explicitly
left alone; a Streamlit UI now exercises the backend instead.

## What changed this session

| Area | Implemented |
| --- | --- |
| LLM provider | **Mistral** default via `llama-index-llms-mistralai` (`mistral-small-latest`); OpenAI-compatible client kept as fallback (`LLM_PROVIDER=openai`) |
| Agent memory | LlamaIndex `ChatMemoryBuffer` wrapped in `SummarizingMemory` (collapse old turns to a summary every N turns) + per-session `ErrorCache` |
| Grammar diagnostics (Option B) | Deterministic stemmer pre-pass on every utterance; compact structured note injected **only on error** |
| Cost controls | Hard `max_tokens` cap, tenacity exponential backoff on 429/5xx, whole-utterance STT, snapshot restore (no re-embedding) |
| Showcase | `backend/showcase/app.py` — Streamlit UI driving the real pipeline, demo-mode without an API key |

## New / changed backend files

- `app/services/llm.py` — reworked: provider dispatch, tenacity-backoff Mistral
  call, `LLM_MAX_TOKENS` cap, `render_user_content` (diagnostic injection),
  expanded prompt contract for diagnostics + `repeat_error`.
- `app/services/memory.py` — new: `SummarizingMemory` (LlamaIndex), `ErrorCache`,
  `MemoryRegistry` (owns memory + cache per session, rebuilds from history).
- `app/services/stemmer/diagnostic.py` — new: deterministic sentence-level
  tense-marker/time-cue check (`atalia jana` → `ta` vs `li`).
- `app/core/config.py` — new settings: `llm_provider`, `mistral_model`,
  `llm_max_tokens`, backoff knobs, memory limits, `stemmer_diagnostics`.
- `app/api/routes/sessions.py` — turn loop now: diagnostic → memory → error
  cache → LLM → snapshot history.
- `app/api/routes/scenarios.py` — added `POST /api/stem/sentence`.
- `app/main.py` — health now reports provider + active model + max_tokens.
- `showcase/app.py` — new Streamlit showcase.
- `pyproject.toml` — added `llama-index-core`, `llama-index-llms-mistralai`,
  `tenacity`; `streamlit` (dev).
- `tests/test_diagnostic.py` — new tests (diagnostics, memory roundtrip,
  error cache, prompt injection).
- `docs/{architecture,models,api}.md` + `README.md` — updated to match.

## Pipeline (one turn)

```
transcript (text | audio -> STT, whole utterance)
   -> stemmer diagnostic (local, free)          # error? inject compact note
   -> SummarizingMemory.put(user)               # ChatMemoryBuffer
   -> maybe summarize old turns                 # every MEMORY_SUMMARIZE_EVERY
   -> ErrorCache.check_and_record               # repeat_error=true shortens reply
   -> Mistral chat (backoff, max_tokens cap)    # JSON: reply + feedback
   -> stemmer enriches learner vocab            # ku-li-a breakdowns
   -> snapshot session.history                  # rebuildable memory restore
```

## Cost / rate-limit controls (part_2 order of impact)

1. Summarizing memory — summary node replaces old turns (not just truncation).
2. Stemmer note injected only on error — clean turns pay no extra tokens.
3. Compact structured diagnostics — `{root, given_marker, expected_marker,
   cue}`, never prose.
4. `ErrorCache` — repeated `(error_type, root)` → `repeat_error=true` → 1-line
   reminder instead of a full re-teach.
5. Snapshot restore — memory rebuilt from `history`, no re-embedding.
6. Whole-utterance STT — one coherent sentence per LLM call.
7. Hard `LLM_MAX_TOKENS` ceiling on every response.
8. tenacity exponential backoff on 429/5xx — no retry-storms.

## Verification (all green)

- `uv run pytest` — 13 passed
  (`tests/test_diagnostic.py`, `tests/test_stemmer.py`)
- FastAPI smoke-tested: `/api/health`, `/api/scenarios`, `/api/stem/sentence`,
  503 "No LLM configured: set MISTRAL_API_KEY." when unkeyed.
- Showcase exercised via Streamlit `AppTest` — turn flow + feedback render OK.

## Run

```bash
cd backend
cp .env.example .env        # set MISTRAL_API_KEY (LLM); OPENAI_API_KEY for cloud STT
uv sync
uv run uvicorn app.main:app --reload          # API (docs at /docs, health at /api/health)
uv run streamlit run showcase/app.py          # showcase (demo mode works without a key)
```

## Outstanding gaps (unchanged)

Persistent store (Postgres/Redis), auth/progress, WhisperX pronunciation
scoring, higher-quality TTS, websocket streaming; extend the diagnostic beyond
tense markers (noun-class agreement) with a frequency lexicon.