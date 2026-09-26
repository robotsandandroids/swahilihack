from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_name: str = "Mzizi AI"
    debug: bool = True
    environment: str = "development"

    # --- CORS ---
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # --- Speech-to-Text ---
    # "local" (faster-whisper) or "cloud" (OpenAI Whisper API)
    stt_engine: str = "local"

    # Local (faster-whisper) settings
    local_whisper_model: str = "tiny"  # tiny | base | small | medium | large-v3
    local_whisper_device: str = "cpu"  # cpu | cuda | auto
    local_whisper_compute_type: str = "int8"  # int8 | float16 | float32

    # Cloud (OpenAI Whisper API) settings
    whisper_cloud_model: str = "whisper-1"

    # --- LLM ---
    # "gemini" (LlamaIndex Gemini), "mistral" (LlamaIndex MistralAI), or "openai" (OpenAI-compatible client).
    # Gemini is the default primary backend; Mistral acts as an automatic fallback.
    llm_provider: str = "gemini"

    # Gemini (via llama-index-llms-gemini)
    gemini_model: str = "gemini-3.6-flash"
    gemini_api_key: str | None = None

    # Mistral (via llama-index-llms-mistralai). Acts as an automatic fallback
    # whenever Gemini fails, or as the primary when LLM_PROVIDER=mistral.
    mistral_model: str = "mistral-small-latest"
    mistral_api_key: str | None = None

    # OpenAI / OpenAI-compatible (LLM_BASE_URL for local vLLM/llama.cpp)
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str | None = None
    llm_max_retries: int = 2
    llm_timeout_seconds: float = 30.0
    # JSON / structured-output mode for the feedback parser
    llm_json_mode: bool = True

    # Hard cap on the LLM response (tokens). Keeps Mistral free-tier billing
    # predictable and stops rambling correction explanations. Tunable per call.
    llm_max_tokens: int = 600

    # --- Rate-limit / backoff (tenacity, Mistral path) ---
    llm_backoff_min_seconds: float = 2.0
    llm_backoff_max_seconds: float = 30.0
    llm_max_attempts: int = 4
    # Ceiling for a single wait, including when the provider sends a
    # Retry-After header (keeps a pathological value from stalling a demo).
    llm_max_wait_seconds: float = 60.0

    # --- Conversation memory (LlamaIndex ChatMemoryBuffer) ---
    memory_token_limit: int = 1800
    memory_summarize_every: int = 6  # collapse history every N user turns
    memory_keep_recent: int = 4      # keep this many recent turns verbatim

    # --- Stemmer diagnostics ---
    # Deterministically analyze each learner utterance before the LLM call and
    # only inject the structured error diagnostic when one is found.
    stemmer_diagnostics: bool = True

    # --- Text-to-Speech ---
    # "edge" (Microsoft Edge neural voices, free, no key) or "none" to disable.
    # Voice options: sw-KE-ZuriNeural (f), sw-KE-RafikiNeural (m),
    # sw-TZ-RehemaNeural (f), sw-TZ-DaudiNeural (m).
    tts_engine: str = "edge"
    tts_voice: str = "sw-KE-ZuriNeural"
    tts_rate: str = "+0%"

    # --- Session limits ---
    session_max_turns: int = 8
    session_max_scenarios: int = 120
    max_audio_bytes: int = 15 * 1024 * 1024

    # --- Secrets ---
    openai_api_key: str | None = None

    @property
    def stt_is_cloud(self) -> bool:
        return self.stt_engine.lower() == "cloud"

    @property
    def llm_uses_mistral(self) -> bool:
        return self.llm_provider.strip().lower() == "mistral"

    @property
    def llm_uses_gemini(self) -> bool:
        return self.llm_provider.strip().lower() == "gemini"

    @property
    def llm_active_model(self) -> str:
        if self.llm_uses_gemini:
            return self.gemini_model
        if self.llm_uses_mistral:
            return self.mistral_model
        return self.llm_model

    @property
    def tts_enabled(self) -> bool:
        return self.tts_engine.strip().lower() != "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()