# `filter-impl-03` implementation record

Change class: **Non-UI**. This pass closes the Evidence facet extraction
review and gate blockers without adding query, index, storage, runtime, or UI
integration.

## Delivered

- Restored the dedicated `tests/evidence-facets.test.ts` contract suite with
  per-descriptor extraction, descriptor/key immutability, ownership-qualified
  collision identities, missing/null distinctions, semantic deferred facts,
  strict snapshot phases, synthetic Local provenance, and canonical search
  text independence from raw payloads and property order.
- Froze the exported `EVIDENCE_FACET_KEYS` tuple at runtime; descriptors and
  extracted catalog collections remain frozen as well.
- Canonicalized protocol enum mode and COMMAND operation values to uppercase,
  making their typed identities case-independent.
- Exposed COMMAND operation only for a concrete COMMAND subscription and made
  unknown capture sources unavailable instead of guessing `LISTENER`.
- Updated the release test-plan count for the restored dedicated suite while
  preserving the Build1 compatibility and workload boundaries.

## Red-green evidence

- `02c88a7` — red restoration and blocker-focused contract tests.
- `09ac4d3` — green Evidence facet implementation.
- `f818e40` — release plan accounting for the restored test file.

## Verification

- Focused facet/adjacent tests: 29/29 passed.
- `npm run typecheck`: passed.
- `npm run test:release`: 75/75 files, 949/949 tests passed.
- `npm test`: ordinary 69/69 files, 765 tests; serialized 6/6 files, 184
  tests passed. The known production-build timeout did not recur.
- `npm run build`: passed with MV3 release artifact verification.
- `npm run docs:check`: passed for 4 documents and 10 maintained commands.
- `git diff --check`: passed.

No GitHub access, push, query/index integration, runtime expansion, or UI
change was performed.
