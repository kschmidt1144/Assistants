import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from assistants_core.providers.gemini_live import GeminiLiveBridge


@pytest.mark.asyncio
async def test_connect_no_key():
    # CORE-I-10
    bridge = GeminiLiveBridge(api_key="", model="gemini-2.0-flash-exp")
    with pytest.raises(RuntimeError, match="GOOGLE_API_KEY is not set"):
        await bridge.connect()


@pytest.fixture
def fake_genai():
    # We patch the local imports of google.genai inside gemini_live.py by injecting into sys.modules
    # But since it actually imports `from google import genai`, we might just mock `google.genai`
    # if it's already installed. It's safer to use MagicMock for the classes we need.
    import google.genai as real_genai
    from google.genai import types

    mock_client_instance = MagicMock()
    mock_aio = MagicMock()
    mock_live = MagicMock()
    mock_cm = AsyncMock()
    mock_session = AsyncMock()
    
    mock_cm.__aenter__.return_value = mock_session
    mock_live.connect.return_value = mock_cm
    mock_aio.live = mock_live
    mock_client_instance.aio = mock_aio

    # We can patch genai.Client in the module or monkeypatch it
    return mock_client_instance, mock_session


@pytest.mark.asyncio
async def test_connect_and_config(monkeypatch, fake_genai):
    # CORE-I-10
    mock_client_instance, mock_session = fake_genai
    import google.genai as genai
    monkeypatch.setattr(genai, "Client", lambda api_key: mock_client_instance)

    bridge = GeminiLiveBridge(api_key="fake", model="models/gemini-2.0-flash-exp")
    
    # Check config with AUDIO
    await bridge.connect(
        response_modalities=("AUDIO",),
        enable_transcription=True,
    )
    
    assert bridge.connected
    
    # Verify kwargs passed to connect
    kwargs = mock_client_instance.aio.live.connect.call_args[1]
    assert kwargs["model"] == "models/gemini-2.0-flash-exp"
    config = kwargs["config"]
    assert config.response_modalities == ["AUDIO"]
    assert config.input_audio_transcription is not None
    assert config.output_audio_transcription is not None
    
    await bridge.close()
    assert not bridge.connected


@pytest.mark.asyncio
async def test_receive_loop_routing(monkeypatch, fake_genai):
    # CORE-I-11 and K3
    mock_client_instance, mock_session = fake_genai
    import google.genai as genai
    monkeypatch.setattr(genai, "Client", lambda api_key: mock_client_instance)

    class FakeResponse:
        def __init__(self, server_content):
            self.server_content = server_content

    class FakeServerContent:
        def __init__(self, it=None, ot=None, mt=None, tc=False):
            self.input_transcription = it
            self.output_transcription = ot
            self.model_turn = mt
            self.turn_complete = tc

    class FakeText:
        def __init__(self, text):
            self.text = text

    class FakePart:
        def __init__(self, text=None, inline_data=None):
            self.text = text
            self.inline_data = inline_data

    class FakeModelTurn:
        def __init__(self, parts):
            self.parts = parts

    async def fake_receive():
        # 1. Input transcription
        yield FakeResponse(FakeServerContent(it=FakeText("Hello user")))
        # 2. Output transcription and Model turn (K3 issue: double emit)
        yield FakeResponse(FakeServerContent(
            ot=FakeText("Hello back"),
            mt=FakeModelTurn([FakePart(text="Hello back")])
        ))
        # 3. Turn complete
        yield FakeResponse(FakeServerContent(tc=True))

    mock_session.receive = fake_receive

    bridge = GeminiLiveBridge(api_key="fake", model="models/gemini")
    
    on_transcript = AsyncMock()
    on_text = AsyncMock()
    on_turn_complete = AsyncMock()
    
    await bridge.connect(
        on_transcript=on_transcript,
        on_text=on_text,
        on_turn_complete=on_turn_complete,
    )
    
    # Wait for the receive loop to process our fake_receive items
    # Since it runs in a background task, we can wait a tiny bit or await the task
    await asyncio.sleep(0.01)
    
    on_transcript.assert_called_once_with("Hello user")
    
    # K3 Issue: Double emit assertion
    # The output transcription triggers on_text, and the model_turn ALSO triggers on_text
    assert on_text.call_count == 2
    on_text.assert_any_call("Hello back")
    
    on_turn_complete.assert_called_once()
    
    await bridge.close()


@pytest.mark.asyncio
async def test_emit_and_error(monkeypatch, fake_genai):
    # CORE-I-12
    mock_client_instance, mock_session = fake_genai
    import google.genai as genai
    monkeypatch.setattr(genai, "Client", lambda api_key: mock_client_instance)

    sync_called = False
    def sync_cb():
        nonlocal sync_called
        sync_called = True

    async def fake_receive_error():
        raise ValueError("Something broke")
        yield  # make it a generator

    mock_session.receive = fake_receive_error

    bridge = GeminiLiveBridge(api_key="fake", model="models/gemini")
    on_error = AsyncMock()

    await bridge.connect(on_error=on_error)
    
    # Test _emit manually
    await bridge._emit(sync_cb)
    assert sync_called

    # Wait for loop to crash
    await asyncio.sleep(0.01)
    
    on_error.assert_called_once()
    assert isinstance(on_error.call_args[0][0], ValueError)

    await bridge.close()


@pytest.mark.asyncio
async def test_send_methods(monkeypatch, fake_genai):
    # CORE-I-13
    mock_client_instance, mock_session = fake_genai
    import google.genai as genai
    monkeypatch.setattr(genai, "Client", lambda api_key: mock_client_instance)

    bridge = GeminiLiveBridge(api_key="fake", model="models/gemini")
    await bridge.connect()

    await bridge.send_audio(b"audiobytes")
    call = mock_session.send_realtime_input.call_args[1]
    assert call["audio"].mime_type == "audio/pcm;rate=16000"
    assert call["audio"].data == b"audiobytes"

    await bridge.send_image(b"imagebytes")
    call = mock_session.send_realtime_input.call_args[1]
    assert call["video"].mime_type == "image/jpeg"
    assert call["video"].data == b"imagebytes"

    await bridge.send_text("Hello", turn_complete=False)
    call = mock_session.send_client_content.call_args[1]
    assert call["turn_complete"] is False
    assert call["turns"][0].parts[0].text == "Hello"

    await bridge.close()
