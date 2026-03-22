# Voice-Native Moodboard

## Direction

Starlog should feel like a private orbital console: calm, high-signal, and slightly cinematic. The interface should read as a live command environment for memory, research, and planning, with the conversation thread at the center and everything else orbiting it as support systems.

The existing `screen_design` references are useful for:

- strong typographic hierarchy
- translucent control surfaces
- ambient sci-fi atmosphere
- explicit voice and system-readiness cues

The design package intentionally diverges from the earlier violet-heavy look. The repo-level frontend guidance says to avoid purple bias. The new direction keeps the same futuristic confidence but pivots toward deep ink, oxidized teal, ion amber, and bone-white contrast.

## Reference Anchors

Primary references in the repo:

- `screen_design/pwa/command_center_ai_agent_violet/code.html`
- `screen_design/mobile app/mobile_assistant_home/code.html`
- `screen_design/desktop_helper/starlog_helper_studio/code.html`

What to keep from them:

- uppercase navigation and instrumentation language
- glass panels over atmospheric backgrounds
- clear system-state chips and voice affordances
- strong separation between primary canvas and supporting telemetry

What to change:

- reduce violet saturation and shift to a cooler teal-led palette
- remove “dashboard clutter” density
- make transcript and cards feel more editorial and less admin-console
- make voice controls feel like a first-class instrument, not a floating gimmick

## Palette

Core colors:

- `Void Ink` `#081218`
- `Deep Current` `#0F222A`
- `Relay Teal` `#73E0D1`
- `Signal Mint` `#B8FFF2`
- `Solar Amber` `#FFB24A`
- `Alert Coral` `#FF7A59`
- `Archive Bone` `#F4EFE4`
- `Fog Slate` `#8FA0A8`

Usage:

- backgrounds are layered dark blues and blue-greens, not flat black
- primary emphasis comes from teal/mint
- amber marks timing, pending action, or spoken-output state
- coral is reserved for destructive or urgent states
- bone-white is used sparingly for the most important text

## Materials

Primary surfaces:

- frosted-glass panels with low-opacity tint
- soft inner glow instead of hard neon borders
- subtle starfield, grid, or radar-line atmosphere in the background
- rounded but not bubbly geometry; panels should feel engineered

Texture rules:

- avoid large flat blank areas
- prefer layered depth with haze, gradients, and faint telemetry lines
- keep noise restrained so text remains easy to scan

## Typography

Type pairing:

- display/headline: `Space Grotesk`
- body/interface text: `Manrope`
- code/status/telemetry: `JetBrains Mono`

Typographic behavior:

- headlines are confident, short, and high-contrast
- labels are uppercase, tracked, and low-volume
- transcript text should be comfortable and editorial, not terminal-like
- telemetry and IDs use mono sparingly

## Primary Visual Motifs

### 1. Transcript as command stream

The conversation thread is the main visual spine. It should feel like an annotated mission log:

- user turns: denser, sharper cards
- assistant turns: broader, more compositional blocks
- structured cards: embedded modules with clear actions

### 2. Voice as an instrument

Voice UI should feel tactile:

- hold-to-talk states expand and pulse
- waveform or spectral indicators appear only while relevant
- reply playback should look like a short transmission, not a media player

### 3. Cards as deployable modules

Cards for notes, tasks, research, and briefings should look like mission inserts:

- compact header strip
- clear content payload
- one primary action and a small number of secondary actions
- provenance and timing shown in a low-volume metadata row

## Motion

Motion should signal system intent, not decorate.

Use:

- slow ambient background drift
- subtle waveform pulse on voice capture
- card reveal with short upward fade
- thin sweep animation on active system chips

Avoid:

- bouncy spring-heavy motion
- constant looping ornaments
- exaggerated hover effects

## Surface Mood Split

### PWA

- should feel like the full command deck
- large transcript canvas
- side panes are secondary and collapsible
- cards can expand into deep linked workspace views

### Mobile

- should feel like a field communicator
- bigger voice affordances
- fewer simultaneous panels
- stronger emphasis on alarms, capture, and spoken briefing playback

### Desktop helper

- should feel like a compact relay console
- quick capture remains minimal
- studio/workspace mode can show diagnostics and recent context
- should visually relate to the main system without copying the whole PWA

## Frontend Rules

- Start every major surface from the transcript or voice action, not from a grid of tools.
- One accent family only: teal/mint for positive action, amber for timing/output, coral for danger.
- Default to depth and atmosphere over flat fills.
- Keep labels short, system-like, and intentionally named.
- Every visible control should answer one of three questions: speak, inspect, or confirm.
