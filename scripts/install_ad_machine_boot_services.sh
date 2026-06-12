#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"

"$ROOT_DIR/scripts/install_api_server_launchagent.sh"
"$ROOT_DIR/scripts/install_web_cockpit_launchagent.sh"
"$ROOT_DIR/scripts/install_ad_machine_guard_launchagent.sh"

printf '\nhealth checks\n'

wait_health() {
  local url="$1"
  local name="$2"
  local retry_max="${3:-12}"
  local retry_wait="${4:-2}"
  local i=1
  while [ "$i" -le "$retry_max" ]; do
    if curl --silent --show-error --fail --max-time 6 "$url" >/dev/null; then
      printf '%s ready (%s/%s)\n' "$name" "$i" "$retry_max"
      return 0
    fi
    sleep "$retry_wait"
    i=$((i + 1))
  done
  printf '%s health check failed after %s retries\n' "$name" "$retry_max" >&2
  return 1
}

wait_health "http://127.0.0.1:8000/health" "api-server"
wait_health "http://127.0.0.1:5174/ad-machine/index.html" "web-cockpit"
wait_health "http://127.0.0.1:8000/api/ad-machine/service-status" "ad-machine-service-status"
wait_health "http://127.0.0.1:8000/api/inventory-quote/retail-zone" "ad-machine-retail-zone"
wait_health "http://127.0.0.1:8000/api/inventory-quote/marketing-boost" "ad-machine-marketing-boost"

printf 'ad machine boot services ready\n'
