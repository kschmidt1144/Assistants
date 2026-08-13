"""Practice console — a GUI→CLI action bridge for the /practice skill.

The browser page at /practice-console shows buttons (drill topic, pause, retry, generate…).
Clicks append actions to a queue file; a Claude Code session running the /practice skill polls
GET /api/practice/pending at every question boundary, obeys, and POSTs /api/practice/consume so
the page can show "picked up". Files live next to the interview packs (jobsearch repo), so the
queue survives backend restarts and the CLI can fall back to reading the files directly.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from interview import PACKS_DIR
from pydantic import BaseModel

practice_router = APIRouter()

PRACTICE_DIR = PACKS_DIR.parent / "practice"
QUEUE = PRACTICE_DIR / "queue.jsonl"
ACTION_LOG = PRACTICE_DIR / "actions-log.jsonl"
STATE = PRACTICE_DIR / "state.json"

ACTIONS = {
    "drill", "pause", "resume", "skip", "retry_current", "retry_flagged",
    "gen", "status", "report", "push_deck", "stop",
}


def _read_jsonl(path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


class ActionReq(BaseModel):
    action: str
    arg: str | None = None


@practice_router.post("/api/practice/action")
def post_action(req: ActionReq) -> dict[str, str]:
    if req.action not in ACTIONS:
        raise HTTPException(400, f"unknown action {req.action!r} (known: {sorted(ACTIONS)})")
    entry = {
        "id": uuid.uuid4().hex[:8],
        "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "action": req.action,
        "arg": req.arg,
    }
    PRACTICE_DIR.mkdir(parents=True, exist_ok=True)
    with QUEUE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")
    return {"id": entry["id"]}


@practice_router.get("/api/practice/pending")
def pending() -> dict[str, list[dict[str, Any]]]:
    return {"pending": _read_jsonl(QUEUE), "recent": _read_jsonl(ACTION_LOG)[-10:]}


class ConsumeReq(BaseModel):
    ids: list[str]


@practice_router.post("/api/practice/consume")
def consume(req: ConsumeReq) -> dict[str, int]:
    """Called by the CLI skill after acting: moves queue entries to the ack log."""
    entries = _read_jsonl(QUEUE)
    taken = [e for e in entries if e["id"] in set(req.ids)]
    left = [e for e in entries if e["id"] not in set(req.ids)]
    ack = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    PRACTICE_DIR.mkdir(parents=True, exist_ok=True)
    with ACTION_LOG.open("a", encoding="utf-8") as fh:
        for e in taken:
            fh.write(json.dumps({**e, "acked": ack}) + "\n")
    QUEUE.write_text("".join(json.dumps(e) + "\n" for e in left), encoding="utf-8")
    return {"consumed": len(taken), "pending": len(left)}


@practice_router.get("/api/practice/state")
def state() -> dict[str, Any]:
    if not STATE.exists():
        return {"bank": [], "session": None}
    return json.loads(STATE.read_text(encoding="utf-8"))


@practice_router.get("/practice-console")
def console() -> HTMLResponse:
    return HTMLResponse(CONSOLE_HTML)


CONSOLE_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Practice Console</title>
<style>
  body { font: 14px/1.5 -apple-system, sans-serif; background: #0d1017; color: #e6e8ee;
         max-width: 760px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
       color: #8b93a7; margin: 22px 0 8px; }
  button { background: #1a2030; color: #e6e8ee; border: 1px solid #2c3548; border-radius: 8px;
           padding: 8px 14px; margin: 0 6px 6px 0; cursor: pointer; font-size: 13px; }
  button:hover { background: #232c42; }
  button.warn { border-color: #7a4a1d; } button.go { border-color: #2d6a4f; }
  input { background: #12161f; color: #e6e8ee; border: 1px solid #2c3548; border-radius: 8px;
          padding: 8px 10px; width: 320px; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .item { padding: 4px 0; border-bottom: 1px solid #1a2030; font-size: 12.5px; color: #aab2c5; }
  .item b { color: #e6e8ee; } .pend { color: #f4b942; } .ack { color: #58c08c; }
  #note { color: #8b93a7; font-size: 12px; margin-top: 4px; }
</style></head><body>
<h1>🎛 Practice Console</h1>
<p id="note">Buttons queue actions for the Claude CLI session running <b>/practice</b>.
Actions are picked up at the next question boundary — watch the log below for the ✓.</p>

<h2>Session</h2>
<div class="row">
  <button class="warn" onclick="act('pause')">⏸ Pause</button>
  <button class="go" onclick="act('resume')">▶ Resume</button>
  <button onclick="act('skip')">⏭ Skip question</button>
  <button onclick="act('retry_current')">🔁 Retry this question</button>
  <button onclick="act('retry_flagged')">🚩 Drill flagged items</button>
  <button onclick="act('status')">📊 Status</button>
  <button onclick="act('report')">📝 Rollup report</button>
  <button class="warn" onclick="act('stop')">⏹ Stop session</button>
</div>

<h2>Drill a topic</h2>
<div class="row" id="topics">loading…</div>

<h2>Generate new items</h2>
<div class="row">
  <input id="genarg" placeholder="e.g. 10 questions on Spring Boot basics">
  <button class="go" onclick="act('gen', document.getElementById('genarg').value)">✨ Generate</button>
  <button onclick="act('push_deck', document.getElementById('genarg').value)">📱 Push as flashcard deck</button>
</div>

<h2>Action log</h2>
<div id="log">—</div>

<script>
async function act(action, arg) {
  await fetch('/api/practice/action', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, arg: arg || null }) });
  poll();
}
async function poll() {
  try {
    const p = await (await fetch('/api/practice/pending')).json();
    const rows = [
      ...p.pending.map(e => `<div class="item pend">⧗ <b>${e.action}</b> ${e.arg || ''} <span>${e.ts}</span> — waiting for CLI</div>`),
      ...p.recent.slice().reverse().map(e => `<div class="item ack">✓ <b>${e.action}</b> ${e.arg || ''} <span>${e.acked}</span></div>`),
    ];
    document.getElementById('log').innerHTML = rows.join('') || '—';
  } catch (e) { document.getElementById('log').textContent = 'backend unreachable'; }
}
async function topics() {
  try {
    const s = await (await fetch('/api/practice/state')).json();
    const names = [...new Set((s.bank || []).map(i => i.topic))];
    const counts = {};
    (s.bank || []).forEach(i => { counts[i.topic] = (counts[i.topic] || 0) + 1; });
    document.getElementById('topics').innerHTML = names.map(t =>
      `<button onclick="act('drill', '${t.replace(/'/g, "\\\\'")}')">${t} <small>(${counts[t]})</small></button>`
    ).join('') || 'no bank yet — run /practice once to seed it';
  } catch (e) { document.getElementById('topics').textContent = 'backend unreachable'; }
}
topics(); poll(); setInterval(poll, 2000);
</script></body></html>"""
