# `filter-impl-09` implementation evidence

This is an implementation proof for the isolated branch `codex/filter-impl-09`
at revision `85b775b` plus the uncommitted changes recorded here. It does not
change the GitHub Project item or claim ticket closure.

## Live ticket

- Project item: `PVTI_lAHOABNB-84BfMBxzg2U2p0`
- Draft content: `DI_lAHOABNB-84BfMBxzgK7Ivw`
- Status at execution: `Todo`
- Blockers at execution: `filter-impl-05` Done; `filter-impl-08` In Progress

## Implementation

IndexedDB discovery now uses the existing readonly query transaction, removes
only the requested facet for its counterfactual base, obtains residual
candidate projections through versioned facet postings, and delegates exact
typed ordering, search, continuation, counts, unavailable states, and active
pins to the storage-neutral memory oracle. Replay payloads are not hydrated for
discovery. Posting shape, token, interval, sequence, event identity, and
projection completeness are validated; failure returns `DISCOVERY_FAILED`
without replacing the base snapshot.

Acceptance mapping:

- Exact parity, typed ordering, counts, self-facet counterfactual, active pins,
  and continuation: `tests/filter-impl-09-indexeddb-discovery.test.ts`.
- Zero base, no concrete values, and isolated corrupt-posting failure: same
  suite.
- Existing negative/same-facet algebra, Around, Scope, Find, lookup, Clear,
  terminal, and lower-tier coverage remains in the integrated 08/05 suites.
- Release and package integrity: `tests/release-package-script.test.ts` and
  release gates below.

## Verification

- Focused 09/05/08 suites: 26 tests passed.
- Full release suite: 85 files, 1,032 tests passed.
- `npm run typecheck`: passed.
- `npm test`: initial run had 833 passed and exposed the expected release-plan
  count update; the subsequent full release run passed all 1,032 tests.
- `npm run build`: passed.
- `npm run release:package:all`: passed.
- `npm run docs:check`: passed.
- Package: `release/lightstreamer-workbench-v2.0.0.zip`, 328,108 bytes.

## Residual risks and integration notes

- The live blocker `filter-impl-08` was still In Progress; this branch remains
  unmerged and must not be declared complete until 08 is closed.
- No real-Chrome 10,000-Evidence/3,842-key performance run was performed or
  claimed here. Fake IndexedDB tests prove semantics only; the accepted visible
  500 ms performance evidence remains a follow-up gate.
- The implementation preserves the reviewed v5 authoritative schema and adds
  no store or migration.
