# `history-followup-01` deferred disposition

**Disposition:** Deferred — the visible Chrome 100k timing packet is not
complete.

**Date:** 2026-08-20
**Lane:** `codex/history-followup-01`
**Source revision inspected:** `58c828260e709f3a95af1b2f5b6996eb0797e663`
**Project item:** `history-followup-01 — Complete the visible Chrome 100k timing packet`
**Project item ID:** `PVTI_lAHOABNB-84BfMBxzg2dtRc`
**Project mutation:** None.

## Reason for deferral

The standing requirement for this lane is that Playwright and UI tests remain
headless and that no visible Chrome is launched. The Project acceptance
criteria require 3 independent samples for each of four workloads in visible
Chrome for Testing 151 through the production React panel with native
IndexedDB. Those requirements cannot both be satisfied in this run.

The repository's existing 100k activation runner cannot supply the missing
proof: `scripts/event-history-100k-activation.mjs` launches with
`headless: true`, declares `proofMode: "non-interactive"`, and records
`compositorFrameMeasured: false`. The manual performance workflow likewise
states that non-interactive layout-commit evidence does not claim a foreground
compositor frame, and explicitly rejects the headed-visible-frame mode under
the headless-only policy.

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
  identity evidence, and capacity/query assertions, but is unconditionally
  headless and therefore cannot close this visible packet.
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
