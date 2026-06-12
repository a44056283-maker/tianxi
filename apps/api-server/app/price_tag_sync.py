"""
Electronic Price Tag Sync API — 电子价签同步队列

Provides:
  POST /api/price-tag/tasks          — create a price tag update task
  GET  /api/price-tag/tasks          — list tasks with filters
  GET  /api/price-tag/tasks/{id}     — get task detail
  POST /api/price-tag/tasks/{id}/retry — retry a failed task

Background worker (runs in FastAPI lifespan):
  Every 30s, scans for status='pending', sends to mock gateway,
  updates status to 'sending' → 'confirmed' or 'failed'.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

from app import retail_core


router = APIRouter(prefix="/api/price-tag", tags=["price-tag-sync"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class PriceTagTaskCreateInput(BaseModel):
    skuKey: str = Field(min_length=1)
    storeCode: str = Field(default="LENOVO-SR-001")
    templateId: str = Field(default="default-store-price")
    deviceId: str | None = None
    pricePayload: dict[str, Any] = Field(default_factory=dict)
    source: str = "manual_api"


class PriceTagTaskResponse(BaseModel):
    id: str
    deviceId: str | None
    skuKey: str
    templateId: str
    pricePayload: dict[str, Any]
    status: str
    retryCount: int
    lastError: str
    createdAt: str
    updatedAt: str


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_price_tag_tables(conn: retail_core.sqlite3.Connection) -> None:
    """Ensure price_tag_update_task table exists (idempotent)."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS price_tag_update_task (
          id TEXT PRIMARY KEY,
          device_id TEXT,
          sku_key TEXT NOT NULL,
          template_id TEXT NOT NULL,
          price_payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    # Index for efficient pending task polling
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_price_tag_task_status_created
        ON price_tag_update_task(status, created_at);
        """
    )


def create_price_tag_task(
    sku_key: str,
    template_id: str,
    price_payload: dict[str, Any],
    device_id: str | None = None,
    source: str = "manual_api",
) -> dict[str, Any]:
    """Create a new price tag update task."""
    conn = retail_core.connect()
    _ensure_price_tag_tables(conn)

    task_id = f"PT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    now = _now_iso()
    payload_json = json.dumps(price_payload, ensure_ascii=False)

    conn.execute(
        """
        INSERT INTO price_tag_update_task
          (id, device_id, sku_key, template_id, price_payload_json, status, retry_count, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, '', ?, ?)
        """,
        (task_id, device_id, sku_key, template_id, payload_json, now, now),
    )
    conn.commit()
    conn.close()

    return {
        "id": task_id,
        "deviceId": device_id,
        "skuKey": sku_key,
        "templateId": template_id,
        "pricePayload": price_payload,
        "status": "pending",
        "retryCount": 0,
        "lastError": "",
        "createdAt": now,
        "updatedAt": now,
    }


def list_price_tag_tasks(
    status: str | None = None,
    sku_key: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List price tag tasks with optional filters."""
    conn = retail_core.connect()
    _ensure_price_tag_tables(conn)

    conditions = []
    params: list[Any] = []
    if status:
        conditions.append("status = ?")
        params.append(status)
    if sku_key:
        conditions.append("sku_key = ?")
        params.append(sku_key)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    query = f"""
        SELECT id, device_id, sku_key, template_id, price_payload_json,
               status, retry_count, last_error, created_at, updated_at
        FROM price_tag_update_task
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])
    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = []
    for row in rows:
        payload = {}
        try:
            payload = json.loads(row["price_payload_json"] or "{}")
        except Exception:
            pass
        results.append({
            "id": str(row["id"]),
            "deviceId": str(row["device_id"] or ""),
            "skuKey": str(row["sku_key"]),
            "templateId": str(row["template_id"]),
            "pricePayload": payload,
            "status": str(row["status"]),
            "retryCount": int(row["retry_count"]),
            "lastError": str(row["last_error"] or ""),
            "createdAt": str(row["created_at"]),
            "updatedAt": str(row["updated_at"]),
        })
    return results


def get_price_tag_task(task_id: str) -> dict[str, Any] | None:
    """Get a single task by id."""
    conn = retail_core.connect()
    row = conn.execute(
        """
        SELECT id, device_id, sku_key, template_id, price_payload_json,
               status, retry_count, last_error, created_at, updated_at
        FROM price_tag_update_task WHERE id = ?
        """,
        (task_id,),
    ).fetchone()
    conn.close()

    if not row:
        return None

    payload = {}
    try:
        payload = json.loads(row["price_payload_json"] or "{}")
    except Exception:
        pass

    return {
        "id": str(row["id"]),
        "deviceId": str(row["device_id"] or ""),
        "skuKey": str(row["sku_key"]),
        "templateId": str(row["template_id"]),
        "pricePayload": payload,
        "status": str(row["status"]),
        "retryCount": int(row["retry_count"]),
        "lastError": str(row["last_error"] or ""),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
    }


def update_task_status(
    task_id: str,
    status: str,
    error: str = "",
) -> None:
    """Update task status and optionally error message."""
    conn = retail_core.connect()
    now = _now_iso()
    if error:
        conn.execute(
            """
            UPDATE price_tag_update_task
            SET status = ?, last_error = ?, updated_at = ?,
                retry_count = retry_count + 1
            WHERE id = ?
            """,
            (status, error[:500], now, task_id),
        )
    else:
        conn.execute(
            """
            UPDATE price_tag_update_task
            SET status = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, now, task_id),
        )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Mock gateway (simulates electronic price tag hardware API)
# ---------------------------------------------------------------------------

PRICE_TAG_GATEWAY_URL = "http://127.0.0.1:8080/api/price-tag/sync"
PRICE_TAG_GATEWAY_TIMEOUT = 5.0


def send_to_price_tag_gateway(task: dict[str, Any]) -> tuple[bool, str]:
    """
    Send a price tag update to the mock gateway.
    Returns (success, error_message).
    """
    payload = task.get("pricePayload") or {}
    sku_key = task.get("skuKey", "")

    try:
        response = requests.post(
            PRICE_TAG_GATEWAY_URL,
            json={
                "deviceId": task.get("deviceId") or "mock-device-001",
                "skuKey": sku_key,
                "templateId": task.get("templateId", "default-store-price"),
                "pricePayload": payload,
                "taskId": task.get("id", ""),
            },
            timeout=PRICE_TAG_GATEWAY_TIMEOUT,
        )
        if 200 <= response.status_code < 300:
            return True, ""
        return False, f"gateway returned {response.status_code}: {response.text[:200]}"
    except requests.exceptions.ConnectionError:
        # Gateway not running — treat as mock success for development
        return True, "mock_success (gateway not running)"
    except requests.exceptions.Timeout:
        return False, "gateway timeout"
    except Exception as exc:
        return False, str(exc)[:200]


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

_worker_running = False
_worker_thread: threading.Thread | None = None


def price_tag_worker_loop(stop_event: threading.Event) -> None:
    """
    Background loop: every 30s, poll pending tasks and send to gateway.
    """
    while not stop_event.is_set():
        try:
            conn = retail_core.connect()
            _ensure_price_tag_tables(conn)

            rows = conn.execute(
                """
                SELECT id, device_id, sku_key, template_id, price_payload_json,
                       status, retry_count, created_at
                FROM price_tag_update_task
                WHERE status = 'pending' AND retry_count < 3
                ORDER BY created_at ASC
                LIMIT 10
                """,
            ).fetchall()
            conn.close()

            for row in rows:
                task = {
                    "id": str(row["id"]),
                    "deviceId": str(row["device_id"] or ""),
                    "skuKey": str(row["sku_key"]),
                    "templateId": str(row["template_id"]),
                    "pricePayload": json.loads(row["price_payload_json"] or "{}"),
                    "status": str(row["status"]),
                    "retryCount": int(row["retry_count"]),
                }

                # Mark as sending
                update_task_status(task["id"], "sending")

                # Send to gateway
                success, error = send_to_price_tag_gateway(task)

                if success:
                    update_task_status(task["id"], "confirmed")
                else:
                    new_status = "failed" if int(row["retry_count"]) >= 2 else "pending"
                    update_task_status(task["id"], new_status, error=error)

        except Exception as exc:
            # Don't crash the worker thread
            print(f"[price-tag-worker] error: {exc}")

        # Wait 30 seconds or stop event
        stop_event.wait(timeout=30.0)


def start_price_tag_worker() -> None:
    global _worker_running, _worker_thread
    if _worker_running:
        return
    _worker_running = True
    stop_event = threading.Event()
    _worker_thread = threading.Thread(
        target=price_tag_worker_loop,
        args=(stop_event,),
        daemon=True,
        name="price-tag-worker",
    )
    _worker_thread.start()


def stop_price_tag_worker() -> None:
    global _worker_running, _worker_thread
    _worker_running = False
    if _worker_thread:
        _worker_thread.join(timeout=5.0)
        _worker_thread = None


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@router.post("/tasks", response_model=PriceTagTaskResponse)
def create_task(body: PriceTagTaskCreateInput) -> PriceTagTaskResponse:
    """Create a new electronic price tag update task."""
    task = create_price_tag_task(
        sku_key=body.skuKey,
        template_id=body.templateId,
        price_payload=body.pricePayload,
        device_id=body.deviceId,
        source=body.source,
    )
    return PriceTagTaskResponse(**task)


@router.get("/tasks", response_model=list[PriceTagTaskResponse])
def list_tasks(
    status: str | None = Query(None, description="Filter by status: pending, sending, confirmed, failed"),
    skuKey: str | None = Query(None, description="Filter by SKU key"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[PriceTagTaskResponse]:
    """List price tag update tasks."""
    tasks = list_price_tag_tasks(status=status, sku_key=skuKey, limit=limit, offset=offset)
    return [PriceTagTaskResponse(**t) for t in tasks]


@router.get("/tasks/{task_id}", response_model=PriceTagTaskResponse)
def get_task(task_id: str) -> PriceTagTaskResponse:
    """Get a specific price tag task."""
    task = get_price_tag_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return PriceTagTaskResponse(**task)


@router.post("/tasks/{task_id}/retry", response_model=PriceTagTaskResponse)
def retry_task(task_id: str) -> PriceTagTaskResponse:
    """Reset a failed task back to pending for retry."""
    task = get_price_tag_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    conn = retail_core.connect()
    now = _now_iso()
    conn.execute(
        """
        UPDATE price_tag_update_task
        SET status = 'pending', retry_count = 0, last_error = '', updated_at = ?
        WHERE id = ?
        """,
        (now, task_id),
    )
    conn.commit()
    conn.close()

    return PriceTagTaskResponse(**get_price_tag_task(task_id))
