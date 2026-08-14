# Event History performance gate manual workflow

This is a deliberate developer-run gate, not ordinary CI. It measures the
authoritative `EventHistory.offer` → `follow` → `read` boundary through the
production React `WorkbenchPanel` path in headless Chrome for Testing major
151. The runner's only supported proof mode is
`non-interactive-layout-commit`; it records DOM/layout publication evidence and
does not claim a foreground compositor frame.

## Run

Use the exact cached Chrome for Testing 151 and fail closed if it is absent:

```sh
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers \
npm run measure:event-history
```

The runner is unconditionally headless and refuses a system-Chrome fallback, fake IndexedDB,
and missing reference data. It runs three independent samples for every adapter,
workload, and payload-shape matrix cell, plus three post-GC heap samples for
each checkpoint tier. It writes the machine report and concise interpretation
to `test-results/event-history-performance.json` and `.md`.

The headless file harness launches Chrome with the centralized unattended-test
policy (`--use-mock-keychain`, `--password-store=basic`, `--disable-sync`,
`--no-first-run`, `--no-default-browser-check`, and the supported password,
sign-in, and profile-onboarding feature disables). It also uses
`--disable-features=CalculateNativeWinOcclusion`; it does not create or
activate desktop windows, request focus, or run compositor/rAF diagnostics.
The workload, long-task, boundary, and storage semantics are unchanged.

An explicit `LSEW_EVENT_HISTORY_PERF_MODE=headed-visible-frame` request fails
before Chrome launch with a headless-only policy error because that legacy
mode cannot make its compositor claim without a desktop window.

The pinned reference is [event-history-performance-reference.json](event-history-performance-reference.json).
A report never replaces it automatically. A reference update requires an
explicit maintainer rationale and disposition in the same focused change.

### Non-interactive closure mode

The supported non-interactive proof uses a fresh temporary profile, real native
IndexedDB, real DOM/React, and the same 36-cell, query, scenario, heap, and
absolute-threshold workloads. It does not activate windows, request focus,
probe rAF, use screencasts, or claim a headed compositor result. The
compositor-dependent publication confirmation is replaced only by the
independently instrumented production React
layout-effect/DOM publication boundary; query, storage, correctness, heap, and
performance thresholds are unchanged.

Capture a candidate without self-adoption:

```sh
LSEW_EVENT_HISTORY_PERF_MODE=non-interactive-layout-commit \
LSEW_EVENT_HISTORY_PERF_CAPTURE=true \
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers \
npm run measure:event-history
```

The JSON and Markdown artifacts explicitly report
`proofMode=non-interactive-layout-commit`, `headless=true`, and
`compositorFrameMeasured=false`. Adoption is a separate deliberate local
operation, followed by a clean comparison run; a candidate never becomes its
own reference.

The legacy `LSEW_BROWSER_HEADLESS` and `LSEW_UI_HEADLESS` variables no longer
select a visible browser; setting either to `false` is ignored by the launch
policy.

For the `filter-impl-08` closure, add the explicit scoped selection:

```sh
LSEW_EVENT_HISTORY_PERF_MODE=non-interactive-layout-commit \
LSEW_EVENT_HISTORY_PERF_SELECTION=filter-impl-08 \
LSEW_EVENT_HISTORY_PERF_CAPTURE=true \
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers \
npm run measure:event-history
```

This selection runs the native IndexedDB/memory query matrix, bounded
hydration/index telemetry, the existing exact-threshold query gates, and the
post-GC heap check. It excludes terminal-pressure, checkpoint-pressure, and
lifecycle scenarios. Its `filter-impl-08-noninteractive-layout-commit`
metadata explicitly disclaims foreground scheduling and compositor proof.
The ordinary full-release selection remains the default and is unchanged.

## Absolute decision

`FAIL` is emitted for any correctness, ordering, boundary, terminal, telemetry,
Long Task, query, latency, or heap breach. The classifier evaluates each
sample independently; one failed sample is never hidden by an average.
`REVIEW` is emitted only when every absolute gate passes but the environment is
not comparable or a comparable median regresses by more than 20%. `PASS`
requires all absolute gates and a comparable pinned reference.

The timing thresholds are the accepted Event History contract: IndexedDB
sustained visible p95 ≤100 ms and burst final boundary ≤30 s; memory sustained
visible p95 ≤50 ms and burst final boundary ≤1 s; recent page ≤50 ms;
structured/indexed ≤100 ms; Find/full ≤500 ms; no capture/commit/paint Long
Task >50 ms; query phase allows at most one >50 ms Long Task only for one large
JSON sample and no query Long Task >125 ms; post-GC heap ≤8 MiB for IndexedDB
at 100,000 events and ≤32 MiB for memory at 5,000 events.

## Artifact review

Inspect the JSON for exact environment, source revision/dirty state, shape
bytes, identifiers/order, pressure and terminal facts, transaction/index
telemetry, query distributions, Long Tasks, heap, and lifecycle samples.
Inspect the Markdown matrix and retain the report with the cutover evidence.
An unpacked-extension smoke may be run separately with
`npm run test:ui:extension`; it also uses cached CFT151 only and is
unconditionally headless. Docking overhead is integration evidence, not a
timing baseline.

The supporting production-panel artifact command is also fail-closed and uses
the same headless browser pin:

```sh
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers \
npm run measure:panel
```
