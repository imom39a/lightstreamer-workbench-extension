---
status: accepted
---

# Continue Event History with rolling retention

## Decision

One Panel Session continues to own one temporary Event History, one History
Interval at a time, one Evidence sequence, and one Committed Evidence Boundary.
Valid Capture must not permanently stop because a retained budget or journal
commit failed.

The normal 100,000-record/256 MiB and memory 25,000-record/128 MiB limits
are rolling retention budgets. At a retained high-water crossing, Event History
removes the oldest complete prefix toward a 90% low-water target and continues
accepting recent Evidence. The Retained Range advances inside the same History
Interval. Only deliberate Clear begins another interval.

A failed journal append receives at most three total attempts. If the transaction
still cannot commit, the coordinator opens a circuit for the Panel Session and
accepts that batch and later Capture into bounded memory. It does not endlessly
probe a known-bad adapter. The IndexedDB transaction remains atomic across its
canonical records and query indexes, so an aborted attempt exposes none of the
batch before retry or fallback. Storage degradation is reported independently
from Capture Operation and Observation Coverage.

A **Retention Advance** means previously accepted Evidence is no longer retained.
It does not manufacture missing Capture and does not retroactively invalidate
live projections already applied. An **Evidence Gap** exists only when a valid
captured candidate cannot enter any canonical segment. The gap records an exact
capture-ordinal range and preceding Evidence boundary; later valid Capture remains
eligible. Continuity-dependent Topology, COMMAND, and Scenario conclusions are
limited. A full Topology Checkpoint begun after the latest gap for the current
page epoch restores only the Topology basis from that checkpoint forward; it
does not erase the gap. COMMAND and COMMAND-dependent Scenario conclusions remain
limited until a separately trustworthy, target-scoped COMMAND Snapshot recovery
exists.

The UI remains low-attention. Routine rollover is a quiet counter and one
coalesced informational Notifications episode. A recovered transient commit is
Notifications-only. Sustained memory fallback produces one warning. An actual
Evidence Gap produces one persistent footer and Notifications warning. Repeated
errors update the same bounded condition lifecycle with first/latest time,
occurrence and retry counts, affected ranges, transitions, evictions, and recovery
outcome. There is no new settings or recovery surface.

Clear remains a deliberate erasure and interval-cut operation, not a recovery
button. Controlled Close still cuts intake, attempts erasure, and reports its
outcome. A new Panel Session never replays abandoned Evidence.

## Consequences

- High-volume debugging keeps the newest useful Evidence without unbounded heap,
  browser storage, query, or rendering work.
- A storage incident no longer turns one missing commit into permanent loss of
  all later developer evidence.
- Full-interval replay, frozen reads, copy, and export must report when their
  latched Retained Range expired; partial artifacts cannot be called complete.
- Projections and Scenario assertions distinguish retention from a true
  continuity gap.
- This supersedes ADR 0011's fixed-adapter, terminal-capacity, and fail-closed
  commit-failure rules while retaining its ownership and acceptance boundaries.

## Memory capacity amendment (2026-09-10)

The maintainer authorized expanding memory fallback from 5,000 records/32 MiB
to 25,000 records/128 MiB to retain more useful Evidence after a journal failure.
The count and canonical-byte budgets remain independent, with a 90% rollover
target. These bytes measure canonical Evidence, not total browser heap: decoded
projections, indexes, and editor state consume additional memory. The pending-work
budgets and bounded journal retries remain unchanged. This supersedes the older
memory-capacity figures in ADR 0011; its historical measurements remain historical.

The footer derives storage mode from current History persistence status, including
fallback that happened before the panel follower attached. Notifications includes
the recorded journal failure and failed-attempt/retry counts. A mode label never
asserts that a prior failure was a browser quota error without that evidence.
