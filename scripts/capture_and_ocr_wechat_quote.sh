#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANUAL_DIR="$ROOT_DIR/apps/inventory-sync/artifacts/manual"

mkdir -p "$MANUAL_DIR"

timestamp="$(date '+%Y%m%d_%H%M%S')"
image_path="$MANUAL_DIR/wechat_quote_${timestamp}.png"
text_path="$MANUAL_DIR/wechat_quote_${timestamp}.ocr.txt"
json_path="$MANUAL_DIR/wechat_quote_${timestamp}.ocr.json"

"$ROOT_DIR/scripts/capture_wechat_window.sh" "$image_path" >/dev/null
python3 "$ROOT_DIR/scripts/ocr_wechat_quote_image.py" "$image_path" --text-out "$text_path" --json-out "$json_path" >/dev/null

printf 'image=%s\ntext=%s\njson=%s\n' "$image_path" "$text_path" "$json_path"
