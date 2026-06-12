"""
Inventory Turnover Report API — 进销存闭环报表

GET /api/inventory/turnover-report
Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), category? (optional)
"""
from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import retail_core


router = APIRouter(prefix="/api/inventory", tags=["inventory-turnover"])


class TurnoverReportResponse(BaseModel):
    startDate: str
    endDate: str
    openingStock: int
    purchases: int
    sales: int
    adjustments: int
    closingStock: int
    turnoverRate: float
    daysOfSupply: float
    avgStock: float
    daysInPeriod: int
    byCategory: list[dict[str, Any]]


def _parse_date(value: str | None) -> date:
    if not value:
        raise HTTPException(status_code=400, detail="startDate and endDate are required")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {value}. Use YYYY-MM-DD")


def _date_to_iso(d: date) -> str:
    return d.isoformat()


def compute_turnover_report(
    start_date: date,
    end_date: date,
    category: str | None = None,
) -> dict[str, Any]:
    """
    Compute turnover metrics from inventory_movement data.

    Movement type mapping:
      - purchase_inbound  → purchases (+)
      - transfer_inbound  → transfers_in (+)
      - sales_outbound    → sales (-)  [absolute value for count]
      - transfer_outbound → transfers_out (-)
      - manual_adjustment  → adjustments (+ or -)
      - po_hold_*         → (ignored for turnover)
    """
    conn = retail_core.connect()

    # Build date boundary strings
    start_iso = _date_to_iso(start_date)
    end_iso = _date_to_iso(end_date)
    # Period end: include the full end_date
    period_end_iso = end_iso + " 23:59:59"

    # Base WHERE clause for movements in period
    where_period = """
        business_date >= ? AND business_date < ?
    """
    params_period: tuple[str, str, str] = (start_iso, period_end_iso)

    # Opening stock: cumulative movements before start_date
    opening_rows = conn.execute(
        """
        SELECT movement_type, quantity, sku_key
        FROM inventory_movement
        WHERE business_date < ?
        """,
        (start_iso,),
    ).fetchall()

    # Movements in period
    period_rows = conn.execute(
        """
        SELECT movement_type, quantity, sku_key
        FROM inventory_movement
        WHERE business_date >= ? AND business_date < ?
        """,
        params_period,
    ).fetchall()

    # Category filter: join with sku on sku_key (always use alias 'im')
    category_join = ""
    category_where = ""
    params_category: tuple[str, ...] = ()
    if category:
        category_join = "JOIN sku ON im.sku_key = sku.sku_key"
        category_where = "AND sku.category = ?"
        params_category = (category,)

    conn.close()

    # Aggregate by movement type
    def sum_movements(rows, movement_types, sign: int = 1) -> int:
        total = 0
        for row in rows:
            if row["movement_type"] in movement_types:
                total += sign * int(row["quantity"] or 0)
        return total

    # Opening stock = all inbound movements before start - all outbound before start
    opening_inbound = sum_movements(
        opening_rows,
        {"purchase_inbound", "transfer_inbound", "po_hold_inbound", "po_hold_release", "po_hold_reopen_inbound"},
        sign=1,
    )
    opening_outbound = sum_movements(
        opening_rows,
        {"sales_outbound", "transfer_outbound", "po_hold_outbound", "po_hold_revoke_outbound"},
        sign=1,
    )
    opening_adjustments = sum_movements(opening_rows, {"manual_adjustment"}, sign=1)
    opening_stock = opening_inbound - opening_outbound + opening_adjustments

    # Period aggregates (quantities are stored as positive; outbound types subtract)
    purchases = sum_movements(
        period_rows,
        {"purchase_inbound"},
        sign=1,
    )
    transfers_in = sum_movements(
        period_rows,
        {"transfer_inbound"},
        sign=1,
    )
    sales = abs(
        sum_movements(
            period_rows,
            {"sales_outbound"},
            sign=-1,
        )
    )
    transfers_out = abs(
        sum_movements(
            period_rows,
            {"transfer_outbound"},
            sign=-1,
        )
    )
    adjustments = sum_movements(period_rows, {"manual_adjustment"}, sign=1)

    # Closing stock: opening + all movements in period (all quantities are signed, sign=1 sums everything correctly)
    period_net = sum_movements(
        period_rows,
        {
            "purchase_inbound", "transfer_inbound", "po_hold_inbound",
            "po_hold_release", "po_hold_reopen_inbound",
            "sales_outbound", "transfer_outbound",
            "po_hold_outbound", "po_hold_revoke_outbound",
            "manual_adjustment",
        },
        sign=1,
    )
    closing_stock = opening_stock + period_net

    # Avg stock (simple average of opening and closing)
    avg_stock = (opening_stock + closing_stock) / 2.0

    # Days in period
    days_in_period = (end_date - start_date).days + 1

    # Turnover rate = sales / avg_stock
    turnover_rate = round(sales / avg_stock, 4) if avg_stock > 0 else 0.0

    # Days of supply = avg_stock / (sales / days_in_period)
    daily_sales_rate = sales / days_in_period if days_in_period > 0 else 0.0
    days_of_supply = round(avg_stock / daily_sales_rate, 1) if daily_sales_rate > 0 else 0.0

    # By-category breakdown
    # Categories from sku table
    sku_conn = retail_core.connect()
    categories_rows = sku_conn.execute("SELECT DISTINCT category FROM sku ORDER BY category").fetchall()
    sku_conn.close()

    by_category = []
    for cat_row in categories_rows:
        cat = str(cat_row["category"] or "")
        if not cat:
            continue
        # When filtering by category, skip non-matching categories
        if category and cat != category:
            continue

        # Recompute for this category using sku_key join
        cat_conn = retail_core.connect()
        cat_opening_rows = cat_conn.execute(
            """
            SELECT im.movement_type, im.quantity
            FROM inventory_movement im
            JOIN sku s ON im.sku_key = s.sku_key
            WHERE im.business_date < ? AND s.category = ?
            """,
            (start_iso, cat),
        ).fetchall()

        cat_period_rows = cat_conn.execute(
            """
            SELECT im.movement_type, im.quantity
            FROM inventory_movement im
            JOIN sku s ON im.sku_key = s.sku_key
            WHERE im.business_date >= ? AND im.business_date < ? AND s.category = ?
            """,
            (start_iso, period_end_iso, cat),
        ).fetchall()
        cat_conn.close()

        cat_opening_inbound = sum_movements(
            cat_opening_rows,
            {"purchase_inbound", "transfer_inbound", "po_hold_inbound", "po_hold_release", "po_hold_reopen_inbound"},
            sign=1,
        )
        cat_opening_outbound = sum_movements(
            cat_opening_rows,
            {"sales_outbound", "transfer_outbound", "po_hold_outbound", "po_hold_revoke_outbound"},
            sign=1,
        )
        cat_opening_adj = sum_movements(cat_opening_rows, {"manual_adjustment"}, sign=1)
        cat_opening = cat_opening_inbound - cat_opening_outbound + cat_opening_adj

        cat_purchases = sum_movements(cat_period_rows, {"purchase_inbound"}, sign=1)
        cat_sales = abs(sum_movements(cat_period_rows, {"sales_outbound"}, sign=-1))
        cat_adjustments = sum_movements(cat_period_rows, {"manual_adjustment"}, sign=1)
        # Closing: use all-period signed sum (correct approach)
        cat_period_net = sum_movements(
            cat_period_rows,
            {
                "purchase_inbound", "transfer_inbound", "po_hold_inbound",
                "po_hold_release", "po_hold_reopen_inbound",
                "sales_outbound", "transfer_outbound",
                "po_hold_outbound", "po_hold_revoke_outbound",
                "manual_adjustment",
            },
            sign=1,
        )
        cat_closing = cat_opening + cat_period_net

        by_category.append({
            "category": cat,
            "openingStock": cat_opening,
            "purchases": cat_purchases,
            "sales": cat_sales,
            "adjustments": cat_adjustments,
            "closingStock": cat_closing,
        })

    return {
        "startDate": _date_to_iso(start_date),
        "endDate": _date_to_iso(end_date),
        "openingStock": opening_stock,
        "purchases": purchases,
        "transfersIn": transfers_in,
        "sales": sales,
        "transfersOut": transfers_out,
        "adjustments": adjustments,
        "closingStock": closing_stock,
        "avgStock": round(avg_stock, 2),
        "turnoverRate": turnover_rate,
        "daysOfSupply": days_of_supply,
        "daysInPeriod": days_in_period,
        "byCategory": by_category,
    }


@router.get("/turnover-report", response_model=TurnoverReportResponse)
def get_turnover_report(
    startDate: str = Query(..., description="Start date YYYY-MM-DD"),
    endDate: str = Query(..., description="End date YYYY-MM-DD"),
    category: str | None = Query(None, description="Optional category filter"),
) -> TurnoverReportResponse:
    """
    进销存闭环报表
    - openingStock: stock at start of period
    - purchases: total purchase inbound quantity
    - sales: total sales outbound quantity
    - adjustments: manual adjustments
    - closingStock: opening + purchases - sales + adjustments
    - turnoverRate: sales / avgStock
    - daysOfSupply: avgStock / dailySalesRate
    """
    start = _parse_date(startDate)
    end = _parse_date(endDate)

    if start > end:
        raise HTTPException(status_code=400, detail="startDate must be <= endDate")

    data = compute_turnover_report(start, end, category)
    return TurnoverReportResponse(**data)
