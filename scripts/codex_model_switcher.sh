#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG_PATH="$CODEX_HOME/config.toml"
BACKUP_DIR="$CODEX_HOME/switcher-backups"
MARKER="CODEX_MODEL_SWITCH_RESET"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
DEFAULT_MODEL="gpt-5.3-codex"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/codex_model_switcher.sh status
  bash scripts/codex_model_switcher.sh switch-openrouter [model]
  OPENROUTER_API_KEY=... bash scripts/codex_model_switcher.sh switch-openrouter [model]
  bash scripts/codex_model_switcher.sh switch-original [model]
  bash scripts/codex_model_switcher.sh schedule-reset [YYYY-MM-DD] [HH:MM]
  bash scripts/codex_model_switcher.sh unschedule-reset

Examples:
  bash scripts/codex_model_switcher.sh switch-openrouter gpt-5.3-codex
  bash scripts/codex_model_switcher.sh schedule-reset 2026-05-27 00:10
EOF
}

ensure_config() {
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "ERROR: config.toml not found: $CONFIG_PATH" >&2
    exit 1
  fi
}

backup_config() {
  mkdir -p "$BACKUP_DIR"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG_PATH" "$BACKUP_DIR/config.toml.$ts.bak"
}

status_mode() {
  python3 - "$CONFIG_PATH" <<'PY'
import re, sys
p = sys.argv[1]
text = open(p, 'r', encoding='utf-8').read()
provider = re.search(r'^model_provider\s*=\s*"([^"]+)"', text, re.M)
base_url = re.search(r'^base_url\s*=\s*"([^"]+)"', text, re.M)
model = re.search(r'^model\s*=\s*"([^"]+)"', text, re.M)
if provider and provider.group(1) == 'openrouter':
    mode = 'openrouter'
elif base_url and 'openrouter.ai' in base_url.group(1):
    mode = 'openrouter'
else:
    mode = 'original'
print(f'mode={mode}')
print(f'model={model.group(1) if model else "(unset)"}')
PY
}

switch_openrouter() {
  ensure_config
  local model="${1:-$DEFAULT_MODEL}"
  local api_key="${OPENROUTER_API_KEY:-}"

  if [[ -z "$api_key" ]]; then
    api_key="$(python3 - "$CONFIG_PATH" <<'PY'
import re, sys
text = open(sys.argv[1], 'r', encoding='utf-8').read()
m = re.search(r'(?ms)^\[model_providers\.openrouter\]\n(?:(?!^\[).*[\r\n])*?^api_key\s*=\s*"([^"]+)"', text)
print(m.group(1) if m else '')
PY
)"
  fi

  if [[ -z "$api_key" ]]; then
    echo "ERROR: missing OpenRouter API key. Set OPENROUTER_API_KEY first." >&2
    exit 1
  fi

  backup_config
  python3 - "$CONFIG_PATH" "$model" "$OPENROUTER_BASE_URL" "$api_key" <<'PY'
import re, sys
p, model, base_url, api_key = sys.argv[1:5]
text = open(p, 'r', encoding='utf-8').read()
lines = text.splitlines()

# Remove [model_providers.openrouter] section if exists.
out = []
skip = False
for line in lines:
    if re.match(r'^\[model_providers\.openrouter\]\s*$', line):
        skip = True
        continue
    if skip and re.match(r'^\[.+\]\s*$', line):
        skip = False
    if not skip:
        out.append(line)

# Split root and section parts.
root, rest = [], []
in_root = True
for line in out:
    if in_root and re.match(r'^\[.+\]\s*$', line):
        in_root = False
    if in_root:
        root.append(line)
    else:
        rest.append(line)

# Rebuild root keys.
new_root = []
for line in root:
    if re.match(r'^(base_url|model|model_provider)\s*=\s*', line):
        continue
    new_root.append(line)

# Keep leading comments/blank lines but ensure key lines exist near top.
prefix = []
others = []
for line in new_root:
    if line.strip() == '' or line.lstrip().startswith('#'):
        if not others:
            prefix.append(line)
        else:
            others.append(line)
    else:
        others.append(line)

rebuilt_root = prefix + [
    f'base_url = "{base_url}"',
    f'model = "{model}"',
    'model_provider = "openrouter"',
] + others

# Trim extra blank lines.
while rebuilt_root and rebuilt_root[-1].strip() == '':
    rebuilt_root.pop()

provider_block = [
    '',
    '[model_providers.openrouter]',
    'name = "OpenRouter"',
    f'base_url = "{base_url}"',
    f'api_key = "{api_key}"',
    'wire_api = "responses"',
]

final_lines = rebuilt_root
if rest:
    final_lines += [''] + rest
final_lines += provider_block

open(p, 'w', encoding='utf-8').write('\n'.join(final_lines).rstrip() + '\n')
PY
  echo "Switched to OpenRouter model: $model"
}

switch_original() {
  ensure_config
  local model="${1:-$DEFAULT_MODEL}"
  backup_config

  python3 - "$CONFIG_PATH" "$model" <<'PY'
import re, sys
p, model = sys.argv[1:3]
text = open(p, 'r', encoding='utf-8').read()
lines = text.splitlines()

# Remove [model_providers.openrouter] section if exists.
out = []
skip = False
for line in lines:
    if re.match(r'^\[model_providers\.openrouter\]\s*$', line):
        skip = True
        continue
    if skip and re.match(r'^\[.+\]\s*$', line):
        skip = False
    if not skip:
        out.append(line)

# Split root and sections.
root, rest = [], []
in_root = True
for line in out:
    if in_root and re.match(r'^\[.+\]\s*$', line):
        in_root = False
    if in_root:
        root.append(line)
    else:
        rest.append(line)

new_root = []
model_set = False
for line in root:
    if re.match(r'^(base_url|model_provider)\s*=\s*', line):
        continue
    if re.match(r'^model\s*=\s*', line):
        new_root.append(f'model = "{model}"')
        model_set = True
        continue
    new_root.append(line)

if not model_set:
    # Put model key near top after initial comments/blank lines.
    insert_at = 0
    while insert_at < len(new_root) and (new_root[insert_at].strip() == '' or new_root[insert_at].lstrip().startswith('#')):
        insert_at += 1
    new_root.insert(insert_at, f'model = "{model}"')

while new_root and new_root[-1].strip() == '':
    new_root.pop()

final_lines = new_root
if rest:
    final_lines += [''] + rest

open(p, 'w', encoding='utf-8').write('\n'.join(final_lines).rstrip() + '\n')
PY

  echo "Switched to original Codex login mode (model: $model)"
}

schedule_reset() {
  local date_str="${1:-2026-05-27}"
  local time_str="${2:-00:10}"

  if ! [[ "$date_str" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "ERROR: date must be YYYY-MM-DD" >&2
    exit 1
  fi
  if ! [[ "$time_str" =~ ^[0-9]{2}:[0-9]{2}$ ]]; then
    echo "ERROR: time must be HH:MM" >&2
    exit 1
  fi

  local year month day hour minute
  year="${date_str:0:4}"
  month="${date_str:5:2}"
  day="${date_str:8:2}"
  hour="${time_str:0:2}"
  minute="${time_str:3:2}"

  local script_abs
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  local job_tag="${MARKER}_${year}${month}${day}"
  local cron_line
  cron_line="$((10#$minute)) $((10#$hour)) $((10#$day)) $((10#$month)) * /bin/zsh -lc 'bash "$script_abs" switch-original >/tmp/codex-switch-reset.log 2>&1; bash "$script_abs" unschedule-reset >/tmp/codex-switch-reset.log 2>&1' # $job_tag"

  local current
  current="$(crontab -l 2>/dev/null || true)"
  current="$(printf '%s\n' "$current" | sed "/${MARKER}/d")"

  {
    printf '%s\n' "$current"
    printf '%s\n' "$cron_line"
  } | sed '/^$/N;/^\n$/D' | crontab -

  echo "Scheduled one-time reset to original mode at ${date_str} ${time_str}."
}

unschedule_reset() {
  local current
  current="$(crontab -l 2>/dev/null || true)"
  printf '%s\n' "$current" | sed "/${MARKER}/d" | crontab -
  echo "Removed scheduled reset jobs with marker: $MARKER"
}

show_status() {
  ensure_config
  status_mode
  echo "scheduled_jobs="
  (crontab -l 2>/dev/null || true) | rg "$MARKER" || true
}

main() {
  local cmd="${1:-status}"
  case "$cmd" in
    status)
      show_status
      ;;
    switch-openrouter)
      switch_openrouter "${2:-$DEFAULT_MODEL}"
      ;;
    switch-original)
      switch_original "${2:-$DEFAULT_MODEL}"
      ;;
    schedule-reset)
      schedule_reset "${2:-2026-05-27}" "${3:-00:10}"
      ;;
    unschedule-reset)
      unschedule_reset
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
