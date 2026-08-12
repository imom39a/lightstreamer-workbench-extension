# Integrated prototype review record

## Scope and classification

Disposable Material UI and query-seam validation for `evidence-filter-07`.
Production source, extension packaging, Event History databases, UI standards,
and visual baselines are unchanged.

The executable truth fixture contains exactly 10,000 retained H7 Evidence
records and 3,842 typed COMMAND keys. It includes equal timestamps, missing
facets, Server and Local provenance, snapshot/live phases, update delivery,
session status, active and retired subscriptions, and deterministic H8 Clear,
terminal, lower-capacity fallback, and Limited Coverage states.

## Outcome

Approved by the product owner on 2026-08-12. The accepted feature adds no
dedicated keyboard-shortcut scheme.

The selected atomic query and inline composer remain coherent through the
primary Include → Exclude → Reveal → Reset path and every required adverse
state. The run completed 36 assertions, 14 memory/IndexedDB exact semantic parity
cases, 8 measured query paths, 9 axe passes, and 14 screenshots with no browser
or console exception. The machine-readable record is
[`review/verification.json`](review/verification.json).

## Semantic proof

- Page, `matching`/`inScope`, requested discovery, retained lookup/blockers, and
  optional Find navigation name the same H7 committed boundary.
- Find remains independent: it changes neither Filter nor totals, while
  Previous/Next cannot read a newer boundary than the ledger.
- Draft editing and Cancel issue no query. Apply sends one expected-revision
  mutation batch and publishes one new snapshot. A stale investigation rejects
  the whole draft and preserves recovery.
- Same-facet includes remain additive OR values. Facets AND and exclusions
  subtract. Active values remain pinned through search/paging without inflating
  the concrete distinct total; base zero remains distinct from active zero.
- Exact key discovery returns 50 values for range 1,801–1,850 of 3,842. Search
  finds `order-03842` globally, not just on the loaded page.
- Include Item followed by Exclude LOCAL retains selection and exact blockers;
  Reveal removes only the blocker and preserves the Item criterion.
- Reset preserves Scope, Find, selection, Capture, Coverage, and Live/Frozen.
- Empty, valid contradiction, Scope conflict, unsupported fail-closed,
  discovery-unavailable, hidden-selection, retired-object, Limited Coverage,
  lower memory fallback, Clear, and terminal states remain distinct and
  truthful.
- Clear creates H8 in both adapters, removes only Around, preserves ordinary
  criteria, invalidates stale drafts, inserts a restoration barrier, erases the
  selected payload, and makes an ordinary H7 read point return
  `HISTORY_READ_POINT_UNAVAILABLE`. Terminal Clear is refused.
- Passive Capture advances #9,998 → #10,000. Frozen derives the exact newer
  matching count from Scope + Filter (two unfiltered and zero for the tested
  Item filter); Live publishes #10,000 without mutating other axes.

## Adapter and query-plan proof

The same 14 canonical public snapshots compare deeply and exactly in memory and
browser IndexedDB; digests are diagnostic only:

1. common newest page;
2. structured posting path;
3. structured facets plus free text;
4. counterfactual self-facet discovery;
5. exact counterfactual key page 37;
6. active zero pinned;
7. active zero pinned through global search;
8. active concrete value pinned outside search;
9. base zero distinct from active zero;
10. Around with equal timestamps;
11. Around interval isolation;
12. Find at the same read point;
13. Find nearest surviving match; and
14. lower-capacity 5,000-record prefix.

IndexedDB answers page, exact totals, requested discovery, lookup/blockers, and
optional Find in one read transaction. One authoritative Evidence payload store
is supported by internal projection and typed-posting indexes. The actual UI
request, including lookup and active Find, hydrates only its 60-row page (plus a
selected payload only when it is outside that page); it never calls a full
Evidence-payload `getAll`. Exact discovery enumerates only the requested facet's
3,842 posting values and renders at most 50 ordinary page values plus pinned
active values. Storage objects and posting tokens never escape the adapter.

Latest 12-iteration p95 measurements from the review run:

| Adapter | Recent page ≤50 ms | Structured ≤100 ms | Residual text ≤500 ms | Key page 37 ≤500 ms |
| --- | ---: | ---: | ---: | ---: |
| Memory | 0.8 ms | 3.7 ms | 3.4 ms | 2.2 ms |
| IndexedDB | 10.7 ms | 9.0 ms | 123.2 ms | 33.0 ms |

These are disposable-prototype measurements on headless Chromium, not a claim
about the future packaged extension. They show that the selected interface does
not require an unbounded common path; production must repeat the budgets against
the maintained adapters and representative payload shapes.

## UI, geometry, focus, and accessibility

Every canonical frame was captured in Dark and Light with the same investigation
state and no query or state mutation:

- [`compact dark`](review/matrix-compact-dark.png) · [`compact light`](review/matrix-compact-light.png)
- [`normal dark`](review/matrix-normal-dark.png) · [`normal light`](review/matrix-normal-light.png)
- [`shallow dark`](review/matrix-shallow-dark.png) · [`shallow light`](review/matrix-shallow-light.png)
- [`wide dark`](review/matrix-wide-dark.png) · [`wide light`](review/matrix-wide-light.png)

Required state captures:

- [`3,842-key compact explorer`](review/state-high-cardinality-compact-light.png)
- [`discovery unavailable without ledger loss`](review/state-discovery-unavailable-wide-dark.png)
- [`hidden selection and Reveal`](review/state-hidden-selection-normal-light.png)
- [`Limited Coverage with normal IndexedDB`](review/state-limited-coverage-wide-dark.png)
- [`terminal shallow layout`](review/state-terminal-shallow-light.png)
- [`forced colors`](review/forced-colors-normal.png)

Nested Escape restores value explorer → `Choose values`, add step → `Add
structured criterion`, and composer → the exact labelled Filter trigger.
The feature defines no dedicated keyboard shortcuts; native Tab traversal and
button activation remain available. All eight geometry/theme runs and the
forced-colors run have zero serious or critical axe findings.

## Material findings and resolutions

1. **Find coherence:** Build 5 originally left Find entirely outside the atomic
   seam, permitting a plausible torn navigation result. Build 5 is amended with
   optional `find` request/result sections on the same snapshot. Find still
   changes no Filter criterion or total.
2. **Static mock semantics:** Build 6's comparison script leaked draft changes,
   replaced same-facet values, searched only a local facet page, and lacked
   several lifecycle/focus states. This executable model repairs those defects;
   the accepted inline composer/value-explorer choice is unchanged.
3. **Coverage versus capacity:** Limited Coverage is proven with normal
   IndexedDB/10,000 capacity; lower memory fallback is proven separately with
   Useful Coverage/5,000 capacity.
4. **Unavailable is not zero:** unavailable discovery now reports `Base
   unavailable`, never a manufactured `Base 0`.
5. **High contrast:** the first forced-colors pass exposed theme tokens that
   survived system colors. System color tokens and selected-row action contrast
   were corrected before the final clean axe run.
6. **Bounded IndexedDB work:** the first integrated UI request fell through to
   full payload enumeration whenever lookup and Find were present. The final
   composite plan keeps those optional sections in the same transaction while
   hydrating only the bounded page/lookup payloads; recent and structured p95
   values are 10.7/9.0 ms without changing the public interface.
7. **History isolation:** adapter-owned control state now invalidates H7 after
   Clear, Around checks its interval as well as its half-open time range, and a
   terminal reason qualifies STOPPED Capture with Limited Coverage.

## Remaining production boundary

The prototype does not satisfy the later implementation gate. Production still
needs the authoritative Event History/WorkbenchRuntime command seam, real
memory/fake-IndexedDB contract tests, package and extension-host coverage,
maintained fixtures, failing user-facing tests first, baseline/diff evidence,
documentation updates, and independent visual QA. Builds 3, 9, and 11 remain
future typed leverage consumers rather than prerequisites for this filtering
slice.
