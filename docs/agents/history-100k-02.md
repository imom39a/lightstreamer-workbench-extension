# `history-100k-02` implementation evidence

This document records the query-boundary work for `history-100k-02 — Keep
IndexedDB Evidence queries bounded at 100k`. The change is Non-UI: rendered
controls and row semantics do not change.

## Query boundary

IndexedDB and memory queries latch one immutable read point before selecting
Evidence. The result is qualified by the latched History Interval, Retained
Range, and Committed Evidence Boundary. The IndexedDB transaction remains
read-only while projection metadata, optional discovery, Find, selection, and
the visible page are derived from that boundary. Replay payloads are opened
only for the visible page and an explicitly requested selected Evidence.

Page cursors are version 3 keyset tokens. They carry the query binding, read
point boundary, and the last page's full Evidence identity. IndexedDB validates
the anchor against the latched projection range before continuing; both
adapters reject malformed, stale, out-of-range, or mismatched cursors.

Structured IndexedDB filters choose the smallest Include posting union as one
driver. Other Include/Exclude Criteria and text are evaluated against compact
projection metadata in requested key order. Exact Matching and In Scope
totals are counters, not retained result arrays. Find uses the search-token
index when possible, retains at most the bounded match-identity prefix and
nearby compact projections, and hydrates no payload while discovering exact
totals or neighbors.

The panel runtime aborts superseded query generations. Passive Capture keeps
its existing coalesced refresh boundary, and the active query signal now stops
obsolete Filter, discovery, and Find work before publication.

## Dormant 100k evidence

`benchmarks/event-history-100k-query.ts` and
`tests/history-100k-02-workload.test.ts` provide deterministic bounded-query
evidence for accepted-page, structured-driver, residual, discovery, Find, and
passive-capture work at 100,000 retained Evidence records. The proof records
compact-key work, exact totals, page/selected payload hydration, posting-driver
set count, bounded Find identities/windows, and the absence of a complete
payload collection. It is not a production capacity switch and does not claim
real-Chrome latency.

The shipped capacity is now the activated normal contract:

- normal IndexedDB tier: 100,000 Evidence records or 256 MiB;
- startup memory fallback: 5,000 Evidence records or 32 MiB.

The query profile is selected by the normal Event History factory; it does not
materialize a complete 100,000-element payload or identity collection.

## Focused proof

The implementation proof is provided by:

```text
npm run typecheck
npx vitest run tests/history-100k-02-workload.test.ts tests/history-100k-02-indexeddb.test.ts --no-file-parallelism --maxWorkers=1
npx vitest run tests/filter-impl-04-memory-query.test.ts tests/filter-impl-08-indexeddb-query.test.ts tests/filter-impl-09-indexeddb-parity.test.ts tests/filter-impl-09-indexeddb-discovery.test.ts tests/filter-impl-09-indexeddb-workload.test.ts tests/filter-impl-10-runtime-query.test.ts --no-file-parallelism --maxWorkers=1
```

Fake IndexedDB proves storage semantics and adapter parity. The real-Chrome
100,000 Evidence activation report is maintained separately by
`measure:event-history:100k` and must remain clean-source evidence rather than
synthetic or unit-only proof.
