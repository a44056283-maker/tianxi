#!/usr/bin/env python3
"""Build a same-day recovery queue for scheduled collection tasks.

The queue is intentionally business-outcome based: a task that ran but still
needs browser evidence, SQL/API writeback, or frontend-visible verification is
listed as recovery work.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "apps/inventory-sync/artifacts"
WEB_DATA = ROOT / "apps/web-cockpit/public/data"
OUT_JSON = ARTIFACTS / "latest-morning-recovery-queue.json"
OUT_WEB_JSON = WEB_DATA / "latest-morning-recovery-queue.json"
OUT_MD = ARTIFACTS / "manual/morning-recovery-queue-2026-05-28.md"


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def iso_now() -> str:
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).isoformat(timespec="seconds")


def report(task_id: str) -> dict[str, Any]:
    reports = load_json(ARTIFACTS / "latest-scheduled-task-reports.json", {})
    value = reports.get(task_id)
    return value if isinstance(value, dict) else {}


def runner_slot(task_id: str, slot_prefix: str) -> dict[str, Any]:
    status = load_json(ARTIFACTS / "latest-scheduled-task-runner-status.json", {})
    runs = status.get("lastTaskRuns") if isinstance(status, dict) else {}
    if not isinstance(runs, dict):
        return {}
    for key, value in sorted(runs.items()):
        if key.startswith(f"{task_id}@{slot_prefix}") and isinstance(value, dict):
            return value
    return {}


def count_gap_queue() -> int:
    data = load_json(ARTIFACTS / "latest-retail-core-sync-gap-queue.json", {})
    items = data.get("items") if isinstance(data, dict) else []
    return sum(1 for item in items if isinstance(item, dict) and item.get("status") == "open")


def add_task(
    tasks: list[dict[str, Any]],
    *,
    task_id: str,
    title: str,
    priority: int,
    status: str,
    reason: str,
    owner: str,
    due_slots: list[str],
    actions: list[str],
    success: list[str],
    command: str | None = None,
    evidence_paths: list[str] | None = None,
    note: str | None = None,
) -> None:
    task = {
        "taskId": task_id,
        "title": title,
        "priority": priority,
        "status": status,
        "reason": reason,
        "owner": owner,
        "dueSlots": due_slots,
        "actions": actions,
        "successCriteria": success,
        "commandAfterEvidence": command,
        "evidencePaths": evidence_paths or [],
    }
    if note:
        task["note"] = note
    tasks.append(task)


def build() -> dict[str, Any]:
    tasks: list[dict[str, Any]] = []
    semi = load_json(ARTIFACTS / "latest-semi-auto-execution-plan.json", {})
    semi_summary = semi.get("summary") if isinstance(semi, dict) else {}
    open_gaps = count_gap_queue()

    z = report("zhidiantong-sync-cycle")
    if z.get("executionOutcome") != "real_completed":
        add_task(
            tasks,
            task_id="recovery-zhidiantong-same-day-source-closure",
            title="补采今日智店通出入库、销售订单、调拨与教育补代扫",
            priority=100,
            status="must_run",
            reason=z.get("blockingReason") or f"SQL open gap={open_gaps}",
            owner="智店通/出入库采集智能体",
            due_slots=["11:15", "12:00", "12:45"],
            note="11 缺 SN SKU 目标清单（1-10 优先级排序：20003216→20007932→20008103→20002811→20007936→20007931→20007934→20004481→20004636→20004637→20006806；共 16 SN 缺口）已固化在 docs/ai-context/01_CURRENT_STATE.md 2026-06-08 11:10 节；本轮真实补采动作触发时按 1→10 顺序逐个 SN 补录。脚本侧 title audit 已 0 issue / pass，in-app zhidiantong-sync-cycle outcome 已 executed_not_closed。",
            actions=[
                "使用当前默认 Chrome 已登录会话，先进入网页微信智店通入库群，按图片左箭头扫到上次已采边界，生成 education-agent-scan-2026-05-28-*.json。",
                "进入智店通：线下门店订单 -> 已完成 -> 下单时间 2026-05-28 00:00-23:59:59 -> 搜索，读取总条数/页数，每页同时导出 orderData 与 orderProductData。",
                "同轮导出/采集库存流水、SN库存订单、商品库存统计、商品库存SN统计、采购入库、其他出库、调拨出库、调拨入库。",
                "调拨出库/调拨入库只进入库存、SN 和出入库流水，不计入营销 PO、教育补贴或价保申请计算。",
            ],
            success=[
                "当天源文件齐全且记录文件名、页面总条数、导出条数、导出明细条数。",
                "order_sync_registry / sync_gap_queue open 缺口下降，今日订单金额不再缺 sales_order_amount_snapshot。",
                "前端出入库流水、销售单流水、教育补代扫汇总、库存/SN 状态可见更新。",
            ],
            command="bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle",
            evidence_paths=[
                "apps/inventory-sync/artifacts/manual/education-agent-scan/",
                "/Users/luxiangnan/Downloads/orderData*.xlsx",
                "/Users/luxiangnan/Downloads/orderProductData*.xlsx",
            ],
        )

    jd = report("daily-jd-lenovo-price-sync")
    if jd.get("executionOutcome") != "real_completed":
        pending = (semi_summary or {}).get("retailPriceVerificationCount")
        add_task(
            tasks,
            task_id="recovery-jd-lenovo-locked-link-review",
            title="补采已锁定京东/联想链接真实价格复核",
            priority=90,
            status="must_run",
            reason=jd.get("blockingReason") or f"待复核 {pending} 条",
            owner="价格复核智能体",
            due_slots=["10:00", "11:00", "12:00"],
            actions=[
                "只用当前默认 Chrome 已登录会话打开已锁定链接；不得新开浏览器/Profile，不得无头采集。",
                "逐条点到目标规格、颜色、版本后记录主标题、副标题/配置、已选规格、商品编号、主价、券/国补/PLUS/活动拆分。",
                "白色款单独复采；同配不能只按标题判死刑，必须反复确认原链接规格区。",
                "批量归集后统一写入手工价格批次，再重建 product-url-locks、collection-plan、retail-price-audit、retail-zone。",
            ],
            success=[
                "62 条已锁定链接待复核数下降。",
                "前端零售卡片的京东/官旗/天猫价格和同配状态可见更新。",
            ],
            command="bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync",
        )

    gray = report("daily-gray-channel-check")
    if gray.get("executionOutcome") != "real_completed":
        add_task(
            tasks,
            task_id="recovery-gray-channel-today-original",
            title="补采灰渠公众号当天原文/截图",
            priority=85,
            status="must_run",
            reason=gray.get("blockingReason") or "缺当天灰渠原文",
            owner="灰渠报价智能体",
            due_slots=["11:50"],
            actions=[
                "使用当前默认 Chrome 已登录 https://localhost:3001/ 网页微信。",
                "从文件传输助手聊天记录区固定公众号入口进入，不走收藏夹旧入口。",
                "进入公众号后必须继续打开当天报价菜单、当天原文或当天截图；只进入公众号页不算完成。",
                "保存 raw 文本、截图或 OCR 证据，再写 SQL/API 并前端验收。",
            ],
            success=[
                "latest-gray-wholesale-quotes.json 为 2026-05-28 当天来源，isCarriedForward=false。",
                "前端灰渠报价区显示当天来源证据。",
            ],
            command="bash scripts/run_scheduled_task.sh daily-gray-channel-check",
            evidence_paths=["apps/inventory-sync/artifacts/manual/gray-channel*20260528*"],
        )

    comp_run = runner_slot("daily-competitor-monitor-check", "2026-05-28T04:00")
    comp_report = report("daily-competitor-monitor-check")
    if comp_run.get("businessOutcome") != "real_completed" or comp_report.get("finishedAt", "").startswith("2026-05-27"):
        add_task(
            tasks,
            task_id="recovery-competitor-monitor-today",
            title="补采当天竞品真实排行与价格",
            priority=75,
            status="must_run",
            reason=comp_run.get("blockingReason") or comp_report.get("blockingReason") or "latest report 未更新到 2026-05-28",
            owner="竞品采集智能体",
            due_slots=["04:00"],
            actions=[
                "读取 latest-competitor-collection-plan.json。",
                "使用当前默认 Chrome 已登录会话逐店补采联想/THINK/华硕/惠普/华为等当天真实竞品排行与价格。",
                "不能用上一版基线冒充当天采集；缺店铺必须标记缺口。",
            ],
            success=[
                "latest-competitor-monitor.json generatedAt 更新到 2026-05-28。",
                "竞品前端和飞书播报使用当天真实采集。",
            ],
            command="bash scripts/run_scheduled_task.sh daily-competitor-monitor-check",
        )

    warranty = report("sn-warranty-backfill")
    if warranty.get("executionOutcome") != "real_completed":
        add_task(
            tasks,
            task_id="recovery-sn-warranty-visible-query",
            title="补采 SN 保修可见页面证据",
            priority=55,
            status="defer_after_main_sales_price",
            reason=warranty.get("blockingReason") or "保修队列未收口",
            owner="保修补录智能体",
            due_slots=["12:20"],
            actions=[
                "先处理库存/价格/出入库主链，再补保修。",
                "使用当前默认 Chrome 已登录会话低频打开联想保修查询页，保存当天手工证据。",
                "不得后台脚本批量查询网页或接口冒充人工采集。",
            ],
            success=[
                "64 条保修队列减少。",
                "前端 SN 保修字段可见更新。",
            ],
            command="bash scripts/run_scheduled_task.sh sn-warranty-backfill",
        )

    price = report("daily-price-channel-check")
    if price.get("executionOutcome") == "real_completed":
        add_task(
            tasks,
            task_id="verify-distributor-price-frontend-visible",
            title="复核分销报价已同步前端可见",
            priority=50,
            status="verify_only",
            reason="报告显示 2026-05-28 分销库存文件已同步，但仍需前端可见验收，避免用户侧感知为未执行。",
            owner="报价验收智能体",
            due_slots=["11:30"],
            actions=[
                "打开前端报价/库存零售价相关页面，确认 latest-distributor-quotes 的 2026-05-28 报价已显示。",
                "若前端未显示，重跑 daily-price-channel-check 后执行快照重建与前端刷新。",
            ],
            success=[
                "前端显示 2026-05-28 分销报价来源和关键商品实时进货价。",
            ],
            command="bash scripts/run_scheduled_task.sh daily-price-channel-check",
        )

    summary = {
        "mustRunCount": sum(1 for task in tasks if task["status"] == "must_run"),
        "verifyOnlyCount": sum(1 for task in tasks if task["status"] == "verify_only"),
        "deferCount": sum(1 for task in tasks if task["status"].startswith("defer")),
        "openSyncGapCount": open_gaps,
        "retailPriceVerificationCount": (semi_summary or {}).get("retailPriceVerificationCount"),
        "warrantyGapCount": (semi_summary or {}).get("warrantyGapCount"),
    }
    return {
        "generatedAt": iso_now(),
        "businessDate": "2026-05-28",
        "window": "morning-before-noon-and-first-noon-slots",
        "policy": "脚本触发不等于完成；缺真实证据、SQL/API 写入或前端可见验收即进入补采队列。",
        "summary": summary,
        "tasks": sorted(tasks, key=lambda task: -task["priority"]),
    }


def write_markdown(queue: dict[str, Any]) -> None:
    lines = [
        "# 2026-05-28 上午未收口补采执行清单",
        "",
        f"- 生成时间：{queue['generatedAt']}",
        f"- 口径：{queue['policy']}",
        f"- 必须补采：{queue['summary']['mustRunCount']} 项；仅验收：{queue['summary']['verifyOnlyCount']} 项；低优先级延后：{queue['summary']['deferCount']} 项。",
        "",
    ]
    for index, task in enumerate(queue["tasks"], 1):
        lines.extend(
            [
                f"## {index}. {task['title']}",
                f"- taskId：`{task['taskId']}`",
                f"- 状态：`{task['status']}`",
                f"- 负责智能体：{task['owner']}",
                f"- 上午时段：{', '.join(task['dueSlots'])}",
                f"- 未收口原因：{task['reason']}",
                "- 执行动作：",
            ]
        )
        lines.extend([f"  - {action}" for action in task["actions"]])
        lines.append("- 收口标准：")
        lines.extend([f"  - {item}" for item in task["successCriteria"]])
        if task.get("commandAfterEvidence"):
            lines.append(f"- 证据到位后命令：`{task['commandAfterEvidence']}`")
        lines.append("")
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    queue = build()
    OUT_JSON.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_WEB_JSON.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(queue)
    print(json.dumps({"ok": True, "json": str(OUT_JSON), "webJson": str(OUT_WEB_JSON), "markdown": str(OUT_MD), "summary": queue["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
