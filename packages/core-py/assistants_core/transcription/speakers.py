"""Local speaker identification via voice embeddings (decision #7).

A pluggable `Embedder` turns a PCM audio clip into a fixed vector; `SpeakerIdentifier` enrolls
profiles (averaged, normalized embeddings) and identifies a clip by cosine similarity vs a threshold.

Backends:
  • ResemblyzerEmbedder — high quality (optional `[speaker]` extra; pulls torch/librosa).
  • SpectralEmbedder    — pure-numpy fallback so the app runs without torch (lower accuracy).

Input is PCM16 16kHz mono (what core-web's AudioWorklet capture produces) — no WebM/Opus decode,
which fixes the prototype's unreliable-decode bug.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np

SAMPLE_RATE = 16_000


def pcm16_to_float32(data: bytes) -> np.ndarray:
    """Decode little-endian PCM16 bytes → float32 mono in [-1, 1]."""
    if not data:
        return np.zeros(0, dtype=np.float32)
    ints = np.frombuffer(data, dtype="<i2").astype(np.float32)
    return ints / 32768.0


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@runtime_checkable
class Embedder(Protocol):
    def embed(self, wav: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray: ...


class SpectralEmbedder:
    """Pure-numpy spectral-envelope embedding. No torch. Deterministic. Modest accuracy."""

    def __init__(self, bands: int = 32, frame: int = 400, hop: int = 160) -> None:
        self.bands = bands
        self.frame = frame
        self.hop = hop

    def embed(self, wav: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
        x = np.asarray(wav, dtype=np.float64)
        if x.size < self.frame:
            x = np.pad(x, (0, self.frame - x.size))
        window = np.hanning(self.frame)
        n_frames = 1 + (len(x) - self.frame) // self.hop
        spectra = []
        for i in range(max(n_frames, 1)):
            seg = x[i * self.hop : i * self.hop + self.frame]
            if len(seg) < self.frame:
                seg = np.pad(seg, (0, self.frame - len(seg)))
            spectra.append(np.abs(np.fft.rfft(seg * window)))
        mean_spec = np.log1p(np.mean(spectra, axis=0))
        emb = np.array([band.mean() for band in np.array_split(mean_spec, self.bands)])
        norm = np.linalg.norm(emb)
        return (emb / norm).astype(np.float32) if norm > 0 else emb.astype(np.float32)


class ResemblyzerEmbedder:
    """High-quality embedding via resemblyzer's VoiceEncoder (lazy-loaded)."""

    def __init__(self) -> None:
        from resemblyzer import VoiceEncoder  # noqa: PLC0415 — optional dep

        self._encoder = VoiceEncoder()

    def embed(self, wav: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
        from resemblyzer import preprocess_wav  # noqa: PLC0415

        processed = preprocess_wav(np.asarray(wav, dtype=np.float32), source_sr=sr)
        return np.asarray(self._encoder.embed_utterance(processed), dtype=np.float32)


def default_embedder() -> Embedder:
    """ResemblyzerEmbedder if installed, else the numpy fallback."""
    try:
        return ResemblyzerEmbedder()
    except Exception:  # noqa: BLE001 — resemblyzer/torch absent or failed to load
        return SpectralEmbedder()


class SpeakerIdentifier:
    """Enrolls and identifies speakers against voice profiles stored in the `Database`."""

    def __init__(self, db: Any, embedder: Embedder | None = None, threshold: float = 0.75) -> None:
        self.db = db
        self.embedder = embedder or default_embedder()
        self.threshold = threshold

    def _mean_embedding(self, samples: list[np.ndarray]) -> np.ndarray:
        embs = [self.embedder.embed(s) for s in samples if np.asarray(s).size > 0]
        if not embs:
            raise ValueError("no usable audio to embed")
        mean = np.mean(embs, axis=0)
        norm = np.linalg.norm(mean)
        return mean / norm if norm > 0 else mean

    async def enroll(self, name: str, samples: list[np.ndarray]) -> dict[str, Any]:
        mean = self._mean_embedding(samples)
        await self.db.save_voice_profile(
            name=name, embedding=[float(v) for v in mean], num_samples=len(samples)
        )
        return {"name": name, "num_samples": len(samples)}

    async def identify(self, sample: np.ndarray) -> tuple[str, float]:
        profiles = await self.db.list_voice_profiles(with_embedding=True)
        if not profiles:
            return ("Unknown", 0.0)
        emb = self.embedder.embed(sample)
        best_name, best_score = "Unknown", -1.0
        for profile in profiles:
            score = cosine(emb, np.asarray(profile["embedding"], dtype=np.float32))
            if score > best_score:
                best_score, best_name = score, profile["name"]
        return (best_name if best_score >= self.threshold else "Unknown", float(best_score))
