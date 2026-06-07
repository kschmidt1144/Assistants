import base64
from typing import Any

from assistants_core.realtime import RealtimeSession


class FakeBridge:
    """Stand-in for GeminiLiveBridge — records calls, never touches the network."""

    def __init__(self) -> None:
        self.connected_with: dict[str, Any] | None = None
        self.calls: list[tuple[Any, ...]] = []

    async def connect(self, **kwargs: Any) -> None:
        self.connected_with = kwargs

    async def send_audio(self, data: bytes) -> None:
        self.calls.append(("audio", data))

    async def send_image(self, data: bytes) -> None:
        self.calls.append(("image", data))

    async def send_text(self, text: str) -> None:
        self.calls.append(("text", text))

    async def close(self) -> None:
        self.calls.append(("close",))


def _session() -> tuple[RealtimeSession, FakeBridge, list[dict[str, Any]]]:
    sent: list[dict[str, Any]] = []

    async def send(obj: dict[str, Any]) -> None:
        sent.append(obj)

    bridge = FakeBridge()
    return RealtimeSession(bridge, send, base_system="SYS"), bridge, sent


async def test_config_connects_and_routes():
    sess, bridge, sent = _session()

    await sess.handle({"type": "config", "system": "custom system"})
    assert bridge.connected_with is not None
    assert bridge.connected_with["system_instruction"] == "custom system"
    assert {"type": "status", "data": "connected"} in sent

    await sess.handle({"type": "audio", "data": base64.b64encode(b"abc").decode()})
    assert ("audio", b"abc") in bridge.calls

    await sess.handle({"type": "text", "data": "hi"})
    assert ("text", "hi") in bridge.calls

    await sess.close()
    assert ("close",) in bridge.calls


async def test_autoconnect_uses_base_system():
    sess, bridge, _ = _session()
    await sess.handle({"type": "text", "data": "yo"})  # no config first
    assert bridge.connected_with is not None
    assert bridge.connected_with["system_instruction"] == "SYS"
    assert ("text", "yo") in bridge.calls


async def test_callbacks_emit_protocol_messages():
    sess, bridge, sent = _session()
    await sess.handle({"type": "config"})
    cbs = bridge.connected_with
    assert cbs is not None
    # native-audio (Option B, #8): AUDIO modality + transcription
    assert cbs["response_modalities"] == ("AUDIO",)
    assert cbs["enable_transcription"] is True

    await cbs["on_text"]("hello")
    await cbs["on_turn_complete"]()
    await cbs["on_transcript"]("said something")
    await cbs["on_audio"](b"\x01\x02\x03\x04")

    assert {"type": "text", "data": "hello"} in sent
    assert {"type": "turnComplete"} in sent
    assert {"type": "transcript", "text": "said something"} in sent
    assert {"type": "audio", "data": base64.b64encode(b"\x01\x02\x03\x04").decode()} in sent
