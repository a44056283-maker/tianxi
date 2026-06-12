#!/usr/bin/env python3
"""
每日增量同步脚本 - 纯 HTTP API，不开浏览器
用法: python3 scripts/incremental_sync.py
"""
import json, ssl, urllib.request, urllib.error, os, time
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from datetime import datetime, date

# 加载认证
AUTH_FILE = os.path.join(os.path.dirname(__file__), "..", ".auth", "session.json")
auth = json.load(open(AUTH_FILE))
TOKEN = auth["token"]
TENANT_ID = auth["tenant_id"]
COMPANY_ID = auth["company_id"]
BASE = auth["base_url"]
DB_URL = "postgresql+psycopg://zdt:zdt@localhost:5432/zdt_sync"

def api(path, body):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(BASE+path, data=json.dumps(body).encode(),
        headers={"token":TOKEN,"tenant-id":TENANT_ID,"channel-id":"601","tenancyCode":"25",
                 "Content-Type":"application/json;charset=UTF-8"}, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=20, context=ctx)
        return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return {"code":e.code,"msg":e.read().decode()[:300]}, e.code

engine = create_engine(DB_URL, poolclass=NullPool)
today = date.today().isoformat()
print(f"增量同步开始: {today}")

# ── 1. 实时库存（全量快照，只更新已有） ──
print("\n[1/3] 实时库存...")
d,s = api("/apis/prd/backend/shop/product/stock/batchBoardFindPage",
          {"shopIdList":[COMPANY_ID],"productType":1,"pageNum":1,"pageSize":50})
if s==200 and d.get("code")==0:
    total = d["data"]["total"]
    print(f"  实时库存: {total} 条（今日快照，仅更新）")
    # 写入 snapshot_date = today
    with engine.connect() as conn:
        for r in d["data"].get("list",[]):
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
                "id": r.get("id"), "sd": today,
                "sid": r.get("shopId"), "pid": r.get("skuId"),
                "skuno": r.get("skuNo",""), "bc": r.get("mtmCode",""),
                "pname": r.get("spuName",""),
                "avail": r.get("availableSaleStock",0),
                "locked": r.get("currentOrderSum",0),
                "transit": r.get("transferStock",0),
                "cost": (r.get("costPrice") or 0)/100,
                "rp": (r.get("retailPrice") or 0)/100,
                "raw": json.dumps(r),
            })
        conn.commit()
    print(f"  ✅ 实时库存同步完成")
else:
    print(f"  ❌ 实时库存同步失败: {str(d)[:100]}")

# ── 2. 库存流水（今日增量） ──
print("\n[2/3] 库存流水...")
d2,s2 = api("/apis/prd/backend/storeProductStockDeal/v1.0.1/findPage",
            {"shopId":COMPANY_ID,"startDate":today,"endDate":today,"pageNum":1,"pageSize":50})
if s2==200 and d2.get("code")==0:
    total2 = d2["data"]["total"]
    print(f"  今日库存流水: {total2} 条")
    with engine.connect() as conn:
        for r in d2["data"].get("list",[]):
            oid = r.get("serviceNo","")+"_"+str(r.get("id",""))
            if not oid or oid=="_": continue
            conn.execute(text("""
                INSERT INTO fact_stock_orders (stock_order_id, order_no, order_type_name,
                    store_id, store_code, store_name, created_time, remark,
                    raw_payload, collected_at, source_name)
                VALUES (:id, :ono, :otn, :sid, :scode, :sname, :ct, :rem, :raw, now(), 'zhidiantong')
                ON CONFLICT (stock_order_id) DO UPDATE SET
                    created_time = EXCLUDED.created_time,
                    raw_payload = EXCLUDED.raw_payload
            """), {
                "id": oid, "ono": r.get("serviceNo",""), "otn": r.get("operateTypeName",""),
                "sid": COMPANY_ID, "scode": r.get("shopNo",""), "sname": r.get("shopName",""),
                "ct": r.get("payTime"), "rem": r.get("payRemark",""), "raw": json.dumps(r),
            })
        conn.commit()
    print(f"  ✅ 库存流水同步完成")
else:
    print(f"  ❌ 库存流水同步失败: {str(d2)[:100]}")

# ── 3. SN序列号（今日增量） ──
print("\n[3/3] SN序列号...")
d3,s3 = api("/apis/prd/backend/shop/serialNumber/findPage",
            {"shopId":COMPANY_ID,"startDate":today,"endDate":today,"pageNum":1,"pageSize":50})
if s3==200 and d3.get("code")==0:
    total3 = d3["data"]["total"]
    print(f"  今日SN序列号: {total3} 条")
    with engine.connect() as conn:
        for r in d3["data"].get("list",[]):
            sid = r.get("id")
            if not sid: continue
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
        conn.commit()
    print(f"  ✅ SN序列号同步完成")
else:
    print(f"  ❌ SN序列号同步失败: {str(d3)[:100]}")

# 最终统计
with engine.connect() as conn:
    print("\n📊 当前数据库统计:")
    for tbl,col in [("fact_inventory","id"),("fact_stock_orders","stock_order_id"),("fact_sn_records","id")]:
        cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).fetchone()[0]
        last = conn.execute(text(f"SELECT MAX(collected_at) FROM {tbl}")).fetchone()[0]
        print(f"   {tbl}: {cnt} 条 | 最新采集: {str(last)[:19]}")

print(f"\n✅ {today} 增量同步完成！")
