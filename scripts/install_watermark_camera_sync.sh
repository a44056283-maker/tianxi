#!/usr/bin/env bash
# 安装今日水印相机VIP同步守护进程
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/infra/launchagents/com.lenovo-smart-retail.watermark-camera-sync.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.lenovo-smart-retail.watermark-camera-sync.plist"

echo "Installing $PLIST_SRC → $PLIST_DST"
mkdir -p "$(dirname "$PLIST_DST")"
mkdir -p "$HOME/Library/Logs/lenovo-smart-retail"

cp "$PLIST_SRC" "$PLIST_DST"

# Unload if already loaded
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Load
launchctl load -w "$PLIST_DST"
echo "Loaded watermark-camera-sync daemon"
echo
echo "日志路径："
echo "  stdout: $HOME/Library/Logs/lenovo-smart-retail/watermark-camera-sync.out.log"
echo "  stderr: $HOME/Library/Logs/lenovo-smart-retail/watermark-camera-sync.err.log"
echo "  app:    $HOME/Library/Logs/lenovo-smart-retail/watermark-camera-sync.log"
echo
echo "手动运行："
echo "  python3 $ROOT_DIR/scripts/watermark_camera_sync.py --once"
echo "  python3 $ROOT_DIR/scripts/watermark_camera_sync.py --dry-run --once"
echo
echo "状态查看："
echo "  launchctl list | grep watermark-camera-sync"
