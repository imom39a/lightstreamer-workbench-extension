# `filter-impl-04` implementation evidence

Change class: **Non-UI**. This pass repairs the valid findings from the final
review of the in-memory Evidence Snapshot query seam. IndexedDB query parity is
intentionally not added here; `EventHistory.query` remains optional until the
parity ticket owns that adapter work. Discovery, lookup, and find request
execution remain out of scope for this ticket; the common request shape may
omit them.

## Delivered

- Enforced the documented maximum Evidence page size of 100.
- Distinguished an unavailable History Interval from an unavailable retained
  read point after Clear.
- Returned caller-immutable discovery collections through a read-only map view
  without adding discovery request execution.
- Reported `LIMITED` coverage for lower-capacity fallback and terminal memory
  histories while preserving exact totals and retained Evidence in range.
- Kept terminal histories queryable for their final exact snapshot and refused
  later Capture. Successful controlled Close remains a separate erased/closed
  state and is not represented as terminal history.

## Red-green evidence

- `faab2e9` — red contract tests for the review findings.
- Follow-up green implementation commit records the repaired query behavior.

## Verification

The final command matrix is recorded below after completion. No UI, discovery,
lookup, find, IndexedDB query parity, GitHub issue, or push changes are part of
this ticket.

