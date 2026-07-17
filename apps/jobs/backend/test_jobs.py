import io
from unittest.mock import AsyncMock

import main
import pytest
from assistants_core import get_settings
from fastapi.testclient import TestClient
from store import JobsStore


@pytest.fixture
def client(monkeypatch, tmp_path):
    import assistants_core.config

    monkeypatch.setattr(assistants_core.config, "_find_dotenv", lambda: None)
    get_settings.cache_clear()

    import os
    if "ANTHROPIC_API_KEY" in os.environ:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    db_path = str(tmp_path / "jobs.db")
    fake_settings = get_settings()
    fake_settings.db_path = db_path
    monkeypatch.setattr(main, "get_settings", lambda: fake_settings)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_lifespan(app):
        store = await JobsStore(db_path).connect()
        main._state["store"] = store
        try:
            yield
        finally:
            await store.close()

    main.app.router.lifespan_context = fake_lifespan

    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def mock_claude(monkeypatch):
    mock_reason = AsyncMock(return_value="mocked answer")
    monkeypatch.setattr(main.router.claude, "reason", mock_reason)

    mock_reason_structured = AsyncMock(return_value={"parsed": True})
    monkeypatch.setattr(main.router.claude, "reason_structured", mock_reason_structured)

    return mock_reason, mock_reason_structured


def test_tracker_crud(client):
    # JOB-I-04
    res = client.post("/api/applications", json={"title": "SWE", "company": "Acme"})
    assert res.status_code == 200
    app_id = res.json()["id"]

    res = client.get(f"/api/applications/{app_id}")
    assert res.status_code == 200
    assert res.json()["title"] == "SWE"
    assert res.json()["company"] == "Acme"

    res = client.get("/api/applications")
    assert res.status_code == 200
    assert len(res.json()) >= 1

    # JOB-I-05 (K4 fixed): a bogus status is rejected with 422, not persisted.
    res = client.put(f"/api/applications/{app_id}", json={"status": "Bogus", "notes": "note"})
    assert res.status_code == 422
    assert client.get(f"/api/applications/{app_id}").json()["status"] == "New"

    # A known status still updates fine (and notes alongside it).
    res = client.put(f"/api/applications/{app_id}", json={"status": "Applied", "notes": "sent"})
    assert res.status_code == 200
    assert res.json()["status"] == "Applied"
    assert res.json()["notes"] == "sent"

    res = client.delete(f"/api/applications/{app_id}")
    assert res.status_code == 200

    res = client.get(f"/api/applications/{app_id}")
    assert res.status_code == 404


def test_profile(client, monkeypatch):
    # JOB-I-06: Profile master text
    res = client.get("/api/profile")
    assert res.status_code == 200
    assert res.json()["text"] == ""

    res = client.post("/api/profile", json={"text": "I am a dev."})
    assert res.status_code == 200

    res = client.get("/api/profile")
    assert res.json()["text"] == "I am a dev."

    # JOB-I-07 / K5: upload error translation.
    def fake_parse(data, filename):
        if filename.endswith(".xyz"):
            raise ValueError("Unsupported document type: .xyz")  # unsupported ext → ValueError
        if filename.endswith(".pdf") and b"corrupt" in data:
            raise RuntimeError("PdfReadError: EOF marker not found")  # pypdf-style failure
        return "parsed text"

    monkeypatch.setattr(main, "parse_document", fake_parse)

    # Valid upload
    file_bytes = io.BytesIO(b"hello world")
    res = client.post("/api/profile/upload", files={"file": ("resume.txt", file_bytes, "text/plain")})
    assert res.status_code == 200
    assert client.get("/api/profile").json()["text"] == "parsed text"

    # Unsupported extension → 400 (ValueError path).
    file_bytes = io.BytesIO(b"data")
    res = client.post("/api/profile/upload", files={"file": ("resume.xyz", file_bytes, "application/octet-stream")})
    assert res.status_code == 400

    # K5 fixed: a corrupt PDF raises a non-ValueError (pypdf) → 400, not 500.
    file_bytes = io.BytesIO(b"corrupt data")
    res = client.post("/api/profile/upload", files={"file": ("resume.pdf", file_bytes, "application/pdf")})
    assert res.status_code == 400
    assert "could not parse" in res.json()["detail"]

    # Empty file → 400.
    res = client.post("/api/profile/upload", files={"file": ("resume.txt", io.BytesIO(b""), "text/plain")})
    assert res.status_code == 400

    # Oversized file → 413 (guard runs before parsing).
    big = io.BytesIO(b"x" * (main.MAX_UPLOAD_BYTES + 1))
    res = client.post("/api/profile/upload", files={"file": ("resume.txt", big, "text/plain")})
    assert res.status_code == 413


def test_ai_endpoints(client, mock_claude, monkeypatch):
    mock_reason, mock_reason_structured = mock_claude

    # JOB-I-08: /api/parse-jd missing key -> 400
    res = client.post("/api/parse-jd", json={"jd_text": "Need a dev"})
    assert res.status_code == 400

    fake_settings = get_settings()
    fake_settings.anthropic_api_key = "test"
    monkeypatch.setattr(main, "get_settings", lambda: fake_settings)

    res = client.post("/api/parse-jd", json={"jd_text": "Need a dev"})
    assert res.status_code == 200
    assert res.json() == {"parsed": True}

    # JOB-I-09: /api/tailor no profile -> 400
    client.post("/api/profile", json={"text": ""})  # empty profile
    res = client.post("/api/tailor", json={"jd_text": "Need dev"})
    assert res.status_code == 400
    assert "profile/resume first" in res.json()["detail"]

    # Valid profile
    client.post("/api/profile", json={"text": "I am a dev."})
    
    # Needs to mock tailor_and_score to avoid deep Claude calls in tests,
    # or just let it use mock_claude. But tailor_and_score is imported directly.
    # Let's mock main.tailor_and_score
    mock_tailor = AsyncMock(return_value={"tailored": "yes"})
    monkeypatch.setattr(main, "tailor_and_score", mock_tailor)

    res = client.post("/api/tailor", json={"jd_text": "Need dev"})
    assert res.status_code == 200
    assert res.json() == {"tailored": "yes"}

    # JOB-I-10: Unified Resume endpoint
    # Create apps with JDs
    res1 = client.post("/api/applications", json={"title": "App 1", "jd_text": "Job 1"})
    res2 = client.post("/api/applications", json={"title": "App 2", "jd_text": "Job 2"})
    id1 = res1.json()["id"]
    id2 = res2.json()["id"]

    res = client.post("/api/unified-resume", json={"application_ids": [id1, id2]})
    assert res.status_code == 200
    assert res.json() == {"tailored": "yes"}
    
    # Unified with no JDs
    res3 = client.post("/api/applications", json={"title": "App 3"})
    id3 = res3.json()["id"]
    res = client.post("/api/unified-resume", json={"application_ids": [id3]})
    assert res.status_code == 400
    assert "no job descriptions" in res.json()["detail"]
