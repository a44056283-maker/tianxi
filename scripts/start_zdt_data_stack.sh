#!/bin/zsh
set -euo pipefail

export PATH="/Users/luxiangnan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT_DIR="/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
COMPOSE_FILE="$ROOT_DIR/zdt-sync/docker-compose.yml"
LOG_DIR="$HOME/Library/Logs/lenovo-smart-retail"
LOG_FILE="$LOG_DIR/zdt-data-stack.log"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

if ! command -v docker >/dev/null 2>&1; then
  log "docker command not found; skip data stack start"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  log "docker daemon not ready, opening Docker.app"
  open -a Docker || true
  for _ in {1..30}; do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

if ! docker info >/dev/null 2>&1; then
  log "docker daemon still unavailable after wait; exit"
  exit 0
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "compose file missing: $COMPOSE_FILE"
  exit 0
fi

log "starting zdt postgres/redis stack"
docker compose -f "$COMPOSE_FILE" up -d postgres redis >> "$LOG_FILE" 2>&1 || true
log "zdt data stack start finished"
