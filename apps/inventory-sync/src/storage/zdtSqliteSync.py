#!/usr/bin/env python3
"""
zdtSqliteSync.py
将 ZDT 出入库数据从 PostgreSQL 增量同步到工程软件 SQLite。
供 cron 每15分钟调用，保持前端 API 与 ZDT 实时同步。

运行：python3 zdtSqliteSync.py
"""

import json
import sqlite3
import datetime
import os
import sys

# ── 配置 ───────────────────────────────────────────────────────────────
PG_CONN = "postgresql://zdt:zdt@localhost:5432/zdt_sync"
SQLITE_DB = "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
STATE_FILE = "/tmp/zdt_sqlite_sync_state.json"
LOG_FILE = "/tmp/zdt_sqlite_sync.log"

ZDT_TYPE_MAP = {
    "订单出库":        "sales_outbound",
    "采购入库":        "purchase_inbound",
    "调拨出库":        "transfer_outbound",
    "调拨入库":        "transfer_inbound",
    "订单退货入库":    "purchase_inbound",
    "门店出库":        "sales_outbound",
    # 待商确认是库存流水候选状态，不能按销售出库扣 SN/库存。
    # 采购入库页面可按 CGR 单据号单独投影展示，但这里不得污染销售流水。
    "待商确认":        "pending_stock_flow",
    "同店换库位出库":  "transfer_outbound",
    "同店换库位入库":  "transfer_inbound",
}


def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def ensure_columns(conn):
    existing = {r[1] for r in conn.execute("PRAGMA table_info(inventory_movement)").fetchall()}
    needed = {
        "zdt_id":      "TEXT",
        "zdt_shop_no": "TEXT",
        "zdt_order_no":"TEXT",
        "zdt_source":  "TEXT DEFAULT 'zhidiantong'",
    }
    for col, ddl in needed.items():
        if col not in existing:
            try:
                conn.execute(f"ALTER TABLE inventory_movement ADD COLUMN {col} {ddl}")
            except Exception:
                pass


def dt_to_str(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, datetime.date):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if "T" in s or "+" in s:
        try:
            s = s.replace("T", " ").split("+")[0].split(".")[0]
        except:
            pass
    return s


def resolve_movement_type(operate_type_name):
    oper = str(operate_type_name or "").strip()
    return ZDT_TYPE_MAP.get(oper, "")


def resolve_source_document_type(operate_type_name, order_no):
    oper = str(operate_type_name or "").strip()
    order_text = str(order_no or "").strip().upper()
    if oper == "订单出库":
        return "业务订单"
    if oper == "门店出库":
        return "门店出库"
    if oper == "待商确认":
        return "待商确认"
    if oper == "采购入库":
        return "采购入库"
    if oper == "订单退货入库" or order_text.startswith("T"):
        return "订单退货入库"
    if oper == "调拨出库":
        return "调拨出库"
    if oper == "调拨入库":
        return "调拨入库"
    if oper == "同店换库位出库":
        return "同店换库位出库"
    if oper == "同店换库位入库":
        return "同店换库位入库"
    return oper or ""


def sync(pg_conn, sqlite_conn, dry_run=False):
    state = load_state()
    last_max_pay_time = state.get("max_pay_time", "2020-01-01")

    # PostgreSQL 查询增量（比上次更新的记录）
    cur = pg_conn.cursor()
    cur.execute("""
        SELECT id, shop_no, sku_no, mtm_code, product_name, operate_type_name,
               quantity, pay_time, pay_remark, warehouse_location_name,
               user_name, supplier_name, company_name, shop_name, raw_payload, collected_at
        FROM fact_stock_orders
        WHERE source_name = 'zhidiantong'
          AND pay_time > %s
        ORDER BY pay_time
    """, (last_max_pay_time,))
    rows = cur.fetchall()
    cur.close()

    if not rows:
        log("无增量数据")
        return 0

    log(f"发现 {len(rows)} 条增量记录（pay_time > {last_max_pay_time}）")

    stats = {"insert": 0, "exists": 0, "error": 0}
    max_pay_time = last_max_pay_time

    for rec in rows:
        zdt_id   = str(rec[0])[:128]
        sku_key  = rec[2] or rec[3] or zdt_id
        mtm      = rec[3] or ""
        oper     = rec[5] or ""
        mtype    = resolve_movement_type(oper)
        qty      = rec[6] or 0
        pay_time = rec[7]
        biz_dt   = dt_to_str(pay_time)
        remark   = rec[8] or ""
        loc      = rec[9] or ""
        user     = rec[10] or ""
        sup      = rec[11] or ""
        company  = rec[12] or ""
        shop     = rec[13] or ""
        payload  = rec[14]

        if pay_time:
            pt_str = dt_to_str(pay_time)
            if pt_str > max_pay_time:
                max_pay_time = pt_str

        order_no = ""
        serial = ""
        if isinstance(payload, dict):
            order_no = payload.get("orderNo", "") or ""
            serial  = payload.get("serialNumber", "") or ""
        source_document_type = resolve_source_document_type(oper, order_no)
        inbound_document_no = order_no if mtype == "purchase_inbound" else ""

        local_id = f"ZDT-{zdt_id}"[:128]

        if not mtype:
            stats["exists"] += 1
            log(f"SKIP 未映射操作类型: {oper or 'EMPTY'} / {zdt_id}")
            continue

        try:
            # 按 source_ref 去重（同一 ZDT 原始订单号只保留一条，避免重复销售单）
            row = sqlite_conn.execute(
                "SELECT id FROM inventory_movement WHERE source_ref = ? AND source_system = 'zhidiantong' AND movement_type = ?",
                (order_no, mtype)
            ).fetchone()
            if row:
                stats["exists"] += 1
                continue

            if dry_run:
                stats["insert"] += 1
                continue

            sqlite_conn.execute("""
                INSERT INTO inventory_movement (
                    id, sku_key, serial_number, movement_type, quantity,
                    business_date, source_system, source_ref,
                    operator_name, supplier_name, location_name,
                    product_name, pn_mtm, note, created_at,
                    store_name, company_name, shop_name,
                    inbound_document_no, source_document_type, service_type_name, operate_type_name,
                    zdt_id, zdt_shop_no, zdt_order_no, zdt_source
                ) VALUES (?, ?, ?, ?, ?, ?, 'zhidiantong', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zhidiantong')
            """, (
                local_id, sku_key, serial, mtype, qty,
                biz_dt, order_no,
                user, sup, loc,
                rec[4] or "", mtm, remark,
                datetime.datetime.now().isoformat(),
                shop, company, shop,
                inbound_document_no, source_document_type, source_document_type or oper, oper,
                zdt_id, rec[1] or "", order_no,
            ))
            stats["insert"] += 1
        except Exception as e:
            stats["error"] += 1
            log(f"ERROR {zdt_id[:20]}: {e}")

    state["max_pay_time"] = max_pay_time
    save_state(state)

    return stats["insert"]


def main():
    os.makedirs(os.path.dirname(LOG_FILE) or ".", exist_ok=True)
    dry = "--dry" in sys.argv

    log("=== ZDT SQLite 增量同步 ===")

    import psycopg
    pg_conn = psycopg.connect(PG_CONN)

    sqlite_conn = sqlite3.connect(SQLITE_DB, timeout=10)
    sqlite_conn.execute("PRAGMA foreign_keys = ON")
    ensure_columns(sqlite_conn)
    sqlite_conn.commit()

    stats = sync(pg_conn, sqlite_conn, dry_run=dry)

    sqlite_conn.commit()
    sqlite_conn.close()
    pg_conn.close()

    log(f"完成: insert={stats}")


if __name__ == "__main__":
    main()
