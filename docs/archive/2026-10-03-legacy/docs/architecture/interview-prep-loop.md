# Interview Prep Loop Architecture

The interview prep loop is Starlog's learning-engine slice: ingest learning material, preserve
provenance, gate review by topic readiness, schedule practice, and feed progress back into planning.

## Loop

1. **Ingest:** imports or captures create source artifacts from curated decks, PDFs, clips, or user
   notes.
2. **Normalize and extract:** source text, sections, topics, chunks, and metadata are preserved with
   source fidelity.
3. **Generate study material:** cards, notes, answer chunks, and practice items are derived from
   trusted sources with version history.
4. **Gate review:** card-topic links keep cards out of due review until prerequisites are read or
   explicitly unlocked.
5. **Practice and grade:** Review records attempts, reveal/grade events, quality signals, and next
   due dates.
6. **Plan:** Planner uses progress, due load, and schedule constraints to propose blocks and next
   study actions.
7. **Brief and assist:** Assistant and daily briefing summarize next steps, but major schedule/task
   writes still require confirmation.

See [diagrams/interview-prep-loop.mmd](diagrams/interview-prep-loop.mmd).

## Architectural Responsibilities

- `services/api` owns artifacts, sources, topics, cards, card-topic links, attempts, tasks, and
  scheduling state.
- Import scripts and future workers may seed or refresh study material, but they must preserve
  source/provenance records.
- Clients expose the loop through Assistant, Library, Planner, and Review rather than creating
  separate learning-only surfaces.

## Validation Boundary

Automated Android interview-prep validation is the preferred phone gate for this lane. Current
device, harness, and proof status belongs in [../CURRENT_STATE.md](../CURRENT_STATE.md) and
[../UI_FUNCTIONAL_TEST_HARNESSES.md](../UI_FUNCTIONAL_TEST_HARNESSES.md), not in this architecture
summary.
