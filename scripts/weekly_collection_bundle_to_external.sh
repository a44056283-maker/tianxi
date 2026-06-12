#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTERNAL_ROOT="${LENOVO_EXTERNAL_BACKUP_ROOT:-/Volumes/TianLu_Storage/联想智慧零售采集备份}"
WEEK_TAG="$(date +%G-W%V)"
WEEKLY_DIR="$EXTERNAL_ROOT/weekly"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -d /Volumes/TianLu_Storage ]]; then
  echo "External volume not mounted: /Volumes/TianLu_Storage"
  exit 0
fi

mkdir -p "$WEEKLY_DIR"
OUT_TAR="$WEEKLY_DIR/collection-${WEEK_TAG}-${STAMP}.tar.gz"

cd "$ROOT_DIR"

tar -czf "$OUT_TAR" \
  apps/inventory-sync/artifacts/manual \
  apps/inventory-sync/artifacts/scheduled-task-runs \
  apps/inventory-sync/artifacts/latest-scheduled-task-reports.json \
  apps/web-cockpit/public/data/latest-scheduled-task-dashboard.json \
  apps/api-server/data/retail-core.sqlite3 \
  docs/ai-context/latest-snapshot.md \
  docs/ai-context/latest-package-path.txt

echo "weekly bundle complete: $OUT_TAR"
