# `filter-impl-08` real-Chrome capture follow-up disposition

Date: 2026-08-20; branch: `codex/perf-followup-01`
Scope: ticket-scoped `filter-impl-08` real-Chrome query proof only

## Disposition

**DEFERRED — no clean candidate, reference, or comparison artifact was
completed.** The bounded loop reached real headless Chrome 151 and exposed two
scoped runner defects, both repaired and covered by focused tests. The final
capture reached the query-shard completion and heap page, but the execution
environment terminated the long-running command session before the runner
could write its report. No p95 claim is made and the pending reference remains
unmodified.

## Required proof

The intended command was the repository's explicit non-interactive selection:

```text
LSEW_EVENT_HISTORY_PERF_MODE=non-interactive-layout-commit
LSEW_EVENT_HISTORY_PERF_SELECTION=filter-impl-08
LSEW_EVENT_HISTORY_PERF_CAPTURE=true
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers
npm run measure:event-history
```

Every attempt used Chrome for Testing `151.0.7922.138` on `darwin/arm64`,
`--headless=new`, a unique temporary profile, native IndexedDB, and the
unattended flags `--use-mock-keychain --password-store=basic --disable-sync
--no-first-run --no-default-browser-check`. No visible browser was opened.
The selection retains its existing query and heap gates; terminal-pressure,
checkpoint-pressure, and lifecycle scenarios remain excluded. Thresholds and
`PENDING_AGE` semantics were not changed.

## Bounded loop evidence

| Attempt | Source state | Result | Exact evidence |
| --- | --- | --- | --- |
| 1. Existing `f34a47b` path | clean at `58c8282` | Fail-closed timeout before query timings | `/tmp/filter-impl-08-noninteractive-capture.json` records `elapsedMs=31284`, `progressStageAgeMs=30064`, `progressStageDeadlineMs=30000`, IndexedDB fixture `offered=10000`, `settled=null`. Heartbeats were live, but the constant `filter-query-fixture/receipt-settlement` stage key exhausted the query ceiling. |
| 2. Receipt-stage repair retry | dirty (watchdog test/repair) | Fail-closed harness rejection | `elapsedMs=58916`; Chrome reached the optional Find probe, which threw `TypeError: Cannot read properties of undefined (reading 'sequence')`. `EvidenceFindResult.matches` contains identities directly; the harness incorrectly read `entry.identity.sequence`. |
| 3. Final repaired capture | dirty (harness probe repair) | Query shard resolved; report not written | The clean log recorded `state=resolved elapsedMs=175005` for the scoped query shard. The runner then opened its heap page; the command session was terminated at about 6:09 wall time while Chrome remained headless and CPU-active. No candidate JSON/Markdown report was produced. |

The supplied `/tmp/filter-impl-08-scoped-candidate.log` did not exist at the
start of the lane. The bounded attempts created fresh logs; the first
fail-closed diagnostic remains at
`/tmp/filter-impl-08-noninteractive-capture.json`.

## Repairs in this lane

- Receipt/offer/commit substages now receive the existing 120-second stage
  watchdog when the substage carries that work, even when its parent stage is
  named `filter-query-fixture` and also contains `query`. Ordinary query and
  close/read ceilings remain 30 seconds, and the dedicated `PENDING_AGE`
  branch remains unchanged.
- The scoped Find correctness probe reads `EvidenceFindResult.matches` as
  `EvidenceIdentity[]` and uses `entry.sequence`.

## Artifact status

| Artifact | Status |
| --- | --- |
| Candidate capture JSON/Markdown | Not completed; the existing JSON is a fail-closed timeout diagnostic, not a candidate. |
| Separately adopted reference | Not attempted; adoption requires a clean `NOT_CLASSIFIED` candidate with complete query and heap evidence. `docs/reference/event-history-performance-reference.json` remains `PENDING_MAINTAINER_BASELINE`. |
| Clean comparison JSON/Markdown | Not produced because no reference was adopted. |
| Timing/p95 provenance | No query p95 values are authoritative or claimed. |

## Verification

- Focused runner, harness, and gate suites: **230/230 passed**.
- `tsc --noEmit`: **passed**.
- Real-Chrome attempts: headless CFT151 only; no visible UI.

Completion requires a new clean-source run after this commit can complete its
heap phase, followed by explicit reference adoption and one clean comparison.
