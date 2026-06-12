#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_NAME="${1:-}"
LOCK_DIR="$ROOT_DIR/.scheduled-task.lock"
CPU_MAX_PERCENT="${CODEX_CPU_MAX_PERCENT:-75}"
POST_SYNC_TIMEOUT_SECONDS="${POST_SYNC_TIMEOUT_SECONDS:-120}"
RSYNC_TIMEOUT_SECONDS="${RSYNC_TIMEOUT_SECONDS:-45}"
LOCK_WAIT_SECONDS="${SCHEDULED_TASK_LOCK_WAIT_SECONDS:-1800}"
LOCK_POLL_SECONDS="${SCHEDULED_TASK_LOCK_POLL_SECONDS:-10}"

run_cli() {
  local cmd_desc="$1"
  shift
  if "$@"; then
    return 0
  fi
  return $?
}

run_with_fallback() {
  local primary_status=0
  local primary_output=""

  set +e
  primary_output="$(
    cd "$ROOT_DIR/apps/inventory-sync" && \
    nice -n 10 npm run run:scheduled-task -- "$TASK_NAME" 2>&1
  )"
  primary_status=$?
  set -e

  if [[ $primary_status -eq 0 ]]; then
    printf '%s\n' "$primary_output"
    return 0
  fi

  printf '%s\n' "$primary_output" >&2

  if [[ "$primary_output" == *"listen EPERM"* ]] || [[ "$primary_output" == *"tsx"* ]]; then
    echo "Primary scheduled-task entry failed, switching to node --import tsx/esm fallback for task=$TASK_NAME" >&2
    (
      cd "$ROOT_DIR/apps/inventory-sync"
      nice -n 10 node --import tsx/esm src/cli.ts run-scheduled-task "$TASK_NAME"
    )
    return $?
  fi

  return $primary_status
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  local pid=0
  local elapsed=0

  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout_seconds )); then
      echo "timeout: command exceeded ${timeout_seconds}s: $*" >&2
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

refresh_product_library_frontend_snapshots() {
  case "$TASK_NAME" in
    zhidiantong-sync-cycle|daily-audit-and-snapshot-rebuild)
      ;;
    *)
      return 0
      ;;
  esac

  if ! run_with_timeout "$POST_SYNC_TIMEOUT_SECONDS" python3 "$ROOT_DIR/scripts/refresh_frontend_snapshots.py"; then
    echo "warn: post-sync snapshot refresh timed out or failed; continue without blocking scheduler" >&2
    return 0
  fi

  mkdir -p "$ROOT_DIR/apps/web-cockpit/dist/data"
  if ! run_with_timeout "$RSYNC_TIMEOUT_SECONDS" rsync -a --delete "$ROOT_DIR/apps/web-cockpit/public/data/" "$ROOT_DIR/apps/web-cockpit/dist/data/"; then
    echo "warn: dist/data rsync timed out or failed; continue without blocking scheduler" >&2
    return 0
  fi
  echo "Dist frontend data refreshed from public/data"
}

run_terminal_price_consistency_audit() {
  case "$TASK_NAME" in
    daily-jd-lenovo-price-sync|daily-audit-and-snapshot-rebuild)
      ;;
    *)
      return 0
      ;;
  esac

  PYTHONPATH="$ROOT_DIR/apps/api-server" python3 - <<'PY'
from pathlib import Path
from app import product_library

data_dir = Path("apps/web-cockpit/public/data").resolve()
product_library.write_published_product_projection_snapshots(data_dir)
PY
  python3 "$ROOT_DIR/scripts/audit_terminal_price_consistency.py"
  python3 "$ROOT_DIR/scripts/audit_terminal_title_consistency.py"
}

get_total_cpu_percent() {
  local logical_cpu total_cpu
  logical_cpu="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 1)"
  total_cpu="$(ps -A -o %cpu= | awk '{sum += $1} END {printf "%.2f", sum}')"
  awk -v total="$total_cpu" -v cores="$logical_cpu" 'BEGIN {
    if (cores <= 0) cores = 1
    printf "%.2f", total / cores
  }'
}

if [[ -z "$TASK_NAME" ]]; then
  echo "Usage: bash scripts/run_scheduled_task.sh <task-name>" >&2
  exit 1
fi

LOCK_WAITED_SECONDS=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if (( LOCK_WAITED_SECONDS >= LOCK_WAIT_SECONDS )); then
    echo "Another scheduled task is still running after ${LOCK_WAIT_SECONDS}s: $LOCK_DIR" >&2
    exit 75
  fi
  echo "Scheduled task queued behind active task: task=${TASK_NAME} waited=${LOCK_WAITED_SECONDS}s lock=${LOCK_DIR}" >&2
  sleep "$LOCK_POLL_SECONDS"
  LOCK_WAITED_SECONDS=$((LOCK_WAITED_SECONDS + LOCK_POLL_SECONDS))
done
trap 'rmdir "$LOCK_DIR"' EXIT

CURRENT_CPU_PERCENT="$(get_total_cpu_percent)"
if awk -v current="$CURRENT_CPU_PERCENT" -v max="$CPU_MAX_PERCENT" 'BEGIN { exit !(current >= max) }'; then
  echo "CPU guard blocked scheduled task: current=${CURRENT_CPU_PERCENT}% threshold=${CPU_MAX_PERCENT}% task=${TASK_NAME}" >&2
  exit 69
fi

cd "$ROOT_DIR/apps/inventory-sync"
run_with_fallback
refresh_product_library_frontend_snapshots
run_terminal_price_consistency_audit
python3 "$ROOT_DIR/scripts/protect_real_records.py" >/tmp/protect-real-records.log 2>&1 || {
  echo "warn: protect_real_records failed, skipped"
  cat /tmp/protect-real-records.log >&2 || true
}
if [[ "${LENOVO_EXTERNAL_BACKUP_ENABLE:-1}" == "1" ]]; then
  bash "$ROOT_DIR/scripts/offload_collection_to_external.sh" || echo "warn: external offload failed, skipped"
fi
