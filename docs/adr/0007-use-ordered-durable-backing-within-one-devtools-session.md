---
status: superseded
---

# Use ordered durable backing within one DevTools session

Superseded by [ADR 0011 — Make one session-owned journal the Evidence acceptance boundary](0011-make-one-session-owned-journal-the-evidence-acceptance-boundary.md).

The statements below preserve the original decision-time record. Current
production ownership, capacity, interval, continuity, and cleanup behavior is
defined by ADR 0014 and the current outcome note below.

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

## Current production outcome (2026-08-29)

ADR 0014 now governs the implementation. One Panel Session owns one temporary
rolling Event History with a normal IndexedDB retention budget of 100,000
Evidence records or 256 MiB and a memory-backed budget of 25,000 records or
128 MiB. Bounded journal retry can continue into memory without changing
Observation Coverage by itself.

Clear makes an exact History Interval cut, and Complete History is qualified by
the interval's Committed Evidence Boundary and continuity status. Retention
advance removes the oldest accepted prefix without stopping Capture; an exact
Evidence Gap is recorded only when one candidate cannot enter any canonical
segment, and later valid Capture remains eligible.
Controlled Close attempts erasure and reports its outcome. Abnormal cleanup is
guarded and may be deferred, leaving residual data until a later sweep; the
sweep never replays abandoned Evidence and a new Panel Session starts empty.
