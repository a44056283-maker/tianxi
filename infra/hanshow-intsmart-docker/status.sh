#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose ps
printf '\n--- Intsmart HTTPS ---\n'
curl -k -I --max-time 5 https://127.0.0.1:8445 || true
