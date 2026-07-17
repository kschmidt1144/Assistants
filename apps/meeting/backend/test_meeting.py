import base64
from unittest.mock import AsyncMock

import main
import numpy as np
import pytest
from assistants_core import Database, SpeakerIdentifier
from fastapi.testclient import TestClient


class StubEmbedder:
    """Maps a constant clip to a basis vector by mean amplitude — deterministic, no torch."""

    def embed(self, wav: np.ndarray, sr: int = 16000) -> np.ndarray:
        idx = min(int(round(float(np.mean(wav)) * 9)), 9)
        v = np.zeros(10, dtype=np.float32)
        v[max(0, idx)] = 1.0
        return v


def _clip(int16_val: int, n: int = 1600) -> str:
    return base64.b64encode(np.full(n, int16_val, dtype="<i2").tobytes()).decode()


@pytest.fixture
def client(monkeypatch, tmp_path):
    # Ensure no API keys interfere with logic
    import assistants_core.config

    monkeypatch.setattr(assistants_core.config, "_find_dotenv", lambda: None)

    main.get_settings.cache_clear()
    import os

    if "ANTHROPIC_API_KEY" in os.environ:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    db_path = str(tmp_path / "test.db")

    fake_settings = main.get_settings()
    fake_settings.db_path = db_path
    monkeypatch.setattr(main, "get_settings", lambda: fake_settings)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_lifespan(app):
        db = await Database(db_path).connect()
        main._state["db"] = db
        main._state["identifier"] = SpeakerIdentifier(db, embedder=StubEmbedder())
        try:
            yield
        finally:
            await db.close()

    main.app.router.lifespan_context = fake_lifespan

    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def mock_claude(monkeypatch):
    mock_reason = AsyncMock(return_value="mocked answer")
    monkeypatch.setattr(main.router.claude, "reason", mock_reason)

    mock_reason_structured = AsyncMock(return_value={"items": [{"action": "a", "owner": "o"}]})
    monkeypatch.setattr(main.router.claude, "reason_structured", mock_reason_structured)

    return mock_reason, mock_reason_structured


def test_speaker_id_endpoints(client):
    # MTG-I-01
    res = client.post("/api/enroll-speaker", json={"name": "alice", "samples": [_clip(3277)]})
    assert res.status_code == 200
    assert res.json()["name"] == "alice"
    assert res.json()["num_samples"] == 1

    res = client.post("/api/identify-speaker", json={"audio": _clip(3277)})
    assert res.status_code == 200
    assert res.json()["speaker"] == "alice"

    res = client.post("/api/identify-speaker", json={"audio": _clip(31000)})
    assert res.status_code == 200
    assert res.json()["speaker"] == "Unknown"

    res = client.get("/api/voice-profiles")
    assert res.status_code == 200
    assert "alice" in [p["name"] for p in res.json()]
    assert "embedding" not in res.json()[0]

    res = client.delete("/api/voice-profiles/alice")
    assert res.status_code == 200

    res = client.get("/api/voice-profiles")
    assert "alice" not in [p["name"] for p in res.json()]


def test_claude_endpoints(client, mock_claude, monkeypatch):
    # MTG-I-02 & MTG-I-03
    mock_reason, mock_reason_structured = mock_claude

    # Missing key - MTG-I-03
    for ep in ["summarize", "action-items", "clean-transcript"]:
        res = client.post(f"/api/{ep}", json={"transcript": "text"})
        assert res.status_code == 400

    res = client.post("/api/ask", json={"transcript": "text", "question": "q"})
    assert res.status_code == 400

    # Mock key
    fake_settings = main.get_settings()
    fake_settings.anthropic_api_key = "test"
    monkeypatch.setattr(main, "get_settings", lambda: fake_settings)

    res = client.post("/api/summarize", json={"transcript": "text"})
    assert res.status_code == 200
    assert res.json() == {"summary": "mocked answer"}

    res = client.post("/api/action-items", json={"transcript": "text"})
    assert res.status_code == 200
    assert res.json() == {"items": [{"action": "a", "owner": "o"}]}

    res = client.post("/api/clean-transcript", json={"transcript": "text"})
    assert res.status_code == 200
    assert res.json() == {"cleaned": "mocked answer"}

    res = client.post("/api/ask", json={"transcript": "text", "question": "q"})
    assert res.status_code == 200
    assert res.json() == {"answer": "mocked answer"}


def test_meeting_crud(client):
    # MTG-I-04, MTG-I-05, MTG-I-06
    res = client.post("/api/meetings", json={"title": "Standup"})
    assert res.status_code == 200
    m_id = res.json()["id"]

    res = client.post(
        f"/api/meetings/{m_id}/entries", json={"entries": [{"text": "hi", "speaker": "alice"}]}
    )
    assert res.status_code == 200
    assert res.json() == {"added": 1}

    res = client.get(f"/api/meetings/{m_id}")
    assert res.status_code == 200
    assert res.json()["session"]["title"] == "Standup"
    assert len(res.json()["entries"]) == 1
    assert res.json()["entries"][0]["text"] == "hi"

    res = client.get("/api/meetings")
    assert res.status_code == 200
    assert len(res.json()) >= 1

    res = client.get("/api/meetings/missing")
    assert res.status_code == 404

    # PUT sets title + summary.
    res = client.put(f"/api/meetings/{m_id}", json={"title": "New", "summary": "A summary"})
    assert res.status_code == 200

    res = client.get(f"/api/meetings/{m_id}")
    assert res.json()["session"]["title"] == "New"
    assert res.json()["session"]["metadata"]["summary"] == "A summary"

    # K6 fixed: a title-only PUT must NOT wipe the previously stored summary metadata.
    res = client.put(f"/api/meetings/{m_id}", json={"title": "Renamed"})
    assert res.status_code == 200
    res = client.get(f"/api/meetings/{m_id}")
    assert res.json()["session"]["title"] == "Renamed"
    assert res.json()["session"]["metadata"]["summary"] == "A summary"

    res = client.post("/api/meetings", data="malformed")
    assert res.status_code == 422

    # PUT/DELETE on a missing meeting → 404.
    assert client.put("/api/meetings/missing", json={"title": "x"}).status_code == 404
    assert client.delete("/api/meetings/missing").status_code == 404

    # K6 fixed: meeting CRUD now supports delete; the meeting + its entries are removed.
    res = client.delete(f"/api/meetings/{m_id}")
    assert res.status_code == 200
    assert client.get(f"/api/meetings/{m_id}").status_code == 404
