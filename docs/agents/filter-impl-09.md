# `filter-impl-09` implementation evidence

This document records the IndexedDB discovery integrity repair on top of
`f659d3cdca67ae8d723206524dfe8a4aeefdc672` on branch `codex/filter-impl-09`.

## Repair

IndexedDB discovery remains optional and isolated: a malformed or incomplete
posting index returns `DISCOVERY_FAILED` for that facet while the base query,
totals, read point, cursor behavior, and transaction remain coherent.

- Discovery validates every discovered-facet posting, including the
  no-counterfactual path where posting candidates are `null`.
- Posting validation requires exact shape, token/facet identity, interval,
  sequence validity, and `posting.eventId === projection.eventId` for the
  authoritative projection at that sequence. Same-interval postings outside
  the exact projection range fail closed when they claim that event identity;
  valid postings from other intervals are ignored by the active-interval read.
  A token containing a sequence is not sufficient.
- Contextual facet postings use the same page/owner-qualified identity context
  as query projections; the schema rebuild path uses the same context.
- Discovery still delegates typed ordering, exact counts, active pins,
  continuation, and unavailable states to the storage-neutral memory oracle.
  It never hydrates replay payloads.
- The shared filter algebra preserves the built-in scalar types while also
  accepting opaque string-valued catalog facet types such as `client`,
  `session`, and `listener`, so full-catalog parity filters are valid.

## Tests and red/green proof

`tests/filter-impl-09-indexeddb-discovery.test.ts` now covers:

- mismatched posting event identity with an otherwise valid token and sequence;
- same-interval, valid-shape out-of-range posting with the legitimate posting
  retained, while preserving coherent base totals;
- valid posting from a genuinely different interval;
- missing and malformed discovered-facet postings when no counterfactual
  filter exists;
- durable/memory parity for every `EVIDENCE_FACET_KEYS` catalog facet, including
  a concrete listener identity and absent active zero-count pins;
- existing pagination, self-facet counterfactual, zero-base,
  no-concrete-values, and isolated failure behavior.

The new range test was run against the clean starting revision before the
repair and incorrectly produced `AVAILABLE` discovery; the cross-interval test
also incorrectly failed closed. After the repair, the range corruption
produces `UNAVAILABLE` with `DISCOVERY_FAILED`, the cross-interval posting is
ignored, and base totals remain successful.

## Verification

The focused 04/05/08/09 suites (39 tests), typecheck, release tests, build,
documentation check, package-all gate, and `git diff --check` are run for this
hardening. Final counts, package sizes, and the committed revision are recorded
in `/tmp/filter-impl-09-test-hardening-result.txt`.

## Residual performance boundary

Fake IndexedDB tests prove integrity and semantic parity, not real-Chrome
latency at the 10,000-Evidence/3,842-key workload. The repair scans the
requested discovered facet's posting tokens inside the existing bounded
readonly transaction; no replay-payload hydration or unbounded retained
materialization is introduced. Real-Chrome performance evidence remains a
separate follow-up boundary.
