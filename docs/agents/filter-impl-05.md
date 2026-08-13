# filter-impl-05 proof

This ticket adds `src/core/evidence-filter-discovery.ts`, a memory-only discovery planner consumed by the atomic query in `event-history-authoritative.ts`.

The planner reads only the latched `entriesAtRead`-derived deterministic records. It removes both polarities for the requested facet, retains free text, Around, and all other criteria, groups by typed identity, orders by type/value/identity, and emits exact counts and observed `distinctTotal`. Descriptor lookup is through `FACET_DESCRIPTORS`; absent extractor values are never invented.

Continuation cursors are opaque base64url JSON tokens bound to facet, normalized label search, request size, serialized filter, read point, and position. Invalid or stale tokens return local `DISCOVERY_FAILED`. Search matches only the canonical facet descriptor label and typed value label/value. Active criteria are pinned with exact zero counts when absent without inflating `distinctTotal` or changing observed ordering. Requested discovery exceptions are isolated from page and totals.

The contract adds only `ZERO_BASE` to `FacetDiscoveryResult.reason`, because the prior union could not truthfully distinguish an empty counterfactual base from a nonempty base with no concrete value. `NO_CONCRETE_VALUES` remains the latter state; `DISCOVERY_FAILED` remains local failure.

## TDD commits

- `60da457` — `test(filter): specify memory facet discovery` (red tests for same-facet counterfactuals, exact counts, and continuation)
- `db8db1b` — `feat(filter): discover contextual memory facets` (green planner and one-snapshot memory wiring)
- A final refactor commit records the expanded empty-state, search/pinning, latch, and browser-safe cursor tests plus implementation cleanup.

## Verification evidence

Focused tests cover same-facet Include/Exclude omission, other criteria and Around retention, typed exact counts, deterministic continuation, stale cursor isolation, label search, zero-base/no-concrete states, retired active pinning, and read-point stability. The workload/performance commands below are the release evidence; no UI, lookup/Around/Find implementation, IndexedDB code, or mutation controls are part of this ticket.
