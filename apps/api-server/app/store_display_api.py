"""
Store Display API — 价签-库存关联视图

GET /api/inventory/store-display
按门店 + 商品分类聚合：当前库存量、当前零售价、价签状态、最近一次销售时间

Data sources:
  - sku table: current_stock, sellable_stock
  - latest-published-product-projection-live.json: retail price
  - price_tag_update_task: latest task per sku
  - sales_order + sales_order_line: MAX(pay_time) per sku
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api/inventory", tags=["store-display"])


APP_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = APP_DIR / "apps" / "web-cockpit" / "public" / "data"
RETAIL_ZONE_SNAPSHOT_FILE = DATA_DIR / "latest-retail-zone-snapshot.json"
PRODUCT_PROJECTION_FILE = DATA_DIR / "latest-published-product-projection-live.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(v: Any) -> str:
    if not v:
        return ""
    return str(v)[:19]


def load_product_projection() -> dict[str, Any]:
    """Load the latest product projection snapshot for retail price data."""
    if not PRODUCT_PROJECTION_FILE.exists():
        return {}
    try:
        with open(PRODUCT_PROJECTION_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


class StoreDisplayItem(BaseModel):
    skuKey: str
    productName: str
    category: str
    currentStock: int
    sellableStock: int
    storeRetailPrice: float | None
    finalPrice: float | None
    priceTagStatus: str
    lastPriceTagUpdate: str
    lastSaleAt: str
    priceVersion: str | None


class StoreDisplaySummary(BaseModel):
    totalSkus: int
    pendingPriceTags: int
    failedPriceTags: int
    confirmedPriceTags: int
    lowStockSkus: int
    outOfStockSkus: int


class StoreDisplayResponse(BaseModel):
    storeCode: str
    asOf: str
    items: list[StoreDisplayItem]
    summary: StoreDisplaySummary


def compute_store_display(
    category: str | None = None,
    store_code: str = "LENOVO-SR-001",
) -> dict[str, Any]:
    """
    Compute store display data from:
      1. sku table (current_stock, sellable_stock)
      2. latest-published-product-projection-live.json (retail prices)
      3. price_tag_update_task (latest task status per sku)
      4. sales_order + sales_order_line (last sale time per sku)
    """
    from app import retail_core

    conn = retail_core.connect()

    # 1. Load all SKUs
    if category:
        sku_rows = conn.execute(
            """
            SELECT sku_key, name, category, current_stock, sellable_stock
            FROM sku WHERE category = ? ORDER BY category, name
            """,
            (category,),
        ).fetchall()
    else:
        sku_rows = conn.execute(
            """
            SELECT sku_key, name, category, current_stock, sellable_stock
            FROM sku ORDER BY category, name
            """,
        ).fetchall()

    sku_keys = [str(row["sku_key"]) for row in sku_rows]

    # 2. Load projection snapshot for retail prices
    projection = load_product_projection()
    projection_items: dict[str, dict[str, Any]] = {}
    if isinstance(projection, dict):
        items_list = projection.get("items") or []
        for item in items_list:
            if isinstance(item, dict):
                sku_k = str(item.get("skuKey") or "")
                if sku_k:
                    projection_items[sku_k] = item

    # 3. Load latest price tag task per sku
    price_tag_status: dict[str, dict[str, str]] = {}
    if sku_keys:
        placeholders = ",".join(["?"] * len(sku_keys))
        task_rows = conn.execute(
            f"""
            SELECT t1.sku_key, t1.status, t1.updated_at
            FROM price_tag_update_task t1
            INNER JOIN (
                SELECT sku_key, MAX(updated_at) as max_updated
                FROM price_tag_update_task
                WHERE sku_key IN ({placeholders})
                GROUP BY sku_key
            ) t2 ON t1.sku_key = t2.sku_key AND t1.updated_at = t2.max_updated
            """,
            sku_keys,
        ).fetchall()
        for row in task_rows:
            price_tag_status[str(row["sku_key"])] = {
                "status": str(row["status"] or "unknown"),
                "updatedAt": str(row["updated_at"] or ""),
            }

    # 4. Load last sale time per sku from sales_order + sales_order_line
    last_sale: dict[str, str] = {}
    if sku_keys:
        placeholders = ",".join(["?"] * len(sku_keys))
        sale_rows = conn.execute(
            f"""
            SELECT sol.sku_key, MAX(sa.pay_time) as last_sale_at
            FROM sales_order_line sol
            JOIN sales_order sa ON sol.order_id = sa.id
            WHERE sol.sku_key IN ({placeholders})
              AND sa.pay_time IS NOT NULL AND sa.pay_time != ''
            GROUP BY sol.sku_key
            """,
            sku_keys,
        ).fetchall()
        for row in sale_rows:
            last_sale[str(row["sku_key"])] = str(row["last_sale_at"] or "")

    conn.close()

    # Build items
    items: list[dict[str, Any]] = []
    pending_count = 0
    failed_count = 0
    confirmed_count = 0
    low_stock_count = 0
    out_of_stock_count = 0

    for row in sku_rows:
        sku_key = str(row["sku_key"])
        current_stock = int(row["current_stock"] or 0)
        sellable_stock = int(row["sellable_stock"] or 0)
        product_name = str(row["name"] or "")
        cat = str(row["category"] or "")

        # Get projection data
        proj = projection_items.get(sku_key, {})
        pricing = proj.get("pricing") or {}
        store_retail_price = pricing.get("storeRetailPrice")
        final_price = pricing.get("finalPrice")
        price_version = pricing.get("priceVersion")

        # Price tag status
        tag_info = price_tag_status.get(sku_key, {})
        tag_status = tag_info.get("status", "unknown")
        tag_updated = tag_info.get("updatedAt", "")

        # Last sale
        last_sale_at = last_sale.get(sku_key, "")

        # Counts for summary
        if tag_status == "pending":
            pending_count += 1
        elif tag_status == "failed":
            failed_count += 1
        elif tag_status == "confirmed":
            confirmed_count += 1

        if current_stock == 0:
            out_of_stock_count += 1
        elif current_stock < 5:
            low_stock_count += 1

        items.append({
            "skuKey": sku_key,
            "productName": product_name,
            "category": cat,
            "currentStock": current_stock,
            "sellableStock": sellable_stock,
            "storeRetailPrice": store_retail_price,
            "finalPrice": final_price,
            "priceTagStatus": tag_status,
            "lastPriceTagUpdate": tag_updated,
            "lastSaleAt": last_sale_at,
            "priceVersion": price_version,
        })

    return {
        "storeCode": store_code,
        "asOf": _now_iso(),
        "items": items,
        "summary": {
            "totalSkus": len(items),
            "pendingPriceTags": pending_count,
            "failedPriceTags": failed_count,
            "confirmedPriceTags": confirmed_count,
            "lowStockSkus": low_stock_count,
            "outOfStockSkus": out_of_stock_count,
        },
    }


@router.get("/store-display", response_model=StoreDisplayResponse)
def get_store_display(
    category: str | None = None,
    storeCode: str = "LENOVO-SR-001",
) -> StoreDisplayResponse:
    """
    价签-库存关联视图
    Returns per-SKU: current stock, retail price, price tag status, last sale time.
    """
    data = compute_store_display(category=category, store_code=storeCode)
    return StoreDisplayResponse(**data)
