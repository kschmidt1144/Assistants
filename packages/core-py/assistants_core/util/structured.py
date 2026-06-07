"""Small helpers for building JSON Schemas for Claude structured outputs."""

from __future__ import annotations

from typing import Any


def object_schema(
    properties: dict[str, Any], *, required: list[str] | None = None, additional: bool = False
) -> dict[str, Any]:
    """Build an `object` JSON Schema. Defaults to all keys required, no extra properties.

    Structured outputs don't support every JSON Schema keyword (no min/max, length, etc.) — keep
    schemas to types, enums, arrays, and nested objects.
    """
    return {
        "type": "object",
        "properties": properties,
        "required": required if required is not None else list(properties.keys()),
        "additionalProperties": additional,
    }
