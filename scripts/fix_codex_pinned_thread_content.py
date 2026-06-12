#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser()
GLOBAL_STATE_PATH = CODEX_HOME / ".codex-global-state.json"
STATE_DB_PATH = CODEX_HOME / "state_5.sqlite"


@dataclass
class ThreadFixResult:
    thread_id: str
    rollout_path: Path | None
    changed_lines: int = 0
    cleared_reasoning_lines: int = 0
    skipped_multimodal_lines: int = 0
    parse_errors: int = 0
    backup_path: Path | None = None
    note: str = ""


def load_pinned_thread_ids() -> list[str]:
    payload = json.loads(GLOBAL_STATE_PATH.read_text(encoding="utf-8"))
    thread_ids = payload.get("pinned-thread-ids", [])
    if not isinstance(thread_ids, list):
        return []
    return [str(item).strip() for item in thread_ids if str(item).strip()]


def load_rollout_paths(thread_ids: list[str]) -> dict[str, Path | None]:
    if not thread_ids:
        return {}
    conn = sqlite3.connect(STATE_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        placeholders = ",".join("?" for _ in thread_ids)
        rows = conn.execute(
            f"SELECT id, rollout_path FROM threads WHERE id IN ({placeholders})",
            thread_ids,
        ).fetchall()
    finally:
        conn.close()

    by_id = {str(row["id"]): row for row in rows}
    resolved: dict[str, Path | None] = {}
    for thread_id in thread_ids:
        row = by_id.get(thread_id)
        rollout_path = str(row["rollout_path"] or "").strip() if row else ""
        resolved[thread_id] = Path(os.path.expanduser(rollout_path)) if rollout_path else None
    return resolved


def load_rollouts_from_session_dir(session_dir: Path) -> dict[str, Path | None]:
    resolved: dict[str, Path | None] = {}
    for path in sorted(session_dir.glob("rollout-*.jsonl")):
        thread_id = path.stem.split("-")[-1]
        resolved[thread_id] = path
    return resolved


def normalize_text_content(content: list[Any]) -> str | None:
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            return None
        item_type = str(item.get("type") or "").strip()
        if item_type not in {"input_text", "output_text", "text"}:
            return None
        parts.append(str(item.get("text") or ""))
    return "".join(parts)


def should_fix_response_item(obj: dict[str, Any]) -> tuple[bool, str | None]:
    if obj.get("type") != "response_item":
        return False, None
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        return False, None
    if payload.get("type") != "message":
        return False, None
    content = payload.get("content")
    if not isinstance(content, list):
        return False, None
    normalized = normalize_text_content(content)
    if normalized is None:
        return False, None
    return True, normalized


def should_clear_reasoning_content(obj: dict[str, Any]) -> bool:
    if obj.get("type") != "response_item":
        return False
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        return False
    if payload.get("type") != "reasoning":
        return False
    content = payload.get("content")
    if not isinstance(content, list) or not content:
        return False
    for item in content:
        if not isinstance(item, dict):
            return False
        if str(item.get("type") or "").strip() != "reasoning_text":
            return False
    return True


def backup_file(path: Path, *, stamp: str) -> Path:
    backup_path = path.with_name(f"{path.name}.pre-{stamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


def fix_rollout_file(thread_id: str, rollout_path: Path | None, *, write: bool, stamp: str) -> ThreadFixResult:
    result = ThreadFixResult(thread_id=thread_id, rollout_path=rollout_path)
    if rollout_path is None:
        result.note = "missing_rollout_path"
        return result
    if not rollout_path.exists():
        result.note = "rollout_file_missing"
        return result

    original_lines = rollout_path.read_text(encoding="utf-8").splitlines()
    rewritten_lines: list[str] = []

    for line in original_lines:
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            result.parse_errors += 1
            rewritten_lines.append(line)
            continue

        should_fix, normalized = should_fix_response_item(obj)
        if should_fix and normalized is not None:
            payload = obj["payload"]
            payload["content"] = normalized
            rewritten_lines.append(json.dumps(obj, ensure_ascii=False))
            result.changed_lines += 1
            continue

        if should_clear_reasoning_content(obj):
            payload = obj["payload"]
            payload["content"] = []
            rewritten_lines.append(json.dumps(obj, ensure_ascii=False))
            result.changed_lines += 1
            result.cleared_reasoning_lines += 1
            continue

        if (
            obj.get("type") == "response_item"
            and isinstance(obj.get("payload"), dict)
            and obj["payload"].get("type") == "message"
            and isinstance(obj["payload"].get("content"), list)
        ):
            result.skipped_multimodal_lines += 1

        rewritten_lines.append(json.dumps(obj, ensure_ascii=False))

    if write and result.changed_lines > 0:
        result.backup_path = backup_file(rollout_path, stamp=stamp)
        rollout_path.write_text("\n".join(rewritten_lines) + "\n", encoding="utf-8")
        result.note = "updated"
    elif result.changed_lines > 0:
        result.note = "dry_run_changes_detected"
    else:
        result.note = "no_text_array_changes"
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="修复 Codex pinned threads rollout 中的纯文本 user.content 数组，恢复为字符串。",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="实际写回文件；默认只做 dry-run。",
    )
    parser.add_argument(
        "--thread-id",
        action="append",
        default=[],
        help="只修指定 thread id，可重复传入。",
    )
    parser.add_argument(
        "--session-dir",
        default="",
        help="直接扫描指定会话目录下的 rollout-*.jsonl，而不是只读 pinned threads。",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="持续轮询并自动修复命中的 rollout 文件。",
    )
    parser.add_argument(
        "--interval-seconds",
        type=float,
        default=2.0,
        help="watch 模式轮询间隔秒数，默认 2 秒。",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=0,
        help="watch 模式最多执行多少轮；0 表示无限循环。",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="输出紧凑单行 JSON，适合 watch 日志。",
    )
    return parser


def collect_rollout_paths(args: argparse.Namespace) -> tuple[list[str], dict[str, Path | None]]:
    if args.session_dir:
        session_dir = Path(args.session_dir).expanduser()
        rollout_paths = load_rollouts_from_session_dir(session_dir)
        thread_ids = list(rollout_paths.keys())
    else:
        thread_ids = [item.strip() for item in args.thread_id if item.strip()] or load_pinned_thread_ids()
        rollout_paths = load_rollout_paths(thread_ids)
    return thread_ids, rollout_paths


def build_summary(args: argparse.Namespace, results: list[ThreadFixResult]) -> dict[str, Any]:
    return {
        "codexHome": str(CODEX_HOME),
        "write": bool(args.write),
        "watch": bool(args.watch),
        "threadCount": len(results),
        "changedThreadCount": sum(1 for item in results if item.changed_lines > 0),
        "changedLineCount": sum(item.changed_lines for item in results),
        "skippedMultimodalLineCount": sum(item.skipped_multimodal_lines for item in results),
        "parseErrorCount": sum(item.parse_errors for item in results),
        "results": [
            {
                "threadId": item.thread_id,
                "rolloutPath": str(item.rollout_path) if item.rollout_path else "",
                "changedLines": item.changed_lines,
                "clearedReasoningLines": item.cleared_reasoning_lines,
                "skippedMultimodalLines": item.skipped_multimodal_lines,
                "parseErrors": item.parse_errors,
                "backupPath": str(item.backup_path) if item.backup_path else "",
                "note": item.note,
            }
            for item in results
        ],
    }


def print_summary(summary: dict[str, Any], *, compact: bool) -> None:
    if compact:
        print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
        return
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def run_once(args: argparse.Namespace) -> dict[str, Any]:
    stamp = datetime.now().strftime("%Y-%m-%d-codex-pinned-content-fix")
    thread_ids, rollout_paths = collect_rollout_paths(args)
    results = [
        fix_rollout_file(thread_id, rollout_paths.get(thread_id), write=args.write, stamp=stamp)
        for thread_id in thread_ids
    ]
    return build_summary(args, results)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.watch:
        print_summary(run_once(args), compact=args.compact)
        return 0

    iteration = 0
    while True:
        iteration += 1
        summary = run_once(args)
        summary["iteration"] = iteration
        summary["timestamp"] = datetime.now().isoformat(timespec="seconds")
        if iteration == 1 or summary["changedLineCount"] > 0 or summary["parseErrorCount"] > 0:
            print_summary(summary, compact=args.compact)
        if args.max_iterations > 0 and iteration >= args.max_iterations:
            break
        time.sleep(max(args.interval_seconds, 0.2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
