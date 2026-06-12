#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
APP_API_DIR = ROOT_DIR / "apps" / "api-server"
ARTIFACT_DIR = ROOT_DIR / "apps" / "inventory-sync" / "artifacts"
WEB_DATA_DIR = ROOT_DIR / "apps" / "web-cockpit" / "public" / "data"
RUNTIME_DIR = ROOT_DIR / ".automation-runtime"
STATE_PATH = RUNTIME_DIR / "scheduled-task-runner-state.json"
PID_LOCK_PATH = RUNTIME_DIR / "scheduled-task-runner.lock"
STATUS_PATH = ARTIFACT_DIR / "latest-scheduled-task-runner-status.json"
WEB_STATUS_PATH = WEB_DATA_DIR / "latest-scheduled-task-runner-status.json"
PAUSED_TASKS_PATH = ARTIFACT_DIR / "paused-scheduled-tasks.json"
TASK_SCRIPT = ROOT_DIR / "scripts" / "run_scheduled_task.sh"
RECOVERY_QUEUE_SCRIPT = ROOT_DIR / "scripts" / "build_morning_recovery_queue.py"
RECOVERY_QUEUE_PATH = ARTIFACT_DIR / "latest-morning-recovery-queue.json"
DASHBOARD_PATH = ARTIFACT_DIR / "latest-scheduled-task-dashboard.json"
REPORT_PATH = ARTIFACT_DIR / "latest-scheduled-task-reports.json"
POLL_SECONDS = 60
TRIGGER_WINDOW_MINUTES = 18
RETRYABLE_EXIT_CODES = {69, 75}
RUN_ONCE = os.environ.get("SCHEDULED_TASK_RUNNER_ONCE") == "1"
CATCHUP_IF_NO_RUN_TODAY = True
ZHIDIANTONG_TASK_NAME = "zhidiantong-sync-cycle"
SYNC_HEALTH_TASK_NAME = "sync-health-spot-check"

# All production scheduled tasks must continue to run. Browser or visible-input
# blockers are reported honestly by the task itself; they are no longer held
# outside the runner as watch-only tasks.
AUTO_MANAGED_TASKS: dict[str, list[str]] = {
    "zhidiantong-sync-cycle": [
        "11:15", "12:00", "12:45", "13:30", "14:15", "15:00", "15:45",
        "16:30", "17:15", "18:00", "19:00", "19:30", "20:15", "21:00", "21:45",
    ],
    "daily-price-channel-check": ["11:30", "13:45"],
    "daily-gray-channel-check": ["11:50", "13:50"],
    "daily-jd-lenovo-price-sync": [
        "10:00", "11:00", "12:00", "13:00", "14:00", "15:00",
        "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00",
    ],
    "sync-health-spot-check": [],
    "daily-competitor-monitor-check": ["04:00"],
    "sn-warranty-backfill": ["12:20", "15:20", "19:20"],
    "daily-stale-inventory-check": ["01:00"],
    "daily-development-plan-update": ["13:00"],
    "daily-audit-and-snapshot-rebuild": ["12:25", "15:25", "19:25", "21:30"],
}

TASK_RUN_PRIORITY: dict[str, int] = {
    "zhidiantong-sync-cycle": 10,
    "daily-audit-and-snapshot-rebuild": 20,
    "daily-price-channel-check": 30,
    "daily-gray-channel-check": 40,
    "daily-jd-lenovo-price-sync": 50,
    "sync-health-spot-check": 55,
    "sn-warranty-backfill": 60,
    "daily-competitor-monitor-check": 70,
    "daily-stale-inventory-check": 80,
    "daily-development-plan-update": 90,
}


def get_shanghai_now() -> datetime:
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Shanghai"))


def ensure_dirs() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def save_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_paused_task_names() -> set[str]:
    payload = load_json(PAUSED_TASKS_PATH, {})
    paused: set[str] = set()
    if isinstance(payload, dict):
        for item in payload.get("tasks", []):
            if isinstance(item, dict) and item.get("paused"):
                task_name = str(item.get("taskName") or "").strip()
                if task_name:
                    paused.add(task_name)
            elif isinstance(item, str):
                paused.add(item)
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, str):
                paused.add(item)
    return paused


def active_auto_managed_tasks() -> dict[str, list[str]]:
    paused = load_paused_task_names()
    return {task_name: slots for task_name, slots in AUTO_MANAGED_TASKS.items() if task_name not in paused}


def hydrate_state_from_dashboard(now: datetime, state: dict[str, Any]) -> None:
    # Dashboard reports are summaries, not proof that a scheduled slot actually
    # ran after restart. Older versions hydrated slotRuns from this file and hid
    # locked/missing-input slots as completed. Keep the marker only for audit.
    state["dashboardHydrationPolicy"] = "disabled_no_slot_completion"


def drop_dashboard_hydrated_slot_runs(state: dict[str, Any]) -> None:
    slot_runs = state.setdefault("slotRuns", {})
    stale_keys = [
        key
        for key, payload in slot_runs.items()
        if payload.get("stdoutTail") == ["hydrated_from_latest_scheduled_task_dashboard"]
    ]
    for key in stale_keys:
        slot_runs.pop(key, None)


def prune_historical_slot_runs(now: datetime, state: dict[str, Any]) -> None:
    date_key = now.strftime("%Y-%m-%d")
    slot_runs = state.setdefault("slotRuns", {})
    active_tasks = active_auto_managed_tasks()
    stale_keys: list[str] = []
    for key in list(slot_runs.keys()):
        task_name, _, suffix = key.partition("@")
        if task_name not in active_tasks:
            continue
        slot_date, _, _slot_time = suffix.partition("T")
        if slot_date != date_key:
            stale_keys.append(key)
    for key in stale_keys:
        slot_runs.pop(key, None)


def acquire_single_instance_lock():
    ensure_dirs()
    lock_file = PID_LOCK_PATH.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("scheduled_task_runner already active", file=sys.stderr)
        sys.exit(0)
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def load_enabled_profiles() -> dict[str, dict[str, Any]]:
    sys.path.insert(0, str(APP_API_DIR))
    from app import scheduled_task_console  # noqa: E402
    from app import retail_core  # noqa: E402

    # SQLite 在 API 写入高峰时可能短时被锁；这里做重试和降级，避免 runner 直接崩溃。
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            scheduled_task_console.init_scheduled_task_console()
            profiles = scheduled_task_console.list_scheduled_task_profiles().get("items", [])
            return {item["taskName"]: item for item in profiles if item.get("enabled")}
        except Exception as error:  # noqa: BLE001
            last_error = error
            if "database is locked" not in str(error).lower():
                raise
            time.sleep(1.0 + attempt * 1.5)

    # 降级路径：直接从主库读已启用任务，保证定时框架不断。
    try:
        with retail_core.connect() as conn:
            rows = conn.execute(
                """
                SELECT task_name, requires_computer_use, priority, related_pipeline
                  FROM scheduled_task_profile
                 WHERE enabled = 1
                """
            ).fetchall()
        profiles: dict[str, dict[str, Any]] = {}
        for row in rows:
            task_name = str(row["task_name"] or "").strip()
            if not task_name:
                continue
            profiles[task_name] = {
                "taskName": task_name,
                "requiresComputerUse": bool(row["requires_computer_use"]),
                "priority": int(row["priority"] or 0),
                "relatedPipeline": str(row["related_pipeline"] or ""),
                "enabled": True,
            }
        if profiles:
            print("[warn] scheduled_task_profile loaded via sqlite fallback after lock retries", flush=True)
            return profiles
    except Exception:
        pass

    # 最后兜底：保留 runner 可运行，不因锁问题完全停摆。
    fallback = {name: {"taskName": name, "enabled": True} for name in active_auto_managed_tasks()}
    print(f"[warn] using static task fallback due to profile lock: {last_error}", flush=True)
    return fallback


def run_task(task_name: str) -> dict[str, Any]:
    started = time.time()
    started_at = get_shanghai_now().isoformat()
    result = subprocess.run(
        ["bash", str(TASK_SCRIPT), task_name],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    retryable = result.returncode in RETRYABLE_EXIT_CODES
    result_payload = {
        "taskName": task_name,
        "status": "completed" if result.returncode == 0 else "failed",
        "retryable": retryable,
        "exitCode": result.returncode,
        "startedAt": started_at,
        "finishedAt": get_shanghai_now().isoformat(),
        "durationMs": int((time.time() - started) * 1000),
        "stdoutTail": result.stdout.strip().splitlines()[-5:],
        "stderrTail": result.stderr.strip().splitlines()[-5:],
    }
    print(
        f"[task] task={task_name} status={result_payload['status']} exit={result.returncode} retryable={retryable}",
        flush=True,
    )
    return enrich_with_business_outcome(task_name, result_payload)


def _parse_result_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _select_fresh_report(task_name: str, result_payload: dict[str, Any]) -> dict[str, Any] | None:
    reports = load_json(REPORT_PATH, {})
    report = reports.get(task_name) if isinstance(reports, dict) else None
    if not isinstance(report, dict):
        return None

    report_finished_at = _parse_result_dt(report.get("finishedAt"))
    result_started_at = _parse_result_dt(result_payload.get("startedAt"))
    result_finished_at = _parse_result_dt(result_payload.get("finishedAt"))
    if not report_finished_at or not result_finished_at:
        return None

    if result_started_at is None:
        duration_ms = int(result_payload.get("durationMs") or 0)
        result_started_at = result_finished_at - timedelta(milliseconds=duration_ms)

    lower_bound = result_started_at - timedelta(seconds=10)
    upper_bound = result_finished_at + timedelta(minutes=5)
    if lower_bound <= report_finished_at <= upper_bound:
        return report
    return None


def enrich_with_business_outcome(task_name: str, result_payload: dict[str, Any]) -> dict[str, Any]:
    report = _select_fresh_report(task_name, result_payload)
    if not isinstance(report, dict):
        if result_payload.get("status") == "completed":
            result_payload["businessOutcome"] = "executed_not_closed"
            result_payload["businessClosed"] = False
            result_payload["manualActionRequired"] = True
            result_payload["status"] = "completed_with_business_gap"
            result_payload["blockingReason"] = (
                "本次调度未产出当前时间窗内的新任务报告，不能沿用旧报告判定完成。"
            )
        elif result_payload.get("status") == "failed":
            result_payload["manualActionRequired"] = True
            if not result_payload.get("blockingReason"):
                stderr_tail = result_payload.get("stderrTail") or []
                if isinstance(stderr_tail, list) and stderr_tail:
                    result_payload["blockingReason"] = str(stderr_tail[-1])
        return result_payload
    outcome = report.get("executionOutcome")
    if outcome:
        result_payload["businessOutcome"] = outcome
        result_payload["businessClosed"] = outcome == "real_completed"
        if result_payload.get("status") == "completed" and outcome != "real_completed":
            result_payload["status"] = "completed_with_business_gap"
            result_payload["manualActionRequired"] = True
    if "manualActionRequired" in report:
        result_payload["manualActionRequired"] = bool(report.get("manualActionRequired"))
    blocking_reason = report.get("blockingReason")
    if blocking_reason:
        result_payload["blockingReason"] = blocking_reason
    return result_payload


def refresh_recovery_queue() -> dict[str, Any] | None:
    if not RECOVERY_QUEUE_SCRIPT.exists():
        return None
    subprocess.run(
        [sys.executable, str(RECOVERY_QUEUE_SCRIPT)],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    payload = load_json(RECOVERY_QUEUE_PATH, None)
    if isinstance(payload, dict):
        return payload
    return None


def slot_key(task_name: str, date_key: str, slot_time: str) -> str:
    return f"{task_name}@{date_key}T{slot_time}"


def sort_slot_candidates(candidates: list[tuple[str, str, str]]) -> list[tuple[str, str, str]]:
    return sorted(
        candidates,
        key=lambda item: (
            item[1],
            item[2],
            TASK_RUN_PRIORITY.get(item[0], 999),
            item[0],
        ),
    )


def due_slots(now: datetime, enabled_profiles: dict[str, dict[str, Any]]) -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []
    date_key = now.strftime("%Y-%m-%d")
    for task_name, time_list in active_auto_managed_tasks().items():
        if task_name not in enabled_profiles:
            continue
        for slot_time in time_list:
            hour, minute = map(int, slot_time.split(":"))
            slot_dt = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if slot_dt <= now <= slot_dt + timedelta(minutes=TRIGGER_WINDOW_MINUTES):
                results.append((task_name, date_key, slot_time))
    return results


def due_same_day_catchup_slots(
    now: datetime,
    enabled_profiles: dict[str, dict[str, Any]],
    state: dict[str, Any],
) -> list[tuple[str, str, str]]:
    if not CATCHUP_IF_NO_RUN_TODAY:
        return []
    results: list[tuple[str, str, str]] = []
    date_key = now.strftime("%Y-%m-%d")
    task_slots = state.get("taskSlots", {})
    slot_runs = state.get("slotRuns", {})
    for task_name, time_list in active_auto_managed_tasks().items():
        if task_name not in enabled_profiles:
            continue
        last_run = task_slots.get(task_name)
        if last_run:
            try:
                last_dt = datetime.fromisoformat(str(last_run))
                if last_dt.astimezone(now.tzinfo).strftime("%Y-%m-%d") == date_key:
                    continue
            except ValueError:
                pass
        elapsed_slots: list[str] = []
        for slot_time in time_list:
            hour, minute = map(int, slot_time.split(":"))
            slot_dt = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if slot_dt <= now:
                elapsed_slots.append(slot_time)
        if not elapsed_slots:
            continue
        latest_slot = elapsed_slots[-1]
        key = slot_key(task_name, date_key, latest_slot)
        if key in slot_runs:
            continue
        results.append((task_name, date_key, latest_slot))
    return results


def collect_zhidiantong_file_fingerprint(now: datetime) -> dict[str, Any] | None:
    today = now.strftime("%Y-%m-%d")
    compact_today = now.strftime("%Y%m%d")
    search_dirs = [
        ARTIFACT_DIR / "manual",
        ARTIFACT_DIR,
        Path.home() / "Downloads",
    ]
    patterns = [
        f"zhidiantong-stock-stream-{today}.*",
        f"stock_count{today}.*",
        f"stock_count{compact_today}.*",
        f"stock_count_{compact_today}.*",
        f"库存流水-{today}.*",
        f"库存流水-{compact_today}.*",
        f"zhidiantong-sn-stock-order-{today}.*",
        f"sn-stock-order-{today}.*",
        f"SN库存订单-{today}.*",
        f"SN库存订单-{compact_today}.*",
        "serialNumberData*.xls*",
        "serialNumberData*.csv",
        "orderData*.xls*",
        "orderData*.csv",
        "orderProductData*.xls*",
        "orderProductData*.csv",
        f"商品库存统计_{today}.*",
        f"商品库存SN统计_{today}.*",
    ]
    matched: list[dict[str, Any]] = []
    for directory in search_dirs:
        if not directory.exists():
            continue
        for pattern in patterns:
            for file_path in directory.glob(pattern):
                try:
                    stat = file_path.stat()
                except OSError:
                    continue
                if not file_path.is_file():
                    continue
                matched.append({
                    "path": str(file_path),
                    "mtimeMs": int(stat.st_mtime * 1000),
                    "size": stat.st_size,
                })
    if not matched:
        return None
    matched.sort(key=lambda item: (item["mtimeMs"], item["path"]))
    fingerprint = "|".join(f"{item['path']}:{item['mtimeMs']}:{item['size']}" for item in matched)
    return {
        "fingerprint": fingerprint,
        "latestMtimeMs": max(item["mtimeMs"] for item in matched),
        "fileCount": len(matched),
        "latestFiles": matched[-8:],
    }


def due_zhidiantong_file_change_slot(
    now: datetime,
    enabled_profiles: dict[str, dict[str, Any]],
    state: dict[str, Any],
) -> list[tuple[str, str, str]]:
    if ZHIDIANTONG_TASK_NAME in load_paused_task_names():
        return []
    if ZHIDIANTONG_TASK_NAME not in enabled_profiles:
        return []
    fingerprint_payload = collect_zhidiantong_file_fingerprint(now)
    if fingerprint_payload is None:
        return []
    file_triggers = state.setdefault("fileTriggers", {})
    previous = file_triggers.get(ZHIDIANTONG_TASK_NAME, {})
    if previous.get("fingerprint") == fingerprint_payload["fingerprint"]:
        return []
    last_run = state.get("taskSlots", {}).get(ZHIDIANTONG_TASK_NAME)
    if last_run:
        try:
            last_dt = datetime.fromisoformat(str(last_run))
            last_run_ms = int(last_dt.timestamp() * 1000)
            if fingerprint_payload["latestMtimeMs"] <= last_run_ms:
                file_triggers[ZHIDIANTONG_TASK_NAME] = fingerprint_payload
                return []
        except ValueError:
            pass
    state.setdefault("pendingFileTriggers", {})[ZHIDIANTONG_TASK_NAME] = fingerprint_payload
    return [(ZHIDIANTONG_TASK_NAME, now.strftime("%Y-%m-%d"), f"file-{now.strftime('%H%M')}")]


def _irregular_sync_health_interval_minutes(now: datetime, sequence: int) -> int:
    seed = f"{now.strftime('%Y-%m-%d')}:{sequence}:{SYNC_HEALTH_TASK_NAME}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return 35 + (int(digest[:8], 16) % 41)


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def due_irregular_sync_health_slot(
    now: datetime,
    enabled_profiles: dict[str, dict[str, Any]],
    state: dict[str, Any],
) -> list[tuple[str, str, str]]:
    if SYNC_HEALTH_TASK_NAME in load_paused_task_names():
        return []
    if SYNC_HEALTH_TASK_NAME not in enabled_profiles:
        return []
    if not (10 <= now.hour < 22):
        return []

    date_key = now.strftime("%Y-%m-%d")
    task_slots = state.setdefault("taskSlots", {})
    slot_runs = state.setdefault("slotRuns", {})
    irregular_state = state.setdefault("irregularTaskState", {})
    task_state = irregular_state.setdefault(SYNC_HEALTH_TASK_NAME, {})
    pending_state = state.setdefault("pendingIrregularTriggers", {})

    last_run = _parse_iso_datetime(task_slots.get(SYNC_HEALTH_TASK_NAME))
    last_run_today = last_run and last_run.astimezone(now.tzinfo).strftime("%Y-%m-%d") == date_key

    sequence = int(task_state.get("sequence", 0))
    next_due = _parse_iso_datetime(task_state.get("nextDueAt"))

    if not last_run_today and next_due is None:
        pending_state[SYNC_HEALTH_TASK_NAME] = {"sequence": sequence, "seededAt": now.isoformat()}
        return [(SYNC_HEALTH_TASK_NAME, date_key, f"irregular-{sequence:02d}")]

    if next_due and now < next_due.astimezone(now.tzinfo):
        return []

    key = slot_key(SYNC_HEALTH_TASK_NAME, date_key, f"irregular-{sequence:02d}")
    if key in slot_runs:
        if next_due is None:
            interval = _irregular_sync_health_interval_minutes(now, sequence + 1)
            task_state["nextDueAt"] = (now + timedelta(minutes=interval)).isoformat()
            task_state["sequence"] = sequence + 1
        return []

    pending_state[SYNC_HEALTH_TASK_NAME] = {"sequence": sequence, "seededAt": now.isoformat()}
    return [(SYNC_HEALTH_TASK_NAME, date_key, f"irregular-{sequence:02d}")]


def normalize_slot_runs_for_status(slot_runs: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in slot_runs.items():
        if not isinstance(value, dict):
            normalized[key] = value
            continue
        item = dict(value)
        outcome = item.get("businessOutcome")
        if item.get("status") == "completed" and outcome and outcome != "real_completed":
            item["status"] = "completed_with_business_gap"
            item["businessClosed"] = False
            item["manualActionRequired"] = True
        elif outcome == "real_completed":
            item["businessClosed"] = True
        normalized[key] = item
    return normalized


def build_status_payload(
    enabled_profiles: dict[str, dict[str, Any]],
    state: dict[str, Any],
    last_watchdog: dict[str, Any] | None,
) -> dict[str, Any]:
    paused_task_names = sorted(load_paused_task_names())
    active_tasks = active_auto_managed_tasks()
    auto_task_names = list(active_tasks.keys())
    watch_only = [
        {
            "taskName": profile["taskName"],
            "label": profile.get("label"),
            "requiresComputerUse": bool(profile.get("requiresComputerUse")),
            "category": profile.get("category"),
        }
        for profile in enabled_profiles.values()
        if profile["taskName"] not in AUTO_MANAGED_TASKS
    ]
    recovery_queue = load_json(RECOVERY_QUEUE_PATH, {})
    recovery_summary = recovery_queue.get("summary") if isinstance(recovery_queue, dict) else None
    return {
        "generatedAt": get_shanghai_now().isoformat(),
        "runnerMode": "full-schedule-managed",
        "historicalCatchupPolicy": "same_day_latest_slot_if_no_run",
        "slotRetryPolicy": "queued_serial_execution_waits_for_task_lock",
        "taskQueuePolicy": "same-time slots run by priority: zhidiantong main-chain first, detail rebuild second, then quote/price/warranty/supporting tasks",
        "pollSeconds": POLL_SECONDS,
        "watchdogEnabled": False,
        "pausedTasks": [
            {
                "taskName": task_name,
                "schedule": AUTO_MANAGED_TASKS.get(task_name, []),
            }
            for task_name in paused_task_names
        ],
        "businessOutcomePolicy": "exitCode=0 只代表脚本执行；businessOutcome 不是 real_completed 时自动标记 completed_with_business_gap 并进入补采队列。",
        "recoveryQueue": {
            "path": str(RECOVERY_QUEUE_PATH),
            "generatedAt": recovery_queue.get("generatedAt") if isinstance(recovery_queue, dict) else None,
            "summary": recovery_summary,
        },
        "autoManagedTasks": [
            {
                "taskName": task_name,
                "label": enabled_profiles.get(task_name, {}).get("label"),
                "schedule": (
                    ["营业时段 10:00-22:00 不定时抽检（约 35-75 分钟）"]
                    if task_name == SYNC_HEALTH_TASK_NAME
                    else active_tasks[task_name]
                ),
                "lastRun": state.get("taskSlots", {}).get(task_name),
            }
            for task_name in auto_task_names
        ],
        "watchOnlyTasks": watch_only,
        "lastWatchdog": None,
        "lastTaskRuns": normalize_slot_runs_for_status(state.get("slotRuns", {})),
    }


def main() -> None:
    lock_file = acquire_single_instance_lock()
    ensure_dirs()
    state = load_json(STATE_PATH, {"taskSlots": {}, "slotRuns": {}, "lastWatchdogAt": None, "lastWatchdog": None})
    last_watchdog: dict[str, Any] | None = None

    try:
        while True:
            enabled_profiles = load_enabled_profiles()
            now = get_shanghai_now()
            prune_historical_slot_runs(now, state)
            drop_dashboard_hydrated_slot_runs(state)
            hydrate_state_from_dashboard(now, state)

            slot_candidates = due_slots(now, enabled_profiles)
            slot_candidates.extend(due_same_day_catchup_slots(now, enabled_profiles, state))
            slot_candidates.extend(due_zhidiantong_file_change_slot(now, enabled_profiles, state))
            slot_candidates.extend(due_irregular_sync_health_slot(now, enabled_profiles, state))
            deduped: list[tuple[str, str, str]] = []
            seen_keys: set[str] = set()
            for task_name, date_key, slot_time in slot_candidates:
                key = slot_key(task_name, date_key, slot_time)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                deduped.append((task_name, date_key, slot_time))
            slot_candidates = sort_slot_candidates(deduped)

            for task_name, date_key, slot_time in slot_candidates:
                key = slot_key(task_name, date_key, slot_time)
                existing = state.get("slotRuns", {}).get(key)
                if existing:
                    continue
                result = run_task(task_name)
                state.setdefault("slotRuns", {})[key] = result
                if task_name == ZHIDIANTONG_TASK_NAME:
                    pending = state.setdefault("pendingFileTriggers", {}).pop(task_name, None)
                    if pending:
                        state.setdefault("fileTriggers", {})[task_name] = {
                            **pending,
                            "lastAttemptedAt": result["finishedAt"],
                            "lastBusinessOutcome": result.get("businessOutcome"),
                            "lastBlockingReason": result.get("blockingReason"),
                        }
                if task_name == SYNC_HEALTH_TASK_NAME:
                    pending = state.setdefault("pendingIrregularTriggers", {}).pop(task_name, None) or {}
                    irregular_state = state.setdefault("irregularTaskState", {}).setdefault(task_name, {})
                    sequence = int(pending.get("sequence", irregular_state.get("sequence", 0)))
                    next_interval = _irregular_sync_health_interval_minutes(now, sequence + 1)
                    irregular_state["sequence"] = sequence + 1
                    irregular_state["lastTriggeredAt"] = result["finishedAt"]
                    irregular_state["nextDueAt"] = (
                        datetime.fromisoformat(result["finishedAt"]).astimezone(now.tzinfo)
                        + timedelta(minutes=next_interval)
                    ).isoformat()
                    irregular_state["lastBusinessOutcome"] = result.get("businessOutcome")
                    irregular_state["lastBlockingReason"] = result.get("blockingReason")
                if result["status"] == "completed":
                    state.setdefault("taskSlots", {})[task_name] = result["finishedAt"]
                elif result["status"] == "completed_with_business_gap":
                    state.setdefault("taskSlots", {})[task_name] = result["finishedAt"]
                    state.setdefault("businessGapTasks", {})[task_name] = {
                        "lastAttemptedAt": result["finishedAt"],
                        "businessOutcome": result.get("businessOutcome"),
                        "blockingReason": result.get("blockingReason"),
                    }
                refresh_recovery_queue()

            status_payload = build_status_payload(enabled_profiles, state, last_watchdog)
            save_json(STATUS_PATH, status_payload)
            save_json(WEB_STATUS_PATH, status_payload)
            save_json(STATE_PATH, state)
            if RUN_ONCE:
                break
            time.sleep(POLL_SECONDS)
    finally:
        try:
            lock_file.close()
        except OSError:
            pass


if __name__ == "__main__":
    main()
