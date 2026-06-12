"""今日相机教育补代扫归类规则。"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

TARGET_STAFF = {
    "梁伟": "EMP003",
    "郭晨臣": "EMP006",
    "李建定": "EMP005",
}

GROUP_HINTS = ("智店通入库群", "教育补贴群")


@dataclass
class RoutedAgentRecord:
    source_group_name: str
    route_reason: str
    staff_id: str
    staff_name: str
    customer_phone: str
    serial_numbers: list[str]
    order_number: str
    bundle_size: int
    scan_type: str


def normalize_phone(value: str | None) -> str:
    digits = re.sub(r"\D+", "", value or "")
    return digits[-11:] if len(digits) >= 11 else digits


def extract_serial_numbers(text: str) -> list[str]:
    return sorted(set(re.findall(r"\b[A-Z0-9]{8,20}\b", text or "")))


def extract_customer_phone(text: str) -> str:
    matched = re.search(r"(1[3-9]\d{9})", text or "")
    return normalize_phone(matched.group(1) if matched else "")


def extract_order_number(text: str) -> str:
    matched = re.search(r"(XS\d{8,})", text or "", re.IGNORECASE)
    return matched.group(1).upper() if matched else ""


def detect_group_hint(text: str) -> str:
    for group_name in GROUP_HINTS:
        if group_name in (text or ""):
            return group_name
    return ""


def detect_bundle_size(text: str, serial_numbers: list[str]) -> int:
    text = text or ""
    if "三件套" in text:
        return 3
    if "二件套" in text or "两件套" in text:
        return 2
    if len(serial_numbers) >= 3:
        return 3
    if len(serial_numbers) == 2:
        return 2
    return 1


def detect_scan_type(bundle_size: int) -> str:
    if bundle_size >= 3:
        return "three_piece"
    if bundle_size == 2:
        return "two_piece"
    return "single_scan"


def route_record(user_name: str, watermark_text: str, extracted: dict[str, Any] | None = None) -> RoutedAgentRecord | None:
    extracted = extracted or {}
    if not any(name in (user_name or "") for name in TARGET_STAFF):
        return None
    if "教育补" not in (watermark_text or "") and "代扫" not in (watermark_text or ""):
        return None
    serial_numbers = extracted.get("serial_numbers") or extract_serial_numbers(watermark_text)
    customer_phone = normalize_phone(extracted.get("customer_phone") or extract_customer_phone(watermark_text))
    order_number = extract_order_number(watermark_text)
    group_hint = detect_group_hint(watermark_text)
    bundle_size = detect_bundle_size(watermark_text, serial_numbers)
    scan_type = detect_scan_type(bundle_size)

    staff_name = next(name for name in TARGET_STAFF if name in (user_name or ""))
    staff_id = TARGET_STAFF[staff_name]
    if group_hint:
        return RoutedAgentRecord(group_hint, "文本显式带群名", staff_id, staff_name, customer_phone, serial_numbers, order_number, bundle_size, scan_type)
    if bundle_size >= 3 and customer_phone:
        return RoutedAgentRecord("智店通入库群", "同手机号三件套默认归智店通口径", staff_id, staff_name, customer_phone, serial_numbers, order_number, bundle_size, scan_type)
    return RoutedAgentRecord("教育补贴群", "默认单扫教育补归教育补口径", staff_id, staff_name, customer_phone, serial_numbers, order_number, bundle_size, scan_type)


def build_bundle_groups(records: list[RoutedAgentRecord]) -> dict[str, list[RoutedAgentRecord]]:
    grouped: dict[str, list[RoutedAgentRecord]] = {}
    phone_counter = Counter(record.customer_phone for record in records if record.customer_phone)
    for record in records:
        key = record.customer_phone or record.order_number or ",".join(record.serial_numbers) or record.staff_name
        grouped.setdefault(key, []).append(record)
    for group_key, group_records in grouped.items():
        if not group_key:
            continue
        if phone_counter.get(group_key, 0) >= 3:
            for record in group_records:
                record.source_group_name = "智店通入库群"
                record.route_reason = "同手机号累计达到三件套"
                record.bundle_size = max(record.bundle_size, 3)
                record.scan_type = "three_piece"
    return grouped
