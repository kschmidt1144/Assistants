"""Shared FastAPI wiring for the app backends.

`install_cors` adds the usual `CORSMiddleware` **and** a fallback exception handler that keeps the
CORS headers on otherwise-unhandled 500s.

Why the handler matters: an unhandled exception is turned into a 500 by Starlette's
`ServerErrorMiddleware`, which sits *outside* `CORSMiddleware` in the stack — so that 500 carries no
`Access-Control-Allow-Origin` header. The browser then blocks the response and surfaces an opaque
`TypeError: Failed to fetch` instead of the real error. Registering an `Exception` handler runs at the
`ServerErrorMiddleware` layer (where CORS can't reach it), so we mirror the app's origin allowlist and
set the header ourselves. `ServerErrorMiddleware` still re-raises afterwards, so the full traceback is
logged by the server as usual.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


def _cors_headers(origin: str | None, allow_origins: Sequence[str]) -> dict[str, str]:
    """The CORS response headers for `origin` given the allowlist (mirrors CORSMiddleware)."""
    if not origin:
        return {}
    if "*" in allow_origins:
        return {"access-control-allow-origin": "*"}
    if origin in allow_origins:
        return {"access-control-allow-origin": origin, "vary": "Origin"}
    return {}


def install_cors(
    app: FastAPI,
    origins: Sequence[str],
    *,
    allow_methods: Sequence[str] = ("*",),
    allow_headers: Sequence[str] = ("*",),
) -> None:
    """Scope CORS to `origins`, and keep those headers on unhandled-exception 500s."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_methods=list(allow_methods),
        allow_headers=list(allow_headers),
    )

    @app.exception_handler(Exception)
    async def _cors_safe_500(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            {"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
            status_code=500,
            headers=_cors_headers(request.headers.get("origin"), origins),
        )
