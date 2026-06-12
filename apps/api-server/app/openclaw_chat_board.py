from __future__ import annotations

import json
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
ARTIFACT_DIR = PROJECT_ROOT / "apps" / "inventory-sync" / "artifacts"
PUBLIC_DATA_DIR = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data"
OPENCLAW_ROOT = ARTIFACT_DIR / "manual" / "openclaw"
CHAT_ROOT = OPENCLAW_ROOT / "chat"
THREAD_FILE = CHAT_ROOT / "thread.json"
COMMAND_DIR = OPENCLAW_ROOT / "commands"
RECEIPT_DIR = OPENCLAW_ROOT / "receipts"
CHAT_ARTIFACT_PATH = ARTIFACT_DIR / "latest-openclaw-chat-board.json"
CHAT_WEB_PATH = PUBLIC_DATA_DIR / "latest-openclaw-chat-board.json"
COMMAND_ARTIFACT_PATH = ARTIFACT_DIR / "latest-openclaw-command-board.json"
COMMAND_WEB_PATH = PUBLIC_DATA_DIR / "latest-openclaw-command-board.json"
OPENCLAW_SESSION_REGISTRY = Path.home() / ".openclaw" / "agents" / "main" / "sessions" / "sessions.json"
OPENCLAW_SESSION_KEY = "agent:main:dashboard:c8e07d33-4dba-42c9-b110-da9c51c27b93"
OPENCLAW_ENV_WRAPPER = PROJECT_ROOT / "scripts" / "openclaw_env.sh"

OPENCLAW_PENDING_STATUSES = {
    "drafted",
    "queued",
    "steered",
    "acknowledged",
    "executing",
    "blocked",
}
OPENCLAW_ACTIVE_STATUSES = {"queued", "steered", "acknowledged", "executing"}
CHAT_HIDDEN_TASK_NAMES = {"openclaw-watchdog"}
OPENCLAW_SEND_TIMEOUT_MS = 15000
RECEIPT_TRIGGER_PENDING_STATUSES = {
    "completed",
    "completed_with_warnings",
    "blocked_missing_input",
    "blocked_page_risk",
    "executed_not_closed",
    "failed",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def walk_json_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted([path for path in root.rglob("*.json") if path.is_file()])


def default_thread() -> dict[str, Any]:
    return {
        "session": {
            "sessionId": "openclaw-lenovo-retail-main",
            "updatedAt": now_iso(),
        },
        "messages": [],
    }


def load_thread() -> dict[str, Any]:
    payload = read_json(THREAD_FILE, default_thread())
    if not isinstance(payload, dict):
        payload = default_thread()
    payload.setdefault("session", {})
    payload["session"].setdefault("sessionId", "openclaw-lenovo-retail-main")
    payload["session"].setdefault("updatedAt", now_iso())
    payload.setdefault("messages", [])
    if not isinstance(payload["messages"], list):
        payload["messages"] = []
    return payload


def save_thread(payload: dict[str, Any]) -> None:
    payload.setdefault("session", {})
    payload["session"]["updatedAt"] = now_iso()
    write_json(THREAD_FILE, payload)


def load_commands() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in walk_json_files(COMMAND_DIR):
        payload = read_json(path, {})
        if isinstance(payload, dict) and isinstance(payload.get("commandId"), str):
            items.append(payload)
        elif isinstance(payload, dict) and isinstance(payload.get("command"), dict):
            command = payload["command"]
            if isinstance(command.get("commandId"), str):
                items.append(command)
    items.sort(
        key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""),
        reverse=True,
    )
    return items


def find_command_file(command_id: str) -> Path | None:
    for path in walk_json_files(COMMAND_DIR):
        payload = read_json(path, {})
        if isinstance(payload, dict) and payload.get("commandId") == command_id:
            return path
        if (
            isinstance(payload, dict)
            and isinstance(payload.get("command"), dict)
            and payload["command"].get("commandId") == command_id
        ):
            return path
    return None


def extract_evidence_paths(text: str) -> list[str]:
    candidates = re.findall(r"(receipts/[^\s`]+)", text)
    return sorted(set(candidates))


def load_receipts() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in walk_json_files(RECEIPT_DIR):
        payload = read_json(path, {})
        if isinstance(payload, dict) and isinstance(payload.get("receiptId"), str):
            payload.setdefault("receiptPath", str(path))
            items.append(payload)
        elif isinstance(payload, dict) and isinstance(payload.get("receipt"), dict):
            receipt = payload["receipt"]
            if isinstance(receipt.get("receiptId"), str):
                receipt.setdefault("receiptPath", str(path))
                items.append(receipt)
    items.sort(key=lambda item: str(item.get("capturedAt") or ""), reverse=True)
    return items


def load_openclaw_session_messages(limit: int = 40) -> list[dict[str, Any]]:
    registry = read_json(OPENCLAW_SESSION_REGISTRY, {})
    if not isinstance(registry, dict):
        return []
    session_meta = registry.get(OPENCLAW_SESSION_KEY)
    if not isinstance(session_meta, dict):
        return []
    session_file = session_meta.get("sessionFile")
    if not isinstance(session_file, str) or not session_file.strip():
        return []
    path = Path(session_file).expanduser()
    if not path.exists():
        return []

    messages: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in lines[-400:]:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("type") != "message":
            continue
        message = payload.get("message")
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        if role not in {"assistant", "user"}:
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        text_parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "text":
                continue
            text = str(item.get("text") or "").strip()
            if text:
                text_parts.append(text)
        if not text_parts:
            continue
        text = "\n\n".join(text_parts).strip()
        if not text:
            continue
        status = "info"
        if "阻塞" in text or "403" in text or "无权访问" in text:
            status = "warn"
        if "任务完成" in text or "可以接收下一条任务" in text:
            status = "good"
        messages.append(
            {
                "id": f"openclaw-session-{payload.get('id')}",
                "role": "assistant" if role == "assistant" else "user",
                "kind": "session",
                "text": text,
                "timestamp": str(payload.get("timestamp") or ""),
                "taskName": "openclaw-live-session",
                "status": None,
                "tone": status,
                "source": "openclaw-control",
            }
        )
    return messages[-limit:]


def reconcile_openclaw_command_statuses(
    commands: list[dict[str, Any]],
    session_messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    latest_assistant = None
    for item in reversed(session_messages):
        if item.get("role") == "assistant":
            latest_assistant = item
            break
    if not latest_assistant:
        return commands

    latest_text = str(latest_assistant.get("text") or "").strip()
    latest_timestamp = str(latest_assistant.get("timestamp") or now_iso())
    latest_dt = parse_iso(latest_timestamp)
    pending_openclaw = [
        item
        for item in commands
        if item.get("targetSystem") == "openclaw"
        and str(item.get("status") or "") in OPENCLAW_ACTIVE_STATUSES
    ]
    if not pending_openclaw:
        return commands

    latest_command = pending_openclaw[0]
    command_id = str(latest_command.get("commandId") or "").strip()
    if not command_id:
        return commands
    command_created_at = str(latest_command.get("createdAt") or "")
    command_created_dt = parse_iso(command_created_at)
    if latest_dt and command_created_dt and latest_dt <= command_created_dt:
        return commands

    next_status = None
    if "任务完成" in latest_text or "可以接收下一条任务" in latest_text:
        next_status = "completed"
    elif "blocked_page_risk" in latest_text or "无权访问" in latest_text:
        next_status = "blocked"
    if not next_status or str(latest_command.get("status") or "") == next_status:
        return commands

    command_path = find_command_file(command_id)
    if not command_path:
        return commands

    payload = read_json(command_path, {})
    target = payload
    if isinstance(payload, dict) and isinstance(payload.get("command"), dict):
        target = payload["command"]
    if not isinstance(target, dict):
        return commands

    target["status"] = next_status
    target["updatedAt"] = latest_timestamp
    target["resultSummary"] = latest_text
    target["evidencePaths"] = extract_evidence_paths(latest_text)
    write_json(command_path, payload)
    return load_commands()


def summarize_receipt(receipt: dict[str, Any]) -> str:
    status = str(receipt.get("status") or "unknown")
    task_name = str(receipt.get("taskName") or "未命名任务")
    record_count = int(receipt.get("recordCount") or 0)
    blocking_reason = str(receipt.get("blockingReason") or "").strip()
    notes = receipt.get("notes") if isinstance(receipt.get("notes"), list) else []
    summary = f"{task_name} 已回传结果，状态 {status}，记录 {record_count} 条。"
    if blocking_reason:
        summary += f" 阻塞原因：{blocking_reason}"
    elif notes:
        summary += f" 摘要：{str(notes[0])}"
    elif receipt.get("codexAction"):
        summary += f" 后续动作：{str(receipt.get('codexAction'))}"
    return summary


def map_receipt_tone(status: str) -> str:
    if status == "completed":
        return "good"
    if status in {"completed_with_warnings", "blocked_missing_input", "executed_not_closed"}:
        return "warn"
    return "danger"


def receipt_requires_codex(receipt: dict[str, Any]) -> bool:
    status = str(receipt.get("status") or "").strip()
    if status not in RECEIPT_TRIGGER_PENDING_STATUSES:
        return False
    if str(receipt.get("taskCategory") or "").strip() == "watchdog":
        return False
    return True


def build_receipt_trigger_command(receipt: dict[str, Any]) -> dict[str, Any]:
    receipt_id = str(receipt.get("receiptId") or "").strip()
    task_name = str(receipt.get("taskName") or "openclaw-receipt").strip()
    status = str(receipt.get("status") or "unknown").strip()
    notes = receipt.get("notes") if isinstance(receipt.get("notes"), list) else []
    first_note = str(notes[0]).strip() if notes else ""
    summary = summarize_receipt(receipt)
    blocking_reason = str(receipt.get("blockingReason") or "").strip() or None
    pending_status = "blocked" if status in {"blocked_missing_input", "blocked_page_risk", "failed"} else "queued"
    raw_evidence = receipt.get("rawEvidencePaths") if isinstance(receipt.get("rawEvidencePaths"), list) else []
    structured_evidence = receipt.get("structuredOutputPaths") if isinstance(receipt.get("structuredOutputPaths"), list) else []
    receipt_path = [receipt.get("receiptPath")] if receipt.get("receiptPath") else []
    return {
        "commandId": f"receipt-trigger-{receipt_id}",
        "title": f"回执待验收：{task_name}",
        "instruction": summary,
        "status": pending_status,
        "createdAt": str(receipt.get("capturedAt") or now_iso()),
        "updatedAt": str(receipt.get("capturedAt") or now_iso()),
        "taskName": task_name,
        "sourceSystem": "openclaw",
        "targetSystem": "codex",
        "operator": "openclaw",
        "presetKey": "receipt-trigger",
        "relatedReceiptId": receipt_id,
        "resultSummary": first_note or summary,
        "blockingReason": blocking_reason,
        "evidencePaths": [str(path) for path in (structured_evidence + raw_evidence + receipt_path) if str(path).strip()][:12],
        "commandMode": "receipt_trigger",
        "sourceScope": str(receipt.get("sourceSystem") or "").strip() or None,
        "targetDate": None,
        "dateFrom": None,
        "dateTo": None,
        "collectionNote": "auto-triggered by receipt arrival",
    }


def build_command_board_snapshot(commands: list[dict[str, Any]]) -> dict[str, Any]:
    by_status: dict[str, int] = {}
    latest_by_task: dict[str, dict[str, Any]] = {}
    for command in commands:
        status = str(command.get("status") or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
        task_name = str(command.get("taskName") or "")
        if task_name and task_name not in latest_by_task:
            latest_by_task[task_name] = command
    pending_for_openclaw = [
        command
        for command in commands
        if command.get("targetSystem") == "openclaw"
        and str(command.get("status") or "") in OPENCLAW_PENDING_STATUSES
    ]
    pending_for_codex = [
        command
        for command in commands
        if command.get("targetSystem") == "codex"
        and str(command.get("status") or "") in OPENCLAW_PENDING_STATUSES
    ]
    return {
        "generatedAt": now_iso(),
        "rootDir": str(OPENCLAW_ROOT),
        "total": len(commands),
        "byStatus": by_status,
        "latestUpdatedAt": (
            commands[0].get("updatedAt") or commands[0].get("createdAt")
            if commands
            else None
        ),
        "pendingForOpenClaw": pending_for_openclaw[:100],
        "pendingForCodex": pending_for_codex[:100],
        "latestByTask": latest_by_task,
        "commands": commands[:200],
    }


def save_command_board_snapshot(commands: list[dict[str, Any]]) -> dict[str, Any]:
    snapshot = build_command_board_snapshot(commands)
    write_json(COMMAND_ARTIFACT_PATH, snapshot)
    write_json(COMMAND_WEB_PATH, snapshot)
    return snapshot


def append_thread_message(
    *,
    role: str,
    kind: str,
    text: str,
    task_name: str | None = None,
    status: str | None = None,
    command_id: str | None = None,
    receipt_id: str | None = None,
    tone: str = "info",
) -> dict[str, Any]:
    thread = load_thread()
    message = {
        "id": f"msg-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}",
        "role": role,
        "kind": kind,
        "text": text.strip(),
        "timestamp": now_iso(),
        "taskName": task_name,
        "status": status,
        "commandId": command_id,
        "receiptId": receipt_id,
        "tone": tone,
    }
    thread["messages"].append(message)
    save_thread(thread)
    return message


def create_command(
    *,
    instruction: str,
    title: str,
    task_name: str,
    preset_key: str | None = None,
    operator: str = "codex",
    source_system: str = "codex",
    target_system: str = "openclaw",
    status: str = "drafted",
    result_summary: str | None = None,
    blocking_reason: str | None = None,
    related_receipt_id: str | None = None,
    command_mode: str | None = None,
    source_scope: str | None = None,
    target_date: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    collection_note: str | None = None,
) -> dict[str, Any]:
    command_id = f"openclaw-command-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    command = {
        "commandId": command_id,
        "title": title.strip() or task_name,
        "instruction": instruction.strip(),
        "status": status,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "taskName": task_name,
        "sourceSystem": source_system,
        "targetSystem": target_system,
        "operator": operator,
        "presetKey": preset_key,
        "relatedReceiptId": related_receipt_id,
        "resultSummary": result_summary,
        "blockingReason": blocking_reason,
        "evidencePaths": [],
        "commandMode": command_mode or "normal",
        "sourceScope": source_scope,
        "targetDate": target_date,
        "dateFrom": date_from,
        "dateTo": date_to,
        "collectionNote": collection_note,
    }
    dated_dir = COMMAND_DIR / datetime.now().strftime("%Y-%m-%d")
    write_json(dated_dir / f"{command_id}.json", command)
    save_command_board_snapshot(load_commands())
    return command


def update_command(
    command_id: str,
    *,
    status: str | None = None,
    result_summary: str | None = None,
    blocking_reason: str | None = None,
    evidence_paths: list[str] | None = None,
) -> dict[str, Any] | None:
    command_path = find_command_file(command_id)
    if not command_path:
        return None

    payload = read_json(command_path, {})
    target = payload
    if isinstance(payload, dict) and isinstance(payload.get("command"), dict):
        target = payload["command"]
    if not isinstance(target, dict):
        return None

    if status is not None:
        target["status"] = status
    if result_summary is not None:
        target["resultSummary"] = result_summary
    if blocking_reason is not None:
        target["blockingReason"] = blocking_reason
    if evidence_paths is not None:
        target["evidencePaths"] = evidence_paths
    target["updatedAt"] = now_iso()
    write_json(command_path, payload)
    save_command_board_snapshot(load_commands())
    return target


def dispatch_command_to_openclaw(command: dict[str, Any]) -> dict[str, Any]:
    if not OPENCLAW_ENV_WRAPPER.exists():
        return {
            "ok": False,
            "error": f"OpenClaw wrapper missing: {OPENCLAW_ENV_WRAPPER}",
        }

    command_id = str(command.get("commandId") or "").strip()
    instruction = str(command.get("instruction") or "").strip()
    if not command_id or not instruction:
        return {"ok": False, "error": "command payload missing commandId or instruction"}

    gateway_params = {
        "sessionKey": OPENCLAW_SESSION_KEY,
        "message": instruction,
        "idempotencyKey": command_id,
        "thinking": "off",
    }
    invoke_args = [
        str(OPENCLAW_ENV_WRAPPER),
        "gateway",
        "call",
        "chat.send",
        "--json",
        "--timeout",
        str(OPENCLAW_SEND_TIMEOUT_MS),
        "--params",
        json.dumps(gateway_params, ensure_ascii=False),
    ]

    try:
        result = subprocess.run(
            invoke_args,
            cwd=PROJECT_ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=(OPENCLAW_SEND_TIMEOUT_MS / 1000) + 5,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "OpenClaw gateway chat.send timed out"}

    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if result.returncode != 0:
        return {
            "ok": False,
            "error": stderr or stdout or f"OpenClaw gateway call exited {result.returncode}",
            "returncode": result.returncode,
        }

    try:
        payload = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        return {
            "ok": False,
            "error": f"OpenClaw gateway returned non-JSON payload: {stdout[:300]}",
        }

    run_id = str(payload.get("runId") or command_id).strip()
    status = str(payload.get("status") or "").strip() or "started"
    return {
        "ok": True,
        "runId": run_id,
        "status": status,
        "payload": payload,
    }


def build_preset_tasks(task_profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    presets: list[dict[str, Any]] = [
        {
            "key": "train-enter-page",
            "taskName": "train-enter-page",
            "title": "训练模板：进页",
            "category": "能力训练",
            "summary": "只训练进入目标页面、识别页面状态、截图与回执。",
            "prompt": "本轮只训练页面进入能力。只做：进入目标页面、确认页面名称/URL/状态、截图、写回执。不做筛选、不做导出、不做提取、不做分类。成功标准：正确进入、正确识别状态、截图和回执齐全。",
            "commandMode": "normal",
        },
        {
            "key": "train-hit-control",
            "taskName": "train-hit-control",
            "title": "训练模板：命中控件",
            "category": "能力训练",
            "summary": "只训练命中一个控件并判断是否真正触发。",
            "prompt": "本轮只训练控件命中能力。只做：进入已知页面、点击一个指定控件、观察页面变化、截图、写回执。不改其他字段，不进入其他页面。成功标准：明确判断控件已触发或未触发，并写清失败原因与下轮偏移建议。",
            "commandMode": "normal",
        },
        {
            "key": "train-export-action",
            "taskName": "train-export-action",
            "title": "训练模板：导出动作",
            "category": "能力训练",
            "summary": "只训练导出按钮命中、下载触发和是否生成文件。",
            "prompt": "本轮只训练导出能力。只做：进入目标页面、找到导出按钮、尝试导出、确认是否生成文件、写回执。不解析导出内容、不分类、不写正式快照。成功标准：写清是否真的触发导出、文件名、保存路径。",
            "commandMode": "normal",
        },
        {
            "key": "train-verify-download",
            "taskName": "train-verify-download",
            "title": "训练模板：确认落盘",
            "category": "能力训练",
            "summary": "只训练确认下载文件是否真实落盘、路径是否准确。",
            "prompt": "本轮只训练文件落点确认。只做：检查导出后的下载目录或指定目录、确认文件名、确认文件路径、写回执。不重新导出、不解析文件。成功标准：路径、文件名、时间三项都明确。",
            "commandMode": "normal",
        },
        {
            "key": "train-extract-parse",
            "taskName": "train-extract-parse",
            "title": "训练模板：提取内容",
            "category": "能力训练",
            "summary": "只训练从页面文本、截图 OCR 或 Excel 中提取最小结构化字段。",
            "prompt": "本轮只训练提取能力。只做：读取已有页面文本/截图/Excel，提取关键字段，写回执。不重新导出、不分类入正式库。成功标准：明确来源、明确字段、提取失败时明确原因。",
            "commandMode": "normal",
        },
        {
            "key": "train-classify-archive",
            "taskName": "train-classify-archive",
            "title": "训练模板：分类归档",
            "category": "能力训练",
            "summary": "只训练把提取结果按日期、来源、产品分类/系列/型号归档。",
            "prompt": "本轮只训练分类归档能力。只做：读取已有提取结果，按日期、来源、产品分类、产品系列、产品型号归档，写回执。不重新打开页面、不重新导出。成功标准：分类键清楚、归档位置明确、receipt 可复核。",
            "commandMode": "normal",
        },
        {
            "key": "history-collection",
            "taskName": "history-collection",
            "title": "历史采集任务",
            "category": "历史采集",
            "summary": "按指定日期或日期区间回补历史证据，只写原始证据与回执，不冒充当日实时采集。",
            "prompt": "执行历史采集任务。先确认指定来源、指定日期或日期区间，再按人工可见路径回补原始证据。必须明确区分历史补采与当日实时采集；只保存证据、截图、原始文件路径和回执，不直接写 latest-*.json。",
            "commandMode": "history_collection",
        },
        {
            "key": "custom-collection",
            "taskName": "custom-collection",
            "title": "自定义采集任务",
            "category": "自定义采集",
            "summary": "按指定来源、指定页面、指定字段做一次性定制采集，结果先回执再由 Codex 审核。",
            "prompt": "执行自定义采集任务。严格按给定来源、页面入口、目标字段和证据要求操作。若页面阻塞、登录失效、转圈、403 或入口不一致，立即写阻塞原因，不准扩展成其他采集任务。",
            "commandMode": "custom_collection",
        },
    ]
    for task in task_profiles:
        task_name = str(task.get("taskName") or "").strip()
        if not task_name or not task.get("enabled", True):
            continue
        label = str(task.get("label") or task_name)
        workflow = str(task.get("workflowSummary") or "").strip()
        prompt = str(task.get("currentPrompt") or task.get("defaultPrompt") or "").strip()
        category = str(task.get("category") or "general")
        presets.append(
            {
                "key": task_name,
                "taskName": task_name,
                "title": label,
                "category": category,
                "summary": workflow or label,
                "prompt": prompt,
                "commandMode": "scheduled_task",
            }
        )
        if len(presets) >= 12:
            break
    if presets:
        return presets
    return [
        {
            "key": "zhidiantong-audit",
            "taskName": "zhidiantong-audit",
            "title": "智店通网页审计",
            "category": "zhidiantong",
            "summary": "先审计登录态、白屏、转圈、入口可达性，再汇报阻塞点。",
            "prompt": "先审计智店通当前网页状态。识别登录态、白屏、转圈、权限异常、可点击入口，禁止继续采集业务数据。若阻塞，明确写出阻塞原因和建议恢复路径。",
            "commandMode": "normal",
        },
        {
            "key": "repair-blocked-task",
            "taskName": "repair-blocked-task",
            "title": "修复阻塞并继续",
            "category": "repair",
            "summary": "收到阻塞后，先定位卡点，再给出修复结果或继续阻塞说明。",
            "prompt": "针对刚才阻塞的任务，先定位失败原因，再尝试修复。只能复用现有登录会话，不准新开空白窗口。修复后继续原任务，否则明确回报阻塞原因。",
            "commandMode": "normal",
        },
    ]


def build_chat_board(task_profiles: list[dict[str, Any]]) -> dict[str, Any]:
    thread = load_thread()
    commands = load_commands()
    session_messages = load_openclaw_session_messages()
    commands = reconcile_openclaw_command_statuses(commands, session_messages)
    receipts = [
        item
        for item in load_receipts()
        if str(item.get("taskName") or "").strip() not in CHAT_HIDDEN_TASK_NAMES
    ]
    explicit_messages = [
        item for item in thread.get("messages", []) if isinstance(item, dict)
    ]
    known_receipt_ids = {
        str(item.get("receiptId"))
        for item in explicit_messages
        if item.get("receiptId")
    }
    known_command_ids = {
        str(item.get("commandId"))
        for item in explicit_messages
        if item.get("commandId")
    }
    derived_messages: list[dict[str, Any]] = []
    for command in commands:
        if (
            command.get("sourceSystem") == "openclaw"
            and command.get("targetSystem") == "codex"
            and str(command.get("commandId")) not in known_command_ids
        ):
            derived_messages.append(
                {
                    "id": f"cmd-{command['commandId']}",
                    "role": "assistant",
                    "kind": "command",
                    "text": str(command.get("resultSummary") or command.get("instruction") or ""),
                    "timestamp": str(command.get("updatedAt") or command.get("createdAt") or ""),
                    "taskName": command.get("taskName"),
                    "status": command.get("status"),
                    "commandId": command.get("commandId"),
                    "tone": "warn" if command.get("status") == "blocked" else "info",
                }
            )
    for receipt in receipts:
        if str(receipt.get("receiptId")) in known_receipt_ids:
            continue
        derived_messages.append(
            {
                "id": f"receipt-{receipt['receiptId']}",
                "role": "assistant",
                "kind": "receipt",
                "text": summarize_receipt(receipt),
                "timestamp": str(receipt.get("capturedAt") or ""),
                "taskName": receipt.get("taskName"),
                "status": receipt.get("status"),
                "receiptId": receipt.get("receiptId"),
                "tone": map_receipt_tone(str(receipt.get("status") or "")),
            }
        )
    known_message_fingerprints = {
        (
            str(item.get("role") or ""),
            str(item.get("timestamp") or ""),
            str(item.get("text") or "").strip(),
        )
        for item in explicit_messages + derived_messages
    }
    for session_message in session_messages:
        fingerprint = (
            str(session_message.get("role") or ""),
            str(session_message.get("timestamp") or ""),
            str(session_message.get("text") or "").strip(),
        )
        if fingerprint in known_message_fingerprints:
            continue
        derived_messages.append(session_message)
        known_message_fingerprints.add(fingerprint)

    messages = explicit_messages + derived_messages
    messages.sort(key=lambda item: str(item.get("timestamp") or ""))

    pending_for_openclaw = [
        command
        for command in commands
        if command.get("targetSystem") == "openclaw"
        and str(command.get("status") or "") in OPENCLAW_PENDING_STATUSES
    ]
    pending_for_codex = [
        command
        for command in commands
        if command.get("targetSystem") == "codex"
        and str(command.get("status") or "") in OPENCLAW_PENDING_STATUSES
    ]
    known_trigger_receipt_ids = {
        str(command.get("relatedReceiptId") or "").strip()
        for command in pending_for_codex
        if str(command.get("relatedReceiptId") or "").strip()
    }
    blocked_receipts = [
        receipt
        for receipt in receipts
        if str(receipt.get("status") or "") in {
            "blocked_missing_input",
            "blocked_page_risk",
            "failed",
            "executed_not_closed",
        }
    ]
    derived_pending_for_codex = [
        build_receipt_trigger_command(receipt)
        for receipt in receipts
        if receipt_requires_codex(receipt)
        and str(receipt.get("receiptId") or "").strip() not in known_trigger_receipt_ids
    ]
    pending_for_codex = pending_for_codex + derived_pending_for_codex
    latest_receipt = receipts[0] if receipts else None
    latest_command = commands[0] if commands else None
    latest_error = None
    for item in blocked_receipts:
        latest_error = str(item.get("blockingReason") or "").strip()
        if latest_error:
            break
    if not latest_error:
        for item in commands:
            if str(item.get("status") or "") == "blocked" and item.get("blockingReason"):
                latest_error = str(item.get("blockingReason"))
                break

    payload = {
        "generatedAt": now_iso(),
        "session": {
            "sessionId": thread.get("session", {}).get("sessionId", "openclaw-lenovo-retail-main"),
            "updatedAt": thread.get("session", {}).get("updatedAt", now_iso()),
        },
        "dispatch": {
            "running": any(
                str(command.get("status") or "") in OPENCLAW_ACTIVE_STATUSES
                for command in pending_for_openclaw
            ),
            "pendingOpenClawCount": len(pending_for_openclaw),
            "pendingCodexCount": len(pending_for_codex),
            "blockedCount": len(blocked_receipts),
            "lastRequestedAt": (
                pending_for_openclaw[0].get("updatedAt") or pending_for_openclaw[0].get("createdAt")
                if pending_for_openclaw
                else None
            ),
            "lastFinishedAt": latest_receipt.get("capturedAt") if latest_receipt else None,
            "lastError": latest_error,
        },
        "stats": {
            "receiptTotal": len(receipts),
            "commandTotal": len(commands),
            "blockedCount": len(blocked_receipts),
            "pendingOpenClawCount": len(pending_for_openclaw),
            "pendingCodexCount": len(pending_for_codex),
        },
        "presetTasks": build_preset_tasks(task_profiles),
        "pendingOpenClawTasks": pending_for_openclaw[:8],
        "pendingCodexTasks": pending_for_codex[:8],
        "blockedItems": blocked_receipts[:8],
        "latestReceipt": latest_receipt,
        "latestCommand": latest_command,
        "messages": messages[-80:],
    }
    write_json(CHAT_ARTIFACT_PATH, payload)
    write_json(CHAT_WEB_PATH, payload)
    return payload
