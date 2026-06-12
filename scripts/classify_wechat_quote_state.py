#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def run_capture() -> Path:
    root = Path(__file__).resolve().parents[1]
    cmd = [str(root / "scripts" / "capture_wechat_window.sh")]
    output = subprocess.check_output(cmd, text=True).strip()
    return Path(output)


def run_ocr(image_path: Path) -> tuple[Path, str]:
    root = Path(__file__).resolve().parents[1]
    text_path = image_path.with_suffix(".state.ocr.txt")
    cmd = [
        "python3",
        str(root / "scripts" / "ocr_wechat_quote_image.py"),
        str(image_path),
        "--text-out",
        str(text_path),
    ]
    text = subprocess.check_output(cmd, text=True)
    return text_path, text


def classify(text: str) -> dict:
    normalized = re.sub(r"\s+", "", text)
    dated_quote_shortcut = bool(
        re.search(r"(报价|电脑报价).{0,12}(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}|\d{1,2}[月./-]\d{1,2})", normalized)
        or re.search(r"(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}|\d{1,2}[月./-]\d{1,2}).{0,12}(报价|电脑报价)", normalized)
    )

    if "文件传输助手" in normalized and "公众号名片" in normalized and "郑州市创业" in normalized:
        return {
            "state": "file_transfer_card",
            "nextAction": "click_official_account_card",
            "confidence": "high",
        }
    if "已关注" in normalized and "全部" in normalized and "文章" in normalized and "郑州市创业" in normalized:
        return {
            "state": "official_account_home",
            "nextAction": "click_bottom_dated_quote_shortcut",
            "confidence": "high",
            "datedQuoteShortcutDetected": dated_quote_shortcut,
        }
    if "郑州市创业" in normalized and dated_quote_shortcut:
        return {
            "state": "dated_quote_shortcut_visible",
            "nextAction": "click_bottom_dated_quote_shortcut",
            "confidence": "high",
            "datedQuoteShortcutDetected": True,
        }
    if "电脑报价" in normalized and ("听全文" in normalized or "写留言" in normalized):
        masked = bool(re.search(r"\d\*{1,3}\d", normalized))
        return {
            "state": "official_article",
            "nextAction": "capture_or_scroll_article",
            "confidence": "high",
            "maskedPriceDetected": masked,
        }
    if "登录" in normalized or "手机上完成登录" in normalized:
        return {
            "state": "login_blocked",
            "nextAction": "stop_and_wait_for_manual_login",
            "confidence": "high",
        }
    return {
        "state": "unknown",
        "nextAction": "manual_review_before_click",
        "confidence": "low",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Capture Chrome web WeChat at https://localhost:3001, OCR it, and classify the current quote-collection state."
    )
    parser.add_argument("--image", help="Optional existing image path. If omitted, capture Chrome web WeChat at https://localhost:3001.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    image_path = Path(args.image).expanduser().resolve() if args.image else run_capture()
    text_path, text = run_ocr(image_path)
    result = classify(text)
    payload = {
        "imagePath": str(image_path),
        "textPath": str(text_path),
        "lineCount": len([line for line in text.splitlines() if line.strip()]),
        **result,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
