#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
AUTOMATION_ROOT="$HOME/.codex/automations"
BACKUP_ROOT="$HOME/.codex/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/automations-restore-$TIMESTAMP"

echo "[1/5] 备份当前自动化目录"
mkdir -p "$BACKUP_DIR"
if [ -d "$AUTOMATION_ROOT" ]; then
  cp -R "$AUTOMATION_ROOT/." "$BACKUP_DIR/"
fi

echo "[2/5] 按标准源重写 30 条自动化定义"
python3 "$PROJECT_ROOT/scripts/reload_codex_automations.py"

echo "[3/5] 校验 automation.toml 数量与 TOML 解析"
python3 - <<'PY'
from pathlib import Path
import tomllib

base = Path.home() / ".codex" / "automations"
files = sorted(base.glob("*/automation.toml"))
broken: list[str] = []
for file in files:
    try:
        tomllib.loads(file.read_text(encoding="utf-8"))
    except Exception as exc:
        broken.append(f"{file}: {exc}")

print(f"automation_count={len(files)}")
print(f"broken_count={len(broken)}")
if broken:
    print("broken_files_begin")
    for row in broken:
        print(row)
    print("broken_files_end")
    raise SystemExit(1)
PY

echo "[4/5] 抽查关键自动化"
python3 - <<'PY'
from pathlib import Path
import tomllib

base = Path.home() / ".codex" / "automations"
for automation_id in ("automation-2", "automation-8", "11-15", "4", "sn"):
    path = base / automation_id / "automation.toml"
    if not path.exists():
        continue
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    print(f"{automation_id}\t{data.get('name')}\t{data.get('status')}")
PY

echo "[5/5] 恢复完成"
echo "backup_dir=$BACKUP_DIR"
echo "automation_root=$AUTOMATION_ROOT"
echo "说明：如 Codex 自动化列表当时已打开，切走再切回自动化页即可刷新显示。"
