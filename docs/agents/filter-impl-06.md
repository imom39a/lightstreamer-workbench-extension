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

## TDD commits

- `be92475` — red lookup/Around/Find/lifecycle contract tests.
- `145fa71` — green memory planner, contract extension, and atomic adapter
  wiring.
- `7b1a234` — red unsupported-Reveal, nearest-hit, and stale-anchor tests.
- `15142df` — refactor isolated Reveal and selected-payload semantics.
- `8210cbd` — terminal optional-snapshot coverage and maintained test-plan
  count.

## Verification

- Focused `tests/filter-impl-06-memory.test.ts`: **8/8 passed**.
- Adjacent 04 query/performance, lifecycle, adapter, and final-gap suites:
  **26/26 passed**.
- Full ordinary suite: **72 files / 780 tests passed**.
- Full release suite: **78 files / 964 tests passed**, serialized.
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
