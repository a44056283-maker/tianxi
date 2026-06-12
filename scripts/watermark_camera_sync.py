#!/usr/bin/env python3
"""
今日水印相机VIP → 本地外挂硬盘 → OCR → SQL 同步 CLI（2026-06-09）

完整链路：
1. 今日水印相机VIP iOS App 拍照 → 上传至云盘（WebDAV 挂载到 /Volumes/TianLu_Storage/Shared/今日水印相机/）
2. 本脚本扫描 incoming 目录
3. 按文件名/EXIF 元数据分类（三件套 / 教育补单扫 / 待分类）
4. 复制到 ocr_staging 目录
5. 调用本地 OCR 服务 (http://127.0.0.1:8765)
6. 用 OCR 提取的 SN/订单号/客户名匹配 sales_order_line
7. 构造 record POST 到 /api/education-scan/v2/records
8. 成功 → 移到 processed/{date}/{staff}/
9. 失败 → 移到 failed/{date}/
10. 生成 sync_report_{date}.json

支持：
- 增量同步（只处理新文件）
- 重试机制（最多 3 次）
- 全链路审计日志
- 员工名自动映射

用法：
    python3 scripts/watermark_camera_sync.py
    python3 scripts/watermark_camera_sync.py --dry-run
    python3 scripts/watermark_camera_sync.py --once  # 单次运行
    python3 scripts/watermark_camera_sync.py --watch # 持续监听
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional
import urllib.request
import urllib.error

# ---- Paths ----
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / 'config' / 'watermark_camera_path_mapping.json'
LOG_DIR = Path.home() / 'Library' / 'Logs' / 'lenovo-smart-retail'
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / 'watermark-camera-sync.log'


def log(level: str, msg: str, **fields: Any) -> None:
    """Structured log line"""
    ts = datetime.now(timezone(timedelta(hours=8))).isoformat()
    fields_str = ' '.join(f'{k}={v}' for k, v in fields.items())
    print(f'[{ts}] [{level}] {msg} {fields_str}'.strip())
    if level in ('ERROR', 'WARN'):
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f'[{ts}] [{level}] {msg} {fields_str}\n')


def load_config() -> dict:
    return json.load(open(CONFIG_PATH, encoding='utf-8'))


# ---- File classification ----

def extract_metadata_from_filename(filename: str) -> dict:
    """从文件名提取元数据（今日水印相机 VIP 文件名约定）"""
    meta = {
        'staff_name': None,
        'staff_id': None,
        'scan_type': None,
        'order_number': None,
        'timestamp': None,
    }
    stem = Path(filename).stem
    # Order number: XS + digits
    m = re.search(r'(XS\d{10,20})', filename, re.IGNORECASE)
    if m:
        meta['order_number'] = m.group(1)
    # Staff name (中文 2-4 字 + EMP ID)
    emp_match = re.search(r'EMP(\d{3})', filename)
    if emp_match:
        meta['staff_id'] = f'EMP{emp_match.group(1)}'
    else:
        # Try Chinese name match
        for name in ['梁伟', '郭楠', '李建定', '郭晨臣']:
            if name in filename:
                meta['staff_name'] = name
                break
    # Scan type from filename keywords
    if any(kw in filename for kw in ['三件套', '三件', 'three_piece']):
        meta['scan_type'] = 'three_piece'
    elif any(kw in filename for kw in ['多扫', 'multi', '两件套', '两件', 'two_piece']):
        meta['scan_type'] = 'multi_scan' if '多' in filename or 'multi' in filename else 'two_piece'
    elif any(kw in filename for kw in ['单扫', '单', 'single', 'education']):
        meta['scan_type'] = 'single_scan'
    # Timestamp: 20260609_123045
    ts_match = re.search(r'(\d{8})[_-](\d{6})', filename)
    if ts_match:
        meta['timestamp'] = f'{ts_match.group(1)}_{ts_match.group(2)}'
    return meta


def extract_metadata_from_exif(image_path: Path) -> dict:
    """从图片 EXIF 提取元数据（员工水印）"""
    meta = {}
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS
        img = Image.open(image_path)
        exif = img.getexif()
        if exif:
            for tag_id, value in exif.items():
                tag = TAGS.get(tag_id, tag_id)
                if tag == 'DateTimeOriginal':
                    meta['exif_datetime'] = str(value)
                elif tag == 'Artist':
                    meta['exif_artist'] = str(value)
                elif tag == 'Copyright':
                    meta['exif_copyright'] = str(value)
                elif tag == 'Software':
                    meta['exif_software'] = str(value)
        # Try GPS
        exif_ifd = img.getexif().get_ifd(0x8825) if hasattr(img.getexif(), 'get_ifd') else None
        if exif_ifd:
            from PIL.ExifTags import GPSTAGS
            for tag_id, value in exif_ifd.items():
                tag = GPSTAGS.get(tag_id, tag_id)
                if tag == 'GPSLatitude':
                    meta['exif_gps_lat'] = str(value)
                elif tag == 'GPSLongitude':
                    meta['exif_gps_long'] = str(value)
    except Exception as e:
        log('WARN', 'EXIF read failed', file=str(image_path), error=str(e))
    return meta


def extract_text_via_ocr(image_path: Path, ocr_url: str) -> dict:
    """用本地 OCR 服务识别员工水印（multipart/form-data）"""
    try:
        import http.client
        import mimetypes

        boundary = '----WatermarkSyncBoundary12345'
        with open(image_path, 'rb') as f:
            image_data = f.read()

        body = (
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"\r\n'
            f'Content-Type: {mimetypes.guess_type(image_path.name)[0] or "image/jpeg"}\r\n'
            f'\r\n'
        ).encode('utf-8') + image_data + f'\r\n--{boundary}--\r\n'.encode('utf-8')

        host = ocr_url.replace('http://', '').replace('https://', '').split(':')[0]
        port = int(ocr_url.split(':')[-1].split('/')[0])

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
        log('WARN', 'OCR call failed', file=str(image_path), error=str(e))
        return {}


def get_staff_id_by_name_or_id(name: Optional[str], id_str: Optional[str], mapping: dict) -> Optional[str]:
    if id_str and re.match(r'EMP\d{3}', id_str):
        return id_str
    if name:
        return mapping.get(name) or mapping.get(name.lower())
    return None


# ---- Main processing ----

def classify_and_stage(image_path: Path, scan_type_folders: dict, ocr_staging: Path) -> Path:
    """根据 scan type 分类文件到对应的 staging 目录"""
    meta = extract_metadata_from_filename(image_path.name)
    scan_type = meta.get('scan_type') or 'single_scan'
    folder_name = scan_type_folders.get(scan_type, '教育补单扫')
    target = ocr_staging / folder_name
    target.mkdir(parents=True, exist_ok=True)
    target_path = target / image_path.name
    if target_path.exists():
        # Add timestamp to avoid collision
        stem = image_path.stem
        suffix = image_path.suffix
        target_path = target / f'{stem}_{int(time.time())}{suffix}'
    shutil.copy2(image_path, target_path)
    return target_path


def call_ocr_service(image_path: Path, ocr_url: str) -> dict:
    """调用本地 OCR 服务识别字段"""
    return extract_text_via_ocr(image_path, ocr_url)


def match_sales_order(sn: Optional[str], order: Optional[str], phone: Optional[str], api_base: str) -> Optional[dict]:
    """依次尝试 SN → 订单号 → 手机号 匹配销售流水"""
    candidates = [
        ('serial', sn),
        ('order', order),
        ('phone', phone),
    ]
    for kind, value in candidates:
        if not value:
            continue
        try:
            url = f'{api_base}/api/education-scan/v2/match-{kind}/{value}'
            with urllib.request.urlopen(url, timeout=10) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('matched'):
                    return result
        except Exception as e:
            log('WARN', f'match {kind} failed', value=value, error=str(e))
    return None


def build_education_record(file_meta: dict, ocr_result: dict, match_result: Optional[dict], config: dict) -> dict:
    """构造教育补贴 record payload"""
    staff_mapping = config['staffNameMapping']
    staff_id = get_staff_id_by_name_or_id(
        file_meta.get('staff_name'),
        file_meta.get('staff_id'),
        staff_mapping
    ) or 'EMP005'  # Default to 李建定

    # Determine source group from folder
    scan_type = file_meta.get('scan_type', 'single_scan')
    if scan_type == 'three_piece':
        source_group = '智店通入库群'
        default_fee = 300
        zhixiangjin = 2000
    elif scan_type == 'two_piece':
        source_group = '智店通入库群'
        default_fee = 130
        zhixiangjin = 0
    else:
        source_group = '智店通入库群'
        default_fee = 50
        zhixiangjin = 0

    record = {
        'record_id': f'watermark-cam-{int(time.time()*1000)}-{file_meta.get("filename_hash", "")[:6]}',
        'scan_date': datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d'),
        'source_group_name': source_group,
        'scan_type': scan_type,
        'staff_id': staff_id,
        'customer_name': file_meta.get('customer_name') or (match_result or {}).get('salesOrder', {}).get('customer_name') or '未填',
        'customer_phone': file_meta.get('customer_phone') or '',
        'agent_phone': file_meta.get('agent_phone') or '',
        'product_name': (match_result or {}).get('productMaster', {}).get('canonical_name', ''),
        'sku_key': (match_result or {}).get('salesOrderLine', {}).get('sku_key', ''),
        'pn_mtm': (match_result or {}).get('salesOrderLine', {}).get('mtm_code', ''),
        'spec': (match_result or {}).get('salesOrderLine', {}).get('spec', ''),
        'category': '游戏笔记本' if scan_type in ('three_piece', 'two_piece') else '',
        'quantity': 1,
        'education_discount_amount': ocr_result.get('educationDiscount', 0) or 500,
        'service_fee_per_unit': ocr_result.get('serviceFee', 0) or default_fee,
        'zhixiangjin_amount': ocr_result.get('zhixiangjin', 0) or zhixiangjin,
        'order_number': file_meta.get('order_number') or ocr_result.get('orderNumber', '') or (match_result or {}).get('salesOrder', {}).get('id', ''),
        'serial_numbers': [(match_result or {}).get('serialNumber') or ocr_result.get('serialNumber', '')] if (match_result or {}).get('serialNumber') or ocr_result.get('serialNumber') else [],
        'voucher_code': ocr_result.get('voucherCode', ''),
        'status': '未付',
        'report_status': '今日水印相机VIP自动校准',
        'evidence_images': [],  # Already on cloud drive
        'notes': f'来源: 今日水印相机VIP | 文件: {file_meta.get("source_filename", "")}',
        'sync_status': 'pending',
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    return record


def submit_record(record: dict, api_base: str, max_retries: int = 3) -> bool:
    """提交 record 到 SQL（带重试）"""
    url = f'{api_base}/api/education-scan/v2/records'
    body = json.dumps(record).encode('utf-8')
    headers = {'Content-Type': 'application/json'}

    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('ok') or 'recordId' in result:
                    return True
                log('WARN', 'submit attempt failed', attempt=attempt, result=str(result)[:200])
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')[:300]
            log('WARN', f'submit attempt {attempt} HTTP {e.code}', body=err_body)
            if e.code < 500:
                # 4xx = client error, no retry
                log('ERROR', 'submit record HTTP error (no retry)', status=e.code, body=err_body)
                return False
        except Exception as e:
            log('WARN', f'submit attempt {attempt} exception', error=str(e))

        if attempt < max_retries:
            wait = 2 ** attempt  # 2, 4, 8 seconds
            log('INFO', f'retrying in {wait}s', attempt=attempt+1, max=max_retries)
            time.sleep(wait)

    log('ERROR', 'submit record failed after retries', max_retries=max_retries)
    return False


def process_file(image_path: Path, config: dict, dry_run: bool = False) -> dict:
    """处理单张图片：OCR + 匹配 + 提交"""
    result = {
        'file': image_path.name,
        'status': 'pending',
        'staff_id': None,
        'matched': False,
        'submitted': False,
        'errors': [],
    }
    try:
        # 1. Extract metadata
        meta = extract_metadata_from_filename(image_path.name)
        result['staff_id'] = meta.get('staff_id') or meta.get('staff_name')
        result['scan_type'] = meta.get('scan_type')

        # 2. EXIF
        exif = extract_metadata_from_exif(image_path)
        result['exif'] = exif
        if not meta.get('staff_name') and exif.get('exif_artist'):
            meta['staff_name'] = exif['exif_artist']

        # 3. OCR
        ocr_url = config['ocrService']['url']
        ocr_result = call_ocr_service(image_path, ocr_url)
        result['ocr_extracted'] = ocr_result
        if not meta.get('order_number') and ocr_result.get('orderNumber'):
            meta['order_number'] = ocr_result['orderNumber']
        if not meta.get('serial_number') and ocr_result.get('serialNumber'):
            meta['serial_number'] = ocr_result['serialNumber']
        if ocr_result.get('customerName') and not meta.get('customer_name'):
            meta['customer_name'] = ocr_result['customerName']
        if ocr_result.get('customerPhone') and not meta.get('customer_phone'):
            meta['customer_phone'] = ocr_result['customerPhone']
        if ocr_result.get('agentPhone') and not meta.get('agent_phone'):
            meta['agent_phone'] = ocr_result['agentPhone']

        # 4. Match
        api_base = config['educationApi']['url']
        match_result = match_sales_order(
            sn=meta.get('serial_number'),
            order=meta.get('order_number'),
            phone=meta.get('customer_phone'),
            api_base=api_base,
        )
        if match_result:
            result['matched'] = True
            result['match_source'] = match_result.get('matchSource')

        # 5. Build & submit record
        record = build_education_record(
            file_meta={**meta, 'source_filename': image_path.name, 'filename_hash': str(hash(image_path.name))},
            ocr_result=ocr_result,
            match_result=match_result,
            config=config,
        )

        if dry_run:
            result['status'] = 'dry_run'
            result['record_preview'] = record
            log('INFO', 'DRY RUN', file=image_path.name, sku=record.get('sku_key'))
        else:
            success = submit_record(record, api_base)
            if success:
                result['submitted'] = True
                result['status'] = 'success'
                log('INFO', 'record submitted', file=image_path.name, sku=record.get('sku_key'), order=record.get('order_number'))
            else:
                result['status'] = 'submit_failed'
                result['errors'].append('submit_failed')
                log('ERROR', 'record submit failed', file=image_path.name)
    except Exception as e:
        result['status'] = 'exception'
        result['errors'].append(str(e))
        log('ERROR', 'process file exception', file=image_path.name, error=str(e))
    return result


def move_to_processed(image_path: Path, config: dict, result: dict) -> Optional[Path]:
    """移动到 processed/{date}/{staff}/"""
    if not result.get('submitted'):
        return None
    processed_root = Path(config['pathMapping']['processedDir'])
    today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    staff = result.get('staff_id') or 'unknown'
    dest_dir = processed_root / today / staff
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / image_path.name
    if dest.exists():
        stem, suffix = image_path.stem, image_path.suffix
        dest = dest_dir / f'{stem}_{int(time.time())}{suffix}'
    try:
        shutil.move(str(image_path), str(dest))
        return dest
    except Exception as e:
        log('WARN', 'move to processed failed', error=str(e))
        return None


def move_to_failed(image_path: Path, config: dict) -> Optional[Path]:
    failed_root = Path(config['pathMapping']['failedDir'])
    today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    dest_dir = failed_root / today
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / image_path.name
    if dest.exists():
        stem, suffix = image_path.stem, image_path.suffix
        dest = dest_dir / f'{stem}_{int(time.time())}{suffix}'
    try:
        shutil.move(str(image_path), str(dest))
        return dest
    except Exception as e:
        log('WARN', 'move to failed failed', error=str(e))
        return None


def write_sync_report(results: list, config: dict) -> Path:
    """生成 sync_report_{date}.json"""
    today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    report_dir = Path(config['pathMapping']['syncReportDir'])
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f'sync_report_{today}.json'
    
    success_count = sum(1 for r in results if r.get('submitted'))
    matched_count = sum(1 for r in results if r.get('matched'))
    failed_count = len(results) - success_count
    
    report = {
        'date': today,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'total': len(results),
        'submitted': success_count,
        'matched': matched_count,
        'failed': failed_count,
        'results': results,
    }
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log('INFO', f'sync report written', path=str(report_path), total=len(results), success=success_count, matched=matched_count, failed=failed_count)
    return report_path


def scan_incoming(incoming_dir: Path) -> list:
    """扫描 incoming 目录下的新图片"""
    if not incoming_dir.exists():
        return []
    exts = {'.png', '.jpg', '.jpeg', '.webp', '.heic'}
    files = []
    for f in sorted(incoming_dir.iterdir()):
        if f.is_file() and f.suffix.lower() in exts:
            files.append(f)
    return files


def run_once(config: dict, dry_run: bool = False) -> int:
    """单次同步运行"""
    incoming = Path(config['pathMapping']['incomingDir'])
    files = scan_incoming(incoming)
    if not files:
        log('INFO', 'no new files in incoming')
        return 0
    log('INFO', f'found {len(files)} new files', dir=str(incoming))
    results = []
    for f in files:
        result = process_file(f, config, dry_run=dry_run)
        if result.get('submitted'):
            move_to_processed(f, config, result)
        elif not dry_run:
            move_to_failed(f, config)
        results.append(result)
    if not dry_run:
        write_sync_report(results, config)
    return len(results)


def main():
    parser = argparse.ArgumentParser(description='今日水印相机VIP → 本地外挂硬盘 → SQL 同步')
    parser.add_argument('--once', action='store_true', help='单次运行（默认）')
    parser.add_argument('--watch', action='store_true', help='持续监听')
    parser.add_argument('--dry-run', action='store_true', help='只处理不入库')
    parser.add_argument('--interval', type=int, default=300, help='监听间隔秒数')
    args = parser.parse_args()

    config = load_config()
    log('INFO', 'watermark camera sync starting', dry_run=args.dry_run, mode='watch' if args.watch else 'once')

    if args.watch:
        while True:
            try:
                run_once(config, dry_run=args.dry_run)
            except Exception as e:
                log('ERROR', 'loop exception', error=str(e))
            time.sleep(args.interval)
    else:
        run_once(config, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
