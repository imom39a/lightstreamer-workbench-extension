---
status: accepted
---

# Use ordered durable backing within one DevTools session

Workbench retains every accepted captured event exactly once and in capture order for the lifetime of the current DevTools session. It uses IndexedDB as operational backing, appends in bounded ordered batches, and falls back to in-memory history when IndexedDB is unavailable; it does not treat that backing store as cross-session product persistence. This preserves complete browsable Capture during sustained activity without introducing an implicit retention policy beyond the active debugging session.

The fallback changes History Capacity, not Observation Coverage. Workbench reports it once as a storage diagnostic and does not mark Capture coverage limited solely because IndexedDB is unavailable.

## Considered Options

- Keep all Capture history only in panel runtime memory.
- Persist Capture history across DevTools sessions in IndexedDB.
- Use IndexedDB as session-scoped operational backing with an in-memory fallback.

## Consequences

- Batching may coalesce persistence work and append notifications, but it must never sample, drop, duplicate, or reorder retained events.
- One-off events must settle without waiting indefinitely for another event to fill a batch.
- Clearing history waits behind already accepted writes before removing them, so queued events cannot reappear after the clear completes.
- Normal close drains already accepted writes before closing the backing store.
- Session teardown clears operational history; deliberate user downloads are the only durable Capture-derived artifacts.
- Cross-session retention would require a separate decision covering privacy, pruning, schema migration, and user control.
