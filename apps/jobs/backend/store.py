"""Local SQLite store for the Job Application Assistant (applications + master profile).

App-local (own tables) so the core stays domain-agnostic. Same style as core `Database`.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from typing import Any

STATUSES = ["New", "Interested", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS applications (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  company         TEXT,
  location        TEXT,
  url             TEXT,
  jd_text         TEXT,
  parsed_data     TEXT,
  status          TEXT NOT NULL,
  status_history  TEXT,
  notes           TEXT,
  created_at      REAL NOT NULL,
  updated_at      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  text        TEXT NOT NULL,
  updated_at  REAL NOT NULL
);
"""


def _now() -> float:
    return time.time()


def _app_id(url: str | None) -> str:
    if url:
        return hashlib.md5(url.encode()).hexdigest()
    return uuid.uuid4().hex


class JobsStore:
    def __init__(self, path: str) -> None:
        self.path = path
        self._conn: Any = None

    async def connect(self) -> JobsStore:
        import aiosqlite

        if self.path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()
        return self

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        d = dict(row)
        d["parsed_data"] = json.loads(d["parsed_data"]) if d.get("parsed_data") else None
        d["status_history"] = json.loads(d["status_history"]) if d.get("status_history") else []
        return d

    # ── applications ──────────────────────────────────────────────────────────
    async def upsert_application(
        self,
        *,
        title: str | None,
        company: str | None,
        url: str | None = None,
        location: str | None = None,
        jd_text: str | None = None,
        parsed_data: dict[str, Any] | None = None,
        status: str = "New",
    ) -> dict[str, Any]:
        aid = _app_id(url)
        existing = await self.get_application(aid)
        now = _now()
        if existing:  # dedup by url-derived id: refresh fields, keep status/history
            await self._conn.execute(
                "UPDATE applications SET title=?, company=?, location=?, jd_text=?, parsed_data=?, updated_at=?"
                " WHERE id=?",
                (title, company, location, jd_text, json.dumps(parsed_data) if parsed_data else None, now, aid),
            )
        else:
            history = [{"status": status, "date": now}]
            await self._conn.execute(
                "INSERT INTO applications (id, title, company, location, url, jd_text, parsed_data,"
                " status, status_history, notes, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (aid, title, company, location, url, jd_text,
                 json.dumps(parsed_data) if parsed_data else None,
                 status, json.dumps(history), "", now, now),
            )
        await self._conn.commit()
        result = await self.get_application(aid)
        assert result is not None
        return result

    async def get_application(self, app_id: str) -> dict[str, Any] | None:
        cur = await self._conn.execute("SELECT * FROM applications WHERE id=?", (app_id,))
        row = await cur.fetchone()
        return self._row(row) if row else None

    async def list_applications(self, *, status: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM applications"
        clauses, params = [], []
        if status:
            clauses.append("status=?")
            params.append(status)
        if query:
            clauses.append("(title LIKE ? OR company LIKE ?)")
            params.extend([f"%{query}%", f"%{query}%"])
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC"
        cur = await self._conn.execute(sql, params)
        return [self._row(r) for r in await cur.fetchall()]

    async def update_application(
        self, app_id: str, *, status: str | None = None, notes: str | None = None
    ) -> dict[str, Any] | None:
        app = await self.get_application(app_id)
        if not app:
            return None
        now = _now()
        if status and status != app["status"]:
            history = app["status_history"]
            history.append({"status": status, "date": now})
            await self._conn.execute(
                "UPDATE applications SET status=?, status_history=?, updated_at=? WHERE id=?",
                (status, json.dumps(history), now, app_id),
            )
        if notes is not None:
            await self._conn.execute(
                "UPDATE applications SET notes=?, updated_at=? WHERE id=?", (notes, now, app_id)
            )
        await self._conn.commit()
        return await self.get_application(app_id)

    async def delete_application(self, app_id: str) -> None:
        await self._conn.execute("DELETE FROM applications WHERE id=?", (app_id,))
        await self._conn.commit()

    async def stats(self) -> dict[str, int]:
        cur = await self._conn.execute("SELECT status, COUNT(*) c FROM applications GROUP BY status")
        return {row["status"]: row["c"] for row in await cur.fetchall()}

    # ── master profile (one row) ──────────────────────────────────────────────
    async def set_profile(self, text: str) -> None:
        await self._conn.execute(
            "INSERT INTO profile (id, text, updated_at) VALUES (1, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
            (text, _now()),
        )
        await self._conn.commit()

    async def get_profile(self) -> str:
        cur = await self._conn.execute("SELECT text FROM profile WHERE id=1")
        row = await cur.fetchone()
        return row["text"] if row else ""
