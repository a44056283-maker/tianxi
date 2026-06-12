#!/usr/bin/env python3
"""Build a clean purchase-inbound projection from OpenClaw raw ZDT exports.

This is intentionally read-only against OpenClaw source files. It creates a
frontend/API projection that avoids trusting the downstream retail-core SQLite
when purchase cost has been polluted by earlier movement-type mapping mistakes.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = (
    PROJECT_ROOT.parents[0]
    / "智店通采集CLI软件"
    / "zdt_sync_openclaw_starter"
    / "data"
    / "raw"
)
OUTPUT_FILE = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data" / "latest-openclaw-purchase-inbound-projection.json"

INBOUND_OPERATE_TYPES = {"采购入库", "订单退货入库", "待商确认"}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    return value if isinstance(value, dict) else {}


def raw_records(path: Path) -> list[dict[str, Any]]:
    records = read_json(path).get("records", [])
    return [item for item in records if isinstance(item, dict)]


def latest_raw_file(entity: str) -> Path | None:
    folder = RAW_ROOT / entity
    if not folder.exists():
        return None
    files = [path for path in folder.glob("*.json") if path.is_file()]
    if not files:
        return None
    return max(files, key=lambda path: path.stat().st_mtime)


def latest_file_per_date(entity: str) -> list[Path]:
    folder = RAW_ROOT / entity
    if not folder.exists():
        return []
    latest_by_date: dict[str, Path] = {}
    for path in folder.glob("*.json"):
        if not path.is_file():
            continue
        day = path.name[:10]
        current = latest_by_date.get(day)
        if current is None or path.stat().st_mtime > current.stat().st_mtime:
            latest_by_date[day] = path
    return sorted(latest_by_date.values())


def text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def zdt_cent_amount(value: Any) -> float | None:
    amount = number(value)
    if amount <= 0:
        return None
    return round(amount / 100, 2)


def int_quantity(value: Any) -> int:
    try:
        return abs(int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def build_inventory_cost_index(path: Path | None) -> tuple[dict[str, dict[str, Any]], list[str]]:
    if path is None:
        return {}, []
    index: dict[str, dict[str, Any]] = {}
    for row in raw_records(path):
        sku_no = text(row.get("skuNo"))
        if not sku_no:
            continue
        unit_cost = zdt_cent_amount(row.get("costPrice"))
        index[sku_no] = {
            "skuNo": sku_no,
            "productName": text(row.get("spuName")) or text(row.get("productName")),
            "spec": text(row.get("skuName")),
            "pnMtm": text(row.get("mtmCode")),
            "currentStock": int_quantity(row.get("currentStock")),
            "availableSaleStock": int_quantity(row.get("availableSaleStock")),
            "unitCost": unit_cost,
            "costSource": "openclaw.raw.inventory.costPrice",
            "sourceFile": str(path),
        }
    return index, [str(path)]


def build_serial_index(paths: list[Path]) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    by_doc_sku: dict[str, dict[str, dict[str, Any]]] = {}
    source_files: list[str] = []
    for path in paths:
        source_files.append(str(path))
        for row in raw_records(path):
            service_no = text(row.get("serviceNo"))
            sku_no = text(row.get("skuNo"))
            serial = text(row.get("serialNumber"))
            if not service_no or not sku_no or not serial:
                continue
            key = f"{service_no}|{sku_no}"
            by_doc_sku.setdefault(key, {})[serial] = {
                "serialNumber": serial,
                "skuNo": sku_no,
                "productName": text(row.get("productName")),
                "pnMtm": text(row.get("mtmCode")),
                "spec": text(row.get("propertyName")),
                "documentNumber": service_no,
                "businessDate": text(row.get("payTime")),
                "operatorName": text(row.get("userName")),
                "locationName": text(row.get("shopLocationName")),
                "sourceDocumentType": text(row.get("operateTypeName")),
            }
    return {key: list(value.values()) for key, value in by_doc_sku.items()}, source_files


def build_stock_order_records(paths: list[Path]) -> tuple[list[dict[str, Any]], list[str]]:
    rows_by_key: dict[str, dict[str, Any]] = {}
    source_files: list[str] = []
    for path in paths:
        source_files.append(str(path))
        for row in raw_records(path):
            operate_type = text(row.get("operateTypeName"))
            service_no = text(row.get("serviceNo"))
            sku_no = text(row.get("skuNo"))
            quantity = int_quantity(row.get("quantity"))
            if operate_type not in INBOUND_OPERATE_TYPES or not service_no or not sku_no or quantity <= 0:
                continue
            if operate_type == "待商确认" and not service_no.upper().startswith("CGR"):
                continue
            key = "|".join([
                service_no,
                sku_no,
                operate_type,
                text(row.get("payTime")),
                str(quantity),
            ])
            rows_by_key[key] = {**row, "_sourceFile": str(path)}
    return list(rows_by_key.values()), source_files


def main() -> None:
    inventory_file = latest_raw_file("inventory")
    stock_order_files = latest_file_per_date("stock_order")
    sn_files = latest_file_per_date("sn_stock_order")
    inventory_by_sku, inventory_sources = build_inventory_cost_index(inventory_file)
    serials_by_doc_sku, serial_sources = build_serial_index(sn_files)
    stock_rows, stock_sources = build_stock_order_records(stock_order_files)

    records: list[dict[str, Any]] = []
    for row in stock_rows:
        sku_no = text(row.get("skuNo"))
        service_no = text(row.get("serviceNo"))
        quantity = int_quantity(row.get("quantity"))
        inventory_meta = inventory_by_sku.get(sku_no, {})
        unit_cost = inventory_meta.get("unitCost")
        amount = round(float(unit_cost) * quantity, 2) if isinstance(unit_cost, (int, float)) and unit_cost > 0 else None
        serials = serials_by_doc_sku.get(f"{service_no}|{sku_no}", [])
        serial_numbers = [item["serialNumber"] for item in serials if item.get("serialNumber")]
        operate_type = text(row.get("operateTypeName"))
        # UI 不再展示人工确认提示，统一按采购入库实时链路呈现。
        note_text = ""
        records.append({
            "id": f"openclaw-purchase-{service_no}-{sku_no}",
            "skuKey": sku_no,
            "quantity": quantity,
            "movementType": "purchase_inbound",
            "businessDate": text(row.get("payTime")) or text(row.get("payDate")),
            "serialNumber": serial_numbers[0] if serial_numbers else None,
            "serialNumbersDisplay": ", ".join(serial_numbers) if serial_numbers else None,
            "documentNumber": service_no,
            "sourceRef": service_no,
            "sourceDocumentType": "采购入库",
            "operatorName": text(row.get("userName")),
            "supplierName": text(row.get("supplierName")),
            "storeName": text(row.get("shopName")),
            "locationName": text(row.get("shopLocationName")),
            "purchaseCost": unit_cost,
            "amount": amount,
            "productName": text(row.get("productName")) or inventory_meta.get("productName"),
            "pnMtm": text(row.get("mtmCode")) or inventory_meta.get("pnMtm"),
            "spec": text(row.get("propertyName")) or inventory_meta.get("spec"),
            "note": note_text,
            "updatedAt": now_iso(),
            "openclaw": {
                "sourceFile": row.get("_sourceFile"),
                "costSourceFile": inventory_meta.get("sourceFile"),
                "currentStock": inventory_meta.get("currentStock"),
                "availableSaleStock": inventory_meta.get("availableSaleStock"),
                "operateTypeName": operate_type,
                "serviceTypeName": text(row.get("serviceTypeName")),
            },
            "serials": serials,
        })

    records.sort(key=lambda item: (text(item.get("businessDate")), text(item.get("documentNumber"))), reverse=True)
    payload = {
        "generatedAt": now_iso(),
        "source": "openclaw_raw_purchase_inbound_projection",
        "sourceFiles": {
            "inventory": inventory_sources,
            "stockOrder": stock_sources,
            "snStockOrder": serial_sources,
        },
        "summary": {
            "recordCount": len(records),
            "withUnitCostCount": sum(1 for item in records if item.get("purchaseCost")),
            "withSerialCount": sum(1 for item in records if item.get("serialNumbersDisplay")),
        },
        "records": records,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "output": str(OUTPUT_FILE),
        **payload["summary"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
