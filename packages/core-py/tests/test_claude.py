import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from assistants_core.models import ModelRole, ModelSpec
from assistants_core.providers.claude import ClaudeClient, user_text


def test_base_kwargs_gating():
    # CORE-U-06 (K1 issue)
    registry = {
        ModelRole.REASON_DEEP: ModelSpec(
            role=ModelRole.REASON_DEEP, provider="anthropic", context_window=1000,
            model_id="claude-3-7-sonnet-20250219", supports_effort=True, supports_thinking=True
        ),
        ModelRole.REASON_FAST: ModelSpec(
            role=ModelRole.REASON_FAST, provider="anthropic", context_window=1000,
            model_id="claude-3-5-haiku-20241022", supports_effort=False, supports_thinking=False
        ),
    }
    client = ClaudeClient(api_key="dummy", registry=registry)

    # Test Sonnet (supports effort & thinking)
    kwargs_sonnet = client._base_kwargs(
        registry[ModelRole.REASON_DEEP],
        system="Hello",
        messages=[],
        max_tokens=100,
        effort="high",
        thinking=True,
        cache_system=True,
    )
    assert kwargs_sonnet["output_config"]["effort"] == "high"
    assert kwargs_sonnet["thinking"]["type"] == "adaptive"
    # System string should be wrapped for caching
    assert isinstance(kwargs_sonnet["system"], list)
    assert kwargs_sonnet["system"][0]["cache_control"]["type"] == "ephemeral"

    # Test Haiku (does NOT support effort & thinking)
    kwargs_haiku = client._base_kwargs(
        registry[ModelRole.REASON_FAST],
        system="Hello",
        messages=[],
        max_tokens=100,
        effort="high",
        thinking=True,
        cache_system=False,
    )
    # Neither should be present
    assert "output_config" not in kwargs_haiku
    assert "thinking" not in kwargs_haiku
    # System should remain a string if not cached
    assert kwargs_haiku["system"] == "Hello"

    # Test empty system
    kwargs_empty = client._base_kwargs(
        registry[ModelRole.REASON_FAST],
        system="",
        messages=[],
        max_tokens=100,
        effort="high",
        thinking=False,
        cache_system=True,
    )
    assert kwargs_empty["system"] == ""


class FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class FakeMessage:
    def __init__(self, blocks):
        self.content = blocks


@pytest.fixture
def fake_claude_client():
    registry = {
        ModelRole.REASON_DEEP: ModelSpec(
            role=ModelRole.REASON_DEEP, provider="anthropic", context_window=1000,
            model_id="claude-3-7-sonnet", supports_effort=True, supports_thinking=True
        )
    }
    client = ClaudeClient(api_key="dummy", registry=registry)
    mock_anthropic = MagicMock()
    mock_messages = AsyncMock()
    mock_anthropic.messages = mock_messages
    client._client = mock_anthropic
    return client, mock_messages


@pytest.mark.asyncio
async def test_reason(fake_claude_client):
    # CORE-I-07
    client, mock_messages = fake_claude_client
    mock_messages.create.return_value = FakeMessage(
        [FakeTextBlock("Hello "), FakeTextBlock("World")]
    )

    out = await client.reason(
        system="sys",
        messages=[user_text("test")],
        role=ModelRole.REASON_DEEP,
        max_tokens=50,
        effort="low",
        thinking=False,
    )

    assert out == "Hello World"
    mock_messages.create.assert_called_once()
    kwargs = mock_messages.create.call_args[1]
    assert kwargs["model"] == "claude-3-7-sonnet"
    assert kwargs["max_tokens"] == 50
    assert "thinking" not in kwargs


@pytest.mark.asyncio
async def test_reason_structured(fake_claude_client):
    # CORE-I-08 (K2 issue)
    client, mock_messages = fake_claude_client
    mock_messages.create.return_value = FakeMessage([FakeTextBlock('{"key": "value"}')])

    schema = {"type": "object", "properties": {"key": {"type": "string"}}}
    out = await client.reason_structured(
        schema=schema,
        system="sys",
        messages=[user_text("test")],
        role=ModelRole.REASON_DEEP,
        effort="high",
    )
    assert out == {"key": "value"}
    
    kwargs = mock_messages.create.call_args[1]
    # Thinking must be disabled for structured output
    assert "thinking" not in kwargs
    # Output config should have both effort and format
    assert kwargs["output_config"]["effort"] == "high"
    assert kwargs["output_config"]["format"]["type"] == "json_schema"
    assert kwargs["output_config"]["format"]["schema"] == schema

    # Test malformed JSON (K2)
    mock_messages.create.return_value = FakeMessage([FakeTextBlock('{"key": "truncated')])
    with pytest.raises(json.JSONDecodeError):
        await client.reason_structured(
            schema=schema,
            system="sys",
            messages=[],
            role=ModelRole.REASON_DEEP,
        )


@pytest.mark.asyncio
async def test_stream_reason(fake_claude_client):
    # CORE-I-09
    client, mock_messages = fake_claude_client

    class FakeStream:
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass
        @property
        async def text_stream(self):
            for t in ["A", "B", "C"]:
                yield t

    mock_messages.stream = MagicMock(return_value=FakeStream())

    deltas = []
    async for chunk in client.stream_reason(
        system="sys",
        messages=[],
    ):
        deltas.append(chunk)

    assert deltas == ["A", "B", "C"]
