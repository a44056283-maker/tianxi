#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
BIN_DIR="$HOME/.local/bin"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/lenovo-smart-retail"
WRAPPER_PATH="$BIN_DIR/start-lenovo-smart-retail-scheduled-runner.sh"
PLIST_SOURCE="$ROOT_DIR/infra/launchagents/com.lenovo-smart-retail.scheduled-task-runner.plist"
PLIST_TARGET="$LAUNCH_AGENT_DIR/com.lenovo-smart-retail.scheduled-task-runner.plist"

mkdir -p "$BIN_DIR" "$LAUNCH_AGENT_DIR" "$LOG_DIR"

cat >"$WRAPPER_PATH" <<'EOF'
#!/bin/zsh
set -euo pipefail
export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
exec /Users/luxiangnan/.local/share/lenovo-smart-retail-api-runtime/bin/python \
  "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/scripts/scheduled_task_runner.py"
EOF

chmod +x "$WRAPPER_PATH"
cp "$PLIST_SOURCE" "$PLIST_TARGET"
launchctl bootout "gui/$(id -u)" "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
echo "Installed and started: com.lenovo-smart-retail.scheduled-task-runner"
