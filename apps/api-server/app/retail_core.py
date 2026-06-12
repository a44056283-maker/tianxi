from __future__ import annotations

import json
import hashlib
import os
import re
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB_FILE = APP_DIR / "data" / "retail-core.sqlite3"
ARTIFACT_DIR = APP_DIR.parent / "inventory-sync" / "artifacts"
MANUAL_NEARBY_QUOTE_FILE = APP_DIR.parent / "inventory-sync" / "artifacts" / "manual" / "sales-price-protection-nearby-quotes.json"


def resolve_db_file() -> Path:
    configured = os.environ.get("LENOVO_SMART_RETAIL_DB_FILE", "").strip()
    if configured:
        return Path(configured).expanduser()
    return DEFAULT_DB_FILE


DB_FILE = resolve_db_file()
INIT_DB_LOCK = threading.Lock()
INIT_DB_DONE = False
SQLITE_INT64_MAX = 2**63 - 1
INVENTORY_MOVEMENT_QTY_ABSURD_THRESHOLD = 100
PHYSICAL_HOLD_WAREHOUSE_CODE = "PO_HOLD"
PHYSICAL_HOLD_LOCATION_CODE = "PO_EDU_REAL_STOCK"
PHYSICAL_HOLD_RELEASE_LOCATION_CODE = "SALES_FLOOR"
PHYSICAL_HOLD_CONSUMED_LOCATION_CODE = "PO_EDU_CONSUMED"
PHYSICAL_HOLD_REVOKED_LOCATION_CODE = "PO_EDU_REVOKED"
PHYSICAL_HOLD_REASON_PREOUT = "po_education_preout"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_business_datetime_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = text.replace("T", " ").replace("Z", "").strip()
    matched = re.search(r"(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?", normalized)
    if not matched:
        return normalized
    date_part = matched.group(1)
    time_part = matched.group(2)
    if not time_part:
        return date_part
    parts = time_part.split(":")
    if len(parts) == 2:
        parts.append("00")
    return f"{date_part} {':'.join(part.zfill(2) for part in parts[:3])}"


def extract_business_date(value: Any) -> date | None:
    text = normalize_business_datetime_text(value)
    matched = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if not matched:
        return None
    try:
        return date(int(matched.group(1)), int(matched.group(2)), int(matched.group(3)))
    except ValueError:
        return None


def format_short_date(value: Any) -> str:
    text = str(value or "").strip()
    matched = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if matched:
        return f"{matched.group(1)[2:]}/{matched.group(2)}/{matched.group(3)}"
    return text.replace("-", "/").removeprefix("20")


def format_countdown_label(days: Any) -> str:
    try:
        value = int(days)
    except (TypeError, ValueError):
        return ""
    return f"剩余 {max(value, 0)} 天"


def parse_sqlite_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(float(value or 0) or 0)
    except (TypeError, ValueError, OverflowError):
        return default
    if parsed > SQLITE_INT64_MAX or parsed < -SQLITE_INT64_MAX - 1:
        return default
    return parsed


def count_serial_tokens(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, list):
        return sum(1 for item in value if str(item or "").strip())
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    if isinstance(parsed, list):
        return sum(1 for item in parsed if str(item or "").strip())
    return sum(1 for item in text.split(",") if item.strip())


def normalize_inventory_movement_quantity(
    raw_quantity: Any,
    *,
    movement_type: str = "",
    serial_number: Any = None,
    amount: Any = None,
    unit_cost: Any = None,
) -> int:
    quantity = abs(parse_sqlite_int(raw_quantity))
    if 0 < quantity <= INVENTORY_MOVEMENT_QTY_ABSURD_THRESHOLD:
        return quantity
    serial_count = count_serial_tokens(serial_number)
    if serial_count > 0:
        return serial_count
    try:
        normalized_amount = abs(float(amount or 0))
    except (TypeError, ValueError, OverflowError):
        normalized_amount = 0.0
    try:
        normalized_unit_cost = abs(float(unit_cost or 0))
    except (TypeError, ValueError, OverflowError):
        normalized_unit_cost = 0.0
    if normalized_amount > 0 and normalized_unit_cost > 0:
        inferred = int(round(normalized_amount / normalized_unit_cost))
        if 0 < inferred <= INVENTORY_MOVEMENT_QTY_ABSURD_THRESHOLD:
            return inferred
    if quantity > 0 and quantity <= SQLITE_INT64_MAX:
        return 1
    return 1 if movement_type else 0


def normalize_lookup_key(value: Any) -> str:
    return str(value or "").strip().upper().replace(" ", "")


def strip_zdt_prefix(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text.startswith("ZDT-"):
        return text[4:].strip()
    return text


def normalize_openclaw_currency_amount(value: Any) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return round(amount / 100, 2)


def normalize_purchase_cost_amount(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if abs(amount) >= 100000:
        amount = amount / 100.0
    return round(amount, 0)


def normalize_product_category_fields(
    raw_category: Any,
    source_category: Any,
    jd_subcategory: Any,
    product_name: Any,
    spec: Any = "",
    pn_mtm: Any = "",
    catalog_source: Any = "",
) -> dict[str, str]:
    raw_category_text = str(raw_category or "").strip()
    source_category_text = str(source_category or raw_category_text or "").strip()
    jd_subcategory_text = str(jd_subcategory or "").strip()
    product_name_text = str(product_name or "").strip()
    spec_text = str(spec or "").strip()
    pn_mtm_text = str(pn_mtm or "").strip()
    catalog_source_text = str(catalog_source or "").strip()
    text = " ".join(
        value
        for value in (
            raw_category_text,
            source_category_text,
            product_name_text,
            spec_text,
            pn_mtm_text,
        )
        if value
    )
    lecoo_catalog_source = "来酷官方旗舰店目录"

    def build(category: str, subcategory: str, chosen_catalog_source: str | None = None) -> dict[str, str]:
        return {
            "category": category,
            "sourceCategory": source_category_text or raw_category_text or category,
            "jdSubcategory": subcategory,
            "catalogSource": chosen_catalog_source or catalog_source_text or "联想京东自营旗舰店目录",
        }

    if re.search(r"拯救者火力强化", source_category_text, re.I):
        return build("电脑配件", "存储升级")
    if re.search(r"小新\s*PRO\s*16|小新PRO16|PRO\s*16C|PRO16C|PRO\s*16GT|PRO16GT", text, re.I):
        return build("轻薄笔记本", "小新Pro16")
    if re.search(r"小新\s*PRO\s*14|小新PRO14|PRO\s*14C|PRO14C|PRO\s*14GT|PRO14GT", text, re.I):
        return build("轻薄笔记本", "小新Pro14")
    if (
        re.search(r"平板|TAB(?![A-Z0-9])|PAD|\bTB[0-9A-Z]{4,}\b|Y700(?!0)|Y900", text, re.I)
        and re.search(r"配件|键盘|磁吸键盘|手写笔|触控笔|保护套|保护壳|保护夹|钢化膜|贴膜|支架|底座|散热壳|妙想键盘|笔尖|套装", text, re.I)
    ):
        return build("电脑配件", "平板配件")
    if re.search(r"小新平板|拯救者平板|YOGA平板", source_category_text, re.I) or re.search(r"平板|TAB(?![A-Z0-9])|PAD|\bTB[0-9A-Z]{4,}\b", text, re.I):
        if re.search(r"拯救者|Y700", text, re.I):
            return build("平板电脑", "拯救者平板")
        if re.search(r"YOGA", text, re.I):
            return build("平板电脑", "YOGA平板")
        return build("平板电脑", "小新平板")
    if re.search(r"手机|MOTO|RAZR|EDGE|PHN|XT\d+|折叠机|直板机", text, re.I):
        if re.search(r"RAZR|折叠", text, re.I):
            return build("手机", "moto折叠屏手机")
        return build("手机", "moto手机")
    if re.search(r"耳机|耳麦|HEADSET|X600|Y360|R360", text, re.I):
        if re.search(r"拯救者|电竞", text, re.I):
            return build("耳机音箱", "电竞耳机")
        return build("耳机音箱", "蓝牙耳机")
    if re.search(r"打印机|喷墨|激光|鲸鱼|PANDA|CM408", text, re.I):
        if re.search(r"激光|PANDA", text, re.I):
            return build("打印机", "激光打印机")
        return build("打印机", "喷墨打印机")
    if re.search(r"24-ILL|27-ILL|27-IRH|AIO|一体机", text, re.I):
        if re.search(r"小新", text, re.I):
            return build("一体机", "小新一体机")
        return build("一体机", "联想一体机")
    if re.search(r"THINKVISION", text, re.I):
        return build("显示器", "办公显示器")
    if re.search(r"U盘|内存条|扩展坞|拓展坞|线材类|刻录机|周边|游戏手柄", text, re.I):
        if re.search(r"内存条", text, re.I):
            return build("电脑配件", "存储升级")
        if re.search(r"扩展坞|拓展坞", text, re.I):
            return build("电脑配件", "扩展坞")
        if re.search(r"线材类", text, re.I):
            return build("电脑配件", "线材")
        if re.search(r"U盘", text, re.I):
            return build("电脑配件", "移动存储")
        if re.search(r"游戏手柄", text, re.I):
            return build("电脑配件", "游戏手柄")
        return build("电脑配件", "其他配件")
    if re.search(r"词典笔|冲牙器|剃须刀|按摩仪器|电动牙刷|跳绳|其他家居|解决方案产品", text, re.I):
        return build("智能生活", source_category_text or jd_subcategory_text or "智能生活")
    if re.search(r"鼠标|键盘|支架|适配器|充电器|硬盘|箱包|背包|保护|钢化膜|手写笔|键鼠|GM11|GK10|QXR|QXD|QX4|GX21|ZG38|QZQ|QXB", text, re.I):
        if re.search(r"鼠标|GM11", text, re.I):
            return build("电脑配件", "鼠标")
        if re.search(r"键盘|键鼠|GK10", text, re.I):
            return build("电脑配件", "键盘/键鼠套装")
        if re.search(r"支架", text, re.I):
            return build("电脑配件", "支架")
        if re.search(r"适配器|充电器|氮化镓", text, re.I):
            return build("电脑配件", "电源适配器")
        if re.search(r"硬盘|火力强化", text, re.I):
            return build("电脑配件", "存储升级")
        if re.search(r"保护|钢化膜|手写笔", text, re.I):
            return build("电脑配件", "平板配件")
        if re.search(r"箱包|背包", text, re.I):
            return build("电脑配件", "电脑包")
        return build("电脑配件", "其他配件")
    if re.search(r"天逸|510S|扬天|启天|商务台式|台式", text, re.I):
        return build("商务台式", "天逸台式机")
    if re.search(r"GEEKPRO|刃7000|游戏主机|主机", text, re.I):
        return build("游戏主机", "GeekPro游戏主机")
    if re.search(r"显示器|MONITOR|27Q|L2435", text, re.I):
        if re.search(r"拯救者|LEGION|电竞", text, re.I):
            return build("显示器", "电竞显示器")
        return build("显示器", "办公显示器")
    if re.search(r"来酷LECOO|LECOO|来酷", source_category_text, re.I):
        if re.search(r"战7000", text, re.I):
            return build("游戏笔记本", "来酷战7000", lecoo_catalog_source)
        if re.search(r"斗战者|N176|RTX|5060|5070", text, re.I):
            return build("游戏笔记本", "斗战者游戏本", lecoo_catalog_source)
        if re.search(r"AIR|N175", text, re.I):
            return build("轻薄笔记本", "来酷Air", lecoo_catalog_source)
        if re.search(r"PRO", text, re.I):
            return build("轻薄笔记本", "来酷Pro", lecoo_catalog_source)
        if re.search(r"N155|15", text, re.I):
            return build("轻薄笔记本", "来酷15", lecoo_catalog_source)
        return build("轻薄笔记本", "来酷轻薄本", lecoo_catalog_source)
    if re.search(r"拯救者$", source_category_text, re.I) or re.search(r"拯救者|LEGION|Y7000|Y9000|R7000|R9000|RTX|5060|5070|斗战者|战7000", text, re.I):
        if re.search(r"战7000", text, re.I):
            return build("游戏笔记本", "来酷战7000", lecoo_catalog_source)
        if re.search(r"来酷|LECOO|斗战者", text, re.I):
            return build("游戏笔记本", "斗战者游戏本", lecoo_catalog_source)
        return build("游戏笔记本", "拯救者游戏本")
    if re.search(r"YOGA", text, re.I) and re.search(r"AIR\s*14|IPH\d*|ILL\d*|ULTRA|U[3579]\d{0,3}G|UX\d{0,4}G", product_name_text, re.I):
        return build("轻薄笔记本", "YOGA笔记本")
    if re.search(r"小新$", source_category_text, re.I) or re.search(r"小新|YOGA|AIR|PRO|笔记本|电脑", text, re.I):
        if re.search(r"PRO\s*16|PRO16|16C|16\s*IAH|16\s*AHP", text, re.I):
            return build("轻薄笔记本", "小新Pro16")
        if re.search(r"PRO\s*14|PRO14|14C|14\s*IAH|14\s*IRH", text, re.I):
            return build("轻薄笔记本", "小新Pro14")
        if re.search(r"PRO", text, re.I):
            return build("轻薄笔记本", "小新Pro")
        if re.search(r"AIR", text, re.I):
            return build("轻薄笔记本", "小新Air")
        if re.search(r"YOGA", text, re.I):
            return build("轻薄笔记本", "YOGA笔记本")
        return build("轻薄笔记本", "小新数字系列")
    if re.search(r"智能|摄像头|路由|音箱|智控", text, re.I) and not re.search(r"耳机", text, re.I):
        return build("智能生活", jd_subcategory_text or source_category_text or "智能生活")
    return build(raw_category_text or source_category_text or "未分类", jd_subcategory_text or source_category_text or "未细分")


def extract_canonical_sales_order_no(*values: Any) -> str:
    for value in values:
        text = strip_zdt_prefix(value)
        if not text:
            continue
        matched = re.search(r"(XS\d{14,})", text)
        if matched:
            return matched.group(1)
    return strip_zdt_prefix(values[0]) if values else ""


def extract_canonical_purchase_order_no(*values: Any) -> str:
    for value in values:
        text = strip_zdt_prefix(value)
        if not text:
            continue
        matched = re.search(r"(CGR\d{8,})", text)
        if matched:
            return matched.group(1)
    return strip_zdt_prefix(values[0]) if values else ""


def normalize_serial_display_text(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parts = [segment.strip() for segment in re.split(r"[,，、\n\r\t]+", raw)]
    cleaned: list[str] = []
    seen: set[str] = set()
    for segment in parts:
        normalized = str(segment or "").strip()
        upper = normalized.upper()
        if not normalized or upper in {"-1", "NULL", "NONE", "N/A"}:
            continue
        if upper in seen:
            continue
        seen.add(upper)
        cleaned.append(normalized)
    return ", ".join(cleaned)


def normalize_movement_document_number(
    movement_type: Any,
    document_number: Any,
    source_ref: Any,
    inbound_document_no: Any,
) -> str:
    normalized_type = str(movement_type or "").strip()
    values = [document_number, source_ref, inbound_document_no]
    if normalized_type in {"purchase_inbound", "采购入库"}:
        return extract_canonical_purchase_order_no(*values)
    if normalized_type in {"sales_outbound", "销售出库", "业务订单"}:
        return extract_canonical_sales_order_no(*values)
    for value in values:
        text = strip_zdt_prefix(value)
        if text:
            return text
    return ""


def default_source_document_type_for_movement(movement_type: str) -> str:
    normalized = str(movement_type or "").strip()
    if normalized == "sales_outbound":
        return "业务订单"
    if normalized == "purchase_inbound":
        return "采购入库"
    if normalized == "transfer_outbound":
        return "调拨出库"
    if normalized == "transfer_inbound":
        return "调拨入库"
    if normalized == "po_hold_inbound":
        return "PO实物仓转入"
    if normalized == "po_hold_release":
        return "PO实物仓转回门店"
    if normalized == "po_hold_outbound":
        return "智惠服务二次出库"
    if normalized == "po_hold_revoke_outbound":
        return "实物仓撤销转入"
    if normalized == "po_hold_reopen_inbound":
        return "撤销误核销恢复实物仓"
    return "库存调整"


def score_openclaw_order_row(row: tuple[Any, ...]) -> tuple[int, int, int, int, int]:
    total_amount = normalize_openclaw_currency_amount(row[4] or 0)
    pay_amount = normalize_openclaw_currency_amount(row[5] or row[4] or 0)
    total_quantity = int(row[10] or 0) if str(row[10] or "").strip() else 0
    pay_time = 1 if normalize_business_datetime_text(row[11] or "") else 0
    created_time = 1 if normalize_business_datetime_text(row[12] or "") else 0
    score = 0
    if total_amount > 0:
        score += 8
    if pay_amount > 0:
        score += 8
    if total_quantity > 0:
        score += 4
    if pay_time:
        score += 2
    if created_time:
        score += 1
    return (
        score,
        int(round(pay_amount * 100)),
        int(round(total_amount * 100)),
        total_quantity,
        pay_time + created_time,
    )


def is_placeholder_openclaw_order_line(row: tuple[Any, ...]) -> bool:
    quantity = int(row[7] or 0) if str(row[7] or "").strip() else 0
    unit_price = normalize_openclaw_currency_amount(row[8] or 0)
    total_amount = normalize_openclaw_currency_amount(row[9] or 0)
    pay_amount = normalize_openclaw_currency_amount(row[10] or 0)
    product_no = str(row[3] or "").strip()
    product_name = str(row[4] or "").strip()
    mtm_code = str(row[5] or "").strip()
    spec = str(row[6] or "").strip()
    serial_number = str(row[11] or "").strip()
    return (
        quantity <= 1
        and unit_price <= 0
        and total_amount <= 0
        and pay_amount <= 0
        and not product_no
        and not product_name
        and not mtm_code
        and not spec
        and not serial_number
    )


def normalize_openclaw_line_pay_amount(pay_amount: Any, total_amount: Any) -> float:
    total_yuan = normalize_openclaw_currency_amount(total_amount or 0)
    try:
        pay_value = float(pay_amount or 0)
    except (TypeError, ValueError):
        pay_value = 0.0
    if pay_value <= 0:
        return total_yuan
    if total_yuan > 0 and pay_value <= total_yuan * 1.5:
        return round(pay_value, 2)
    return normalize_openclaw_currency_amount(pay_value)


def parse_mixed_serial_numbers(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        candidates = value
    else:
        text = str(value or "").strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                candidates = parsed
            elif isinstance(parsed, str):
                candidates = re.split(r"[,，、\s]+", parsed)
            else:
                candidates = re.split(r"[,，、\s]+", text)
        except json.JSONDecodeError:
            candidates = re.split(r"[,，、\s]+", text)
    normalized: list[str] = []
    for item in candidates:
        serial = str(item or "").strip()
        if not serial or serial in {"-1", "[]", "NONE", "NULL"}:
            continue
        normalized.append(serial)
    return list(dict.fromkeys(normalized))


def _target_serial_status_from_movement_type(movement_type: str) -> str:
    normalized = str(movement_type or "").strip()
    if normalized in {"purchase_inbound", "transfer_inbound", "po_hold_inbound", "po_hold_release", "po_hold_reopen_inbound"}:
        return "in_stock"
    if normalized in {"sales_outbound", "po_hold_outbound", "po_hold_revoke_outbound"}:
        return "sold"
    return "out_of_stock"


def is_physical_hold_movement_type(movement_type: str) -> bool:
    return str(movement_type or "").strip() in {
        "po_hold_inbound",
        "po_hold_release",
        "po_hold_outbound",
        "po_hold_revoke_outbound",
        "po_hold_reopen_inbound",
    }


def is_physical_hold_location(warehouse_code: str = "", location_code: str = "") -> bool:
    return (
        str(warehouse_code or "").strip() == PHYSICAL_HOLD_WAREHOUSE_CODE
        or str(location_code or "").strip() == PHYSICAL_HOLD_LOCATION_CODE
    )


def is_service_fulfillment_text(*parts: Any) -> bool:
    text = " ".join(str(part or "").strip() for part in parts if str(part or "").strip())
    return bool(re.search(r"智惠服务|LENOVO\s*CARE|CARE服务|无忧服务|延保服务", text, re.IGNORECASE))


def is_non_inventory_service_item(sku_key: str, product_name: str = "", pn_mtm: str = "") -> bool:
    normalized_name = normalize_lookup_key(product_name)
    normalized_pn = normalize_lookup_key(pn_mtm)
    return (
        "LENOVOCARE" in normalized_name
        or "智惠" in str(product_name or "")
        or normalized_pn.startswith("LENOVOCARE")
        or sku_key in {"10002930", "10002932"}
    )


def extract_sales_order_payload_sku_key(item: dict[str, Any]) -> str:
    product_item_no = str(item.get("productItemNo") or "").strip()
    if product_item_no:
        matched = re.search(r"_(\d{5,})$", product_item_no)
        if matched:
            return matched.group(1)
    for key in ("skuKey", "skuNo", "sku", "itemNo"):
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return ""


def build_sales_order_lines_from_raw_payload(raw_payload: Any) -> list[dict[str, Any]]:
    if not raw_payload:
        return []
    if isinstance(raw_payload, str):
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            return []
    elif isinstance(raw_payload, dict):
        payload = raw_payload
    else:
        return []
    item_list = payload.get("orderItemList")
    if not isinstance(item_list, list):
        return []
    grouped_lines: dict[str, dict[str, Any]] = {}
    for item in item_list:
        if not isinstance(item, dict):
            continue
        sku_key = extract_sales_order_payload_sku_key(item)
        product_name = str(item.get("productName") or "").strip()
        product_no = str(item.get("productNo") or item.get("spuNo") or "").strip()
        mtm_code = str(item.get("mtmCode") or "").strip()
        spec = str(item.get("propertiesIndb") or item.get("appendProperty") or "").strip()
        if not sku_key:
            continue
        bucket = grouped_lines.setdefault(
            sku_key,
            {
                "sku_key": sku_key,
                "product_name": product_name,
                "product_no": product_no,
                "mtm_code": mtm_code,
                "spec": spec,
                "quantity": 0,
                "deal_price": 0.0,
                "pay_amount": 0.0,
                "discount_amount": 0.0,
                "serial_numbers": [],
            },
        )
        serial_numbers = parse_mixed_serial_numbers(item.get("serialNumber"))
        quantity = int(item.get("quantity") or 0) if str(item.get("quantity") or "").strip() else 0
        if quantity <= 0:
            quantity = len(serial_numbers) or 1
        bucket["quantity"] += quantity
        deal_price = normalize_openclaw_currency_amount(item.get("unitPrice") or item.get("price") or 0)
        if deal_price > 0:
            bucket["deal_price"] = deal_price
        pay_amount = normalize_openclaw_line_pay_amount(item.get("payAmount"), item.get("totalAmount") or item.get("paidAmount"))
        if pay_amount > 0:
            bucket["pay_amount"] += pay_amount
        discount_amount = normalize_openclaw_currency_amount(item.get("discountAmount") or 0)
        if discount_amount > 0:
            bucket["discount_amount"] += discount_amount
        for serial_number in serial_numbers:
            if serial_number not in bucket["serial_numbers"]:
                bucket["serial_numbers"].append(serial_number)
        if not bucket["product_name"] and product_name:
            bucket["product_name"] = product_name
        if not bucket["product_no"] and product_no:
            bucket["product_no"] = product_no
        if not bucket["mtm_code"] and mtm_code:
            bucket["mtm_code"] = mtm_code
        if not bucket["spec"] and spec:
            bucket["spec"] = spec
    return list(grouped_lines.values())


def backfill_sales_order_lines_from_raw_payload(conn: sqlite3.Connection, timestamp: str) -> int:
    rows = conn.execute(
        """
        SELECT id, raw_payload_json
        FROM sales_order
        WHERE id LIKE 'XS%'
          AND TRIM(COALESCE(raw_payload_json, '')) NOT IN ('', '{}')
        """
    ).fetchall()
    updated_orders = 0
    for row in rows:
        order_id = str(row["id"] or "").strip()
        existing_lines = conn.execute(
            """
            SELECT id, deal_price, pay_amount, serial_number, serial_numbers_json
            FROM sales_order_line
            WHERE order_id = ?
            ORDER BY id
            """,
            (order_id,),
        ).fetchall()
        payload_lines = build_sales_order_lines_from_raw_payload(row["raw_payload_json"])
        if not payload_lines:
            continue
        missing_line_rows = not existing_lines
        missing_price = any(float(line["deal_price"] or 0) <= 0 and float(line["pay_amount"] or 0) <= 0 for line in existing_lines)
        missing_serial = any(
            not str(line["serial_number"] or "").strip()
            and not parse_mixed_serial_numbers(line["serial_numbers_json"])
            for line in existing_lines
        )
        if not (missing_line_rows or missing_price or missing_serial):
            continue
        conn.execute("DELETE FROM sales_order_line WHERE order_id = ?", (order_id,))
        for index, line in enumerate(payload_lines, start=1):
            serial_numbers = list(line["serial_numbers"])
            serial_number = serial_numbers[0] if serial_numbers else ""
            conn.execute(
                """
                INSERT OR REPLACE INTO sales_order_line
                (id, order_id, sku_key, product_name, product_no, mtm_code, spec, supplier_name,
                 quantity, deal_price, pay_amount, discount_amount, serial_number, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{order_id}-{index:03d}",
                    order_id,
                    line["sku_key"],
                    line["product_name"],
                    line["product_no"],
                    line["mtm_code"],
                    line["spec"],
                    "",
                    int(line["quantity"] or 0),
                    float(line["deal_price"] or 0),
                    float(line["pay_amount"] or 0),
                    float(line["discount_amount"] or 0) if float(line["discount_amount"] or 0) > 0 else None,
                    serial_number,
                    json.dumps(serial_numbers, ensure_ascii=False),
                    timestamp,
                ),
            )
        updated_orders += 1
    return updated_orders


def connect() -> sqlite3.Connection:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    last_error: sqlite3.OperationalError | None = None
    for attempt in range(5):
        try:
            conn = sqlite3.connect(DB_FILE, timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 30000")
            conn.execute("PRAGMA journal_mode = WAL")
            return conn
        except sqlite3.OperationalError as error:
            last_error = error
            if "unable to open database file" not in str(error).lower():
                raise
            time.sleep(0.05 * (attempt + 1))
    assert last_error is not None
    raise last_error


def _is_sqlite_locked_error(error: BaseException) -> bool:
    return "database is locked" in str(error).lower()


def _has_core_tables(conn: sqlite3.Connection) -> bool:
    required = ("product", "sku", "serial_item", "inventory_movement", "sales_order")
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?, ?)",
        required,
    ).fetchall()
    existing = {str(row["name"] or "") for row in rows}
    return all(table in existing for table in required)


def init_db() -> None:
    global INIT_DB_DONE
    if INIT_DB_DONE:
        return
    with INIT_DB_LOCK:
        if INIT_DB_DONE:
            return
        last_error: sqlite3.OperationalError | None = None
        for attempt in range(1, 6):
            try:
                with connect() as conn:
                    conn.executescript(
                        """
            CREATE TABLE IF NOT EXISTS product (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              brand TEXT NOT NULL DEFAULT 'Lenovo',
              category TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sku (
              id TEXT PRIMARY KEY,
              product_id TEXT NOT NULL,
              sku_key TEXT NOT NULL UNIQUE,
              pn_mtm TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT '',
              source_category TEXT NOT NULL DEFAULT '',
              jd_subcategory TEXT NOT NULL DEFAULT '',
              catalog_source TEXT NOT NULL DEFAULT '',
              sellable_stock INTEGER NOT NULL DEFAULT 0,
              current_stock INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(product_id) REFERENCES product(id)
            );

            CREATE TABLE IF NOT EXISTS serial_item (
              serial_number TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              warehouse_code TEXT NOT NULL DEFAULT 'STORE',
              location_code TEXT NOT NULL DEFAULT 'SALES_FLOOR',
              cost_amount REAL,
              inbound_date TEXT,
              inbound_document_no TEXT NOT NULL DEFAULT '',
              operator_name TEXT NOT NULL DEFAULT '',
              supplier_name TEXT NOT NULL DEFAULT '',
              warranty_status TEXT NOT NULL DEFAULT 'unknown',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory_movement (
              id TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              serial_number TEXT,
              movement_type TEXT NOT NULL,
              quantity INTEGER NOT NULL,
              business_date TEXT NOT NULL,
              source_system TEXT NOT NULL,
              source_ref TEXT NOT NULL DEFAULT '',
              source_document_type TEXT NOT NULL DEFAULT '',
              inbound_document_no TEXT NOT NULL DEFAULT '',
              store_name TEXT NOT NULL DEFAULT '',
              location_name TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              unit_name TEXT NOT NULL DEFAULT '',
              unit_cost REAL,
              amount REAL,
              operator_name TEXT NOT NULL DEFAULT '',
              supplier_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              service_type_name TEXT NOT NULL DEFAULT '',
              operate_type_name TEXT NOT NULL DEFAULT '',
              pay_remark TEXT NOT NULL DEFAULT '',
              company_name TEXT NOT NULL DEFAULT '',
              shop_name TEXT NOT NULL DEFAULT '',
              warehouse_location_name TEXT NOT NULL DEFAULT '',
              property_name TEXT NOT NULL DEFAULT '',
              property_value TEXT NOT NULL DEFAULT '',
              spu_no TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS physical_stock_hold (
              serial_number TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              source_order_no TEXT NOT NULL DEFAULT '',
              source_order_line_id TEXT NOT NULL DEFAULT '',
              hold_reason TEXT NOT NULL DEFAULT '',
              warehouse_code TEXT NOT NULL DEFAULT 'PO_HOLD',
              location_code TEXT NOT NULL DEFAULT 'PO_EDU_REAL_STOCK',
              hold_status TEXT NOT NULL DEFAULT 'active',
              matched_service_order_no TEXT NOT NULL DEFAULT '',
              matched_outbound_movement_id TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS staff (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS customer (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              phone TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS supplier (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              source_system TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sales_order (
              id TEXT PRIMARY KEY,
              external_order_no TEXT NOT NULL DEFAULT '',
              store_code TEXT NOT NULL,
              operator_id TEXT NOT NULL,
              customer_name TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              status_name TEXT NOT NULL DEFAULT '',
              total_amount REAL NOT NULL DEFAULT 0,
              pay_amount REAL NOT NULL DEFAULT 0,
              order_type INTEGER,
              order_type_name TEXT NOT NULL DEFAULT '',
              channel_type_name TEXT NOT NULL DEFAULT '',
              cashier_name TEXT NOT NULL DEFAULT '',
              total_quantity INTEGER NOT NULL DEFAULT 0,
              pay_time TEXT NOT NULL DEFAULT '',
              created_time TEXT NOT NULL DEFAULT '',
              shop_id TEXT NOT NULL DEFAULT '',
              shop_name TEXT NOT NULL DEFAULT '',
              company_id TEXT NOT NULL DEFAULT '',
              business_date TEXT NOT NULL,
              raw_payload_json TEXT NOT NULL DEFAULT '{}',
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sales_order_line (
              id TEXT PRIMARY KEY,
              order_id TEXT NOT NULL,
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              product_no TEXT NOT NULL DEFAULT '',
              mtm_code TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              supplier_name TEXT NOT NULL DEFAULT '',
              quantity INTEGER NOT NULL,
              deal_price REAL NOT NULL,
              pay_amount REAL,
              discount_amount REAL,
              serial_number TEXT NOT NULL DEFAULT '',
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              FOREIGN KEY(order_id) REFERENCES sales_order(id)
            );

            CREATE TABLE IF NOT EXISTS purchase_order (
              id TEXT PRIMARY KEY,
              supplier_id TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              total_amount REAL NOT NULL DEFAULT 0,
              business_date TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS purchase_order_line (
              id TEXT PRIMARY KEY,
              order_id TEXT NOT NULL,
              sku_key TEXT NOT NULL,
              quantity INTEGER NOT NULL,
              cost_price REAL,
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              FOREIGN KEY(order_id) REFERENCES purchase_order(id)
            );

            CREATE TABLE IF NOT EXISTS external_system (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              system_type TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_task (
              id TEXT PRIMARY KEY,
              external_system_id TEXT NOT NULL,
              task_type TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              status TEXT NOT NULL,
              retry_count INTEGER NOT NULL DEFAULT 0,
              last_error TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_user (
              username TEXT PRIMARY KEY,
              password_hash TEXT NOT NULL,
              password_salt TEXT NOT NULL,
              display_name TEXT NOT NULL DEFAULT '',
              active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS order_sync_registry (
              order_number TEXT PRIMARY KEY,
              external_order_number TEXT NOT NULL DEFAULT '',
              business_date TEXT NOT NULL DEFAULT '',
              order_type TEXT NOT NULL DEFAULT 'sales_outbound',
              sku_keys_json TEXT NOT NULL DEFAULT '[]',
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              seen_in_stock_stream INTEGER NOT NULL DEFAULT 0,
              seen_in_sn_stock_order INTEGER NOT NULL DEFAULT 0,
              seen_in_sales_export INTEGER NOT NULL DEFAULT 0,
              seen_in_frontend_sales_orders INTEGER NOT NULL DEFAULT 0,
              seen_in_frontend_movements INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'pending_reconcile',
              missing_fields_json TEXT NOT NULL DEFAULT '[]',
              source_files_json TEXT NOT NULL DEFAULT '[]',
              message TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_gap_queue (
              id TEXT PRIMARY KEY,
              order_number TEXT NOT NULL,
              external_order_number TEXT NOT NULL DEFAULT '',
              gap_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'open',
              severity TEXT NOT NULL DEFAULT 'warning',
              business_date TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              serial_number TEXT NOT NULL DEFAULT '',
              missing_fields_json TEXT NOT NULL DEFAULT '[]',
              source_flags_json TEXT NOT NULL DEFAULT '{}',
              message TEXT NOT NULL DEFAULT '',
              source_files_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS education_agent_scan_raw (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              record_id TEXT NOT NULL,
              source_group_name TEXT NOT NULL DEFAULT '',
              collection_source TEXT NOT NULL DEFAULT '',
              scan_date TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              quantity INTEGER NOT NULL DEFAULT 1,
              education_discount_amount REAL NOT NULL DEFAULT 0,
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              order_number TEXT NOT NULL DEFAULT '',
              outbound_date TEXT NOT NULL DEFAULT '',
              outbound_store_name TEXT NOT NULL DEFAULT '',
              outbound_operator_name TEXT NOT NULL DEFAULT '',
              payment_received INTEGER NOT NULL DEFAULT 0,
              activity_label TEXT NOT NULL DEFAULT '',
              rule_text TEXT NOT NULL DEFAULT '',
              customer_name TEXT NOT NULL DEFAULT '',
              customer_phone TEXT NOT NULL DEFAULT '',
              agent_phone TEXT NOT NULL DEFAULT '',
              model_text TEXT NOT NULL DEFAULT '',
              voucher_code TEXT NOT NULL DEFAULT '',
              voucher_verified_at TEXT NOT NULL DEFAULT '',
              report_status TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              raw_payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(record_id, scan_date, serial_numbers_json)
            );

            CREATE INDEX IF NOT EXISTS idx_education_agent_scan_raw_scan_date
              ON education_agent_scan_raw(scan_date);
            CREATE INDEX IF NOT EXISTS idx_education_agent_scan_raw_order_number
              ON education_agent_scan_raw(order_number);
            CREATE INDEX IF NOT EXISTS idx_education_agent_scan_raw_record_id
              ON education_agent_scan_raw(record_id);

            CREATE INDEX IF NOT EXISTS idx_sync_gap_queue_status
              ON sync_gap_queue(status, business_date, order_number);

            CREATE TABLE IF NOT EXISTS price_tag_device (
              id TEXT PRIMARY KEY,
              vendor TEXT NOT NULL,
              model TEXT NOT NULL DEFAULT '',
              store_code TEXT NOT NULL,
              status TEXT NOT NULL,
              battery_level INTEGER,
              signal_level INTEGER,
              last_seen_at TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS price_tag_template (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              template_type TEXT NOT NULL,
              payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS price_tag_binding (
              id TEXT PRIMARY KEY,
              device_id TEXT NOT NULL,
              sku_key TEXT NOT NULL,
              store_code TEXT NOT NULL,
              status TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS price_tag_update_task (
              id TEXT PRIMARY KEY,
              device_id TEXT,
              sku_key TEXT NOT NULL,
              template_id TEXT NOT NULL,
              price_payload_json TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL,
              retry_count INTEGER NOT NULL DEFAULT 0,
              last_error TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_category_node (
              id TEXT PRIMARY KEY,
              source_system TEXT NOT NULL,
              name TEXT NOT NULL,
              level INTEGER NOT NULL,
              parent_id TEXT,
              display_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sku_category_mapping (
              sku_key TEXT PRIMARY KEY,
              smart_retail_category TEXT NOT NULL,
              zhidiantong_category TEXT NOT NULL,
              jd_subcategory TEXT NOT NULL,
              catalog_source TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sales_price_protection_history (
              id TEXT PRIMARY KEY,
              order_number TEXT NOT NULL,
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              quantity INTEGER NOT NULL DEFAULT 1,
              outbound_date TEXT NOT NULL DEFAULT '',
              outbound_movement_ids_json TEXT NOT NULL DEFAULT '[]',
              protection_quote_date TEXT NOT NULL DEFAULT '',
              realtime_purchase_price REAL,
              inventory_average_cost REAL,
              unit_diff REAL,
              estimated_protection_amount REAL,
              inbound_date TEXT NOT NULL DEFAULT '',
              inbound_cost_amount REAL,
              inbound_document_no TEXT NOT NULL DEFAULT '',
              source_note TEXT NOT NULL DEFAULT '',
              source_quote_file TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reimbursement_voucher_ledger (
              id TEXT PRIMARY KEY,
              history_id TEXT NOT NULL,
              order_number TEXT NOT NULL,
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              quantity INTEGER NOT NULL DEFAULT 1,
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              outbound_date TEXT NOT NULL DEFAULT '',
              inbound_document_no TEXT NOT NULL DEFAULT '',
              inbound_cost_amount REAL,
              realtime_purchase_price REAL,
              unit_diff REAL,
              estimated_protection_amount REAL,
              status TEXT NOT NULL DEFAULT 'pending',
              voucher_code TEXT NOT NULL,
              voucher_template_version TEXT NOT NULL DEFAULT 'v1',
              voucher_payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS distributor_quote_current (
              id TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              pickup_price REAL,
              subsidy_price REAL,
              education_subsidy REAL,
              quote_date TEXT NOT NULL DEFAULT '',
              quote_file TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              match_fingerprint TEXT NOT NULL DEFAULT '',
              match_method TEXT NOT NULL DEFAULT '',
              match_confidence REAL,
              match_evidence TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS gray_wholesale_quote_current (
              id TEXT PRIMARY KEY,
              account_name TEXT NOT NULL DEFAULT '',
              entry_point TEXT NOT NULL DEFAULT '',
              quote_date TEXT NOT NULL DEFAULT '',
              captured_at TEXT NOT NULL DEFAULT '',
              product_text TEXT NOT NULL DEFAULT '',
              market_wholesale_price REAL,
              masked_price_text TEXT NOT NULL DEFAULT '',
              tax_included INTEGER NOT NULL DEFAULT 0,
              service_included INTEGER NOT NULL DEFAULT 0,
              match_fingerprint TEXT NOT NULL DEFAULT '',
              evidence_text TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory_price_signal_current (
              sku_key TEXT PRIMARY KEY,
              pn_mtm TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              inventory_average_cost REAL,
              realtime_purchase_price REAL,
              gray_wholesale_price REAL,
              distributor_quote_date TEXT NOT NULL DEFAULT '',
              gray_quote_date TEXT NOT NULL DEFAULT '',
              realtime_match_method TEXT NOT NULL DEFAULT '',
              realtime_match_confidence REAL,
              realtime_match_evidence TEXT NOT NULL DEFAULT '',
              gray_match_method TEXT NOT NULL DEFAULT '',
              gray_match_confidence REAL,
              gray_match_evidence TEXT NOT NULL DEFAULT '',
              source_generated_at TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS store_manual_promotion (
              id TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              mode TEXT NOT NULL,
              value REAL NOT NULL,
              valid_from TEXT NOT NULL,
              valid_to TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS manufacturer_manual_promotion (
              id TEXT PRIMARY KEY,
              source_key TEXT NOT NULL,
              outbound_date TEXT NOT NULL,
              order_number TEXT NOT NULL DEFAULT '',
              outbound_document_number TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL,
              product_name TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              boost_amount REAL NOT NULL DEFAULT 0,
              education_amount REAL NOT NULL DEFAULT 0,
              valid_from TEXT NOT NULL DEFAULT '',
              valid_to TEXT NOT NULL DEFAULT '',
              marketing_po_enabled INTEGER NOT NULL DEFAULT 0,
              education_enabled INTEGER NOT NULL DEFAULT 0,
              source_activity_ids TEXT NOT NULL DEFAULT '',
              source_labels TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cross_outbound_check_rule (
              id TEXT PRIMARY KEY,
              match_mode TEXT NOT NULL DEFAULT 'sku',
              source_key TEXT NOT NULL,
              source_label TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              counterparty TEXT NOT NULL DEFAULT '联想',
              settlement_mode TEXT NOT NULL DEFAULT 'priceDiff',
              calculation_basis TEXT NOT NULL DEFAULT 'purchaseCost',
              settlement_price REAL,
              per_unit_amount REAL,
              valid_from TEXT NOT NULL DEFAULT '',
              valid_to TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cross_outbound_check_history (
              id TEXT PRIMARY KEY,
              rule_id TEXT NOT NULL DEFAULT '',
              source_key TEXT NOT NULL DEFAULT '',
              order_number TEXT NOT NULL DEFAULT '',
              outbound_date TEXT NOT NULL DEFAULT '',
              business_date TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL DEFAULT '',
              pn_mtm TEXT NOT NULL DEFAULT '',
              product_name TEXT NOT NULL DEFAULT '',
              spec TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              product_line TEXT NOT NULL DEFAULT 'computer',
              quantity INTEGER NOT NULL DEFAULT 1,
              cost_unit_price REAL,
              cost_total_amount REAL,
              cost_source TEXT NOT NULL DEFAULT 'unknown',
              serial_costs_json TEXT NOT NULL DEFAULT '[]',
              sales_unit_price REAL,
              sales_total_amount REAL,
              settlement_mode TEXT NOT NULL DEFAULT 'priceDiff',
              calculation_basis TEXT NOT NULL DEFAULT 'purchaseCost',
              settlement_price REAL,
              per_unit_amount REAL,
              cross_check_amount REAL NOT NULL DEFAULT 0,
              counterparty TEXT NOT NULL DEFAULT '联想',
              serial_numbers_json TEXT NOT NULL DEFAULT '[]',
              store_name TEXT NOT NULL DEFAULT '',
              operator_name TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              rule_valid_from TEXT NOT NULL DEFAULT '',
              rule_valid_to TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_activity_current (
              id TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              activity_kind TEXT NOT NULL,
              activity_label TEXT NOT NULL DEFAULT '',
              amount REAL NOT NULL DEFAULT 0,
              valid_from TEXT NOT NULL DEFAULT '',
              valid_to TEXT NOT NULL DEFAULT '',
              countdown_days INTEGER,
              rule_text TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              source_type TEXT NOT NULL DEFAULT '',
              source_activity_id TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL DEFAULT '{}',
              updated_at TEXT NOT NULL,
              UNIQUE (sku_key, activity_kind)
            );

            CREATE TABLE IF NOT EXISTS snapshot_cache (
              snapshot_name TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              source_file TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'snapshot_file',
              generated_at TEXT NOT NULL DEFAULT '',
              file_mtime_ns INTEGER NOT NULL DEFAULT 0,
              synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pricing_policy_rule (
              id TEXT PRIMARY KEY,
              policy_code TEXT NOT NULL UNIQUE,
              policy_name TEXT NOT NULL,
              scope_type TEXT NOT NULL DEFAULT 'category',
              scope_value TEXT NOT NULL DEFAULT '',
              channel TEXT NOT NULL DEFAULT 'store_retail',
              formula_type TEXT NOT NULL DEFAULT 'fixed_markup',
              formula_json TEXT NOT NULL DEFAULT '{}',
              priority INTEGER NOT NULL DEFAULT 100,
              enabled INTEGER NOT NULL DEFAULT 1,
              note TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'system_seed',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS subsidy_policy_rule (
              id TEXT PRIMARY KEY,
              policy_code TEXT NOT NULL UNIQUE,
              policy_name TEXT NOT NULL,
              region TEXT NOT NULL DEFAULT '',
              eligible_categories_json TEXT NOT NULL DEFAULT '[]',
              ratio REAL NOT NULL DEFAULT 0,
              computer_cap REAL NOT NULL DEFAULT 0,
              tablet_cap REAL NOT NULL DEFAULT 0,
              phone_cap REAL NOT NULL DEFAULT 0,
              eligibility_note TEXT NOT NULL DEFAULT '',
              rule_json TEXT NOT NULL DEFAULT '{}',
              enabled INTEGER NOT NULL DEFAULT 1,
              source_system TEXT NOT NULL DEFAULT 'system_seed',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS frontend_sync_target (
              target_key TEXT PRIMARY KEY,
              target_name TEXT NOT NULL,
              route_pattern TEXT NOT NULL DEFAULT '',
              sync_ready INTEGER NOT NULL DEFAULT 0,
              sync_mode TEXT NOT NULL DEFAULT 'rebuild_snapshot',
              dependency_json TEXT NOT NULL DEFAULT '[]',
              note TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'system_seed',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS frontend_display_control (
              control_key TEXT PRIMARY KEY,
              control_name TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              note TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'system_seed',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS frontend_activity_display_override (
              activity_id TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL,
              marketing_po_enabled INTEGER NOT NULL DEFAULT 1,
              marketing_po_amount REAL,
              education_subsidy_enabled INTEGER NOT NULL DEFAULT 1,
              education_subsidy_amount REAL,
              note TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'api.frontend_activity_display_override',
              updated_at TEXT NOT NULL,
              PRIMARY KEY (activity_id, sku_key)
            );
            """
                    )
                    seed_default_admin_user(conn)
                    ensure_serial_item_columns(conn)
                    ensure_sku_columns(conn)
                    ensure_inventory_movement_columns(conn)
                    ensure_physical_stock_hold_schema(conn)
                    ensure_sales_order_columns(conn)
                    ensure_sales_order_line_columns(conn)
                    ensure_education_agent_scan_columns(conn)
                    ensure_manufacturer_manual_promotion_columns(conn)
                    ensure_frontend_activity_display_override_schema(conn)
                    ensure_cross_outbound_check_rule_columns(conn)
                    ensure_cross_outbound_check_history_columns(conn)
                    seed_default_pricing_governance(conn)
                    seed_default_frontend_sync_targets(conn)
                    seed_default_frontend_display_controls(conn)
                INIT_DB_DONE = True
                return
            except sqlite3.OperationalError as error:
                if not _is_sqlite_locked_error(error):
                    raise
                last_error = error
                # Retry transient SQLite lock contention caused by concurrent startup requests.
                time.sleep(min(0.25 * attempt, 1.5))
        if last_error:
            try:
                with connect() as conn:
                    if _has_core_tables(conn):
                        INIT_DB_DONE = True
                        return
            except sqlite3.OperationalError:
                pass
            raise last_error


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def seed_default_admin_user(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT username FROM admin_user WHERE username = 'admin'"
    ).fetchone()
    if row:
        return
    created_at = now_iso()
    salt = hashlib.sha256(os.urandom(32)).hexdigest()
    password_hash = _hash_password("admin", salt)
    conn.execute(
        """
        INSERT INTO admin_user
          (username, password_hash, password_salt, display_name, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        """,
        ("admin", password_hash, salt, "系统管理员", created_at, created_at),
    )


def seed_default_pricing_governance(conn: sqlite3.Connection) -> None:
    timestamp = now_iso()
    pricing_rules = [
        {
            "id": "pricing-accessory-platform",
            "policy_code": "accessory-platform-1p1-tail9",
            "policy_name": "配件平台价乘1.1取9尾",
            "scope_type": "category_rule",
            "scope_value": "accessory",
            "channel": "store_retail",
            "formula_type": "multiplier_tail9",
            "formula_json": json.dumps({"multiplier": 1.1, "tail": 9}),
            "priority": 10,
            "note": "对应 priceEngine: getAccessoryRetailPrice / 配件按采集价 ×1.1 后取9尾",
        },
        {
            "id": "pricing-gaming-plus400or300",
            "policy_code": "gaming-platform-plus-400-300",
            "policy_name": "游戏本平台最低价加价规则",
            "scope_type": "category_rule",
            "scope_value": "gaming_notebook",
            "channel": "store_retail",
            "formula_type": "tiered_fixed_markup_tail99",
            "formula_json": json.dumps({"base_source": "min(jd_self,lenovo_official)", "calculation": "base_price + category_markup + white_gaming_extra_markup + min(education_subsidy,500)", "threshold": 10000, "high_markup": 400, "low_markup": 300, "white_gaming_extra_markup": 500, "notebook_education_add_back_cap": 500, "tail": 99}),
            "priority": 20,
            "note": "对应 priceEngine: 京东/官旗最低有效价优先；游戏本 >=10000 加400, 否则加300；白色游戏笔记本在此基础上额外加500；有教育补的笔记本按补贴金额封顶500加回。以上加价为叠加关系，不是二选一。",
        },
        {
            "id": "pricing-thin-plus300or200",
            "policy_code": "thin-platform-plus-300-200",
            "policy_name": "轻薄本平台最低价加价规则",
            "scope_type": "category_rule",
            "scope_value": "thin_notebook",
            "channel": "store_retail",
            "formula_type": "tiered_fixed_markup_tail99",
            "formula_json": json.dumps({"base_source": "min(jd_self,lenovo_official)", "calculation": "base_price + category_markup + min(education_subsidy,500)", "threshold": 5000, "high_markup": 300, "low_markup": 200, "notebook_education_add_back_cap": 500, "tail": 99}),
            "priority": 30,
            "note": "对应 priceEngine: 京东/官旗最低有效价优先；轻薄本 >=5000 加300, 否则加200；有教育补的笔记本按补贴金额封顶500加回。品类加价和教育补加回为叠加关系，不是二选一。",
        },
        {
            "id": "pricing-phone-tablet-platform",
            "policy_code": "phone-tablet-lowest-valid-tail99",
            "policy_name": "手机平板平台最低价99尾",
            "scope_type": "category_rule",
            "scope_value": "phone_tablet",
            "channel": "store_retail",
            "formula_type": "same_price_tail99",
            "formula_json": json.dumps({"base_source": "min(jd_self,lenovo_official)", "tail": 99}),
            "priority": 40,
            "note": "对应 priceEngine: 京东/官旗最低有效价优先；手机/平板平台最低价99尾，不叠加电脑加价，不加回教育补",
        },
        {
            "id": "fallback-accessory-safety-margin",
            "policy_code": "fallback-accessory-safety-margin",
            "policy_name": "配件门店锁定待复核价",
            "scope_type": "fallback_rule",
            "scope_value": "accessory",
            "channel": "store_retail",
            "formula_type": "percent_with_floor_tail9",
            "formula_json": json.dumps({"ratio": 0.2, "min_markup": 20, "tail": 9}),
            "priority": 110,
            "note": "对应 priceEngine: 配件 fallback 20% 且最少加20",
        },
        {
            "id": "fallback-smart-device-safety-margin",
            "policy_code": "fallback-smart-device-safety-margin",
            "policy_name": "手机平板门店锁定待复核价",
            "scope_type": "fallback_rule",
            "scope_value": "phone_tablet",
            "channel": "store_retail",
            "formula_type": "percent_with_floor_tail99",
            "formula_json": json.dumps({"ratio": 0.08, "min_markup": 100, "tail": 99}),
            "priority": 120,
            "note": "对应 priceEngine: 手机/平板 fallback 8% 且最少加100",
        },
        {
            "id": "fallback-computer-safety-margin",
            "policy_code": "fallback-computer-safety-margin",
            "policy_name": "电脑门店锁定待复核价",
            "scope_type": "fallback_rule",
            "scope_value": "computer",
            "channel": "store_retail",
            "formula_type": "percent_with_floor_tail99",
            "formula_json": json.dumps({"ratio": 0.08, "min_markup": 300, "tail": 99}),
            "priority": 130,
            "note": "对应 priceEngine: 电脑 fallback 8% 且最少加300",
        },
    ]
    for item in pricing_rules:
        conn.execute(
            """
            INSERT INTO pricing_policy_rule
            (id, policy_code, policy_name, scope_type, scope_value, channel, formula_type,
             formula_json, priority, enabled, note, source_system, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'system_seed', ?, ?)
            ON CONFLICT(policy_code) DO UPDATE SET
              policy_name = excluded.policy_name,
              scope_type = excluded.scope_type,
              scope_value = excluded.scope_value,
              channel = excluded.channel,
              formula_type = excluded.formula_type,
              formula_json = excluded.formula_json,
              priority = excluded.priority,
              note = excluded.note,
              updated_at = excluded.updated_at
            WHERE
              pricing_policy_rule.policy_name != excluded.policy_name OR
              pricing_policy_rule.scope_type != excluded.scope_type OR
              pricing_policy_rule.scope_value != excluded.scope_value OR
              pricing_policy_rule.channel != excluded.channel OR
              pricing_policy_rule.formula_type != excluded.formula_type OR
              pricing_policy_rule.formula_json != excluded.formula_json OR
              pricing_policy_rule.priority != excluded.priority OR
              pricing_policy_rule.note != excluded.note
            """,
            (
                item["id"], item["policy_code"], item["policy_name"], item["scope_type"], item["scope_value"],
                item["channel"], item["formula_type"], item["formula_json"], item["priority"], item["note"], timestamp, timestamp,
            ),
        )
    conn.execute(
        """
        INSERT INTO subsidy_policy_rule
        (id, policy_code, policy_name, region, eligible_categories_json, ratio, computer_cap, tablet_cap,
         phone_cap, eligibility_note, rule_json, enabled, source_system, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'system_seed', ?, ?)
        ON CONFLICT(policy_code) DO UPDATE SET
          policy_name = excluded.policy_name,
          region = excluded.region,
          eligible_categories_json = excluded.eligible_categories_json,
          ratio = excluded.ratio,
          computer_cap = excluded.computer_cap,
          tablet_cap = excluded.tablet_cap,
          phone_cap = excluded.phone_cap,
          eligibility_note = excluded.eligibility_note,
          rule_json = excluded.rule_json,
          updated_at = excluded.updated_at
        WHERE
          subsidy_policy_rule.policy_name != excluded.policy_name OR
          subsidy_policy_rule.region != excluded.region OR
          subsidy_policy_rule.eligible_categories_json != excluded.eligible_categories_json OR
          subsidy_policy_rule.ratio != excluded.ratio OR
          subsidy_policy_rule.computer_cap != excluded.computer_cap OR
          subsidy_policy_rule.tablet_cap != excluded.tablet_cap OR
          subsidy_policy_rule.phone_cap != excluded.phone_cap OR
          subsidy_policy_rule.eligibility_note != excluded.eligibility_note OR
          subsidy_policy_rule.rule_json != excluded.rule_json
        """,
        (
            "subsidy-henan-2026",
            "henan-national-subsidy-2026",
            "河南门店国补规则 2026",
            "河南",
            json.dumps(["游戏笔记本", "轻薄笔记本", "平板电脑", "一体机", "商务台式", "游戏主机", "手机"], ensure_ascii=False),
            0.15,
            1500,
            500,
            500,
            "电脑类最高补15%，单台封顶1500；手机和平板6000元以下补15%，单台封顶500，6000元及以上不参与补贴；仅一级能耗参与。",
            json.dumps({"ratio": 0.15, "computerCap": 1500, "tabletCap": 500, "phoneCap": 500}, ensure_ascii=False),
            timestamp,
            timestamp,
        ),
    )


def seed_default_frontend_sync_targets(conn: sqlite3.Connection) -> None:
    timestamp = now_iso()
    targets = [
        ("retailHome", "零售卡前端", "/", 1, "published_projection_price_overlay", json.dumps(["latest-published-product-projection.json", "latest-retail-zone-snapshot.json"]), "价格、主标题、活动价链统一以发布商品投影为准，零售区快照只做展示承载"),
        ("retailLive", "零售直播页", "/retail-live", 1, "published_projection_price_overlay", json.dumps(["latest-published-product-projection.json", "latest-retail-zone-snapshot.json"]), "与零售卡同源，价格统一以发布商品投影为准"),
        ("adMachine", "彩页广告机前端", "/ad-machine/*.html", 1, "published_projection_plus_flyer_build", json.dumps(["latest-published-product-projection.json", "/flyers/lenovo-618-flyers-data.json"]), "已接入统一商品发布投影与广告机彩页自动重建链"),
        ("retailOps", "进销存销售端", "/retail-ops", 1, "sql_api_plus_published_projection", json.dumps(["latest-retail-core-*.json", "latest-published-product-projection.json", "latest-retail-zone-snapshot.json"]), "进销存业务链走 SQL/API，客户可见价格统一以发布商品投影为准"),
        ("androidPos", "收银台前端", "/android-pos", 1, "published_projection_plus_sql_sn", json.dumps(["latest-published-product-projection.json", "api/retail-core/serial-items"]), "已接入统一商品发布投影与 SQL SN 数据"),
        ("androidPosLite", "收银台兼容页", "/android-pos-lite.html", 1, "published_projection_plus_sql_sn", json.dumps(["latest-published-product-projection.json", "api/retail-core/serial-items"]), "已接入统一商品发布投影与 SQL SN 数据"),
    ]
    for target in targets:
        conn.execute(
            """
            INSERT INTO frontend_sync_target
            (target_key, target_name, route_pattern, sync_ready, sync_mode, dependency_json, note, source_system, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'system_seed', ?)
            ON CONFLICT(target_key) DO UPDATE SET
              target_name = excluded.target_name,
              route_pattern = excluded.route_pattern,
              sync_ready = excluded.sync_ready,
              sync_mode = excluded.sync_mode,
              dependency_json = excluded.dependency_json,
              note = excluded.note,
              updated_at = excluded.updated_at
            WHERE
              frontend_sync_target.target_name != excluded.target_name OR
              frontend_sync_target.route_pattern != excluded.route_pattern OR
              frontend_sync_target.sync_ready != excluded.sync_ready OR
              frontend_sync_target.sync_mode != excluded.sync_mode OR
              frontend_sync_target.dependency_json != excluded.dependency_json OR
              frontend_sync_target.note != excluded.note
            """,
            (*target, timestamp),
        )


def seed_default_frontend_display_controls(conn: sqlite3.Connection) -> None:
    timestamp = now_iso()
    controls = [
        ("marketing_po", "营销PO展示开关", 1, "控制前端营销PO活动与折扣展示，不影响后端奖励计算"),
        ("education_subsidy", "教育补展示开关", 1, "控制前端教育补活动与折扣展示，不影响后端奖励计算"),
    ]
    for control in controls:
        conn.execute(
            """
            INSERT INTO frontend_display_control
            (control_key, control_name, enabled, note, source_system, updated_at)
            VALUES (?, ?, ?, ?, 'system_seed', ?)
            ON CONFLICT(control_key) DO UPDATE SET
              control_name = excluded.control_name,
              enabled = excluded.enabled,
              note = excluded.note,
              updated_at = excluded.updated_at
            WHERE
              frontend_display_control.control_name != excluded.control_name OR
              frontend_display_control.enabled != excluded.enabled OR
              frontend_display_control.note != excluded.note
            """,
            (*control, timestamp),
        )


def list_admin_users() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT username, display_name, active, created_at, updated_at
            FROM admin_user
            ORDER BY username
            """
        ).fetchall()
    return {
        "generatedAt": now_iso(),
        "items": [
            {
                "username": str(row["username"] or ""),
                "displayName": str(row["display_name"] or ""),
                "active": bool(row["active"]),
                "createdAt": str(row["created_at"] or ""),
                "updatedAt": str(row["updated_at"] or ""),
            }
            for row in rows
        ],
    }


def verify_admin_user(username: str, password: str) -> bool:
    init_db()
    normalized_username = str(username or "").strip()
    if not normalized_username or not password:
        return False
    with connect() as conn:
        row = conn.execute(
            """
            SELECT password_hash, password_salt, active
            FROM admin_user
            WHERE username = ?
            """,
            (normalized_username,),
        ).fetchone()
    if not row or not row["active"]:
        return False
    return _hash_password(password, str(row["password_salt"] or "")) == str(row["password_hash"] or "")


def update_admin_password(username: str, current_password: str, new_password: str) -> bool:
    init_db()
    normalized_username = str(username or "").strip()
    next_password = str(new_password or "").strip()
    if not normalized_username or len(next_password) < 4:
        return False
    if not verify_admin_user(normalized_username, current_password):
        return False
    updated_at = now_iso()
    salt = hashlib.sha256(os.urandom(32)).hexdigest()
    password_hash = _hash_password(next_password, salt)
    with connect() as conn:
        conn.execute(
            """
            UPDATE admin_user
            SET password_hash = ?, password_salt = ?, updated_at = ?
            WHERE username = ?
            """,
            (password_hash, salt, updated_at, normalized_username),
        )
    return True


def create_admin_user(username: str, password: str, display_name: str = "") -> bool:
    init_db()
    normalized_username = str(username or "").strip()
    normalized_password = str(password or "").strip()
    normalized_display_name = str(display_name or "").strip() or normalized_username
    if not normalized_username or len(normalized_password) < 4:
        return False
    created_at = now_iso()
    salt = hashlib.sha256(os.urandom(32)).hexdigest()
    password_hash = _hash_password(normalized_password, salt)
    try:
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO admin_user
                  (username, password_hash, password_salt, display_name, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                (normalized_username, password_hash, salt, normalized_display_name, created_at, created_at),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def set_admin_user_active(username: str, active: bool) -> bool:
    init_db()
    normalized_username = str(username or "").strip()
    if not normalized_username or normalized_username == "admin":
        return False
    with connect() as conn:
        result = conn.execute(
            """
            UPDATE admin_user
            SET active = ?, updated_at = ?
            WHERE username = ?
            """,
            (1 if active else 0, now_iso(), normalized_username),
        )
    return result.rowcount > 0


def ensure_sku_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(sku)").fetchall()
    }
    columns = {
        "source_category": "TEXT NOT NULL DEFAULT ''",
        "jd_subcategory": "TEXT NOT NULL DEFAULT ''",
        "catalog_source": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE sku ADD COLUMN {name} {ddl}")


def ensure_serial_item_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(serial_item)").fetchall()
    }
    columns = {
        "product_name": "TEXT NOT NULL DEFAULT ''",
        "pn_mtm": "TEXT NOT NULL DEFAULT ''",
        "spec": "TEXT NOT NULL DEFAULT ''",
        "inbound_date": "TEXT",
        "inbound_document_no": "TEXT NOT NULL DEFAULT ''",
        "operator_name": "TEXT NOT NULL DEFAULT ''",
        "supplier_name": "TEXT NOT NULL DEFAULT ''",
        "warranty_checked_at": "TEXT NOT NULL DEFAULT ''",
        "official_warranty_start": "TEXT NOT NULL DEFAULT ''",
        "official_warranty_end": "TEXT NOT NULL DEFAULT ''",
        "warranty_service_plan": "TEXT NOT NULL DEFAULT ''",
        "warranty_official_product_name": "TEXT NOT NULL DEFAULT ''",
        "warranty_official_lookup_url": "TEXT NOT NULL DEFAULT ''",
        "warranty_evidence_screenshot_path": "TEXT NOT NULL DEFAULT ''",
        "warranty_evidence_text_path": "TEXT NOT NULL DEFAULT ''",
        "warranty_failure_reason": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE serial_item ADD COLUMN {name} {ddl}")


def ensure_inventory_movement_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(inventory_movement)").fetchall()
    }
    columns = {
        "source_document_type": "TEXT NOT NULL DEFAULT ''",
        "inbound_document_no": "TEXT NOT NULL DEFAULT ''",
        "store_name": "TEXT NOT NULL DEFAULT ''",
        "location_name": "TEXT NOT NULL DEFAULT ''",
        "product_name": "TEXT NOT NULL DEFAULT ''",
        "unit_name": "TEXT NOT NULL DEFAULT ''",
        "unit_cost": "REAL",
        "amount": "REAL",
        "operator_name": "TEXT NOT NULL DEFAULT ''",
        "supplier_name": "TEXT NOT NULL DEFAULT ''",
        "pn_mtm": "TEXT NOT NULL DEFAULT ''",
        "spec": "TEXT NOT NULL DEFAULT ''",
        "service_type_name": "TEXT NOT NULL DEFAULT ''",
        "operate_type_name": "TEXT NOT NULL DEFAULT ''",
        "pay_remark": "TEXT NOT NULL DEFAULT ''",
        "company_name": "TEXT NOT NULL DEFAULT ''",
        "shop_name": "TEXT NOT NULL DEFAULT ''",
        "warehouse_location_name": "TEXT NOT NULL DEFAULT ''",
        "property_name": "TEXT NOT NULL DEFAULT ''",
        "property_value": "TEXT NOT NULL DEFAULT ''",
        "spu_no": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE inventory_movement ADD COLUMN {name} {ddl}")


def ensure_physical_stock_hold_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS physical_stock_hold (
          serial_number TEXT PRIMARY KEY,
          sku_key TEXT NOT NULL,
          source_order_no TEXT NOT NULL DEFAULT '',
          source_order_line_id TEXT NOT NULL DEFAULT '',
          hold_reason TEXT NOT NULL DEFAULT '',
          warehouse_code TEXT NOT NULL DEFAULT 'PO_HOLD',
          location_code TEXT NOT NULL DEFAULT 'PO_EDU_REAL_STOCK',
          hold_status TEXT NOT NULL DEFAULT 'active',
          matched_service_order_no TEXT NOT NULL DEFAULT '',
          matched_outbound_movement_id TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(physical_stock_hold)").fetchall()
    }
    columns = {
        "source_order_line_id": "TEXT NOT NULL DEFAULT ''",
        "hold_reason": "TEXT NOT NULL DEFAULT ''",
        "warehouse_code": f"TEXT NOT NULL DEFAULT '{PHYSICAL_HOLD_WAREHOUSE_CODE}'",
        "location_code": f"TEXT NOT NULL DEFAULT '{PHYSICAL_HOLD_LOCATION_CODE}'",
        "hold_status": "TEXT NOT NULL DEFAULT 'active'",
        "matched_service_order_no": "TEXT NOT NULL DEFAULT ''",
        "matched_outbound_movement_id": "TEXT NOT NULL DEFAULT ''",
        "note": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE physical_stock_hold ADD COLUMN {name} {ddl}")


def ensure_sales_order_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(sales_order)").fetchall()
    }
    columns = {
        "external_order_no": "TEXT NOT NULL DEFAULT ''",
        "pay_amount": "REAL NOT NULL DEFAULT 0",
        "status_name": "TEXT NOT NULL DEFAULT ''",
        "order_type": "INTEGER",
        "order_type_name": "TEXT NOT NULL DEFAULT ''",
        "channel_type_name": "TEXT NOT NULL DEFAULT ''",
        "cashier_name": "TEXT NOT NULL DEFAULT ''",
        "total_quantity": "INTEGER NOT NULL DEFAULT 0",
        "pay_time": "TEXT NOT NULL DEFAULT ''",
        "created_time": "TEXT NOT NULL DEFAULT ''",
        "shop_id": "TEXT NOT NULL DEFAULT ''",
        "shop_name": "TEXT NOT NULL DEFAULT ''",
        "company_id": "TEXT NOT NULL DEFAULT ''",
        "raw_payload_json": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE sales_order ADD COLUMN {name} {ddl}")


def ensure_sales_order_line_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(sales_order_line)").fetchall()
    }
    columns = {
        "product_name": "TEXT NOT NULL DEFAULT ''",
        "product_no": "TEXT NOT NULL DEFAULT ''",
        "mtm_code": "TEXT NOT NULL DEFAULT ''",
        "spec": "TEXT NOT NULL DEFAULT ''",
        "supplier_name": "TEXT NOT NULL DEFAULT ''",
        "pay_amount": "REAL",
        "discount_amount": "REAL",
        "serial_number": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE sales_order_line ADD COLUMN {name} {ddl}")


def ensure_education_agent_scan_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(education_agent_scan_raw)").fetchall()
    }
    columns = {
        "customer_name": "TEXT NOT NULL DEFAULT ''",
        "customer_phone": "TEXT NOT NULL DEFAULT ''",
        "agent_phone": "TEXT NOT NULL DEFAULT ''",
        "model_text": "TEXT NOT NULL DEFAULT ''",
        "voucher_code": "TEXT NOT NULL DEFAULT ''",
        "voucher_verified_at": "TEXT NOT NULL DEFAULT ''",
        "report_status": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE education_agent_scan_raw ADD COLUMN {name} {ddl}")


def ensure_manufacturer_manual_promotion_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(manufacturer_manual_promotion)").fetchall()
    }
    if not existing:
        return
    columns = {
        "valid_from": "TEXT NOT NULL DEFAULT ''",
        "valid_to": "TEXT NOT NULL DEFAULT ''",
        "marketing_po_enabled": "INTEGER NOT NULL DEFAULT 0",
        "education_enabled": "INTEGER NOT NULL DEFAULT 0",
        "source_activity_ids": "TEXT NOT NULL DEFAULT ''",
        "source_labels": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE manufacturer_manual_promotion ADD COLUMN {name} {ddl}")


def ensure_frontend_activity_display_override_schema(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(frontend_activity_display_override)").fetchall()
    columns = {row[1] for row in rows}
    if not rows:
        return
    if "activity_id" in columns:
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_activity_display_override_activity_sku
            ON frontend_activity_display_override(activity_id, sku_key)
            """
        )
        return
    conn.execute("ALTER TABLE frontend_activity_display_override RENAME TO frontend_activity_display_override_legacy")
    conn.execute(
        """
        CREATE TABLE frontend_activity_display_override (
          activity_id TEXT NOT NULL DEFAULT '',
          sku_key TEXT NOT NULL,
          marketing_po_enabled INTEGER NOT NULL DEFAULT 1,
          marketing_po_amount REAL,
          education_subsidy_enabled INTEGER NOT NULL DEFAULT 1,
          education_subsidy_amount REAL,
          note TEXT NOT NULL DEFAULT '',
          source_system TEXT NOT NULL DEFAULT 'api.frontend_activity_display_override',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (activity_id, sku_key)
        )
        """
    )
    conn.execute(
        """
        INSERT INTO frontend_activity_display_override (
          activity_id,
          sku_key,
          marketing_po_enabled,
          marketing_po_amount,
          education_subsidy_enabled,
          education_subsidy_amount,
          note,
          source_system,
          updated_at
        )
        SELECT
          '',
          sku_key,
          marketing_po_enabled,
          marketing_po_amount,
          education_subsidy_enabled,
          education_subsidy_amount,
          note,
          source_system,
          updated_at
        FROM frontend_activity_display_override_legacy
        """
    )
    conn.execute("DROP TABLE frontend_activity_display_override_legacy")


def ensure_cross_outbound_check_history_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(cross_outbound_check_history)").fetchall()
    }
    if not existing:
        return
    if "cost_unit_price" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_history ADD COLUMN cost_unit_price REAL")
    if "cost_total_amount" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_history ADD COLUMN cost_total_amount REAL")
    if "cost_source" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_history ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown'")
    if "serial_costs_json" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_history ADD COLUMN serial_costs_json TEXT NOT NULL DEFAULT '[]'")
    if "calculation_basis" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_history ADD COLUMN calculation_basis TEXT NOT NULL DEFAULT 'purchaseCost'")


def ensure_cross_outbound_check_rule_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(cross_outbound_check_rule)").fetchall()
    }
    if not existing:
        return
    if "calculation_basis" not in existing:
        conn.execute("ALTER TABLE cross_outbound_check_rule ADD COLUMN calculation_basis TEXT NOT NULL DEFAULT 'purchaseCost'")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_activity_display_override_activity_sku
        ON frontend_activity_display_override(activity_id, sku_key)
        """
    )


def load_retail_zone_display_names(data_dir: Path) -> dict[str, str]:
    payload = _load_json_payload(data_dir, "latest-retail-zone-snapshot.json")
    decisions = ((payload.get("decisions") or {}) if isinstance(payload, dict) else {}).get("items") or []
    display_names: dict[str, str] = {}
    if not isinstance(decisions, list):
        return display_names
    for item in decisions:
        if not isinstance(item, dict):
            continue
        sku_key = str(item.get("skuKey") or "").strip()
        product_name = str(item.get("productName") or "").strip()
        if sku_key and product_name:
            display_names[sku_key] = product_name
    return display_names


def seed_reference_data(data_dir: Path) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    seeded_skus = 0
    seeded_serials = 0
    seeded_movements = 0
    synced_warranty_records = 0
    synced_sales_price_protection = 0
    synced_distributor_quotes = 0
    synced_gray_wholesale_quotes = 0
    synced_inventory_price_signals = 0
    synced_sales_orders = 0
    synced_sales_export_movements = 0
    synced_order_registry = 0
    synced_education_agent_scan_rows = 0
    enriched_sales_orders_from_openclaw = 0
    synced_sales_orders_from_openclaw = 0
    backfilled_sales_order_lines_from_payload = 0
    synced_purchase_orders_from_openclaw = 0
    synced_purchase_order_lines_from_openclaw = 0
    enriched_purchase_movements_from_openclaw = 0
    normalized_purchase_movement_identity = 0
    enriched_movement_suppliers_from_openclaw = 0
    enriched_sales_order_line_suppliers = 0
    enriched_sales_order_lines_from_movements = 0
    normalized_sales_movement_amounts = 0
    synced_stock_order_events = 0
    synced_sn_event_states = 0
    reconciled_serial_statuses = 0
    reconciled_sku_stock = 0
    serial_overrides = load_serial_overrides(data_dir)
    retail_zone_display_names = load_retail_zone_display_names(data_dir)
    current_snapshot_serials: set[str] = set()

    with connect() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO external_system
            (id, name, system_type, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("zhidiantong", "智店通", "inventory_pos", "manual_sync", timestamp),
                ("lenovo_warranty", "联想保修查询", "warranty", "planned", timestamp),
                ("price_tag_gateway", "电子价签网关", "electronic_shelf_label", "planned", timestamp),
                ("local_sync_port", "本地统一同步端口", "local_orchestrator", "active", timestamp),
            ],
        )
        conn.executemany(
            """
            INSERT OR IGNORE INTO staff (id, name, role, active, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("EMP001", "店长A", "manager", 1, timestamp),
                ("EMP002", "销售B", "sales", 1, timestamp),
            ],
        )

        snapshot_file = data_dir / "latest-adjusted-inventory-snapshot.json"
        if snapshot_file.exists():
            snapshot = json.loads(snapshot_file.read_text(encoding="utf-8"))
            snapshot_is_sql_backed = str(snapshot.get("source") or "").startswith("sqlite.retail_core")
            for item in snapshot.get("skus", []):
                if not isinstance(item, dict):
                    continue
                sku_key = str(item.get("skuKey", "")).strip()
                if not sku_key:
                    continue
                category_name = str(item.get("category", ""))
                product_id = f"PROD-{sku_key}"
                snapshot_name = str(item.get("productName", sku_key))
                name = snapshot_name
                conn.execute(
                    """
                    INSERT INTO product
                    (id, name, brand, category, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      category = excluded.category
                    """,
                    (product_id, name, "Lenovo", category_name, timestamp),
                )
                conn.execute(
                    (
                        """
                        INSERT INTO sku
                        (id, product_id, sku_key, pn_mtm, name, category,
                         source_category, jd_subcategory, catalog_source,
                         sellable_stock, current_stock, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(sku_key) DO UPDATE SET
                          name = excluded.name,
                          category = excluded.category,
                          source_category = excluded.source_category,
                          jd_subcategory = excluded.jd_subcategory,
                          catalog_source = excluded.catalog_source,
                          updated_at = excluded.updated_at
                        """
                        if snapshot_is_sql_backed
                        else
                        """
                        INSERT INTO sku
                        (id, product_id, sku_key, pn_mtm, name, category,
                         source_category, jd_subcategory, catalog_source,
                         sellable_stock, current_stock, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(sku_key) DO UPDATE SET
                          name = excluded.name,
                          category = excluded.category,
                          source_category = excluded.source_category,
                          jd_subcategory = excluded.jd_subcategory,
                          catalog_source = excluded.catalog_source,
                          sellable_stock = excluded.sellable_stock,
                          current_stock = excluded.current_stock,
                          updated_at = excluded.updated_at
                        """
                    ),
                    (
                        f"SKU-{sku_key}",
                        product_id,
                        sku_key,
                        str(item.get("pnMtm", "")),
                        name,
                        category_name,
                        str(item.get("sourceCategory", "")),
                        str(item.get("jdSubcategory", "")),
                        str(item.get("catalogSource", "")),
                        0 if snapshot_is_sql_backed else int(item.get("sellableStock", 0) or 0),
                        0 if snapshot_is_sql_backed else int(item.get("currentStock", 0) or 0),
                        timestamp,
                    ),
                )
                existing_master = conn.execute(
                    "SELECT canonical_name FROM product_master WHERE id = ?",
                    (product_id,),
                ).fetchone()
                canonical_name = (
                    str(existing_master["canonical_name"]).strip()
                    if existing_master and str(existing_master["canonical_name"]).strip()
                    else snapshot_name
                )
                master_source_confidence = (
                    "sql_locked_title"
                    if existing_master and str(existing_master["canonical_name"]).strip()
                    else "snapshot"
                )
                master_source_system = (
                    "product_master.sql_locked"
                    if existing_master and str(existing_master["canonical_name"]).strip()
                    else "latest-adjusted-inventory-snapshot.json"
                )
                master_note = (
                    "主标题按 SQL 产品主档锁定；零售区标题仅作展示与证据输入，不再反向覆盖。"
                    if existing_master and str(existing_master["canonical_name"]).strip()
                    else "主标题按库存总表/库存快照名称初始化；零售区标题仅作展示与证据输入，不参与主档回写。"
                )
                conn.execute(
                    """
                    INSERT INTO product_master
                    (id, product_id, canonical_name, brand, product_line, model_family,
                     default_category, primary_sku_key, configuration_summary,
                     configuration_fingerprint, review_status, source_confidence,
                     created_source, last_source_system, last_synced_at,
                     updated_by, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      canonical_name = excluded.canonical_name,
                      default_category = excluded.default_category,
                      configuration_summary = excluded.configuration_summary,
                      source_confidence = excluded.source_confidence,
                      last_source_system = excluded.last_source_system,
                      last_synced_at = excluded.last_synced_at,
                      updated_by = excluded.updated_by,
                      notes = excluded.notes,
                      updated_at = excluded.updated_at
                    """,
                    (
                        product_id,
                        product_id,
                        canonical_name,
                        "Lenovo",
                        "",
                        "",
                        category_name,
                        sku_key,
                        str(item.get("spec") or ""),
                        "",
                        "seeded",
                        master_source_confidence,
                        "snapshot_seed",
                        master_source_system,
                        timestamp,
                        "system",
                        master_note,
                        timestamp,
                        timestamp,
                    ),
                )
                seeded_skus += 1
                for serial in item.get("serials", []):
                    if not isinstance(serial, dict):
                        continue
                    serial_number = str(serial.get("serialNumber", "")).strip()
                    if not serial_number:
                        continue
                    current_snapshot_serials.add(serial_number)
                    override = serial_overrides.get(serial_number, {})
                    conn.execute(
                        """
                        INSERT INTO serial_item
                        (serial_number, sku_key, product_name, pn_mtm, spec, status,
                         warehouse_code, location_code, cost_amount, inbound_date,
                         inbound_document_no, operator_name, supplier_name,
                         warranty_status, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(serial_number) DO UPDATE SET
                          sku_key = excluded.sku_key,
                          product_name = excluded.product_name,
                          pn_mtm = excluded.pn_mtm,
                          spec = excluded.spec,
                          status = excluded.status,
                          location_code = excluded.location_code,
                          cost_amount = excluded.cost_amount,
                          inbound_date = COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date),
                          inbound_document_no = COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no),
                          operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
                          supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), serial_item.supplier_name),
                          updated_at = excluded.updated_at
                        """,
                        (
                            serial_number,
                            sku_key,
                            str(override.get("productName") or serial.get("productName") or name),
                            str(override.get("pnMtm") or serial.get("pnMtm") or item.get("pnMtm") or ""),
                            str(override.get("spec") or serial.get("spec") or item.get("spec") or ""),
                            "in_stock",
                            "STORE",
                            str(override.get("locationName") or "SALES_FLOOR"),
                            override.get("purchaseCost"),
                            override.get("inboundDate"),
                            str(override.get("documentNumber") or ""),
                            str(override.get("operatorName") or ""),
                            str(override.get("supplierName") or ""),
                            "unknown",
                            timestamp,
                        ),
                    )
                    seeded_serials += 1
                upsert_sku_category_mapping(conn, item, timestamp)

            if current_snapshot_serials:
                placeholders = ",".join("?" for _ in current_snapshot_serials)
                conn.execute(
                    f"""
                    UPDATE serial_item
                    SET status = 'out_of_stock', updated_at = ?
                    WHERE status = 'in_stock'
                      AND serial_number NOT IN ({placeholders})
                    """,
                    [timestamp, *sorted(current_snapshot_serials)],
                )
            else:
                conn.execute(
                    """
                    UPDATE serial_item
                    SET status = 'out_of_stock', updated_at = ?
                    WHERE status = 'in_stock'
                    """,
                    (timestamp,),
                )

            # Serial overrides are the durable SN fact source for inbound date/document/cost.
            # They must also repair sold/out-of-stock SN rows, not only the current in-stock set.
            for serial_number, override in serial_overrides.items():
                serial_number = str(serial_number or "").strip()
                if not serial_number:
                    continue
                sku_key = str(override.get("skuKey") or "").strip()
                if not sku_key:
                    continue
                conn.execute(
                    """
                    INSERT INTO serial_item
                    (serial_number, sku_key, product_name, pn_mtm, spec, status,
                     warehouse_code, location_code, cost_amount, inbound_date,
                     inbound_document_no, operator_name, supplier_name,
                     warranty_status, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(serial_number) DO UPDATE SET
                      sku_key = COALESCE(NULLIF(excluded.sku_key, ''), serial_item.sku_key),
                      product_name = COALESCE(NULLIF(excluded.product_name, ''), serial_item.product_name),
                      pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), serial_item.pn_mtm),
                      spec = COALESCE(NULLIF(excluded.spec, ''), serial_item.spec),
                      location_code = COALESCE(NULLIF(excluded.location_code, ''), serial_item.location_code),
                      cost_amount = COALESCE(excluded.cost_amount, serial_item.cost_amount),
                      inbound_date = COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date),
                      inbound_document_no = COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no),
                      operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
                      supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), serial_item.supplier_name),
                      updated_at = excluded.updated_at
                    """,
                    (
                        serial_number,
                        sku_key,
                        str(override.get("productName") or ""),
                        str(override.get("pnMtm") or ""),
                        str(override.get("spec") or ""),
                        "in_stock" if serial_number in current_snapshot_serials else "out_of_stock",
                        "STORE",
                        str(override.get("locationName") or "SALES_FLOOR"),
                        override.get("purchaseCost"),
                        str(override.get("inboundDate") or ""),
                        str(override.get("documentNumber") or ""),
                        str(override.get("operatorName") or ""),
                        str(override.get("supplierName") or ""),
                        "unknown",
                        timestamp,
                    ),
                )

            seed_category_nodes(conn, snapshot.get("skus", []), timestamp)
            seeded_movements = seed_inventory_movements(conn, data_dir, timestamp)
            enriched_movement_suppliers_from_openclaw = enrich_inventory_movement_suppliers_from_openclaw_sql(conn, timestamp)
            seeded_movements += backfill_inventory_movement_zhidiantong_fields(conn, timestamp)
            synced_distributor_quotes = sync_distributor_quotes(conn, data_dir, timestamp)
            synced_gray_wholesale_quotes = sync_gray_wholesale_quotes(conn, data_dir, timestamp)
            synced_inventory_price_signals = sync_inventory_price_signals(conn, data_dir, timestamp)
            # 不再清空全表：snapshot只有68条，会丢失PG过来的812条正确金额
            # 让各sync函数用ON CONFLICT UPDATE保留已有正确数据
            synced_sales_orders = sync_sales_orders_from_export_snapshot(conn, timestamp)
            synced_sales_orders += sync_sales_orders_from_inventory_movements(conn, timestamp)
            synced_sales_orders_from_openclaw = sync_all_sales_orders_from_openclaw_sql(conn, timestamp)
            (
                synced_purchase_orders_from_openclaw,
                synced_purchase_order_lines_from_openclaw,
                enriched_purchase_movements_from_openclaw,
            ) = sync_purchase_orders_from_openclaw_sql(conn, timestamp, data_dir)
            synced_stock_order_events, synced_sn_event_states = sync_stock_orders_and_sn_from_openclaw_sql(conn, timestamp)
            synced_inventory_quantity_from_openclaw = sync_inventory_quantity_from_openclaw_fact_inventory(conn, timestamp)
            normalized_purchase_movement_identity = normalize_purchase_inbound_movement_identity(conn, timestamp)
            enriched_sales_orders_from_openclaw = enrich_sales_orders_from_openclaw_sql(conn, timestamp)
            cleaned_sales_orders = cleanup_invalid_and_duplicate_sales_orders(conn, timestamp)
            enriched_sales_order_lines_from_movements = enrich_sales_order_lines_from_inventory_movements(conn)
            enriched_sales_order_line_suppliers = enrich_sales_order_line_suppliers_from_movements(conn)
            normalized_sales_movement_amounts = normalize_sales_outbound_movement_amounts_from_sales_lines(conn, timestamp)
            synced_sales_export_movements = sync_inventory_movements_from_sales_order_exports(conn, timestamp)
            # 最后一轮用 OpenClaw/采购主链强制收口，避免前序导入占位行把真实金额、数量、SN 或采购分类刷回错误状态。
            synced_sales_orders_from_openclaw += sync_all_sales_orders_from_openclaw_sql(conn, timestamp)
            backfilled_sales_order_lines_from_payload = backfill_sales_order_lines_from_raw_payload(conn, timestamp)
            normalize_outbound_document_fields(conn, timestamp)
            normalized_purchase_movement_identity += normalize_purchase_inbound_movement_identity(conn, timestamp)
            enriched_sales_order_lines_from_movements += enrich_sales_order_lines_from_inventory_movements(conn)
            normalized_sales_movement_amounts += normalize_sales_outbound_movement_amounts_from_sales_lines(conn, timestamp)
            normalize_purchase_cost_to_integer(conn, timestamp)
            reconciled_serial_statuses, reconciled_sku_stock = reconcile_serial_and_sku_stock_from_movements(conn, timestamp)
            auto_consumed_physical_holds = finalize_physical_hold_from_service_orders(
                note="同步链自动扫描智惠服务订单并完成实物仓二次出库",
                operator_name="system.sync",
                conn=conn,
            )
            synced_inventory_quantity_from_openclaw += sync_inventory_quantity_from_openclaw_fact_inventory(conn, timestamp)
            synced_warranty_records = sync_warranty_snapshot(conn, data_dir, timestamp)
            synced_sales_price_protection = sync_sales_price_protection_history(conn, data_dir, timestamp)
            synced_order_registry = sync_order_sync_registry(conn, data_dir, timestamp)
            synced_education_agent_scan_rows = sync_education_agent_scan_raw(conn, data_dir, timestamp)

    return {
        "database": str(DB_FILE),
        "seededSkus": seeded_skus,
        "seededSerials": seeded_serials,
        "seededMovements": seeded_movements,
        "syncedDistributorQuotes": synced_distributor_quotes,
        "syncedGrayWholesaleQuotes": synced_gray_wholesale_quotes,
        "syncedInventoryPriceSignals": synced_inventory_price_signals,
        "syncedSalesOrders": synced_sales_orders,
        "syncedSalesOrdersFromOpenclaw": synced_sales_orders_from_openclaw,
        "backfilledSalesOrderLinesFromPayload": backfilled_sales_order_lines_from_payload,
        "syncedPurchaseOrdersFromOpenclaw": synced_purchase_orders_from_openclaw,
        "syncedPurchaseOrderLinesFromOpenclaw": synced_purchase_order_lines_from_openclaw,
        "enrichedPurchaseMovementsFromOpenclaw": enriched_purchase_movements_from_openclaw,
        "normalizedPurchaseMovementIdentity": normalized_purchase_movement_identity,
        "enrichedSalesOrdersFromOpenclaw": enriched_sales_orders_from_openclaw,
        "cleanedSalesOrders": cleaned_sales_orders,
        "enrichedMovementSuppliersFromOpenclaw": enriched_movement_suppliers_from_openclaw,
        "enrichedSalesOrderLineSuppliers": enriched_sales_order_line_suppliers,
        "enrichedSalesOrderLinesFromMovements": enriched_sales_order_lines_from_movements,
        "normalizedSalesMovementAmounts": normalized_sales_movement_amounts,
        "syncedStockOrderEvents": synced_stock_order_events,
        "syncedSnEventStates": synced_sn_event_states,
        "syncedInventoryQuantityFromOpenclaw": synced_inventory_quantity_from_openclaw,
        "syncedSalesExportMovements": synced_sales_export_movements,
        "reconciledSerialStatuses": reconciled_serial_statuses,
        "reconciledSkuStockRows": reconciled_sku_stock,
        "autoConsumedPhysicalHoldCount": int(auto_consumed_physical_holds.get("finalizedCount", 0)),
        "syncedOrderRegistry": synced_order_registry,
        "syncedEducationAgentScanRows": synced_education_agent_scan_rows,
        "syncedWarrantyRecords": synced_warranty_records,
        "syncedSalesPriceProtectionRecords": synced_sales_price_protection,
    }


def reconcile_serial_and_sku_stock_from_movements(conn: sqlite3.Connection, timestamp: str) -> tuple[int, int]:
    """
    以库存流水为准收口 SN 状态：
    1) 按每个 SN 的最新出入方向回写 serial_item.status，避免销售出库后仍停留 in_stock。

    SKU 库存数量不得再由 SN 数反推。智店通商品库存数量快照才是库存数量真值；
    SN 只作为明细与差异校验来源。
    """
    movement_rows = conn.execute(
        """
        SELECT serial_number, movement_type, business_date, created_at,
               sku_key, product_name, pn_mtm, spec, inbound_document_no,
               operator_name, supplier_name, location_name
        FROM inventory_movement
        WHERE TRIM(COALESCE(serial_number, '')) <> ''
          AND movement_type IN (
            'sales_outbound', 'transfer_outbound', 'purchase_inbound', 'transfer_inbound',
            'po_hold_inbound', 'po_hold_release', 'po_hold_outbound',
            'po_hold_revoke_outbound', 'po_hold_reopen_inbound'
          )
        ORDER BY business_date DESC, created_at DESC
        """
    ).fetchall()

    latest_by_serial: dict[str, sqlite3.Row] = {}
    for row in movement_rows:
        serials = parse_mixed_serial_numbers(row["serial_number"])
        for serial in serials:
            if not serial or serial in latest_by_serial:
                continue
            latest_by_serial[serial] = row

    serial_status_updates = 0
    for serial, movement_row in latest_by_serial.items():
        movement_type = str(movement_row["movement_type"] or "").strip()
        target_status = _target_serial_status_from_movement_type(movement_type)
        before = conn.total_changes
        target_warehouse_code = PHYSICAL_HOLD_WAREHOUSE_CODE if movement_type in {"po_hold_inbound", "po_hold_outbound", "po_hold_reopen_inbound"} else "STORE"
        target_location_code = (
            PHYSICAL_HOLD_LOCATION_CODE
            if movement_type == "po_hold_inbound"
            else (
                PHYSICAL_HOLD_RELEASE_LOCATION_CODE
                if movement_type == "po_hold_release"
                else (
                    PHYSICAL_HOLD_CONSUMED_LOCATION_CODE
                    if movement_type == "po_hold_outbound"
                    else (
                        PHYSICAL_HOLD_REVOKED_LOCATION_CODE
                        if movement_type == "po_hold_revoke_outbound"
                        else (
                            PHYSICAL_HOLD_LOCATION_CODE
                            if movement_type == "po_hold_reopen_inbound"
                            else str(movement_row["location_name"] or "").strip()
                        )
                    )
                )
            )
        )
        conn.execute(
            """
            INSERT INTO serial_item
            (serial_number, sku_key, product_name, pn_mtm, spec, status,
             warehouse_code, location_code, cost_amount, inbound_date, inbound_document_no,
             operator_name, supplier_name, warranty_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'unknown', ?)
            ON CONFLICT(serial_number) DO UPDATE SET
              sku_key = COALESCE(NULLIF(excluded.sku_key, ''), serial_item.sku_key),
              product_name = COALESCE(NULLIF(excluded.product_name, ''), serial_item.product_name),
              pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), serial_item.pn_mtm),
              spec = COALESCE(NULLIF(excluded.spec, ''), serial_item.spec),
              status = excluded.status,
              warehouse_code = COALESCE(NULLIF(excluded.warehouse_code, ''), serial_item.warehouse_code),
              location_code = COALESCE(NULLIF(excluded.location_code, ''), serial_item.location_code),
              inbound_date = CASE
                WHEN excluded.status = 'in_stock' THEN COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date)
                ELSE serial_item.inbound_date
              END,
              inbound_document_no = CASE
                WHEN excluded.status = 'in_stock' THEN COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no)
                ELSE serial_item.inbound_document_no
              END,
              operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
              supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), serial_item.supplier_name),
              updated_at = excluded.updated_at
            """,
            (
                serial,
                str(movement_row["sku_key"] or "").strip(),
                str(movement_row["product_name"] or "").strip(),
                str(movement_row["pn_mtm"] or "").strip(),
                str(movement_row["spec"] or "").strip(),
                target_status,
                target_warehouse_code,
                target_location_code,
                normalize_business_datetime_text(movement_row["business_date"] or "") if target_status == "in_stock" else "",
                str(movement_row["inbound_document_no"] or "").strip() if target_status == "in_stock" else "",
                str(movement_row["operator_name"] or "").strip(),
                str(movement_row["supplier_name"] or "").strip(),
                timestamp,
            ),
        )
        after = conn.total_changes
        if after > before:
            serial_status_updates += after - before

    sku_stock_adjustments = 0
    sku_rows = conn.execute(
        """
        SELECT sku_key, current_stock
        FROM sku
        WHERE COALESCE(current_stock, 0) <> 0
           OR EXISTS (
                SELECT 1
                FROM serial_item
                WHERE serial_item.sku_key = sku.sku_key
                  AND serial_item.status IN ('in_stock', 'stock_count_excess')
           )
        """
    ).fetchall()

    hold_count_cache: dict[str, int] = {}
    for sku_row in sku_rows:
        sku_key = str(sku_row["sku_key"] or "").strip()
        # sku.current_stock 是智店通日导数（门店+实物仓 in_stock 总数）；
        # SKU 调整逻辑用 target_stock 限制 in_stock SN 个数，需要把 active hold 也算进 target。
        if sku_key not in hold_count_cache:
            hold_count_row = conn.execute(
                "SELECT COUNT(*) FROM physical_stock_hold WHERE sku_key = ? AND hold_status = 'active'",
                (sku_key,),
            ).fetchone()
            hold_count_cache[sku_key] = int(hold_count_row[0] or 0) if hold_count_row else 0
        target_stock = max(int(sku_row["current_stock"] or 0) + hold_count_cache[sku_key], 0)
        in_stock_rows = conn.execute(
            """
            SELECT serial_number
            FROM serial_item
            WHERE sku_key = ?
              AND status = 'in_stock'
            ORDER BY COALESCE(NULLIF(inbound_date, ''), '') DESC,
                     updated_at DESC,
                     serial_number ASC
            """,
            (sku_key,),
        ).fetchall()
        in_stock_serials = [str(row["serial_number"] or "").strip() for row in in_stock_rows if str(row["serial_number"] or "").strip()]

        if len(in_stock_serials) > target_stock:
            excess_serials = in_stock_serials[target_stock:]
            if excess_serials:
                placeholders = ",".join("?" for _ in excess_serials)
                updated = conn.execute(
                    f"""
                    UPDATE serial_item
                    SET status = 'stock_count_excess',
                        updated_at = ?
                    WHERE sku_key = ?
                      AND status = 'in_stock'
                      AND serial_number IN ({placeholders})
                    """,
                    (timestamp, sku_key, *excess_serials),
                ).rowcount
                sku_stock_adjustments += int(updated or 0)
                in_stock_serials = in_stock_serials[:target_stock]

        if len(in_stock_serials) < target_stock:
            shortage = target_stock - len(in_stock_serials)
            candidate_rows = conn.execute(
                """
                SELECT serial_number, status, inbound_date, updated_at
                FROM serial_item
                WHERE sku_key = ?
                  AND status IN ('stock_count_excess', 'out_of_stock')
                ORDER BY COALESCE(NULLIF(inbound_date, ''), '') DESC,
                         updated_at DESC,
                         serial_number ASC
                """,
                (sku_key,),
            ).fetchall()
            promote_serials: list[str] = []
            fallback_outbound_serials: list[str] = []
            for candidate in candidate_rows:
                serial = str(candidate["serial_number"] or "").strip()
                if not serial:
                    continue
                latest_movement = latest_by_serial.get(serial)
                latest_type = str(latest_movement["movement_type"] or "").strip() if latest_movement else ""
                current_status = str(candidate["status"] or "").strip()
                if current_status == "stock_count_excess" or latest_type in {"purchase_inbound", "transfer_inbound"}:
                    promote_serials.append(serial)
                elif current_status == "out_of_stock":
                    fallback_outbound_serials.append(serial)
                if len(promote_serials) >= shortage:
                    break
            if len(promote_serials) < shortage and fallback_outbound_serials:
                for serial in fallback_outbound_serials:
                    if serial in promote_serials:
                        continue
                    promote_serials.append(serial)
                    if len(promote_serials) >= shortage:
                        break
            if promote_serials:
                placeholders = ",".join("?" for _ in promote_serials)
                updated = conn.execute(
                    f"""
                    UPDATE serial_item
                    SET status = 'in_stock',
                        updated_at = ?
                    WHERE sku_key = ?
                      AND status IN ('stock_count_excess', 'out_of_stock')
                      AND serial_number IN ({placeholders})
                    """,
                    (timestamp, sku_key, *promote_serials),
                ).rowcount
                sku_stock_adjustments += int(updated or 0)

    return serial_status_updates, sku_stock_adjustments


def sync_inventory_quantity_from_openclaw_fact_inventory(conn: sqlite3.Connection, timestamp: str) -> int:
    """
    用 OpenClaw 从智店通采集的 fact_inventory 最新 zhidiantong 快照校准 SKU 库存数量。

    注意：fact_inventory 里也存在 engineer_api 回灌镜像，它来自本地系统，不能再反向作为
    智店通库存真值。本函数只读取 source_name='zhidiantong'。
    """
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return 0
    try:
        import psycopg  # type: ignore
    except Exception:
        return 0
    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT MAX(snapshot_date)
                    FROM fact_inventory
                    WHERE source_name = 'zhidiantong'
                      AND COALESCE(business_scope, 'inventory_snapshot') = 'inventory_snapshot'
                    """
                )
                latest_date = cur.fetchone()[0]
                if not latest_date:
                    return 0
                cur.execute(
                    """
                    SELECT sku_no, mtm_code, sku_name, spu_name, category_name,
                           current_stock, available_sale_stock, unsellable_stock, cost_price
                    FROM fact_inventory
                    WHERE source_name = 'zhidiantong'
                      AND COALESCE(business_scope, 'inventory_snapshot') = 'inventory_snapshot'
                      AND snapshot_date = %s
                    """,
                    (latest_date,),
                )
                rows = cur.fetchall()
    except Exception:
        return 0

    seen_skus: set[str] = set()
    updated = 0
    for row in rows:
        sku_key = str(row[0] or "").strip()
        if not sku_key:
            continue
        seen_skus.add(sku_key)
        pn_mtm = str(row[1] or "").strip()
        spec = str(row[2] or "").strip()
        product_name = str(row[3] or "").strip() or sku_key
        category = str(row[4] or "").strip() or "未分类"
        current_stock = int(row[5] or 0)
        sellable_stock = int(row[6] if row[6] is not None else current_stock)
        cost_price = normalize_purchase_cost_amount(row[8])
        product_id = f"PROD-{sku_key}"
        conn.execute(
            """
            INSERT INTO product (id, name, brand, category, created_at)
            VALUES (?, ?, 'Lenovo', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              category = excluded.category
            """,
            (product_id, product_name, category, timestamp),
        )
        changed = conn.execute(
            """
            INSERT INTO sku
            (id, product_id, sku_key, pn_mtm, name, category, source_category,
             jd_subcategory, catalog_source, sellable_stock, current_stock, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT jd_subcategory FROM sku WHERE sku_key = ?), ''),
                    COALESCE((SELECT catalog_source FROM sku WHERE sku_key = ?), ''), ?, ?, ?)
            ON CONFLICT(sku_key) DO UPDATE SET
              product_id = excluded.product_id,
              pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), sku.pn_mtm),
              name = excluded.name,
              category = excluded.category,
              source_category = excluded.source_category,
              sellable_stock = excluded.sellable_stock,
              current_stock = excluded.current_stock,
              updated_at = excluded.updated_at
            """,
            (
                f"SKU-{sku_key}",
                product_id,
                sku_key,
                pn_mtm,
                product_name,
                category,
                category,
                sku_key,
                sku_key,
                sellable_stock,
                current_stock,
                timestamp,
            ),
        ).rowcount
        if changed:
            updated += int(changed)
        if cost_price is not None:
            conn.execute(
                """
                UPDATE serial_item
                SET cost_amount = COALESCE(cost_amount, ?)
                WHERE sku_key = ?
                  AND status = 'in_stock'
                  AND (cost_amount IS NULL OR cost_amount <= 0)
                """,
                (cost_price, sku_key),
            )

    if seen_skus:
        placeholders = ",".join("?" for _ in seen_skus)
        zeroed = conn.execute(
            f"""
            UPDATE sku
            SET current_stock = 0,
                sellable_stock = 0,
                updated_at = ?
            WHERE sku_key NOT IN ({placeholders})
              AND (COALESCE(current_stock, 0) <> 0 OR COALESCE(sellable_stock, 0) <> 0)
            """,
            (timestamp, *sorted(seen_skus)),
        ).rowcount
        updated += int(zeroed or 0)

    return updated


def _detect_openclaw_movement_type(service_type_name: str, operate_type_name: str, quantity: int) -> str:
    text = f"{service_type_name} {operate_type_name}".strip()
    if re.search(r"销售.*出库|业务订单|零售.*出库|门店.*销售", text):
        return "sales_outbound"
    if re.search(r"采购.*入库|商品入库|订单退货入库|入库", text) and not re.search(r"调拨", text):
        return "purchase_inbound"
    if re.search(r"调拨.*入库|换库位.*入库", text):
        return "transfer_inbound"
    if re.search(r"调拨.*出库|其他出库|换库位.*出库|出库", text):
        return "transfer_outbound"
    if quantity < 0:
        return "sales_outbound"
    return "manual_adjustment"


def sync_stock_orders_and_sn_from_openclaw_sql(conn: sqlite3.Connection, timestamp: str) -> tuple[int, int]:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return (0, 0)
    try:
        import psycopg  # type: ignore
    except Exception:
        return (0, 0)

    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, company_name, shop_no, shop_name, service_type_name, service_no, spu_no, sku_no,
                           mtm_code, product_name, property_name, property_value, operate_type_name, quantity,
                           user_name, pay_date, pay_time, pay_remark, warehouse_location_name, supplier_name
                    FROM fact_stock_orders
                    ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
                    """
                )
                stock_rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT serial_number, spu_no, product_name, sku_no, mtm_code, property_name, shop_no, shop_name,
                           service_type_name, service_no, operate_type_name, user_name, pay_time, pay_remark,
                           warehouse_location_name
                    FROM fact_sn_records
                    WHERE COALESCE(TRIM(serial_number), '') <> ''
                    ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
                    """
                )
                sn_rows = cur.fetchall()
    except Exception:
        return (0, 0)

    synced_movements = 0
    for row in stock_rows:
        raw_id = str(row[0] or "").strip()
        sku_key = str(row[7] or "").strip()
        if not raw_id or not sku_key:
            continue
        service_type_name = str(row[4] or "").strip()
        service_no = str(row[5] or "").strip()
        operate_type_name = str(row[12] or "").strip()
        quantity = int(row[13] or 0)
        if quantity == 0:
            continue
        movement_type = _detect_openclaw_movement_type(service_type_name, operate_type_name, quantity)
        movement_id = f"ZDT-{raw_id}"
        business_date = normalize_business_datetime_text(row[16] or row[15] or "") or timestamp
        inbound_doc = (
            extract_canonical_purchase_order_no(service_no, raw_id)
            if movement_type in {"purchase_inbound", "transfer_inbound"}
            else ""
        )
        document_type = "采购入库" if movement_type == "purchase_inbound" else service_type_name
        conn.execute(
            """
            INSERT INTO inventory_movement
            (id, sku_key, serial_number, movement_type, quantity, business_date, source_system, source_ref,
             source_document_type, inbound_document_no, store_name, location_name, product_name, unit_name,
             unit_cost, amount, operator_name, supplier_name, pn_mtm, spec, service_type_name, operate_type_name,
             pay_remark, company_name, shop_name, warehouse_location_name, property_name, property_value, spu_no,
             note, created_at)
            VALUES (?, ?, '', ?, ?, ?, 'zhidiantong', ?, ?, ?, ?, ?, ?, '台', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              sku_key = excluded.sku_key,
              movement_type = excluded.movement_type,
              quantity = excluded.quantity,
              business_date = excluded.business_date,
              source_ref = excluded.source_ref,
              source_document_type = excluded.source_document_type,
              inbound_document_no = excluded.inbound_document_no,
              store_name = excluded.store_name,
              location_name = excluded.location_name,
              product_name = excluded.product_name,
              operator_name = excluded.operator_name,
              supplier_name = CASE WHEN TRIM(COALESCE(inventory_movement.supplier_name, '')) = '' THEN excluded.supplier_name ELSE inventory_movement.supplier_name END,
              pn_mtm = excluded.pn_mtm,
              spec = excluded.spec,
              service_type_name = excluded.service_type_name,
              operate_type_name = excluded.operate_type_name,
              pay_remark = excluded.pay_remark,
              company_name = excluded.company_name,
              shop_name = excluded.shop_name,
              warehouse_location_name = excluded.warehouse_location_name,
              property_name = excluded.property_name,
              property_value = excluded.property_value,
              spu_no = excluded.spu_no,
              note = excluded.note,
              created_at = excluded.created_at
            """,
            (
                movement_id,
                sku_key,
                movement_type,
                abs(quantity),
                business_date,
                service_no or raw_id,
                document_type,
                inbound_doc,
                str(row[3] or "").strip(),
                str(row[18] or "").strip(),
                str(row[9] or "").strip(),
                str(row[14] or "").strip(),
                str(row[19] or "").strip(),
                str(row[8] or "").strip(),
                str(row[11] or "").strip(),
                service_type_name,
                operate_type_name,
                str(row[17] or "").strip(),
                str(row[1] or "").strip(),
                str(row[3] or "").strip(),
                str(row[18] or "").strip(),
                str(row[10] or "").strip(),
                str(row[11] or "").strip(),
                str(row[6] or "").strip(),
                f"openclaw.full_db.{movement_type}",
                timestamp,
            ),
        )
        synced_movements += 1

    # 只使用每个 SN 的最新一条事件，避免旧记录把最新状态覆盖回去。
    latest_sn_rows: list[tuple[Any, ...]] = []
    seen_serial_numbers: set[str] = set()
    for row in sn_rows:
        serial_number = str(row[0] or "").strip()
        if not serial_number or serial_number in seen_serial_numbers:
            continue
        seen_serial_numbers.add(serial_number)
        latest_sn_rows.append(row)

    synced_sn_states = 0
    for row in latest_sn_rows:
        serial_number = str(row[0] or "").strip()
        sku_key = str(row[3] or "").strip()
        if not serial_number or not sku_key:
            continue
        operate_type_name = str(row[10] or "").strip()
        service_type_name = str(row[8] or "").strip()
        merged_text = f"{service_type_name} {operate_type_name}".strip()
        status = "in_stock"
        if re.search(r"出库|销售|业务订单", merged_text):
            status = "out_of_stock"
        business_date = normalize_business_datetime_text(row[12] or "") or ""
        service_no = str(row[9] or "").strip()
        inbound_doc = extract_canonical_purchase_order_no(service_no) if status == "in_stock" else ""
        conn.execute(
            """
            INSERT INTO serial_item
            (serial_number, sku_key, product_name, pn_mtm, spec, status,
             warehouse_code, location_code, cost_amount, inbound_date, inbound_document_no,
             operator_name, supplier_name, warranty_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'STORE', ?, NULL, ?, ?, ?, '', 'unknown', ?)
            ON CONFLICT(serial_number) DO UPDATE SET
              sku_key = excluded.sku_key,
              product_name = COALESCE(NULLIF(excluded.product_name, ''), serial_item.product_name),
              pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), serial_item.pn_mtm),
              spec = COALESCE(NULLIF(excluded.spec, ''), serial_item.spec),
              status = excluded.status,
              location_code = COALESCE(NULLIF(excluded.location_code, ''), serial_item.location_code),
              inbound_date = CASE
                WHEN excluded.status = 'in_stock' THEN COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date)
                ELSE serial_item.inbound_date
              END,
              inbound_document_no = CASE
                WHEN excluded.status = 'in_stock' THEN COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no)
                ELSE serial_item.inbound_document_no
              END,
              operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
              updated_at = excluded.updated_at
            """,
            (
                serial_number,
                sku_key,
                str(row[2] or "").strip(),
                str(row[4] or "").strip(),
                str(row[5] or "").strip(),
                status,
                str(row[14] or "").strip(),
                business_date if status == "in_stock" else "",
                inbound_doc,
                str(row[11] or "").strip(),
                timestamp,
            ),
        )
        synced_sn_states += 1

    return (synced_movements, synced_sn_states)


def cleanup_invalid_and_duplicate_sales_orders(conn: sqlite3.Connection, timestamp: str) -> int:
    rows = conn.execute(
        """
        SELECT id, external_order_no, note
        FROM sales_order
        """
    ).fetchall()
    if not rows:
        return 0

    existing_ids = {str(row["id"] or "").strip() for row in rows if str(row["id"] or "").strip()}
    delete_ids: set[str] = set()
    for row in rows:
        order_id = str(row["id"] or "").strip()
        if not order_id:
            continue
        normalized = order_id.upper()
        if normalized.startswith("ZDT-CGR") or normalized.startswith("CGR"):
            delete_ids.add(order_id)
            continue
        canonical_id = extract_canonical_sales_order_no(order_id, row["external_order_no"], row["note"])
        if not canonical_id or canonical_id == normalized:
            continue
        if canonical_id not in existing_ids:
            continue
        if (
            normalized.startswith("ZDT-")
            or normalized.startswith("SALE-EXPORT-")
            or normalized.startswith("SALE-XS")
            or normalized.startswith("SALE-20")
        ):
            delete_ids.add(order_id)

    if not delete_ids:
        return 0

    placeholders = ",".join("?" for _ in delete_ids)
    conn.execute(
        f"DELETE FROM sales_order_line WHERE order_id IN ({placeholders})",
        tuple(sorted(delete_ids)),
    )
    deleted = conn.execute(
        f"DELETE FROM sales_order WHERE id IN ({placeholders})",
        tuple(sorted(delete_ids)),
    ).rowcount
    return int(deleted or 0)


def normalize_outbound_document_fields(conn: sqlite3.Connection, timestamp: str) -> int:
    """
    销售/其他出库流水不应占用 inbound_document_no，避免一行出现两个不同单号。
    """
    updated = conn.execute(
        """
        UPDATE inventory_movement
        SET inbound_document_no = '',
            created_at = ?
        WHERE movement_type IN ('sales_outbound', 'transfer_outbound')
          AND TRIM(COALESCE(inbound_document_no, '')) <> ''
        """,
        (timestamp,),
    ).rowcount
    return int(updated or 0)


def normalize_purchase_cost_to_integer(conn: sqlite3.Connection, timestamp: str) -> int:
    """
    采购成本价统一按整数元展示。

    OpenClaw/ZDT 源数据里同一字段可能混用“元”和“分”：
    - 13439 表示 13439 元
    - 1229900 表示 12299.00 元
    所以先把明显的分单位值转为元，再去掉分角尾数，并联动金额。
    """
    updated = 0
    updated += conn.execute(
        """
        UPDATE inventory_movement
        SET unit_cost = ROUND(CASE WHEN ABS(unit_cost) >= 100000 THEN unit_cost / 100.0 ELSE unit_cost END, 0),
            amount = ROUND(ROUND(CASE WHEN ABS(unit_cost) >= 100000 THEN unit_cost / 100.0 ELSE unit_cost END, 0) * ABS(quantity), 2),
            created_at = ?
        WHERE movement_type = 'purchase_inbound'
          AND unit_cost IS NOT NULL
          AND (
            ABS(unit_cost) >= 100000
            OR ABS(unit_cost - ROUND(unit_cost, 0)) > 0.00001
          )
        """,
        (timestamp,),
    ).rowcount or 0
    updated += conn.execute(
        """
        UPDATE purchase_order_line
        SET cost_price = ROUND(CASE WHEN ABS(cost_price) >= 100000 THEN cost_price / 100.0 ELSE cost_price END, 0),
            created_at = ?
        WHERE cost_price IS NOT NULL
          AND (
            ABS(cost_price) >= 100000
            OR ABS(cost_price - ROUND(cost_price, 0)) > 0.00001
          )
        """,
        (timestamp,),
    ).rowcount or 0
    updated += conn.execute(
        """
        UPDATE serial_item
        SET cost_amount = ROUND(CASE WHEN ABS(cost_amount) >= 100000 THEN cost_amount / 100.0 ELSE cost_amount END, 0),
            updated_at = ?
        WHERE cost_amount IS NOT NULL
          AND (
            ABS(cost_amount) >= 100000
            OR ABS(cost_amount - ROUND(cost_amount, 0)) > 0.00001
          )
        """,
        (timestamp,),
    ).rowcount or 0
    return int(updated)


def sync_all_sales_orders_from_openclaw_sql(conn: sqlite3.Connection, timestamp: str) -> int:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return 0
    try:
        import psycopg  # type: ignore
    except Exception:
        return 0
    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT order_id, order_no, status, status_name, total_amount, pay_amount,
                           order_type, order_type_name, channel_type_name, cashier_name,
                           total_quantity, pay_time, created_time, shop_id, shop_name, company_id,
                           outer_order_no, buyer_phone, buyer_nick, raw_payload
                    FROM fact_orders
                    ORDER BY pay_time DESC NULLS LAST, created_time DESC NULLS LAST
                    """
                )
                raw_order_rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT order_id, order_no, sku_no, product_no, product_name, mtm_code, spec,
                           quantity, unit_price, total_amount, pay_amount, discount_amount, serial_number
                    FROM fact_order_items
                    """
                )
                raw_line_rows = cur.fetchall()
    except Exception:
        return 0

    order_rows: dict[str, tuple[Any, ...]] = {}
    for row in raw_order_rows:
        external_order_no = str(row[0] or "").strip()
        raw_order_no = str(row[1] or "").strip() or external_order_no
        canonical_order_no = extract_canonical_sales_order_no(raw_order_no, external_order_no)
        if not canonical_order_no:
            continue
        previous = order_rows.get(canonical_order_no)
        if previous is None or score_openclaw_order_row(row) > score_openclaw_order_row(previous):
            order_rows[canonical_order_no] = row

    lines_by_order: dict[str, dict[str, dict[str, Any]]] = {}
    for row in raw_line_rows:
        external_order_id = str(row[0] or "").strip()
        raw_order_no = str(row[1] or "").strip()
        canonical_order_no = extract_canonical_sales_order_no(raw_order_no, external_order_id)
        sku_key = str(row[2] or row[3] or "").strip()
        if not canonical_order_no or not sku_key:
            continue
        order_bucket = lines_by_order.setdefault(canonical_order_no, {})
        bucket = order_bucket.get(sku_key)
        if bucket is None:
            bucket = {
                "sku_key": sku_key,
                "product_name": "",
                "product_no": "",
                "mtm_code": "",
                "spec": "",
                "quantity": 0,
                "unit_price": 0.0,
                "pay_amount": 0.0,
                "discount_amount": 0.0,
                "serial_numbers": [],
                "has_real": False,
            }
            order_bucket[sku_key] = bucket
        placeholder = is_placeholder_openclaw_order_line(row)
        if placeholder and bucket["has_real"]:
            continue
        if not placeholder and not bucket["has_real"]:
            bucket["quantity"] = 0
            bucket["unit_price"] = 0.0
            bucket["pay_amount"] = 0.0
            bucket["discount_amount"] = 0.0
            bucket["serial_numbers"] = []
            bucket["has_real"] = True
        if not placeholder:
            bucket["has_real"] = True
        quantity = int(row[7] or 0) if str(row[7] or "").strip() else 0
        if quantity > 0:
            bucket["quantity"] += quantity
        unit_price = normalize_openclaw_currency_amount(row[8] or 0)
        total_amount = normalize_openclaw_currency_amount(row[9] or 0)
        pay_amount = normalize_openclaw_line_pay_amount(row[10], row[9])
        discount_amount = normalize_openclaw_currency_amount(row[11] or 0)
        if unit_price > 0:
            bucket["unit_price"] = unit_price
        if total_amount > 0 or pay_amount > 0:
            bucket["pay_amount"] += pay_amount if pay_amount > 0 else total_amount
        if discount_amount > 0:
            bucket["discount_amount"] += discount_amount
        for serial in parse_mixed_serial_numbers(row[12]):
            if serial not in bucket["serial_numbers"]:
                bucket["serial_numbers"].append(serial)
        if not bucket["product_name"]:
            bucket["product_name"] = str(row[4] or "").strip()
        if not bucket["product_no"]:
            bucket["product_no"] = str(row[3] or "").strip()
        if not bucket["mtm_code"]:
            bucket["mtm_code"] = str(row[5] or "").strip()
        if not bucket["spec"]:
            bucket["spec"] = str(row[6] or "").strip()

    synced_orders = 0
    for order_no, row in order_rows.items():
        external_order_no = str(row[0] or "").strip()
        raw_order_no = str(row[1] or "").strip() or external_order_no
        status_raw = str(row[2] or "").strip() or "completed"
        status_name = str(row[3] or "").strip() or status_raw
        total_amount = normalize_openclaw_currency_amount(row[4])
        pay_amount = normalize_openclaw_currency_amount(row[5] or row[4] or 0)
        raw_payload = row[19] if len(row) > 19 else {}
        if isinstance(raw_payload, dict):
            raw_total_amount = normalize_openclaw_currency_amount(raw_payload.get("totalAmount") or raw_payload.get("productAmount") or 0)
            raw_pay_amount = normalize_openclaw_currency_amount(raw_payload.get("payAmount") or raw_payload.get("paidAmount") or 0)
            if raw_total_amount > total_amount:
                total_amount = raw_total_amount
            if raw_pay_amount > pay_amount:
                pay_amount = raw_pay_amount
        order_type = int(row[6] or 1) if str(row[6] or "").strip() else 1
        order_type_name = str(row[7] or "").strip() or "线下"
        channel_type_name = str(row[8] or "").strip() or "门店收银"
        cashier_name = str(row[9] or "").strip()
        grouped_lines = list((lines_by_order.get(order_no) or {}).values())
        total_quantity = int(row[10] or 0) if str(row[10] or "").strip() else 0
        if total_quantity <= 0:
            total_quantity = sum(int(line["quantity"] or 0) for line in grouped_lines)
        pay_time = normalize_business_datetime_text(row[11] or "")
        created_time = normalize_business_datetime_text(row[12] or "")
        business_date = _business_datetime_or_inferred(order_no, pay_time or created_time)
        shop_id = str(row[13] or "").strip()
        shop_name = str(row[14] or "").strip() or "STORE-XY-SYL"
        company_id = str(row[15] or "").strip()
        outer_order_no = str(row[16] or "").strip()
        buyer_phone = str(row[17] or "").strip()
        buyer_nick = str(row[18] or "").strip()
        payload_lines = build_sales_order_lines_from_raw_payload(raw_payload)
        grouped_quantity = sum(int(line["quantity"] or 0) for line in grouped_lines)
        payload_quantity = sum(int(line["quantity"] or 0) for line in payload_lines)
        grouped_pay_amount = sum(float(line.get("pay_amount") or 0) for line in grouped_lines)
        payload_pay_amount = sum(float(line.get("pay_amount") or 0) for line in payload_lines)
        if payload_lines and (
            not grouped_lines
            or payload_quantity > grouped_quantity
            or (payload_quantity >= grouped_quantity and payload_pay_amount > grouped_pay_amount * 10)
        ):
            grouped_lines = payload_lines
        customer_name = buyer_nick or buyer_phone

        conn.execute(
            """
            INSERT INTO sales_order
            (id, external_order_no, store_code, operator_id, customer_name, status, status_name, total_amount, pay_amount,
             order_type, order_type_name, channel_type_name, cashier_name, total_quantity, pay_time, created_time,
             shop_id, shop_name, company_id, business_date, raw_payload_json, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              external_order_no = excluded.external_order_no,
              customer_name = CASE
                WHEN TRIM(COALESCE(excluded.customer_name, '')) <> '' THEN excluded.customer_name
                ELSE sales_order.customer_name
              END,
              status = excluded.status,
              status_name = excluded.status_name,
              total_amount = CASE WHEN excluded.total_amount > 0 THEN excluded.total_amount ELSE sales_order.total_amount END,
              pay_amount = CASE WHEN excluded.pay_amount > 0 THEN excluded.pay_amount ELSE sales_order.pay_amount END,
              order_type = excluded.order_type,
              order_type_name = excluded.order_type_name,
              channel_type_name = excluded.channel_type_name,
              cashier_name = CASE WHEN excluded.cashier_name IS NOT NULL AND excluded.cashier_name != '' AND excluded.cashier_name NOT IN ('ZHIDIANTONG', 'POS', '') THEN excluded.cashier_name ELSE sales_order.cashier_name END,
              total_quantity = excluded.total_quantity,
              pay_time = excluded.pay_time,
              created_time = excluded.created_time,
              shop_id = excluded.shop_id,
              shop_name = excluded.shop_name,
              company_id = excluded.company_id,
              business_date = excluded.business_date,
              note = excluded.note,
              created_at = excluded.created_at
            """,
            (
                order_no,
                outer_order_no or external_order_no,
                shop_name,
                "OPENCLAW",
                customer_name,
                status_raw,
                status_name,
                total_amount,
                pay_amount,
                order_type,
                order_type_name,
                channel_type_name,
                cashier_name,
                total_quantity,
                pay_time or business_date,
                created_time or business_date,
                shop_id,
                shop_name,
                company_id,
                business_date,
                json.dumps(raw_payload if isinstance(raw_payload, dict) else {}, ensure_ascii=False),
                f"OpenClaw 历史订单全量同步 {raw_order_no or order_no}",
                timestamp,
            ),
        )
        if customer_name:
            customer_id = normalize_lookup_key(buyer_phone) or normalize_lookup_key(customer_name) or normalize_lookup_key(order_no)
            conn.execute(
                """
                INSERT INTO customer (id, name, phone, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = CASE WHEN TRIM(COALESCE(excluded.name, '')) <> '' THEN excluded.name ELSE customer.name END,
                  phone = CASE WHEN TRIM(COALESCE(excluded.phone, '')) <> '' THEN excluded.phone ELSE customer.phone END,
                  created_at = excluded.created_at
                """,
                (f"CUS-{customer_id}", customer_name, buyer_phone, timestamp),
            )
        conn.execute("DELETE FROM sales_order_line WHERE order_id = ?", (order_no,))
        for index, line in enumerate(grouped_lines, start=1):
            serial_numbers = list(line["serial_numbers"])
            serial_number = serial_numbers[0] if serial_numbers else ""
            conn.execute(
                """
                INSERT OR REPLACE INTO sales_order_line
                (id, order_id, sku_key, product_name, product_no, mtm_code, spec, supplier_name,
                 quantity, deal_price, pay_amount, discount_amount, serial_number, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{order_no}-{index:03d}",
                    order_no,
                    line["sku_key"],
                    line["product_name"],
                    line["product_no"],
                    line["mtm_code"],
                    line["spec"],
                    "",
                    int(line["quantity"] or 0),
                    float(line.get("unit_price") or line.get("deal_price") or 0),
                    float(line["pay_amount"] or 0),
                    float(line["discount_amount"] or 0) if float(line["discount_amount"] or 0) > 0 else None,
                    serial_number,
                    json.dumps(serial_numbers, ensure_ascii=False),
                    timestamp,
                ),
            )
        synced_orders += 1
    return synced_orders


def sync_purchase_orders_from_openclaw_sql(
    conn: sqlite3.Connection,
    timestamp: str,
    data_dir: Path | None = None,
) -> tuple[int, int, int]:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return (0, 0, 0)
    try:
        import psycopg  # type: ignore
    except Exception:
        return (0, 0, 0)

    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, purchase_no, stock_in_time, operator_name, store_name, supplier_name, remark, status, raw_payload
                    FROM fact_purchase_orders
                    ORDER BY stock_in_time DESC NULLS LAST, collected_at DESC NULLS LAST
                    """
                )
                header_rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT id, purchase_no, purchase_id, stock_in_time, operator_name, store_name, supplier_name, remark,
                           product_no, product_name, sku_no, mtm_code, specification, quantity,
                           cost_price, batch_cost_price, shop_location_name, manage_sn, raw_payload
                    FROM fact_purchase_order_details
                    ORDER BY stock_in_time DESC NULLS LAST, collected_at DESC NULLS LAST
                    """
                )
                detail_rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT serial_number, product_name, sku_no, mtm_code, property_name,
                           service_no, user_name, pay_time, warehouse_location_name
                    FROM fact_sn_records
                    WHERE COALESCE(TRIM(service_no), '') <> ''
                    ORDER BY pay_time DESC NULLS LAST, collected_at DESC NULLS LAST
                    """
                )
                serial_rows = cur.fetchall()
    except Exception:
        return (0, 0, 0)

    serials_by_purchase_sku: dict[tuple[str, str], list[str]] = {}
    serial_meta_by_purchase_sku: dict[tuple[str, str], list[dict[str, Any]]] = {}
    serial_meta_by_purchase_only: dict[str, list[dict[str, Any]]] = {}
    for serial_row in serial_rows:
        purchase_no = extract_canonical_purchase_order_no(serial_row[5], serial_row[0])
        sku_key = str(serial_row[2] or "").strip()
        serial_number = str(serial_row[0] or "").strip()
        if not purchase_no or not sku_key or not serial_number:
            if not purchase_no or not serial_number:
                continue
            serial_meta_by_purchase_only.setdefault(purchase_no, []).append({
                "serial_number": serial_number,
                "product_name": str(serial_row[1] or "").strip(),
                "pn_mtm": str(serial_row[3] or "").strip(),
                "spec": str(serial_row[4] or "").strip(),
                "operator_name": str(serial_row[6] or "").strip(),
                "business_date": normalize_business_datetime_text(serial_row[7] or ""),
                "location_code": str(serial_row[8] or "").strip(),
            })
            continue
        key = (purchase_no, sku_key)
        existing = serials_by_purchase_sku.setdefault(key, [])
        if serial_number not in existing:
            existing.append(serial_number)
        meta_bucket = serial_meta_by_purchase_sku.setdefault(key, [])
        if any(item.get("serial_number") == serial_number for item in meta_bucket):
            continue
        meta_bucket.append({
            "serial_number": serial_number,
            "product_name": str(serial_row[1] or "").strip(),
            "pn_mtm": str(serial_row[3] or "").strip(),
            "spec": str(serial_row[4] or "").strip(),
            "operator_name": str(serial_row[6] or "").strip(),
            "business_date": normalize_business_datetime_text(serial_row[7] or ""),
            "location_code": str(serial_row[8] or "").strip(),
        })

    for movement in conn.execute(
        """
        SELECT source_ref, id, sku_key, serial_number
        FROM inventory_movement
        WHERE movement_type = 'purchase_inbound'
        """
    ).fetchall():
        purchase_no = extract_canonical_purchase_order_no(movement["source_ref"], movement["id"])
        sku_key = str(movement["sku_key"] or "").strip()
        if not purchase_no or not sku_key:
            continue
        serials = parse_mixed_serial_numbers(movement["serial_number"])
        if not serials:
            continue
        key = (purchase_no, sku_key)
        existing = serials_by_purchase_sku.setdefault(key, [])
        for serial in serials:
            if serial not in existing:
                existing.append(serial)

    details_by_purchase: dict[str, list[tuple[Any, ...]]] = {}
    for row in detail_rows:
        purchase_no = extract_canonical_purchase_order_no(row[1], row[2], row[0])
        if not purchase_no:
            continue
        details_by_purchase.setdefault(purchase_no, []).append(row)

    projection_by_purchase: dict[str, list[dict[str, Any]]] = {}
    if data_dir is not None:
        projection_file = data_dir / "latest-openclaw-purchase-inbound-projection.json"
        if projection_file.exists():
            try:
                projection_payload = json.loads(projection_file.read_text(encoding="utf-8"))
                projection_records = projection_payload.get("records") or []
                if isinstance(projection_records, list):
                    for record in projection_records:
                        if not isinstance(record, dict):
                            continue
                        purchase_no = extract_canonical_purchase_order_no(
                            record.get("documentNumber"),
                            record.get("sourceRef"),
                            record.get("id"),
                        )
                        sku_key = str(record.get("skuKey") or "").strip()
                        quantity = abs(parse_sqlite_int(record.get("quantity")))
                        if not purchase_no or not sku_key or quantity <= 0:
                            continue
                        projection_by_purchase.setdefault(purchase_no, []).append(record)
            except Exception:
                projection_by_purchase = {}

    movement_groups_by_purchase: dict[str, list[dict[str, Any]]] = {}
    for movement in conn.execute(
        """
        SELECT id, source_ref, sku_key, quantity, unit_cost, amount, supplier_name,
               business_date, product_name, pn_mtm, spec, operator_name, location_name
        FROM inventory_movement
        WHERE movement_type = 'purchase_inbound'
        """
    ).fetchall():
        purchase_no = extract_canonical_purchase_order_no(movement["source_ref"], movement["id"])
        sku_key = str(movement["sku_key"] or "").strip()
        if not purchase_no or not sku_key:
            continue
        movement_groups_by_purchase.setdefault(purchase_no, []).append({
            "sku_key": sku_key,
            "quantity": abs(int(movement["quantity"] or 0)),
            "cost_price": float(movement["unit_cost"] or 0),
            "amount": float(movement["amount"] or 0),
            "supplier_name": str(movement["supplier_name"] or "").strip(),
            "business_date": normalize_business_datetime_text(movement["business_date"] or ""),
            "product_name": str(movement["product_name"] or "").strip(),
            "pn_mtm": str(movement["pn_mtm"] or "").strip(),
            "spec": str(movement["spec"] or "").strip(),
            "operator_name": str(movement["operator_name"] or "").strip(),
            "location_name": str(movement["location_name"] or "").strip(),
        })

    header_by_purchase: dict[str, tuple[Any, ...]] = {}
    for header in header_rows:
        purchase_no = extract_canonical_purchase_order_no(header[1], header[0])
        if purchase_no:
            header_by_purchase[purchase_no] = header

    synced_orders = 0
    synced_lines = 0
    updated_movements = 0

    all_purchase_nos = sorted({
        *header_by_purchase.keys(),
        *details_by_purchase.keys(),
        *movement_groups_by_purchase.keys(),
        *(purchase_no for purchase_no, _sku_key in serials_by_purchase_sku.keys()),
    })

    for purchase_no in all_purchase_nos:
        header = header_by_purchase.get(purchase_no)
        fallback_movements = movement_groups_by_purchase.get(purchase_no, [])
        business_date = normalize_business_datetime_text(header[2] or "") if header else ""
        if not business_date and fallback_movements:
            business_date = str(fallback_movements[0].get("business_date") or "").strip()
        supplier_name = str(header[5] or "").strip() if header else ""
        if not supplier_name and fallback_movements:
            supplier_name = str(fallback_movements[0].get("supplier_name") or "").strip()
        status = str(header[7] or "").strip() if header else ""
        status = status or "completed"
        detail_groups: dict[str, dict[str, Any]] = {}
        total_amount = 0.0
        for detail in details_by_purchase.get(purchase_no, []):
            sku_key = str(detail[10] or "").strip()
            if not sku_key:
                continue
            quantity = parse_sqlite_int(detail[13])
            cost_price = float(detail[15] or detail[14] or 0) if str(detail[15] or detail[14] or "").strip() else 0.0
            total_amount += quantity * cost_price
            key = sku_key
            grouped = detail_groups.setdefault(key, {
                "sku_key": sku_key,
                "quantity": 0,
                "cost_price": cost_price,
                "serial_numbers": [],
                "pn_mtm": str(detail[11] or "").strip(),
                "spec": str(detail[12] or "").strip(),
            })
            grouped["quantity"] += quantity
            if cost_price > 0:
                grouped["cost_price"] = cost_price
            for serial in serials_by_purchase_sku.get((purchase_no, sku_key), []):
                if serial not in grouped["serial_numbers"]:
                    grouped["serial_numbers"].append(serial)

        if not detail_groups and fallback_movements:
            for movement in fallback_movements:
                sku_key = str(movement.get("sku_key") or "").strip()
                quantity = parse_sqlite_int(movement.get("quantity"))
                amount = float(movement.get("amount") or 0)
                if not sku_key or quantity <= 0:
                    continue
                cost_price = float(movement.get("cost_price") or 0)
                if cost_price <= 0 and amount > 0:
                    cost_price = round(amount / quantity, 2)
                total_amount += amount if amount > 0 else quantity * cost_price
                grouped = detail_groups.setdefault(sku_key, {
                    "sku_key": sku_key,
                    "quantity": 0,
                    "cost_price": cost_price,
                    "serial_numbers": [],
                    "pn_mtm": str(movement.get("pn_mtm") or "").strip(),
                    "spec": str(movement.get("spec") or "").strip(),
                })
                grouped["quantity"] += quantity
                if cost_price > 0:
                    grouped["cost_price"] = cost_price
                for serial in serials_by_purchase_sku.get((purchase_no, sku_key), []):
                    if serial not in grouped["serial_numbers"]:
                        grouped["serial_numbers"].append(serial)

        if not detail_groups and purchase_no in projection_by_purchase:
            for record in projection_by_purchase[purchase_no]:
                sku_key = str(record.get("skuKey") or "").strip()
                quantity = abs(parse_sqlite_int(record.get("quantity")))
                if not sku_key or quantity <= 0:
                    continue
                cost_price = float(record.get("purchaseCost") or 0)
                amount = float(record.get("amount") or 0)
                if cost_price <= 0 and amount > 0:
                    cost_price = round(amount / quantity, 2)
                total_amount += amount if amount > 0 else quantity * cost_price
                grouped = detail_groups.setdefault(sku_key, {
                    "sku_key": sku_key,
                    "quantity": 0,
                    "cost_price": cost_price,
                    "serial_numbers": [],
                    "pn_mtm": str(record.get("pnMtm") or "").strip(),
                    "spec": str(record.get("spec") or "").strip(),
                })
                grouped["quantity"] += quantity
                if cost_price > 0:
                    grouped["cost_price"] = cost_price
                serials = record.get("serials") or []
                if isinstance(serials, list):
                    for serial in serials:
                        serial_number = ""
                        if isinstance(serial, dict):
                            serial_number = str(
                                serial.get("serialNumber")
                                or serial.get("serial_number")
                                or serial.get("sn")
                                or ""
                            ).strip()
                        elif isinstance(serial, str):
                            serial_number = serial.strip()
                        if serial_number and serial_number not in grouped["serial_numbers"]:
                            grouped["serial_numbers"].append(serial_number)

        if not detail_groups:
            continue

        # Fallback: when OpenClaw SN rows do not carry sku_no, allocate by purchase_no + PN/规格.
        fallback_serial_pool = serial_meta_by_purchase_only.get(purchase_no, [])
        if fallback_serial_pool:
            allocated_serials: set[str] = set()
            for grouped in detail_groups.values():
                for serial in grouped["serial_numbers"]:
                    allocated_serials.add(serial)

            for grouped in detail_groups.values():
                if grouped["serial_numbers"]:
                    continue
                target_pn = normalize_lookup_key(grouped.get("pn_mtm") or "")
                target_spec = normalize_lookup_key(grouped.get("spec") or "")
                matched_meta: list[dict[str, Any]] = []
                for meta in fallback_serial_pool:
                    serial_number = str(meta.get("serial_number") or "").strip()
                    if not serial_number or serial_number in allocated_serials:
                        continue
                    meta_pn = normalize_lookup_key(meta.get("pn_mtm") or "")
                    meta_spec = normalize_lookup_key(meta.get("spec") or "")
                    if target_pn and meta_pn and target_pn == meta_pn:
                        matched_meta.append(meta)
                        allocated_serials.add(serial_number)
                        continue
                    if target_spec and meta_spec and target_spec == meta_spec:
                        matched_meta.append(meta)
                        allocated_serials.add(serial_number)
                if not matched_meta:
                    continue
                for meta in matched_meta:
                    serial_number = str(meta.get("serial_number") or "").strip()
                    if not serial_number:
                        continue
                    if serial_number not in grouped["serial_numbers"]:
                        grouped["serial_numbers"].append(serial_number)
                    key = (purchase_no, grouped["sku_key"])
                    serial_meta_by_purchase_sku.setdefault(key, []).append(meta)

            # 若采购单只有一个 SKU 行，且仍有未分配 SN，则全部归入该 SKU。
            remaining_unassigned = [
                meta for meta in fallback_serial_pool
                if str(meta.get("serial_number") or "").strip()
                and str(meta.get("serial_number") or "").strip() not in allocated_serials
            ]
            if len(detail_groups) == 1 and remaining_unassigned:
                only_group = next(iter(detail_groups.values()))
                only_key = (purchase_no, only_group["sku_key"])
                bucket = serial_meta_by_purchase_sku.setdefault(only_key, [])
                for meta in remaining_unassigned:
                    serial_number = str(meta.get("serial_number") or "").strip()
                    if not serial_number:
                        continue
                    if serial_number not in only_group["serial_numbers"]:
                        only_group["serial_numbers"].append(serial_number)
                    if not any(item.get("serial_number") == serial_number for item in bucket):
                        bucket.append(meta)

        total_amount = 0.0
        for grouped in detail_groups.values():
            serial_numbers: list[str] = []
            seen_serials: set[str] = set()
            for serial in grouped.get("serial_numbers") or []:
                serial_number = str(serial or "").strip()
                if not serial_number:
                    continue
                upper = serial_number.upper()
                if upper in seen_serials:
                    continue
                seen_serials.add(upper)
                serial_numbers.append(serial_number)
            grouped["serial_numbers"] = serial_numbers
            if serial_numbers:
                grouped["quantity"] = len(serial_numbers)
            quantity = abs(parse_sqlite_int(grouped.get("quantity")))
            cost_price = float(grouped.get("cost_price") or 0)
            grouped["quantity"] = quantity
            total_amount += quantity * cost_price

        conn.execute(
            """
            INSERT INTO purchase_order
            (id, supplier_id, status, total_amount, business_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              supplier_id = excluded.supplier_id,
              status = excluded.status,
              total_amount = excluded.total_amount,
              business_date = excluded.business_date,
              created_at = excluded.created_at
            """,
            (purchase_no, supplier_name, status, round(total_amount, 2), business_date or timestamp, timestamp),
        )
        conn.execute("DELETE FROM purchase_order_line WHERE order_id = ?", (purchase_no,))
        synced_orders += 1

        for index, grouped in enumerate(detail_groups.values(), start=1):
            conn.execute(
                """
                INSERT INTO purchase_order_line
                (id, order_id, sku_key, quantity, cost_price, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{purchase_no}-{index:03d}",
                    purchase_no,
                    grouped["sku_key"],
                    grouped["quantity"],
                    grouped["cost_price"],
                    json.dumps(grouped["serial_numbers"], ensure_ascii=False),
                    timestamp,
                ),
            )
            synced_lines += 1
            for serial_meta in serial_meta_by_purchase_sku.get((purchase_no, grouped["sku_key"]), []):
                serial_number = str(serial_meta.get("serial_number") or "").strip()
                if not serial_number:
                    continue
                conn.execute(
                    """
                    INSERT INTO serial_item
                    (serial_number, sku_key, product_name, pn_mtm, spec, status,
                     warehouse_code, location_code, cost_amount, inbound_date,
                     inbound_document_no, operator_name, supplier_name,
                     warranty_status, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(serial_number) DO UPDATE SET
                      sku_key = COALESCE(NULLIF(excluded.sku_key, ''), serial_item.sku_key),
                      product_name = COALESCE(NULLIF(excluded.product_name, ''), serial_item.product_name),
                      pn_mtm = COALESCE(NULLIF(excluded.pn_mtm, ''), serial_item.pn_mtm),
                      spec = COALESCE(NULLIF(excluded.spec, ''), serial_item.spec),
                      location_code = COALESCE(NULLIF(excluded.location_code, ''), serial_item.location_code),
                      cost_amount = COALESCE(excluded.cost_amount, serial_item.cost_amount),
                      inbound_date = COALESCE(NULLIF(excluded.inbound_date, ''), serial_item.inbound_date),
                      inbound_document_no = COALESCE(NULLIF(excluded.inbound_document_no, ''), serial_item.inbound_document_no),
                      operator_name = COALESCE(NULLIF(excluded.operator_name, ''), serial_item.operator_name),
                      supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), serial_item.supplier_name),
                      updated_at = excluded.updated_at
                    """,
                    (
                        serial_number,
                        grouped["sku_key"],
                        str(serial_meta.get("product_name") or ""),
                        str(serial_meta.get("pn_mtm") or ""),
                        str(serial_meta.get("spec") or ""),
                        "in_stock",
                        "STORE",
                        str(serial_meta.get("location_code") or "SALES_FLOOR"),
                        grouped["cost_price"] if grouped["cost_price"] > 0 else None,
                        str(serial_meta.get("business_date") or business_date or ""),
                        purchase_no,
                        str(serial_meta.get("operator_name") or ""),
                        supplier_name,
                        "unknown",
                        timestamp,
                    ),
                )
            if grouped["cost_price"] <= 0:
                continue
            movement_rows = conn.execute(
                """
                SELECT id, quantity, source_document_type, supplier_name
                FROM inventory_movement
                WHERE movement_type = 'purchase_inbound'
                  AND sku_key = ?
                """,
                (grouped["sku_key"],),
            ).fetchall()
            for movement in movement_rows:
                movement_purchase_no = extract_canonical_purchase_order_no(movement["id"])
                if movement_purchase_no != purchase_no:
                    continue
                quantity = abs(int(grouped.get("quantity") or movement["quantity"] or 0)) or 1
                amount = round(grouped["cost_price"] * quantity, 2)
                conn.execute(
                    """
                    UPDATE inventory_movement
                    SET source_ref = ?,
                        inbound_document_no = CASE WHEN TRIM(COALESCE(inbound_document_no, '')) = '' THEN ? ELSE inbound_document_no END,
                        source_document_type = CASE
                          WHEN TRIM(COALESCE(source_document_type, '')) = '' THEN '采购入库'
                          WHEN source_document_type = '业务订单' THEN '采购入库'
                          ELSE source_document_type
                        END,
                        supplier_name = CASE WHEN TRIM(COALESCE(supplier_name, '')) = '' THEN ? ELSE supplier_name END,
                        quantity = ?,
                        unit_cost = ?,
                        amount = ?,
                        operate_type_name = CASE WHEN TRIM(COALESCE(operate_type_name, '')) = '' THEN '采购入库' ELSE operate_type_name END,
                        service_type_name = CASE WHEN TRIM(COALESCE(service_type_name, '')) = '' THEN '采购入库' ELSE service_type_name END,
                        created_at = ?
                    WHERE id = ?
                    """,
                    (
                        purchase_no,
                        purchase_no,
                        supplier_name,
                        quantity,
                        grouped["cost_price"],
                        amount,
                        timestamp,
                        movement["id"],
                    ),
                )
                updated_movements += 1

            # 补一条可见采购流水（用于前端采购入库单据流水自动展示），避免只写 purchase_order_line 不落库流水。
            movement_id = f"PURCHASEQ-{purchase_no}-{grouped['sku_key']}"
            quantity = abs(int(grouped["quantity"] or 0))
            if quantity > 0:
                amount = round((grouped["cost_price"] or 0) * quantity, 2) if grouped["cost_price"] else 0.0
                serial_numbers = grouped.get("serial_numbers") or []
                serial_numbers_text = "、".join(serial_numbers)
                conn.execute(
                    """
                    INSERT INTO inventory_movement
                    (id, sku_key, serial_number, movement_type, quantity, business_date,
                     source_system, source_ref, note, created_at, inbound_document_no,
                     operator_name, supplier_name, pn_mtm, spec, source_document_type,
                     store_name, product_name, unit_name, unit_cost, amount, service_type_name, operate_type_name)
                    VALUES (?, ?, ?, 'purchase_inbound', ?, ?, 'zhidiantong', ?, '', ?, ?, ?, ?, ?, ?, '采购入库', '', '', '台', ?, ?, '采购入库', '采购入库')
                    ON CONFLICT(id) DO UPDATE SET
                      serial_number = excluded.serial_number,
                      quantity = excluded.quantity,
                      business_date = excluded.business_date,
                      source_ref = excluded.source_ref,
                      inbound_document_no = excluded.inbound_document_no,
                      operator_name = CASE WHEN TRIM(COALESCE(inventory_movement.operator_name, '')) = '' THEN excluded.operator_name ELSE inventory_movement.operator_name END,
                      supplier_name = CASE WHEN TRIM(COALESCE(inventory_movement.supplier_name, '')) = '' THEN excluded.supplier_name ELSE inventory_movement.supplier_name END,
                      pn_mtm = CASE WHEN TRIM(COALESCE(inventory_movement.pn_mtm, '')) = '' THEN excluded.pn_mtm ELSE inventory_movement.pn_mtm END,
                      spec = CASE WHEN TRIM(COALESCE(inventory_movement.spec, '')) = '' THEN excluded.spec ELSE inventory_movement.spec END,
                      unit_cost = excluded.unit_cost,
                      amount = excluded.amount,
                      source_document_type = '采购入库',
                      service_type_name = '采购入库',
                      operate_type_name = '采购入库',
                      created_at = excluded.created_at
                    """,
                    (
                        movement_id,
                        grouped["sku_key"],
                        serial_numbers_text,
                        quantity,
                        business_date or timestamp,
                        purchase_no,
                        timestamp,
                        purchase_no,
                        str(header[3] or "").strip() if header else "",
                        supplier_name,
                        grouped.get("pn_mtm") or "",
                        grouped.get("spec") or "",
                        grouped["cost_price"] if grouped["cost_price"] > 0 else None,
                        amount if amount > 0 else None,
                    ),
                )

    return (synced_orders, synced_lines, updated_movements)


def enrich_sales_order_lines_from_inventory_movements(conn: sqlite3.Connection) -> int:
    sales_order_rows = conn.execute(
        """
        SELECT id, pay_amount, total_amount
        FROM sales_order
        """
    ).fetchall()
    order_amount_by_id = {
        str(row["id"] or "").strip(): float(row["pay_amount"] or row["total_amount"] or 0)
        for row in sales_order_rows
    }
    line_count_by_order = {
        str(row[0] or ""): int(row[1] or 0)
        for row in conn.execute(
            """
            SELECT order_id, COUNT(*)
            FROM sales_order_line
            GROUP BY order_id
            """
        ).fetchall()
    }
    movement_rows = conn.execute(
        """
        SELECT source_ref, sku_key, serial_number, quantity, amount
        FROM inventory_movement
        WHERE movement_type = 'sales_outbound'
        """
    ).fetchall()
    movement_map: dict[tuple[str, str], dict[str, Any]] = {}
    for row in movement_rows:
        order_id = extract_canonical_sales_order_no(row["source_ref"])
        sku_key = str(row["sku_key"] or "").strip()
        if not order_id or not sku_key:
            continue
        key = (order_id, sku_key)
        is_exact_order_ref = str(row["source_ref"] or "").strip() == order_id
        bucket = movement_map.setdefault(key, {"serials": [], "amounts": [], "max_quantity": 0, "has_exact": False})
        if is_exact_order_ref and not bucket["has_exact"]:
            bucket["serials"] = []
            bucket["amounts"] = []
            bucket["max_quantity"] = 0
            bucket["has_exact"] = True
        elif not is_exact_order_ref and bucket["has_exact"]:
            continue
        for serial in parse_mixed_serial_numbers(row["serial_number"]):
            if serial not in bucket["serials"]:
                bucket["serials"].append(serial)
        bucket["max_quantity"] = max(bucket["max_quantity"], abs(int(row["quantity"] or 0)) or 0)
        raw_amount = row["amount"]
        if raw_amount not in (None, ""):
            try:
                amount_value = float(raw_amount or 0)
            except (TypeError, ValueError):
                amount_value = 0.0
            if amount_value > 0:
                order_amount = order_amount_by_id.get(order_id, 0)
                if order_amount > 0 and amount_value > order_amount * 5 and amount_value / 100 <= order_amount * 1.5:
                    amount_value = round(amount_value / 100, 2)
                bucket["amounts"].append(amount_value)

    updated = 0
    line_rows = conn.execute(
        """
        SELECT id, order_id, sku_key, quantity, deal_price, pay_amount, serial_number, serial_numbers_json
        FROM sales_order_line
        """
    ).fetchall()
    for row in line_rows:
        order_id = str(row["order_id"] or "").strip()
        sku_key = str(row["sku_key"] or "").strip()
        if not order_id or not sku_key:
            continue
        movement = movement_map.get((order_id, sku_key))
        if not movement:
            continue
        existing_serials = parse_mixed_serial_numbers(row["serial_numbers_json"])
        single_serial = str(row["serial_number"] or "").strip()
        if single_serial and single_serial not in {"-1"}:
            existing_serials = [single_serial, *[serial for serial in existing_serials if serial != single_serial]]
        merged_serials = existing_serials or movement["serials"]
        line_pay_amount = float(row["pay_amount"] or 0)
        line_deal_price = float(row["deal_price"] or 0)
        current_quantity = abs(int(row["quantity"] or 0)) or 1
        quantity = movement["max_quantity"] or current_quantity
        inferred_total = sum(float(value or 0) for value in movement["amounts"] if float(value or 0) > 0)
        if line_count_by_order.get(order_id, 0) == 1 and order_amount_by_id.get(order_id, 0) > 0:
            inferred_total = order_amount_by_id.get(order_id, 0)
        elif inferred_total <= 0 and line_count_by_order.get(order_id, 0) == 1:
            inferred_total = order_amount_by_id.get(order_id, 0)
        inferred_unit = round(inferred_total / quantity, 2) if inferred_total > 0 and quantity > 0 else 0.0
        should_override_pay_amount = False
        if inferred_total > 0:
            if line_pay_amount <= 0:
                should_override_pay_amount = True
            elif line_count_by_order.get(order_id, 0) == 1 and abs(line_pay_amount - inferred_total) > 0.01:
                should_override_pay_amount = True
            # Do not downscale trusted sales-order line amounts with stale movement rows.
            # Old movement rows may carry a 100x-smaller amount from pre-normalization data.
        next_pay_amount = inferred_total if should_override_pay_amount else line_pay_amount
        should_override_deal_price = False
        if inferred_unit > 0:
            if line_deal_price <= 0:
                should_override_deal_price = True
            elif line_count_by_order.get(order_id, 0) == 1 and abs((line_deal_price * quantity) - inferred_total) > 0.01:
                should_override_deal_price = True
        next_deal_price = inferred_unit if should_override_deal_price else line_deal_price
        next_quantity = quantity if quantity > 0 else current_quantity
        next_serial_number = merged_serials[0] if merged_serials else ""
        if (
            next_quantity == int(row["quantity"] or 0)
            and
            next_pay_amount == row["pay_amount"]
            and next_deal_price == row["deal_price"]
            and next_serial_number == str(row["serial_number"] or "")
            and json.dumps(merged_serials, ensure_ascii=False) == str(row["serial_numbers_json"] or "[]")
        ):
            continue
        conn.execute(
            """
            UPDATE sales_order_line
            SET quantity = ?,
                deal_price = ?,
                pay_amount = ?,
                serial_number = ?,
                serial_numbers_json = ?
            WHERE id = ?
            """,
            (
                next_quantity,
                next_deal_price,
                next_pay_amount,
                next_serial_number,
                json.dumps(merged_serials, ensure_ascii=False),
                row["id"],
            ),
        )
        updated += 1
    return updated


def normalize_sales_outbound_movement_amounts_from_sales_lines(conn: sqlite3.Connection, timestamp: str) -> int:
    line_rows = conn.execute(
        """
        SELECT order_id, sku_key, quantity, COALESCE(pay_amount, deal_price, 0) AS line_amount
        FROM sales_order_line
        """
    ).fetchall()
    per_unit_amount_by_order_sku: dict[tuple[str, str], float] = {}
    for row in line_rows:
        order_id = str(row["order_id"] or "").strip()
        sku_key = str(row["sku_key"] or "").strip()
        quantity = abs(int(row["quantity"] or 0)) or 1
        line_amount = float(row["line_amount"] or 0)
        if not order_id or not sku_key or line_amount <= 0:
            continue
        per_unit_amount_by_order_sku[(order_id, sku_key)] = round(line_amount / quantity, 2)

    updated = 0
    movement_rows = conn.execute(
        """
        SELECT id, source_ref, sku_key, quantity, amount, unit_cost
        FROM inventory_movement
        WHERE movement_type = 'sales_outbound'
        """
    ).fetchall()
    for row in movement_rows:
        order_id = extract_canonical_sales_order_no(row["source_ref"])
        sku_key = str(row["sku_key"] or "").strip()
        if not order_id or not sku_key:
            continue
        per_unit_amount = per_unit_amount_by_order_sku.get((order_id, sku_key))
        if not per_unit_amount or per_unit_amount <= 0:
            continue
        quantity = abs(int(row["quantity"] or 0)) or 1
        target_amount = round(per_unit_amount * quantity, 2)
        current_amount = float(row["amount"] or 0)
        current_unit_cost = float(row["unit_cost"] or 0) if "unit_cost" in row.keys() else 0.0
        if (
            current_amount > 0
            and abs(current_amount - target_amount) < 0.01
            and current_unit_cost > 0
            and abs(current_unit_cost - per_unit_amount) < 0.01
        ):
            continue
        conn.execute(
            """
            UPDATE inventory_movement
            SET amount = ?,
                unit_cost = ?,
                created_at = ?
            WHERE id = ?
            """,
            (target_amount, per_unit_amount, timestamp, row["id"]),
        )
        updated += 1
    return updated


def normalize_purchase_inbound_movement_identity(conn: sqlite3.Connection, timestamp: str) -> int:
    rows = conn.execute(
        """
        SELECT id, source_ref, inbound_document_no, source_document_type
        FROM inventory_movement
        WHERE movement_type = 'purchase_inbound'
        """
    ).fetchall()
    updated = 0
    for row in rows:
        canonical_purchase_no = extract_canonical_purchase_order_no(
            row["source_ref"],
            row["inbound_document_no"],
            row["id"],
        )
        if not canonical_purchase_no:
            continue
        current_source_ref = str(row["source_ref"] or "").strip()
        current_inbound_no = str(row["inbound_document_no"] or "").strip()
        current_source_type = str(row["source_document_type"] or "").strip()
        if (
            current_source_ref == canonical_purchase_no
            and current_inbound_no == canonical_purchase_no
            and current_source_type == "采购入库"
        ):
            continue
        conn.execute(
            """
            UPDATE inventory_movement
            SET source_ref = ?,
                inbound_document_no = ?,
                source_document_type = '采购入库',
                operate_type_name = CASE WHEN TRIM(COALESCE(operate_type_name, '')) = '' THEN '采购入库' ELSE operate_type_name END,
                service_type_name = CASE WHEN TRIM(COALESCE(service_type_name, '')) = '' THEN '采购入库' ELSE service_type_name END,
                created_at = ?
            WHERE id = ?
            """,
            (canonical_purchase_no, canonical_purchase_no, timestamp, row["id"]),
        )
        updated += 1
    return updated


def _is_non_normal_purchase_inbound_source_ref(value: str) -> bool:
    normalized = str(value or "").strip().upper()
    if not normalized:
        return False
    if normalized.startswith("PURCHASEQ-"):
        return True
    if normalized.startswith("TDR"):
        return True
    if re.fullmatch(r"T\d+", normalized):
        return True
    return False


def _is_non_normal_purchase_inbound_row(
    movement_type: str,
    source_ref: str,
    note: str,
) -> bool:
    if str(movement_type or "").strip() != "purchase_inbound":
        return False
    note_text = str(note or "")
    if _is_non_normal_purchase_inbound_source_ref(source_ref):
        return True
    if "openclaw.full_db.purchase_inbound" in note_text:
        return True
    if "重复占位采购行" in note_text:
        return True
    if "库存流水导出导入" in note_text:
        return True
    return False


def enrich_sales_orders_from_openclaw_sql(conn: sqlite3.Connection, timestamp: str) -> int:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return 0
    try:
        import psycopg  # type: ignore
    except Exception:
        return 0

    pending_rows = conn.execute(
        """
        SELECT id
        FROM sales_order
        WHERE COALESCE(total_amount, 0) <= 0
        """
    ).fetchall()
    if not pending_rows:
        return 0

    local_to_order_no: dict[str, str] = {}
    for row in pending_rows:
        local_id = str(row["id"] or "").strip()
        if not local_id:
            continue
        matched = re.search(r"(XS\d{14,})", local_id)
        local_to_order_no[local_id] = matched.group(1) if matched else local_id
    order_nos = sorted({value for value in local_to_order_no.values() if value})
    if not order_nos:
        return 0

    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT order_no, pay_amount, total_amount, pay_time, order_id, outer_order_no, buyer_phone, buyer_nick
                    FROM fact_orders
                    WHERE order_no = ANY(%s)
                    """,
                    (order_nos,),
                )
                pg_orders = {
                    str(row[0] or ""): row
                    for row in cur.fetchall()
                    if row and str(row[0] or "").strip()
                }
                cur.execute(
                    """
                    SELECT o.order_no, i.sku_no, i.product_no, i.product_name, i.spec, i.mtm_code,
                           i.unit_price, i.pay_amount, i.serial_number
                    FROM fact_orders AS o
                    JOIN fact_order_items AS i ON i.order_id = o.order_id
                    WHERE o.order_no = ANY(%s)
                    """,
                    (order_nos,),
                )
                pg_line_rows = cur.fetchall()
    except Exception:
        return 0

    pg_lines_by_order: dict[str, list[Any]] = {}
    for row in pg_line_rows:
        order_no = str(row[0] or "").strip()
        if not order_no:
            continue
        pg_lines_by_order.setdefault(order_no, []).append(row)

    updated_orders = 0
    for local_id, order_no in local_to_order_no.items():
        record = pg_orders.get(order_no)
        if not record:
            continue
        pay_amount = normalize_openclaw_currency_amount(record[1])
        total_amount = normalize_openclaw_currency_amount(record[2])
        pay_time = str(record[3] or "").strip()
        external_order_no = str(record[4] or "").strip()
        outer_order_no = str(record[5] or "").strip()
        buyer_phone = str(record[6] or "").strip()
        buyer_nick = str(record[7] or "").strip()
        customer_name = buyer_nick or buyer_phone
        amount = pay_amount if pay_amount > 0 else total_amount
        if amount <= 0:
            continue
        conn.execute(
            """
            UPDATE sales_order
            SET total_amount = ?,
                pay_amount = ?,
                pay_time = CASE WHEN TRIM(COALESCE(pay_time, '')) = '' THEN ? ELSE pay_time END,
                external_order_no = CASE WHEN TRIM(COALESCE(external_order_no, '')) = '' THEN ? ELSE external_order_no END,
                customer_name = CASE WHEN TRIM(COALESCE(customer_name, '')) = '' THEN ? ELSE customer_name END,
                created_at = ?
            WHERE id = ?
            """,
            (amount, amount, pay_time, outer_order_no or external_order_no, customer_name, timestamp, local_id),
        )
        updated_orders += 1
        if customer_name:
            customer_id = normalize_lookup_key(buyer_phone) or normalize_lookup_key(customer_name) or normalize_lookup_key(order_no)
            conn.execute(
                """
                INSERT INTO customer (id, name, phone, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = CASE WHEN TRIM(COALESCE(excluded.name, '')) <> '' THEN excluded.name ELSE customer.name END,
                  phone = CASE WHEN TRIM(COALESCE(excluded.phone, '')) <> '' THEN excluded.phone ELSE customer.phone END,
                  created_at = excluded.created_at
                """,
                (f"CUS-{customer_id}", customer_name, buyer_phone, timestamp),
            )

        local_lines = conn.execute(
            """
            SELECT id, sku_key, serial_number
            FROM sales_order_line
            WHERE order_id = ?
            """,
            (local_id,),
        ).fetchall()
        remote_lines = pg_lines_by_order.get(order_no, [])
        for local_line in local_lines:
            line_id = str(local_line["id"] or "")
            local_sku = str(local_line["sku_key"] or "").strip()
            local_serial = str(local_line["serial_number"] or "").strip().upper()
            matched_line = None
            for remote in remote_lines:
                remote_sku = str(remote[1] or "").strip()
                remote_serial = str(remote[8] or "").strip().upper()
                if local_serial and remote_serial and local_serial == remote_serial:
                    matched_line = remote
                    break
                if local_sku and remote_sku and local_sku == remote_sku:
                    matched_line = remote
            if not matched_line:
                continue
            unit_price = normalize_openclaw_currency_amount(matched_line[6])
            line_pay_amount = normalize_openclaw_currency_amount(matched_line[7])
            conn.execute(
                """
                UPDATE sales_order_line
                SET deal_price = CASE WHEN COALESCE(deal_price, 0) <= 0 AND ? > 0 THEN ? ELSE deal_price END,
                    pay_amount = CASE WHEN COALESCE(pay_amount, 0) <= 0 AND ? > 0 THEN ? ELSE pay_amount END,
                    product_name = CASE WHEN TRIM(COALESCE(product_name, '')) = '' AND TRIM(COALESCE(?, '')) <> '' THEN ? ELSE product_name END,
                    product_no = CASE WHEN TRIM(COALESCE(product_no, '')) = '' AND TRIM(COALESCE(?, '')) <> '' THEN ? ELSE product_no END,
                    spec = CASE WHEN TRIM(COALESCE(spec, '')) = '' AND TRIM(COALESCE(?, '')) <> '' THEN ? ELSE spec END,
                    mtm_code = CASE WHEN TRIM(COALESCE(mtm_code, '')) = '' AND TRIM(COALESCE(?, '')) <> '' THEN ? ELSE mtm_code END
                WHERE id = ?
                """,
                (
                    unit_price,
                    unit_price,
                    line_pay_amount,
                    line_pay_amount,
                    str(matched_line[3] or ""),
                    str(matched_line[3] or ""),
                    str(matched_line[2] or ""),
                    str(matched_line[2] or ""),
                    str(matched_line[4] or ""),
                    str(matched_line[4] or ""),
                    str(matched_line[5] or ""),
                    str(matched_line[5] or ""),
                    line_id,
                ),
            )
    return updated_orders


def enrich_inventory_movement_suppliers_from_openclaw_sql(conn: sqlite3.Connection, timestamp: str) -> int:
    database_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "postgresql://zdt:zdt@localhost:5432/zdt_sync").strip()
    if not database_url:
        return 0
    try:
        import psycopg  # type: ignore
    except Exception:
        return 0

    movement_rows = conn.execute(
        """
        SELECT id, source_ref, sku_key, supplier_name
        FROM inventory_movement
        WHERE movement_type IN ('sales_outbound', 'transfer_outbound', 'purchase_inbound', 'transfer_inbound')
        """
    ).fetchall()
    if not movement_rows:
        return 0

    order_nos = sorted({
        str(row["source_ref"] or "").strip()
        for row in movement_rows
        if str(row["source_ref"] or "").strip()
    })
    if not order_nos:
        return 0

    try:
        with psycopg.connect(database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT service_no, sku_no, supplier_name
                    FROM fact_stock_orders
                    WHERE service_no = ANY(%s)
                      AND COALESCE(TRIM(supplier_name), '') <> ''
                    """,
                    (order_nos,),
                )
                supplier_rows = cur.fetchall()
    except Exception:
        return 0

    supplier_by_order_sku: dict[tuple[str, str], str] = {}
    supplier_by_order: dict[str, str] = {}
    for service_no, sku_no, supplier_name in supplier_rows:
        order_no = str(service_no or "").strip()
        sku = str(sku_no or "").strip()
        supplier = str(supplier_name or "").strip()
        if not order_no or not supplier:
            continue
        supplier_by_order[order_no] = supplier_by_order.get(order_no) or supplier
        if sku:
            supplier_by_order_sku[(order_no, sku)] = supplier

    updated = 0
    for row in movement_rows:
        movement_id = str(row["id"] or "").strip()
        order_no = str(row["source_ref"] or "").strip()
        sku_key = str(row["sku_key"] or "").strip()
        current_supplier = str(row["supplier_name"] or "").strip()
        if not movement_id or not order_no:
            continue
        supplier = supplier_by_order_sku.get((order_no, sku_key)) or supplier_by_order.get(order_no, "")
        if not supplier:
            continue
        if current_supplier == supplier:
            continue
        conn.execute(
            """
            UPDATE inventory_movement
            SET supplier_name = ?,
                created_at = ?
            WHERE id = ?
            """,
            (supplier, timestamp, movement_id),
        )
        updated += 1
    return updated


def enrich_sales_order_line_suppliers_from_movements(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        """
        SELECT line.id AS line_id, line.order_id, line.sku_key, line.supplier_name,
               line.serial_number, line.serial_numbers_json,
               COALESCE(
                 (
                   SELECT movement.supplier_name
                   FROM inventory_movement AS movement
                   WHERE movement.source_ref = line.order_id
                     AND movement.sku_key = line.sku_key
                     AND TRIM(COALESCE(movement.supplier_name, '')) <> ''
                   ORDER BY movement.business_date DESC, movement.created_at DESC
                   LIMIT 1
                 ),
                 (
                   SELECT movement.supplier_name
                   FROM inventory_movement AS movement
                   WHERE movement.source_ref = line.order_id
                     AND TRIM(COALESCE(movement.supplier_name, '')) <> ''
                   ORDER BY movement.business_date DESC, movement.created_at DESC
                   LIMIT 1
                 ),
                 ''
               ) AS movement_supplier
        FROM sales_order_line AS line
        """
    ).fetchall()
    updated = 0
    for row in rows:
        line_id = str(row["line_id"] or "").strip()
        current_supplier = str(row["supplier_name"] or "").strip()
        movement_supplier = str(row["movement_supplier"] or "").strip()
        serial_supplier = ""
        serial_candidates: list[str] = []
        serial_number = str(row["serial_number"] or "").strip()
        if serial_number:
            serial_candidates.append(serial_number)
        try:
            parsed_serials = json.loads(str(row["serial_numbers_json"] or "[]"))
            if isinstance(parsed_serials, list):
                serial_candidates.extend([str(item).strip() for item in parsed_serials if str(item).strip()])
        except json.JSONDecodeError:
            pass
        for serial in serial_candidates:
            serial_row = conn.execute(
                """
                SELECT supplier_name
                FROM serial_item
                WHERE serial_number = ?
                  AND TRIM(COALESCE(supplier_name, '')) <> ''
                LIMIT 1
                """,
                (serial,),
            ).fetchone()
            if serial_row:
                serial_supplier = str(serial_row["supplier_name"] or "").strip()
                if serial_supplier:
                    break
        supplier = serial_supplier or movement_supplier
        if not line_id or not supplier or supplier == current_supplier:
            continue
        conn.execute(
            "UPDATE sales_order_line SET supplier_name = ? WHERE id = ?",
            (supplier, line_id),
        )
        updated += 1
    return updated


def sync_distributor_quotes(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str | None = None,
) -> int:
    distributor_quotes = _load_json_payload(data_dir, "latest-distributor-quotes.json")
    quotes = distributor_quotes.get("quotes", [])
    if not isinstance(quotes, list):
        return 0
    now = timestamp or now_iso()
    conn.execute("DELETE FROM distributor_quote_current")
    synced = 0
    for index, quote in enumerate(quotes):
        if not isinstance(quote, dict):
            continue
        pn_mtm = str(quote.get("pnMtm") or "").strip()
        product_name = str(quote.get("productName") or "").strip()
        sku_key = str(
            quote.get("skuKey")
            or ((quote.get("libraryMatch") or {}).get("primarySkuKey") if isinstance(quote.get("libraryMatch"), dict) else "")
            or ""
        ).strip()
        pickup_price = quote.get("pickupPrice")
        if pickup_price in (None, "", 0) and not (pn_mtm or sku_key or product_name):
            continue
        match_method = ""
        match_confidence = None
        match_evidence = ""
        library_match = quote.get("libraryMatch")
        if isinstance(library_match, dict):
            match_method = str(library_match.get("status") or "").strip()
            try:
                match_confidence = float(library_match.get("confidence")) if library_match.get("confidence") not in (None, "") else None
            except (TypeError, ValueError):
                match_confidence = None
            match_evidence = str(library_match.get("evidence") or "").strip()
        quote_id_basis = f"{index}|{sku_key}|{pn_mtm}|{product_name}|{quote.get('quoteDate') or ''}|{quote.get('sourceFile') or ''}|{quote.get('pickupPrice') or ''}|{quote.get('subsidyPrice') or ''}"
        quote_id = "dq-" + hashlib.sha1(quote_id_basis.encode("utf-8")).hexdigest()[:20]
        conn.execute(
            """
            INSERT INTO distributor_quote_current
            (id, sku_key, pn_mtm, product_name, pickup_price, subsidy_price,
             education_subsidy, quote_date, quote_file, source_file,
             match_fingerprint, match_method, match_confidence, match_evidence, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                quote_id,
                sku_key,
                pn_mtm,
                product_name,
                pickup_price,
                quote.get("subsidyPrice"),
                quote.get("educationSubsidy"),
                str(quote.get("quoteDate") or ""),
                str(distributor_quotes.get("quoteFile") or ""),
                str(quote.get("sourceFile") or ""),
                str(quote.get("matchFingerprint") or ""),
                match_method,
                match_confidence,
                match_evidence,
                now,
            ),
        )
        synced += 1
    return synced


def list_distributor_quotes(limit: int = 400) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, pn_mtm, product_name, pickup_price, subsidy_price,
                       education_subsidy, quote_date, quote_file, source_file,
                       match_fingerprint, match_method, match_confidence, match_evidence, updated_at
                FROM distributor_quote_current
                ORDER BY quote_date DESC, sku_key, pn_mtm, product_name
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
    quote_dates = sorted({str(row["quote_date"] or "") for row in rows if str(row["quote_date"] or "").strip()}, reverse=True)
    return {
        "generatedAt": now_iso(),
        "source": "retail_core.distributor_quote_current",
        "quoteDate": quote_dates[0] if quote_dates else "",
        "quoteCount": len(rows),
        "quotes": rows,
        "summary": {
            "skuMatchedCount": sum(1 for row in rows if str(row.get("sku_key") or "").strip()),
            "pnMatchedCount": sum(1 for row in rows if str(row.get("pn_mtm") or "").strip()),
            "latestQuoteDate": quote_dates[0] if quote_dates else "",
        },
    }


def sync_gray_wholesale_quotes(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str | None = None,
) -> int:
    gray_snapshot = _load_json_payload(data_dir, "latest-gray-wholesale-quotes.json")
    quotes = gray_snapshot.get("quotes", [])
    if not isinstance(quotes, list):
        return 0
    now = timestamp or now_iso()
    conn.execute("DELETE FROM gray_wholesale_quote_current")
    synced = 0
    for index, quote in enumerate(quotes):
        if not isinstance(quote, dict):
            continue
        product_text = str(quote.get("productText") or "").strip()
        if not product_text:
            continue
        quote_id_basis = f"{index}|{quote.get('quoteDate') or ''}|{product_text}|{quote.get('marketWholesalePrice') or ''}|{quote.get('maskedPriceText') or ''}|{quote.get('capturedAt') or ''}"
        quote_id = "gq-" + hashlib.sha1(quote_id_basis.encode("utf-8")).hexdigest()[:20]
        conn.execute(
            """
            INSERT INTO gray_wholesale_quote_current
            (id, account_name, entry_point, quote_date, captured_at, product_text,
             market_wholesale_price, masked_price_text, tax_included, service_included,
             match_fingerprint, evidence_text, source_file, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                quote_id,
                str(quote.get("accountName") or gray_snapshot.get("accountName") or ""),
                str(quote.get("entryPoint") or gray_snapshot.get("entryPoint") or ""),
                str(quote.get("quoteDate") or ""),
                str(quote.get("capturedAt") or ""),
                product_text,
                quote.get("marketWholesalePrice"),
                str(quote.get("maskedPriceText") or ""),
                1 if quote.get("taxIncluded") else 0,
                1 if quote.get("serviceIncluded") else 0,
                str(quote.get("matchFingerprint") or ""),
                str(quote.get("evidenceText") or ""),
                str(gray_snapshot.get("sourceFile") or ""),
                now,
            ),
        )
        synced += 1
    return synced


def list_gray_wholesale_quotes(limit: int = 1200) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, account_name, entry_point, quote_date, captured_at, product_text,
                       market_wholesale_price, masked_price_text, tax_included, service_included,
                       match_fingerprint, evidence_text, source_file, updated_at
                FROM gray_wholesale_quote_current
                ORDER BY quote_date DESC, captured_at DESC, product_text
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
    quote_dates = sorted({str(row["quote_date"] or "") for row in rows if str(row["quote_date"] or "").strip()}, reverse=True)
    account_name = next((str(row.get("account_name") or "") for row in rows if str(row.get("account_name") or "").strip()), "")
    entry_point = next((str(row.get("entry_point") or "") for row in rows if str(row.get("entry_point") or "").strip()), "")
    source_file = next((str(row.get("source_file") or "") for row in rows if str(row.get("source_file") or "").strip()), "")
    items = [
        {
            "source": "wechat-official-account",
            "accountName": str(row.get("account_name") or ""),
            "entryPoint": str(row.get("entry_point") or ""),
            "quoteDate": str(row.get("quote_date") or ""),
            "capturedAt": str(row.get("captured_at") or ""),
            "productText": str(row.get("product_text") or ""),
            "marketWholesalePrice": row.get("market_wholesale_price"),
            "maskedPriceText": str(row.get("masked_price_text") or "") or None,
            "taxIncluded": bool(row.get("tax_included")),
            "serviceIncluded": bool(row.get("service_included")),
            "matchFingerprint": str(row.get("match_fingerprint") or ""),
            "evidenceText": str(row.get("evidence_text") or "") or None,
        }
        for row in rows
    ]
    return {
        "generatedAt": now_iso(),
        "accountName": account_name,
        "entryPoint": entry_point,
        "quoteDate": quote_dates[0] if quote_dates else "",
        "isCarriedForward": False,
        "carryForwardFrom": quote_dates[-1] if len(quote_dates) > 1 else "",
        "sourceFile": source_file,
        "quoteCount": len(items),
        "quotes": items,
    }


def sync_inventory_price_signals(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str | None = None,
) -> int:
    retail_zone = _load_json_payload(data_dir, "latest-retail-zone-snapshot.json")
    decisions = (((retail_zone.get("decisions") or {}) if isinstance(retail_zone, dict) else {}).get("items") or [])
    if not isinstance(decisions, list):
        return 0

    now = timestamp or now_iso()
    source_generated_at = str(retail_zone.get("generatedAt") or "")
    conn.execute("DELETE FROM inventory_price_signal_current")
    synced = 0

    for item in decisions:
        if not isinstance(item, dict):
            continue
        sku_key = str(item.get("skuKey") or "").strip()
        if not sku_key:
            continue
        pn_mtm = str(item.get("pnMtm") or "").strip()
        product_name = str(item.get("productName") or "").strip()
        match = item.get("match") if isinstance(item.get("match"), dict) else {}
        realtime_match = match.get("realtimePurchasePrice") if isinstance(match.get("realtimePurchasePrice"), dict) else {}
        gray_match = match.get("grayWholesalePrice") if isinstance(match.get("grayWholesalePrice"), dict) else {}
        price_sources = item.get("priceSources") if isinstance(item.get("priceSources"), list) else []
        distributor_quote_date = ""
        gray_quote_date = ""
        for source in price_sources:
            if not isinstance(source, dict):
                continue
            source_name = str(source.get("source") or "").strip()
            if source_name == "实时进货价" and not distributor_quote_date:
              distributor_quote_date = str(source.get("publishedAt") or "")
            if source_name == "灰渠批发价" and not gray_quote_date:
              gray_quote_date = str(source.get("publishedAt") or "")
        conn.execute(
            """
            INSERT INTO inventory_price_signal_current
            (sku_key, pn_mtm, product_name, inventory_average_cost, realtime_purchase_price,
             gray_wholesale_price, distributor_quote_date, gray_quote_date,
             realtime_match_method, realtime_match_confidence, realtime_match_evidence,
             gray_match_method, gray_match_confidence, gray_match_evidence,
             source_generated_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sku_key,
                pn_mtm,
                product_name,
                item.get("inventoryAverageCost"),
                item.get("realtimePurchasePrice"),
                item.get("grayWholesalePrice"),
                distributor_quote_date,
                gray_quote_date,
                str(realtime_match.get("method") or ""),
                realtime_match.get("confidence"),
                str(realtime_match.get("evidence") or ""),
                str(gray_match.get("method") or ""),
                gray_match.get("confidence"),
                str(gray_match.get("evidence") or ""),
                source_generated_at,
                now,
            ),
        )
        synced += 1
    return synced


def list_inventory_price_signals(limit: int = 4000) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT sku_key, pn_mtm, product_name, inventory_average_cost,
                       realtime_purchase_price, gray_wholesale_price,
                       distributor_quote_date, gray_quote_date,
                       realtime_match_method, realtime_match_confidence, realtime_match_evidence,
                       gray_match_method, gray_match_confidence, gray_match_evidence,
                       source_generated_at, updated_at
                FROM inventory_price_signal_current
                ORDER BY sku_key
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
    items = [
        {
            "skuKey": str(row.get("sku_key") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "productName": str(row.get("product_name") or ""),
            "inventoryAverageCost": row.get("inventory_average_cost"),
            "realtimePurchasePrice": row.get("realtime_purchase_price"),
            "grayWholesalePrice": row.get("gray_wholesale_price"),
            "distributorQuoteDate": str(row.get("distributor_quote_date") or ""),
            "grayQuoteDate": str(row.get("gray_quote_date") or ""),
            "realtimeMatchMethod": str(row.get("realtime_match_method") or ""),
            "realtimeMatchConfidence": row.get("realtime_match_confidence"),
            "realtimeMatchEvidence": str(row.get("realtime_match_evidence") or ""),
            "grayMatchMethod": str(row.get("gray_match_method") or ""),
            "grayMatchConfidence": row.get("gray_match_confidence"),
            "grayMatchEvidence": str(row.get("gray_match_evidence") or ""),
            "sourceGeneratedAt": str(row.get("source_generated_at") or ""),
            "updatedAt": str(row.get("updated_at") or ""),
        }
        for row in rows
    ]
    latest_generated_at = max((item["sourceGeneratedAt"] for item in items if item["sourceGeneratedAt"]), default="")
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.inventory_price_signal_current",
        "sourceGeneratedAt": latest_generated_at,
        "itemCount": len(items),
        "items": items,
    }


def list_store_manual_promotions() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, product_name, pn_mtm, category, mode, value,
                       valid_from, valid_to, note, enabled, updated_at
                FROM store_manual_promotion
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
        ]
    items = [
        {
            "id": str(row.get("id") or ""),
            "skuKey": str(row.get("sku_key") or ""),
            "productName": str(row.get("product_name") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "category": str(row.get("category") or ""),
            "mode": str(row.get("mode") or "minus_amount"),
            "value": row.get("value"),
            "validFrom": str(row.get("valid_from") or ""),
            "validTo": str(row.get("valid_to") or ""),
            "note": str(row.get("note") or ""),
            "enabled": bool(row.get("enabled")),
            "updatedAt": str(row.get("updated_at") or ""),
        }
        for row in rows
    ]
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.store_manual_promotion",
        "itemCount": len(items),
        "items": items,
    }


def save_store_manual_promotions(items: list[dict[str, Any]]) -> dict[str, Any]:
    init_db()
    now = now_iso()
    cleaned: list[dict[str, Any]] = []
    for raw in items:
        sku_key = str(raw.get("skuKey") or "").strip()
        if not sku_key:
            continue
        mode = str(raw.get("mode") or "minus_amount").strip()
        if mode not in {"minus_amount", "fixed_price"}:
            mode = "minus_amount"
        try:
            value = float(raw.get("value"))
        except (TypeError, ValueError):
            continue
        if value < 0:
            continue
        valid_from = str(raw.get("validFrom") or "").strip()
        valid_to = str(raw.get("validTo") or "").strip()
        if not valid_from or not valid_to:
            continue
        cleaned.append(
            {
                "id": str(raw.get("id") or f"smp-{hashlib.sha1(f'{sku_key}|{mode}|{value}|{valid_from}|{valid_to}|{now}'.encode('utf-8')).hexdigest()[:16]}"),
                "skuKey": sku_key,
                "productName": str(raw.get("productName") or "").strip(),
                "pnMtm": str(raw.get("pnMtm") or "").strip(),
                "category": str(raw.get("category") or "").strip(),
                "mode": mode,
                "value": value,
                "validFrom": valid_from,
                "validTo": valid_to,
                "note": str(raw.get("note") or "").strip(),
                "enabled": bool(raw.get("enabled", True)),
                "updatedAt": str(raw.get("updatedAt") or now),
            }
        )

    with connect() as conn:
        conn.execute("DELETE FROM store_manual_promotion")
        for item in cleaned:
            conn.execute(
                """
                INSERT INTO store_manual_promotion
                (id, sku_key, product_name, pn_mtm, category, mode, value,
                 valid_from, valid_to, note, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["skuKey"],
                    item["productName"],
                    item["pnMtm"],
                    item["category"],
                    item["mode"],
                    item["value"],
                    item["validFrom"],
                    item["validTo"],
                    item["note"],
                    1 if item["enabled"] else 0,
                    item["updatedAt"],
                ),
            )
        conn.commit()
    return list_store_manual_promotions()


def list_manufacturer_manual_promotions() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, source_key, outbound_date, order_number, outbound_document_number,
                       sku_key, product_name, pn_mtm, spec, category,
                       boost_amount, education_amount, valid_from, valid_to,
                       marketing_po_enabled, education_enabled,
                       source_activity_ids, source_labels,
                       note, enabled, created_at, updated_at
                FROM manufacturer_manual_promotion
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
        ]
    items = [
        {
            "id": str(row.get("id") or ""),
            "sourceKey": str(row.get("source_key") or ""),
            "outboundDate": str(row.get("outbound_date") or ""),
            "orderNumber": str(row.get("order_number") or ""),
            "outboundDocumentNumber": str(row.get("outbound_document_number") or ""),
            "skuKey": str(row.get("sku_key") or ""),
            "productName": str(row.get("product_name") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "spec": str(row.get("spec") or ""),
            "category": str(row.get("category") or ""),
            "boostAmount": row.get("boost_amount"),
            "educationAmount": row.get("education_amount"),
            "validFrom": str(row.get("valid_from") or ""),
            "validTo": str(row.get("valid_to") or ""),
            "marketingPoEnabled": bool(row.get("marketing_po_enabled")),
            "educationEnabled": bool(row.get("education_enabled")),
            "sourceActivityIds": [item for item in str(row.get("source_activity_ids") or "").split(",") if item],
            "sourceLabels": [item for item in str(row.get("source_labels") or "").split(" / ") if item],
            "note": str(row.get("note") or ""),
            "enabled": bool(row.get("enabled")),
            "createdAt": str(row.get("created_at") or ""),
            "updatedAt": str(row.get("updated_at") or ""),
        }
        for row in rows
    ]
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.manufacturer_manual_promotion",
        "itemCount": len(items),
        "items": items,
    }


def save_manufacturer_manual_promotions(items: list[dict[str, Any]]) -> dict[str, Any]:
    init_db()
    now = now_iso()
    cleaned: list[dict[str, Any]] = []
    for raw in items:
        source_key = str(raw.get("sourceKey") or "").strip()
        outbound_date = str(raw.get("outboundDate") or "").strip()
        sku_key = str(raw.get("skuKey") or "").strip()
        product_name = str(raw.get("productName") or "").strip()
        if not source_key or not outbound_date or not sku_key or not product_name:
            continue
        try:
            boost_amount = float(raw.get("boostAmount") or 0)
            education_amount = float(raw.get("educationAmount") or 0)
        except (TypeError, ValueError):
            continue
        if boost_amount < 0 or education_amount < 0:
            continue
        valid_from = str(raw.get("validFrom") or "").strip()
        valid_to = str(raw.get("validTo") or "").strip()
        created_at = str(raw.get("createdAt") or now)
        updated_at = str(raw.get("updatedAt") or now)
        marketing_po_enabled = bool(raw.get("marketingPoEnabled", boost_amount > 0))
        education_enabled = bool(raw.get("educationEnabled", education_amount > 0))
        source_activity_ids = raw.get("sourceActivityIds") if isinstance(raw.get("sourceActivityIds"), list) else []
        source_labels = raw.get("sourceLabels") if isinstance(raw.get("sourceLabels"), list) else []
        cleaned.append(
            {
                "id": str(raw.get("id") or f"mmp-{hashlib.sha1(f'{source_key}|{sku_key}|{outbound_date}|{boost_amount}|{education_amount}|{now}'.encode('utf-8')).hexdigest()[:16]}"),
                "sourceKey": source_key,
                "outboundDate": outbound_date,
                "orderNumber": str(raw.get("orderNumber") or "").strip(),
                "outboundDocumentNumber": str(raw.get("outboundDocumentNumber") or "").strip(),
                "skuKey": sku_key,
                "productName": product_name,
                "pnMtm": str(raw.get("pnMtm") or "").strip(),
                "spec": str(raw.get("spec") or "").strip(),
                "category": str(raw.get("category") or "").strip(),
                "boostAmount": boost_amount,
                "educationAmount": education_amount,
                "validFrom": valid_from,
                "validTo": valid_to,
                "marketingPoEnabled": marketing_po_enabled,
                "educationEnabled": education_enabled,
                "sourceActivityIds": [str(item).strip() for item in source_activity_ids if str(item).strip()],
                "sourceLabels": [str(item).strip() for item in source_labels if str(item).strip()],
                "note": str(raw.get("note") or "").strip(),
                "enabled": bool(raw.get("enabled", True)),
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

    with connect() as conn:
        conn.execute("DELETE FROM manufacturer_manual_promotion")
        for item in cleaned:
            conn.execute(
                """
                INSERT INTO manufacturer_manual_promotion
                (id, source_key, outbound_date, order_number, outbound_document_number,
                 sku_key, product_name, pn_mtm, spec, category,
                 boost_amount, education_amount, valid_from, valid_to,
                 marketing_po_enabled, education_enabled, source_activity_ids, source_labels,
                 note, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["sourceKey"],
                    item["outboundDate"],
                    item["orderNumber"],
                    item["outboundDocumentNumber"],
                    item["skuKey"],
                    item["productName"],
                    item["pnMtm"],
                    item["spec"],
                    item["category"],
                    item["boostAmount"],
                    item["educationAmount"],
                    item["validFrom"],
                    item["validTo"],
                    1 if item["marketingPoEnabled"] else 0,
                    1 if item["educationEnabled"] else 0,
                    ",".join(item["sourceActivityIds"]),
                    " / ".join(item["sourceLabels"]),
                    item["note"],
                    1 if item["enabled"] else 0,
                    item["createdAt"],
                    item["updatedAt"],
                ),
            )
        conn.commit()
    return list_manufacturer_manual_promotions()


def list_cross_outbound_check_rules() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, match_mode, source_key, source_label, sku_key, pn_mtm,
                       product_name, spec, category, counterparty, settlement_mode,
                       calculation_basis, settlement_price, per_unit_amount, valid_from, valid_to,
                       note, enabled, created_at, updated_at
                FROM cross_outbound_check_rule
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
        ]
    items = [
        {
            "id": str(row.get("id") or ""),
            "matchMode": str(row.get("match_mode") or "sku"),
            "sourceKey": str(row.get("source_key") or ""),
            "sourceLabel": str(row.get("source_label") or ""),
            "skuKey": str(row.get("sku_key") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "productName": str(row.get("product_name") or ""),
            "spec": str(row.get("spec") or ""),
            "category": str(row.get("category") or ""),
            "counterparty": str(row.get("counterparty") or "联想"),
            "settlementMode": str(row.get("settlement_mode") or "priceDiff"),
            "calculationBasis": str(row.get("calculation_basis") or "purchaseCost"),
            "settlementPrice": row.get("settlement_price"),
            "perUnitAmount": row.get("per_unit_amount"),
            "validFrom": str(row.get("valid_from") or ""),
            "validTo": str(row.get("valid_to") or ""),
            "note": str(row.get("note") or ""),
            "enabled": bool(row.get("enabled")),
            "createdAt": str(row.get("created_at") or ""),
            "updatedAt": str(row.get("updated_at") or ""),
        }
        for row in rows
    ]
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.cross_outbound_check_rule",
        "itemCount": len(items),
        "items": items,
    }


def save_cross_outbound_check_rules(items: list[dict[str, Any]]) -> dict[str, Any]:
    init_db()
    now = now_iso()
    cleaned: list[dict[str, Any]] = []
    for raw in items:
        source_key = str(raw.get("sourceKey") or "").strip()
        if not source_key:
            continue
        match_mode = str(raw.get("matchMode") or "sku").strip()
        if match_mode not in {"sku", "mtm"}:
            match_mode = "sku"
        settlement_mode = str(raw.get("settlementMode") or "priceDiff").strip()
        if settlement_mode not in {"priceDiff", "perUnitAmount"}:
            settlement_mode = "priceDiff"
        calculation_basis = str(raw.get("calculationBasis") or "purchaseCost").strip()
        if calculation_basis not in {"salesPrice", "purchaseCost"}:
            calculation_basis = "purchaseCost"
        valid_from = str(raw.get("validFrom") or "").strip()
        valid_to = str(raw.get("validTo") or "").strip()
        if not valid_from or not valid_to:
            continue
        settlement_price = raw.get("settlementPrice")
        per_unit_amount = raw.get("perUnitAmount")
        try:
            settlement_price = float(settlement_price) if settlement_price not in (None, "") else None
        except (TypeError, ValueError):
            settlement_price = None
        try:
            per_unit_amount = float(per_unit_amount) if per_unit_amount not in (None, "") else None
        except (TypeError, ValueError):
            per_unit_amount = None
        cleaned.append(
            {
                "id": str(raw.get("id") or f"cross-rule-{hashlib.sha1(f'{source_key}|{match_mode}|{valid_from}|{valid_to}|{now}'.encode('utf-8')).hexdigest()[:16]}"),
                "matchMode": match_mode,
                "sourceKey": source_key,
                "sourceLabel": str(raw.get("sourceLabel") or "").strip(),
                "skuKey": str(raw.get("skuKey") or "").strip(),
                "pnMtm": str(raw.get("pnMtm") or "").strip(),
                "productName": str(raw.get("productName") or "").strip(),
                "spec": str(raw.get("spec") or "").strip(),
                "category": str(raw.get("category") or "").strip(),
                "counterparty": str(raw.get("counterparty") or "联想").strip() or "联想",
                "settlementMode": settlement_mode,
                "calculationBasis": calculation_basis,
                "settlementPrice": settlement_price,
                "perUnitAmount": per_unit_amount,
                "validFrom": valid_from,
                "validTo": valid_to,
                "note": str(raw.get("note") or "").strip(),
                "enabled": bool(raw.get("enabled", True)),
                "createdAt": str(raw.get("createdAt") or now),
                "updatedAt": str(raw.get("updatedAt") or now),
            }
        )
    with connect() as conn:
        conn.execute("DELETE FROM cross_outbound_check_rule")
        for item in cleaned:
            conn.execute(
                """
                INSERT INTO cross_outbound_check_rule
                (id, match_mode, source_key, source_label, sku_key, pn_mtm,
                 product_name, spec, category, counterparty, settlement_mode,
                 calculation_basis, settlement_price, per_unit_amount, valid_from, valid_to,
                 note, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["matchMode"],
                    item["sourceKey"],
                    item["sourceLabel"],
                    item["skuKey"],
                    item["pnMtm"],
                    item["productName"],
                    item["spec"],
                    item["category"],
                    item["counterparty"],
                    item["settlementMode"],
                    item["calculationBasis"],
                    item["settlementPrice"],
                    item["perUnitAmount"],
                    item["validFrom"],
                    item["validTo"],
                    item["note"],
                    1 if item["enabled"] else 0,
                    item["createdAt"],
                    item["updatedAt"],
                ),
            )
        conn.commit()
    return list_cross_outbound_check_rules()


def list_cross_outbound_check_history() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        reconcile_cross_outbound_check_history(conn)
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, rule_id, source_key, order_number, outbound_date, business_date,
                       sku_key, pn_mtm, product_name, spec, category, product_line,
                       quantity, cost_unit_price, cost_total_amount, cost_source, serial_costs_json,
                       sales_unit_price, sales_total_amount, settlement_mode, calculation_basis,
                       settlement_price, per_unit_amount, cross_check_amount,
                       counterparty, serial_numbers_json, store_name, operator_name,
                       note, rule_valid_from, rule_valid_to, created_at, updated_at
                FROM cross_outbound_check_history
                ORDER BY business_date DESC, updated_at DESC, id DESC
                """
            ).fetchall()
        ]
    items = []
    for row in rows:
        serial_numbers_json = str(row.get("serial_numbers_json") or "[]").strip()
        try:
            serial_numbers = json.loads(serial_numbers_json) if serial_numbers_json else []
        except json.JSONDecodeError:
            serial_numbers = []
        serial_costs_json = str(row.get("serial_costs_json") or "[]").strip()
        try:
            serial_costs = json.loads(serial_costs_json) if serial_costs_json else []
        except json.JSONDecodeError:
            serial_costs = []
        items.append(
            {
                "id": str(row.get("id") or ""),
                "ruleId": str(row.get("rule_id") or ""),
                "sourceKey": str(row.get("source_key") or ""),
                "orderNumber": str(row.get("order_number") or ""),
                "outboundDate": str(row.get("outbound_date") or ""),
                "businessDate": str(row.get("business_date") or ""),
                "skuKey": str(row.get("sku_key") or ""),
                "pnMtm": str(row.get("pn_mtm") or ""),
                "productName": str(row.get("product_name") or ""),
                "spec": str(row.get("spec") or ""),
                "category": str(row.get("category") or ""),
                "productLine": str(row.get("product_line") or "computer"),
                "quantity": parse_sqlite_int(row.get("quantity"), 1),
                "costUnitPrice": row.get("cost_unit_price"),
                "costTotalAmount": row.get("cost_total_amount"),
                "costSource": str(row.get("cost_source") or "unknown"),
                "serialCosts": serial_costs if isinstance(serial_costs, list) else [],
                "salesUnitPrice": row.get("sales_unit_price"),
                "salesTotalAmount": row.get("sales_total_amount"),
                "settlementMode": str(row.get("settlement_mode") or "priceDiff"),
                "calculationBasis": str(row.get("calculation_basis") or "purchaseCost"),
                "settlementPrice": row.get("settlement_price"),
                "perUnitAmount": row.get("per_unit_amount"),
                "crossCheckAmount": float(row.get("cross_check_amount") or 0),
                "counterparty": str(row.get("counterparty") or "联想"),
                "serialNumbers": serial_numbers if isinstance(serial_numbers, list) else [],
                "storeName": str(row.get("store_name") or ""),
                "operatorName": str(row.get("operator_name") or ""),
                "note": str(row.get("note") or ""),
                "ruleValidFrom": str(row.get("rule_valid_from") or ""),
                "ruleValidTo": str(row.get("rule_valid_to") or ""),
                "createdAt": str(row.get("created_at") or ""),
                "updatedAt": str(row.get("updated_at") or ""),
            }
        )
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.cross_outbound_check_history",
        "itemCount": len(items),
        "items": items,
    }


def _decode_json_list(raw_value: Any) -> list[Any]:
    text = str(raw_value or "[]").strip()
    if not text:
        return []
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError:
        return []
    return decoded if isinstance(decoded, list) else []


def backfill_serial_item_costs_from_purchase_lines(conn: sqlite3.Connection) -> bool:
    purchase_rows = conn.execute(
        """
        SELECT pol.sku_key, pol.cost_price, pol.serial_numbers_json, po.id AS document_no, po.business_date
        FROM purchase_order_line pol
        JOIN purchase_order po ON po.id = pol.order_id
        WHERE pol.cost_price IS NOT NULL AND pol.cost_price > 0
        """
    ).fetchall()
    changed = False
    now = now_iso()
    for row in purchase_rows:
        cost_price = float(row["cost_price"] or 0)
        if cost_price <= 0:
            continue
        serial_numbers = [
            str(item).strip()
            for item in _decode_json_list(row["serial_numbers_json"])
            if str(item).strip()
        ]
        if not serial_numbers:
            continue
        for serial_number in serial_numbers:
            current = conn.execute(
                """
                SELECT cost_amount, inbound_document_no, inbound_date
                FROM serial_item
                WHERE serial_number = ?
                """,
                (serial_number,),
            ).fetchone()
            if current is None:
                continue
            current_cost = current["cost_amount"]
            if current_cost is not None and float(current_cost or 0) > 0:
                continue
            conn.execute(
                """
                UPDATE serial_item
                SET cost_amount = ?,
                    inbound_document_no = COALESCE(NULLIF(inbound_document_no, ''), ?),
                    inbound_date = COALESCE(NULLIF(inbound_date, ''), ?),
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (
                    cost_price,
                    str(row["document_no"] or ""),
                    str(row["business_date"] or ""),
                    now,
                    serial_number,
                ),
            )
            changed = True
    return changed


def reconcile_cross_outbound_check_history(conn: sqlite3.Connection) -> bool:
    changed = backfill_serial_item_costs_from_purchase_lines(conn)
    rows = conn.execute(
        """
        SELECT id, quantity, sales_unit_price, settlement_mode, calculation_basis,
               settlement_price, per_unit_amount, cost_unit_price, cost_total_amount,
               cost_source, cross_check_amount, serial_numbers_json, serial_costs_json
        FROM cross_outbound_check_history
        """
    ).fetchall()
    if not rows:
        if changed:
            conn.commit()
        return changed
    serial_numbers = sorted(
        {
            str(serial).strip()
            for row in rows
            for serial in _decode_json_list(row["serial_numbers_json"])
            if str(serial).strip()
        }
    )
    serial_cost_map: dict[str, float] = {}
    if serial_numbers:
        placeholders = ",".join("?" for _ in serial_numbers)
        serial_rows = conn.execute(
            f"""
            SELECT serial_number, cost_amount
            FROM serial_item
            WHERE serial_number IN ({placeholders})
              AND cost_amount IS NOT NULL
              AND cost_amount > 0
            """,
            serial_numbers,
        ).fetchall()
        serial_cost_map = {
            str(row["serial_number"]): round(float(row["cost_amount"] or 0), 2)
            for row in serial_rows
            if str(row["serial_number"] or "").strip()
        }
    now = now_iso()
    for row in rows:
        quantity = max(1, parse_sqlite_int(row["quantity"], 1))
        serial_list = [
            str(serial).strip()
            for serial in _decode_json_list(row["serial_numbers_json"])
            if str(serial).strip()
        ]
        derived_serial_costs = [
            serial_cost_map[serial_number]
            for serial_number in serial_list
            if serial_number in serial_cost_map
        ]
        existing_serial_costs = [
            round(float(value), 2)
            for value in _decode_json_list(row["serial_costs_json"])
            if isinstance(value, (int, float)) and float(value) > 0
        ]
        if derived_serial_costs:
            next_serial_costs = derived_serial_costs
            next_cost_total: float | None = round(sum(derived_serial_costs), 2)
            next_cost_unit: float | None = derived_serial_costs[0] if len(derived_serial_costs) == 1 else None
            next_cost_source = "serialActual"
        elif existing_serial_costs:
            next_serial_costs = existing_serial_costs
            next_cost_total = round(sum(existing_serial_costs), 2)
            next_cost_unit = existing_serial_costs[0] if len(existing_serial_costs) == 1 else None
            next_cost_source = str(row["cost_source"] or "unknown") or "unknown"
        else:
            next_serial_costs = []
            next_cost_total = None
            next_cost_unit = None
            next_cost_source = "unknown"
        settlement_mode = str(row["settlement_mode"] or "priceDiff")
        calculation_basis = str(row["calculation_basis"] or "purchaseCost")
        settlement_price = float(row["settlement_price"] or 0)
        sales_unit_price = float(row["sales_unit_price"] or 0)
        per_unit_amount = float(row["per_unit_amount"] or 0)
        if settlement_mode == "perUnitAmount":
            next_cross_check_amount = round(per_unit_amount * quantity, 2)
        elif calculation_basis == "salesPrice":
            next_cross_check_amount = round(max(0.0, (sales_unit_price - settlement_price) * quantity), 2)
        elif next_cost_total is not None:
            next_cross_check_amount = round(max(0.0, next_cost_total - settlement_price * quantity), 2)
        else:
            next_cross_check_amount = round(float(row["cross_check_amount"] or 0), 2)
        current_cost_unit = row["cost_unit_price"]
        current_cost_total = row["cost_total_amount"]
        current_cost_source = str(row["cost_source"] or "unknown") or "unknown"
        current_cross_check_amount = round(float(row["cross_check_amount"] or 0), 2)
        needs_update = (
            existing_serial_costs != next_serial_costs
            or (current_cost_unit is None) != (next_cost_unit is None)
            or (current_cost_unit is not None and next_cost_unit is not None and round(float(current_cost_unit), 2) != next_cost_unit)
            or (current_cost_total is None) != (next_cost_total is None)
            or (current_cost_total is not None and next_cost_total is not None and round(float(current_cost_total), 2) != next_cost_total)
            or current_cost_source != next_cost_source
            or current_cross_check_amount != next_cross_check_amount
        )
        if not needs_update:
            continue
        conn.execute(
            """
            UPDATE cross_outbound_check_history
            SET cost_unit_price = ?,
                cost_total_amount = ?,
                cost_source = ?,
                serial_costs_json = ?,
                cross_check_amount = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                next_cost_unit,
                next_cost_total,
                next_cost_source,
                json.dumps(next_serial_costs, ensure_ascii=False),
                next_cross_check_amount,
                now,
                str(row["id"] or ""),
            ),
        )
        changed = True
    if changed:
        conn.commit()
    return changed

def save_cross_outbound_check_history(items: list[dict[str, Any]]) -> dict[str, Any]:
    init_db()
    now = now_iso()
    cleaned: list[dict[str, Any]] = []
    for raw in items:
        order_number = str(raw.get("orderNumber") or "").strip()
        outbound_date = str(raw.get("outboundDate") or raw.get("businessDate") or "").strip()
        sku_key = str(raw.get("skuKey") or "").strip()
        product_name = str(raw.get("productName") or "").strip()
        if not order_number or not outbound_date or not sku_key or not product_name:
            continue
        try:
            quantity = max(1, parse_sqlite_int(raw.get("quantity"), 1))
            cross_check_amount = float(raw.get("crossCheckAmount") or 0)
        except (TypeError, ValueError):
            continue
        serial_numbers = raw.get("serialNumbers") if isinstance(raw.get("serialNumbers"), list) else []
        serial_costs = raw.get("serialCosts") if isinstance(raw.get("serialCosts"), list) else []
        settlement_mode = str(raw.get("settlementMode") or "priceDiff").strip()
        if settlement_mode not in {"priceDiff", "perUnitAmount"}:
            settlement_mode = "priceDiff"
        cleaned.append(
            {
                "id": str(raw.get("id") or f"cross-history-{hashlib.sha1(f'{order_number}|{sku_key}|{outbound_date}|{now}'.encode('utf-8')).hexdigest()[:16]}"),
                "ruleId": str(raw.get("ruleId") or "").strip(),
                "sourceKey": str(raw.get("sourceKey") or "").strip(),
                "orderNumber": order_number,
                "outboundDate": outbound_date,
                "businessDate": str(raw.get("businessDate") or outbound_date).strip(),
                "skuKey": sku_key,
                "pnMtm": str(raw.get("pnMtm") or "").strip(),
                "productName": product_name,
                "spec": str(raw.get("spec") or "").strip(),
                "category": str(raw.get("category") or "").strip(),
                "productLine": str(raw.get("productLine") or "computer").strip() or "computer",
                "quantity": quantity,
                "costUnitPrice": raw.get("costUnitPrice"),
                "costTotalAmount": raw.get("costTotalAmount"),
                "costSource": str(raw.get("costSource") or "unknown").strip() or "unknown",
                "serialCosts": [
                    float(item)
                    for item in serial_costs
                    if (
                        isinstance(item, (int, float))
                        or (isinstance(item, str) and item.strip())
                    )
                ],
                "salesUnitPrice": raw.get("salesUnitPrice"),
                "salesTotalAmount": raw.get("salesTotalAmount"),
                "settlementMode": settlement_mode,
                "calculationBasis": str(raw.get("calculationBasis") or "purchaseCost").strip() or "purchaseCost",
                "settlementPrice": raw.get("settlementPrice"),
                "perUnitAmount": raw.get("perUnitAmount"),
                "crossCheckAmount": cross_check_amount,
                "counterparty": str(raw.get("counterparty") or "联想").strip() or "联想",
                "serialNumbers": [str(item).strip() for item in serial_numbers if str(item).strip()],
                "storeName": str(raw.get("storeName") or "").strip(),
                "operatorName": str(raw.get("operatorName") or "").strip(),
                "note": str(raw.get("note") or "").strip(),
                "ruleValidFrom": str(raw.get("ruleValidFrom") or "").strip(),
                "ruleValidTo": str(raw.get("ruleValidTo") or "").strip(),
                "createdAt": str(raw.get("createdAt") or now),
                "updatedAt": str(raw.get("updatedAt") or now),
            }
        )
    with connect() as conn:
        conn.execute("DELETE FROM cross_outbound_check_history")
        for item in cleaned:
            conn.execute(
                """
                INSERT INTO cross_outbound_check_history
                (id, rule_id, source_key, order_number, outbound_date, business_date,
                 sku_key, pn_mtm, product_name, spec, category, product_line,
                 quantity, cost_unit_price, cost_total_amount, cost_source, serial_costs_json,
                 sales_unit_price, sales_total_amount, settlement_mode, calculation_basis,
                 settlement_price, per_unit_amount, cross_check_amount, counterparty,
                 serial_numbers_json, store_name, operator_name, note,
                 rule_valid_from, rule_valid_to, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["ruleId"],
                    item["sourceKey"],
                    item["orderNumber"],
                    item["outboundDate"],
                    item["businessDate"],
                    item["skuKey"],
                    item["pnMtm"],
                    item["productName"],
                    item["spec"],
                    item["category"],
                    item["productLine"],
                    item["quantity"],
                    item["costUnitPrice"],
                    item["costTotalAmount"],
                    item["costSource"],
                    json.dumps(item["serialCosts"], ensure_ascii=False),
                    item["salesUnitPrice"],
                    item["salesTotalAmount"],
                    item["settlementMode"],
                    item["calculationBasis"],
                    item["settlementPrice"],
                    item["perUnitAmount"],
                    item["crossCheckAmount"],
                    item["counterparty"],
                    json.dumps(item["serialNumbers"], ensure_ascii=False),
                    item["storeName"],
                    item["operatorName"],
                    item["note"],
                    item["ruleValidFrom"],
                    item["ruleValidTo"],
                    item["createdAt"],
                    item["updatedAt"],
                ),
            )
        conn.commit()
    return list_cross_outbound_check_history()


def list_product_activity_current() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, activity_kind, activity_label, amount,
                       valid_from, valid_to, countdown_days, rule_text,
                       source_file, source_type, source_activity_id, payload_json, updated_at
                FROM product_activity_current
                ORDER BY sku_key ASC, activity_kind ASC, updated_at DESC
                """
            ).fetchall()
        ]
    items = []
    for row in rows:
        payload_text = str(row.get("payload_json") or "").strip()
        try:
            payload = json.loads(payload_text) if payload_text else {}
        except json.JSONDecodeError:
            payload = {}
        items.append(
            {
                "id": str(row.get("id") or ""),
                "skuKey": str(row.get("sku_key") or ""),
                "activityKind": str(row.get("activity_kind") or ""),
                "activityLabel": str(row.get("activity_label") or ""),
                "amount": float(row.get("amount") or 0),
                "validFrom": str(row.get("valid_from") or ""),
                "validTo": str(row.get("valid_to") or ""),
                "validFromShort": format_short_date(row.get("valid_from") or ""),
                "validToShort": format_short_date(row.get("valid_to") or ""),
                "countdownDays": row.get("countdown_days"),
                "countdownLabel": format_countdown_label(row.get("countdown_days")),
                "ruleText": str(row.get("rule_text") or ""),
                "sourceFile": str(row.get("source_file") or ""),
                "sourceType": str(row.get("source_type") or ""),
                "sourceActivityId": str(row.get("source_activity_id") or ""),
                "payload": payload if isinstance(payload, dict) else {},
                "updatedAt": str(row.get("updated_at") or ""),
            }
        )
    latest_updated_at = max((item["updatedAt"] for item in items if item["updatedAt"]), default=now_iso())
    return {
        "generatedAt": latest_updated_at,
        "source": "retail_core.product_activity_current",
        "itemCount": len(items),
        "items": items,
    }


def category_node_id(source_system: str, name: str, parent_id: str | None = None) -> str:
    basis = f"{source_system}:{parent_id or 'root'}:{name}".strip()
    return "cat-" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def upsert_sku_category_mapping(
    conn: sqlite3.Connection,
    item: dict[str, Any],
    timestamp: str,
) -> None:
    sku_key = str(item.get("skuKey", "")).strip()
    if not sku_key:
        return
    conn.execute(
        """
        INSERT INTO sku_category_mapping
        (sku_key, smart_retail_category, zhidiantong_category, jd_subcategory,
         catalog_source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(sku_key) DO UPDATE SET
          smart_retail_category = excluded.smart_retail_category,
          zhidiantong_category = excluded.zhidiantong_category,
          jd_subcategory = excluded.jd_subcategory,
          catalog_source = excluded.catalog_source,
          updated_at = excluded.updated_at
        """,
        (
            sku_key,
            str(item.get("category", "")),
            str(item.get("sourceCategory", "")),
            str(item.get("jdSubcategory", "")),
            str(item.get("catalogSource", "")),
            timestamp,
        ),
    )


def seed_category_nodes(
    conn: sqlite3.Connection,
    skus: list[Any],
    timestamp: str,
) -> None:
    smart_categories: dict[str, set[str]] = {}
    zhidiantong_categories: set[str] = set()
    catalog_roots: dict[str, set[str]] = {}

    for item in skus:
        if not isinstance(item, dict):
            continue
        smart_category = str(item.get("category", "")).strip() or "未分类"
        jd_subcategory = str(item.get("jdSubcategory", "")).strip() or "未细分"
        source_category = str(item.get("sourceCategory", "")).strip() or "未分类"
        catalog_source = str(item.get("catalogSource", "")).strip() or "未标记目录"
        smart_categories.setdefault(smart_category, set()).add(jd_subcategory)
        zhidiantong_categories.add(source_category)
        catalog_roots.setdefault(catalog_source, set()).add(jd_subcategory)

    rows: list[tuple[str, str, str, int, str | None, int, str]] = []
    for index, (name, children) in enumerate(sorted(smart_categories.items()), start=1):
        parent_id = category_node_id("smart_retail", name)
        rows.append((parent_id, "smart_retail", name, 1, None, index, timestamp))
        for child_index, child in enumerate(sorted(children), start=1):
            rows.append((
                category_node_id("smart_retail", child, parent_id),
                "smart_retail",
                child,
                2,
                parent_id,
                child_index,
                timestamp,
            ))

    for index, name in enumerate(sorted(zhidiantong_categories), start=1):
        rows.append((
            category_node_id("zhidiantong", name),
            "zhidiantong",
            name,
            1,
            None,
            index,
            timestamp,
        ))

    for index, (name, children) in enumerate(sorted(catalog_roots.items()), start=1):
        parent_id = category_node_id("catalog_source", name)
        rows.append((parent_id, "catalog_source", name, 1, None, index, timestamp))
        for child_index, child in enumerate(sorted(children), start=1):
            rows.append((
                category_node_id("catalog_source", child, parent_id),
                "catalog_source",
                child,
                2,
                parent_id,
                child_index,
                timestamp,
            ))

    conn.executemany(
        """
        INSERT OR REPLACE INTO product_category_node
        (id, source_system, name, level, parent_id, display_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )


def signed_movement_quantity(movement_type: str, quantity: int) -> int:
    if movement_type in {"sales_outbound", "transfer_outbound"}:
        return -abs(quantity)
    return abs(quantity)


def normalize_movement_type_from_hints(
    movement_type: str,
    *,
    movement_id: str = "",
    document_number: str = "",
    source_ref: str = "",
    source_document_type: str = "",
    service_type_name: str = "",
    operate_type_name: str = "",
    note: str = "",
) -> str:
    normalized = str(movement_type or "").strip()
    movement_id = str(movement_id or "").strip().upper()
    document_no = str(document_number or source_ref or "").strip().upper()
    text = " ".join(
        [
            str(source_document_type or ""),
            str(service_type_name or ""),
            str(operate_type_name or ""),
            str(note or ""),
        ]
    )

    is_purchase = (
        movement_id.startswith("PURCHASEQ-")
        or re.match(r"^CGR\d+", document_no) is not None
        or re.search(r"采购入库|商品入库|订单退货入库", text) is not None
    )
    is_transfer_out = (
        movement_id.startswith("OTHEROUTQ-")
        or movement_id.startswith("TRANSFEROUTQ-")
        or re.search(r"调拨出库|其他出库|其它出库|换库位出库", text) is not None
    )
    is_sales = (
        movement_id.startswith("SALE-EXPORT-")
        or re.search(r"销售出库|订单出库|业务订单|门店销售|零售出库", text) is not None
    )

    if is_purchase:
        return "purchase_inbound"
    if is_sales and not is_transfer_out:
        return "sales_outbound"
    if is_transfer_out and not is_sales:
        return "transfer_outbound"
    if is_transfer_out and is_sales:
        return "transfer_outbound" if movement_id.startswith(("OTHEROUTQ-", "TRANSFEROUTQ-")) else "sales_outbound"
    return normalized


def seed_inventory_movements(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str,
) -> int:
    path = data_dir / "latest-inventory-movements.json"
    if not path.exists():
        return 0
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("records", [])
    # ── 销售出库按 source_ref 去重 ──────────────────────────────────────────────
    # 同一 source_ref 可能有多条记录（ZDT-XS / SALEQ / SALE），
    # 按 type_score 保留最优1条，防止 INSERT OR REPLACE 后仍有重复
    # type_score: SALE-*=3(有SN) > SALEQ-*=2(有amount) > ZDT-XS*=1(有日期) > other=0
    # 去重维度：source_ref 本身（同一订单不因 SKU 不同而保留多条）
    source_ref_best: dict[str, tuple[dict[str, Any], int]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        mtype = str(rec.get("movementType", "")).strip()
        src_ref = str(rec.get("sourceRef") or rec.get("documentNumber") or "").strip()
        rec_id = str(rec.get("id", "")).strip()
        if mtype != "sales_outbound" or not src_ref:
            continue
        if rec_id.startswith("SALE-"):
            score = 3
        elif rec_id.startswith("SALEQ-"):
            score = 2
        elif rec_id.startswith("ZDT-XS"):
            score = 1
        else:
            score = 0
        existing = source_ref_best.get(src_ref)
        existing_score = existing[1] if existing else -1
        if score > existing_score:
            source_ref_best[src_ref] = (rec, score)

    # 构建去重后的记录列表：保留最优 sales_outbound + 全部其他类型
    deduped_src_refs: set[str] = set()
    deduped_records: list[dict[str, Any]] = []
    # 先加入最优的 sales_outbound
    for rec, _ in source_ref_best.values():
        deduped_records.append(rec)
        deduped_src_refs.add(str(rec.get("sourceRef") or rec.get("documentNumber") or "").strip())
    # 再加入非 sales_outbound 和未参与去重的 sales_outbound（保持数据完整性）
    for rec in records:
        if not isinstance(rec, dict):
            deduped_records.append(rec)
            continue
        mtype = str(rec.get("movementType", "")).strip()
        src_ref = str(rec.get("sourceRef") or rec.get("documentNumber") or "").strip()
        if mtype != "sales_outbound" or not src_ref:
            deduped_records.append(rec)
            continue
        if src_ref not in deduped_src_refs:
            deduped_records.append(rec)
            deduped_src_refs.add(src_ref)
    records = deduped_records

    if not isinstance(records, list):
        return 0
    inserted = 0
    for record in records:
        if not isinstance(record, dict):
            continue
        movement_id = str(record.get("id", "")).strip()
        sku_key = str(record.get("skuKey", "")).strip()
        movement_type = str(record.get("movementType", "")).strip()
        if not movement_id or not sku_key or not movement_type:
            continue
        source_ref = str(record.get("documentNumber") or record.get("sourceRef") or "").strip()
        movement_type = normalize_movement_type_from_hints(
            movement_type,
            movement_id=movement_id,
            document_number=str(record.get("documentNumber") or ""),
            source_ref=source_ref,
            source_document_type=str(record.get("sourceDocumentType") or ""),
            service_type_name=str(record.get("serviceTypeName") or ""),
            operate_type_name=str(record.get("operateTypeName") or ""),
            note=str(record.get("note") or ""),
        )
        raw_quantity = normalize_inventory_movement_quantity(
            record.get("quantity", 1),
            movement_type=movement_type,
            serial_number=record.get("serialNumber"),
            amount=record.get("amount"),
            unit_cost=record.get("unitCost") if record.get("unitCost") is not None else record.get("purchaseCost"),
        )
        inbound_document_no = str(record.get("inboundDocumentNo") or record.get("documentNumber") or "").strip()
        if movement_type not in {"purchase_inbound", "transfer_inbound"}:
            inbound_document_no = ""
        raw_supplier = str(record.get("supplierName") or "").strip()
        supplier_name = raw_supplier
        conn.execute(
            """
            INSERT OR REPLACE INTO inventory_movement
            (id, sku_key, serial_number, movement_type, quantity, business_date,
             source_system, source_ref, source_document_type, inbound_document_no, store_name, location_name,
             product_name, unit_name, unit_cost, amount, operator_name, supplier_name, pn_mtm, spec,
             service_type_name, operate_type_name, pay_remark, company_name, shop_name, warehouse_location_name,
             property_name, property_value, spu_no, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                movement_id,
                sku_key,
                record.get("serialNumber"),
                movement_type,
                signed_movement_quantity(movement_type, raw_quantity),
                normalize_business_datetime_text(record.get("businessDate") or record.get("updatedAt") or timestamp),
                str(payload.get("source") or "smart_retail_snapshot"),
                source_ref,
                str(record.get("sourceDocumentType") or ""),
                inbound_document_no,
                str(record.get("storeName") or "").strip(),
                str(record.get("locationName") or "").strip(),
                str(record.get("productName") or ""),
                str(record.get("unitName") or ""),
                record.get("unitCost"),
                record.get("amount"),
                str(record.get("operatorName") or "").strip(),
                supplier_name,
                str(record.get("pnMtm") or "").strip(),
                str(record.get("spec") or "").strip(),
                str(record.get("serviceTypeName") or ""),
                str(record.get("operateTypeName") or ""),
                str(record.get("payRemark") or ""),
                str(record.get("companyName") or ""),
                str(record.get("shopName") or ""),
                str(record.get("warehouseLocationName") or ""),
                str(record.get("propertyName") or ""),
                str(record.get("propertyValue") or ""),
                str(record.get("spuNo") or ""),
                str(record.get("note") or ""),
                str(record.get("updatedAt") or timestamp),
            ),
        )
        inserted += 1
    return inserted


def backfill_inventory_movement_zhidiantong_fields(conn: sqlite3.Connection, timestamp: str) -> int:
    rows = conn.execute(
        """
        SELECT id, movement_type, source_system, source_ref, sku_key, spec,
               location_name, operator_name, store_name, shop_name
        FROM inventory_movement
        """
    ).fetchall()
    updated = 0
    for row in rows:
        movement_type = str(row["movement_type"] or "").strip()
        if movement_type == "sales_outbound":
            operate_type_name = "订单出库"
            service_type_name = "销售出库"
        elif movement_type == "purchase_inbound":
            operate_type_name = "采购入库"
            service_type_name = "采购入库"
        elif movement_type == "transfer_outbound":
            operate_type_name = "调拨出库"
            service_type_name = "调拨出库"
        elif movement_type == "transfer_inbound":
            operate_type_name = "调拨入库"
            service_type_name = "调拨入库"
        elif movement_type == "po_hold_inbound":
            operate_type_name = "实物仓转入"
            service_type_name = "PO实物仓转入"
        elif movement_type == "po_hold_release":
            operate_type_name = "实物仓转回门店"
            service_type_name = "PO实物仓转回门店"
        elif movement_type == "po_hold_outbound":
            operate_type_name = "智惠服务二次出库"
            service_type_name = "智惠服务二次出库"
        elif movement_type == "po_hold_revoke_outbound":
            operate_type_name = "实物仓撤销转入"
            service_type_name = "实物仓撤销转入"
        elif movement_type == "po_hold_reopen_inbound":
            operate_type_name = "撤销误核销恢复实物仓"
            service_type_name = "撤销误核销恢复实物仓"
        else:
            operate_type_name = "库存调整"
            service_type_name = "库存调整"
        source_system = str(row["source_system"] or "").strip()
        source_ref = str(row["source_ref"] or "").strip()
        canonical_source_ref = source_ref
        if movement_type == "sales_outbound":
            canonical_source_ref = extract_canonical_sales_order_no(source_ref, row["id"]) or source_ref or str(row["id"] or "")
        elif movement_type == "purchase_inbound":
            canonical_source_ref = extract_canonical_purchase_order_no(source_ref, row["id"]) or source_ref or str(row["id"] or "")
        sku_key = str(row["sku_key"] or "").strip()
        spec = str(row["spec"] or "").strip()
        location_name = str(row["location_name"] or "").strip()
        operator_name = str(row["operator_name"] or "").strip()
        store_name = str(row["store_name"] or "").strip()
        shop_name = str(row["shop_name"] or "").strip()
        pay_remark = "POS/智店通同步" if source_system else ""
        desired_source_document_type = default_source_document_type_for_movement(movement_type)
        conn.execute(
            """
            UPDATE inventory_movement
            SET source_ref = CASE
                  WHEN TRIM(COALESCE(source_ref, '')) = '' THEN ?
                  WHEN ? <> '' AND TRIM(COALESCE(source_ref, '')) <> ? THEN ?
                  ELSE source_ref
                END,
                source_document_type = CASE
                  WHEN TRIM(COALESCE(source_document_type, '')) = '' THEN ?
                  WHEN movement_type <> 'sales_outbound' AND TRIM(COALESCE(source_document_type, '')) = '业务订单' THEN ?
                  WHEN movement_type = 'sales_outbound' AND TRIM(COALESCE(source_document_type, '')) IN ('采购入库', '入库', '库存流水单') THEN ?
                  ELSE source_document_type
                END,
                inbound_document_no = CASE
                  WHEN movement_type = 'purchase_inbound' AND TRIM(COALESCE(inbound_document_no, '')) = '' THEN ?
                  ELSE inbound_document_no
                END,
                store_name = CASE WHEN TRIM(COALESCE(store_name, '')) = '' THEN ? ELSE store_name END,
                shop_name = CASE WHEN TRIM(COALESCE(shop_name, '')) = '' THEN ? ELSE shop_name END,
                warehouse_location_name = CASE WHEN TRIM(COALESCE(warehouse_location_name, '')) = '' THEN ? ELSE warehouse_location_name END,
                product_name = CASE WHEN TRIM(COALESCE(product_name, '')) = '' THEN (
                    COALESCE(
                      (SELECT COALESCE(NULLIF(name, ''), '') FROM sku WHERE sku.sku_key = inventory_movement.sku_key LIMIT 1),
                      ''
                    )
                ) ELSE product_name END,
                unit_name = CASE WHEN TRIM(COALESCE(unit_name, '')) = '' THEN '台' ELSE unit_name END,
                service_type_name = CASE WHEN TRIM(COALESCE(service_type_name, '')) = '' THEN ? ELSE service_type_name END,
                operate_type_name = CASE WHEN TRIM(COALESCE(operate_type_name, '')) = '' THEN ? ELSE operate_type_name END,
                pay_remark = CASE WHEN TRIM(COALESCE(pay_remark, '')) = '' THEN ? ELSE pay_remark END,
                company_name = CASE WHEN TRIM(COALESCE(company_name, '')) = '' THEN '联想智慧零售' ELSE company_name END,
                property_name = CASE WHEN TRIM(COALESCE(property_name, '')) = '' THEN '规格' ELSE property_name END,
                property_value = CASE WHEN TRIM(COALESCE(property_value, '')) = '' THEN ? ELSE property_value END,
                spu_no = CASE WHEN TRIM(COALESCE(spu_no, '')) = '' THEN ? ELSE spu_no END,
                operator_name = CASE WHEN TRIM(COALESCE(operator_name, '')) = '' THEN '系统同步' ELSE operator_name END,
                created_at = ?
            WHERE id = ?
            """,
            (
                canonical_source_ref or str(row["id"] or ""),
                canonical_source_ref,
                canonical_source_ref,
                canonical_source_ref,
                desired_source_document_type,
                desired_source_document_type,
                desired_source_document_type,
                canonical_source_ref or source_ref or str(row["id"] or ""),
                store_name or "联想体验店（新野县书院路）",
                shop_name or store_name or "联想体验店（新野县书院路）",
                location_name or "销售库",
                service_type_name,
                operate_type_name,
                pay_remark,
                spec,
                sku_key,
                timestamp,
                str(row["id"] or ""),
            ),
        )
        updated += 1
    return updated


def sync_sales_orders_from_inventory_movements(conn: sqlite3.Connection, timestamp: str) -> int:
    # 正式销售单只能由导出快照或 OpenClaw 订单事实入库。
    # inventory_movement 仅保留库存流水职能，避免“销售出库流水壳单”覆盖真实金额与分类。
    return 0


def sync_sales_orders_from_export_snapshot(conn: sqlite3.Connection, timestamp: str) -> int:
    orders = load_zhidiantong_sales_orders_snapshot()
    synced = 0
    # ★ 核心修复：如果订单已存在DB且有正确金额，但快照金额为0，跳过避免覆盖
    existing_map = {str(r[0]): r for r in conn.execute("SELECT id,total_amount,cashier_name FROM sales_order").fetchall()}
    for order in orders:
        order_id = str(order.get("id") or "").strip()
        if order_id in existing_map:
            row = existing_map[order_id]
            snap_amount = float(order.get("totalAmount") or 0)
            db_amount = float(row[1] or 0)
            # DB已有正金额但快照金额为0 → 跳过，不覆盖已有数据
            if db_amount > 0 and snap_amount <= 0:
                continue
        business_date = _business_datetime_or_inferred(order_id, str(order.get("businessDate") or ""))
        if not order_id or not business_date:
            continue
        status = str(order.get("status") or "completed").strip() or "completed"
        operator_name = str(order.get("operatorName") or "ZHIDIANTONG").strip() or "ZHIDIANTONG"
        store_name = str(order.get("storeName") or "STORE-XY-SYL").strip() or "STORE-XY-SYL"
        total_amount = float(order.get("totalAmount") or 0)
        note = str(order.get("note") or f"智店通销售出库导出导入，订单 {order_id}")
        conn.execute(
            """
            INSERT INTO sales_order
            (id, external_order_no, store_code, operator_id, customer_name, status, status_name, total_amount, pay_amount,
             order_type, order_type_name, channel_type_name, cashier_name, total_quantity, pay_time, created_time,
             shop_id, shop_name, company_id, business_date, raw_payload_json, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              external_order_no = excluded.external_order_no,
              store_code = excluded.store_code,
              operator_id = excluded.operator_id,
              status = excluded.status,
              status_name = excluded.status_name,
              total_amount = CASE WHEN excluded.total_amount > 0 AND excluded.total_amount IS NOT NULL THEN excluded.total_amount ELSE sales_order.total_amount END,
              pay_amount = CASE WHEN excluded.pay_amount > 0 AND excluded.pay_amount IS NOT NULL THEN excluded.pay_amount ELSE sales_order.pay_amount END,
              total_quantity = CASE WHEN excluded.total_quantity > 0 THEN excluded.total_quantity ELSE sales_order.total_quantity END,
              pay_time = excluded.pay_time,
              created_time = excluded.created_time,
              shop_name = excluded.shop_name,
              business_date = excluded.business_date,
              raw_payload_json = excluded.raw_payload_json,
              note = excluded.note,
              created_at = excluded.created_at
            """,
            (
                order_id,
                str(order.get("externalOrderNo") or ""),
                store_name,
                operator_name,
                "",
                status,
                str(order.get("statusName") or status),
                total_amount,
                float(order.get("payAmount") or total_amount or 0),
                int(order.get("orderType") or 1) if str(order.get("orderType") or "").strip() else None,
                str(order.get("orderTypeName") or "线下"),
                str(order.get("channelTypeName") or "门店收银"),
                str(order.get("cashierName") or operator_name),
                sum(int((line.get("quantity") or 0) if isinstance(line, dict) else 0) for line in (order.get("lines", []) if isinstance(order.get("lines", []), list) else [])),
                str(order.get("payTime") or business_date),
                str(order.get("createdTime") or business_date),
                str(order.get("shopId") or ""),
                store_name,
                str(order.get("companyId") or ""),
                business_date,
                json.dumps(order, ensure_ascii=False),
                note,
                timestamp,
            ),
        )
        conn.execute("DELETE FROM sales_order_line WHERE order_id = ?", (order_id,))
        lines = order.get("lines", [])
        if not isinstance(lines, list):
            lines = []
        for index, line in enumerate(lines, start=1):
            if not isinstance(line, dict):
                continue
            sku_key = str(line.get("skuKey") or "").strip()
            if not sku_key:
                continue
            serial_numbers = [
                str(serial).strip()
                for serial in line.get("serialNumbers", [])
                if str(serial).strip()
            ] if isinstance(line.get("serialNumbers"), list) else []
            quantity = len(serial_numbers) if serial_numbers else int(line.get("quantity") or 1)
            deal_price = float(line.get("dealPrice") or line.get("paidAmount") or line.get("lineTotalAmount") or 0)
            conn.execute(
                """
                INSERT OR REPLACE INTO sales_order_line
                (id, order_id, sku_key, product_name, product_no, mtm_code, spec, supplier_name,
                 quantity, deal_price, pay_amount, discount_amount, serial_number, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{order_id}-{index:03d}",
                    order_id,
                    sku_key,
                    str(line.get("productName") or ""),
                    str(line.get("productNo") or ""),
                    str(line.get("pnMtm") or line.get("mtmCode") or ""),
                    str(line.get("spec") or ""),
                    "",
                    quantity,
                    deal_price,
                    float(line.get("paidAmount") or line.get("payAmount") or deal_price * quantity),
                    float(line.get("discountAmount") or 0) if str(line.get("discountAmount") or "").strip() else None,
                    serial_numbers[0] if serial_numbers else "",
                    json.dumps(serial_numbers, ensure_ascii=False),
                    timestamp,
                ),
            )
        synced += 1
    return synced


def sync_inventory_movements_from_sales_order_exports(conn: sqlite3.Connection, timestamp: str) -> int:
    """Backfill missing outbound ledger rows from trusted sales order exports.

    This is only used when orderData/orderProductData already produced concrete
    SKU lines. Service-only orders have no inventory lines and are intentionally
    ignored by the registry below.
    """
    rows = conn.execute(
        """
        SELECT sales_order.id AS order_id, sales_order.business_date,
               sales_order.store_code, sales_order.operator_id,
               sales_order_line.sku_key, sales_order_line.quantity,
               sales_order_line.serial_numbers_json,
               COALESCE(NULLIF(sales_order_line.product_name, ''), sku.name) AS product_name,
               COALESCE(NULLIF(sales_order_line.mtm_code, ''), sku.pn_mtm) AS pn_mtm,
               COALESCE(NULLIF(sales_order_line.spec, ''), sku.category) AS category,
               sales_order_line.pay_amount, sales_order_line.deal_price
        FROM sales_order
        JOIN sales_order_line ON sales_order_line.order_id = sales_order.id
        LEFT JOIN sku ON sku.sku_key = sales_order_line.sku_key
        WHERE sales_order.id LIKE 'XS%'
          AND NOT EXISTS (
            SELECT 1
            FROM inventory_movement AS movement
            WHERE movement.source_ref = sales_order.id
              AND movement.movement_type = 'sales_outbound'
              AND movement.sku_key = sales_order_line.sku_key
              AND (
                TRIM(COALESCE(sales_order_line.serial_number, '')) = ''
                OR TRIM(COALESCE(movement.serial_number, '')) = TRIM(COALESCE(sales_order_line.serial_number, ''))
              )
          )
        ORDER BY sales_order.business_date, sales_order.id
        """
    ).fetchall()
    synced = 0
    for row in rows:
        order_id = str(row["order_id"] or "").strip()
        sku_key = str(row["sku_key"] or "").strip()
        if not order_id or not sku_key:
            continue
        try:
            serials = json.loads(str(row["serial_numbers_json"] or "[]"))
        except json.JSONDecodeError:
            serials = []
        serial_numbers = [str(serial or "").strip() for serial in serials if str(serial or "").strip()] if isinstance(serials, list) else []
        if not serial_numbers:
            quantity = max(1, int(row["quantity"] or 1))
            serial_numbers = ["" for _ in range(quantity)]
        for index, serial_number in enumerate(serial_numbers, start=1):
            movement_id = f"SALE-EXPORT-{order_id}-{sku_key}-{serial_number or index}"
            conn.execute(
                """
                INSERT INTO inventory_movement
                (id, sku_key, serial_number, movement_type, quantity, business_date,
                 source_system, source_ref, source_document_type, inbound_document_no, store_name, location_name,
                 product_name, unit_name, unit_cost, amount, operator_name, supplier_name, pn_mtm, spec,
                 service_type_name, operate_type_name, pay_remark, company_name, shop_name, warehouse_location_name,
                 property_name, property_value, spu_no, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  sku_key = excluded.sku_key,
                  serial_number = excluded.serial_number,
                  business_date = excluded.business_date,
                  source_ref = excluded.source_ref,
                  source_document_type = excluded.source_document_type,
                  store_name = excluded.store_name,
                  location_name = excluded.location_name,
                  product_name = excluded.product_name,
                  operator_name = excluded.operator_name,
                  pn_mtm = excluded.pn_mtm,
                  service_type_name = excluded.service_type_name,
                  operate_type_name = excluded.operate_type_name,
                  unit_cost = excluded.unit_cost,
                  amount = excluded.amount,
                  shop_name = excluded.shop_name,
                  warehouse_location_name = excluded.warehouse_location_name,
                  note = excluded.note,
                  created_at = excluded.created_at
                """,
                (
                    movement_id,
                    sku_key,
                    serial_number or None,
                    "sales_outbound",
                    -1,
                    _business_datetime_or_inferred(order_id, str(row["business_date"] or "")),
                    "zhidiantong_sales_export_backfill",
                    order_id,
                    "业务订单",
                    "",
                    str(row["store_code"] or ""),
                    str(row["store_code"] or ""),
                    str(row["product_name"] or ""),
                    "台",
                    (
                        round(float(row["pay_amount"] or 0) / max(1, abs(int(row["quantity"] or 1))), 2)
                        if row["pay_amount"] not in (None, "")
                        else (float(row["deal_price"] or 0) if row["deal_price"] not in (None, "") else None)
                    ),
                    float(row["pay_amount"] or 0) if row["pay_amount"] not in (None, "") else None,
                    str(row["operator_id"] or ""),
                    "",
                    str(row["pn_mtm"] or ""),
                    str(row["category"] or ""),
                    "销售出库",
                    "订单出库",
                    "",
                    "",
                    str(row["store_code"] or ""),
                    str(row["store_code"] or ""),
                    "",
                    "",
                    "",
                    f"由智店通销售金额快照自动补齐出库流水，单号 {order_id}",
                    timestamp,
                ),
            )
            synced += 1
    return synced


def _load_snapshot_payload(data_dir: Path, file_name: str) -> dict[str, Any]:
    for path in (data_dir / file_name, ARTIFACT_DIR / file_name):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return {}


def _json_list(values: set[str] | list[str]) -> str:
    return json.dumps(sorted({str(value).strip() for value in values if str(value).strip()}), ensure_ascii=False)


def _json_object(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _ensure_order_registry_row(registry: dict[str, dict[str, Any]], order_number: str, timestamp: str) -> dict[str, Any]:
    return registry.setdefault(order_number, {
        "order_number": order_number,
        "external_order_number": "",
        "business_date": _infer_business_date_from_order_id(order_number, ""),
        "order_type": "sales_outbound",
        "sku_keys": set(),
        "serial_numbers": set(),
        "source_files": set(),
        "seen_in_stock_stream": 0,
        "seen_in_sn_stock_order": 0,
        "seen_in_sales_export": 0,
        "seen_in_frontend_sales_orders": 0,
        "seen_in_frontend_movements": 0,
        "status": "pending_reconcile",
        "missing_fields": [],
        "message": "",
        "created_at": timestamp,
        "updated_at": timestamp,
        "sample_sku_key": "",
        "sample_product_name": "",
        "sample_serial_number": "",
    })


def _prefer_precise_business_datetime(current: str, candidate: Any) -> str:
    normalized = normalize_business_datetime_text(candidate)
    if not normalized:
        return current
    if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}", normalized):
        return normalized
    if current and re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}", current):
        return current
    return normalized or current


def _canonical_sales_order_number(order_number: Any) -> tuple[str, str]:
    raw = str(order_number or "").strip()
    if not raw:
        return "", ""
    if raw.startswith("XS") and "_" in raw:
        base = raw.split("_", 1)[0].strip()
        if base.startswith("XS"):
            return base, raw
    return raw, raw


def sync_order_sync_registry(conn: sqlite3.Connection, data_dir: Path, timestamp: str) -> int:
    # 历史缺口归档窗口：只让最近两天的缺口参与 open 阻塞，避免旧遗留长期卡住当天采集闭环。
    gap_window_start = datetime.now(timezone.utc).date() - timedelta(days=2)
    registry: dict[str, dict[str, Any]] = {}
    for row in conn.execute(
        """
        SELECT movement.sku_key, movement.serial_number, movement.business_date,
               movement.source_ref, sku.name AS product_name
        FROM inventory_movement AS movement
        LEFT JOIN sku ON sku.sku_key = movement.sku_key
        WHERE movement.movement_type = 'sales_outbound'
          AND movement.source_ref LIKE 'XS%'
        """
    ).fetchall():
        raw_order_number = str(row["source_ref"] or "").strip()
        order_number, external_order_number = _canonical_sales_order_number(raw_order_number)
        if not order_number:
            continue
        item = _ensure_order_registry_row(registry, order_number, timestamp)
        if external_order_number and external_order_number != order_number:
            item["external_order_number"] = item["external_order_number"] or external_order_number
        item["seen_in_stock_stream"] = 1
        item["seen_in_frontend_movements"] = 1
        item["business_date"] = _prefer_precise_business_datetime(item["business_date"], row["business_date"])
        for key, field in (("sku_key", "sku_keys"), ("serial_number", "serial_numbers")):
            value = str(row[key] or "").strip()
            if value:
                item[field].add(value)
        item["sample_sku_key"] = item["sample_sku_key"] or str(row["sku_key"] or "").strip()
        item["sample_serial_number"] = item["sample_serial_number"] or str(row["serial_number"] or "").strip()
        item["sample_product_name"] = item["sample_product_name"] or str(row["product_name"] or "").strip()

    for row in conn.execute(
        """
        SELECT sales_order.id, sales_order.business_date, sales_order.note,
               sales_order.total_amount, sales_order_line.sku_key,
               sales_order_line.serial_numbers_json, sku.name AS product_name
        FROM sales_order
        LEFT JOIN sales_order_line ON sales_order_line.order_id = sales_order.id
        LEFT JOIN sku ON sku.sku_key = sales_order_line.sku_key
        WHERE sales_order.id LIKE 'XS%'
        """
    ).fetchall():
        sku_key = str(row["sku_key"] or "").strip()
        raw_order_number = str(row["id"] or "").strip()
        order_number, external_order_number = _canonical_sales_order_number(raw_order_number)
        if not sku_key and order_number not in registry:
            continue
        item = _ensure_order_registry_row(registry, order_number, timestamp)
        if external_order_number and external_order_number != order_number:
            item["external_order_number"] = item["external_order_number"] or external_order_number
        item["seen_in_frontend_sales_orders"] = 1
        note = str(row["note"] or "")
        if "销售出库导出" in note or float(row["total_amount"] or 0) > 0:
            item["seen_in_sales_export"] = 1
        item["business_date"] = _prefer_precise_business_datetime(item["business_date"], row["business_date"])
        if sku_key:
            item["sku_keys"].add(sku_key)
            item["sample_sku_key"] = item["sample_sku_key"] or sku_key
        item["sample_product_name"] = item["sample_product_name"] or str(row["product_name"] or "").strip()
        try:
            serials = json.loads(str(row["serial_numbers_json"] or "[]"))
        except json.JSONDecodeError:
            serials = []
        if isinstance(serials, list):
            for serial in serials:
                serial_text = str(serial or "").strip()
                if serial_text:
                    item["serial_numbers"].add(serial_text)
                    item["sample_serial_number"] = item["sample_serial_number"] or serial_text

    master_payload = _load_snapshot_payload(data_dir, "latest-inventory-master-snapshot.json")
    for row in master_payload.get("rows", []) if isinstance(master_payload.get("rows"), list) else []:
        if not isinstance(row, dict):
            continue
        source_refs = row.get("sourceRefs", [])
        if not isinstance(source_refs, list):
            continue
        for source_ref in source_refs:
            if not isinstance(source_ref, dict) or source_ref.get("kind") != "sn_stock_order_export":
                continue
            raw_order_number = str(source_ref.get("documentNumber") or "").strip()
            order_number, external_order_number = _canonical_sales_order_number(raw_order_number)
            if not order_number.startswith("XS"):
                continue
            item = _ensure_order_registry_row(registry, order_number, timestamp)
            if external_order_number and external_order_number != order_number:
                item["external_order_number"] = item["external_order_number"] or external_order_number
            item["seen_in_sn_stock_order"] = 1
            item["business_date"] = _prefer_precise_business_datetime(item["business_date"], source_ref.get("capturedAt"))
            sku_key = str(row.get("skuKey") or "").strip()
            serial_number = str(row.get("serialNumber") or "").strip()
            product_name = str(row.get("productName") or "").strip()
            file_path = str(source_ref.get("filePath") or "").strip()
            if sku_key:
                item["sku_keys"].add(sku_key)
                item["sample_sku_key"] = item["sample_sku_key"] or sku_key
            if serial_number:
                item["serial_numbers"].add(serial_number)
                item["sample_serial_number"] = item["sample_serial_number"] or serial_number
            item["sample_product_name"] = item["sample_product_name"] or product_name
            if file_path:
                item["source_files"].add(file_path)

    active_gap_ids: set[str] = set()
    upserted = 0
    for item in registry.values():
        business_day = extract_business_date(item.get("business_date"))
        is_recent_for_gap = bool(business_day and business_day >= gap_window_start)
        missing_fields: list[str] = []
        gaps: list[tuple[str, str, str]] = []
        if is_recent_for_gap and item["seen_in_sn_stock_order"] and not item["seen_in_stock_stream"]:
            missing_fields.extend(["inventory_movement", "frontend_movement"])
            gaps.append(("sn_only_missing_movement", "critical", "SN 订单导出已出现该销售单，但库存流水和前端出库流水均未闭环。"))
        if is_recent_for_gap and item["seen_in_stock_stream"] and not item["seen_in_sales_export"]:
            missing_fields.append("sales_order_amount_snapshot")
            gaps.append(("missing_sales_order_snapshot", "warning", "库存流水已出现销售出库，但 orderData/orderProductData 销售金额快照未覆盖。"))
        if is_recent_for_gap and item["seen_in_sales_export"] and not item["seen_in_stock_stream"]:
            missing_fields.append("inventory_movement")
            gaps.append(("missing_inventory_movement", "critical", "销售金额快照已出现该订单，但库存流水未出现对应销售出库。"))
        item["missing_fields"] = sorted(set(missing_fields))
        if not is_recent_for_gap:
            item["status"] = "closed"
            item["message"] = f"历史订单（{item.get('business_date') or 'unknown'}）缺口已归档，不阻塞当日采集。"
        else:
            item["status"] = "closed" if not gaps else "pending_reconcile"
            item["message"] = "订单闭环完成" if not gaps else "；".join(gap[2] for gap in gaps)
        conn.execute(
            """
            INSERT INTO order_sync_registry
            (order_number, external_order_number, business_date, order_type,
             sku_keys_json, serial_numbers_json, seen_in_stock_stream,
             seen_in_sn_stock_order, seen_in_sales_export,
             seen_in_frontend_sales_orders, seen_in_frontend_movements,
             status, missing_fields_json, source_files_json, message, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_number) DO UPDATE SET
              business_date = excluded.business_date,
              sku_keys_json = excluded.sku_keys_json,
              serial_numbers_json = excluded.serial_numbers_json,
              seen_in_stock_stream = excluded.seen_in_stock_stream,
              seen_in_sn_stock_order = excluded.seen_in_sn_stock_order,
              seen_in_sales_export = excluded.seen_in_sales_export,
              seen_in_frontend_sales_orders = excluded.seen_in_frontend_sales_orders,
              seen_in_frontend_movements = excluded.seen_in_frontend_movements,
              status = excluded.status,
              missing_fields_json = excluded.missing_fields_json,
              source_files_json = excluded.source_files_json,
              message = excluded.message,
              updated_at = excluded.updated_at
            """,
            (
                item["order_number"], item["external_order_number"], item["business_date"], item["order_type"],
                _json_list(item["sku_keys"]), _json_list(item["serial_numbers"]),
                item["seen_in_stock_stream"], item["seen_in_sn_stock_order"], item["seen_in_sales_export"],
                item["seen_in_frontend_sales_orders"], item["seen_in_frontend_movements"],
                item["status"], json.dumps(item["missing_fields"], ensure_ascii=False),
                _json_list(item["source_files"]), item["message"], item["created_at"], item["updated_at"],
            ),
        )
        upserted += 1
        source_flags = {
            "stockStream": bool(item["seen_in_stock_stream"]),
            "snStockOrder": bool(item["seen_in_sn_stock_order"]),
            "salesExport": bool(item["seen_in_sales_export"]),
            "frontendSalesOrders": bool(item["seen_in_frontend_sales_orders"]),
            "frontendMovements": bool(item["seen_in_frontend_movements"]),
        }
        for gap_type, severity, message in gaps:
            gap_id = f"{item['order_number']}:{gap_type}"
            active_gap_ids.add(gap_id)
            conn.execute(
                """
                INSERT INTO sync_gap_queue
                (id, order_number, external_order_number, gap_type, status, severity,
                 business_date, sku_key, product_name, serial_number, missing_fields_json,
                 source_flags_json, message, source_files_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  status = 'open',
                  severity = excluded.severity,
                  business_date = excluded.business_date,
                  sku_key = excluded.sku_key,
                  product_name = excluded.product_name,
                  serial_number = excluded.serial_number,
                  missing_fields_json = excluded.missing_fields_json,
                  source_flags_json = excluded.source_flags_json,
                  message = excluded.message,
                  source_files_json = excluded.source_files_json,
                  updated_at = excluded.updated_at
                """,
                (
                    gap_id, item["order_number"], item["external_order_number"], gap_type, severity,
                    item["business_date"], item["sample_sku_key"], item["sample_product_name"],
                    item["sample_serial_number"], json.dumps(item["missing_fields"], ensure_ascii=False),
                    _json_object(source_flags), message, _json_list(item["source_files"]), timestamp, timestamp,
                ),
            )
    if active_gap_ids:
        placeholders = ",".join("?" for _ in active_gap_ids)
        conn.execute(
            f"UPDATE sync_gap_queue SET status = 'resolved', updated_at = ? WHERE status = 'open' AND id NOT IN ({placeholders})",
            (timestamp, *sorted(active_gap_ids)),
        )
    else:
        conn.execute("UPDATE sync_gap_queue SET status = 'resolved', updated_at = ? WHERE status = 'open'", (timestamp,))
    return upserted


def refresh_order_sync_registry(data_dir: Path) -> int:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        return sync_order_sync_registry(conn, data_dir, timestamp)


def load_serial_overrides(data_dir: Path) -> dict[str, dict[str, Any]]:
    path = data_dir / "latest-serial-overrides.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    overrides = payload.get("overrides", {})
    if not isinstance(overrides, dict):
        return {}
    return {str(key): value for key, value in overrides.items() if isinstance(value, dict)}


def load_warranty_snapshot(data_dir: Path) -> list[dict[str, Any]]:
    path = data_dir / "latest-lenovo-warranty-snapshot.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    records = payload.get("records", [])
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)]


def load_zhidiantong_sales_orders_snapshot() -> list[dict[str, Any]]:
    path = ARTIFACT_DIR / "latest-zhidiantong-sales-orders.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    orders = payload.get("orders", []) if isinstance(payload, dict) else []
    if not isinstance(orders, list):
        return []
    return [order for order in orders if isinstance(order, dict)]


def _load_json_payload(data_dir: Path, name: str) -> dict[str, Any]:
    path = data_dir / name
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def sync_snapshot_cache(data_dir: Path, snapshot_names: list[str]) -> dict[str, int]:
    init_db()
    synced = 0
    skipped = 0
    with connect() as conn:
        for snapshot_name in snapshot_names:
            path = data_dir / snapshot_name
            if not path.exists():
                skipped += 1
                continue
            stat = path.stat()
            current = conn.execute(
                "SELECT file_mtime_ns FROM snapshot_cache WHERE snapshot_name = ?",
                (snapshot_name,),
            ).fetchone()
            cached_mtime = int(current["file_mtime_ns"]) if current else -1
            if cached_mtime == int(stat.st_mtime_ns):
                skipped += 1
                continue
            payload = _load_json_payload(data_dir, snapshot_name)
            generated_at = str(payload.get("generatedAt") or payload.get("updatedAt") or "")
            source_system = str(payload.get("source") or "snapshot_file")
            conn.execute(
                """
                INSERT INTO snapshot_cache
                (snapshot_name, payload_json, source_file, source_system, generated_at, file_mtime_ns, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(snapshot_name) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  source_file = excluded.source_file,
                  source_system = excluded.source_system,
                  generated_at = excluded.generated_at,
                  file_mtime_ns = excluded.file_mtime_ns,
                  synced_at = excluded.synced_at
                """,
                (
                    snapshot_name,
                    json.dumps(payload, ensure_ascii=False),
                    str(path),
                    source_system,
                    generated_at,
                    int(stat.st_mtime_ns),
                    now_iso(),
                ),
            )
            synced += 1
    return {"syncedCount": synced, "skippedCount": skipped}


def get_snapshot_cache(snapshot_name: str, *, default: dict[str, Any] | None = None) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT payload_json FROM snapshot_cache WHERE snapshot_name = ?",
            (snapshot_name,),
        ).fetchone()
    if not row:
        return default or {}
    try:
        payload = json.loads(str(row["payload_json"] or "{}"))
    except json.JSONDecodeError:
        return default or {}
    return payload if isinstance(payload, dict) else (default or {})


def _find_projection_item(data_dir: Path, sku_key: str) -> dict[str, Any]:
    projection = get_snapshot_cache("latest-published-product-projection.json", default={"items": []})
    items = projection.get("items", []) if isinstance(projection, dict) else []
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and str(item.get("skuKey") or "") == sku_key:
                return item
    path = data_dir / "latest-published-product-projection.json"
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        items = payload.get("items", []) if isinstance(payload, dict) else []
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and str(item.get("skuKey") or "") == sku_key:
                    return item
    return {}


def _price_tag_title(item: dict[str, Any]) -> str:
    for key in ("displayTitle", "displayName", "productName"):
        value = str(item.get(key) or "").strip()
        if value:
            return value
    pn_mtm = str(item.get("pnMtm") or "").strip()
    return pn_mtm or "未命名商品"


def _resolve_price_tag_binding(sku_key: str, store_code: str) -> dict[str, Any] | None:
    init_db()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT b.id,
                   b.device_id,
                   b.sku_key,
                   b.store_code,
                   b.status,
                   b.updated_at,
                   d.vendor,
                   d.model,
                   d.status AS device_status,
                   d.last_seen_at
            FROM price_tag_binding b
            LEFT JOIN price_tag_device d
              ON d.id = b.device_id
            WHERE b.sku_key = ?
              AND b.store_code = ?
              AND b.status = 'active'
            ORDER BY b.updated_at DESC
            LIMIT 1
            """,
            (sku_key, store_code),
        ).fetchone()
    return dict(row) if row else None


def build_price_tag_payload(
    data_dir: Path,
    *,
    sku_key: str,
    store_code: str = "LENOVO-SR-001",
    override_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item = _find_projection_item(data_dir, sku_key)
    pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
    marketing = item.get("marketingPoActivity") if isinstance(item.get("marketingPoActivity"), dict) else None
    education = item.get("educationActivity") if isinstance(item.get("educationActivity"), dict) else None
    manual_promotion = item.get("storeManualPromotion") if isinstance(item.get("storeManualPromotion"), dict) else None
    barcode_value = str(item.get("pnMtm") or sku_key or "").strip()
    base_payload: dict[str, Any] = {
        "skuKey": sku_key,
        "storeCode": store_code,
        "productName": _price_tag_title(item),
        "pnMtm": str(item.get("pnMtm") or "").strip(),
        "spec": str(item.get("spec") or "").strip(),
        "category": str(item.get("category") or "").strip(),
        "barcodeValue": barcode_value,
        "pricing": {
            "storeRetailPrice": pricing.get("storeRetailPrice"),
            "adjustedPreSubsidyPrice": pricing.get("adjustedPreSubsidyPrice"),
            "nationalSubsidyPrice": pricing.get("nationalSubsidyPrice"),
            "finalPrice": pricing.get("finalPrice"),
            "marketingPoAmount": pricing.get("marketingPoAmount"),
            "educationDiscountAmount": pricing.get("educationDiscountAmount"),
            "storeManualPromotionAmount": pricing.get("storeManualPromotionAmount"),
            "effectiveFrom": pricing.get("effectiveFrom"),
            "effectiveTo": pricing.get("effectiveTo"),
            "countdownDays": pricing.get("countdownDays"),
            "priceVersion": pricing.get("priceVersion"),
        },
        "activities": {
            "marketingPoActivity": marketing,
            "educationActivity": education,
            "storeManualPromotion": manual_promotion,
        },
        "labelPayload": {
            "title": _price_tag_title(item),
            "subtitle": str(item.get("spec") or item.get("category") or "").strip(),
            "barcodeValue": barcode_value,
            "storeRetailPrice": pricing.get("storeRetailPrice"),
            "adjustedPreSubsidyPrice": pricing.get("adjustedPreSubsidyPrice"),
            "nationalSubsidyPrice": pricing.get("nationalSubsidyPrice"),
            "finalPrice": pricing.get("finalPrice"),
            "effectiveFrom": pricing.get("effectiveFrom"),
            "effectiveTo": pricing.get("effectiveTo"),
            "countdownDays": pricing.get("countdownDays"),
            "marketingPoLabel": marketing.get("label") if marketing else "",
            "marketingPoAmount": marketing.get("amount") if marketing else pricing.get("marketingPoAmount"),
            "educationLabel": education.get("label") if education else "",
            "educationAmount": education.get("amount") if education else pricing.get("educationDiscountAmount"),
        },
        "source": "sql_published_projection",
        "cloudActivationState": "pending_gateway_activation",
    }
    if override_payload:
        base_payload.update({key: value for key, value in override_payload.items() if key not in {"pricing", "activities", "labelPayload"}})
        if isinstance(override_payload.get("pricing"), dict):
            base_payload["pricing"] = {**base_payload["pricing"], **override_payload["pricing"]}
        if isinstance(override_payload.get("activities"), dict):
            base_payload["activities"] = {**base_payload["activities"], **override_payload["activities"]}
        if isinstance(override_payload.get("labelPayload"), dict):
            base_payload["labelPayload"] = {**base_payload["labelPayload"], **override_payload["labelPayload"]}
    return base_payload


def list_price_tag_devices() -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, vendor, model, store_code, status, battery_level, signal_level, last_seen_at, created_at
            FROM price_tag_device
            ORDER BY created_at DESC, id
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_price_tag_templates() -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, name, template_type, payload_json, created_at
            FROM price_tag_template
            ORDER BY created_at DESC, id
            """
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["payload"] = json.loads(item.pop("payload_json", "{}"))
        except json.JSONDecodeError:
            item["payload"] = {}
        items.append(item)
    return items


def list_price_tag_bindings() -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT b.id, b.device_id, b.sku_key, b.store_code, b.status, b.updated_at,
                   d.vendor, d.model, d.status AS device_status
            FROM price_tag_binding b
            LEFT JOIN price_tag_device d
              ON d.id = b.device_id
            ORDER BY b.updated_at DESC, b.id
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_price_tag_update_tasks(limit: int = 20) -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, device_id, sku_key, template_id, price_payload_json, status,
                   retry_count, last_error, created_at, updated_at
            FROM price_tag_update_task
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["pricePayload"] = json.loads(item.pop("price_payload_json", "{}"))
        except json.JSONDecodeError:
            item["pricePayload"] = {}
        items.append(item)
    return items


def get_price_tag_console_status(data_dir: Path, *, store_code: str = "LENOVO-SR-001") -> dict[str, Any]:
    init_db()
    with connect() as conn:
        gateway = conn.execute(
            "SELECT id, name, system_type, status, created_at FROM external_system WHERE id = 'price_tag_gateway'"
        ).fetchone()
        pending_count = int(conn.execute("SELECT COUNT(*) AS count FROM price_tag_update_task WHERE status = 'pending'").fetchone()["count"])
    templates = list_price_tag_templates()
    devices = list_price_tag_devices()
    bindings = list_price_tag_bindings()
    tasks = list_price_tag_update_tasks(limit=20)
    return {
        "generatedAt": now_iso(),
        "storeCode": store_code,
        "gateway": dict(gateway) if gateway else {
            "id": "price_tag_gateway",
            "name": "电子价签网关",
            "system_type": "electronic_shelf_label",
            "status": "planned",
            "created_at": "",
        },
        "counts": {
            "templateCount": len(templates),
            "deviceCount": len(devices),
            "bindingCount": len(bindings),
            "pendingTaskCount": pending_count,
        },
        "templates": templates,
        "devices": devices,
        "bindings": bindings[:50],
        "tasks": tasks,
        "cloudReadiness": "pending_gateway_activation" if not devices else "binding_ready_waiting_gateway_activation",
        "source": "retail_core.price_tag_console",
    }


def upsert_price_tag_device(
    *,
    device_id: str,
    vendor: str,
    model: str,
    store_code: str,
    status: str = "planned",
    battery_level: int | None = None,
    signal_level: int | None = None,
    last_seen_at: str | None = None,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO price_tag_device
            (id, vendor, model, store_code, status, battery_level, signal_level, last_seen_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              vendor = excluded.vendor,
              model = excluded.model,
              store_code = excluded.store_code,
              status = excluded.status,
              battery_level = excluded.battery_level,
              signal_level = excluded.signal_level,
              last_seen_at = excluded.last_seen_at
            """,
            (device_id, vendor, model, store_code, status, battery_level, signal_level, last_seen_at, timestamp),
        )
    return {"id": device_id, "vendor": vendor, "model": model, "storeCode": store_code, "status": status}


def upsert_price_tag_template(
    *,
    template_id: str,
    name: str,
    template_type: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO price_tag_template
            (id, name, template_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              template_type = excluded.template_type,
              payload_json = excluded.payload_json
            """,
            (template_id, name, template_type, json.dumps(payload or {}, ensure_ascii=False), timestamp),
        )
    return {"id": template_id, "name": name, "templateType": template_type}


def upsert_price_tag_binding(
    *,
    binding_id: str,
    device_id: str,
    sku_key: str,
    store_code: str,
    status: str = "active",
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO price_tag_binding
            (id, device_id, sku_key, store_code, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              device_id = excluded.device_id,
              sku_key = excluded.sku_key,
              store_code = excluded.store_code,
              status = excluded.status,
              updated_at = excluded.updated_at
            """,
            (binding_id, device_id, sku_key, store_code, status, timestamp),
        )
    return {"id": binding_id, "deviceId": device_id, "skuKey": sku_key, "storeCode": store_code, "status": status}


def save_snapshot_cache(
    data_dir: Path,
    snapshot_name: str,
    payload: dict[str, Any],
    *,
    source_system: str = "api_snapshot_write",
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized = dict(payload)
    normalized.setdefault("generatedAt", timestamp)
    normalized.setdefault("source", source_system)
    web_path = data_dir / snapshot_name
    artifact_path = ARTIFACT_DIR / snapshot_name
    web_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    payload_text = json.dumps(normalized, ensure_ascii=False, indent=2)
    web_path.write_text(payload_text, encoding="utf-8")
    artifact_path.write_text(payload_text, encoding="utf-8")
    stat = web_path.stat()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO snapshot_cache
            (snapshot_name, payload_json, source_file, source_system, generated_at, file_mtime_ns, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(snapshot_name) DO UPDATE SET
              payload_json = excluded.payload_json,
              source_file = excluded.source_file,
              source_system = excluded.source_system,
              generated_at = excluded.generated_at,
              file_mtime_ns = excluded.file_mtime_ns,
              synced_at = excluded.synced_at
            """,
            (
                snapshot_name,
                json.dumps(normalized, ensure_ascii=False),
                str(web_path),
                source_system,
                str(normalized.get("generatedAt") or timestamp),
                int(stat.st_mtime_ns),
                timestamp,
            ),
        )
    return {
        "snapshot": normalized,
        "webPath": str(web_path),
        "artifactPath": str(artifact_path),
    }


def _derive_stock_age_days(value: str) -> int | None:
    inbound_day = extract_business_date(value)
    if not inbound_day:
        return None
    try:
        return max((datetime.now(timezone.utc).date() - inbound_day).days, 0)
    except Exception:
        return None


def _build_sql_inventory_categories(skus: list[dict[str, Any]]) -> list[dict[str, Any]]:
    category_map: dict[str, dict[str, Any]] = {}
    for sku in skus:
        category = str(sku.get("category") or "未分类").strip() or "未分类"
        current = category_map.setdefault(category, {
            "category": category,
            "skuCount": 0,
            "currentStock": 0,
            "sellableStock": 0,
            "unsellableStock": 0,
            "pendingInboundStock": 0,
            "serialCount": 0,
            "topSkus": [],
        })
        current["skuCount"] += 1
        current["currentStock"] += int(sku.get("currentStock") or 0)
        current["sellableStock"] += int(sku.get("sellableStock") or 0)
        current["unsellableStock"] += int(sku.get("unsellableStock") or 0)
        current["pendingInboundStock"] += int(sku.get("pendingInboundStock") or 0)
        current["serialCount"] += int(sku.get("serialCount") or 0)
        current["topSkus"].append({
            "skuKey": str(sku.get("skuKey") or ""),
            "productName": str(sku.get("productName") or ""),
            "pnMtm": str(sku.get("pnMtm") or ""),
            "currentStock": int(sku.get("currentStock") or 0),
            "sellableStock": int(sku.get("sellableStock") or 0),
            "unsellableStock": int(sku.get("unsellableStock") or 0),
        })
    return [
        {
            **item,
            "topSkus": sorted(
                item["topSkus"],
                key=lambda row: (-int(row.get("currentStock") or 0), -int(row.get("sellableStock") or 0), str(row.get("skuKey") or "")),
            )[:5],
        }
        for item in sorted(
            category_map.values(),
            key=lambda row: (-int(row["currentStock"]), -int(row["sellableStock"]), str(row["category"])),
        )
    ]


def build_standard_inventory_snapshot_from_sql() -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        sku_rows = conn.execute(
            """
            SELECT sku.product_id, sku.sku_key, sku.pn_mtm, sku.name, sku.category,
                   sku.source_category, sku.jd_subcategory, sku.catalog_source,
                   sku.sellable_stock, sku.current_stock, sku.updated_at,
                   product.name AS product_name
            FROM sku
            LEFT JOIN product ON product.id = sku.product_id
            ORDER BY COALESCE(sku.current_stock, 0) DESC, sku.sku_key
            """
        ).fetchall()
        serial_rows = conn.execute(
            """
            SELECT serial_number, sku_key, product_name, pn_mtm, spec, status,
                   warehouse_code, location_code, inbound_date, inbound_document_no, operator_name, supplier_name,
                   cost_amount
            FROM serial_item
            ORDER BY updated_at DESC, serial_number
            """
        ).fetchall()
        active_hold_rows = conn.execute(
            """
            SELECT hold.serial_number, hold.sku_key, hold.warehouse_code, hold.location_code,
                   hold.created_at, hold.updated_at,
                   serial_item.product_name, serial_item.pn_mtm, serial_item.spec,
                   serial_item.inbound_date, serial_item.inbound_document_no, serial_item.operator_name,
                   serial_item.supplier_name, serial_item.cost_amount
            FROM physical_stock_hold AS hold
            LEFT JOIN serial_item ON serial_item.serial_number = hold.serial_number
            WHERE hold.hold_status = 'active'
            ORDER BY hold.updated_at DESC, hold.serial_number
            """
        ).fetchall()
        hold_count_by_sku = _physical_hold_count_by_sku(conn)

    serials_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in serial_rows:
        sku_key = str(row["sku_key"] or "").strip()
        if not sku_key or str(row["status"] or "").strip() != "in_stock":
            continue
        serials_by_sku.setdefault(sku_key, []).append({
            "serialNumber": str(row["serial_number"] or "").strip(),
            "productName": str(row["product_name"] or "").strip() or None,
            "pnMtm": str(row["pn_mtm"] or "").strip() or None,
            "spec": str(row["spec"] or "").strip() or None,
            "organizationName": "联想体验店（新野县书院路）",
            "warehouseCode": str(row["warehouse_code"] or "").strip() or None,
            "inboundDate": str(row["inbound_date"] or "").strip() or None,
            "purchaseCost": normalize_purchase_cost_amount(row["cost_amount"]),
            "inboundDocumentNumber": str(row["inbound_document_no"] or "").strip() or None,
            "inboundOperatorName": str(row["operator_name"] or "").strip() or None,
            "supplierName": str(row["supplier_name"] or "").strip() or None,
            "locationName": str(row["location_code"] or "").strip() or None,
            "stockAgeDays": _derive_stock_age_days(str(row["inbound_date"] or "")),
            "isPhysicalHold": is_physical_hold_location(row["warehouse_code"], row["location_code"]),
        })
    active_hold_serials_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in active_hold_rows:
        sku_key = str(row["sku_key"] or "").strip()
        serial_number = str(row["serial_number"] or "").strip()
        if not sku_key or not serial_number:
            continue
        active_hold_serials_by_sku.setdefault(sku_key, []).append({
            "serialNumber": serial_number,
            "productName": str(row["product_name"] or "").strip() or None,
            "pnMtm": str(row["pn_mtm"] or "").strip() or None,
            "spec": str(row["spec"] or "").strip() or None,
            "organizationName": "联想体验店（新野县书院路）",
            "warehouseCode": str(row["warehouse_code"] or "").strip() or "PO_HOLD",
            "inboundDate": str(row["inbound_date"] or row["created_at"] or "").strip() or None,
            "purchaseCost": normalize_purchase_cost_amount(row["cost_amount"]),
            "inboundDocumentNumber": str(row["inbound_document_no"] or "").strip() or None,
            "inboundOperatorName": str(row["operator_name"] or "").strip() or None,
            "supplierName": str(row["supplier_name"] or "").strip() or None,
            "locationName": str(row["location_code"] or "").strip() or None,
            "stockAgeDays": _derive_stock_age_days(str(row["inbound_date"] or row["created_at"] or "")),
            "isPhysicalHold": True,
        })

    skus: list[dict[str, Any]] = []
    totals = {
        "skuCount": 0,
        "currentStock": 0,
        "sellableStock": 0,
        "occupiedStock": 0,
        "unsellableStock": 0,
        "pendingInboundStock": 0,
        "serialCount": 0,
        "unmatchedSerialCount": 0,
        "physicalHoldStock": 0,
    }
    warnings: list[str] = []
    for row in sku_rows:
        sku_key = str(row["sku_key"] or "").strip()
        current_stock = int(row["current_stock"] or 0)
        sellable_stock = int(row["sellable_stock"] or 0)
        normalized_category = normalize_product_category_fields(
            row["category"],
            row["source_category"],
            row["jd_subcategory"],
            row["name"] or row["product_name"],
            "",
            row["pn_mtm"],
            row["catalog_source"],
        )
        raw_serials = serials_by_sku.get(sku_key, [])
        regular_serials = [serial for serial in raw_serials if not bool(serial.get("isPhysicalHold"))]
        hold_serials = active_hold_serials_by_sku.get(sku_key, [])
        hold_stock = max(hold_count_by_sku.get(sku_key, 0), 0)
        # sku.current_stock / sku.sellable_stock 保持智店通日导数真值。
        # PO / 教育补实物仓只走独立 hold 维度展示，不能再叠加回 current/sellable，
        # 否则转仓后前端会出现 currentStock 与 physicalHoldStock 双计。
        effective_current_stock = current_stock
        effective_sellable_stock = sellable_stock
        # 智店通商品库存数量快照是库存真值；serial_item 里可能保留了历史/未核销 SN。
        # 前端库存展示不能用超量 SN 反向抬高库存，只展示不超过当前库存数量的在库 SN。
        visible_regular_serials = regular_serials[:max(current_stock, 0)]
        visible_hold_serials = hold_serials[:max(hold_stock, 0)]
        visible_serials = visible_regular_serials + visible_hold_serials
        raw_serial_count = len(regular_serials) + len(hold_serials)
        serial_count = len(visible_serials)
        effective_total_stock = current_stock + hold_stock
        unmatched = max(effective_total_stock - raw_serial_count, 0)
        excess_serial_count = max(raw_serial_count - effective_total_stock, 0)
        quality_warnings: list[str] = []
        if unmatched > 0:
            quality_warnings.append(f"有效实物库存 {effective_total_stock} 台，但仅有 {raw_serial_count} 条在库SN，待补SN {unmatched} 条。")
        if excess_serial_count > 0:
            quality_warnings.append(
                f"有效实物库存 {effective_total_stock} 台，但SN台账仍有 {raw_serial_count} 条在库SN，多出 {excess_serial_count} 条；前端已按有效库存数量截断展示。"
            )
        sku_payload = {
            "skuKey": sku_key,
            "productName": str(row["name"] or row["product_name"] or "").strip(),
            "pnMtm": str(row["pn_mtm"] or "").strip() or None,
            "spec": None,
            "category": normalized_category["category"],
            "sourceCategory": normalized_category["sourceCategory"] or None,
            "jdSubcategory": normalized_category["jdSubcategory"] or None,
            "catalogSource": normalized_category["catalogSource"] or None,
            "productCode": str(row["product_id"] or "").strip() or None,
            "skuCode": sku_key,
            "organizationName": "联想体验店（新野县书院路）",
            "organizationCode": "D0186124",
            "stockType": "SQL实时库存",
            "currentStock": effective_current_stock,
            "sellableStock": effective_sellable_stock,
            "occupiedStock": 0,
            "unsellableStock": 0,
            "pendingInboundStock": 0,
            "serialCount": serial_count,
            "physicalHoldStock": hold_stock,
            "physicalHoldSerialCount": len(visible_hold_serials),
            "serials": visible_serials,
            "dataQuality": {
                "stockAndSerialMatched": unmatched == 0 and excess_serial_count == 0,
                "stockQuantityDiff": effective_total_stock - raw_serial_count,
                "rawSerialCount": raw_serial_count,
                "visibleSerialCount": serial_count,
                "excessSerialCount": excess_serial_count,
                "warnings": quality_warnings,
            },
        }
        skus.append(sku_payload)
        totals["skuCount"] += 1
        totals["currentStock"] += effective_current_stock
        totals["sellableStock"] += effective_sellable_stock
        totals["serialCount"] += serial_count
        totals["unmatchedSerialCount"] += unmatched
        totals["physicalHoldStock"] = int(totals.get("physicalHoldStock", 0)) + hold_stock
        totals["excessSerialCount"] = int(totals.get("excessSerialCount", 0)) + excess_serial_count
        if unmatched > 0:
            warnings.append(f"{sku_key} 缺少 {unmatched} 条在库SN。")
        if excess_serial_count > 0:
            warnings.append(f"{sku_key} SN台账多出 {excess_serial_count} 条，已按智店通库存数量截断前端展示。")

    return {
        "source": "sqlite.retail_core",
        "generatedAt": timestamp,
        "storeName": "联想体验店（新野县书院路）",
        "organizationCode": "D0186124",
        "totals": totals,
        "dataQuality": {
            "stockAndSerialScopeLikelyMatched": totals["serialCount"] <= totals["currentStock"],
            "warnings": warnings,
        },
        "categories": _build_sql_inventory_categories(skus),
        "skus": skus,
        "files": {
            "stockQuantityFile": str(DB_FILE),
            "stockSnFile": str(DB_FILE),
        },
    }


def build_inventory_master_snapshot_from_sql() -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        sku_rows = conn.execute(
            """
            SELECT sku.product_id, sku.sku_key, sku.pn_mtm, sku.name, sku.category,
                   sku.source_category, sku.jd_subcategory, sku.catalog_source,
                   sku.sellable_stock, sku.current_stock
            FROM sku
            ORDER BY COALESCE(sku.current_stock, 0) DESC, sku.sku_key
            """
        ).fetchall()
        serial_rows = conn.execute(
            """
            SELECT serial_number, sku_key, product_name, pn_mtm, spec, status,
                   warehouse_code, location_code, cost_amount, inbound_date,
                   inbound_document_no, operator_name, supplier_name,
                   warranty_status, updated_at
            FROM serial_item
            ORDER BY sku_key, updated_at DESC, serial_number
            """
        ).fetchall()
        active_hold_rows = conn.execute(
            """
            SELECT serial_number, sku_key
            FROM physical_stock_hold
            WHERE hold_status = 'active'
            ORDER BY updated_at DESC, serial_number
            """
        ).fetchall()
        hold_count_by_sku = _physical_hold_count_by_sku(conn)
        movement_rows = conn.execute(
            """
            SELECT serial_number, movement_type, business_date, source_ref, location_name, operator_name, note
            FROM inventory_movement
            WHERE TRIM(COALESCE(serial_number, '')) <> ''
            ORDER BY business_date DESC, created_at DESC
            """
        ).fetchall()

    latest_movement_by_serial: dict[str, sqlite3.Row] = {}
    for row in movement_rows:
        serial_number = str(row["serial_number"] or "").strip()
        if serial_number and serial_number not in latest_movement_by_serial:
            latest_movement_by_serial[serial_number] = row

    serials_by_sku: dict[str, list[sqlite3.Row]] = {}
    for row in serial_rows:
        sku_key = str(row["sku_key"] or "").strip()
        if sku_key:
            serials_by_sku.setdefault(sku_key, []).append(row)
    active_hold_serials_by_sku: dict[str, set[str]] = {}
    for row in active_hold_rows:
        sku_key = str(row["sku_key"] or "").strip()
        serial_number = str(row["serial_number"] or "").strip()
        if sku_key and serial_number:
            active_hold_serials_by_sku.setdefault(sku_key, set()).add(serial_number)

    rows: list[dict[str, Any]] = []
    exceptions: list[dict[str, Any]] = []
    row_with_inbound_date = 0
    row_with_inbound_document = 0
    row_with_latest_movement = 0
    in_stock_row_count = 0
    sku_without_serial_count = 0

    for sku_row in sku_rows:
        sku_key = str(sku_row["sku_key"] or "").strip()
        current_stock = int(sku_row["current_stock"] or 0)
        sellable_stock = int(sku_row["sellable_stock"] or 0)
        hold_stock = max(hold_count_by_sku.get(sku_key, 0), 0)
        effective_current_stock = current_stock
        effective_sellable_stock = sellable_stock
        effective_total_stock = current_stock + hold_stock
        normalized_sku_category = normalize_product_category_fields(
            sku_row["category"],
            sku_row["source_category"],
            sku_row["jd_subcategory"],
            sku_row["name"],
            "",
            sku_row["pn_mtm"],
            sku_row["catalog_source"],
        )
        serial_group = serials_by_sku.get(sku_key, [])
        raw_in_stock_serials = [row for row in serial_group if str(row["status"] or "").strip() == "in_stock"]
        regular_in_stock_serials = [
            row for row in raw_in_stock_serials
            if not is_physical_hold_location(row["warehouse_code"], row["location_code"])
        ]
        hold_in_stock_serials = [
            row for row in raw_in_stock_serials
            if is_physical_hold_location(row["warehouse_code"], row["location_code"])
            and str(row["serial_number"] or "").strip() in active_hold_serials_by_sku.get(sku_key, set())
        ]
        visible_in_stock_serials = (
            regular_in_stock_serials[:max(current_stock, 0)]
            + hold_in_stock_serials[:max(hold_stock, 0)]
        )
        visible_in_stock_serial_numbers = {
            str(row["serial_number"] or "").strip()
            for row in visible_in_stock_serials
            if str(row["serial_number"] or "").strip()
        }
        if effective_total_stock > 0 and not raw_in_stock_serials:
            sku_without_serial_count += 1
            exceptions.append({
                "type": "sku_without_serials",
                "skuKey": sku_key,
                "message": f"SKU {sku_key} 有效实物库存为 {effective_total_stock}，但没有在库SN。",
                "sourceFile": str(DB_FILE),
            })

        for serial_row in serial_group:
            normalized_serial_category = normalize_product_category_fields(
                sku_row["category"],
                sku_row["source_category"],
                sku_row["jd_subcategory"],
                serial_row["product_name"] or sku_row["name"],
                serial_row["spec"],
                serial_row["pn_mtm"] or sku_row["pn_mtm"],
                sku_row["catalog_source"],
            )
            serial_number = str(serial_row["serial_number"] or "").strip()
            status = str(serial_row["status"] or "").strip()
            raw_status = status
            stock_count_excess = status == "in_stock" and serial_number not in visible_in_stock_serial_numbers
            if stock_count_excess:
                status = "stock_count_excess"
            latest = latest_movement_by_serial.get(serial_number)
            inbound_date = str(serial_row["inbound_date"] or "").strip()
            inbound_document_no = str(serial_row["inbound_document_no"] or "").strip()
            movement_type = str(latest["movement_type"] or "").strip() if latest else ""
            movement_date = str(latest["business_date"] or "").strip() if latest else ""
            if not movement_type and inbound_date:
                movement_type = "purchase_inbound"
            if not movement_date and inbound_date:
                movement_date = inbound_date
            row = {
                "serialNumber": serial_number,
                "skuKey": sku_key,
                "skuCode": sku_key,
                "productCode": str(sku_row["product_id"] or "").strip() or None,
                "pnMtm": str(serial_row["pn_mtm"] or sku_row["pn_mtm"] or "").strip() or None,
                "productName": str(serial_row["product_name"] or sku_row["name"] or "").strip(),
                "spec": str(serial_row["spec"] or "").strip() or None,
                "category": normalized_serial_category["category"] or None,
                "organizationName": "联想体验店（新野县书院路）",
                "organizationCode": "D0186124",
                "stockType": "SQL实时库存",
                "currentStock": 1 if status == "in_stock" else 0,
                "sellableStock": 1 if status == "in_stock" and effective_sellable_stock > 0 else 0,
                "skuCurrentStock": effective_current_stock,
                "skuSellableStock": effective_sellable_stock,
                "occupiedStock": 0,
                "unsellableStock": 0,
                "pendingInboundStock": 0,
                "serialCountWithinSku": len(visible_in_stock_serials),
                "rawSerialCountWithinSku": len(raw_in_stock_serials),
                "stockCountExcess": stock_count_excess,
                "physicalHold": is_physical_hold_location(serial_row["warehouse_code"], serial_row["location_code"]),
                "physicalHoldStockWithinSku": hold_stock,
                "inStock": status == "in_stock",
                "lifecycleStatus": status or None,
                "rawLifecycleStatus": raw_status or None,
                "stockAgeDays": _derive_stock_age_days(inbound_date),
                "inboundDate": inbound_date or None,
                "purchaseCost": normalize_purchase_cost_amount(serial_row["cost_amount"]),
                "inboundDocumentNumber": inbound_document_no or None,
                "inboundOperatorName": str(serial_row["operator_name"] or "").strip() or None,
                "supplierName": str(serial_row["supplier_name"] or "").strip() or None,
                "locationName": str(serial_row["location_code"] or "").strip() or None,
                "dataQuality": {
                    "warnings": (
                        ["智店通库存数量小于SN台账在库数，本条标记为超量SN，不参与当前库存台账。"]
                        if stock_count_excess else []
                    )
                },
                "latestBusinessDate": movement_date or None,
                "latestDocumentType": "业务订单" if latest or inbound_date else None,
                "latestMovementType": movement_type or None,
                "latestOperatorName": str(latest["operator_name"] or "").strip() if latest else None,
                "latestStoreName": "联想体验店（新野县书院路）",
                "latestNote": (
                    str(latest["note"] or "").strip()
                    if latest else (
                        "由 serial_item.inbound_date 回填采购入库时间"
                        if inbound_date else None
                    )
                ),
                "inboundDocumentType": "业务订单" if inbound_document_no else None,
                "sourceRefs": [{"kind": "sqlite_serial_item", "filePath": str(DB_FILE)}],
                "evidencePriority": ["sqlite_serial_item", "sqlite_inventory_movement"],
            }
            rows.append(row)
            if status == "in_stock":
                in_stock_row_count += 1
            if inbound_date:
                row_with_inbound_date += 1
            if inbound_document_no:
                row_with_inbound_document += 1
            if latest:
                row_with_latest_movement += 1

        missing_sn = max(current_stock - len(raw_in_stock_serials), 0)
        if missing_sn > 0:
            rows.append({
                "serialNumber": f"[缺SN x{missing_sn}]",
                "skuKey": sku_key,
                "skuCode": sku_key,
                "productCode": str(sku_row["product_id"] or "").strip() or None,
                "pnMtm": str(sku_row["pn_mtm"] or "").strip() or None,
                "productName": str(sku_row["name"] or "").strip(),
                "category": normalized_sku_category["category"] or None,
                "organizationName": "联想体验店（新野县书院路）",
                "organizationCode": "D0186124",
                "stockType": "SQL实时库存",
                "currentStock": current_stock,
                "sellableStock": sellable_stock,
                "occupiedStock": 0,
                "unsellableStock": 0,
                "pendingInboundStock": 0,
                "serialCountWithinSku": len(visible_in_stock_serials),
                "rawSerialCountWithinSku": len(raw_in_stock_serials),
                "inStock": True,
                "dataQuality": {"warnings": [f"当前SQL库存 {current_stock} 台，但仅有 {len(raw_in_stock_serials)} 条在库SN。"]},
                "sourceRefs": [{"kind": "sqlite_missing_sn_placeholder", "filePath": str(DB_FILE)}],
                "evidencePriority": ["sqlite_sku_stock"],
            })
            in_stock_row_count += missing_sn

    rows.sort(key=lambda item: (str(item.get("skuKey") or ""), 0 if item.get("inStock") else 1, str(item.get("serialNumber") or "")))
    warnings = []
    if exceptions:
        warnings.append(f"存在 {len(exceptions)} 条库存/SN 闭环异常，需继续补齐。")
    return {
        "source": "sqlite.retail_core",
        "generatedAt": timestamp,
        "files": {
            "stockQuantityFile": str(DB_FILE),
            "stockSnFile": str(DB_FILE),
        },
        "totals": {
            "rowCount": len(rows),
            "skuCount": len(sku_rows),
            "inStockRowCount": in_stock_row_count,
            "rowWithInboundDateCount": row_with_inbound_date,
            "rowWithInboundDocumentCount": row_with_inbound_document,
            "rowWithLatestMovementCount": row_with_latest_movement,
            "skuWithoutSerialCount": sku_without_serial_count,
            "exceptionCount": len(exceptions),
        },
        "coverage": {
            "inboundDateCoverage": (row_with_inbound_date / len(rows)) if rows else 0,
            "inboundDocumentCoverage": (row_with_inbound_document / len(rows)) if rows else 0,
            "movementCoverage": (row_with_latest_movement / len(rows)) if rows else 0,
        },
        "warnings": warnings,
        "rows": rows,
        "exceptions": exceptions,
    }


def refresh_sql_inventory_snapshot_cache(data_dir: Path) -> dict[str, dict[str, Any]]:
    standard_snapshot = build_standard_inventory_snapshot_from_sql()
    inventory_master_snapshot = build_inventory_master_snapshot_from_sql()
    adjusted_snapshot = dict(standard_snapshot)
    adjusted_snapshot["source"] = "sqlite.retail_core_adjusted"
    adjusted_snapshot["generatedAt"] = now_iso()
    adjusted_warnings = list((adjusted_snapshot.get("dataQuality") or {}).get("warnings") or [])
    adjusted_warnings.append("已切换为SQL实时库存主链；adjusted 快照不再沿用旧导出推算结果。")
    adjusted_snapshot["dataQuality"] = {
        **dict(adjusted_snapshot.get("dataQuality") or {}),
        "warnings": adjusted_warnings,
    }
    return {
        "standard": save_snapshot_cache(
            data_dir,
            "latest-standard-inventory-snapshot.json",
            standard_snapshot,
            source_system="sqlite.retail_core_inventory_snapshot",
        ),
        "adjusted": save_snapshot_cache(
            data_dir,
            "latest-adjusted-inventory-snapshot.json",
            adjusted_snapshot,
            source_system="sqlite.retail_core_inventory_snapshot",
        ),
        "master": save_snapshot_cache(
            data_dir,
            "latest-inventory-master-snapshot.json",
            inventory_master_snapshot,
            source_system="sqlite.retail_core_inventory_snapshot",
        ),
    }


def _load_manual_nearby_quotes() -> list[dict[str, Any]]:
    if not MANUAL_NEARBY_QUOTE_FILE.exists():
        return []
    try:
        payload = json.loads(MANUAL_NEARBY_QUOTE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    records = payload.get("records", []) if isinstance(payload, dict) else []
    return [item for item in records if isinstance(item, dict)]


def _extract_order_number(note: str) -> str:
    normalized = str(note or "").strip()
    matched = normalized and re.search(r"(?:订单|单据)\s*([A-Z]{2}\d{8,})", normalized, re.I)
    if matched:
        return matched.group(1)
    fallback = normalized and re.search(r"\b([A-Z]{2}\d{8,})\b", normalized, re.I)
    return fallback.group(1) if fallback else normalized


def _date_part(value: str) -> str:
    matched = re.search(r"(\d{4}-\d{2}-\d{2})", str(value or ""))
    return matched.group(1) if matched else str(value or "").strip()


def _day_gap(from_date: str, to_date: str) -> int | None:
    try:
        left = datetime.strptime(from_date, "%Y-%m-%d")
        right = datetime.strptime(to_date, "%Y-%m-%d")
    except ValueError:
        return None
    return (right - left).days


def _infer_business_date_from_order_id(order_id: str, fallback: str = "") -> str:
    matched = re.match(r"^[A-Z]{2}(\d{2})(\d{2})(\d{2})\d+$", str(order_id or "").strip(), re.I)
    if matched:
        year, month, day = matched.groups()
        return f"20{year}-{month}-{day}"
    return _date_part(fallback)


def _business_datetime_or_inferred(order_id: str, fallback: str = "") -> str:
    normalized = normalize_business_datetime_text(fallback)
    if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}", normalized):
        return normalized
    inferred = _infer_business_date_from_order_id(order_id, normalized)
    return normalized if re.match(r"^\d{4}-\d{2}-\d{2}$", normalized) else inferred


def _dedupe_inventory_movement_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sales_serial_counts: dict[tuple[str, str], int] = {}
    sales_quantity_only_counts: dict[tuple[str, str], int] = {}
    for row in rows:
        movement_type = str(row.get("movement_type") or "").strip()
        source_ref = str(row.get("source_ref") or "").strip()
        sku_key = str(row.get("sku_key") or "").strip()
        if movement_type != "sales_outbound" or not source_ref or not sku_key:
            continue
        canonical_sales_ref = extract_canonical_sales_order_no(source_ref) or source_ref
        key = (canonical_sales_ref, sku_key)
        quantity = abs(int(row.get("quantity") or 0))
        serial_number = str(row.get("serial_number") or "").strip()
        if serial_number:
            sales_serial_counts[key] = sales_serial_counts.get(key, 0) + quantity
        else:
            sales_quantity_only_counts[key] = sales_quantity_only_counts.get(key, 0) + quantity

    purchase_best: dict[tuple[str, str], tuple[dict[str, Any], tuple[int, int, int, str]]] = {}
    sales_best: dict[tuple[str, str, str], tuple[dict[str, Any], tuple[float, float, int, str]]] = {}
    passthrough_rows: list[dict[str, Any]] = []
    for row in rows:
        movement_type = str(row.get("movement_type") or "").strip()
        source_ref = str(row.get("source_ref") or "").strip()
        inbound_document_no = str(row.get("inbound_document_no") or "").strip()
        source_document_type = str(row.get("source_document_type") or "").strip()
        sku_key = str(row.get("sku_key") or "").strip()
        serial_number = str(row.get("serial_number") or "").strip()
        is_purchase_like = (
            movement_type == "purchase_inbound"
            or source_document_type in {"采购入库", "入库", "库存流水单"}
            or bool(re.search(r"CGR\d{8,}", f"{source_ref} {inbound_document_no}".upper()))
        )
        if is_purchase_like and sku_key:
            canonical_doc = extract_canonical_purchase_order_no(
                inbound_document_no,
                source_ref,
            ) or str(inbound_document_no or source_ref or "").strip()
            if canonical_doc:
                normalized_serials = normalize_serial_display_text(
                    row.get("serial_numbers_display") or serial_number
                )
                serial_count = (
                    len([item for item in normalized_serials.split(", ") if item.strip()])
                    if normalized_serials
                    else 0
                )
                quantity_score = abs(int(row.get("quantity") or 0))
                unit_cost_score = 1 if row.get("unit_cost") not in (None, "", 0, 0.0) else 0
                created_at_score = str(row.get("created_at") or "")
                key = (canonical_doc, sku_key)
                candidate_score = (serial_count, quantity_score, unit_cost_score, created_at_score)
                existing = purchase_best.get(key)
                if existing is None or candidate_score > existing[1]:
                    purchase_best[key] = (row, candidate_score)
                continue
        if movement_type == "sales_outbound" and source_ref and sku_key and serial_number:
            canonical_sales_ref = extract_canonical_sales_order_no(source_ref) or source_ref
            amount_score = float(row.get("amount") or 0)
            unit_cost_score = float(row.get("unit_cost") or 0)
            product_score = 1 if str(row.get("product_name") or "").strip() else 0
            created_at_score = str(row.get("created_at") or "")
            key = (canonical_sales_ref, sku_key, serial_number)
            candidate_score = (amount_score, unit_cost_score, product_score, created_at_score)
            existing = sales_best.get(key)
            if existing is None or candidate_score > existing[1]:
                sales_best[key] = (row, candidate_score)
            continue
        if movement_type != "sales_outbound" or not source_ref or not sku_key or serial_number:
            passthrough_rows.append(row)
            continue
        canonical_sales_ref = extract_canonical_sales_order_no(source_ref) or source_ref
        key = (canonical_sales_ref, sku_key)
        if sales_serial_counts.get(key, 0) >= sales_quantity_only_counts.get(key, 0):
            continue
        passthrough_rows.append(row)
    deduped: list[dict[str, Any]] = passthrough_rows + [item[0] for item in sales_best.values()] + [item[0] for item in purchase_best.values()]
    deduped.sort(
        key=lambda row: (
            str(row.get("business_date") or ""),
            str(row.get("created_at") or ""),
        ),
        reverse=True,
    )
    return deduped


def sync_sales_price_protection_history(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str | None = None,
) -> int:
    distributor_quotes = _load_json_payload(data_dir, "latest-distributor-quotes.json")
    movements = _load_json_payload(data_dir, "latest-inventory-movements.json")
    inventory_snapshot = _load_json_payload(data_dir, "latest-standard-inventory-snapshot.json")
    inventory_master = _load_json_payload(data_dir, "latest-inventory-master-snapshot.json")

    quotes = distributor_quotes.get("quotes", [])
    quotes.extend(_load_manual_nearby_quotes())
    records = movements.get("records", [])
    inventory_skus = inventory_snapshot.get("skus", [])
    inventory_rows = inventory_master.get("rows", [])
    if (
        not isinstance(quotes, list)
        or not isinstance(records, list)
        or not isinstance(inventory_skus, list)
        or not isinstance(inventory_rows, list)
    ):
        return 0

    quotes_by_pn: dict[str, list[dict[str, Any]]] = {}
    for quote in quotes:
        if not isinstance(quote, dict):
            continue
        pn_mtm = str(quote.get("pnMtm") or "").strip()
        quote_date = _date_part(str(quote.get("quoteDate") or ""))
        if not pn_mtm or not quote_date:
            continue
        quotes_by_pn.setdefault(pn_mtm, []).append({**quote, "quoteDate": quote_date})
    for pn_mtm, rows in quotes_by_pn.items():
        quotes_by_pn[pn_mtm] = sorted(rows, key=lambda item: str(item.get("quoteDate") or ""))
    if not quotes_by_pn:
        return 0

    sku_profile_by_key = {
        str(item.get("skuKey", "")).strip(): item
        for item in inventory_skus
        if isinstance(item, dict) and str(item.get("skuKey", "")).strip()
    }

    serial_snapshot_by_number: dict[str, dict[str, Any]] = {}
    latest_inbound_by_sku: dict[str, dict[str, Any]] = {}
    for row in inventory_rows:
        if not isinstance(row, dict):
            continue
        sku_key = str(row.get("skuKey", "")).strip()
        serial_number = str(row.get("serialNumber") or "").strip()
        inbound_date = str(row.get("inboundDate") or "")
        if serial_number:
            serial_snapshot_by_number[serial_number] = row
        if not sku_key or not inbound_date:
            continue
        current = latest_inbound_by_sku.get(sku_key)
        if not current or inbound_date > str(current.get("inboundDate") or ""):
            latest_inbound_by_sku[sku_key] = row

    inbound_by_serial: dict[str, dict[str, Any]] = {}
    latest_purchase_by_sku: dict[str, dict[str, Any]] = {}
    refunded_order_sku_keys: set[tuple[str, str]] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        movement_type = str(record.get("movementType", "")).strip()
        if movement_type == "transfer_inbound":
            refund_order_number = _extract_order_number(str(record.get("note") or ""))
            refund_sku_key = str(record.get("skuKey", "")).strip()
            if refund_order_number and refund_sku_key:
                refunded_order_sku_keys.add((refund_order_number, refund_sku_key))
        if movement_type != "purchase_inbound":
            continue
        sku_key = str(record.get("skuKey", "")).strip()
        serial_number = str(record.get("serialNumber") or "").strip()
        business_date = str(record.get("businessDate") or "")
        payload = {
            "inboundDate": business_date,
            "inboundDocumentNumber": str(record.get("documentNumber") or ""),
            "inboundOperatorName": str(record.get("operatorName") or ""),
            "supplierName": str(record.get("supplierName") or ""),
            "purchaseCost": (
                record.get("purchaseCost")
                if record.get("purchaseCost") not in (None, "")
                else record.get("unitCost")
            ),
        }
        if serial_number:
            inbound_by_serial[serial_number] = payload
        if sku_key and business_date:
            current = latest_purchase_by_sku.get(sku_key)
            if not current or business_date > str(current.get("inboundDate") or ""):
                latest_purchase_by_sku[sku_key] = payload

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        if str(record.get("movementType", "")).strip() != "sales_outbound":
            continue
        note = str(record.get("note") or "").strip()
        if note.startswith("本地销售单 "):
            continue
        sku_key = str(record.get("skuKey", "")).strip()
        sku_profile = sku_profile_by_key.get(sku_key)
        product_name = str((sku_profile or {}).get("productName") or record.get("productName") or "")
        pn_mtm = str(
            (sku_profile or {}).get("pnMtm")
            or record.get("pnMtm")
            or ""
        ).strip()
        is_service_item = is_non_inventory_service_item(sku_key, product_name, pn_mtm)
        sale_date = _date_part(str(record.get("businessDate") or ""))
        candidate_quotes = quotes_by_pn.get(pn_mtm, [])
        same_day_quote = next(
            (candidate for candidate in reversed(candidate_quotes) if str(candidate.get("quoteDate") or "") <= sale_date),
            None,
        )
        nearby_quote = next(
            (
                candidate
                for candidate in candidate_quotes
                if (gap := _day_gap(sale_date, str(candidate.get("quoteDate") or ""))) is not None
                and 0 < gap <= 2
            ),
            None,
        )
        quote = same_day_quote or nearby_quote
        order_number = _extract_order_number(note)
        if not order_number:
            continue
        if (order_number, sku_key) in refunded_order_sku_keys:
            continue
        serial_number = str(record.get("serialNumber") or "").strip()
        inbound = (
            inbound_by_serial.get(serial_number)
            or serial_snapshot_by_number.get(serial_number)
            or latest_purchase_by_sku.get(sku_key)
            or latest_inbound_by_sku.get(sku_key)
            or {}
        )
        inbound_cost = inbound.get("purchaseCost")
        if inbound_cost is None and isinstance(sku_profile, dict):
            inbound_cost = sku_profile.get("salesCostPrice")
        if is_service_item:
            try:
                inbound_cost_numeric = float(inbound_cost) if inbound_cost is not None else 0.0
            except (TypeError, ValueError):
                inbound_cost_numeric = 0.0
            if inbound_cost is None or inbound_cost_numeric == 0:
                inbound_cost = 0
        pickup_price = quote.get("pickupPrice") if isinstance(quote, dict) else None
        try:
            inbound_cost_value = float(inbound_cost) if inbound_cost is not None else None
        except (TypeError, ValueError):
            inbound_cost_value = None
        try:
            pickup_price_value = float(pickup_price) if pickup_price is not None else None
        except (TypeError, ValueError):
            pickup_price_value = None
        unit_diff = round(inbound_cost_value - pickup_price_value, 2) if inbound_cost_value is not None and pickup_price_value is not None else None
        key = (order_number, sku_key)
        protection_quote_date = str((quote or {}).get("quoteDate") or "")
        bucket = grouped.setdefault(key, {
            "order_number": order_number,
            "sku_key": sku_key,
            "product_name": product_name,
            "pn_mtm": pn_mtm,
            "serial_numbers": [],
            "quantity": 0,
            "outbound_date": str(record.get("businessDate") or ""),
            "outbound_movement_ids": [],
            "protection_quote_date": protection_quote_date,
            "realtime_purchase_price": pickup_price_value,
            "inventory_average_cost": inbound_cost_value,
            "unit_diff": unit_diff if unit_diff is not None else 0.0,
            "estimated_protection_amount": 0.0,
            "inbound_dates": [],
            "inbound_costs": [],
            "inbound_document_numbers": [],
            "source_note": note,
            "source_quote_file": str((quote or {}).get("sourceFile") or ""),
            "has_positive_diff": False,
            "missing_quote": quote is None,
            "missing_inbound_cost": False if is_service_item else inbound_cost_value is None,
            "is_service_item": is_service_item,
            "nearby_quote_date": str(nearby_quote.get("quoteDate") or "") if same_day_quote is None and nearby_quote else "",
            "nearby_quote_pickup_price": nearby_quote.get("pickupPrice") if same_day_quote is None and nearby_quote else None,
            "nearby_quote_source_file": str(nearby_quote.get("sourceFile") or "") if same_day_quote is None and nearby_quote else "",
        })
        if serial_number:
            bucket["serial_numbers"].append(serial_number)
        inbound_date = str(inbound.get("inboundDate") or "")
        if inbound_date:
            bucket["inbound_dates"].append(inbound_date)
        inbound_document_number = str(
            inbound.get("inboundDocumentNumber")
            or inbound.get("documentNumber")
            or ""
        )
        if inbound_document_number:
            bucket["inbound_document_numbers"].append(inbound_document_number)
        if inbound_cost_value is not None:
            bucket["inbound_costs"].append(inbound_cost_value)
        bucket["quantity"] += int(record.get("quantity", 1) or 1)
        bucket["outbound_movement_ids"].append(str(record.get("id") or ""))
        bucket["estimated_protection_amount"] = round(
            float(bucket["estimated_protection_amount"]) + max(unit_diff or 0, 0),
            2,
        )
        bucket["has_positive_diff"] = bool(bucket["has_positive_diff"] or ((unit_diff or 0) > 0))
        bucket["missing_quote"] = bool(bucket["missing_quote"] and quote is None)
        bucket["missing_inbound_cost"] = bool(bucket["missing_inbound_cost"] and inbound_cost_value is None)

    synced = 0
    now = timestamp or now_iso()
    today_date = _date_part(now)
    for (order_number, sku_key), item in grouped.items():
        outbound_date_part = _date_part(str(item["outbound_date"] or ""))
        inbound_date = sorted(item["inbound_dates"])[0] if item["inbound_dates"] else ""
        inbound_cost_amount = round(
            sum(float(cost) for cost in item["inbound_costs"]) / len(item["inbound_costs"]),
            2,
        ) if item["inbound_costs"] else None
        inbound_document_no = item["inbound_document_numbers"][0] if item["inbound_document_numbers"] else ""
        status = (
            "pending"
            if item["has_positive_diff"]
            else "blocked_missing_quote"
            if item["missing_quote"]
            else "blocked_missing_cost"
            if item["missing_inbound_cost"]
            else "no_need"
        )
        source_note = str(item["source_note"] or "")
        if item.get("is_service_item"):
            service_note = "Lenovo Care / 智惠服务 SKU 成本按 0 处理，不进入待补进货成本链"
            source_note = f"{source_note}；{service_note}" if source_note else service_note
        quote_date_part = _date_part(str(item.get("protection_quote_date") or ""))
        if (
            outbound_date_part
            and quote_date_part
            and (gap := _day_gap(outbound_date_part, quote_date_part)) is not None
            and 0 < gap <= 2
        ):
            nearby_note = f"缺少出库当日报价，已改用临近日期报价凭证 {quote_date_part}，原销售日 {outbound_date_part}"
            if nearby_note not in source_note:
                source_note = f"{source_note}；{nearby_note}" if source_note else nearby_note
        if status == "blocked_missing_quote" and item.get("nearby_quote_date"):
            status = "pending"
            item["protection_quote_date"] = str(item.get("nearby_quote_date") or "")
            item["source_quote_file"] = str(item.get("nearby_quote_source_file") or "")
            try:
                item["realtime_purchase_price"] = float(item.get("nearby_quote_pickup_price")) if item.get("nearby_quote_pickup_price") is not None else None
            except (TypeError, ValueError):
                item["realtime_purchase_price"] = None
            if inbound_cost_amount is not None and item["realtime_purchase_price"] is not None:
                item["unit_diff"] = round(float(inbound_cost_amount) - float(item["realtime_purchase_price"]), 2)
                item["estimated_protection_amount"] = round(max(float(item["unit_diff"]), 0.0), 2)
                item["has_positive_diff"] = bool(float(item["unit_diff"]) > 0)
            else:
                item["unit_diff"] = 0.0
                item["estimated_protection_amount"] = 0.0
            nearby_note = f"缺少出库当日报价，已改用临近日期报价凭证 {item['protection_quote_date']}，原销售日 {outbound_date_part}"
            if nearby_note not in source_note:
                source_note = f"{source_note}；{nearby_note}" if source_note else nearby_note
        if status == "blocked_missing_quote":
            missing_quote_note = "缺少出库当日分销报价快照，禁止用后续报价回补历史价保证据"
            if source_note:
                source_note = f"{source_note}；{missing_quote_note}"
            else:
                source_note = missing_quote_note
        if status == "blocked_missing_cost":
            missing_cost_note = "入库成本待补"
            if inbound_document_no:
                missing_cost_note = f"入库单 {inbound_document_no} 成本字段为 0，待补真实进货成本"
            if source_note:
                source_note = f"{source_note}；{missing_cost_note}"
            else:
                source_note = missing_cost_note
        history_id = f"pp-{hashlib.sha1(f'{order_number}:{sku_key}'.encode('utf-8')).hexdigest()[:20]}"
        existing = conn.execute(
            """
            SELECT protection_quote_date, source_quote_file, realtime_purchase_price,
                   unit_diff, estimated_protection_amount, source_note, status
            FROM sales_price_protection_history
            WHERE id = ?
            """,
            (history_id,),
        ).fetchone()
        existing_quote_date = str(existing["protection_quote_date"] or "").strip() if existing else ""
        existing_quote_file = str(existing["source_quote_file"] or "").strip() if existing else ""
        existing_source_note = str(existing["source_note"] or "").strip() if existing else ""
        current_quote_date = _date_part(str(item.get("protection_quote_date") or ""))
        current_evidence_valid = bool(
            outbound_date_part
            and current_quote_date
            and (
                current_quote_date <= outbound_date_part
                or (
                    "临近日期报价凭证" in source_note
                    and (gap := _day_gap(outbound_date_part, current_quote_date)) is not None
                    and 0 < gap <= 2
                )
            )
        )
        existing_evidence_valid = bool(
            existing
            and outbound_date_part
            and existing_quote_date
            and (
                existing_quote_date <= outbound_date_part
                or (
                    "临近日期报价凭证" in existing_source_note
                    and (gap := _day_gap(outbound_date_part, existing_quote_date)) is not None
                    and 0 < gap <= 2
                )
            )
        )
        exact_same_day_upgrade = bool(
            existing
            and outbound_date_part
            and current_quote_date == outbound_date_part
            and existing_quote_date != outbound_date_part
        )
        freeze_history_evidence = bool(
            existing
            and outbound_date_part
            and outbound_date_part < today_date
            and existing_evidence_valid
            and (existing_quote_date or existing_quote_file)
            and not exact_same_day_upgrade
        )
        if freeze_history_evidence:
            if existing_quote_date:
                item["protection_quote_date"] = existing_quote_date
            if existing_quote_file:
                item["source_quote_file"] = existing_quote_file
            item["realtime_purchase_price"] = existing["realtime_purchase_price"]
            item["unit_diff"] = existing["unit_diff"]
            item["estimated_protection_amount"] = existing["estimated_protection_amount"]
            source_note = str(existing["source_note"] or source_note)
            status = str(existing["status"] or status)
        elif existing and outbound_date_part and existing_quote_date and existing_quote_date > outbound_date_part:
            if not current_evidence_valid:
                item["protection_quote_date"] = ""
                item["source_quote_file"] = ""
                item["realtime_purchase_price"] = None
                item["unit_diff"] = 0.0
                item["estimated_protection_amount"] = 0.0
                status = "blocked_missing_quote"
                invalid_quote_note = f"原冻结价保证据日期 {existing_quote_date} 晚于出库日 {outbound_date_part}，已作废，待补出库当日报价快照"
                source_note = f"{source_note}；{invalid_quote_note}" if source_note else invalid_quote_note
        conn.execute(
            """
            INSERT INTO sales_price_protection_history
            (id, order_number, sku_key, product_name, pn_mtm, serial_numbers_json, quantity,
             outbound_date, outbound_movement_ids_json, protection_quote_date,
             realtime_purchase_price, inventory_average_cost, unit_diff, estimated_protection_amount,
             inbound_date, inbound_cost_amount, inbound_document_no,
             source_note, source_quote_file, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              product_name = excluded.product_name,
              pn_mtm = excluded.pn_mtm,
              serial_numbers_json = excluded.serial_numbers_json,
              quantity = excluded.quantity,
              outbound_date = excluded.outbound_date,
              outbound_movement_ids_json = excluded.outbound_movement_ids_json,
              protection_quote_date = excluded.protection_quote_date,
              realtime_purchase_price = excluded.realtime_purchase_price,
              inventory_average_cost = excluded.inventory_average_cost,
              unit_diff = excluded.unit_diff,
              estimated_protection_amount = excluded.estimated_protection_amount,
              inbound_date = excluded.inbound_date,
              inbound_cost_amount = excluded.inbound_cost_amount,
              inbound_document_no = excluded.inbound_document_no,
              source_note = excluded.source_note,
              source_quote_file = excluded.source_quote_file,
              status = excluded.status,
              updated_at = excluded.updated_at
            """,
            (
                history_id,
                order_number,
                sku_key,
                item["product_name"],
                item["pn_mtm"],
                json.dumps(item["serial_numbers"], ensure_ascii=False),
                item["quantity"],
                item["outbound_date"],
                json.dumps(item["outbound_movement_ids"], ensure_ascii=False),
                item["protection_quote_date"],
                item["realtime_purchase_price"],
                item["inventory_average_cost"],
                item["unit_diff"],
                item["estimated_protection_amount"],
                inbound_date,
                inbound_cost_amount,
                inbound_document_no,
                source_note,
                item["source_quote_file"],
                status,
                now,
                now,
            ),
        )
        voucher_key = f"{history_id}:{item['outbound_date']}:{item['estimated_protection_amount']}"
        voucher_id = f"rv-{hashlib.sha1(voucher_key.encode('utf-8')).hexdigest()[:24]}"
        voucher_code = f"RB-{_date_part(item['outbound_date']) or today_date}-{order_number}-{sku_key}"
        voucher_payload = {
            "templateVersion": "v1",
            "historyId": history_id,
            "orderNumber": order_number,
            "skuKey": sku_key,
            "productName": item["product_name"],
            "pnMtm": item["pn_mtm"],
            "quantity": item["quantity"],
            "serialNumbers": item["serial_numbers"],
            "outboundDate": item["outbound_date"],
            "inboundDocumentNo": inbound_document_no,
            "inboundCostAmount": inbound_cost_amount,
            "realtimePurchasePrice": item["realtime_purchase_price"],
            "unitDiff": item["unit_diff"],
            "estimatedProtectionAmount": item["estimated_protection_amount"],
            "status": status,
            "sourceQuoteFile": item["source_quote_file"],
            "sourceNote": source_note,
        }
        # 报销凭证台账按销售出库自动追加，禁止自动删除历史凭证。
        conn.execute(
            """
            INSERT OR IGNORE INTO reimbursement_voucher_ledger
            (id, history_id, order_number, sku_key, product_name, pn_mtm,
             quantity, serial_numbers_json, outbound_date, inbound_document_no,
             inbound_cost_amount, realtime_purchase_price, unit_diff, estimated_protection_amount,
             status, voucher_code, voucher_template_version, voucher_payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                voucher_id,
                history_id,
                order_number,
                sku_key,
                item["product_name"],
                item["pn_mtm"],
                item["quantity"],
                json.dumps(item["serial_numbers"], ensure_ascii=False),
                item["outbound_date"],
                inbound_document_no,
                inbound_cost_amount,
                item["realtime_purchase_price"],
                item["unit_diff"],
                item["estimated_protection_amount"],
                status,
                voucher_code,
                "v1",
                json.dumps(voucher_payload, ensure_ascii=False),
                now,
            ),
        )
        synced += 1
    # 价保历史改为只增不减：不再按规则自动删除历史记录。
    return synced


def sync_warranty_snapshot(
    conn: sqlite3.Connection,
    data_dir: Path,
    timestamp: str | None = None,
) -> int:
    records = load_warranty_snapshot(data_dir)
    if not records:
        return 0

    synced = 0
    checked_at_fallback = timestamp or now_iso()
    for record in records:
        serial_number = str(record.get("serialNumber", "")).strip()
        sku_key = str(record.get("skuKey", "")).strip()
        if not serial_number:
            continue

        existing = conn.execute(
            """
            SELECT serial_number, sku_key, product_name, pn_mtm, spec, status,
                   warehouse_code, location_code, cost_amount, inbound_date,
                   inbound_document_no, operator_name, supplier_name,
                   warranty_status, official_warranty_start, official_warranty_end
            FROM serial_item
            WHERE serial_number = ?
            """,
            (serial_number,),
        ).fetchone()

        if not existing and not sku_key:
            continue

        payload = {
            "serial_number": serial_number,
            "sku_key": sku_key or str(existing["sku_key"] if existing else ""),
            "product_name": str(
                record.get("productName")
                or record.get("officialProductName")
                or (existing["product_name"] if existing else "")
            ),
            "pn_mtm": str(record.get("pnMtm") or (existing["pn_mtm"] if existing else "")),
            "spec": str(existing["spec"] if existing else ""),
            "status": str(existing["status"] if existing else "in_stock"),
            "warehouse_code": str(existing["warehouse_code"] if existing else "STORE"),
            "location_code": str(existing["location_code"] if existing else "SALES_FLOOR"),
            "cost_amount": existing["cost_amount"] if existing else None,
            "inbound_date": existing["inbound_date"] if existing else None,
            "inbound_document_no": str(existing["inbound_document_no"] if existing else ""),
            "operator_name": str(existing["operator_name"] if existing else ""),
            "supplier_name": str(existing["supplier_name"] if existing else ""),
            "warranty_status": str(record.get("status") or "unknown"),
            "warranty_checked_at": str(record.get("checkedAt") or checked_at_fallback),
            "official_warranty_start": str(record.get("officialWarrantyStart") or ""),
            "official_warranty_end": str(record.get("officialWarrantyEnd") or ""),
            "warranty_service_plan": str(record.get("servicePlan") or ""),
            "warranty_official_product_name": str(record.get("officialProductName") or ""),
            "warranty_official_lookup_url": str(record.get("officialLookupUrl") or ""),
            "warranty_evidence_screenshot_path": str(record.get("evidenceScreenshotPath") or ""),
            "warranty_evidence_text_path": str(record.get("evidenceTextPath") or ""),
            "warranty_failure_reason": str(record.get("failureReason") or ""),
            "updated_at": checked_at_fallback,
        }

        existing_warranty_start = str(existing["official_warranty_start"] if existing else "")
        existing_warranty_end = str(existing["official_warranty_end"] if existing else "")
        if existing_warranty_start and not payload["official_warranty_start"]:
            payload["official_warranty_start"] = existing_warranty_start
        if existing_warranty_end and not payload["official_warranty_end"]:
            payload["official_warranty_end"] = existing_warranty_end
        if existing and str(existing["warranty_status"] or "") == "success" and payload["warranty_status"] in {"failed", "captcha_required"}:
            payload["warranty_status"] = "success"

        conn.execute(
            """
            INSERT INTO serial_item
            (serial_number, sku_key, product_name, pn_mtm, spec, status,
             warehouse_code, location_code, cost_amount, inbound_date,
             inbound_document_no, operator_name, supplier_name,
             warranty_status, warranty_checked_at, official_warranty_start,
             official_warranty_end, warranty_service_plan, warranty_official_product_name,
             warranty_official_lookup_url, warranty_evidence_screenshot_path,
             warranty_evidence_text_path, warranty_failure_reason, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(serial_number) DO UPDATE SET
              sku_key = excluded.sku_key,
              product_name = excluded.product_name,
              pn_mtm = excluded.pn_mtm,
              warranty_status = excluded.warranty_status,
              warranty_checked_at = excluded.warranty_checked_at,
              official_warranty_start = excluded.official_warranty_start,
              official_warranty_end = excluded.official_warranty_end,
              warranty_service_plan = excluded.warranty_service_plan,
              warranty_official_product_name = excluded.warranty_official_product_name,
              warranty_official_lookup_url = excluded.warranty_official_lookup_url,
              warranty_evidence_screenshot_path = excluded.warranty_evidence_screenshot_path,
              warranty_evidence_text_path = excluded.warranty_evidence_text_path,
              warranty_failure_reason = excluded.warranty_failure_reason,
              updated_at = excluded.updated_at
            """,
            (
                payload["serial_number"],
                payload["sku_key"],
                payload["product_name"],
                payload["pn_mtm"],
                payload["spec"],
                payload["status"],
                payload["warehouse_code"],
                payload["location_code"],
                payload["cost_amount"],
                payload["inbound_date"],
                payload["inbound_document_no"],
                payload["operator_name"],
                payload["supplier_name"],
                payload["warranty_status"],
                payload["warranty_checked_at"],
                payload["official_warranty_start"],
                payload["official_warranty_end"],
                payload["warranty_service_plan"],
                payload["warranty_official_product_name"],
                payload["warranty_official_lookup_url"],
                payload["warranty_evidence_screenshot_path"],
                payload["warranty_evidence_text_path"],
                payload["warranty_failure_reason"],
                payload["updated_at"],
            ),
        )
        synced += 1
    return synced


def table_counts() -> dict[str, int]:
    init_db()
    tables = [
        "product",
        "sku",
        "serial_item",
        "inventory_movement",
        "distributor_quote_current",
        "gray_wholesale_quote_current",
        "inventory_price_signal_current",
        "product_category_node",
        "sku_category_mapping",
        "staff",
        "sales_order",
        "purchase_order",
        "external_system",
        "sync_task",
        "price_tag_device",
        "price_tag_binding",
        "price_tag_update_task",
        "sales_price_protection_history",
    ]
    with connect() as conn:
        return {
            table: int(conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"])
            for table in tables
        }


def list_pricing_policy_rules() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        pricing_rows = [dict(row) for row in conn.execute(
            """
            SELECT *
            FROM pricing_policy_rule
            ORDER BY priority ASC, policy_code ASC
            """
        ).fetchall()]
        subsidy_rows = [dict(row) for row in conn.execute(
            """
            SELECT *
            FROM subsidy_policy_rule
            ORDER BY policy_code ASC
            """
        ).fetchall()]
    for row in pricing_rows:
        try:
            row["formula"] = json.loads(row.pop("formula_json", "{}"))
        except json.JSONDecodeError:
            row["formula"] = {}
    for row in subsidy_rows:
        try:
            row["eligible_categories"] = json.loads(row.pop("eligible_categories_json", "[]"))
        except json.JSONDecodeError:
            row["eligible_categories"] = []
        try:
            row["rule"] = json.loads(row.pop("rule_json", "{}"))
        except json.JSONDecodeError:
            row["rule"] = {}
    return {
        "generatedAt": now_iso(),
        "pricingRules": pricing_rows,
        "subsidyRules": subsidy_rows,
        "pricingRuleCount": len(pricing_rows),
        "subsidyRuleCount": len(subsidy_rows),
    }


def list_frontend_sync_targets() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT *
            FROM frontend_sync_target
            ORDER BY target_key ASC
            """
        ).fetchall()]
    for row in rows:
        try:
            row["dependencies"] = json.loads(row.pop("dependency_json", "[]"))
        except json.JSONDecodeError:
            row["dependencies"] = []
        row["syncReady"] = bool(row.pop("sync_ready", 0))
    return {
        "generatedAt": now_iso(),
        "items": rows,
        "count": len(rows),
        "readyCount": sum(1 for row in rows if row.get("syncReady")),
    }


def list_frontend_display_controls() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT control_key, control_name, enabled, note, source_system, updated_at
            FROM frontend_display_control
            ORDER BY control_key ASC
            """
        ).fetchall()]
    items = []
    for row in rows:
        items.append({
            "controlKey": str(row.get("control_key") or ""),
            "controlName": str(row.get("control_name") or ""),
            "enabled": bool(row.get("enabled")),
            "note": str(row.get("note") or ""),
            "sourceSystem": str(row.get("source_system") or ""),
            "updatedAt": str(row.get("updated_at") or ""),
        })
    map_by_key = {item["controlKey"]: item for item in items}
    return {
        "generatedAt": now_iso(),
        "items": items,
        "controls": {
            "showMarketingPo": bool(map_by_key.get("marketing_po", {}).get("enabled", True)),
            "showEducationSubsidy": bool(map_by_key.get("education_subsidy", {}).get("enabled", True)),
        },
        "count": len(items),
    }


def save_frontend_display_controls(*, show_marketing_po: bool, show_education_subsidy: bool, source_system: str = "api.frontend_display_controls") -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            UPDATE frontend_display_control
            SET enabled = ?, source_system = ?, updated_at = ?
            WHERE control_key = 'marketing_po'
            """,
            (1 if show_marketing_po else 0, source_system, timestamp),
        )
        conn.execute(
            """
            UPDATE frontend_display_control
            SET enabled = ?, source_system = ?, updated_at = ?
            WHERE control_key = 'education_subsidy'
            """,
            (1 if show_education_subsidy else 0, source_system, timestamp),
        )
    return list_frontend_display_controls()


def list_frontend_activity_display_overrides() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT
              override.activity_id,
              override.sku_key,
              override.marketing_po_enabled,
              override.marketing_po_amount,
              override.education_subsidy_enabled,
              override.education_subsidy_amount,
              override.note,
              override.updated_at,
              sku.name AS product_name,
              sku.pn_mtm,
              sku.category,
              sku.current_stock
            FROM frontend_activity_display_override AS override
            LEFT JOIN sku ON sku.sku_key = override.sku_key
            ORDER BY sku.category, override.sku_key
            """
        ).fetchall()]
    items = []
    for row in rows:
        items.append({
            "activityId": str(row.get("activity_id") or ""),
            "skuKey": str(row.get("sku_key") or ""),
            "productName": str(row.get("product_name") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "category": str(row.get("category") or "未分类"),
            "currentStock": int(row.get("current_stock") or 0),
            "marketingPoEnabled": bool(row.get("marketing_po_enabled")),
            "marketingPoAmount": float(row.get("marketing_po_amount")) if row.get("marketing_po_amount") is not None else None,
            "educationSubsidyEnabled": bool(row.get("education_subsidy_enabled")),
            "educationSubsidyAmount": float(row.get("education_subsidy_amount")) if row.get("education_subsidy_amount") is not None else None,
            "note": str(row.get("note") or ""),
            "updatedAt": str(row.get("updated_at") or ""),
        })
    return {
        "generatedAt": now_iso(),
        "count": len(items),
        "items": items,
    }


def list_frontend_activity_display_catalog() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT sku_key, name, pn_mtm, category, current_stock
            FROM sku
            WHERE current_stock > 0
            ORDER BY category ASC, current_stock DESC, sku_key ASC
            """
        ).fetchall()]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        category = str(row.get("category") or "未分类")
        grouped.setdefault(category, []).append({
            "skuKey": str(row.get("sku_key") or ""),
            "productName": str(row.get("name") or ""),
            "pnMtm": str(row.get("pn_mtm") or ""),
            "currentStock": int(row.get("current_stock") or 0),
        })
    categories = [
        {
            "category": key,
            "skuCount": len(value),
            "items": value,
        }
        for key, value in grouped.items()
    ]
    return {
        "generatedAt": now_iso(),
        "categoryCount": len(categories),
        "skuCount": sum(int(item["skuCount"]) for item in categories),
        "categories": categories,
    }


def save_frontend_activity_display_override(
    *,
    activity_id: str,
    sku_key: str,
    marketing_po_enabled: bool,
    marketing_po_amount: float | None,
    education_subsidy_enabled: bool,
    education_subsidy_amount: float | None,
    note: str = "",
    source_system: str = "api.frontend_activity_display_override",
) -> dict[str, Any]:
    init_db()
    normalized_activity_id = str(activity_id or "").strip()
    normalized_sku_key = str(sku_key or "").strip()
    if not normalized_sku_key:
        raise ValueError("skuKey 不能为空")
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO frontend_activity_display_override
            (activity_id, sku_key, marketing_po_enabled, marketing_po_amount, education_subsidy_enabled, education_subsidy_amount, note, source_system, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(activity_id, sku_key) DO UPDATE SET
              marketing_po_enabled = excluded.marketing_po_enabled,
              marketing_po_amount = excluded.marketing_po_amount,
              education_subsidy_enabled = excluded.education_subsidy_enabled,
              education_subsidy_amount = excluded.education_subsidy_amount,
              note = excluded.note,
              source_system = excluded.source_system,
              updated_at = excluded.updated_at
            """,
            (
                normalized_activity_id,
                normalized_sku_key,
                1 if marketing_po_enabled else 0,
                marketing_po_amount,
                1 if education_subsidy_enabled else 0,
                education_subsidy_amount,
                str(note or "").strip(),
                source_system,
                timestamp,
            ),
        )
    return list_frontend_activity_display_overrides()


def list_category_tree() -> dict[str, Any]:
    init_db()
    with connect() as conn:
        category_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, source_system, name, level, parent_id, display_order
                FROM product_category_node
                ORDER BY source_system, level, display_order, name
                """
            ).fetchall()
        ]
        mapping_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT sku_key, smart_retail_category, zhidiantong_category,
                       jd_subcategory, catalog_source
                FROM sku_category_mapping
                ORDER BY smart_retail_category, jd_subcategory, sku_key
                """
            ).fetchall()
        ]

    return {
        "categoryNodes": category_rows,
        "skuMappings": mapping_rows,
        "summary": {
            "categoryNodeCount": len(category_rows),
            "skuMappingCount": len(mapping_rows),
            "zhidiantongCategoryCount": len({
                row["zhidiantong_category"] for row in mapping_rows
            }),
            "smartRetailCategoryCount": len({
                row["smart_retail_category"] for row in mapping_rows
            }),
            "jdSubcategoryCount": len({row["jd_subcategory"] for row in mapping_rows}),
        },
    }


def list_serial_items(limit: int = 80) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        stock_rows = conn.execute(
            """
            SELECT sku_key, current_stock
            FROM sku
            """
        ).fetchall()
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT serial_number, sku_key, product_name, pn_mtm, spec, status,
                       warehouse_code, location_code, cost_amount, inbound_date,
                       inbound_document_no, operator_name, supplier_name,
                       warranty_status, warranty_checked_at, official_warranty_start,
                       official_warranty_end, warranty_service_plan,
                       warranty_official_product_name, warranty_official_lookup_url,
                       warranty_evidence_screenshot_path, warranty_evidence_text_path,
                       warranty_failure_reason, updated_at
                FROM serial_item
                ORDER BY updated_at DESC, sku_key, serial_number
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
        hold_rows = conn.execute(
            """
            SELECT serial_number, hold_status
            FROM physical_stock_hold
            ORDER BY updated_at DESC, serial_number
            """
        ).fetchall()
        hold_count_by_sku = _physical_hold_count_by_sku(conn)
    hold_status_by_serial = {
        str(row["serial_number"] or "").strip(): str(row["hold_status"] or "").strip()
        for row in hold_rows
        if str(row["serial_number"] or "").strip()
    }
    stock_by_sku = {
        str(row["sku_key"] or "").strip(): int(row["current_stock"] or 0)
        for row in stock_rows
        if str(row["sku_key"] or "").strip()
    }
    visible_in_stock_seen: dict[str, int] = {}
    for row in rows:
        row["cost_amount"] = normalize_purchase_cost_amount(row.get("cost_amount"))
        serial_number = str(row.get("serial_number") or "").strip()
        sku_key = str(row.get("sku_key") or "").strip()
        status = str(row.get("status") or "").strip()
        if status == "in_stock" and is_physical_hold_location(row.get("warehouse_code"), row.get("location_code")):
            hold_status = hold_status_by_serial.get(serial_number, "")
            if hold_status in {"consumed", "released", "revoked"}:
                row["status"] = hold_status
                row["status_note"] = f"实物仓状态以 physical_stock_hold 为准，当前为 {hold_status}。"
                status = row["status"]
        if status == "in_stock":
            allowed_stock = max(stock_by_sku.get(sku_key, 0), 0) + max(hold_count_by_sku.get(sku_key, 0), 0)
            seen = visible_in_stock_seen.get(sku_key, 0)
            if seen >= allowed_stock:
                row["status"] = "stock_count_excess"
                row["stock_count_excess"] = True
                row["status_note"] = "智店通库存数量小于SN台账在库数，本条不参与当前库存展示。"
            else:
                visible_in_stock_seen[sku_key] = seen + 1
    status_counts: dict[str, int] = {}
    for row in rows:
        status_key = str(row.get("status") or "unknown").strip() or "unknown"
        status_counts[status_key] = status_counts.get(status_key, 0) + 1
    return {
        "items": rows,
        "count": len(rows),
        "statusCounts": status_counts,
    }


def list_physical_stock_holds(limit: int = 5000, status: str = "") -> dict[str, Any]:
    init_db()
    conditions: list[str] = []
    params: list[Any] = []
    normalized_status = str(status or "").strip()
    if normalized_status and normalized_status not in {"all", "*"}:
        conditions.append("hold_status = ?")
        params.append(normalized_status)
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT hold.serial_number, hold.sku_key, hold.source_order_no, hold.source_order_line_id,
                       hold.hold_reason, hold.warehouse_code, hold.location_code, hold.hold_status,
                       hold.matched_service_order_no, hold.matched_outbound_movement_id, hold.note,
                       hold.created_at, hold.updated_at,
                       COALESCE(NULLIF(TRIM(sales_order.business_date), ''), NULLIF(TRIM(sales_order.pay_time), ''), NULLIF(TRIM(sales_order.created_time), ''), '') AS source_sales_business_date,
                       serial_item.product_name, serial_item.pn_mtm, serial_item.spec,
                       serial_item.status AS serial_status
                FROM physical_stock_hold AS hold
                LEFT JOIN serial_item ON serial_item.serial_number = hold.serial_number
                LEFT JOIN sales_order ON sales_order.id = hold.source_order_no
                WHERE {where_clause}
                ORDER BY hold.updated_at DESC, hold.serial_number
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
        ]
    counts: dict[str, int] = {}
    for row in rows:
        hold_status = str(row.get("hold_status") or "unknown").strip() or "unknown"
        counts[hold_status] = counts.get(hold_status, 0) + 1
    return {
        "generatedAt": now_iso(),
        "source": "sqlite.physical_stock_hold",
        "count": len(rows),
        "statusCounts": counts,
        "items": rows,
    }


def list_physical_hold_sales_order_candidates(
    limit: int = 120,
    keyword: str = "",
    transfer_status: str = "",
) -> dict[str, Any]:
    init_db()
    normalized_keyword = str(keyword or "").strip().lower()
    normalized_transfer_status = str(transfer_status or "").strip().lower()
    valid_order_statuses = {"60", "已完成", "completed"}
    sales_orders = list_sales_orders(limit=max(limit * 8, 2000)).get("items", [])
    with connect() as conn:
        hold_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT serial_number, sku_key, source_order_no, hold_status,
                       matched_service_order_no, updated_at
                FROM physical_stock_hold
                ORDER BY updated_at DESC, serial_number
                """
            ).fetchall()
        ]
    hold_by_serial = {
        str(row.get("serial_number") or "").strip(): row
        for row in hold_rows
        if str(row.get("serial_number") or "").strip()
        and str(row.get("hold_status") or "").strip() != "revoked"
    }
    candidates: list[dict[str, Any]] = []
    summary = {
        "all": 0,
        "untransferred": 0,
        "partial": 0,
        "transferred": 0,
        "active": 0,
        "consumed": 0,
        "released": 0,
        "revoked": 0,
    }

    for order in sales_orders:
        if not isinstance(order, dict):
            continue
        status_text = str(order.get("status_name") or order.get("status") or "").strip()
        if status_text not in valid_order_statuses:
            continue
        order_number = str(order.get("order_number") or order.get("order_no") or order.get("id") or "").strip()
        if not order_number:
            continue
        lines = order.get("lines") if isinstance(order.get("lines"), list) else []
        serials: list[str] = []
        sku_keys: list[str] = []
        product_names: list[str] = []
        for line in lines:
            if not isinstance(line, dict):
                continue
            sku_key = str(line.get("sku_key") or line.get("sku_no") or "").strip()
            product_name = str(line.get("product_name") or "").strip()
            if sku_key:
                sku_keys.append(sku_key)
            if product_name:
                product_names.append(product_name)
            line_serials: list[str] = []
            serial_number = str(line.get("serial_number") or "").strip()
            if serial_number:
                line_serials.append(serial_number)
            try:
                parsed = json.loads(str(line.get("serial_numbers_json") or "[]"))
            except json.JSONDecodeError:
                parsed = []
            if isinstance(parsed, list):
                line_serials.extend(str(item or "").strip() for item in parsed if str(item or "").strip())
            for item in line_serials:
                if item and item not in serials:
                    serials.append(item)
        if not serials:
            continue
        matched_holds = [hold_by_serial[item] for item in serials if item in hold_by_serial]
        transferred_serial_count = len(matched_holds)
        active_hold_count = sum(1 for item in matched_holds if str(item.get("hold_status") or "").strip() == "active")
        consumed_hold_count = sum(1 for item in matched_holds if str(item.get("hold_status") or "").strip() == "consumed")
        released_hold_count = sum(1 for item in matched_holds if str(item.get("hold_status") or "").strip() == "released")
        revoked_hold_count = sum(1 for item in matched_holds if str(item.get("hold_status") or "").strip() == "revoked")
        eligible_serials = [item for item in serials if item not in hold_by_serial]
        if transferred_serial_count == 0:
            derived_transfer_status = "untransferred"
            derived_transfer_label = "未转仓"
        elif transferred_serial_count >= len(serials):
            derived_transfer_status = "transferred"
            derived_transfer_label = "已全部转仓"
        else:
            derived_transfer_status = "partial"
            derived_transfer_label = "部分已转仓"
        searchable_chunks = [
            order_number,
            str(order.get("customer_name") or ""),
            str(order.get("cashier_name") or ""),
            " ".join(product_names[:4]),
            " ".join(sku_keys[:4]),
            " ".join(serials[:8]),
        ]
        searchable_text = " ".join(chunk for chunk in searchable_chunks if chunk).lower()
        if normalized_keyword and normalized_keyword not in searchable_text:
            continue
        if normalized_transfer_status and normalized_transfer_status not in {"all", "*"}:
            status_match = derived_transfer_status == normalized_transfer_status
            if normalized_transfer_status == "active":
                status_match = active_hold_count > 0
            elif normalized_transfer_status == "consumed":
                status_match = consumed_hold_count > 0
            elif normalized_transfer_status == "released":
                status_match = released_hold_count > 0
            if not status_match:
                continue
        summary["all"] += 1
        summary[derived_transfer_status] += 1
        summary["active"] += 1 if active_hold_count > 0 else 0
        summary["consumed"] += 1 if consumed_hold_count > 0 else 0
        summary["released"] += 1 if released_hold_count > 0 else 0
        summary["revoked"] += 1 if revoked_hold_count > 0 else 0
        candidates.append(
            {
                "orderNumber": order_number,
                "businessDate": str(order.get("business_date") or order.get("operate_time") or "").strip(),
                "customerName": str(order.get("customer_name") or "").strip(),
                "cashierName": str(order.get("cashier_name") or "").strip(),
                "shopName": str(order.get("shop_name") or "").strip(),
                "statusName": status_text,
                "payAmount": float(order.get("pay_amount") or order.get("total_amount") or 0) if order.get("pay_amount") is not None or order.get("total_amount") is not None else None,
                "serialCount": len(serials),
                "transferredSerialCount": transferred_serial_count,
                "eligibleTransferCount": len(eligible_serials),
                "activeHoldCount": active_hold_count,
                "consumedHoldCount": consumed_hold_count,
                "releasedHoldCount": released_hold_count,
                "revokedHoldCount": revoked_hold_count,
                "transferStatus": derived_transfer_status,
                "transferStatusLabel": derived_transfer_label,
                "serialNumbers": serials,
                "eligibleSerialNumbers": eligible_serials,
                "skuKeys": sorted({item for item in sku_keys if item}),
                "productNames": sorted({item for item in product_names if item})[:4],
            }
        )
        if len(candidates) >= limit:
            break

    return {
        "generatedAt": now_iso(),
        "source": "sqlite.sales_order+physical_stock_hold",
        "count": len(candidates),
        "summary": summary,
        "items": candidates,
    }


def _physical_hold_count_by_sku(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        """
        SELECT sku_key, COUNT(*) AS total
        FROM physical_stock_hold
        WHERE hold_status = 'active'
        GROUP BY sku_key
        """
    ).fetchall()
    return {
        str(row["sku_key"] or "").strip(): int(row["total"] or 0)
        for row in rows
        if str(row["sku_key"] or "").strip()
    }


def _create_physical_hold_movement(
    conn: sqlite3.Connection,
    *,
    movement_id: str,
    sku_key: str,
    serial_number: str,
    movement_type: str,
    business_date: str,
    source_ref: str,
    source_document_type: str,
    product_name: str = "",
    pn_mtm: str = "",
    spec: str = "",
    operator_name: str = "",
    note: str = "",
    location_name: str = "",
) -> None:
    quantity = 1 if movement_type in {"po_hold_inbound", "po_hold_release", "po_hold_reopen_inbound"} else -1
    conn.execute(
        """
        INSERT INTO inventory_movement
        (id, sku_key, serial_number, movement_type, quantity, business_date,
         source_system, source_ref, source_document_type, inbound_document_no, store_name, location_name,
         product_name, unit_name, unit_cost, amount, operator_name, supplier_name, pn_mtm, spec,
         service_type_name, operate_type_name, pay_remark, company_name, shop_name, warehouse_location_name,
         property_name, property_value, spu_no, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'physical_stock_hold', ?, ?, '', '联想体验店（新野县书院路）', ?,
                ?, '台', NULL, NULL, ?, '', ?, ?, ?, ?, '', '联想智慧零售', '联想体验店（新野县书院路）', ?, '实物仓', ?, '', ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (
            movement_id,
            sku_key,
            serial_number,
            movement_type,
            quantity,
            business_date,
            source_ref,
            source_document_type,
            location_name,
            product_name,
            operator_name,
            pn_mtm,
            spec,
            source_document_type,
            source_document_type,
            location_name,
            PHYSICAL_HOLD_REASON_PREOUT,
            note,
            business_date,
        ),
    )


def transfer_sales_order_serials_to_physical_hold(
    order_number: str,
    *,
    serial_numbers: list[str] | None = None,
    hold_reason: str = PHYSICAL_HOLD_REASON_PREOUT,
    note: str = "",
    operator_name: str = "system",
    warehouse_code: str = PHYSICAL_HOLD_WAREHOUSE_CODE,
    location_code: str = PHYSICAL_HOLD_LOCATION_CODE,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized_order = extract_canonical_sales_order_no(order_number) or str(order_number or "").strip()
    if not normalized_order:
        raise ValueError("order_number_required")
    requested_serials = {
        str(item or "").strip()
        for item in (serial_numbers or [])
        if str(item or "").strip()
    }
    transferred: list[str] = []
    skipped: list[dict[str, Any]] = []
    with connect() as conn:
        line_rows = conn.execute(
            """
            SELECT line.id, line.order_id, line.sku_key, line.product_name, line.mtm_code, line.spec,
                   line.serial_numbers_json, sales_order.business_date
            FROM sales_order_line AS line
            LEFT JOIN sales_order ON sales_order.id = line.order_id
            WHERE line.order_id = ?
            ORDER BY line.id
            """,
            (normalized_order,),
        ).fetchall()
        if not line_rows:
            raise ValueError("sales_order_not_found")
        candidates: list[dict[str, Any]] = []
        for row in line_rows:
            try:
                row_serials = json.loads(str(row["serial_numbers_json"] or "[]"))
            except json.JSONDecodeError:
                row_serials = []
            if not isinstance(row_serials, list):
                row_serials = []
            for serial in row_serials:
                serial_number = str(serial or "").strip()
                if not serial_number:
                    continue
                if requested_serials and serial_number not in requested_serials:
                    continue
                candidates.append({
                    "serial_number": serial_number,
                    "sku_key": str(row["sku_key"] or "").strip(),
                    "product_name": str(row["product_name"] or "").strip(),
                    "pn_mtm": str(row["mtm_code"] or "").strip(),
                    "spec": str(row["spec"] or "").strip(),
                    "line_id": str(row["id"] or "").strip(),
                    "business_date": normalize_business_datetime_text(row["business_date"] or "") or timestamp,
                })
        if requested_serials:
            found_serials = {item["serial_number"] for item in candidates}
            for missing_serial in sorted(requested_serials - found_serials):
                skipped.append({"serialNumber": missing_serial, "reason": "serial_not_in_sales_order"})
        for item in candidates:
            serial_row = conn.execute(
                """
                SELECT serial_number, sku_key, product_name, pn_mtm, spec, status
                FROM serial_item
                WHERE serial_number = ?
                """,
                (item["serial_number"],),
            ).fetchone()
            if not serial_row:
                skipped.append({"serialNumber": item["serial_number"], "reason": "serial_not_found"})
                continue
            existing_hold = conn.execute(
                "SELECT hold_status FROM physical_stock_hold WHERE serial_number = ?",
                (item["serial_number"],),
            ).fetchone()
            if existing_hold and str(existing_hold["hold_status"] or "").strip() == "active":
                skipped.append({"serialNumber": item["serial_number"], "reason": "already_in_physical_hold"})
                continue
            conn.execute(
                """
                INSERT INTO physical_stock_hold
                (serial_number, sku_key, source_order_no, source_order_line_id, hold_reason, warehouse_code,
                 location_code, hold_status, matched_service_order_no, matched_outbound_movement_id, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', '', ?, ?, ?)
                ON CONFLICT(serial_number) DO UPDATE SET
                  sku_key = excluded.sku_key,
                  source_order_no = excluded.source_order_no,
                  source_order_line_id = excluded.source_order_line_id,
                  hold_reason = excluded.hold_reason,
                  warehouse_code = excluded.warehouse_code,
                  location_code = excluded.location_code,
                  hold_status = 'active',
                  matched_service_order_no = '',
                  matched_outbound_movement_id = '',
                  note = excluded.note,
                  updated_at = excluded.updated_at
                """,
                (
                    item["serial_number"],
                    item["sku_key"] or str(serial_row["sku_key"] or "").strip(),
                    normalized_order,
                    item["line_id"],
                    hold_reason,
                    warehouse_code,
                    location_code,
                    note,
                    timestamp,
                    timestamp,
                ),
            )
            _create_physical_hold_movement(
                conn,
                movement_id=f"POHOLD-IN-{normalized_order}-{item['serial_number']}",
                sku_key=item["sku_key"] or str(serial_row["sku_key"] or "").strip(),
                serial_number=item["serial_number"],
                movement_type="po_hold_inbound",
                business_date=timestamp,
                source_ref=normalized_order,
                source_document_type="PO实物仓转入",
                product_name=item["product_name"] or str(serial_row["product_name"] or "").strip(),
                pn_mtm=item["pn_mtm"] or str(serial_row["pn_mtm"] or "").strip(),
                spec=item["spec"] or str(serial_row["spec"] or "").strip(),
                operator_name=operator_name,
                note=note or f"历史销售单 {normalized_order} 转入 PO/教育补实物仓",
                location_name=location_code,
            )
            conn.execute(
                """
                UPDATE serial_item
                SET status = 'in_stock',
                    warehouse_code = ?,
                    location_code = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (warehouse_code, location_code, timestamp, item["serial_number"]),
            )
            # sku.current_stock 由智店通日导数维护（含门店+实物仓 in_stock 总数），
            # 实物仓转入不修改 sku，hold 数走 physical_stock_hold 单独维度展示。
            transferred.append(item["serial_number"])
    return {
        "ok": True,
        "orderNumber": normalized_order,
        "transferredCount": len(transferred),
        "transferredSerials": transferred,
        "skipped": skipped,
    }


def release_physical_hold_to_store(
    serial_numbers: list[str],
    *,
    note: str = "",
    operator_name: str = "system",
    location_code: str = PHYSICAL_HOLD_RELEASE_LOCATION_CODE,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized_serials = [str(item or "").strip() for item in serial_numbers if str(item or "").strip()]
    released: list[str] = []
    skipped: list[dict[str, Any]] = []
    with connect() as conn:
        for serial_number in normalized_serials:
            hold_row = conn.execute(
                """
                SELECT serial_number, sku_key, source_order_no, hold_status
                FROM physical_stock_hold
                WHERE serial_number = ?
                """,
                (serial_number,),
            ).fetchone()
            if not hold_row or str(hold_row["hold_status"] or "").strip() != "active":
                skipped.append({"serialNumber": serial_number, "reason": "hold_not_active"})
                continue
            serial_row = conn.execute(
                "SELECT sku_key, product_name, pn_mtm, spec FROM serial_item WHERE serial_number = ?",
                (serial_number,),
            ).fetchone()
            if not serial_row:
                skipped.append({"serialNumber": serial_number, "reason": "serial_not_found"})
                continue
            conn.execute(
                """
                UPDATE physical_stock_hold
                SET hold_status = 'released',
                    note = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (note or "手动从 PO/教育补实物仓转回门店", timestamp, serial_number),
            )
            _create_physical_hold_movement(
                conn,
                movement_id=f"POHOLD-REL-{serial_number}",
                sku_key=str(serial_row["sku_key"] or "").strip(),
                serial_number=serial_number,
                movement_type="po_hold_release",
                business_date=timestamp,
                source_ref=str(hold_row["source_order_no"] or "").strip() or serial_number,
                source_document_type="PO实物仓转回门店",
                product_name=str(serial_row["product_name"] or "").strip(),
                pn_mtm=str(serial_row["pn_mtm"] or "").strip(),
                spec=str(serial_row["spec"] or "").strip(),
                operator_name=operator_name,
                note=note or f"SN {serial_number} 手动转回门店可售库存",
                location_name=location_code,
            )
            conn.execute(
                """
                UPDATE serial_item
                SET status = 'in_stock',
                    warehouse_code = 'STORE',
                    location_code = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (location_code, timestamp, serial_number),
            )
            # 转回门店不修改 sku.current_stock（日导数已含该 SN）。
            released.append(serial_number)
    return {
        "ok": True,
        "releasedCount": len(released),
        "releasedSerials": released,
        "skipped": skipped,
    }


def revoke_physical_hold_transfer(
    serial_numbers: list[str],
    *,
    note: str = "",
    operator_name: str = "system",
    location_code: str = PHYSICAL_HOLD_REVOKED_LOCATION_CODE,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized_serials = [str(item or "").strip() for item in serial_numbers if str(item or "").strip()]
    revoked: list[str] = []
    skipped: list[dict[str, Any]] = []
    owns_connection = conn is None
    active_conn = conn or connect()
    try:
        for serial_number in normalized_serials:
            hold_row = active_conn.execute(
                """
                SELECT serial_number, sku_key, source_order_no, hold_status, matched_service_order_no
                FROM physical_stock_hold
                WHERE serial_number = ?
                """,
                (serial_number,),
            ).fetchone()
            if not hold_row or str(hold_row["hold_status"] or "").strip() != "active":
                skipped.append({"serialNumber": serial_number, "reason": "hold_not_active"})
                continue
            serial_row = active_conn.execute(
                "SELECT sku_key, product_name, pn_mtm, spec FROM serial_item WHERE serial_number = ?",
                (serial_number,),
            ).fetchone()
            if not serial_row:
                skipped.append({"serialNumber": serial_number, "reason": "serial_not_found"})
                continue
            active_conn.execute(
                """
                UPDATE physical_stock_hold
                SET hold_status = 'revoked',
                    matched_service_order_no = '',
                    matched_outbound_movement_id = '',
                    note = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (note or "误转仓撤销，恢复销售出库状态", timestamp, serial_number),
            )
            _create_physical_hold_movement(
                active_conn,
                movement_id=f"POHOLD-REV-{serial_number}",
                sku_key=str(serial_row["sku_key"] or "").strip(),
                serial_number=serial_number,
                movement_type="po_hold_revoke_outbound",
                business_date=timestamp,
                source_ref=str(hold_row["source_order_no"] or "").strip() or serial_number,
                source_document_type="实物仓撤销转入",
                product_name=str(serial_row["product_name"] or "").strip(),
                pn_mtm=str(serial_row["pn_mtm"] or "").strip(),
                spec=str(serial_row["spec"] or "").strip(),
                operator_name=operator_name,
                note=note or f"SN {serial_number} 撤销误转入实物仓，恢复销售出库状态",
                location_name=location_code,
            )
            active_conn.execute(
                """
                UPDATE serial_item
                SET status = 'sold',
                    warehouse_code = 'STORE',
                    location_code = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (location_code, timestamp, serial_number),
            )
            revoked.append(serial_number)
    finally:
        if owns_connection:
            active_conn.commit()
            active_conn.close()
    return {
        "ok": True,
        "revokedCount": len(revoked),
        "revokedSerials": revoked,
        "skipped": skipped,
    }


def reopen_consumed_physical_hold(
    serial_numbers: list[str],
    *,
    note: str = "",
    operator_name: str = "system",
    location_code: str = PHYSICAL_HOLD_LOCATION_CODE,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized_serials = [str(item or "").strip() for item in serial_numbers if str(item or "").strip()]
    reopened: list[str] = []
    skipped: list[dict[str, Any]] = []
    owns_connection = conn is None
    active_conn = conn or connect()
    try:
        for serial_number in normalized_serials:
            hold_row = active_conn.execute(
                """
                SELECT serial_number, sku_key, source_order_no, hold_status
                FROM physical_stock_hold
                WHERE serial_number = ?
                """,
                (serial_number,),
            ).fetchone()
            if not hold_row or str(hold_row["hold_status"] or "").strip() != "consumed":
                skipped.append({"serialNumber": serial_number, "reason": "hold_not_consumed"})
                continue
            serial_row = active_conn.execute(
                "SELECT sku_key, product_name, pn_mtm, spec FROM serial_item WHERE serial_number = ?",
                (serial_number,),
            ).fetchone()
            if not serial_row:
                skipped.append({"serialNumber": serial_number, "reason": "serial_not_found"})
                continue
            active_conn.execute(
                """
                UPDATE physical_stock_hold
                SET hold_status = 'active',
                    matched_service_order_no = '',
                    matched_outbound_movement_id = '',
                    note = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (note or "撤销误核销，恢复实物仓 active 状态", timestamp, serial_number),
            )
            _create_physical_hold_movement(
                active_conn,
                movement_id=f"POHOLD-REOPEN-{serial_number}",
                sku_key=str(serial_row["sku_key"] or "").strip(),
                serial_number=serial_number,
                movement_type="po_hold_reopen_inbound",
                business_date=timestamp,
                source_ref=str(hold_row["source_order_no"] or "").strip() or serial_number,
                source_document_type="撤销误核销恢复实物仓",
                product_name=str(serial_row["product_name"] or "").strip(),
                pn_mtm=str(serial_row["pn_mtm"] or "").strip(),
                spec=str(serial_row["spec"] or "").strip(),
                operator_name=operator_name,
                note=note or f"SN {serial_number} 撤销误核销，恢复到实物仓 active 状态",
                location_name=location_code,
            )
            active_conn.execute(
                """
                UPDATE serial_item
                SET status = 'in_stock',
                    warehouse_code = ?,
                    location_code = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (PHYSICAL_HOLD_WAREHOUSE_CODE, location_code, timestamp, serial_number),
            )
            # 恢复 active 不修改 sku.current_stock（日导数已含该 SN）。
            reopened.append(serial_number)
    finally:
        if owns_connection:
            active_conn.commit()
            active_conn.close()
    return {
        "ok": True,
        "reopenedCount": len(reopened),
        "reopenedSerials": reopened,
        "skipped": skipped,
    }


def rebind_physical_hold_service_order(
    service_order_no: str,
    *,
    serial_numbers: list[str],
    note: str = "",
    operator_name: str = "system",
) -> dict[str, Any]:
    init_db()
    normalized_serials = [str(item or "").strip() for item in serial_numbers if str(item or "").strip()]
    if not normalized_serials:
        raise ValueError("serial_numbers_required")
    with connect() as conn:
        reopen_result = reopen_consumed_physical_hold(
            normalized_serials,
            note=note or "重绑服务单前先撤销旧核销",
            operator_name=operator_name,
            conn=conn,
        )
        finalize_result = finalize_physical_hold_from_service_orders(
            service_order_no=service_order_no,
            serial_numbers=normalized_serials,
            note=note or f"重绑到智惠服务单 {service_order_no}",
            operator_name=operator_name,
            conn=conn,
        )
        conn.commit()
    return {
        "ok": True,
        "serviceOrderNo": str(service_order_no or "").strip(),
        "reopenedCount": int(reopen_result.get("reopenedCount", 0)),
        "reopenedSerials": reopen_result.get("reopenedSerials", []),
        "finalizedCount": int(finalize_result.get("finalizedCount", 0)),
        "finalizedSerials": finalize_result.get("finalizedSerials", []),
        "skipped": [*(reopen_result.get("skipped", []) or []), *(finalize_result.get("skipped", []) or [])],
    }


def finalize_physical_hold_from_service_orders(
    *,
    service_order_no: str = "",
    serial_numbers: list[str] | None = None,
    note: str = "",
    operator_name: str = "system",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    normalized_service_order = str(service_order_no or "").strip()
    normalized_serials = {
        str(item or "").strip()
        for item in (serial_numbers or [])
        if str(item or "").strip()
    }
    finalized: list[str] = []
    skipped: list[dict[str, Any]] = []
    owns_connection = conn is None
    active_conn = conn or connect()
    try:
        hold_rows = active_conn.execute(
            """
            SELECT hold.serial_number, hold.sku_key, hold.source_order_no, hold.hold_status,
                   serial_item.product_name, serial_item.pn_mtm, serial_item.spec
            FROM physical_stock_hold AS hold
            LEFT JOIN serial_item ON serial_item.serial_number = hold.serial_number
            WHERE hold.hold_status = 'active'
            ORDER BY hold.updated_at DESC, hold.serial_number
            """
        ).fetchall()
        for hold_row in hold_rows:
            serial_number = str(hold_row["serial_number"] or "").strip()
            if normalized_serials and serial_number not in normalized_serials:
                continue
            movement_row = active_conn.execute(
                """
                SELECT
                    id,
                    source_ref,
                    business_date,
                    sku_key,
                    pn_mtm,
                    source_document_type,
                    service_type_name,
                    operate_type_name,
                    note,
                    product_name,
                    pay_remark
                FROM inventory_movement
                WHERE TRIM(COALESCE(serial_number, '')) = ?
                  AND movement_type IN ('sales_outbound', 'transfer_outbound')
                ORDER BY
                  CASE
                    WHEN UPPER(COALESCE(product_name, '')) LIKE '%LENOVO CARE%'
                      OR COALESCE(product_name, '') LIKE '%智惠%'
                      OR COALESCE(source_document_type, '') LIKE '%智惠%'
                      OR COALESCE(service_type_name, '') LIKE '%智惠%'
                      OR COALESCE(operate_type_name, '') LIKE '%智惠%'
                      OR UPPER(COALESCE(note, '')) LIKE '%CARE%'
                      OR COALESCE(note, '') LIKE '%智惠%'
                    THEN 0
                    ELSE 1
                  END,
                  business_date DESC,
                  created_at DESC
                """,
                (serial_number,),
            ).fetchone()
            if not movement_row:
                skipped.append({"serialNumber": serial_number, "reason": "service_outbound_not_found"})
                continue
            movement_source_ref = str(movement_row["source_ref"] or "").strip()
            if normalized_service_order and movement_source_ref != normalized_service_order:
                skipped.append({"serialNumber": serial_number, "reason": "service_order_not_matched", "sourceRef": movement_source_ref})
                continue
            hold_pn = normalize_lookup_key(hold_row["pn_mtm"] or "")
            movement_pn = normalize_lookup_key(movement_row["pn_mtm"] or "")
            hold_sku = normalize_lookup_key(hold_row["sku_key"] or "")
            movement_sku = normalize_lookup_key(movement_row["sku_key"] or "")
            if hold_pn and movement_pn and hold_pn != movement_pn:
                skipped.append({
                    "serialNumber": serial_number,
                    "reason": "service_order_pn_mismatch",
                    "sourceRef": movement_source_ref,
                    "holdPnMtm": str(hold_row["pn_mtm"] or "").strip(),
                    "movementPnMtm": str(movement_row["pn_mtm"] or "").strip(),
                })
                continue
            if not movement_pn and hold_sku and movement_sku and hold_sku != movement_sku:
                skipped.append({
                    "serialNumber": serial_number,
                    "reason": "service_order_sku_mismatch",
                    "sourceRef": movement_source_ref,
                    "holdSkuKey": str(hold_row["sku_key"] or "").strip(),
                    "movementSkuKey": str(movement_row["sku_key"] or "").strip(),
                })
                continue
            if not is_service_fulfillment_text(
                movement_row["product_name"],
                movement_row["source_document_type"],
                movement_row["service_type_name"],
                movement_row["operate_type_name"],
                movement_row["note"],
                movement_row["pay_remark"],
                movement_source_ref,
            ):
                skipped.append({"serialNumber": serial_number, "reason": "movement_not_service_fulfillment", "sourceRef": movement_source_ref})
                continue
            movement_id = str(movement_row["id"] or "").strip()
            active_conn.execute(
                """
                UPDATE physical_stock_hold
                SET hold_status = 'consumed',
                    matched_service_order_no = ?,
                    matched_outbound_movement_id = ?,
                    note = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (
                    movement_source_ref,
                    movement_id,
                    note or f"由智惠服务订单 {movement_source_ref} 完成二次出库",
                    timestamp,
                    serial_number,
                ),
            )
            _create_physical_hold_movement(
                active_conn,
                movement_id=f"POHOLD-OUT-{movement_source_ref}-{serial_number}",
                sku_key=str(hold_row["sku_key"] or "").strip(),
                serial_number=serial_number,
                movement_type="po_hold_outbound",
                business_date=normalize_business_datetime_text(movement_row["business_date"] or "") or timestamp,
                source_ref=movement_source_ref or movement_id,
                source_document_type="智惠服务二次出库",
                product_name=str(hold_row["product_name"] or "").strip(),
                pn_mtm=str(hold_row["pn_mtm"] or "").strip(),
                spec=str(hold_row["spec"] or "").strip(),
                operator_name=operator_name,
                note=note or f"SN {serial_number} 匹配智惠服务订单 {movement_source_ref} 完成二次出库",
                location_name=PHYSICAL_HOLD_CONSUMED_LOCATION_CODE,
            )
            active_conn.execute(
                """
                UPDATE serial_item
                SET status = 'sold',
                    warehouse_code = ?,
                    location_code = ?,
                    updated_at = ?
                WHERE serial_number = ?
                """,
                (PHYSICAL_HOLD_WAREHOUSE_CODE, PHYSICAL_HOLD_CONSUMED_LOCATION_CODE, timestamp, serial_number),
            )
            finalized.append(serial_number)
    finally:
        if owns_connection:
            active_conn.commit()
            active_conn.close()
    return {
        "ok": True,
        "serviceOrderNo": normalized_service_order,
        "finalizedCount": len(finalized),
        "finalizedSerials": finalized,
        "skipped": skipped,
    }


def list_inventory_movements(
    page: int = 1,
    page_size: int = 20,
    start_date: str = "",
    end_date: str = "",
    movement_type: str = "",
) -> dict[str, Any]:
    """
    出入库流水查询，支持：
    - 日期范围筛选 (start_date / end_date, YYYY-MM-DD)
    - 移动类型筛选 (movement_type: sales_outbound / purchase_inbound / transfer_outbound / transfer_inbound)
    - 分页 (page 从1开始)
    返回：items + 分页元数据 + 分类统计(typeCounts/flowCategoryCounts/operateTypeCounts)
    """
    init_db()
    conditions = []
    params: list = []

    if start_date:
        conditions.append("movement.business_date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("movement.business_date <= ?")
        params.append(end_date)
    if movement_type and movement_type not in ("", "all"):
        conditions.append("movement.movement_type = ?")
        params.append(movement_type)
        if movement_type == "purchase_inbound":
            conditions.append(
                """
                NOT (
                  movement.movement_type = 'purchase_inbound'
                  AND (
                    UPPER(COALESCE(movement.source_ref, '')) LIKE 'PURCHASEQ-%'
                    OR UPPER(COALESCE(movement.source_ref, '')) LIKE 'TDR%'
                    OR UPPER(COALESCE(movement.source_ref, '')) GLOB 'T[0-9]*'
                    OR COALESCE(movement.note, '') LIKE '%openclaw.full_db.purchase_inbound%'
                    OR COALESCE(movement.note, '') LIKE '%重复占位采购行%'
                    OR COALESCE(movement.note, '') LIKE '%库存流水导出导入%'
                  )
                )
                """
            )

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    movement_type_name_map = {
        "sales_outbound": "销售出库",
        "purchase_inbound": "采购入库",
        "transfer_outbound": "调拨出库",
        "transfer_inbound": "调拨入库",
        "po_hold_inbound": "实物仓转入",
        "po_hold_release": "实物仓转回门店",
        "po_hold_outbound": "智惠服务二次出库",
        "po_hold_revoke_outbound": "实物仓撤销转入",
        "po_hold_reopen_inbound": "撤销误核销恢复实物仓",
        "stock_adjustment": "库存调整",
    }

    # 总记录数
    with connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM inventory_movement AS movement WHERE {where_clause}",
            params,
        ).fetchone()[0]

    # 分类统计（基于筛选后全量，不受分页影响）
    type_counts: dict[str, int] = {}
    flow_category_counts: dict[str, int] = {}
    operate_type_counts: dict[str, int] = {}

    with connect() as conn:
        for row in conn.execute(
            f"""
            SELECT movement_type, operate_type_name, source_ref, note
            FROM inventory_movement AS movement
            WHERE {where_clause}
            """,
            params,
        ).fetchall():
            mt = str(row[0] or "")
            ot = str(row[1] or "").strip()
            source_ref = str(row[2] or "")
            note_text = str(row[3] or "")
            is_non_normal_purchase = _is_non_normal_purchase_inbound_row(mt, source_ref, note_text)
            counted_mt = "" if is_non_normal_purchase else mt
            if counted_mt:
                type_counts[counted_mt] = type_counts.get(counted_mt, 0) + 1
            elif is_non_normal_purchase:
                type_counts["other_inbound_import"] = type_counts.get("other_inbound_import", 0) + 1
            if ot:
                operate_type_counts[ot] = operate_type_counts.get(ot, 0) + 1
            fc_map = {
                "sales_outbound": "销售出库",
                "purchase_inbound": "采购入库",
                "transfer_outbound": "调拨出库",
                "transfer_inbound": "调拨入库",
                "po_hold_inbound": "实物仓转入",
                "po_hold_release": "实物仓转回门店",
                "po_hold_outbound": "智惠服务二次出库",
                "po_hold_revoke_outbound": "实物仓撤销转入",
                "po_hold_reopen_inbound": "撤销误核销恢复实物仓",
            }
            if is_non_normal_purchase:
                fc = "其他"
            else:
                fc = fc_map.get(mt, "其他")
            flow_category_counts[fc] = flow_category_counts.get(fc, 0) + 1

    # 分页数据（去重后）
    offset = (page - 1) * page_size
    with connect() as conn:
        raw_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT movement.id, movement.sku_key, sku.name AS product_name,
                       sku.category, sku.source_category, sku.jd_subcategory,
                       CASE 
                         WHEN json_valid(movement.serial_number) THEN
                           COALESCE(
                             (SELECT value FROM json_each(movement.serial_number) LIMIT 1),
                             movement.serial_number
                           )
                         ELSE movement.serial_number
                       END AS serial_number,
                       CASE 
                         WHEN json_valid(movement.serial_number) THEN
                           (SELECT GROUP_CONCAT(value, ', ') FROM json_each(movement.serial_number))
                         WHEN movement.movement_type = 'purchase_inbound' THEN
                           COALESCE(
                             (SELECT GROUP_CONCAT(serial_number, ', ') FROM serial_item
                               WHERE inbound_document_no = COALESCE(
                                     NULLIF(movement.inbound_document_no, ''),
                                     movement.source_ref)
                                 AND sku_key = movement.sku_key),
                             (SELECT GROUP_CONCAT(value, ', ')
                                FROM purchase_order_line pol, json_each(pol.serial_numbers_json)
                               WHERE pol.order_id = COALESCE(
                                     NULLIF(movement.inbound_document_no, ''),
                                     movement.source_ref)
                                 AND pol.sku_key = movement.sku_key),
                             movement.serial_number
                           )
                         ELSE movement.serial_number
                       END AS serial_numbers_display,
                       movement.movement_type,
                       movement.quantity, movement.business_date,
                       movement.source_system, movement.source_ref,
                       movement.source_document_type, movement.inbound_document_no,
                       movement.store_name,
                       movement.unit_name,
                       CASE
                         WHEN movement.movement_type = 'purchase_inbound' THEN
                           COALESCE(
                             NULLIF(movement.unit_cost, 0),
                             (SELECT pol.cost_price
                                FROM purchase_order_line pol
                               WHERE pol.order_id = COALESCE(NULLIF(movement.inbound_document_no, ''), movement.source_ref)
                                 AND pol.sku_key = movement.sku_key
                               LIMIT 1)
                           )
                         ELSE movement.unit_cost
                       END AS unit_cost,
                       CASE
                         WHEN movement.movement_type = 'purchase_inbound' THEN
                           COALESCE(
                             NULLIF(movement.amount, 0),
                             ROUND(NULLIF(movement.unit_cost, 0) * ABS(movement.quantity), 2),
                             (SELECT ROUND(pol.cost_price * ABS(movement.quantity), 2)
                                FROM purchase_order_line pol
                               WHERE pol.order_id = COALESCE(NULLIF(movement.inbound_document_no, ''), movement.source_ref)
                                 AND pol.sku_key = movement.sku_key
                               LIMIT 1)
                           )
                         ELSE movement.amount
                       END AS amount,
                       movement.service_type_name,
                       movement.operate_type_name,
                       movement.pay_remark,
                       movement.company_name,
                       movement.shop_name,
                       movement.warehouse_location_name,
                       movement.property_name,
                       movement.property_value,
                       movement.spu_no,
                       movement.note, movement.created_at,
                       -- Scalar subquery: handles JSON array SN (purchase_inbound) vs plain SN (sales_outbound)
                       COALESCE(
                           (SELECT si.pn_mtm FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.pn_mtm, ''), sku.pn_mtm, '') AS pn_mtm,
                       COALESCE(
                           (SELECT si.spec FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.spec, ''), '') AS spec,
                       COALESCE(
                           (SELECT si.location_code FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.location_name, ''), '') AS location_name,
                       COALESCE(
                           (SELECT si.operator_name FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.operator_name, ''), '') AS operator_name,
                       COALESCE(
                           (SELECT si.supplier_name FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.supplier_name, ''), '') AS supplier_name,
                       COALESCE(
                           (SELECT si.inbound_document_no FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           NULLIF(movement.inbound_document_no, ''), movement.source_ref, '') AS inbound_document_no,
                       COALESCE(
                           (SELECT si.status FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           '') AS serial_status,
                       COALESCE(
                           (SELECT si.inbound_date FROM serial_item si
                            WHERE (json_valid(movement.serial_number) AND si.serial_number IN (
                                SELECT value FROM json_each(movement.serial_number)))
                             OR (NOT json_valid(movement.serial_number) AND si.serial_number = movement.serial_number)
                            LIMIT 1),
                           '') AS serial_inbound_date
                FROM inventory_movement AS movement
                LEFT JOIN sku ON sku.sku_key = movement.sku_key
                WHERE {where_clause}
                ORDER BY movement.business_date DESC, movement.created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            ).fetchall()
        ]
        rows = _dedupe_inventory_movement_rows(raw_rows)

    # 采购入库 SN 兜底：当流水行未带 SN 时，按单号+SKU 回查 serial_item 明细。
    inbound_serial_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
    with connect() as conn:
        for row in rows:
            mt = str(row.get("movement_type") or "")
            if mt != "purchase_inbound":
                continue
            sku_key = str(row.get("sku_key") or "").strip()
            if not sku_key:
                continue
            doc_no = str(row.get("inbound_document_no") or row.get("source_ref") or "").strip()
            canonical_doc_no = extract_canonical_purchase_order_no(doc_no)
            key = (canonical_doc_no or doc_no, sku_key)
            if key in inbound_serial_cache:
                continue
            if not (doc_no or canonical_doc_no):
                inbound_serial_cache[key] = []
                continue
            serial_rows = conn.execute(
                """
                SELECT serial_number, pn_mtm, spec, location_code, operator_name, supplier_name, inbound_document_no, inbound_date, status, cost_amount
                FROM serial_item
                WHERE sku_key = ?
                  AND (
                    inbound_document_no = ?
                    OR inbound_document_no = ?
                  )
                ORDER BY inbound_date DESC, updated_at DESC
                """,
                (sku_key, doc_no, canonical_doc_no or doc_no),
            ).fetchall()
            inbound_serial_cache[key] = [dict(item) for item in serial_rows]

    # 补字段别名（智店通常用口径）
    for row in rows:
        original_source_ref = str(row.get("source_ref") or "").strip()
        original_inbound_document_no = str(row.get("inbound_document_no") or "").strip()
        mt = str(row.get("movement_type") or "")
        normalized_source_document_type = str(row.get("source_document_type") or "").strip()
        canonical_purchase_document_no = extract_canonical_purchase_order_no(original_source_ref, original_inbound_document_no)
        looks_like_purchase_document = bool(canonical_purchase_document_no and re.search(r"CGR\d{8,}", f"{original_source_ref} {original_inbound_document_no}".upper()))
        if looks_like_purchase_document and mt == "sales_outbound":
            mt = "purchase_inbound"
            row["movement_type"] = mt
        if looks_like_purchase_document:
            normalized_source_document_type = "采购入库"
            row["source_document_type"] = normalized_source_document_type
        effective_document_type = normalized_source_document_type or mt
        normalized_document_no = normalize_movement_document_number(
            effective_document_type,
            original_source_ref,
            original_source_ref,
            original_inbound_document_no,
        )
        normalized_inbound_document_no = (
            extract_canonical_purchase_order_no(original_inbound_document_no, original_source_ref)
            if effective_document_type == "purchase_inbound"
            else original_inbound_document_no
        )
        normalized_serial = normalize_serial_display_text(row.get("serial_number"))
        normalized_serials_display = normalize_serial_display_text(row.get("serial_numbers_display"))
        is_non_normal_purchase = _is_non_normal_purchase_inbound_row(
            mt,
            original_source_ref,
            str(row.get("note") or ""),
        )

        row["serial_number"] = normalized_serial
        row["serial_numbers_display"] = normalized_serials_display or normalized_serial
        row["source_ref"] = normalized_document_no or str(row.get("source_ref") or "").strip()
        row["inbound_document_no"] = normalized_inbound_document_no or normalized_document_no
        row["service_no"] = row.get("source_ref") or row.get("id") or ""
        row["movement_no"] = row.get("source_ref") or row.get("id") or ""
        row["document_no"] = row.get("source_ref") or row.get("inbound_document_no") or row.get("id") or ""
        row["business_no"] = row.get("source_ref") or row.get("inbound_document_no") or ""
        row["sku_no"] = row.get("sku_key") or ""
        row["user_name"] = row.get("operator_name") or ""
        row["pay_time"] = row.get("business_date") or ""
        row["operate_time"] = row.get("business_date") or row.get("created_at") or ""
        row["warehouse_name"] = row.get("warehouse_location_name") or row.get("location_name") or ""
        row["movement_type_name"] = "其他订单" if is_non_normal_purchase else movement_type_name_map.get(mt, "其他")
        row["operate_type_name"] = row.get("operate_type_name") or ""
        row["service_type_name"] = normalized_source_document_type or row.get("service_type_name") or ""
        row["flow_category"] = "其他" if is_non_normal_purchase else {
            "sales_outbound": "销售出库",
            "purchase_inbound": "采购入库",
            "transfer_outbound": "调拨出库",
            "transfer_inbound": "调拨入库",
            "po_hold_inbound": "实物仓转入",
            "po_hold_release": "实物仓转回门店",
            "po_hold_outbound": "智惠服务二次出库",
        }.get(mt, "其他")

        # 针对采购入库行，确保 SN/PN/规格/操作人/供应商能从 serial_item 自动回填。
        if mt == "purchase_inbound":
            sku_key = str(row.get("sku_key") or "").strip()
            inbound_doc_no = str(row.get("inbound_document_no") or row.get("source_ref") or "").strip()
            canonical_doc_no = extract_canonical_purchase_order_no(inbound_doc_no)
            serial_meta = inbound_serial_cache.get((canonical_doc_no or inbound_doc_no, sku_key), [])
            if serial_meta:
                serial_numbers: list[str] = []
                seen_serials: set[str] = set()
                for item in serial_meta:
                    serial = str(item.get("serial_number") or "").strip()
                    if not serial:
                        continue
                    upper = serial.upper()
                    if upper in seen_serials:
                        continue
                    seen_serials.add(upper)
                    serial_numbers.append(serial)
                if serial_numbers:
                    row["serial_numbers_display"] = ", ".join(serial_numbers)
                    row["serial_number"] = row.get("serial_number") or serial_numbers[0]
                first = serial_meta[0]
                row["pn_mtm"] = row.get("pn_mtm") or str(first.get("pn_mtm") or "").strip()
                row["spec"] = row.get("spec") or str(first.get("spec") or "").strip()
                row["location_name"] = row.get("location_name") or str(first.get("location_code") or "").strip()
                row["operator_name"] = row.get("operator_name") or str(first.get("operator_name") or "").strip()
                row["supplier_name"] = row.get("supplier_name") or str(first.get("supplier_name") or "").strip()
                if not row.get("unit_cost"):
                    cost_amount = first.get("cost_amount")
                    if cost_amount not in (None, ""):
                        try:
                            row["unit_cost"] = float(cost_amount)
                        except (TypeError, ValueError):
                            pass

    return {
        "items": rows,
        "count": total,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": (total + page_size - 1) // page_size if total else 1,
        "typeCounts": type_counts,
        "flowCategoryCounts": flow_category_counts,
        "operateTypeCounts": operate_type_counts,
    }


def list_sales_orders(limit: int = 80) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, store_code, operator_id, customer_name, status, status_name,
                       total_amount, pay_amount, order_type, order_type_name,
                       channel_type_name, cashier_name, total_quantity, pay_time, created_time,
                       shop_id, shop_name, company_id, external_order_no,
                       business_date, raw_payload_json, note, created_at
                FROM sales_order
                ORDER BY
                    COALESCE(NULLIF(TRIM(business_date), ''), NULLIF(TRIM(pay_time), ''), NULLIF(TRIM(created_time), ''), created_at) DESC,
                    created_at DESC,
                    id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
        shadowed_shell_order_ids = {
            str(row.get("external_order_no") or "").strip()
            for row in rows
            if str(row.get("id") or "").strip().upper().startswith("XS")
            and str(row.get("external_order_no") or "").strip()
        }
        rows = [
            row
            for row in rows
            if not (
                str(row.get("id") or "").strip() in shadowed_shell_order_ids
                and not str(row.get("id") or "").strip().upper().startswith("XS")
                and not str(row.get("external_order_no") or "").strip()
            )
        ]
        line_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, order_id, sku_key, quantity, deal_price, serial_numbers_json, created_at
                       , product_name, product_no, mtm_code, spec, supplier_name, pay_amount, discount_amount, serial_number
                FROM sales_order_line
                WHERE order_id IN ({})
                ORDER BY order_id, id
                """.format(",".join("?" for _ in rows) or "''"),
                tuple(row["id"] for row in rows),
            ).fetchall()
        ] if rows else []
        registry_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT order_number, status, missing_fields_json
                FROM order_sync_registry
                WHERE order_number IN ({})
                """.format(",".join("?" for _ in rows) or "''"),
                tuple(row["id"] for row in rows),
            ).fetchall()
        ] if rows else []
    should_scale_amount_by_100 = False
    positive_totals = [float(row.get("total_amount") or 0) for row in rows if float(row.get("total_amount") or 0) > 0]
    if positive_totals:
        should_scale_amount_by_100 = max(positive_totals) < 1000

    lines_by_order: dict[str, list[dict[str, Any]]] = {}
    for row in line_rows:
        if should_scale_amount_by_100:
            for field in ("deal_price", "pay_amount", "discount_amount"):
                raw_value = row.get(field)
                if raw_value is None:
                    continue
                try:
                    number_value = float(raw_value)
                except (TypeError, ValueError):
                    continue
                if number_value > 0:
                    row[field] = round(number_value * 100, 2)
        lines_by_order.setdefault(str(row["order_id"]), []).append(row)
    registry_by_order = {str(row["order_number"]): row for row in registry_rows}
    for row in rows:
        if should_scale_amount_by_100:
            for field in ("total_amount", "pay_amount"):
                raw_value = row.get(field)
                if raw_value is None:
                    continue
                try:
                    number_value = float(raw_value)
                except (TypeError, ValueError):
                    continue
                if number_value > 0:
                    row[field] = round(number_value * 100, 2)
        order_id = str(row["id"])
        registry = registry_by_order.get(order_id)
        missing_fields: list[str] = []
        if registry:
            try:
                parsed_missing_fields = json.loads(str(registry.get("missing_fields_json") or "[]"))
                if isinstance(parsed_missing_fields, list):
                    missing_fields = [str(item) for item in parsed_missing_fields]
            except json.JSONDecodeError:
                missing_fields = []
        amount_pending = (
            float(row.get("total_amount") or 0) <= 0
            and (
                "sales_order_amount_snapshot" in missing_fields
                or str(row.get("note") or "").startswith("由智店通销售出库流水派生")
                or "SN库存订单导出补同步" in str(row.get("note") or "")
            )
        )
        row_lines = lines_by_order.get(order_id, [])
        if amount_pending:
            row["total_amount"] = None
            row["amount_status"] = "pending_source_export"
            row["amount_source"] = "missing_orderData_orderProductData"
            for line in row_lines:
                if float(line.get("deal_price") or 0) <= 0:
                    line["deal_price"] = None
        # OpenClaw / 智店通常用口径别名，便于前端统一展示与对账。
        row["order_no"] = row.get("id") or ""
        row["order_number"] = row.get("id") or ""
        row["business_no"] = row.get("external_order_no") or row.get("id") or ""
        row["operate_time"] = row.get("pay_time") or row.get("created_time") or row.get("created_at") or ""
        row["raw_payload"] = _decode_json_field(row.get("raw_payload_json"), {}) if row.get("raw_payload_json") else {}
        row["lines"] = row_lines
        for line in row_lines:
            line["sku_no"] = line.get("sku_key") or ""
            line["unit_price"] = line.get("deal_price")
            line["deal_amount"] = line.get("pay_amount")
            line["supplier_name"] = line.get("supplier_name") or ""
            line["serial_number"] = line.get("serial_number") or (
                (_decode_json_field(line.get("serial_numbers_json"), [""])[0] if _decode_json_field(line.get("serial_numbers_json"), []) else "")
            )
    return {"items": rows, "count": len(rows)}


def _decode_json_field(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback


def list_customers(limit: int = 500) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT customer.id, customer.name, customer.phone, customer.created_at,
                       COUNT(sales_order.id) AS order_count,
                       MAX(sales_order.business_date) AS latest_order_date,
                       SUM(COALESCE(sales_order.pay_amount, sales_order.total_amount, 0)) AS total_paid_amount
                FROM customer
                LEFT JOIN sales_order ON sales_order.customer_name = customer.name
                  OR (TRIM(COALESCE(customer.phone, '')) <> '' AND sales_order.customer_name = customer.phone)
                GROUP BY customer.id, customer.name, customer.phone, customer.created_at
                ORDER BY latest_order_date DESC, customer.created_at DESC
                LIMIT ?
                """,
                (max(int(limit or 0), 1),),
            ).fetchall()
        ]
    return {
        "items": rows,
        "count": len(rows),
        "source": "retail_core.customer",
    }


def list_order_sync_registry(limit: int = 120) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM order_sync_registry
                ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END,
                         business_date DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
    for row in rows:
        row["sku_keys"] = _decode_json_field(row.pop("sku_keys_json", "[]"), [])
        row["serial_numbers"] = _decode_json_field(row.pop("serial_numbers_json", "[]"), [])
        row["missing_fields"] = _decode_json_field(row.pop("missing_fields_json", "[]"), [])
        row["source_files"] = _decode_json_field(row.pop("source_files_json", "[]"), [])
    return {"items": rows, "count": len(rows)}


def list_sync_gap_queue(limit: int = 120) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM sync_gap_queue
                ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END,
                         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                         business_date DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
        status_rows = conn.execute(
            "SELECT status, COUNT(*) AS count FROM sync_gap_queue GROUP BY status"
        ).fetchall()
    for row in rows:
        row["missing_fields"] = _decode_json_field(row.pop("missing_fields_json", "[]"), [])
        row["source_flags"] = _decode_json_field(row.pop("source_flags_json", "{}"), {})
        row["source_files"] = _decode_json_field(row.pop("source_files_json", "[]"), [])
    return {
        "items": rows,
        "count": len(rows),
        "statusCounts": {row["status"]: int(row["count"]) for row in status_rows},
    }


def sync_education_agent_scan_raw(conn: sqlite3.Connection, data_dir: Path, timestamp: str) -> int:
    payload = _load_json_payload(data_dir, "latest-education-subsidy-agent-scan-summary.json")
    rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return 0

    def _text(value: Any) -> str:
        return str(value or "").strip()

    def _phone(value: Any) -> str:
        digits = "".join(ch for ch in _text(value) if ch.isdigit())
        if digits.startswith("86") and len(digits) > 11:
            return digits[-11:]
        return digits

    conn.execute("DELETE FROM education_agent_scan_raw")
    inserted = 0
    for item in rows:
        if not isinstance(item, dict):
            continue
        serial_numbers = item.get("serialNumbers")
        if not isinstance(serial_numbers, list):
            serial_numbers = []
        serial_numbers = [str(value).strip() for value in serial_numbers if str(value).strip()]
        record_id = _text(item.get("id")) or f"education-agent-{inserted+1}"
        scan_date = _date_part(_text(item.get("scanDate"))) or _date_part(_text(item.get("lockedDisplayDate"))) or ""
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO education_agent_scan_raw
            (record_id, source_group_name, collection_source, scan_date,
             product_name, sku_key, pn_mtm, spec, category, quantity,
             education_discount_amount, serial_numbers_json, order_number,
             outbound_date, outbound_store_name, outbound_operator_name,
             payment_received, activity_label, rule_text,
             customer_name, customer_phone, agent_phone, model_text,
             voucher_code, voucher_verified_at, report_status,
             source_file, raw_payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                _text(item.get("sourceGroupName")),
                _text(item.get("collectionSource")) or _text(item.get("sourceGroupName")),
                scan_date,
                _text(item.get("productName")),
                _text(item.get("skuKey")),
                _text(item.get("pnMtm")),
                _text(item.get("spec")),
                _text(item.get("category")),
                max(int(item.get("quantity") or 1), 1),
                float(item.get("educationDiscountAmount") or 0),
                json.dumps(serial_numbers, ensure_ascii=False),
                _text(item.get("orderNumber")),
                _text(item.get("outboundDate")),
                _text(item.get("outboundStoreName")),
                _text(item.get("outboundOperatorName")),
                1 if bool(item.get("paymentReceived")) else 0,
                _text(item.get("activityLabel")),
                _text(item.get("ruleText")),
                _text(item.get("customerName")),
                _phone(item.get("customerPhone")),
                _phone(item.get("agentPhone")),
                _text(item.get("modelText")),
                _text(item.get("voucherCode")),
                _text(item.get("voucherVerifiedAt")),
                _text(item.get("reportStatus")),
                _text(item.get("sourceFile")),
                json.dumps(item, ensure_ascii=False),
                timestamp,
            ),
        )
        inserted += int(cursor.rowcount or 0)
    return inserted


def list_education_agent_scan_summary(limit: int = 2000) -> dict[str, Any]:
    init_db()
    known_source_groups = {"智店通入库群", "教育补贴群"}
    bundle_rule_map = {
        "three_piece_bundle": {
            "label": "三件套代扫费 300",
            "activity_label": "青春有AI三件套",
            "zhixiangjin_amount": 2000.0,
        },
        "two_piece_bundle": {
            "label": "两件套代扫费 130",
            "activity_label": "锦鲤跃龙门两件套",
            "zhixiangjin_amount": 0.0,
        },
        "legion_dual_screen_combo": {
            "label": "拯救者双屏畅玩两件套代扫费 150",
            "activity_label": "拯救者双屏畅玩两件套",
            "zhixiangjin_amount": 1000.0,
        },
    }

    def _normalize_source_group_name(source_group_name: Any, collection_source: Any) -> str:
        group_name = str(source_group_name or "").strip()
        source_name = str(collection_source or "").strip()
        if source_name in known_source_groups:
            return source_name
        if group_name in known_source_groups:
            return group_name
        return group_name or source_name or "智店通入库群"

    def _infer_bundle_rule(source_group_name: str, activity_label: str, rule_text: str) -> tuple[str | None, str | None, float]:
        if source_group_name != "智店通入库群":
            return None, None, 0.0
        text = " ".join([activity_label, rule_text]).strip()
        if not text:
            return None, None, 0.0
        normalized = text.lower()
        if "青春有ai三件套".lower() in normalized or "three_piece_bundle" in normalized:
            rule = bundle_rule_map["three_piece_bundle"]
            return "three_piece_bundle", str(rule["label"]), float(rule["zhixiangjin_amount"])
        if "锦鲤跃龙门两件套".lower() in normalized or "two_piece_bundle" in normalized:
            rule = bundle_rule_map["two_piece_bundle"]
            return "two_piece_bundle", str(rule["label"]), float(rule["zhixiangjin_amount"])
        if "拯救者双屏畅玩两件套".lower() in normalized or "legion_dual_screen_combo" in normalized:
            rule = bundle_rule_map["legion_dual_screen_combo"]
            return "legion_dual_screen_combo", str(rule["label"]), float(rule["zhixiangjin_amount"])
        return None, None, 0.0

    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT record_id, source_group_name, collection_source, scan_date,
                       product_name, sku_key, pn_mtm, spec, category, quantity,
                       education_discount_amount, serial_numbers_json, order_number,
                       outbound_date, outbound_store_name, outbound_operator_name,
                       payment_received, activity_label, rule_text,
                       customer_name, customer_phone, agent_phone, model_text,
                       voucher_code, voucher_verified_at, report_status,
                       source_file, created_at,
                       service_fee_per_unit, zhixiangjin_amount, raw_payload_json
                FROM education_agent_scan_raw
                ORDER BY scan_date DESC, created_at DESC, id DESC
                LIMIT ?
                """,
                (max(int(limit or 0), 1),),
            ).fetchall()
        ]
        activity_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT sku_key, amount, valid_from, valid_to
                FROM product_activity_current
                WHERE activity_kind = 'education'
                """
            ).fetchall()
        ]

    education_activity_by_sku: dict[str, dict[str, Any]] = {}
    for row in activity_rows:
        sku_key = str(row.get("sku_key") or "").strip()
        if not sku_key:
            continue
        education_activity_by_sku[sku_key] = {
            "amount": float(row.get("amount") or 0),
            "valid_from": str(row.get("valid_from") or "").strip(),
            "valid_to": str(row.get("valid_to") or "").strip(),
        }

    normalized_rows: list[dict[str, Any]] = []
    def _date_in_range(value: str, valid_from: str, valid_to: str) -> bool:
        day = _date_part(value)
        if not day:
            return True
        if valid_from and day < valid_from:
            return False
        if valid_to and day > valid_to:
            return False
        return True

    for row in rows:
        raw_payload = _decode_json_field(row.get("raw_payload_json"), {})
        if not isinstance(raw_payload, dict):
            raw_payload = {}
        raw_metadata = raw_payload.get("metadata") if isinstance(raw_payload.get("metadata"), dict) else {}
        serial_numbers = _decode_json_field(row.get("serial_numbers_json"), [])
        if not isinstance(serial_numbers, list):
            serial_numbers = []
        quantity = max(int(row.get("quantity") or 1), 1)
        group_name = _normalize_source_group_name(row.get("source_group_name"), row.get("collection_source"))
        collection_source = str(raw_metadata.get("collectionSource") or row.get("collection_source") or group_name or "").strip() or group_name
        source_file = str(row.get("source_file") or "").strip()
        source_type = str(raw_metadata.get("sourceType") or "").strip()
        if not source_type:
            if source_file.startswith("manual://wechat/"):
                source_type = "wechat_group_manual"
            elif source_file.startswith("manual://xhey-api/") or "xhey_api" in source_file:
                source_type = "xhey_api_manual"
            elif "watermark" in source_file or "xhey_web_folder" in source_file:
                source_type = "watermark_camera_manual"
            else:
                source_type = "sql_manual_import"
        # BUG FIX: 优先读新列 service_fee_per_unit，fallback 到 raw_payload，最后才是默认 30/50
        raw_service_fee = float(row.get("service_fee_per_unit") or 0)
        if not raw_service_fee:
            raw_service_fee = float(raw_payload.get("serviceFeePerUnit") or 0)
        default_fee = 30 if group_name == "教育补贴群" else 50
        service_fee_per_unit = raw_service_fee if raw_service_fee > 0 else default_fee
        activity_label = str(row.get("activity_label") or "").strip()
        rule_text = str(row.get("rule_text") or "").strip()
        row_education_discount = float(row.get("education_discount_amount") or 0)
        sku_key = str(row.get("sku_key") or "").strip()
        activity_rule = education_activity_by_sku.get(sku_key)
        if activity_rule and _date_in_range(
            str(row.get("outbound_date") or row.get("scan_date") or ""),
            activity_rule.get("valid_from", ""),
            activity_rule.get("valid_to", ""),
        ):
            row_education_discount = float(activity_rule.get("amount") or 0)
        total_education_discount = round(row_education_discount * quantity, 2)
        total_service_fee = round(service_fee_per_unit * quantity, 2)
        payment_received = bool(int(row.get("payment_received") or 0))
        status = "已付" if payment_received else ("未付" if str(row.get("outbound_date") or "").strip() else "待出库同步")
        service_rule_key = str(raw_payload.get("serviceRuleKey") or "").strip() or None
        service_rule_label = str(raw_payload.get("serviceRuleLabel") or "").strip() or None
        # BUG FIX: 优先读新列 zhixiangjin_amount，fallback 到 raw_payload
        raw_zhixiangjin = float(row.get("zhixiangjin_amount") or 0)
        if not raw_zhixiangjin:
            raw_zhixiangjin = float(raw_payload.get("zhixiangjinAmount") or 0)
        zhixiangjin_amount = raw_zhixiangjin
        if not service_rule_key:
            inferred_rule_key, inferred_rule_label, inferred_zhixiangjin = _infer_bundle_rule(group_name, activity_label, rule_text)
            service_rule_key = inferred_rule_key
            service_rule_label = inferred_rule_label
            if not zhixiangjin_amount:
                zhixiangjin_amount = inferred_zhixiangjin
        normalized_rows.append(
            {
                "id": row.get("record_id") or "",
                "sourceType": source_type,
                "sourceGroupName": group_name,
                "collectionSource": collection_source,
                "sourceFile": source_file,
                "scanDate": row.get("scan_date") or "",
                "lockedDisplayDate": row.get("scan_date") or "",
                "productName": row.get("product_name") or "",
                "skuKey": row.get("sku_key") or "",
                "pnMtm": row.get("pn_mtm") or "",
                "spec": row.get("spec") or "",
                "category": row.get("category") or "",
                "quantity": quantity,
                "educationDiscountAmount": row_education_discount,
                "totalEducationDiscountAmount": total_education_discount,
                "serviceFeePerUnit": service_fee_per_unit,
                "totalServiceFee": total_service_fee,
                "orderNumber": row.get("order_number") or "",
                "outboundDate": row.get("outbound_date") or "",
                "outboundStoreName": row.get("outbound_store_name") or "",
                "outboundOperatorName": row.get("outbound_operator_name") or "",
                "serialNumbers": [str(item).strip() for item in serial_numbers if str(item).strip()],
                "paymentReceived": payment_received,
                "activityLabel": activity_label or "教育补代扫",
                "ruleText": rule_text,
                "customerName": row.get("customer_name") or "",
                "customerPhone": row.get("customer_phone") or "",
                "agentPhone": row.get("agent_phone") or "",
                "modelText": row.get("model_text") or "",
                "voucherCode": row.get("voucher_code") or "",
                "voucherVerifiedAt": row.get("voucher_verified_at") or "",
                "reportStatus": row.get("report_status") or "",
                "photoId": str(raw_metadata.get("photoId") or ""),
                "mediaUrl": str(raw_metadata.get("mediaUrl") or ""),
                "takenAt": str(raw_metadata.get("takenAt") or ""),
                "watermark": str(raw_metadata.get("watermark") or ""),
                "serviceRuleKey": service_rule_key,
                "serviceRuleLabel": service_rule_label,
                "zhixiangjinAmount": zhixiangjin_amount,
                "bundleGroupId": str(raw_payload.get("bundleGroupId") or "").strip() or None,
                "bundleMatchedOrderNumber": str(raw_payload.get("bundleMatchedOrderNumber") or "").strip() or None,
                "bundleMatchedPnMtms": raw_payload.get("bundleMatchedPnMtms") if isinstance(raw_payload.get("bundleMatchedPnMtms"), list) else [],
                "bundleMatchedProductTypes": raw_payload.get("bundleMatchedProductTypes") if isinstance(raw_payload.get("bundleMatchedProductTypes"), list) else [],
                "bundleChargeApplied": bool(raw_payload.get("bundleChargeApplied")),
                "bundleTotalServiceFee": float(raw_payload.get("bundleTotalServiceFee") or 0),
                "bundleTotalZhixiangjinAmount": float(raw_payload.get("bundleTotalZhixiangjinAmount") or 0),
                "status": status,
            }
        )

    summary = {
        "totalCount": 0,
        "pendingOutboundCount": 0,
        "unpaidCount": 0,
        "paidCount": 0,
        "matchedOutboundCount": 0,
        "totalEducationDiscountAmount": 0.0,
        "totalServiceFee": 0.0,
        "totalZhixiangjinAmount": 0.0,
        "unpaidServiceFee": 0.0,
        "phoneMismatchCount": 0,
    }
    latest_scan_date = ""
    latest_scan_date_by_group: dict[str, str] = {}
    group_map: dict[str, dict[str, Any]] = {}
    for item in normalized_rows:
        item_scan_date = str(item.get("scanDate") or item.get("lockedDisplayDate") or item.get("outboundDate") or "").strip()
        if item_scan_date and item_scan_date > latest_scan_date:
            latest_scan_date = item_scan_date
        summary["totalCount"] += 1
        if item["status"] == "待出库同步":
            summary["pendingOutboundCount"] += 1
        if item["status"] == "未付":
            summary["unpaidCount"] += 1
        if item["status"] == "已付":
            summary["paidCount"] += 1
        if item["outboundDate"]:
            summary["matchedOutboundCount"] += 1
        summary["totalEducationDiscountAmount"] = round(summary["totalEducationDiscountAmount"] + float(item["totalEducationDiscountAmount"] or 0), 2)
        summary["totalServiceFee"] = round(summary["totalServiceFee"] + float(item["totalServiceFee"] or 0), 2)
        summary["totalZhixiangjinAmount"] = round(summary["totalZhixiangjinAmount"] + float(item["zhixiangjinAmount"] or 0), 2)
        if item["status"] != "已付":
            summary["unpaidServiceFee"] = round(summary["unpaidServiceFee"] + float(item["totalServiceFee"] or 0), 2)
        if item.get("customerPhone") and item.get("agentPhone") and item.get("customerPhone") != item.get("agentPhone"):
            summary["phoneMismatchCount"] += 1

        group = group_map.setdefault(
            item["sourceGroupName"],
            {
                "sourceGroupName": item["sourceGroupName"],
                "collectionSource": item["collectionSource"],
                "serviceFeePerUnit": item["serviceFeePerUnit"],
                "totalCount": 0,
                "pendingOutboundCount": 0,
                "unpaidCount": 0,
                "paidCount": 0,
                "matchedOutboundCount": 0,
                "totalEducationDiscountAmount": 0.0,
                "totalServiceFee": 0.0,
                "totalZhixiangjinAmount": 0.0,
                "unpaidServiceFee": 0.0,
            },
        )
        if item_scan_date:
            group_latest_scan_date = latest_scan_date_by_group.get(item["sourceGroupName"], "")
            if item_scan_date > group_latest_scan_date:
                latest_scan_date_by_group[item["sourceGroupName"]] = item_scan_date
        group["totalCount"] += 1
        if item["status"] == "待出库同步":
            group["pendingOutboundCount"] += 1
        if item["status"] == "未付":
            group["unpaidCount"] += 1
        if item["status"] == "已付":
            group["paidCount"] += 1
        if item["outboundDate"]:
            group["matchedOutboundCount"] += 1
        group["totalEducationDiscountAmount"] = round(group["totalEducationDiscountAmount"] + float(item["totalEducationDiscountAmount"] or 0), 2)
        group["totalServiceFee"] = round(group["totalServiceFee"] + float(item["totalServiceFee"] or 0), 2)
        group["totalZhixiangjinAmount"] = round(group["totalZhixiangjinAmount"] + float(item["zhixiangjinAmount"] or 0), 2)
        if item["status"] != "已付":
            group["unpaidServiceFee"] = round(group["unpaidServiceFee"] + float(item["totalServiceFee"] or 0), 2)

    return {
        "generatedAt": now_iso(),
        "source": "sql.education_agent_scan_raw",
        "sourceGroupName": "智店通入库群、教育补贴群",
        "sourceGroupNames": ["智店通入库群", "教育补贴群"],
        "latestScanDate": latest_scan_date,
        "latestEducationGroupScanDate": latest_scan_date_by_group.get("教育补贴群", ""),
        "latestInboundGroupScanDate": latest_scan_date_by_group.get("智店通入库群", ""),
        "totalCount": summary["totalCount"],
        "pendingOutboundCount": summary["pendingOutboundCount"],
        "unpaidCount": summary["unpaidCount"],
        "paidCount": summary["paidCount"],
        "matchedOutboundCount": summary["matchedOutboundCount"],
        "totalEducationDiscountAmount": summary["totalEducationDiscountAmount"],
        "totalServiceFee": summary["totalServiceFee"],
        "totalZhixiangjinAmount": summary["totalZhixiangjinAmount"],
        "unpaidServiceFee": summary["unpaidServiceFee"],
        "phoneMismatchCount": summary["phoneMismatchCount"],
        "summary": summary,
        "groupSummaries": list(group_map.values()),
        "rows": normalized_rows,
    }


def list_sales_price_protection_history(limit: int = 80) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, order_number, sku_key, product_name, pn_mtm,
                       serial_numbers_json, quantity, outbound_date,
                       outbound_movement_ids_json,
                       protection_quote_date, realtime_purchase_price,
                       inventory_average_cost, unit_diff, estimated_protection_amount,
                       inbound_date, inbound_cost_amount, inbound_document_no,
                       source_note, source_quote_file, status, updated_at
                FROM sales_price_protection_history
                ORDER BY outbound_date DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
        for row in rows:
            inbound_operator_name = ""
            supplier_name = ""
            raw_serials = row.get("serial_numbers_json") or "[]"
            try:
                serial_numbers = json.loads(raw_serials)
            except json.JSONDecodeError:
                serial_numbers = []
            if isinstance(serial_numbers, list):
                for serial_number in serial_numbers:
                    serial = str(serial_number or "").strip()
                    if not serial:
                        continue
                    serial_row = conn.execute(
                        """
                        SELECT operator_name, supplier_name
                        FROM serial_item
                        WHERE serial_number = ?
                        """,
                        (serial,),
                    ).fetchone()
                    if serial_row:
                        inbound_operator_name = str(serial_row["operator_name"] or "")
                        supplier_name = str(serial_row["supplier_name"] or "")
                        if inbound_operator_name or supplier_name:
                            break
            row["inbound_operator_name"] = inbound_operator_name
            row["supplier_name"] = supplier_name
            voucher_row = conn.execute(
                """
                SELECT voucher_code, voucher_template_version, voucher_payload_json, created_at
                FROM reimbursement_voucher_ledger
                WHERE history_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """,
                (str(row.get("id") or ""),),
            ).fetchone()
            if voucher_row:
                row["voucher_code"] = str(voucher_row["voucher_code"] or "")
                row["voucher_template_version"] = str(voucher_row["voucher_template_version"] or "v1")
                row["voucher_generated_at"] = str(voucher_row["created_at"] or "")
                row["voucher_payload"] = _decode_json_field(voucher_row["voucher_payload_json"], {})
            else:
                row["voucher_code"] = ""
                row["voucher_template_version"] = "v1"
                row["voucher_generated_at"] = ""
                row["voucher_payload"] = {}
    return {"items": rows, "count": len(rows)}


def list_sn_sales_compliance(limit: int = 800) -> dict[str, Any]:
    init_db()

    def _safe_json_list(value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        text = str(value or "").strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []

    def _normalize_serials(*values: Any) -> list[str]:
        serials: list[str] = []
        for value in values:
            if isinstance(value, list):
                serials.extend([str(item or "").strip().upper() for item in value])
                continue
            if value in (None, ""):
                continue
            text = str(value).strip()
            if not text:
                continue
            if text.startswith("[") and text.endswith("]"):
                serials.extend([str(item or "").strip().upper() for item in _safe_json_list(text)])
            else:
                serials.extend([item.strip().upper() for item in re.split(r"[,/，\s]+", text) if item.strip()])
        return sorted({item for item in serials if item})

    def _window_contains(business_day: str, start_day: str, end_day: str) -> bool:
        target = _date_part(business_day)
        if not target:
            return False
        start = _date_part(start_day) or target
        end = _date_part(end_day) or target
        return start <= target <= end

    def _product_line(category: str, product_name: str) -> str:
        text = f"{category} {product_name}"
        if re.search(r"手机|平板", text, re.I):
            return "mobileTablet"
        return "computer"

    def _build_action(warnings: list[str], po_compliant: bool, valid_sales: bool) -> str:
        if not valid_sales:
            return "先补 SN / 入库 / 出库链路证据"
        if warnings:
            return warnings[0]
        if po_compliant:
            return "优先整理 PO / 教育补申领材料"
        return "人工复核活动资格与智店通有效销量判断"

    sales_orders = list_sales_orders(limit=max(limit, 2000)).get("items", [])
    sync_gaps = list_sync_gap_queue(limit=4000).get("items", [])
    price_protection_rows = list_sales_price_protection_history(limit=4000).get("items", [])
    current_activities = list_product_activity_current().get("items", [])
    manual_promotions = list_manufacturer_manual_promotions().get("items", [])
    marketing_history_snapshot = get_snapshot_cache("latest-marketing-boost-history.json", default={"cards": []})
    marketing_history_rows = marketing_history_snapshot.get("cards", []) if isinstance(marketing_history_snapshot, dict) else []

    with connect() as conn:
        sku_rows = conn.execute(
            """
            SELECT sku_key, current_stock,
                   COALESCE((
                     SELECT COUNT(*)
                     FROM serial_item
                     WHERE serial_item.sku_key = sku.sku_key
                       AND serial_item.status = 'in_stock'
                   ), 0) AS in_stock_serial_count
            FROM sku
            """
        ).fetchall()
        serial_rows = conn.execute(
            """
            SELECT serial_number, sku_key, product_name, pn_mtm, spec, status,
                   inbound_date, inbound_document_no, operator_name, supplier_name,
                   cost_amount, location_code, updated_at
            FROM serial_item
            ORDER BY updated_at DESC, serial_number
            """
        ).fetchall()
        movement_rows = conn.execute(
            """
            SELECT id, sku_key, movement_type, business_date, source_ref,
                   inbound_document_no, source_document_type, serial_number,
                   operator_name, supplier_name, store_name, note, created_at
            FROM inventory_movement
            WHERE TRIM(COALESCE(serial_number, '')) <> ''
            ORDER BY business_date DESC, created_at DESC
            """
        ).fetchall()

    sku_diff_map = {
        str(row["sku_key"] or "").strip(): int(row["current_stock"] or 0) - int(row["in_stock_serial_count"] or 0)
        for row in sku_rows
        if str(row["sku_key"] or "").strip()
    }
    serial_by_number = {
        str(row["serial_number"] or "").strip().upper(): dict(row)
        for row in serial_rows
        if str(row["serial_number"] or "").strip()
    }
    movements_by_serial: dict[str, list[dict[str, Any]]] = {}
    for row in movement_rows:
        record = dict(row)
        for serial in _normalize_serials(record.get("serial_number")):
            movements_by_serial.setdefault(serial, []).append(record)

    gap_keys_by_order: dict[str, list[dict[str, Any]]] = {}
    gap_keys_by_serial: dict[str, list[dict[str, Any]]] = {}
    for row in sync_gaps:
        if not isinstance(row, dict) or str(row.get("status") or "") != "open":
            continue
        order_number = str(row.get("order_number") or "").strip().upper()
        serial_number = str(row.get("serial_number") or "").strip().upper()
        if order_number:
            gap_keys_by_order.setdefault(order_number, []).append(row)
        if serial_number:
            gap_keys_by_serial.setdefault(serial_number, []).append(row)

    protection_by_order_sku: dict[tuple[str, str], list[dict[str, Any]]] = {}
    protection_by_serial: dict[str, list[dict[str, Any]]] = {}
    for row in price_protection_rows:
        if not isinstance(row, dict):
            continue
        order_key = str(row.get("order_number") or "").strip().upper()
        sku_key = str(row.get("sku_key") or "").strip()
        if order_key and sku_key:
            protection_by_order_sku.setdefault((order_key, sku_key), []).append(row)
        for serial in _normalize_serials(row.get("serial_numbers_json")):
            protection_by_serial.setdefault(serial, []).append(row)

    marketing_history_by_order_sku: dict[tuple[str, str], list[dict[str, Any]]] = {}
    marketing_history_by_serial: dict[str, list[dict[str, Any]]] = {}
    for row in marketing_history_rows:
        if not isinstance(row, dict):
            continue
        order_key = str(row.get("orderNumber") or "").strip().upper()
        sku_key = str(row.get("skuKey") or "").strip()
        if order_key and sku_key:
            marketing_history_by_order_sku.setdefault((order_key, sku_key), []).append(row)
        for serial in _normalize_serials(row.get("serialNumbers")):
            marketing_history_by_serial.setdefault(serial, []).append(row)

    with connect() as conn:
        physical_hold_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT serial_number, sku_key, source_order_no, hold_status,
                       matched_service_order_no, updated_at
                FROM physical_stock_hold
                ORDER BY updated_at DESC, serial_number
                """
            ).fetchall()
        ]
    physical_hold_by_serial = {
        str(row.get("serial_number") or "").strip().upper(): row
        for row in physical_hold_rows
        if str(row.get("serial_number") or "").strip()
    }
    physical_hold_by_order_sku: dict[tuple[str, str], dict[str, Any]] = {}
    for row in physical_hold_rows:
        order_key = str(row.get("source_order_no") or "").strip().upper()
        sku_key = str(row.get("sku_key") or "").strip()
        if order_key and sku_key:
            physical_hold_by_order_sku.setdefault((order_key, sku_key), row)

    manual_promotion_by_order_sku: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in manual_promotions:
        if not isinstance(row, dict) or not bool(row.get("enabled", True)):
            continue
        order_key = str(row.get("orderNumber") or "").strip().upper()
        sku_key = str(row.get("skuKey") or "").strip()
        if order_key and sku_key:
            manual_promotion_by_order_sku.setdefault((order_key, sku_key), []).append(row)

    current_activity_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in current_activities:
        if not isinstance(row, dict):
            continue
        sku_key = str(row.get("skuKey") or "").strip()
        if sku_key:
            current_activity_by_sku.setdefault(sku_key, []).append(row)

    items: list[dict[str, Any]] = []
    today = now_iso()
    valid_order_statuses = {"60", "已完成", "completed"}

    for order in sales_orders:
        if not isinstance(order, dict):
            continue
        status_text = str(order.get("status_name") or order.get("status") or "").strip()
        if status_text not in valid_order_statuses:
            continue
        order_number = str(order.get("order_number") or order.get("order_no") or order.get("id") or "").strip()
        order_key = order_number.upper()
        sales_date = str(order.get("operate_time") or order.get("pay_time") or order.get("business_date") or "").strip()
        lines = order.get("lines") if isinstance(order.get("lines"), list) else []
        for line_index, line in enumerate(lines):
            if not isinstance(line, dict):
                continue
            sku_key = str(line.get("sku_key") or line.get("sku_no") or "").strip()
            product_name = str(line.get("product_name") or "").strip()
            category = str(line.get("category") or "").strip()
            serials = _normalize_serials(line.get("serial_number"), line.get("serial_numbers_json"))
            if not serials:
                serials = [""]
            for serial_index, serial_number in enumerate(serials):
                serial_row = serial_by_number.get(serial_number) if serial_number else None
                movement_chain = movements_by_serial.get(serial_number, []) if serial_number else []
                current_stock_diff = int(sku_diff_map.get(sku_key, 0))
                active_rows = [
                    row for row in current_activity_by_sku.get(sku_key, [])
                    if _window_contains(sales_date, str(row.get("validFrom") or ""), str(row.get("validTo") or ""))
                ]
                po_rows = [
                    row for row in active_rows
                    if "教育" not in str(row.get("activityLabel") or "") and "education" not in str(row.get("activityKind") or "").lower()
                ]
                education_rows = [
                    row for row in active_rows
                    if "教育" in str(row.get("activityLabel") or "") or "education" in str(row.get("activityKind") or "").lower()
                ]
                frozen_history_rows = marketing_history_by_serial.get(serial_number) or marketing_history_by_order_sku.get((order_key, sku_key), [])
                manual_rows = manual_promotion_by_order_sku.get((order_key, sku_key), [])
                protection_rows = protection_by_serial.get(serial_number) or protection_by_order_sku.get((order_key, sku_key), [])
                open_gaps = list(gap_keys_by_order.get(order_key, []))
                if serial_number:
                    open_gaps.extend(gap_keys_by_serial.get(serial_number, []))
                unique_gap_types = sorted({str(item.get("gap_type") or "").strip() for item in open_gaps if str(item.get("gap_type") or "").strip()})
                has_inbound = bool(
                    (serial_row and str(serial_row.get("inbound_date") or "").strip())
                    or any(str(item.get("movement_type") or "") in {"purchase_inbound", "transfer_inbound"} for item in movement_chain)
                )
                has_sales_outbound = bool(
                    serial_number
                    and any(str(item.get("movement_type") or "") == "sales_outbound" for item in movement_chain)
                ) or bool(order_number)
                has_transfer_or_other_outbound = any(
                    str(item.get("movement_type") or "") in {"transfer_outbound", "stock_adjustment"}
                    for item in movement_chain
                )
                chain_complete = bool(serial_number and has_inbound and has_sales_outbound)
                frozen_po_amount = max([
                    float(row.get("boostAmount") or row.get("estimatedMarketingSupportAmount") or 0)
                    for row in frozen_history_rows
                ] + [0.0])
                frozen_education_amount = max([
                    float(row.get("educationDiscountAmount") or 0)
                    for row in frozen_history_rows
                ] + [0.0])
                manual_po_amount = max([float(row.get("boostAmount") or 0) for row in manual_rows] + [0.0])
                manual_education_amount = max([float(row.get("educationAmount") or 0) for row in manual_rows] + [0.0])
                current_po_amount = max([float(row.get("amount") or 0) for row in po_rows] + [0.0])
                current_education_amount = max([float(row.get("amount") or 0) for row in education_rows] + [0.0])
                physical_hold_row = (
                    physical_hold_by_serial.get(serial_number.upper())
                    if serial_number
                    else physical_hold_by_order_sku.get((order_key, sku_key))
                )
                physical_hold_status = str(physical_hold_row.get("hold_status") or "").strip() if physical_hold_row else ""
                physical_hold_managed = bool(physical_hold_row) and physical_hold_status in {"active", "consumed", "released"}
                po_amount = max([frozen_po_amount, manual_po_amount, current_po_amount, 0.0])
                education_amount = max([frozen_education_amount, manual_education_amount, current_education_amount, 0.0])
                price_protection_amount = max([float(row.get("estimated_protection_amount") or 0) for row in protection_rows] + [0.0])
                if physical_hold_managed:
                    po_amount = 0.0
                    education_amount = 0.0
                po_eligible = po_amount > 0
                education_eligible = education_amount > 0
                price_protection_ready = price_protection_amount > 0
                valid_sales_candidate = chain_complete and not open_gaps and current_stock_diff >= 0
                po_compliant = valid_sales_candidate and (po_eligible or education_eligible)
                frozen_activity_labels = {
                    str(row.get("activityLabel") or "").strip()
                    for row in frozen_history_rows
                    if str(row.get("activityLabel") or "").strip()
                }
                if not frozen_activity_labels:
                    for row in frozen_history_rows:
                        rule_text = str(row.get("ruleText") or "").strip()
                        if "PO" in rule_text or "加磅" in rule_text:
                            frozen_activity_labels.add("PO加磅")
                        if "教育" in rule_text:
                            frozen_activity_labels.add("教育补贴")
                warnings: list[str] = []
                if not serial_number:
                    warnings.append("销售订单缺 SN，当前不能判定有效销量。")
                if not has_inbound:
                    warnings.append("缺少采购入库来源，需补入库单号 / 成本 / 供应商。")
                if open_gaps:
                    warnings.append(f"仍有 SQL 同步缺口：{' / '.join(unique_gap_types[:3])}。")
                if current_stock_diff != 0:
                    warnings.append(f"当前 SKU 库存与 SN 差异 {current_stock_diff} 台。")
                if has_transfer_or_other_outbound:
                    warnings.append("检测到调拨/库存调整链路，需人工复核是否影响有效销量。")
                if physical_hold_managed:
                    warnings.append(
                        f"该 SN 已进入实物仓管理（{physical_hold_status or 'active'}），营销PO/教育补已停止重复计算。"
                    )
                if valid_sales_candidate and not (po_eligible or education_eligible or price_protection_ready):
                    warnings.append("未命中 PO / 教育补 / 价保规则，需人工复核活动资格。")
                if not serial_row and serial_number:
                    warnings.append("SN 未进入 SQL serial_item 主档，需补 SN 主表。")

                if not serial_number or not has_inbound or open_gaps:
                    compliance_status = "blocked_missing_evidence"
                    status_label = "阻塞"
                elif current_stock_diff != 0:
                    compliance_status = "warning_sn_conflict"
                    status_label = "SN冲突"
                elif physical_hold_managed:
                    compliance_status = "compliant_pass"
                    status_label = "实物仓已接管"
                elif has_transfer_or_other_outbound or not (po_eligible or education_eligible or price_protection_ready):
                    compliance_status = "warning_activity_gap"
                    status_label = "待复核"
                elif po_compliant:
                    compliance_status = "compliant_pass"
                    status_label = "合规通过"
                else:
                    compliance_status = "warning_chain_gap"
                    status_label = "链路待补"

                items.append(
                    {
                        "id": f"sn-compliance-{order_number or 'unknown'}-{sku_key or 'sku'}-{serial_number or f'missing-{line_index}-{serial_index}'}",
                        "orderNumber": order_number,
                        "salesDate": sales_date,
                        "outboundDate": sales_date,
                        "outboundDocumentNumber": str(line.get("order_id") or order_number),
                        "skuKey": sku_key,
                        "productName": product_name or str(serial_row.get("product_name") or "") if serial_row else product_name,
                        "pnMtm": str(line.get("mtm_code") or serial_row.get("pn_mtm") or "").strip() if serial_row else str(line.get("mtm_code") or "").strip(),
                        "spec": str(line.get("spec") or serial_row.get("spec") or "").strip() if serial_row else str(line.get("spec") or "").strip(),
                        "category": category,
                        "productLine": _product_line(category, product_name),
                        "serialNumber": serial_number,
                        "quantity": int(line.get("quantity") or 1),
                        "salesUnitPrice": float(line.get("unit_price") or line.get("deal_price") or 0) if line.get("unit_price") is not None or line.get("deal_price") is not None else None,
                        "salesAmount": float(line.get("deal_amount") or line.get("pay_amount") or 0) if line.get("deal_amount") is not None or line.get("pay_amount") is not None else None,
                        "payAmount": float(order.get("pay_amount") or 0) if order.get("pay_amount") is not None else None,
                        "storeName": str(order.get("shop_name") or order.get("store_code") or "联想体验店（新野县书院路）"),
                        "operatorName": str(order.get("cashier_name") or order.get("operator_id") or ""),
                        "inboundDate": str(serial_row.get("inbound_date") or "").strip() if serial_row else "",
                        "inboundDocumentNumber": str(serial_row.get("inbound_document_no") or "").strip() if serial_row else "",
                        "purchaseCost": normalize_purchase_cost_amount(serial_row.get("cost_amount")) if serial_row else None,
                        "supplierName": str(serial_row.get("supplier_name") or "").strip() if serial_row else "",
                        "locationName": str(serial_row.get("location_code") or "").strip() if serial_row else "",
                        "activityLabels": sorted(
                            frozen_activity_labels
                            | {
                                str(row.get("activityLabel") or "").strip()
                                for row in [*po_rows, *education_rows]
                                if str(row.get("activityLabel") or "").strip()
                            }
                        ),
                        "marketingPoAmount": round(po_amount, 2),
                        "educationAmount": round(education_amount, 2),
                        "priceProtectionAmount": round(price_protection_amount, 2),
                        "claimableAmount": round(po_amount + education_amount + price_protection_amount, 2),
                        "validation": {
                            "isValidSalesCandidate": valid_sales_candidate,
                            "chainComplete": chain_complete,
                            "poEligible": po_eligible,
                            "educationEligible": education_eligible,
                            "priceProtectionReady": price_protection_ready,
                            "poCompliant": po_compliant,
                            "physicalHoldManaged": physical_hold_managed,
                            "physicalHoldStatus": physical_hold_status,
                            "hasStockConflict": current_stock_diff != 0,
                            "hasOpenSyncGap": bool(open_gaps),
                            "hasTransferOrOtherOutbound": has_transfer_or_other_outbound,
                        },
                        "movementChain": {
                            "hasInbound": has_inbound,
                            "hasSalesOutbound": has_sales_outbound,
                            "hasTransferOrOtherOutbound": has_transfer_or_other_outbound,
                            "currentStockDiff": current_stock_diff,
                            "openGapTypes": unique_gap_types,
                            "movementCount": len(movement_chain),
                        },
                        "manualReview": {
                            "required": compliance_status != "compliant_pass" and not physical_hold_managed,
                            "mode": "codex_manual_task" if warnings else "none",
                            "reason": warnings[0] if warnings else "",
                        },
                        "evidence": {
                            "frozenPromotionHistory": bool(frozen_history_rows),
                            "manualPromotionMatched": bool(manual_rows),
                            "currentActivityMatched": bool(active_rows),
                            "priceProtectionHistoryMatched": bool(protection_rows),
                            "physicalHoldManaged": physical_hold_managed,
                        },
                        "status": compliance_status,
                        "statusLabel": status_label,
                        "recommendedAction": _build_action(warnings, po_compliant, valid_sales_candidate),
                        "warnings": warnings,
                        "updatedAt": today,
                    }
                )

    items.sort(
        key=lambda item: (
            {"blocked_missing_evidence": 0, "warning_sn_conflict": 1, "warning_activity_gap": 2, "warning_chain_gap": 3, "compliant_pass": 4}.get(str(item.get("status") or ""), 9),
            str(item.get("salesDate") or ""),
            str(item.get("orderNumber") or ""),
        )
    )
    items = list(reversed(items[-limit:])) if len(items) > limit else items
    summary = {
        "totalCount": len(items),
        "compliantCount": sum(1 for item in items if item["status"] == "compliant_pass"),
        "blockedCount": sum(1 for item in items if str(item["status"]).startswith("blocked")),
        "warningCount": sum(1 for item in items if str(item["status"]).startswith("warning")),
        "poEligibleCount": sum(1 for item in items if bool(item["validation"]["poEligible"])),
        "educationEligibleCount": sum(1 for item in items if bool(item["validation"]["educationEligible"])),
        "priceProtectionReadyCount": sum(1 for item in items if bool(item["validation"]["priceProtectionReady"])),
        "claimableAmount": round(sum(float(item.get("claimableAmount") or 0) for item in items), 2),
        "manualReviewCount": sum(1 for item in items if bool(item["manualReview"]["required"])),
    }
    return {
        "generatedAt": now_iso(),
        "source": "retail_core.sn_sales_compliance",
        "automation": {
            "autoRefreshSupported": True,
            "realTimeCollectionMode": "codex_manual_task",
            "realTimeCollectionReason": "当前外部有效销量页面/厂家资格页不允许脚本实时采集；日更可自动刷新 SQL 已落库链路，实时缺口需由 Codex 手动任务补证据。",
        },
        "summary": summary,
        "items": items,
        "count": len(items),
    }


def validate_sales_order(order: dict[str, Any]) -> list[dict[str, Any]]:
    init_db()
    errors: list[dict[str, Any]] = []
    with connect() as conn:
        for line in order.get("lines", []):
            sku_key = str(line.get("skuKey", "")).strip()
            quantity = int(line.get("quantity", 1) or 1)
            serials = [
                str(serial).strip()
                for serial in line.get("serialNumbers", [])
                if str(serial).strip()
            ]
            if serials and len(serials) != quantity:
                errors.append({
                    "error": "serial_quantity_mismatch",
                    "skuKey": sku_key,
                    "quantity": quantity,
                    "serialCount": len(serials),
                })
                continue
            sku_row = conn.execute(
                "SELECT sku_key, sellable_stock FROM sku WHERE sku_key = ?",
                (sku_key,),
            ).fetchone()
            if not sku_row:
                errors.append({"error": "sku_not_found", "skuKey": sku_key})
                continue
            if serials:
                for serial in serials:
                    serial_row = conn.execute(
                        """
                        SELECT serial_number, sku_key, status
                        FROM serial_item
                        WHERE serial_number = ?
                        """,
                        (serial,),
                    ).fetchone()
                    if not serial_row:
                        errors.append({
                            "error": "serial_not_found",
                            "skuKey": sku_key,
                            "serialNumber": serial,
                        })
                        continue
                    if serial_row["sku_key"] != sku_key:
                        errors.append({
                            "error": "serial_sku_mismatch",
                            "skuKey": sku_key,
                            "serialSkuKey": serial_row["sku_key"],
                            "serialNumber": serial,
                        })
                    if serial_row["status"] != "in_stock":
                        errors.append({
                            "error": "serial_not_sellable",
                            "skuKey": sku_key,
                            "serialNumber": serial,
                            "status": serial_row["status"],
                        })
            elif int(sku_row["sellable_stock"] or 0) < quantity:
                errors.append({
                    "error": "insufficient_sellable_stock",
                    "skuKey": sku_key,
                    "requested": quantity,
                    "sellableStock": int(sku_row["sellable_stock"] or 0),
                })
    return errors


def record_sales_order(order: dict[str, Any]) -> None:
    init_db()
    timestamp = now_iso()
    order_status = str(order.get("status", "completed") or "completed")
    is_reserved = order_status == "reserved"
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO sales_order
            (id, store_code, operator_id, customer_name, status, total_amount,
             business_date, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order["id"],
                order["storeCode"],
                order["operatorId"],
                order.get("customerName", ""),
                order_status,
                float(order.get("totalAmount", 0) or 0),
                order["businessDate"],
                order.get("note", ""),
                order.get("createdAt", timestamp),
            ),
        )
        for index, line in enumerate(order.get("lines", []), start=1):
            line_id = f"{order['id']}-{index:03d}"
            serials = line.get("serialNumbers", [])
            conn.execute(
                """
                INSERT OR REPLACE INTO sales_order_line
                (id, order_id, sku_key, supplier_name, quantity, deal_price, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    line_id,
                    order["id"],
                    line["skuKey"],
                    "",
                    int(line.get("quantity", 1) or 1),
                    float(line.get("dealPrice", 0) or 0),
                    json.dumps(serials, ensure_ascii=False),
                    timestamp,
                ),
            )
            for serial in serials or [None]:
                movement_id = f"{line_id}-{serial or 'NO-SN'}"
                movement_quantity = 0 if is_reserved else (-1 if serial else -1 * int(line.get("quantity", 1) or 1))
                movement_type = "sales_outbound_placeholder" if is_reserved else "sales_outbound"
                movement_note = f"广告机/收银端出库占位 {order['id']}，未扣真实库存" if is_reserved else f"本地销售单 {order['id']} 出库"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO inventory_movement
                    (id, sku_key, serial_number, movement_type, quantity, business_date,
                     source_system, source_ref, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        movement_id,
                        line["skuKey"],
                        serial,
                        movement_type,
                        movement_quantity,
                        order["businessDate"],
                        "local_sales",
                        order["id"],
                        movement_note,
                        timestamp,
                    ),
                )
                if serial:
                    conn.execute(
                        """
                        UPDATE serial_item
                        SET status = ?, updated_at = ?
                        WHERE serial_number = ?
                        """,
                        ("reserved" if is_reserved else "sold", timestamp, serial),
                    )
            if not is_reserved:
                conn.execute(
                    """
                    UPDATE sku
                    SET sellable_stock = MAX(sellable_stock - ?, 0),
                        current_stock = MAX(current_stock - ?, 0),
                        updated_at = ?
                    WHERE sku_key = ?
                    """,
                    (
                        int(line.get("quantity", 1) or 1),
                        int(line.get("quantity", 1) or 1),
                        timestamp,
                        line["skuKey"],
                    ),
                )


def delete_sales_order(order_id: str) -> dict[str, Any] | None:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        registry_row = conn.execute(
            """
            SELECT order_number, external_order_number, status
            FROM order_sync_registry
            WHERE order_number = ? OR external_order_number = ?
            LIMIT 1
            """,
            (order_id, order_id),
        ).fetchone()
        if registry_row:
            raise ValueError("sales_order_already_reconciled")

        order_row = conn.execute(
            """
            SELECT id, store_code, operator_id, customer_name, status, total_amount,
                   business_date, note, created_at
            FROM sales_order
            WHERE id = ?
            """,
            (order_id,),
        ).fetchone()
        movement_rows = conn.execute(
            """
            SELECT id, sku_key, serial_number, quantity, movement_type, note
            FROM inventory_movement
            WHERE source_system = 'local_sales'
              AND source_ref = ?
              AND movement_type IN ('sales_outbound', 'sales_outbound_placeholder')
            """,
            (order_id,),
        ).fetchall()

        if not order_row and not movement_rows:
            return None

        order_status = str(order_row["status"] or "") if order_row else ""
        order_note = str(order_row["note"] or "") if order_row else ""
        local_placeholder_order = order_id.startswith("SO-") or "本地销售单" in order_note or "收银端出库占位" in order_note
        if not local_placeholder_order:
            local_placeholder_order = any(
                str(row["movement_type"] or "") == "sales_outbound_placeholder"
                or "本地销售单" in str(row["note"] or "")
                or "收银端出库占位" in str(row["note"] or "")
                for row in movement_rows
            )
        was_reserved = order_status == "reserved" or any(
            str(row["movement_type"] or "") == "sales_outbound_placeholder"
            for row in movement_rows
        )

        sync_rows = conn.execute(
            """
            SELECT id, status
            FROM sync_task
            WHERE entity_type = 'sales_order' AND entity_id = ?
            """,
            (order_id,),
        ).fetchall()
        completed_sync = [dict(row) for row in sync_rows if str(row["status"] or "") == "completed"]
        if completed_sync and not local_placeholder_order:
            raise ValueError("sales_order_already_synced")

        line_rows = conn.execute(
            """
            SELECT sku_key, quantity, serial_numbers_json
            FROM sales_order_line
            WHERE order_id = ?
            """,
            (order_id,),
        ).fetchall() if order_row else []

        if not line_rows and movement_rows:
            line_by_sku: dict[str, dict[str, Any]] = {}
            for row in movement_rows:
                sku_key = str(row["sku_key"] or "").strip()
                if not sku_key:
                    continue
                current = line_by_sku.setdefault(sku_key, {
                    "sku_key": sku_key,
                    "quantity": 0,
                    "serial_numbers": [],
                })
                current["quantity"] += max(1, abs(int(row["quantity"] or 0)))
                serial_number = str(row["serial_number"] or "").strip()
                if serial_number:
                    current["serial_numbers"].append(serial_number)
            line_rows = [
                {
                    "sku_key": payload["sku_key"],
                    "quantity": payload["quantity"],
                    "serial_numbers_json": json.dumps(payload["serial_numbers"], ensure_ascii=False),
                }
                for payload in line_by_sku.values()
            ]

        reverted_serials: list[str] = []
        for row in line_rows:
            sku_key = str(row["sku_key"] or "").strip()
            quantity = int(row["quantity"] or 0)
            try:
                serial_numbers = json.loads(str(row["serial_numbers_json"] or "[]"))
            except json.JSONDecodeError:
                serial_numbers = []
            if not isinstance(serial_numbers, list):
                serial_numbers = []

            if not was_reserved:
                conn.execute(
                    """
                    UPDATE sku
                    SET sellable_stock = sellable_stock + ?,
                        current_stock = current_stock + ?,
                        updated_at = ?
                    WHERE sku_key = ?
                    """,
                    (quantity, quantity, timestamp, sku_key),
                )
            for serial in serial_numbers:
                serial_number = str(serial or "").strip()
                if not serial_number:
                    continue
                reverted_serials.append(serial_number)
                conn.execute(
                    """
                    UPDATE serial_item
                    SET status = 'in_stock', updated_at = ?
                    WHERE serial_number = ?
                    """,
                    (timestamp, serial_number),
                )

        conn.execute(
            """
            DELETE FROM inventory_movement
            WHERE source_system IN ('local_sales', 'sql_inventory_movements')
              AND source_ref = ?
              AND movement_type IN ('sales_outbound', 'sales_outbound_placeholder')
            """,
            (order_id,),
        )
        conn.execute("DELETE FROM sales_order_line WHERE order_id = ?", (order_id,))
        conn.execute("DELETE FROM sales_order WHERE id = ?", (order_id,))
        conn.execute("DELETE FROM sales_price_protection_history WHERE order_number = ?", (order_id,))
        conn.execute(
            """
            DELETE FROM sync_task
            WHERE entity_type = 'sales_order' AND entity_id = ?
            """,
            (order_id,),
        )

    return {
        "ok": True,
        "orderId": order_id,
        "revertedSerialCount": len(reverted_serials),
        "revertedSerials": reverted_serials,
    }


def record_purchase_order(order: dict[str, Any]) -> None:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO purchase_order
            (id, supplier_id, status, total_amount, business_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                order["id"],
                order.get("supplierId", ""),
                order.get("status", "completed"),
                float(order.get("totalAmount", 0) or 0),
                order["businessDate"],
                order.get("createdAt", timestamp),
            ),
        )
        for index, line in enumerate(order.get("lines", []), start=1):
            line_id = f"{order['id']}-{index:03d}"
            serials = [
                str(serial).strip()
                for serial in line.get("serialNumbers", [])
                if str(serial).strip()
            ]
            quantity = int(line.get("quantity") or len(serials) or 1)
            sku_key = str(line["skuKey"]).strip()
            product_name = str(line.get("productName") or sku_key)
            conn.execute(
                """
                INSERT OR IGNORE INTO product
                (id, name, brand, category, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (f"PROD-{sku_key}", product_name, "Lenovo", "", timestamp),
            )
            conn.execute(
                """
                INSERT INTO sku
                (id, product_id, sku_key, pn_mtm, name, category, source_category,
                 jd_subcategory, catalog_source, sellable_stock, current_stock, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sku_key) DO UPDATE SET
                  name = excluded.name,
                  sellable_stock = sku.sellable_stock + excluded.sellable_stock,
                  current_stock = sku.current_stock + excluded.current_stock,
                  updated_at = excluded.updated_at
                """,
                (
                    f"SKU-{sku_key}",
                    f"PROD-{sku_key}",
                    sku_key,
                    str(line.get("pnMtm", "")),
                    product_name,
                    str(line.get("category", "")),
                    str(line.get("sourceCategory", "")),
                    str(line.get("jdSubcategory", "")),
                    str(line.get("catalogSource", "")),
                    quantity,
                    quantity,
                    timestamp,
                ),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO purchase_order_line
                (id, order_id, sku_key, quantity, cost_price, serial_numbers_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    line_id,
                    order["id"],
                    sku_key,
                    quantity,
                    line.get("costPrice"),
                    json.dumps(serials, ensure_ascii=False),
                    timestamp,
                ),
            )
            movement_serials = serials or [None]
            for serial in movement_serials:
                movement_id = f"{line_id}-{serial or 'NO-SN'}"
                movement_quantity = 1 if serial else quantity
                conn.execute(
                    """
                    INSERT OR REPLACE INTO inventory_movement
                    (id, sku_key, serial_number, movement_type, quantity, business_date,
                     source_system, source_ref, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        movement_id,
                        sku_key,
                        serial,
                        "purchase_inbound",
                        movement_quantity,
                        order["businessDate"],
                        "local_purchase",
                        order["id"],
                        f"本地采购入库 {order['id']}",
                        timestamp,
                    ),
                )
                if serial:
                    conn.execute(
                        """
                        INSERT INTO serial_item
                        (serial_number, sku_key, product_name, pn_mtm, spec, status,
                         warehouse_code, location_code, cost_amount, inbound_date,
                         inbound_document_no, operator_name, supplier_name,
                         warranty_status, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(serial_number) DO UPDATE SET
                          sku_key = excluded.sku_key,
                          product_name = excluded.product_name,
                          pn_mtm = excluded.pn_mtm,
                          spec = excluded.spec,
                          status = 'in_stock',
                          location_code = excluded.location_code,
                          cost_amount = excluded.cost_amount,
                          inbound_date = excluded.inbound_date,
                          inbound_document_no = excluded.inbound_document_no,
                          operator_name = excluded.operator_name,
                          supplier_name = excluded.supplier_name,
                          updated_at = excluded.updated_at
                        """,
                        (
                            serial,
                            sku_key,
                            product_name,
                            str(line.get("pnMtm", "")),
                            str(line.get("spec", "")),
                            "in_stock",
                            "STORE",
                            str(order.get("locationCode", "SALES_FLOOR")),
                            line.get("costPrice"),
                            order["businessDate"],
                            order["id"],
                            str(order.get("operatorId", "")),
                            str(order.get("supplierId", "")),
                            "unknown",
                            timestamp,
                        ),
                    )


def retry_sync_task(task_id: str) -> dict[str, Any] | None:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM sync_task WHERE id = ?",
            (task_id,),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            """
            UPDATE sync_task
            SET status = 'pending',
                retry_count = retry_count + 1,
                last_error = '',
                updated_at = ?
            WHERE id = ?
            """,
            (timestamp, task_id),
        )
    return {"taskId": task_id, "status": "pending"}


def enqueue_sync_task(
    task_id: str,
    external_system_id: str,
    task_type: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> None:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO sync_task
            (id, external_system_id, task_type, entity_type, entity_id, status,
             retry_count, last_error, payload_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                external_system_id,
                task_type,
                entity_type,
                entity_id,
                "pending",
                0,
                "",
                json.dumps(payload, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )


def list_sync_tasks(limit: int = 50) -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, external_system_id, task_type, entity_type, entity_id,
                   status, retry_count, last_error, created_at, updated_at
            FROM sync_task
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_sync_task(task_id: str) -> dict[str, Any] | None:
    init_db()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, external_system_id, task_type, entity_type, entity_id,
                   status, retry_count, last_error, payload_json, created_at, updated_at
            FROM sync_task
            WHERE id = ?
            """,
            (task_id,),
        ).fetchone()
    if not row:
        return None
    result = dict(row)
    try:
        result["payload"] = json.loads(result.pop("payload_json", "{}"))
    except json.JSONDecodeError:
        result["payload"] = {}
    return result


def update_sync_task_status(
    task_id: str,
    status: str,
    last_error: str = "",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    init_db()
    timestamp = now_iso()
    with connect() as conn:
        row = conn.execute(
            "SELECT payload_json FROM sync_task WHERE id = ?",
            (task_id,),
        ).fetchone()
        if not row:
            return None
        try:
            current_payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            current_payload = {}
        next_payload = current_payload
        if payload:
            next_payload = {**current_payload, **payload}
        conn.execute(
            """
            UPDATE sync_task
            SET status = ?,
                last_error = ?,
                payload_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                last_error,
                json.dumps(next_payload, ensure_ascii=False),
                timestamp,
                task_id,
            ),
        )
    return get_sync_task(task_id)


def create_price_tag_update_task(
    sku_key: str,
    template_id: str,
    price_payload: dict[str, Any],
    device_id: str | None = None,
    data_dir: Path | None = None,
    store_code: str = "LENOVO-SR-001",
) -> dict[str, Any]:
    init_db()
    timestamp = now_iso()
    task_id = f"PT-{datetime.now().strftime('%Y%m%d%H%M%S')}-{sku_key}"
    resolved_binding = _resolve_price_tag_binding(sku_key, store_code)
    resolved_device_id = device_id or (str(resolved_binding.get("device_id") or "").strip() if resolved_binding else None)
    normalized_payload = dict(price_payload or {})
    if data_dir is not None:
        normalized_payload = build_price_tag_payload(
            data_dir,
            sku_key=sku_key,
            store_code=store_code,
            override_payload=normalized_payload,
        )
    with connect() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO price_tag_template
            (id, name, template_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                template_id,
                "默认门店价签",
                "store_price",
                json.dumps({"fields": ["name", "price", "subsidyPrice"]}, ensure_ascii=False),
                timestamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO price_tag_update_task
            (id, device_id, sku_key, template_id, price_payload_json, status,
             retry_count, last_error, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                resolved_device_id,
                sku_key,
                template_id,
                json.dumps(normalized_payload, ensure_ascii=False),
                "pending",
                0,
                "",
                timestamp,
                timestamp,
            ),
        )
    return {
        "taskId": task_id,
        "status": "pending",
        "deviceId": resolved_device_id,
        "bindingId": resolved_binding.get("id") if resolved_binding else None,
        "pricePayload": normalized_payload,
    }
