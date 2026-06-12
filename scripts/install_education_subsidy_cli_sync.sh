#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/infra/launchagents/com.lenovo-smart-retail.education-subsidy-cli-sync.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.lenovo-smart-retail.education-subsidy-cli-sync.plist"

mkdir -p "$(dirname "$PLIST_DST")"
mkdir -p "$HOME/Library/Logs/lenovo-smart-retail"

cp "$PLIST_SRC" "$PLIST_DST"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

echo "Loaded education-subsidy-cli-sync daemon"
echo "  stdout: $HOME/Library/Logs/lenovo-smart-retail/education-subsidy-cli-sync.out.log"
echo "  stderr: $HOME/Library/Logs/lenovo-smart-retail/education-subsidy-cli-sync.err.log"
echo "  app:    $HOME/Library/Logs/lenovo-smart-retail/education-subsidy-cli-sync.log"
