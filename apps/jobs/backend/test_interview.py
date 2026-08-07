"""Interview practice mode: pack splitting, the Live WS route, and the debrief grader."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import interview
import main
import pytest
from assistants_core import get_settings
from fastapi.testclient import TestClient
from store import JobsStore


@pytest.fixture
def client(monkeypatch, tmp_path):
    import assistants_core.config

    monkeypatch.setattr(assistants_core.config, "_find_dotenv", lambda: None)
    get_settings.cache_clear()

    db_path = str(tmp_path / "jobs.db")
    fake_settings = get_settings()
    fake_settings.db_path = db_path
    monkeypatch.setattr(main, "get_settings", lambda: fake_settings)

    @asynccontextmanager
    async def fake_lifespan(app):
        store = await JobsStore(db_path).connect()
        main._state["store"] = store
        try:
            yield
        finally:
            await store.close()

    main.app.router.lifespan_context = fake_lifespan

    with TestClient(main.app) as c:
        yield c

PACK = """# Mock pack — Test Screen

## SESSION

Interviewer: a test interviewer.

## FLOW

1. Ask one question.

## GRADING FACTS (debrief only)

- Secret model answer the interviewer must never see.

## SCORING RUBRIC (debrief)

Score everything 1-5.
"""


@pytest.fixture
def packs_dir(monkeypatch, tmp_path):
    (tmp_path / "test-screen.md").write_text(PACK, encoding="utf-8")
    monkeypatch.setattr(interview, "PACKS_DIR", tmp_path)
    return tmp_path


def test_pack_split_keeps_grading_out_of_interviewer_prompt(client, packs_dir):
    packs = client.get("/api/interview/packs").json()
    assert packs == [{"name": "test-screen", "title": "Mock pack — Test Screen"}]

    system = client.get("/api/interview/packs/test-screen").json()["system"]
    assert "MOCK job interview" in system  # preamble
    assert "Ask one question" in system  # flow half
    assert "Secret model answer" not in system  # grading half stays out

    assert client.get("/api/interview/packs/nope").status_code == 404


class FakeBridge:
    def __init__(self):
        self.connected = False
        self.system = None
        self.sent_text = []
        self.sent_audio = []

    async def connect(self, **kwargs):
        self.connected = True
        self.system = kwargs.get("system_instruction")
        return self

    async def send_audio(self, data):
        self.sent_audio.append(data)

    async def send_text(self, data):
        self.sent_text.append(data)

    async def close(self):
        self.connected = False


def test_ws_interview_configures_pack_system(client, packs_dir, monkeypatch):
    fake = FakeBridge()
    monkeypatch.setattr(interview._provider, "gemini_live", lambda: fake)

    system = client.get("/api/interview/packs/test-screen").json()["system"]
    with client.websocket_connect("/ws/interview") as ws:
        ws.send_json({"type": "config", "system": system})
        assert ws.receive_json() == {"type": "status", "data": "connected"}
        assert fake.connected and "Ask one question" in fake.system

        ws.send_json({"type": "text", "data": "[BEGIN_INTERVIEW]"})
        ws.send_json({"type": "audio", "data": "AQA="})
    import time

    time.sleep(0.1)
    assert fake.sent_text == ["[BEGIN_INTERVIEW]"]
    assert fake.sent_audio == [b"\x01\x00"]


def test_debrief_grades_and_saves(client, packs_dir, monkeypatch):
    monkeypatch.setattr(
        interview, "get_settings", lambda: type("S", (), {"has_anthropic": True})()
    )
    mock_reason = AsyncMock(return_value="## Verdict\nAdvance.")
    monkeypatch.setattr(interview._provider.claude, "reason", mock_reason)

    res = client.post(
        "/api/interview/debrief",
        json={
            "pack": "test-screen",
            "transcript": [
                {"speaker": "interviewer", "text": "Tell me about yourself."},
                {"speaker": "candidate", "text": "I am a data scientist.", "seconds": 45.2},
            ],
            "duration_seconds": 300,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["scorecard"].startswith("## Verdict")

    # The grader saw the grading half + the timed transcript.
    prompt = mock_reason.call_args.kwargs["messages"][0]["content"]
    assert "Secret model answer" in prompt
    assert "[45s]" in prompt and "I am a data scientist." in prompt

    saved = packs_dir / "sessions"
    files = list(saved.glob("*-test-screen.md"))
    assert len(files) == 1 and "Advance." in files[0].read_text(encoding="utf-8")

    # Empty transcript is a 400, not a Claude call.
    assert client.post(
        "/api/interview/debrief", json={"pack": "test-screen", "transcript": []}
    ).status_code == 400
