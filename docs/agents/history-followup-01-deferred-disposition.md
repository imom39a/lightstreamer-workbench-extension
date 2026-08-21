# `history-followup-01` accepted-outlier disposition

**Disposition:** Closed / Done as an accepted outlier. The owner accepted the
visible 100k packet's large-journal cleanup diagnostics rather than spending
another multi-hour browser session on this edge case. This is not a clean
canonical PASS packet.

**Date:** 2026-08-20
**Project item:** `history-followup-01 — Complete the visible Chrome 100k timing packet`
**Project item ID:** `PVTI_lAHOABNB-84BfMBxzg2dtRc`
**Perf companion:** `perf-followup-01` is independently complete and passed.

## Evidence and boundary

The authorized visible CFT151 run completed all 12 cells and captured all 12
screenshots at:

- JSON: `/tmp/lsew-history-followup-01-visible-bounded-5/activation.json`
- Markdown: `/tmp/lsew-history-followup-01-visible-bounded-5/activation.md`
- Source revision: `518edd04311ba893960287561f3bd1b79e8fce39`
- Runner: CFT `151.0.7922.138`, native IndexedDB, visible override, fresh
  isolated profile per cell

Every cell passed ordered publication, ordered retention, boundary identity,
retained-range identity, terminal publication, panel-mounted, and pressure
checks. The report is `FAIL` only because six large-journal closes emitted
`Failed to close panel event history. Timed out while clearing Event History.`
No cell data, capacity gate, or correctness assertion failed.

## Cleanup fix attempted

Commit `9e5b01d` changes controlled close to close and delete the session
database instead of clearing all derived index stores in one giant transaction;
it also gives the delete request a bounded timeout. Typecheck, build, and 78
focused IndexedDB/lifecycle tests passed. A final visible run using that fix
was started with a six-hour cap, then stopped at the owner's direction because
the package was too long; it produced no replacement acceptance report.

The accepted-outlier decision therefore records the real limitation: the
visible 12-cell timing evidence is valid for workload correctness and pressure,
but the clean controlled-close packet remains a maintainer follow-up if the
cleanup edge case becomes worth another long Chrome session.
