#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import re
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "apps/web-cockpit/public/data"
OUTPUT_DIR = ROOT / "artifacts/price-tags/output"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")


COMPUTER_CATEGORIES = {
    "轻薄笔记本",
    "游戏笔记本",
    "一体机",
    "游戏主机",
    "商务台式",
    "GeekPro台式",
    "台式机",
}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def currency(value: float | int | None) -> str:
    if value is None:
        return "待补"
    if abs(value - round(value)) < 1e-6:
        return f"{int(round(value)):,}"
    return f"{value:,.2f}"


def get_best_title(row: dict, marketplace_by_sku: dict[str, list[dict]]) -> str:
    records = marketplace_by_sku.get(row["skuKey"], [])
    for source in ("jd", "lenovo_official"):
        for record in records:
            if record.get("source") != source:
                continue
            title = (record.get("matchTitle") or "").strip()
            if title and not re.search(r"系列家族页|可见子配置|家族详情页", title):
                return title
    return row.get("productName") or row.get("skuKey") or "未命名商品"


def compact_spec(row: dict, title: str) -> str:
    live_spec = str(row.get("spec") or "").strip()
    pn = str(row.get("pnMtm") or "").strip()
    pieces = []
    for pattern in [
        r"(Ultra\s*[X]?\d\s*\d{3}\w*)",
        r"(Ultra\s*[579]\s*\d{3}\w*)",
        r"(i[3579][-\s]?\d{4,5}\w*)",
        r"(R[579][-\s]?\d{3,4}\w*)",
        r"(锐龙\s*\d\s*\d{4}\w*)",
        r"(\d{1,2}G(?:B)?)",
        r"(\dT(?:B)?|\d{3,4}G(?:B)?SSD)",
        r"(RTX\s*\d{4}\w*)",
        r"(\d(?:\.\d)?K\s*\d{2,3}Hz)",
        r"(冰魄白|碳晶黑|钛晶黑|黑色|白色|云绢|浅海贝|赛道灰|冠军白)",
    ]:
        for match in re.findall(pattern, title, flags=re.I):
            value = re.sub(r"\s+", " ", match).strip()
            if value and value not in pieces:
                pieces.append(value)
    if len(pieces) >= 3:
        return " / ".join(pieces[:8])
    return live_spec or pn or "见商品标题"


def wrap_text(text: str, max_chars: int) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    lines: list[str] = []
    current = ""
    for char in text:
        weight = 2 if ord(char) > 127 else 1
        current_weight = sum(2 if ord(c) > 127 else 1 for c in current)
        if current and current_weight + weight > max_chars:
            lines.append(current)
            current = char
        else:
            current += char
    if current:
        lines.append(current)
    return lines


def draw_centered(c: canvas.Canvas, text: str, x: float, y: float, font: str, size: float, color=colors.black):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(x, y, text)


def draw_tag(c: canvas.Canvas, item: dict, index: int, total: int):
    page_w = 110 * mm
    page_h = 110 * mm
    margin = 7 * mm
    red = colors.HexColor("#e2231a")
    dark = colors.HexColor("#202124")
    grey = colors.HexColor("#5f6368")
    light = colors.HexColor("#f5f6f7")

    c.setFillColor(colors.white)
    c.rect(0, 0, page_w, page_h, stroke=0, fill=1)
    c.setFillColor(red)
    c.rect(0, page_h - 16 * mm, page_w, 16 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("CJK-Bold", 12)
    c.drawString(margin, page_h - 10.5 * mm, "Lenovo 门店价签")
    c.setFont("CJK", 6.5)
    c.drawRightString(page_w - margin, page_h - 10.5 * mm, f"{index}/{total}")

    y = page_h - 22 * mm
    c.setFillColor(dark)
    c.setFont("CJK-Bold", 9.6)
    for line in wrap_text(item["title"], 40)[:3]:
        c.drawString(margin, y, line)
        y -= 5.0 * mm

    y -= 1 * mm
    c.setFillColor(grey)
    c.setFont("CJK", 7.4)
    spec_lines = wrap_text(item["spec"], 44)[:2]
    for line in spec_lines:
        c.drawString(margin, y, line)
        y -= 4.3 * mm

    c.setFillColor(light)
    c.roundRect(margin, 39 * mm, page_w - 2 * margin, 25 * mm, 4 * mm, stroke=0, fill=1)
    c.setFillColor(red)
    c.setFont("CJK-Bold", 12)
    c.drawString(margin + 5 * mm, 54 * mm, "门店展示价")
    c.setFont("CJK-Bold", 30)
    c.drawRightString(page_w - margin - 5 * mm, 45 * mm, f"¥{currency(item['tag_price'])}")

    c.setFillColor(grey)
    c.setFont("CJK", 7)
    c.drawString(margin, 32 * mm, f"门店零售价：¥{currency(item['base_price'])}    本价签：门店零售价 + ¥500")
    c.drawString(margin, 27.5 * mm, f"SKU：{item['sku']}    PN/MTM：{item['pn']}")
    c.drawString(margin, 23 * mm, f"库存：{item['stock']} 台    品类：{item['category']}")

    c.setStrokeColor(colors.HexColor("#dadce0"))
    c.line(margin, 18 * mm, page_w - margin, 18 * mm)
    c.setFillColor(grey)
    c.setFont("CJK", 6.3)
    c.drawString(margin, 13.5 * mm, "价格以门店当日系统为准；活动、国补、教育补和服务包以实际政策核销为准。")
    c.drawString(margin, 9.5 * mm, f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("CJK", str(FONT_PATH)))
    pdfmetrics.registerFont(TTFont("CJK-Bold", str(FONT_PATH)))

    retail = load_json(DATA_DIR / "latest-retail-zone-snapshot.json")
    marketplace = load_json(DATA_DIR / "latest-marketplace-price-snapshot.json")

    marketplace_by_sku: dict[str, list[dict]] = {}
    for record in marketplace.get("records", []):
        marketplace_by_sku.setdefault(record.get("productId", ""), []).append(record)

    items = []
    for row in retail.get("decisions", {}).get("items", []):
        stock = int(row.get("currentStock") or 0)
        category = str(row.get("category") or "")
        if stock <= 0 or category not in COMPUTER_CATEGORIES:
            continue
        base_price = row.get("recommendedPreSubsidyPrice")
        if not isinstance(base_price, (int, float)) or not math.isfinite(base_price):
            continue
        title = get_best_title(row, marketplace_by_sku)
        items.append({
            "sku": row.get("skuKey", ""),
            "pn": row.get("pnMtm", ""),
            "category": category,
            "stock": stock,
            "title": title,
            "spec": compact_spec(row, title),
            "base_price": float(base_price),
            "tag_price": float(base_price) + 500,
        })

    items.sort(key=lambda x: (x["category"], x["sku"]))

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    pdf_path = OUTPUT_DIR / f"门店价签-笔记本台式机-库存SKU-门店价加500-{stamp}.pdf"
    csv_path = OUTPUT_DIR / f"门店价签-笔记本台式机-库存SKU-门店价加500-{stamp}.csv"

    page_size = (110 * mm, 110 * mm)
    c = canvas.Canvas(str(pdf_path), pagesize=page_size)
    for index, item in enumerate(items, 1):
        draw_tag(c, item, index, len(items))
        c.showPage()
    c.save()

    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["sku", "pn", "category", "stock", "title", "spec", "base_price", "tag_price"])
        writer.writeheader()
        writer.writerows(items)

    print(json.dumps({
        "pdf": str(pdf_path),
        "csv": str(csv_path),
        "count": len(items),
        "items": items,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
