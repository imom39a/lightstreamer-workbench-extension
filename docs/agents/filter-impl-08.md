# filter-impl-08 proof

Status: implemented on `codex/filter-impl-08` from `93188cd20ff0714363b4840abe7edc13390fb274`.

This change adds the public `EvidenceFilterQueryAdapter.query` implementation to the IndexedDB Event History adapter. The readonly transaction reads `historyControl`, `evidence`, and `facetPostings` together, derives one immutable interval/boundary/retained-range read point, rejects stale points, and evaluates the shared memory semantics (`evaluateFilter`, `normalizeAround`, `lookupEvidence`, and `findEvidence`). Page records are payload-free; selected lookup alone receives an immutable payload copy. Unsupported criteria return exact zero base totals, Around uses the shared half-open rules, Find remains independent of Filter, and closed histories reject later queries.

Focused proof:

- `tests/filter-impl-08-indexeddb-query.test.ts` covers memory/IndexedDB page and totals parity, Around, selected blockers and Find, unsupported fail-closed evaluation, Clear invalidation, and typed facet algebra.
- `npm run typecheck` passes.
- `npx vitest run tests/filter-impl-08-indexeddb-query.test.ts --no-file-parallelism --maxWorkers=1` passes.
- Existing `filter-impl-06-memory` and `filter-impl-07-postings` suites pass.

The adapter preserves v3 schema, posting writes, migration, admission, terminal, cleanup, and ownership behavior. UI, runtime publication, discovery continuation, and browser visual verification are outside this non-UI ticket.
