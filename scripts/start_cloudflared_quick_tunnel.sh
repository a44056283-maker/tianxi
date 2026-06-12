#!/usr/bin/env bash

set -euo pipefail

TARGET_URL="${1:-http://127.0.0.1:5174}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared 未安装。请先把 cloudflared 放到 PATH 中。"
  exit 1
fi

echo "启动 Cloudflare quick tunnel -> ${TARGET_URL}"
echo "按 Ctrl+C 可停止。"

exec cloudflared tunnel --url "${TARGET_URL}"
