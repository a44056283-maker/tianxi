#!/usr/bin/env bash
# OpenClaw 启动脚本 - 在 Mac 终端运行此脚本

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ENV="$SCRIPT_DIR/openclaw_env.sh"

echo "=== OpenClaw 启动脚本 ==="

# 检查 openclaw_env.sh 是否存在
if [[ ! -f "$OPENCLAW_ENV" ]]; then
  echo "错误: 找不到 $OPENCLAW_ENV"
  exit 1
fi

# 检查 OpenClaw 是否已安装
echo "[1/4] 检查 OpenClaw 安装状态..."
if ! "$OPENCLAW_ENV" --version &>/dev/null; then
  echo "OpenClaw 未安装，正在尝试安装..."
  if command -v brew &>/dev/null; then
    brew install --cask openclaw 2>&1 || brew install openclaw 2>&1 || true
  fi
fi

OPENCLAW_VERSION="$("$OPENCLAW_ENV" --version 2>&1 || echo "unknown")"
echo "  OpenClaw 版本: $OPENCLAW_VERSION"

# 启动 Daemon
echo "[2/4] 启动 OpenClaw Daemon..."
if "$OPENCLAW_ENV" daemon status 2>&1 | grep -q "LaunchAgent (loaded)"; then
  echo "  Daemon 已运行"
elif "$OPENCLAW_ENV" daemon start 2>&1; then
  echo "  Daemon 启动成功"
else
  echo "  Daemon 启动失败，尝试强制启动..."
  "$OPENCLAW_ENV" daemon start --force 2>&1 || true
fi

# 启动 Gateway
echo "[3/4] 启动 OpenClaw Gateway..."
if "$OPENCLAW_ENV" gateway status 2>&1 | grep -q "running"; then
  echo "  Gateway 已运行"
elif "$OPENCLAW_ENV" gateway start 2>&1; then
  echo "  Gateway 启动成功"
else
  echo "  Gateway 启动失败，尝试强制启动..."
  "$OPENCLAW_ENV" gateway start --force 2>&1 || true
fi

# 健康检查
echo "[4/4] 执行健康检查..."
sleep 2
if [[ -x "$OPENCLAW_ENV" ]]; then
  "$OPENCLAW_ENV" gateway health 2>&1 || echo "  健康检查完成"
fi

echo ""
echo "=== 启动完成 ==="
echo "运行以下命令检查状态:"
echo "  $OPENCLAW_ENV daemon status"
echo "  $OPENCLAW_ENV gateway health"
echo "  $OPENCLAW_ENV models status"
