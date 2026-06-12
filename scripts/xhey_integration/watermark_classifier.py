"""水印关键词 →凭证分类.

分类规则:
 教育补/代扫 → education_subsidy
库存流水/出库/入库 → inventory_movement
销售/收银 → sales_order
采购/进货 → purchase_order
其它 → unknown
"""
import re
from dataclasses import dataclass, field


CATEGORY_KEYWORDS = {
 "education_subsidy": ["教育补", "教育补贴", "代扫", "国补", "以旧换新"],
 "inventory_movement": ["库存流水", "出库", "入库", "调拨", "盘点"],
 "sales_order": ["销售", "收银", "成交", "订单"],
 "purchase_order": ["采购", "进货", "到货"],
}


@dataclass
class Classification:
 category: str
 matched_keyword: str = ""
 confidence: float =0.0
 extracted: dict = field(default_factory=dict)


def _extract_fields(text):
 result = {}
 sns = re.findall(r"\b(BH[A-Z0-9]{5,10})\b", text)
 if sns: result["serial_numbers"] = sns
 orders = re.findall(r"(XS\d{10,})", text)
 if orders: result["order_number"] = orders[0]
 amounts = re.findall(r"[¥￥]\s*(\d+(?:\.\d+)?)", text)
 if amounts: result["amount"] = amounts[0]
 cust = re.search(r"客户[:：\s]*([^\s]+)", text)
 if cust: result["customer_name"] = cust.group(1)
 return result


def classify(watermark_text):
 if not watermark_text: return Classification(category="unknown", confidence=0.0)
 pairs = [(category, kw) for category, kws in CATEGORY_KEYWORDS.items() for kw in kws]
 matched = [(cat, kw) for cat, kw in pairs if kw in watermark_text]
 matched.sort(key=lambda x: -len(x[1]))
 if not matched: return Classification(category="unknown", confidence=0.0)
 cat, kw = matched[0]
 return Classification(category=cat, matched_keyword=kw, confidence=min(len(kw) /4.0,1.0), extracted=_extract_fields(watermark_text))


def main():
 tests = ["我是梁伟 教育补凭证 单扫订单XS26060900012345客户张三 SN:BH022VR7", "我是李建定 教育补凭证 三件套 SN:BH022VR8 BH022VR9 BH023AA1", "我是郭晨臣库存流水 出库 SN:BH023AA2数量3", "采购入库 商品SKU20003365数量5 单价4999元", "客户现场销售订单XS26061000099999 ¥8888", "我是员工早安 (无关键词)"]
 out_lines = []
 for t in tests: out_lines.append("\n".join(["text: " + t[:80], " → category=" + classify(t).category + " kw=" + classify(t).matched_keyword + " conf=" + ("%.2f" % classify(t).confidence), " extracted: " + str(classify(t).extracted)]))
 print("\n".join(out_lines))


if __name__ == "__main__":
 main()
