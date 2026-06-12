#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANUAL_DIR="$ROOT_DIR/apps/inventory-sync/artifacts/manual"
WEB_WECHAT_URL="${WEB_WECHAT_URL:-https://localhost:3001/}"
CHROME_APP_NAME="${CHROME_APP_NAME:-Google Chrome}"

mkdir -p "$MANUAL_DIR"

timestamp="$(date '+%Y%m%d_%H%M%S')"
output_path="${1:-$MANUAL_DIR/web_wechat_capture_${timestamp}.png}"

osascript <<APPLESCRIPT >/dev/null
tell application "$CHROME_APP_NAME"
  activate
  set targetUrl to "$WEB_WECHAT_URL"
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

bounds="$(osascript -e 'tell application "System Events" to tell process "'"$CHROME_APP_NAME"'" to get {position, size} of window 1' | tr -d "\n")"
if [[ -z "$bounds" ]]; then
  echo "未能读取 Chrome 网页微信窗口位置" >&2
  exit 3
fi

IFS=',' read -r x y w h <<<"$bounds"
x="$(echo "$x" | xargs)"
y="$(echo "$y" | xargs)"
w="$(echo "$w" | xargs)"
h="$(echo "$h" | xargs)"

if [[ -z "$x" || -z "$y" || -z "$w" || -z "$h" ]]; then
  echo "Chrome 网页微信窗口 bounds 非法: $bounds" >&2
  exit 4
fi

/usr/sbin/screencapture -x -R"${x},${y},${w},${h}" "$output_path"

printf '%s\n' "$output_path"
