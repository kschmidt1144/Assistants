"""install_cors keeps CORS headers on unhandled-exception 500s (else the browser sees only a
generic "Failed to fetch" because the 500 from ServerErrorMiddleware has no CORS header)."""

from __future__ import annotations

from assistants_core import install_cors
from fastapi import FastAPI
from fastapi.testclient import TestClient

ORIGIN = "http://localhost:5173"


def _app() -> FastAPI:
    app = FastAPI()
    install_cors(app, [ORIGIN])

    @app.get("/boom")
    def boom() -> dict[str, str]:
        raise RuntimeError("kaboom")

    @app.get("/ok")
    def ok() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_unhandled_500_keeps_cors_header():
    # raise_server_exceptions=False so we observe the actual 500 response (not the re-raised exc).
    client = TestClient(_app(), raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": ORIGIN})
    assert resp.status_code == 500
    assert resp.headers["access-control-allow-origin"] == ORIGIN
    assert "kaboom" in resp.json()["detail"]  # the real cause is surfaced, not swallowed


def test_500_omits_cors_for_disallowed_origin():
    client = TestClient(_app(), raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://evil.test"})
    assert resp.status_code == 500
    assert "access-control-allow-origin" not in resp.headers


def test_normal_response_still_has_cors():
    client = TestClient(_app(), raise_server_exceptions=False)
    resp = client.get("/ok", headers={"Origin": ORIGIN})
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == ORIGIN
