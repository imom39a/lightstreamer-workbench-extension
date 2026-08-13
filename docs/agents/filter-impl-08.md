# `filter-impl-08` repair proof

## Deadline repair (2026-08-13)

The live timeout audit found that the performance proof's shared deadline stopped
at matrix shard operations: fresh harness `Target.createTarget` and
`Target.closeTarget` used unbounded control-CDP promises, and heap/lifecycle
work reset to independent one-hour or phase ceilings. The repair establishes one
absolute `deadlineAt` after authoritative preparation, threads it through matrix,
heap, forced-GC, lifecycle, and cleanup work, and bounds target creation/close
requests (including setup-failure cleanup). Expiry produces the existing
fail-closed `PerformanceOperationTimeout` evidence with the last operation and
progress status when available; cleanup remains bounded after expiry.

Deterministic verification covers hung `Target.createTarget`, hung
`Target.closeTarget`, expired shared deadlines before heap, expired shared
deadlines before lifecycle, and structured timeout evidence. No real performance
candidate was launched and no Chrome performance success is claimed.

The IndexedDB query adapter uses one readonly transaction over `historyControl`,
`facetPostings`, `queryProjections`, and selected `evidence` payloads. The
authoritative v3 Evidence record shape remains exact; schema version 4 adds a
separate sequence-keyed `queryProjections` store. Commits and Clear update the
projection store atomically with Evidence, postings, and control. Empty v3
projection stores are backfilled only during the explicit old-database upgrade
path; ordinary opens do not hydrate replay payloads into a process cache.

Find runs over the complete latched retained projection interval independently
of Filter. Around anchors are validated against that complete interval before
Filter evaluation. A read point from the same interval may remain valid after a
later commit; the later boundary is excluded. Missing/corrupt projections and
selected replay payloads fail closed, and the last coherent query remains the
published diagnostic result.

Focused measured proof on 2026-08-13:

- `npx vitest run --no-file-parallelism --maxWorkers=1 tests/filter-impl-08-indexeddb-query.test.ts`: 9 tests passed.
- `npx vitest run --no-file-parallelism --maxWorkers=1 tests/authoritative-event-history-indexeddb.test.ts`: 65 tests passed before the final combined run; the combined focused pair passed 71 tests before adversarial additions, and the current query suite is 9/9.
- `npm test`: ordinary phase 74 files / 794 tests passed; serialized phase 9 files / 190 tests passed (40.95 seconds total for the two phases).
- `npm run test:release`: 83 files / 984 tests passed in 77.56 seconds.
- `npm run typecheck`, `npm run build`, and focused filter/posting/schema suites pass.
- `LSEW_BROWSER_HEADLESS=false LSEW_UI_HEADLESS=false LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run measure:event-history` was attempted with cached Chrome for Testing 151 installed, but fails closed before launch because `docs/reference/event-history-performance-reference.json` is empty and `PENDING_MAINTAINER_BASELINE`. No p95 claim is made and no machine-readable performance report was produced.
- The deterministic package audit measured a stored ZIP of 1,069,630 bytes after removing the unused extension favicon; this remains above the 1 MiB budget and is a release blocker.
- The performance harness proves the existing Around-only request with exact totals and the exact 50-record page length, newest-first order, sequence, and event identity on both its 10,000-record IndexedDB/3,842-key and 5,000-record memory fixtures. A focused gate test rejects wrong Around page size, order, and identity.

The deep tests cover Filter-independent current/nearest Find, an excluded but
retained Around anchor, same-timestamp ordering, old-schema projection
migration, Clear/read-point invalidation, terminal/fallback behavior inherited
from the authoritative suite, corrupt/missing selected data, concurrent-latch
boundary exclusion, compound facet algebra, and zero replay-payload hydration
for ordinary queries. Real-Chromium 10,000-record / 3,842-key evidence and
package-size closure remain outstanding.
