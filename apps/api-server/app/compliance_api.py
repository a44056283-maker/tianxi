"""
compliance_api.py — 合规校验 API 路由
======================================
FastAPI 路由，实现合规规则执行、违规管理、预警查询、规则注册。
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parents[1]
DB_PATH = APP_DIR / "data" / "retail-core.sqlite3"
MIGRATIONS_DIR = APP_DIR / "migrations"

# ---------------------------------------------------------------------------
# 路由实例
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api/compliance", tags=["compliance"])

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Pydantic 模型
# ---------------------------------------------------------------------------


class RuleCreateInput(BaseModel):
    rule_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    severity: str = Field(default="medium")
    entity_type: str = ""
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class ViolationAcknowledgeInput(BaseModel):
    assigned_to: str = ""
    notes: str = ""


class ViolationResolveInput(BaseModel):
    notes: str = ""


class ViolationFilterInput(BaseModel):
    severity: Optional[str] = None
    status: Optional[str] = None
    rule_id: Optional[str] = None
    entity_type: Optional[str] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# ---------------------------------------------------------------------------
# 数据库初始化（运行迁移）
# ---------------------------------------------------------------------------

_compliance_init_lock = threading.Lock()
_compliance_initialized = False


def ensure_compliance_schema(conn: sqlite3.Connection) -> None:
    """确保 compliance 相关表已创建（幂等）"""
    migration_file = MIGRATIONS_DIR / "2026-06-10-compliance.sql"
    if not migration_file.exists():
        return
    sql = migration_file.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


def init_compliance_once() -> None:
    global _compliance_initialized
    if _compliance_initialized:
        return
    with _compliance_init_lock:
        if _compliance_initialized:
            return
        conn = _get_conn()
        try:
            ensure_compliance_schema(conn)
            _compliance_initialized = True
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# 内部 API 函数（供 worker 和路由共用）
# ---------------------------------------------------------------------------

def _persist_violations(
    conn: sqlite3.Connection,
    violations: list[dict],
    scan_run_id: str,
) -> int:
    """将违规列表写入 compliance_violation 表，返回写入数量"""
    count = 0
    for v in violations:
        vid = _new_id()
        conn.execute(
            """
            INSERT INTO compliance_violation
                (id, rule_id, severity, entity_type, entity_id,
                 description, detected_at, status, scan_run_id, metadata_json)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
            """,
            (
                vid,
                v["rule_id"],
                v["severity"],
                v["entity_type"],
                v["entity_id"],
                v["description"],
                _now_iso(),
                scan_run_id,
                v.get("metadata_json", "{}"),
            ),
        )
        count += 1
    conn.commit()
    return count


# ---------------------------------------------------------------------------
# API 端点
# ---------------------------------------------------------------------------

@router.on_event("startup")  # type: ignore[misc]
async def startup_init():
    init_compliance_once()


# --- 运行扫描 ---------------------------------------------------------

class ScanRunResponse(BaseModel):
    ok: bool
    scan_run_id: str
    rules_run: int
    violations_found: int
    violations: list[dict[str, Any]]
    duration_ms: int
    errors: list[str]


@router.post("/check/run", response_model=ScanRunResponse)
async def run_compliance_scan(
    rule_id: str | None = Query(default=None, description="仅运行指定规则"),
) -> ScanRunResponse:
    """
    立即运行全量合规扫描（或指定规则）。
    将违规记录写入 compliance_violation 表。
    """
    import time
    from app.compliance_rules import RuleEngine, ALL_RULES

    start = time.perf_counter()
    scan_run_id = _new_id()
    errors: list[str] = []

    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        engine = RuleEngine(ALL_RULES)
        if rule_id:
            # 仅运行指定规则
            violations = engine.run_rule(conn, rule_id)
            rules_run = 1
        else:
            # 全量运行
            violations = engine.run_all(conn)
            rules_run = len(engine.list_rules(enabled_only=True))

        # 写入数据库
        written = _persist_violations(conn, violations, scan_run_id)

        duration_ms = int((time.perf_counter() - start) * 1000)

        return ScanRunResponse(
            ok=True,
            scan_run_id=scan_run_id,
            rules_run=rules_run,
            violations_found=written,
            violations=violations,
            duration_ms=duration_ms,
            errors=errors,
        )
    except Exception as exc:
        errors.append(f"{type(exc).__name__}: {exc}")
        duration_ms = int((time.perf_counter() - start) * 1000)
        return ScanRunResponse(
            ok=False,
            scan_run_id=scan_run_id,
            rules_run=0,
            violations_found=0,
            violations=[],
            duration_ms=duration_ms,
            errors=errors,
        )
    finally:
        conn.close()


# --- 违规列表 ---------------------------------------------------------

class ViolationListResponse(BaseModel):
    total: int
    items: list[dict[str, Any]]
    limit: int
    offset: int


@router.get("/violations", response_model=ViolationListResponse)
async def list_violations(
    severity: str | None = Query(default=None),
    status: str | None = Query(default=None),
    rule_id: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ViolationListResponse:
    """列出违规记录（支持按严重等级/状态/规则/实体类型过滤）"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        where_parts = []
        params: list[Any] = []

        if severity:
            where_parts.append("severity = ?")
            params.append(severity)
        if status:
            where_parts.append("status = ?")
            params.append(status)
        if rule_id:
            where_parts.append("rule_id = ?")
            params.append(rule_id)
        if entity_type:
            where_parts.append("entity_type = ?")
            params.append(entity_type)
        if from_date:
            where_parts.append("detected_at >= ?")
            params.append(from_date)
        if to_date:
            where_parts.append("detected_at <= ?")
            params.append(to_date)

        where_clause = " AND ".join(where_parts) if where_parts else "1=1"

        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM compliance_violation WHERE {where_clause}",
            params,
        ).fetchone()["cnt"]

        rows = conn.execute(
            f"""
            SELECT id, rule_id, severity, entity_type, entity_id,
                   description, detected_at, status, assigned_to,
                   resolved_at, notes, metadata_json, scan_run_id
            FROM compliance_violation
            WHERE {where_clause}
            ORDER BY
                CASE severity
                    WHEN 'critical' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END,
                detected_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        items = [dict(r) for r in rows]
        # 解析 metadata_json
        for item in items:
            if item.get("metadata_json"):
                try:
                    item["metadata"] = json.loads(item["metadata_json"])
                except Exception:
                    item["metadata"] = {}
            else:
                item["metadata"] = {}

        return ViolationListResponse(
            total=total,
            items=items,
            limit=limit,
            offset=offset,
        )
    finally:
        conn.close()


# --- 确认违规 ---------------------------------------------------------

class ViolationActionResponse(BaseModel):
    ok: bool
    violation_id: str
    action: str
    message: str


@router.post("/violations/{violation_id}/acknowledge", response_model=ViolationActionResponse)
async def acknowledge_violation(
    violation_id: str,
    body: ViolationAcknowledgeInput | None = None,
) -> ViolationActionResponse:
    """确认违规（标记为 acknowledged）"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        existing = conn.execute(
            "SELECT id, status FROM compliance_violation WHERE id = ?",
            (violation_id,),
        ).fetchone()

        if not existing:
            raise HTTPException(status_code=404, detail="违规记录不存在")

        if existing["status"] == "resolved":
            raise HTTPException(status_code=400, detail="已解决的违规不能重新确认")

        assigned_to = body.assigned_to if body else ""
        notes = body.notes if body else ""

        conn.execute(
            """
            UPDATE compliance_violation
            SET status = 'acknowledged',
                assigned_to = COALESCE(NULLIF(?, ''), assigned_to),
                notes = COALESCE(NULLIF(?, ''), notes)
            WHERE id = ?
            """,
            (assigned_to, notes, violation_id),
        )
        conn.commit()

        return ViolationActionResponse(
            ok=True,
            violation_id=violation_id,
            action="acknowledge",
            message="违规已确认",
        )
    finally:
        conn.close()


@router.post("/violations/{violation_id}/resolve", response_model=ViolationActionResponse)
async def resolve_violation(
    violation_id: str,
    body: ViolationResolveInput | None = None,
) -> ViolationActionResponse:
    """解决违规（标记为 resolved）"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        existing = conn.execute(
            "SELECT id FROM compliance_violation WHERE id = ?",
            (violation_id,),
        ).fetchone()

        if not existing:
            raise HTTPException(status_code=404, detail="违规记录不存在")

        notes = body.notes if body else ""

        conn.execute(
            """
            UPDATE compliance_violation
            SET status = 'resolved', resolved_at = ?, notes = COALESCE(NULLIF(?, ''), notes)
            WHERE id = ?
            """,
            (_now_iso(), notes, violation_id),
        )
        conn.commit()

        return ViolationActionResponse(
            ok=True,
            violation_id=violation_id,
            action="resolve",
            message="违规已解决",
        )
    finally:
        conn.close()


# --- 预警列表 ---------------------------------------------------------

class AlertListResponse(BaseModel):
    total: int
    items: list[dict[str, Any]]


@router.get("/alerts", response_model=AlertListResponse)
async def list_alerts(
    violation_id: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AlertListResponse:
    """列出预警记录"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        where_parts = []
        params: list[Any] = []

        if violation_id:
            where_parts.append("violation_id = ?")
            params.append(violation_id)
        if channel:
            where_parts.append("channel = ?")
            params.append(channel)
        if status:
            where_parts.append("status = ?")
            params.append(status)

        where_clause = " AND ".join(where_parts) if where_parts else "1=1"

        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM compliance_alert WHERE {where_clause}",
            params,
        ).fetchone()["cnt"]

        rows = conn.execute(
            f"""
            SELECT id, violation_id, channel, recipient, message,
                   sent_at, acknowledged_at, status, error_message, metadata_json
            FROM compliance_alert
            WHERE {where_clause}
            ORDER BY sent_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        items = [dict(r) for r in rows]
        for item in items:
            if item.get("metadata_json"):
                try:
                    item["metadata"] = json.loads(item["metadata_json"])
                except Exception:
                    item["metadata"] = {}
            else:
                item["metadata"] = {}

        return AlertListResponse(total=total, items=items)
    finally:
        conn.close()


# --- 规则管理 ---------------------------------------------------------

class RuleListResponse(BaseModel):
    rules: list[dict[str, Any]]


@router.get("/rules", response_model=RuleListResponse)
async def list_rules() -> RuleListResponse:
    """列出所有已注册规则"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        rows = conn.execute("""
            SELECT id, rule_id, name, description, severity,
                   entity_type, enabled, config_json, created_at, updated_at
            FROM compliance_rule
            ORDER BY
                CASE severity
                    WHEN 'critical' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END
        """).fetchall()

        rules = []
        for row in rows:
            d = dict(row)
            try:
                d["config"] = json.loads(row["config_json"])
            except Exception:
                d["config"] = {}
            rules.append(d)

        return RuleListResponse(rules=rules)
    finally:
        conn.close()


@router.post("/rules", response_model=dict[str, Any])
async def create_or_update_rule(body: RuleCreateInput) -> dict[str, Any]:
    """新增或更新规则（Upsert）"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        rule_id = body.rule_id
        now = _now_iso()

        existing = conn.execute(
            "SELECT id FROM compliance_rule WHERE rule_id = ?",
            (rule_id,),
        ).fetchone()

        if existing:
            # 更新
            conn.execute(
                """
                UPDATE compliance_rule
                SET name = ?, description = ?, severity = ?,
                    entity_type = ?, enabled = ?, config_json = ?, updated_at = ?
                WHERE rule_id = ?
                """,
                (
                    body.name,
                    body.description,
                    body.severity,
                    body.entity_type,
                    1 if body.enabled else 0,
                    json.dumps(body.config, ensure_ascii=False),
                    now,
                    rule_id,
                ),
            )
            conn.commit()
            message = "规则已更新"
        else:
            # 新增
            new_pk = _new_id()
            conn.execute(
                """
                INSERT INTO compliance_rule
                    (id, rule_id, name, description, severity,
                     entity_type, enabled, config_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_pk,
                    rule_id,
                    body.name,
                    body.description,
                    body.severity,
                    body.entity_type,
                    1 if body.enabled else 0,
                    json.dumps(body.config, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            conn.commit()
            message = "规则已创建"

        return {"ok": True, "rule_id": rule_id, "message": message}
    finally:
        conn.close()


# --- 统计摘要 ---------------------------------------------------------

class ComplianceStatsResponse(BaseModel):
    today_critical: int
    today_high: int
    total_open: int
    total_acknowledged: int
    total_resolved: int
    avg_resolution_hours: float | None


@router.get("/stats", response_model=ComplianceStatsResponse)
async def get_compliance_stats() -> ComplianceStatsResponse:
    """获取合规统计摘要（今日新增 critical/high 数、待处理数、平均解决时长）"""
    conn = _get_conn()
    try:
        ensure_compliance_schema(conn)

        today = _now_iso()[:10]  # YYYY-MM-DD

        today_critical = conn.execute(
            """
            SELECT COUNT(*) as cnt FROM compliance_violation
            WHERE severity = 'critical' AND detected_at >= ?
            """,
            (today,),
        ).fetchone()["cnt"]

        today_high = conn.execute(
            """
            SELECT COUNT(*) as cnt FROM compliance_violation
            WHERE severity = 'high' AND detected_at >= ?
            """,
            (today,),
        ).fetchone()["cnt"]

        total_open = conn.execute(
            "SELECT COUNT(*) as cnt FROM compliance_violation WHERE status = 'open'"
        ).fetchone()["cnt"]

        total_acknowledged = conn.execute(
            "SELECT COUNT(*) as cnt FROM compliance_violation WHERE status = 'acknowledged'"
        ).fetchone()["cnt"]

        total_resolved = conn.execute(
            "SELECT COUNT(*) as cnt FROM compliance_violation WHERE status = 'resolved'"
        ).fetchone()["cnt"]

        # 平均解决时长（小时）
        avg_row = conn.execute(
            """
            SELECT AVG(
                (julianday(resolved_at) - julianday(detected_at)) * 24
            ) as avg_hours
            FROM compliance_violation
            WHERE status = 'resolved'
              AND resolved_at > detected_at
              AND resolved_at IS NOT NULL
            """
        ).fetchone()

        avg_hours = avg_row["avg_hours"] if avg_row and avg_row["avg_hours"] is not None else None

        return ComplianceStatsResponse(
            today_critical=today_critical,
            today_high=today_high,
            total_open=total_open,
            total_acknowledged=total_acknowledged,
            total_resolved=total_resolved,
            avg_resolution_hours=round(avg_hours, 2) if avg_hours is not None else None,
        )
    finally:
        conn.close()
