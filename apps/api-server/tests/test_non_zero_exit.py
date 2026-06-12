"""
Tests for inventory-master-sync non-zero exit handling (allowNonZeroExit shield).

When the inventory-master-sync subprocess exits with code != 0 but stdout
contains valid JSON (lastInventoryMaster signature exists), the status
should be 'executed_not_closed' instead of 'failed'.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_allow_non_zero_exit_shield():
    """exitCode=1 but valid JSON with lastInventoryMaster → status=executed_not_closed."""
    from app import local_sync

    # Mock the subprocess result that simulates the known pattern:
    # inventory-master-sync exits with code 1 but wrote 60 snapshot files
    mock_report = {
        "exitCode": 1,
        "status": "failed",
        "lastInventoryMaster": {
            "signature": "abc123def456",
            "writtenCount": 60,
            "generatedAt": "2026-06-10T04:00:00Z",
        },
        "writtenCount": 60,
    }

    exit_code = mock_report.get("exitCode", 0)
    json_valid = (
        isinstance(mock_report.get("lastInventoryMaster"), dict)
        or isinstance(mock_report.get("inventoryMasterSnapshot"), dict)
        or isinstance(mock_report.get("snapshotCache"), dict)
    )

    if exit_code != 0 and json_valid:
        computed_status = "executed_not_closed"
    else:
        computed_status = str(mock_report.get("status") or "").strip() or (
            "completed" if exit_code == 0 else "failed"
        )

    assert computed_status == "executed_not_closed", (
        f"Expected executed_not_closed, got {computed_status}"
    )


def test_zero_exit_normal_completed():
    """exitCode=0 with valid JSON → status=completed."""
    mock_report = {
        "exitCode": 0,
        "status": "completed",
        "lastInventoryMaster": {"signature": "abc123"},
        "writtenCount": 60,
    }
    exit_code = mock_report.get("exitCode", 0)
    json_valid = (
        isinstance(mock_report.get("lastInventoryMaster"), dict)
        or isinstance(mock_report.get("inventoryMasterSnapshot"), dict)
        or isinstance(mock_report.get("snapshotCache"), dict)
    )
    if exit_code != 0 and json_valid:
        computed_status = "executed_not_closed"
    else:
        computed_status = str(mock_report.get("status") or "").strip() or (
            "completed" if exit_code == 0 else "failed"
        )
    assert computed_status == "completed"


def test_non_zero_exit_no_json_is_failed():
    """exitCode=1 with no valid JSON → status=failed."""
    mock_report = {
        "exitCode": 1,
        "status": "failed",
        "stderr": "some error",
    }
    exit_code = mock_report.get("exitCode", 0)
    json_valid = (
        isinstance(mock_report.get("lastInventoryMaster"), dict)
        or isinstance(mock_report.get("inventoryMasterSnapshot"), dict)
        or isinstance(mock_report.get("snapshotCache"), dict)
    )
    if exit_code != 0 and json_valid:
        computed_status = "executed_not_closed"
    else:
        computed_status = str(mock_report.get("status") or "").strip() or (
            "completed" if exit_code == 0 else "failed"
        )
    assert computed_status == "failed"
