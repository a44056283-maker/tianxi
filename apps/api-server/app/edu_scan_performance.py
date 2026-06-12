"""
教育补贴绩效归属计算（2026-06-09）
- 扫法规则：单扫/多扫/三件套/二件套 的服务费 + 智享金金额
- 角色分成：店长 20%/10%，服务顾问 80%/90%
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# 扫法规则：服务费(单台) + 智享金(单台)
SCAN_TYPE_RULES = {
    'single_scan': {
        'label': '单扫',
        'service_fee_per_unit': 30,  # 默认教育补贴群单扫
        'zhixiangjin_amount': 0,
    },
    'multi_scan': {
        'label': '多扫',
        'service_fee_per_unit': 50,  # 智店通入库群单扫
        'zhixiangjin_amount': 0,
    },
    'three_piece': {
        'label': '三件套',
        'service_fee_per_unit': 300,
        'zhixiangjin_amount': 2000,
    },
    'two_piece': {
        'label': '两件套',
        'service_fee_per_unit': 130,
        'zhixiangjin_amount': 0,
    },
    'legion_combo': {
        'label': '拯救者双屏畅玩',
        'service_fee_per_unit': 150,
        'zhixiangjin_amount': 1000,
    },
}

# 角色分成
ROLE_SHARE = {
    'manager': {
        'label': '店长',
        'service_fee_share': 0.20,  # 服务费 20% 归店长
        'zhixiangjin_share': 0.10,  # 智享金 10% 归店长
    },
    'service_advisor': {
        'label': '服务顾问',
        'service_fee_share': 0.80,
        'zhixiangjin_share': 0.90,
    },
    'sales': {  # legacy 兼容
        'label': '销售员',
        'service_fee_share': 0.80,
        'zhixiangjin_share': 0.90,
    },
}

DB_PATH = Path(__file__).parent.parent / 'data' / 'retail-core.sqlite3'


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def calculate_and_write_performance(
    record_id: str,
    staff_id: str,
    staff_name: str,
    staff_role: str,
    scan_date: str,
    scan_type: str,
    service_fee: float,
    zhixiangjin: float,
    conn: sqlite3.Connection = None,
) -> dict[str, Any]:
    """计算并写入一条绩效归属记录（复用主调用方的 connection 避免双连接死锁）"""
    role_rule = ROLE_SHARE.get(staff_role, ROLE_SHARE['service_advisor'])
    fee_attr = round(service_fee * role_rule['service_fee_share'], 2)
    zxj_attr = round(zhixiangjin * role_rule['zhixiangjin_share'], 2)
    total_attr = fee_attr + zxj_attr
    rule_desc = f"{role_rule['label']} 分成: 服务费 {int(role_rule['service_fee_share']*100)}% + 智享金 {int(role_rule['zhixiangjin_share']*100)}%"

    if conn is None:
        # 兑底：走独立连接（但不适合有未提交事务的上下文）
        own_conn = sqlite3.connect(str(DB_PATH), timeout=30)
        try:
            return calculate_and_write_performance(
                record_id, staff_id, staff_name, staff_role,
                scan_date, scan_type, service_fee, zhixiangjin,
                conn=own_conn,
            )
        finally:
            own_conn.close()

    # upsert
    conn.execute(
        "DELETE FROM education_scan_performance WHERE record_id = ?", (record_id,)
    )
    conn.execute(
        """
        INSERT INTO education_scan_performance (
          record_id, staff_id, staff_name, staff_role, scan_date, scan_type,
          service_fee_attribution, zhixiangjin_attribution, total_attribution,
          attribution_rule, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (record_id, staff_id, staff_name, staff_role, scan_date, scan_type,
         fee_attr, zxj_attr, total_attr, rule_desc, _now_iso())
    )
    return {
        'recordId': record_id,
        'serviceFeeAttribution': fee_attr,
        'zhixiangjinAttribution': zxj_attr,
        'totalAttribution': total_attr,
        'rule': rule_desc,
    }


def get_default_service_fee(scan_type: str, source_group: str) -> float:
    """根据扫法和群获取默认服务费"""
    rule = SCAN_TYPE_RULES.get(scan_type, SCAN_TYPE_RULES['single_scan'])
    fee = rule['service_fee_per_unit']
    if scan_type == 'single_scan':
        # 单扫默认按群区分
        if source_group == '教育补贴群':
            return 30
        return 50
    return fee


def get_default_zhixiangjin(scan_type: str) -> float:
    return SCAN_TYPE_RULES.get(scan_type, {}).get('zhixiangjin_amount', 0)
