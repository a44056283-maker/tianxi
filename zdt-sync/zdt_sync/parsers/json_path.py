from __future__ import annotations

from typing import Any


def extract_json_path(payload: Any, path: str | None) -> Any:
    """Very small dot-path extractor: 'data.records' -> payload['data']['records']."""
    if not path:
        return payload
    current = payload
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current
