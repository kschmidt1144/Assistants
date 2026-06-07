import pytest
from assistants_core.config import Settings
from assistants_core.models import ModelRole
from assistants_core.providers import ClaudeClient, GeminiLiveBridge, ProviderRouter


def _router(monkeypatch):
    for k in ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]:
        monkeypatch.delenv(k, raising=False)
    return ProviderRouter(Settings(_env_file=None))


def test_router_resolves_models(monkeypatch):
    r = _router(monkeypatch)
    assert r.model_id(ModelRole.REASON_DEEP) == "claude-opus-4-8"
    assert isinstance(r.claude, ClaudeClient)
    assert r.claude is r.claude  # cached
    assert isinstance(r.gemini_live(), GeminiLiveBridge)


def test_clients_require_keys(monkeypatch):
    r = _router(monkeypatch)
    with pytest.raises(RuntimeError):
        _ = r.claude.client  # no ANTHROPIC_API_KEY
