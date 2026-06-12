"""
Tests for 6-Terminal Heartbeat Endpoint — POST /api/local-sync/heartbeat
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_heartbeat_insert():
    """POST /api/local-sync/heartbeat → 200, ok=true, recordedAt exists."""
    response = client.post(
        "/api/local-sync/heartbeat",
        json={
            "terminalId": "retailHome",
            "terminalName": "零售卡前端",
            "lastFetchedAt": "2026-06-10T04:00:00Z",
            "clientDataSignature": "sig_abc123",
            "status": "live",
        },
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert data.get("ok") is True
    assert data.get("terminalId") == "retailHome"
    assert "recordedAt" in data


def test_heartbeat_update_existing():
    """Same terminalId sent twice → second call updates recordedAt."""
    response1 = client.post(
        "/api/local-sync/heartbeat",
        json={
            "terminalId": "retailHome",
            "terminalName": "零售卡前端",
            "lastFetchedAt": "2026-06-10T04:00:00Z",
            "clientDataSignature": "sig_v1",
            "status": "live",
        },
    )
    assert response1.status_code == 200
    rec1 = response1.json()["recordedAt"]

    response2 = client.post(
        "/api/local-sync/heartbeat",
        json={
            "terminalId": "retailHome",
            "terminalName": "零售卡前端",
            "lastFetchedAt": "2026-06-10T04:01:00Z",
            "clientDataSignature": "sig_v2",
            "status": "live",
        },
    )
    assert response2.status_code == 200
    rec2 = response2.json()["recordedAt"]
    # Second recordedAt should be >= first (same or later timestamp)
    assert rec2 >= rec1


def test_heartbeat_missing_terminal_id():
    """Missing terminalId → ok=false, error message."""
    response = client.post(
        "/api/local-sync/heartbeat",
        json={"terminalName": "test"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("ok") is False
    assert "terminalId" in data.get("error", "").lower() or "required" in data.get("error", "").lower()


def test_six_terminal_status_shows_heartbeat():
    """GET /api/local-sync/six-terminal-status includes heartbeat data after POST."""
    # Send heartbeat for retailLive
    client.post(
        "/api/local-sync/heartbeat",
        json={
            "terminalId": "retailLive",
            "terminalName": "零售直播页",
            "lastFetchedAt": "2026-06-10T04:00:00Z",
            "clientDataSignature": "sig_retailLive",
            "status": "live",
        },
    )
    # Verify six-terminal-status reflects it
    response = client.get("/api/local-sync/six-terminal-status")
    assert response.status_code == 200
    data = response.json()
    terminals = {t["key"]: t for t in data["terminals"]}
    assert "retailLive" in terminals
    t = terminals["retailLive"]
    assert t["lastFetchedAt"] == "2026-06-10T04:00:00Z"
    assert t["clientDataSignature"] == "sig_retailLive"
    assert t["lag"] in ("live", "stale", "dead", "unknown")


def test_heartbeat_lag_computation():
    """Verify lag is correctly computed from lastFetchedAt age."""
    import time
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    response = client.post(
        "/api/local-sync/heartbeat",
        json={
            "terminalId": "adMachine",
            "terminalName": "彩页广告机",
            "lastFetchedAt": now,
            "clientDataSignature": "sig_now",
            "status": "live",
        },
    )
    assert response.status_code == 200
    # Within 60s should be "live"
    assert response.json().get("lag") == "live"
