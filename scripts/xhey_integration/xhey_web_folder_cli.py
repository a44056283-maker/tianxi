#!/usr/bin/env python3
"""今日相机网页分类文件夹 CLI。

链路：
网页端分类文件夹导出 ZIP / 本地目录 / 直链 URL
-> 解压/整理
-> OCR 提取文本
-> 教育补规则归类
-> Bridge API
-> SQL
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from watermark_classifier import classify, Classification  # noqa: E402
from xhey_pull_worker import BRIDGE_BASE, BRIDGE_TOKEN, PHOTO_BASE_DIR, _post_bridge_file  # noqa: E402

TARGET_STAFF = {"梁伟", "郭晨臣", "李建定"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_EXTRACT_DIR = Path("/tmp/xhey_web_folder_cli")
DEFAULT_REPORT_DIR = Path("/Volumes/TianLu_Storage/Shared/今日水印相机/reports")
DEFAULT_REGISTRY_FILE = DEFAULT_REPORT_DIR / "xhey-web-folder-cli-registry.json"
OCR_URL = os.environ.get("LOCAL_OCR_URL", "http://127.0.0.1:8765/ocr/extract")
DRY_RUN = os.environ.get("XHEY_DRY_RUN", "false").lower() in ("1", "true", "yes")
PHONE_CONTEXT_KEYWORDS = ("电话", "手机号", "联系电话", "手机号码", "客户电话")
ORDER_CONTEXT_KEYWORDS = ("订单", "单号", "核销", "券", "优惠", "教育补", "教育优惠")
IDENTITY_CONTEXT_KEYWORDS = ("公民身份号码", "居民身份证", "身份证号码")
TIME_CLUSTER_SECONDS = 240
BLOCKED_CUSTOMER_NAMES = {
    "今日水印",
    "联想",
    "中国制造",
    "星期四",
    "星期六",
    "心理咨询",
    "新野",
    "高德地图",
    "公安局",
    "百脑汇商贸有限公司",
    "联想体验店",
    "体验店",
    "便利店",
    "管理中心",
}


@dataclass
class FolderPhoto:
    photo_id: str
    user_id: str
    user_name: str
    taken_at: int
    watermark_text: str
    media_url: str
    extra: dict[str, Any]


@dataclass
class WebFolderCandidate:
    image_path: Path
    original_folder: str
    staff_name: str
    classification: Classification
    extracted: dict[str, Any]
    watermark_text: str
    group_key: str
    customer_phone: str
    product_keys: list[str]
    taken_at: int
    photo_date: str
    has_customer_evidence: bool
    fingerprint: str


@dataclass
class PhoneBundleStats:
    evidence_count: int
    distinct_product_count: int


def _now_cn() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat()


def _compute_file_fingerprint(image_path: Path) -> str:
    digest = hashlib.sha1()
    digest.update(str(image_path.name).encode("utf-8"))
    with image_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _load_registry(registry_file: Path) -> dict[str, Any]:
    def is_formally_processed(entry: dict[str, Any]) -> bool:
        record_id = str(entry.get("recordId") or entry.get("record_id") or "").strip()
        bridge_status = str(entry.get("bridgeStatus") or entry.get("bridge_status") or "").strip().lower()
        if not record_id or record_id.startswith("DRY-"):
            return False
        return bridge_status not in {"", "dry_run"}

    def bootstrap_from_reports() -> dict[str, Any]:
        report_dir = registry_file.parent
        processed_paths: dict[str, Any] = {}
        if report_dir.exists():
            for report_file in sorted(report_dir.glob("xhey-web-folder-cli-report-*.json")):
                try:
                    payload = json.loads(report_file.read_text())
                except Exception:
                    continue
                if bool(payload.get("dryRun")):
                    continue
                for item in payload.get("results", []):
                    if item.get("status") != "processed":
                        continue
                    file_path = str(item.get("file") or "").strip()
                    if not file_path:
                        continue
                    bridge_resp = item.get("bridge_resp") or {}
                    candidate_entry = {
                        "recordId": bridge_resp.get("record_id") or bridge_resp.get("recordId") or "",
                        "bridgeStatus": bridge_resp.get("status") or "",
                        "savedAt": str(payload.get("generatedAt") or ""),
                    }
                    if not is_formally_processed(candidate_entry):
                        continue
                    processed_paths[file_path] = candidate_entry
        return {"processedFingerprints": {}, "processedPaths": processed_paths, "updatedAt": ""}

    if not registry_file.exists():
        return bootstrap_from_reports()
    try:
        payload = json.loads(registry_file.read_text())
    except Exception:
        return bootstrap_from_reports()
    if not isinstance(payload, dict):
        return bootstrap_from_reports()
    processed = payload.get("processedFingerprints")
    if not isinstance(processed, dict):
        processed = {}
    processed_paths = payload.get("processedPaths")
    if not isinstance(processed_paths, dict):
        processed_paths = {}
    processed = {
        key: value
        for key, value in processed.items()
        if isinstance(value, dict) and is_formally_processed(value)
    }
    processed_paths = {
        key: value
        for key, value in processed_paths.items()
        if isinstance(value, dict) and is_formally_processed(value)
    }
    return {
        "processedFingerprints": processed,
        "processedPaths": processed_paths,
        "updatedAt": str(payload.get("updatedAt") or ""),
    }


def _save_registry(registry_file: Path, registry: dict[str, Any]) -> None:
    registry_file.parent.mkdir(parents=True, exist_ok=True)
    registry["updatedAt"] = _now_cn()
    registry_file.write_text(json.dumps(registry, ensure_ascii=False, indent=2))


def _safe_name(value: str) -> str:
    return value.replace("/", "_").replace("\\", "_").strip() or "unknown"


def _download_zip(download_url: str, workdir: Path) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    target = workdir / "xhey-web-folder-export.zip"
    with urllib.request.urlopen(download_url, timeout=60) as response:
        target.write_bytes(response.read())
    return target


def _prepare_input(args: argparse.Namespace) -> tuple[Path, Path]:
    extract_root = Path(args.extract_dir).expanduser().resolve()
    if args.download_url:
        zip_path = _download_zip(args.download_url, extract_root)
        return zip_path, extract_root
    if args.zip_path:
        return Path(args.zip_path).expanduser().resolve(), extract_root
    if args.directory:
        return Path(args.directory).expanduser().resolve(), extract_root
    raise ValueError("必须提供 --download-url / --zip-path / --directory 其中之一")


def _extract_if_needed(input_path: Path, extract_root: Path) -> Path:
    if input_path.is_dir():
        return input_path
    if input_path.suffix.lower() != ".zip":
        raise ValueError(f"不支持的输入文件: {input_path}")
    target_dir = extract_root / input_path.stem
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(input_path) as zf:
        zf.extractall(target_dir)
    return target_dir


def _iter_image_files(root_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in root_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def _detect_staff_name(path: Path) -> str:
    for part in path.parts:
        if part in TARGET_STAFF:
            return part
    return ""


def _ocr_extract(image_path: Path) -> dict[str, Any]:
    boundary = "----XheyWebFolderCliBoundary"
    body_head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"\r\n'
        f"Content-Type: {mimetypes.guess_type(image_path.name)[0] or 'image/jpeg'}\r\n\r\n"
    ).encode("utf-8")
    body_tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    payload = body_head + image_path.read_bytes() + body_tail
    request = urllib.request.Request(
        OCR_URL,
        data=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _build_watermark_text(ocr_payload: dict[str, Any]) -> str:
    lines = ocr_payload.get("lines") or []
    texts = [str(line.get("text") or "").strip() for line in lines if str(line.get("text") or "").strip()]
    return "\n".join(texts)


def _parse_taken_at_from_filename(image_path: Path) -> int:
    match = re.search(r"(20\d{2})_(\d{2})_(\d{2}) (\d{2})_(\d{2})_(\d{2})", image_path.name)
    if not match:
        return int(image_path.stat().st_mtime)
    year, month, day, hour, minute, second = map(int, match.groups())
    dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone(timedelta(hours=8)))
    return int(dt.timestamp())


def _parse_photo_date(image_path: Path) -> str:
    match = re.search(r"(20\d{2})_(\d{2})_(\d{2}) ", image_path.name)
    if not match:
        timestamp = _parse_taken_at_from_filename(image_path)
        return datetime.fromtimestamp(timestamp, tz=timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
    year, month, day = match.groups()
    return f"{year}-{month}-{day}"


def _build_photo(image_path: Path, staff_name: str, watermark_text: str) -> FolderPhoto:
    digest = hashlib.sha1(str(image_path).encode("utf-8")).hexdigest()
    return FolderPhoto(
        photo_id=f"web-{digest[:20]}",
        user_id=f"web-folder-{staff_name or 'unknown'}",
        user_name=staff_name or "unknown",
        taken_at=_parse_taken_at_from_filename(image_path),
        watermark_text=watermark_text,
        media_url=str(image_path),
        extra={"sourcePath": str(image_path)},
    )


def _normalize_phone(value: Any) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        return digits
    return ""


def _normalize_serial_numbers(extracted: dict[str, Any]) -> list[str]:
    serials = extracted.get("serial_numbers") or []
    if not serials and extracted.get("serialNumber"):
        serials = [extracted["serialNumber"]]
    normalized = []
    for item in serials:
        value = str(item or "").strip().upper()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _meaningful_customer_name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        return ""
    if name in BLOCKED_CUSTOMER_NAMES or name in TARGET_STAFF:
        return ""
    if len(name) < 2 or len(name) > 4:
        return ""
    if any(ch.isdigit() for ch in name):
        return ""
    return name


def _has_identity_signal(extracted: dict[str, Any], watermark_text: str) -> bool:
    customer_name = _meaningful_customer_name(extracted.get("customer_name") or extracted.get("customerName"))
    if not customer_name:
        return False
    if not any(keyword in watermark_text for keyword in IDENTITY_CONTEXT_KEYWORDS):
        return False
    return any(token in watermark_text for token in (f"姓名{customer_name}", f"姓名 {customer_name}", f"姓名\n{customer_name}"))


def _has_order_signal(extracted: dict[str, Any], watermark_text: str) -> bool:
    order_number = str(extracted.get("order_number") or extracted.get("orderNumber") or "").strip()
    voucher_code = str(extracted.get("voucher_code") or extracted.get("voucherCode") or "").strip()
    return bool(order_number or voucher_code or any(keyword in watermark_text for keyword in ORDER_CONTEXT_KEYWORDS))


def _trusted_customer_phone(extracted: dict[str, Any], watermark_text: str) -> str:
    phone = _normalize_phone(extracted.get("customer_phone") or extracted.get("customerPhone"))
    if not phone:
        return ""
    if any(keyword in watermark_text for keyword in PHONE_CONTEXT_KEYWORDS):
        return phone
    if _has_order_signal(extracted, watermark_text):
        return phone
    return ""


def _has_customer_evidence(extracted: dict[str, Any], watermark_text: str) -> bool:
    return bool(
        _trusted_customer_phone(extracted, watermark_text)
        or _has_identity_signal(extracted, watermark_text)
        or _has_order_signal(extracted, watermark_text)
    )


def _build_group_key(extracted: dict[str, Any], watermark_text: str) -> str:
    phone = _trusted_customer_phone(extracted, watermark_text)
    if phone:
        return f"phone:{phone}"
    order_number = str(extracted.get("order_number") or extracted.get("orderNumber") or "").strip().upper()
    if order_number:
        return f"order:{order_number}"
    customer_name = _meaningful_customer_name(extracted.get("customer_name") or extracted.get("customerName"))
    if _has_identity_signal(extracted, watermark_text) and customer_name:
        return f"name:{customer_name}"
    return ""


def _build_product_keys(extracted: dict[str, Any]) -> list[str]:
    serials = _normalize_serial_numbers(extracted)
    if serials:
        return [f"sn:{serial}" for serial in serials]
    return []


def _is_candidate_evidence(extracted: dict[str, Any], watermark_text: str) -> bool:
    return _has_customer_evidence(extracted, watermark_text)


def _build_phone_bundle_stats(candidates: list[WebFolderCandidate]) -> dict[str, PhoneBundleStats]:
    counters: dict[str, Counter[str]] = {}
    evidence_counter: Counter[str] = Counter()
    for candidate in candidates:
        if not candidate.customer_phone:
            continue
        evidence_counter[candidate.customer_phone] += 1
        bucket = counters.setdefault(candidate.customer_phone, Counter())
        for product_key in candidate.product_keys:
            bucket[product_key] += 1
    stats: dict[str, PhoneBundleStats] = {}
    for phone, product_counter in counters.items():
        stats[phone] = PhoneBundleStats(
            evidence_count=evidence_counter[phone],
            distinct_product_count=len(product_counter),
        )
    return stats


def _cluster_candidates(candidates: list[WebFolderCandidate]) -> list[list[WebFolderCandidate]]:
    grouped: dict[tuple[str, str], list[WebFolderCandidate]] = {}
    for candidate in candidates:
      grouped.setdefault((candidate.staff_name, candidate.photo_date), []).append(candidate)
    clusters: list[list[WebFolderCandidate]] = []
    for _, rows in grouped.items():
      rows.sort(key=lambda item: (item.taken_at, str(item.image_path)))
      current: list[WebFolderCandidate] = []
      for item in rows:
        if not current:
          current = [item]
          continue
        if item.taken_at - current[-1].taken_at <= TIME_CLUSTER_SECONDS:
          current.append(item)
          continue
        clusters.append(current)
        current = [item]
      if current:
        clusters.append(current)
    return clusters


def _merge_cluster_evidence(candidates: list[WebFolderCandidate]) -> list[dict[str, Any] | WebFolderCandidate]:
    results: list[dict[str, Any] | WebFolderCandidate] = []
    for cluster in _cluster_candidates(candidates):
        donor_phone = ""
        donor_order = ""
        donor_name = ""
        donor_agent_phone = ""
        for item in cluster:
            extracted = item.extracted
            donor_phone = donor_phone or _trusted_customer_phone(extracted, item.watermark_text)
            donor_order = donor_order or str(extracted.get("order_number") or extracted.get("orderNumber") or "").strip().upper()
            donor_name = donor_name or _meaningful_customer_name(extracted.get("customer_name") or extracted.get("customerName"))
            donor_agent_phone = donor_agent_phone or _normalize_phone(extracted.get("agent_phone") or extracted.get("agentPhone"))
        for item in cluster:
            merged_extracted = dict(item.extracted)
            if not _has_customer_evidence(merged_extracted, item.watermark_text):
                if donor_phone and not merged_extracted.get("customer_phone") and not merged_extracted.get("customerPhone"):
                    merged_extracted["customer_phone"] = donor_phone
                if donor_order and not merged_extracted.get("order_number") and not merged_extracted.get("orderNumber"):
                    merged_extracted["order_number"] = donor_order
                if donor_name and not merged_extracted.get("customer_name") and not merged_extracted.get("customerName"):
                    merged_extracted["customer_name"] = donor_name
                if donor_agent_phone and not merged_extracted.get("agent_phone") and not merged_extracted.get("agentPhone"):
                    merged_extracted["agent_phone"] = donor_agent_phone
            merged = WebFolderCandidate(
                image_path=item.image_path,
                original_folder=item.original_folder,
                staff_name=item.staff_name,
                classification=item.classification,
                extracted=merged_extracted,
                watermark_text=item.watermark_text,
                group_key=_build_group_key(merged_extracted, item.watermark_text),
                customer_phone=_trusted_customer_phone(merged_extracted, item.watermark_text),
                product_keys=_build_product_keys(merged_extracted),
                taken_at=item.taken_at,
                photo_date=item.photo_date,
                has_customer_evidence=_has_customer_evidence(merged_extracted, item.watermark_text),
                fingerprint=item.fingerprint,
            )
            if merged.has_customer_evidence:
                results.append(merged)
            else:
                results.append({
                    "status": "skipped",
                    "reason": "未提取到可归组的客户/订单证据",
                    "file": str(item.image_path),
                    "staff_name": item.staff_name,
                    "category": item.classification.category,
                    "watermark_excerpt": item.watermark_text[:240],
                    "extracted": merged_extracted,
                })
    return results


def _route_candidate(candidate: WebFolderCandidate, group_counter: Counter[str], phone_bundle_stats: dict[str, PhoneBundleStats]):
    extracted = candidate.extracted
    phone = candidate.customer_phone
    serials = _normalize_serial_numbers(extracted)
    order_number = str(extracted.get("order_number") or extracted.get("orderNumber") or "").strip().upper()
    hint = ""
    if "智店通入库群" in candidate.watermark_text:
        hint = "智店通入库群"
    elif "教育补贴群" in candidate.watermark_text:
        hint = "教育补贴群"

    evidence_count = group_counter.get(candidate.group_key, 0) if candidate.group_key else 0
    bundle_stats = phone_bundle_stats.get(phone, PhoneBundleStats(evidence_count=0, distinct_product_count=0))
    distinct_product_count = bundle_stats.distinct_product_count
    if hint:
        source_group_name = hint
        route_reason = "网页图像文本显式带群名"
    elif phone and distinct_product_count >= 3:
        source_group_name = "智店通入库群"
        route_reason = "同手机号下不同商品达到三件套"
    elif phone and distinct_product_count >= 2:
        source_group_name = "智店通入库群"
        route_reason = "同手机号下不同商品达到两件套"
    else:
        source_group_name = "教育补贴群"
        route_reason = "单扫教育补证据默认归教育补贴群"

    if distinct_product_count >= 3:
        bundle_size = 3
        scan_type = "three_piece"
    elif distinct_product_count >= 2:
        bundle_size = 2
        scan_type = "two_piece"
    else:
        bundle_size = 1
        scan_type = "single_scan"
    return type(
        "WebFolderRoute",
        (),
        {
            "source_group_name": source_group_name,
            "route_reason": route_reason,
            "staff_id": {"梁伟": "EMP003", "李建定": "EMP005", "郭晨臣": "EMP006"}.get(candidate.staff_name, "unknown"),
            "staff_name": candidate.staff_name,
            "customer_phone": phone,
            "serial_numbers": serials,
            "order_number": order_number,
            "bundle_size": bundle_size,
            "scan_type": scan_type,
            "distinct_product_count": distinct_product_count,
            "evidence_count": evidence_count,
        },
    )()


def _save_local_json(photo: FolderPhoto, classification: Classification, routed, original_folder: str) -> str:
    date_str = tempfile.mktemp()
    _ = date_str
    taken_date = photo.taken_at
    date_folder = Path(PHOTO_BASE_DIR) / Path(
        __import__("datetime").datetime.fromtimestamp(taken_date).strftime("%Y-%m-%d")
    )
    target_dir = date_folder / routed.source_group_name / routed.staff_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{photo.photo_id}.json"
    payload = {
        "photo_id": photo.photo_id,
        "user_id": photo.user_id,
        "user_name": photo.user_name,
        "taken_at": photo.taken_at,
        "watermark_text": photo.watermark_text,
        "category": classification.category,
        "confidence": classification.confidence,
        "extracted": classification.extracted,
        "source_group_name": routed.source_group_name,
        "route_reason": routed.route_reason,
        "customer_phone": routed.customer_phone,
        "serial_numbers": routed.serial_numbers,
        "order_number": routed.order_number,
        "bundle_size": routed.bundle_size,
        "scan_type": routed.scan_type,
        "collection_source": "xhey_web_folder_cli",
        "source_type": "watermark_camera_manual",
        "original_folder": original_folder,
        "source_path": str(photo.media_url),
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    return str(target)


def _submit_bridge(image_path: Path, photo: FolderPhoto, classification: Classification, routed, original_folder: str) -> dict[str, Any]:
    metadata = {
        "staff_id": routed.staff_id,
        "staff_name": routed.staff_name,
        "scan_type": routed.scan_type,
        "source_group": routed.source_group_name,
        "customer_phone": routed.customer_phone,
        "serial_number": routed.serial_numbers[0] if routed.serial_numbers else "",
        "order_number": routed.order_number,
        "notes": f"{routed.route_reason} | original_folder={original_folder}",
        "captured_at": __import__("datetime").datetime.fromtimestamp(photo.taken_at).isoformat(),
        "client_tag": "xhey-web-folder-cli",
        "source_type": "watermark_camera_manual",
        "collection_source": "xhey_web_folder_cli",
        "photo_id": photo.photo_id,
        "media_url": photo.media_url,
        "watermark": photo.watermark_text,
        "taken_at": str(photo.taken_at),
        "extracted": classification.extracted,
    }
    if DRY_RUN:
        return {"record_id": f"DRY-{photo.photo_id}", "matched": True, "status": "dry_run"}
    return _post_bridge_file("/api/collection/v1/submit", metadata, str(image_path))


def _build_candidate(image_path: Path, original_folder: str) -> dict[str, Any] | WebFolderCandidate:
    staff_name = _detect_staff_name(image_path)
    if not staff_name:
        return {"status": "skipped", "reason": "非目标员工文件夹", "file": str(image_path)}

    ocr_payload = _ocr_extract(image_path)
    watermark_text = _build_watermark_text(ocr_payload)
    if not watermark_text.strip():
        return {
            "status": "skipped",
            "reason": "OCR 无文本",
            "file": str(image_path),
            "staff_name": staff_name,
            "watermark_excerpt": "",
        }

    classification = classify(watermark_text)
    extracted = dict(classification.extracted)
    extracted.update((ocr_payload.get("extracted") or {}))
    if extracted.get("serialNumber") and not extracted.get("serial_numbers"):
        extracted["serial_numbers"] = [str(extracted["serialNumber"])]
    if extracted.get("customerPhone") and not extracted.get("customer_phone"):
        extracted["customer_phone"] = str(extracted["customerPhone"])
    classification.extracted = extracted
    return WebFolderCandidate(
        image_path=image_path,
        original_folder=original_folder,
        staff_name=staff_name,
        classification=classification,
        extracted=classification.extracted,
        watermark_text=watermark_text,
        group_key=_build_group_key(classification.extracted, watermark_text),
        customer_phone=_trusted_customer_phone(classification.extracted, watermark_text),
        product_keys=_build_product_keys(classification.extracted),
        taken_at=_parse_taken_at_from_filename(image_path),
        photo_date=_parse_photo_date(image_path),
        has_customer_evidence=_has_customer_evidence(classification.extracted, watermark_text),
        fingerprint=_compute_file_fingerprint(image_path),
    )


def _process_candidate(candidate: WebFolderCandidate, group_counter: Counter[str], phone_bundle_stats: dict[str, PhoneBundleStats], registry: dict[str, Any], dry_run: bool) -> dict[str, Any]:
    existing_path = registry["processedPaths"].get(str(candidate.image_path))
    if existing_path:
        return {
            "status": "skipped",
            "reason": "已在历史报告中处理",
            "file": str(candidate.image_path),
            "staff_name": candidate.staff_name,
            "record_id": existing_path.get("recordId") or "",
            "bridge_status": existing_path.get("bridgeStatus") or "",
        }
    existing_registry = registry["processedFingerprints"].get(candidate.fingerprint)
    if existing_registry:
        return {
            "status": "skipped",
            "reason": "已在 CLI 入库注册表中处理",
            "file": str(candidate.image_path),
            "staff_name": candidate.staff_name,
            "record_id": existing_registry.get("recordId") or "",
            "bridge_status": existing_registry.get("bridgeStatus") or "",
        }
    photo = _build_photo(candidate.image_path, candidate.staff_name, candidate.watermark_text)
    routed = _route_candidate(candidate, group_counter, phone_bundle_stats)

    saved_path = _save_local_json(photo, candidate.classification, routed, candidate.original_folder)
    bridge_resp = _submit_bridge(candidate.image_path, photo, candidate.classification, routed, candidate.original_folder)
    bridge_status = str(bridge_resp.get("status") or "")
    record_id = str(bridge_resp.get("record_id") or bridge_resp.get("recordId") or "")
    is_success = dry_run or bool(record_id) or bridge_resp.get("matched") is True
    if is_success:
        registry["processedFingerprints"][candidate.fingerprint] = {
            "file": str(candidate.image_path),
            "recordId": record_id,
            "bridgeStatus": bridge_status,
            "savedAt": _now_cn(),
        }
        registry["processedPaths"][str(candidate.image_path)] = {
            "recordId": record_id,
            "bridgeStatus": bridge_status,
            "savedAt": _now_cn(),
        }
    return {
        "status": "processed",
        "file": str(candidate.image_path),
        "staff_name": candidate.staff_name,
        "photo_id": photo.photo_id,
        "routed_group": routed.source_group_name,
        "route_reason": routed.route_reason,
        "category": candidate.classification.category,
        "watermark_excerpt": candidate.watermark_text[:240],
        "extracted": candidate.classification.extracted,
        "group_key": candidate.group_key,
        "group_count": group_counter.get(candidate.group_key, 0) if candidate.group_key else 0,
        "distinct_product_count": routed.distinct_product_count,
        "evidence_count": routed.evidence_count,
        "saved_path": saved_path,
        "bridge_resp": bridge_resp,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="今日相机网页分类文件夹 CLI")
    parser.add_argument("--download-url", help="网页导出的 ZIP 直链 URL")
    parser.add_argument("--zip-path", help="本地 ZIP 路径")
    parser.add_argument("--directory", help="已解压目录路径")
    parser.add_argument("--extract-dir", default=str(DEFAULT_EXTRACT_DIR), help="ZIP 解压目录")
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR), help="处理报告目录")
    parser.add_argument("--registry-file", default=str(DEFAULT_REGISTRY_FILE), help="已处理文件注册表")
    parser.add_argument("--min-date", default="", help="仅处理不早于该日期的图片，格式 YYYY-MM-DD")
    parser.add_argument("--max-date", default="", help="仅处理不晚于该日期的图片，格式 YYYY-MM-DD")
    parser.add_argument("--max-files", type=int, default=0, help="最多处理多少张，0=不限制")
    args = parser.parse_args()

    input_path, extract_root = _prepare_input(args)
    source_dir = _extract_if_needed(input_path, extract_root)
    image_files = _iter_image_files(source_dir)
    if args.min_date or args.max_date:
        filtered_files = []
        for image_path in image_files:
            photo_date = _parse_photo_date(image_path)
            if args.min_date and photo_date < args.min_date:
                continue
            if args.max_date and photo_date > args.max_date:
                continue
            filtered_files.append(image_path)
        image_files = filtered_files
    if args.max_files > 0:
        image_files = image_files[: args.max_files]

    registry_file = Path(args.registry_file).expanduser().resolve()
    registry = _load_registry(registry_file)
    preliminary = []
    for image_path in image_files:
        original_folder = next((part for part in image_path.parts if part in TARGET_STAFF), "")
        preliminary.append(_build_candidate(image_path, original_folder))

    enriched = _merge_cluster_evidence([item for item in preliminary if isinstance(item, WebFolderCandidate)])
    candidates = [item for item in enriched if isinstance(item, WebFolderCandidate)]
    group_counter = Counter(item.group_key for item in candidates if item.group_key)
    phone_bundle_stats = _build_phone_bundle_stats(candidates)
    results = []
    for item in enriched:
        if isinstance(item, WebFolderCandidate):
            results.append(_process_candidate(item, group_counter, phone_bundle_stats, registry, DRY_RUN))
        else:
            results.append(item)
    if not DRY_RUN:
        _save_registry(registry_file, registry)

    report_dir = Path(args.report_dir).expanduser().resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"xhey-web-folder-cli-report-{__import__('datetime').datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    summary = {
        "ok": True,
        "dryRun": DRY_RUN,
        "bridgeBase": BRIDGE_BASE,
        "hasBridgeToken": bool(BRIDGE_TOKEN),
        "sourceDir": str(source_dir),
        "inputPath": str(input_path),
        "registryFile": str(registry_file),
        "fileCount": len(image_files),
        "processedCount": sum(1 for item in results if item.get("status") == "processed"),
        "skippedCount": sum(1 for item in results if item.get("status") == "skipped"),
        "results": results,
    }
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nreport: {report_path}")


if __name__ == "__main__":
    main()
