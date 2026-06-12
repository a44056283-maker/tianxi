#!/usr/bin/env python3
"""
每日全量同步脚本 - 订单 + 库存 + 商品
纯 HTTP API，不开浏览器，不开新窗口
"""
import json, ssl, urllib.request, urllib.error, os, time
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from datetime import date

AUTH_FILE = os.path.join(os.path.dirname(__file__), "..", ".auth", "session.json")
auth = json.load(open(AUTH_FILE))
TOKEN = auth["token"]
TENANT_ID = auth["tenant_id"]
COMPANY_ID = auth["company_id"]
BASE = auth["base_url"]
DB_URL = "postgresql+psycopg://zdt:zdt@localhost:5432/zdt_sync"

def api(path, body):
    ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    req = urllib.request.Request(BASE+path, data=json.dumps(body).encode(),
        headers={"token":TOKEN,"tenant-id":TENANT_ID,"channel-id":"601","tenancyCode":"25",
                 "Content-Type":"application/json;charset=UTF-8"}, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=20, context=ctx)
        return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return {"code":e.code,"msg":e.read().decode()[:200]}, e.code

def paginate(path, body, label):
    page = 1; all_recs = []
    while True:
        b = dict(body); b["pageNum"] = page; b["pageSize"] = 50
        d, s = api(path, b)
        if s != 200 or d.get("code") != 0:
            print(f"  ❌ {label} code={d.get('code')} msg={d.get('msg','')[:100]}"); break
        data = d.get("data", {})
        total = data.get("total", 0)
        recs = data.get("list", [])
        if not recs: break
        all_recs.extend(recs)
        print(f"  {label} 第{page}页 +{len(recs)} (累计{len(all_recs)}/{total})")
        if len(all_recs) >= total: break
        page += 1; time.sleep(0.2)
    return all_recs

engine = create_engine(DB_URL, poolclass=NullPool)
today = date.today().isoformat()
print(f"{'='*50}")
print(f"知店通每日同步 | {today}")
print(f"{'='*50}")

# ═══════════════════════════════════════════
# 1. 订单 - 线下 type=1
# ═══════════════════════════════════════════
print("\n[1/6] 线下订单...")
recs = paginate("/apis/trade/backend/order/findPage",
                {"companyId": COMPANY_ID, "type": 1}, "线下订单")
with engine.connect() as conn:
    for raw in recs:
        oid = raw.get("id", "")
        if not oid: continue
        conn.execute(text("""
            INSERT INTO fact_orders (order_id, order_no, outer_order_no, store_name,
                created_time, pay_time, total_amount, pay_amount, discount_amount,
                status, status_name, order_type, order_type_name,
                channel_type, channel_type_name, delivery_type, delivery_type_name,
                buyer_phone, cashier_name, total_quantity, raw_payload, collected_at, source_name)
            VALUES (:oid, :no, :ono, :sn, :ct, :pt,
                :ta, :pa, :da, :st, :stn, :ot, :otn,
                :cht, :chtn, :dvt, :dvtn, :bp, :cn, :tq, :raw, now(), 'zhidiantong')
            ON CONFLICT (order_id) DO UPDATE SET
                pay_amount = EXCLUDED.pay_amount, status = EXCLUDED.status,
                raw_payload = EXCLUDED.raw_payload
        """), {
            "oid": oid, "no": raw.get("orderNo",""), "ono": raw.get("outerOrderNo",""),
            "sn": raw.get("shopName",""), "ct": raw.get("createdTime"), "pt": raw.get("payTime"),
            "ta": (raw.get("totalAmount") or 0)/100, "pa": (raw.get("payAmount") or 0)/100,
            "da": (raw.get("totalPromotionAmount") or 0)/100,
            "st": raw.get("status"), "stn": raw.get("statusName",""),
            "ot": raw.get("type"), "otn": raw.get("typeName",""),
            "cht": raw.get("channelType"), "chtn": raw.get("channelTypeName",""),
            "dvt": raw.get("deliveryType"), "dvtn": raw.get("deliveryTypeName",""),
            "bp": raw.get("buyerPhone",""), "cn": raw.get("cashierName",""),
            "tq": raw.get("totalQuantity",0), "raw": json.dumps(raw),
        })
        # 订单明细
        for item in (raw.get("orderItemList") or []):
            iid = item.get("id")
            if not iid: continue
            try:
                conn.execute(text("""
                    INSERT INTO fact_order_items (id, order_id, product_id, product_name,
                        product_no, sku_no, barcode, mtm_code, spec, quantity,
                        unit_price, total_amount, pay_amount, discount_amount,
                        unit, serial_number, raw_payload, collected_at)
                    VALUES (:id, :oid, :pid, :pn, :pno, :sno, :bc, :mtm, :spec, :q,
                        :up, :ta, :pa, :da, :u, :sn, :raw, now())
                    ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity
                """), {
                    "id": iid, "oid": oid, "pid": item.get("spuId"),
                    "pn": item.get("productName",""), "pno": item.get("productNo",""),
                    "sno": item.get("productItemNo",""), "bc": item.get("barCode",""),
                    "mtm": item.get("mtmCode",""), "spec": item.get("propertiesIndb",""),
                    "q": item.get("quantity",0), "up": (item.get("unitPrice") or 0)/100,
                    "ta": (item.get("totalAmount") or 0)/100, "pa": (item.get("payAmount") or 0)/100,
                    "da": (item.get("discountAmount") or 0)/100, "u": item.get("unit",""),
                    "sn": item.get("serialNumber",""), "raw": json.dumps(item),
                })
            except: pass
        # 支付明细
        for pm in (raw.get("orderPayList") or []):
            mid = pm.get("id") or f"{oid}_{pm.get('payType')}"
            try:
                conn.execute(text("""
                    INSERT INTO fact_order_payments (id, order_id, pay_type, pay_type_name,
                        pay_channel, transaction, pay_amount, raw_payload, collected_at)
                    VALUES (:id, :oid, :pt, :ptn, :pch, :tx, :pa, :raw, now())
                    ON CONFLICT (id) DO UPDATE SET pay_amount = EXCLUDED.pay_amount
                """), {
                    "id": mid, "oid": oid, "pt": pm.get("payType"), "ptn": pm.get("payTypeName",""),
                    "pch": pm.get("payChannel",""), "tx": pm.get("transaction",""),
                    "pa": (pm.get("payAmount") or 0)/100, "raw": json.dumps(pm),
                })
            except: pass
    conn.commit()
print(f"  ✅ 线下订单写入完成: {len(recs)} 条")

# ═══════════════════════════════════════════
# 2. 订单 - 线上 type=2
# ═══════════════════════════════════════════
print("\n[2/6] 线上订单...")
recs2 = paginate("/apis/trade/backend/order/findPage",
                 {"companyId": COMPANY_ID, "type": 2}, "线上订单")
with engine.connect() as conn:
    for raw in recs2:
        oid = raw.get("id", "")
        if not oid: continue
        try:
            conn.execute(text("""
                INSERT INTO fact_orders (order_id, order_no, outer_order_no, store_name,
                    created_time, pay_time, total_amount, pay_amount, discount_amount,
                    status, status_name, order_type, order_type_name,
                    channel_type, channel_type_name, delivery_type, delivery_type_name,
                    buyer_phone, cashier_name, total_quantity, raw_payload, collected_at, source_name)
                VALUES (:oid, :no, :ono, :sn, :ct, :pt,
                    :ta, :pa, :da, :st, :stn, :ot, :otn,
                    :cht, :chtn, :dvt, :dvtn, :bp, :cn, :tq, :raw, now(), 'zhidiantong')
                ON CONFLICT (order_id) DO UPDATE SET
                    pay_amount = EXCLUDED.pay_amount, status = EXCLUDED.status,
                    raw_payload = EXCLUDED.raw_payload
            """), {
                "oid": oid, "no": raw.get("orderNo",""), "ono": raw.get("outerOrderNo",""),
                "sn": raw.get("shopName",""), "ct": raw.get("createdTime"), "pt": raw.get("payTime"),
                "ta": (raw.get("totalAmount") or 0)/100, "pa": (raw.get("payAmount") or 0)/100,
                "da": (raw.get("totalPromotionAmount") or 0)/100,
                "st": raw.get("status"), "stn": raw.get("statusName",""),
                "ot": raw.get("type"), "otn": raw.get("typeName",""),
                "cht": raw.get("channelType"), "chtn": raw.get("channelTypeName",""),
                "dvt": raw.get("deliveryType"), "dvtn": raw.get("deliveryTypeName",""),
                "bp": raw.get("buyerPhone",""), "cn": raw.get("cashierName",""),
                "tq": raw.get("totalQuantity",0), "raw": json.dumps(raw),
            })
        except: pass
    conn.commit()
print(f"  ✅ 线上订单写入完成: {len(recs2)} 条")

# ═══════════════════════════════════════════
# 3. 商品档案
# ═══════════════════════════════════════════
print("\n[3/6] 商品档案...")
recs3 = paginate("/apis/prd/backend/shop/product/findPageShopProduct",
                 {"shopId": COMPANY_ID, "source": "1"}, "商品档案")
with engine.connect() as conn:
    for r in recs3:
        pid = r.get("id")
        if not pid: continue
        try:
            conn.execute(text("""
                INSERT INTO fact_products (product_id, sku_id, sku_no, product_no, barcode, mtm_code,
                    name, category, spec, store_id, store_code, store_name,
                    retail_price, cost_price, channel_price, status, status_name,
                    unit, pic_url, raw_payload, collected_at, source_name)
                VALUES (:pid, :skuid, :skuno, :pno, :bc, :mtm, :name, :cat, :spec,
                    :sid, :scode, :sname, :rp, :cp, :chp, :st, :stn, :u, :pic, :raw, now(), 'zhidiantong')
                ON CONFLICT (product_id) DO UPDATE SET
                    name = EXCLUDED.name, status = EXCLUDED.status,
                    retail_price = EXCLUDED.retail_price,
                    raw_payload = EXCLUDED.raw_payload, collected_at = now()
            """), {
                "pid": int(pid), "skuid": r.get("skuId") or None,
                "skuno": r.get("skuNo","") or "", "pno": r.get("productNo","") or "",
                "bc": r.get("barCode","") or "", "mtm": r.get("mtmCode","") or "",
                "name": r.get("productName",""), "cat": r.get("categoryText",""),
                "spec": r.get("propertiesIndb","") or "",
                "sid": int(r.get("shopId") or COMPANY_ID),
                "scode": "", "sname": "",
                "rp": (r.get("retailPrice") or 0)/100,
                "cp": (r.get("costPrice") or 0)/100,
                "chp": (r.get("channelPrice") or 0)/100,
                "st": r.get("status"), "stn": {1:"上架",0:"下架"}.get(r.get("status"),""),
                "u": r.get("unit",""), "pic": r.get("imageUrl",""),
                "raw": json.dumps(r),
            })
        except: pass
    conn.commit()
print(f"  ✅ 商品档案写入完成: {len(recs3)} 条")

# ═══════════════════════════════════════════
# 4. 实时库存快照
# ═══════════════════════════════════════════
print("\n[4/6] 实时库存...")
page = 1; inv_total = 0
while True:
    d, s = api("/apis/prd/backend/shop/product/stock/batchBoardFindPage",
               {"shopIdList":[COMPANY_ID],"productType":1,"pageNum":page,"pageSize":50})
    if s != 200 or d.get("code") != 0: print(f"  ❌ 实时库存: {str(d)[:100]}"); break
    data = d.get("data",{}); recs4 = data.get("list",[])
    if not recs4: break
    with engine.connect() as conn:
        for r in recs4:
            try:
                conn.execute(text("""
                    INSERT INTO fact_inventory (id, snapshot_date, store_id, product_id, sku_no,
                        barcode, product_name, available_qty, locked_qty, in_transit_qty,
                        unit_cost, retail_price, raw_payload, collected_at)
                    VALUES (:id, :sd, :sid, :pid, :skuno, :bc, :pname,
                        :avail, :locked, :transit, :cost, :rp, :raw, now())
                    ON CONFLICT (id) DO UPDATE SET
                        snapshot_date = EXCLUDED.snapshot_date,
                        available_qty = EXCLUDED.available_qty,
                        locked_qty = EXCLUDED.locked_qty,
                        collected_at = now()
                """), {
                    "id": r.get("id"), "sd": today, "sid": r.get("shopId"),
                    "pid": r.get("skuId"), "skuno": r.get("skuNo",""),
                    "bc": r.get("mtmCode",""), "pname": r.get("spuName",""),
                    "avail": r.get("availableSaleStock",0), "locked": r.get("currentOrderSum",0),
                    "transit": r.get("transferStock",0),
                    "cost": (r.get("costPrice") or 0)/100,
                    "rp": (r.get("retailPrice") or 0)/100, "raw": json.dumps(r),
                })
            except: pass
        conn.commit()
    inv_total += len(recs4)
    print(f"  实时库存 第{page}/{data.get('pages',1)}页 +{len(recs4)} (累计{inv_total}/{data.get('total',0)})")
    if page >= data.get("pages",1): break
    page += 1; time.sleep(0.2)
print(f"  ✅ 实时库存写入完成: {inv_total} 条")

# ═══════════════════════════════════════════
# 5. 库存流水
# ═══════════════════════════════════════════
print("\n[5/6] 库存流水...")
recs5 = paginate("/apis/prd/backend/storeProductStockDeal/v1.0.1/findPage",
                 {"shopId": COMPANY_ID, "startDate": "2026-01-01", "endDate": today},
                 "库存流水")
with engine.connect() as conn:
    for r in recs5:
        oid = r.get("serviceNo","") + "_" + str(r.get("id",""))
        if not oid or oid == "_": continue
        try:
            conn.execute(text("""
                INSERT INTO fact_stock_orders (stock_order_id, order_no, order_type_name,
                    store_id, store_code, store_name, created_time, remark,
                    raw_payload, collected_at, source_name)
                VALUES (:id, :ono, :otn, :sid, :scode, :sname, :ct, :rem, :raw, now(), 'zhidiantong')
                ON CONFLICT (stock_order_id) DO UPDATE SET
                    created_time = EXCLUDED.created_time, raw_payload = EXCLUDED.raw_payload
            """), {
                "id": oid, "ono": r.get("serviceNo",""), "otn": r.get("operateTypeName",""),
                "sid": COMPANY_ID, "scode": r.get("shopNo",""), "sname": r.get("shopName",""),
                "ct": r.get("payTime"), "rem": r.get("payRemark",""), "raw": json.dumps(r),
            })
        except: pass
    conn.commit()
print(f"  ✅ 库存流水写入完成: {len(recs5)} 条")

# ═══════════════════════════════════════════
# 6. SN序列号
# ═══════════════════════════════════════════
print("\n[6/6] SN序列号...")
recs6 = paginate("/apis/prd/backend/shop/serialNumber/findPage",
                 {"shopId": COMPANY_ID, "startDate": "2026-01-01", "endDate": today},
                 "SN序列号")
with engine.connect() as conn:
    for r in recs6:
        sid = r.get("id")
        if not sid: continue
        try:
            conn.execute(text("""
                INSERT INTO fact_sn_records (id, serial_number, spu_no, sku_no, mtm_code,
                    product_name, property_name, shop_no, shop_name,
                    service_type_name, service_no, operate_type_name, user_name,
                    pay_time, pay_remark, sales_property, shop_location_id, shop_location_name,
                    raw_payload, collected_at)
                VALUES (:id, :sn, :spu, :sku, :mtm, :pn, :prop, :sno, :sname,
                    :stn, :sno2, :otn, :uname, :pt, :prem, :sp, :slid, :slname, :raw, now())
                ON CONFLICT (id) DO UPDATE SET
                    pay_time = EXCLUDED.pay_time,
                    operate_type_name = EXCLUDED.operate_type_name,
                    raw_payload = EXCLUDED.raw_payload
            """), {
                "id": sid, "sn": r.get("serialNumber",""), "spu": r.get("spuNo",""),
                "sku": r.get("skuNo",""), "mtm": r.get("mtmCode",""),
                "pn": r.get("productName",""), "prop": r.get("propertyName",""),
                "sno": r.get("shopNo",""), "sname": r.get("shopName",""),
                "stn": r.get("serviceTypeName",""), "sno2": r.get("serviceNo",""),
                "otn": r.get("operateTypeName",""), "uname": r.get("userName",""),
                "pt": r.get("payTime"), "prem": r.get("payRemark",""),
                "sp": r.get("salesProperty"), "slid": r.get("shopLocationId",""),
                "slname": r.get("shopLocationName",""), "raw": json.dumps(r),
            })
        except: pass
    conn.commit()
print(f"  ✅ SN序列号写入完成: {len(recs6)} 条")

# ═══════════════════════════════════════════
# 最终统计
# ═══════════════════════════════════════════
print(f"\n{'='*50}")
print(f"📊 数据库统计")
print(f"{'='*50}")
with engine.connect() as conn:
    tables = [
        ("fact_orders", "order_id"),
        ("fact_order_items", "id"),
        ("fact_order_payments", "id"),
        ("fact_products", "product_id"),
        ("fact_inventory", "id"),
        ("fact_stock_orders", "stock_order_id"),
        ("fact_sn_records", "id"),
    ]
    for tbl, pk in tables:
        try:
            cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).fetchone()[0]
            last = conn.execute(text(f"SELECT MAX(collected_at) FROM {tbl}")).fetchone()[0]
            print(f"  {tbl}: {cnt} 条 | {str(last)[:19]}")
        except: pass

print(f"\n✅ {today} 全量同步完成！")
