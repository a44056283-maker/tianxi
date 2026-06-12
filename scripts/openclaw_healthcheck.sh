#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW="$SCRIPT_DIR/openclaw_env.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_openclaw() {
  perl -e 'alarm shift @ARGV; exec @ARGV' 15 "$OPENCLAW" "$@"
}

DAEMON_OUT="$TMP_DIR/daemon.txt"
HEALTH_OUT="$TMP_DIR/health.txt"
MODELS_OUT="$TMP_DIR/models.txt"

run_openclaw daemon status >"$DAEMON_OUT"
run_openclaw gateway health >"$HEALTH_OUT"
run_openclaw models status >"$MODELS_OUT"

echo "OpenClaw health summary"
echo "- daemon_loaded: $(grep -q 'LaunchAgent (loaded)' "$DAEMON_OUT" && echo yes || echo no)"
echo "- gateway_ok: $(grep -q '^OK ' "$HEALTH_OUT" && echo yes || echo no)"
echo "- config_present: $(grep -q 'Config (cli): ~/.openclaw/openclaw.json' "$DAEMON_OUT" && echo yes || echo no)"
echo "- default_model: $(grep '^Default' "$MODELS_OUT" | sed 's/^[^:]*: *//')"
echo "- configured_models: $(grep '^Configured models' "$MODELS_OUT" | sed 's/^[^:]*: *//')"
echo "- minimax_auth_detected: $(grep -q 'source=env: MINIMAX_API_KEY' "$MODELS_OUT" && echo yes || echo no)"
