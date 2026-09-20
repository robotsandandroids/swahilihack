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
    llm_provider: str = "openai"  # openai (or any OpenAI-compatible base url)
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str | None = None  # e.g. a local vLLM/llama.cpp endpoint
    llm_max_retries: int = 2
    llm_timeout_seconds: float = 30.0
    # JSON / structured-output mode for the feedback parser
    llm_json_mode: bool = True

    # --- Session limits ---
    session_max_turns: int = 8
    session_max_scenarios: int = 120
    max_audio_bytes: int = 15 * 1024 * 1024

    # --- Secrets ---
    openai_api_key: str | None = None

    @property
    def stt_is_cloud(self) -> bool:
        return self.stt_engine.lower() == "cloud"


@lru_cache
def get_settings() -> Settings:
    return Settings()