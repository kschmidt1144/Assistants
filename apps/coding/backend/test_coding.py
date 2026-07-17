from unittest.mock import AsyncMock

import anthropic
import httpx
import main
import pytest
from assistants_core.models import ModelRole
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    # Ensure no API keys interfere with logic
    import assistants_core.config
    monkeypatch.setattr(assistants_core.config, "_find_dotenv", lambda: None)
    
    main.get_settings.cache_clear()
    import os
    if "ANTHROPIC_API_KEY" in os.environ:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    if "GOOGLE_API_KEY" in os.environ:
        monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
        
    return TestClient(main.app)


@pytest.fixture
def mock_claude(monkeypatch):
    mock_reason = AsyncMock(return_value="mocked answer")
    monkeypatch.setattr(main.router.claude, "reason", mock_reason)
    return mock_reason


def test_health_and_models(client):
    # COD-I-01
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["app"] == "coding"
    assert "anthropic" in data

    resp = client.get("/api/models")
    assert resp.status_code == 200
    data = resp.json()
    assert ModelRole.REASON_DEEP in data
    assert ModelRole.REALTIME in data


def test_analyze(client, mock_claude, monkeypatch):
    # COD-I-02
    # 400 without key
    resp = client.post("/api/analyze", json={"text": "Hello"})
    assert resp.status_code == 400
    assert "ANTHROPIC_API_KEY not set" in resp.json()["detail"]

    # Mock key to bypass check
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    main.get_settings.cache_clear()

    # Role coercion (invalid role -> deep)
    resp = client.post("/api/analyze", json={"text": "Hello", "role": "bogus"})
    assert resp.status_code == 200
    mock_claude.assert_called_once()
    kwargs = mock_claude.call_args[1]
    assert kwargs["role"] == ModelRole.REASON_DEEP
    assert kwargs["messages"][0]["content"] == "Hello"
    assert kwargs["messages"][0]["role"] == "user"
    mock_claude.reset_mock()

    # Role coercion (realtime -> deep)
    resp = client.post("/api/analyze", json={"text": "Hello", "role": "realtime"})
    assert resp.status_code == 200
    kwargs = mock_claude.call_args[1]
    assert kwargs["role"] == ModelRole.REASON_DEEP
    mock_claude.reset_mock()

    # Context appended to system
    resp = client.post("/api/analyze", json={"text": "Hello", "context": "MyProject"})
    assert resp.status_code == 200
    kwargs = mock_claude.call_args[1]
    assert "MyProject" in kwargs["system"]
    mock_claude.reset_mock()

    # With image
    resp = client.post("/api/analyze", json={"text": "Look", "image": "base64bytes"})
    assert resp.status_code == 200
    kwargs = mock_claude.call_args[1]
    content = kwargs["messages"][0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "image"
    assert content[0]["source"]["data"] == "base64bytes"


def test_ocr(client, mock_claude, monkeypatch):
    # COD-I-03
    # 400 without key
    resp = client.post("/api/ocr", json={"image": "img"})
    assert resp.status_code == 400

    # Mock key
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    main.get_settings.cache_clear()

    # Missing image
    resp = client.post("/api/ocr", json={})
    assert resp.status_code == 422

    resp = client.post("/api/ocr", json={"image": "imgbytes"})
    assert resp.status_code == 200
    assert resp.json() == {"text": "mocked answer"}
    mock_claude.assert_called_once()
    kwargs = mock_claude.call_args[1]
    assert kwargs["role"] == ModelRole.REASON_FAST
    assert kwargs["thinking"] is False


def test_analyze_provider_error_is_clean_http_error(client, monkeypatch):
    # COD-I-06: a provider/network failure (incl. for image requests) must surface as a normal
    # HTTP error so the response keeps its CORS headers — an *unhandled* exception 500s outside
    # CORSMiddleware, which the browser silently reports as "Failed to fetch".
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    main.get_settings.cache_clear()
    boom = anthropic.APIConnectionError(
        message="upstream boom",
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
    )
    monkeypatch.setattr(main.router.claude, "reason", AsyncMock(side_effect=boom))

    # Image present (the case the bug report worried about) — thinking stays on; the error is caught.
    resp = client.post("/api/analyze", json={"text": "Look", "image": "b64"})
    assert resp.status_code == 502
    assert "upstream boom" in resp.json()["detail"]

    # OCR is protected the same way.
    resp = client.post("/api/ocr", json={"image": "b64"})
    assert resp.status_code == 502
    assert "upstream boom" in resp.json()["detail"]


class FakeBridge:
    def __init__(self):
        self.connected = False
        self.on_text = None
        self.on_audio = None
        self.on_error = None
        self.on_turn_complete = None
        self.sent_audio = []
        self.sent_image = []
        self.sent_text = []

    async def connect(self, **kwargs):
        self.connected = True
        self.on_text = kwargs.get("on_text")
        self.on_audio = kwargs.get("on_audio")
        self.on_error = kwargs.get("on_error")
        self.on_turn_complete = kwargs.get("on_turn_complete")
        return self

    async def send_audio(self, data):
        self.sent_audio.append(data)

    async def send_image(self, data):
        self.sent_image.append(data)

    async def send_text(self, data, *, turn_complete=True):
        self.sent_text.append(data)

    async def close(self):
        self.connected = False


def test_ws_live(client, monkeypatch):
    # COD-I-04
    fake_bridge = FakeBridge()
    monkeypatch.setattr(main.router, "gemini_live", lambda: fake_bridge)
    
    with client.websocket_connect("/ws/live") as websocket:
        # Config -> {status:"connected"}
        websocket.send_json({"type": "config"})
        resp = websocket.receive_json()
        assert resp == {"type": "status", "data": "connected"}
        assert fake_bridge.connected

        # Audio decode
        websocket.send_json({"type": "audio", "data": "AQA="}) # base64 for \x01\x00
        # Wait a tiny bit for async processing (TestClient websocket is sync but backend runs async)
        
        # Image decode
        websocket.send_json({"type": "image", "data": "AQA="})

        # Text decode
        websocket.send_json({"type": "text", "data": "hello", "turn_complete": True})
        
        import time
        time.sleep(0.1) # yield so backend async task can process the messages
        
    # Check that FakeBridge recorded them
    assert len(fake_bridge.sent_audio) == 1
    assert fake_bridge.sent_audio[0] == b'\x01\x00'
    assert len(fake_bridge.sent_image) == 1
    assert len(fake_bridge.sent_text) == 1
    assert fake_bridge.sent_text[0] == "hello"


def test_cors(client):
    # COD-I-05
    resp = client.options(
        "/api/analyze",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"

    resp = client.options(
        "/api/analyze",
        headers={
            "Origin": "http://evil.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in resp.headers
