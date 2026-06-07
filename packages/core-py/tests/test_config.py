from assistants_core.config import Settings

_KEYS = [
    "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_LIVE_MODEL",
    "CLAUDE_DEEP_MODEL", "CLAUDE_BALANCED_MODEL", "CLAUDE_FAST_MODEL", "ASSISTANTS_DB_PATH",
]


def test_defaults(monkeypatch):
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)
    s = Settings(_env_file=None)
    assert s.anthropic_api_key is None
    assert s.google_api_key is None
    assert s.has_anthropic is False
    assert s.has_google is False
    assert s.db_path.endswith("assistants.sqlite")


def test_env_override(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "gemini-x")
    monkeypatch.setenv("ASSISTANTS_DB_PATH", "/tmp/x.sqlite")
    s = Settings(_env_file=None)
    assert s.anthropic_api_key == "sk-test"
    assert s.has_anthropic is True
    assert s.gemini_live_model == "gemini-x"
    assert s.db_path == "/tmp/x.sqlite"
