#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/lenovo-smart-retail"
LOG_FILE="$LOG_DIR/education-subsidy-cli-sync.log"

mkdir -p "$LOG_DIR"

{
  printf '[%s] start education subsidy cli sync\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  cd "$ROOT_DIR"
  python3 "$ROOT_DIR/scripts/run_education_subsidy_cli_sync.py"
  printf '[%s] done education subsidy cli sync\n' "$(date '+%Y-%m-%d %H:%M:%S')"
} >> "$LOG_FILE" 2>&1
