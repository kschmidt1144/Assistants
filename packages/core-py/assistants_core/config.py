"""Typed application settings, sourced from environment / `.env`.

All secrets and model overrides live here so the rest of the core never reads `os.environ`
directly. See `.env.example` at the repo root for the variable names.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Secrets ──────────────────────────────────────────────────────────────
    anthropic_api_key: str | None = None  # ANTHROPIC_API_KEY
    google_api_key: str | None = None  # GOOGLE_API_KEY (Gemini)

    # ── Model overrides (defaults resolved in models.py) ─────────────────────
    gemini_live_model: str | None = None  # GEMINI_LIVE_MODEL  (open decision #8)
    claude_deep_model: str | None = None  # CLAUDE_DEEP_MODEL
    claude_balanced_model: str | None = None  # CLAUDE_BALANCED_MODEL
    claude_fast_model: str | None = None  # CLAUDE_FAST_MODEL

    # ── Local persistence ────────────────────────────────────────────────────
    db_path: str = Field(default="./data/assistants.sqlite", alias="ASSISTANTS_DB_PATH")

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_google(self) -> bool:
        return bool(self.google_api_key)


def _find_dotenv() -> str | None:
    """Walk up from CWD to find a `.env`, so an app works regardless of where it's launched."""
    for directory in [Path.cwd(), *Path.cwd().parents]:
        candidate = directory / ".env"
        if candidate.is_file():
            return str(candidate)
    return None


@lru_cache
def get_settings() -> Settings:
    """Cached process-wide settings. Call `get_settings.cache_clear()` in tests."""
    return Settings(_env_file=_find_dotenv())
