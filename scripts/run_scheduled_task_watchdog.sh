#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR/apps/inventory-sync"
node --import tsx/esm src/cli.ts run-scheduled-task-watchdog
