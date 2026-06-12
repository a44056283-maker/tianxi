#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

print_file() {
  local path="$1"
  if [[ -f "$ROOT_DIR/$path" ]]; then
    printf '\n===== %s =====\n' "$path"
    sed -n '1,220p' "$ROOT_DIR/$path"
  else
    printf '\n===== %s =====\n缺失\n' "$path"
  fi
}

cd "$ROOT_DIR"

printf 'Smart Retail Context Bootstrap\n'
printf 'Project: %s\n' "$ROOT_DIR"
printf 'Generated: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
printf '\n===== git status --short =====\n'
git status --short || true

print_file "AGENTS.md"
print_file "docs/ai-context/00_PROJECT_BRIEF.md"
print_file "docs/ai-context/01_CURRENT_STATE.md"
print_file "docs/ai-context/02_DECISIONS.md"
print_file "docs/ai-context/04_NEXT_ACTIONS.md"
print_file "docs/ai-context/05_OPERATION_BOUNDARY.md"
print_file "docs/ai-context/07_BROWSER_WORKFLOW.md"
print_file "docs/ai-context/09_CODEX_HANDOFF.md"
print_file "docs/ai-context/10_TEST_LOG.md"
print_file "docs/ai-context/11_MEMORY_SYSTEM.md"
print_file "docs/ai-context/12_EXECUTION_CORE.md"

if [[ -f "$ROOT_DIR/docs/ai-context/latest-snapshot.md" ]]; then
  print_file "docs/ai-context/latest-snapshot.md"
fi

if [[ -f "$ROOT_DIR/docs/ai-context/latest-package-path.txt" ]]; then
  printf '\n===== docs/ai-context/latest-package-path.txt =====\n'
  cat "$ROOT_DIR/docs/ai-context/latest-package-path.txt"
  printf '\n'
fi
