#!/usr/bin/env python3
from __future__ import annotations

import json
import time
import tomllib
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_PATH = PROJECT_ROOT.parent / "automation_payloads.json"
AUTOMATION_ROOT = Path.home() / ".codex" / "automations"


def format_toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        text = f"{value}"
        return text
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        if not value:
            return "[]"
        lines = ["["]
        for item in value:
            lines.append(f"  {format_toml_value(item)},")
        lines.append("]")
        return "\n".join(lines)
    raise TypeError(f"unsupported TOML value: {type(value)!r}")


def build_toml(entry: dict[str, Any]) -> str:
    timestamp_ms = int(time.time() * 1000)
    ordered_keys = [
        ("version", 1),
        ("id", entry["id"]),
        ("kind", entry["kind"]),
        ("name", entry["name"]),
        ("prompt", entry["prompt"]),
        ("status", entry.get("status", "ACTIVE")),
        ("rrule", entry["rrule"]),
        ("model", entry.get("model", "gpt-5.3-codex")),
        ("reasoning_effort", entry.get("reasoningEffort", entry.get("reasoning_effort", "low"))),
        ("execution_environment", entry.get("executionEnvironment", entry.get("execution_environment", "local"))),
        ("cwds", entry.get("cwds", [])),
        ("created_at", entry.get("created_at", timestamp_ms)),
        ("updated_at", entry.get("updated_at", timestamp_ms)),
    ]
    return "\n".join(f"{key} = {format_toml_value(value)}" for key, value in ordered_keys) + "\n"


def main() -> int:
    payload = json.loads(PAYLOAD_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
      raise SystemExit("automation_payloads.json is not a list")
    written = 0
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        automation_id = str(entry.get("id") or "").strip()
        if not automation_id:
            continue
        target_dir = AUTOMATION_ROOT / automation_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / "automation.toml"
        target_file.write_text(build_toml(entry), encoding="utf-8")
        tomllib.loads(target_file.read_text(encoding="utf-8"))
        written += 1
    print(json.dumps({
        "ok": True,
        "payloadCount": len(payload),
        "writtenCount": written,
        "automationRoot": str(AUTOMATION_ROOT),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
