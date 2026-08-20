# `history-followup-01` deferred disposition

**Disposition:** Deferred, non-blocking. The visible Chrome 100k packet has no
acceptance report, so this item is not marked Done.

**Date:** 2026-08-20
**Project item:** `history-followup-01 — Complete the visible Chrome 100k timing packet`
**Project item ID:** `PVTI_lAHOABNB-84BfMBxzg2dtRc`
**Integrated fix:** `e61d90e` (history commit watchdog; isolated fix `6dba5f3`,
later comment-only amend `39a4012`)

## Authorized visible retry

The product owner authorized the exact visible CFT151 override below. Ordinary
Playwright and UI tests remain headless; no other visible browser run was made.

```sh
test ! -L .cache/lsew-browsers && \
test -d /tmp/lsew-perf-followup-01/.cache/lsew-browsers && \
LSEW_BROWSER_CACHE_DIR=/tmp/lsew-perf-followup-01/.cache/lsew-browsers \
LSEW_HISTORY_100K_TIMEOUT_MS=1800000 \
LSEW_HISTORY_100K_OUTPUT=/tmp/lsew-history-followup-01-visible-fix-run \
npm run measure:event-history:100k:visible-override
```

The retry used CFT `151.0.7922.138`, native IndexedDB, and fresh isolated
profiles. It ran for about 20 minutes and was stopped at the bounded lane
timebox (exit 130) before the matrix produced a report. The output directory
contains no `activation.json`, Markdown report, or screenshots; therefore
there are **0/12 accepted cells** and no visible timing/compositor claim.

The production repair removed the premature 2-second commit watchdog for the
multi-index Evidence transaction and uses a bounded 30-second commit ceiling.
The 100k/256 MiB capacity gates were not changed. Focused history verification
passed 70 tests; typecheck and production build passed on the fix worktree.

## Non-blocking follow-up

The missing packet remains a maintainer follow-up. Do not substitute the prior
failed artifact, headless evidence, synthetic tests, or quota measurements for
the required visible 12-cell packet. This deferred item does not block the
independent `perf-followup-01` lane, which completed its scoped headless proof.
