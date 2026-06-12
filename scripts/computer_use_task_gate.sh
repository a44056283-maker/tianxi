#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.automation-runtime"
ACTIVE_FILE="$STATE_DIR/computer-use-active.json"
QUEUE_FILE="$STATE_DIR/computer-use-queue.json"
CPU_MAX_PERCENT="${CODEX_CPU_MAX_PERCENT:-60}"
ACTIVE_TTL_SECONDS="${CODEX_COMPUTER_USE_TTL_SECONDS:-5400}"
WAIT_TIMEOUT_SECONDS="${CODEX_COMPUTER_USE_WAIT_TIMEOUT_SECONDS:-7200}"
WAIT_POLL_SECONDS="${CODEX_COMPUTER_USE_WAIT_POLL_SECONDS:-60}"

mkdir -p "$STATE_DIR"

get_total_cpu_percent() {
  local logical_cpu total_cpu
  logical_cpu="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 1)"
  total_cpu="$(ps -A -o %cpu= | awk '{sum += $1} END {printf "%.2f", sum}')"
  awk -v total="$total_cpu" -v cores="$logical_cpu" 'BEGIN {
    if (cores <= 0) cores = 1
    printf "%.2f", total / cores
  }'
}

ensure_queue_file() {
  [[ -f "$QUEUE_FILE" ]] || printf '[]\n' > "$QUEUE_FILE"
}

cleanup_stale_active() {
  [[ -f "$ACTIVE_FILE" ]] || return 0
  python3 - "$ACTIVE_FILE" "$ACTIVE_TTL_SECONDS" <<'PY'
import json, os, sys, time
path = sys.argv[1]
ttl = int(sys.argv[2])
try:
    data = json.load(open(path, 'r', encoding='utf-8'))
except Exception:
    os.remove(path)
    sys.exit(0)
acquired = data.get('acquiredAtEpoch')
if not isinstance(acquired, (int, float)):
    os.remove(path)
    sys.exit(0)
if time.time() - acquired > ttl:
    os.remove(path)
PY
}

enqueue_task() {
  local task_id="$1"
  local priority="$2"
  local label="$3"
  local reason="$4"
  ensure_queue_file
  python3 - "$QUEUE_FILE" "$task_id" "$priority" "$label" "$reason" <<'PY'
import json, sys, time
path, task_id, priority, label, reason = sys.argv[1:]
priority = int(priority)
try:
    items = json.load(open(path, 'r', encoding='utf-8'))
except Exception:
    items = []
items = [item for item in items if item.get('taskId') != task_id]
items.append({
    'taskId': task_id,
    'priority': priority,
    'label': label,
    'reason': reason,
    'queuedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'queuedAtEpoch': time.time(),
})
items.sort(key=lambda item: (-int(item.get('priority', 0)), float(item.get('queuedAtEpoch', 0))))
with open(path, 'w', encoding='utf-8') as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps({'queued': True, 'taskId': task_id, 'priority': priority, 'reason': reason}, ensure_ascii=False))
PY
}

remove_from_queue() {
  local task_id="$1"
  ensure_queue_file
  python3 - "$QUEUE_FILE" "$task_id" <<'PY'
import json, sys
path, task_id = sys.argv[1:]
try:
    items = json.load(open(path, 'r', encoding='utf-8'))
except Exception:
    items = []
items = [item for item in items if item.get('taskId') != task_id]
with open(path, 'w', encoding='utf-8') as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
}

show_status() {
  cleanup_stale_active
  ensure_queue_file
  local cpu
  cpu="$(get_total_cpu_percent)"
  python3 - "$ACTIVE_FILE" "$QUEUE_FILE" "$cpu" "$CPU_MAX_PERCENT" <<'PY'
import json, os, sys
active_path, queue_path, cpu, limit = sys.argv[1:]
active = None
if os.path.exists(active_path):
    try:
        active = json.load(open(active_path, 'r', encoding='utf-8'))
    except Exception:
        active = {'invalid': True}
try:
    queue = json.load(open(queue_path, 'r', encoding='utf-8'))
except Exception:
    queue = []
print(json.dumps({
    'cpuPercent': float(cpu),
    'cpuLimitPercent': float(limit),
    'active': active,
    'queueLength': len(queue),
    'queue': queue[:10],
}, ensure_ascii=False, indent=2))
PY
}

COMMAND="${1:-}"

case "$COMMAND" in
  acquire)
    TASK_ID="${2:-}"
    PRIORITY="${3:-}"
    LABEL="${4:-$TASK_ID}"
    if [[ -z "$TASK_ID" || -z "$PRIORITY" ]]; then
      echo "Usage: bash scripts/computer_use_task_gate.sh acquire <task-id> <priority> [label]" >&2
      exit 1
    fi
    cleanup_stale_active
    if [[ -f "$ACTIVE_FILE" ]]; then
      ACTIVE_TASK_ID="$(python3 - "$ACTIVE_FILE" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], 'r', encoding='utf-8')).get('taskId', 'unknown'))
PY
)"
      enqueue_task "$TASK_ID" "$PRIORITY" "$LABEL" "active_slot_held_by:${ACTIVE_TASK_ID}" >/dev/null
      echo "DEFERRED: active computer-use slot held by ${ACTIVE_TASK_ID}" >&2
      exit 70
    fi
    CURRENT_CPU_PERCENT="$(get_total_cpu_percent)"
    if awk -v current="$CURRENT_CPU_PERCENT" -v max="$CPU_MAX_PERCENT" 'BEGIN { exit !(current >= max) }'; then
      enqueue_task "$TASK_ID" "$PRIORITY" "$LABEL" "cpu_guard:${CURRENT_CPU_PERCENT}%>=${CPU_MAX_PERCENT}%" >/dev/null
      echo "DEFERRED: CPU guard current=${CURRENT_CPU_PERCENT}% threshold=${CPU_MAX_PERCENT}%" >&2
      exit 69
    fi
    remove_from_queue "$TASK_ID"
    python3 - "$ACTIVE_FILE" "$TASK_ID" "$PRIORITY" "$LABEL" "$CURRENT_CPU_PERCENT" <<'PY'
import json, sys, time
path, task_id, priority, label, cpu = sys.argv[1:]
payload = {
    'taskId': task_id,
    'priority': int(priority),
    'label': label,
    'cpuPercentAtAcquire': float(cpu),
    'acquiredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'acquiredAtEpoch': time.time(),
}
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps(payload, ensure_ascii=False))
PY
    ;;
  acquire-wait)
    TASK_ID="${2:-}"
    PRIORITY="${3:-}"
    LABEL="${4:-$TASK_ID}"
    TIMEOUT_SECONDS="${5:-$WAIT_TIMEOUT_SECONDS}"
    if [[ -z "$TASK_ID" || -z "$PRIORITY" ]]; then
      echo "Usage: bash scripts/computer_use_task_gate.sh acquire-wait <task-id> <priority> [label] [timeout-seconds]" >&2
      exit 1
    fi
    START_EPOCH="$(date +%s)"
    while true; do
      if OUTPUT="$("$0" acquire "$TASK_ID" "$PRIORITY" "$LABEL" 2>&1)"; then
        echo "$OUTPUT"
        exit 0
      fi
      STATUS_CODE=$?
      echo "$OUTPUT" >&2
      if [[ "$STATUS_CODE" != "69" && "$STATUS_CODE" != "70" ]]; then
        exit "$STATUS_CODE"
      fi
      NOW_EPOCH="$(date +%s)"
      ELAPSED=$((NOW_EPOCH - START_EPOCH))
      if (( ELAPSED >= TIMEOUT_SECONDS )); then
        echo "TIMEOUT: waited ${ELAPSED}s for computer-use slot task=${TASK_ID}" >&2
        show_status
        exit 75
      fi
      echo "WAITING: task=${TASK_ID} queued; retry in ${WAIT_POLL_SECONDS}s" >&2
      sleep "$WAIT_POLL_SECONDS"
    done
    ;;
  release)
    TASK_ID="${2:-}"
    if [[ -z "$TASK_ID" ]]; then
      echo "Usage: bash scripts/computer_use_task_gate.sh release <task-id>" >&2
      exit 1
    fi
    cleanup_stale_active
    if [[ -f "$ACTIVE_FILE" ]]; then
      ACTIVE_TASK_ID="$(python3 - "$ACTIVE_FILE" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], 'r', encoding='utf-8')).get('taskId', 'unknown'))
PY
)"
      if [[ "$ACTIVE_TASK_ID" == "$TASK_ID" ]]; then
        rm -f "$ACTIVE_FILE"
      fi
    fi
    remove_from_queue "$TASK_ID"
    echo "released:${TASK_ID}"
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: bash scripts/computer_use_task_gate.sh <acquire|acquire-wait|release|status> ..." >&2
    exit 1
    ;;
esac
