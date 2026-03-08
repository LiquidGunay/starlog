# Starlog v1 Plan (Revised): Clip-First Knowledge + Scheduling System

## Brief summary
Build Starlog as a **web-first workspace + focused companion app** with a **clip-first knowledge graph**:

- **PWA (primary workspace):** full notes, summaries, cards, tasks, calendar, planning, deep review.
- **Mobile app (focused utility):** capture/share, alarms + offline spoken briefing playback, quick review/triage.
- **Desktop clipping tools:** browser extension + cross-platform desktop helper (Tauri) for clipping from any app (including terminal via copy/screenshot).
- **Single-user, low-cost backend:** FastAPI + SQLite on Railway, local-first client caches, deterministic export.
- **AI policy:** manual quick-action triggers, strict on-device OCR, STT/TTS on-device first, LLM with local/Codex/API fallback.

---

## Product decisions locked for v1

- App shape: **Web app + PWA** + **companion mobile app** (iOS + Android personal beta).
- Sync: **Railway backend** with local caches on devices.
- Scope: **Balanced MVP** (knowledge + SRS + tasks/calendar + alarms/briefing).
- Auth: **Single-user passphrase login**.
- Calendar: **Internal calendar + two-way Google Calendar sync**.
- Alarm routine: **Morning alarm + spoken brief**, audio generated/cached ahead of time.
- Automation policy: **Suggest-first / button-triggered** (no default auto-processing).
- Clipping: **Browser clipper + cross-platform desktop helper + mobile share capture**.
- Knowledge linkage: **Artifact graph model** with versioned derived outputs.
- Export: **Markdown + JSON full export**.
- AI: **Best-effort local bridge + fallbacks**, with Codex-subscription path treated as optional/experimental.

---

## Architecture (decision-complete)

### 1) Clients and responsibilities

#### PWA (primary workspace)
- Full note editing (desktop + mobile browser when needed).
- Artifact inbox triage and processing actions.
- Summary/note/card/task graph navigation.
- SRS review dashboard and deep study sessions.
- Calendar/time-block planning and sync controls.
- Search across notes/transcripts/OCR text.

#### Mobile app (focused companion)
- Share-sheet capture (text/url/image/file/audio).
- Quick typed capture + inbox triage.
- Alarm scheduling and **offline** morning briefing playback.
- Quick SRS review session.
- Launch/open PWA for deep editing/planning.

#### Desktop helper (Tauri, cross-platform)
- Global hotkeys:
  - Clip from clipboard/selection (for terminal/other apps).
  - Screenshot region/window -> local OCR -> Starlog artifact.
- App/window metadata capture (app name/window title/timestamp).
- Queued upload to Starlog sync API.

#### Browser extension
- Clip selection, full page, image, link with metadata.
- Save raw HTML + normalized text snapshot.
- “Send to existing note” and “Create new artifact” actions.

---

## Clip-first knowledge model

### Core model additions/locking
- `Artifact` is the root object for every clip/capture.
- Derived objects are explicitly linked with typed relations:
  - `Artifact -> SummaryVersion`
  - `Artifact -> NoteBlock`
  - `Artifact -> CardSetVersion`
  - `Artifact -> TaskSuggestionSet`
- No hidden coupling via tags only; provenance is explicit.

### Required source fidelity
For each clip, store:
- **Raw source** (e.g., HTML, image binary, original text payload).
- **Normalized source** (cleaned text/metadata/structure).
- **Extracted source** (OCR/transcript output).
- Checksums + timestamps + source metadata for traceability.

### Versioning behavior
- Re-running summarize/cards on same artifact creates new immutable versions.
- Prior versions remain queryable/comparable.
- UI shows latest by default, with version history panel.

---

## AI runtime and orchestration policy

### Trigger model
- Default is **manual quick-action buttons** on each artifact:
  - `Summarize`
  - `Create cards`
  - `Generate tasks`
  - `Create/append note`
- Optional batch actions from inbox, still user-initiated.

### Runtime policy by capability
- OCR: **strict on-device only** (no server/API OCR).
- STT/TTS: on-device first; user-configurable fallback allowed.
- LLM tasks: provider chain
  1. local model (if configured),
  2. Codex bridge (best effort),
  3. API-key provider fallback.
- All AI-capable features should share a **capability-level ordered execution policy** so phone, laptop, and backend can prefer:
  1. on-device execution,
  2. queued local batch bridge,
  3. server-local runtime,
  4. remote bridge,
  5. API fallback.
- The same policy object should be editable by the user and readable by future chat/voice interfaces.

### Codex subscription integration
- Implement as **experimental provider adapter** behind feature flag.
- Design for “best effort”, never as sole required path.
- Guaranteed product availability via supported fallback providers.

---

## Data + sync + backend

- Backend: Python FastAPI + worker + SQLite (Railway volume).
- Client local-first caches:
  - PWA: IndexedDB + mutation queue.
  - Mobile: local SQLite + mutation queue.
- Sync protocol:
  - `push` idempotent mutation batches,
  - `pull` by cursor with incremental deltas.
- Conflict rule: field-level last-write-wins + conflict log entry for review.
- Daily backup + restore drill support.

---

## Public APIs / interfaces (important additions)

### New/updated domain types
- `Artifact`
- `SummaryVersion`
- `CardSetVersion`
- `ArtifactRelation`
- `CaptureSource` (`browser_ext`, `desktop_helper`, `mobile_share`, etc.)
- `ProcessingRun` (action, provider, prompt version, output refs, trace id)

### Key endpoints
- `POST /v1/capture` (accepts source metadata + raw payload refs)
- `POST /v1/artifacts/:id/actions/summarize`
- `POST /v1/artifacts/:id/actions/cards`
- `POST /v1/artifacts/:id/actions/tasks`
- `GET /v1/artifacts/:id/graph`
- `GET /v1/artifacts/:id/versions`
- Existing sync/tasks/calendar/review endpoints remain; now relation-aware.

### Agent-control surface (new v1 addition)
- Every meaningful Starlog action should remain reachable through a stable programmatic interface, not only click-driven UI.
- The backend should expose a tool catalog with machine-readable schemas so LLM/chat/voice interfaces can call Starlog actions directly.
- Minimum v1 tool coverage:
  - capture text as artifact
  - list artifacts and inspect artifact graph
  - run artifact actions (`summarize`, `cards`, `tasks`, `append_note`)
  - create/update/list/get note
  - create/update task
  - list tasks
  - create calendar event
  - list calendar events
  - generate time blocks
  - generate briefing
  - schedule morning briefing alarm
  - get/set execution policy
  - list due cards
  - submit review
  - search Starlog
- v1 should include a thin typed-command assistant over that tool layer so core workflows are usable without clicking through the UI.
- v1 should also support queued voice commands by running STT first, then feeding the transcript into the same command planner/tool layer.
- Tool definitions should be exportable in an LLM-friendly schema format (OpenAI function-style or equivalent).

### Assistant shell additions
- Provide `POST /v1/agent/command` as a deterministic typed-command planner/executor over the tool layer.
- Provide `POST /v1/agent/command/voice` for queued voice commands that transcribe locally/batch-locally, then run the same command planner.
- Both mobile companion and PWA should surface this assistant shell so phone and laptop have the same command-oriented interface.
- Assistant history should be visible in the client and show planned steps, executed tools, and final result status.

### Desktop/helper local interface
- Local authenticated bridge from helper/extension to API client layer.
- Signed session token + short TTL for helper-origin calls.
- Offline queue contract with retry + dedupe key.

---

## Delivery phases

1. **Foundation**
   - Monorepo setup, auth, sync core, schema migrations, logging/metrics.
2. **Clip infrastructure**
   - Artifact model, browser extension, Tauri helper, mobile share capture.
3. **Knowledge graph + actions**
   - Artifact graph viewer, manual quick actions, versioned outputs.
4. **SRS core**
   - Native scheduler, card types, review flow, provenance surfaces.
5. **Tasks + calendar**
   - Internal planning model + two-way Google sync + time-block rules.
6. **Alarms + briefing**
   - Nightly brief generation/cache + mobile offline playback.
7. **AI provider layer hardening**
   - Local providers, Codex experimental adapter, API fallback routing.
8. **Export/backup hardening**
   - Deterministic Markdown+JSON export + restore validation.

---

## Test cases and scenarios

### Clipping and provenance
- Browser clip creates artifact with raw+normalized+extracted layers.
- Desktop screenshot clip OCR runs locally and indexes text.
- Terminal copy clip preserves app/window metadata.
- Artifact graph correctly links summary/note/cards/tasks.
- Re-run actions produce new versions without overwriting prior outputs.

### App split behavior
- Deep note editing works in mobile PWA.
- Mobile app handles capture/alarm/quick review flows without deep editor dependency.
- “Open in PWA” handoff from app works with same account/session.

### Alarm + offline brief
- Nightly generation caches briefing audio on phone.
- Morning playback succeeds in airplane mode.
- Missing audio gracefully falls back to text notification.

### AI routing and policy
- OCR never leaves device (policy test).
- STT/TTS prefer local runtime.
- LLM provider fallback chain executes deterministically on failures.

### Calendar/tasks/SRS
- Two-way Google sync create/update/delete + conflict handling.
- Time-blocking avoids overlaps and schedules estimates.
- SRS daily queue deterministic for fixed review history.

### Portability/reliability
- Full export contains all entities + IDs + relations + media manifest.
- Re-import verification script confirms counts and relation integrity.
- Backup restore recovers functioning system.

---

## Assumptions and defaults

- Desktop helper “cross-platform” means **macOS + Windows** in v1; Linux deferred.
- Browser extension v1 targets Chromium-based browsers first.
- Single-user system only; no multi-tenant roles.
- Railway hosts Starlog backend; heavy AI execution is mostly client-side.
- Codex subscription adapter is optional/experimental, not guaranteed SLA.
- If Codex path unavailable, Starlog remains fully usable via local or API-key providers.
