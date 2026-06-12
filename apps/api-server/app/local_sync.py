from __future__ import annotations

import calendar
import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from . import product_library
from . import retail_core

APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
INVENTORY_SYNC_DIR = PROJECT_ROOT / "apps" / "inventory-sync"
WEB_COCKPIT_DIR = PROJECT_ROOT / "apps" / "web-cockpit"
ARTIFACT_DIR = INVENTORY_SYNC_DIR / "artifacts"
OPENCLAW_AUTO_SYNC_TASK_ID = "AUTO-ZDT-SQL-BRIDGE"
_AUTO_SYNC_LOCK = threading.Lock()
_AUTO_SYNC_CACHE: dict[str, Any] = {
    "checkedAt": 0.0,
    "sourceSignature": "",
    "result": None,
}
_AUTO_INVENTORY_MASTER_SYNC_LOCK = threading.Lock()
_AUTO_INVENTORY_MASTER_SYNC_STATE: dict[str, Any] = {
    "running": False,
    "startedAt": "",
    "lastRequestedAt": 0.0,
    "lastFinishedAt": 0.0,
    "lastResult": None,
    "currentTrigger": "",
    "currentSource": "",
}

LOCAL_SYNC_PIPELINES = {
    "inventory-master-sync": {
        "label": "库存总表统一同步",
        "description": "优先消费库存流水总表，缺失时回退拆分导入，再统一重建快照。",
    },
    "quote-master-sync": {
        "label": "报价总表统一同步",
        "description": "消费分销报价总表、灰渠原文和零售价手工批次，统一输出待采清单与快照。",
    },
    "full-daily-sync": {
        "label": "全量日更编排",
        "description": "串行执行库存、报价、保修与快照重建。",
    },
}

PRODUCT_LIBRARY_REBUILD_STEPS = [
    ("build-product-url-locks", "重建链接锁库"),
    ("build-collection-plan", "重建采集计划"),
    ("build-standard-price-master", "重建标准价格主表"),
    ("audit-retail-prices", "重建零售价审计"),
    ("build-retail-zone", "重建零售区快照"),
]

PRODUCT_LIBRARY_REBUILD_SCOPES = {
    "pricing": [
        ("build-product-url-locks", "重建链接锁库"),
        ("build-standard-price-master", "重建标准价格主表"),
        ("audit-retail-prices", "重建零售价审计"),
        ("build-retail-zone", "重建零售区快照"),
    ],
    "full": PRODUCT_LIBRARY_REBUILD_STEPS,
}

OPENCLAW_SIGNATURE_QUERIES = [
    ("fact_orders", "SELECT COUNT(*), COALESCE(MAX(collected_at)::text, '') FROM fact_orders"),
    ("fact_order_items", "SELECT COUNT(*), COALESCE(MAX(collected_at)::text, '') FROM fact_order_items"),
    ("fact_purchase_orders", "SELECT COUNT(*), COALESCE(MAX(collected_at)::text, '') FROM fact_purchase_orders"),
    ("fact_purchase_order_details", "SELECT COUNT(*), COALESCE(MAX(collected_at)::text, '') FROM fact_purchase_order_details"),
    ("fact_stock_orders", "SELECT COUNT(*), COALESCE(MAX(pay_time)::text, '') FROM fact_stock_orders"),
    ("fact_sn_records", "SELECT COUNT(*), COALESCE(MAX(collected_at)::text, '') FROM fact_sn_records"),
]


def list_pipelines() -> list[dict[str, Any]]:
    return [
        {"name": name, **meta}
        for name, meta in LOCAL_SYNC_PIPELINES.items()
    ]


def read_artifact(name: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
    path = ARTIFACT_DIR / name
    if not path.exists():
        return default or {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default or {}
    return raw if isinstance(raw, dict) else (default or {})


def latest_report() -> dict[str, Any]:
    return read_artifact("latest-local-sync-report.json", {})


def failure_queue() -> dict[str, Any]:
    return read_artifact("latest-local-sync-failure-queue.json", {"items": [], "total": 0})


def _read_seed_counts_snapshot(data_dir: Path) -> dict[str, Any]:
    path = data_dir / "latest-retail-core-status.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _agent_scan_baseline_candidates() -> list[Path]:
    return [
        PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data" / "latest-education-subsidy-agent-scan-summary.json",
        INVENTORY_SYNC_DIR / "artifacts" / "append-only-registries" / "latest-education-subsidy-agent-scan-summary.json",
    ]


def _normalize_agent_scan_serials(value: Any) -> list[str]:
    if isinstance(value, str):
        decoded = retail_core._decode_json_field(value, [])  # type: ignore[attr-defined]
        value = decoded if isinstance(decoded, list) else []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item or "").strip()]


def _explicit_group_from_text(*values: Any) -> str:
    text = "\n".join(str(value or "") for value in values)
    if "智店通入库群" in text:
        return "智店通入库群"
    if "教育补贴群" in text:
        return "教育补贴群"
    return ""


def _is_synthetic_agent_scan_row(
    *,
    record_id: Any,
    source_file: Any,
    customer_phone: Any = "",
    serial_numbers: Any = None,
    client_tag: Any = "",
    photo_id: Any = "",
) -> bool:
    record_id_text = str(record_id or "").strip().lower()
    source_file_text = str(source_file or "").strip().lower()
    customer_phone_text = str(customer_phone or "").strip()
    client_tag_text = str(client_tag or "").strip().lower()
    photo_id_text = str(photo_id or "").strip().lower()
    serials = {str(item or "").strip().upper() for item in _normalize_agent_scan_serials(serial_numbers)}
    return (
        "test-bridge" in source_file_text
        or "debug-cli" in source_file_text
        or source_file_text.startswith("cli://test")
        or client_tag_text.startswith("test-")
        or photo_id_text.startswith("test-")
        or record_id_text.startswith("test-")
        or (record_id_text.startswith("watermark-cam-test") or record_id_text.startswith("watermark-cam-debug"))
        or customer_phone_text == "13812345678"
        or "SN1234ABCD" in serials
    )


def _agent_scan_row_fingerprint(row: dict[str, Any]) -> tuple[Any, ...]:
    source_group_name = str(row.get("sourceGroupName") or "").strip()
    serial_numbers = tuple(sorted(serial.upper() for serial in _normalize_agent_scan_serials(row.get("serialNumbers"))))
    order_number = str(row.get("orderNumber") or "").strip()
    voucher_code = str(row.get("voucherCode") or "").strip()
    customer_phone = str(row.get("customerPhone") or "").strip()
    photo_id = str(row.get("photoId") or "").strip()
    media_url = str(row.get("mediaUrl") or "").strip()
    source_file = str(row.get("sourceFile") or "").strip()
    scan_date = str(row.get("scanDate") or "").strip()
    if serial_numbers:
        return ("serial", source_group_name, serial_numbers, order_number or voucher_code or customer_phone)
    if voucher_code:
        return ("voucher", source_group_name, voucher_code, customer_phone or order_number)
    if photo_id:
        return ("photo", source_group_name, photo_id)
    if media_url:
        return ("media", source_group_name, media_url)
    return ("fallback", source_group_name, customer_phone, order_number, source_file, scan_date)


_AGENT_PLACEHOLDER_VALUES = {"", "待补", "待补商品", "待补型号", "手机", "机型", "unknown", "--", "none"}


def _agent_scan_has_billable_unit(row: dict[str, Any]) -> bool:
    def meaningful(value: Any) -> bool:
        text = str(value or "").strip()
        return text.lower() not in _AGENT_PLACEHOLDER_VALUES

    if _normalize_agent_scan_serials(row.get("serialNumbers")):
        return True
    return any(
        meaningful(row.get(key))
        for key in ("productName", "skuKey", "pnMtm", "orderNumber", "voucherCode", "modelText")
    )


def _agent_scan_normalize_finance(item: dict[str, Any]) -> dict[str, Any] | None:
    if not _agent_scan_has_billable_unit(item):
        return None
    source_group_name = str(item.get("sourceGroupName") or "").strip()
    scan_type = str(item.get("scanType") or "single_scan").strip() or "single_scan"
    quantity = max(1, int(item.get("quantity") or 1))
    expected_fee: float | None = None
    fee_scope = "unit"
    if scan_type == "three_piece":
        expected_fee, fee_scope = 300.0, "bundle"
        source_group_name = "智店通入库群"
    elif scan_type == "dual_screen_two_piece":
        expected_fee, fee_scope = 150.0, "bundle"
        source_group_name = "智店通入库群"
    elif scan_type == "two_piece":
        expected_fee, fee_scope = 130.0, "bundle"
        source_group_name = "智店通入库群"
    elif source_group_name == "教育补贴群":
        expected_fee = 30.0
    elif source_group_name == "智店通入库群":
        expected_fee = 50.0
    if expected_fee is not None:
        item["sourceGroupName"] = source_group_name
        item["serviceFeePerUnit"] = expected_fee
        item["totalServiceFee"] = expected_fee if fee_scope == "bundle" else round(expected_fee * quantity, 2)
        item["bundleTotalServiceFee"] = item["totalServiceFee"]
        item["feeScope"] = fee_scope
    item.setdefault("ruleVersion", "education-subsidy-agent-scan-v2.0.0")
    item.setdefault("classificationStatus", "formal_candidate")
    item.setdefault("evidenceLevel", "billable")
    item.setdefault("reviewStatus", item.get("reviewStatus") or "pending")
    return item


def _rebuild_agent_scan_summary(rows: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
    group_summary_map: dict[str, dict[str, Any]] = {}
    latest_scan_date = ""
    latest_education_group_scan_date = ""
    latest_inbound_group_scan_date = ""
    summary = {
        "totalCount": 0,
        "pendingOutboundCount": 0,
        "unpaidCount": 0,
        "paidCount": 0,
        "matchedOutboundCount": 0,
        "totalEducationDiscountAmount": 0.0,
        "totalServiceFee": 0.0,
        "totalZhixiangjinAmount": 0.0,
        "unpaidServiceFee": 0.0,
        "phoneMismatchCount": 0,
    }

    normalized_rows: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        item = dict(item)
        normalized_item = _agent_scan_normalize_finance(item)
        if normalized_item is None:
            continue
        item = normalized_item
        normalized_rows.append(item)
        source_group_name = str(item.get("sourceGroupName") or "未分组").strip() or "未分组"
        collection_source = str(item.get("collectionSource") or source_group_name).strip() or source_group_name
        scan_date = str(item.get("scanDate") or item.get("lockedDisplayDate") or "").strip()
        service_fee_per_unit = float(item.get("serviceFeePerUnit") or 0)
        total_discount = float(item.get("totalEducationDiscountAmount") or 0)
        total_service_fee = float(item.get("totalServiceFee") or 0)
        total_zhixiangjin = float(item.get("totalZhixiangjinAmount") or item.get("zhixiangjinAmount") or 0)
        payment_received = bool(item.get("paymentReceived"))
        status = str(item.get("status") or "").strip()
        if not status:
            status = "已付" if payment_received else ("未付" if str(item.get("outboundDate") or "").strip() else "待出库同步")
            item["status"] = status

        summary["totalCount"] += 1
        if status == "待出库同步":
            summary["pendingOutboundCount"] += 1
        elif status == "已付":
            summary["paidCount"] += 1
        else:
            summary["unpaidCount"] += 1
        if str(item.get("outboundDate") or "").strip():
            summary["matchedOutboundCount"] += 1
        summary["totalEducationDiscountAmount"] = round(summary["totalEducationDiscountAmount"] + total_discount, 2)
        summary["totalServiceFee"] = round(summary["totalServiceFee"] + total_service_fee, 2)
        summary["totalZhixiangjinAmount"] = round(summary["totalZhixiangjinAmount"] + total_zhixiangjin, 2)
        if status != "已付":
            summary["unpaidServiceFee"] = round(summary["unpaidServiceFee"] + total_service_fee, 2)
        customer_phone = str(item.get("customerPhone") or "").strip()
        agent_phone = str(item.get("agentPhone") or "").strip()
        if customer_phone and agent_phone and customer_phone != agent_phone:
            summary["phoneMismatchCount"] += 1

        if scan_date and scan_date > latest_scan_date:
            latest_scan_date = scan_date
        if source_group_name == "教育补贴群" and scan_date > latest_education_group_scan_date:
            latest_education_group_scan_date = scan_date
        if source_group_name == "智店通入库群" and scan_date > latest_inbound_group_scan_date:
            latest_inbound_group_scan_date = scan_date

        group_summary = group_summary_map.setdefault(
            source_group_name,
            {
                "sourceGroupName": source_group_name,
                "collectionSource": collection_source,
                "serviceFeePerUnit": service_fee_per_unit,
                "totalCount": 0,
                "pendingOutboundCount": 0,
                "unpaidCount": 0,
                "paidCount": 0,
                "matchedOutboundCount": 0,
                "totalEducationDiscountAmount": 0.0,
                "totalServiceFee": 0.0,
                "totalZhixiangjinAmount": 0.0,
                "unpaidServiceFee": 0.0,
            },
        )
        if not group_summary.get("serviceFeePerUnit") and service_fee_per_unit:
            group_summary["serviceFeePerUnit"] = service_fee_per_unit
        group_summary["totalCount"] += 1
        if status == "待出库同步":
            group_summary["pendingOutboundCount"] += 1
        elif status == "已付":
            group_summary["paidCount"] += 1
        else:
            group_summary["unpaidCount"] += 1
        if str(item.get("outboundDate") or "").strip():
            group_summary["matchedOutboundCount"] += 1
        group_summary["totalEducationDiscountAmount"] = round(group_summary["totalEducationDiscountAmount"] + total_discount, 2)
        group_summary["totalServiceFee"] = round(group_summary["totalServiceFee"] + total_service_fee, 2)
        group_summary["totalZhixiangjinAmount"] = round(group_summary["totalZhixiangjinAmount"] + total_zhixiangjin, 2)
        if status != "已付":
            group_summary["unpaidServiceFee"] = round(group_summary["unpaidServiceFee"] + total_service_fee, 2)

    payload["rows"] = normalized_rows
    payload["totalCount"] = summary["totalCount"]
    payload["pendingOutboundCount"] = summary["pendingOutboundCount"]
    payload["unpaidCount"] = summary["unpaidCount"]
    payload["paidCount"] = summary["paidCount"]
    payload["matchedOutboundCount"] = summary["matchedOutboundCount"]
    payload["totalEducationDiscountAmount"] = summary["totalEducationDiscountAmount"]
    payload["totalServiceFee"] = summary["totalServiceFee"]
    payload["totalZhixiangjinAmount"] = summary["totalZhixiangjinAmount"]
    payload["unpaidServiceFee"] = summary["unpaidServiceFee"]
    payload["phoneMismatchCount"] = summary["phoneMismatchCount"]
    payload["latestScanDate"] = latest_scan_date
    payload["latestEducationGroupScanDate"] = latest_education_group_scan_date
    payload["latestInboundGroupScanDate"] = latest_inbound_group_scan_date
    payload["summary"] = dict(summary)
    payload["ruleVersion"] = "education-subsidy-agent-scan-v2.0.0"
    payload["groupSummaries"] = sorted(
        group_summary_map.values(),
        key=lambda item: (-int(item["totalCount"]), str(item["sourceGroupName"])),
    )
    return payload


def _merge_v2_records_into_agent_scan_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    payload = dict(snapshot) if isinstance(snapshot, dict) else {}
    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_fingerprints: set[tuple[Any, ...]] = set()
    v2_records: list[dict[str, Any]] = []

    with retail_core.connect() as conn:
        v2_rows = conn.execute(
            """
            SELECT *
            FROM education_scan_record_v2
            WHERE scan_date >= '2026-06-06'
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()

    for row in v2_rows:
        raw_payload = retail_core._decode_json_field(row["raw_payload_json"], {})  # type: ignore[attr-defined]
        metadata = raw_payload.get("metadata") if isinstance(raw_payload.get("metadata"), dict) else {}
        serial_numbers = retail_core._decode_json_field(row["serial_numbers_json"], [])  # type: ignore[attr-defined]
        if bool(metadata.get("serviceMatchFiltered") or metadata.get("nonBillableEvidenceOnly") or metadata.get("non_billable_evidence_only") in (True, "true", "1")):
            continue
        record_id = str(row["record_id"] or "").strip()
        if (
            not record_id
            or _is_synthetic_agent_scan_row(
                record_id=record_id,
                source_file=row["source_file"],
                customer_phone=row["customer_phone"],
                serial_numbers=serial_numbers,
                client_tag=metadata.get("clientTag"),
                photo_id=metadata.get("photoId"),
            )
        ):
            continue
        if not isinstance(serial_numbers, list):
            serial_numbers = []
        source_group_name = (
            _explicit_group_from_text(row["source_file"], metadata.get("watermark"))
            or str(row["source_group_name"] or "").strip()
        )
        source_type = str(metadata.get("sourceType") or "").strip() or "watermark_camera_manual"
        collection_source = str(metadata.get("collectionSource") or "").strip() or source_group_name
        record = {
            "id": record_id,
            "sourceType": source_type,
            "sourceGroupName": source_group_name,
            "collectionSource": collection_source,
            "sourceFile": row["source_file"] or "",
            "scanDate": row["scan_date"] or "",
            "lockedDisplayDate": row["scan_date"] or "",
            "productName": row["product_name"] or "",
            "skuKey": row["sku_key"] or "",
            "pnMtm": row["pn_mtm"] or "",
            "spec": row["spec"] or "",
            "category": row["category"] or "",
            "scanType": row["scan_type"] or "",
            "quantity": row["quantity"] or 1,
            "educationDiscountAmount": row["education_discount_amount"] or 0,
            "totalEducationDiscountAmount": row["total_education_discount_amount"] or 0,
            "serviceFeePerUnit": row["service_fee_per_unit"] or 0,
            "totalServiceFee": row["total_service_fee"] or 0,
            "zhixiangjinAmount": row["zhixiangjin_amount"] or 0,
            "orderNumber": row["order_number"] or "",
            "outboundDate": row["outbound_date"] or "",
            "outboundStoreName": row["outbound_store_name"] or "",
            "outboundOperatorName": row["outbound_operator_name"] or "",
            "serialNumbers": [str(item).strip() for item in serial_numbers if str(item or "").strip()],
            "paymentReceived": str(row["status"] or "") == "已付",
            "activityLabel": "教育补代扫 CLI 主链",
            "ruleText": row["report_status"] or "CLI 正式入库",
            "customerName": row["customer_name"] or "",
            "customerPhone": row["customer_phone"] or "",
            "agentPhone": row["agent_phone"] or "",
            "modelText": row["spec"] or "",
            "voucherCode": row["voucher_code"] or "",
            "voucherVerifiedAt": row["voucher_verified_at"] or "",
            "reportStatus": row["report_status"] or "本地录入",
            "photoId": metadata.get("photoId") or "",
            "mediaUrl": metadata.get("mediaUrl") or "",
            "takenAt": metadata.get("takenAt") or metadata.get("capturedAt") or "",
            "watermark": metadata.get("watermark") or "",
            "serviceRuleKey": row["service_rule_key"],
            "serviceRuleLabel": row["service_rule_label"],
            "bundleChargeApplied": bool(row["bundle_charge_applied"]),
            "bundleTotalServiceFee": row["total_service_fee"] or 0,
            "bundleTotalZhixiangjinAmount": row["zhixiangjin_amount"] or 0,
            "status": row["status"] or "未付",
        }
        normalized_record = _agent_scan_normalize_finance(record)
        if normalized_record is None:
            continue
        v2_records.append(normalized_record)

    override_ids = {str(item.get("id") or "").strip() for item in v2_records if str(item.get("id") or "").strip()}

    candidate_snapshots: list[dict[str, Any]] = []
    for candidate_path in _agent_scan_baseline_candidates():
        if not candidate_path.exists():
            continue
        try:
            candidate_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(candidate_payload, dict) and isinstance(candidate_payload.get("rows"), list):
            candidate_snapshots.append(candidate_payload)
    if isinstance(payload.get("rows"), list):
        candidate_snapshots.append(payload)

    candidate_snapshots.sort(key=lambda item: len(item.get("rows") or []), reverse=True)
    for candidate_payload in candidate_snapshots:
        for item in candidate_payload.get("rows") or []:
            if not isinstance(item, dict):
                continue
            row_id = str(item.get("id") or "").strip()
            if row_id and row_id in override_ids:
                continue
            if _is_synthetic_agent_scan_row(
                record_id=row_id,
                source_file=item.get("sourceFile"),
                customer_phone=item.get("customerPhone"),
                serial_numbers=item.get("serialNumbers"),
                client_tag="",
                photo_id=item.get("photoId"),
            ):
                continue
            fingerprint = _agent_scan_row_fingerprint(item)
            if row_id and row_id in seen_ids:
                continue
            if fingerprint in seen_fingerprints:
                continue
            normalized_item = _agent_scan_normalize_finance(dict(item))
            if normalized_item is None:
                continue
            rows.append(normalized_item)
            if row_id:
                seen_ids.add(row_id)
            seen_fingerprints.add(fingerprint)

    for record in v2_records:
        record_id = str(record.get("id") or "").strip()
        fingerprint = _agent_scan_row_fingerprint(record)
        if record_id and record_id in seen_ids:
            continue
        if fingerprint in seen_fingerprints:
            continue
        rows.append(record)
        if record_id:
            seen_ids.add(record_id)
        seen_fingerprints.add(fingerprint)

    rows.sort(
        key=lambda item: (
            str(item.get("scanDate") or ""),
            str(item.get("takenAt") or ""),
            str(item.get("id") or ""),
        ),
        reverse=True,
    )
    return _rebuild_agent_scan_summary(rows, payload)


def compute_openclaw_source_signature() -> dict[str, Any]:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return {"ok": False, "error": "missing_database_url"}
    try:
        import psycopg  # type: ignore
    except Exception as error:
        return {"ok": False, "error": f"psycopg_unavailable:{error}"}

    parts: list[dict[str, Any]] = []
    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                for table_name, sql in OPENCLAW_SIGNATURE_QUERIES:
                    cur.execute(sql)
                    count, max_marker = cur.fetchone()
                    parts.append({
                        "table": table_name,
                        "count": int(count or 0),
                        "maxMarker": str(max_marker or ""),
                    })
    except Exception as error:
        return {"ok": False, "error": f"signature_query_failed:{type(error).__name__}:{error}"}

    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True)
    return {
        "ok": True,
        "parts": parts,
        "signature": hashlib.sha1(raw.encode("utf-8")).hexdigest(),
    }


def _read_auto_sync_state() -> dict[str, Any]:
    with retail_core.connect() as conn:
        row = conn.execute(
            "SELECT status, payload_json, updated_at FROM sync_task WHERE id = ?",
            (OPENCLAW_AUTO_SYNC_TASK_ID,),
        ).fetchone()
    if not row:
        return {}
    try:
        payload = json.loads(str(row["payload_json"] or "{}"))
    except json.JSONDecodeError:
        payload = {}
    return {
        "status": str(row["status"] or ""),
        "updatedAt": str(row["updated_at"] or ""),
        "payload": payload if isinstance(payload, dict) else {},
    }


def _write_auto_sync_state(*, status: str, payload: dict[str, Any], updated_at: str, error: str = "") -> None:
    with retail_core.connect() as conn:
        conn.execute(
            """
            INSERT INTO sync_task
            (id, external_system_id, task_type, entity_type, entity_id, status, retry_count, last_error, payload_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              last_error = excluded.last_error,
              payload_json = excluded.payload_json,
              updated_at = excluded.updated_at
            """,
            (
                OPENCLAW_AUTO_SYNC_TASK_ID,
                "zhidiantong",
                "auto_sql_bridge_sync",
                "openclaw_signature",
                "inventory_order_sync",
                status,
                error,
                json.dumps(payload, ensure_ascii=False),
                updated_at,
                updated_at,
            ),
        )
        conn.commit()


def ensure_openclaw_sql_bridge(data_dir: Path, *, force: bool = False, min_interval_seconds: float = 15.0) -> dict[str, Any]:
    now = time.time()
    cached_result = _AUTO_SYNC_CACHE.get("result")
    cached_checked_at = float(_AUTO_SYNC_CACHE.get("checkedAt") or 0.0)
    if not force and cached_result and now - cached_checked_at < min_interval_seconds:
        return cached_result

    source_info = compute_openclaw_source_signature()
    if not source_info.get("ok"):
        result = {
            "ok": False,
            "status": "signature_unavailable",
            "error": source_info.get("error", "unknown"),
            "database": str(retail_core.DB_FILE),
        }
        _AUTO_SYNC_CACHE.update({"checkedAt": now, "result": result})
        return result

    source_signature = str(source_info.get("signature") or "")
    with _AUTO_SYNC_LOCK:
        latest_state = _read_auto_sync_state()
        payload = latest_state.get("payload") if isinstance(latest_state.get("payload"), dict) else {}
        last_signature = str(payload.get("sourceSignature") or "")
        if not force and last_signature == source_signature:
            status_snapshot = _read_seed_counts_snapshot(data_dir)
            result = {
                "ok": True,
                "status": "up_to_date",
                "sourceSignature": source_signature,
                "updatedAt": latest_state.get("updatedAt", ""),
                "database": str(retail_core.DB_FILE),
                **(status_snapshot if isinstance(status_snapshot, dict) else {}),
            }
            _AUTO_SYNC_CACHE.update({"checkedAt": time.time(), "sourceSignature": source_signature, "result": result})
            return result

        started_at = retail_core.now_iso()
        _write_auto_sync_state(
            status="running",
            payload={"startedAt": started_at, "sourceSignature": source_signature, "sourceParts": source_info.get("parts", [])},
            updated_at=started_at,
        )
        try:
            written = write_static_snapshots(data_dir)
            finished_at = retail_core.now_iso()
            status_snapshot = _read_seed_counts_snapshot(data_dir)
            result = {
                "ok": True,
                "status": "synced",
                "database": str(retail_core.DB_FILE),
                "sourceSignature": source_signature,
                "sourceParts": source_info.get("parts", []),
                "startedAt": started_at,
                "finishedAt": finished_at,
                "writtenCount": len(written),
                **(status_snapshot if isinstance(status_snapshot, dict) else {}),
            }
            _write_auto_sync_state(
                status="completed",
                payload=result,
                updated_at=finished_at,
            )
        except Exception as error:
            finished_at = retail_core.now_iso()
            result = {
                "ok": False,
                "status": "failed",
                "database": str(retail_core.DB_FILE),
                "sourceSignature": source_signature,
                "startedAt": started_at,
                "finishedAt": finished_at,
                "error": f"{type(error).__name__}: {error}",
            }
            _write_auto_sync_state(
                status="failed",
                payload=result,
                updated_at=finished_at,
                error=result["error"],
            )
        _AUTO_SYNC_CACHE.update({"checkedAt": time.time(), "sourceSignature": source_signature, "result": result})
        return result


def regenerate_ad_machine_pages() -> dict[str, Any]:
    completed = subprocess.run(
        ["node", "scripts/generate-lenovo-618-flyers.mjs"],
        cwd=WEB_COCKPIT_DIR,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": "node scripts/generate-lenovo-618-flyers.mjs",
        "exitCode": completed.returncode,
        "ok": completed.returncode == 0,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def write_static_snapshots(data_dir: Path) -> dict[str, str]:
    seed_result = retail_core.seed_reference_data(data_dir)
    repair_timestamp = retail_core.now_iso()
    with retail_core.connect() as conn:
        final_sales_sync = retail_core.sync_all_sales_orders_from_openclaw_sql(conn, repair_timestamp)
        final_purchase_identity = retail_core.normalize_purchase_inbound_movement_identity(conn, repair_timestamp)
        final_sales_line_enrichment = retail_core.enrich_sales_order_lines_from_inventory_movements(conn)
        final_sales_amount_normalization = retail_core.normalize_sales_outbound_movement_amounts_from_sales_lines(conn, repair_timestamp)
        conn.commit()
    seed_result["finalRepairSalesOrdersFromOpenclaw"] = final_sales_sync
    seed_result["finalRepairPurchaseMovementIdentity"] = final_purchase_identity
    seed_result["finalRepairSalesOrderLinesFromMovements"] = final_sales_line_enrichment
    seed_result["finalRepairSalesMovementAmounts"] = final_sales_amount_normalization
    inventory_snapshot_result = retail_core.refresh_sql_inventory_snapshot_cache(data_dir)
    product_library_written = product_library.write_published_product_projection_snapshots(data_dir)
    ad_machine_result = regenerate_ad_machine_pages()
    sales_orders_payload = retail_core.list_sales_orders(limit=2000)
    agent_scan_payload = retail_core.list_education_agent_scan_summary(limit=2000)
    existing_agent_scan_snapshot = read_artifact(
        "latest-education-subsidy-agent-scan-summary.json",
        default={},
    )
    education_agent_full_snapshot = agent_scan_payload if isinstance(agent_scan_payload, dict) else {}
    if isinstance(existing_agent_scan_snapshot, dict):
        for key in ("bundleOrderAudit", "phoneMismatchAlerts", "workflow"):
            if not education_agent_full_snapshot.get(key) and existing_agent_scan_snapshot.get(key):
                education_agent_full_snapshot[key] = existing_agent_scan_snapshot.get(key)
    education_agent_full_snapshot = _merge_v2_records_into_agent_scan_snapshot(education_agent_full_snapshot)
    agent_scan_serials: set[str] = set()
    gap_source_group_by_order: dict[str, str] = {}
    for row in (education_agent_full_snapshot.get("rows") or education_agent_full_snapshot.get("items") or []):
        if not isinstance(row, dict):
            continue
        order_number = str(
            row.get("bundleMatchedOrderNumber")
            or row.get("orderNumber")
            or row.get("order_number")
            or ""
        ).strip()
        source_group_name = str(
            row.get("sourceGroupName")
            or row.get("collectionSource")
            or ""
        ).strip()
        if order_number and source_group_name:
            gap_source_group_by_order[order_number] = source_group_name
        for key in ("serialNumber", "serial_number", "sn", "boxCode", "box_code"):
            value = str(row.get(key) or "").strip().upper()
            if value:
                agent_scan_serials.add(value)
        serial_numbers = row.get("serialNumbers")
        if isinstance(serial_numbers, list):
            for value in serial_numbers:
                serial = str(value or "").strip().upper()
                if serial:
                    agent_scan_serials.add(serial)
    for audit_item in education_agent_full_snapshot.get("bundleOrderAudit") or []:
        if not isinstance(audit_item, dict):
            continue
        order_number = str(audit_item.get("orderNumber") or "").strip()
        if not order_number:
            continue
        gap_source_group_by_order.setdefault(order_number, "智店通入库群")
    with retail_core.connect() as conn:
        v2_rows = conn.execute(
            """
            SELECT order_number, source_group_name, serial_numbers_json, raw_payload_json, source_file, record_id
            FROM education_scan_record_v2
            WHERE scan_date >= '2026-06-06'
            ORDER BY id DESC
            """
        ).fetchall()
    for row in v2_rows:
        raw_payload = retail_core._decode_json_field(row["raw_payload_json"], {})  # type: ignore[attr-defined]
        metadata = raw_payload.get("metadata") if isinstance(raw_payload.get("metadata"), dict) else {}
        source_file = str(row["source_file"] or "").strip().lower()
        photo_id = str(metadata.get("photoId") or "").strip().lower()
        client_tag = str(metadata.get("clientTag") or "").strip().lower()
        if (
            "test-bridge" in source_file
            or source_file.startswith("cli://test")
            or client_tag.startswith("test-")
            or photo_id.startswith("test-")
            or bool(metadata.get("serviceMatchFiltered") or metadata.get("nonBillableEvidenceOnly") or metadata.get("non_billable_evidence_only") in (True, "true", "1"))
        ):
            continue
        order_number = str(row["order_number"] or "").strip()
        source_group_name = str(row["source_group_name"] or "").strip()
        if order_number and source_group_name:
            gap_source_group_by_order[order_number] = source_group_name
        serial_numbers = retail_core._decode_json_field(row["serial_numbers_json"], [])  # type: ignore[attr-defined]
        if isinstance(serial_numbers, list):
            for value in serial_numbers:
                serial = str(value or "").strip().upper()
                if serial:
                    agent_scan_serials.add(serial)

    agent_scan_gap_items: list[dict[str, Any]] = []
    for order in sales_orders_payload.get("items", []):
        if not isinstance(order, dict):
            continue
        order_no = str(order.get("order_number") or order.get("order_no") or order.get("id") or "").strip()
        operate_time = str(order.get("operate_time") or order.get("pay_time") or order.get("created_at") or "").strip()
        source_group_name = gap_source_group_by_order.get(order_no)
        if not source_group_name and operate_time[:10] >= "2026-05-31":
            source_group_name = "智店通入库群"
        for line in order.get("lines", []) or []:
            if not isinstance(line, dict):
                continue
            if retail_core.is_service_fulfillment_text(
                line.get("sku_key"),
                line.get("product_name"),
                line.get("pn_mtm"),
                line.get("spec"),
            ):
                continue
            serials: list[str] = []
            raw_serial_number = str(line.get("serial_number") or "").strip()
            if raw_serial_number:
                serials.append(raw_serial_number)
            try:
                parsed_serials = json.loads(str(line.get("serial_numbers_json") or "[]"))
                if isinstance(parsed_serials, list):
                    serials.extend([str(item).strip() for item in parsed_serials if str(item).strip()])
            except json.JSONDecodeError:
                pass
            normalized_serials = sorted({serial.upper() for serial in serials if serial})
            missing_serials = [serial for serial in normalized_serials if serial not in agent_scan_serials]
            if not missing_serials:
                continue
            agent_scan_gap_items.append({
                "orderNumber": order_no,
                "operateTime": operate_time,
                "sourceGroupName": source_group_name or "待判定",
                "collectionSource": source_group_name or "待判定",
                "skuKey": str(line.get("sku_key") or line.get("sku_no") or "").strip(),
                "productName": str(line.get("product_name") or "").strip(),
                "serialNumbers": normalized_serials,
                "missingSerialNumbers": missing_serials,
            })
    inventory_movements_payload = retail_core.list_inventory_movements(page=1, page_size=5000)
    artifact_payloads = {
        "latest-local-sync-report.json": latest_report(),
        "latest-local-sync-failure-queue.json": failure_queue(),
        "latest-local-sync-pipelines.json": {
            "items": list_pipelines(),
            "count": len(LOCAL_SYNC_PIPELINES),
        },
        "latest-retail-core-status.json": {
            "database": seed_result["database"],
            "seeded": {
                "skus": seed_result.get("seededSkus", 0),
                "serials": seed_result.get("seededSerials", 0),
                "movements": seed_result.get("seededMovements", 0),
                "salesOrders": seed_result.get("syncedSalesOrders", 0),
                "orderRegistry": seed_result.get("syncedOrderRegistry", 0),
                "warrantyRecords": seed_result.get("syncedWarrantyRecords", 0),
            },
            "tableCounts": retail_core.table_counts(),
        },
        "latest-retail-core-category-tree.json": retail_core.list_category_tree(),
        "latest-retail-core-serial-items.json": retail_core.list_serial_items(limit=5000),
        "latest-retail-core-inventory-movements.json": inventory_movements_payload,
        "latest-retail-core-sales-orders.json": sales_orders_payload,
        "latest-retail-core-customers.json": retail_core.list_customers(limit=5000),
        "latest-retail-core-order-sync-registry.json": retail_core.list_order_sync_registry(limit=500),
        "latest-retail-core-sync-gap-queue.json": retail_core.list_sync_gap_queue(limit=500),
        "latest-retail-core-distributor-quotes.json": retail_core.list_distributor_quotes(limit=600),
        "latest-retail-core-gray-wholesale-quotes.json": retail_core.list_gray_wholesale_quotes(limit=1200),
        "latest-retail-core-price-signals.json": retail_core.list_inventory_price_signals(limit=4000),
        "latest-retail-core-sync-tasks.json": retail_core.list_sync_tasks(limit=100),
        "latest-retail-core-sales-price-protection-history.json": retail_core.list_sales_price_protection_history(limit=240),
        "latest-education-subsidy-agent-scan-summary.json": education_agent_full_snapshot,
        "latest-sn-sales-compliance-snapshot.json": retail_core.list_sn_sales_compliance(limit=4000),
        "latest-education-agent-scan-sync-gap.json": {
            "generatedAt": retail_core.now_iso(),
            "source": "api.local_sync",
            "salesOrderCount": int(sales_orders_payload.get("count") or 0),
            "agentScanSerialCount": len(agent_scan_serials),
            "gapCount": len(agent_scan_gap_items),
            "items": agent_scan_gap_items[:2000],
        },
    }
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    written: dict[str, str] = {}
    for file_name, payload in artifact_payloads.items():
        for path in (data_dir / file_name, artifact_dir / file_name):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            written[f"{file_name}:{'web' if 'web-cockpit' in str(path) else 'artifact'}"] = str(path)
    for key, result in inventory_snapshot_result.items():
        written[f"inventory_snapshot::{key}::web"] = str(result.get("webPath") or "")
        written[f"inventory_snapshot::{key}::artifact"] = str(result.get("artifactPath") or "")
    written.update({f"product_library::{key}": value for key, value in product_library_written.items()})
    written["ad_machine_generator::status"] = json.dumps(ad_machine_result, ensure_ascii=False)
    return written


def run_pipeline(
    pipeline: str,
    *,
    dry_run: bool = False,
    trigger: str = "api",
    operator: str | None = None,
) -> dict[str, Any]:
    if pipeline not in LOCAL_SYNC_PIPELINES:
        raise ValueError(f"unsupported pipeline: {pipeline}")
    command = [
        "node",
        "--import",
        "tsx/esm",
        "src/cli.ts",
        "run-local-sync",
        pipeline,
        "--trigger",
        trigger,
    ]
    if dry_run:
        command.append("--dry-run")
    if operator:
        command.extend(["--operator", operator])

    completed = subprocess.run(
        command,
        cwd=INVENTORY_SYNC_DIR,
        text=True,
        capture_output=True,
        check=False,
    )
    stdout = completed.stdout.strip()
    if not stdout:
        return {
            "status": "failed",
            "exitCode": completed.returncode,
            "stdout": stdout,
            "stderr": completed.stderr.strip(),
        }
    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        json_payload = None
        for index, char in enumerate(stdout):
            if char != "{":
                continue
            candidate = stdout[index:]
            try:
                json_payload = json.loads(candidate)
                break
            except json.JSONDecodeError:
                continue
        if json_payload is not None:
            result = json_payload
            result["stdout"] = stdout
            result["parsedFromMixedStdout"] = True
        else:
            return {
                "status": "failed",
                "exitCode": completed.returncode,
                "stdout": stdout,
                "stderr": completed.stderr.strip(),
                "error": "invalid_json_output",
            }
    result["exitCode"] = completed.returncode
    if completed.stderr.strip():
        result["stderr"] = completed.stderr.strip()
    return result


def ensure_inventory_master_sync(
    data_dir: Path,
    *,
    trigger: str = "api_auto",
    operator: str | None = None,
    source: str = "",
    force: bool = False,
    min_interval_seconds: float = 20.0,
    wait_for_completion: bool = True,
    max_wait_seconds: float = 45.0,
) -> dict[str, Any]:
    wait_started_at = time.time()
    execution_started_at = ""
    while True:
        should_execute = False
        running_snapshot: dict[str, Any] | None = None
        with _AUTO_INVENTORY_MASTER_SYNC_LOCK:
            state = _AUTO_INVENTORY_MASTER_SYNC_STATE
            running = bool(state.get("running"))
            last_result = state.get("lastResult") if isinstance(state.get("lastResult"), dict) else None
            last_finished_at = float(state.get("lastFinishedAt") or 0.0)
            if running:
                running_snapshot = {
                    "ok": True,
                    "status": "running",
                    "pipeline": "inventory-master-sync",
                    "trigger": str(state.get("currentTrigger") or trigger),
                    "source": str(state.get("currentSource") or source),
                    "startedAt": str(state.get("startedAt") or ""),
                }
            elif (
                not force
                and last_result
                and last_result.get("ok")
                and last_finished_at > 0
                and time.time() - last_finished_at < min_interval_seconds
            ):
                return {
                    **last_result,
                    "status": "throttled",
                    "pipeline": "inventory-master-sync",
                    "trigger": trigger,
                    "source": source,
                    "throttled": True,
                    "minIntervalSeconds": min_interval_seconds,
                }
            else:
                execution_started_at = retail_core.now_iso()
                state["running"] = True
                state["startedAt"] = execution_started_at
                state["lastRequestedAt"] = time.time()
                state["currentTrigger"] = trigger
                state["currentSource"] = source
                should_execute = True
        if should_execute:
            break
        if not wait_for_completion:
            return running_snapshot or {
                "ok": True,
                "status": "running",
                "pipeline": "inventory-master-sync",
                "trigger": trigger,
                "source": source,
            }
        if time.time() - wait_started_at >= max_wait_seconds:
            return {
                **(running_snapshot or {}),
                "ok": False,
                "status": "wait_timeout",
                "pipeline": "inventory-master-sync",
                "trigger": trigger,
                "source": source,
                "maxWaitSeconds": max_wait_seconds,
            }
        time.sleep(0.5)

    try:
        report = run_pipeline(
            "inventory-master-sync",
            dry_run=False,
            trigger=trigger,
            operator=operator,
        )
        written = write_static_snapshots(data_dir)
        finished_at = retail_core.now_iso()
        # allowNonZeroExit 盾牌：退出码非零但 JSON 有效（inventory snapshot 已写入）→ executed_not_closed
        exit_code = report.get("exitCode", 0)
        json_valid = (
            isinstance(report.get("lastInventoryMaster"), dict)
            or isinstance(report.get("inventoryMasterSnapshot"), dict)
            or isinstance(report.get("snapshotCache"), dict)
        )
        if exit_code != 0 and json_valid:
            report_status = "executed_not_closed"
        else:
            report_status = str(report.get("status") or "").strip() or ("completed" if exit_code == 0 else "failed")
        ok = report_status not in {"failed"}
        result = {
            "ok": ok,
            "status": report_status,
            "pipeline": "inventory-master-sync",
            "trigger": trigger,
            "source": source,
            "startedAt": execution_started_at,
            "finishedAt": finished_at,
            "writtenCount": len(written),
            "report": report,
        }
    except Exception as error:
        finished_at = retail_core.now_iso()
        result = {
            "ok": False,
            "status": "failed",
            "pipeline": "inventory-master-sync",
            "trigger": trigger,
            "source": source,
            "startedAt": execution_started_at,
            "finishedAt": finished_at,
            "error": f"{type(error).__name__}: {error}",
        }
    with _AUTO_INVENTORY_MASTER_SYNC_LOCK:
        _AUTO_INVENTORY_MASTER_SYNC_STATE["running"] = False
        _AUTO_INVENTORY_MASTER_SYNC_STATE["lastFinishedAt"] = time.time()
        _AUTO_INVENTORY_MASTER_SYNC_STATE["lastResult"] = result
        _AUTO_INVENTORY_MASTER_SYNC_STATE["currentTrigger"] = ""
        _AUTO_INVENTORY_MASTER_SYNC_STATE["currentSource"] = ""
    return result


def run_inventory_sync_command(command_name: str) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "node",
            "--import",
            "tsx/esm",
            "src/cli.ts",
            command_name,
        ],
        cwd=INVENTORY_SYNC_DIR,
        text=True,
        capture_output=True,
        check=False,
    )
    stdout = completed.stdout.strip()
    parsed: dict[str, Any] | None = None
    if stdout:
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            for index, char in enumerate(stdout):
                if char != "{":
                    continue
                candidate = stdout[index:]
                try:
                    parsed = json.loads(candidate)
                    break
                except json.JSONDecodeError:
                    continue
    return {
        "command": command_name,
        "exitCode": completed.returncode,
        "ok": completed.returncode == 0,
        "stdout": stdout,
        "stderr": completed.stderr.strip(),
        "parsed": parsed,
    }


def rebuild_product_library_views(*, trigger: str = "api", operator: str | None = None, scope: str = "full") -> dict[str, Any]:
    steps_to_run = PRODUCT_LIBRARY_REBUILD_SCOPES.get(scope, PRODUCT_LIBRARY_REBUILD_STEPS)
    steps: list[dict[str, Any]] = []
    failed = False
    for command_name, label in steps_to_run:
        result = run_inventory_sync_command(command_name)
        steps.append({
            "command": command_name,
            "label": label,
            **result,
        })
        if not result["ok"]:
            failed = True
            break
    return {
        "status": "failed" if failed else "completed",
        "trigger": trigger,
        "operator": operator or "system",
        "scope": scope,
        "stepCount": len(steps),
        "steps": steps,
    }


# === 6 终端同步状态聚合 (2026-06-08) ===

SIX_TERMINAL_CATALOG: list[dict[str, str]] = [
    {"key": "retailHome", "title": "零售卡前端", "route": "/"},
    {"key": "retailLive", "title": "零售直播页", "route": "/retail-live"},
    {"key": "adMachine", "title": "彩页广告机前端", "route": "/ad-machine/index.html"},
    {"key": "retailOps", "title": "进销存销售端", "route": "/retail-ops"},
    {"key": "androidPos", "title": "收银台前端", "route": "/android-pos"},
    {"key": "androidPosLite", "title": "收银台兼容页", "route": "/android-pos-lite.html"},
]

SIX_TERMINAL_FACT_LAYER_FILES: dict[str, str] = {
    "publishedProductProjection": "latest-published-product-projection.json",
    "retailZone": "latest-retail-zone-snapshot.json",
    "inventoryMaster": "latest-inventory-master-snapshot.json",
    "standardInventory": "latest-standard-inventory-snapshot.json",
}


def _six_terminal_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _six_terminal_signature(data: dict[str, Any]) -> str:
    """对快照的轻量指纹（只取顶层 metadata，避免 23MB 投影重 hash）"""
    if not data:
        return ""
    fingerprint: dict[str, Any] = {
        "generatedAt": data.get("generatedAt") or data.get("publishedAt") or "",
        "version": data.get("version") or data.get("schemaVersion") or "",
        "totals": data.get("totals") or {},
        "skusCount": (
            len(data.get("skus", []))
            or len(data.get("rows", []))
            or len(data.get("decisions", {}).get("items", []))
            or len(data.get("items", []))
        ),
        "firstSkus": (
            (data.get("skus") or data.get("rows") or [])[:3]
            if isinstance(data.get("skus"), list) or isinstance(data.get("rows"), list)
            else []
        ),
    }
    canonical = json.dumps(fingerprint, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _six_terminal_convergence_score(fact_layer: dict[str, dict[str, Any]]) -> int:
    """100 = 全同步，0 = 全分叉。"""
    weights = {
        "publishedProductProjection": 40,
        "retailZone": 30,
        "inventoryMaster": 20,
        "standardInventory": 10,
    }
    score = 0
    for key, weight in weights.items():
        if fact_layer.get(key, {}).get("exists"):
            score += weight
    return score


def _compute_heartbeat_lag(last_fetched_at: str) -> str:
    """根据 lastFetchedAt 计算 lag 状态：live/stale/dead/unknown。"""
    if not last_fetched_at:
        return "unknown"
    try:
        # 优先尝试 email.utils（处理带时区和各种 ISO 变体）
        from email.utils import parsedate_to_datetime
        try:
            fetched_dt = parsedate_to_datetime(last_fetched_at)
            fetched_ts = calendar.timegm(fetched_dt.timetuple())
        except Exception:
            # 回退：尝试常见格式
            fetched_ts = None
            for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    st = time.strptime(last_fetched_at, fmt)
                    fetched_ts = calendar.timegm(st)
                    break
                except ValueError:
                    continue
            if fetched_ts is None:
                return "unknown"
        now_ts = time.time()
        age_seconds = now_ts - fetched_ts
        if age_seconds < 60:
            return "live"
        elif age_seconds < 300:
            return "stale"
        else:
            return "dead"
    except Exception:
        return "unknown"


def record_terminal_heartbeat(
    terminal_id: str,
    terminal_name: str = "",
    last_fetched_at: str = "",
    client_data_signature: str = "",
    status: str = "",
) -> dict[str, Any]:
    """Upsert a terminal heartbeat record into fact_terminal_heartbeat.

    Returns: {ok, terminalId, recordedAt, lag}
    """
    recorded_at = _six_terminal_now_iso()
    lag = _compute_heartbeat_lag(last_fetched_at)
    conn = retail_core.connect()
    try:
        conn.execute(
            """
            INSERT INTO fact_terminal_heartbeat
                (terminal_id, terminal_name, last_fetched_at, client_data_signature, raw_status, recorded_at)
            VALUES
                (:terminal_id, :terminal_name, :last_fetched_at, :client_data_signature, :raw_status, :recorded_at)
            ON CONFLICT(terminal_id) DO UPDATE SET
                terminal_name = excluded.terminal_name,
                last_fetched_at = excluded.last_fetched_at,
                client_data_signature = excluded.client_data_signature,
                raw_status = excluded.raw_status,
                recorded_at = excluded.recorded_at
            """,
            {
                "terminal_id": terminal_id,
                "terminal_name": terminal_name,
                "last_fetched_at": last_fetched_at,
                "client_data_signature": client_data_signature,
                "raw_status": status,
                "recorded_at": recorded_at,
            },
        )
        conn.commit()
        return {"ok": True, "terminalId": terminal_id, "recordedAt": recorded_at, "lag": lag}
    finally:
        conn.close()


def get_terminal_heartbeats() -> dict[str, dict[str, Any]]:
    """返回所有终端最新心跳的字典 {terminal_id: record}。"""
    conn = retail_core.connect()
    try:
        rows = conn.execute(
            """
            SELECT terminal_id, terminal_name, last_fetched_at,
                   client_data_signature, raw_status, recorded_at
            FROM fact_terminal_heartbeat
            ORDER BY recorded_at DESC
            """,
        ).fetchall()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            tid = dict(row).get("terminal_id", "")
            if tid and tid not in result:
                result[tid] = dict(row)
        return result
    finally:
        conn.close()


def compute_six_terminal_status() -> dict[str, Any]:
    """聚合 6 终端同步状态。事实层 = 4 个关键快照的 generatedAt + 签名。"""
    fact_layer: dict[str, dict[str, Any]] = {}
    for key, filename in SIX_TERMINAL_FACT_LAYER_FILES.items():
        path = ARTIFACT_DIR / filename
        size = path.stat().st_size if path.exists() else 0
        data = read_artifact(filename, {}) if size < 8 * 1024 * 1024 else {}
        fact_layer[key] = {
            "filename": filename,
            "exists": bool(data) or size > 0,
            "generatedAt": (
                data.get("generatedAt")
                or data.get("publishedAt")
                or data.get("updatedAt")
                or ""
            ),
            "signature": _six_terminal_signature(data) if data else f"file-only-{size}",
            "sizeBytes": size,
        }

    # 读取心跳表，合并到终端状态
    heartbeats = get_terminal_heartbeats()

    terminals: list[dict[str, Any]] = []
    for t in SIX_TERMINAL_CATALOG:
        hb = heartbeats.get(t["key"], {})
        last_fetched = hb.get("last_fetched_at", "") or hb.get("lastFetchedAt", "")
        client_sig = hb.get("client_data_signature", "") or hb.get("clientDataSignature", "")
        raw_status = hb.get("raw_status", "") or hb.get("status", "")
        if not raw_status:
            raw_status = _compute_heartbeat_lag(last_fetched)
        terminals.append({
            "key": t["key"],
            "title": t["title"],
            "route": t["route"],
            "lastFetchedAt": last_fetched,
            "clientDataSignature": client_sig,
            "lag": raw_status,
        })

    return {
        "computedAt": _six_terminal_now_iso(),
        "convergenceScore": _six_terminal_convergence_score(fact_layer),
        "factLayer": fact_layer,
        "terminals": terminals,
    }


_CALIBRATE_SIX_TERMINALS_LOCK = threading.Lock()
_CALIBRATE_SIX_TERMINALS_STATE: dict[str, Any] = {
    "running": False,
    "startedAt": "",
    "finishedAt": "",
    "lastResult": None,
    "currentTrigger": "",
    "currentChangedBy": "",
    "taskId": "",
}


def _calibrate_six_terminals_worker(
    data_dir: Path,
    *,
    trigger: str,
    changed_by: str,
    task_id: str,
) -> None:
    """后台线程：执行实际校准链。"""
    steps: list[dict[str, Any]] = []

    def _record(name: str, ok: bool, payload: dict[str, Any]) -> None:
        steps.append({"name": name, "ok": ok, "finishedAt": _six_terminal_now_iso(), **payload})

    # Step 0: seed reference data + product library (in background)
    try:
        from . import retail_core as _rc
        _rc.seed_reference_data(data_dir)
        from . import main as _main_mod  # type: ignore
        ensure_fn = getattr(_main_mod, "ensure_product_library_seeded", None)
        if callable(ensure_fn):
            ensure_fn(force=True)
        _record("seed-reference-data", True, {"status": "completed"})
    except Exception as e:
        _record("seed-reference-data", False, {"error": str(e)})

    # Step 1: inventory-master-sync
    try:
        result = ensure_inventory_master_sync(
            data_dir,
            trigger=trigger,
            operator=changed_by,
            source="six-terminal-calibrate",
            force=True,
        )
        _record(
            "ensure-inventory-master",
            bool(result.get("ok")),
            {
                "status": result.get("status"),
                "writtenCount": result.get("writtenCount", 0),
            },
        )
    except Exception as e:
        _record("ensure-inventory-master", False, {"error": str(e)})

    # Step 2: refresh published product projection
    try:
        from . import product_library as _pl
        projection = _pl.build_published_product_projection(data_dir)
        if isinstance(projection, dict):
            _record(
                "rebuild-published-projection",
                True,
                {"status": "completed", "itemCount": len(projection.get("items", []))},
            )
        else:
            _record(
                "rebuild-published-projection",
                True,
                {"status": "completed", "itemCount": 0},
            )
    except Exception as e:
        _record("rebuild-published-projection", False, {"error": str(e)})

    final = {
        "taskId": task_id,
        "startedAt": _CALIBRATE_SIX_TERMINALS_STATE.get("startedAt", ""),
        "finishedAt": _six_terminal_now_iso(),
        "trigger": trigger,
        "changedBy": changed_by,
        "steps": steps,
        "allOk": all(s["ok"] for s in steps),
    }
    with _CALIBRATE_SIX_TERMINALS_LOCK:
        _CALIBRATE_SIX_TERMINALS_STATE["running"] = False
        _CALIBRATE_SIX_TERMINALS_STATE["finishedAt"] = final["finishedAt"]
        _CALIBRATE_SIX_TERMINALS_STATE["lastResult"] = final


def calibrate_six_terminals(
    data_dir: Path,
    *,
    trigger: str = "manual",
    changed_by: str = "user",
    force: bool = True,
) -> dict[str, Any]:
    """手动触发原子重建（后台异步）。立即返回 taskId，不阻塞 HTTP 调用。

    inventory-master-sync 跳 1 个 node 子进程 ~30-90s，
    build_published_product_projection 是 SQL 读 ~1-2s。
    """
    with _CALIBRATE_SIX_TERMINALS_LOCK:
        if _CALIBRATE_SIX_TERMINALS_STATE["running"] and not force:
            return {
                "ok": True,
                "status": "already_running",
                "taskId": _CALIBRATE_SIX_TERMINALS_STATE["taskId"],
                "startedAt": _CALIBRATE_SIX_TERMINALS_STATE["startedAt"],
                "message": "校准已在后台运行中，不要重复点击",
            }
        started_at = _six_terminal_now_iso()
        task_id = f"CALIBRATE-SIX-{int(time.time() * 1000)}"
        _CALIBRATE_SIX_TERMINALS_STATE["running"] = True
        _CALIBRATE_SIX_TERMINALS_STATE["startedAt"] = started_at
        _CALIBRATE_SIX_TERMINALS_STATE["currentTrigger"] = trigger
        _CALIBRATE_SIX_TERMINALS_STATE["currentChangedBy"] = changed_by
        _CALIBRATE_SIX_TERMINALS_STATE["taskId"] = task_id

    # 后台线程执行
    worker = threading.Thread(
        target=_calibrate_six_terminals_worker,
        args=(data_dir,),
        kwargs={"trigger": trigger, "changed_by": changed_by, "task_id": task_id},
        daemon=True,
    )
    worker.start()

    return {
        "ok": True,
        "status": "started",
        "taskId": task_id,
        "startedAt": started_at,
        "trigger": trigger,
        "changedBy": changed_by,
        "message": "校准已在后台启动，请 30-90 秒后刷新看板查看结果",
    }


def get_calibrate_six_terminals_status() -> dict[str, Any]:
    """查看后台校准状态。"""
    with _CALIBRATE_SIX_TERMINALS_LOCK:
        state = dict(_CALIBRATE_SIX_TERMINALS_STATE)
    return state
