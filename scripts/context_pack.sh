#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date '+%Y%m%d-%H%M')"
OUT_DIR="$ROOT_DIR/docs/ai-context/packages"
LATEST_PATH_FILE="$ROOT_DIR/docs/ai-context/latest-package-path.txt"
LATEST_ZIP="$OUT_DIR/latest-smart-retail-context.zip"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/smart-retail-context.XXXXXX")"
PKG_NAME="smart-retail-context-${STAMP}"
PKG_DIR="$STAGE_DIR/$PKG_NAME"
ZIP_PATH="$OUT_DIR/${PKG_NAME}.zip"

mkdir -p "$OUT_DIR" "$PKG_DIR"

copy_if_exists() {
  local path="$1"
  if [[ -e "$ROOT_DIR/$path" ]]; then
    mkdir -p "$PKG_DIR/$(dirname "$path")"
    cp -R "$ROOT_DIR/$path" "$PKG_DIR/$path"
  fi
}

copy_globbed() {
  local dir="$1"
  local pattern="$2"
  if [[ -d "$ROOT_DIR/$dir" ]]; then
    while IFS= read -r file; do
      [[ -n "$file" ]] || continue
      mkdir -p "$PKG_DIR/$(dirname "$file")"
      cp -R "$ROOT_DIR/$file" "$PKG_DIR/$file"
    done < <(cd "$ROOT_DIR" && find "$dir" -maxdepth 1 -type f -name "$pattern" | sort)
  fi
}

copy_if_exists "AGENTS.md"
copy_if_exists "README.md"
copy_globbed "docs" "*.md"
copy_globbed "docs/ai-context" "*.md"
copy_if_exists "apps/web-cockpit/src"

if [[ -d "$ROOT_DIR/apps/web-cockpit/public/data" ]]; then
  mkdir -p "$PKG_DIR/apps/web-cockpit/public/data"
  while IFS= read -r file; do
    cp "$ROOT_DIR/$file" "$PKG_DIR/$file"
  done < <(cd "$ROOT_DIR" && find "apps/web-cockpit/public/data" -maxdepth 1 -type f -name 'latest-*.json' | sort)
fi

copy_if_exists "apps/api-server/app"
copy_if_exists "apps/inventory-sync/src"

while IFS= read -r file; do
  mkdir -p "$PKG_DIR/$(dirname "$file")"
  cp "$ROOT_DIR/$file" "$PKG_DIR/$file"
done < <(cd "$ROOT_DIR" && find . \( -name package.json -o -name pyproject.toml \) \
  -not -path './node_modules/*' \
  -not -path './apps/web-cockpit/node_modules/*' \
  -not -path './apps/inventory-sync/node_modules/*' \
  -not -path './apps/api-server/.venv/*' | sed 's#^\./##' | sort)

mkdir -p "$PKG_DIR/meta"
(cd "$ROOT_DIR" && git status) > "$PKG_DIR/meta/git-status.txt"
(cd "$ROOT_DIR" && git log --oneline -10) > "$PKG_DIR/meta/git-log-last-10.txt"
cp "$ROOT_DIR/docs/ai-context/09_CODEX_HANDOFF.md" "$PKG_DIR/meta/09_CODEX_HANDOFF.md"
{
  printf 'package=%s\n' "$ZIP_PATH"
  printf 'generated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'root=%s\n' "$ROOT_DIR"
  printf 'included_roots=\n'
  printf -- '- AGENTS.md\n'
  printf -- '- README.md\n'
  printf -- '- docs/*.md\n'
  printf -- '- docs/ai-context/*.md\n'
  printf -- '- apps/web-cockpit/src/\n'
  printf -- '- apps/web-cockpit/public/data/latest-*.json\n'
  printf -- '- apps/api-server/app/\n'
  printf -- '- apps/inventory-sync/src/\n'
  printf -- '- package.json / pyproject.toml\n'
  printf -- '- meta/git-status.txt\n'
  printf -- '- meta/git-log-last-10.txt\n'
} > "$PKG_DIR/meta/context-manifest.txt"

find "$PKG_DIR" \
  \( -name node_modules -o -name .venv -o -name dist -o -name artifacts \) \
  -prune -exec rm -rf {} + 2>/dev/null || true

find "$PKG_DIR" -type f \
  \( -iname '.env' -o -iname '.env.*' -o -iname '*cookie*' -o -iname '*token*' -o -iname '*session*' -o -iname '*storage-state*' -o -iname 'zhidiantong-session.json' \) \
  -delete

if command -v zip >/dev/null 2>&1; then
  (cd "$STAGE_DIR" && zip -qr "$ZIP_PATH" "$PKG_NAME")
else
  ditto -c -k --sequesterRsrc --keepParent "$PKG_DIR" "$ZIP_PATH"
fi

cp "$ZIP_PATH" "$LATEST_ZIP"
printf '%s\n' "$ZIP_PATH" > "$LATEST_PATH_FILE"
rm -rf "$STAGE_DIR"
printf '%s\n' "$ZIP_PATH"
