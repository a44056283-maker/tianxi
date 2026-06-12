#!/usr/bin/env bash
# OpenClaw 状态检查脚本 - 在 Mac 终端运行此脚本

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ENV="$SCRIPT_DIR/openclaw_env.sh"

echo "=== OpenClaw 状态检查 ==="

run_openclaw() {
  perl -e 'alarm shift @ARGV; exec @ARGV' 15 "$OPENCLAW_ENV" "$@"
}

check_result() {
  local label="$1"
  shift
  echo ""
  echo "--- $label ---"
  if [[ -x "$OPENCLAW_ENV" ]]; then
    if run_openclaw "$@" &>/dev/null; then
      run_openclaw "$@" 2>&1 || true
    else
      echo "  无法执行: $*"
    fi
  else
    echo "  openclaw_env.sh 不可执行"
  fi
}

echo ""
echo "检查顺序: Daemon -> Gateway -> 模型配置"
check_result "Daemon 状态" daemon status
check_result "Gateway 健康" gateway health
check_result "模型状态" models status

echo ""
echo "=== 检查完成 ==="
