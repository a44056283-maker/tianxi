.PHONY: setup browsers db-up db-down db-init auth-login auth-check collect-orders collect-inventory status test lint package

setup:
	python -m venv .venv
	. .venv/bin/activate && pip install -U pip && pip install -e '.[dev]'
	cp -n .env.example .env || true
	cp -n config/selectors.example.yaml config/selectors.yaml || true
	cp -n config/stores.example.yaml config/stores.yaml || true

browsers:
	. .venv/bin/activate && playwright install chromium

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose down

db-init:
	. .venv/bin/activate && zdt-sync db init

auth-login:
	. .venv/bin/activate && zdt-sync auth login

auth-check:
	. .venv/bin/activate && zdt-sync auth check

collect-orders:
	. .venv/bin/activate && zdt-sync collect orders --incremental --headful

collect-inventory:
	. .venv/bin/activate && zdt-sync collect inventory --headful

status:
	. .venv/bin/activate && zdt-sync status

test:
	. .venv/bin/activate && python -m compileall zdt_sync && pytest -q

lint:
	. .venv/bin/activate && ruff check zdt_sync tests

package:
	cd .. && zip -r zdt_sync_openclaw_starter.zip zdt_sync_openclaw_starter -x '*/.venv/*' '*/.auth/*' '*/artifacts/*' '*/__pycache__/*'
