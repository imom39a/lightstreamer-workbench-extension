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
- `f36eaf9` — green implementation and Non-UI evidence record.

## Verification

- Focused query/performance: 8/8 tests passed.
- Concurrency/lifecycle/IndexedDB suites: 143/143 tests passed.
- Event History benchmark: 10,000 retained records completed successfully.
- Default suite: ordinary 71 files / 773 tests plus serialized IndexedDB 8
  files / 192 tests (965 total) passed.
- Release suite: 77 files / 957 tests passed with one-file-at-a-time
  execution.
- `npm run typecheck`: passed.
- `npm run build`: passed with MV3/CSP/local-script release checks.
- `npm run docs:check`: passed for 4 documents and 10 maintained commands.
- `git diff --check`: passed.

No UI, discovery, lookup, find, IndexedDB query parity, GitHub issue, or push
changes are part of this ticket.
