"""Practice console: queue post → pending → consume roundtrip, and validation."""

import practice
import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(practice, "PRACTICE_DIR", tmp_path)
    monkeypatch.setattr(practice, "QUEUE", tmp_path / "queue.jsonl")
    monkeypatch.setattr(practice, "ACTION_LOG", tmp_path / "actions-log.jsonl")
    monkeypatch.setattr(practice, "STATE", tmp_path / "state.json")
    return TestClient(app)


def test_action_roundtrip(client):
    assert client.post("/api/practice/action", json={"action": "bogus"}).status_code == 400

    a = client.post("/api/practice/action", json={"action": "drill", "arg": "Classic ML"}).json()
    b = client.post("/api/practice/action", json={"action": "pause"}).json()

    p = client.get("/api/practice/pending").json()
    assert [e["id"] for e in p["pending"]] == [a["id"], b["id"]]
    assert p["recent"] == []

    res = client.post("/api/practice/consume", json={"ids": [a["id"]]}).json()
    assert res == {"consumed": 1, "pending": 1}

    p = client.get("/api/practice/pending").json()
    assert [e["id"] for e in p["pending"]] == [b["id"]]
    assert p["recent"][0]["id"] == a["id"] and p["recent"][0]["acked"]


def test_state_and_console(client):
    assert client.get("/api/practice/state").json() == {"bank": [], "session": None}
    page = client.get("/practice-console")
    assert page.status_code == 200 and "Practice Console" in page.text
