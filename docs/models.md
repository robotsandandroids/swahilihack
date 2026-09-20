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

- Default `gpt-4o-mini` via the OpenAI-compatible client. Point `LLM_BASE_URL`
  at a local server (vLLM, LM Studio, llama.cpp) for fully offline practice.
- The conversation runs in JSON mode so the LLM returns reply + structured
  feedback in one call; the API validates it into Pydantic models and fixes
  malformed fields so a bad model response never crashes the app.
- Feedback (score/comprehension/grammar/enunciation/corrections) is soft:
  the LLM judges from the transcript. It is a language-learning aid, not a
  certification.

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