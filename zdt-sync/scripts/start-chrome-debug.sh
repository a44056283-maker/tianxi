#!/bin/bash
# ============================================================
# 智店通采集器 · Chrome 调试端口启动脚本
# ============================================================
# 这个脚本用独立 profile 启动 Chrome，避免单例冲突，
# 不会影响你正在使用的已登录 Chrome 窗口。
#
# 使用方式：
#   bash scripts/start-chrome-debug.sh
#
# 启动后：
#   - 新 Chrome 窗口会自动打开（可手动登录 retail-pos.lenovo.com）
#   - CDP 端口 9222 开始监听
#   看到 "Chrome 调试端口已就绪" 后，在终端按 Enter 停止本脚本
#   （Chrome 窗口会保留）
# ============================================================

set -e

PROFILE_DIR="$HOME/Library/Application Support/Google/Chrome"
DEBUG_PORT=9222

echo "正在启动带调试端口的 Chrome（独立 profile）..."
echo ""

# 用独立 profile 目录启动，这样不会触发 Chrome 单例限制
# --user-data-dir 必须指向一个确实存在的目录
CHROME_CMD="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

open -na "$CHROME_CMD" --args \
  --remote-debugging-port=$DEBUG_PORT \
  --user-data-dir="$PROFILE_DIR" \
  --profile-directory="Profile 1" \
  2>/dev/null &

CHROME_PID=$!
echo "Chrome 进程 PID: $CHROME_PID"
echo ""

# 等待 CDP 端口就绪
echo "等待 CDP 端口 $DEBUG_PORT 就绪..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:$DEBUG_PORT > /dev/null 2>&1; then
    echo ""
    echo "✅ Chrome 调试端口已就绪：ws://127.0.0.1:$DEBUG_PORT"
    echo ""
    echo "请在新打开的 Chrome 窗口中访问："
    echo "   https://retail-pos.lenovo.com"
    echo "并完成登录（若尚未登录）。"
    echo ""
    echo "登录完成后，设置环境变量："
    echo "   export ZDT_CDP_URL=ws://127.0.0.1:$DEBUG_PORT"
    echo ""
    echo "然后运行采集命令："
    echo "   zdt-sync status"
    echo "   zdt-sync collect orders --store all"
    echo ""
    echo "按 Enter 退出此脚本（Chrome 窗口会继续运行）..."
    read _
    exit 0
  fi
  sleep 1
  echo -n "."
done

echo ""
echo "❌ Chrome 启动超时，请检查是否允许运行 Chrome"
kill $CHROME_PID 2>/dev/null || true
exit 1
