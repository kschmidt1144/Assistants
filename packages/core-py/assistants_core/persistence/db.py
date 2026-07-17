"""Local SQLite persistence (async).

Replaces the prototypes' scattered JSON files / vanish-on-reload state with one local store.
Phase-0 schema covers sessions + transcripts; context banks etc. get added with the Jobs app.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  app         TEXT NOT NULL,
  title       TEXT,
  metadata    TEXT,
  created_at  REAL NOT NULL,
  updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS transcripts (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  name        TEXT,
  created_at  REAL NOT NULL,
  updated_at  REAL NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS transcript_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id TEXT NOT NULL,
  ts            REAL NOT NULL,
  speaker       TEXT,
  text          TEXT NOT NULL,
  FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entries_transcript ON transcript_entries(transcript_id);
CREATE TABLE IF NOT EXISTS voice_profiles (
  name         TEXT PRIMARY KEY,
  embedding    TEXT NOT NULL,
  num_samples  INTEGER,
  created_at   REAL NOT NULL
);
"""


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return uuid.uuid4().hex


class Database:
    """Thin async wrapper over a single aiosqlite connection."""

    def __init__(self, path: str = ":memory:") -> None:
        self.path = path
        self._conn: Any = None

    async def connect(self) -> Database:
        import aiosqlite

        if self.path != ":memory:":
            parent = os.path.dirname(os.path.abspath(self.path))
            os.makedirs(parent, exist_ok=True)
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA foreign_keys = ON")
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()
        return self

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def __aenter__(self) -> Database:
        return await self.connect()

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    @staticmethod
    def _dict(row: Any) -> dict[str, Any]:
        d = dict(row)
        if d.get("metadata"):
            d["metadata"] = json.loads(d["metadata"])
        return d

    # ── sessions ──────────────────────────────────────────────────────────────
    async def create_session(
        self, *, app: str, title: str | None = None, metadata: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        sid = session_id or _new_id()
        now = _now()
        await self._conn.execute(
            "INSERT INTO sessions (id, app, title, metadata, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (sid, app, title, json.dumps(metadata) if metadata else None, now, now),
        )
        await self._conn.commit()
        result = await self.get_session(sid)
        assert result is not None
        return result

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        cur = await self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cur.fetchone()
        return self._dict(row) if row else None

    async def list_sessions(self, *, app: str | None = None) -> list[dict[str, Any]]:
        if app is None:
            cur = await self._conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
        else:
            cur = await self._conn.execute(
                "SELECT * FROM sessions WHERE app = ? ORDER BY updated_at DESC", (app,)
            )
        return [self._dict(r) for r in await cur.fetchall()]

    # ── transcripts ─────────────────────────────────────────────────────────--
    async def create_transcript(
        self, *, session_id: str | None = None, name: str | None = None,
        transcript_id: str | None = None,
    ) -> dict[str, Any]:
        tid = transcript_id or _new_id()
        now = _now()
        await self._conn.execute(
            "INSERT INTO transcripts (id, session_id, name, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (tid, session_id, name, now, now),
        )
        await self._conn.commit()
        cur = await self._conn.execute("SELECT * FROM transcripts WHERE id = ?", (tid,))
        return self._dict(await cur.fetchone())

    async def add_entry(
        self, *, transcript_id: str, text: str, speaker: str | None = None, ts: float | None = None
    ) -> int:
        cur = await self._conn.execute(
            "INSERT INTO transcript_entries (transcript_id, ts, speaker, text) VALUES (?, ?, ?, ?)",
            (transcript_id, ts if ts is not None else _now(), speaker, text),
        )
        now = _now()
        await self._conn.execute(
            "UPDATE transcripts SET updated_at = ? WHERE id = ?", (now, transcript_id)
        )
        await self._conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = (SELECT session_id FROM transcripts WHERE id = ?)",
            (now, transcript_id),
        )
        await self._conn.commit()
        return int(cur.lastrowid)

    async def get_entries(self, transcript_id: str) -> list[dict[str, Any]]:
        cur = await self._conn.execute(
            "SELECT id, transcript_id, ts, speaker, text FROM transcript_entries"
            " WHERE transcript_id = ? ORDER BY id ASC",
            (transcript_id,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def delete_session(self, session_id: str) -> None:
        # Transcripts + entries cascade via FK (PRAGMA foreign_keys = ON, set in connect()).
        await self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await self._conn.commit()

    async def update_session(
        self, session_id: str, *, title: str | None = None, metadata: dict[str, Any] | None = None
    ) -> None:
        sets, params = [], []
        if title is not None:
            sets.append("title = ?")
            params.append(title)
        if metadata is not None:
            sets.append("metadata = ?")
            params.append(json.dumps(metadata))
        if not sets:
            return
        sets.append("updated_at = ?")
        params.append(_now())
        params.append(session_id)
        await self._conn.execute(f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", params)
        await self._conn.commit()

    # ── voice profiles (speaker-ID) ──────────────────────────────────────────--
    async def save_voice_profile(self, *, name: str, embedding: list[float], num_samples: int) -> None:
        await self._conn.execute(
            "INSERT OR REPLACE INTO voice_profiles (name, embedding, num_samples, created_at)"
            " VALUES (?, ?, ?, ?)",
            (name, json.dumps(embedding), num_samples, _now()),
        )
        await self._conn.commit()

    async def list_voice_profiles(self, *, with_embedding: bool = False) -> list[dict[str, Any]]:
        cur = await self._conn.execute(
            "SELECT name, embedding, num_samples, created_at FROM voice_profiles ORDER BY name ASC"
        )
        out: list[dict[str, Any]] = []
        for row in await cur.fetchall():
            item: dict[str, Any] = {
                "name": row["name"],
                "num_samples": row["num_samples"],
                "created_at": row["created_at"],
            }
            if with_embedding:
                item["embedding"] = json.loads(row["embedding"])
            out.append(item)
        return out

    async def delete_voice_profile(self, name: str) -> None:
        await self._conn.execute("DELETE FROM voice_profiles WHERE name = ?", (name,))
        await self._conn.commit()
