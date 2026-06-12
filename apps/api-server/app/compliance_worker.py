"""
compliance_worker.py — 合规校验后台扫描 Worker
================================================
后台线程定期运行合规扫描（Phase 2 完全实现）。
Phase 1：启动时立即运行一次全量扫描（SN一致性验证）。
Phase 2：每 60 分钟（可配置）运行一次全量扫描，
         critical 级别自动写 compliance_alert（不实际发消息）。
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone

from pathlib import Path

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parents[1]
DB_PATH = APP_DIR / "data" / "retail-core.sqlite3"
MIGRATIONS_DIR = APP_DIR / "migrations"

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
COMPLIANCE_SCAN_INTERVAL_MS = int(
    os.environ.get("COMPLIANCE_SCAN_INTERVAL_MS", "3600000")  # 默认 60 分钟
)

# ---------------------------------------------------------------------------
# 工具
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
# 迁移初始化
# ---------------------------------------------------------------------------


def _ensure_schema(conn: sqlite3.Connection) -> None:
    migration_file = MIGRATIONS_DIR / "2026-06-10-compliance.sql"
    if not migration_file.exists():
        return
    sql = migration_file.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


# ---------------------------------------------------------------------------
# 核心扫描函数（Phase 2 将增强）
# ---------------------------------------------------------------------------


def run_compliance_scan_once() -> dict:
    """
    执行一次全量合规扫描。
    Phase 1：调用规则引擎，持久化违规记录。
    Phase 2：增加 critical 预警写入 compliance_alert。
    """
    from app.compliance_rules import RuleEngine, ALL_RULES

    scan_run_id = _new_id()
    start = time.perf_counter()

    conn = _get_conn()
    try:
        _ensure_schema(conn)
        engine = RuleEngine(ALL_RULES)
        violations = engine.run_all(conn)

        # 写入违规记录
        written = 0
        for v in violations:
            vid = _new_id()
            conn.execute(
                """
                INSERT INTO compliance_violation
                    (id, rule_id, severity, entity_type, entity_id,
                     description, detected_at, status, scan_run_id, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
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
            written += 1

            # Phase 2: critical 级别写预警（暂时只写表，不发实际消息）
            if v["severity"] == "critical":
                _write_critical_alert(conn, vid, v)

        conn.commit()
        elapsed_ms = int((time.perf_counter() - start) * 1000)

        return {
            "ok": True,
            "scan_run_id": scan_run_id,
            "violations_found": len(violations),
            "violations_written": written,
            "elapsed_ms": elapsed_ms,
        }
    except Exception as exc:
        return {
            "ok": False,
            "scan_run_id": scan_run_id,
            "error": f"{type(exc).__name__}: {exc}",
        }
    finally:
        conn.close()


def _write_critical_alert(conn: sqlite3.Connection, violation_id: str, violation: dict) -> None:
    """写 critical 级别预警到 compliance_alert 表（不发实际消息）"""
    alert_id = _new_id()
    metadata = {
        "scan_run_source": "compliance_worker",
        "auto_generated": True,
    }
    conn.execute(
        """
        INSERT INTO compliance_alert
            (id, violation_id, channel, recipient, message,
             sent_at, status, metadata_json)
        VALUES (?, ?, 'in_app', 'store_manager', ?, ?, 'pending', ?)
        """,
        (
            alert_id,
            violation_id,
            f"[Critical 合规预警] {violation['description']}",
            _now_iso(),
            __import__("json").dumps(metadata, ensure_ascii=False),
        ),
    )


# ---------------------------------------------------------------------------
# 定时扫描循环（Phase 2 实现）
# ---------------------------------------------------------------------------

_worker_timer: threading.Timer | None = None
_worker_started = False
_worker_lock = threading.Lock()


def _scan_loop() -> None:
    """每 COMPLIANCE_SCAN_INTERVAL_MS 运行一次扫描（循环）"""
    global _worker_timer
    result = run_compliance_scan_once()
    print(f"[compliance_worker] scan completed: {result}")

    # 重新调度
    interval_s = COMPLIANCE_SCAN_INTERVAL_MS / 1000
    _worker_timer = threading.Timer(interval_s, _scan_loop)
    _worker_timer.name = "compliance-scan-loop"
    _worker_timer.daemon = True
    _worker_timer.start()


def start_compliance_worker() -> None:
    """
    启动合规扫描 worker。
    Phase 1：只运行一次启动扫描（SN一致性验证）。
    Phase 2：启动定时循环。
    """
    global _worker_started, _worker_timer

    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True

    print("[compliance_worker] starting compliance worker...")

    # Phase 1：立即运行一次
    result = run_compliance_scan_once()
    print(f"[compliance_worker] initial scan result: {result}")

    # Phase 2：启动定时循环
    interval_s = COMPLIANCE_SCAN_INTERVAL_MS / 1000
    _worker_timer = threading.Timer(interval_s, _scan_loop)
    _worker_timer.name = "compliance-scan-loop"
    _worker_timer.daemon = True
    _worker_timer.start()
    print(f"[compliance_worker] periodic scan scheduled every {interval_s:.0f}s")


def stop_compliance_worker() -> None:
    global _worker_timer
    if _worker_timer is not None:
        _worker_timer.cancel()
        _worker_timer = None
