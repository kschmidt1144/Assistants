import numpy as np
from assistants_core.persistence import Database
from assistants_core.transcription import SpeakerIdentifier, cosine, pcm16_to_float32


class StubEmbedder:
    """Deterministic: maps a constant-valued clip to a basis vector by its mean amplitude."""

    def embed(self, wav: np.ndarray, sr: int = 16000) -> np.ndarray:
        idx = min(int(round(float(np.mean(wav)) * 9)), 9)
        v = np.zeros(10, dtype=np.float32)
        v[max(0, idx)] = 1.0
        return v


def clip(value: float, n: int = 1600) -> np.ndarray:
    return np.full(n, value, dtype=np.float32)


def test_pcm16_to_float32_roundtrip():
    pcm = (np.array([0, 16384, -16384, 32767], dtype="<i2")).tobytes()
    out = pcm16_to_float32(pcm)
    assert out.shape == (4,)
    assert abs(out[1] - 0.5) < 1e-3
    assert out[2] < 0


def test_cosine_basic():
    assert cosine(np.array([1.0, 0]), np.array([1.0, 0])) == 1.0
    assert cosine(np.array([1.0, 0]), np.array([0.0, 1.0])) == 0.0
    assert cosine(np.zeros(2), np.array([1.0, 0])) == 0.0


async def test_enroll_and_identify():
    async with Database(":memory:") as db:
        ident = SpeakerIdentifier(db, embedder=StubEmbedder(), threshold=0.75)

        await ident.enroll("alice", [clip(0.1), clip(0.1)])
        await ident.enroll("bob", [clip(0.5), clip(0.5)])

        name, score = await ident.identify(clip(0.1))
        assert name == "alice"
        assert score > 0.9

        name, _ = await ident.identify(clip(0.5))
        assert name == "bob"

        # an unseen voice (basis index 9) matches no profile → Unknown
        name, _ = await ident.identify(clip(0.95))
        assert name == "Unknown"


async def test_profiles_persist_and_delete():
    async with Database(":memory:") as db:
        ident = SpeakerIdentifier(db, embedder=StubEmbedder())
        await ident.enroll("alice", [clip(0.1)])

        listed = await db.list_voice_profiles()
        assert [p["name"] for p in listed] == ["alice"]
        assert "embedding" not in listed[0]  # not leaked unless requested

        full = await db.list_voice_profiles(with_embedding=True)
        assert len(full[0]["embedding"]) == 10

        await db.delete_voice_profile("alice")
        assert await db.list_voice_profiles() == []
