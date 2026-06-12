#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path("/private/tmp/xhey_web_folder_cli")
REPORT_DIR = Path("/Volumes/TianLu_Storage/Shared/今日水印相机/reports")
REGISTRY_FILE = REPORT_DIR / "xhey-web-folder-cli-registry.json"
DEFAULT_MIN_DATE = "2026-06-06"
SYNC_SCRIPT = PROJECT_ROOT / "scripts" / "xhey_integration" / "xhey_web_folder_cli.py"
WATERMARK_SCRIPT = PROJECT_ROOT / "scripts" / "watermark_camera_sync.py"
REPAIR_SCRIPT = PROJECT_ROOT / "scripts" / "repair_education_service_filtered_records.py"
TARGET_DIR_KEYWORDS = ("lijianding-", "liangwei-", "guochenchen-", "xhey_cli_real_batch_")


def now_cn() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat()


def find_source_dirs(source_root: Path) -> list[Path]:
    if not source_root.exists():
        return []
    results = []
    for entry in sorted(source_root.iterdir()):
        if not entry.is_dir():
            continue
        if any(entry.name.startswith(prefix) for prefix in TARGET_DIR_KEYWORDS):
            results.append(entry)
    return results


def resolve_source_inputs(source_root: Path, explicit_source_dirs: list[str]) -> list[Path]:
    if explicit_source_dirs:
        resolved: list[Path] = []
        for value in explicit_source_dirs:
            path = Path(value).expanduser()
            resolved.append(path.resolve() if path.exists() else path)
        return resolved
    return find_source_dirs(source_root)


def post_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def run_subprocess(cmd: list[str], cwd: Path) -> tuple[int, str, str]:
    env = os.environ.copy()
    env["XHEY_DRY_RUN"] = "false"
    completed = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, env=env)
    return completed.returncode, completed.stdout, completed.stderr


def main() -> None:
    parser = argparse.ArgumentParser(description="教育补 CLI 主链批量同步")
    parser.add_argument("--source-root", default=str(SOURCE_ROOT), help="网页分类文件夹解压根目录")
    parser.add_argument("--source-dir", action="append", default=[], help="单个今日相册目录或 ZIP，可重复传入")
    parser.add_argument("--report-dir", default=str(REPORT_DIR), help="报告目录")
    parser.add_argument("--registry-file", default=str(REGISTRY_FILE), help="CLI 去重注册表")
    parser.add_argument("--min-date", default=DEFAULT_MIN_DATE, help="最小日期 YYYY-MM-DD")
    parser.add_argument("--max-date", default="", help="最大日期 YYYY-MM-DD")
    parser.add_argument("--max-files-per-dir", type=int, default=0, help="每个目录最多处理多少张")
    parser.add_argument("--skip-watermark-incoming", action="store_true", help="跳过 incoming 目录同步")
    parser.add_argument("--api-base", default="http://127.0.0.1:8000", help="本地 API 地址")
    args = parser.parse_args()

    source_root = Path(args.source_root).expanduser().resolve()
    report_dir = Path(args.report_dir).expanduser().resolve()
    registry_file = Path(args.registry_file).expanduser().resolve()
    report_dir.mkdir(parents=True, exist_ok=True)

    aggregate: dict[str, Any] = {
        "startedAt": now_cn(),
        "sourceRoot": str(source_root),
        "reportDir": str(report_dir),
        "registryFile": str(registry_file),
        "directories": [],
        "watermarkIncoming": None,
        "projectionSync": None,
        "workbench": None,
    }
    failed_steps: list[str] = []

    if not args.skip_watermark_incoming:
        incoming_cmd = [sys.executable, str(WATERMARK_SCRIPT), "--once"]
        code, stdout, stderr = run_subprocess(incoming_cmd, PROJECT_ROOT)
        aggregate["watermarkIncoming"] = {
            "command": incoming_cmd,
            "exitCode": code,
            "stdoutTail": stdout[-1200:],
            "stderrTail": stderr[-1200:],
        }
        if code != 0:
            failed_steps.append("watermarkIncoming")

    source_inputs = resolve_source_inputs(source_root, list(args.source_dir or []))
    aggregate["explicitSourceInputs"] = [str(item) for item in source_inputs]

    for source_input in source_inputs:
        cmd = [
            sys.executable,
            str(SYNC_SCRIPT),
            "--report-dir",
            str(report_dir),
            "--registry-file",
            str(registry_file),
            "--min-date",
            args.min_date,
        ]
        if source_input.suffix.lower() == ".zip":
            cmd.extend(["--zip-path", str(source_input)])
        else:
            cmd.extend(["--directory", str(source_input)])
        if args.max_date:
            cmd.extend(["--max-date", args.max_date])
        if args.max_files_per_dir > 0:
            cmd.extend(["--max-files", str(args.max_files_per_dir)])
        code, stdout, stderr = run_subprocess(cmd, PROJECT_ROOT)
        parsed: dict[str, Any] | None = None
        for line in stdout.splitlines():
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                try:
                    parsed = json.loads(line)
                except Exception:
                    parsed = None
        aggregate["directories"].append(
            {
                "directory": str(source_input),
                "command": cmd,
                "exitCode": code,
                "summary": parsed,
                "stdoutTail": stdout[-1500:],
                "stderrTail": stderr[-1200:],
            }
        )
        if code != 0:
            failed_steps.append(f"directory:{source_input}")

    repair_cmd = [sys.executable, str(REPAIR_SCRIPT)]
    code, stdout, stderr = run_subprocess(repair_cmd, PROJECT_ROOT)
    aggregate["postRepair"] = {
        "command": repair_cmd,
        "exitCode": code,
        "stdoutTail": stdout[-4000:],
        "stderrTail": stderr[-1200:],
    }
    if code != 0:
        failed_steps.append("postRepair")
    aggregate["failedSteps"] = failed_steps
    if not failed_steps:
        aggregate["projectionSync"] = post_json(f"{args.api_base}/api/education-scan/v2/sync-to-projection")
        aggregate["workbench"] = get_json(f"{args.api_base}/api/education-collection/workbench?since_date={args.min_date}&recent_limit=20")
    aggregate["finishedAt"] = now_cn()

    report_path = report_dir / f"education-subsidy-cli-sync-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(aggregate, ensure_ascii=False, indent=2))
    print(json.dumps(aggregate, ensure_ascii=False, indent=2))
    print(f"\nreport: {report_path}")
    if failed_steps:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
