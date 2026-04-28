# Assistant Event Visibility Policy

Assistant surface events record what happened outside the main chat thread and how the
assistant should surface it. Callers provide a requested visibility, but the backend
resolves that request through `services/api/app/services/assistant_event_policy.py`
before persisting the event.

| Signal | Resolved visibility |
| --- | --- |
| `assistant.card.action_used` | `internal` |
| `assistant.recommendation.deferred` | `internal` |
| `capture.enriched`, `artifact.opened`, `artifact.summarized` | `ambient` |
| `capture.untriaged` | `ambient` |
| `task.created`, `task.completed`, `task.snoozed` | `ambient` |
| `time_block.started`, `time_block.completed` | `ambient` |
| `planner.conflict.resolved`, `planner.conflict.cleared` | `ambient` |
| `review.session.started`, `review.answer.graded` | `ambient` |
| `briefing.played`, `assistant.panel.submitted`, `voice.capture.transcribed` | `ambient` |
| Unknown event with requested `assistant_message` | `assistant_message` |
| `task.missed`, `commitment.overdue` | `assistant_message` |
| `review.repeated_failure` | `assistant_message` |
| `project.stale`, `goal.stale` | `assistant_message` |
| `capture.created`, `planner.conflict.detected` | `dynamic_panel` |
| `review.answer.revealed`, `briefing.generated` | `dynamic_panel` |

`internal` is always honored exactly so callers can record events without thread
projection. `assistant_message` is policy-routable: known dynamic-panel events resolve
to `dynamic_panel`, while unknown events remain plain assistant messages.

Proactivity is bounded by default. The assistant may prepare suggestions, but background
signals should not become random interruptions. `capture.untriaged` is only `ambient` so
delayed capture cleanup does not become a hard interrupt beyond the existing
`capture.created` action case. Missed tasks, overdue commitments, repeated review
failures, and stale projects or goals may become `assistant_message` entries because they
need human attention, but stale project and goal signals are intended for weekly review
or planning contexts rather than dynamic panels. `assistant.recommendation.deferred`
stays `internal` because it records scheduler/orchestration restraint; surfacing it would
itself become a recommendation.

When adding an event kind, add it to the policy table if it should be user-visible by
default or if an `assistant_message` request should be upgraded to a dynamic panel. Keep
low-noise lifecycle updates as `ambient`, reserve `dynamic_panel` for high-confidence
action cases such as capture creation, unresolved planner conflict detection, review
reveal, and briefing focus, and add resolver tests for the new behavior.
