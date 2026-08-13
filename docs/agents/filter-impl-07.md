# `filter-impl-07` implementation evidence

Change class: **Non-UI**. This closure pass versions the authoritative
IndexedDB layout for canonical Evidence facet postings and updates the
Build 1 fixtures and release plan without changing Evidence admission,
capacity tiers, coverage, or retention semantics.

## Closure repairs

- Existing Build 1 IndexedDB schema assertions now intentionally expect the
  v3 `facetPostings` store while retaining the v2 durable control-record
  contract and all prior corruption, capacity, ownership, and replay
  expectations.
- The serialized unit plan isolates all three `filter-impl-07` suites with
  the other fake-IndexedDB suites: 69 ordinary files and 9 serialized files,
  78 files total.
- Seeded current-schema journals include canonical postings, so replay and
  ownership tests exercise the v3 shape rather than silently falling back.

## Automated proof

Real Chrome measurement is not required by this ticket's acceptance criteria:
the ticket requires schema, admission, accounting, cleanup, capacity, and
twelve-posting-bound tests, not browser layout or browser runtime timing.
The exact automated proof is therefore retained here:

- `filter-impl-07-schema.test.ts` proves schema version 3, the isolated
  `facetPostings` store, the composite `[token, sequence]` key, the single
  non-unique token index, and the complete three-store layout.
- `filter-impl-07-postings.test.ts` proves canonical typed identities are
  persisted atomically, missing values do not create fake postings, and
  topology checkpoints do not receive postings.
- `filter-impl-07-failure-cleanup.test.ts` proves duplicate Evidence rejection
  leaves postings unchanged and Clear removes postings in the same transaction.
- `evidence-facets.test.ts` proves the first-release catalog has exactly twelve
  frozen facet descriptors; the posting implementation bounds one Evidence
  record to that catalog.
- Focused schema/postings/failure/capacity/serialization run: **5 files,
  86 tests passed**.

## Verification

- `npm test`: ordinary **69 files / 765 tests**, serialized **9 files / 189
  tests** passed.
- `npm run test:release`: **78 files / 954 tests** passed.
- `npm run typecheck`: passed.
- `npm run build`: passed with MV3 release artifact verification.
- `npm run docs:check`: passed for 4 documents and 10 maintained commands.
- `git diff --check`: passed.

No UI, Chrome focus, GitHub, or push operation was performed.
