#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

API_BASE="http://127.0.0.1:8000"
STATUS_URL="$API_BASE/api/ad-machine/service-status"
REFRESH_URL="$API_BASE/api/ad-machine/service-status/refresh-data"
REPAIR_URL="$API_BASE/api/ad-machine/service-status/repair"
LOCK_FILE="${HOME}/.cache/lenovo-smart-retail/ad-machine-guard.lock"
STATE_FILE="${HOME}/.cache/lenovo-smart-retail/ad-machine-guard-state.json"
LOG_DIR="${HOME}/Library/Logs/lenovo-smart-retail"
LOG_FILE="$LOG_DIR/ad-machine-guard.log"
COOLDOWN_SECONDS=120

mkdir -p "$(dirname "$LOCK_FILE")" "$LOG_DIR"

if [[ -f "$LOCK_FILE" ]]; then
  old_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
    exit 0
  fi
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

now_epoch="$(date +%s)"
last_action=0
if [[ -f "$STATE_FILE" ]]; then
  last_action="$(python3 - <<'PY' "$STATE_FILE"
import json,sys
path=sys.argv[1]
try:
  data=json.load(open(path,'r',encoding='utf-8'))
  print(int(data.get('last_action',0)))
except Exception:
  print(0)
PY
)"
fi

status_json="$(curl -sS -m 5 "$STATUS_URL" || true)"
if [[ -z "$status_json" ]]; then
  echo "[$(date '+%F %T')] status_fetch_failed" >> "$LOG_FILE"
  exit 0
fi

parsed_lines="$(python3 - <<'PY' "$status_json"
import json,sys
raw=sys.argv[1]
try:
  payload=json.loads(raw)
except Exception:
  print('0'); print('0'); print('parse_error'); sys.exit(0)
uc=int(payload.get('unhealthyCount') or 0)
services=payload.get('services') or []
snapshot_only=1 if uc>0 and all((s.get('issueType')=='snapshot_stale') for s in services if not s.get('ok')) else 0
keys='|'.join([str(s.get('key')) for s in services if not s.get('ok')])
print(str(uc))
print(str(snapshot_only))
print(keys)
PY
)"
unhealthy_count="$(echo "$parsed_lines" | sed -n '1p')"
snapshot_only="$(echo "$parsed_lines" | sed -n '2p')"
unhealthy_keys="$(echo "$parsed_lines" | sed -n '3p')"
unhealthy_count="${unhealthy_count:-0}"
snapshot_only="${snapshot_only:-0}"

if [[ "$unhealthy_count" -le 0 ]]; then
  echo "[$(date '+%F %T')] healthy" >> "$LOG_FILE"
  exit 0
fi

if (( now_epoch - last_action < COOLDOWN_SECONDS )); then
  echo "[$(date '+%F %T')] unhealthy=$unhealthy_count cooldown_skip keys=$unhealthy_keys" >> "$LOG_FILE"
  exit 0
fi

if [[ "$snapshot_only" -eq 1 ]]; then
  action="refresh-data"
  result="$(curl -sS -m 12 -X POST "$REFRESH_URL" || true)"
else
  action="repair"
  result="$(curl -sS -m 12 -X POST "$REPAIR_URL" || true)"
fi

cat > "$STATE_FILE" <<JSON
{"last_action": $now_epoch, "action": "${action}", "unhealthy": ${unhealthy_count}}
JSON

echo "[$(date '+%F %T')] unhealthy=$unhealthy_count action=$action keys=$unhealthy_keys result=${result:0:220}" >> "$LOG_FILE"
