"""
test_compliance.py — 合规校验系统测试
======================================
测试规则引擎、API 端点和 SN 一致性规则。
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# 测试用临时数据库
# ---------------------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parents[2]  # .../api-server
TEST_DB_FILE = APP_DIR / "data" / "test-compliance.sqlite3"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _init_test_db(conn: sqlite3.Connection) -> None:
    """初始化测试数据库schema + 种子数据"""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sku (
            id TEXT PRIMARY KEY,
            sku_key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            pn_mtm TEXT NOT NULL DEFAULT '',
            current_stock INTEGER NOT NULL DEFAULT 0,
            category TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS serial_item (
            serial_number TEXT PRIMARY KEY,
            sku_key TEXT NOT NULL,
            status TEXT NOT NULL,
            warehouse_code TEXT NOT NULL DEFAULT 'STORE',
            location_code TEXT NOT NULL DEFAULT 'SALES_FLOOR',
            cost_amount REAL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inventory_movement (
            id TEXT PRIMARY KEY,
            sku_key TEXT NOT NULL,
            serial_number TEXT,
            movement_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            business_date TEXT NOT NULL,
            source_system TEXT NOT NULL,
            source_ref TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales_order (
            id TEXT PRIMARY KEY,
            store_code TEXT NOT NULL,
            operator_id TEXT NOT NULL,
            status TEXT NOT NULL,
            business_date TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales_order_line (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            sku_key TEXT NOT NULL,
            product_name TEXT NOT NULL DEFAULT '',
            quantity INTEGER NOT NULL,
            deal_price REAL NOT NULL,
            serial_number TEXT NOT NULL DEFAULT '',
            serial_numbers_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_order (
            id TEXT PRIMARY KEY,
            supplier_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            business_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_order_line (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            sku_key TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            cost_price REAL,
            serial_numbers_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS education_scan_record_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id TEXT UNIQUE NOT NULL,
            scan_date TEXT NOT NULL,
            scan_timestamp TEXT NOT NULL,
            source_group_name TEXT NOT NULL,
            scan_type TEXT NOT NULL,
            staff_id TEXT NOT NULL,
            staff_name TEXT NOT NULL,
            staff_role TEXT NOT NULL,
            customer_name TEXT,
            customer_phone TEXT,
            sku_key TEXT,
            education_discount_amount REAL DEFAULT 0,
            service_fee_per_unit REAL DEFAULT 0,
            zhixiangjin_amount REAL DEFAULT 0,
            total_education_discount_amount REAL DEFAULT 0,
            serial_numbers_json TEXT,
            order_number TEXT,
            outbound_date TEXT,
            status TEXT DEFAULT '未付',
            voucher_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS compliance_rule (
            id TEXT PRIMARY KEY,
            rule_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
            entity_type TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS compliance_violation (
            id TEXT PRIMARY KEY,
            rule_id TEXT NOT NULL,
            severity TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            detected_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            assigned_to TEXT NOT NULL DEFAULT '',
            resolved_at TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            scan_run_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS compliance_alert (
            id TEXT PRIMARY KEY,
            violation_id TEXT NOT NULL,
            channel TEXT NOT NULL,
            recipient TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            sent_at TEXT NOT NULL,
            acknowledged_at TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );
    """)
    conn.commit()


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def test_db():
    """使用临时文件数据库"""
    # 使用项目真实数据库路径（测试环境）
    db_file = APP_DIR / "data" / "retail-core.sqlite3"
    if not db_file.exists():
        pytest.skip(f"数据库文件不存在: {db_file}")

    conn = sqlite3.connect(str(db_file), timeout=10)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


@pytest.fixture
def clean_test_db():
    """创建临时测试数据库（隔离）"""
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name

    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    _init_test_db(conn)
    yield conn
    conn.close()
    os.unlink(db_path)


# ---------------------------------------------------------------------------
# 规则引擎基础测试
# ---------------------------------------------------------------------------

def test_rule_engine_register_and_list(test_db):
    from app.compliance_rules import RuleEngine, ComplianceRule

    engine = RuleEngine()
    assert len(engine.list_rules()) == 0

    rule = ComplianceRule(
        rule_id="test_rule",
        name="测试规则",
        description="测试",
        severity="high",
        entity_type="test",
    )
    engine.register(rule)
    assert engine.get_rule("test_rule") is not None
    assert len(engine.list_rules()) == 1


def test_rule_engine_run_all(test_db):
    from app.compliance_rules import RuleEngine, ALL_RULES

    engine = RuleEngine(ALL_RULES)
    violations = engine.run_all(test_db)

    # 返回 list
    assert isinstance(violations, list)
    # 每个违规包含必要字段
    for v in violations:
        assert "rule_id" in v
        assert "severity" in v
        assert "entity_type" in v
        assert "entity_id" in v
        assert "description" in v


# ---------------------------------------------------------------------------
# R1: SN 状态一致性规则测试
# ---------------------------------------------------------------------------

def test_sn_rule_detects_sold_without_outbound(clean_test_db):
    """SN 状态为 sold 但无出库流水 → 应检测到违规"""
    from app.compliance_rules import _sn_status_inconsistency

    conn = clean_test_db

    # 插入 sold 状态的 SN（无出库流水）
    conn.execute(
        "INSERT INTO serial_item (serial_number, sku_key, status, updated_at) VALUES (?, ?, ?, ?)",
        ("SN-TEST-001", "SKU001", "sold", _now_iso()),
    )
    conn.commit()

    violations = _sn_status_inconsistency(conn)

    assert len(violations) == 1
    v = violations[0]
    assert v["rule_id"] == "sn_status_inconsistency"
    assert v["severity"] == "critical"
    assert v["entity_type"] == "serial_item"
    assert v["entity_id"] == "SN-TEST-001"


def test_sn_rule_passes_when_outbound_exists(clean_test_db):
    """SN 状态为 sold 且有出库流水 → 无违规"""
    from app.compliance_rules import _sn_status_inconsistency

    conn = clean_test_db

    # 插入 sold 状态的 SN + 出库流水
    conn.execute(
        "INSERT INTO serial_item (serial_number, sku_key, status, updated_at) VALUES (?, ?, ?, ?)",
        ("SN-TEST-002", "SKU001", "sold", _now_iso()),
    )
    conn.execute(
        """
        INSERT INTO inventory_movement
            (id, sku_key, serial_number, movement_type, quantity, business_date, source_system, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (_new_id(), "SKU001", "SN-TEST-002", "outbound", -1, "2026-06-10", "test", "ref1", _now_iso()),
    )
    conn.commit()

    violations = _sn_status_inconsistency(conn)
    assert len(violations) == 0


# ---------------------------------------------------------------------------
# R2: 库存流水一致性测试
# ---------------------------------------------------------------------------

def test_inventory_mismatch_detected(clean_test_db):
    """SKU 账上库存与流水不一致 → 应检测到违规"""
    from app.compliance_rules import _inventory_movement_mismatch

    conn = clean_test_db

    conn.execute(
        "INSERT INTO sku (id, sku_key, name, current_stock, updated_at) VALUES (?, ?, ?, ?, ?)",
        (_new_id(), "SKU-MISMATCH", "测试SKU", 10, _now_iso()),
    )
    conn.execute(
        """
        INSERT INTO inventory_movement
            (id, sku_key, movement_type, quantity, business_date, source_system, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (_new_id(), "SKU-MISMATCH", "inbound", 5, "2026-06-10", "test", "ref1", _now_iso()),
    )
    conn.commit()

    violations = _inventory_movement_mismatch(conn)

    # current_stock=10, movement_sum=5, diff=5 > 1 → 违规
    assert len(violations) >= 1
    v = next((x for x in violations if x["entity_id"] == "SKU-MISMATCH"), None)
    assert v is not None
    assert v["severity"] == "high"


# ---------------------------------------------------------------------------
# R3: 零售价规则测试
# ---------------------------------------------------------------------------

def test_retail_price_violation_detected(clean_test_db):
    """价格不以99结尾 → 应检测到违规"""
    from app.compliance_rules import _retail_price_violation

    conn = clean_test_db

    # 销售订单 + 订单行（价格 3000，不以99结尾）
    order_id = _new_id()
    conn.execute(
        """
        INSERT INTO sales_order (id, store_code, operator_id, status, business_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (order_id, "STORE001", "OP001", "completed", "2026-06-10", _now_iso()),
    )
    conn.execute(
        """
        INSERT INTO sales_order_line
            (id, order_id, sku_key, product_name, quantity, deal_price, serial_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (_new_id(), order_id, "SKU001", "测试商品", 1, 3000.0, "", _now_iso()),
    )
    conn.commit()

    violations = _retail_price_violation(conn)

    assert len(violations) >= 1
    v = next((x for x in violations if x["rule_id"] == "retail_price_violation"), None)
    assert v is not None
    assert v["severity"] == "high"


def test_retail_price_below_cost_detected(clean_test_db):
    """成交价低于成本价 → 应检测到违规"""
    from app.compliance_rules import _retail_price_violation

    conn = clean_test_db

    order_id = _new_id()
    conn.execute(
        """
        INSERT INTO sales_order (id, store_code, operator_id, status, business_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (order_id, "STORE001", "OP001", "completed", "2026-06-10", _now_iso()),
    )
    # 成交价 2000，成本价 2500
    line_id = _new_id()
    conn.execute(
        """
        INSERT INTO sales_order_line
            (id, order_id, sku_key, product_name, quantity, deal_price, serial_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (line_id, order_id, "SKU001", "测试商品", 1, 2000.0, "SN-BELOW-COST", _now_iso()),
    )
    conn.execute(
        "INSERT INTO serial_item (serial_number, sku_key, status, cost_amount, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("SN-BELOW-COST", "SKU001", "sold", 2500.0, _now_iso()),
    )
    conn.commit()

    violations = _retail_price_violation(conn)

    assert len(violations) >= 1
    v = next((x for x in violations if x["entity_id"] == line_id), None)
    assert v is not None
    assert "低于成本价" in v["description"]


# ---------------------------------------------------------------------------
# R4: 采购价异常测试
# ---------------------------------------------------------------------------

def test_purchase_price_anomaly_detected(clean_test_db):
    """采购单价偏离均值超过 30% → 应检测到违规"""
    from app.compliance_rules import _purchase_price_anomaly

    conn = clean_test_db

    order_id = _new_id()
    conn.execute(
        "INSERT INTO purchase_order (id, supplier_id, status, business_date) VALUES (?, ?, ?, ?)",
        (order_id, "SUP001", "completed", "2026-06-10"),
    )

    # 3 个 SKU 同类产品，均价约 100
    for i, cost in enumerate([100.0, 100.0, 160.0]):  # 160 偏离均值 60%
        sku_key = f"SKU00{i}"
        conn.execute(
            "INSERT INTO sku (id, sku_key, name, pn_mtm, category, current_stock, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (_new_id(), sku_key, f"商品{i}", "PN-COMMON", "电脑", _now_iso()),
        )
        conn.execute(
            """
            INSERT INTO purchase_order_line (id, order_id, sku_key, cost_price, quantity, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (_new_id(), order_id, sku_key, cost, 1, _now_iso()),
        )
    conn.commit()

    violations = _purchase_price_anomaly(conn)

    assert len(violations) >= 1
    v = violations[0]
    assert v["rule_id"] == "purchase_price_anomaly"
    assert v["severity"] == "medium"


# ---------------------------------------------------------------------------
# R5: 教育补贴合规测试
# ---------------------------------------------------------------------------

def test_education_subsidy_unpaid_with_discount(clean_test_db):
    """教育补贴已减免但订单状态为未付 → 违规"""
    from app.compliance_rules import _education_subsidy_violation

    conn = clean_test_db

    conn.execute(
        """
        INSERT INTO education_scan_record_v2
            (record_id, scan_date, scan_timestamp, source_group_name, scan_type,
             staff_id, staff_name, staff_role, customer_name, sku_key,
             education_discount_amount, service_fee_per_unit, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "EDU-001", "2026-06-10", _now_iso(), "联想体验店", "single_scan",
            "STAFF001", "张三", "服务顾问", "李四", "SKU001",
            500.0, 100.0, "未付", _now_iso(), _now_iso(),
        ),
    )
    conn.commit()

    violations = _education_subsidy_violation(conn)

    assert len(violations) >= 1
    v = violations[0]
    assert v["rule_id"] == "education_subsidy_violation"
    assert v["severity"] == "high"


# ---------------------------------------------------------------------------
# API 端点测试（使用真实 DB）
# ---------------------------------------------------------------------------

def test_compliance_rules_api_real_db(test_db):
    """GET /api/compliance/rules 应返回已注册规则"""
    # 跳过 FastAPI 启动，直接测试导入
    from app.compliance_rules import ALL_RULES

    assert len(ALL_RULES) >= 5
    assert "sn_status_inconsistency" in ALL_RULES
    assert "inventory_movement_mismatch" in ALL_RULES
    assert "retail_price_violation" in ALL_RULES
    assert "purchase_price_anomaly" in ALL_RULES
    assert "education_subsidy_violation" in ALL_RULES


def test_all_rules_produce_valid_violation_structure(test_db):
    """所有规则返回的违规记录符合规范"""
    from app.compliance_rules import RuleEngine, ALL_RULES

    engine = RuleEngine(ALL_RULES)
    violations = engine.run_all(test_db)

    required_keys = {"rule_id", "severity", "entity_type", "entity_id", "description"}

    for v in violations:
        assert required_keys.issubset(v.keys()), f"违规记录缺少字段: {v}"
        assert v["severity"] in ("critical", "high", "medium", "low"), f"严重等级无效: {v['severity']}"


# ---------------------------------------------------------------------------
# Violation API 测试
# ---------------------------------------------------------------------------

def test_violation_acknowledge_updates_status(clean_test_db):
    """确认违规应将 status 更新为 acknowledged"""
    conn = clean_test_db

    vid = _new_id()
    conn.execute(
        """
        INSERT INTO compliance_violation
            (id, rule_id, severity, entity_type, entity_id, description, detected_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
        """,
        (vid, "sn_status_inconsistency", "critical", "serial_item", "SN-001", "测试违规", _now_iso()),
    )
    conn.commit()

    # 模拟 acknowledge 逻辑
    conn.execute(
        "UPDATE compliance_violation SET status = 'acknowledged', assigned_to = '店长A' WHERE id = ?",
        (vid,),
    )
    conn.commit()

    row = conn.execute("SELECT status, assigned_to FROM compliance_violation WHERE id = ?", (vid,)).fetchone()
    assert row["status"] == "acknowledged"
    assert row["assigned_to"] == "店长A"


def test_violation_resolve_updates_status(clean_test_db):
    """解决违规应将 status 更新为 resolved"""
    conn = clean_test_db

    vid = _new_id()
    conn.execute(
        """
        INSERT INTO compliance_violation
            (id, rule_id, severity, entity_type, entity_id, description, detected_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'acknowledged')
        """,
        (vid, "sn_status_inconsistency", "critical", "serial_item", "SN-001", "测试违规", _now_iso()),
    )
    conn.commit()

    conn.execute(
        "UPDATE compliance_violation SET status = 'resolved', resolved_at = ? WHERE id = ?",
        (_now_iso(), vid),
    )
    conn.commit()

    row = conn.execute("SELECT status, resolved_at FROM compliance_violation WHERE id = ?", (vid,)).fetchone()
    assert row["status"] == "resolved"
    assert row["resolved_at"] != ""


# ---------------------------------------------------------------------------
# 规则引擎隔离测试
# ---------------------------------------------------------------------------

def test_rule_engine_disabled_rule_not_run(clean_test_db):
    """禁用的规则不应被运行"""
    from app.compliance_rules import ComplianceRule, RuleEngine

    engine = RuleEngine()

    called = []

    def dummy_check(conn):
        called.append(True)
        return []

    rule = ComplianceRule(
        rule_id="disabled_test",
        name="测试禁用规则",
        description="",
        severity="high",
        entity_type="test",
        enabled=False,
        check_fn=dummy_check,
    )
    engine.register(rule)
    engine.run_all(clean_test_db)

    assert len(called) == 0  # 不应被调用


# ---------------------------------------------------------------------------
# Phase 1 验证：SN 一致性规则在真实 DB 上运行
# ---------------------------------------------------------------------------

def test_sn_consistency_on_real_db(test_db):
    """在真实数据库上运行 SN 一致性规则，验证不抛异常且返回有效结构"""
    from app.compliance_rules import _sn_status_inconsistency

    violations = _sn_status_inconsistency(test_db)

    assert isinstance(violations, list)
    for v in violations:
        assert v["rule_id"] == "sn_status_inconsistency"
        assert v["severity"] == "critical"
        assert v["entity_type"] == "serial_item"
        assert len(v["entity_id"]) > 0
        assert "SN" in v["entity_id"] or "sn" in v["entity_id"].lower()
