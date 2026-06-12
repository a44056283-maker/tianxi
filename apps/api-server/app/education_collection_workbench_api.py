from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from app import retail_core
from app.collection_bridge_api import (
    _derive_record_unit_key_from_row,
    _is_test_like_record,
    _normalize_phone,
    _resolve_bundle_scan_type_from_unit_count,
)

router = APIRouter(prefix="/api/education-collection", tags=["education-collection-workbench"])

PROJECT_ROOT = Path(__file__).resolve().parents[3]
WEB_DATA_DIR = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data"
DB_PATH = Path(__file__).parent.parent / "data" / "retail-core.sqlite3"
SERVICE_PRODUCT_KEYWORDS = ("lenovo care", "智惠", "延保", "保修", "服务", "保险", "会员")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _read_json(name: str, default: Any) -> Any:
    path = WEB_DATA_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _summary_value(payload: dict[str, Any], key: str, default: Any = 0) -> Any:
    if not isinstance(payload, dict):
        return default
    if key in payload and payload.get(key) not in (None, ""):
        return payload.get(key)
    nested = payload.get("summary")
    if isinstance(nested, dict) and nested.get(key) not in (None, ""):
        return nested.get(key)
    return default


def _date_part(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "T" in text:
        return text.split("T", 1)[0]
    if " " in text:
        return text.split(" ", 1)[0]
    return text[:10]


def _parse_raw_metadata(row: sqlite3.Row) -> dict[str, Any]:
    raw_payload = {}
    raw_text = row["raw_payload_json"] if "raw_payload_json" in row.keys() else ""
    if raw_text:
        try:
            raw_payload = json.loads(raw_text)
        except Exception:
            raw_payload = {}
    metadata = raw_payload.get("metadata") if isinstance(raw_payload, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _infer_source_type(row: sqlite3.Row, metadata: dict[str, Any]) -> str:
    source_type = str(metadata.get("sourceType") or "").strip()
    if source_type:
        return source_type
    source_file = str(row["source_file"] or "").strip()
    if source_file.startswith("manual://wechat/"):
        return "wechat_group_manual"
    if source_file.startswith("manual://xhey-api/") or "xhey_api" in source_file:
        return "xhey_api_manual"
    if "watermark" in source_file or "xhey_web_folder" in source_file:
        return "watermark_camera_manual"
    return "sql_manual_import"


def _infer_collection_source(row: sqlite3.Row, metadata: dict[str, Any]) -> str:
    collection_source = str(metadata.get("collectionSource") or "").strip()
    if collection_source:
        return collection_source
    source_file = str(row["source_file"] or "").strip()
    if source_file.startswith("manual://wechat/"):
        return "wechat_group"
    return str(row["source_group_name"] or "").strip() or "unknown"


def _is_test_record(row: sqlite3.Row, metadata: dict[str, Any]) -> bool:
    source_file = str(row["source_file"] or "").strip().lower()
    client_tag = str(metadata.get("clientTag") or "").strip().lower()
    photo_id = str(metadata.get("photoId") or "").strip().lower()
    customer_phone = str(row["customer_phone"] or "").strip()
    serial_numbers: list[str] = []
    try:
        loaded = json.loads(row["serial_numbers_json"] or "[]")
        if isinstance(loaded, list):
            serial_numbers = [str(item or "").strip().upper() for item in loaded if str(item or "").strip()]
    except Exception:
        serial_numbers = []
    return (
        "test-bridge" in source_file
        or "debug-cli" in source_file
        or source_file.startswith("cli://test")
        or client_tag.startswith("test-")
        or photo_id.startswith("test-")
        or str(row["record_id"] or "").startswith("test-")
        or (str(row["record_id"] or "").startswith("watermark-cam-test") or str(row["record_id"] or "").startswith("watermark-cam-debug"))
        or customer_phone == "13812345678"
        or "SN1234ABCD" in serial_numbers
    )


def _is_service_filtered_record(metadata: dict[str, Any]) -> bool:
    return bool(metadata.get("serviceMatchFiltered") or metadata.get("nonBillableEvidenceOnly") or metadata.get("non_billable_evidence_only") in (True, "true", "1"))


def _is_service_like_name(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    return any(keyword in text for keyword in SERVICE_PRODUCT_KEYWORDS)


def _row_has_billable_unit(row: sqlite3.Row, serial_numbers: list[Any]) -> bool:
    if serial_numbers:
        return True
    return bool(
        str(row["product_name"] or "").strip()
        or str(row["sku_key"] or "").strip()
        or str(row["pn_mtm"] or "").strip()
        or str(row["order_number"] or "").strip()
        or str(row["voucher_code"] or "").strip()
    )


def _build_gap_backlog(gap_payload: dict[str, Any], since_date: str) -> dict[str, Any]:
    items = gap_payload.get("items") if isinstance(gap_payload, dict) else []
    if not isinstance(items, list):
        items = []
    filtered = []
    by_date: Counter[str] = Counter()
    by_group: Counter[str] = Counter()
    for item in items:
        if not isinstance(item, dict):
            continue
        if _is_service_like_name(item.get("productName")):
            continue
        operate_day = _date_part(item.get("operateTime"))
        if since_date and operate_day and operate_day < since_date:
            continue
        filtered.append(item)
        if operate_day:
            by_date[operate_day] += 1
        by_group[str(item.get("sourceGroupName") or "未分组")] += 1
    return {
        "gapCount": len(filtered),
        "dateBuckets": [
            {"date": day, "count": count}
            for day, count in sorted(by_date.items(), reverse=True)
        ],
        "groupBuckets": [
            {"sourceGroupName": group_name, "count": count}
            for group_name, count in by_group.most_common()
        ],
        "samples": filtered[:12],
    }


@router.get("/workbench")
def get_workbench(
    since_date: str = Query("2026-06-06"),
    recent_limit: int = Query(80, ge=20, le=400),
) -> dict[str, Any]:
    if not isinstance(since_date, str) or not since_date:
        since_date = "2026-06-06"
    if not isinstance(recent_limit, int):
        recent_limit = 80
    projection = retail_core.list_education_agent_scan_summary(limit=4000)
    projection_file_summary = _read_json("latest-education-subsidy-agent-scan-summary.json", {})
    gap_payload = _read_json("latest-education-agent-scan-sync-gap.json", {})
    failure_queue = _read_json("latest-local-sync-failure-queue.json", {})

    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT record_id, scan_date, scan_timestamp, source_group_name, scan_type,
                   staff_id, staff_name, customer_name, customer_phone, agent_phone, order_number,
                   serial_numbers_json, sync_status, review_status, report_status,
                   status, total_service_fee, total_education_discount_amount,
                   source_file, raw_payload_json, created_at, updated_at,
                   voucher_code, product_name, sku_key, pn_mtm, id
            FROM education_scan_record_v2
            WHERE scan_date >= ?
            ORDER BY created_at DESC, id DESC
            """,
            (since_date,),
        ).fetchall()
    finally:
        conn.close()

    recent_records: list[dict[str, Any]] = []
    source_counter: Counter[str] = Counter()
    source_latest: dict[str, str] = {}
    batch_map: dict[tuple[str, str, str], dict[str, Any]] = {}
    date_counter: Counter[str] = Counter()
    sql_source_types: set[str] = set()
    sql_dates: set[str] = set()
    sql_cli_count = 0
    sql_group_counter: Counter[str] = Counter()
    sql_service_filtered_count = 0
    active_total_count = 0
    active_paid_count = 0
    active_unpaid_count = 0
    active_total_service_fee = 0.0
    active_total_discount_amount = 0.0
    active_group_summary: dict[str, dict[str, Any]] = {}
    latest_scan_date = ""
    latest_education_group_scan_date = ""
    latest_inbound_group_scan_date = ""
    phone_bundle_map: dict[str, dict[str, Any]] = {}

    for row in rows:
        metadata = _parse_raw_metadata(row)
        if _is_test_record(row, metadata):
            continue
        if _is_service_filtered_record(metadata):
            sql_service_filtered_count += 1
            continue
        source_type = _infer_source_type(row, metadata)
        collection_source = _infer_collection_source(row, metadata)
        serial_numbers = []
        try:
            serial_numbers = json.loads(row["serial_numbers_json"] or "[]")
        except Exception:
            serial_numbers = []
        if not isinstance(serial_numbers, list):
            serial_numbers = []
        if not _row_has_billable_unit(row, serial_numbers):
            sql_service_filtered_count += 1
            continue
        created_at = str(row["created_at"] or row["updated_at"] or row["scan_timestamp"] or "")
        scan_date = str(row["scan_date"] or "")
        batch_key = (scan_date or "", source_type, collection_source)
        batch = batch_map.setdefault(
            batch_key,
            {
                "batchKey": f"{scan_date}:{source_type}:{collection_source}",
                "scanDate": scan_date,
                "sourceType": source_type,
                "collectionSource": collection_source,
                "recordCount": 0,
                "successCount": 0,
                "partialCount": 0,
                "pendingReviewCount": 0,
                "latestCreatedAt": "",
                "staffIds": set(),
                "sourceGroupNames": set(),
            },
        )
        batch["recordCount"] += 1
        if str(row["sync_status"] or "") == "success":
            batch["successCount"] += 1
        else:
            batch["partialCount"] += 1
        if str(row["review_status"] or "") in ("pending", "", "local"):
            batch["pendingReviewCount"] += 1
        if created_at > batch["latestCreatedAt"]:
            batch["latestCreatedAt"] = created_at
        if row["staff_id"]:
            batch["staffIds"].add(str(row["staff_id"]))
        if row["source_group_name"]:
            batch["sourceGroupNames"].add(str(row["source_group_name"]))

        record = {
            "recordId": row["record_id"],
            "scanDate": scan_date,
            "createdAt": created_at,
            "staffId": row["staff_id"],
            "staffName": row["staff_name"],
            "sourceGroupName": row["source_group_name"],
            "collectionSource": collection_source,
            "sourceType": source_type,
            "scanType": row["scan_type"],
            "customerName": row["customer_name"] or "",
            "customerPhone": row["customer_phone"] or "",
            "orderNumber": row["order_number"] or "",
            "serialNumbers": [str(item).strip() for item in serial_numbers if str(item).strip()],
            "syncStatus": row["sync_status"] or "",
            "reviewStatus": row["review_status"] or "",
            "reportStatus": row["report_status"] or "",
            "photoId": str(metadata.get("photoId") or ""),
            "mediaUrl": str(metadata.get("mediaUrl") or ""),
            "takenAt": str(metadata.get("takenAt") or ""),
            "watermark": str(metadata.get("watermark") or ""),
            "sourceFile": row["source_file"] or "",
        }
        recent_records.append(record)
        active_total_count += 1
        if str(row["status"] or "") == "已付":
            active_paid_count += 1
        else:
            active_unpaid_count += 1
        active_total_service_fee += float(row["total_service_fee"] or 0)
        active_total_discount_amount += float(row["total_education_discount_amount"] or 0)
        source_counter[source_type] += 1
        sql_source_types.add(source_type)
        if source_type == "watermark_camera_manual":
            sql_cli_count += 1
        group_name = str(row["source_group_name"] or "未分组")
        sql_group_counter[group_name] += 1
        group_summary = active_group_summary.setdefault(
            group_name,
            {
                "sourceGroupName": group_name,
                "totalCount": 0,
                "paidCount": 0,
                "unpaidCount": 0,
                "totalServiceFee": 0.0,
            },
        )
        group_summary["totalCount"] += 1
        if str(row["status"] or "") == "已付":
            group_summary["paidCount"] += 1
        else:
            group_summary["unpaidCount"] += 1
        group_summary["totalServiceFee"] += float(row["total_service_fee"] or 0)
        if created_at and created_at > source_latest.get(source_type, ""):
            source_latest[source_type] = created_at
        if scan_date:
            date_counter[scan_date] += 1
            sql_dates.add(scan_date)
            latest_scan_date = max(latest_scan_date, scan_date)
            if group_name == "教育补贴群":
                latest_education_group_scan_date = max(latest_education_group_scan_date, scan_date)
            if group_name == "智店通入库群":
                latest_inbound_group_scan_date = max(latest_inbound_group_scan_date, scan_date)

        bundle_phone = _normalize_phone(row["customer_phone"] or row["agent_phone"] or metadata.get("agentPhone") or "")
        if bundle_phone and not _is_test_like_record(row, metadata):
            bundle_entry = phone_bundle_map.setdefault(
                bundle_phone,
                {
                    "phone": bundle_phone,
                    "customerNames": set(),
                    "currentScanTypes": set(),
                    "sourceGroups": set(),
                    "unitKeys": set(),
                    "records": [],
                },
            )
            if row["customer_name"]:
                bundle_entry["customerNames"].add(str(row["customer_name"]))
            if row["scan_type"]:
                bundle_entry["currentScanTypes"].add(str(row["scan_type"]))
            if row["source_group_name"]:
                bundle_entry["sourceGroups"].add(str(row["source_group_name"]))
            unit_key = _derive_record_unit_key_from_row(row)
            if unit_key:
                bundle_entry["unitKeys"].add(unit_key)
            bundle_entry["records"].append(
                {
                    "recordId": row["record_id"],
                    "scanDate": scan_date,
                    "scanType": row["scan_type"] or "",
                    "sourceGroupName": row["source_group_name"] or "",
                    "skuKey": row["sku_key"] or "",
                    "pnMtm": row["pn_mtm"] or "",
                    "productName": row["product_name"] or "",
                    "orderNumber": row["order_number"] or "",
                }
            )

    batch_rows = []
    for item in batch_map.values():
        batch_rows.append(
            {
                **item,
                "staffIds": sorted(item["staffIds"]),
                "sourceGroupNames": sorted(item["sourceGroupNames"]),
            }
        )
    batch_rows.sort(key=lambda item: (item["scanDate"], item["latestCreatedAt"]), reverse=True)

    gap_backlog = _build_gap_backlog(gap_payload, since_date)
    sql_projection_summary = {
        "totalCount": active_total_count,
        "paidCount": active_paid_count,
        "unpaidCount": active_unpaid_count,
        "totalServiceFee": active_total_service_fee,
        "totalEducationDiscountAmount": active_total_discount_amount,
    }
    projection_summary_source = (
        projection_file_summary
        if isinstance(projection_file_summary, dict) and projection_file_summary.get("rows")
        else projection
    )
    projection_group_summaries = (
        projection_summary_source.get("groupSummaries")
        if isinstance(projection_summary_source, dict)
        else None
    )
    if not isinstance(projection_group_summaries, list) or not projection_group_summaries:
        projection_group_summaries = sorted(
            active_group_summary.values(),
            key=lambda item: (-int(item["totalCount"]), str(item["sourceGroupName"])),
        )
    projection_summary = {
        "totalCount": int(_summary_value(projection_summary_source, "totalCount", sql_projection_summary["totalCount"]) or sql_projection_summary["totalCount"]),
        "paidCount": int(_summary_value(projection_summary_source, "paidCount", sql_projection_summary["paidCount"]) or sql_projection_summary["paidCount"]),
        "unpaidCount": int(_summary_value(projection_summary_source, "unpaidCount", sql_projection_summary["unpaidCount"]) or sql_projection_summary["unpaidCount"]),
        "totalServiceFee": float(_summary_value(projection_summary_source, "totalServiceFee", sql_projection_summary["totalServiceFee"]) or sql_projection_summary["totalServiceFee"]),
        "unpaidServiceFee": float(
            _summary_value(
                projection_summary_source,
                "unpaidServiceFee",
                sum(float(item.get("unpaidServiceFee") or 0) for item in projection_group_summaries or []),
            ) or sum(float(item.get("unpaidServiceFee") or 0) for item in projection_group_summaries or [])
        ),
        "totalEducationDiscountAmount": float(
            _summary_value(
                projection_summary_source,
                "totalEducationDiscountAmount",
                sql_projection_summary["totalEducationDiscountAmount"],
            ) or sql_projection_summary["totalEducationDiscountAmount"]
        ),
        "totalZhixiangjinAmount": float(
            _summary_value(projection_summary_source, "totalZhixiangjin", 0)
            or _summary_value(projection_summary_source, "totalZhixiangjinAmount", 0)
            or 0
        ),
    }
    phone_alerts = (
        projection_summary_source.get("phoneMismatchAlerts")
        if isinstance(projection_summary_source, dict)
        else []
    )
    if not isinstance(phone_alerts, list):
        phone_alerts = []
    failure_items = failure_queue.get("items") if isinstance(failure_queue, dict) else []
    if not isinstance(failure_items, list):
        failure_items = []
    education_failures = [
        item for item in failure_items
        if "教育补" in str(item.get("detail") or "") or "today_camera_education_agent_scan" in str(item.get("step") or "")
    ]

    source_breakdown = [
        {
            "sourceType": source_type,
            "count": count,
            "latestCreatedAt": source_latest.get(source_type, ""),
        }
        for source_type, count in source_counter.most_common()
    ]

    start_day = date.fromisoformat(since_date)
    today = datetime.now().date()
    timeline = []
    cursor = start_day
    while cursor <= today:
        day = cursor.isoformat()
        timeline.append(
            {
                "date": day,
                "recordCount": int(date_counter.get(day, 0)),
                "gapCount": next((int(item["count"]) for item in gap_backlog["dateBuckets"] if item["date"] == day), 0),
            }
        )
        cursor += timedelta(days=1)

    phone_bundle_candidates = []
    for entry in phone_bundle_map.values():
        unit_count = len(entry["unitKeys"])
        if unit_count < 2:
            continue
        recommended_scan_type = _resolve_bundle_scan_type_from_unit_count(unit_count)
        phone_bundle_candidates.append(
            {
                "phone": entry["phone"],
                "customerNames": sorted(entry["customerNames"]),
                "unitCount": unit_count,
                "recordCount": len(entry["records"]),
                "currentScanTypes": sorted(entry["currentScanTypes"]),
                "recommendedScanType": recommended_scan_type,
                "sourceGroups": sorted(entry["sourceGroups"]),
                "records": sorted(entry["records"], key=lambda item: (item["scanDate"], item["recordId"])),
            }
        )
    phone_bundle_candidates.sort(key=lambda item: (-int(item["unitCount"]), -int(item["recordCount"]), str(item["phone"])))

    return {
        "generatedAt": datetime.now().isoformat(),
        "sinceDate": since_date,
        "overview": {
            "projectionTotalCount": int(projection_summary.get("totalCount") or 0),
            "projectionPaidCount": int(projection_summary.get("paidCount") or 0),
            "projectionUnpaidCount": int(projection_summary.get("unpaidCount") or 0),
            "projectionTotalServiceFee": float(projection_summary.get("totalServiceFee") or 0),
            "projectionTotalEducationDiscountAmount": float(projection_summary.get("totalEducationDiscountAmount") or 0),
            "sqlRecordCountSinceDate": active_total_count,
            "sqlCliRecordCountSinceDate": sql_cli_count,
            "sqlEducationGroupCountSinceDate": int(sql_group_counter.get("教育补贴群", 0)),
            "sqlInboundGroupCountSinceDate": int(sql_group_counter.get("智店通入库群", 0)),
            "sqlServiceFilteredCountSinceDate": sql_service_filtered_count,
            "gapCountSinceDate": int(gap_backlog["gapCount"]),
            "phoneMismatchCount": len(phone_alerts),
            "recentRecordCount": len(recent_records),
        },
        "projection": {
            "generatedAt": datetime.now().isoformat(),
            "latestScanDate": latest_scan_date,
            "latestEducationGroupScanDate": latest_education_group_scan_date,
            "latestInboundGroupScanDate": latest_inbound_group_scan_date,
            "summary": projection_summary or {},
            "groupSummaries": projection_group_summaries,
        },
        "sourceBreakdown": source_breakdown,
        "batches": batch_rows[:30],
        "recentRecords": recent_records[:recent_limit],
        "gapBacklog": gap_backlog,
        "timeline": timeline,
        "phoneMismatchAlerts": phone_alerts[:20],
        "phoneBundleCandidates": phone_bundle_candidates[:20],
        "educationFailures": education_failures[:10],
        "workflow": {
            "channels": [
                {"key": "watermark_camera_manual", "label": "网页分类文件夹 CLI 主链"},
                {"key": "xhey_api_manual", "label": "今日相机 API 待恢复链"},
                {"key": "wechat_group_manual", "label": "旧微信群历史数据"},
            ],
            "bundleRules": [
                "同手机号累计 1 个有效商品/设备单元 = single_scan，归教育补贴群。",
                "同手机号累计 2 个不同有效商品/设备单元 = two_piece，归智店通入库群。",
                "同手机号累计 3 个及以上不同有效商品/设备单元 = three_piece，归智店通入库群。",
                "同手机号后续再补进一台不同电脑或其他商品时，即使不是同一单、同一批或同一天出库，也要整组升级套数。",
                "图片或文件夹显式带群名时，优先按指定群名归类。",
                "智惠/延保/保险/会员等服务类商品不是教育补机器，不参与产品销售归属；命中时只保留代扫证据，不记成教育补产品。",
                "代扫闭环以真实实物 PO 出库机器为准，必须能落到带电话的截图证据；无法确认机器实物归属的记录进入人工复核。",
            ],
        },
    }
