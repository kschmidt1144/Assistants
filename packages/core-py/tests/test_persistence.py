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

async def test_update_session():
    async with Database(":memory:") as db:
        s = await db.create_session(app="meeting", title="Old")
        await db.update_session(s["id"], title="New")
        got = await db.get_session(s["id"])
        assert got["title"] == "New"
        
        await db.update_session(s["id"], metadata={"k": 1})
        got = await db.get_session(s["id"])
        assert got["metadata"] == {"k": 1}
        
        # no-op
        await db.update_session(s["id"])

async def test_add_entry_bumps_updated_at():
    async with Database(":memory:") as db:
        s = await db.create_session(app="meeting", title="Old")
        t = await db.create_transcript(session_id=s["id"], name="raw")
        initial = await db.get_session(s["id"])
        
        # Wait a tiny bit just in case
        import asyncio
        await asyncio.sleep(1.1)
        
        rowid = await db.add_entry(transcript_id=t["id"], text="test", ts=1.0)
        assert rowid is not None
        
        updated = await db.get_session(s["id"])
        assert updated["updated_at"] > initial["updated_at"]

async def test_get_session_none():
    async with Database(":memory:") as db:
        assert await db.get_session("bogus") is None

async def test_fk_cascade_delete():
    async with Database(":memory:") as db:
        s = await db.create_session(app="meeting", title="Old")
        t = await db.create_transcript(session_id=s["id"], name="raw")
        await db.add_entry(transcript_id=t["id"], text="test", ts=1.0)
        
        await db._conn.execute("DELETE FROM sessions WHERE id = ?", (s["id"],))
        
        # Ensure transcript is gone (cascade)
        cur = await db._conn.execute("SELECT * FROM transcripts WHERE session_id = ?", (s["id"],))
        transcripts = await cur.fetchall()
        assert len(transcripts) == 0

async def test_connect_creates_parent_dir_and_is_idempotent(tmp_path):
    import os
    db_path = os.path.join(tmp_path, "newdir", "test.db")
    async with Database(db_path) as db:
        await db.create_session(app="meeting", title="1")
    assert os.path.exists(db_path)
    
    # K10: Idempotent reconnect
    async with Database(db_path) as db2:
        sessions = await db2.list_sessions(app="meeting")
        assert len(sessions) == 1
