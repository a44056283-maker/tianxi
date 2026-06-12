#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "请先安装 Python 3.11+"
  exit 1
fi

python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e '.[dev]'
playwright install chromium
cp -n .env.example .env || true
cp -n config/selectors.example.yaml config/selectors.yaml || true
cp -n config/stores.example.yaml config/stores.yaml || true

echo "安装完成。请确认 Docker Desktop 已安装并启动。下一步：docker compose up -d postgres redis && zdt-sync db init"
