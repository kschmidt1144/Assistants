"""Per-connection realtime session: ties a `GeminiLiveBridge` to a transport.

Transport-agnostic on purpose — the FastAPI WebSocket route supplies an async `send_json`, and this
class routes inbound `ClientMessage`s to the bridge and bridge callbacks back out as `ServerMessage`s
(the shared protocol envelope in core-web/protocol.ts). Reusable by the Meeting app later.
"""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from typing import Any

from ..providers.gemini_live import GeminiLiveBridge

SendJson = Callable[[dict[str, Any]], Awaitable[None]]


class RealtimeSession:
    def __init__(self, bridge: GeminiLiveBridge, send_json: SendJson, *, base_system: str = "") -> None:
        self._bridge = bridge
        self._send = send_json
        self._base_system = base_system
        self._started = False

    async def _connect(self, system: str | None) -> None:
        await self._bridge.connect(
            system_instruction=system or self._base_system or None,
            response_modalities=("AUDIO",),  # native-audio (#8); model text arrives via transcription
            enable_transcription=True,
            on_text=lambda text: self._send({"type": "text", "data": text}),
            on_transcript=lambda text: self._send({"type": "transcript", "text": text}),
            on_audio=lambda audio: self._send(
                {"type": "audio", "data": base64.b64encode(audio).decode()}
            ),
            on_turn_complete=lambda: self._send({"type": "turnComplete"}),
            on_error=lambda exc: self._send({"type": "error", "data": str(exc)}),
        )
        self._started = True
        await self._send({"type": "status", "data": "connected"})

    async def handle(self, msg: dict[str, Any]) -> None:
        """Process one inbound client message. Auto-connects on first data if no config was sent."""
        mtype = msg.get("type")

        if mtype == "config":
            if not self._started:
                await self._connect(msg.get("system"))
            return

        if not self._started:
            await self._connect(None)

        if mtype == "audio":
            await self._bridge.send_audio(base64.b64decode(msg["data"]))
        elif mtype == "image":
            await self._bridge.send_image(base64.b64decode(msg["data"]))
        elif mtype == "text":
            await self._bridge.send_text(msg["data"])
        elif mtype == "multimodal":
            await self._bridge.send_image(base64.b64decode(msg["image"]))
            await self._bridge.send_text(msg["text"])

    async def close(self) -> None:
        await self._bridge.close()
