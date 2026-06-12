#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path("/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit")
DB_PATH = ROOT / "apps/api-server/data/retail-core.sqlite3"
OUTPUT_PATH = ROOT / "apps/inventory-sync/artifacts/latest-non-normal-purchase-inbound-audit.json"


def iso_now() -> str:
    return datetime.now().astimezone().isoformat()


def classify(source_ref: str, note: str) -> str:
    normalized = (source_ref or "").strip().upper()
    note_text = note or ""
    if normalized.startswith("PURCHASEQ-"):
        return "purchase_placeholder"
    if normalized.startswith("TDR"):
        return "historical_stock_stream_tdr"
    if normalized.startswith("T") and normalized[1:].isdigit():
        return "historical_stock_stream_t"
    if "openclaw.full_db.purchase_inbound" in note_text:
        return "openclaw_projection"
    if "重复占位采购行" in note_text:
        return "isolated_placeholder"
    if "库存流水导出导入" in note_text:
        return "historical_stock_stream_import"
    return "other"


def main() -> int:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, source_ref, source_document_type, sku_key, product_name, quantity, unit_cost, amount, note, created_at
        FROM inventory_movement
        WHERE movement_type = 'purchase_inbound'
          AND (
            UPPER(COALESCE(source_ref, '')) LIKE 'PURCHASEQ-%'
            OR UPPER(COALESCE(source_ref, '')) LIKE 'TDR%'
            OR UPPER(COALESCE(source_ref, '')) GLOB 'T[0-9]*'
            OR COALESCE(note, '') LIKE '%openclaw.full_db.purchase_inbound%'
            OR COALESCE(note, '') LIKE '%重复占位采购行%'
            OR COALESCE(note, '') LIKE '%库存流水导出导入%'
          )
        ORDER BY created_at DESC, source_ref DESC
        """
    ).fetchall()
    conn.close()

    items = []
    class_counter: Counter[str] = Counter()
    source_ref_counter: Counter[str] = Counter()
    for row in rows:
        source_ref = str(row["source_ref"] or "")
        note = str(row["note"] or "")
        category = classify(source_ref, note)
        class_counter[category] += 1
        source_ref_counter[source_ref] += 1
        items.append(
            {
                "id": str(row["id"] or ""),
                "sourceRef": source_ref,
                "sourceDocumentType": str(row["source_document_type"] or ""),
                "skuKey": str(row["sku_key"] or ""),
                "productName": str(row["product_name"] or ""),
                "quantity": int(row["quantity"] or 0),
                "unitCost": float(row["unit_cost"] or 0) if row["unit_cost"] is not None else None,
                "amount": float(row["amount"] or 0) if row["amount"] is not None else None,
                "note": note,
                "createdAt": str(row["created_at"] or ""),
                "auditCategory": category,
            }
        )

    payload = {
        "generatedAt": iso_now(),
        "source": "scripts.audit_non_normal_purchase_inbound",
        "totalCount": len(items),
        "categoryCounts": dict(class_counter),
        "topDuplicateSourceRefs": [
            {"sourceRef": key, "count": count}
            for key, count in source_ref_counter.most_common(50)
        ],
        "items": items,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(OUTPUT_PATH))
    print(json.dumps({
        "totalCount": payload["totalCount"],
        "categoryCounts": payload["categoryCounts"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
