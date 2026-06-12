#!/usr/bin/env python3
"""Audit stock/SN parity across customer-facing terminal snapshots."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "apps" / "web-cockpit" / "public" / "data"
DIST_DATA = ROOT / "apps" / "web-cockpit" / "dist" / "data"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def by_sku(payload: dict) -> dict[str, dict]:
    rows = payload.get("skus") or payload.get("items") or []
    return {str(row.get("skuKey") or ""): row for row in rows if row.get("skuKey")}


def stock_tuple(row: dict) -> tuple[int, int, int]:
    return (
        int(row.get("currentStock") or 0),
        int(row.get("sellableStock") or 0),
        int(row.get("serialCount") or 0),
    )


def build_audit_payload() -> dict:
    standard = load_json(WEB_DATA / "latest-standard-inventory-snapshot.json")
    projection = load_json(WEB_DATA / "latest-published-product-projection.json")
    live_projection = load_json(WEB_DATA / "latest-published-product-projection-live.json")
    dist_projection = load_json(DIST_DATA / "latest-published-product-projection.json")

    standard_map = by_sku(standard)
    projection_map = by_sku(projection)
    live_map = by_sku(live_projection)
    dist_map = by_sku(dist_projection)

    projection_mismatches: list[dict] = []
    channel_mismatches: list[dict] = []
    dist_mismatches: list[dict] = []
    live_mismatches: list[dict] = []
    core_mismatches: list[dict] = []

    for sku, item in standard_map.items():
        data_quality = item.get("dataQuality") or {}
        if not data_quality.get("stockAndSerialMatched", True):
            core_mismatches.append({
                "skuKey": sku,
                "currentStock": int(item.get("currentStock") or 0),
                "sellableStock": int(item.get("sellableStock") or 0),
                "serialCount": int(item.get("serialCount") or 0),
                "rawSerialCount": int(data_quality.get("rawSerialCount") or 0),
                "missingSerialCount": int(data_quality.get("missingSerialCount") or 0),
                "excessSerialCount": int(data_quality.get("excessSerialCount") or 0),
            })

    for sku, item in projection_map.items():
        expected = standard_map.get(sku)
        if expected and stock_tuple(item) != stock_tuple(expected):
            projection_mismatches.append({
                "skuKey": sku,
                "projection": stock_tuple(item),
                "standard": stock_tuple(expected),
            })
        for channel in ("retailHero", "cashier", "adMachine"):
            view = (item.get("channelViews") or {}).get(channel) or {}
            if stock_tuple(view) != stock_tuple(item):
                channel_mismatches.append({
                    "skuKey": sku,
                    "channel": channel,
                    "projection": stock_tuple(item),
                    "channelView": stock_tuple(view),
                })
        dist_item = dist_map.get(sku)
        if dist_item and stock_tuple(dist_item) != stock_tuple(item):
            dist_mismatches.append({
                "skuKey": sku,
                "dist": stock_tuple(dist_item),
                "public": stock_tuple(item),
            })
        live_item = live_map.get(sku)
        if live_item and stock_tuple(live_item) != stock_tuple(item):
            live_mismatches.append({
                "skuKey": sku,
                "live": stock_tuple(live_item),
                "projection": stock_tuple(item),
            })

    summary = {
        "standardTotals": standard.get("totals"),
        "projectionItemCount": len(projection_map),
        "liveItemCount": len(live_map),
        "coreStockSnMismatchCount": len(core_mismatches),
        "projectionVsStandardMismatchCount": len(projection_mismatches),
        "channelStockSnMismatchCount": len(channel_mismatches),
        "distMismatchCount": len(dist_mismatches),
        "liveMismatchCount": len(live_mismatches),
    }
    return {
        "summary": summary,
        "samples": {
            "core": core_mismatches[:20],
            "projectionVsStandard": projection_mismatches[:20],
            "channel": channel_mismatches[:20],
            "dist": dist_mismatches[:20],
            "live": live_mismatches[:20],
        },
    }


def main() -> int:
    payload = build_audit_payload()
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    summary = payload.get("summary") or {}
    return 1 if any((
        int(summary.get("coreStockSnMismatchCount") or 0) > 0,
        int(summary.get("projectionVsStandardMismatchCount") or 0) > 0,
        int(summary.get("channelStockSnMismatchCount") or 0) > 0,
        int(summary.get("distMismatchCount") or 0) > 0,
        int(summary.get("liveMismatchCount") or 0) > 0,
    )) else 0


if __name__ == "__main__":
    raise SystemExit(main())
