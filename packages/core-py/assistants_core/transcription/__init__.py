"""Transcription, diarization & speaker identification.

Speaker-ID uses **local voice embeddings** (decision #7) — see `speakers.py`. No third-party STT
provider (locked decision #5); the Meeting app does live transcription in-browser (Web Speech) and
uses these embeddings for diarization.
"""

from __future__ import annotations

from .speakers import (
    Embedder,
    ResemblyzerEmbedder,
    SpeakerIdentifier,
    SpectralEmbedder,
    cosine,
    default_embedder,
    pcm16_to_float32,
)

__all__ = [
    "Embedder",
    "ResemblyzerEmbedder",
    "SpeakerIdentifier",
    "SpectralEmbedder",
    "cosine",
    "default_embedder",
    "pcm16_to_float32",
]
