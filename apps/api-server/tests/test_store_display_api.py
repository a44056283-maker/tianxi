"""
Tests for Store Display API — 价签-库存关联视图
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_store_display_returns_200():
    """GET /api/inventory/store-display returns 200."""
    response = client.get("/api/inventory/store-display")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


def test_store_display_returns_expected_fields():
    """Response contains all required top-level fields."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    assert "storeCode" in data
    assert "asOf" in data
    assert "items" in data
    assert "summary" in data


def test_store_display_items_are_list():
    """items is a list."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    assert isinstance(data["items"], list), f"Expected list, got {type(data['items'])}"


def test_store_display_item_has_required_fields():
    """Each item has all required fields."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    required_item_fields = [
        "skuKey", "productName", "category", "currentStock", "sellableStock",
        "storeRetailPrice", "priceTagStatus", "lastPriceTagUpdate", "lastSaleAt",
    ]
    for item in data["items"][:3]:  # Check first 3 items
        for field in required_item_fields:
            assert field in item, f"Missing field '{field}' in item: {item}"


def test_store_display_summary_fields():
    """Summary contains required counts."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    summary_fields = [
        "totalSkus", "pendingPriceTags", "failedPriceTags",
        "confirmedPriceTags", "lowStockSkus", "outOfStockSkus",
    ]
    for field in summary_fields:
        assert field in data["summary"], f"Missing summary field: {field}"
        assert isinstance(data["summary"][field], int), f"{field} should be int"


def test_store_display_with_category_filter():
    """Category filter returns only matching SKUs."""
    response = client.get(
        "/api/inventory/store-display",
        params={"category": "游戏笔记本"},
    )
    assert response.status_code == 200
    data = response.json()
    for item in data["items"]:
        assert item["category"] == "游戏笔记本", (
            f"Expected category '游戏笔记本', got '{item['category']}'"
        )


def test_store_display_total_skus_matches_items_length():
    """summary.totalSkus equals len(items)."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    assert data["summary"]["totalSkus"] == len(data["items"]), (
        f"totalSkus mismatch: {data['summary']['totalSkus']} != {len(data['items'])}"
    )


def test_store_display_price_tag_status_valid():
    """Each item's priceTagStatus is a known status value."""
    response = client.get("/api/inventory/store-display")
    data = response.json()
    valid_statuses = {"pending", "sending", "confirmed", "failed", "unknown"}
    for item in data["items"]:
        status = item.get("priceTagStatus", "")
        assert status in valid_statuses, f"Invalid priceTagStatus: '{status}'"
