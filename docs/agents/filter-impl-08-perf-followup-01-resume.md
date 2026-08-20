# `filter-impl-08` resume capture disposition

Date: 2026-08-20; branch: `codex/perf-followup-01-resume`; source revision:
`278c439cb9ee57b804e501becf3fb9d546926448`

## Disposition

**DEFERRED — the single bounded headless capture produced useful query and
heap evidence, but not a clean adoptable candidate.** No reference or clean
comparison artifact was produced. The pending maintainer reference remains
unchanged. No retry was run.

## Bounded attempt

This lane ran exactly one direct foreground invocation with:

```text
LSEW_EVENT_HISTORY_PERF_MODE=non-interactive-layout-commit
LSEW_EVENT_HISTORY_PERF_SELECTION=filter-impl-08
LSEW_EVENT_HISTORY_PERF_CAPTURE=true
LSEW_EVENT_HISTORY_PERF_DEADLINE_MS=900000
LSEW_BROWSER_CACHE_DIR=/tmp/lsew-perf-followup-01/.cache/lsew-browsers
npm run measure:event-history
```

The runner used Node `v24.18.1`, Chrome for Testing `151.0.7922.138` on
`darwin/arm64`, `headless=true`, a fresh temporary profile, and native
IndexedDB (`fakeIndexedDbUsed=false`). The report was generated at
`2026-08-20T14:33:42.725Z`; the query shard resolved at `188056 ms`. No
visible browser was opened. Thresholds, workload sizes, and `PENDING_AGE`
semantics were not changed.

## Evidence

The authoritative report artifacts remain outside the repository:

- `/tmp/filter-impl-08-resume-capture.json` — 45,260 bytes.
- `/tmp/filter-impl-08-resume-capture.md` — 8,978 bytes.
- `/tmp/filter-impl-08-scoped-candidate.log` — prior full bounded-loop log,
  preserved from the earlier lane.

The wrapper did not create a final shell log because its post-run `status`
assignment hit zsh's read-only `status` variable after the runner had already
written the JSON and Markdown reports. The runner's final FAIL summary and
Chrome output remain in the captured session transcript; the report files are
the authoritative evidence.

The report has `decision.verdict=FAIL`, `source.dirty=false`,
`runner.product=Chrome/151.0.7922.138`, `queryCells=6`, `heapSamples=6`, and
`cells=0`. The scoped selection intentionally omits terminal-pressure,
checkpoint-pressure, and lifecycle scenarios. Its global decision nevertheless
also reports full-run expectations such as `Expected 36 matrix samples`,
terminal scenarios, and checkpoint scenarios, so this artifact is not
`NOT_CLASSIFIED` and cannot be adopted.

### Query p95 provenance

These are the exact per-sample `latency.*P95Ms` fields from the JSON report;
they are diagnostic evidence only and do not constitute an accepted p95
claim:

| Adapter/sample | Recent 50 | Recent 100 | Structured 50 | Structured 100 | Find | Lookup | Around |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IndexedDB/1 | 6.40 | 11.20 | 4.10 | 3.90 | 40.10 | 7.90 | 43.30 |
| IndexedDB/2 | 5.50 | 8.50 | 2.80 | 2.60 | 25.50 | 5.90 | 36.50 |
| IndexedDB/3 | 5.60 | 8.50 | 2.90 | 2.60 | 26.10 | 5.90 | 35.90 |
| Memory/1 | 2.40 | 2.30 | 8.30 | 8.20 | 23.70 | 3.50 | 2.40 |
| Memory/2 | 2.40 | 2.20 | 7.80 | 8.80 | 23.60 | 3.50 | 2.90 |
| Memory/3 | 2.60 | 2.00 | 8.00 | 8.10 | 23.10 | 3.30 | 2.80 |

IndexedDB query correctness was exact for all three samples. Memory reported
`totalsExact=false`, `orderExact=false`, `collisionExact=false`, and
`findIndependent=false` for all three samples; its query telemetry reported
zero candidate/projection reads and `bounded=false`. Memory query Long Tasks
were `259 ms`, `221 ms`, and `219 ms`.

### Heap evidence

The six heap operations completed, but the unchanged post-GC threshold rejected
their deltas:

| Adapter | Sample 1 | Sample 2 | Sample 3 |
| --- | ---: | ---: | ---: |
| IndexedDB | 20,645,168 bytes | 20,813,868 bytes | 20,191,996 bytes |
| Memory | 19,750,920 bytes | 19,927,752 bytes | 19,885,696 bytes |

Each exceeds the existing `8,388,608`-byte gate. No threshold was altered.

## Artifact status

| Artifact | Status |
| --- | --- |
| Scoped capture JSON/Markdown | Produced and preserved, but FAIL and not adoptable |
| Adopted reference | Not produced; `docs/reference/event-history-performance-reference.json` remains `PENDING_MAINTAINER_BASELINE` |
| Clean comparison | Not produced because no reference was adopted and no second benchmark was authorized |
| Timing/p95 provenance | Preserved per query cell above; no authoritative p95 claim |

The watchdog and Find-probe repairs are already integrated in ancestor commit
`e93037c`. This resume commit records only the new bounded evidence and its
deferral; no Project ticket was edited.
