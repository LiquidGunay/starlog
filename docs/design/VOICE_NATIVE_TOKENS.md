# Voice-Native Tokens And Implementation Guidance

## CSS Token Baseline

```css
:root {
  --sl-color-bg-0: #081218;
  --sl-color-bg-1: #0f222a;
  --sl-color-bg-2: #16323b;
  --sl-color-surface: rgba(18, 33, 41, 0.78);
  --sl-color-surface-strong: rgba(28, 48, 58, 0.9);
  --sl-color-border: rgba(115, 224, 209, 0.18);
  --sl-color-border-strong: rgba(115, 224, 209, 0.35);
  --sl-color-text: #f4efe4;
  --sl-color-text-dim: #b9c4c8;
  --sl-color-text-muted: #8fa0a8;
  --sl-color-accent: #73e0d1;
  --sl-color-accent-soft: #b8fff2;
  --sl-color-amber: #ffb24a;
  --sl-color-alert: #ff7a59;
  --sl-color-shadow: rgba(4, 10, 13, 0.5);

  --sl-radius-sm: 10px;
  --sl-radius-md: 16px;
  --sl-radius-lg: 24px;
  --sl-radius-pill: 999px;

  --sl-space-1: 4px;
  --sl-space-2: 8px;
  --sl-space-3: 12px;
  --sl-space-4: 16px;
  --sl-space-5: 24px;
  --sl-space-6: 32px;
  --sl-space-7: 48px;

  --sl-font-display: "Space Grotesk", sans-serif;
  --sl-font-body: "Manrope", sans-serif;
  --sl-font-mono: "JetBrains Mono", monospace;

  --sl-shadow-panel: 0 24px 80px rgba(4, 10, 13, 0.42);
  --sl-shadow-glow: 0 0 0 1px rgba(115, 224, 209, 0.12), 0 18px 40px rgba(115, 224, 209, 0.08);
}
```

## Typography Scale

- `display-1`: 52/56, `Space Grotesk`, 600
- `display-2`: 40/44, `Space Grotesk`, 600
- `section-title`: 24/30, `Space Grotesk`, 600
- `card-title`: 18/24, `Space Grotesk`, 600
- `body-lg`: 16/24, `Manrope`, 500
- `body-md`: 14/21, `Manrope`, 500
- `meta`: 11/16, `JetBrains Mono`, 500, uppercase, tracking `0.12em`

## Component Guidance

### Transcript shell

- transcript column should dominate width on desktop
- max readable text width: `72ch`
- turn spacing should be generous; avoid compressed chat bubbles
- cards should align to transcript rhythm, not break it

### Voice controls

- primary voice button uses accent fill or accent ring, never a generic FAB purple
- active capture state gets amber waveform and stronger glow
- idle voice control should look ready, not shouting for attention

### Structured cards

- header band: mono metadata + category chip
- body: one clear decision or summary
- footer: one primary action, up to two secondary actions
- provenance must always be visible but low emphasis

### Side panes

- support-only by default
- lower contrast than main transcript canvas
- can contain queues, diagnostics, or recent entities
- should visually collapse away without breaking the main composition

## Background System

Layer the background in three passes:

1. radial glow anchored near the transcript input area
2. low-opacity grid or radar arcs
3. one slow atmospheric gradient drifting behind the main surface

The background should be noticeable only in peripheral vision.

## Motion Tokens

- `panel-enter`: `180ms`, ease-out, opacity + translateY(8px)
- `card-expand`: `220ms`, ease-out
- `voice-pulse`: `1200ms`, ease-in-out
- `status-sweep`: `1800ms`, linear, subtle only

Motion rules:

- system states should animate once when they change
- ambient motion can loop slowly
- action feedback should finish quickly

## Implementation Rules For Frontend Workers

- Do not use default Inter/Arial/system UI stacks when creating new major surfaces.
- Do not reintroduce violet as the dominant accent.
- Keep transcript surfaces brighter than support panes.
- Prefer one decisive primary action per card.
- Every new voice affordance must expose a visible transcript equivalent.
- Avoid generic dashboard tiles unless they are embedded as cards inside the conversation.
