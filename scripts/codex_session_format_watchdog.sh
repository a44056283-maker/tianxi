#!/bin/bash
set -euo pipefail

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
HOME_DIR="${HOME:-/Users/luxiangnan}"
LOG_DIR="$PROJECT_ROOT/outputs"
PID_FILE="$LOG_DIR/codex-session-format-watch.pid"
LOG_FILE="$LOG_DIR/codex-session-format-watch.log"
INTERVAL_SECONDS="${CODEX_SESSION_FORMAT_WATCH_INTERVAL_SECONDS:-0.5}"
PYTHON_BIN="${CODEX_SESSION_FORMAT_WATCH_PYTHON_BIN:-/Library/Frameworks/Python.framework/Versions/3.11/bin/python3}"
REFRESH_SECONDS="${CODEX_SESSION_FORMAT_WATCH_REFRESH_SECONDS:-60}"

mkdir -p "$LOG_DIR"

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

run_watch() {
  cd "$PROJECT_ROOT"
  echo "$$" >"$PID_FILE"
  trap 'rm -f "$PID_FILE"' EXIT
  while true; do
    local session_dir max_iterations
    session_dir="${HOME_DIR}/.codex/sessions/$(date +%Y/%m/%d)"
    max_iterations="$("$PYTHON_BIN" - <<PY
interval_seconds = max(float("$INTERVAL_SECONDS"), 0.2)
refresh_seconds = max(float("$REFRESH_SECONDS"), interval_seconds)
print(max(1, int(round(refresh_seconds / interval_seconds))))
PY
)"
    "$PYTHON_BIN" scripts/fix_codex_pinned_thread_content.py \
      --write \
      --session-dir "$session_dir" \
      --watch \
      --interval-seconds "$INTERVAL_SECONDS" \
      --max-iterations "$max_iterations" \
      --compact
  done
}

start_watch() {
  if is_running; then
    echo "already_running pid=$(cat "$PID_FILE")"
    return 0
  fi
  nohup "$0" run >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  disown "$pid" 2>/dev/null || true
  sleep 0.5
  if is_running; then
    echo "started pid=$pid log=$LOG_FILE"
    return 0
  fi
  echo "failed_to_start log=$LOG_FILE" >&2
  return 1
}

stop_watch() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "not_running"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  sleep 0.5
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "stopped pid=$pid"
}

status_watch() {
  if is_running; then
    ps -p "$(cat "$PID_FILE")" -o pid,ppid,lstart,etime,command
    return 0
  fi
  echo "not_running"
}

case "${1:-start}" in
  run)
    run_watch
    ;;
  start)
    start_watch
    ;;
  stop)
    stop_watch
    ;;
  restart)
    stop_watch
    start_watch
    ;;
  status)
    status_watch
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|run}" >&2
    exit 64
    ;;
esac
