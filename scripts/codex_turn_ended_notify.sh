#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  shift
  PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
  cd "$PROJECT_ROOT"
  python3 scripts/fix_codex_pinned_thread_content.py \
    --write \
    --session-dir "${HOME}/.codex/sessions/$(date +%Y/%m/%d)" \
    --compact
  exit 0
fi

if [[ "$#" -lt 3 ]]; then
  echo "Usage: $0 <original-client> turn-ended <payload> [extra args...]" >&2
  exit 64
fi

ORIGINAL_CLIENT="$1"
shift

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
LOG_DIR="$PROJECT_ROOT/outputs"
mkdir -p "$LOG_DIR"
EVENT_NAME="${1:-}"
PAYLOAD="${2:-}"

ORIGINAL_EXIT=0
if [[ "${CODEX_NOTIFY_WRAPPER_SKIP_ORIGINAL:-0}" != "1" ]]; then
  if ! "$ORIGINAL_CLIENT" "$@"; then
    ORIGINAL_EXIT=$?
  fi
fi

# Give Codex a brief moment to flush the current turn into the rollout file.
sleep 0.3

THREAD_ID="$(
python3 - "$PAYLOAD" <<'PY'
import json
import sys

raw = sys.argv[1] if len(sys.argv) > 1 else ""
if not raw:
    print("")
    raise SystemExit(0)

try:
    payload = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

for key in ("thread_id", "threadId", "id"):
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        print(value.strip())
        raise SystemExit(0)

print("")
PY
)"

if [[ -n "$THREAD_ID" ]]; then
  FIX_ARGS=(
    --write
    --thread-id "$THREAD_ID"
    --compact
  )
  FIX_MODE="thread"
else
  FIX_ARGS=(
    --write
    --session-dir "${HOME}/.codex/sessions/$(date +%Y/%m/%d)"
    --compact
  )
  FIX_MODE="session_dir_fallback"
fi

run_fix_once() {
  (
    cd "$PROJECT_ROOT"
    printf '[%s] event=%s mode=%s thread_id=%s pass=%s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" \
      "$EVENT_NAME" \
      "$FIX_MODE" \
      "${THREAD_ID:-}" \
      "$1"
    python3 scripts/fix_codex_pinned_thread_content.py "${FIX_ARGS[@]}"
  ) >>"$LOG_DIR/codex-turn-ended-notify.log" 2>&1 || true
}

(
  run_fix_once immediate
  sleep 1.2
  run_fix_once delayed
) &

exit "$ORIGINAL_EXIT"
