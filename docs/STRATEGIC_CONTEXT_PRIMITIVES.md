# Strategic Context Primitives

Starlog v1 keeps a lightweight strategic context layer so Assistant can later reason about what should move forward now without overloading tasks, notes, or calendar events.

This layer has three durable backend primitives:

- `goals`: longer-lived direction with a horizon, rationale, success criteria, status, review cadence, and optional last-reviewed timestamp.
- `projects`: active bodies of work that can optionally link to a goal and a next task action while tracking current state, desired outcome, open questions, and risks.
- `commitments`: explicit promises or obligations from Assistant, captures, tasks, or other sources, with optional recipient, due date, status, and recovery plan.

The v1 API foundation exposes basic list/create/update routes at `/v1/goals`, `/v1/projects`, and `/v1/commitments`. The tables intentionally mirror the existing single-user backend style and do not add a new ownership model.

Assistant card projection helpers can emit the existing contract kinds `goal_status`, `project_status`, and `commitment_status`. This is only contract support. This PR does not wire goals, projects, or commitments into Assistant recommendation ranking, proactive prioritization, Planner redesign, or automatic "what should I move forward now?" selection.
