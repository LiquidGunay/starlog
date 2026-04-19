# Chat UI Moodboard

This document is the active design reference for the Starlog Assistant chat overhaul on mobile and web. It replaces the April 2026 pack as the primary source of truth for current chat-first implementation work.

Reference implementation:
- [apps/web/app/design/chat-moodboard/page.tsx](/home/ubuntu/starlog/apps/web/app/design/chat-moodboard/page.tsx)

Soft historical input only:
- `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/**`

## Visual thesis

Build Starlog chat as a nocturnal instrument panel rather than a pastel concept mock.

- Mood: cinematic, calm, intelligent, tactile
- Material: smoked glass, dark alloy, warm signal light, paper-like type contrast
- Energy: precise and alive, not glossy, cute, or neon-gaming

The interface should feel like one continuous conversation surface with docked tools, not stacked cards floating on a generic app background.

## Content plan

1. Presence: the thread itself is the hero
2. Support: artifacts, tool traces, and actions appear as attached context
3. Detail: motion, typography, and spacing communicate state changes
4. Conversion: the composer remains the most obvious affordance at rest

## Interaction thesis

- Message clusters should settle into place with short upward motion and opacity, as if entering a physical light cone.
- The composer should behave like a docked command rail with clear idle, listening, and sending states.
- Secondary surfaces should slide, peel, or lift from the edge rather than popping as independent cards.

## Material system

### Palette

- Base 01: obsidian ink
- Base 02: graphite plum
- Base 03: smoked violet haze
- Accent 01: rose signal
- Accent 02: ember copper
- Accent 03: electric ice for rare system highlights only

### Surfaces

- Primary canvas: near-black with tonal depth, not flat black
- Thread layers: low-contrast glass and mist, separated by blur, shadow, and edge light
- Borders: sparse hairlines only where needed for alignment or docking
- Cards: reserved for artifact payloads and deliberate interactions, never default wrappers

### Typography

- Display voice: editorial serif or high-character humanist for key product moments
- Working voice: disciplined sans for thread text, metadata, and controls
- Hierarchy should come from size, spacing, and tone before extra color or chrome

## Conversation anatomy

- Assistant messages should read as anchored slabs of content, not generic rounded chat bubbles.
- User messages should be tighter and more directional, with stronger contrast and cleaner alignment.
- Attached artifact payloads should feel embedded under assistant turns with shared rhythm and edge geometry.
- Tooling, latency, and draft states should appear as subtle rails, pulses, or inline markers instead of diagnostic boxes.

## Motion and behavior

- Use staggered entrances for initial thread hydration.
- Let long threads build depth through fade and compression rather than hard dividers.
- Animate composer state changes with shape and glow shifts, not spinner-heavy UI.
- Avoid ornamental particle motion, oversized parallax, or decorative gradient sweeps.

## Component guardrails

- Overhaul component structure where needed; do not treat this effort as a reskin of current bubbles and cards.
- Prefer docked layout, grouped messages, and integrated attachments over standalone card stacks.
- Preserve chat-first behavior, persistent-thread semantics, and explicit-confirmation product rules.
- Maintain a shared visual language across native mobile and web PWA, with platform-specific ergonomics handled through spacing and controls rather than separate themes.

## Rejection criteria

- Pastel-purple concept styling with low contrast
- Generic messaging-app bubbles copied into Starlog
- Thick bordered cards around every region
- Decorative gradients used as the main visual idea
- Diagnostics visually competing with the conversation
- Mobile and web drifting into different visual systems
