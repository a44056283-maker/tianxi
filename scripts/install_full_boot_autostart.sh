#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LOCAL_BIN="$HOME/.local/bin"
LOG_DIR="$HOME/Library/Logs/lenovo-smart-retail"

mkdir -p "$LAUNCH_AGENT_DIR" "$LOCAL_BIN" "$LOG_DIR"

install_agent() {
  local label="$1"
  local plist_source="$ROOT_DIR/infra/launchagents/${label}.plist"
  local plist_target="$LAUNCH_AGENT_DIR/${label}.plist"
  cp "$plist_source" "$plist_target"
  launchctl bootout "gui/$(id -u)" "$plist_target" >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist_target"
  launchctl enable "gui/$(id -u)/$label"
  launchctl kickstart -k "gui/$(id -u)/$label"
}

cp "$ROOT_DIR/scripts/start_api_server.sh" "$LOCAL_BIN/start-lenovo-smart-retail-api.sh"
cp "$ROOT_DIR/apps/web-cockpit/scripts/start-web-cockpit.sh" "$LOCAL_BIN/start-lenovo-smart-retail-web.sh"
cp "$ROOT_DIR/scripts/start_scheduled_task_runner.sh" "$LOCAL_BIN/start-lenovo-smart-retail-scheduled-runner.sh"
cp "$ROOT_DIR/scripts/start_zdt_data_stack.sh" "$LOCAL_BIN/start-lenovo-smart-retail-zdt-data-stack.sh"
cp "$ROOT_DIR/scripts/start_zdt_cli_sync.sh" "$LOCAL_BIN/start-lenovo-smart-retail-zdt-cli-sync.sh"
chmod +x "$LOCAL_BIN/start-lenovo-smart-retail-api.sh" \
  "$LOCAL_BIN/start-lenovo-smart-retail-web.sh" \
  "$LOCAL_BIN/start-lenovo-smart-retail-scheduled-runner.sh" \
  "$LOCAL_BIN/start-lenovo-smart-retail-zdt-data-stack.sh" \
  "$LOCAL_BIN/start-lenovo-smart-retail-zdt-cli-sync.sh"

install_agent "com.lenovo-smart-retail.zdt-data-stack"
install_agent "com.lenovo-smart-retail.api-server"
install_agent "com.lenovo-smart-retail.web-cockpit"
install_agent "com.lenovo-smart-retail.scheduled-task-runner"
install_agent "com.lenovo-smart-retail.zdt-cli-sync"

echo "installed and kicked all boot services:"
launchctl list | rg "com.lenovo-smart-retail.(zdt-data-stack|api-server|web-cockpit|scheduled-task-runner|zdt-cli-sync)" || true
