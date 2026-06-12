#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
API_ENV_FILE="${HOME}/.config/lenovo-smart-retail/api-server.env"
DEFAULT_DB_FILE="${PROJECT_ROOT}/apps/api-server/data/retail-core.sqlite3"
DEFAULT_LEDGER_FILE="${PROJECT_ROOT}/apps/api-server/data/local-sales-ledger.json"
REMOTE_HOST="${LENOVO_SMART_RETAIL_ARCHIVE_HOST:-192.168.13.48}"
REMOTE_ROOT="${LENOVO_SMART_RETAIL_ARCHIVE_ROOT:-/Volumes/TianLu_Archive/Backups/lenovo-smart-retail-cockpit/sqlite-history}"

if [[ -f "$API_ENV_FILE" ]]; then
  source "$API_ENV_FILE"
fi

DB_FILE="${LENOVO_SMART_RETAIL_DB_FILE:-$DEFAULT_DB_FILE}"
LEDGER_FILE="${LENOVO_SMART_RETAIL_LEDGER_FILE:-$DEFAULT_LEDGER_FILE}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d)"
ARCHIVE_DIR="${TMP_DIR}/retail-core-${STAMP}"
SNAPSHOT_MD="${PROJECT_ROOT}/docs/ai-context/latest-snapshot.md"
SNAPSHOT_ZIP_PATH_FILE="${PROJECT_ROOT}/docs/ai-context/latest-package-path.txt"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$ARCHIVE_DIR"

if [[ ! -f "$DB_FILE" ]]; then
  echo "DB file not found: $DB_FILE" >&2
  exit 1
fi

sqlite3 "$DB_FILE" ".backup '${ARCHIVE_DIR}/retail-core.sqlite3'"

if [[ -f "$LEDGER_FILE" ]]; then
  cp "$LEDGER_FILE" "${ARCHIVE_DIR}/local-sales-ledger.json"
fi

if [[ -f "$SNAPSHOT_MD" ]]; then
  cp "$SNAPSHOT_MD" "${ARCHIVE_DIR}/latest-snapshot.md"
fi

if [[ -f "$SNAPSHOT_ZIP_PATH_FILE" ]]; then
  PACKAGE_PATH="$(cat "$SNAPSHOT_ZIP_PATH_FILE")"
  if [[ -f "$PACKAGE_PATH" ]]; then
    cp "$PACKAGE_PATH" "${ARCHIVE_DIR}/"
  fi
fi

shasum -a 256 "${ARCHIVE_DIR}/retail-core.sqlite3" > "${ARCHIVE_DIR}/SHA256SUMS.txt"
if [[ -f "${ARCHIVE_DIR}/local-sales-ledger.json" ]]; then
  shasum -a 256 "${ARCHIVE_DIR}/local-sales-ledger.json" >> "${ARCHIVE_DIR}/SHA256SUMS.txt"
fi

cat > "${ARCHIVE_DIR}/manifest.json" <<EOF
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "dbFile": "$DB_FILE",
  "ledgerFile": "$LEDGER_FILE",
  "archiveHost": "$REMOTE_HOST",
  "archiveRoot": "$REMOTE_ROOT",
  "items": [
    "retail-core.sqlite3",
    "local-sales-ledger.json",
    "latest-snapshot.md"
  ]
}
EOF

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_ROOT'"
rsync -a "$ARCHIVE_DIR/" "${REMOTE_HOST}:${REMOTE_ROOT}/${STAMP}/"

echo "${REMOTE_HOST}:${REMOTE_ROOT}/${STAMP}"
