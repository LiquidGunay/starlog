# Starlog Codebase Organization

This document is the developer-facing map for the current Starlog repository. It is meant to answer
one practical question quickly: where should you look when you need to change a specific part of the
product?

Starlog is organized as a monorepo with three main product layers:

- frontend clients in `apps/`
- backend and AI services in `services/`
- capture/distribution tooling in `tools/`

## Top-level map

### `apps/`

User-facing clients.

- `apps/web` — the installable PWA and current primary workspace.
- `apps/mobile` — the native mobile companion focused on capture, alarms, offline playback, and quick review.

### `services/`

Server and runtime code.

- `services/api` — FastAPI system of record for auth, sync, artifacts, notes, tasks, calendar, briefings, review, and tool execution.
- `services/ai-runtime` — Python AI runtime for prompts, orchestration, provider adapters, and eval-related logic.
- `services/worker` — placeholder area for future dedicated worker-runtime code.

### `tools/`

Non-core client surfaces and capture helpers.

- `tools/browser-extension` — browser clipping surface.
- `tools/desktop-helper` — Tauri-based desktop helper for clipboard/screenshot capture and local bridge work.

### `packages/`

Shared code used by more than one surface.

- `packages/contracts` — shared TypeScript contracts and schema-like client/server types.

### Other important roots

- `docs` — runbooks, status docs, release checklists, and implementation guides.
- `scripts` — local automation, smoke flows, helper tooling, and workitem coordination scripts.
- `artifacts` — captured validation output, screenshots, release evidence, and proof bundles.
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026` — current external design source of truth for April 2026 observatory work; older in-repo design folders were intentionally removed.

## Frontend surfaces

### `apps/web`

Use this workspace when you are changing the synced PWA experience.

Key responsibilities:

- assistant/chat workspace
- artifact and note/task/calendar views
- search, sync, review, and portability surfaces
- offline browser caching and optimistic update flows
- installable PWA behavior and share-target support

Typical places to inspect:

- `apps/web/app/` — route-level UI, shared components, layout, and route-local client logic
- `apps/web/app/lib/` — browser-side helpers such as API clients, caches, snapshots, search helpers, and shared formatting/state utilities
- `apps/web/tests/` — Playwright coverage for the PWA

Start here for:

- chat and thread presentation
- artifact views and inline card rendering
- provider/settings UI
- offline/sync UX
- PWA design-system work

### `apps/mobile`

Use this workspace when you are changing the native Android-first companion.

Key responsibilities:

- quick capture and share-intent intake
- alarm scheduling and offline briefing playback
- mobile review and triage flows
- phone-local voice capture and route selection
- device-local persistence and native integrations

Typical places to inspect:

- `apps/mobile/App.tsx` — current top-level app shell and major screen flows
- `apps/mobile/local-stt.*` and related helpers — speech-recognition probes and local mobile voice helpers
- `apps/mobile/android/` — generated/native Android project for dev-build and device validation work

Start here for:

- capture UI and share handling
- phone-specific state/persistence
- alarm, audio, and briefing playback behavior
- Android device validation

## Backend surfaces

### `services/api`

This is the system of record. It owns persisted domain state and the HTTP contract used by the web,
mobile, and helper clients.

Key responsibilities:

- auth and bootstrap/login
- capture ingestion and artifact storage
- notes, tasks, calendar, planning, and review APIs
- sync, export/import, and backup endpoints
- tool catalog and guarded action execution
- job queues and worker-facing lifecycle endpoints

Typical places to inspect:

- `services/api/app/` — route handlers, schemas, service logic, and core application wiring
- `services/api/tests/` — API and behavior tests
- `services/api/alembic*` or schema/bootstrap code — storage setup and migrations where present

Start here for:

- changing an HTTP endpoint
- modifying persistence or domain schemas
- adding new tool execution paths
- connecting product surfaces to stored Starlog data

## AI surfaces

### `services/ai-runtime`

This is the separate Python runtime for AI-specific workflows. It should own prompts, orchestration,
provider adapters, and evaluation support instead of scattering AI logic into the API layer.

Key responsibilities:

- prompt loading and workflow assembly
- provider/model adapters
- chat-turn and briefing generation
- research summarization/ranking flows
- eval fixtures and smoke workflows

Typical places to inspect:

- `services/ai-runtime/runtime_app/` — runtime application entrypoints and workflow wiring
- `services/ai-runtime/tests/` — runtime tests
- `services/ai-runtime/evals/` — eval inputs, goldens, and quality fixtures
- `services/ai-runtime/scripts/` — smoke scripts and developer utilities

Start here for:

- model selection/routing behavior
- prompt edits
- AI workflow contracts
- research and briefing generation logic

## Capture and helper tooling

### `tools/browser-extension`

Use this for browser-native clipping and extension packaging.

Start here for:

- extension capture UI
- page selection/send-to-Starlog flow
- extension auth/base-URL configuration

### `tools/desktop-helper`

Use this for the cross-platform desktop helper.

Key responsibilities:

- quick clipboard/screenshot capture
- helper diagnostics and recent capture history
- desktop-local bridge discovery and host integration
- Tauri packaging and platform-specific helper behavior

Typical places to inspect:

- `tools/desktop-helper/src/` — frontend markup, styling, and helper UI logic
- `tools/desktop-helper/src-tauri/` — Tauri/native host integration
- `tools/desktop-helper/tests/` — helper Playwright coverage

Start here for:

- quick popup and workspace UI
- desktop capture metadata
- native host permissions/problems
- helper packaging/distribution flows

## Shared contracts and scripts

### `packages/contracts`

Use this when two or more TypeScript surfaces need a stable shared contract.

Typical use cases:

- request/response payload typing
- shared artifact/task/calendar structures
- client/server alignment work

### `scripts`

Use this directory before inventing a new helper. Many recurring operations already have a script.

Common categories:

- workitem/lock coordination
- Android smoke and dev-client launch helpers
- AI worker and smoke utilities
- PWA release or hosted validation flows
- desktop-helper packaging helpers

## Documentation and evidence

### `docs`

Use `docs/` for human-readable runbooks and status material, not for duplicate source-of-truth logic.

Examples:

- setup guides
- release checklists
- validation matrices
- implementation-status snapshots
- operator runbooks

### `artifacts`

Use `artifacts/` for generated evidence rather than prose guidance.

Examples:

- screenshots
- smoke logs
- exported proof bundles
- release artifacts

## How to decide where a change belongs

- If it changes what the user sees in the PWA, start in `apps/web`.
- If it changes what the phone app does or how device features are used, start in `apps/mobile`.
- If it changes stored domain behavior or HTTP APIs, start in `services/api`.
- If it changes prompts, models, or workflow orchestration, start in `services/ai-runtime`.
- If it changes capture helpers outside the core web/mobile apps, start in `tools/`.
- If multiple TypeScript surfaces need the same contract, check `packages/contracts`.
- If the task is operational or validation-oriented, inspect `scripts/` and `docs/` before adding new code.

## Recommended reading order for new contributors

1. `AGENTS.md` for repo rules, lock workflow, and validation runbooks.
2. `README.md` for product-level setup and surface overview.
3. `docs/IMPLEMENTATION_STATUS.md` for the current shipped snapshot.
4. This file for code ownership and navigation.
5. The specific surface runbook that matches your task, such as Android, desktop helper, or PWA release docs.
