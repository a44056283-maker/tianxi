"""
采集对接端 API（2026-06-09）
============================

**目的**：让"另一台电脑"通过 HTTP 调用此端点提交凭证（教育补贴单扫/三件套/多扫/二件套），
本机负责 OCR 识别 + 销售流水匹配 + 入库 + 返回 record_id。

**架构**：
```
[另一台电脑 / 任意客户端]
   ↓ HTTP POST (multipart/form-data 或 application/json)
[/api/collection/v1/submit]
   ↓
   [本机 OCR service :8765 + 销售流水匹配 + SQLite 入库]
   ↓
   [返回 {record_id, status, matched, ...}]
```

**与 edu_scan_v2_api 的关系**：
- edu_scan_v2_api 是本机内部使用（staff-mobile.html 调用）
- collection_bridge_api 是**对外公开**的对接端（另一台电脑调用）
- 两者最终都写入 education_scan_record_v2 表，逻辑可复用

**API Key 鉴权**：
- 在 HTTP Header 中传 `X-Bridge-Token: <api_key>`
- API Key 从环境变量 `COLLECTION_BRIDGE_API_KEY` 读取
- 留空则禁用鉴权（仅开发环境）
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional
import urllib.request
import urllib.error
import http.client

from fastapi import APIRouter, Header, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/collection/v1", tags=["collection-bridge"])

# ============== Configuration ==============

PROJECT_ROOT = Path(__file__).resolve().parents[3]  # apps/api-server/app/ → apps/api-server/ → apps/ → project root
SQLITE_PATH = Path(os.environ.get(
    'RETAIL_CORE_DB',
    str(PROJECT_ROOT / 'apps' / 'api-server' / 'data' / 'retail-core.sqlite3')
))
OCR_SERVICE_URL = os.environ.get('OCR_SERVICE_URL', 'http://127.0.0.1:8765')
BRIDGE_API_KEY = os.environ.get('COLLECTION_BRIDGE_API_KEY', '')  # 空字符串=不启用鉴权
EVIDENCE_DIR = Path(os.environ.get(
    'COLLECTION_EVIDENCE_DIR',
    '/Volumes/TianLu_Storage/Shared/今日水印相机/processed'
))

# CORS for对接端（让另一台电脑浏览器也能调）
# 在 main.py 的 CORSMiddleware 已配置，此处无需再设

# ============== Database ==============

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(SQLITE_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


# ============== Auth ==============

def verify_bridge_token(x_bridge_token: Optional[str] = Header(None)) -> str:
    """简单 API Key 鉴权"""
    if not BRIDGE_API_KEY:
        # 未配置 API Key = 开放模式（仅开发用）
        return 'dev-no-auth'
    if not x_bridge_token:
        raise HTTPException(status_code=401, detail='Missing X-Bridge-Token header')
    if not secrets.compare_digest(x_bridge_token, BRIDGE_API_KEY):
        raise HTTPException(status_code=403, detail='Invalid X-Bridge-Token')
    return 'authenticated'


# ============== Models ==============

class SubmitMetadata(BaseModel):
    """采集端提交的元数据（与图片配套）"""
    staff_id: str = Field(..., description="员工 ID（EMP003/EMP004/EMP005/EMP006）")
    staff_name: Optional[str] = Field(None, description="员工姓名（仅用于审计）")
    scan_type: str = Field(..., description="扫法：single_scan | multi_scan | three_piece | two_piece")
    source_group: str = Field('智店通入库群', description="来源群（智店通入库群 / 教育补贴群）")
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    agent_phone: Optional[str] = None
    serial_number: Optional[str] = None
    order_number: Optional[str] = None
    education_discount_amount: Optional[float] = 0
    service_fee_per_unit: Optional[float] = 0
    zhixiangjin_amount: Optional[float] = 0
    notes: Optional[str] = None
    client_tag: Optional[str] = Field(None, description="采集端来源标识，例如 'laptop-b-collect-v1'")
    captured_at: Optional[str] = Field(None, description="拍摄时间 ISO 8601")
    source_type: Optional[str] = Field(None, description="来源类型，例如 xhey_api_manual / watermark_camera_manual")
    collection_source: Optional[str] = Field(None, description="采集来源，例如 xhey_api / watermark_camera_web_cli")
    photo_id: Optional[str] = Field(None, description="今日相机 photoId")
    media_url: Optional[str] = Field(None, description="今日相机原始图片 URL")
    watermark: Optional[str] = Field(None, description="水印文本")
    taken_at: Optional[str] = Field(None, description="今日相机拍摄时间")
    extracted: Optional[dict[str, Any]] = Field(None, description="上游结构化提取字段")


class SubmitResponse(BaseModel):
    ok: bool
    record_id: str
    status: str  # 'success' | 'partial' | 'failed'
    matched: bool
    match_source: Optional[str] = None  # 'serial' | 'order' | 'phone' | None
    matched_sku: Optional[str] = None
    matched_product: Optional[str] = None
    warnings: list[str] = []
    errors: list[str] = []
    evidence_path: Optional[str] = None
    processing_time_ms: int
    server_time: str


class StaffInfo(BaseModel):
    staff_id: str
    staff_name: str
    role: str
    performance_share: float
    default_fee: dict[str, float]


class HealthInfo(BaseModel):
    status: str
    server_time: str
    api_version: str
    auth_enabled: bool
    database: str
    ocr_service: str
    uptime_seconds: float


# ============== OCR Service ==============

def call_ocr_service(image_bytes: bytes, filename: str) -> dict:
    """调用本地 OCR 服务"""
    try:
        boundary = '----BridgeBoundary' + secrets.token_hex(8)
        body = (
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: image/jpeg\r\n'
            f'\r\n'
        ).encode('utf-8') + image_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')

        host = OCR_SERVICE_URL.replace('http://', '').split(':')[0]
        port = int(OCR_SERVICE_URL.split(':')[-1])
        conn = http.client.HTTPConnection(host, port, timeout=30)
        conn.request('POST', '/ocr/extract', body, {
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(len(body)),
        })
        resp = conn.getresponse()
        result = json.loads(resp.read().decode('utf-8'))
        conn.close()
        return result.get('extracted', {})
    except Exception as e:
        return {'error': str(e), 'extracted': False}


# ============== Sales Order Matching ==============

def _build_service_priority_case(alias: str = 'sol') -> str:
    text_expr = (
        f"lower(coalesce({alias}.product_name, '') || ' ' || "
        f"coalesce({alias}.sku_key, '') || ' ' || "
        f"coalesce({alias}.mtm_code, '') || ' ' || "
        f"coalesce({alias}.spec, ''))"
    )
    checks = [f"{text_expr} LIKE '%{keyword.lower()}%'" for keyword in SERVICE_PRODUCT_KEYWORDS]
    return f"CASE WHEN {' OR '.join(checks)} THEN 1 ELSE 0 END"


def _serial_exists_exact(conn: sqlite3.Connection, serial: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM sales_order_line sol
        WHERE sol.serial_number = ?
           OR sol.serial_numbers_json LIKE ?
        LIMIT 1
        """,
        (serial, f'%"{serial}"%'),
    ).fetchone()
    if row:
        return True
    row = conn.execute(
        "SELECT 1 FROM serial_item WHERE serial_number = ? LIMIT 1",
        (serial,),
    ).fetchone()
    return bool(row)


def _generate_serial_alias_candidates(serial: str) -> list[str]:
    base = str(serial or '').strip().upper()
    if not base:
        return []
    candidates = [base]
    swapped_o = base.replace('O', '0')
    if swapped_o != base:
        candidates.append(swapped_o)
    swapped_i = base.replace('I', '1')
    if swapped_i not in candidates:
        candidates.append(swapped_i)
    swapped_b = base.replace('S', '5')
    if swapped_b not in candidates:
        candidates.append(swapped_b)
    return candidates


def resolve_known_serial_alias(serial: str) -> str:
    base = str(serial or '').strip().upper()
    if not base:
        return ''
    conn = get_db()
    try:
        if _serial_exists_exact(conn, base):
            return base
        for candidate in _generate_serial_alias_candidates(base)[1:]:
            if candidate and _serial_exists_exact(conn, candidate):
                return candidate
        return base
    finally:
        conn.close()


def match_sales_order(sn: Optional[str], order: Optional[str], phone: Optional[str]) -> Optional[dict]:
    """SN → 订单 → 手机号 顺序匹配"""
    service_priority_case = _build_service_priority_case('sol')
    candidates = [
        ('serial', resolve_known_serial_alias(sn or '') if sn else sn),
        ('order', order),
        ('phone', phone),
    ]
    for kind, value in candidates:
        if not value:
            continue
        try:
            conn = get_db()
            if kind == 'serial':
                # 优先 sales_order_line.serial_number（已销售）
                row = conn.execute("""
                    SELECT sol.sku_key, sol.mtm_code AS pn_mtm, sol.spec,
                           so.id AS order_id, so.customer_name,
                           so.external_order_no, so.pay_time,
                           sol.product_name
                    FROM sales_order_line sol
                    LEFT JOIN sales_order so ON so.id = sol.order_id
                    WHERE sol.serial_number = ?
                       OR sol.serial_numbers_json LIKE ?
                    ORDER BY """ + service_priority_case + """, so.pay_time DESC, sol.id DESC
                    LIMIT 1
                """, (value, f'%"{value}"%')).fetchone()
                # 如果没匹配到，fallback 到 serial_item（库存 SN）
                if not row:
                    row = conn.execute("""
                        SELECT sku_key, pn_mtm, spec, product_name
                        FROM serial_item
                        WHERE serial_number = ?
                        LIMIT 1
                    """, (value,)).fetchone()
                    if row:
                        return {
                            'matchSource': 'serial-inventory',
                            'skuKey': row['sku_key'],
                            'pnMtm': row['pn_mtm'],
                            'spec': row['spec'],
                            'orderId': '',
                            'customerName': '',
                            'customerPhone': '',
                            'productName': row['product_name'],
                        }
            elif kind == 'order':
                row = conn.execute("""
                    SELECT sol.sku_key, sol.mtm_code AS pn_mtm, sol.spec,
                           so.id AS order_id, so.customer_name,
                           so.external_order_no, so.pay_time,
                           sol.product_name
                    FROM sales_order_line sol
                    LEFT JOIN sales_order so ON so.id = sol.order_id
                    WHERE so.id = ? OR so.external_order_no = ?
                    ORDER BY """ + service_priority_case + """, so.pay_time DESC, sol.id DESC
                    LIMIT 1
                """, (value, value)).fetchone()
            else:  # phone
                # sales_order 没有 customer_phone 字段 — 从 raw_payload_json 提取
                # 或 fallback 到 serial_item.serial_number 附近信息
                # 暂不支持 phone 匹配
                row = None
            conn.close()
            if row:
                keys = row.keys() if hasattr(row, 'keys') else []
                return {
                    'matchSource': kind,
                    'skuKey': row['sku_key'] if 'sku_key' in keys else '',
                    'pnMtm': row['pn_mtm'] if 'pn_mtm' in keys else '',
                    'spec': row['spec'] if 'spec' in keys else '',
                    'orderId': row['order_id'] if 'order_id' in keys else '',
                    'customerName': row['customer_name'] if 'customer_name' in keys else '',
                    'customerPhone': '',
                    'productName': row['product_name'] if 'product_name' in keys else '',
                }
        except Exception as e:
            print(f'[match {kind}] error: {e}', file=sys.stderr)
    return None


# ============== Record Builder ==============

SCAN_TYPE_DEFAULTS = {
    'three_piece': {'default_fee': 300, 'default_zhixiangjin': 2000, 'default_education_discount': 500},
    'two_piece':   {'default_fee': 130, 'default_zhixiangjin': 0,   'default_education_discount': 0},
    'multi_scan':  {'default_fee': 80,  'default_zhixiangjin': 0,   'default_education_discount': 0},
    'single_scan': {'default_fee': 50,  'default_zhixiangjin': 0,   'default_education_discount': 30},
}

SERVICE_PRODUCT_KEYWORDS = ('Lenovo Care', '智惠', '延保', '保修', '服务', '保险', '碎屏', '会员')
BUNDLE_RECLASSIFY_SINCE_DATE = '2026-06-06'

def _resolve_capture_datetime(metadata: SubmitMetadata) -> datetime:
    shanghai_tz = timezone(timedelta(hours=8))
    candidates = [
        str(metadata.captured_at or '').strip(),
        str(metadata.taken_at or '').strip(),
    ]
    for raw in candidates:
        if not raw:
            continue
        try:
            if raw.isdigit():
                return datetime.fromtimestamp(int(raw), tz=shanghai_tz)
            normalized = raw.replace('Z', '+00:00')
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=shanghai_tz)
            return parsed.astimezone(shanghai_tz)
        except Exception:
            continue
    return datetime.now(shanghai_tz)


def _normalize_phone(value: Any) -> str:
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if len(digits) == 11:
        return digits
    if len(digits) > 11:
        return digits[-11:]
    return ''


def _load_raw_payload(raw_text: Any) -> dict[str, Any]:
    text = str(raw_text or '').strip()
    if not text:
        return {}
    try:
        payload = json.loads(text)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _load_serial_numbers(row: sqlite3.Row | dict[str, Any]) -> list[str]:
    raw_value = row['serial_numbers_json'] if isinstance(row, sqlite3.Row) else row.get('serial_numbers_json')
    try:
        serials = json.loads(raw_value or '[]')
    except Exception:
        serials = []
    result: list[str] = []
    for item in serials if isinstance(serials, list) else []:
        text = str(item or '').strip().upper()
        if text:
            result.append(text)
    return result


def _is_test_like_record(row: sqlite3.Row, metadata: dict[str, Any]) -> bool:
    source_file = str(row['source_file'] or '').strip().lower()
    client_tag = str(metadata.get('clientTag') or '').strip().lower()
    photo_id = str(metadata.get('photoId') or '').strip().lower()
    return (
        'test-bridge' in source_file
        or source_file.startswith('cli://test')
        or client_tag.startswith('test-')
        or photo_id.startswith('test-')
        or str(row['record_id'] or '').startswith('test-')
        or str(row['record_id'] or '').startswith('watermark-cam-')
    )


def _derive_record_unit_key_from_row(row: sqlite3.Row) -> str:
    payload = _load_raw_payload(row['raw_payload_json'])
    metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
    extracted = metadata.get('extracted') if isinstance(metadata.get('extracted'), dict) else {}
    serials = _load_serial_numbers(row)
    voucher_code = str(row['voucher_code'] or extracted.get('voucherCode') or '').strip().upper()
    product_key = ' | '.join(
        part for part in [
            str(row['sku_key'] or '').strip().upper(),
            str(row['pn_mtm'] or '').strip().upper(),
            str(row['product_name'] or '').strip(),
            str(extracted.get('modelText') or '').strip(),
        ]
        if part
    )
    order_number = str(row['order_number'] or '').strip().upper()
    parts = [
        f"serial:{serials[0]}" if serials else '',
        f"voucher:{voucher_code}" if voucher_code else '',
        f"product:{product_key}" if product_key else '',
        f"order:{order_number}" if order_number else '',
    ]
    return '||'.join(part for part in parts if part)


def _derive_pending_record_unit_key(record: dict[str, Any], ocr_data: dict[str, Any], match: Optional[dict[str, Any]]) -> str:
    serials = [str(item or '').strip().upper() for item in (record.get('serial_numbers') or []) if str(item or '').strip()]
    voucher_code = str(record.get('voucher_code') or ocr_data.get('voucherCode') or '').strip().upper()
    product_key = ' | '.join(
        part for part in [
            str((match or {}).get('skuKey') or record.get('sku_key') or '').strip().upper(),
            str((match or {}).get('pnMtm') or record.get('pn_mtm') or '').strip().upper(),
            str((match or {}).get('productName') or record.get('product_name') or '').strip(),
            str(ocr_data.get('modelText') or '').strip(),
        ]
        if part
    )
    order_number = str(record.get('order_number') or '').strip().upper()
    parts = [
        f"serial:{serials[0]}" if serials else '',
        f"voucher:{voucher_code}" if voucher_code else '',
        f"product:{product_key}" if product_key else '',
        f"order:{order_number}" if order_number else '',
    ]
    return '||'.join(part for part in parts if part)


def _resolve_bundle_scan_type_from_unit_count(unit_count: int) -> str:
    if unit_count >= 3:
        return 'three_piece'
    if unit_count >= 2:
        return 'two_piece'
    return 'single_scan'


def preview_bundle_classification(phone: str, pending_unit_key: str = '') -> Optional[dict[str, Any]]:
    normalized_phone = _normalize_phone(phone)
    if not normalized_phone:
        return None
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT record_id, source_file, order_number, voucher_code, sku_key, pn_mtm, product_name,
                   serial_numbers_json, raw_payload_json
            FROM education_scan_record_v2
            WHERE scan_date >= ?
              AND COALESCE(NULLIF(customer_phone, ''), NULLIF(agent_phone, '')) = ?
            ORDER BY scan_date ASC, id ASC
            """,
            (BUNDLE_RECLASSIFY_SINCE_DATE, normalized_phone),
        ).fetchall()
    finally:
        conn.close()
    unit_keys: set[str] = set()
    for row in rows:
        payload = _load_raw_payload(row['raw_payload_json'])
        metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
        if bool(metadata.get('serviceMatchFiltered')):
            continue
        if _is_test_like_record(row, metadata):
            continue
        unit_key = _derive_record_unit_key_from_row(row)
        if unit_key:
            unit_keys.add(unit_key)
    if pending_unit_key:
        unit_keys.add(pending_unit_key)
    unit_count = len(unit_keys)
    return {
        'phone': normalized_phone,
        'unitCount': unit_count,
        'scanType': _resolve_bundle_scan_type_from_unit_count(unit_count),
        'sourceGroup': '智店通入库群' if unit_count >= 2 else '教育补贴群',
    }


def reclassify_phone_bundle_records(phone: str) -> Optional[dict[str, Any]]:
    normalized_phone = _normalize_phone(phone)
    if not normalized_phone:
        return None
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT id, record_id, scan_date, customer_phone, agent_phone, source_group_name, scan_type,
                   source_file, order_number, voucher_code, sku_key, pn_mtm, product_name, serial_numbers_json,
                   raw_payload_json, updated_at
            FROM education_scan_record_v2
            WHERE scan_date >= ?
              AND COALESCE(NULLIF(customer_phone, ''), NULLIF(agent_phone, '')) = ?
            ORDER BY scan_date ASC, id ASC
            """,
            (BUNDLE_RECLASSIFY_SINCE_DATE, normalized_phone),
        ).fetchall()
        eligible_rows: list[sqlite3.Row] = []
        unit_keys: set[str] = set()
        for row in rows:
            payload = _load_raw_payload(row['raw_payload_json'])
            metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
            if bool(metadata.get('serviceMatchFiltered')):
                continue
            if _is_test_like_record(row, metadata):
                continue
            eligible_rows.append(row)
            unit_key = _derive_record_unit_key_from_row(row)
            if unit_key:
                unit_keys.add(unit_key)
        if not eligible_rows:
            return None
        unit_count = len(unit_keys)
        target_scan_type = _resolve_bundle_scan_type_from_unit_count(unit_count)
        target_source_group = '智店通入库群' if unit_count >= 2 else '教育补贴群'
        updated_record_ids: list[str] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in eligible_rows:
            payload = _load_raw_payload(row['raw_payload_json'])
            metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
            metadata['bundleByPhoneUnitCount'] = unit_count
            metadata['bundleByPhoneReclassifiedAt'] = now_iso
            metadata['bundleByPhoneRule'] = 'same_phone_accumulated_units'
            payload['metadata'] = metadata
            if str(row['scan_type'] or '') != target_scan_type or str(row['source_group_name'] or '') != target_source_group:
                conn.execute(
                    """
                    UPDATE education_scan_record_v2
                    SET scan_type = ?,
                        source_group_name = ?,
                        raw_payload_json = ?,
                        updated_at = ?,
                        review_status = CASE WHEN review_status = 'reviewed' THEN review_status ELSE 'pending' END
                    WHERE id = ?
                    """,
                    (target_scan_type, target_source_group, json.dumps(payload, ensure_ascii=False), now_iso, row['id']),
                )
                updated_record_ids.append(str(row['record_id']))
            else:
                conn.execute(
                    "UPDATE education_scan_record_v2 SET raw_payload_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(payload, ensure_ascii=False), now_iso, row['id']),
                )
        conn.commit()
        return {
            'phone': normalized_phone,
            'unitCount': unit_count,
            'scanType': target_scan_type,
            'sourceGroup': target_source_group,
            'updatedRecordIds': updated_record_ids,
        }
    finally:
        conn.close()


def _is_service_like_match(match: Optional[dict[str, Any]]) -> bool:
    if not match:
        return False
    text = ' '.join(
        str(match.get(key) or '').strip()
        for key in ('productName', 'skuKey', 'pnMtm', 'spec')
    )
    return any(keyword.lower() in text.lower() for keyword in SERVICE_PRODUCT_KEYWORDS)


def _normalize_match_for_education_scan(match: Optional[dict[str, Any]]) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    if not match or not _is_service_like_match(match):
        return match, None
    filtered = dict(match)
    return None, {
        'matchSource': filtered.get('matchSource'),
        'skuKey': filtered.get('skuKey'),
        'pnMtm': filtered.get('pnMtm'),
        'spec': filtered.get('spec'),
        'productName': filtered.get('productName'),
        'reason': 'matched_service_product',
    }


def build_record(metadata: SubmitMetadata, ocr_data: dict, match: Optional[dict], evidence_filename: str) -> dict:
    defaults = SCAN_TYPE_DEFAULTS.get(metadata.scan_type, SCAN_TYPE_DEFAULTS['single_scan'])
    capture_dt = _resolve_capture_datetime(metadata)

    # OCR 提取的客户/订单/SN 优先
    customer_name = metadata.customer_name or ocr_data.get('customerName') or '未填'
    customer_phone = metadata.customer_phone or ocr_data.get('customerPhone') or ''
    agent_phone = metadata.agent_phone or ocr_data.get('agentPhone') or ''
    order_number = metadata.order_number or ocr_data.get('orderNumber') or (match or {}).get('orderId') or ''
    serial_number = metadata.serial_number or ocr_data.get('serialNumber') or ''

    # 优先用 OCR 提取的服务费/智享金
    edu_discount = metadata.education_discount_amount or ocr_data.get('educationDiscount') or defaults['default_education_discount']
    service_fee = metadata.service_fee_per_unit or ocr_data.get('serviceFee') or defaults['default_fee']
    zhixiangjin = metadata.zhixiangjin_amount or ocr_data.get('zhixiangjin') or defaults['default_zhixiangjin']

    record = {
        'record_id': f'BRIDGE-{int(time.time()*1000)}-{secrets.token_hex(4).upper()}',
        'scan_date': capture_dt.strftime('%Y-%m-%d'),
        'scan_timestamp': capture_dt.isoformat(),
        'source_group_name': metadata.source_group,
        'scan_type': metadata.scan_type,
        'staff_id': metadata.staff_id,
        'customer_name': customer_name,
        'customer_phone': customer_phone,
        'agent_phone': agent_phone,
        'product_name': (match or {}).get('productName') or '',
        'sku_key': (match or {}).get('skuKey') or '',
        'pn_mtm': (match or {}).get('pnMtm') or '',
        'spec': (match or {}).get('spec') or '',
        'category': '',
        'quantity': 1,
        'education_discount_amount': float(edu_discount),
        'total_education_discount_amount': float(edu_discount),
        'service_fee_per_unit': float(service_fee),
        'total_service_fee': float(service_fee),
        'zhixiangjin_amount': float(zhixiangjin),
        'order_number': order_number,
        'serial_numbers': [serial_number] if serial_number else [],
        'voucher_code': ocr_data.get('voucherCode', '') or '',
        'status': '未付',
        'report_status': '今日相机自动采集' if (metadata.source_type or '').startswith('xhey') else '对接端自动校准',
        'evidence_images': [evidence_filename] if evidence_filename else [],
        'notes': metadata.notes or f'来源: {metadata.client_tag or "bridge"}',
        'sync_status': 'success' if match else 'partial',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'source_metadata': {
            'captureSource': 'bridge',
            'clientTag': metadata.client_tag,
            'capturedAt': metadata.captured_at,
            'bridgeVersion': 'v1',
            'sourceType': metadata.source_type or 'bridge_manual',
            'collectionSource': metadata.collection_source or metadata.client_tag or 'bridge',
            'photoId': metadata.photo_id or '',
            'mediaUrl': metadata.media_url or '',
            'watermark': metadata.watermark or '',
            'takenAt': metadata.taken_at or '',
            'extracted': metadata.extracted or {},
            'evidencePath': evidence_filename or '',
            'serviceMatchFiltered': False,
        },
    }
    return record


def trigger_projection_sync() -> dict[str, Any]:
    """桥接写入后立刻刷新教育补汇总快照。"""
    try:
        from app.edu_scan_v2_api import sync_to_projection

        payload = sync_to_projection()
        if isinstance(payload, dict):
            return payload
        return {'ok': False, 'status': 'unexpected_sync_payload'}
    except Exception as error:
        return {
            'ok': False,
            'status': 'sync_failed',
            'error': f'{type(error).__name__}: {error}',
        }


def repair_service_filtered_records(since_date: str = BUNDLE_RECLASSIFY_SINCE_DATE) -> dict[str, Any]:
    conn = get_db()
    rows: list[sqlite3.Row] = []
    try:
        rows = conn.execute(
            """
            SELECT id, record_id, customer_phone, agent_phone, order_number,
                   serial_numbers_json, raw_payload_json
            FROM education_scan_record_v2
            WHERE scan_date >= ?
              AND raw_payload_json LIKE '%"serviceMatchFiltered": true%'
            ORDER BY id ASC
            """,
            (since_date,),
        ).fetchall()
        repaired: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        touched_phones: set[str] = set()
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in rows:
            payload = _load_raw_payload(row['raw_payload_json'])
            metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
            extracted = metadata.get('extracted') if isinstance(metadata.get('extracted'), dict) else {}
            serial_numbers = _load_serial_numbers(row)
            serial = next((item for item in serial_numbers if item), '') or str(extracted.get('serialNumber') or '').strip().upper()
            phone = _normalize_phone(
                row['customer_phone']
                or row['agent_phone']
                or extracted.get('customer_phone')
                or extracted.get('customerPhone')
            )
            old_order_number = str(row['order_number'] or extracted.get('orderNumber') or '').strip()
            rematch = match_sales_order(sn=serial or None, order=None, phone=phone or None)
            if not rematch or _is_service_like_match(rematch):
                skipped.append({
                    'recordId': str(row['record_id']),
                    'serial': serial,
                    'orderNumber': old_order_number,
                    'phone': phone,
                    'reason': 'no_non_service_machine_match',
                })
                continue
            metadata['serviceMatchFiltered'] = False
            metadata['serviceRepairApplied'] = True
            metadata['serviceRepairAppliedAt'] = now_iso
            metadata['repairedFromOrderNumber'] = old_order_number
            metadata['machineRematch'] = rematch
            conn.execute(
                """
                UPDATE education_scan_record_v2
                SET product_name = ?,
                    sku_key = ?,
                    pn_mtm = ?,
                    spec = ?,
                    order_number = ?,
                    sync_status = 'success',
                    raw_payload_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    str(rematch.get('productName') or ''),
                    str(rematch.get('skuKey') or ''),
                    str(rematch.get('pnMtm') or ''),
                    str(rematch.get('spec') or ''),
                    str(rematch.get('orderId') or old_order_number),
                    json.dumps({'source': 'bridge', 'metadata': metadata}, ensure_ascii=False),
                    now_iso,
                    row['id'],
                ),
            )
            repaired.append({
                'recordId': str(row['record_id']),
                'serial': serial,
                'oldOrderNumber': old_order_number,
                'newOrderNumber': str(rematch.get('orderId') or old_order_number),
                'skuKey': str(rematch.get('skuKey') or ''),
                'productName': str(rematch.get('productName') or ''),
            })
            if phone:
                touched_phones.add(phone)
        conn.commit()
    finally:
        conn.close()

    bundle_updates = []
    for phone in sorted(touched_phones):
        result = reclassify_phone_bundle_records(phone)
        if result:
            bundle_updates.append(result)
    return {
        'ok': True,
        'sinceDate': since_date,
        'candidateCount': len(rows),
        'repairedCount': len(repaired),
        'skippedCount': len(skipped),
        'repaired': repaired,
        'skipped': skipped,
        'bundleUpdates': bundle_updates,
    }


def repair_serial_ocr_records(since_date: str = BUNDLE_RECLASSIFY_SINCE_DATE) -> dict[str, Any]:
    conn = get_db()
    rows: list[sqlite3.Row] = []
    try:
        rows = conn.execute(
            """
            SELECT id, record_id, customer_phone, agent_phone, order_number,
                   serial_numbers_json, raw_payload_json, product_name, sku_key, pn_mtm, spec
            FROM education_scan_record_v2
            WHERE scan_date >= ?
            ORDER BY id ASC
            """,
            (since_date,),
        ).fetchall()
        repaired: list[dict[str, Any]] = []
        touched_phones: set[str] = set()
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in rows:
            payload = _load_raw_payload(row['raw_payload_json'])
            metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
            extracted = metadata.get('extracted') if isinstance(metadata.get('extracted'), dict) else {}
            serials = _load_serial_numbers(row)
            if not serials:
                extracted_serial = str(extracted.get('serialNumber') or '').strip().upper()
                if extracted_serial:
                    serials = [extracted_serial]
            if not serials:
                continue
            normalized_serials = [resolve_known_serial_alias(serial) for serial in serials]
            changed_serials = normalized_serials != serials
            serial_for_match = next((item for item in normalized_serials if item), '')
            current_order_number = str(row['order_number'] or '').strip()
            rematch = match_sales_order(sn=serial_for_match or None, order=current_order_number or None, phone=_normalize_phone(row['customer_phone'] or row['agent_phone']))
            should_update_match = bool(rematch) and (
                changed_serials
                or not current_order_number
                or not str(row['product_name'] or '').strip()
                or not str(row['sku_key'] or '').strip()
            )
            if not changed_serials and not should_update_match:
                continue
            extracted['serialNumber'] = serial_for_match
            extracted['serial_numbers'] = normalized_serials
            metadata['extracted'] = extracted
            metadata['serialAliasRepairApplied'] = True
            metadata['serialAliasRepairAppliedAt'] = now_iso
            metadata['serialAliasRepairFrom'] = serials
            update_values = {
                'serial_numbers_json': json.dumps(normalized_serials, ensure_ascii=False),
                'raw_payload_json': json.dumps({'source': 'bridge', 'metadata': metadata}, ensure_ascii=False),
                'updated_at': now_iso,
            }
            if rematch:
                update_values.update({
                    'order_number': str(rematch.get('orderId') or current_order_number),
                    'product_name': str(rematch.get('productName') or row['product_name'] or ''),
                    'sku_key': str(rematch.get('skuKey') or row['sku_key'] or ''),
                    'pn_mtm': str(rematch.get('pnMtm') or row['pn_mtm'] or ''),
                    'spec': str(rematch.get('spec') or row['spec'] or ''),
                    'sync_status': 'success',
                })
            conn.execute(
                """
                UPDATE education_scan_record_v2
                SET serial_numbers_json = :serial_numbers_json,
                    raw_payload_json = :raw_payload_json,
                    updated_at = :updated_at,
                    order_number = COALESCE(:order_number, order_number),
                    product_name = COALESCE(:product_name, product_name),
                    sku_key = COALESCE(:sku_key, sku_key),
                    pn_mtm = COALESCE(:pn_mtm, pn_mtm),
                    spec = COALESCE(:spec, spec),
                    sync_status = COALESCE(:sync_status, sync_status)
                WHERE id = :id
                """,
                {
                    **update_values,
                    'order_number': update_values.get('order_number'),
                    'product_name': update_values.get('product_name'),
                    'sku_key': update_values.get('sku_key'),
                    'pn_mtm': update_values.get('pn_mtm'),
                    'spec': update_values.get('spec'),
                    'sync_status': update_values.get('sync_status'),
                    'id': row['id'],
                },
            )
            repaired.append({
                'recordId': str(row['record_id']),
                'fromSerials': serials,
                'toSerials': normalized_serials,
                'newOrderNumber': update_values.get('order_number') or current_order_number,
                'skuKey': update_values.get('sku_key') or str(row['sku_key'] or ''),
            })
            phone = _normalize_phone(row['customer_phone'] or row['agent_phone'])
            if phone:
                touched_phones.add(phone)
        conn.commit()
    finally:
        conn.close()

    bundle_updates = []
    for phone in sorted(touched_phones):
        result = reclassify_phone_bundle_records(phone)
        if result:
            bundle_updates.append(result)
    return {
        'ok': True,
        'sinceDate': since_date,
        'candidateCount': len(rows),
        'repairedCount': len(repaired),
        'repaired': repaired,
        'bundleUpdates': bundle_updates,
    }


# ============== Save Record ==============

def save_record(record: dict) -> int:
    """保存到 education_scan_record_v2 表"""
    conn = get_db()
    try:
        # Look up staff_name from staff table
        staff_row = conn.execute("SELECT name FROM staff WHERE id = ?", (record['staff_id'],)).fetchone()
        staff_name = staff_row['name'] if staff_row else (record.get('staff_name') or record['staff_id'])
        staff_role_row = conn.execute("SELECT role FROM staff WHERE id = ?", (record['staff_id'],)).fetchone()
        staff_role = staff_role_row['role'] if staff_role_row else ''
        cur = conn.execute("""
            INSERT INTO education_scan_record_v2 (
                record_id, scan_date, scan_timestamp, source_group_name, scan_type,
                staff_id, staff_name, staff_role,
                customer_name, customer_phone, agent_phone,
                product_name, sku_key, pn_mtm, spec,
                category, quantity,
                education_discount_amount, total_education_discount_amount,
                service_fee_per_unit, total_service_fee, zhixiangjin_amount,
                order_number, serial_numbers_json, voucher_code,
                status, report_status, evidence_images_json,
                sync_status, source_file, raw_payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            record['record_id'], record['scan_date'],
            record.get('scan_timestamp') or datetime.now(timezone(timedelta(hours=8))).isoformat(),
            record['source_group_name'], record['scan_type'],
            record['staff_id'], staff_name, staff_role,
            record['customer_name'], record['customer_phone'], record['agent_phone'],
            record['product_name'], record['sku_key'], record['pn_mtm'], record['spec'],
            record['category'], record['quantity'],
            record['education_discount_amount'], record['total_education_discount_amount'],
            record['service_fee_per_unit'], record['total_service_fee'], record['zhixiangjin_amount'],
            record['order_number'], json.dumps(record['serial_numbers'], ensure_ascii=False),
            record['voucher_code'],
            record['status'], record['report_status'],
            json.dumps(record['evidence_images'], ensure_ascii=False),
            record['sync_status'],
            record['notes'],
            json.dumps({'source': 'bridge', 'metadata': record.get('source_metadata', {})}, ensure_ascii=False),
            record['created_at'],
            record['created_at'],
        ))
        record_db_id = cur.lastrowid
        conn.commit()
        return record_db_id
    finally:
        conn.close()


def find_existing_record_id_by_photo_id(photo_id: str) -> str | None:
    if not photo_id:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            """
            SELECT record_id
            FROM education_scan_record_v2
            WHERE raw_payload_json LIKE ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (f'%"photoId": "{photo_id}"%',),
        ).fetchone()
        return str(row['record_id']) if row and row['record_id'] else None
    finally:
        conn.close()


def save_evidence(image_bytes: bytes, metadata: SubmitMetadata) -> str:
    """保存证据图片到处理目录"""
    today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    staff_dir = EVIDENCE_DIR / today / metadata.staff_id
    staff_dir.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time() * 1000)
    safe_scan = metadata.scan_type.replace('/', '_')
    safe_staff = metadata.staff_name.replace('/', '_') if metadata.staff_name else metadata.staff_id
    filename = f'{timestamp}_{safe_staff}_{safe_scan}_{secrets.token_hex(3)}.jpg'
    dest = staff_dir / filename
    with open(dest, 'wb') as f:
        f.write(image_bytes)
    return str(dest.relative_to(EVIDENCE_DIR.parent.parent))


# ============== Endpoints ==============

STARTUP_TIME = time.time()

@router.get('/health', response_model=HealthInfo)
async def health_check():
    """健康检查（采集端连接前先 ping）"""
    db_status = 'ok'
    try:
        conn = get_db()
        conn.execute('SELECT 1 FROM education_scan_record_v2 LIMIT 1').fetchone()
        conn.close()
    except Exception as e:
        db_status = f'error: {e}'

    ocr_status = 'ok'
    try:
        host = OCR_SERVICE_URL.replace('http://', '').split(':')[0]
        port = int(OCR_SERVICE_URL.split(':')[-1])
        conn = http.client.HTTPConnection(host, port, timeout=5)
        conn.request('GET', '/health')
        resp = conn.getresponse()
        if resp.status != 200:
            ocr_status = f'error: HTTP {resp.status}'
        conn.close()
    except Exception as e:
        ocr_status = f'unreachable: {e}'

    return HealthInfo(
        status='ok' if db_status == 'ok' else 'degraded',
        server_time=datetime.now(timezone(timedelta(hours=8))).isoformat(),
        api_version='v1',
        auth_enabled=bool(BRIDGE_API_KEY),
        database=db_status,
        ocr_service=ocr_status,
        uptime_seconds=time.time() - STARTUP_TIME,
    )


@router.get('/staff')
async def list_staff(auth: str = Header(None, alias='X-Bridge-Token')):
    """采集端下拉选择员工用"""
    verify_bridge_token(auth)
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT id, name, role
            FROM staff
            WHERE active = 1
            ORDER BY role DESC, name
        """).fetchall()
        # Performance share rules
        PERFORMANCE_SHARE = {
            'manager': 0.2,
            'service_advisor': 0.8,
            'sales': 0.5,
        }
        staff_list = []
        for r in rows:
            scan_defaults = {}
            for scan_type in SCAN_TYPE_DEFAULTS:
                scan_defaults[scan_type] = SCAN_TYPE_DEFAULTS[scan_type]['default_fee']
            staff_list.append({
                'staff_id': r['id'],
                'staff_name': r['name'],
                'role': r['role'],
                'performance_share': PERFORMANCE_SHARE.get(r['role'], 0.5),
                'default_fee': scan_defaults,
            })
        return {'ok': True, 'staff': staff_list, 'count': len(staff_list)}
    finally:
        conn.close()


@router.get('/scan-types')
async def list_scan_types(auth: str = Header(None, alias='X-Bridge-Token')):
    """扫法列表"""
    verify_bridge_token(auth)
    return {
        'ok': True,
        'scan_types': [
            {'key': 'single_scan', 'label': '教育补单扫', 'default_fee': 50,  'default_zhixiangjin': 0,    'default_education_discount': 30},
            {'key': 'multi_scan',  'label': '多扫',       'default_fee': 80,  'default_zhixiangjin': 0,    'default_education_discount': 0},
            {'key': 'three_piece', 'label': '三件套',     'default_fee': 300, 'default_zhixiangjin': 2000, 'default_education_discount': 500},
            {'key': 'two_piece',   'label': '二件套',     'default_fee': 130, 'default_zhixiangjin': 0,    'default_education_discount': 0},
        ]
    }


@router.post('/match/serial/{serial}')
async def match_serial(serial: str, auth: str = Header(None, alias='X-Bridge-Token')):
    """预检：另一台电脑可以先用 SN 试匹配，得到 SKU/订单后再决定是否提交"""
    verify_bridge_token(auth)
    result = match_sales_order(sn=serial, order=None, phone=None)
    return {'ok': True, 'matched': bool(result), 'data': result}


@router.post('/match/order/{order_id}')
async def match_order(order_id: str, auth: str = Header(None, alias='X-Bridge-Token')):
    verify_bridge_token(auth)
    result = match_sales_order(sn=None, order=order_id, phone=None)
    return {'ok': True, 'matched': bool(result), 'data': result}


@router.post('/match/phone/{phone}')
async def match_phone(phone: str, auth: str = Header(None, alias='X-Bridge-Token')):
    verify_bridge_token(auth)
    result = match_sales_order(sn=None, order=None, phone=phone)
    return {'ok': True, 'matched': bool(result), 'data': result}


@router.post('/submit', response_model=SubmitResponse)
async def submit(
    file: UploadFile = File(..., description="凭证图片 (jpg/png/webp)"),
    metadata: str = Form(..., description="JSON string of SubmitMetadata"),
    auth: str = Header(None, alias='X-Bridge-Token'),
):
    """
    采集对接端主入口

    另一台电脑调用方式：
    ```bash
    curl -X POST "http://<mac-mini-ip>:8000/api/collection/v1/submit" \\
      -H "X-Bridge-Token: <api_key>" \\
      -F "file=@voucher.jpg" \\
      -F 'metadata={"staff_id":"EMP003","scan_type":"single_scan","source_group":"智店通入库群","client_tag":"laptop-b-collect-v1"}'
    ```

    返回：
    - record_id: 本机分配的唯一 ID（采集端可以保存用于追踪）
    - matched: 是否匹配到销售流水
    - matched_sku / matched_product: 匹配到的 SKU 和商品
    - evidence_path: 证据图片保存的相对路径
    """
    start = time.time()
    verify_bridge_token(auth)

    # 解析 metadata
    try:
        meta_dict = json.loads(metadata)
        meta = SubmitMetadata(**meta_dict)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f'Invalid metadata JSON: {e}')

    warnings: list[str] = []
    errors: list[str] = []

    # 1. 读图片
    image_bytes = await file.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='Image too large (max 20MB)')
    if not image_bytes:
        raise HTTPException(status_code=422, detail='Empty image file')

    # 2. 保存证据
    try:
        evidence_rel = save_evidence(image_bytes, meta)
    except Exception as e:
        evidence_rel = ''
        errors.append(f'evidence save failed: {e}')

    # 3. OCR 识别
    ocr_data = call_ocr_service(image_bytes, file.filename or 'voucher.jpg')
    if 'error' in ocr_data:
        warnings.append(f'OCR failed: {ocr_data["error"]}')

    # 4. 合并 OCR 结果到 meta（仅当 meta 没传时）
    if not meta.customer_name and ocr_data.get('customerName'):
        meta.customer_name = ocr_data['customerName']
    if not meta.customer_phone and ocr_data.get('customerPhone'):
        meta.customer_phone = ocr_data['customerPhone']
    if not meta.agent_phone and ocr_data.get('agentPhone'):
        meta.agent_phone = ocr_data['agentPhone']
    if not meta.serial_number and ocr_data.get('serialNumber'):
        meta.serial_number = ocr_data['serialNumber']
    if not meta.order_number and ocr_data.get('orderNumber'):
        meta.order_number = ocr_data['orderNumber']
    if meta.serial_number:
        normalized_serial = resolve_known_serial_alias(meta.serial_number)
        if normalized_serial and normalized_serial != str(meta.serial_number).strip().upper():
            warnings.append(f'SN OCR 纠偏：{meta.serial_number} -> {normalized_serial}')
            meta.serial_number = normalized_serial

    # 5. 匹配销售流水
    raw_match = match_sales_order(
        sn=meta.serial_number,
        order=meta.order_number,
        phone=meta.customer_phone,
    )
    match, filtered_service_match = _normalize_match_for_education_scan(raw_match)
    if filtered_service_match:
        warnings.append('命中智惠/延保等服务类商品，已按非教育补产品过滤，不计入机器销售匹配。')
    if not raw_match:
        warnings.append('未匹配到销售流水（SN/订单/手机号）')

    bundle_preview = None

    # 6. 构造 record
    record = build_record(meta, ocr_data, match, evidence_rel)
    if filtered_service_match:
        record['source_metadata']['serviceMatchFiltered'] = True
        record['source_metadata']['filteredServiceMatch'] = filtered_service_match
    else:
        bundle_preview = preview_bundle_classification(
            record.get('customer_phone') or record.get('agent_phone') or '',
            _derive_pending_record_unit_key(record, ocr_data, match),
        )
        if bundle_preview and bundle_preview['scanType'] != record['scan_type']:
            record['scan_type'] = str(bundle_preview['scanType'])
            record['source_group_name'] = str(bundle_preview['sourceGroup'])
            warnings.append(
                f"同手机号累计不同商品/设备单元 {bundle_preview['unitCount']} 个，已按 {bundle_preview['scanType']} 归类。"
            )
        elif bundle_preview and bundle_preview['sourceGroup'] != record['source_group_name']:
            record['source_group_name'] = str(bundle_preview['sourceGroup'])

    existing_record_id = find_existing_record_id_by_photo_id(meta.photo_id or '')
    if existing_record_id:
        warnings.append(f'duplicate photoId: {meta.photo_id}')
        processing_time = int((time.time() - start) * 1000)
        return SubmitResponse(
            ok=True,
            record_id=existing_record_id,
            status='success' if match else 'partial',
            matched=bool(match),
            match_source=match['matchSource'] if match else None,
            matched_sku=match['skuKey'] if match else None,
            matched_product=match['productName'] if match else None,
            warnings=warnings,
            errors=errors,
            evidence_path=evidence_rel,
            processing_time_ms=processing_time,
            server_time=datetime.now(timezone(timedelta(hours=8))).isoformat(),
        )

    # 7. 入库
    try:
        db_id = save_record(record)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'DB save failed: {e}')

    if not filtered_service_match:
        bundle_reclassify = reclassify_phone_bundle_records(record.get('customer_phone') or record.get('agent_phone') or '')
        if bundle_reclassify and bundle_reclassify.get('updatedRecordIds'):
            warnings.append(
                f"同手机号累计归类已刷新：{bundle_reclassify['scanType']}，联动更新 {len(bundle_reclassify['updatedRecordIds'])} 条历史记录。"
            )

    sync_result = trigger_projection_sync()
    if not sync_result.get('ok'):
        warnings.append(f'projection sync failed: {sync_result.get("error") or sync_result.get("status") or "unknown"}')

    processing_time = int((time.time() - start) * 1000)
    return SubmitResponse(
        ok=True,
        record_id=record['record_id'],
        status='success' if match else 'partial',
        matched=bool(match),
        match_source=match['matchSource'] if match else None,
        matched_sku=match['skuKey'] if match else None,
        matched_product=match['productName'] if match else None,
        warnings=warnings,
        errors=errors,
        evidence_path=evidence_rel,
        processing_time_ms=processing_time,
        server_time=datetime.now(timezone(timedelta(hours=8))).isoformat(),
    )


@router.get('/records/{record_id}')
async def get_record(record_id: str, auth: str = Header(None, alias='X-Bridge-Token')):
    """查询单条记录（采集端可以用 record_id 反查）"""
    verify_bridge_token(auth)
    conn = get_db()
    try:
        row = conn.execute("""
            SELECT * FROM education_scan_record_v2 WHERE record_id = ?
        """, (record_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Record not found')
        result = dict(row)
        # 解析 JSON 字段
        for k in ('serial_numbers_json', 'evidence_images_json', 'raw_payload_json'):
            if result.get(k):
                try:
                    result[k] = json.loads(result[k])
                except Exception:
                    pass
        return {'ok': True, 'record': result}
    finally:
        conn.close()


@router.get('/records')
async def list_records(
    limit: int = Query(20, le=200),
    offset: int = Query(0, ge=0),
    staff_id: Optional[str] = None,
    scan_date: Optional[str] = None,
    matched_only: bool = False,
    auth: str = Header(None, alias='X-Bridge-Token'),
):
    """列出最近记录（采集端轮询 / 管理员看）"""
    verify_bridge_token(auth)
    conn = get_db()
    try:
        sql = "SELECT * FROM education_scan_record_v2 WHERE 1=1"
        params: list[Any] = []
        if staff_id:
            sql += " AND staff_id = ?"
            params.append(staff_id)
        if scan_date:
            sql += " AND scan_date = ?"
            params.append(scan_date)
        if matched_only:
            sql += " AND sync_status IN ('success', 'partial')"
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        records = []
        for r in rows:
            item = dict(r)
            for k in ('serial_numbers_json', 'evidence_images_json'):
                if item.get(k):
                    try:
                        item[k.replace('_json', '')] = json.loads(item[k])
                    except Exception:
                        pass
            records.append(item)
        total = conn.execute("SELECT COUNT(*) FROM education_scan_record_v2").fetchone()[0]
        return {'ok': True, 'records': records, 'total': total, 'limit': limit, 'offset': offset}
    finally:
        conn.close()


@router.get('/stats')
async def get_stats(
    scan_date: Optional[str] = None,
    auth: str = Header(None, alias='X-Bridge-Token'),
):
    """统计（管理端 dashboard）"""
    verify_bridge_token(auth)
    conn = get_db()
    try:
        date_filter = scan_date or datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
        rows = conn.execute("""
            SELECT
                staff_id,
                scan_type,
                COUNT(*) AS cnt,
                SUM(service_fee_per_unit) AS total_fee,
                SUM(zhixiangjin_amount) AS total_zhixiangjin,
                SUM(education_discount_amount) AS total_edu_discount
            FROM education_scan_record_v2
            WHERE scan_date = ?
            GROUP BY staff_id, scan_type
            ORDER BY staff_id, scan_type
        """, (date_filter,)).fetchall()
        by_staff: dict[str, dict] = {}
        total_fee = 0.0
        total_zhixiangjin = 0.0
        total_edu = 0.0
        for r in rows:
            sid = r['staff_id']
            if sid not in by_staff:
                by_staff[sid] = {'staff_id': sid, 'count': 0, 'total_fee': 0, 'total_zhixiangjin': 0, 'total_edu_discount': 0, 'by_scan_type': {}}
            by_staff[sid]['count'] += r['cnt']
            by_staff[sid]['total_fee'] += r['total_fee'] or 0
            by_staff[sid]['total_zhixiangjin'] += r['total_zhixiangjin'] or 0
            by_staff[sid]['total_edu_discount'] += r['total_edu_discount'] or 0
            by_staff[sid]['by_scan_type'][r['scan_type']] = {
                'count': r['cnt'],
                'total_fee': r['total_fee'] or 0,
                'total_zhixiangjin': r['total_zhixiangjin'] or 0,
                'total_edu_discount': r['total_edu_discount'] or 0,
            }
            total_fee += r['total_fee'] or 0
            total_zhixiangjin += r['total_zhixiangjin'] or 0
            total_edu += r['total_edu_discount'] or 0

        total_records = conn.execute(
            "SELECT COUNT(*) FROM education_scan_record_v2 WHERE scan_date = ?", (date_filter,)
        ).fetchone()[0]
        matched_records = conn.execute(
            "SELECT COUNT(*) FROM education_scan_record_v2 WHERE scan_date = ? AND sync_status = 'success'", (date_filter,)
        ).fetchone()[0]
        return {
            'ok': True,
            'scan_date': date_filter,
            'total_records': total_records,
            'matched_records': matched_records,
            'match_rate': round(matched_records / total_records, 4) if total_records else 0,
            'total_service_fee': total_fee,
            'total_zhixiangjin': total_zhixiangjin,
            'total_education_discount': total_edu,
            'by_staff': list(by_staff.values()),
        }
    finally:
        conn.close()
