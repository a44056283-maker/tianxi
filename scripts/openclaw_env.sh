#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
ENV_FILE="$PROJECT_ROOT/apps/inventory-sync/.env"

# Find OpenClaw binary - check multiple locations
find_openclaw() {
  local bins=(
    "$HOME/.local/opt/node-v24.15.0/bin/openclaw"
    "$HOME/.local/bin/openclaw"
    "/usr/local/bin/openclaw"
    "/opt/homebrew/bin/openclaw"
    "$(command -v openclaw 2>/dev/null)"
  )
  for bin in "${bins[@]}"; do
    if [[ -n "$bin" && -x "$bin" ]]; then
      echo "$bin"
      return 0
    fi
  done
  return 1
}

OPENCLAW_BIN="$(find_openclaw)" || OPENCLAW_BIN=""

export PATH="$HOME/.local/bin:$HOME/.local/opt/node-v24.15.0/bin:$PATH"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "$OPENCLAW_BIN" ]]; then
  echo "OpenClaw binary not found. Installing..." >&2
  if command -v brew &>/dev/null; then
    brew install --cask openclaw 2>/dev/null || brew install openclaw 2>/dev/null || true
  fi
  OPENCLAW_BIN="$(find_openclaw)" || true
fi

if [[ -z "$OPENCLAW_BIN" || ! -x "$OPENCLAW_BIN" ]]; then
  echo "OpenClaw binary not found and could not be installed." >&2
  echo "Please install OpenClaw manually: https://openclaw.dev" >&2
  exit 1
fi

exec "$OPENCLAW_BIN" "$@"
