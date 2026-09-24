from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_name: str = "SemaAI"
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
    # "mistral" (LlamaIndex MistralAI) or "openai" (OpenAI-compatible client).
    # Mistral is the default backend; OpenAI remains a drop-in fallback.
    llm_provider: str = "mistral"

    # Mistral (via llama-index-llms-mistralai)
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

    # --- Conversation memory (LlamaIndex ChatMemoryBuffer) ---
    memory_token_limit: int = 1800
    memory_summarize_every: int = 6  # collapse history every N user turns
    memory_keep_recent: int = 4      # keep this many recent turns verbatim

    # --- Stemmer diagnostics ---
    # Deterministically analyze each learner utterance before the LLM call and
    # only inject the structured error diagnostic when one is found.
    stemmer_diagnostics: bool = True

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
    def llm_active_model(self) -> str:
        return self.mistral_model if self.llm_uses_mistral else self.llm_model


@lru_cache
def get_settings() -> Settings:
    return Settings()