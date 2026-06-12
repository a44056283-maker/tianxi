#!/usr/bin/env python3
"""
ZDT 销售订单去重 + 数据补全脚本
目标：清理 SQLite sales_order 重复记录，补充缺失字段

记录类型（优先级）：
  XS      = zdtSalesOrderSync.py 写入（最新，最权威）
  ZDT-XS  = syncZdtToLocalSqlite.py 回填（旧数据，与 XS 重复）
  SALE    = 工程软件导出（数据不完整）
  OTHER   = 其他混入记录

去重策略：
  - XS 记录（id 以 XS 开头）：永久保留，不删
  - ZDT-XS 记录：id 前缀匹配 XS.id → 删除（已过期）
  - SALE 记录：按 external_order_no 重复组，保留最优，删除其他
  - 补充字段：收银员 / 金额 / pay_time / status / supplier
"""

import json, os, re, sqlite3
from datetime import datetime
from collections import defaultdict

# ── 路径配置 ──────────────────────────────────────────────────────────────
RETAIL_DB = os.environ.get(
    "LENOVO_SMART_RETAIL_DB_FILE",
    "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
)
PG_CONN = os.environ.get(
    "ZDT_SYNC_DATABASE_URL",
    "postgresql://zdt:zdt@localhost:5432/zdt_sync"
)

PURCHASE_COST_FEN_THRESHOLD = 50000
PURCHASE_QTY_ABSURD_THRESHOLD = 100

import psycopg

def pg_connect():
    return psycopg.connect(PG_CONN)

def sqlite_connect(path):
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def canonical_purchase_no(*values):
    for value in values:
        text = str(value or "").strip().upper()
        if not text:
            continue
        match = re.search(r"(CGR\d{6,})", text)
        if match:
            return match.group(1)
        if text.startswith("CGR"):
            return text
    return str(values[0] or "").strip().upper() if values else ""


def normalize_purchase_money_unit(value):
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if amount <= 0:
        return 0.0
    if abs(amount) >= PURCHASE_COST_FEN_THRESHOLD:
        amount = amount / 100.0
    return round(amount, 2)


def normalize_purchase_quantity(value, *, fallback=0):
    try:
        quantity = int(abs(float(value or 0)))
    except (TypeError, ValueError):
        quantity = 0
    if quantity <= 0:
        return int(fallback or 0)
    if quantity > PURCHASE_QTY_ABSURD_THRESHOLD:
        return int(fallback or 1)
    return quantity


def parse_serial_payload(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text or text == "[]":
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [item.strip() for item in text.split(",") if item.strip()]

# ═══════════════════════════════════════════════════════════════════════════════
# 第一部分：sales_order 去重
# ═══════════════════════════════════════════════════════════════════════════════
def deduplicate_sales_orders():
    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()

    # 读取所有有 id 的订单（不只是有 external_order_no 的）
    # XS 记录的 external_order_no 可能为空（''），但 id=order_no 本身可识别
    cur.execute("""
        SELECT id, external_order_no, cashier_name, total_amount, pay_time,
               created_time, status, status_name, business_date,
               customer_name, order_type_name, channel_type_name,
               total_quantity, shop_name, note, raw_payload_json
        FROM sales_order
        WHERE id IS NOT NULL
    """)
    all_orders = [dict(row) for row in cur.fetchall()]

    # 按 external_order_no 分组（跳过空字符串，它们按 id 各自独立不会重复）
    groups = defaultdict(list)
    for o in all_orders:
        ext = str(o["external_order_no"] or "").strip()
        if ext:  # 只有非空 external_order_no 才加入分组检测
            groups[ext].append(o)
        # 空 external_order_no 的记录（多为 XS 记录）按 id 各自独立，不参与重复检测

    total_groups = len(groups)
    duplicate_groups = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"  有 external_order_no（非空）: {len(all_orders)} 条，分组 {total_groups} 个，重复组: {len(duplicate_groups)}")

    # ── 第一步：XS 权威记录永留 ─────────────────────────────────────────
    # id 以 XS 开头 = zdtSalesOrderSync.py 写入
    xs_ids = set(o["id"] for o in all_orders if o["id"].startswith("XS"))
    print(f"  XS 权威记录: {len(xs_ids)} 条")

    # ── 第二步：删 ZDT-XS 中与 XS 重复的 ──────────────────────────────
    # ZDT-XS id 格式：ZDT-XS{尾缀}_数字ID
    # XS id 格式：XS{尾缀}
    # ZDT-XS 与 XS 重复条件：ZDT-XS id 包含 XS id（去掉 ZDT- 前缀）
    def is_zs_dup_of_xs(zdt_xs_id, xs_set):
        # ZDT-XS26052919223096509_1384237798599913472 → XS26052919223096509
        if not zdt_xs_id.startswith("ZDT-XS"):
            return False
        suffix = zdt_xs_id.replace("ZDT-XS", "").split("_")[0]
        candidate_xs = "XS" + suffix
        return candidate_xs in xs_set

    to_delete_zdt = []
    for o in all_orders:
        if o["id"].startswith("ZDT-XS") and is_zs_dup_of_xs(o["id"], xs_ids):
            to_delete_zdt.append(o["id"])

    print(f"  ZDT-XS 与 XS 重复（需删除）: {len(to_delete_zdt)} 条")
    if to_delete_zdt:
        placeholders = ",".join("?" * len(to_delete_zdt))
        cur.execute(f"DELETE FROM sales_order_line WHERE order_id IN ({placeholders})", to_delete_zdt)
        cur.execute(f"DELETE FROM sales_order WHERE id IN ({placeholders})", to_delete_zdt)

    # ── 第三步：其他 external_order_no 重复组 ───────────────────────────
    kept = 0
    deleted_other = 0
    updated_other = 0

    for ext_no, orders in duplicate_groups.items():
        # 排除已删除的 ZDT-XS
        orders = [o for o in orders if o["id"] not in set(to_delete_zdt)]
        if len(orders) <= 1:
            continue

        # 评分
        def score(o):
            s = 0
            if o.get("cashier_name"): s += 100
            if o.get("pay_time") and ":" in str(o["pay_time"]): s += 10
            if o.get("total_amount") and float(o["total_amount"] or 0) > 0: s += 5
            if o.get("status"): s += 1
            return s

        orders.sort(key=score, reverse=True)
        best = orders[0]
        for o in orders[1:]:
            changed = False
            for field in ["cashier_name", "total_amount", "pay_time", "status", "status_name"]:
                if not o.get(field) and best.get(field):
                    o[field] = best[field]
                    changed = True
            if changed:
                updated_other += 1
            cur.execute("DELETE FROM sales_order WHERE id = ?", (o["id"],))
            deleted_other += 1
        kept += 1

    conn.commit()

    cur.execute("SELECT COUNT(*) FROM sales_order")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sales_order WHERE cashier_name != ''")
    with_cashier = cur.fetchone()[0]
    cur.execute("""
        SELECT external_order_no, COUNT(*) FROM sales_order
        WHERE external_order_no IS NOT NULL AND external_order_no != ''
        GROUP BY external_order_no HAVING COUNT(*) > 1
    """)
    remaining_dups = len(cur.fetchall())

    print(f"\n  ✓ 去重完成:")
    print(f"    ZDT-XS 删: {len(to_delete_zdt)} 条 | 其他组: {kept}组 删:{deleted_other} 补:{updated_other}")
    print(f"    总记录: {total} | 有收银员: {with_cashier} | 剩余重复: {remaining_dups} 组")
    conn.close()
    return {"zdt_xs_deleted": len(to_delete_zdt), "other_kept": kept, "other_deleted": deleted_other}

# ═══════════════════════════════════════════════════════════════════════════════
# 第二部分：sales_order 字段补充（收银员/金额/pay_time）
# ═══════════════════════════════════════════════════════════════════════════════
def enrich_orders_from_pg():
    """
    从 PG fact_orders 读取收银员姓名、实际金额，补充到 SQLite 缺失字段
    """
    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()
    now = datetime.now().isoformat()[:19]

    pg = pg_connect()
    pg_cur = pg.cursor()

    # 读取 XS 记录（有 external_order_no 但无收银员或无金额）
    cur.execute("""
        SELECT id, external_order_no, cashier_name, total_amount
        FROM sales_order
        WHERE id LIKE 'XS%'
          AND (cashier_name IS NULL OR cashier_name = ''
               OR total_amount IS NULL OR total_amount = 0)
    """)
    to_enrich = [dict(row) for row in cur.fetchall()]
    print(f"\n  XS 待补充收银员/金额: {len(to_enrich)} 条")

    if not to_enrich:
        pg_cur.close()
        pg.close()
        conn.close()
        return {"updated": 0}

    # 从 PG 读取对应订单
    # XS 记录：id = order_no（XS前缀），external_order_no = outer_order_no（可能为空）
    # 需同时查 order_no（匹配id）和 outer_order_no（匹配external_order_no）
    xs_nos = [str(o["id"]) for o in to_enrich if str(o["id"]).startswith("XS")]
    ext_nos = [str(o["external_order_no"]) for o in to_enrich if o["external_order_no"]]

    if not xs_nos and not ext_nos:
        pg_cur.close()
        pg.close()
        conn.close()
        return {"updated": 0}

    # 两次查询：一次按 order_no（匹配 XS id），一次按 outer_order_no（匹配 external_order_no）
    pg_data = {}
    if xs_nos:
        placeholders_xs = ",".join("?" * len(xs_nos))
        pg_cur.execute(f"""
            SELECT order_no, cashier_name, total_amount, pay_amount, status, status_name, pay_time
            FROM fact_orders
            WHERE source_name = 'zhidiantong'
              AND order_no IN ({placeholders_xs})
        """, xs_nos)
        for r in pg_cur.fetchall():
            pg_data[str(r[0])] = {"cashier": r[1], "total": float(r[2] or 0), "pay": float(r[3] or 0),
                                   "status": r[4], "status_name": r[5], "pay_time": r[6]}

    if ext_nos:
        placeholders_ext = ",".join("?" * len(ext_nos))
        pg_cur.execute(f"""
            SELECT order_no, cashier_name, total_amount, pay_amount, status, status_name, pay_time
            FROM fact_orders
            WHERE source_name = 'zhidiantong'
              AND outer_order_no IN ({placeholders_ext})
        """, ext_nos)
        for r in pg_cur.fetchall():
            pg_data[str(r[0])] = {"cashier": r[1], "total": float(r[2] or 0), "pay": float(r[3] or 0),
                                   "status": r[4], "status_name": r[5], "pay_time": r[6]}

    pg_cur.close()
    pg.close()

    updated = 0
    for o in to_enrich:
        ext = str(o["external_order_no"])
        if ext not in pg_data:
            continue
        info = pg_data[ext]
        if (not o.get("cashier_name") and info["cashier"]) or \
           (not o.get("total_amount") and info["total"] > 0):
            new_cashier = o.get("cashier_name") or info["cashier"] or ""
            new_amount = o.get("total_amount") or info["pay"] or info["total"] or 0
            new_status = o.get("status") or (info["status"] if info["status"] else "")
            new_status_name = o.get("status_name") or info["status_name"] or ""
            cur.execute("""
                UPDATE sales_order
                SET cashier_name = ?, total_amount = ?, status = ?, status_name = ?
                WHERE id = ?
            """, (new_cashier, new_amount, new_status, new_status_name, o["id"]))
            updated += 1

    conn.commit()
    print(f"  收银员/金额补充: {updated} 条")
    conn.close()
    return {"updated": updated}

# ═══════════════════════════════════════════════════════════════════════════════
# 第三部分：sales_order_line SN 补全
# ═══════════════════════════════════════════════════════════════════════════════
def enrich_lines_with_sn():
    """从 PG fact_order_items 读取 SN，补全 SQLite sales_order_line"""
    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM sales_order_line WHERE serial_number IS NULL OR serial_number = ''")
    no_sn = cur.fetchone()[0]
    print(f"\n  无SN商品明细: {no_sn} 条")

    pg = pg_connect()
    pg_cur = pg.cursor()
    pg_cur.execute("""
        SELECT oi.serial_number, oi.sku_no, oi.unit_price,
               oi.quantity, o.order_id
        FROM fact_order_items oi
        JOIN fact_orders o ON oi.order_id = o.order_id
        WHERE o.source_name = 'zhidiantong'
          AND oi.serial_number IS NOT NULL AND oi.serial_number != ''
    """)
    pg_sn = {str(r[4]): {"serial_number": r[0], "sku_no": r[1], "unit_price": r[2]}
             for r in pg_cur.fetchall()}
    pg_cur.close()
    pg.close()

    if not pg_sn:
        print("  PG 无 SN 数据")
        conn.close()
        return {"updated": 0}

    # 找到 SQLite sales_order 中有 external_order_no = PG order_id 的记录
    cur.execute("SELECT id, external_order_no FROM sales_order WHERE cashier_name != ''")
    id_map = {str(r[1]): r[0] for r in cur.fetchall() if r[1]}

    updated = 0
    for pg_oid, sn_info in pg_sn.items():
        if pg_oid not in id_map:
            continue
        sqlite_oid = id_map[pg_oid]
        cur.execute("""
            UPDATE sales_order_line
            SET serial_number = :sn
            WHERE order_id = :oid
              AND (serial_number IS NULL OR serial_number = '')
            LIMIT 1
        """, {"sn": sn_info["serial_number"], "oid": sqlite_oid})
        if cur.rowcount > 0:
            updated += 1

    conn.commit()
    print(f"  SN补全: {updated} 条")
    conn.close()
    return {"updated": updated}

# ═══════════════════════════════════════════════════════════════════════════════
# 第四部分：出库 amount 补全
# ═══════════════════════════════════════════════════════════════════════════════
def fill_outbound_amounts():
    """
    出库记录 amount 从 fact_orders 补全
    ZDT-XS id → XS id → fact_orders.order_id → total_amount
    """
    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()

    cur.execute("""
        SELECT source_system, COUNT(*) as cnt,
               SUM(CASE WHEN amount IS NULL OR amount = 0 THEN 1 ELSE 0 END) as no_amt
        FROM inventory_movement
        WHERE movement_type = 'sales_outbound'
        GROUP BY source_system
    """)
    print(f"\n  出库记录:")
    for r in cur.fetchall():
        print(f"    {r[0]}: {r[1]}条 | 空金额:{r[2]}")

    pg = pg_connect()
    pg_cur = pg.cursor()
    pg_cur.execute("""
        SELECT order_id, outer_order_no, total_amount, pay_amount
        FROM fact_orders WHERE source_name = 'zhidiantong'
    """)
    by_oid = {str(r[0]): float(r[3] or r[2] or 0) for r in pg_cur.fetchall()}
    by_outer = {str(r[1]): float(r[3] or r[2] or 0) for r in pg_cur.fetchall()}
    pg_cur.close()
    pg.close()

    cur.execute("""
        SELECT id, zdt_order_no, amount
        FROM inventory_movement
        WHERE movement_type = 'sales_outbound'
          AND (amount IS NULL OR amount = 0)
    """)
    null_amount = [dict(row) for row in cur.fetchall()]
    print(f"  amount为空: {len(null_amount)} 条")

    updated = 0
    for row in null_amount:
        amt = 0
        row_id = row["id"]

        if row_id.startswith("ZDT-XS"):
            parts = row_id.replace("ZDT-XS", "").split("_")
            xs_key = parts[0]  # 如 "XS26052919223096509"
            # xs_key 就是 ZDT order_id → fact_orders.order_id
            if xs_key in by_oid:
                amt = by_oid[xs_key]
            elif xs_key in by_outer:
                amt = by_outer[xs_key]

        if amt > 0:
            cur.execute("UPDATE inventory_movement SET amount = ? WHERE id = ?", (amt, row_id))
            updated += 1

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM inventory_movement WHERE movement_type = 'sales_outbound' AND (amount IS NULL OR amount = 0)")
    remaining = cur.fetchone()[0]
    print(f"  出库金额补全: {updated} 条，剩余: {remaining} 条")
    conn.close()
    return {"updated": updated}

# ═══════════════════════════════════════════════════════════════════════════════
# 第五部分：入库 supplier + amount 补全
# ═══════════════════════════════════════════════════════════════════════════════
def fill_inbound():
    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()

    cur.execute("""
        UPDATE inventory_movement
        SET movement_type = 'purchase_inbound',
            inbound_document_no = CASE
              WHEN COALESCE(TRIM(inbound_document_no), '') <> '' THEN inbound_document_no
              WHEN UPPER(COALESCE(source_ref, '')) LIKE 'CGR%' THEN
                CASE
                  WHEN INSTR(source_ref, '_') > 0 THEN SUBSTR(source_ref, 1, INSTR(source_ref, '_') - 1)
                  ELSE source_ref
                END
              WHEN UPPER(COALESCE(id, '')) LIKE 'ZDT-CGR%' THEN
                CASE
                  WHEN INSTR(SUBSTR(id, 5), '_') > 0 THEN SUBSTR(SUBSTR(id, 5), 1, INSTR(SUBSTR(id, 5), '_') - 1)
                  ELSE SUBSTR(id, 5)
                END
              ELSE inbound_document_no
            END,
            source_document_type = CASE
              WHEN COALESCE(TRIM(source_document_type), '') IN ('', '库存流水单') THEN '采购入库'
              ELSE source_document_type
            END,
            note = CASE
              WHEN COALESCE(TRIM(note), '') = '' OR note = 'openclaw.full_db.manual_adjustment' THEN
                '智店通采购入库自动归正'
              ELSE note
            END
        WHERE movement_type = 'manual_adjustment'
          AND (
            UPPER(COALESCE(source_ref, '')) LIKE 'CGR%'
            OR UPPER(COALESCE(id, '')) LIKE 'ZDT-CGR%'
          )
    """)

    pg = pg_connect()
    pg_cur = pg.cursor()
    pg_cur.execute("""
        SELECT pd.purchase_no, pd.sku_no, pd.quantity, pd.cost_price, pd.supplier_name, p.stock_in_time
        FROM fact_purchase_order_details pd
        JOIN fact_purchase_orders p ON pd.purchase_id = p.id
        WHERE pd.cost_price > 0
        ORDER BY p.stock_in_time DESC
    """)
    from collections import defaultdict
    purchase_doc_detail_keys = set()
    sku_purchases = defaultdict(list)
    for r in pg_cur.fetchall():
        d = dict(zip([d[0] for d in pg_cur.description], r))
        sku = str(d.get("sku_no", "")).strip()
        doc_no = canonical_purchase_no(d.get("purchase_no"))
        if sku and doc_no:
            purchase_doc_detail_keys.add((doc_no, sku))
        if sku:
            sku_purchases[sku].append(d)

    pg_cur.execute("""
        SELECT service_no, sku_no, product_name, mtm_code, property_value, quantity, user_name,
               pay_time, supplier_name, unit_price
        FROM fact_stock_orders
        WHERE (
            UPPER(COALESCE(service_no, '')) LIKE 'CGR%'
            OR
            service_type_name ILIKE '%入库%'
            OR operate_type_name ILIKE '%采购入库%'
            OR operate_type_name ILIKE '%调拨入库%'
            OR operate_type_name ILIKE '%订单退货入库%'
          )
        ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
    """)
    inbound_serial_groups = {}
    inbound_serial_meta = {}
    for r in pg_cur.fetchall():
        d = dict(zip([d[0] for d in pg_cur.description], r))
        doc_no = canonical_purchase_no(d.get("service_no"))
        sku = str(d.get("sku_no", "")).strip()
        if not doc_no or not sku:
            continue
        group_key = (doc_no, sku)
        group = inbound_serial_groups.setdefault(group_key, {
            "serial_numbers": [],
            "serial_set": set(),
            "supplier_name": str(d.get("supplier_name") or "").strip(),
            "unit_cost": None,
            "quantity": None,
            "product_name": str(d.get("product_name") or "").strip(),
            "pn_mtm": str(d.get("mtm_code") or "").strip(),
            "spec": str(d.get("property_value") or "").strip(),
            "operator_name": str(d.get("user_name") or "").strip(),
            "inbound_date": str(d.get("pay_time") or "")[:19],
        })
        unit_cost = normalize_purchase_money_unit(d.get("unit_price"))
        if unit_cost > 0 and (group["unit_cost"] is None or float(group["unit_cost"] or 0) <= 0):
            group["unit_cost"] = unit_cost
        group_qty = normalize_purchase_quantity(d.get("quantity"), fallback=0)
        if group_qty > 0 and (group["quantity"] is None or int(group["quantity"] or 0) <= 0):
            group["quantity"] = group_qty

    pg_cur.execute("""
        SELECT service_no, sku_no, product_name, mtm_code, property_value, quantity, user_name,
               pay_time, supplier_name, unit_price, serial_number
        FROM fact_stock_orders
        WHERE COALESCE(TRIM(serial_number), '') <> ''
          AND (
            UPPER(COALESCE(service_no, '')) LIKE 'CGR%'
            OR
            service_type_name ILIKE '%入库%'
            OR operate_type_name ILIKE '%采购入库%'
            OR operate_type_name ILIKE '%调拨入库%'
            OR operate_type_name ILIKE '%订单退货入库%'
          )
        ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
    """)
    for r in pg_cur.fetchall():
        d = dict(zip([d[0] for d in pg_cur.description], r))
        doc_no = canonical_purchase_no(d.get("service_no"))
        sku = str(d.get("sku_no", "")).strip()
        serial = str(d.get("serial_number", "")).strip()
        if not doc_no or not sku or not serial:
            continue
        group_key = (doc_no, sku)
        group = inbound_serial_groups.setdefault(group_key, {
            "serial_numbers": [],
            "serial_set": set(),
            "supplier_name": str(d.get("supplier_name") or "").strip(),
            "unit_cost": None,
            "quantity": None,
            "product_name": str(d.get("product_name") or "").strip(),
            "pn_mtm": str(d.get("mtm_code") or "").strip(),
            "spec": str(d.get("property_value") or "").strip(),
            "operator_name": str(d.get("user_name") or "").strip(),
            "inbound_date": str(d.get("pay_time") or "")[:19],
        })
        upper = serial.upper()
        if upper not in group["serial_set"]:
            group["serial_set"].add(upper)
            group["serial_numbers"].append(serial)
        unit_cost = normalize_purchase_money_unit(d.get("unit_price"))
        if unit_cost > 0 and (group["unit_cost"] is None or float(group["unit_cost"] or 0) <= 0):
            group["unit_cost"] = unit_cost
        group_qty = normalize_purchase_quantity(d.get("quantity"), fallback=0)
        if group_qty > 0 and (group["quantity"] is None or int(group["quantity"] or 0) <= 0):
            group["quantity"] = group_qty
        inbound_serial_meta[serial.upper()] = {
            "serial_number": serial,
            "sku_key": sku,
            "product_name": str(d.get("product_name") or "").strip(),
            "pn_mtm": str(d.get("mtm_code") or "").strip(),
            "spec": str(d.get("property_value") or "").strip(),
            "operator_name": str(d.get("user_name") or "").strip(),
            "supplier_name": str(d.get("supplier_name") or "").strip(),
            "cost_amount": unit_cost if unit_cost > 0 else None,
            "inbound_document_no": doc_no,
            "inbound_date": str(d.get("pay_time") or "")[:19],
        }

    pg_cur.execute("""
        SELECT service_no, sku_no, product_name, mtm_code, property_name, user_name,
               pay_time, supplier_name, unit_cost, serial_number
        FROM fact_sn_records
        WHERE COALESCE(TRIM(serial_number), '') <> ''
          AND (
            UPPER(COALESCE(service_no, '')) LIKE 'CGR%'
            OR
            service_type_name ILIKE '%入库%'
            OR operate_type_name ILIKE '%采购入库%'
            OR operate_type_name ILIKE '%调拨入库%'
            OR operate_type_name ILIKE '%订单退货入库%'
          )
        ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
    """)
    for r in pg_cur.fetchall():
        d = dict(zip([d[0] for d in pg_cur.description], r))
        doc_no = canonical_purchase_no(d.get("service_no"))
        sku = str(d.get("sku_no", "")).strip()
        serial = str(d.get("serial_number", "")).strip()
        if not doc_no or not sku or not serial:
            continue
        group_key = (doc_no, sku)
        group = inbound_serial_groups.setdefault(group_key, {
            "serial_numbers": [],
            "serial_set": set(),
            "supplier_name": str(d.get("supplier_name") or "").strip(),
            "unit_cost": None,
            "product_name": str(d.get("product_name") or "").strip(),
            "pn_mtm": str(d.get("mtm_code") or "").strip(),
            "spec": str(d.get("property_name") or "").strip(),
            "operator_name": str(d.get("user_name") or "").strip(),
            "inbound_date": str(d.get("pay_time") or "")[:19],
        })
        upper = serial.upper()
        if upper not in group["serial_set"]:
            group["serial_set"].add(upper)
            group["serial_numbers"].append(serial)
        unit_cost = normalize_purchase_money_unit(d.get("unit_cost"))
        if unit_cost > 0 and (group["unit_cost"] is None or float(group["unit_cost"] or 0) <= 0):
            group["unit_cost"] = unit_cost
        meta = inbound_serial_meta.setdefault(upper, {
            "serial_number": serial,
            "sku_key": sku,
            "product_name": str(d.get("product_name") or "").strip(),
            "pn_mtm": str(d.get("mtm_code") or "").strip(),
            "spec": str(d.get("property_name") or "").strip(),
            "operator_name": str(d.get("user_name") or "").strip(),
            "supplier_name": str(d.get("supplier_name") or "").strip(),
            "cost_amount": unit_cost if unit_cost > 0 else None,
            "inbound_document_no": doc_no,
            "inbound_date": str(d.get("pay_time") or "")[:19],
        })
        if not meta.get("cost_amount") and unit_cost > 0:
            meta["cost_amount"] = unit_cost
    pg_cur.close()
    pg.close()

    cur.execute("""
        SELECT source_ref, sku_key,
               COUNT(*) AS row_count,
               SUM(CASE WHEN serial_number IS NULL OR TRIM(serial_number) = '' OR serial_number = '[]' THEN 1 ELSE 0 END) AS empty_serial_count,
               GROUP_CONCAT(id) AS ids
        FROM inventory_movement
        WHERE movement_type = 'purchase_inbound'
          AND UPPER(COALESCE(source_ref, '')) NOT LIKE 'CGR%'
          AND (id LIKE 'PURCHASEQ-%' OR id LIKE 'ZDT-%')
        GROUP BY source_ref, sku_key
        HAVING COUNT(*) >= 2
    """)
    quarantine_ids = []
    quarantined_groups = 0
    for group_row in cur.fetchall():
        group = dict(group_row)
        row_count = int(group.get("row_count") or 0)
        empty_serial_count = int(group.get("empty_serial_count") or 0)
        source_ref = str(group.get("source_ref") or "").strip()
        sku = str(group.get("sku_key") or "").strip()
        doc_no = canonical_purchase_no(source_ref)
        has_pg_source = (doc_no, sku) in purchase_doc_detail_keys or (doc_no, sku) in inbound_serial_groups
        if row_count <= 1 or empty_serial_count != row_count or has_pg_source:
            continue
        ids = [item.strip() for item in str(group.get("ids") or "").split(",") if item.strip()]
        if not ids:
            continue
        quarantine_ids.extend(ids)
        quarantined_groups += 1

    if quarantine_ids:
        placeholders = ",".join("?" * len(quarantine_ids))
        cur.execute(f"""
            UPDATE inventory_movement
            SET movement_type = 'manual_adjustment',
                source_document_type = '异常待校验',
                note = CASE
                  WHEN COALESCE(TRIM(note), '') = '' THEN '自动隔离：重复占位采购行，无PG采购明细/库存入库源'
                  ELSE note || ' | 自动隔离：重复占位采购行，无PG采购明细/库存入库源'
                END
            WHERE id IN ({placeholders})
        """, quarantine_ids)

    cur.execute("""
        SELECT id, sku_key, quantity, amount, supplier_name, movement_type,
               serial_number, inbound_document_no, source_ref, unit_cost
        FROM inventory_movement
        WHERE movement_type IN ('purchase_inbound', 'transfer_inbound')
           OR (
             movement_type = 'manual_adjustment'
             AND (
               UPPER(COALESCE(source_ref, '')) LIKE 'CGR%'
               OR UPPER(COALESCE(id, '')) LIKE 'ZDT-CGR%'
             )
           )
    """)
    inbound = [dict(row) for row in cur.fetchall()]
    print(f"\n  入库记录: {len(inbound)} 条")

    upd_amt = 0
    upd_sup = 0
    upd_sn = 0
    upd_qty = 0
    for row in inbound:
        sku = str(row.get("sku_key", "")).strip()
        doc_no = canonical_purchase_no(row.get("inbound_document_no"), row.get("id"), row.get("source_ref"))
        serial_group = inbound_serial_groups.get((doc_no, sku))
        latest = sku_purchases[sku][0] if sku and sku in sku_purchases else None
        row_serials = parse_serial_payload(row.get("serial_number"))
        serial_count = len(row_serials) or (len(serial_group.get("serial_numbers", [])) if serial_group else 0)
        group_quantity = int(serial_group.get("quantity") or 0) if serial_group else 0
        qty = group_quantity or normalize_purchase_quantity(row.get("quantity"), fallback=serial_count or 1)
        cost = 0
        supplier = ""
        if latest:
            cost = normalize_purchase_money_unit(latest.get("cost_price"))
            supplier = latest.get("supplier_name", "") or ""
        if serial_group:
            group_cost = float(serial_group.get("unit_cost") or 0)
            if group_cost > 0:
                cost = group_cost
            supplier = supplier or str(serial_group.get("supplier_name") or "").strip()
        row_unit_cost = normalize_purchase_money_unit(row.get("unit_cost"))
        if cost <= 0 and row_unit_cost > 0:
            cost = row_unit_cost
        try:
            current_amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            current_amount = 0
        expected_amount = round(qty * cost, 2) if cost > 0 and qty > 0 else 0
        source_row_qty = normalize_purchase_quantity(row.get("quantity"), fallback=0)
        quantity_corrected = qty > 0 and source_row_qty != qty
        amount_needs_rebuild = False
        if expected_amount > 0:
            if current_amount <= 0:
                amount_needs_rebuild = True
            elif current_amount > expected_amount * 100:
                amount_needs_rebuild = True
            elif abs(current_amount - expected_amount) > max(1, expected_amount * 0.05):
                amount_needs_rebuild = True

        if quantity_corrected:
            cur.execute("UPDATE inventory_movement SET quantity = ? WHERE id = ?", (qty, row["id"]))
            upd_qty += 1
        if cost > 0 and (amount_needs_rebuild or row_unit_cost <= 0 or abs(row_unit_cost - cost) > 0.01):
            cur.execute("UPDATE inventory_movement SET amount = ?, unit_cost = ? WHERE id = ?",
                         (expected_amount if expected_amount > 0 else current_amount, cost, row["id"]))
            upd_amt += 1
        if supplier and (not row.get("supplier_name") or row["supplier_name"] == ""):
            cur.execute("UPDATE inventory_movement SET supplier_name = ? WHERE id = ?",
                         (supplier, row["id"]))
            upd_sup += 1
        if doc_no and row.get("movement_type") == 'manual_adjustment':
            cur.execute("""
                UPDATE inventory_movement
                SET movement_type = 'purchase_inbound',
                    inbound_document_no = CASE WHEN COALESCE(TRIM(inbound_document_no), '') = '' THEN ? ELSE inbound_document_no END,
                    source_document_type = CASE WHEN COALESCE(TRIM(source_document_type), '') = '' THEN '采购入库' ELSE source_document_type END,
                    note = CASE WHEN COALESCE(TRIM(note), '') = '' THEN ? ELSE note END
                WHERE id = ?
            """, (doc_no, f'智店通采购入库 {doc_no}', row["id"]))
        if serial_group and (not row.get("serial_number") or str(row.get("serial_number")).strip() in {"", "[]"}):
            serial_payload = json.dumps(serial_group["serial_numbers"], ensure_ascii=False)
            cur.execute("UPDATE inventory_movement SET serial_number = ? WHERE id = ?",
                         (serial_payload, row["id"]))
            upd_sn += 1

    cur.execute("""
        UPDATE inventory_movement
        SET unit_cost = ROUND(unit_cost / 100.0, 2),
            amount = CASE
              WHEN amount IS NOT NULL AND amount > 0 THEN ROUND(amount / 100.0, 2)
              ELSE amount
            END
        WHERE movement_type IN ('purchase_inbound', 'transfer_inbound')
          AND unit_cost >= ?
    """, (PURCHASE_COST_FEN_THRESHOLD,))
    scaled_cost_cleanup = cur.rowcount or 0

    cur.execute("""
        UPDATE inventory_movement
        SET quantity = CASE
              WHEN ABS(COALESCE(quantity, 0)) > ? THEN 1
              ELSE quantity
            END,
            amount = ROUND(
              COALESCE(unit_cost, 0) * CASE
                WHEN ABS(COALESCE(quantity, 0)) > ? THEN 1
                WHEN ABS(COALESCE(quantity, 0)) < 1 THEN 1
                ELSE ABS(quantity)
              END,
              2
            )
        WHERE movement_type IN ('purchase_inbound', 'transfer_inbound')
          AND amount >= 1000000
          AND COALESCE(unit_cost, 0) > 0
    """, (PURCHASE_QTY_ABSURD_THRESHOLD, PURCHASE_QTY_ABSURD_THRESHOLD))
    absurd_amount_cleanup = cur.rowcount or 0

    serial_upserts = 0
    for serial_meta in inbound_serial_meta.values():
        cur.execute("""
            INSERT INTO serial_item
            (serial_number, sku_key, product_name, pn_mtm, spec, status,
             warehouse_code, location_code, cost_amount, inbound_date,
             inbound_document_no, operator_name, supplier_name,
             warranty_status, updated_at)
            VALUES (?, ?, ?, ?, ?, 'in_stock', 'STORE', 'SALES_FLOOR', ?, ?, ?, ?, ?, 'unknown', ?)
            ON CONFLICT(serial_number) DO UPDATE SET
              sku_key = COALESCE(NULLIF(excluded.sku_key, ''), serial_item.sku_key),
              product_name = COALESCE(NULLIF(excluded.product_name, ''), serial_item.product_name),
              pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), serial_item.pn_mtm),
              spec = COALESCE(NULLIF(excluded.spec, ''), serial_item.spec),
              status = 'in_stock',
              cost_amount = COALESCE(excluded.cost_amount, serial_item.cost_amount),
              inbound_date = COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date),
              inbound_document_no = COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no),
              operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
              supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), serial_item.supplier_name),
              updated_at = excluded.updated_at
        """, (
            serial_meta["serial_number"],
            serial_meta["sku_key"],
            serial_meta.get("product_name", ""),
            serial_meta.get("pn_mtm", ""),
            serial_meta.get("spec", ""),
            serial_meta.get("cost_amount"),
            serial_meta.get("inbound_date", ""),
            serial_meta.get("inbound_document_no", ""),
            serial_meta.get("operator_name", ""),
            serial_meta.get("supplier_name", ""),
            datetime.now().isoformat()[:19],
        ))
        serial_upserts += 1

    bulk_doc_sn_updates = 0
    for (doc_no, sku), group in inbound_serial_groups.items():
        if not doc_no or not sku or not group["serial_numbers"]:
            continue
        serial_payload = json.dumps(group["serial_numbers"], ensure_ascii=False)
        cur.execute("""
            UPDATE inventory_movement
            SET serial_number = CASE
                  WHEN COALESCE(TRIM(serial_number), '') = '' OR serial_number = '[]' THEN ?
                  ELSE serial_number
                END,
                movement_type = CASE
                  WHEN movement_type = 'manual_adjustment' THEN 'purchase_inbound'
                  ELSE movement_type
                END,
                inbound_document_no = CASE
                  WHEN COALESCE(TRIM(inbound_document_no), '') = '' THEN ?
                  ELSE inbound_document_no
                END,
                source_document_type = CASE
                  WHEN COALESCE(TRIM(source_document_type), '') IN ('', '库存流水单') THEN '采购入库'
                  ELSE source_document_type
                END
            WHERE sku_key = ?
              AND (
                inbound_document_no = ?
                OR source_ref = ?
                OR source_ref LIKE ?
                OR id LIKE ?
              )
        """, (
            serial_payload,
            doc_no,
            sku,
            doc_no,
            doc_no,
            f"{doc_no}%",
            f"ZDT-{doc_no}%",
        ))
        bulk_doc_sn_updates += cur.rowcount

    for (doc_no, sku), group in inbound_serial_groups.items():
        if not group["serial_numbers"]:
            continue
        serial_payload = json.dumps(group["serial_numbers"], ensure_ascii=False)
        cur.execute("""
            UPDATE purchase_order_line
            SET serial_numbers_json = ?
            WHERE order_id = ? AND sku_key = ? AND (serial_numbers_json IS NULL OR serial_numbers_json = '' OR serial_numbers_json = '[]')
        """, (serial_payload, doc_no, sku))

    # 二次自愈：只要同采购单+SKU已存在真实成本/数量，就不允许占位采购行继续保留待补成本或异常数量。
    cur.execute("""
        SELECT id, sku_key, quantity, unit_cost, amount, supplier_name,
               inbound_document_no, source_ref, movement_type
        FROM inventory_movement
        WHERE movement_type IN ('purchase_inbound', 'transfer_inbound')
           OR (
             movement_type = 'manual_adjustment'
             AND (
               UPPER(COALESCE(source_ref, '')) LIKE 'CGR%'
               OR UPPER(COALESCE(id, '')) LIKE 'ZDT-CGR%'
             )
           )
    """)
    second_pass_rows = [dict(row) for row in cur.fetchall()]
    doc_sku_best: dict[tuple[str, str], dict[str, object]] = {}
    sku_best_cost: dict[str, float] = {}
    for row in second_pass_rows:
        sku = str(row.get("sku_key") or "").strip()
        if not sku:
            continue
        doc_no = canonical_purchase_no(row.get("inbound_document_no"), row.get("source_ref"), row.get("id"))
        qty = normalize_purchase_quantity(row.get("quantity"), fallback=0)
        cost = normalize_purchase_money_unit(row.get("unit_cost"))
        supplier = str(row.get("supplier_name") or "").strip()
        row_id = str(row.get("id") or "")
        is_placeholder = row_id.startswith("PURCHASEQ-")
        if cost > 0 and sku not in sku_best_cost:
            sku_best_cost[sku] = cost
        if not doc_no:
            continue
        current = doc_sku_best.get((doc_no, sku))
        current_score = (
            1 if current and float(current.get("unit_cost") or 0) > 0 else 0,
            1 if current and str(current.get("supplier_name") or "").strip() else 0,
            int(current.get("is_non_placeholder") or 0) if current else 0,
            1 if current and 0 < int(current.get("quantity") or 0) <= PURCHASE_QTY_ABSURD_THRESHOLD else 0,
            -int(current.get("quantity") or 0) if current and int(current.get("quantity") or 0) > 0 else -999999,
        )
        candidate = {
            "unit_cost": cost if cost > 0 else 0,
            "quantity": qty if qty > 0 else 0,
            "supplier_name": supplier,
            "is_non_placeholder": 0 if is_placeholder else 1,
        }
        candidate_score = (
            1 if cost > 0 else 0,
            1 if supplier else 0,
            0 if is_placeholder else 1,
            1 if 0 < qty <= PURCHASE_QTY_ABSURD_THRESHOLD else 0,
            -qty if qty > 0 else -999999,
        )
        if current is None or candidate_score > current_score:
            doc_sku_best[(doc_no, sku)] = candidate

    carried_cost_updates = 0
    carried_qty_updates = 0
    carried_supplier_updates = 0
    for row in second_pass_rows:
        sku = str(row.get("sku_key") or "").strip()
        if not sku:
            continue
        doc_no = canonical_purchase_no(row.get("inbound_document_no"), row.get("source_ref"), row.get("id"))
        doc_group = doc_sku_best.get((doc_no, sku)) if doc_no else None
        target_cost = float(doc_group.get("unit_cost") or 0) if doc_group else 0
        if target_cost <= 0:
            target_cost = float(sku_best_cost.get(sku) or 0)
        target_qty = int(doc_group.get("quantity") or 0) if doc_group else 0
        target_supplier = str(doc_group.get("supplier_name") or "").strip() if doc_group else ""
        current_cost = normalize_purchase_money_unit(row.get("unit_cost"))
        current_qty = normalize_purchase_quantity(row.get("quantity"), fallback=0)
        current_amount = normalize_purchase_money_unit(row.get("amount"))
        should_update_cost = target_cost > 0 and current_cost <= 0
        should_update_qty = target_qty > 0 and (
            current_qty <= 0
            or current_qty > PURCHASE_QTY_ABSURD_THRESHOLD
        )
        if should_update_cost or should_update_qty:
            final_cost = target_cost if target_cost > 0 else current_cost
            final_qty = target_qty if target_qty > 0 else current_qty or 1
            final_amount = round(final_cost * final_qty, 2) if final_cost > 0 else current_amount
            cur.execute("""
                UPDATE inventory_movement
                SET unit_cost = CASE WHEN ? > 0 THEN ? ELSE unit_cost END,
                    quantity = CASE WHEN ? > 0 THEN ? ELSE quantity END,
                    amount = CASE WHEN ? > 0 THEN ? ELSE amount END
                WHERE id = ?
            """, (
                1 if should_update_cost else 0,
                final_cost,
                1 if should_update_qty else 0,
                final_qty,
                1 if final_amount > 0 else 0,
                final_amount,
                row["id"],
            ))
            if should_update_cost:
                carried_cost_updates += 1
            if should_update_qty:
                carried_qty_updates += 1
        if target_supplier and not str(row.get("supplier_name") or "").strip():
            cur.execute("UPDATE inventory_movement SET supplier_name = ? WHERE id = ?", (target_supplier, row["id"]))
            carried_supplier_updates += 1

    conn.commit()
    cur.execute("""
        SELECT movement_type, COUNT(*) as total,
               SUM(CASE WHEN amount IS NULL OR amount = 0 THEN 1 ELSE 0 END) as no_amt,
               SUM(CASE WHEN supplier_name IS NULL OR supplier_name = '' THEN 1 ELSE 0 END) as no_sup,
               SUM(CASE WHEN serial_number IS NULL OR TRIM(serial_number) = '' OR serial_number = '[]' THEN 1 ELSE 0 END) as no_sn
        FROM inventory_movement
        WHERE movement_type IN ('purchase_inbound','transfer_inbound')
        GROUP BY movement_type
    """)
    print(f"\n  入库验证:")
    for r in cur.fetchall():
        print(f"    {r[0]}: 总{r[1]} | 空金额:{r[2]} | 空供应商:{r[3]} | 空SN:{r[4]}")
    print(f"  更新: 金额{upd_amt} 条, 供应商{upd_sup} 条, SN{upd_sn} 条, 修正数量{upd_qty} 条, 分单位清洗{scaled_cost_cleanup} 条, 异常金额清洗{absurd_amount_cleanup} 条, 批量SN兜底{bulk_doc_sn_updates} 条, 成本继承{carried_cost_updates} 条, 数量回填{carried_qty_updates} 条, 供应商继承{carried_supplier_updates} 条, serial_item{serial_upserts} 条, 隔离重复占位组{quarantined_groups} 组")
    conn.close()
    return {"upd_amt": upd_amt, "upd_sup": upd_sup, "upd_sn": upd_sn, "bulk_doc_sn_updates": bulk_doc_sn_updates, "serial_upserts": serial_upserts}

# ═══════════════════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════════════════
def run():
    now = datetime.now()
    print(f"[{now.isoformat()[:19]}] === ZDT 数据去重 + 补全 ===\n")

    r1 = deduplicate_sales_orders()
    r2 = enrich_orders_from_pg()
    r3 = enrich_lines_with_sn()
    r4 = fill_outbound_amounts()
    r5 = fill_inbound()

    conn = sqlite_connect(RETAIL_DB)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM sales_order")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sales_order WHERE cashier_name != ''")
    with_cashier = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sales_order_line WHERE serial_number != ''")
    with_sn = cur.fetchone()[0]
    cur.execute("""
        SELECT movement_type, COUNT(*) as cnt,
               SUM(CASE WHEN amount IS NULL OR amount = 0 THEN 1 ELSE 0 END) as no_amt
        FROM inventory_movement
        GROUP BY movement_type
    """)
    stats = [dict(zip([d[0] for d in cur.description], r)) for r in cur.fetchall()]

    print(f"\n=== 最终数据状态 ===")
    print(f"  sales_order: {total} 条 | 有收银员: {with_cashier} 条")
    print(f"  sales_order_line: 有SN: {with_sn} 条")
    for s in stats:
        print(f"  inventory_movement {s['movement_type']}: {s['cnt']}条 | 空金额:{s['no_amt']}")
    conn.close()
    return {"dedupe": r1, "enrich": r2, "sn": r3, "outbound": r4, "inbound": r5}

if __name__ == "__main__":
    run()
