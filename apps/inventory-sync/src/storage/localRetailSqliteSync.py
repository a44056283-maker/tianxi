#!/usr/bin/env python3
"""
本店零售系统 SQLite (retail-core.sqlite3) → PostgreSQL 实时同步

数据流：
  retail-core.sqlite3           →  PostgreSQL fact_* 表
  inventory_movement (1760条)  →  fact_stock_orders (库存流水)
  sales_order (810条)          →  fact_orders (销售订单)
  serial_item (415条)          →  fact_sn_records (SN记录)

实时策略：轮询 created_at，每 30 秒检测新记录并写入
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, date
from pathlib import Path
from typing import Any

import psycopg

# ── 配置 ────────────────────────────────────────────────────────────────────
RETAIL_DB = os.environ.get(
    "LENOVO_SMART_RETAIL_DB_FILE",
    "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
)
PG_CONN = os.environ.get(
    "ZDT_SYNC_DATABASE_URL",
    "postgresql://zdt:zdt@localhost:5432/zdt_sync"
)
POLL_INTERVAL = 30  # 秒


# ── SQLite ───────────────────────────────────────────────────────────────────
def sqlite_connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def row_dict(row: sqlite3.Row) -> dict:
    return dict(row)


# ── PG ───────────────────────────────────────────────────────────────────────
def pg_conn():
    return psycopg.connect(PG_CONN)


def upsert(table: str, record: dict, pk_fields: list[str], all_fields: list[str]):
    """Upsert 到 PostgreSQL。ON CONFLICT DO UPDATE 以 pk_fields 为准。"""
    if not record:
        return
    cols = [f for f in all_fields if f in record]
    data = {c: record[c] for c in cols}
    data["collected_at"] = datetime.utcnow()
    placeholders = ", ".join([f"%({c})s" for c in cols])
    updates = ", ".join([f"{c}=EXCLUDED.{c}" for c in cols if c not in pk_fields])
    sql = f"""
        INSERT INTO {table} ({", ".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT ({", ".join(pk_fields)}) DO UPDATE SET {updates}
    """
    try:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, data)
            conn.commit()
    except Exception as e:
        pass  # 忽略个别写入错误


# ── 同步库存流水 ─────────────────────────────────────────────────────────────
def sync_inventory_movements(conn: sqlite3.Connection, since: str | None) -> int:
    """inventory_movement → fact_stock_orders"""
    if since:
        rows = conn.execute(
            "SELECT * FROM inventory_movement WHERE created_at > ? ORDER BY created_at",
            (since,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM inventory_movement ORDER BY created_at LIMIT 5000"
        ).fetchall()

    count = 0
    for row in rows:
        d = row_dict(row)
        record = {
            "id": d.get("id"),
            "sku_no": d.get("sku_key"),
            "service_type_name": d.get("source_document_type", ""),
            "service_no": d.get("source_ref", ""),
            "spu_no": d.get("spu_no", ""),
            "product_name": d.get("product_name", ""),
            "property_name": d.get("property_name", ""),
            "property_value": d.get("property_value", ""),
            "operate_type_name": d.get("movement_type", ""),
            "quantity": d.get("quantity"),
            "user_name": d.get("operator_name", ""),
            "pay_date": d.get("business_date", "")[:10] if d.get("business_date") else None,
            "pay_time": d.get("business_date", ""),
            "pay_remark": d.get("pay_remark", ""),
            "warehouse_location_name": d.get("warehouse_location_name", "") or d.get("location_name", ""),
            "raw_payload": json.dumps(d, ensure_ascii=False),
            "source_name": d.get("source_system", "local_sqlite"),
            "supplier_name": d.get("supplier_name", ""),
            "company_name": d.get("company_name", ""),
            "shop_name": d.get("shop_name", "") or d.get("store_name", ""),
            "shop_no": d.get("sku_key", "")[:10] if d.get("sku_key") else "",
            "mtm_code": d.get("pn_mtm", ""),
        }
        upsert("fact_stock_orders", record,
               pk_fields=["id"],
               all_fields=["id","sku_no","service_type_name","service_no","spu_no","product_name",
                           "property_name","property_value","operate_type_name","quantity","user_name",
                           "pay_date","pay_time","pay_remark","warehouse_location_name","raw_payload",
                           "source_name","supplier_name","company_name","shop_name","shop_no","mtm_code",
                           "collected_at"])
        count += 1
    return count


# ── 同步销售订单 ─────────────────────────────────────────────────────────────
def sync_sales_orders(conn: sqlite3.Connection, since: str | None) -> int:
    """sales_order + sales_order_line → fact_orders"""
    if since:
        rows = conn.execute(
            "SELECT * FROM sales_order WHERE created_at > ? ORDER BY created_at",
            (since,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM sales_order ORDER BY created_at LIMIT 5000"
        ).fetchall()

    count = 0
    for row in rows:
        d = row_dict(row)
        order_id = d.get("id")

        # 获取订单行
        lines = conn.execute(
            "SELECT * FROM sales_order_line WHERE order_id = ?",
            (order_id,)
        ).fetchall()

        if not lines:
            # 无行订单
            rec = {
                "order_id": order_id,
                "order_no": d.get("external_order_no") or order_id,
                "outer_order_no": d.get("external_order_no"),
                "status": 1 if d.get("status") == "completed" else 0,
                "status_name": d.get("status_name", ""),
                "total_amount": d.get("total_amount", 0) or 0,
                "pay_amount": d.get("pay_amount", 0) or 0,
                "total_quantity": d.get("total_quantity", 0) or 0,
                "buyer_nick": d.get("customer_name", ""),
                "shop_name": d.get("shop_name", ""),
                "order_type": 2,  # offline/pos
                "order_type_name": d.get("channel_type_name", "") or d.get("order_type_name", ""),
                "pay_time": d.get("pay_time") or None,
                "created_time": d.get("created_time") or None,
                "cashier_name": d.get("cashier_name", ""),
                "raw_payload": d.get("raw_payload_json", "{}"),
                "source_name": "local_sqlite",
            }
            upsert("fact_orders", rec,
                   pk_fields=["order_id"],
                   all_fields=["order_id","order_no","outer_order_no","status","status_name",
                               "total_amount","pay_amount","total_quantity","buyer_nick","shop_name",
                               "order_type","order_type_name","pay_time","created_time","cashier_name",
                               "raw_payload","source_name","collected_at"])
            count += 1
            continue

        # 有行订单：先插入 header，再插入所有行（解决 FK 约束）
        head = {
            "order_id": order_id,
            "order_no": d.get("external_order_no") or order_id,
            "outer_order_no": d.get("external_order_no"),
            "status": 1 if d.get("status") in ("已完成", "completed") else 0,
            "status_name": d.get("status_name", ""),
            "total_amount": d.get("total_amount", 0) or 0,
            "pay_amount": d.get("pay_amount", 0) or 0,
            "total_quantity": d.get("total_quantity", 0) or 0,
            "buyer_nick": d.get("customer_name", ""),
            "shop_name": d.get("shop_name", ""),
            "order_type": 2,
            "order_type_name": d.get("channel_type_name", "") or d.get("order_type_name", ""),
            "pay_time": d.get("pay_time") or None,
            "created_time": d.get("created_time") or None,
            "cashier_name": d.get("cashier_name", ""),
            "raw_payload": d.get("raw_payload_json", "{}"),
            "source_name": "local_sqlite",
        }
        upsert("fact_orders", head,
               pk_fields=["order_id"],
               all_fields=["order_id","order_no","outer_order_no","status","status_name",
                           "total_amount","pay_amount","total_quantity","buyer_nick","shop_name",
                           "order_type","order_type_name","pay_time","created_time","cashier_name",
                           "raw_payload","source_name","collected_at"])
        count += 1

        for line in lines:
            ld = row_dict(line)
            line_sku = ld.get("sku_key", "") or ""
            line_record = {
                "id": f"{order_id}_{line_sku}",
                "order_id": order_id,
                "product_name": ld.get("product_name", ""),
                "product_no": ld.get("product_no", ""),
                "sku_no": line_sku,
                "barcode": ld.get("barcode", "") or ld.get("bar_code", ""),
                "mtm_code": ld.get("mtm_code", ""),
                "spec": ld.get("spec", ""),
                "quantity": ld.get("quantity", 0) or 0,
                "unit_price": ld.get("deal_price", 0) or 0,
                "total_amount": (ld.get("deal_price", 0) or 0) * (ld.get("quantity", 0) or 0),
                "pay_amount": ld.get("deal_price", 0) or 0,
                "discount_amount": 0,
                "serial_number": ld.get("serial_number", ""),
                "raw_payload": json.dumps({"order": d, "line": ld}, ensure_ascii=False),
                "collected_at": datetime.utcnow(),
            }
            upsert("fact_order_items", line_record,
                   pk_fields=["id"],
                   all_fields=["id","order_id","product_name","product_no","sku_no","barcode",
                               "mtm_code","spec","quantity","unit_price","total_amount","pay_amount",
                               "discount_amount","serial_number","raw_payload","collected_at"])
            count += 1

    return count


# ── 同步SN记录 ───────────────────────────────────────────────────────────────
def sync_serial_items(conn: sqlite3.Connection, since: str | None) -> int:
    """serial_item → fact_sn_records"""
    if since:
        rows = conn.execute(
            "SELECT * FROM serial_item WHERE updated_at > ? ORDER BY updated_at",
            (since,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM serial_item ORDER BY updated_at LIMIT 5000"
        ).fetchall()

    count = 0
    for row in rows:
        d = row_dict(row)
        serial = d.get("serial_number", "")
        if not serial:
            continue
        record = {
            "id": serial,
            "serial_number": serial,
            "product_name": d.get("product_name", ""),
            "sku_no": d.get("sku_key", ""),
            "mtm_code": d.get("pn_mtm", ""),
            "property_name": d.get("spec", ""),
            "shop_name": d.get("warehouse_code", ""),  # warehouse_code as shop_name proxy
            "service_type_name": d.get("status", ""),
            "operate_type_name": d.get("warranty_status", ""),
            "pay_time": d.get("inbound_date", ""),
            "pay_remark": d.get("inbound_document_no", ""),
            "warehouse_location_name": d.get("location_code", ""),
            "user_name": d.get("operator_name", ""),
            "raw_payload": json.dumps(d, ensure_ascii=False),
            "source_name": "local_sqlite",
        }
        upsert("fact_sn_records", record,
               pk_fields=["id"],
               all_fields=["id","serial_number","product_name","sku_no","mtm_code","property_name",
                           "shop_name","service_type_name","operate_type_name","pay_time","pay_remark",
                           "warehouse_location_name","user_name","raw_payload","source_name","collected_at"])
        count += 1
    return count


# ── Sync metadata ─────────────────────────────────────────────────────────────
def get_last_sync(key: str) -> str | None:
    try:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT cursor_value FROM sync_state WHERE source_name = 'local_sqlite' AND entity_name = %s",
                    (key,)
                )
                row = cur.fetchone()
                return row[0] if row else None
    except Exception:
        return None


def set_last_sync(key: str, value: str):
    try:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sync_state (source_name, entity_name, cursor_value, last_sync_time, last_success_time, status, updated_at)
                    VALUES ('local_sqlite', %s, %s, NOW(), NOW(), 'active', NOW())
                    ON CONFLICT (source_name, entity_name) DO UPDATE SET
                        cursor_value = EXCLUDED.cursor_value,
                        last_sync_time = EXCLUDED.last_sync_time,
                        last_success_time = EXCLUDED.last_success_time,
                        updated_at = NOW()
                """, (key, value))
                conn.commit()
    except Exception:
        pass


# ── 主流程 ───────────────────────────────────────────────────────────────────
def run_sync(entity: str | None = None) -> dict[str, Any]:
    if not Path(RETAIL_DB).exists():
        return {"ok": False, "error": f"SQLite not found: {RETAIL_DB}"}

    try:
        conn = sqlite_connect(RETAIL_DB)
    except Exception as e:
        return {"ok": False, "error": f"SQLite connect failed: {e}"}

    now = datetime.utcnow().isoformat()
    results = {}
    entities = ["inventory_movement", "sales_order", "serial_item"]
    if entity:
        entities = [entity]

    for ent in entities:
        sync_key = f"local_sqlite_{ent}"
        since = get_last_sync(sync_key)
        try:
            if ent == "inventory_movement":
                count = sync_inventory_movements(conn, since)
            elif ent == "sales_order":
                count = sync_sales_orders(conn, since)
            elif ent == "serial_item":
                count = sync_serial_items(conn, since)
            else:
                count = 0
            results[ent] = {"ok": True, "count": count}
            set_last_sync(sync_key, now)
        except Exception as e:
            results[ent] = {"ok": False, "error": str(e)}

    conn.close()
    results["ok"] = all(v.get("ok", False) for v in results.values())
    return results


def run_poll(interval: int = 30, entity: str | None = None):
    print(f"[LocalSQLiteSync] 轮询模式启动，间隔 {interval} 秒", flush=True)
    print(f"[LocalSQLiteSync] SQLite: {RETAIL_DB}", flush=True)
    print(f"[LocalSQLiteSync] PG: {PG_CONN[:50]}...", flush=True)

    while True:
        ts = datetime.now().strftime("%H:%M:%S")
        try:
            result = run_sync(entity=entity)
            if result.get("ok"):
                counts = {k: v["count"] for k, v in result.items() if k != "ok" and v.get("ok")}
                print(f"[{ts}] ✓ 同步完成: {counts}", flush=True)
            else:
                print(f"[{ts}] ✗ 同步失败: {result.get('error')}", flush=True)
        except Exception as e:
            print(f"[{ts}] ✗ 轮询异常: {e}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="本地零售 SQLite → PostgreSQL 同步")
    parser.add_argument("--poll", "-p", action="store_true", help="轮询持续同步")
    parser.add_argument("--interval", "-i", type=int, default=30, help="轮询间隔（秒）")
    parser.add_argument("--entity", "-e", choices=["inventory_movement","sales_order","serial_item"],
                        help="只同步指定实体")
    args = parser.parse_args()

    if args.poll:
        run_poll(interval=args.interval, entity=args.entity)
    else:
        result = run_sync(entity=args.entity)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(0 if result.get("ok") else 1)
