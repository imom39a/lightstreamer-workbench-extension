# `perf-followup-01` completion evidence

**Disposition:** Complete for the scoped real-Chrome filter-query capture.

**Date:** 2026-08-20
**Integrated commits:** `9bd03c6`, `3de5044`, `c220d9e`
**Project item:** `perf-followup-01 — Complete scoped real-Chrome filter query capture`
**Project item ID:** `PVTI_lAHOABNB-84BfMBxzg2b91Q`

## Evidence packet

The clean candidate, separately pinned reference, and clean comparison are:

- `/tmp/filter-impl-08-complete-candidate-3.json` (capture-only `NOT_CLASSIFIED`,
  no failures)
- `/tmp/filter-impl-08-complete-reference.json` (explicitly adopted scoped
  reference; canonical pending baseline was not changed)
- `/tmp/filter-impl-08-complete-comparison.json` (`PASS`, no failures)

Both browser runs used real headless Chrome for Testing `151.0.7922.138` on
darwin/arm64, native IndexedDB (`fakeIndexedDbUsed: false`), a fresh temporary
profile, and `non-interactive-layout-commit` proof mode. The source revision
was `c220d9e472ca31f2e40f24bc7103769fa7f38df5` and `source.dirty` was false.
This is a scoped headless/layout-commit proof; it does not claim foreground
compositor-frame scheduling.

The candidate contains six query cells (IndexedDB and memory, three samples
each) and six post-GC heap samples. All query correctness fields are true,
all query Long Task arrays are empty with supported observers, and all heap
samples report `status: PASS`. Find traversal is bounded (IndexedDB
candidate/projection reads `3/3`; memory `2/2`) with no residual scan. Lookup
hydrates exactly one payload per adapter/sample. The comparison independently
returned `PASS` with the same six query cells and six heap samples.

The heap probe is intentionally scoped: IndexedDB uses the `small-lifecycle`
shape; memory uses `small-lifecycle` and `ordinary-item-update`. Terminal,
checkpoint, and lifecycle pressure scenarios are excluded by this ticket’s
selection. No query thresholds or `PENDING_AGE` semantics were changed.

## Repair summary

- Commit-time memory query indexes now provide bounded facet/search/timestamp
  candidates and compact closed-activity retention.
- IndexedDB Find selects the rarest positive exact normalized-token or existing
  trigram posting; no write-amplifying six-gram index is retained.
- Long-task evidence is attributed only to entries that start during the
  measured query interval, so post-query GC is not misreported as query work.
- Focused verification: typecheck plus nine targeted test files, 93 passed and
  one skipped. Production extension build passed.
