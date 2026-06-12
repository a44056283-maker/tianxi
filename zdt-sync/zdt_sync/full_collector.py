"""
全量历史数据采集器
- 建一次 CDP 连接读 token，后续全部走 HTTP API（不开新页）
- 幂等写入 PostgreSQL
"""
from __future__ import annotations

import hashlib
import json
import ssl
import time
import urllib.error
import urllib.request
import websocket
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

# ── 单次 CDP 连接读 token（复用同一连接）─────────────────────────────

class _ChromeSession:
    """建立一次 CDP 连接，整个采集过程复用"""
    _instance = None

    def __init__(self):
        import json as _json, urllib.request as _ur
        targets = _json.loads(_ur.urlopen("http://127.0.0.1:9222/json/list", timeout=5).read())
        for t in targets:
            if t["type"] == "page" and "retail-pos" in t.get("url", ""):
                self._ws_url = t["webSocketDebuggerUrl"]
                self._url = t.get("url", "")
                break
        else:
            raise RuntimeError("未找到零售后台页面，请先在 Chrome 打开智店通")

        self._ws = websocket.create_connection(self._ws_url, timeout=15)
        self._ws.settimeout(2)
        self._cid = 1
        self._ws.send(json.dumps({"id": self._cid, "method": "Runtime.enable"}))
        self._cid += 1
        time.sleep(0.3)

    def eval(self, script: str) -> str:
        self._ws.send(json.dumps({"id": self._cid, "method": "Runtime.evaluate",
                                  "params": {"expression": script, "returnByValue": True}}))
        self._cid += 1
        start = time.time()
        while time.time() - start < 8:
            self._ws.settimeout(1)
            try:
                m = json.loads(self._ws.recv())
                if m.get("id") == self._cid - 1:
                    return m.get("result", {}).get("result", {}).get("value", "")
            except:
                pass
        return ""

    def read_token(self) -> tuple[str, str]:
        token_raw = self.eval('localStorage.getItem("user.token")').strip('"')
        tenant_raw = self.eval('localStorage.getItem("user.tenantId")').strip('"')
        print(f"Token: {token_raw[:20]}... | TenantID: {tenant_raw}")
        return token_raw, tenant_raw

    def close(self):
        self._ws.close()

    @classmethod
    def get(cls) -> "_ChromeSession":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance


# ── HTTP API 调用 ────────────────────────────────────────────────────────

def _api_headers(token: str, tenant_id: str) -> dict:
    return {
        "token": token,
        "tenant-id": tenant_id,
        "channel-id": "601",
        "tenancyCode": "25",
        "lang": "zh-CN",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
    }

def _post(url: str, body: dict, token: str, tenant_id: str, timeout: int = 20) -> dict:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_api_headers(token, tenant_id), method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"code": e.code, "message": f"HTTP {e.code}: {e.read().decode()[:100]}"}

def _get(url: str, token: str, tenant_id: str, timeout: int = 20) -> dict:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers=_api_headers(token, tenant_id))
    try:
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"code": e.code, "message": f"HTTP {e.code}: {e.read().decode()[:100]}"}

# ── 分页采集 ────────────────────────────────────────────────────────────

def paginate(url: str, body: dict, token: str, tenant_id: str,
             page_size: int = 50) -> list[dict]:
    page = 1
    all_records = []
    while True:
        b = dict(body)
        b["pageNum"] = page
        b["pageSize"] = page_size
        d = _post(url, b, token, tenant_id)
        if d.get("code") != 0:
            print(f"    ⚠️ code={d.get('code')} msg={d.get('message')}")
            break
        data = d.get("data", {})
        total = data.get("total", 0)
        records = data.get("list", data.get("records", []))
        if not records:
            break
        all_records.extend(records)
        print(f"    第 {page} 页 +{len(records)} (累计 {len(all_records)}/{total})")
        if len(all_records) >= total:
            break
        page += 1
        time.sleep(0.3)
    return all_records


# ── 数据库写入 ──────────────────────────────────────────────────────────

def upsert_order(conn, raw: dict):
    order_id = raw.get("id", "")
    conn.execute(text("""
        INSERT INTO fact_orders (order_id, order_no, outer_order_no, store_name,
            created_time, pay_time, delivery_date,
            total_amount, pay_amount, discount_amount,
            status, status_name, order_type, order_type_name,
            channel_type, channel_type_name,
            delivery_type, delivery_type_name,
            buyer_phone, cashier_name, total_quantity,
            raw_payload, collected_at, source_name)
        VALUES (:oid, :no, :ono, :sname,
            :ct, :pt, :dd,
            :ta, :pa, :da,
            :st, :stn, :ot, :otn,
            :cht, :chtn,
            :dvt, :dvtn,
            :bp, :cn, :tq,
            :raw, now(), 'zhidiantong')
        ON CONFLICT (order_id) DO UPDATE SET
            total_amount = EXCLUDED.total_amount,
            pay_amount = EXCLUDED.pay_amount,
            status = EXCLUDED.status
    """), {
        "oid": order_id, "no": raw.get("orderNo", ""), "ono": raw.get("outerOrderNo", ""),
        "sname": raw.get("shopName", ""),
        "ct": raw.get("createdTime"), "pt": raw.get("payTime"),
        "dd": (raw.get("deliveryDateTime") or "")[:10] if raw.get("deliveryDateTime") else None,
        "ta": (raw.get("totalAmount") or 0) / 100,
        "pa": (raw.get("payAmount") or 0) / 100,
        "da": (raw.get("totalPromotionAmount") or 0) / 100,
        "st": raw.get("status"), "stn": raw.get("statusName", ""),
        "ot": raw.get("type"), "otn": raw.get("typeName", ""),
        "cht": raw.get("channelType"), "chtn": raw.get("channelTypeName", ""),
        "dvt": raw.get("deliveryType"), "dvtn": raw.get("deliveryTypeName", ""),
        "bp": raw.get("buyerPhone", ""),
        "cn": raw.get("cashierName", ""),
        "tq": raw.get("totalQuantity", 0),
        "raw": json.dumps(raw, ensure_ascii=False),
    })

    for item in (raw.get("orderItemList") or []):
        item_id = item.get("id")
        if not item_id:
            continue
        try:
            conn.execute(text("""
                INSERT INTO fact_order_items (id, order_id, product_id, product_name,
                    product_no, sku_no, barcode, mtm_code, spec, quantity,
                    unit_price, total_amount, pay_amount, discount_amount,
                    unit, serial_number, category_type, raw_payload, collected_at)
                VALUES (:id, :oid, :pid, :pn, :pno, :sno, :bc, :mtm, :spec, :q,
                    :up, :ta, :pa, :da, :u, :sn, :ct, :raw, now())
                ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity
            """), {
                "id": item_id, "oid": order_id,
                "pid": item.get("spuId"),
                "pn": item.get("productName", ""),
                "pno": item.get("productNo", ""),
                "sno": item.get("productItemNo", ""),
                "bc": item.get("barCode", ""),
                "mtm": item.get("mtmCode", ""),
                "spec": item.get("propertiesIndb", ""),
                "q": item.get("quantity", 0),
                "up": (item.get("unitPrice") or 0) / 100,
                "ta": (item.get("totalAmount") or 0) / 100,
                "pa": (item.get("payAmount") or 0) / 100,
                "da": (item.get("discountAmount") or 0) / 100,
                "u": item.get("unit", ""),
                "sn": item.get("serialNumber", ""),
                "ct": item.get("categoryType"),
                "raw": json.dumps(item, ensure_ascii=False),
            })
        except Exception:
            pass

    for pm in (raw.get("orderPayList") or []):
        pm_id = pm.get("id") or f"{order_id}_{pm.get('payType')}"
        try:
            conn.execute(text("""
                INSERT INTO fact_order_payments (id, order_id, pay_type, pay_type_name,
                    pay_channel, transaction, pay_amount, raw_payload, collected_at)
                VALUES (:id, :oid, :pt, :ptn, :pch, :tx, :pa, :raw, now())
                ON CONFLICT (id) DO UPDATE SET pay_amount = EXCLUDED.pay_amount
            """), {
                "id": pm_id, "oid": order_id,
                "pt": pm.get("payType"),
                "ptn": pm.get("payTypeName", ""),
                "pch": pm.get("payChannel", ""),
                "tx": pm.get("transaction", ""),
                "pa": (pm.get("payAmount") or 0) / 100,
                "raw": json.dumps(pm, ensure_ascii=False),
            })
        except Exception:
            pass


def upsert_stock_order(conn, raw: dict):
    soid = raw.get("id", "") or raw.get("orderId", "")
    if not soid:
        return
    try:
        conn.execute(text("""
            INSERT INTO fact_stock_orders (stock_order_id, order_no, order_type, order_type_name,
                store_name, status, status_name, create_user_name,
                created_time, confirm_time, remark, raw_payload, collected_at, source_name)
            VALUES (:id, :no, :ot, :otn, :sn, :st, :stn, :cu,
                :ct, :cft, :rem, :raw, now(), 'zhidiantong')
            ON CONFLICT (stock_order_id) DO UPDATE SET status = EXCLUDED.status
        """), {
            "id": soid,
            "no": raw.get("orderNo", ""),
            "ot": raw.get("orderType"),
            "otn": raw.get("orderTypeName", ""),
            "sn": raw.get("shopName", "") or raw.get("storeName", ""),
            "st": raw.get("status"),
            "stn": raw.get("statusName", ""),
            "cu": raw.get("createUserName", "") or raw.get("createName", ""),
            "ct": raw.get("createTime", "") or raw.get("createdTime", ""),
            "cft": raw.get("confirmTime", ""),
            "rem": raw.get("remark", ""),
            "raw": json.dumps(raw, ensure_ascii=False),
        })
    except Exception:
        pass


# ── 主采集流程 ──────────────────────────────────────────────────────────

def run():
    print("=" * 60)
    print("智店通 · 全量历史数据采集")
    print("=" * 60)

    # ── 1. 建一次 CDP 连接，读 token ──────────────────────────────
    chrome = _ChromeSession.get()
    token, tenant_id = chrome.read_token()
    COMPANY_ID = "654987208927359345"

    DB_URL = "postgresql+psycopg://zdt:zdt@localhost:5432/zdt_sync"
    engine = create_engine(DB_URL, poolclass=NullPool)

    with engine.connect() as conn:
        # ══════════════════════════════════════════
        # 1. 线下订单
        # ══════════════════════════════════════════
        print("\n📦 采集线下门店订单...")
        body = {"companyId": COMPANY_ID, "type": 1, "pageNum": 1, "pageSize": 50}
        records = paginate(
            "https://retail-pos.lenovo.com/apis/trade/backend/order/findPage",
            body, token, tenant_id
        )
        for raw in records:
            upsert_order(conn, raw)
        conn.commit()
        print(f"  ✅ 写入 {len(records)} 条线下订单")

        # 统计
        for tbl in ["fact_orders", "fact_order_items", "fact_order_payments"]:
            cnt = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).fetchone()[0]
            print(f"     {tbl}: {cnt} 条")

    print("\n" + "=" * 60)
    print("采集完成！")
    print("=" * 60)

if __name__ == "__main__":
    run()
