#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTERNAL_ROOT="${LENOVO_EXTERNAL_BACKUP_ROOT:-/Volumes/TianLu_Storage/联想智慧零售采集备份}"
TODAY="$(date +%F)"
DAILY_DIR="$EXTERNAL_ROOT/daily/$TODAY"

if [[ ! -d /Volumes/TianLu_Storage ]]; then
  echo "External volume not mounted: /Volumes/TianLu_Storage"
  exit 0
fi

mkdir -p "$DAILY_DIR/manual" "$DAILY_DIR/evidence" "$DAILY_DIR/sql"

move_old_files() {
  local src_dir="$1"
  local dst_dir="$2"
  if [[ ! -d "$src_dir" ]]; then
    return 0
  fi

  mkdir -p "$dst_dir"
  find "$src_dir" -type f \( \
    -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.pdf' -o \
    -name '*.xlsx' -o -name '*.xls' -o -name '*.csv' -o -name '*.json' -o -name '*.txt' \
  \) -mtime +0 -print0 | while IFS= read -r -d '' file; do
    rel="${file#${src_dir}/}"
    mkdir -p "$dst_dir/$(dirname "$rel")"
    rsync -a "$file" "$dst_dir/$rel"
    rm -f "$file"
  done
}

move_old_files "$ROOT_DIR/apps/inventory-sync/artifacts/manual" "$DAILY_DIR/manual"
move_old_files "$ROOT_DIR/apps/inventory-sync/artifacts/manual/evidence" "$DAILY_DIR/evidence"

SQL_DB="$ROOT_DIR/apps/api-server/data/retail-core.sqlite3"
if [[ -f "$SQL_DB" ]]; then
  rsync -a "$SQL_DB" "$DAILY_DIR/sql/retail-core.sqlite3"
fi

find "$ROOT_DIR/apps/inventory-sync/artifacts/manual" -type d -empty -delete 2>/dev/null || true

echo "external offload complete: $DAILY_DIR"
