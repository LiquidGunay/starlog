# Assistant Event Visibility Policy

Assistant surface events record what happened outside the main chat thread and how the
assistant should surface it. Callers provide a requested visibility, but the backend
resolves that request through `services/api/app/services/assistant_event_policy.py`
before persisting the event.

| Signal | Resolved visibility |
| --- | --- |
| `assistant.card.action_used` | `internal` |
| `capture.enriched`, `artifact.opened`, `artifact.summarized` | `ambient` |
| `task.created`, `task.completed`, `task.snoozed` | `ambient` |
| `time_block.started`, `time_block.completed` | `ambient` |
| `review.session.started`, `review.answer.graded` | `ambient` |
| `briefing.played`, `assistant.panel.submitted`, `voice.capture.transcribed` | `ambient` |
| Unknown event with requested `assistant_message` | `assistant_message` |
| `capture.created`, `planner.conflict.detected` | `dynamic_panel` |
| `review.answer.revealed`, `briefing.generated` | `dynamic_panel` |

`internal` is always honored exactly so callers can record events without thread
projection. `assistant_message` is policy-routable: known dynamic-panel events resolve
to `dynamic_panel`, while unknown events remain plain assistant messages.

When adding an event kind, add it to the policy table if it should be user-visible by
default or if an `assistant_message` request should be upgraded to a dynamic panel. Keep
low-noise lifecycle updates as `ambient`, reserve `dynamic_panel` for events that need
explicit user action, and add resolver tests for the new behavior.
