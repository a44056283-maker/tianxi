"""
纯 API 模式采集器 - 直接调用后端 API，不依赖浏览器 DOM
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import yaml

from zdt_sync.settings import load_settings
from zdt_sync.utils import ensure_dir

# ── Chrome CDP 读取 ──────────────────────────────────────────────────────────

def _get_retail_ws_url() -> tuple[str, str] | None:
    """返回 (ws_url, page_url)"""
    import websocket
    import urllib.request
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5).read())
    for t in targets:
        if t["type"] == "page" and "retail-pos" in t.get("url", ""):
            return t["webSocketDebuggerUrl"], t.get("url", "")
    return None


def _read_token_from_chrome() -> tuple[str, str]:
    """实时从 Chrome localStorage 读取 token 和 tenant-id"""
    import websocket
    info = _get_retail_ws_url()
    if not info:
        raise RuntimeError("未找到零售后台页面，请先在 Chrome 打开智店通")
    ws_url, page_url = info

    ws = websocket.create_connection(ws_url, timeout=15)
    ws.settimeout(2)
    ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
    time.sleep(0.3)

    for cid, key in [(100, "user.token"), (101, "user.tenantId")]:
        ws.send(json.dumps({"id": cid, "method": "Runtime.evaluate", "params": {
            "expression": f"localStorage.getItem('{key}')", "returnByValue": True
        }}))

    token = tenant_id = None
    start = time.time()
    while time.time() - start < 8:
        try:
            m = json.loads(ws.recv())
            if m.get("id") == 100:
                token = m.get("result", {}).get("result", {}).get("value", "").strip('"')
            if m.get("id") == 101:
                tenant_id = m.get("result", {}).get("result", {}).get("value", "").strip('"')
        except:
            pass
    ws.close()

    if not token:
        raise RuntimeError("从 Chrome 读取 token 失败，请确认已登录")
    return token, tenant_id or ""


# ── API 调用 ─────────────────────────────────────────────────────────────────

def _build_api_headers(token: str, tenant_id: str) -> dict:
    return {
        "token": token,
        "tenant-id": tenant_id,
        "channel-id": "601",
        "tenancyCode": "25",
        "lang": "zh-CN",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
    }


def _post(ctx: ssl.SSLContext, url: str, body: dict, headers: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"API {url} HTTP {e.code}: {e.read().decode()[:200]}")


# ── 采集器 ────────────────────────────────────────────────────────────────────

def collect_orders(
    start_date: str | None = None,
    end_date: str | None = None,
    company_id: str = "654987208927359345",
    page_size: int = 50,
) -> list[dict]:
    """
    采集订单数据，返回订单列表。
    company_id 通过 findUserNestOrg 动态获取。
    """
    token, tenant_id = _read_token_from_chrome()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    h = _build_api_headers(token, tenant_id)

    # 动态获取 company_id（如果没有传）
    if not company_id:
        body = json.dumps({"status": [1, 2, 3], "enableDataPermFilter": True,
                           "orgTypes": [2, 3], "disableUnSelectNode": True}).encode()
        req = urllib.request.Request(
            "https://retail-pos.lenovo.com/apis/uc/backend/org/findUserNestOrg",
            data=body, headers=h, method="POST")
        resp = json.loads(urllib.request.urlopen(req, timeout=10, context=ctx).read())
        if resp.get("code") != 0 or not resp.get("data"):
            raise RuntimeError(f"获取 company_id 失败: {resp}")
        company_id = resp["data"][0]["id"]
        print(f"  动态 companyId: {company_id} ({resp['data'][0].get('name', '')})")

    # 日期默认当天
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")
    if not start_date:
        start_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    all_records = []
    page = 1
    while True:
        body = {
            "placeStartTime": start_date,
            "placeEndTime": end_date,
            "companyId": company_id,
            "type": 1,
            "pageNum": page,
            "pageSize": page_size,
        }
        d = _post(ctx, "https://retail-pos.lenovo.com/apis/trade/backend/order/findPage", body, h)
        if d.get("code") != 0:
            raise RuntimeError(f"订单 API 失败: {d}")
        data = d.get("data", {})
        records = data.get("list", [])
        total = data.get("total", 0)
        if not records:
            break
        all_records.extend(records)
        print(f"  第 {page} 页 +{len(records)} 条 (累计 {len(all_records)}/{total})")
        if len(all_records) >= total:
            break
        page += 1
        time.sleep(0.3)

    return all_records


def collect_products(
    company_id: str = "654987208927359345",
    page_size: int = 50,
) -> list[dict]:
    """采集商品数据"""
    token, tenant_id = _read_token_from_chrome()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    h = _build_api_headers(token, tenant_id)

    # 先找商品列表 API
    # 已知页面 /product/list-city 和 /product/list-store
    # 尝试拦截
    all_records = []
    page = 1
    while True:
        # 门店商品
        body = {"companyId": company_id, "pageNum": page, "pageSize": page_size}
        d = _post(ctx, "https://retail-pos.lenovo.com/apis/product/backend/product/item/list", body, h)
        if d.get("code") != 0:
            break
        data = d.get("data", {})
        records = data.get("list", [])
        total = data.get("total", 0)
        if not records:
            break
        all_records.extend(records)
        print(f"  商品第 {page} 页 +{len(records)} (累计 {len(all_records)}/{total})")
        if len(all_records) >= total:
            break
        page += 1
        time.sleep(0.3)
    return all_records


# ── 字段映射 ─────────────────────────────────────────────────────────────────

ORDER_FIELDS = [
    "id", "orderNo", "outerOrderNo", "status", "statusName",
    "totalAmount", "payAmount", "paidAmount",
    "shopName", "typeName", "channelTypeName", "channelName",
    "payTime", "createdTime", "cashierName",
    "payTypeName", "payChannelName", "transaction",
    "totalQuantity", "deliveryTypeName",
]

def flatten_order(raw: dict) -> dict:
    """把嵌套订单对象拍平"""
    flat = {k: raw.get(k, "") for k in ORDER_FIELDS}
    flat["orderNo"] = raw.get("orderNo", "")
    flat["orderTime"] = raw.get("createdTime", "")
    flat["payTime"] = raw.get("payTime", "")
    flat["totalAmount"] = raw.get("totalAmount", 0) / 100  # 分→元
    flat["payAmount"] = raw.get("payAmount", 0) / 100
    flat["paidAmount"] = raw.get("paidAmount", 0) / 100
    flat["items"] = json.dumps(raw.get("orderItemList", []), ensure_ascii=False)
    flat["payments"] = json.dumps(raw.get("orderPayList", []), ensure_ascii=False)
    return flat
