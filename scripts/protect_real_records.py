#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "apps" / "inventory-sync" / "artifacts"
WEB_DATA_DIR = ROOT / "apps" / "web-cockpit" / "public" / "data"
REGISTRY_DIR = ARTIFACT_DIR / "append-only-registries"
MANUAL_EDU_DIR = ARTIFACT_DIR / "manual" / "education-agent-scan"
MANUAL_EDU_REGISTRY_DIR = REGISTRY_DIR / "manual-education-agent-scan"
MANUAL_EDU_INDEX = REGISTRY_DIR / "manual-education-agent-scan-index.json"


@dataclass(frozen=True)
class ProtectSpec:
    file_name: str
    list_key: str
    identity_keys: tuple[str, ...]


SPECS: tuple[ProtectSpec, ...] = (
    ProtectSpec("latest-education-subsidy-agent-scan-summary.json", "rows", ("serialNumbers", "serial_number", "serialNumber", "id", "orderNumber")),
    ProtectSpec("latest-marketing-boost-history.json", "cards", ("id", "orderNumber", "outboundDate", "skuKey")),
    ProtectSpec("latest-marketing-boost-snapshot.json", "history", ("id", "orderNumber", "outboundDate", "skuKey")),
    ProtectSpec("latest-inventory-movements.json", "records", ("id", "documentNumber", "businessDate", "skuKey", "serialNumber")),
    ProtectSpec("latest-retail-core-inventory-movements.json", "items", ("id", "document_number", "business_date", "sku_key", "serial_number")),
    ProtectSpec("latest-retail-core-sales-orders.json", "items", ("id",)),
    ProtectSpec("latest-zhidiantong-sales-orders.json", "orders", ("id",)),
    ProtectSpec("latest-retail-core-serial-items.json", "items", ("serial_number", "sku_key")),
)


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize(value: Any) -> str:
    return str(value or "").strip()


def build_identity(row: dict[str, Any], keys: tuple[str, ...]) -> str:
    def normalize_serials(value: Any) -> str:
        if isinstance(value, list):
            serials = sorted({normalize(item).upper() for item in value if normalize(item)})
            if serials:
                return ",".join(serials)
        text = normalize(value).upper()
        return text

    for key in keys:
        if key in {"serialNumbers", "serial_number", "serialNumber"}:
            value = normalize_serials(row.get(key))
        else:
            value = normalize(row.get(key))
        if value:
            if key == "id":
                return f"id:{value}"
            if key in {"serialNumbers", "serial_number", "serialNumber"}:
                return f"sn:{value}"
    parts = [normalize(row.get(key)) for key in keys if normalize(row.get(key))]
    if not parts:
        parts = [json.dumps(row, ensure_ascii=False, sort_keys=True)]
    return "|".join(parts)


def richness(row: dict[str, Any]) -> int:
    score = 0
    for value in row.values():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, list) and len(value) == 0:
            continue
        score += 1
    return score


def merge_row(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    # Preserve historical evidence fields and fill missing values from either side.
    merged: dict[str, Any] = {**old, **new}
    for key, old_value in old.items():
        new_value = merged.get(key)
        if new_value is None or (isinstance(new_value, str) and not new_value.strip()):
            merged[key] = old_value
        if isinstance(old_value, list) and isinstance(new_value, list):
            seen = []
            for item in old_value + new_value:
                if item not in seen:
                    seen.append(item)
            merged[key] = seen
    # Prefer richer row as base status.
    if richness(old) > richness(new):
        for key, value in old.items():
            if key not in merged or merged[key] in (None, "", []):
                merged[key] = value
    return merged


def merge_records(spec: ProtectSpec, current_rows: list[dict[str, Any]], registry_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in registry_rows + current_rows:
        if not isinstance(row, dict):
            continue
        identity = build_identity(row, spec.identity_keys)
        if identity in merged:
            merged[identity] = merge_row(merged[identity], row)
        else:
            merged[identity] = row
    rows = list(merged.values())
    rows.sort(
        key=lambda item: (
            normalize(item.get("scanDate") or item.get("businessDate") or item.get("outboundDate")),
            normalize(item.get("id") or item.get("orderNumber") or item.get("serialNumber") or item.get("serial_number")),
        ),
        reverse=True,
    )
    return rows


def protect_one(spec: ProtectSpec) -> dict[str, Any]:
    artifact_path = ARTIFACT_DIR / spec.file_name
    web_path = WEB_DATA_DIR / spec.file_name
    registry_path = REGISTRY_DIR / spec.file_name

    artifact_payload = read_json(artifact_path) or {}
    web_payload = read_json(web_path) or {}
    registry_payload = read_json(registry_path) or {}

    artifact_rows = artifact_payload.get(spec.list_key)
    web_rows = web_payload.get(spec.list_key)
    registry_rows = registry_payload.get("rows")
    if not isinstance(artifact_rows, list):
        artifact_rows = []
    if not isinstance(web_rows, list):
        web_rows = []
    if not isinstance(registry_rows, list):
        registry_rows = []

    merged_rows = merge_records(spec, artifact_rows + web_rows, registry_rows)
    if not artifact_payload:
        artifact_payload = web_payload if isinstance(web_payload, dict) else {}
    if not web_payload:
        web_payload = artifact_payload if isinstance(artifact_payload, dict) else {}

    artifact_payload[spec.list_key] = merged_rows
    web_payload[spec.list_key] = merged_rows
    registry_out = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(),
        "source": "append_only_registry",
        "fileName": spec.file_name,
        "listKey": spec.list_key,
        "count": len(merged_rows),
        "rows": merged_rows,
    }
    write_json(artifact_path, artifact_payload)
    write_json(web_path, web_payload)
    write_json(registry_path, registry_out)
    return {
        "file": spec.file_name,
        "listKey": spec.list_key,
        "count": len(merged_rows),
    }


def main() -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    results = [protect_one(spec) for spec in SPECS]
    manual_result = protect_manual_education_scan_files()
    print(json.dumps({"ok": True, "protected": results}, ensure_ascii=False, indent=2))
    print(json.dumps({"ok": True, "manualEducationScan": manual_result}, ensure_ascii=False, indent=2))


def protect_manual_education_scan_files() -> dict[str, Any]:
    MANUAL_EDU_REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    MANUAL_EDU_DIR.mkdir(parents=True, exist_ok=True)

    existing_index = read_json(MANUAL_EDU_INDEX) or {}
    indexed_files = existing_index.get("files")
    if not isinstance(indexed_files, dict):
        indexed_files = {}

    restored_files: list[str] = []
    snapshotted_files: list[str] = []

    # Restore deleted real files from append-only mirror.
    for filename, payload in indexed_files.items():
        if not isinstance(payload, dict):
            continue
        target = MANUAL_EDU_DIR / filename
        if target.exists():
            continue
        mirror_name = normalize(payload.get("mirror"))
        if not mirror_name:
            continue
        mirror_path = MANUAL_EDU_REGISTRY_DIR / mirror_name
        if not mirror_path.exists():
            continue
        target.write_text(mirror_path.read_text(encoding="utf-8"), encoding="utf-8")
        restored_files.append(filename)

    # Snapshot current files into append-only mirror and refresh index.
    refreshed_files: dict[str, Any] = dict(indexed_files)
    for path in sorted(MANUAL_EDU_DIR.glob("education-agent-scan-*.json")):
        content = path.read_text(encoding="utf-8")
        digest = __import__("hashlib").sha256(content.encode("utf-8")).hexdigest()[:16]
        mirror_name = f"{path.stem}-{digest}.json"
        mirror_path = MANUAL_EDU_REGISTRY_DIR / mirror_name
        if not mirror_path.exists():
            mirror_path.write_text(content, encoding="utf-8")
            snapshotted_files.append(path.name)
        refreshed_files[path.name] = {
            "mirror": mirror_name,
            "updatedAt": __import__("datetime").datetime.now().isoformat(),
        }

    index_payload = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(),
        "source": "append_only_registry",
        "directory": str(MANUAL_EDU_DIR),
        "files": refreshed_files,
        "restoredCount": len(restored_files),
        "snapshottedCount": len(snapshotted_files),
    }
    write_json(MANUAL_EDU_INDEX, index_payload)
    return {
        "restoredFiles": restored_files,
        "snapshottedFiles": snapshotted_files,
        "trackedCount": len(refreshed_files),
    }


if __name__ == "__main__":
    main()
