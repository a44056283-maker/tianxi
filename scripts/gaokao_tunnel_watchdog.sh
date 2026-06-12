#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
TUNNEL_NAME="gaokao2026-main"
PUBLIC_URL="https://gaokao2026.tianlu2026.org/"
SUMMARY_URL="https://gaokao2026.tianlu2026.org/api/marketing/gaokao-2026/summary"
LOCAL_GATEWAY_URL="http://127.0.0.1:19518/"
LOCAL_SUMMARY_URL="http://127.0.0.1:8010/api/marketing/gaokao-2026/summary"
TUNNEL_LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.tianlu.gaokao2026-main-tunnel.plist"
GATEWAY_LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.tianlu.gaokao-gateway.plist"
API_LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.tianlu.gaokao-api-server.plist"
LOG_DIR="$PROJECT_ROOT/outputs/gaokao-tunnel-watchdog"
mkdir -p "$LOG_DIR"
RUN_TS="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="$LOG_DIR/$RUN_TS.log"

exec > >(tee -a "$LOG_FILE") 2>&1

now() {
  date '+%Y-%m-%d %H:%M:%S'
}

info() {
  printf '[%s] %s\n' "$(now)" "$*"
}

http_status() {
  local url="$1"
  curl -sS -o /dev/null -m 8 -w '%{http_code}' "$url" || true
}

restart_launch_agent() {
  local plist="$1"
  local label="$2"
  info "重启 LaunchAgent: $label"
  launchctl unload "$plist" 2>/dev/null || true
  sleep 1
  launchctl load "$plist"
}

connector_count() {
  /Users/luxiangnan/.local/bin/cloudflared tunnel info "$TUNNEL_NAME" 2>/dev/null | awk '/CONNECTOR ID/{flag=1; next} flag && NF {count++} END {print count+0}'
}

public_healthy() {
  local root_code summary_code
  root_code="$(http_status "$PUBLIC_URL")"
  summary_code="$(http_status "$SUMMARY_URL")"
  info "公网检查: root=$root_code summary=$summary_code"
  [[ "$root_code" == "200" && "$summary_code" == "200" ]]
}

local_healthy() {
  local gateway_code summary_code
  gateway_code="$(http_status "$LOCAL_GATEWAY_URL")"
  summary_code="$(http_status "$LOCAL_SUMMARY_URL")"
  info "本地检查: gateway=$gateway_code summary=$summary_code"
  [[ "$gateway_code" == "200" && "$summary_code" == "200" ]]
}

verify_or_fail() {
  local connectors
  connectors="$(connector_count)"
  info "当前 active connectors: $connectors"
  if public_healthy; then
    info "watchdog 结果: 已健康"
    return 0
  fi
  info "watchdog 结果: 仍异常"
  return 1
}

main() {
  info "开始高考 tunnel watchdog"
  if ! local_healthy; then
    restart_launch_agent "$API_LAUNCH_AGENT" "gaokao-api-server"
    sleep 2
    restart_launch_agent "$GATEWAY_LAUNCH_AGENT" "gaokao-gateway"
    sleep 3
  fi

  local connectors
  connectors="$(connector_count)"
  info "初始 active connectors: $connectors"

  if [[ "$connectors" -lt 1 ]] || ! public_healthy; then
    restart_launch_agent "$TUNNEL_LAUNCH_AGENT" "gaokao2026-main-tunnel"
    sleep 6
  fi

  if verify_or_fail; then
    exit 0
  fi

  info "二次尝试重启 tunnel"
  restart_launch_agent "$TUNNEL_LAUNCH_AGENT" "gaokao2026-main-tunnel"
  sleep 8
  verify_or_fail
}

main "$@"
