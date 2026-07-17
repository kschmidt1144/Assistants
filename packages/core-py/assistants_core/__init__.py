"""assistants-core — shared backend core for the Assistants apps."""

from __future__ import annotations

from .config import Settings, get_settings
from .docs import parse_document
from .models import ModelRole, ModelSpec, Provider, build_registry
from .persistence import Database
from .providers import (
    ClaudeClient,
    GeminiLiveBridge,
    Message,
    ProviderRouter,
    StructuredOutputError,
    user_text,
    user_with_image,
)
from .realtime import RealtimeSession
from .transcription import SpeakerIdentifier, default_embedder, pcm16_to_float32
from .util import object_schema
from .web import install_cors

__version__ = "0.1.0"

__all__ = [
    "ClaudeClient",
    "Database",
    "GeminiLiveBridge",
    "Message",
    "ModelRole",
    "ModelSpec",
    "Provider",
    "ProviderRouter",
    "RealtimeSession",
    "Settings",
    "SpeakerIdentifier",
    "StructuredOutputError",
    "build_registry",
    "default_embedder",
    "get_settings",
    "install_cors",
    "object_schema",
    "parse_document",
    "pcm16_to_float32",
    "user_text",
    "user_with_image",
]
