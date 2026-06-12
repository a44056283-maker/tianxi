#!/usr/bin/env python3
"""
syncZdtToLocalSqlite.py
将 PostgreSQL fact_stock_orders 中 ZDT 来源的出入库数据写入工程软件 SQLite。
纯标准库，不依赖第三方 DB 驱动。

运行：python3 syncZdtToLocalSqlite.py
"""

import json
import sqlite3
import datetime
import os

# ── 配置 ───────────────────────────────────────────────────────────────
SQLITE_DB = "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
JSON_FILE = "/tmp/zdt_stock_orders.json"
LOG_FILE  = "/tmp/sync_zdt_sqlite.log"

# ZDT operate_type → movement_type 映射
ZDT_TYPE_MAP = {
    "订单出库":        "sales_outbound",
    "采购入库":        "purchase_inbound",
    "调拨出库":        "transfer_outbound",
    "调拨入库":        "transfer_inbound",
    "订单退货入库":    "purchase_inbound",
    "门店出库":        "sales_outbound",
    # 待商确认不是销售出库，不能继续污染销售/SN 出库链路。
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


def load_json():
    with open(JSON_FILE) as f:
        return json.load(f)


def ensure_columns(conn):
    """确保 inventory_movement 有 zdt 专用列"""
    existing = {r[1] for r in conn.execute("PRAGMA table_info(inventory_movement)").fetchall()}
    needed = {
        "zdt_id":          "TEXT",
        "zdt_shop_no":     "TEXT",
        "zdt_order_no":    "TEXT",
        "zdt_source":      "TEXT DEFAULT 'zhidiantong'",
    }
    for col, ddl in needed.items():
        if col not in existing:
            try:
                conn.execute(f"ALTER TABLE inventory_movement ADD COLUMN {col} {ddl}")
                log(f"  ADD COLUMN {col}")
            except Exception as e:
                log(f"  WARN {col}: {e}")


def make_serial_number(payload):
    """从 raw_payload 提取 serialNumber"""
    if isinstance(payload, dict):
        return payload.get("serialNumber", "") or ""
    return ""


def make_order_no(payload):
    """从 raw_payload 提取 orderNo"""
    if isinstance(payload, dict):
        return payload.get("orderNo", "") or ""
    return ""


def dt_to_str(v):
    """datetime/date 或 ISO 字符串 → 'YYYY-MM-DD HH:MM:SS' 格式字符串"""
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, datetime.date):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    # 已经是 ISO 格式
    if "T" in s or "+" in s:
        try:
            # 2026-05-28T12:22:03+00:00 → 2026-05-28 12:22:03
            s = s.replace("T", " ").split("+")[0].split(".")[0]
        except:
            pass
    return s


def upsert(conn, rec):
    zdt_id   = str(rec["id"])[:128]
    sku_key  = rec.get("sku_no") or rec.get("mtm_code") or zdt_id
    mtm      = rec.get("mtm_code") or ""
    oper     = rec.get("operate_type_name") or ""
    mtype    = ZDT_TYPE_MAP.get(oper, "sales_outbound")
    qty      = rec.get("quantity") or 0
    pay_time = rec.get("pay_time")
    biz_dt   = dt_to_str(pay_time)
    remark   = rec.get("pay_remark") or ""
    loc      = rec.get("warehouse_location_name") or ""
    user     = rec.get("user_name") or ""
    sup      = rec.get("supplier_name") or ""
    company  = rec.get("company_name") or ""
    shop     = rec.get("shop_name") or ""
    payload  = rec.get("raw_payload")
    order_no = make_order_no(payload)
    serial   = make_serial_number(payload)

    # 本地 id 避免与现有 id 冲突
    local_id = f"ZDT-{zdt_id}"[:128]

    # 查重：zdt_id 已存在则跳过
    row = conn.execute(
        "SELECT id FROM inventory_movement WHERE zdt_id = ? AND source_system = 'zhidiantong'",
        (zdt_id,)
    ).fetchone()
    if row:
        return "exists"

    conn.execute("""
        INSERT INTO inventory_movement (
            id, sku_key, serial_number, movement_type, quantity,
            business_date, source_system, source_ref,
            operator_name, supplier_name, location_name,
            product_name, pn_mtm, note, created_at,
            store_name, company_name, shop_name,
            zdt_id, zdt_shop_no, zdt_order_no, zdt_source
        ) VALUES (?, ?, ?, ?, ?, ?, 'zhidiantong', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zhidiantong')
    """, (
        local_id, sku_key, serial, mtype, qty,
        biz_dt, order_no,
        user, sup, loc,
        rec.get("product_name") or "", mtm, remark,
        datetime.datetime.now().isoformat(),
        shop, company, shop,
        zdt_id, rec.get("shop_no") or "", order_no,
    ))
    return "insert"


def main():
    os.makedirs(os.path.dirname(LOG_FILE) or ".", exist_ok=True)
    log("=== 同步 ZDT fact_stock_orders → SQLite inventory_movement ===")

    log("Step 1: 加载 JSON...")
    records = load_json()
    log(f"  共 {len(records)} 条记录")

    log("Step 2: 连接 SQLite...")
    conn = sqlite3.connect(SQLITE_DB, timeout=10)
    conn.execute("PRAGMA foreign_keys = ON")

    log("Step 3: 确保列存在...")
    ensure_columns(conn)
    conn.commit()

    log("Step 4: 写入记录...")
    stats = {"insert": 0, "exists": 0, "error": 0}
    for i, rec in enumerate(records):
        if i % 200 == 0:
            log(f"  进度 {i+1}/{len(records)}")
        try:
            r = upsert(conn, rec)
            stats[r] = stats.get(r, 0) + 1
        except Exception as e:
            log(f"  ERROR [{rec.get('id','')[:30]}]: {e}")
            stats["error"] += 1

    conn.commit()
    conn.close()

    log(f"完成: insert={stats['insert']}, exists={stats['exists']}, error={stats['error']}")


if __name__ == "__main__":
    main()
