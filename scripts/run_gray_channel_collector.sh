#!/usr/bin/env bash
#
# 灰渠公众号报价采集脚本
# 用法:
#   bash scripts/run_gray_channel_collector.sh           # 手动执行
#   bash scripts/run_gray_channel_collector.sh --cron    # 定时任务模式
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY_SYNC_DIR="$ROOT_DIR/apps/inventory-sync"
LOCK_FILE="$ROOT_DIR/.gray-channel-collector.lock"
LOG_FILE="$ROOT_DIR/logs/gray-channel-collector.log"

# 创建日志目录
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# 检查是否在定时任务模式
IS_CRON=false
if [[ "${1:-}" == "--cron" ]]; then
  IS_CRON=true
fi

# 检查是否有其他实例在运行
if [[ -f "$LOCK_FILE" ]]; then
  PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if kill -0 "$PID" 2>/dev/null; then
    log "⚠️  另一个实例正在运行 (PID: $PID)"
    exit 75
  else
    log "🧹  清理旧的锁文件"
    rm -f "$LOCK_FILE"
  fi
fi

# 创建锁文件
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "🚀 开始执行灰渠公众号报价采集"
log "   模式: $(if $IS_CRON; then echo '定时任务'; else echo '手动执行'; fi)"

# 检查是否有手动文本文件
TODAY=$(date '+%Y-%m-%d')
MANUAL_FILE="$INVENTORY_SYNC_DIR/artifacts/manual/gray-wholesale-$TODAY.txt"
MANUAL_FILE_ALT="$INVENTORY_SYNC_DIR/artifacts/manual/gray-wholesale-$TODAY.md"

if [[ -f "$MANUAL_FILE" ]]; then
  log "📄 发现手动文本文件: $MANUAL_FILE"
  cd "$INVENTORY_SYNC_DIR"
  npm run collect-gray-channel -- "$MANUAL_FILE"
elif [[ -f "$MANUAL_FILE_ALT" ]]; then
  log "📄 发现手动文本文件: $MANUAL_FILE_ALT"
  cd "$INVENTORY_SYNC_DIR"
  npm run collect-gray-channel -- "$MANUAL_FILE_ALT"
else
  log "⚠️  未找到当天手动文本文件。"
  log "   固定入口: Chrome 已登录的 https://localhost:3001/ 网页微信"
  log "   禁止入口: 微信桌面版、browser-use 新浏览器、无头采集"
  log "💡 请从网页微信保存当天公众号原文到以下位置之一:"
  log "   - $MANUAL_FILE"
  log "   - $MANUAL_FILE_ALT"
  log "   然后重新执行本脚本"

  cd "$INVENTORY_SYNC_DIR"
  npm run run:scheduled-task -- daily-gray-channel-check
fi

log "✅ 灰渠公众号报价采集任务完成"
