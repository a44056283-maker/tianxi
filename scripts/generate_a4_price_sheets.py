from __future__ import annotations

import html
import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile
from pypdf import PdfWriter

PROJECT_ROOT = Path("/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit")
DATA_FILE = PROJECT_ROOT / "apps/web-cockpit/public/flyers/lenovo-618-flyers-data.json"
DESKTOP_DIR = Path("/Users/luxiangnan/Desktop")
OUTPUT_DIR = DESKTOP_DIR / f"联想门店A4价格单_{datetime.now().strftime('%Y%m%d_%H%M')}"
ZIP_PATH = DESKTOP_DIR / f"{OUTPUT_DIR.name}.zip"
CHROME_BIN = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

THEMES = {
    "联想618游戏本门店促销页": {
        "slug": "游戏本",
        "accent": "#ff5c4d",
        "accent2": "#ffd27f",
        "edge": "#ff9478",
        "bg1": "#180607",
        "bg2": "#2a0b0f",
        "badge": "拯救者 / 斗战者",
    },
    "联想618轻薄本门店促销页": {
        "slug": "轻薄本",
        "accent": "#ff5977",
        "accent2": "#ffd7b1",
        "edge": "#ff9cb1",
        "bg1": "#13080c",
        "bg2": "#31141a",
        "badge": "小新 / YOGA / 来酷",
    },
    "联想618平板门店促销页": {
        "slug": "平板",
        "accent": "#34c9ff",
        "accent2": "#d4f7ff",
        "edge": "#74dfff",
        "bg1": "#07131b",
        "bg2": "#0e2734",
        "badge": "小新平板 / 拯救者平板",
    },
    "联想618手机门店促销页": {
        "slug": "手机",
        "accent": "#ff65d6",
        "accent2": "#ffd8ad",
        "edge": "#ffadea",
        "bg1": "#17061a",
        "bg2": "#2f0c31",
        "badge": "MOTO 手机",
    },
}


def load_payload() -> dict[str, Any]:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def money(value: Any) -> str:
    if value is None or value == "":
        return "-"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "-"
    if abs(number - round(number)) < 0.01:
        return f"¥{int(round(number)):,}"
    return f"¥{number:,.2f}"


def short_date(date_text: Any) -> str:
    raw = str(date_text or "").strip()
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        return raw[2:10]
    return raw or "-"


def activity_amount(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0
    return "-" if number <= 0 else money(number)


def activity_period(product: dict[str, Any]) -> str:
    start = short_date(product.get("validFrom"))
    end = short_date(product.get("validTo"))
    remain = product.get("remainingDays")
    parts: list[str] = []
    if start != "-" or end != "-":
        if start != "-" and end != "-":
            parts.append(f"{start}~{end}")
        else:
            parts.append(start if start != "-" else end)
    if remain not in (None, ""):
        parts.append(f"剩{remain}天")
    return " / ".join(parts) if parts else "-"


def subtitle_line(product: dict[str, Any]) -> str:
    subtitle = str(product.get("subtitle") or "").strip()
    if not subtitle:
        return "-"
    return subtitle


def full_title(product: dict[str, Any]) -> str:
    title = str(product.get("title") or "").strip()
    pn_mtm = str(product.get("pnMtm") or "").strip()
    if title:
        if pn_mtm:
            title = title.replace(f" · {pn_mtm}", "").replace(f"· {pn_mtm}", "").replace(pn_mtm, "").strip(" ·")
        return " ".join(title.split())
    main_title = str(product.get("mainTitle") or product.get("title") or "").strip()
    subtitle = str(product.get("subtitle") or "").strip()
    if main_title and subtitle:
        merged = f"{main_title} · {subtitle}"
        if pn_mtm:
            merged = merged.replace(f" · {pn_mtm}", "").replace(f"· {pn_mtm}", "").replace(pn_mtm, "").strip(" ·")
        return " ".join(merged.split())
    return main_title


def metric_block(label: str, value: str, meta: str = "") -> str:
    meta_html = f'<small>{html.escape(meta)}</small>' if meta else ""
    return f'<div class="metric-box"><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong>{meta_html}</div>'


def render_rows(products: list[dict[str, Any]]) -> str:
    rows: list[str] = []
    for product in products:
        title = html.escape(full_title(product))
        rank = int(product.get("rank") or 0)
        period = activity_period(product)
        metrics = "".join(
            [
                metric_block("门店零售价", money(product.get("storePrice"))),
                metric_block("营销", activity_amount(product.get("boostAmount")), period if product.get("boostAmount") else ""),
                metric_block("教育补", activity_amount(product.get("educationDiscountAmount")), period if product.get("educationDiscountAmount") else ""),
                metric_block("门店国补前价", money(product.get("adjustedPreSubsidyPrice"))),
                metric_block("国补后价", money(product.get("finalPrice"))),
            ]
        )
        rows.append(
            f"""
            <tr>
              <td class="rank-cell">{rank:02d}</td>
              <td class="content-cell">
                <div class="title">{title}</div>
                <div class="metric-grid">{metrics}</div>
              </td>
            </tr>
            """
        )
    return "".join(rows)


def page_html(page: dict[str, Any], theme: dict[str, str], generated_at: str) -> str:
    products = list(page.get("products") or [])
    sellable_total = sum(int(item.get("sellableStock") or item.get("currentStock") or 0) for item in products)
    rows_markup = render_rows(products)
    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(theme['slug'])}A4价格单</title>
  <style>
    @page {{ size: A4 landscape; margin: 8mm; }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; }}
    body {{
      font-family: "PingFang SC","Microsoft YaHei",Arial,sans-serif;
      color: #2f241e;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, {theme['accent']} 18%, transparent), transparent 36%),
        linear-gradient(140deg, #fffaf4 0%, #fff4ea 52%, #fffdf9 100%);
    }}
    .sheet {{
      min-height: calc(210mm - 16mm);
      padding: 6mm;
      position: relative;
    }}
    .hero {{
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 3mm;
      align-items: stretch;
      padding: 3.2mm 4mm;
      border-radius: 4mm;
      background: linear-gradient(135deg, color-mix(in srgb, {theme['accent']} 14%, #fff7f2), #fffdf9);
      border: 1px solid rgba(123, 75, 47, 0.14);
    }}
    .eyebrow {{
      display: inline-block;
      color: #9a3412;
      font-size: 8pt;
      font-weight: 900;
      letter-spacing: .08em;
    }}
    h1 {{
      margin: 1.2mm 0 1mm;
      font-size: 18pt;
      line-height: 1;
    }}
    .hero-note {{
      margin: 0;
      color: rgba(65, 45, 33, .82);
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.25;
    }}
    .summary {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.8mm;
      align-content: start;
    }}
    .summary-box {{
      padding: 2mm;
      border-radius: 3mm;
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(123, 75, 47, 0.14);
    }}
    .summary-box span {{
      display: block;
      font-size: 7pt;
      color: rgba(88, 67, 54, .88);
    }}
    .summary-box strong {{
      display: block;
      margin-top: .6mm;
      font-size: 12pt;
      line-height: 1.05;
    }}
    .table-wrap {{
      margin-top: 2.4mm;
      border-radius: 3mm;
      overflow: hidden;
      border: 1px solid rgba(123, 75, 47, 0.14);
      background: rgba(255,255,255,0.96);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }}
    .rank-col {{
      width: 4.8mm;
    }}
    .content-col {{
      width: auto;
    }}
    thead {{
      display: table-header-group;
    }}
    thead th {{
      padding: 2mm 1.4mm;
      background: linear-gradient(180deg, rgba(255,239,221,.92), rgba(255,250,242,.98));
      color: #5c3922;
      font-size: 7.8pt;
      font-weight: 900;
      text-align: center;
      border-bottom: 1px solid rgba(126, 84, 58, 0.18);
    }}
    tbody tr {{
      page-break-inside: avoid;
      break-inside: avoid;
    }}
    tbody tr:nth-child(odd) {{
      background: rgba(255, 251, 246, 0.96);
    }}
    tbody td {{
      padding: 1.45mm 1.3mm;
      border-bottom: 1px solid rgba(126, 84, 58, 0.18);
      vertical-align: top;
      font-size: 7.2pt;
      line-height: 1.12;
      color: rgba(49, 35, 27, .96);
      word-break: break-word;
    }}
    tbody tr:last-child td {{
      border-bottom: 0;
    }}
    .rank-head {{
      width: 4.8mm;
      padding-left: .18mm;
      padding-right: .18mm;
    }}
    .content-head {{
      padding-left: 1mm;
      padding-right: 1mm;
    }}
    .rank-cell {{
      width: 4.8mm;
      min-width: 4.8mm;
      max-width: 4.8mm;
      text-align: center;
      padding: 1.05mm .12mm;
      font-size: 6.8pt;
      font-weight: 900;
      color: #40231b;
      background: linear-gradient(135deg, color-mix(in srgb, {theme['accent']} 38%, white), color-mix(in srgb, {theme['accent2']} 55%, white));
    }}
    .content-cell {{
      width: auto;
      padding: 1.25mm 1.05mm 1.15mm .72mm;
    }}
    .title {{
      font-size: 8.15pt;
      font-weight: 900;
      line-height: 1.12;
      color: #2b211c;
      white-space: normal;
      word-break: break-word;
      margin-bottom: 1.15mm;
    }}
    .metric-grid {{
      display: grid;
      grid-template-columns: 1.18fr .74fr .74fr .96fr 1.02fr;
      gap: .72mm;
      align-items: stretch;
    }}
    .metric-box {{
      padding: .9mm .8mm;
      border-radius: 2.2mm;
      background: rgba(255, 249, 242, 0.96);
      border: 1px solid rgba(126, 84, 58, 0.14);
      text-align: center;
    }}
    .metric-box span {{
      display: block;
      color: #8a5a3b;
      font-size: 5.35pt;
      font-weight: 800;
      line-height: 1.05;
    }}
    .metric-box strong {{
      display: block;
      margin-top: .35mm;
      color: #8a3412;
      font-size: 7.6pt;
      line-height: 1.04;
      font-weight: 900;
    }}
    .metric-box small {{
      display: block;
      margin-top: .35mm;
      color: rgba(99, 76, 61, .9);
      font-size: 4.85pt;
      line-height: 1.05;
      font-weight: 700;
    }}
    .metric-box:last-child {{
      background: linear-gradient(180deg, rgba(255,236,176,.88), rgba(255,248,224,.96));
      border-color: rgba(199, 130, 44, 0.2);
    }}
    .metric-box:last-child strong {{
      font-size: 8.25pt;
    }}
    .footer {{
      margin-top: 3mm;
      font-size: 7.6pt;
      color: rgba(99, 76, 61, .9);
      text-align: right;
    }}
  </style>
</head>
<body>
  <section class="sheet">
    <header class="hero">
      <div>
        <div class="eyebrow">联想智慧零售 · A4 打印价格单</div>
        <h1>{html.escape(theme['slug'])}在售价格单</h1>
        <p class="hero-note">{html.escape(theme['badge'])} · 与广告机同色系风格 · 生成时间 {html.escape(generated_at)}</p>
      </div>
      <div class="summary">
        <div class="summary-box"><span>在售商品</span><strong>{len(products)}</strong></div>
        <div class="summary-box"><span>可售库存</span><strong>{sellable_total}</strong></div>
        <div class="summary-box"><span>打印规格</span><strong>A4横向</strong></div>
      </div>
    </header>
    <div class="table-wrap">
      <table>
        <colgroup>
          <col class="rank-col" />
          <col class="content-col" />
        </colgroup>
        <thead>
          <tr>
            <th class="rank-head">序</th>
            <th class="content-head">产品标题与价格信息</th>
          </tr>
        </thead>
        <tbody>{rows_markup}</tbody>
      </table>
    </div>
    <div class="footer">价格字段口径：广告机发布快照同步，包含门店零售价、营销、教育补、门店国补前价、国补后价。</div>
  </section>
</body>
</html>
"""


def render_pdfs(html_files: list[Path]) -> None:
    if not CHROME_BIN.exists():
        raise SystemExit(f"Chrome 不存在：{CHROME_BIN}")
    for html_file in html_files:
        pdf_path = html_file.with_suffix(".pdf")
        subprocess.run(
            [
                str(CHROME_BIN),
                "--headless=new",
                "--disable-gpu",
                f"--print-to-pdf={pdf_path}",
                "--no-pdf-header-footer",
                html_file.as_uri(),
            ],
            check=True,
        )


def merge_pdfs(pdf_files: list[Path]) -> Path:
    combined_path = OUTPUT_DIR / f"{OUTPUT_DIR.name}_合并打印版.pdf"
    writer = PdfWriter()
    for pdf_file in pdf_files:
        writer.append(str(pdf_file))
    with combined_path.open("wb") as file:
        writer.write(file)
    return combined_path


def write_readme(files: list[Path]) -> None:
    lines = [
        "# 联想门店 A4 价格单导出",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "- 打印规格：A4 横向",
        "- 版式：浅色高对比打印底版 + 高密度表格清单",
        "- 价格字段：门店零售价、营销、教育补、门店国补前价、国补后价",
        "- 标题口径：对齐广告机与收银端完整主标题，保留核心配置参数",
        "",
        "## 文件清单",
    ]
    for file in files:
        lines.append(f"- {file.name}")
    (OUTPUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def package_output() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with ZipFile(ZIP_PATH, "w", compression=ZIP_DEFLATED) as zf:
        for path in sorted(OUTPUT_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, arcname=f"{OUTPUT_DIR.name}/{path.relative_to(OUTPUT_DIR)}")


def main() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = load_payload()
    generated_at = str(payload.get("generatedAt") or "")
    html_files: list[Path] = []
    for page in payload.get("pages") or []:
        theme = THEMES.get(str(page.get("title") or ""))
        if not theme:
            continue
        html_path = OUTPUT_DIR / f"{theme['slug']}_A4价格单.html"
        html_path.write_text(page_html(page, theme, generated_at), encoding="utf-8")
        html_files.append(html_path)
    render_pdfs(html_files)
    pdf_files = [path.with_suffix(".pdf") for path in html_files]
    combined_pdf = merge_pdfs(pdf_files)
    write_readme(html_files + pdf_files + [combined_pdf])
    package_output()
    print(str(OUTPUT_DIR))
    print(str(ZIP_PATH))


if __name__ == "__main__":
    main()
