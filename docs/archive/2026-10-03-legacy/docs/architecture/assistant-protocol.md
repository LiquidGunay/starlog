# Assistant Protocol Architecture

The Starlog assistant protocol is the durable contract between clients, API persistence, AI
orchestration, and Starlog domain surfaces.

## Canonical Objects

- **Thread:** the single persistent user conversation across clients.
- **Message:** user, assistant, system, or tool-facing record with typed parts.
- **Run:** one assistant execution attempt tied to thread state and provider/tool activity.
- **Run step:** persisted lifecycle unit for model deltas, tool calls, tool results, interrupts, and
  guarded writes.
- **Surface event:** cross-surface signal that links Assistant activity to Library, Planner, Review,
  capture helpers, and mobile/desktop handoffs.
- **Attachment:** artifact, source, file, clip, image, audio, or structured payload reference.
- **Projection:** compatibility summary/card derived from canonical protocol state.

## Message Parts And Events

New protocol work should prefer typed parts over encoded UI strings:

- text and transcript parts
- attachment references
- tool call and tool result parts
- dynamic panel or card projection references
- entity links into `Assistant`, `Library`, `Planner`, and `Review`
- interrupt and confirmation prompts
- ambient status updates

The backend may send semantic payloads and stable identifiers. It must not send arbitrary JSX, HTML,
or frontend component trees.

## Confirmation And Proactivity

Proactive behavior can prepare suggestions and candidate writes. Major writes require explicit user
confirmation through a persisted interrupt or guarded action. The confirmation event becomes part of
the run history.

## Provenance

Assistant outputs that summarize, classify, extract, or generate cards must preserve source links:

- raw source
- normalized source
- extracted text/metadata
- derived summary/card versions
- user edits and later regenerated versions

See [diagrams/data-provenance.mmd](diagrams/data-provenance.mmd).

## Compatibility

Older `content + cards + traces` views are migration projections. They can remain as fallback
rendering paths, but durable storage and new cross-client work should be protocol-first.
