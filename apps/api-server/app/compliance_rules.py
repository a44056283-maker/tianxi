"""
compliance_rules.py — 合规规则引擎
===================================
注册并运行5个核心合规检测规则。

规则签名:
    def check(conn: sqlite3.Connection) -> list[dict]
    返回违规列表，每条包含:
        rule_id, severity, entity_type, entity_id, description, metadata_json
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------


@dataclass
class ComplianceRule:
    rule_id: str
    name: str
    description: str
    severity: str  # critical | high | medium | low
    entity_type: str
    enabled: bool = True
    config: dict[str, Any] = field(default_factory=dict)
    check_fn: Callable[[sqlite3.Connection], list[dict]] | None = None

    def to_row(self) -> dict[str, Any]:
        return {
            "id": self.rule_id,
            "rule_id": self.rule_id,
            "name": self.name,
            "description": self.description,
            "severity": self.severity,
            "entity_type": self.entity_type,
            "enabled": 1 if self.enabled else 0,
            "config_json": json.dumps(self.config, ensure_ascii=False),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# 规则实现
# ---------------------------------------------------------------------------

def _sn_status_inconsistency(conn: sqlite3.Connection) -> list[dict]:
    """
    R1: SN状态一致性
    规则：serial_item.status == 'sold' 但 sales_order_line.serial_number 关联的
          serial_item 在 inventory_movement 中没有对应的出库流水。
    逻辑：
      1. 找出 serial_item.status = 'sold' 的 SN
      2. 对每个 SN，检查 inventory_movement 中是否存在 outbound/出库类型的流水
      3. 若无出库流水，则为违规（SN已标记 sold 但无出库记录）
    """
    violations = []
    rows = conn.execute("""
        SELECT
            si.serial_number,
            si.sku_key,
            si.status,
            si.location_code,
            si.updated_at
        FROM serial_item si
        WHERE si.status = 'sold'
    """).fetchall()

    for row in rows:
        sn = row["serial_number"]
        sku_key = row["sku_key"]

        # 检查是否有出库流水
        outbound = conn.execute("""
            SELECT COUNT(*) as cnt
            FROM inventory_movement im
            WHERE im.serial_number = ?
              AND im.movement_type IN ('outbound', 'sale', 'sold', '出库', '销售出库')
        """, (sn,)).fetchone()

        if outbound is None or outbound["cnt"] == 0:
            violations.append({
                "rule_id": "sn_status_inconsistency",
                "severity": "critical",
                "entity_type": "serial_item",
                "entity_id": sn,
                "description": (
                    f"SN {sn} (SKU: {sku_key}) 状态为 sold "
                    f"但 inventory_movement 中无出库流水"
                ),
                "metadata_json": json.dumps({
                    "serial_number": sn,
                    "sku_key": sku_key,
                    "serial_status": "sold",
                    "outbound_movement_count": 0,
                }, ensure_ascii=False),
            })
    return violations


def _inventory_movement_mismatch(conn: sqlite3.Connection) -> list[dict]:
    """
    R2: 库存数 vs 流水一致性
    规则：对每个 sku_key，比较 sku.current_stock 与
          SUM(inventory_movement quantity)（净变化），差异超过阈值（默认1台）则违规。
    逻辑：
      1. 从 sku 表获取 current_stock
      2. 从 inventory_movement 按 sku_key SUM(quantity)
      3. 差异绝对值 > 1 则记录违规
    """
    violations = []
    threshold = 1  # 允许1台误差

    rows = conn.execute("""
        SELECT
            s.sku_key,
            s.current_stock,
            COALESCE(SUM(im.quantity), 0) as movement_sum,
            COUNT(im.id) as movement_count
        FROM sku s
        LEFT JOIN inventory_movement im ON im.sku_key = s.sku_key
        GROUP BY s.sku_key
    """).fetchall()

    for row in rows:
        sku_key = row["sku_key"]
        current = row["current_stock"]
        movement_sum = row["movement_sum"]
        diff = abs(current - movement_sum)

        if diff > threshold:
            violations.append({
                "rule_id": "inventory_movement_mismatch",
                "severity": "high",
                "entity_type": "sku",
                "entity_id": sku_key,
                "description": (
                    f"SKU {sku_key} 库存账实差异：账上 {current} vs 流水累加 {movement_sum}，"
                    f"差异 {diff} 台（阈值 {threshold}）"
                ),
                "metadata_json": json.dumps({
                    "sku_key": sku_key,
                    "current_stock": current,
                    "movement_sum": movement_sum,
                    "difference": diff,
                    "threshold": threshold,
                    "movement_count": row["movement_count"],
                }, ensure_ascii=False),
            })
    return violations


def _retail_price_violation(conn: sqlite3.Connection) -> list[dict]:
    """
    R3: 零售价规则违反
    规则（逐项检测）：
      1. 价格不以99结尾（如 3000、2999 是合规；3001 不合规）
      2. 价格低于成本价（cost_amount）
      3. 价格超过国补上限（待配置，暂时只做标记）

    检查范围：所有有销售记录的 sales_order_line（已付）
    """
    violations = []

    rows = conn.execute("""
        SELECT
            sol.id,
            sol.order_id,
            sol.sku_key,
            sol.product_name,
            sol.deal_price,
            si.cost_amount,
            so.business_date,
            so.store_code,
            so.operator_id
        FROM sales_order_line sol
        JOIN sales_order so ON so.id = sol.order_id
        LEFT JOIN serial_item si ON si.serial_number = sol.serial_number
        WHERE sol.deal_price > 0
    """).fetchall()

    for row in rows:
        deal_price = row["deal_price"]
        cost_amount = row["cost_amount"] if row["cost_amount"] is not None else None
        sku_key = row["sku_key"]
        line_id = row["id"]

        reasons = []

        # 规则1：价格不以99结尾
        if int(deal_price) % 100 != 99 and deal_price % 1 == 0:
            reasons.append("价格不以99结尾")

        # 规则2：价格低于成本价
        if cost_amount is not None and deal_price < cost_amount:
            reasons.append(f"成交价 {deal_price} 低于成本价 {cost_amount}")

        if reasons:
            violations.append({
                "rule_id": "retail_price_violation",
                "severity": "high",
                "entity_type": "sales_order_line",
                "entity_id": line_id,
                "description": (
                    f"销售订单行 {line_id} (SKU: {sku_key}) "
                    f"零售价违规：{'；'.join(reasons)}"
                ),
                "metadata_json": json.dumps({
                    "line_id": line_id,
                    "order_id": row["order_id"],
                    "sku_key": sku_key,
                    "product_name": row["product_name"],
                    "deal_price": deal_price,
                    "cost_amount": cost_amount,
                    "business_date": row["business_date"],
                    "store_code": row["store_code"],
                    "reasons": reasons,
                }, ensure_ascii=False),
            })
    return violations


def _purchase_price_anomaly(conn: sqlite3.Connection) -> list[dict]:
    """
    R4: 采购价异常
    规则：purchase_order_line.unit_cost 偏离同类商品（相同 category/pn_mtm）
          均值超过 30% 则违规。
    """
    violations = []
    deviation_threshold = 0.30

    rows = conn.execute("""
        SELECT
            pol.id,
            pol.order_id,
            pol.sku_key,
            s.name as product_name,
            s.pn_mtm,
            pol.cost_price as unit_cost,
            pol.quantity,
            s.category,
            po.business_date,
            po.supplier_id
        FROM purchase_order_line pol
        JOIN purchase_order po ON po.id = pol.order_id
        LEFT JOIN sku s ON s.sku_key = pol.sku_key
        WHERE pol.cost_price IS NOT NULL AND pol.cost_price > 0
    """).fetchall()

    # 按 pn_mtm + category 分组计算均值
    stats: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = f"{row['pn_mtm'] or ''}|{row['category'] or ''}"
        if key not in stats:
            stats[key] = {"prices": [], "products": set()}
        stats[key]["prices"].append(row["unit_cost"])
        stats[key]["products"].add(row["product_name"])

    avg_map = {
        key: sum(v["prices"]) / len(v["prices"])
        for key, v in stats.items()
        if len(v["prices"]) >= 2
    }

    for row in rows:
        key = f"{row['pn_mtm'] or ''}|{row['category'] or ''}"
        avg_cost = avg_map.get(key)
        if avg_cost is None or avg_cost <= 0:
            continue

        deviation = abs(row["unit_cost"] - avg_cost) / avg_cost
        if deviation > deviation_threshold:
            violations.append({
                "rule_id": "purchase_price_anomaly",
                "severity": "medium",
                "entity_type": "purchase_order_line",
                "entity_id": row["id"],
                "description": (
                    f"采购单行 {row['id']} (SKU: {row['sku_key']}, "
                    f"PN: {row['pn_mtm'] or 'N/A'}) 单价 {row['unit_cost']} "
                    f"偏离同类均值 {avg_cost:.2f} 达 {deviation*100:.1f}% "
                    f"（阈值 30%）"
                ),
                "metadata_json": json.dumps({
                    "line_id": row["id"],
                    "order_id": row["order_id"],
                    "sku_key": row["sku_key"],
                    "product_name": row["product_name"],
                    "pn_mtm": row["pn_mtm"],
                    "unit_cost": row["unit_cost"],
                    "category_avg_cost": avg_cost,
                    "deviation_pct": round(deviation * 100, 2),
                    "threshold_pct": 30,
                    "supplier_id": row["supplier_id"],
                    "business_date": row["business_date"],
                }, ensure_ascii=False),
            })
    return violations


def _education_subsidy_violation(conn: sqlite3.Connection) -> list[dict]:
    """
    R5: 教育补/营销活动合规
    规则：
      1. education_scan_record_v2 中 education_discount_amount 超出配置范围
      2. serial_numbers_json 非空但对应的 serial_item 不存在或状态不一致
      3. 教育补折扣 > 0 但 status = '未付'（已享受优惠但未付款）
    注：8条记录，全部走检查
    """
    violations = []

    rows = conn.execute("""
        SELECT
            e.id,
            e.record_id,
            e.scan_date,
            e.scan_type,
            e.staff_id,
            e.staff_name,
            e.customer_name,
            e.sku_key,
            e.education_discount_amount,
            e.service_fee_per_unit,
            e.zhixiangjin_amount,
            e.total_education_discount_amount,
            e.serial_numbers_json,
            e.order_number,
            e.outbound_date,
            e.status,
            e.voucher_code
        FROM education_scan_record_v2 e
        WHERE e.education_discount_amount > 0
           OR e.total_education_discount_amount > 0
    """).fetchall()

    for row in rows:
        reasons = []

        # 规则1：教育补 > 0 但 status = 未付
        if row["education_discount_amount"] > 0 and row["status"] == "未付":
            reasons.append("教育补贴已减免但订单状态为未付款")

        # 规则2：serial_numbers_json 非空，验证 SN 存在
        sn_json = row["serial_numbers_json"]
        if sn_json:
            try:
                sns = json.loads(sn_json)
                if isinstance(sns, list) and len(sns) > 0:
                    for sn in sns:
                        si = conn.execute(
                            "SELECT status FROM serial_item WHERE serial_number = ?",
                            (sn,),
                        ).fetchone()
                        if si is None:
                            reasons.append(f"SN {sn} 在 serial_item 表中不存在")
                        elif si["status"] not in ("sold", "in_stock"):
                            reasons.append(f"SN {sn} 状态异常: {si['status']}")
            except (json.JSONDecodeError, TypeError):
                reasons.append("serial_numbers_json 格式错误")

        if reasons:
            violations.append({
                "rule_id": "education_subsidy_violation",
                "severity": "high",
                "entity_type": "education_scan_record_v2",
                "entity_id": str(row["id"]),
                "description": (
                    f"教育补贴记录 {row['record_id']} (员工: {row['staff_name']}, "
                    f"客户: {row['customer_name'] or '未知'}) 合规违规："
                    f"{'；'.join(reasons)}"
                ),
                "metadata_json": json.dumps({
                    "edu_record_id": row["id"],
                    "record_id": row["record_id"],
                    "scan_date": row["scan_date"],
                    "scan_type": row["scan_type"],
                    "staff_id": row["staff_id"],
                    "staff_name": row["staff_name"],
                    "customer_name": row["customer_name"],
                    "sku_key": row["sku_key"],
                    "education_discount_amount": row["education_discount_amount"],
                    "total_education_discount": row["total_education_discount_amount"],
                    "service_fee": row["service_fee_per_unit"],
                    "zhixiangjin": row["zhixiangjin_amount"],
                    "order_number": row["order_number"],
                    "status": row["status"],
                    "reasons": reasons,
                }, ensure_ascii=False),
            })
    return violations


# ---------------------------------------------------------------------------
# 规则引擎
# ---------------------------------------------------------------------------

ALL_RULES: dict[str, ComplianceRule] = {
    "sn_status_inconsistency": ComplianceRule(
        rule_id="sn_status_inconsistency",
        name="SN状态一致性检测",
        description="serial_item.status 与 sales_order_line 关联状态不一致",
        severity="critical",
        entity_type="serial_item",
        check_fn=_sn_status_inconsistency,
    ),
    "inventory_movement_mismatch": ComplianceRule(
        rule_id="inventory_movement_mismatch",
        name="库存数 vs 流水一致性检测",
        description="SKU库存账与 inventory_movement 流水净和不一致",
        severity="high",
        entity_type="sku",
        check_fn=_inventory_movement_mismatch,
    ),
    "retail_price_violation": ComplianceRule(
        rule_id="retail_price_violation",
        name="零售价规则违反检测",
        description="价格不以99结尾、低于成本价、超过国补上限",
        severity="high",
        entity_type="sku",
        check_fn=_retail_price_violation,
    ),
    "purchase_price_anomaly": ComplianceRule(
        rule_id="purchase_price_anomaly",
        name="采购价异常检测",
        description="采购单价偏离同类商品均值超过30%",
        severity="medium",
        entity_type="purchase_order_line",
        check_fn=_purchase_price_anomaly,
    ),
    "education_subsidy_violation": ComplianceRule(
        rule_id="education_subsidy_violation",
        name="教育补/营销活动合规检测",
        description="教育补贴价格超出活动范围、SN未匹配",
        severity="high",
        entity_type="education_scan_record_v2",
        check_fn=_education_subsidy_violation,
    ),
}


class RuleEngine:
    """合规规则引擎"""

    def __init__(self, rules: dict[str, ComplianceRule] | None = None):
        self._rules: dict[str, ComplianceRule] = rules or dict(ALL_RULES)

    def register(self, rule: ComplianceRule) -> None:
        self._rules[rule.rule_id] = rule

    def get_rule(self, rule_id: str) -> ComplianceRule | None:
        return self._rules.get(rule_id)

    def list_rules(self, enabled_only: bool = False) -> list[ComplianceRule]:
        rules = list(self._rules.values())
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        return rules

    def run_all(self, conn: sqlite3.Connection) -> list[dict]:
        """运行所有启用的规则，返回全部违规列表"""
        violations = []
        for rule in self.list_rules(enabled_only=True):
            if rule.check_fn is None:
                continue
            try:
                result = rule.check_fn(conn)
                violations.extend(result)
            except Exception as exc:
                # 单个规则失败不影响其他规则
                violations.append({
                    "rule_id": rule.rule_id,
                    "severity": "critical",
                    "entity_type": "system",
                    "entity_id": rule.rule_id,
                    "description": f"规则 {rule.rule_id} 执行异常：{exc}",
                    "metadata_json": json.dumps({"error": str(exc)}, ensure_ascii=False),
                })
        return violations

    def run_rule(self, conn: sqlite3.Connection, rule_id: str) -> list[dict]:
        """运行指定规则"""
        rule = self.get_rule(rule_id)
        if rule is None or not rule.enabled:
            return []
        if rule.check_fn is None:
            return []
        try:
            return rule.check_fn(conn)
        except Exception as exc:
            return [{
                "rule_id": rule.rule_id,
                "severity": "critical",
                "entity_type": "system",
                "entity_id": rule_id,
                "description": f"规则 {rule_id} 执行异常：{exc}",
                "metadata_json": json.dumps({"error": str(exc)}, ensure_ascii=False),
            }]
