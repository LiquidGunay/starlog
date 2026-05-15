# Assistant Runtime Architecture Decision

Date: 2026-05-15
Workitem: WI-CHAT-OPTIONS-RECORD

## Decision

Starlog will adopt **assistant-ui** as the strategic web Assistant runtime/rendering
layer, while keeping the **Starlog assistant protocol** as the source of truth.

The canonical protocol remains Starlog-owned:

- server-owned threads, messages, runs, run steps, interrupts, surface events, ambient
  updates, attachments, and card projections
- shared contracts in `@starlog/contracts`
- Starlog-specific tool names and typed payloads
- Starlog API persistence and orchestration as the system of record

assistant-ui is the preferred frontend runtime for the desktop web Assistant because it
matches a server-owned external-store model and gives Starlog a mature thread/tool UI
foundation without making the frontend the owner of assistant state.

## Consequences

- The old custom chat renderer is transitional, not the target architecture.
- `content + cards + traces` compatibility can remain during migration, but new
  architecture work should move toward typed message parts, tool lifecycle, interrupts,
  and surface events.
- Starlog cards remain useful as summaries and compatibility projections, but they are
  not the control plane for structured interaction.
- The backend sends semantic tool and interrupt payloads. It must not send arbitrary
  JSX, HTML, or frontend component trees.
- Mobile must converge on the same Starlog assistant protocol, but the native mobile
  app remains the primary phone client. Mobile PWA work is fallback-only and should not
  absorb primary phone UX redesign effort.

## MCP Apps

MCP Apps are a useful product and integration pattern for typed tools, permissions,
external context, and app-scoped capabilities. They are **not** a v1 runtime dependency
for the Starlog Assistant UI.

Use MCP Apps as design inspiration where the pattern helps:

- named tools with stable schemas
- explicit capability boundaries
- user-visible authorization and confirmation points
- tool results that can be rendered consistently across clients

Do not require the Starlog assistant protocol or UI runtime to depend on MCP hosting,
MCP client availability, or a specific Apps SDK integration.

## Rejected Or Deferred Options

### Keep the custom chat renderer as the target

Rejected. The current renderer can bridge the migration, but keeping it as the target
would preserve the same architectural weakness: UI-bearing state would stay scattered
across message strings, cards, traces, and metadata instead of becoming a durable run
and message-part protocol.

### AG-UI

Deferred. AG-UI overlaps with the goal of agent/UI event protocols, but Starlog already
needs a domain-specific assistant protocol for durable artifacts, provenance, planner
state, review state, mobile parity, and one persistent thread. AG-UI may be useful as
future reference material, but it should not replace the Starlog protocol as the source
of truth for v1.

### CopilotKit

Rejected for the core Assistant runtime. CopilotKit is oriented toward embedding
copilot behavior inside an application. Starlog's Assistant is the primary operating
surface and requires server-owned persistence, cross-surface events, durable memory,
and native mobile convergence. Those requirements make CopilotKit a poor fit as the
central runtime, though individual ideas can still inform future UI affordances.

### Vercel AI Elements

Deferred. Vercel AI Elements can provide useful UI primitives, but primitives are not a
runtime architecture. Starlog needs server-owned threads, runs, interrupts, tool
lifecycle, and cross-client protocol compatibility. Elements may be used later for
isolated component inspiration if they do not conflict with the assistant-ui runtime
direction.

## Current Evidence Boundary

This decision is architectural direction plus a migration boundary, not a claim that
assistant-ui parity has shipped everywhere. Current working evidence is tracked in
[docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md).

Current status:

- Desktop web assistant-ui coverage is partial. It can adapt/render supported Starlog
  assistant protocol snapshots and dynamic panel parts, while unsupported or
  not-yet-migrated tool/message shapes continue through Starlog compatibility
  projections and existing fallback render paths.
- Native mobile must converge on the same Starlog assistant protocol. The React Native
  assistant-ui-style implementation is in progress, with view-model and panel-state
  coverage ahead of full installed-device dynamic-panel proof.
- The mobile PWA remains a fallback phone surface and a useful browser/viewport test
  target. It is not the primary mobile UX redesign target.

Current UI harnesses prove Starlog can render and submit structured assistant protocol
parts under mocked snapshots and interrupt APIs. They do not yet prove a live
LLM/Codex run can drive every dynamic panel or that native mobile has reached web
assistant-ui parity.
