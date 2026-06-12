#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose up -d --no-build
printf '\nHanshow Intsmart started.\n'
printf 'Local HTTPS: https://127.0.0.1:8445\n'
printf 'LAN HTTPS:   https://192.168.13.104:8445\n'
printf 'Local HTTP:  http://127.0.0.1:48446\n'
