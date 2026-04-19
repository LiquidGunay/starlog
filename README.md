# Starlog

Starlog is a single-user assistant for capture, planning, review, and follow-up.

The product is organized around one persistent Assistant thread. `Library`, `Planner`, and
`Review` are support views for deeper work, not separate products.

Current install/setup handoff:

- [docs/STARLOG_SETUP_GUIDE.md](/home/ubuntu/starlog/docs/STARLOG_SETUP_GUIDE.md)

## What You Use

- `Assistant`: the primary thread for commands, follow-up questions, confirmations, and returned cards
- `Library`: notes, captures, saved artifacts, and source history
- `Planner`: tasks, schedule, briefings, and time blocks
- `Review`: flashcards and recall sessions
- `Desktop helper`: a capture companion for clipboard and screenshot intake on laptop

## First-Time Use

For a first-time user, the normal path is:

1. Open the web app at `/assistant`.
2. If this is a new Starlog instance, choose `Set Up Starlog` and create a passphrase with at least 12 characters.
3. Sign in with that same passphrase.
4. Start in the Assistant thread with a plain command such as:
   - `summarize latest artifact`
   - `create task Review project notes tomorrow at 10`
   - `make cards from the last capture`
5. Use the cards returned in chat to jump into `Library`, `Planner`, or `Review` when you need a deeper surface.

Important:

- Starlog is single-user today.
- Do not commit passphrases, bearer tokens, API keys, or bridge tokens into this repo.

## Everyday Workflow

The intended flow is simple:

1. Capture something.
   Use the web app, the mobile app, the desktop helper, or a share/deep-link path.
2. Ask Assistant to do the next step.
   Summarize it, make cards, create a task, plan time, or pull related context.
3. Open a support view only when needed.
   `Library` for artifact/note inspection, `Planner` for scheduling, `Review` for recall sessions.

## Native Mobile

The native mobile app is the first-class mobile client.

Tabs:

- `Assistant`
- `Library`
- `Planner`
- `Review`

Use mobile for:

- quick capture
- voice input
- in-thread Assistant actions
- review on the go
- editable morning briefing drafts
- native alarm and local TTS briefing playback

## Self-Host Starlog

Starlog is designed so the web app and API can be self-hosted together.

The PWA talks to the API you run. The native mobile app and desktop helper can then point at that same deployment, whether you host it locally, on Railway, or somewhere else.

### Prerequisites

- `Node.js` + `pnpm`
- `Python 3.12+`
- [`uv`](https://docs.astral.sh/uv/)

### Start The Full Local Stack In One Command

From repo root:

```bash
./scripts/dev_stack.sh
```

This command:

- installs or refreshes workspace dependencies with `pnpm install`
- syncs the API environment with `uv sync --project services/api --extra dev`
- starts the API on `http://0.0.0.0:8000`
- starts the PWA on `http://localhost:3000`

For phone or LAN testing, use:

```bash
./scripts/dev_stack.sh --lan
```

That keeps the API on `http://0.0.0.0:8000` and exposes the PWA on `http://0.0.0.0:3000`.

Press `Ctrl-C` once to stop both services.

If you prefer aliases, `make dev-stack`, `make dev-stack-lan`, `pnpm dev:stack`, and `pnpm dev:stack:lan` point to the same flow.

### Manual Start Commands

If you prefer to run each service yourself:

Install dependencies:

```bash
pnpm install
uv sync --project services/api --extra dev
```

Run the API:

```bash
uv run --project services/api uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir services/api
```

Run the PWA:

```bash
pnpm --filter web dev
```

For LAN access to the PWA, use:

```bash
pnpm --filter web dev -- --hostname 0.0.0.0 --port 3000
```

### Production-Style Web Hosting

Build:

```bash
pnpm --filter web build
```

Run:

```bash
pnpm --filter web start
```

The production web server uses the Next.js app in `apps/web`.

The API can be hosted anywhere that can run the FastAPI service in `services/api`.

### First Sign-In On A Self-Hosted Instance

1. Open the web app.
2. Set API base to your API URL, for example `http://localhost:8000`.
3. Click `Set Up Starlog` if this is a new instance.
4. Sign in with the passphrase you just created.
5. Go to `/assistant` and start using the thread.

## Mobile And Phone Testing

For LAN testing from your phone, use:

- web app: `http://<YOUR_LAN_IP>:3000`
- API: `http://<YOUR_LAN_IP>:8000`

Detailed setup:

- [docs/PHONE_SETUP.md](/home/ubuntu/starlog/docs/PHONE_SETUP.md)
- [docs/ANDROID_DEV_BUILD.md](/home/ubuntu/starlog/docs/ANDROID_DEV_BUILD.md)

## Desktop Helper

The desktop helper is a capture-first companion, not a second full client.

Use it for:

- clipboard capture
- screenshot capture
- recent capture review
- `Open in Library`
- `Ask Assistant`

Setup and release docs:

- [docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md](/home/ubuntu/starlog/docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md)
- [docs/STARLOG_SETUP_GUIDE.md](/home/ubuntu/starlog/docs/STARLOG_SETUP_GUIDE.md)
- [tools/desktop-helper/README.md](/home/ubuntu/starlog/tools/desktop-helper/README.md)

## Repo Entry Points

- product direction: [PLAN.md](/home/ubuntu/starlog/PLAN.md)
- repo rules: [AGENTS.md](/home/ubuntu/starlog/AGENTS.md)
- architecture/workflow plan: [docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md](/home/ubuntu/starlog/docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md)
