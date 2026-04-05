UV ?= uv
API_PROJECT ?= services/api

.PHONY: bootstrap bootstrap-api bootstrap-web dev-api dev-web dev-web-lan dev-worker dev-local-ai test-api lint-api seed-api verify-export sync-workitem-registry check-workitem-registry test-workitem-registry sync-workitem-mirror check-workitem-mirror test-workitem-mirror

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

sync-workitem-registry:
	python3 scripts/observatory_registry.py refresh

check-workitem-registry:
	python3 scripts/workitem_lock.py status >/dev/null
	PYTHONPATH=scripts python3 -c "from pathlib import Path; from workitem_lock import Registry, git_common_dir; repo = Path('.').resolve(); registry = Registry(git_common_dir(repo) / 'codex-workitems'); registry.ensure(); required = [registry.workitems_file, registry.review_backlog_file, registry.branch_cleanup_file, registry.design_queue_file]; missing = [str(path) for path in required if not path.exists()]; assert not missing, f'Missing registry files: {missing}'"

test-workitem-registry:
	python3 -m unittest scripts/tests/test_observatory_registry.py

sync-workitem-mirror: sync-workitem-registry

check-workitem-mirror: check-workitem-registry

test-workitem-mirror: test-workitem-registry
