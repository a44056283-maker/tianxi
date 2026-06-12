#!/usr/bin/env python3
"""
ZDT 订单 → 工程软件 SQLite 同步脚本
数据流：ZDT API → PostgreSQL fact_orders/fact_order_items → 工程软件 SQLite sales_order/sales_order_line

每次运行：读取 PostgreSQL ZDT 今日订单，增量写入工程软件 SQLite。
状态文件：/tmp/zdt_sales_order_sync_state.json
"""

import json, os, sqlite3, sys, time
from datetime import datetime, date
from pathlib import Path

# ── 路径配置 ──────────────────────────────────────────────────────────────
RETAIL_DB = os.environ.get(
    "LENOVO_SMART_RETAIL_DB_FILE",
    "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
)
PG_CONN = os.environ.get(
    "ZDT_SYNC_DATABASE_URL",
    "postgresql://zdt:zdt@localhost:5432/zdt_sync"
)
STATE_FILE = "/tmp/zdt_sales_order_sync_state.json"

# ── 状态管理 ──────────────────────────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"last_sync_time": None}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

# ── PostgreSQL 连接 ────────────────────────────────────────────────────────
import psycopg

def pg_connect():
    return psycopg.connect(PG_CONN)

# ── SQLite 连接 ─────────────────────────────────────────────────────────────
def sqlite_connect(path):
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

# ── 主同步 ────────────────────────────────────────────────────────────────
def sync():
    state = load_state()
    last_time = state.get("last_sync_time") or "1970-01-01T00:00:00"
    today = date.today().isoformat()
    now = datetime.now()
    now_str = now.isoformat()

    print(f"[{now_str[:19]}] === ZDT 订单 → 工程软件 SQLite ===")
    print(f"  上次同步: {last_time}")

    # 读取 PostgreSQL ZDT 今日新订单
    pg = pg_connect()
    pg_cur = pg.cursor()

    # 订单主表
    pg_cur.execute("""
        SELECT order_id, order_no, status, status_name, total_amount, pay_amount,
               buyer_phone, buyer_nick, shop_id, shop_name, company_id,
               order_type, order_type_name, channel_type, channel_type_name,
               pay_time, created_time, cashier_name, total_quantity,
               delivery_type, delivery_type_name, delivery_store_name,
               outer_order_no, raw_payload
        FROM fact_orders
        WHERE source_name = 'zhidiantong'
          AND (pay_time > %(last_time)s OR created_time > %(last_time)s
               OR collected_at > %(last_time)s)
        ORDER BY pay_time
    """, {"last_time": last_time})
    orders = [dict(zip([d[0] for d in pg_cur.description], r)) for r in pg_cur.fetchall()]

    print(f"  PG 新增订单: {len(orders)} 条")

    if not orders:
        print("  无新订单，跳过")
        pg_cur.close()
        pg.close()
        return

    # 读取商品明细
    order_ids = [str(r["order_id"]) for r in orders]
    pg_cur.execute("""
        SELECT oi.id, oi.order_id, oi.product_name, oi.product_no, oi.sku_no,
               oi.barcode, oi.mtm_code, oi.spec, oi.quantity, oi.unit_price,
               oi.total_amount, oi.pay_amount, oi.discount_amount, oi.unit,
               oi.serial_number, oi.raw_payload
        FROM fact_order_items oi
        JOIN fact_orders o ON oi.order_id = o.order_id
        WHERE oi.order_id = ANY(%(ids)s)
          AND o.source_name = 'zhidiantong'
    """, {"ids": order_ids})
    items_rows = [dict(zip([d[0] for d in pg_cur.description], r)) for r in pg_cur.fetchall()]

    items_by_order = {}
    for row in items_rows:
        oid = str(row["order_id"])
        if oid not in items_by_order:
            items_by_order[oid] = []
        items_by_order[oid].append(row)

    pg_cur.close()
    pg.close()

    # 写入 SQLite
    sqlite_conn = sqlite_connect(RETAIL_DB)
    sqlite_cur = sqlite_conn.cursor()
    orders_saved = 0
    items_saved = 0
    max_time = last_time

    for order in orders:
        r = order
        order_id = str(r["order_id"])
        pay_time = r["pay_time"]
        created_time = r["created_time"]

        # 更新最大时间戳
        for t in [pay_time, created_time]:
            if t:
                t_str = t.isoformat() if hasattr(t, 'isoformat') else str(t)
                if t_str > max_time:
                    max_time = t_str

        # 状态映射
        status_map = {60: "completed", 20: "pending", 3: "cancelled", 4: "refunded"}
        status_str = status_map.get(int(r.get("status") or 0), "completed")

        # 格式化时间
        def fmt_ts(ts):
            if ts is None:
                return ""
            if hasattr(ts, 'strftime'):
                return ts.strftime("%Y-%m-%d %H:%M:%S")
            return str(ts)[:19]

        business_date = fmt_ts(pay_time)[:10] if pay_time else today
        pay_time_str = fmt_ts(pay_time)
        created_time_str = fmt_ts(created_time)

        try:
            sqlite_cur.execute("""
                INSERT INTO sales_order (
                    id, store_code, operator_id, customer_name, status, total_amount,
                    business_date, note, created_at, external_order_no, pay_amount,
                    order_type, order_type_name, channel_type_name, cashier_name,
                    total_quantity, pay_time, created_time, shop_id, shop_name,
                    company_id, raw_payload_json, status_name
                ) VALUES (
                    :id, :store_code, :operator_id, :customer_name, :status, :total_amount,
                    :business_date, :note, :created_at, :external_order_no, :pay_amount,
                    :order_type, :order_type_name, :channel_type_name, :cashier_name,
                    :total_quantity, :pay_time, :created_time, :shop_id, :shop_name,
                    :company_id, :raw_payload_json, :status_name
                )
                ON CONFLICT(id) DO UPDATE SET
                    status = :upd_status,
                    status_name = :upd_status_name,
                    total_amount = :upd_total_amount,
                    pay_amount = :upd_pay_amount,
                    cashier_name = :upd_cashier_name,
                    pay_time = :upd_pay_time,
                    external_order_no = :upd_external_order_no,
                    raw_payload_json = :upd_raw_payload
            """, {
                "id": r.get("order_no") or order_id,
                "store_code": "D0186124",
                "operator_id": "",
                "customer_name": r.get("buyer_nick", "") or r.get("buyer_phone", "") or "",
                "status": status_str,
                "total_amount": float(r.get("total_amount") or 0),
                "business_date": business_date,
                "note": "",
                "created_at": created_time_str,
                "external_order_no": r.get("outer_order_no", "") or r.get("order_no", ""),
                "pay_amount": float(r.get("pay_amount") or 0),
                "order_type": int(r.get("order_type") or 1),
                "order_type_name": r.get("order_type_name", "") or "线上订单",
                "channel_type_name": r.get("channel_type_name", "") or "",
                "cashier_name": r.get("cashier_name", "") or "",
                "total_quantity": int(r.get("total_quantity") or 0),
                "pay_time": pay_time_str,
                "created_time": created_time_str,
                "shop_id": str(r.get("shop_id", "") or ""),
                "shop_name": r.get("shop_name", "") or "",
                "company_id": str(r.get("company_id", "") or ""),
                "raw_payload_json": json.dumps(r.get("raw_payload") or {}, ensure_ascii=False),
                "status_name": r.get("status_name", "") or "",
                # update values (SQLite ON CONFLICT doesn't allow separate UPDATE values, reuse same)
                "upd_status": status_str,
                "upd_status_name": r.get("status_name", "") or "",
                "upd_total_amount": float(r.get("total_amount") or 0),
                "upd_pay_amount": float(r.get("pay_amount") or 0),
                "upd_cashier_name": r.get("cashier_name", "") or "",
                "upd_pay_time": pay_time_str,
                "upd_external_order_no": r.get("outer_order_no", "") or r.get("order_no", "") or "",
                "upd_raw_payload": json.dumps(r.get("raw_payload") or {}, ensure_ascii=False),
            })
            orders_saved += 1
        except Exception as e:
            print(f"  [订单错误] {order_id}: {e}")
            continue

        # 写入商品明细
        for item in items_by_order.get(order_id, []):
            item_id = str(item["id"])
            serial_numbers = [item.get("serial_number", "")] if item.get("serial_number") else []
            try:
                sqlite_cur.execute("""
                    INSERT INTO sales_order_line (
                        id, order_id, sku_key, quantity, deal_price,
                        serial_numbers_json, created_at, product_name, product_no,
                        mtm_code, spec, pay_amount, discount_amount, serial_number,
                        supplier_name
                    ) VALUES (
                        :id, :order_id, :sku_key, :quantity, :deal_price,
                        :serial_numbers_json, :created_at, :product_name, :product_no,
                        :mtm_code, :spec, :pay_amount, :discount_amount, :serial_number,
                        :supplier_name
                    )
                    ON CONFLICT(id) DO UPDATE SET
                        product_name = :upd_product_name,
                        deal_price = :upd_deal_price,
                        quantity = :upd_quantity,
                        serial_number = :upd_serial_number,
                        serial_numbers_json = :upd_serial_numbers_json
                """, {
                    "id": item_id,
                    "order_id": order_id,
                    "sku_key": str(item.get("sku_no", "")),
                    "quantity": int(item.get("quantity") or 0),
                    "deal_price": float(item.get("unit_price") or 0),
                    "serial_numbers_json": json.dumps(serial_numbers, ensure_ascii=False),
                    "created_at": now_str[:19],
                    "product_name": item.get("product_name", "") or "",
                    "product_no": str(item.get("product_no", "")),
                    "mtm_code": item.get("mtm_code", "") or "",
                    "spec": item.get("spec", "") or "",
                    "pay_amount": float(item.get("pay_amount") or 0),
                    "discount_amount": float(item.get("discount_amount") or 0),
                    "serial_number": item.get("serial_number", "") or "",
                    "supplier_name": "智店通",
                    # update values
                    "upd_product_name": item.get("product_name", "") or "",
                    "upd_deal_price": float(item.get("unit_price") or 0),
                    "upd_quantity": int(item.get("quantity") or 0),
                    "upd_serial_number": item.get("serial_number", "") or "",
                    "upd_serial_numbers_json": json.dumps(serial_numbers, ensure_ascii=False),
                })
                items_saved += 1
            except Exception as e:
                print(f"    [商品错误] {item_id}: {e}")

    sqlite_conn.commit()

    # 验证
    sqlite_cur.execute("SELECT COUNT(*) FROM sales_order WHERE cashier_name != ''")
    total_with_cashier = sqlite_cur.fetchone()[0]
    sqlite_cur.execute("SELECT COUNT(*) FROM sales_order WHERE external_order_no != ''")
    total_with_ext = sqlite_cur.fetchone()[0]

    print(f"  写入: 订单 {orders_saved} 条, 商品明细 {items_saved} 条")
    print(f"  SQLite sales_order 总数(有收银员): {total_with_cashier} 条")
    print(f"  SQLite sales_order 总数(有外部订单号): {total_with_ext} 条")

    sqlite_cur.close()
    sqlite_conn.close()

    # 保存状态
    state["last_sync_time"] = max_time
    save_state(state)
    print(f"  状态已更新: last_sync_time={max_time[:19]}")

if __name__ == "__main__":
    sync()
