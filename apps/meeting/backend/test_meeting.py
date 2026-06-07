import base64

import main
import numpy as np
from assistants_core import Database, SpeakerIdentifier


class StubEmbedder:
    """Maps a constant clip to a basis vector by mean amplitude — deterministic, no torch."""

    def embed(self, wav: np.ndarray, sr: int = 16000) -> np.ndarray:
        idx = min(int(round(float(np.mean(wav)) * 9)), 9)
        v = np.zeros(10, dtype=np.float32)
        v[max(0, idx)] = 1.0
        return v


def _clip(int16_val: int, n: int = 1600) -> str:
    return base64.b64encode(np.full(n, int16_val, dtype="<i2").tobytes()).decode()


async def test_persistence_and_speaker_id():
    db = await Database(":memory:").connect()
    main._state["db"] = db
    main._state["identifier"] = SpeakerIdentifier(db, embedder=StubEmbedder())
    try:
        m = await main.create_meeting(main.CreateMeeting(title="Standup"))
        await main.append_entries(
            m["id"], main.AppendEntries(entries=[main.EntryIn(text="hi", speaker="alice")])
        )
        got = await main.get_meeting(m["id"])
        assert [e["text"] for e in got["entries"]] == ["hi"]

        await main.enroll_speaker(main.EnrollRequest(name="alice", samples=[_clip(3277), _clip(3277)]))
        await main.enroll_speaker(main.EnrollRequest(name="bob", samples=[_clip(16384)]))

        assert (await main.identify_speaker(main.IdentifyRequest(audio=_clip(3277))))["speaker"] == "alice"
        assert (await main.identify_speaker(main.IdentifyRequest(audio=_clip(31000))))["speaker"] == "Unknown"

        profiles = await main.voice_profiles()
        assert {p["name"] for p in profiles} == {"alice", "bob"}
    finally:
        await db.close()
        main._state["db"] = None
        main._state["identifier"] = None
