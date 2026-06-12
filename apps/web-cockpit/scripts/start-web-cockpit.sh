#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

API_HEALTH_URL="http://127.0.0.1:8000/health"

until curl --silent --fail --max-time 3 "$API_HEALTH_URL" >/dev/null 2>&1; do
  echo "[start-web-cockpit] waiting for api-server health: $API_HEALTH_URL"
  sleep 2
done

cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit"
exec /Users/luxiangnan/.local/bin/npm run preview -- --host 0.0.0.0 --port 5174
