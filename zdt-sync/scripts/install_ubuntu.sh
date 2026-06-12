#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip docker.io docker-compose-plugin curl ca-certificates
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e '.[dev]'
playwright install chromium
cp -n .env.example .env || true
cp -n config/selectors.example.yaml config/selectors.yaml || true
cp -n config/stores.example.yaml config/stores.yaml || true

echo "安装完成。下一步：docker compose up -d postgres redis && zdt-sync db init"
