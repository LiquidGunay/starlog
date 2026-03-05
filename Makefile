UV ?= uv
API_PROJECT ?= services/api

.PHONY: bootstrap bootstrap-api bootstrap-web dev-api dev-web dev-worker test-api lint-api seed-api

bootstrap: bootstrap-api bootstrap-web

bootstrap-api:
	$(UV) sync --project $(API_PROJECT) --extra dev

bootstrap-web:
	pnpm install

dev-api:
	$(UV) run --project $(API_PROJECT) uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir services/api

dev-web:
	pnpm --filter web dev

dev-worker:
	$(UV) run --project $(API_PROJECT) python -m app.worker

test-api:
	$(UV) run --project $(API_PROJECT) pytest services/api/tests

lint-api:
	$(UV) run --project $(API_PROJECT) ruff check services/api
	$(UV) run --project $(API_PROJECT) mypy services/api/app

seed-api:
	PYTHONPATH=services/api $(UV) run --project $(API_PROJECT) python scripts/dev_seed.py
