#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "apps" / "web-cockpit" / "public" / "data"
ARTIFACT_DIR = ROOT / "apps" / "inventory-sync" / "artifacts"
REPORT_NAME = "latest-terminal-title-consistency-audit.json"
INTERNAL_TITLE_PATTERNS = [
    re.compile(r"^PHN\s+MOTO\b", re.IGNORECASE),
    re.compile(r"^Legion\s+[A-Z0-9]", re.IGNORECASE),
    re.compile(r"^Lecoo\s+N\d", re.IGNORECASE),
    re.compile(r"^GeekPro-", re.IGNORECASE),
    re.compile(r"^刃7000P-26", re.IGNORECASE),
    re.compile(r"^TB\d+[A-Z]*\s+TAB\b", re.IGNORECASE),
    re.compile(r"\bTAB\s+\d+G\+\d+G", re.IGNORECASE),
    re.compile(r"[A-Z]\d+[A-Z]?\d+G\d+T", re.IGNORECASE),
    re.compile(r"\bIRX\d|IAX\d|ADR\d|IPH\d|ILL\d|AHP\d|IRH\d|IRL\d", re.IGNORECASE),
]
DETAIL_REQUIRED_CATEGORIES = {"游戏笔记本", "轻薄笔记本", "平板电脑", "手机", "台式机", "一体机", "台式/一体机", "显示器"}
ACCESSORY_TITLE_PATTERN = re.compile(
    r"鼠标|键盘|背包|支架|保护夹|钢化膜|适配器|充电器|耳机|鼠标垫|手写笔|插排|摄像头|打印机|体脂秤|投影|剃须刀|存储|牙刷|按摩|咖啡|手柄|膜|包",
    re.IGNORECASE,
)
PROMO_TITLE_PATTERN = re.compile(
    r"^【[^】]+】|国家补贴(?:15%)?|教育优惠|张凌赫同款|主流游戏|新品热卖|社群专属|性价比首选|"
    r"官方旗舰店?|年会礼品|P图设计|旗舰标压|高刷高色域电竞屏|逆势前行\s*内存不涨",
    re.IGNORECASE,
)
CONFIG_DETAIL_PATTERN = re.compile(
    r"\b\d+\s*(?:G|GB|T|TB)\b|\d+\+\d+|RTX|GTX|Ultra\s*(?:\d|X)|i[3579][-\s]?\d|R[3579][-\s]?|骁龙|天玑|Dimensity|OLED|\d(?:\.\d)?K|\d{2,3}\s*Hz|Wi-?Fi|WIFI|英寸|酷睿|锐龙|内存|固态|SSD|高刷|2K|3K",
    re.IGNORECASE,
)
CPU_DETAIL_PATTERN = re.compile(r"Ultra\s*(?:\d|X)|i[3579][-\s]?\d{3,5}|R[3579][-\s]?\d{3,5}|骁龙|天玑|Dimensity|酷睿|锐龙", re.IGNORECASE)
MEMORY_STORAGE_DETAIL_PATTERN = re.compile(r"\b\d+\s*(?:G|GB|T|TB)\b|\d+\+\d+|SSD|内存|固态", re.IGNORECASE)
GENERIC_SERIES_LOST_PATTERN = re.compile(
    r"^联想(?:moto)?(?:酷睿|锐龙|骁龙|Ultra|英特尔)?[A-Za-z0-9\-\s]*"
    r"(?:笔记本电脑|台式电脑|台式机|一体台式电脑|一体机|显示器|手机|平板电脑)\b",
    re.IGNORECASE,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_json(url: str, timeout: float = 4.0) -> tuple[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return "ok", json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return f"unavailable:{exc}", None


def clean_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def looks_like_internal_title(value: Any) -> bool:
    title = clean_title(value)
    if not title:
        return False
    if re.search(r'[\u4e00-\u9fff]', title):
        return False
    return any(pattern.search(title) for pattern in INTERNAL_TITLE_PATTERNS)


def requires_config_detail(item: dict[str, Any]) -> bool:
    category = clean_title(item.get("category"))
    title_text = clean_title(item.get("displayTitle") or item.get("productName"))
    if category not in DETAIL_REQUIRED_CATEGORIES:
        return False
    # Misclassified accessories should be fixed by category mapping, but they
    # should not be judged as missing CPU/memory/storage configuration.
    return not bool(ACCESSORY_TITLE_PATTERN.search(title_text))


def has_config_detail(value: Any) -> bool:
    return bool(CONFIG_DETAIL_PATTERN.search(clean_title(value)))


def has_strong_primary_detail(item: dict[str, Any], value: Any) -> bool:
    title = clean_title(value)
    category = clean_title(item.get("category"))
    if category in {"游戏笔记本", "轻薄笔记本", "台式机", "一体机", "台式/一体机"}:
        return bool(CPU_DETAIL_PATTERN.search(title) and MEMORY_STORAGE_DETAIL_PATTERN.search(title))
    if category in {"平板电脑", "手机"}:
        return bool(re.search(r"\d+\s*(?:GB|G)\s*/\s*\d+\s*(?:GB|G)|\d+\+\d+", title, re.IGNORECASE) or ("GB" in title and ("256" in title or "128" in title or "512" in title)))
    if category == "显示器":
        return bool(re.search(r"\d+(?:\.\d+)?英寸", title, re.IGNORECASE) and re.search(r"\d{2,3}\s*Hz|\d(?:\.\d)?K|OLED|[A-Z]{1,4}\d{2,5}", title, re.IGNORECASE))
    return has_config_detail(title)


def has_series_model_identity(item: dict[str, Any], value: Any) -> bool:
    title = clean_title(value)
    category = clean_title(item.get("category"))
    main_title = clean_title(title.split("·", 1)[0])
    if not main_title:
        return False
    if GENERIC_SERIES_LOST_PATTERN.search(main_title):
        return False
    if category == "游戏笔记本":
        return bool(
            re.search(r"拯救者|LEGION|斗战者|Lecoo", main_title, re.IGNORECASE)
            and re.search(r"Y7000P|Y7000X|Y9000P|R7000P|R9000P|Y7000|Y9000|R7000|R9000|战7000", main_title, re.IGNORECASE)
        )
    if category == "轻薄笔记本":
        return bool(
            re.search(r"小新|YOGA|IDEAPAD|ThinkBook|ThinkPad|来酷", main_title, re.IGNORECASE)
            and re.search(r"小新\s?1[46]|Pro14|Pro16|Air\s?1[346]|Air1[346]|Aura|14\s?Aura|16\s?Aura|Air16|来酷\s?14|来酷14|Lecoo\s*Air16", main_title, re.IGNORECASE)
        )
    if category in {"台式机", "一体机", "台式/一体机"}:
        return bool(re.search(r"小新|ThinkCentre|ThinkStation|AIO|YOGA", main_title, re.IGNORECASE))
    if category in {"平板电脑", "手机", "显示器"}:
        return not bool(GENERIC_SERIES_LOST_PATTERN.search(main_title))
    return True


def index_projection(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items = payload.get("items") if isinstance(payload, dict) else []
    return {
        str(item.get("skuKey") or "").strip(): item
        for item in items
        if isinstance(item, dict)
        and str(item.get("skuKey") or "").strip()
        and int(item.get("currentStock") or 0) > 0
    }


def retail_zone_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = payload.get("decisions") if isinstance(payload, dict) else {}
    items = decisions.get("items") if isinstance(decisions, dict) else []
    return [item for item in items if isinstance(item, dict)]


def append_issue(issues: list[dict[str, Any]], *, terminal: str, sku: str, field: str, expected: Any, actual: Any, title: str = "") -> None:
    issues.append({
        "terminal": terminal,
        "skuKey": sku,
        "field": field,
        "expected": expected,
        "actual": actual,
        "title": title,
    })


def audit_projection_title_detail(projection_by_sku: dict[str, dict[str, Any]], issues: list[dict[str, Any]]) -> int:
    checked = 0
    for sku, item in projection_by_sku.items():
        if not requires_config_detail(item):
            continue
        checked += 1
        category = clean_title(item.get("category"))
        display_title = clean_title(item.get("displayTitle") or item.get("productName"))
        if not has_series_model_identity(item, display_title):
            append_issue(
                issues,
                terminal="publishedProjection",
                sku=sku,
                field="displayTitleSeriesModel",
                expected="series_and_model_kept_in_main_title",
                actual=display_title,
                title=display_title,
            )
        elif not has_config_detail(display_title):
            append_issue(
                issues,
                terminal="publishedProjection",
                sku=sku,
                field="displayTitleDetail",
                expected="main_title_with_configuration",
                actual=display_title,
                title=display_title,
            )
        elif not has_strong_primary_detail(item, display_title):
            append_issue(
                issues,
                terminal="publishedProjection",
                sku=sku,
                field="displayTitleStrongDetail",
                expected="cpu_and_memory_or_storage_detail",
                actual=display_title,
                title=display_title,
            )
        elif category not in {"显示器"} and "·" not in display_title:
            append_issue(
                issues,
                terminal="publishedProjection",
                sku=sku,
                field="displayTitleSeparator",
                expected="main_title_separator_detail",
                actual=display_title,
                title=display_title,
            )
        if PROMO_TITLE_PATTERN.search(display_title):
            append_issue(
                issues,
                terminal="publishedProjection",
                sku=sku,
                field="displayTitlePromoNoise",
                expected="clean_customer_title",
                actual=display_title,
                title=display_title,
            )
    return checked


def audit_channel_views(projection_by_sku: dict[str, dict[str, Any]], issues: list[dict[str, Any]]) -> int:
    checked = 0
    for sku, item in projection_by_sku.items():
        display_title = clean_title(item.get("displayTitle") or item.get("productName"))
        if not display_title:
            append_issue(issues, terminal="publishedProjection", sku=sku, field="displayTitle", expected="non-empty", actual="", title="")
        elif looks_like_internal_title(display_title):
            append_issue(issues, terminal="publishedProjection", sku=sku, field="displayTitle", expected="customer_visible_title", actual=display_title, title=display_title)
        views = item.get("channelViews") if isinstance(item.get("channelViews"), dict) else {}
        for view_name in ("retailHero", "cashier", "adMachine"):
            view = views.get(view_name) if isinstance(views.get(view_name), dict) else {}
            if not view:
                append_issue(issues, terminal=view_name, sku=sku, field="channelView", expected="present", actual="missing", title=display_title)
                continue
            checked += 1
            view_title = clean_title(view.get("displayTitle"))
            if view_title != display_title:
                append_issue(issues, terminal=view_name, sku=sku, field="displayTitle", expected=display_title, actual=view_title, title=display_title)
            if looks_like_internal_title(view_title):
                append_issue(issues, terminal=view_name, sku=sku, field="displayTitle", expected="customer_visible_title", actual=view_title, title=display_title)
    return checked


def audit_retail_zone(name: str, payload: dict[str, Any], projection_by_sku: dict[str, dict[str, Any]], issues: list[dict[str, Any]]) -> int:
    checked = 0
    for item in retail_zone_items(payload):
        sku = str(item.get("skuKey") or "").strip()
        projection = projection_by_sku.get(sku)
        if not sku or not projection:
            continue
        checked += 1
        expected = clean_title(projection.get("displayTitle") or projection.get("productName"))
        actual = clean_title(item.get("displayTitle") or item.get("productName"))
        if actual != expected:
            append_issue(issues, terminal=name, sku=sku, field="productName", expected=expected, actual=actual, title=expected)
        if looks_like_internal_title(actual):
            append_issue(issues, terminal=name, sku=sku, field="productName", expected="customer_visible_title", actual=actual, title=expected)
    return checked


def audit_standard_master(name: str, payload: dict[str, Any], projection_by_sku: dict[str, dict[str, Any]], issues: list[dict[str, Any]]) -> int:
    rows = payload.get("rows") if isinstance(payload, dict) else []
    checked = 0
    if not isinstance(rows, list):
        return checked
    for row in rows:
        if not isinstance(row, dict):
            continue
        sku = str(row.get("skuKey") or "").strip()
        projection = projection_by_sku.get(sku)
        if not sku or not projection:
            continue
        checked += 1
        expected = clean_title(projection.get("displayTitle") or projection.get("productName"))
        actual = clean_title(row.get("displayTitle") or row.get("productName"))
        if actual != expected:
            append_issue(issues, terminal=name, sku=sku, field="productName", expected=expected, actual=actual, title=expected)
        if looks_like_internal_title(actual):
            append_issue(issues, terminal=name, sku=sku, field="productName", expected="customer_visible_title", actual=actual, title=expected)
    return checked


def main() -> int:
    projection = load_json(DATA_DIR / "latest-published-product-projection.json", {"items": []})
    projection_by_sku = index_projection(projection)
    issues: list[dict[str, Any]] = []
    checks: dict[str, Any] = {
        "activePublishedProjectionItemCount": len(projection_by_sku),
        "titleDetailRequiredChecks": audit_projection_title_detail(projection_by_sku, issues),
        "channelViewChecks": audit_channel_views(projection_by_sku, issues),
    }

    checks["staticRetailZoneChecks"] = audit_retail_zone(
        "staticRetailZone",
        load_json(DATA_DIR / "latest-retail-zone-snapshot.json", {}),
        projection_by_sku,
        issues,
    )
    checks["standardPriceMasterChecks"] = audit_standard_master(
        "standardPriceMaster",
        load_json(DATA_DIR / "latest-standard-price-master.json", {}),
        projection_by_sku,
        issues,
    )
    checks["standardPriceMasterFrontendChecks"] = audit_standard_master(
        "standardPriceMasterFrontend",
        load_json(DATA_DIR / "latest-standard-price-master-frontend-snapshot.json", {}),
        projection_by_sku,
        issues,
    )

    api_status, api_retail_zone = fetch_json("http://127.0.0.1:8000/api/inventory-quote/retail-zone")
    checks["apiRetailZoneStatus"] = api_status
    checks["apiRetailZoneChecks"] = audit_retail_zone("apiRetailZone", api_retail_zone, projection_by_sku, issues) if isinstance(api_retail_zone, dict) else 0

    report = {
        "generatedAt": now_iso(),
        "source": "latest-published-product-projection.json",
        "status": "pass" if not issues else "fail",
        "rules": [
            "客户可见端只允许使用 SQL/发布投影下发的 displayTitle。",
            "采集链路、智店通导入和标准价格主档的原始 productName 只允许作为证据或 sourceProductName 保留，不允许覆盖 displayTitle。",
            "零售英雄卡、收银端、广告机三端 displayTitle 必须一致。",
            "主力商品（电脑、平板、手机、台式/一体机、显示器）客户可见主标题必须带配置详参；配件不按电脑配置强制。",
        ],
        "summary": {
            **checks,
            "issueCount": len(issues),
        },
        "issues": issues[:500],
        "truncated": len(issues) > 500,
    }
    for output_dir in (DATA_DIR, ARTIFACT_DIR):
        save_json(output_dir / REPORT_NAME, report)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
