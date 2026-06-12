#!/usr/bin/env bash
#
# 灰渠公众号报价采集定时任务设置脚本
# 用法: bash scripts/setup_gray_channel_cron.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COLLECTOR_SCRIPT="$SCRIPT_DIR/run_gray_channel_collector.sh"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_step() {
  echo -e "${GREEN}✓${NC} $1"
}

echo_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# 显示当前 cron 任务
show_current_crons() {
  echo ""
  echo "当前灰渠采集相关的 cron 任务:"
  echo ""
  crontab -l 2>/dev/null | grep -E "gray.*channel|gray_channel|scheduled.*task" || echo "  (无)"
  echo ""
}

# 添加新的 cron 任务
add_cron_task() {
  local time=$1
  local description=$2

  echo_warn "添加 cron 任务: $description @ $time"

  # 检查是否已存在相同的任务
  if crontab -l 2>/dev/null | grep -q "$COLLECTOR_SCRIPT.*--cron"; then
    echo_warn "  该任务已存在，跳过"
    return
  fi

  # 添加到 crontab
  (crontab -l 2>/dev/null; echo "$time cd \"$ROOT_DIR\" && bash \"$COLLECTOR_SCRIPT\" --cron >> \"$ROOT_DIR/logs/gray-channel-cron.log\" 2>&1") | crontab -
  echo_step "  已添加"
}

# 移除 cron 任务
remove_cron_tasks() {
  echo_warn "移除所有灰渠采集相关的 cron 任务..."

  crontab -l 2>/dev/null | grep -v "gray.*channel|gray_channel" | crontab - 2>/dev/null || true

  echo_step "  已移除"
}

# 主菜单
show_menu() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║       灰渠公众号报价采集 - 定时任务配置                      ║"
  echo "╠════════════════════════════════════════════════════════════╣"
  echo "║                                                            ║"
  echo "║  1. 查看当前 cron 任务                                      ║"
  echo "║  2. 添加每日定时任务 (每天 08:00)                           ║"
  echo "║  3. 添加每日定时任务 (每天 14:00)                           ║"
  echo "║  4. 添加每日定时任务 (每天 18:00)                           ║"
  echo "║  5. 自定义时间                                              ║"
  echo "║  6. 移除所有灰渠采集定时任务                                ║"
  echo "║  7. 退出                                                   ║"
  echo "║                                                            ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo -n "请选择 [1-7]: "
}

# 处理自定义时间输入
get_custom_time() {
  echo ""
  echo "请输入 cron 时间表达式 (格式: 分 时 日 月 周)"
  echo "示例:"
  echo "  0 8 * * *     - 每天 08:00"
  echo "  30 14 * * 1-5 - 每周一到周五 14:30"
  echo "  0 */6 * * *   - 每 6 小时"
  echo ""
  echo -n "请输入: "
  read -r custom_time

  if [[ ! "$custom_time" =~ ^[0-9,\-*\/]+[[:space:]]+[0-9,\-*\/]+[[:space:]]+[0-9,\-*\/]+[[:space:]]+[0-9,\-*\/]+[[:space:]]+[0-9,\-*\/]+$ ]]; then
    echo_warn "无效的时间表达式"
    return 1
  fi

  echo "$custom_time"
}

# 主程序
main() {
  echo_step "灰渠公众号报价采集定时任务配置"

  if ! command -v crontab &>/dev/null; then
    echo_warn "crontab 不可用，请在 macOS 系统上运行此脚本"
    exit 1
  fi

  if [[ ! -f "$COLLECTOR_SCRIPT" ]]; then
    echo_warn "找不到采集脚本: $COLLECTOR_SCRIPT"
    exit 1
  fi

  # 确保脚本可执行
  chmod +x "$COLLECTOR_SCRIPT"

  if [[ $# -gt 0 ]]; then
    # 命令行模式
    case "$1" in
      show)
        show_current_crons
        ;;
      add-08)
        add_cron_task "0 8 * * *" "每天 08:00"
        ;;
      add-14)
        add_cron_task "0 14 * * *" "每天 14:00"
        ;;
      add-18)
        add_cron_task "0 18 * * *" "每天 18:00"
        ;;
      remove)
        remove_cron_tasks
        ;;
      *)
        echo_warn "未知参数: $1"
        echo "用法: $0 [show|add-08|add-14|add-18|remove]"
        ;;
    esac
    return
  fi

  # 交互模式
  while true; do
    show_menu
    read -r choice

    case "$choice" in
      1)
        show_current_crons
        ;;
      2)
        add_cron_task "0 8 * * *" "每天 08:00"
        ;;
      3)
        add_cron_task "0 14 * * *" "每天 14:00"
        ;;
      4)
        add_cron_task "0 18 * * *" "每天 18:00"
        ;;
      5)
        if custom_time=$(get_custom_time); then
          add_cron_task "$custom_time" "自定义时间"
        fi
        ;;
      6)
        remove_cron_tasks
        ;;
      7)
        echo ""
        echo_step "退出"
        break
        ;;
      *)
        echo_warn "无效选择"
        ;;
    esac
  done

  echo ""
  echo_step "配置完成!"
}

main "$@"
