# `filter-impl-02` implementation record

Change class: **Non-UI**. This ticket adds a storage- and renderer-neutral
canonical Filter algebra. It does not change the panel, Event History query
path, runtime commands, facet catalog, extractors, or browser-visible output.

## Delivered

- Versioned immutable `Filter` with typed values and identity
  `JSON.stringify(["v1", facet, type, value])`.
- AND across facets, OR within same-facet Includes, Exclude subtraction,
  normalized free text, half-open interval evaluation, and external Scope.
- Canonical ordering, identity deduplication, equality, JSON serialization,
  and deep freezing.
- Atomic revision-checked add/remove/set/clear/reset mutations with stale and
  invalid outcomes that preserve the prior Filter.
- Typed string, enum, number, boolean, and null rules; unsupported criteria
  evaluate fail-closed.
- A documented temporary scalar adapter for Build 1 compatibility. The legacy
  matcher and Event History production path remain unchanged; filter-impl-03
  owns the eventual catalog boundary.

## Red-green evidence

- `8d608d4` — failing canonical algebra contract tests.
- `9e3a2d0` — canonical typed Filter algebra implementation and green tests.
- `02d433d` — isolated temporary legacy scalar delegation and compatibility
  tests.

## Verification

Focused algebra and Build 1 tests, typecheck, full unit tests, production
build, docs checks, and diff checks are recorded in the implementation handoff
for this ticket. No UI scenario or screenshot is affected because no shipped
panel or rendering path consumes the new algebra yet.

## Explicitly not delivered

The twelve-facet catalog/extractors, storage queries, runtime revision
commands, and UI remain outside this ticket.
