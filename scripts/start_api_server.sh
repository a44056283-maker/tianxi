#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
API_DIR="$ROOT_DIR/apps/api-server"
API_ENV_FILE="${HOME}/.config/lenovo-smart-retail/api-server.env"

if [[ -f "$API_ENV_FILE" ]]; then
  source "$API_ENV_FILE"
fi

cd "$API_DIR"
export PYTHONPATH="$API_DIR${PYTHONPATH:+:$PYTHONPATH}"
exec /Users/luxiangnan/.local/bin/uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
