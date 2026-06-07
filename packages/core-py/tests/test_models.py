from assistants_core.config import Settings
from assistants_core.models import (
    CLAUDE_BALANCED,
    CLAUDE_DEEP,
    CLAUDE_FAST,
    DEFAULT_GEMINI_LIVE_MODEL,
    ModelRole,
    Provider,
    build_registry,
)

_OVERRIDES = ["GEMINI_LIVE_MODEL", "CLAUDE_DEEP_MODEL", "CLAUDE_BALANCED_MODEL", "CLAUDE_FAST_MODEL"]


def test_registry_defaults(monkeypatch):
    for k in _OVERRIDES:
        monkeypatch.delenv(k, raising=False)
    reg = build_registry(Settings(_env_file=None))

    assert set(reg) == set(ModelRole)
    assert CLAUDE_DEEP == "claude-opus-4-8"
    assert reg[ModelRole.REASON_DEEP].model_id == CLAUDE_DEEP
    assert reg[ModelRole.REASON_BALANCED].model_id == CLAUDE_BALANCED == "claude-sonnet-4-6"
    assert reg[ModelRole.REASON_FAST].model_id == CLAUDE_FAST == "claude-haiku-4-5"
    assert reg[ModelRole.REALTIME].provider == Provider.GEMINI
    assert reg[ModelRole.REALTIME].model_id == DEFAULT_GEMINI_LIVE_MODEL


def test_capability_flags(monkeypatch):
    for k in _OVERRIDES:
        monkeypatch.delenv(k, raising=False)
    reg = build_registry(Settings(_env_file=None))

    # Opus + Sonnet accept effort + adaptive thinking; Haiku 4.5 rejects both.
    assert reg[ModelRole.REASON_DEEP].supports_effort and reg[ModelRole.REASON_DEEP].supports_thinking
    assert reg[ModelRole.REASON_BALANCED].supports_effort and reg[ModelRole.REASON_BALANCED].supports_thinking
    assert not reg[ModelRole.REASON_FAST].supports_effort
    assert not reg[ModelRole.REASON_FAST].supports_thinking


def test_gemini_override(monkeypatch):
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "gemini-custom-99")
    reg = build_registry(Settings(_env_file=None))
    assert reg[ModelRole.REALTIME].model_id == "gemini-custom-99"
