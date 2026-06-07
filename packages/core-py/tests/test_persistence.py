from assistants_core.persistence import Database


async def test_session_and_transcript_roundtrip():
    async with Database(":memory:") as db:
        s = await db.create_session(app="meeting", title="Standup")
        assert s["app"] == "meeting"
        assert s["title"] == "Standup"

        got = await db.get_session(s["id"])
        assert got is not None
        assert got["id"] == s["id"]

        assert len(await db.list_sessions(app="meeting")) == 1
        assert await db.list_sessions(app="coding") == []

        t = await db.create_transcript(session_id=s["id"], name="raw")
        await db.add_entry(transcript_id=t["id"], text="hello", speaker="alice", ts=1.0)
        await db.add_entry(transcript_id=t["id"], text="world", speaker="bob", ts=2.0)

        entries = await db.get_entries(t["id"])
        assert [e["text"] for e in entries] == ["hello", "world"]
        assert entries[0]["speaker"] == "alice"


async def test_metadata_json_roundtrip():
    async with Database(":memory:") as db:
        s = await db.create_session(app="coding", metadata={"k": "v", "n": 1})
        got = await db.get_session(s["id"])
        assert got is not None
        assert got["metadata"] == {"k": "v", "n": 1}
