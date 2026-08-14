# `filter-impl-06` implementation evidence

Change class: **Non-UI**. This implementation is memory-only. It does not add
facet discovery, IndexedDB query parity, runtime/UI controls, recovery
controls, or mutation UI.

## Delivered

- Added `evidence-filter-selection.ts`, the isolated lookup/Around/Find and
  minimal-Reveal planner.
- Extended the storage-neutral contract with immutable optional selected
  payloads, anchor metadata, and an explicit stale-anchor read problem while
  retaining the existing Around range shape for compatibility.
- Selected lookup is evaluated against the latched committed slice. It
  distinguishes retained, not-retained, and other-interval identities;
  reports Scope/Around status, Filter status, and canonical typed criterion
  identities; and copies/freezes only the selected candidate payload.
- Around anchor timestamps derive `[t - 5000, t + 5000)` and use the retained
  interval slice, half-open bounds, interval validation, and Evidence sequence
  ordering for equal timestamps.
- Find scans only when requested, remains independent of Filter and totals,
  preserves a valid current hit, and chooses the nearest sequence-ordered
  surviving hit for retired intent.
- `revealFilter` removes only returned blockers: matching exclusions,
  unsatisfied Include values, free text, Around, and unsupported criteria.
  Satisfied criteria remain unchanged.
- Terminal final snapshots and lower-capacity fallback retain the same
  optional-section semantics and truthful `coverage`/`storage` status.
- The Around anchor now uses the same complete five-component
  `EvidenceIdentity` equality as selected lookup; forged `pageId` and
  `ownerId` anchors are rejected.

## Ticket contract coverage

The focused memory contract suite keeps these ten categories covered:

1. Retained selected lookup, including current-interval, not-retained, and
   other-interval classification.
2. Scope/Around classification and the half-open Around result.
3. Filter matching and exact totals independent of Scope.
4. Selected-only payload hydration with an immutable payload copy.
5. Canonical blocker identities for free text, typed Include/Exclude values,
   Around, and unsupported criteria.
6. Minimal Reveal, removing only the blockers returned for the selection.
7. Around timestamp derivation, retained-range clipping, half-open bounds,
   and equal-timestamp Evidence sequence order.
8. Same-read-point Find, including an active current hit and nearest surviving
   replacement.
9. Clear/stale read points, terminal final snapshots, and lower-capacity
   fallback.
10. Omitted lookup/Find no-scan/no-hydration behavior and active current Find.

The suite also retains the backward-compatible Around range fields and the
filter-impl-05 optional-query seam.

Residual performance coverage exercises Around, residual free text, selected
lookup, and complete Find at both `NORMAL` and `LOWER` tiers against the
accepted `<=500 ms` p95 class. The adjacent filter-impl-04 test retains its
`<50 ms` recent-page and `<100 ms` structured-read p95 gates.

## TDD commits

- `be92475` — red lookup/Around/Find/lifecycle contract tests.
- `145fa71` — green memory planner, contract extension, and atomic adapter
  wiring.
- `7b1a234` — red unsupported-Reveal, nearest-hit, and stale-anchor tests.
- `15142df` — refactor isolated Reveal and selected-payload semantics.
- `8210cbd` — terminal optional-snapshot coverage and maintained test-plan
  count.
- `ba7397e` — red forged `pageId`/`ownerId` Around-anchor tests.
- `90d14e3` — complete-identity Around validation and residual performance
  matrix.
- `84a549b`, `91d42c2` — updated release-plan file-count guards.
- `09b5acc` — corrected test fixtures to use contract identities.

## Verification

- Focused filter-impl-06 suites (`memory` + `memory-performance`):
  **12/12 passed**.
- Adjacent 04 query/performance, lifecycle, adapter, and final-gap suites:
  the focused query/performance pair is **8/8 passed**; the existing 04
  50/100 p95 gates passed.
- Full ordinary suite: **73 files / 785 tests passed**.
- Full release suite: **79 files / 969 tests passed**, serialized.
- `npm run typecheck`: passed.
- `npm run build`: passed with MV3/CSP/local-script release checks.
- `npm run docs:check`: passed for 4 documents and 10 maintained commands.
- `git diff --check`: passed.
- The first parallel ordinary run had one unrelated existing React runtime
  performance timeout; the targeted 13-test suite passed immediately, and the
  complete ordinary rerun passed without source changes.

Omitted lookup and Find sections are represented by the adapter's explicit
`undefined` branches, so their planners are not called. Lookup payload copying
is performed only after an identity match; the ordinary page projection has no
payload field. These are the no-scan/no-unrelated-hydration seams covered by
the focused contract tests and code path.
