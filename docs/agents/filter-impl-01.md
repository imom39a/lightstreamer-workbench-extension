# `filter-impl-01` implementation record

Change class: **Non-UI**. This prefactor adds a storage- and renderer-neutral
Build 2 filtering contract, deterministic accepted-Evidence fixtures, and
contract tests. It is not imported by the Workbench panel or runtime, so it
changes no browser-visible behavior and affects no visual baseline.

The contract uses one atomic query result for page, exact `matching` and `inScope`
totals, requested facet discovery, selected-Evidence lookup, Reveal blockers,
and optional Find navigation. Every section is tied to one explicit History
Interval, Retained Range, and Committed Evidence Boundary. The deterministic
fixture is fixed at the normal 10,000-Evidence capacity and contains 3,842
distinct COMMAND keys, collision-safe typed identities, free text, Around
Evidence, include/exclude, zero-result conflict, and fail-closed unsupported
criterion cases.

The maintained scenario manifest names the primary Include → Exclude → Reveal
→ Reset journey and the empty, conflict, unsupported, unavailable,
hidden-selection, terminal, lower-capacity fallback, and high-volume states.
The lifecycle manifest separately names Clear invalidation, terminal history,
memory fallback, Limited Observation Coverage, and concurrent committed
Capture.

Lifecycle and panel-state scenario contracts remain separate from production
rendering; later implementation tickets can run the same suite against memory
and IndexedDB adapters and add browser scenarios without changing this seam.
