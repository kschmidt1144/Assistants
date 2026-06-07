"""Gemini Live realtime bridge (google-genai).

Owns one bidirectional Live session: PCM16 audio / JPEG frames / text in, streamed text (and
optionally audio) out via callbacks. The backend holds the session so the browser never sees the
API key. Mirrors the send/receive shape the prototypes used.

NOTE: the google-genai Live surface (`send_realtime_input`, `server_content` fields) has shifted
across SDK versions; these calls follow the prototypes' working usage. Integration-testing requires
a real GOOGLE_API_KEY and a confirmed Gemini Live model id (open decision #8).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

Cb = Callable[..., Awaitable[None] | None] | None


class GeminiLiveBridge:
    def __init__(self, api_key: str | None, model: str) -> None:
        self._api_key = api_key
        self._model = model
        self._client: Any = None
        self._cm: Any = None
        self._session: Any = None
        self._recv_task: asyncio.Task[None] | None = None
        self.on_text: Cb = None
        self.on_audio: Cb = None
        self.on_transcript: Cb = None
        self.on_turn_complete: Cb = None
        self.on_error: Cb = None

    @property
    def connected(self) -> bool:
        return self._session is not None

    async def connect(
        self,
        *,
        system_instruction: str | None = None,
        response_modalities: tuple[str, ...] = ("AUDIO",),
        enable_transcription: bool = True,
        on_text: Cb = None,
        on_audio: Cb = None,
        on_transcript: Cb = None,
        on_turn_complete: Cb = None,
        on_error: Cb = None,
    ) -> GeminiLiveBridge:
        if not self._api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set — cannot open Gemini Live.")
        from google import genai
        from google.genai import types

        self.on_text = on_text
        self.on_audio = on_audio
        self.on_transcript = on_transcript
        self.on_turn_complete = on_turn_complete
        self.on_error = on_error

        self._client = genai.Client(api_key=self._api_key)
        config_kwargs: dict[str, Any] = {
            "response_modalities": list(response_modalities),
            "system_instruction": system_instruction,
        }
        if enable_transcription:
            # Native-audio models reply with AUDIO and surface text via transcription, so we
            # enable input (user speech) and, for audio replies, output (model speech) transcription.
            config_kwargs["input_audio_transcription"] = types.AudioTranscriptionConfig()
            if any(m.upper() == "AUDIO" for m in response_modalities):
                config_kwargs["output_audio_transcription"] = types.AudioTranscriptionConfig()
        config = types.LiveConnectConfig(**config_kwargs)
        self._cm = self._client.aio.live.connect(model=self._model, config=config)
        self._session = await self._cm.__aenter__()
        self._recv_task = asyncio.create_task(self._receive_loop())
        return self

    @staticmethod
    async def _emit(cb: Cb, *args: Any) -> None:
        if cb is None:
            return
        result = cb(*args)
        if asyncio.iscoroutine(result):
            await result

    async def _receive_loop(self) -> None:
        try:
            async for response in self._session.receive():
                sc = getattr(response, "server_content", None)
                if sc is not None:
                    it = getattr(sc, "input_transcription", None)
                    if it is not None and getattr(it, "text", None):
                        await self._emit(self.on_transcript, it.text)

                    ot = getattr(sc, "output_transcription", None)
                    if ot is not None and getattr(ot, "text", None):
                        await self._emit(self.on_text, ot.text)

                    mt = getattr(sc, "model_turn", None)
                    if mt is not None and getattr(mt, "parts", None):
                        for part in mt.parts:
                            if getattr(part, "text", None):
                                await self._emit(self.on_text, part.text)
                            inline = getattr(part, "inline_data", None)
                            if inline is not None and getattr(inline, "data", None):
                                await self._emit(self.on_audio, inline.data)

                    if getattr(sc, "turn_complete", False):
                        await self._emit(self.on_turn_complete)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — surface, don't crash the task silently
            await self._emit(self.on_error, exc)

    async def send_audio(self, pcm16: bytes) -> None:
        from google.genai import types

        await self._session.send_realtime_input(
            audio=types.Blob(data=pcm16, mime_type="audio/pcm;rate=16000")
        )

    async def send_image(self, jpeg: bytes) -> None:
        from google.genai import types

        await self._session.send_realtime_input(
            video=types.Blob(data=jpeg, mime_type="image/jpeg")
        )

    async def send_text(self, text: str, *, turn_complete: bool = True) -> None:
        from google.genai import types

        await self._session.send_client_content(
            turns=[types.Content(role="user", parts=[types.Part(text=text)])],
            turn_complete=turn_complete,
        )

    async def close(self) -> None:
        if self._recv_task is not None:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if self._cm is not None:
            try:
                await self._cm.__aexit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass
        self._session = None
        self._cm = None
        self._recv_task = None
