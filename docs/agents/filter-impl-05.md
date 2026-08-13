# filter-impl-05 proof

This ticket adds `src/core/evidence-filter-discovery.ts`, a memory-only discovery planner consumed by the atomic query in `event-history-authoritative.ts`.

The planner reads only the latched `entriesAtRead`-derived deterministic records. It removes both polarities for the requested facet, retains free text, Around, and all other criteria, accounts exactly by typed identity, and emits exact counts and filtered `distinctTotal`. Descriptor lookup is through `FACET_DESCRIPTORS`; absent extractor values are never invented. Exact accounting stores compact identity/type/value/label strings; it does not retain a full typed-value array or full sorted order.

Continuation cursors are opaque base64url JSON validation tokens bound to facet, normalized label search, request size, serialized filter, read point, position, and the last ordered anchor. They are not authorization or tamper-proof tokens; every semantic field and anchor rank is revalidated locally, so malformed, cross-request, stale, and forged/oversized continuations return local `DISCOVERY_FAILED`. Search matches only the canonical facet descriptor label and typed value label/value. Active criteria are pinned with exact observed counts or exact zero counts when absent, including off-page and search-mismatching values, without inflating `distinctTotal` or changing observed ordering. Typed page materialization is bounded by `page size + active pins`.

The contract adds only `ZERO_BASE` to `FacetDiscoveryResult.reason`, because the prior union could not truthfully distinguish an empty counterfactual base from a nonempty base with no concrete value. `NO_CONCRETE_VALUES` remains the latter state; `DISCOVERY_FAILED` remains local failure.

## TDD commits

- `60da457` — `test(filter): specify memory facet discovery` (red tests for same-facet counterfactuals, exact counts, and continuation)
- `db8db1b` — `feat(filter): discover contextual memory facets` (green planner and one-snapshot memory wiring)
- A final refactor commit records the expanded empty-state, search/pinning, latch, and browser-safe cursor tests plus implementation cleanup.
- `98cbe3a` — `test(filter): cover discovery states and read latches`
- `590cc67` — `refactor(filter): bound and document discovery cursors`
- `b0c9012` — `test(filter): include discovery suite in release plan`
- `56ae40a` — `test(filter): isolate unavailable discovery states`
- repair pass — red-memory coverage for both Include/Exclude omission, all 12 facets and typed identity collisions, active off-page/search pins, semantic cursor rejection, failure isolation, Find independence, concurrent read-point stability, and complete 10,000/5,000 traversal.

## Verification evidence

Focused tests cover same-facet Include/Exclude omission, other criteria and Around retention, typed exact counts, deterministic continuation, stale cursor isolation, label search, zero-base/no-concrete states, retired active pinning, and read-point stability. The workload/performance commands below are the release evidence; no UI, lookup/Around/Find implementation, IndexedDB code, or mutation controls are part of this ticket.

Observed verification for the repair: focused discovery `11 passed`, including real normal 10,000-record and lower 5,000-record memory workloads, 3,842 distinct keys, full continuation reachability, repeated timing samples, and the `page size + active pins` candidate bound. Final command evidence is recorded in `/tmp/filter-impl-05-repair.txt`; adjacent, full-suite, release, typecheck, build, and docs results are recorded there after verification.
