#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
LAUNCH_AGENT_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/lenovo-smart-retail"
LOCAL_BIN="${HOME}/.local/bin"
LABEL="com.lenovo-smart-retail.web-cockpit"
PLIST_SOURCE="$ROOT_DIR/infra/launchagents/${LABEL}.plist"
PLIST_TARGET="$LAUNCH_AGENT_DIR/${LABEL}.plist"
SCRIPT_SOURCE="$ROOT_DIR/apps/web-cockpit/scripts/start-web-cockpit.sh"
SCRIPT_TARGET="$LOCAL_BIN/start-lenovo-smart-retail-web.sh"

mkdir -p "$LAUNCH_AGENT_DIR" "$LOG_DIR" "$LOCAL_BIN"
cp "$SCRIPT_SOURCE" "$SCRIPT_TARGET"
chmod +x "$SCRIPT_TARGET"
cp "$PLIST_SOURCE" "$PLIST_TARGET"

launchctl bootout "gui/$(id -u)" "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

printf 'installed %s\n' "$LABEL"
launchctl print "gui/$(id -u)/$LABEL" | sed -n '1,80p'
