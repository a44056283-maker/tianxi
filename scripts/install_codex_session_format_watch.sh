#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
LAUNCH_AGENT_DIR="${HOME}/Library/LaunchAgents"
LABEL="com.lenovo-smart-retail.codex-session-format-watch"
PLIST_SOURCE="$ROOT_DIR/infra/launchagents/${LABEL}.plist"
PLIST_TARGET="$LAUNCH_AGENT_DIR/${LABEL}.plist"

mkdir -p "$LAUNCH_AGENT_DIR" "$ROOT_DIR/outputs"
chmod +x "$ROOT_DIR/scripts/codex_session_format_watchdog.sh"
cp "$PLIST_SOURCE" "$PLIST_TARGET"

launchctl bootout "gui/$(id -u)" "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

printf 'installed %s\n' "$LABEL"
launchctl print "gui/$(id -u)/$LABEL" | sed -n '1,120p'
