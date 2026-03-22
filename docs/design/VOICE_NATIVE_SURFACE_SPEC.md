# Voice-Native Surface Spec

## Shared Product Rule

All three surfaces are part of one system. The user should feel like they are continuing the same conversation, not opening three unrelated apps.

## PWA Spec

Primary role:

- command center
- long-form transcript
- card inspection
- deep editing and review

Primary interactions:

- typed or voiced chat turns
- inline card actions
- side-pane inspection
- deep links into notes, tasks, artifacts, and planning

Layout rules:

- transcript column is the visual anchor
- side panes stay secondary and collapsible
- tool queues and diagnostics should not outrank the conversation

## Mobile Spec

Primary role:

- field capture
- morning briefing playback
- quick review and triage

Primary interactions:

- hold-to-talk
- one-tap capture follow-ups
- swipe or tap triage on concise cards
- alarm and playback flows

Layout rules:

- avoid multi-column layouts
- keep one main action per screen section
- emphasize transport controls, not admin controls

## Desktop Helper Spec

Primary role:

- fast local relay for capture and device context
- diagnostics and bridge health

Primary interactions:

- quick capture from popup
- open workspace/studio for diagnostics and history
- verify local bridge availability

Layout rules:

- popup stays minimal
- studio can be denser, but should still read as a relay console
- do not copy full PWA navigation into the helper

## Card Behavior Across Surfaces

- cards should preserve the same semantic structure everywhere
- mobile cards may collapse metadata
- desktop helper cards may focus on source context and routing status
- PWA cards may expand into richer multi-section layouts

## Voice Rules Across Surfaces

- hold-to-talk is the default everywhere
- spoken output should be short and interruptible
- all spoken output needs a text/transcript form
- capture state must be visibly distinct from idle and playback states

## PR Rules For Frontend Workers

- Use this package before inventing new colors, fonts, or card patterns.
- Keep chat/voice as the operating model; everything else is support.
- Match the moodboard atmosphere without cloning the old violet screens.
- If a proposed component cannot clearly live inside the conversation flow, question whether it should exist.
