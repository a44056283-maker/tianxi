#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
exec /Users/luxiangnan/.local/share/lenovo-smart-retail-api-runtime/bin/python \
  "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/scripts/scheduled_task_runner.py"
