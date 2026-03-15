UV ?= uv
API_PROJECT ?= services/api

.PHONY: bootstrap bootstrap-api bootstrap-web dev-api dev-web dev-web-lan dev-worker dev-local-ai test-api lint-api seed-api verify-export sync-workitem-mirror check-workitem-mirror test-workitem-mirror

bootstrap: bootstrap-api bootstrap-web

bootstrap-api:
	$(UV) sync --project $(API_PROJECT) --extra dev

bootstrap-web:
	pnpm install

dev-api:
	$(UV) run --project $(API_PROJECT) uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir services/api

dev-web:
	pnpm --filter web dev

dev-web-lan:
	pnpm --filter web dev -- --hostname 0.0.0.0 --port 3000

dev-worker:
	$(UV) run --project $(API_PROJECT) python -m app.worker

dev-local-ai:
	PYTHONPATH=services/api $(UV) run --project $(API_PROJECT) python scripts/local_ai_worker.py --api-base http://localhost:8000 --token $$STARLOG_TOKEN

test-api:
	$(UV) run --project $(API_PROJECT) pytest services/api/tests

lint-api:
	$(UV) run --project $(API_PROJECT) ruff check services/api
	$(UV) run --project $(API_PROJECT) mypy services/api/app

seed-api:
	PYTHONPATH=services/api $(UV) run --project $(API_PROJECT) python scripts/dev_seed.py

verify-export:
	$(UV) run --project $(API_PROJECT) python -m app.verify_export_roundtrip

sync-workitem-mirror:
	python3 scripts/sync_workitem_mirror.py

check-workitem-mirror:
	python3 scripts/sync_workitem_mirror.py --check

test-workitem-mirror:
	python3 -m unittest scripts/tests/test_sync_workitem_mirror.py
