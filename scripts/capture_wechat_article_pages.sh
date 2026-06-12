#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANUAL_DIR="$ROOT_DIR/apps/inventory-sync/artifacts/manual"
PAGE_COUNT="${1:-4}"

mkdir -p "$MANUAL_DIR"

timestamp="$(date '+%Y%m%d_%H%M%S')"
base_dir="$MANUAL_DIR/wechat_article_${timestamp}"
mkdir -p "$base_dir"

osascript <<'APPLESCRIPT' >/dev/null
tell application "Google Chrome"
  activate
  set targetUrl to "https://localhost:3001/"
  set foundTab to false
  repeat with w in windows
    set tabIndex to 0
    repeat with t in tabs of w
      set tabIndex to tabIndex + 1
      if (URL of t as text) starts with targetUrl then
        set active tab index of w to tabIndex
        set index of w to 1
        set foundTab to true
        exit repeat
      end if
    end repeat
    if foundTab then exit repeat
  end repeat
  if not foundTab then
    if (count of windows) = 0 then make new window
    tell window 1 to make new tab with properties {URL:targetUrl}
    set active tab index of window 1 to (count of tabs of window 1)
  end if
end tell
APPLESCRIPT
sleep 0.8

for ((i=1; i<=PAGE_COUNT; i++)); do
  page="$(printf '%02d' "$i")"
  image_path="$base_dir/page-${page}.png"
  text_path="$base_dir/page-${page}.ocr.txt"
  json_path="$base_dir/page-${page}.ocr.json"

  "$ROOT_DIR/scripts/capture_wechat_window.sh" "$image_path" >/dev/null
  python3 "$ROOT_DIR/scripts/ocr_wechat_quote_image.py" "$image_path" --text-out "$text_path" --json-out "$json_path" >/dev/null

  if (( i < PAGE_COUNT )); then
    python3 - <<'PY'
import subprocess
import time
import pyautogui
import re

subprocess.run(['osascript', '-e', 'tell application "Google Chrome" to activate'], check=True)
time.sleep(0.2)
out = subprocess.check_output([
    'osascript',
    '-e',
    'tell application "System Events" to tell process "Google Chrome" to get {position, size} of window 1',
], text=True).strip()
nums = [int(x) for x in re.findall(r'\d+', out)]
x, y, w, h = nums
pyautogui.click(x + int(w * 0.5), y + int(h * 0.45))
time.sleep(0.15)
pyautogui.scroll(-900)
time.sleep(0.6)
PY
  fi
done

printf '%s\n' "$base_dir"
