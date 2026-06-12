#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
PAYLOAD_PATH = WORKSPACE_ROOT / "automation_payloads.json"
AUTOMATION_ROOT = Path.home() / ".codex" / "automations"

FORBIDDEN = [
    "zhidiantong-sync-12",
    "zhidiantong-sync-15",
    "zhidiantong-sync-19",
    "收藏/方块",
    "网页微信收藏夹",
    "手动重新登录",
    "旧 JSON 或本地文件扫描冒充真实采集",
]

REQUIRED_GLOBAL = [
    "真实证据 -> 写入 SQL/API 或受控快照 -> 刷新前端 -> 打开前端可见验收",
    "当前已登录的默认 Chrome 可见会话",
    "CLI/OpenClaw 只作为智店通实时触发和轻字段先到层",
    "原来的 30 个 Codex 定时采集任务",
    "只“打开了页面”“进入了公众号”“看到了列表”“脚本跑了”都不是完成",
    "所有采集结果统一走：证据/原始记录 -> SQL",
    "终态只允许 real_completed、executed_not_closed、blocked_missing_input、blocked_page_risk",
]

REQUIRED_BY_ID: dict[str, list[str]] = {
    "automation-5": ["文件传输助手聊天记录区", "进入公众号页只算入口到达", "daily-gray-channel-check"],
    "automation-6": ["文件传输助手聊天记录区", "进入公众号页只算入口到达", "daily-gray-channel-check"],
    "automation-8": ["必须点到目标规格", "白色款不得沿用黑色价", "daily-jd-lenovo-price-sync"],
    "automation-2": ["编排和本地重建，不替代真实页面核价", "manual-price-supplements"],
    "automation-3": ["当天群内真实报价文件", "只解析库存大于 0 商品"],
    "automation-4": ["当天群内真实报价文件", "只解析库存大于 0 商品"],
    "automation-7": ["只重建和审计已确认来源", "SQL open gap"],
    "automation-9": ["只播报 SQL/快照中已发布", "send:daily-inventory-price-broadcast"],
    "automation-10": ["只播报已真实采集", "latest-competitor-monitor.json"],
    "4": ["京东自营对应店铺", "不得用全站排行页"],
    "180": ["不触发外部采集", "latest-stale-inventory-report.json"],
    "automation": ["只记录当天真实发生的进展", "不得把计划写成已完成"],
    "sn": ["联想保修查询页", "不得回退成待补"],
    "sn-15": ["联想保修查询页", "不得回退成待补"],
    "sn-19": ["联想保修查询页", "不得回退成待补"],
}

ZHIDIANTONG_IDS = {
    "11-15",
    "12",
    "12-45",
    "13-30",
    "14-15",
    "15",
    "15-45",
    "16-30",
    "17-15",
    "18-00",
    "19",
    "19-30",
    "20-15",
    "21-00",
    "21-45",
}


def load_payload() -> list[dict]:
    data = json.loads(PAYLOAD_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("automation_payloads.json must be a list")
    return [item for item in data if isinstance(item, dict)]


def audit_prompt(source: str, task_id: str, prompt: str) -> list[str]:
    issues: list[str] = []
    for token in FORBIDDEN:
        if token in prompt:
            issues.append(f"{source}:{task_id}: forbidden token {token}")
    for token in REQUIRED_GLOBAL:
        if token not in prompt:
            issues.append(f"{source}:{task_id}: missing global rule {token}")
    required = list(REQUIRED_BY_ID.get(task_id, []))
    if task_id in ZHIDIANTONG_IDS:
        required.extend([
            "zhidiantong-sync-cycle",
            "线下门店订单",
            "orderData*.xlsx 与 orderProductData*.xlsx",
            "教育补代扫",
            "智店通入库群",
            "教育补贴群",
            "sourceGroupName",
            "collectionSource",
            "50 元/台",
            "30 元/台",
            "调拨出库",
            "调拨入库",
            "不计入营销 PO",
            "价保申请范围",
        ])
    for token in required:
        if token not in prompt:
            issues.append(f"{source}:{task_id}: missing task rule {token}")
    return issues


def audit_payload() -> list[str]:
    issues: list[str] = []
    payload = load_payload()
    if len(payload) != 30:
        issues.append(f"payload count expected 30 got {len(payload)}")
    for item in payload:
        task_id = str(item.get("id") or "")
        prompt = str(item.get("prompt") or "")
        issues.extend(audit_prompt("payload", task_id, prompt))
    return issues


def audit_automations() -> list[str]:
    issues: list[str] = []
    payload_by_id = {str(item.get("id") or ""): item for item in load_payload()}
    expected_active = {
        task_id
        for task_id, item in payload_by_id.items()
        if str(item.get("status", "ACTIVE")).upper() == "ACTIVE"
    }
    expected_paused = {
        task_id
        for task_id, item in payload_by_id.items()
        if str(item.get("status", "ACTIVE")).upper() == "PAUSED"
    }
    active_count = 0
    seen_ids: set[str] = set()
    for path in sorted(AUTOMATION_ROOT.glob("*/automation.toml")):
        try:
            item = tomllib.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            issues.append(f"{path}: TOML parse failed: {exc}")
            continue
        task_id = path.parent.name
        seen_ids.add(task_id)
        status = str(item.get("status", "")).upper()
        expected_status = str(payload_by_id.get(task_id, {}).get("status", "ACTIVE")).upper()
        if task_id in payload_by_id and status != expected_status:
            issues.append(f"{path}: status mismatch expected {expected_status} got {status}")
        if status != "ACTIVE":
            continue
        active_count += 1
        prompt = str(item.get("prompt") or "")
        issues.extend(audit_prompt("automation", task_id, prompt))
    missing = sorted(set(payload_by_id) - seen_ids)
    if missing:
        issues.append(f"missing automation TOML entries: {missing}")
    if active_count != len(expected_active):
        issues.append(f"active automation count expected {len(expected_active)} got {active_count}")
    paused_seen = expected_paused & seen_ids
    if len(paused_seen) != len(expected_paused):
        issues.append(f"paused automation count expected {len(expected_paused)} got {len(paused_seen)}")
    return issues


def main() -> int:
    issues = audit_payload() + audit_automations()
    payload = {
        "ok": not issues,
        "payloadPath": str(PAYLOAD_PATH),
        "automationRoot": str(AUTOMATION_ROOT),
        "issueCount": len(issues),
        "issues": issues,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
