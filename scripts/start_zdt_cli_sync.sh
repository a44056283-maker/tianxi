#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/智店通采集CLI软件/zdt_sync_openclaw_starter"
SCRIPT_DIR="$ROOT_DIR/scripts"
ZDT_STACK_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/zdt-sync"
LOG_DIR="$HOME/Library/Logs/lenovo-smart-retail"
LOG_FILE="$LOG_DIR/zdt-cli-sync.log"

mkdir -p "$LOG_DIR"

if [[ ! -f "$SCRIPT_DIR/zdt_auto_sync.py" ]]; then
  printf '[%s] missing script: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SCRIPT_DIR/zdt_auto_sync.py" >> "$LOG_FILE"
  exit 0
fi

printf '[%s] start zdt cli sync\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
cd "$ROOT_DIR"
run_entity() {
  local entity="$1"
  printf '[%s] run entity=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$entity" >> "$LOG_FILE"
  python3 "$SCRIPT_DIR/zdt_auto_sync.py" -e "$entity" -t ".auth/token.json" >> "$LOG_FILE" 2>&1 || true
}

run_entity inventory
run_entity stock_order
run_entity sn_stock_order
run_entity order
run_entity order_online
run_entity order_refunds_offline
run_entity order_refunds_online
run_entity other_inout
python3 "$SCRIPT_DIR/sync_missing_line_entities.py" >> "$LOG_FILE" 2>&1 || true

if [[ -f "$ZDT_STACK_DIR/scripts/incremental_sync.py" ]]; then
  printf '[%s] run incremental inventory sync\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
  python3 "$ZDT_STACK_DIR/scripts/incremental_sync.py" >> "$LOG_FILE" 2>&1 || true
fi

printf '[%s] done zdt cli sync\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
