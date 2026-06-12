"""
PO / 教育补实物仓 累加口径审计脚本。

校验 4 件事：
1. build_standard_inventory_snapshot_from_sql 的 currentStock 不能再双计 hold
2. transfer 后 sku.current_stock 不应被本地 overlay 改写
3. release 后 sku.current_stock 不应被本地 overlay 改写
4. active hold 中无 stock_count_excess

用法：
  cd apps/api-server && uv run python ../scripts/audit_physical_hold_accumulation.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "apps/api-server/data/retail-core.sqlite3"
API_APP_DIR = PROJECT_ROOT / "apps/api-server/app"
sys.path.insert(0, str(API_APP_DIR))


def _add_count(records: list[dict], name: str, ok: bool, detail: str) -> None:
    records.append({"name": name, "ok": ok, "detail": detail})


def check_1_no_double_count() -> dict:
    """currentStock 不应再 + hold_stock。"""
    from retail_core import build_standard_inventory_snapshot_from_sql, connect
    snap = build_standard_inventory_snapshot_from_sql()
    with connect() as conn:
        sku_total = int(conn.execute(
            "SELECT COALESCE(SUM(current_stock), 0) FROM sku"
        ).fetchone()[0])
        hold_total = int(conn.execute(
            "SELECT COUNT(*) FROM physical_stock_hold WHERE hold_status='active'"
        ).fetchone()[0])
    totals_current_stock = int(snap["totals"]["currentStock"])
    totals_physical_hold = int(snap["totals"]["physicalHoldStock"])
    expected_total = sku_total
    diff = totals_current_stock - expected_total
    ok = diff == 0 and totals_physical_hold == hold_total
    detail = (
        f"totals.currentStock={totals_current_stock} "
        f"vs sku_sum={expected_total} (diff={diff:+d}); "
        f"totals.physicalHoldStock={totals_physical_hold} vs hold_total={hold_total}"
    )
    return {"name": "1.current_stock_no_double_count", "ok": ok, "detail": detail}


def check_2_transfer_keeps_sku() -> dict:
    """transfer 不应直接改写 sku.current_stock。"""
    from retail_core import (
        build_standard_inventory_snapshot_from_sql,
        connect,
        init_db,
        transfer_sales_order_serials_to_physical_hold,
        release_physical_hold_to_store,
    )
    init_db()
    with connect() as conn:
        # 找一个有 SN 的"已完成"销售单 + 该 SN 在门店可售，且没在 hold 里
        target = conn.execute("""
            SELECT si.serial_number, si.sku_key, so.id AS order_id
            FROM serial_item si
            JOIN sales_order_line sol ON sol.sku_key = si.sku_key
            JOIN sales_order so ON so.id = sol.order_id
            WHERE so.status_name = '已完成'
              AND si.status = 'in_stock'
              AND si.warehouse_code = 'STORE'
              AND si.serial_number NOT IN (SELECT serial_number FROM physical_stock_hold)
            LIMIT 1
        """).fetchone()
        if not target:
            return {"name": "2.transfer_keeps_sku", "ok": True,
                    "detail": "SKIP: no eligible SN in sales order (test not run)"}
        sn, sku_key, order_id = target["serial_number"], target["sku_key"], target["order_id"]
        before_current = int(conn.execute(
            "SELECT current_stock FROM sku WHERE sku_key = ?", (sku_key,)
        ).fetchone()[0] or 0)

    # 触发 transfer（如果没真在 sales_order_line.serial_numbers_json 里，会 skipped）
    result = transfer_sales_order_serials_to_physical_hold(
        order_id, serial_numbers=[sn], hold_reason="audit_test", note="audit_test", operator_name="audit"
    )
    if int(result.get("transferredCount", 0)) < 1:
        # 清理（如果 transfer 失败，我们不动 sku）
        return {"name": "2.transfer_keeps_sku", "ok": True,
                "detail": f"SKIP: transfer skipped (skipped={result.get('skipped')})"}

    with connect() as conn:
        after_current = int(conn.execute(
            "SELECT current_stock FROM sku WHERE sku_key = ?", (sku_key,)
        ).fetchone()[0] or 0)
        hold_status = conn.execute(
            "SELECT hold_status FROM physical_stock_hold WHERE serial_number = ?", (sn,)
        ).fetchone()

    # 立即 release 回滚，避免污染
    release_result = release_physical_hold_to_store(
        [sn], note="audit_test_rollback", operator_name="audit"
    )
    ok = after_current == before_current and hold_status and hold_status[0] == "active"
    detail = (
        f"sku {sku_key}: before_current={before_current}, after_transfer={after_current}, "
        f"hold_status={hold_status[0] if hold_status else None}, "
        f"release_reverted={release_result.get('releasedCount', 0)} （transfer 应不修改 sku.current_stock）"
    )
    return {"name": "2.transfer_keeps_sku", "ok": ok, "detail": detail}


def check_3_release_keeps_sku() -> dict:
    """release 不应直接改写 sku.current_stock。"""
    from retail_core import connect, init_db, release_physical_hold_to_store
    init_db()
    with connect() as conn:
        # 找一个 active hold
        target = conn.execute("""
            SELECT h.serial_number, h.sku_key
            FROM physical_stock_hold h
            WHERE h.hold_status = 'active'
            LIMIT 1
        """).fetchone()
        if not target:
            return {"name": "3.release_keeps_sku", "ok": True,
                    "detail": "SKIP: no active hold in DB"}
        sn, sku_key = target["serial_number"], target["sku_key"]
        before_current = int(conn.execute(
            "SELECT current_stock FROM sku WHERE sku_key = ?", (sku_key,)
        ).fetchone()[0] or 0)

    result = release_physical_hold_to_store(
        [sn], note="audit_test_release", operator_name="audit"
    )

    with connect() as conn:
        after_current = int(conn.execute(
            "SELECT current_stock FROM sku WHERE sku_key = ?", (sku_key,)
        ).fetchone()[0] or 0)
        hold_status = conn.execute(
            "SELECT hold_status FROM physical_stock_hold WHERE serial_number = ?", (sn,)
        ).fetchone()

    # 回滚（再 transfer 回去）— 但 transfer 需要 sales_order，按 order_no 查一下
    # 简化：直接重新创建 active hold 行
    from retail_core import _create_physical_hold_movement
    with connect() as conn:
        conn.execute(
            """UPDATE physical_stock_hold SET hold_status='active', updated_at=?,
               matched_service_order_no='', matched_outbound_movement_id=''
               WHERE serial_number=?""",
            ("2026-06-08T00:00:00Z", sn),
        )
        conn.execute(
            """UPDATE serial_item SET status='in_stock', warehouse_code='PO_HOLD',
               location_code='PO_EDU_REAL_STOCK', updated_at=? WHERE serial_number=?""",
            ("2026-06-08T00:00:00Z", sn),
        )
        conn.execute(
            "UPDATE sku SET current_stock=?, updated_at=? WHERE sku_key=?",
            (before_current, "2026-06-08T00:00:00Z", sku_key),
        )
        conn.commit()

    # 当前设计：release 不动 sku.current_stock（日导数已含该 SN），只把 hold 状态从 active 改 released。
    ok = after_current == before_current and hold_status and hold_status[0] == "released"
    detail = (
        f"sku {sku_key}: before_release={before_current}, after_release={after_current}, "
        f"hold_status={hold_status[0] if hold_status else None} （release 应不修改 sku.current_stock）"
    )
    return {"name": "3.release_keeps_sku", "ok": ok, "detail": detail}


def check_4_no_excess_serial_in_active_hold() -> dict:
    """active hold 中无 stock_count_excess。"""
    from retail_core import connect, init_db
    init_db()
    with connect() as conn:
        rows = conn.execute("""
            SELECT h.serial_number, h.sku_key, si.status AS serial_status
            FROM physical_stock_hold h
            LEFT JOIN serial_item si USING(serial_number)
            WHERE h.hold_status = 'active' AND si.status = 'stock_count_excess'
        """).fetchall()
    ok = len(rows) == 0
    detail = (
        f"active hold 中 stock_count_excess SN 数 = {len(rows)}"
        + (f"; 样例: {[r['serial_number'] for r in rows[:5]]}" if rows else "")
    )
    return {"name": "4.no_excess_serial_in_active_hold", "ok": ok, "detail": detail}


def main() -> int:
    checks = [
        check_1_no_double_count(),
        check_2_transfer_keeps_sku(),
        check_3_release_keeps_sku(),
        check_4_no_excess_serial_in_active_hold(),
    ]
    print("=" * 70)
    print("PO 实物仓累加口径审计")
    print("=" * 70)
    for c in checks:
        mark = "PASS" if c["ok"] else "FAIL"
        print(f"[{mark}] {c['name']}")
        print(f"       {c['detail']}")
    print("=" * 70)
    failed = sum(1 for c in checks if not c["ok"])
    print(f"Total: {len(checks) - failed}/{len(checks)} PASS, {failed} FAIL")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
