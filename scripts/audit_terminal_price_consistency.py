#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "apps" / "web-cockpit" / "public" / "data"
ARTIFACT_DIR = ROOT / "apps" / "inventory-sync" / "artifacts"
REPORT_NAME = "latest-terminal-price-consistency-audit.json"
TERMINAL_FILES = (
    ROOT / "apps" / "web-cockpit" / "public" / "android-pos-lite.html",
    ROOT / "apps" / "web-cockpit" / "public" / "ad-machine" / "index.html",
    ROOT / "apps" / "web-cockpit" / "public" / "flyers" / "lenovo-618-gaming.html",
    ROOT / "apps" / "web-cockpit" / "public" / "flyers" / "lenovo-618-thin-light.html",
    ROOT / "apps" / "web-cockpit" / "public" / "flyers" / "lenovo-618-tablet.html",
    ROOT / "apps" / "web-cockpit" / "public" / "flyers" / "lenovo-618-phone.html",
)
LEGACY_TERMS = (
    "门店零售价/国补前",
    "门店国补前执行价",
)
PRICE_FIELDS = (
    "storeRetailPrice",
    "adjustedPreSubsidyPrice",
    "finalPrice",
    "nationalSubsidyPrice",
    "marketingPoAmount",
    "educationDiscountAmount",
    "storeManualPromotionAmount",
)
MATH_FIELDS = (
    "marketingPoAmount",
    "educationDiscountAmount",
    "storeManualPromotionAmount",
)
FORMULA_SAMPLE_LIMIT = 50
RETAIL_ZONE_FIELD_MAP = {
    "storeRetailPrice": "recommendedPreSubsidyPrice",
    "adjustedPreSubsidyPrice": "adjustedPreSubsidyPrice",
    "finalPrice": "fullServiceSubsidyPrice",
    "marketingPoAmount": "marketingPoAmount",
    "educationDiscountAmount": "educationDiscountAmount",
    "storeManualPromotionAmount": "storeManualPromotionAmount",
}


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


def round_price(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 2)


def same_price(left: Any, right: Any) -> bool:
    return round_price(left) == round_price(right)


def is_positive(value: Any) -> bool:
    number = round_price(value)
    return number is not None and number > 0


def index_projection(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items = payload.get("items") if isinstance(payload, dict) else []
    return {
        str(item.get("skuKey") or "").strip(): item
        for item in items
        if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
    }


def retail_zone_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = payload.get("decisions") if isinstance(payload, dict) else {}
    items = decisions.get("items") if isinstance(decisions, dict) else []
    return [item for item in items if isinstance(item, dict)]


def pricing_for(item: dict[str, Any]) -> dict[str, Any]:
    pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
    return pricing


def append_mismatch(mismatches: list[dict[str, Any]], *, terminal: str, sku: str, field: str, expected: Any, actual: Any, title: str = "") -> None:
    mismatches.append({
        "terminal": terminal,
        "skuKey": sku,
        "field": field,
        "expected": round_price(expected) if round_price(expected) is not None else expected,
        "actual": round_price(actual) if round_price(actual) is not None else actual,
        "title": title,
    })


def build_formula_samples(projection_by_sku: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    for sku, item in projection_by_sku.items():
        pricing = pricing_for(item)
        store_price = round_price(pricing.get("storeRetailPrice"))
        adjusted_price = round_price(pricing.get("adjustedPreSubsidyPrice"))
        if store_price is None or adjusted_price is None:
            continue
        po_amount = round_price(pricing.get("marketingPoAmount")) or 0
        edu_amount = round_price(pricing.get("educationDiscountAmount")) or 0
        manual_amount = round_price(pricing.get("storeManualPromotionAmount")) or 0
        if po_amount <= 0 and edu_amount <= 0 and manual_amount <= 0 and store_price == adjusted_price:
            continue
        parts = [f"原门店挂牌价 {store_price:.2f}"]
        if po_amount > 0:
            parts.append(f"营销PO {po_amount:.2f}")
        if edu_amount > 0:
            parts.append(f"教育补 {edu_amount:.2f}")
        if manual_amount > 0:
            parts.append(f"店面活动 {manual_amount:.2f}")
        samples.append({
            "skuKey": sku,
            "title": str(item.get("displayTitle") or item.get("productName") or ""),
            "storeRetailPrice": store_price,
            "adjustedPreSubsidyPrice": adjusted_price,
            "marketingPoAmount": po_amount,
            "educationDiscountAmount": edu_amount,
            "storeManualPromotionAmount": manual_amount,
            "formula": f"活动后国补前执行价 {adjusted_price:.2f} = " + " - ".join(parts),
        })
    samples.sort(
        key=lambda row: (
            -float(row.get("storeManualPromotionAmount") or 0),
            -float(row.get("marketingPoAmount") or 0),
            -float(row.get("educationDiscountAmount") or 0),
            str(row.get("skuKey") or ""),
        )
    )
    return samples[:FORMULA_SAMPLE_LIMIT]


def audit_legacy_wording(mismatches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for path in TERMINAL_FILES:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            continue
        for term in LEGACY_TERMS:
            if term not in text:
                continue
            hit = {
                "file": str(path.relative_to(ROOT)),
                "term": term,
            }
            hits.append(hit)
            append_mismatch(
                mismatches,
                terminal="legacyWording",
                sku=str(path.relative_to(ROOT)),
                field="legacyTerm",
                expected="removed",
                actual=term,
                title=str(path.name),
            )
    return hits


def audit_projection_math(projection_by_sku: dict[str, dict[str, Any]], mismatches: list[dict[str, Any]]) -> int:
    checked = 0
    for sku, item in projection_by_sku.items():
        pricing = pricing_for(item)
        store_price = round_price(pricing.get("storeRetailPrice"))
        adjusted_price = round_price(pricing.get("adjustedPreSubsidyPrice"))
        if store_price is None or adjusted_price is None:
            continue
        checked += 1
        deductions = sum(round_price(pricing.get(field)) or 0 for field in MATH_FIELDS)
        expected_adjusted = round(max(store_price - deductions, 0), 2)
        if adjusted_price != expected_adjusted:
            append_mismatch(
                mismatches,
                terminal="projectionMath",
                sku=sku,
                field="adjustedPreSubsidyPrice",
                expected=expected_adjusted,
                actual=adjusted_price,
                title=str(item.get("displayTitle") or item.get("productName") or ""),
            )
    return checked


def audit_channel_views(projection_by_sku: dict[str, dict[str, Any]], mismatches: list[dict[str, Any]]) -> int:
    checked = 0
    for sku, item in projection_by_sku.items():
        base = pricing_for(item)
        views = item.get("channelViews") if isinstance(item.get("channelViews"), dict) else {}
        title = str(item.get("displayTitle") or item.get("productName") or "")
        for view_name in ("retailHero", "cashier", "adMachine"):
            view = views.get(view_name) if isinstance(views.get(view_name), dict) else {}
            if not view:
                append_mismatch(mismatches, terminal=view_name, sku=sku, field="channelView", expected="present", actual="missing", title=title)
                continue
            checked += 1
            for field in PRICE_FIELDS:
                if field not in base:
                    continue
                if not same_price(base.get(field), view.get(field)):
                    append_mismatch(mismatches, terminal=view_name, sku=sku, field=field, expected=base.get(field), actual=view.get(field), title=title)
    return checked


def audit_retail_zone(name: str, payload: dict[str, Any], projection_by_sku: dict[str, dict[str, Any]], mismatches: list[dict[str, Any]]) -> int:
    checked = 0
    for item in retail_zone_items(payload):
        sku = str(item.get("skuKey") or "").strip()
        projection = projection_by_sku.get(sku)
        if not sku or not projection:
            continue
        checked += 1
        pricing = pricing_for(projection)
        title = str(projection.get("displayTitle") or projection.get("productName") or item.get("productName") or "")
        for projection_field, retail_field in RETAIL_ZONE_FIELD_MAP.items():
            expected = pricing.get(projection_field)
            actual = item.get(retail_field)
            if projection_field in {"marketingPoAmount", "educationDiscountAmount", "storeManualPromotionAmount"}:
                expected = expected or 0
                actual = actual or 0
            if projection_field == "adjustedPreSubsidyPrice" and not is_positive(expected):
                continue
            if not same_price(expected, actual):
                append_mismatch(mismatches, terminal=name, sku=sku, field=retail_field, expected=expected, actual=actual, title=title)
    return checked


def audit_game_notebook_policy(projection_by_sku: dict[str, dict[str, Any]], mismatches: list[dict[str, Any]]) -> int:
    checked = 0
    for sku, item in projection_by_sku.items():
        category = str(item.get("category") or item.get("displayCategory") or "")
        if "游戏" not in category:
            continue
        pricing = pricing_for(item)
        policy = pricing.get("storePricePolicy") if isinstance(pricing.get("storePricePolicy"), dict) else {}
        base_source = str(policy.get("baseSource") or "")
        title = str(item.get("displayTitle") or item.get("productName") or "")
        has_lenovo = is_positive(pricing.get("lenovoOfficialPrice"))
        has_jd = is_positive(pricing.get("jdPrice"))
        checked += 1
        if has_lenovo and base_source != "lenovo_official":
            append_mismatch(mismatches, terminal="storePricePolicy", sku=sku, field="gameNotebookBaseSource", expected="lenovo_official", actual=base_source, title=title)
        elif not has_lenovo and has_jd and base_source != "jd_fallback_no_lenovo_official":
            append_mismatch(mismatches, terminal="storePricePolicy", sku=sku, field="gameNotebookBaseSource", expected="jd_fallback_no_lenovo_official", actual=base_source, title=title)
    return checked


def main() -> int:
    projection = load_json(DATA_DIR / "latest-published-product-projection.json", {"items": []})
    projection_by_sku = index_projection(projection)
    mismatches: list[dict[str, Any]] = []
    checks: dict[str, Any] = {
        "publishedProjectionItemCount": len(projection_by_sku),
        "projectionMathChecks": audit_projection_math(projection_by_sku, mismatches),
        "channelViewChecks": audit_channel_views(projection_by_sku, mismatches),
        "gameNotebookPolicyChecks": audit_game_notebook_policy(projection_by_sku, mismatches),
    }

    retail_zone_static = load_json(DATA_DIR / "latest-retail-zone-snapshot.json", {})
    checks["staticRetailZoneChecks"] = audit_retail_zone("staticRetailZone", retail_zone_static, projection_by_sku, mismatches)

    api_status, api_retail_zone = fetch_json("http://127.0.0.1:8000/api/inventory-quote/retail-zone")
    checks["apiRetailZoneStatus"] = api_status
    if isinstance(api_retail_zone, dict):
        checks["apiRetailZoneChecks"] = audit_retail_zone("apiRetailZone", api_retail_zone, projection_by_sku, mismatches)
    else:
        checks["apiRetailZoneChecks"] = 0

    legacy_wording_hits = audit_legacy_wording(mismatches)
    checks["legacyWordingHits"] = len(legacy_wording_hits)

    report = {
        "generatedAt": now_iso(),
        "source": "latest-published-product-projection.json",
        "status": "pass" if not mismatches else "fail",
        "summary": {
            **checks,
            "mismatchCount": len(mismatches),
        },
        "formulaSamples": build_formula_samples(projection_by_sku),
        "legacyWordingHits": legacy_wording_hits,
        "mismatches": mismatches[:500],
        "truncated": len(mismatches) > 500,
    }
    for output_dir in (DATA_DIR, ARTIFACT_DIR):
        save_json(output_dir / REPORT_NAME, report)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0 if not mismatches else 1


if __name__ == "__main__":
    sys.exit(main())
