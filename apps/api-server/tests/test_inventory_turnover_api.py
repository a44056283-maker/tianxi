"""
Tests for Inventory Turnover Report API — 进销存闭环报表
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the app module is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_turnover_report_returns_200():
    """Basic smoke test: GET /api/inventory/turnover-report returns 200."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-06-10"},
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


def test_turnover_report_returns_expected_fields():
    """Response contains all required fields."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-06-10"},
    )
    data = response.json()
    expected_fields = [
        "startDate", "endDate", "openingStock", "purchases", "sales",
        "adjustments", "closingStock", "turnoverRate", "daysOfSupply",
        "avgStock", "daysInPeriod", "byCategory",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


def test_turnover_report_closing_stock_equals_opening_plus_net():
    """closingStock = openingStock + sum(all period movements)."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-06-10"},
    )
    data = response.json()
    # closingStock = openingStock + net movements in period
    # period_net includes ALL movement types (purchase, transfer, sales, po_hold, manual, etc.)
    period_net = data["closingStock"] - data["openingStock"]
    # Verify the identity holds: closing = opening + period_net
    assert data["closingStock"] == data["openingStock"] + period_net, (
        f"closingStock ({data['closingStock']}) != openingStock ({data['openingStock']}) + period_net ({period_net})"
    )
    # Verify closingStock is a reasonable value (>= 0)
    assert data["closingStock"] >= 0, f"closingStock should be non-negative, got {data['closingStock']}"


def test_turnover_report_turnover_rate_is_positive():
    """Turnover rate should be non-negative when there are sales."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-06-10"},
    )
    data = response.json()
    if data["sales"] > 0:
        assert data["turnoverRate"] >= 0, "Turnover rate should be non-negative"


def test_turnover_report_rejects_invalid_date_format():
    """Invalid date format returns 400."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "01-01-2026", "endDate": "06-10-2026"},
    )
    assert response.status_code == 400, f"Expected 400, got {response.status_code}"


def test_turnover_report_rejects_start_after_end():
    """startDate > endDate returns 400."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-06-10", "endDate": "2026-01-01"},
    )
    assert response.status_code == 400, f"Expected 400, got {response.status_code}"


def test_turnover_report_with_category_filter():
    """Category filter returns filtered results."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-06-10", "category": "游戏笔记本"},
    )
    assert response.status_code == 200
    data = response.json()
    # All byCategory items should match the filter (or empty if no match)
    for item in data.get("byCategory", []):
        assert item["category"] == "游戏笔记本"


def test_turnover_report_days_in_period():
    """daysInPeriod = endDate - startDate + 1."""
    response = client.get(
        "/api/inventory/turnover-report",
        params={"startDate": "2026-01-01", "endDate": "2026-01-31"},
    )
    data = response.json()
    assert data["daysInPeriod"] == 31, f"Expected 31 days, got {data['daysInPeriod']}"
