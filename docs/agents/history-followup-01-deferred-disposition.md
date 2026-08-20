# `history-followup-01` deferred disposition

**Disposition:** Deferred, non-blocking — the visible Chrome 100k timing
packet is not complete.

**Date:** 2026-08-20
**Lane:** `codex/history-followup-01`
**Source revision inspected:** `58c828260e709f3a95af1b2f5b6996eb0797e663`
**Project item:** `history-followup-01 — Complete the visible Chrome 100k timing packet`
**Project item ID:** `PVTI_lAHOABNB-84BfMBxzg2dtRc`
**Project mutation:** None.

## Authorized visible override attempt — 2026-08-20

The product owner authorized one narrowly scoped visible-CFT151 invocation so
this lane would not remain blocked by the standing headless-only test policy.
The default policy remains headless; only the explicit
`--visible-cft151-override` script flag selects visible Chrome and the exact
`history-100k-activation` purpose. No retry was made after the first cell
failed, and the failure does not block the independent performance lane.

Command:

```text
LSEW_BROWSER_CACHE_DIR=/tmp/lsew-perf-followup-01/.cache/lsew-browsers
LSEW_HISTORY_100K_TIMEOUT_MS=1140000
npm run measure:event-history:100k:visible-override
```

The preserved report is
`/tmp/lsew-history-followup-01-visible-override/test-results/history-100k-07/activation.json`
(Markdown companion: `activation.md`). It records:

- `verdict: FAIL`, `headless: false`, `proofMode: visible-cft151`,
  `visibleCft151Override: true`;
- CFT `151.0.7922.138`, native IndexedDB, one fresh temporary profile, and
  the required unattended/remote-debugging flags;
- zero completed cells because `small-lifecycle/1` failed before page launch:
  Playwright rejected the duplicate `--user-data-dir` argument;
- no screenshot or compositor-frame evidence, and no 12-cell timing claim.

The follow-up repair in commit `5b4afba` lets Playwright own the persistent
profile directory and is covered by syntax/diff checks, but it was intentionally
not rerun in this bounded lane. The visible packet therefore remains In
Progress; the explicit override produced auditable failure evidence rather
than an acceptance claim.

## Reason for deferral

The standing requirement for ordinary Playwright and UI tests is that they
remain headless. The Project acceptance criteria require 3 independent samples
for each of four workloads in visible Chrome for Testing 151 through the
production React panel with native IndexedDB. The one explicitly authorized
visible override was attempted, but failed before the first page launched, so
those requirements are still not satisfied in this run.

The repository's existing 100k activation runner cannot supply the missing
proof: `scripts/event-history-100k-activation.mjs` defaults to `headless: true`
and declares `proofMode: "non-interactive"`; only the exact history override
selects `proofMode: "visible-cft151"`, and that attempt recorded
`compositorFrameMeasured: false` before any cell completed. The manual
performance workflow likewise states that non-interactive layout-commit
evidence does not claim a foreground compositor frame.

## Exact missing cells

Every row below is a required Project cell and remains missing. No row is
being marked complete from synthetic, unit, quota, or headless evidence.

| Workload | Sample 1 | Sample 2 | Sample 3 |
| --- | --- | --- | --- |
| `small-lifecycle` | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet |
| `ordinary-item-update` | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet |
| `large-json-rich` | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet |
| `representative-50-40-10` | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet | Missing visible Chrome 151 timing packet |

For each of the 12 cells, the missing packet must contain the Project-required
fresh-profile run and exact accepted/retained count, sequence/order,
capacity/terminal boundary, pressure, timing, and artifact result from visible
Chrome 151 plus native IndexedDB. In particular, no foreground-visible timing
or visible-browser acceptance exists for any cell.

## Evidence reviewed

- `docs/reference/event-history-performance-reference.json` is still
  `PENDING_MAINTAINER_BASELINE` with `cells: []`; no timing baseline was
  adopted.
- `docs/reference/event-history-performance-manual-workflow.md` permits only
  the headless `non-interactive-layout-commit` mode in this environment and
  disclaims compositor-frame proof.
- `scripts/event-history-100k-activation.mjs` has the intended 4-workload ×
  3-sample matrix, fresh temporary profiles, native IndexedDB, bounded
  identity evidence, and capacity/query assertions. Its default path remains
  headless; the exact visible override is now opt-in but failed before a cell
  could close this packet.
- No tracked `test-results/history-100k-07` report exists in this worktree.
  The pinned CFT151 cache and `node_modules` are also absent, so even the
  non-interactive runner could not be executed here.

Headless activation, synthetic/unit tests, quota estimates, and existing
historical 10k measurements remain useful supporting evidence only. They are
not substituted for these 12 visible cells.

## Checks in this lane

- Passed: `node --check scripts/event-history-100k-activation.mjs`.
- Passed: `node --check scripts/chrome-test-policy.mjs`.
- Passed: `git diff --check`.
- Blocked before browser launch: `npm run typecheck` (`tsc` is unavailable
  because dependencies are not installed).
- Blocked before browser launch:
  `npm run measure:event-history:100k` (`@puppeteer/browsers` is unavailable;
  the CFT151 cache is also absent).
- No Playwright or UI test launched visible Chrome.

## Approved next action

Keep this packet deferred and leave the Project item unchanged. A maintainer
or product owner must first record an explicit decision to either:

1. authorize a separately scoped visible-CFT151 exception and a runner that
   can produce the 12 required cells, or
2. replace/re-scope the visible-browser acceptance with the existing
   headless non-interactive contract.

Until that decision is recorded, do not alter the headless runner, adopt a
reference baseline, rerun substitute evidence, or claim visible-browser
acceptance.
