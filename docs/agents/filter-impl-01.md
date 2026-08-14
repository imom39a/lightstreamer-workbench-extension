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

## Repair record

The independent review of `dd40e67` identified declaration-only coverage,
collision-incomplete fixtures, shallow immutability, missing lifecycle
transitions, incomplete bounded-workload proof, and an unintegrated scenario
manifest. The repair stays within this storage/renderer-neutral seam.

The executable reference adapter, facet catalog, deterministic fixture builder,
typed predicate evaluation, discovery, and lifecycle harness live entirely in
`tests/support/`; production exposes only generic storage-neutral contract types
and the atomic query interface. The support
seam evaluates typed include/exclude criteria, free text, half-open Around
Evidence, unsupported fail-closed queries, exact totals, bounded page and
facet-discovery continuation, retained/other-interval lookup with Reveal
blockers, and Find navigation. It also enforces the concrete 5,000-record
memory fallback bound and exercises Clear invalidation, terminal final
boundaries, Limited Observation Coverage, and concurrent Capture.

The fixture now carries page- and owner-qualified identities plus explicit
client, session, listener, missing-value, literal-`"null"`, and case-sensitive
`ABC`/`abc` collision cases. Facet catalogs, scenario manifests, scenario
themes, fixture records, identities, and nested collision values are frozen.
All nine maintained filter scenarios now construct distinct deterministic
Capture state and run through the test-only semantic reference runner. Their
expected outcomes assert concrete totals plus relevant blockers, coverage,
storage, terminal, discovery, retained-range, and high-volume key facts; the
empty scenario is truly empty. Scenario setup uses semantic test actions rather
than fictional UI selectors, without adding runtime or visible UI behavior.

Red-first evidence is preserved in commits `ffc5ea9` and `b3916cb`; the
executable repair is in `b232743` and `916f7bd`. Final documentation and
verification are recorded in the follow-up commit for this repair.
