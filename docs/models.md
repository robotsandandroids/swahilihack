# Speech & model choices

This project ships with **faster-whisper** (local) and **OpenAI Whisper API**
(cloud) behind one interface. Here is the reasoning and the tradeoffs,
especially on limited hardware.

## Why faster-whisper instead of `openai/whisper`

OpenAI's reference `whisper` model works but is a poor fit for a hobby/edge
deployment:

- Loads the model into PyTorch with fp32 weights — heavy RAM and slow CPU
  inference, especially in int8-unfriendly configurations.
- **faster-whisper** runs the same OpenAI Whisper arch through CTranslate2
  with int8 quantization: typically **4-8× faster** on CPU and a fraction of
  the memory, with near-identical WER. It is the standard local default.

### Model size vs hardware (faster-whisper)

| Model | Size | ~RAM | Good for | Notes |
| --- | --- | --- | --- | --- |
| `tiny` | 75 MB | ~1 GB | Raspberry Pi / phone tests | rough on accents |
| `base` | 145 MB | ~1-2 GB | modest x86 laptops | our default; fine for clean Swahili audio |
| `small` | 460 MB | ~2-4 GB | decent accuracy, still CPU-ok | recommended if you have 4 GB+ |
| `medium` | 1.5 GB | ~5-8 GB | near-reference accuracy | slow on CPU (marginal) |
| `large-v3` | 3 GB | ~10 GB+ | best accuracy | GPU strongly recommended |

Start with `base` and switch to `small` if you have the RAM. On extremely
modest hardware use `tiny` plus `VAD_FILTER=True` (already on) — the faster-
whisper VAD skips silence so you only transcribe real speech.

Settings (see `backend/.env.example`):
`LOCAL_WHISPER_MODEL`, `LOCAL_WHISPER_DEVICE` (cpu/cuda/auto),
`LOCAL_WHISPER_COMPUTE_TYPE` (int8 for CPU, float16 for GPU).

## Cloud fallback

Set `STT_ENGINE=cloud` to transcribe via the OpenAI Whisper API
(`whisper-1`). Zero local compute but per-request cost and a network hop to
Whisper's server. Best used as a swap-in, not a default.

## Other STT options considered

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| **Google STT** | best multilingual cloud accuracy vs price per hour; streaming | needs API key, network | good alternative cloud |
| **WhisperX** | word-level timestamps + forced alignment | heavier deps (torch) | future for pronunciation scoring |
| **whisper.cpp** | tiny, runs on Pi/phone | C++ tooling, harder to integrate in Python | if you go really small |
| **Distil-Whisper** | 2x faster than large-v3 at similar accuracy | still torch-based | pairs with WhisperX later |
| **Vosk** | fully offline, small | weaker for accented Swahili | niche |

**Recommendation:** local `faster-whisper` (base/small) as the default, OpenAI
API as the cloud escape-hatch, and plan **WhisperX + forced alignment** as
the pronunciation-scoring upgrade.

## LLM

- Default backend is **Mistral** via `llama-index-llms-mistralai`
  (`mistral-small-latest` on the low/free tiers). Wire-up lives in
  `app/services/llm.py`.
- A single deterministic stemmer pre-pass runs on every learner utterance
  before the LLM call; when it flags a real error it injects a compact
  structured note into the prompt (Option B from part_2.md — one LLM call per
  turn, no reliance on Mistral function calling).
- OpenAI (`gpt-4o-mini` default, `LLM_PROVIDER=openai`) remains as a drop-in
  fallback via the OpenAI-compatible client; point `LLM_BASE_URL` at a local
  server (vLLM, LM Studio, llama.cpp) for fully offline practice.
- The conversation runs in JSON mode so the LLM returns reply + structured
  feedback in one call; the API validates it into Pydantic models and fixes
  malformed fields so a bad model response never crashes the app.
- Feedback (score/comprehension/grammar/enunciation/corrections) is soft:
  the LLM judges from the transcript. It is a language-learning aid, not a
  certification.
- Conversation history lives in a LlamaIndex `ChatMemoryBuffer` with periodic
  summarization + an `ErrorCache` (see `docs/architecture.md`) — this is the
  memory, not vector retrieval.

### Cost & rate-limit controls (free-tier friendly)

1. **Summarizing memory** — `SummarizingMemory` collapses old turns into a
   2-3 sentence summary every N user turns and caps the buffer token count,
   instead of retransmitting full raw history.
2. **No diagnostic on correct sentences** — the stemmer note is only injected
   when a mismatch is detected; clean turns stay cheap.
3. **Compact diagnostics** — the prompt gets `{root, given_marker,
   expected_marker, cue}`, not a separately generated prose explanation.
4. **Repeat-error cache** — the same `(error_type, root)` mistake twice sets
   `repeat_error=true`, so the model replies with a one-line reminder, not a
   full re-teach.
5. **Snapshot restore** — session history is a structured message list that
   rebuilds the memory buffer; no re-embedding anywhere.
6. **Whole-utterance STT** — one coherent sentence per LLM call, never per
   audio fragment.
7. **Hard `max_tokens` cap** (`LLM_MAX_TOKENS`) on every response.
8. **Exponential backoff** (tenacity) around Mistral calls for 429/5xx — no
   retry-storms that burn the quota window.

## TTS (the AI's voice)

For now the AI's lines are spoken **client-side** with the browser
SpeechSynthesis API using a Swahili voice (`sw-KE`) — zero infra cost.
Browser voice quality varies by OS (Android ships good Swahili voices; some
Linux systems have none). If quality becomes the blocker, the cleanest
upgrade is `edge-tts` (pip) behind an optional `/api/tts` endpoint returning
audio, with the frontend falling back to browser TTS. `gTTS` and ElevenLabs
are alternatives but edge-tts' Swahili voice quality is the best free option.

## Where the pipeline spends time

1. STT transcription (dominates: seconds on CPU).
2. LLM turn (network + generation).
3. Stemmer enrichment (µs) and rendering (ms).

So on a weak device the ceiling is the local model size — dial `LOCAL_WHISPER_MODEL`
down rather than up unless you have the RAM.