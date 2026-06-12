#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTION_DIR="$ROOT_DIR/apps/inventory-sync/artifacts/manual/wechat-quote-collection"
CURRENT_DIR="$COLLECTION_DIR/current"
ARCHIVE_DIR="$COLLECTION_DIR/archives"
INTERVAL_DAYS="${1:-30}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
ARCHIVE_NAME="wechat-quote-collection-${STAMP}-last${INTERVAL_DAYS}d.tar.gz"
MANIFEST_NAME="wechat-quote-collection-${STAMP}-last${INTERVAL_DAYS}d.manifest.txt"

if [[ "$INTERVAL_DAYS" != "15" && "$INTERVAL_DAYS" != "30" ]]; then
  echo "interval must be 15 or 30 days" >&2
  exit 2
fi

mkdir -p "$CURRENT_DIR" "$ARCHIVE_DIR"

find "$CURRENT_DIR" -type f -mtime "-$INTERVAL_DAYS" | sort > "$ARCHIVE_DIR/$MANIFEST_NAME"

if [[ ! -s "$ARCHIVE_DIR/$MANIFEST_NAME" ]]; then
  echo "no files found in current/ for last ${INTERVAL_DAYS} days"
  exit 0
fi

tar -czf "$ARCHIVE_DIR/$ARCHIVE_NAME" -C "$COLLECTION_DIR" current

echo "$ARCHIVE_DIR/$ARCHIVE_NAME"
echo "$ARCHIVE_DIR/$MANIFEST_NAME"
