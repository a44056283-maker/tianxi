#!/usr/bin/env python3
"""Refresh SQL-backed terminal inventory snapshots and audit stock/SN parity."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_APP_DIR = ROOT / "apps" / "api-server"
if str(API_APP_DIR) not in sys.path:
    sys.path.insert(0, str(API_APP_DIR))

from app import local_sync, retail_core  # noqa: E402
from audit_terminal_stock_sn_sync import build_audit_payload  # noqa: E402


WEB_DATA = ROOT / "apps" / "web-cockpit" / "public" / "data"
SCRIPT_NAME = "sync_inventory_terminal_state.py"


def main() -> int:
    seed = retail_core.seed_reference_data(WEB_DATA)
    written = local_sync.write_static_snapshots(WEB_DATA)
    audit = build_audit_payload()
    summary = audit.get("summary") or {}
    blocking = any(
        int(summary.get(key) or 0) > 0
        for key in (
            "coreStockSnMismatchCount",
            "projectionVsStandardMismatchCount",
            "channelStockSnMismatchCount",
            "distMismatchCount",
            "liveMismatchCount",
        )
    )
    # Auto-derive the SN reconciliation snapshot so it never goes stale again.
    # Delegates to the new npm run build:sn-reconciliation-snapshot so the logic
    # lives in TypeScript and stays aligned with the audit format.
    sn_reconciliation = None
    sn_reconciliation_error = None
    try:
        cli_cwd = ROOT / "apps" / "inventory-sync"
        proc = subprocess.run(
            ["npm", "run", "build:sn-reconciliation-snapshot", "--silent"],
            cwd=str(cli_cwd),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode == 0:
            try:
                sn_reconciliation = json.loads(proc.stdout)
            except json.JSONDecodeError:
                # Fall back: re-read the just-written files.
                for candidate in (
                    WEB_DATA / "latest-sn-reconciliation-mismatch.json",
                    ROOT / "apps" / "inventory-sync" / "artifacts" / "latest-sn-reconciliation-mismatch.json",
                ):
                    if candidate.exists():
                        sn_reconciliation = json.loads(candidate.read_text(encoding="utf-8"))
                        break
        else:
            sn_reconciliation_error = (proc.stderr or proc.stdout or "").strip()[:300]
    except Exception as exc:
        sn_reconciliation_error = repr(exc)[:300]

    payload = {
        "script": SCRIPT_NAME,
        "database": str(retail_core.DB_FILE),
        "seed": seed,
        "writtenCount": len(written),
        "writtenKeys": sorted(written.keys()),
        "audit": audit,
        "blocking": blocking,
        "snReconciliation": {
            "mismatchCount": (sn_reconciliation or {}).get("mismatchCount"),
            "overSerialCount": (sn_reconciliation or {}).get("overSerialCount"),
            "underSerialCount": (sn_reconciliation or {}).get("underSerialCount"),
            "generatedAt": (sn_reconciliation or {}).get("generatedAt"),
        } if sn_reconciliation else None,
        "snReconciliationError": sn_reconciliation_error,
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 1 if blocking else 0


if __name__ == "__main__":
    raise SystemExit(main())
