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
  authoritative projection at that sequence. A token containing a sequence is
  not sufficient.
- Contextual facet postings use the same page/owner-qualified identity context
  as query projections; the schema rebuild path uses the same context.
- Discovery still delegates typed ordering, exact counts, active pins,
  continuation, and unavailable states to the storage-neutral memory oracle.
  It never hydrates replay payloads.

## Tests and red/green proof

`tests/filter-impl-09-indexeddb-discovery.test.ts` now covers:

- mismatched posting event identity with an otherwise valid token and sequence;
- missing and malformed discovered-facet postings when no counterfactual
  filter exists;
- durable/memory parity for every `EVIDENCE_FACET_KEYS` catalog facet, with
  concrete typed identities and absent active zero-count pins;
- existing pagination, self-facet counterfactual, zero-base,
  no-concrete-values, and isolated failure behavior.

The new corruption tests were run against the clean starting revision before
the repair: all three corruptions incorrectly produced `AVAILABLE` discovery.
After the repair, they produce `UNAVAILABLE` with `DISCOVERY_FAILED`, while
the base totals remain successful.

## Verification

The focused 04/05/08/09 suites, typecheck, release tests, build, documentation
check, package-all gate, and `git diff --check` are run for this repair. Final
counts, package sizes, and the committed revision are recorded in
`/tmp/filter-impl-09-integrity-repair-result.txt`.

## Residual performance boundary

Fake IndexedDB tests prove integrity and semantic parity, not real-Chrome
latency at the 10,000-Evidence/3,842-key workload. The repair scans the
requested discovered facet's posting tokens inside the existing bounded
readonly transaction; no replay-payload hydration or unbounded retained
materialization is introduced. Real-Chrome performance evidence remains a
separate follow-up boundary.
