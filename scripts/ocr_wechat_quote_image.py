#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="OCR a Chrome web WeChat quote screenshot into plain text and structured JSON."
    )
    parser.add_argument("image", help="Absolute or relative path to the source image")
    parser.add_argument(
        "--text-out",
        dest="text_out",
        help="Optional path to write normalized plain text output",
    )
    parser.add_argument(
        "--json-out",
        dest="json_out",
        help="Optional path to write raw OCR line results as JSON",
    )
    return parser


def normalize_lines(result: list[list]) -> list[dict]:
    normalized = []
    for item in result:
        box, text, score = item
        points = box if isinstance(box, list) else []
        y = min((point[1] for point in points), default=0)
        x = min((point[0] for point in points), default=0)
        normalized.append(
            {
                "text": str(text).strip(),
                "score": float(score),
                "box": points,
                "top": y,
                "left": x,
            }
        )
    normalized.sort(key=lambda item: (item["top"], item["left"]))
    return [item for item in normalized if item["text"]]


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    image_path = Path(args.image).expanduser().resolve()
    if not image_path.is_file():
      print(f"image not found: {image_path}", file=sys.stderr)
      return 2

    engine = RapidOCR()
    result, _ = engine(str(image_path))
    records = normalize_lines(result or [])
    text_output = "\n".join(record["text"] for record in records)

    if args.text_out:
        text_path = Path(args.text_out).expanduser().resolve()
        text_path.parent.mkdir(parents=True, exist_ok=True)
        text_path.write_text(text_output, encoding="utf-8")

    if args.json_out:
        json_path = Path(args.json_out).expanduser().resolve()
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(
            json.dumps(
                {
                    "imagePath": str(image_path),
                    "lineCount": len(records),
                    "lines": records,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    print(text_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
