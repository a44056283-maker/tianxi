"""
本地 OCR 服务（2026-06-09）
基于 rapidocr_onnxruntime 提供 HTTP 接口
- POST /ocr/upload  - 上传图片，返回 OCR 文本
- POST /ocr/extract - 上传图片，提取教育补贴字段（订单号/客户名/手机号/金额/SN/券码）
- GET  /health      - 健康检查
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Lenovo Local OCR Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy load RapidOCR
_ocr_engine = None


def get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


# ==================== Field extraction rules ====================

PHONE_RE = re.compile(r"1[3-9]\d{9}")
ORDER_RE = re.compile(r"XS\d{10,20}", re.IGNORECASE)
VOUCHER_RE = re.compile(r"\b\d{16}\b")
SN_RE = re.compile(r"\b[A-Z0-9]{8,12}\b")


def extract_education_fields(ocr_lines: list[dict]) -> dict[str, Any]:
    """
    从 OCR 文本行中提取教育补贴采集字段。
    每行格式: { 'text': str, 'confidence': float, 'box': [...] }
    """
    full_text = "\n".join(line.get("text", "") for line in ocr_lines)

    # 客户姓名（优先从"客户姓名：XXX" 模式提取，其次取最长的纯中文 2-4 字）
    customer_name = None
    name_patterns = [
        re.compile(r"客户\s*姓名[：:\s]*([\u4e00-\u9fff·]{2,5})"),
        re.compile(r"姓名[：:\s]*([\u4e00-\u9fff·]{2,5})"),
        re.compile(r"姓\s*名[：:\s]*([\u4e00-\u9fff·]{2,5})"),
    ]
    for pat in name_patterns:
        m = pat.search(full_text)
        if m:
            candidate = m.group(1).strip()
            if not any(kw in candidate for kw in ["教育", "补贴", "优惠", "国补", "金额", "客户"]):
                customer_name = candidate
                break
    if not customer_name:
        customer_candidates = []
        for line in ocr_lines:
            text = line.get("text", "").strip()
            # 取 "：XXX" 后面的中文名
            m = re.search(r"[：:]\s*([\u4e00-\u9fff·]{2,5})", text)
            if m:
                candidate = m.group(1)
                if not any(kw in candidate for kw in ["教育", "补贴", "优惠", "国补", "金额", "客户"]):
                    customer_candidates.append((candidate, line.get("confidence", 0)))
            # 或纯中文 2-4 字
            elif 2 <= len(text) <= 5 and re.fullmatch(r"[\u4e00-\u9fff·]+", text):
                if not any(kw in text for kw in ["教育", "补贴", "优惠", "国补", "金额", "客户"]):
                    customer_candidates.append((text, line.get("confidence", 0)))
        if customer_candidates:
            customer_name = max(customer_candidates, key=lambda x: x[1])[0]

    # 订单号
    order_match = ORDER_RE.search(full_text)
    order_number = order_match.group(0) if order_match else None

    # 客户手机号（不是代扫电话的、且11位）
    phones = PHONE_RE.findall(full_text)
    # 通常第一个手机号是客户，第二个是代扫
    customer_phone = phones[0] if phones else None
    agent_phone = phones[1] if len(phones) > 1 else None

    # 教育券码（16 位数字）
    voucher_match = VOUCHER_RE.search(full_text)
    voucher_code = voucher_match.group(0) if voucher_match else None

    # 金额：查找 ¥XXX / XXX元 / XXX.XX 元 模式
    amount_pattern = re.compile(r"(?:[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?))|(?:(\d{1,6}(?:\.\d{1,2})?)\s*[元圆])")
    amounts = []
    for m in amount_pattern.finditer(full_text):
        num = m.group(1) or m.group(2)
        if num:
            try:
                amounts.append(int(float(num)))
            except ValueError:
                pass
    # 找教育补贴金额（500/300/1000/600 之类）
    edu_discount_candidates = [a for a in amounts if a in (50, 100, 200, 300, 500, 600, 1000, 1500, 2000)]
    education_discount = edu_discount_candidates[0] if edu_discount_candidates else (amounts[0] if amounts else None)
    # 找服务费
    service_fee_candidates = [a for a in amounts if a in (30, 50, 130, 150, 300)]
    service_fee = service_fee_candidates[0] if service_fee_candidates else None

    # SN（取最长的字母数字组合，但排除订单号和手机号）
    sn_candidates = []
    for line in ocr_lines:
        text = line.get("text", "").strip()
        m = SN_RE.search(text)
        if m and not ORDER_RE.search(text) and m.group(0) not in (customer_phone or '') and not PHONE_RE.search(m.group(0)):
            sn_candidates.append((m.group(0), line.get("confidence", 0)))
    serial_number = max(sn_candidates, key=lambda x: (len(x[0]), x[1]))[0] if sn_candidates else None

    # 扫法判定：基于文案关键词
    scan_type = "single_scan"
    scan_type_label = "单扫"
    if any(kw in full_text for kw in ["三件套", "青春有AI"]):
        scan_type = "three_piece"
        scan_type_label = "三件套"
    elif any(kw in full_text for kw in ["两件套", "锦鲤跃龙门"]):
        scan_type = "two_piece"
        scan_type_label = "两件套"
    elif any(kw in full_text for kw in ["双屏", "拯救者"]):
        scan_type = "legion_combo"
        scan_type_label = "拯救者双屏畅玩"

    # 智享金（套装才填）
    zhixiangjin = 0
    if scan_type == "three_piece":
        zhixiangjin = 2000
    elif scan_type == "legion_combo":
        zhixiangjin = 1000

    return {
        "customerName": customer_name,
        "customerPhone": customer_phone,
        "agentPhone": agent_phone,
        "orderNumber": order_number,
        "voucherCode": voucher_code,
        "serialNumber": serial_number,
        "educationDiscount": education_discount,
        "serviceFee": service_fee,
        "zhixiangjin": zhixiangjin,
        "scanType": scan_type,
        "scanTypeLabel": scan_type_label,
        "extractionConfidence": round(sum(line.get("confidence", 0) for line in ocr_lines) / max(len(ocr_lines), 1), 3),
    }


# ==================== Routes ====================


@app.get("/health")
def health():
    return {"status": "ok", "service": "lenovo-local-ocr", "ocrEngine": "rapidocr_onnxruntime"}


@app.post("/ocr/upload")
async def ocr_upload(file: UploadFile = File(...)):
    """上传图片，返回原始 OCR 文本行"""
    try:
        contents = await file.read()
        # Save to temp
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "img.jpg").suffix, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        ocr = get_ocr()
        result, elapse = ocr(tmp_path)

        if not result:
            return JSONResponse({
                "ok": True,
                "lines": [],
                "text": "",
                "elapse": elapse,
            })

        # result format: [[box, text, confidence], ...]
        lines = []
        full_text = []
        for item in result:
            if len(item) >= 3:
                box, text, conf = item[0], item[1], item[2]
                lines.append({
                    "text": text,
                    "confidence": float(conf),
                    "box": [[float(x), float(y)] for x, y in box] if box else [],
                })
                full_text.append(text)
        return JSONResponse({
            "ok": True,
            "lines": lines,
            "text": "\n".join(full_text),
            "elapse": elapse,
            "filename": file.filename,
        })
    except Exception as e:
        raise HTTPException(500, f"OCR 失败: {e}")


@app.post("/ocr/extract")
async def ocr_extract(file: UploadFile = File(...)):
    """上传图片，提取教育补贴采集字段"""
    try:
        contents = await file.read()
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "img.jpg").suffix, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        ocr = get_ocr()
        result, elapse = ocr(tmp_path)

        if not result:
            return JSONResponse({
                "ok": True,
                "extracted": {},
                "lines": [],
                "elapse": elapse,
                "note": "OCR 未识别到文本",
            })

        # 解析为 lines
        lines = []
        for item in result:
            if len(item) >= 3:
                box, text, conf = item[0], item[1], item[2]
                lines.append({
                    "text": text,
                    "confidence": float(conf),
                    "box": [[float(x), float(y)] for x, y in box] if box else [],
                })

        # 提取字段
        extracted = extract_education_fields(lines)
        return JSONResponse({
            "ok": True,
            "extracted": extracted,
            "lines": lines[:20],  # 只返回前 20 行（避免响应过大）
            "elapse": elapse,
        })
    except Exception as e:
        raise HTTPException(500, f"提取失败: {e}")


@app.post("/ocr/batch")
async def ocr_batch(files: list[UploadFile] = File(...)):
    """批量上传多张图片，逐张 OCR + 合并字段"""
    all_lines = []
    all_extracted = {}
    last_elapse = 0
    for f in files:
        try:
            contents = await f.read()
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=Path(f.filename or "img.jpg").suffix, delete=False) as tmp:
                tmp.write(contents)
                tmp_path = tmp.name

            ocr = get_ocr()
            result, elapse = ocr(tmp_path)
            last_elapse = elapse

            if result:
                for item in result:
                    if len(item) >= 3:
                        box, text, conf = item[0], item[1], item[2]
                        all_lines.append({
                            "text": text,
                            "confidence": float(conf),
                            "box": [[float(x), float(y)] for x, y in box] if box else [],
                            "source": f.filename,
                        })

                # 提取单张字段
                single_extracted = extract_education_fields([
                    {"text": item[1], "confidence": item[2]} for item in result if len(item) >= 3
                ])
                # 合并（不覆盖已找到的）
                for k, v in single_extracted.items():
                    if v and not all_extracted.get(k):
                        all_extracted[k] = v
        except Exception as e:
            continue

    return JSONResponse({
        "ok": True,
        "extracted": all_extracted,
        "lines": all_lines[:50],
        "elapse": last_elapse,
        "fileCount": len(files),
    })


def main():
    import uvicorn
    parser = argparse.ArgumentParser(description="Lenovo Local OCR Service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(f"OCR service starting on http://{args.host}:{args.port}")
    print("Endpoints: /health, /ocr/upload, /ocr/extract, /ocr/batch")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
