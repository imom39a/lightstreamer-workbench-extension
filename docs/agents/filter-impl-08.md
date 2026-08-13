# `filter-impl-08` repair proof

The IndexedDB adapter now executes one bounded readonly transaction. It latches
`historyControl`, reads v3 `facetPostings` token ranges for structured
candidates, uses bounded Evidence cursors/direction for recent pages, scans
only stored lightweight projections for residual text/Around/Find, and
hydrates only the requested lookup payload. No query path calls `getAll()` or
deserializes the journal to derive ordinary totals. Lightweight projections are
derived into a session cache at journal-open/commit time; authoritative v3
Evidence record shape and accounting remain unchanged, including deployed
v2→v3 records that never stored a projection.

Successful snapshots include telemetry for posting reads/candidates, Evidence
cursor reads, selected payload hydrations, candidate/page bounds, residual
scanning, and elapsed time. Opaque page cursors bind interval, committed
boundary, retained range, order, size, and filter. Malformed, stale,
cross-interval, cross-boundary, range, order, filter, and oversized cursors
fail closed.

Discovery is outside filter-impl-08's exact body. Requested discovery returns
an explicit `UNAVAILABLE`/`UNSUPPORTED_AT_READ_POINT` state. This repair does
not implement filter-impl-09 posting-based exact-value discovery or use an
empty map to imply success.

The public adapter retains the memory fallback's fixed lower-capacity parity,
terminal final snapshot, and controlled Close semantics. Query failures publish
a `QUERY_FAILED` status while retaining the last coherent successful query on
the diagnostic status publication; partial exact data is never published. v3 posting writes,
migration, admission, cleanup, and ownership behavior are preserved.

Focused proof:

- `tests/filter-impl-08-indexeddb-query.test.ts` covers memory/IndexedDB page
  and totals parity, Around, lookup blockers and payload selection, Find,
  unsupported fail-closed evaluation, Clear invalidation, typed facet algebra,
  bounded telemetry, request-bound cursors, and the truthful discovery boundary.
- `npm run typecheck` passes.
- The fake-IndexedDB suite proves plan shape and telemetry, not browser latency.
  The required deterministic 10,000-record normal-tier workload and ≤50 ms
  recent, ≤100 ms structured, and ≤500 ms residual p95 gates belong to the
  existing real-browser/manual harness in
  `docs/reference/event-history-performance-manual-workflow.md`.

UI, runtime visual verification, GitHub, push, merge, and status operations
are outside this non-UI repair.
