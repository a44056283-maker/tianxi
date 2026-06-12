#!/usr/bin/env python3
"""
工程软件 API (http://192.168.13.104:5174) → PostgreSQL 实时同步

数据源：
  GET /api/inventory-quote/inventory {"skus": [...]} → fact_inventory
  GET /api/sales/orders                               → fact_orders + fact_order_items

实时策略：轮询 30 秒，upsert
"""

import argparse
import json
import os
import time
from datetime import datetime, date
from typing import Any

import psycopg
import requests

# ── 配置 ─────────────────────────────────────────────────────────────────────
ENGINEER_API = os.environ.get("ENGINEER_API_BASE", "http://192.168.13.104:5174")
PG_CONN = os.environ.get(
    "ZDT_SYNC_DATABASE_URL",
    "postgresql://zdt:zdt@localhost:5432/zdt_sync"
)
WRITE_FACT_INVENTORY_MAIN = os.environ.get("ENGINEER_API_WRITE_FACT_INVENTORY_MAIN", "0").strip().lower() in {"1", "true", "yes", "on"}
TIMEOUT_SECONDS = 15


# ── HTTP ──────────────────────────────────────────────────────────────────────
def api_get(path: str) -> dict[str, Any] | None:
    url = f"{ENGINEER_API}{path}"
    try:
        r = requests.get(url, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[API ERROR] {url}: {e}", flush=True)
        return None


# ── PG ───────────────────────────────────────────────────────────────────────
def pg_conn():
    return psycopg.connect(PG_CONN)


# ── 同步库存 ─────────────────────────────────────────────────────────────────
def sync_inventory() -> int:
    """
    GET /api/inventory-quote/inventory
    默认只写镜像表 engineer_api_inventory_mirror，避免污染 fact_inventory 主链。
    如需旧行为，设置 ENGINEER_API_WRITE_FACT_INVENTORY_MAIN=1。
    """
    data = api_get("/api/inventory-quote/inventory")
    if not data or not isinstance(data, dict):
        return 0

    skus = data.get("skus", []) or (data if isinstance(data, list) else [])

    today = date.today().isoformat()
    count = 0
    now = datetime.utcnow()

    for item in skus:
        sku_no = str(item.get("skuKey", "") or item.get("skuCode", ""))
        if not sku_no:
            continue

        record = {
            "sku_no": sku_no,
            "sku_name": item.get("productName", ""),
            "mtm_code": item.get("pnMtm", ""),
            "category_name": item.get("category", ""),
            "current_stock": item.get("currentStock", 0) or 0,
            "available_sale_stock": item.get("sellableStock", 0) or 0,
            "booked_stock": item.get("occupiedStock", 0) or 0,
            "pending_stock": item.get("pendingInboundStock", 0) or 0,
            "unsellable_stock": item.get("unsellableStock", 0) or 0,
            "shop_name": item.get("organizationName", ""),
            "shop_no": item.get("organizationCode", ""),
            "cost_price": item.get("salesCostPrice"),
            "snapshot_date": today,
            "source_name": "engineer_api",
            "collected_at": now,
            "raw_payload": json.dumps(item, ensure_ascii=False),
        }

        mirror_sql = """
            CREATE TABLE IF NOT EXISTS engineer_api_inventory_mirror (
                sku_no TEXT NOT NULL,
                snapshot_date DATE NOT NULL,
                sku_name TEXT,
                mtm_code TEXT,
                category_name TEXT,
                current_stock NUMERIC,
                available_sale_stock NUMERIC,
                booked_stock NUMERIC,
                pending_stock NUMERIC,
                unsellable_stock NUMERIC,
                shop_name TEXT,
                shop_no TEXT,
                cost_price NUMERIC,
                source_name TEXT NOT NULL DEFAULT 'engineer_api',
                raw_payload JSONB,
                collected_at TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (sku_no, snapshot_date)
            )
        """
        fact_sql = """
            INSERT INTO fact_inventory (
                id, snapshot_date,
                sku_no, sku_name, mtm_code, category_name,
                current_stock, available_sale_stock, booked_stock,
                pending_stock, unsellable_stock,
                shop_name, shop_no, cost_price,
                source_name, raw_payload, collected_at
            )
            SELECT
                COALESCE(
                    (SELECT id FROM fact_inventory
                     WHERE sku_no = %(sku_no)s AND snapshot_date = %(snapshot_date)s
                     LIMIT 1),
                    (SELECT COALESCE(MAX(id), 2000000000000000000) + 1 FROM fact_inventory)
                ),
                %(snapshot_date)s,
                %(sku_no)s, %(sku_name)s, %(mtm_code)s, %(category_name)s,
                %(current_stock)s, %(available_sale_stock)s, %(booked_stock)s,
                %(pending_stock)s, %(unsellable_stock)s,
                %(shop_name)s, %(shop_no)s, %(cost_price)s,
                %(source_name)s, %(raw_payload)s::jsonb, %(collected_at)s
            ON CONFLICT (id, snapshot_date) DO UPDATE SET
                sku_name              = EXCLUDED.sku_name,
                mtm_code              = EXCLUDED.mtm_code,
                category_name         = EXCLUDED.category_name,
                current_stock         = EXCLUDED.current_stock,
                available_sale_stock  = EXCLUDED.available_sale_stock,
                booked_stock          = EXCLUDED.booked_stock,
                pending_stock         = EXCLUDED.pending_stock,
                unsellable_stock      = EXCLUDED.unsellable_stock,
                shop_name             = EXCLUDED.shop_name,
                shop_no               = EXCLUDED.shop_no,
                cost_price            = EXCLUDED.cost_price,
                raw_payload           = EXCLUDED.raw_payload,
                collected_at          = EXCLUDED.collected_at
            WHERE fact_inventory.source_name IS NULL
                OR fact_inventory.source_name = 'engineer_api'
        """
        try:
            with pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(mirror_sql)
                    cur.execute(
                        """
                        INSERT INTO engineer_api_inventory_mirror (
                            sku_no, snapshot_date, sku_name, mtm_code, category_name,
                            current_stock, available_sale_stock, booked_stock, pending_stock,
                            unsellable_stock, shop_name, shop_no, cost_price,
                            source_name, raw_payload, collected_at
                        ) VALUES (
                            %(sku_no)s, %(snapshot_date)s, %(sku_name)s, %(mtm_code)s, %(category_name)s,
                            %(current_stock)s, %(available_sale_stock)s, %(booked_stock)s, %(pending_stock)s,
                            %(unsellable_stock)s, %(shop_name)s, %(shop_no)s, %(cost_price)s,
                            %(source_name)s, %(raw_payload)s::jsonb, %(collected_at)s
                        )
                        ON CONFLICT (sku_no, snapshot_date) DO UPDATE SET
                            sku_name             = EXCLUDED.sku_name,
                            mtm_code             = EXCLUDED.mtm_code,
                            category_name        = EXCLUDED.category_name,
                            current_stock        = EXCLUDED.current_stock,
                            available_sale_stock = EXCLUDED.available_sale_stock,
                            booked_stock         = EXCLUDED.booked_stock,
                            pending_stock        = EXCLUDED.pending_stock,
                            unsellable_stock     = EXCLUDED.unsellable_stock,
                            shop_name            = EXCLUDED.shop_name,
                            shop_no              = EXCLUDED.shop_no,
                            cost_price           = EXCLUDED.cost_price,
                            raw_payload          = EXCLUDED.raw_payload,
                            collected_at         = EXCLUDED.collected_at
                        """,
                        record,
                    )
                    if WRITE_FACT_INVENTORY_MAIN:
                        cur.execute(fact_sql, record)
            count += 1
        except Exception as e:
            print(f"[PG ERROR] sku={sku_no}: {e}", flush=True)

    return count


# ── 同步销售订单 ──────────────────────────────────────────────────────────────
def sync_sales_orders() -> int:
    """GET /api/sales/orders → fact_orders（头）+ fact_order_items（明细），同一事务"""
    data = api_get("/api/sales/orders")
    if not data or "items" not in data:
        return 0

    count = 0
    status_map = {"pending": 0, "completed": 1, "cancelled": 2, "refunded": 3}

    for order in data["items"]:
        order_id = str(order.get("id", ""))
        if not order_id:
            continue

        lines = order.get("lines", []) or []

        try:
            with pg_conn() as conn:
                with conn.cursor() as cur:
                    # ── 订单头 ───────────────────────────────────────────────
                    cur.execute("""
                        INSERT INTO fact_orders (
                            order_id, order_no, status, status_name,
                            total_amount, pay_amount, product_amount, total_quantity,
                            buyer_nick, shop_name, order_type, order_type_name,
                            pay_time, created_time, raw_payload, source_name, collected_at
                        ) VALUES (
                            %(order_id)s, %(order_no)s, %(status)s, %(status_name)s,
                            %(total_amount)s, %(pay_amount)s, %(product_amount)s, %(total_quantity)s,
                            %(buyer_nick)s, %(shop_name)s, %(order_type)s, %(order_type_name)s,
                            %(pay_time)s, %(created_time)s, %(raw_payload)s::jsonb,
                            %(source_name)s, %(collected_at)s
                        )
                        ON CONFLICT (order_id) DO UPDATE SET
                            status = EXCLUDED.status,
                            status_name = EXCLUDED.status_name,
                            total_amount = EXCLUDED.total_amount,
                            pay_amount = EXCLUDED.pay_amount,
                            total_quantity = EXCLUDED.total_quantity,
                            buyer_nick = EXCLUDED.buyer_nick,
                            shop_name = EXCLUDED.shop_name,
                            pay_time = EXCLUDED.pay_time,
                            created_time = EXCLUDED.created_time,
                            raw_payload = EXCLUDED.raw_payload,
                            collected_at = EXCLUDED.collected_at
                    """, {
                        "order_id": order_id,
                        "order_no": order_id,
                        "status": status_map.get(str(order.get("status", "")).lower(), 0),
                        "status_name": order.get("status", ""),
                        "total_amount": order.get("totalAmount", 0) or 0,
                        "pay_amount": 0,
                        "product_amount": 0,
                        "total_quantity": 0,
                        "buyer_nick": order.get("customerName", ""),
                        "shop_name": order.get("storeName", "") or order.get("storeCode", ""),
                        "order_type": 2,
                        "order_type_name": "工程软件直销",
                        "pay_time": order.get("businessDate", ""),
                        "created_time": order.get("createdAt", ""),
                        "raw_payload": json.dumps(order, ensure_ascii=False),
                        "source_name": "engineer_api",
                        "collected_at": datetime.utcnow(),
                    })

                    # ── 订单明细 ─────────────────────────────────────────────
                    for line in lines:
                        sku_no = str(line.get("skuKey", "") or line.get("sku_key", ""))
                        item_id = f"{order_id}_{sku_no}" if sku_no else order_id
                        cur.execute("""
                            INSERT INTO fact_order_items (
                                id, order_id, product_name, product_no, sku_no, barcode,
                                mtm_code, spec, quantity, unit_price, total_amount,
                                pay_amount, discount_amount, serial_number, raw_payload, collected_at
                            ) VALUES (
                                %(id)s, %(order_id)s, %(product_name)s, %(product_no)s,
                                %(sku_no)s, %(barcode)s, %(mtm_code)s, %(spec)s,
                                %(quantity)s, %(unit_price)s, %(total_amount)s,
                                %(pay_amount)s, %(discount_amount)s, %(serial_number)s,
                                %(raw_payload)s::jsonb, %(collected_at)s
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                product_name = EXCLUDED.product_name,
                                product_no = EXCLUDED.product_no,
                                sku_no = EXCLUDED.sku_no,
                                barcode = EXCLUDED.barcode,
                                mtm_code = EXCLUDED.mtm_code,
                                spec = EXCLUDED.spec,
                                quantity = EXCLUDED.quantity,
                                unit_price = EXCLUDED.unit_price,
                                total_amount = EXCLUDED.total_amount,
                                pay_amount = EXCLUDED.pay_amount,
                                serial_number = EXCLUDED.serial_number,
                                raw_payload = EXCLUDED.raw_payload,
                                collected_at = EXCLUDED.collected_at
                        """, {
                            "id": item_id,
                            "order_id": order_id,
                            "product_name": line.get("productName", ""),
                            "product_no": line.get("productNo", "") or line.get("product_no", ""),
                            "sku_no": sku_no,
                            "barcode": line.get("barcode", "") or line.get("bar_code", ""),
                            "mtm_code": line.get("pnMtm", "") or line.get("mtm_code", ""),
                            "spec": line.get("spec", ""),
                            "quantity": line.get("quantity", 0) or 0,
                            "unit_price": line.get("dealPrice", 0) or 0,
                            "total_amount": (line.get("dealPrice", 0) or 0) * (line.get("quantity", 0) or 0),
                            "pay_amount": line.get("dealPrice", 0) or 0,
                            "discount_amount": 0,
                            "serial_number": line.get("serialNumber", "") or line.get("serial_number", ""),
                            "raw_payload": json.dumps(line, ensure_ascii=False),
                            "collected_at": datetime.utcnow(),
                        })
                        count += 1

                conn.commit()
        except Exception as e:
            print(f"[PG ERROR] order={order_id}: {e}", flush=True)

    return count


# ── 主流程 ────────────────────────────────────────────────────────────────────
def run_sync() -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    inv_count = sync_inventory()
    ord_count = sync_sales_orders()
    return {
        "inventory": {"ok": True, "count": inv_count, "at": now},
        "sales_orders": {"ok": True, "count": ord_count, "at": now},
        "ok": True,
    }


def run_poll(interval: int = 30):
    print(f"[EngineerApiSync] 轮询启动，间隔 {interval}s | API: {ENGINEER_API}", flush=True)
    while True:
        ts = datetime.now().strftime("%H:%M:%S")
        try:
            result = run_sync()
            print(f"[{ts}] ✓ 库存 {result['inventory']['count']} 条, 订单项 {result['sales_orders']['count']} 条", flush=True)
        except Exception as e:
            print(f"[{ts}] ✗ {e}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    poll = "--poll" in args or "-p" in args
    interval = 30
    if "-i" in args:
        idx = args.index("-i")
        interval = int(args[idx + 1])

    if poll:
        run_poll(interval)
    else:
        print(json.dumps(run_sync(), indent=2, ensure_ascii=False))
