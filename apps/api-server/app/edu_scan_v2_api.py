"""
教育补贴采集 v2 API 路由（2026-06-09）
- /api/education-scan/v2/records - CRUD
- /api/education-scan/v2/calibrate/{id} - M2.7 校准
- /api/education-scan/v2/sync-to-projection - 同步至 web
- /api/education-scan/v2/stats - 全局统计
- /api/education-scan/v2/performance - 绩效归属
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from app import local_sync
from app.edu_scan_ai_calibrator import MinimaxCalibrator
from app.edu_scan_performance import calculate_and_write_performance

DB_PATH = Path(__file__).parent.parent / 'data' / 'retail-core.sqlite3'
PROJECT_ROOT = Path(__file__).resolve().parents[3]

router = APIRouter(prefix='/api/education-scan/v2', tags=['education-scan-v2'])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


# ==================== Pydantic models ====================


class EvidenceImage(BaseModel):
    imageBase64: str = ""
    imageMimeType: str = "image/jpeg"
    imageName: str = ""


class RecordCreate(BaseModel):
    record_id: Optional[str] = None
    scan_date: str
    source_group_name: str
    scan_type: str = "single_scan"  # single_scan / multi_scan / three_piece / two_piece
    staff_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    agent_phone: Optional[str] = None
    product_name: Optional[str] = None
    sku_key: Optional[str] = None
    pn_mtm: Optional[str] = None
    spec: Optional[str] = None
    category: Optional[str] = None
    quantity: int = 1
    education_discount_amount: float = 0
    service_fee_per_unit: float = 0
    zhixiangjin_amount: float = 0
    order_number: Optional[str] = None
    outbound_date: Optional[str] = None
    outbound_store_name: Optional[str] = None
    outbound_operator_name: Optional[str] = None
    serial_numbers: list[str] = Field(default_factory=list)
    voucher_code: Optional[str] = None
    voucher_verified_at: Optional[str] = None
    status: str = "未付"
    report_status: str = "本地录入"
    evidence_images: list[EvidenceImage] = Field(default_factory=list)
    notes: Optional[str] = None


class RecordPatch(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    calibration_source: str = "manual:admin"
    notes: Optional[str] = None


# ==================== Helper ====================


def _scan_type_label(scan_type: str) -> str:
    return {
        'single_scan': '单扫',
        'multi_scan': '多扫',
        'three_piece': '三件套',
        'two_piece': '二件套',
        'legion_combo': '拯救者双屏畅玩',
    }.get(scan_type, scan_type)


def _normalize_record(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    # 解析 JSON 字段
    for k in ('serial_numbers_json', 'evidence_images_json', 'ai_calibration_json', 'raw_payload_json'):
        if k in d and isinstance(d[k], str):
            try:
                d[k.replace('_json', '')] = json.loads(d[k]) if d[k] else []
            except json.JSONDecodeError:
                d[k.replace('_json', '')] = []
    source_group_name = str(d.get('source_group_name') or '').strip()
    scan_type = str(d.get('scan_type') or 'single_scan').strip() or 'single_scan'
    quantity = max(int(d.get('quantity') or 1), 1)
    serials = d.get('serial_numbers') if isinstance(d.get('serial_numbers'), list) else []
    product_name = str(d.get('product_name') or '').strip().lower()
    placeholder_values = {'', '待补', '待补商品', '待补型号', '手机', '机型', 'unknown', '--', 'none'}
    has_billable_unit = bool(
        serials
        or (product_name and product_name not in placeholder_values)
        or str(d.get('sku_key') or '').strip()
        or str(d.get('pn_mtm') or '').strip()
        or str(d.get('order_number') or '').strip()
        or str(d.get('voucher_code') or '').strip()
    )
    service_like = any(keyword in product_name for keyword in ('延保', '服务', '保险', '会员', '智惠', '保修'))
    fee_scope = 'bundle' if scan_type in {'two_piece', 'three_piece', 'dual_screen_two_piece'} else 'unit'
    d['ruleVersion'] = 'education-subsidy-agent-scan-v2.0.0'
    d['feeScope'] = fee_scope
    d['evidenceLevel'] = 'billable' if has_billable_unit and not service_like else 'evidence_only'
    d['classificationStatus'] = 'service_filtered' if service_like else ('formal_candidate' if has_billable_unit else 'evidence_only')
    d['reviewStatus'] = str(d.get('review_status') or 'pending')
    d['total_service_fee'] = float(d.get('total_service_fee') or (float(d.get('service_fee_per_unit') or 0) * quantity))
    d['total_education_discount_amount'] = float(d.get('total_education_discount_amount') or (float(d.get('education_discount_amount') or 0) * quantity))
    if source_group_name == '教育补贴群' and scan_type == 'single_scan' and has_billable_unit:
        d['service_fee_per_unit'] = 30.0
        d['total_service_fee'] = 30.0 * quantity
    elif source_group_name == '智店通入库群' and scan_type == 'single_scan' and has_billable_unit and float(d.get('service_fee_per_unit') or 0) <= 0:
        d['service_fee_per_unit'] = 50.0
        d['total_service_fee'] = 50.0 * quantity
    if fee_scope == 'bundle' and float(d.get('service_fee_per_unit') or 0) > 0 and not d.get('bundle_charge_applied'):
        d['bundle_charge_applied'] = 1
    return d


# ==================== Routes ====================


@router.post('/records')
def create_record(payload: RecordCreate) -> dict[str, Any]:
    """员工手机端保存一条记录"""
    conn = _get_conn()
    try:
        # 查员工
        staff = conn.execute(
            "SELECT id, name, role FROM staff WHERE id = ?", (payload.staff_id,)
        ).fetchone()
        if not staff:
            raise HTTPException(404, f'员工 {payload.staff_id} 不存在')
        staff_name = staff['name']
        staff_role = staff['role']

        # 生成 record_id
        import uuid
        record_id = payload.record_id or f'edu-scan-{payload.scan_date.replace("-","")}-{uuid.uuid4().hex[:8].upper()}'
        scan_timestamp = _now_iso()
        scan_type_label = _scan_type_label(payload.scan_type)

        # 计算总额
        total_education = payload.education_discount_amount * payload.quantity
        total_service_fee = payload.service_fee_per_unit * payload.quantity
        total_zhixiangjin = payload.zhixiangjin_amount * payload.quantity

        # 写主表
        conn.execute(
            """
            INSERT INTO education_scan_record_v2 (
              record_id, scan_date, scan_timestamp, source_group_name, scan_type, scan_type_label,
              staff_id, staff_name, staff_role, customer_name, customer_phone, agent_phone,
              product_name, sku_key, pn_mtm, spec, category, quantity,
              education_discount_amount, total_education_discount_amount,
              service_fee_per_unit, total_service_fee, zhixiangjin_amount,
              order_number, outbound_date, outbound_store_name, outbound_operator_name,
              serial_numbers_json, voucher_code, voucher_verified_at,
              status, report_status, evidence_images_json,
              source_file, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id, payload.scan_date, scan_timestamp, payload.source_group_name,
                payload.scan_type, scan_type_label, payload.staff_id, staff_name, staff_role,
                payload.customer_name, payload.customer_phone, payload.agent_phone,
                payload.product_name, payload.sku_key, payload.pn_mtm, payload.spec,
                payload.category, payload.quantity,
                payload.education_discount_amount, total_education,
                payload.service_fee_per_unit, total_service_fee, total_zhixiangjin,
                payload.order_number, payload.outbound_date, payload.outbound_store_name,
                payload.outbound_operator_name,
                json.dumps(payload.serial_numbers, ensure_ascii=False),
                payload.voucher_code, payload.voucher_verified_at,
                payload.status, payload.report_status,
                json.dumps([e.dict() for e in payload.evidence_images], ensure_ascii=False),
                f'mobile://{payload.staff_id}/{payload.scan_date.replace("-","")}',
                scan_timestamp, scan_timestamp,
            )
        )

        # 写证据表
        for ev in payload.evidence_images:
            if ev.imageBase64:
                size = len(ev.imageBase64) * 3 // 4  # base64 → bytes 估算
                conn.execute(
                    """
                    INSERT INTO education_scan_evidence (
                      record_id, image_path, image_name, image_mime_type, image_size_bytes, uploaded_by, uploaded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (record_id, ev.imageName, ev.imageName, ev.imageMimeType, size, payload.staff_id, scan_timestamp)
                )

        # 写校准日志
        conn.execute(
            """
            INSERT INTO education_scan_calibration_log (
              record_id, calibration_source, calibration_kind, after_json, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (record_id, f'mobile:{payload.staff_id}', 'initial_create',
             json.dumps({'productName': payload.product_name, 'serviceFeePerUnit': payload.service_fee_per_unit,
                         'zhixiangjinAmount': payload.zhixiangjin_amount}, ensure_ascii=False),
             payload.notes or '员工手机端首次录入', scan_timestamp)
        )

        # 自动计算绩效归属（复用主连接避免双连接死锁）
        calculate_and_write_performance(
            record_id=record_id,
            staff_id=payload.staff_id,
            staff_name=staff_name,
            staff_role=staff_role,
            scan_date=payload.scan_date,
            scan_type=payload.scan_type,
            service_fee=total_service_fee,
            zhixiangjin=total_zhixiangjin,
            conn=conn,
        )

        conn.commit()
        return {
            'ok': True,
            'recordId': record_id,
            'syncStatus': 'local',
            'staffId': payload.staff_id,
            'staffName': staff_name,
            'staffRole': staff_role,
            'totalServiceFee': total_service_fee,
            'totalZhixiangjin': total_zhixiangjin,
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f'保存失败: {e}')
    finally:
        conn.close()


@router.get('/records')
def list_records(
    staff_id: Optional[str] = None,
    scan_date_from: Optional[str] = None,
    scan_date_to: Optional[str] = None,
    status: Optional[str] = None,
    source_group_name: Optional[str] = None,
    scan_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """查询记录列表"""
    conn = _get_conn()
    try:
        where = ['1=1']
        params = []
        if staff_id:
            where.append('staff_id = ?')
            params.append(staff_id)
        if scan_date_from:
            where.append('scan_date >= ?')
            params.append(scan_date_from)
        if scan_date_to:
            where.append('scan_date <= ?')
            params.append(scan_date_to)
        if status:
            where.append('status = ?')
            params.append(status)
        if source_group_name:
            where.append('source_group_name = ?')
            params.append(source_group_name)
        if scan_type:
            where.append('scan_type = ?')
            params.append(scan_type)
        where_sql = ' AND '.join(where)

        total = conn.execute(f'SELECT COUNT(*) FROM education_scan_record_v2 WHERE {where_sql}', params).fetchone()[0]
        offset = (max(page, 1) - 1) * max(page_size, 1)
        rows = conn.execute(
            f'SELECT * FROM education_scan_record_v2 WHERE {where_sql} ORDER BY scan_timestamp DESC LIMIT ? OFFSET ?',
            params + [page_size, offset]
        ).fetchall()
        items = [_normalize_record(r) for r in rows]
        return {
            'total': total,
            'page': page,
            'pageSize': page_size,
            'items': items,
        }
    finally:
        conn.close()


@router.get('/records/{record_id}')
def get_record(record_id: str) -> dict[str, Any]:
    """查询单条记录 + 校准日志 + 证据"""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM education_scan_record_v2 WHERE record_id = ?", (record_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, f'记录 {record_id} 不存在')
        record = _normalize_record(row)
        # 校准日志
        log_rows = conn.execute(
            "SELECT * FROM education_scan_calibration_log WHERE record_id = ? ORDER BY created_at DESC",
            (record_id,)
        ).fetchall()
        record['calibrationLog'] = [dict(r) for r in log_rows]
        # 证据
        ev_rows = conn.execute(
            "SELECT * FROM education_scan_evidence WHERE record_id = ? ORDER BY uploaded_at DESC",
            (record_id,)
        ).fetchall()
        record['evidenceFiles'] = [dict(r) for r in ev_rows]
        # 绩效
        perf_row = conn.execute(
            "SELECT * FROM education_scan_performance WHERE record_id = ?", (record_id,)
        ).fetchone()
        if perf_row:
            record['performance'] = dict(perf_row)
        return record
    finally:
        conn.close()


@router.patch('/records/{record_id}')
def patch_record(record_id: str, payload: RecordPatch) -> dict[str, Any]:
    """手动编辑记录（管理端或手机端手动校准）"""
    conn = _get_conn()
    try:
        # 查原值
        old_row = conn.execute(
            "SELECT * FROM education_scan_record_v2 WHERE record_id = ?", (record_id,)
        ).fetchone()
        if not old_row:
            raise HTTPException(404, f'记录 {record_id} 不存在')
        old = dict(old_row)

        # 白名单字段
        allowed = {
            'source_group_name', 'scan_type', 'scan_date',
            'customer_name', 'customer_phone', 'agent_phone', 'product_name',
            'sku_key', 'pn_mtm', 'spec', 'category', 'quantity',
            'education_discount_amount', 'service_fee_per_unit', 'zhixiangjin_amount',
            'order_number', 'outbound_date', 'voucher_code', 'voucher_verified_at',
            'status', 'report_status', 'review_status',
        }
        updates = {k: v for k, v in payload.fields.items() if k in allowed}
        if not updates:
            return {'ok': True, 'changedFields': []}

        # 重新计算总额
        new_quantity = updates.get('quantity', old['quantity'])
        new_edu = updates.get('education_discount_amount', old['education_discount_amount'])
        new_fee = updates.get('service_fee_per_unit', old['service_fee_per_unit'])
        new_zxj = updates.get('zhixiangjin_amount', old['zhixiangjin_amount'])
        updates['total_education_discount_amount'] = new_edu * new_quantity
        updates['total_service_fee'] = new_fee * new_quantity
        updates['zhixiangjin_amount'] = new_zxj
        if 'scan_type' in updates:
            updates['scan_type_label'] = _scan_type_label(str(updates['scan_type']))
        if 'review_status' in updates:
            updates['reviewed_at'] = _now_iso()
            updates['reviewed_by'] = payload.calibration_source
        updates['updated_at'] = _now_iso()

        # 应用更新
        set_clause = ', '.join(f'{k} = ?' for k in updates)
        params = list(updates.values()) + [record_id]
        conn.execute(f'UPDATE education_scan_record_v2 SET {set_clause} WHERE record_id = ?', params)

        # 写校准日志
        new_row = conn.execute(
            "SELECT * FROM education_scan_record_v2 WHERE record_id = ?", (record_id,)
        ).fetchone()
        new = dict(new_row)
        diff_fields = []
        for k in updates:
            if k in old and old[k] != new.get(k):
                diff_fields.append(f'{k}: {old[k]} → {new.get(k)}')
        conn.execute(
            """
            INSERT INTO education_scan_calibration_log (
              record_id, calibration_source, calibration_kind, before_json, after_json, diff_summary, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (record_id, payload.calibration_source, 'manual_edit',
             json.dumps({k: old.get(k) for k in updates}, ensure_ascii=False, default=str),
             json.dumps({k: new.get(k) for k in updates}, ensure_ascii=False, default=str),
             '; '.join(diff_fields),
             payload.notes or '手动编辑',
             _now_iso())
        )

        # 重算绩效（复用主连接避免双连接死锁）
        calculate_and_write_performance(
            record_id=record_id,
            staff_id=old['staff_id'],
            staff_name=old['staff_name'],
            staff_role=old['staff_role'],
            scan_date=new['scan_date'],
            scan_type=new['scan_type'],
            service_fee=new['total_service_fee'],
            zhixiangjin=new['zhixiangjin_amount'],
            conn=conn,
        )

        conn.commit()
        return {
            'ok': True,
            'changedFields': diff_fields,
            'record': _normalize_record(new_row),
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f'更新失败: {e}')
    finally:
        conn.close()


@router.post('/calibrate/{record_id}')
def calibrate_record(record_id: str) -> dict[str, Any]:
    """用 Minimax-M2.7 自动校准记录"""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM education_scan_record_v2 WHERE record_id = ?", (record_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, f'记录 {record_id} 不存在')
        record = _normalize_record(row)
        evidence_files = conn.execute(
            "SELECT * FROM education_scan_evidence WHERE record_id = ?", (record_id,)
        ).fetchall()
        evidence_list = [dict(r) for r in evidence_files]
        if not evidence_list:
            return {'ok': False, 'status': 'failed', 'reason': 'no_evidence',
                    'message': '没有图片证据，无法自动校准'}

        # 调用 M2.7
        calibrator = MinimaxCalibrator()
        try:
            result = calibrator.calibrate(record, evidence_list)
        except Exception as e:
            return {'ok': False, 'status': 'failed', 'reason': 'm27_error',
                    'message': f'M2.7 调用失败: {e}'}

        if not result.get('extracted'):
            return {'ok': False, 'status': 'failed', 'reason': 'no_extraction',
                    'message': 'M2.7 未提取到有效字段'}

        # 应用校准结果
        extracted = result['extracted']
        update_fields = {}
        if extracted.get('orderNumber') and not record.get('order_number'):
            update_fields['order_number'] = extracted['orderNumber']
        if extracted.get('customerName') and not record.get('customer_name'):
            update_fields['customer_name'] = extracted['customerName']
        if extracted.get('customerPhone') and not record.get('customer_phone'):
            update_fields['customer_phone'] = extracted['customerPhone']
        if extracted.get('serialNumber'):
            serials = record.get('serialNumbers') or []
            if extracted['serialNumber'] not in serials:
                update_fields['serial_numbers'] = serials + [extracted['serialNumber']]
        if extracted.get('voucherCode') and not record.get('voucher_code'):
            update_fields['voucher_code'] = extracted['voucherCode']

        # 金额校准（如果 AI 提取的与现有差异 > 0，记录但不覆盖）
        ai_discount = extracted.get('educationDiscount', 0)
        ai_fee = extracted.get('serviceFee', 0)
        ai_zxj = extracted.get('zhixiangjin', 0)
        if ai_discount and abs(ai_discount - (record.get('education_discount_amount') or 0)) > 0:
            # 标记差异，让管理员决定
            update_fields['ai_calibration_status'] = 'pending_review'
        if ai_fee and abs(ai_fee - (record.get('service_fee_per_unit') or 0)) > 0:
            update_fields['ai_calibration_status'] = 'pending_review'
        if ai_zxj and abs(ai_zxj - (record.get('zhixiangjin_amount') or 0)) > 0:
            update_fields['ai_calibration_status'] = 'pending_review'

        update_fields['ai_calibration_json'] = json.dumps(extracted, ensure_ascii=False)
        update_fields['ai_calibrated_at'] = _now_iso()
        update_fields['ai_calibrated_by'] = 'Minimax-M2.7'
        update_fields['ai_calibration_status'] = update_fields.get('ai_calibration_status', 'calibrated')

        # 写日志 + UPDATE
        diff = []
        for k, v in update_fields.items():
            diff.append(f'{k}={v}')
        conn.execute(
            """
            INSERT INTO education_scan_calibration_log (
              record_id, calibration_source, calibration_kind, before_json, after_json, diff_summary, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (record_id, 'Minimax-M2.7', 'ai_extraction',
             json.dumps({'order_number': record.get('order_number'), 'customer_name': record.get('customer_name')}, ensure_ascii=False, default=str),
             json.dumps(extracted, ensure_ascii=False),
             '; '.join(diff),
             _now_iso())
        )

        set_clause = ', '.join(f'{k} = ?' for k in update_fields)
        params = [json.dumps(v) if k.endswith('_json') else v for k, v in update_fields.items()] + [record_id]
        conn.execute(f'UPDATE education_scan_record_v2 SET {set_clause} WHERE record_id = ?', params)
        conn.commit()

        return {
            'ok': True,
            'status': update_fields.get('ai_calibration_status'),
            'extracted': extracted,
            'confidence': result.get('confidence'),
            'changedFields': diff,
        }
    finally:
        conn.close()


@router.post('/sync-to-projection')
def sync_to_projection() -> dict[str, Any]:
    """按当前主链重建教育补汇总并写回前端/制品快照"""
    written = local_sync.write_static_snapshots(PROJECT_ROOT / 'apps' / 'web-cockpit' / 'public' / 'data')
    targets = [
        PROJECT_ROOT / 'apps' / 'web-cockpit' / 'public' / 'data' / 'latest-education-subsidy-agent-scan-summary.json',
        PROJECT_ROOT / 'apps' / 'inventory-sync' / 'artifacts' / 'latest-education-subsidy-agent-scan-summary.json',
    ]
    payload = {}
    if targets[0].exists():
        payload = json.loads(targets[0].read_text(encoding='utf-8'))
    return {
        'ok': True,
        'totalRows': len(payload.get('rows') or []),
        'summary': payload.get('summary') or {},
        'filesWritten': [str(p) for p in targets if p.exists()],
        'writtenCount': len(written),
    }


@router.get('/stats')
def get_stats(
    scan_date_from: Optional[str] = None,
    scan_date_to: Optional[str] = None,
) -> dict[str, Any]:
    """全局统计（兼容 v1 summary 接口）"""
    conn = _get_conn()
    try:
        where = ['1=1']
        params = []
        if scan_date_from:
            where.append('scan_date >= ?')
            params.append(scan_date_from)
        if scan_date_to:
            where.append('scan_date <= ?')
            params.append(scan_date_to)
        where_sql = ' AND '.join(where)

        rows = conn.execute(
            f'SELECT * FROM education_scan_record_v2 WHERE {where_sql}', params
        ).fetchall()

        from collections import Counter
        groups = Counter(r['source_group_name'] for r in rows)
        statuses = Counter(r['status'] for r in rows)
        types = Counter(r['scan_type'] for r in rows)
        staff = Counter(r['staff_id'] for r in rows)

        return {
            'totalCount': len(rows),
            'unpaidCount': sum(1 for r in rows if r['status'] == '未付'),
            'paidCount': sum(1 for r in rows if r['status'] == '已收款'),
            'totalEducationDiscountAmount': sum(r['total_education_discount_amount'] or 0 for r in rows),
            'totalServiceFee': sum(r['total_service_fee'] or 0 for r in rows),
            'unpaidServiceFee': sum(r['total_service_fee'] or 0 for r in rows if r['status'] == '未付'),
            'totalZhixiangjin': sum(r['zhixiangjin_amount'] or 0 for r in rows),
            'byGroup': dict(groups),
            'byStatus': dict(statuses),
            'byType': dict(types),
            'byStaff': dict(staff),
        }
    finally:
        conn.close()


@router.get('/performance')
def get_performance(
    staff_id: Optional[str] = None,
    scan_date_from: Optional[str] = None,
    scan_date_to: Optional[str] = None,
) -> dict[str, Any]:
    """绩效归属查询"""
    conn = _get_conn()
    try:
        where = ['1=1']
        params = []
        if staff_id:
            where.append('staff_id = ?')
            params.append(staff_id)
        if scan_date_from:
            where.append('scan_date >= ?')
            params.append(scan_date_from)
        if scan_date_to:
            where.append('scan_date <= ?')
            params.append(scan_date_to)
        where_sql = ' AND '.join(where)

        rows = conn.execute(
            f'SELECT staff_id, staff_name, staff_role, scan_type, '
            f'SUM(service_fee_attribution) AS total_service_fee, '
            f'SUM(zhixiangjin_attribution) AS total_zhixiangjin, '
            f'SUM(total_attribution) AS total, '
            f'COUNT(*) AS record_count '
            f'FROM education_scan_performance WHERE {where_sql} '
            f'GROUP BY staff_id, staff_role, scan_type '
            f'ORDER BY staff_id, scan_type',
            params
        ).fetchall()
        return {
            'rows': [dict(r) for r in rows],
            'totals': {
                'recordCount': sum(r['record_count'] for r in rows),
                'totalServiceFee': sum(r['total_service_fee'] or 0 for r in rows),
                'totalZhixiangjin': sum(r['total_zhixiangjin'] or 0 for r in rows),
                'totalAttribution': sum(r['total'] or 0 for r in rows),
            }
        }
    finally:
        conn.close()


@router.get('/staff')
def list_staff(role: Optional[str] = None) -> dict[str, Any]:
    """员工列表（移动端选择用）"""
    conn = _get_conn()
    try:
        if role:
            rows = conn.execute(
                "SELECT id, name, role, active FROM staff WHERE active = 1 AND role = ? ORDER BY id",
                (role,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, role, active FROM staff WHERE active = 1 ORDER BY id"
            ).fetchall()
        return {
            'items': [dict(r) for r in rows]
        }
    finally:
        conn.close()


@router.get('/match-serial/{serial_number}')
def match_serial(serial_number: str) -> dict[str, Any]:
    """
    SN 智能匹配：从 sales_order_line 查 serial_number，关联 sales_order 和 product_master
    返回：
    - matched: 是否找到匹配
    - matchSource: 'sales_order_line' / 'sales_order' / 'product_master' / 'none'
    - confidence: 匹配置信度 0-1
    - 完整订单/产品信息
    """
    conn = _get_conn()
    try:
        sn = serial_number.strip()
        if not sn:
            raise HTTPException(400, 'SN 不能为空')

        result = {
            'matched': False,
            'matchSource': 'none',
            'confidence': 0,
            'serialNumber': sn,
            'salesOrder': None,
            'salesOrderLine': None,
            'productMaster': None,
            'alreadyScanned': False,
            'scannedRecords': [],
        }

        # 1. 查询 sales_order_line（按 SN 精确匹配）
        line_row = conn.execute(
            """
            SELECT id, order_id, sku_key, product_name, product_no, mtm_code, spec,
                   quantity, deal_price, pay_amount, discount_amount, serial_numbers_json, created_at
            FROM sales_order_line
            WHERE serial_number = ? OR serial_numbers_json LIKE ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (sn, f'%{sn}%')
        ).fetchone()

        if line_row:
            line = dict(line_row)
            result['salesOrderLine'] = line
            result['matched'] = True
            result['matchSource'] = 'sales_order_line'
            result['confidence'] = 0.95

            # 2. 关联 sales_order
            order_row = conn.execute(
                """
                SELECT id, external_order_no, customer_name, business_date, total_amount,
                       pay_amount, status, status_name, operator_id, cashier_name, store_code, shop_name
                FROM sales_order WHERE id = ?
                """,
                (line['order_id'],)
            ).fetchone()
            if order_row:
                result['salesOrder'] = dict(order_row)

            # 3. 关联 product_master
            if line['sku_key']:
                pm_row = conn.execute(
                    "SELECT id, canonical_name, brand, default_category, primary_sku_key FROM product_master WHERE id = ?",
                    (f"PROD-{line['sku_key']}",)
                ).fetchone()
                if pm_row:
                    result['productMaster'] = dict(pm_row)

            # 4. 检查是否已被代扫过
            scanned = conn.execute(
                """
                SELECT record_id, scan_date, source_group_name, service_fee_per_unit
                FROM education_agent_scan_raw
                WHERE serial_numbers_json LIKE ? OR order_number = ?
                ORDER BY scan_date DESC LIMIT 5
                """,
                (f'%{sn}%', line['order_id'])
            ).fetchall()
            if scanned:
                result['alreadyScanned'] = True
                result['scannedRecords'] = [dict(r) for r in scanned]
        else:
            # 5. 退路：尝试 product_master 用 SN 的 PN/MTM 反查（SN 可能不是 order line 里的）
            pm_row = conn.execute(
                "SELECT id, canonical_name, brand, default_category, primary_sku_key FROM product_master WHERE id LIKE ? OR canonical_name LIKE ? LIMIT 1",
                (f'%{sn}%', f'%{sn}%')
            ).fetchone()
            if pm_row:
                result['productMaster'] = dict(pm_row)
                result['matchSource'] = 'product_master'
                result['confidence'] = 0.4
                # 不算完全匹配，matched=False

        return result
    finally:
        conn.close()


@router.get('/match-order/{order_number}')
def match_order(order_number: str) -> dict[str, Any]:
    """
    订单号智能匹配：从 sales_order 查 external_order_no / id，关联 line 和 product
    """
    conn = _get_conn()
    try:
        on = order_number.strip()
        if not on:
            raise HTTPException(400, '订单号不能为空')

        result = {
            'matched': False,
            'matchSource': 'none',
            'confidence': 0,
            'orderNumber': on,
            'salesOrder': None,
            'salesOrderLines': [],
            'alreadyScanned': False,
        }

        order_row = conn.execute(
            """
            SELECT id, external_order_no, customer_name, business_date,
                   total_amount, pay_amount, status, status_name, operator_id, cashier_name, store_code
            FROM sales_order WHERE id = ? OR external_order_no = ?
            """,
            (on, on)
        ).fetchone()

        if not order_row:
            return result

        result['salesOrder'] = dict(order_row)
        result['matched'] = True
        result['matchSource'] = 'sales_order'
        result['confidence'] = 0.95

        # 取该订单的所有 line
        line_rows = conn.execute(
            """
            SELECT id, order_id, sku_key, product_name, mtm_code, spec, quantity,
                   deal_price, serial_number, created_at
            FROM sales_order_line WHERE order_id = ?
            """,
            (order_row['id'],)
        ).fetchall()
        result['salesOrderLines'] = [dict(r) for r in line_rows]

        # 关联第一个 product_master
        if line_rows:
            first_line = line_rows[0]
            if first_line['sku_key']:
                pm_row = conn.execute(
                    "SELECT id, canonical_name, brand, default_category FROM product_master WHERE id = ?",
                    (f"PROD-{first_line['sku_key']}",)
                ).fetchone()
                if pm_row:
                    result['productMaster'] = dict(pm_row)

        # 检查是否已代扫
        scanned = conn.execute(
            "SELECT record_id, scan_date, source_group_name FROM education_agent_scan_raw WHERE order_number = ? LIMIT 5",
            (order_row['id'],)
        ).fetchall()
        if scanned:
            result['alreadyScanned'] = True
            result['scannedRecords'] = [dict(r) for r in scanned]

        return result
    finally:
        conn.close()


@router.get('/match-phone/{phone}')
def match_phone(phone: str) -> dict[str, Any]:
    """
    手机号匹配：从 sales_order.customer_phone (or raw_payload) 查最近订单
    实际 customer_phone 不一定存，但能从 outbound 中查
    """
    conn = _get_conn()
    try:
        ph = phone.strip()
        if not ph or len(ph) < 8:
            return {'matched': False, 'phone': ph, 'orders': []}
        # 手机号可能在 raw_payload_json 中
        rows = conn.execute(
            "SELECT id, customer_name, business_date, total_amount FROM sales_order WHERE business_date >= '2026-01-01' ORDER BY business_date DESC LIMIT 50"
        ).fetchall()
        # 由于 sales_order 没有 customer_phone 列，搜索 raw_payload
        import json as _json
        matched = []
        for r in rows:
            raw = conn.execute(
                "SELECT raw_payload_json FROM sales_order WHERE id = ?", (r['id'],)
            ).fetchone()
            if raw and raw[0]:
                try:
                    payload = _json.loads(raw[0])
                    phone_in = str(payload.get('customerPhone') or '')
                    if ph in phone_in:
                        matched.append(dict(r))
                except:
                    continue
        return {
            'matched': len(matched) > 0,
            'phone': ph,
            'orders': matched[:5],
        }
    finally:
        conn.close()
