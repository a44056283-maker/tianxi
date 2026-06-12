from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = REPO_ROOT / "docs" / "commercialization"
INPUT_PATH = DOCS_DIR / "commercialization-progress.manual.json"
JSON_OUTPUT_PATH = DOCS_DIR / "commercialization-progress.latest.json"
MARKDOWN_OUTPUT_PATH = DOCS_DIR / "商业化进度追踪.md"
HTML_OUTPUT_PATH = DOCS_DIR / "商业化进度看板.html"

DB_PATH = REPO_ROOT / "apps" / "api-server" / "data" / "retail-core.sqlite3"
SERVICE_PATH = REPO_ROOT / "apps" / "web-cockpit" / "src" / "domain" / "inventoryQuote" / "service.ts"
RETAIL_CORE_PATH = REPO_ROOT / "apps" / "api-server" / "app" / "retail_core.py"
MAIN_API_PATH = REPO_ROOT / "apps" / "api-server" / "app" / "main.py"
BOOKMARK_AUDIT_PATH = REPO_ROOT / "docs" / "ai-context" / "16_BOOKMARK_SQL_AUDIT.md"
CURRENT_STATE_PATH = REPO_ROOT / "docs" / "ai-context" / "01_CURRENT_STATE.md"
TASK_LOG_PATH = REPO_ROOT / "docs" / "ai-context" / "03_TASK_LOG.md"
NEXT_ACTIONS_PATH = REPO_ROOT / "docs" / "ai-context" / "04_NEXT_ACTIONS.md"
HANDOFF_PATH = REPO_ROOT / "docs" / "ai-context" / "09_CODEX_HANDOFF.md"
TEST_LOG_PATH = REPO_ROOT / "docs" / "ai-context" / "10_TEST_LOG.md"
BACKUP_SCRIPT_PATH = REPO_ROOT / "scripts" / "backup_retail_core_to_archive.sh"
SCHEDULED_REPORTS_PATH = REPO_ROOT / "apps" / "inventory-sync" / "artifacts" / "latest-scheduled-task-reports.json"
WATCHDOG_PATH = REPO_ROOT / "apps" / "inventory-sync" / "artifacts" / "latest-scheduled-task-watchdog.json"
DATA_DIR = REPO_ROOT / "apps" / "web-cockpit" / "public" / "data"

TZ = ZoneInfo("Asia/Shanghai")


def now_cn() -> datetime:
    return datetime.now(TZ)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def first_match(text: str, pattern: str, default: str = "") -> str:
    matched = re.search(pattern, text, flags=re.MULTILINE)
    if not matched:
        return default
    return matched.group(1)


@dataclass
class DimensionResult:
    key: str
    label: str
    max_score: int
    score: int
    evidence: list[str]
    blockers: list[str]


def scan_sql() -> dict[str, Any]:
    result = {
        "dbExists": DB_PATH.exists(),
        "tables": [],
        "counts": {},
        "openSyncGapCount": 0,
        "openSyncGapSeverity": {},
        "tableHasTenantStore": {},
    }
    if not DB_PATH.exists():
        return result

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        ]
        result["tables"] = tables

        target_tables = [
            "product",
            "sku",
            "serial_item",
            "inventory_movement",
            "sales_order",
            "sales_order_line",
            "purchase_order",
            "purchase_order_line",
            "external_system",
            "sync_task",
            "order_sync_registry",
            "sync_gap_queue",
            "snapshot_cache",
            "warranty_record",
            "sales_price_protection_history",
            "distributor_quote_current",
            "gray_wholesale_quote_current",
            "inventory_price_signal_current",
            "product_library_product",
            "product_library_evidence",
            "product_library_source_link",
        ]
        for table in target_tables:
            if table in tables:
                result["counts"][table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            else:
                result["counts"][table] = None

        if "sync_gap_queue" in tables:
            result["openSyncGapCount"] = conn.execute(
                "SELECT COUNT(*) FROM sync_gap_queue WHERE status = 'open'"
            ).fetchone()[0]
            severities = conn.execute(
                "SELECT severity, COUNT(*) AS count FROM sync_gap_queue WHERE status = 'open' GROUP BY severity"
            ).fetchall()
            result["openSyncGapSeverity"] = {
                str(row["severity"] or "unknown"): int(row["count"] or 0) for row in severities
            }

        for table in ["sku", "serial_item", "inventory_movement", "sales_order", "purchase_order"]:
            if table not in tables:
                result["tableHasTenantStore"][table] = False
                continue
            columns = {
                row[1]
                for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            result["tableHasTenantStore"][table] = "tenant_id" in columns and "store_id" in columns

    return result


def scan_scheduled_tasks() -> dict[str, Any]:
    reports = load_json(SCHEDULED_REPORTS_PATH, {})
    watchdog = load_json(WATCHDOG_PATH, {})
    outcomes = Counter()
    statuses = Counter()
    task_rows: list[dict[str, Any]] = []
    for task_name, payload in reports.items():
        if not isinstance(payload, dict):
            continue
        outcome = str(payload.get("executionOutcome") or "unknown")
        status = str(payload.get("status") or "unknown")
        outcomes[outcome] += 1
        statuses[status] += 1
        task_rows.append(
            {
                "taskName": task_name,
                "status": status,
                "executionOutcome": outcome,
                "blockingReason": str(payload.get("blockingReason") or "").strip(),
                "finishedAt": str(payload.get("finishedAt") or "").strip(),
            }
        )
    task_rows.sort(key=lambda item: item["taskName"])
    return {
        "taskCount": len(task_rows),
        "outcomes": dict(outcomes),
        "statuses": dict(statuses),
        "tasks": task_rows,
        "watchdog": {
            "generatedAt": watchdog.get("generatedAt"),
            "missedCount": watchdog.get("summary", {}).get("missedCount"),
            "attentionCount": watchdog.get("summary", {}).get("attentionCount"),
            "pendingCount": watchdog.get("summary", {}).get("pendingCount"),
        },
    }


def scan_files() -> dict[str, Any]:
    service_text = read_text(SERVICE_PATH)
    retail_core_text = read_text(RETAIL_CORE_PATH)
    bookmark_audit = read_text(BOOKMARK_AUDIT_PATH)
    main_api_text = read_text(MAIN_API_PATH)

    snapshot_files = [
        "latest-standard-inventory-snapshot.json",
        "latest-adjusted-inventory-snapshot.json",
        "latest-inventory-master-snapshot.json",
        "latest-inventory-movements.json",
        "latest-retail-zone-snapshot.json",
        "latest-price-protection-snapshot.json",
        "latest-marketing-boost-snapshot.json",
        "latest-marketing-boost-hero-snapshot.json",
        "latest-distributor-quotes.json",
        "latest-gray-wholesale-quotes.json",
        "latest-retail-core-price-signals.json",
        "latest-scheduled-task-dashboard.json",
    ]
    existing_snapshots = [name for name in snapshot_files if (DATA_DIR / name).exists()]

    return {
        "hasMockImport": "../../mock/inventoryQuote.mock" in service_text,
        "hasApiStrictAudit": "api_strict" in bookmark_audit,
        "hasSnapshotCacheMention": "snapshot_cache" in bookmark_audit or "snapshot_cache" in retail_core_text,
        "hasOrderClosureTablesMention": "order_sync_registry" in retail_core_text and "sync_gap_queue" in retail_core_text,
        "hasBackupScript": BACKUP_SCRIPT_PATH.exists(),
        "hasLaunchAgentAuditLog": "LaunchAgent" in read_text(CURRENT_STATE_PATH),
        "hasApiCreateOrderInputs": "class SalesOrderCreateInput" in main_api_text and "class PurchaseOrderCreateInput" in main_api_text,
        "hasLocalSyncModule": (REPO_ROOT / "apps" / "inventory-sync" / "src" / "localRetailSync").exists(),
        "hasMarketingSnapshot": (DATA_DIR / "latest-marketing-boost-snapshot.json").exists(),
        "hasPriceProtectionSnapshot": (DATA_DIR / "latest-price-protection-snapshot.json").exists(),
        "hasWarrantyQueueSnapshot": (DATA_DIR / "latest-warranty-check-queue.json").exists(),
        "snapshotFilesPresent": existing_snapshots,
        "docSetPresent": all(path.exists() for path in [
            CURRENT_STATE_PATH,
            TASK_LOG_PATH,
            NEXT_ACTIONS_PATH,
            HANDOFF_PATH,
            TEST_LOG_PATH,
        ]),
    }


def build_dimension_results(sql_scan: dict[str, Any], task_scan: dict[str, Any], file_scan: dict[str, Any]) -> list[DimensionResult]:
    counts = sql_scan["counts"]
    outcomes = task_scan["outcomes"]
    blocked_task_count = (
        outcomes.get("executed_not_closed", 0)
        + outcomes.get("blocked_missing_input", 0)
        + outcomes.get("blocked_page_risk", 0)
    )

    product_score = 0
    product_evidence: list[str] = []
    product_blockers: list[str] = []
    if counts.get("sku") and counts.get("serial_item") and counts.get("inventory_movement"):
        product_score += 4
        product_evidence.append("SKU、SN、库存流水主表已落 SQLite。")
    if counts.get("sales_order") is not None and counts.get("purchase_order") is not None:
        product_score += 3
        product_evidence.append("销售单、采购单基础表已存在。")
    if file_scan["hasMarketingSnapshot"] and file_scan["hasPriceProtectionSnapshot"]:
        product_score += 2
        product_evidence.append("营销活动和价保快照已具备展示链。")
    if sql_scan["counts"].get("order_sync_registry") is not None and sql_scan["counts"].get("sync_gap_queue") is not None:
        product_score += 2
        product_evidence.append("出入库订单闭环已具备 registry + gap queue。")
    if file_scan["hasApiStrictAudit"]:
        product_score += 2
        product_evidence.append("主书签页默认口径已切到 api_strict 审计。")
    if file_scan["hasWarrantyQueueSnapshot"]:
        product_score += 1
        product_evidence.append("保修补齐队列和后台补录链已存在。")
    if file_scan["hasMockImport"]:
        product_score -= 1
        product_blockers.append("前端 service 仍保留 mock 引用，说明展示层还有过渡实现。")
    if blocked_task_count > 0:
        product_score -= 2
        product_blockers.append("多个定时任务仍处于未收口或阻塞状态。")
    product_score = clamp(product_score, 0, 20)

    data_score = 0
    data_evidence: list[str] = []
    data_blockers: list[str] = []
    if sql_scan["dbExists"]:
        data_score += 5
        data_evidence.append("商业主库 SQLite 已长期运行。")
    if counts.get("snapshot_cache") is not None:
        data_score += 3
        data_evidence.append("snapshot_cache 已承接主要静态快照镜像。")
    if counts.get("order_sync_registry") is not None and counts.get("sync_gap_queue") is not None:
        data_score += 2
        data_evidence.append("订单闭环缺口已结构化入库。")
    if file_scan["hasBackupScript"]:
        data_score += 2
        data_evidence.append("已存在 SQL 备份归档脚本。")
    if file_scan["hasSnapshotCacheMention"]:
        data_score += 2
        data_evidence.append("SQL 主链 + 快照镜像边界已有专门审计文档。")
    if not any(sql_scan["tableHasTenantStore"].values()):
        data_blockers.append("核心业务表尚未补 tenant_id / store_id。")
        data_score -= 1
    data_blockers.append("市场价格、链接、营销历史仍有 snapshot_cache 过渡态。")
    data_score = clamp(data_score, 0, 20)

    delivery_score = 0
    delivery_evidence: list[str] = []
    delivery_blockers: list[str] = []
    if file_scan["hasApiCreateOrderInputs"]:
        delivery_score += 2
        delivery_evidence.append("本地 API 已具备销售单/采购单基础写入入口。")
    if file_scan["hasLocalSyncModule"]:
        delivery_score += 2
        delivery_evidence.append("本地零售同步模块和智店通同步骨架已存在。")
    if file_scan["hasBackupScript"]:
        delivery_score += 1
        delivery_evidence.append("备份归档可作为试点交付基础能力。")
    delivery_blockers.extend([
        "仍缺标准的新租户、新门店、初始化导入向导。",
        "还没有形成正式的实施包、恢复演练和客户开通流程。",
    ])
    delivery_score = clamp(delivery_score, 0, 15)

    tenant_score = 1 if "tenantId" in read_text(REPO_ROOT / "apps" / "inventory-sync" / "src" / "config.ts") else 0
    tenant_evidence = ["配置层已出现 tenantId 字段。"] if tenant_score else []
    tenant_blockers = [
        "SQL 主表没有 tenant_id / store_id 全链路字段。",
        "缺少 user / role / permission / audit_log 这类商业权限基础表。",
    ]
    tenant_score = clamp(tenant_score, 0, 10)

    api_score = 0
    api_evidence: list[str] = []
    api_blockers: list[str] = []
    if file_scan["hasApiCreateOrderInputs"]:
        api_score += 2
        api_evidence.append("FastAPI 已有本地写入类接口输入模型。")
    if file_scan["hasLocalSyncModule"]:
        api_score += 2
        api_evidence.append("本地同步和第三方同步骨架已存在。")
    if file_scan["hasApiStrictAudit"]:
        api_score += 1
        api_evidence.append("前端已按 api_strict 审计主读链。")
    if counts.get("external_system") is not None and counts.get("sync_task") is not None:
        api_score += 1
        api_evidence.append("外部系统与同步任务表已存在。")
    api_blockers.extend([
        "未看到正式 OpenAPI 文档、鉴权、错误码和回调规范。",
        "现阶段更像内部 API，不是客户可直接对接的标准接口包。",
    ])
    api_score = clamp(api_score, 0, 10)

    ops_score = 0
    ops_evidence: list[str] = []
    ops_blockers: list[str] = []
    if task_scan["taskCount"] > 0:
        ops_score += 2
        ops_evidence.append("定时任务体系、回执、watchdog 已成形。")
    if file_scan["hasBackupScript"]:
        ops_score += 2
        ops_evidence.append("备份归档脚本已落地。")
    if file_scan["hasLaunchAgentAuditLog"]:
        ops_score += 1
        ops_evidence.append("已有启动链和服务巡检记录。")
    if task_scan["watchdog"].get("generatedAt"):
        ops_score += 1
        ops_evidence.append("watchdog 最近一次巡检时间可追。")
    ops_blockers.extend([
        "今天仍有多个任务未收口，说明运行稳定性还不够商业级。",
        "API、前端、微信桥、浏览器会话仍依赖环境条件，恢复链未完全标准化。",
    ])
    ops_score = clamp(ops_score, 0, 10)

    docs_score = 0
    docs_evidence: list[str] = []
    docs_blockers: list[str] = []
    if file_scan["docSetPresent"]:
        docs_score += 3
        docs_evidence.append("ai-context 文档、测试日志、交接文档较完整。")
    if BOOKMARK_AUDIT_PATH.exists():
        docs_score += 1
        docs_evidence.append("书签页 SQL 对接审计文档已单列。")
    if TEST_LOG_PATH.exists():
        docs_score += 1
        docs_evidence.append("已有持续测试日志。")
    docs_blockers.extend([
        "缺对外的实施手册、初始化手册、客户 API 对接手册。",
        "还没有正式报价模板、合同边界、SLA 文档。",
    ])
    docs_score = clamp(docs_score, 0, 10)

    pricing_score = 2
    pricing_evidence = ["已形成按平台费 + 模块费 + 对接费 + 运维费的商业化定价思路。"]
    pricing_blockers = [
        "仍缺正式模块报价单、合同边界、实施边界和运维 SLA 模板。",
    ]

    return [
        DimensionResult("product", "产品完整度", 20, product_score, product_evidence, product_blockers),
        DimensionResult("data", "数据架构", 20, data_score, data_evidence, data_blockers),
        DimensionResult("delivery", "商业交付能力", 15, delivery_score, delivery_evidence, delivery_blockers),
        DimensionResult("tenant", "多租户与权限", 10, tenant_score, tenant_evidence, tenant_blockers),
        DimensionResult("api", "API 与集成能力", 10, api_score, api_evidence, api_blockers),
        DimensionResult("ops", "稳定性与运维", 10, ops_score, ops_evidence, ops_blockers),
        DimensionResult("docs", "文档与实施", 10, docs_score, docs_evidence, docs_blockers),
        DimensionResult("pricing", "定价与合同化", 5, pricing_score, pricing_evidence, pricing_blockers),
    ]


def build_module_progress(sql_scan: dict[str, Any], task_scan: dict[str, Any], file_scan: dict[str, Any]) -> list[dict[str, Any]]:
    counts = sql_scan["counts"]
    outcomes = task_scan["outcomes"]

    inventory_score = 68
    movements_score = 61
    marketing_score = 46

    if counts.get("serial_item", 0) and counts.get("inventory_movement", 0):
        inventory_score += 0
    if outcomes.get("real_completed", 0) >= 1:
        inventory_score += 0
    if sql_scan["openSyncGapCount"] > 0:
        movements_score -= 4
    if outcomes.get("executed_not_closed", 0) > 0:
        movements_score -= 2
    if not file_scan["hasMockImport"]:
        inventory_score += 2
    if counts.get("sales_price_protection_history", 0):
        marketing_score += 2
    if counts.get("snapshot_cache", 0):
        marketing_score += 0

    inventory_score = clamp(inventory_score, 0, 100)
    movements_score = clamp(movements_score, 0, 100)
    marketing_score = clamp(marketing_score, 0, 100)

    return [
        {
            "key": "inventory",
            "label": "库存 / SN",
            "score": inventory_score,
            "summary": "库存、SN、保修、主表和前端展示已经有真实主链，但仍存在前端过渡读链和商业化隔离缺口。",
        },
        {
            "key": "movements",
            "label": "出入库",
            "score": movements_score,
            "summary": "销售出库、采购入库、其他出库和订单闭环已经结构化，但当天金额快照缺口仍会导致任务未收口。",
        },
        {
            "key": "marketing",
            "label": "营销 / 价保 / 补贴",
            "score": marketing_score,
            "summary": "营销、价保、教育补已有展示与历史材料，但目前仍以快照镜像和局部历史表为主，离商业化历史链还差一段。",
        },
    ]


def build_blockers(sql_scan: dict[str, Any], task_scan: dict[str, Any], file_scan: dict[str, Any]) -> list[str]:
    blockers = [
        "核心业务表尚未补 tenant_id / store_id，多租户和门店隔离还没有真正落库。",
        "前端 `service.ts` 仍保留 mock 引用，说明展示层还有过渡实现没有完全清掉。",
        "市场价格、链接、营销活动大量数据仍处于 `snapshot_cache` 过渡态，历史表尚未全面规范化。",
    ]
    if sql_scan["openSyncGapCount"] > 0:
        blockers.append(f"当前 `sync_gap_queue` 仍有 {sql_scan['openSyncGapCount']} 条 open 缺口，出入库尚未完全商业级收口。")
    watchdog = task_scan["watchdog"]
    if watchdog.get("missedCount") or watchdog.get("attentionCount"):
        blockers.append(
            f"最近一次 watchdog 仍有 missed={watchdog.get('missedCount', 0)} / attention={watchdog.get('attentionCount', 0)}。"
        )
    return blockers


def build_next_actions() -> list[str]:
    return [
        "先把 `库存 / SN / 出入库 / 营销` 相关核心业务表补 `tenant_id / store_id`，同时补 `tenant / store / user / role / permission` 基础表。",
        "继续把 `marketplace-prices / product-url-locks / marketing-boost / education-agent-scan / competitor-monitor / warranty-check-queue` 从 `snapshot_cache` 推进到正式 SQL 历史表或读模型。",
        "优先收口今天的出入库缺口：补齐缺失 `orderData / orderProductData` 金额快照，清空 `sync_gap_queue` 当前 open 项。",
        "把前端 `inventoryQuote/service.ts` 的 mock/静态兜底进一步收紧，确保商业化看板默认只吃 API/SQL 主链。",
        "补第一版对外产物：最小 API 文档、初始化导入 SOP、备份恢复 SOP、模块报价清单。",
    ]


def build_report() -> dict[str, Any]:
    manual = load_json(INPUT_PATH, {})
    sql_scan = scan_sql()
    task_scan = scan_scheduled_tasks()
    file_scan = scan_files()
    dimensions = build_dimension_results(sql_scan, task_scan, file_scan)
    module_progress = build_module_progress(sql_scan, task_scan, file_scan)
    blockers = build_blockers(sql_scan, task_scan, file_scan)
    next_actions = build_next_actions()
    overall_score = sum(item.score for item in dimensions)

    stage_targets = manual.get("stageTargets", [
        {"label": "试点版", "targetScore": 70},
        {"label": "标准商用版", "targetScore": 85},
        {"label": "连锁复制版", "targetScore": 100},
    ])
    current_target = next((item for item in stage_targets if overall_score < int(item["targetScore"])), stage_targets[-1])

    return {
        "generatedAt": now_cn().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "sourceDocument": manual.get("sourceDocument"),
        "overallScore": overall_score,
        "targetStage": current_target,
        "stageTargets": stage_targets,
        "priorityModules": manual.get("priorityModules", []),
        "baselineNotes": manual.get("baselineNotes", []),
        "userReportedFacts": manual.get("userReportedFacts", []),
        "dimensions": [
            {
                "key": item.key,
                "label": item.label,
                "score": item.score,
                "maxScore": item.max_score,
                "evidence": item.evidence,
                "blockers": item.blockers,
            }
            for item in dimensions
        ],
        "moduleProgress": module_progress,
        "systemScan": {
            "sql": sql_scan,
            "scheduledTasks": task_scan,
            "files": file_scan,
        },
        "blockers": blockers,
        "nextActions": next_actions,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# 联想智慧零售系统商业化进度追踪")
    lines.append("")
    lines.append(f"- 更新时间：`{report['generatedAt']}`")
    lines.append(f"- 当前商业化成熟度：`{report['overallScore']}/100`")
    lines.append(f"- 当前冲刺目标：`{report['targetStage']['label']} {report['targetStage']['targetScore']}/100`")
    lines.append("")
    lines.append("## 1. 结论")
    lines.append("")
    lines.append(f"- 当前系统已从“约 1/3 功能的自用系统”推进到 `商业化成熟度 {report['overallScore']}/100`。")
    lines.append("- 现在可以继续按 `共创试点版` 方向推进，但还不能按成熟标准化 SaaS 对外规模售卖。")
    lines.append("- 当前最值得先收口的三条主线仍是：`库存 / SN`、`出入库`、`营销 / 价保 / 补贴`。")
    lines.append("")
    lines.append("## 2. 八维评分")
    lines.append("")
    lines.append("| 维度 | 当前分值 | 满分 | 说明 |")
    lines.append("| --- | ---: | ---: | --- |")
    for item in report["dimensions"]:
        evidence = "；".join(item["evidence"][:2]) or "待补"
        lines.append(f"| {item['label']} | {item['score']} | {item['maxScore']} | {evidence} |")
    lines.append("")
    lines.append("## 3. 重点模块")
    lines.append("")
    lines.append("| 模块 | 当前进度 | 说明 |")
    lines.append("| --- | ---: | --- |")
    for item in report["moduleProgress"]:
        lines.append(f"| {item['label']} | {item['score']}% | {item['summary']} |")
    lines.append("")
    lines.append("## 4. 当前阻塞")
    lines.append("")
    for item in report["blockers"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## 5. 定时任务状态摘要")
    lines.append("")
    lines.append(f"- 任务总数：`{report['systemScan']['scheduledTasks']['taskCount']}`")
    lines.append(f"- 执行结果分布：`{json.dumps(report['systemScan']['scheduledTasks']['outcomes'], ensure_ascii=False)}`")
    watchdog = report["systemScan"]["scheduledTasks"]["watchdog"]
    lines.append(
        f"- watchdog：`generatedAt={watchdog.get('generatedAt')}`，`missed={watchdog.get('missedCount')}`，`attention={watchdog.get('attentionCount')}`，`pending={watchdog.get('pendingCount')}`"
    )
    lines.append("")
    lines.append("## 6. 系统扫描依据")
    lines.append("")
    sql = report["systemScan"]["sql"]
    counts = sql["counts"]
    lines.append(f"- SQLite 主库：`{DB_PATH}`")
    lines.append(
        f"- 核心表计数：`sku={counts.get('sku')}`，`serial_item={counts.get('serial_item')}`，`inventory_movement={counts.get('inventory_movement')}`，`sales_order={counts.get('sales_order')}`，`order_sync_registry={counts.get('order_sync_registry')}`，`sync_gap_queue={counts.get('sync_gap_queue')}`"
    )
    lines.append(f"- open 缺口：`{sql['openSyncGapCount']}`")
    lines.append(
        f"- 快照镜像文件数：`{len(report['systemScan']['files']['snapshotFilesPresent'])}`，默认书签口径：`api_strict={'是' if report['systemScan']['files']['hasApiStrictAudit'] else '否'}`"
    )
    lines.append("")
    lines.append("## 7. 后续最该做")
    lines.append("")
    for index, item in enumerate(report["nextActions"], 1):
        lines.append(f"{index}. {item}")
    lines.append("")
    lines.append("## 8. 用户/文档基线")
    lines.append("")
    for item in report.get("userReportedFacts", []):
        lines.append(f"- {item}")
    return "\n".join(lines) + "\n"


def render_html(report: dict[str, Any]) -> str:
    report_json = json.dumps(report, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>联想智慧零售系统商业化进度看板</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f5f7fb;
      --surface: #ffffff;
      --surface-soft: #eef3ff;
      --text: #172033;
      --muted: #5c6880;
      --line: #d8dfec;
      --accent: #2b6fff;
      --accent-soft: #d9e6ff;
      --warn: #b76e00;
      --danger: #b83232;
      --good: #0f7a43;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }}
    .page {{
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }}
    h1, h2, h3, p {{ margin: 0; }}
    .hero {{
      background: linear-gradient(135deg, #173b9e 0%, #2b6fff 68%, #5fa4ff 100%);
      color: #fff;
      border-radius: 8px;
      padding: 24px;
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }}
    .hero-meta {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      align-content: start;
    }}
    .metric {{
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 8px;
      padding: 14px;
      min-height: 84px;
    }}
    .metric .label {{ font-size: 12px; opacity: 0.84; }}
    .metric .value {{ font-size: 28px; font-weight: 700; margin-top: 10px; }}
    .layout {{
      display: grid;
      grid-template-columns: 1.25fr 0.95fr;
      gap: 20px;
    }}
    .panel {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }}
    .panel + .panel {{ margin-top: 20px; }}
    .section-title {{
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
    }}
    .subtle {{
      color: var(--muted);
      font-size: 13px;
    }}
    .bar-list {{ display: grid; gap: 14px; }}
    .bar-row {{ display: grid; gap: 6px; }}
    .bar-head {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
    }}
    .bar-track {{
      width: 100%;
      height: 12px;
      background: #ecf0f7;
      border-radius: 999px;
      overflow: hidden;
    }}
    .bar-fill {{
      height: 100%;
      background: linear-gradient(90deg, #2b6fff 0%, #57a0ff 100%);
      border-radius: 999px;
    }}
    .tag-list {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }}
    .tag {{
      padding: 6px 10px;
      background: var(--surface-soft);
      border: 1px solid #cdddff;
      border-radius: 999px;
      font-size: 12px;
      color: #274387;
    }}
    ul {{
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 10px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    th, td {{
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      vertical-align: top;
      text-align: left;
    }}
    th {{
      color: var(--muted);
      font-weight: 600;
      font-size: 12px;
    }}
    .tone-danger {{ color: var(--danger); }}
    .tone-warn {{ color: var(--warn); }}
    .tone-good {{ color: var(--good); }}
    @media (max-width: 980px) {{
      .hero, .layout {{
        grid-template-columns: 1fr;
      }}
      .hero-meta {{
        grid-template-columns: 1fr 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="page" id="app"></div>
  <script>
    const report = {report_json};

    function barRow(label, score, maxScore, note) {{
      const ratio = Math.max(0, Math.min(100, Math.round(score / maxScore * 100)));
      return `
        <div class="bar-row">
          <div class="bar-head">
            <strong>${{label}}</strong>
            <span>${{score}} / ${{maxScore}}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${{ratio}}%"></div></div>
          <div class="subtle">${{note}}</div>
        </div>
      `;
    }}

    function toneOfTask(item) {{
      if (item.executionOutcome === 'real_completed') return 'tone-good';
      if (item.executionOutcome === 'executed_not_closed') return 'tone-warn';
      return 'tone-danger';
    }}

    const dimensionsHtml = report.dimensions.map(item =>
      barRow(item.label, item.score, item.maxScore, (item.evidence || []).slice(0, 2).join('；') || '待补')
    ).join('');

    const modulesHtml = report.moduleProgress.map(item =>
      barRow(item.label, item.score, 100, item.summary)
    ).join('');

    const tasksHtml = report.systemScan.scheduledTasks.tasks.map(item => `
      <tr>
        <td>${{item.taskName}}</td>
        <td>${{item.status}}</td>
        <td class="${{toneOfTask(item)}}">${{item.executionOutcome}}</td>
        <td>${{item.blockingReason || '—'}}</td>
      </tr>
    `).join('');

    document.getElementById('app').innerHTML = `
      <section class="hero">
        <div>
          <h1>联想智慧零售系统商业化进度看板</h1>
          <p style="margin-top:10px;line-height:1.7;max-width:740px;">
            当前评估口径不是“页面能打开多少”，而是“库存、出入库、营销三条主链距离可售卖标准还有多远”。
          </p>
          <div class="tag-list">
            ${{report.priorityModules.map(item => `<span class="tag">${{item}}</span>`).join('')}}
          </div>
        </div>
        <div class="hero-meta">
          <div class="metric">
            <div class="label">商业化成熟度</div>
            <div class="value">${{report.overallScore}} / 100</div>
          </div>
          <div class="metric">
            <div class="label">当前冲刺目标</div>
            <div class="value">${{report.targetStage.targetScore}}</div>
          </div>
          <div class="metric">
            <div class="label">最近扫描时间</div>
            <div class="value" style="font-size:18px;">${{report.generatedAt}}</div>
          </div>
        </div>
      </section>

      <div class="layout">
        <div>
          <section class="panel">
            <div class="section-title">八维成熟度</div>
            <div class="bar-list">${{dimensionsHtml}}</div>
          </section>
          <section class="panel">
            <div class="section-title">主线模块进度</div>
            <div class="bar-list">${{modulesHtml}}</div>
          </section>
          <section class="panel">
            <div class="section-title">当前阻塞</div>
            <ul>${{report.blockers.map(item => `<li>${{item}}</li>`).join('')}}</ul>
          </section>
        </div>
        <div>
          <section class="panel">
            <div class="section-title">系统扫描摘要</div>
            <div class="subtle" style="line-height:1.8;">
              SQLite 主库：${{report.systemScan.sql.dbExists ? '已存在' : '不存在'}}<br />
              SKU：${{report.systemScan.sql.counts.sku ?? '—'}}<br />
              SN：${{report.systemScan.sql.counts.serial_item ?? '—'}}<br />
              库存流水：${{report.systemScan.sql.counts.inventory_movement ?? '—'}}<br />
              销售单：${{report.systemScan.sql.counts.sales_order ?? '—'}}<br />
              订单缺口：${{report.systemScan.sql.openSyncGapCount}}
            </div>
          </section>
          <section class="panel">
            <div class="section-title">定时任务状态</div>
            <div class="subtle" style="margin-bottom:12px;">
              watchdog：missed=${{report.systemScan.scheduledTasks.watchdog.missedCount ?? '—'}} /
              attention=${{report.systemScan.scheduledTasks.watchdog.attentionCount ?? '—'}} /
              pending=${{report.systemScan.scheduledTasks.watchdog.pendingCount ?? '—'}}
            </div>
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>结果</th>
                  <th>阻塞</th>
                </tr>
              </thead>
              <tbody>${{tasksHtml}}</tbody>
            </table>
          </section>
          <section class="panel">
            <div class="section-title">下一步</div>
            <ul>${{report.nextActions.map(item => `<li>${{item}}</li>`).join('')}}</ul>
          </section>
        </div>
      </div>
    `;
  </script>
</body>
</html>
"""


def write_outputs(report: dict[str, Any]) -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    JSON_OUTPUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    MARKDOWN_OUTPUT_PATH.write_text(render_markdown(report), encoding="utf-8")
    HTML_OUTPUT_PATH.write_text(render_html(report), encoding="utf-8")


def main() -> None:
    report = build_report()
    write_outputs(report)
    print(json.dumps({
        "generatedAt": report["generatedAt"],
        "overallScore": report["overallScore"],
        "targetStage": report["targetStage"],
        "json": str(JSON_OUTPUT_PATH),
        "markdown": str(MARKDOWN_OUTPUT_PATH),
        "html": str(HTML_OUTPUT_PATH),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
