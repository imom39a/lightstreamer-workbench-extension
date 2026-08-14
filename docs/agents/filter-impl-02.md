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
- Canonical duplicate typed identities retain the lexicographically smallest
  label (using code-unit ordering), making display labels independent of
  authoring order. Unsupported criteria remain represented and sort by
  `id`, `reason`, `detail`, then `facet`, with present optional fields before
  missing fields.
- Canonical bytes and equality omit presentation labels while retaining the
  deterministic in-memory display label. Runtime-malformed null mutation
  payloads and null unsupported fields fail with `INVALID_FILTER_MUTATION` or
  canonical validation failure without changing the prior Filter.
- A documented temporary scalar adapter for Build 1 compatibility. The legacy
  matcher and Event History production path remain unchanged; filter-impl-03
  owns the eventual catalog boundary.

## Red-green evidence

- `8d608d4` — failing canonical algebra contract tests.
- `9e3a2d0` — canonical typed Filter algebra implementation and green tests.
- `02d433d` — isolated temporary legacy scalar delegation and compatibility
  tests.
- `8f089b9` — red adversarial tests for label independence and runtime-cast
  null mutations/unsupported fields.
- `53866b2` — green implementation for the remaining review blockers.

## Verification

Verification for this pass:

- `npx vitest run tests/filter-algebra.test.ts --no-file-parallelism
  --maxWorkers=1`: 16/16 passed.
- `npm run typecheck`: passed.
- The requested single `npm test` run reached the known production extension
  build timeout: `tests/production-extension-build.test.ts` failed after
  6,210 ms in the ordinary suite. The unchanged test was rerun with
  `--testTimeout=30000 --no-file-parallelism --maxWorkers=1`: 1/1 passed,
  test time 1.95s.
- `npm run test:release`: 74/74 files and 938/938 tests passed in 78.54s.
- `npm run build`: passed; MV3 release artifact verification passed.
- `npm run docs:check`: passed for 4 documents and 10 maintained commands.
- `git diff --check`: passed.

No UI scenario or screenshot is affected because no shipped panel or
rendering path consumes the new algebra yet.

## Explicitly not delivered

The twelve-facet catalog/extractors, storage queries, runtime revision
commands, and UI remain outside this ticket.
