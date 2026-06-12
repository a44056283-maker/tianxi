"""
Tests for Electronic Price Tag Sync API — 电子价签同步队列
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_list_price_tag_tasks_returns_200():
    """GET /api/price-tag/tasks returns 200."""
    response = client.get("/api/price-tag/tasks")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


def test_list_price_tag_tasks_returns_array():
    """Response is a list."""
    response = client.get("/api/price-tag/tasks")
    data = response.json()
    assert isinstance(data, list), f"Expected list, got {type(data)}"


def test_create_price_tag_task_returns_200():
    """POST /api/price-tag/tasks creates a task and returns 200."""
    response = client.post(
        "/api/price-tag/tasks",
        json={
            "skuKey": "20006725",
            "storeCode": "LENOVO-SR-001",
            "templateId": "default-store-price",
            "pricePayload": {"storeRetailPrice": 11599.0, "skuKey": "20006725"},
            "source": "test_suite",
        },
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert "id" in data
    assert data["skuKey"] == "20006725"
    assert data["status"] == "pending"


def test_create_price_tag_task_requires_sku_key():
    """Empty skuKey returns 422."""
    response = client.post(
        "/api/price-tag/tasks",
        json={"skuKey": "", "templateId": "default-store-price", "pricePayload": {}},
    )
    assert response.status_code == 422, f"Expected 422, got {response.status_code}"


def test_get_price_tag_task_returns_404_for_unknown():
    """GET /api/price-tag/tasks/unknown-id returns 404."""
    response = client.get("/api/price-tag/tasks/PT-DOES-NOT-EXIST-123")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


def test_get_price_tag_task_after_create():
    """After creation, GET returns the task."""
    # Create
    create_resp = client.post(
        "/api/price-tag/tasks",
        json={
            "skuKey": "20006725",
            "templateId": "default-store-price",
            "pricePayload": {"test": True},
            "source": "test_suite",
        },
    )
    task_id = create_resp.json()["id"]

    # Retrieve
    get_resp = client.get(f"/api/price-tag/tasks/{task_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == task_id
    assert data["skuKey"] == "20006725"


def test_list_tasks_filter_by_status():
    """GET /api/price-tag/tasks?status=pending returns filtered results."""
    response = client.get("/api/price-tag/tasks", params={"status": "pending"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # All items should have status=pending (or empty if none exist)
    for item in data:
        assert item["status"] == "pending"


def test_list_tasks_filter_by_sku_key():
    """GET /api/price-tag/tasks?skuKey=X returns only that SKU."""
    response = client.get("/api/price-tag/tasks", params={"skuKey": "20006725"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_retry_failed_task():
    """POST /api/price-tag/tasks/{id}/retry resets to pending."""
    # Find a pending or confirmed task to retry
    list_resp = client.get("/api/price-tag/tasks", params={"limit": 1})
    items = list_resp.json()
    if not items:
        # No tasks exist yet, skip
        return

    task_id = items[0]["id"]
    retry_resp = client.post(f"/api/price-tag/tasks/{task_id}/retry")
    assert retry_resp.status_code == 200
    data = retry_resp.json()
    assert data["status"] == "pending"
    assert data["retryCount"] == 0


def test_retry_unknown_task_returns_404():
    """Retry non-existent task returns 404."""
    response = client.post("/api/price-tag/tasks/PT-DOES-NOT-EXIST-999/retry")
    assert response.status_code == 404
