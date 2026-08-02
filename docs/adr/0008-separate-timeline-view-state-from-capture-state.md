---
status: accepted
---

# Separate Timeline view state from Capture state

The Timeline has an explicit Live or Frozen view state that is independent of whether Capture is active. Live follows the newest matching activity, while Frozen anchors a historical window and counts newer matching events without pausing Capture; event-detail selection is pinned independently from both states. This lets a developer investigate history without accidentally changing observation behavior or losing the current context.

## Considered Options

- Make the Timeline always follow the newest captured activity.
- Treat scrolling, event selection, or historical browsing as an implicit Capture pause.
- Model Live/Frozen view state, Capture state, and pinned event detail independently.

## Consequences

- A Frozen Timeline may continue to receive and retain events while showing an accurate count of newer matching events.
- Scrolling away from the latest window or explicitly freezing enters Frozen state; following live deliberately returns to the newest matching window.
- Filters determine both the visible window and the newer-event count.
- Selecting or clearing an event detail does not silently change Live/Frozen state.
- Rendering may coalesce refreshes and overlay a bounded live tail, but retained history remains complete and ordered.
