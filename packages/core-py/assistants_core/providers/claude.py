"""Claude reasoning client (Anthropic SDK).

Wraps the Messages API with the techniques the prototypes were missing (REBUILD_PLAN.md §5):
streaming, structured outputs, prompt caching, and adaptive thinking + effort — applied only
to models that accept them (Haiku 4.5 rejects effort/thinking, so we gate on `ModelSpec` flags).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from ..models import ModelRole, ModelSpec

# Message = a plain dict shaped like the Anthropic Messages API expects.
Message = dict[str, Any]


class StructuredOutputError(ValueError):
    """`reason_structured` got a response that wasn't valid JSON.

    Raised instead of a bare `JSONDecodeError` when a structured call comes back truncated
    (hit `max_tokens`) or refused — so callers see *why* the parse failed (K2), not an opaque
    decode error from deep inside the SDK.
    """


def user_text(text: str) -> Message:
    return {"role": "user", "content": text}


def user_with_image(text: str, image_b64: str, media_type: str = "image/jpeg") -> Message:
    return {
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": text},
        ],
    }


class ClaudeClient:
    """Async wrapper over `anthropic.AsyncAnthropic`, keyed by `ModelRole`.

    The underlying client is built lazily so the module imports (and offline tests run) without
    an API key; calling a method without `ANTHROPIC_API_KEY` raises a clear error.
    """

    def __init__(self, api_key: str | None, registry: dict[ModelRole, ModelSpec]) -> None:
        self._api_key = api_key
        self._registry = registry
        self._client: Any = None

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._api_key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set — cannot call Claude.")
            from anthropic import AsyncAnthropic

            self._client = AsyncAnthropic(api_key=self._api_key)
        return self._client

    def _spec(self, role: ModelRole) -> ModelSpec:
        return self._registry[role]

    def _base_kwargs(
        self,
        spec: ModelSpec,
        *,
        system: str,
        messages: list[Message],
        max_tokens: int,
        effort: str,
        thinking: bool,
        cache_system: bool,
    ) -> dict[str, Any]:
        system_block: Any = system
        if cache_system and system:
            system_block = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        kwargs: dict[str, Any] = {
            "model": spec.model_id,
            "max_tokens": max_tokens,
            "system": system_block,
            "messages": messages,
        }
        output_config: dict[str, Any] = {}
        if spec.supports_effort:
            output_config["effort"] = effort
        if output_config:
            kwargs["output_config"] = output_config
        if thinking and spec.supports_thinking:
            kwargs["thinking"] = {"type": "adaptive"}
        return kwargs

    @staticmethod
    def _text_of(message: Any) -> str:
        return "".join(b.text for b in message.content if getattr(b, "type", None) == "text")

    async def reason(
        self,
        *,
        system: str,
        messages: list[Message],
        role: ModelRole = ModelRole.REASON_DEEP,
        max_tokens: int = 16_000,
        effort: str = "high",
        thinking: bool = True,
        cache_system: bool = True,
    ) -> str:
        """One-shot completion → concatenated text."""
        spec = self._spec(role)
        kwargs = self._base_kwargs(
            spec, system=system, messages=messages, max_tokens=max_tokens,
            effort=effort, thinking=thinking, cache_system=cache_system,
        )
        message = await self.client.messages.create(**kwargs)
        return self._text_of(message)

    async def reason_structured(
        self,
        *,
        schema: dict[str, Any],
        system: str,
        messages: list[Message],
        role: ModelRole = ModelRole.REASON_DEEP,
        max_tokens: int = 16_000,
        effort: str = "high",
        cache_system: bool = True,
    ) -> Any:
        """Completion constrained to `schema` (JSON Schema) → parsed object.

        Replaces the prototypes' brittle ```json``` fence-stripping with real structured outputs.
        """
        spec = self._spec(role)
        kwargs = self._base_kwargs(
            spec, system=system, messages=messages, max_tokens=max_tokens,
            effort=effort, thinking=False, cache_system=cache_system,
        )
        kwargs["output_config"] = {
            **kwargs.get("output_config", {}),
            "format": {"type": "json_schema", "schema": schema},
        }
        message = await self.client.messages.create(**kwargs)
        text = self._text_of(message)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            stop = getattr(message, "stop_reason", None)
            raise StructuredOutputError(
                f"structured output was not valid JSON (stop_reason={stop!r}, "
                f"{len(text)} chars received): {text[:200]!r}"
            ) from exc

    async def stream_reason(
        self,
        *,
        system: str,
        messages: list[Message],
        role: ModelRole = ModelRole.REASON_DEEP,
        max_tokens: int = 16_000,
        effort: str = "high",
        thinking: bool = True,
        cache_system: bool = True,
    ) -> AsyncIterator[str]:
        """Stream text deltas (use for live UI / long outputs)."""
        spec = self._spec(role)
        kwargs = self._base_kwargs(
            spec, system=system, messages=messages, max_tokens=max_tokens,
            effort=effort, thinking=thinking, cache_system=cache_system,
        )
        async with self.client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
