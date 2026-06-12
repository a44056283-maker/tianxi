"""
A4 横向打印价格单生成器
- 数据源：latest-published-product-projection-live.json
- 范围：游戏笔记本 / 轻薄笔记本 / 平板电脑 / 手机（仅 currentStock > 0）
- 格式：与 联想门店A4价格单_20260527_1953_合并打印版.pdf 模板一致
"""

import json
import sys
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER

PROJECT_ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = PROJECT_ROOT / 'apps' / 'web-cockpit' / 'public' / 'data'
OUTPUT_DIR = Path('/Users/luxiangnan/.openclaw/workspace/artifacts/manual/openclaw/pricelist')

# Categories to include
TARGET_CATEGORIES = ['游戏笔记本', '轻薄笔记本', '平板电脑', '手机']
CATEGORY_LABELS = {
    '游戏笔记本': ('游戏本在售价格单', '拯救者 / 斗战者'),
    '轻薄笔记本': ('轻薄本在售价格单', '小新 / YOGA / 来酷'),
    '平板电脑': ('平板在售价格单', '小新 Pad / 拯救者平板'),
    '手机': ('手机在售价格单', '联想 moto / 来酷'),
}

# Fonts
FONT_HEITI = '/System/Library/Fonts/STHeiti Medium.ttc'
FONT_HEITI_LIGHT = '/System/Library/Fonts/STHeiti Light.ttc'


def register_fonts():
    pdfmetrics.registerFont(TTFont('Heiti', FONT_HEITI))
    pdfmetrics.registerFont(TTFont('HeitiLight', FONT_HEITI_LIGHT))


def load_data():
    with open(DATA_DIR / 'latest-published-product-projection-live.json', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('items', [])


def filter_and_group(items):
    """Filter target categories with currentStock > 0, grouped by category, sorted by storeRetailPrice desc"""
    from collections import defaultdict
    grouped = defaultdict(list)
    for it in items:
        cat = it.get('category', '')
        if cat in TARGET_CATEGORIES and it.get('currentStock', 0) > 0:
            grouped[cat].append(it)
    # Sort each category by storeRetailPrice desc
    for cat in grouped:
        grouped[cat].sort(
            key=lambda x: x.get('pricing', {}).get('storeRetailPrice', 0) or 0,
            reverse=True,
        )
    return grouped


def format_price(value, decimals=0):
    if value is None or value <= 0:
        return '-'
    if decimals == 0:
        return f'¥{value:,.0f}'
    return f'¥{value:,.{decimals}f}'


def format_activity(activity, amount_field):
    if not activity:
        return '-'
    amount = activity.get('amount', 0)
    if not amount or amount <= 0:
        return '-'
    valid_from = activity.get('validFromShort', '')
    valid_to = activity.get('validToShort', '')
    countdown = activity.get('countdownDays')
    countdown_label = f'剩{countdown}天' if countdown is not None else ''
    date_range = f'{valid_from}~{valid_to}'
    return f'¥{amount:,.0f} {date_range} / {countdown_label}'


def build_page_header(cat, summary):
    """Build header table for a page"""
    title, subline = CATEGORY_LABELS[cat]
    stock = summary.get(cat, 0)

    header_data = [
        [Paragraph(f'<font name="Heiti" color="#0a3d62"><b>联想智慧零售 · A4 打印价格单</b></font> &nbsp; <font color="#888">|</font> &nbsp; <font name="Heiti" color="#c0392b"><b>{title}</b></font>',
                   ParagraphStyle('main_title', fontName='Heiti', fontSize=15, leading=20))],
        [Paragraph(f'<font color="#666">{subline} · 与广告机同色系风格 · 生成时间 {datetime.now().isoformat(timespec="seconds")}Z</font>',
                   ParagraphStyle('meta', fontName='HeitiLight', fontSize=8, leading=11))],
    ]
    t = Table(header_data, colWidths=[240 * mm])
    t.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LINEBELOW', (0, 1), (-1, 1), 0.5, colors.HexColor('#0a3d62')),
    ]))
    return t


def build_meta_summary(cat, items_list):
    """Build a meta summary line: 在售商品 X 可售库存 Y 打印规格 A4横向"""
    sku_count = len(items_list)
    total_stock = sum(it.get('currentStock', 0) for it in items_list)
    return Paragraph(
        f'在售商品 <b>{sku_count}</b> &nbsp; 可售库存 <b>{total_stock}</b> &nbsp; 打印规格 A4横向',
        ParagraphStyle('meta_summary', fontName='HeitiLight', fontSize=8, leading=10, textColor=colors.HexColor('#444'))
    )


def build_sku_row(idx, item):
    """Build a single SKU row - one product + 6 price lines"""
    p = item.get('pricing', {})
    title = item.get('displayTitle', '') or item.get('productName', '')
    spec = item.get('spec', '')

    # Build price lines with right-aligned amounts for scannability
    price_lines = []
    price_lines.append(
        f'<font color="#1a1a1a">门店零售价</font> <font name="Heiti" color="#1a1a1a"><b>{format_price(p.get("storeRetailPrice"))}</b></font>'
    )
    marketing_str = format_activity(item.get('marketingPoActivity'), 'marketingPoAmount')
    if marketing_str == '-':
        price_lines.append('<font color="#888">营销 -</font>')
    else:
        price_lines.append(f'<font color="#d35400">营销 {marketing_str}</font>')

    education_str = format_activity(item.get('educationActivity'), 'educationDiscountAmount')
    if education_str == '-':
        price_lines.append('<font color="#888">教育补 -</font>')
    else:
        price_lines.append(f'<font color="#27ae60">教育补 {education_str}</font>')

    price_lines.append(f'<font color="#1a1a1a">国补前价 {format_price(p.get("adjustedPreSubsidyPrice"))}</font>')
    # 国补后价: larger, bolder, more vibrant
    price_lines.append(
        f'<font name="Heiti" color="#c0392b" size="12"><b>国补后价 {format_price(p.get("nationalSubsidyPrice"), 2)}</b></font>'
    )

    # Two-column structure: left=title, right=prices
    title_text = title
    if spec:
        title_text = f'<font name="Heiti"><b>{title}</b></font><br/><font color="#666" size="8">· 配置 {spec}</font>'
    else:
        title_text = f'<font name="Heiti"><b>{title}</b></font>'

    # Use a table for left/right columns within each row
    content = Table(
        [[
            Paragraph(f'<font name="Heiti" color="#0a3d62" size="10"><b>{idx:02d}</b></font> &nbsp; {title_text}',
                      ParagraphStyle('sku_title', fontName='HeitiLight', fontSize=9, leading=14, leftIndent=2)),
            Paragraph('<br/>'.join(price_lines),
                      ParagraphStyle('sku_prices', fontName='HeitiLight', fontSize=8, leading=12, leftIndent=4, alignment=TA_LEFT)),
        ]],
        colWidths=[110 * mm, 130 * mm],
    )
    content.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (0, 0), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, colors.HexColor('#bbb')),
    ]))
    return content


def build_section(cat, items_list):
    """Build a full section (header + meta + SKUs) for a category"""
    elements = []
    elements.append(build_page_header(cat, {cat: sum(it.get('currentStock', 0) for it in items_list)}))
    elements.append(Spacer(1, 4 * mm))
    elements.append(build_meta_summary(cat, items_list))
    elements.append(Spacer(1, 4 * mm))
    for i, it in enumerate(items_list, 1):
        elements.append(build_sku_row(i, it))
        elements.append(Spacer(1, 2 * mm))
    # Footer
    elements.append(Spacer(1, 4 * mm))
    elements.append(Paragraph(
        '价格字段口径：广告机发布快照同步，包含门店零售价、营销、教育补、门店国补前价、国补后价。',
        ParagraphStyle('footer', fontName='HeitiLight', fontSize=7, leading=9, textColor=colors.HexColor('#888'))
    ))
    return elements


def make_doc(filename):
    doc = BaseDocTemplate(
        str(filename),
        pagesize=landscape(A4),
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title='联想智慧零售 A4 价格单',
        author='OpenClaw',
    )

    # Use a header function that draws on every page
    def draw_header(canvas, doc):
        canvas.saveState()
        # Subtle tan band
        canvas.setFillColor(colors.HexColor('#f7f3ec'))
        canvas.rect(0, doc.pagesize[1] - 8 * mm, doc.pagesize[0], 8 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor('#0a3d62'))
        canvas.setFont('Heiti', 9)
        canvas.drawString(15 * mm, doc.pagesize[1] - 5.5 * mm, '序')
        canvas.drawString(25 * mm, doc.pagesize[1] - 5.5 * mm, '产品标题与价格信息')
        # Page number on right
        canvas.setFillColor(colors.HexColor('#666'))
        canvas.setFont('HeitiLight', 8)
        page_label = f'{doc.page + 1} / {doc._pageRef if hasattr(doc, "_pageRef") else "?"}'
        canvas.drawRightString(doc.pagesize[0] - 15 * mm, doc.pagesize[1] - 5.5 * mm, f'第 {doc.page} 页')
        canvas.restoreState()

    frame = Frame(
        doc.leftMargin, doc.bottomMargin,
        doc.width, doc.height - 8 * mm,
        id='normal',
        showBoundary=0,
    )
    template = PageTemplate(id='main', frames=[frame], onPage=draw_header)
    doc.addPageTemplates([template])
    return doc


def main():
    register_fonts()
    items = load_data()
    grouped = filter_and_group(items)

    # Order: 游戏笔记本 → 轻薄笔记本 → 平板电脑 → 手机
    cats_ordered = [c for c in TARGET_CATEGORIES if c in grouped]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f'联想门店A4价格单_{datetime.now().strftime("%Y%m%d")}_v1.pdf'
    doc = make_doc(out_path)
    story = []

    from reportlab.platypus import PageBreak
    for i, cat in enumerate(cats_ordered):
        if i > 0:
            story.append(PageBreak())
        story.extend(build_section(cat, grouped[cat]))

    doc.build(story)
    print(f'✓ Generated: {out_path}')
    print(f'  Total SKUs: {sum(len(v) for v in grouped.values())}')
    for cat, items_list in grouped.items():
        print(f'  {cat}: {len(items_list)}')


if __name__ == '__main__':
    main()
