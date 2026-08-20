# `filter-impl-08` repair proof

## Native-window frame diagnosis (2026-08-13)

The prior paint-stage activation and 32 ms rAF watchdog experiments timed out
with no callback for the final React-owned rAF. Both are removed: activation is
now lifecycle setup only, and a real `requestAnimationFrame` callback remains
the sole visible-frame proof. Authoritative harness targets are created as
dedicated native top-level windows with explicit bounds, then verified through
`Target.getTargetInfo` and `Browser.getWindowForTarget` before page setup.
Optional `LSEW_EVENT_HISTORY_PERF_FRAME_DIAGNOSTICS=true` enables bounded
diagnostic-only Chrome tracing and Target lifecycle capture; those artifacts
must not be used as performance measurements.

The clean native-window follow-up reached the prior failure boundary again.
The independent CDP rAF probe also timed out while `document.hasFocus()` and
`document.visibilityState === "visible"` remained true. Page screencast
delivery produced only three initial frames and no trace chunks were reported.
This rules out a React-only routing issue; the remaining failure is headed
CfT151/macOS compositor frame suppression. No visible-frame or performance
PASS is claimed.

## Per-target macOS activation follow-up (2026-08-13)

The first activation attempt ran only once before the initial target. Native
window creation and exact target/window verification now establish the page's
window topology before setup. Launch Services activation remains bounded
process-level lifecycle control only; it does not substitute for the
foreground double-rAF gate or workload visible-frame proof, and any activation
failure aborts setup closed.

## macOS activation-flag repair (2026-08-13)

The performance runner restores the macOS-only `--activate-on-launch` Chrome
argument. The file harness eliminated the prior raw-navigation confounder, so
the activation flag can again address the remaining macOS foreground
activation risk without changing document setup. The runner still starts with
`about:blank`, keeps `--no-proxy-server` and
`--disable-features=CalculateNativeWinOcclusion`, and creates the browser
target through the existing browser-target flow.

For a headed runner launched from background cmux, both launch controls are
needed for reliable `requestAnimationFrame` scheduling: native window
occlusion must be disabled and the macOS window must be activated. The
`Page.bringToFront` followed by bounded double-frame
`document.visibilityState` gate remains authoritative for foreground
readiness. Exact URL polling still accepts only the committed harness URL and
complete page-token/query identity. This repair was validated without
launching Chrome; no Chrome performance result or claim is made.

## Fresh-document polling repair (2026-08-13)

The failed capture stopped before benchmark execution at a redundant raw
`Page.navigate` request: CDP and the renderer were live, but navigation could
remain pending on CfT 151/macOS even though `Target.createTarget` had already
requested the exact URL. `ensureFreshHarnessDocument` now never navigates.
After `Page.enable` and `Runtime.enable`, it boundedly polls cancellable
`Runtime.evaluate("location.href")` until the URL is an exact string match,
including the complete pageToken/query identity. `about:blank`, stale metadata,
different tokens, and other mismatches are not accepted or navigated. A
never-committing document fails with structured `page-document-polling`
evidence, while a pending evaluation is cancelled and reported at
`page-document-evaluate`. Capture remains observational, and no Chrome was
launched during this implementation or its tests.

The same failed run exposed a separate cleanup-composition defect: the outer
finalizer's one-second bound could expire before `terminateChild` completed its
documented SIGTERM/SIGKILL sequence. Finalization now passes an absolute
deadline into termination, with an outer allowance that contains both cleanup
phases; deterministic just-under and over-budget tests preserve the primary
error and retain termination diagnostics.

## Outer finalization repair (2026-08-13)

The final lifecycle review found that outer timeout evidence and `finally`
cleanup could replace the primary `PerformanceOperationTimeout` or keep the
runner alive indefinitely. `main()` now records the primary outcome before
entering finalization. Evidence writing, CDP close, Chrome termination, HTTP
server cleanup, and temporary-root removal each run through a finite,
best-effort bound that catches synchronous throws and rejected promises.

Secondary failures are retained as structured `outerDiagnostics` on the
primary error when it is extensible. A cleanup failure without a primary
failure raises an explicit `PerformanceOuterCleanupError`, so cleanup cannot
silently turn a run into success. Workload sizes, the shared proof deadline,
thresholds, and capture/reference semantics are unchanged. No Chrome was
launched and no real capture was run.

Deterministic regressions combine a primary timeout with failing and
never-settling evidence, throwing CDP close, rejecting and throwing child
termination, never-settling server cleanup, and failing and never-settling
temporary-root removal.

## Final lifecycle repair (2026-08-13)

The final lifecycle review found three fail-closed gaps. Startup timeout handling
now always writes JSON and Markdown evidence, even when failure occurs before
`Browser.getVersion` and before Chrome/environment metadata exists. The evidence
retains the source revision, single proof deadline, operation phase, rejected
status, and explicit `null`/`unknown` partial metadata; it never fabricates a
runner or environment value.

`preparePageForAuthoritativeRun` now derives a finite deadline for numeric and
default calls and routes both `Page.bringToFront` and `Runtime.evaluate` through
the cancellable bounded control-CDP path. Final HTTP-server cleanup tracks active
sockets, retires them with `closeAllConnections`, and returns after a bounded
cleanup deadline even if the close callback never arrives. Temporary-directory
cleanup remains in `finally` after this bounded cleanup.

Deterministic regressions cover initial `Page.enable` timeout evidence creation,
pending visibility-request cancellation, and never-callback server cleanup.
Workload sizes, the one proof deadline, thresholds, and capture/reference
semantics are unchanged. No Chrome was launched and no real capture was run.

## Polling-timeout repair (2026-08-13)

The bounded startup audit found that fresh-document URL polling and harness
readiness polling could reach their absolute deadline after every
`Runtime.evaluate` had settled, then throw an unstructured `Error`. Those
failures bypassed the existing `PerformanceOperationTimeout` /
`SHARED_DEADLINE_EXCEEDED` diagnostic path and therefore lost phase evidence.
The repair reports structured timeout status for `page-document-polling` and
`harness-readiness`, preserving JSON/Markdown timeout handling.

`ensureFreshHarnessDocument` now derives a finite deadline when called without
options and routes setup plus URL evaluations through the cancellable bounded
control-CDP request path. No raw no-options evaluation can remain pending;
the existing finite shared-deadline production path and all workload, proof
gates, capture/reference semantics, and the single absolute proof deadline
remain unchanged.

Deterministic regressions cover both settled-request polling expiries and the
no-options request-retirement contract. No Chrome was launched and no real
performance capture was run; no Chrome candidate claim is made.

### Polling-timeout verification

- Focused script: 1 file, 23 tests passed.
- Focused runner: 1 file, 78 tests passed.
- `npm run typecheck` passed.

## Initial-startup deadline repair (2026-08-13)

The final startup audit found that `main()` called
`prepareInitialPageForAuthoritativeRun()` before creating `proofDeadlineAt`.
That left initial `Page.enable`, `Runtime.enable`, harness
readiness, foreground visibility, and URL/token evaluations outside the one
absolute proof budget. A hung initial CDP request could therefore keep the
headed runner alive indefinitely even though later matrix, heap, and lifecycle
operations had deadline handling.

The repair creates `proofDeadlineAt` immediately after the initial CDP
connection and passes it through initial preparation and `Browser.getVersion`.
All setup and evaluation requests use bounded local retirement with the
existing structured `PerformanceOperationTimeout` / `SHARED_DEADLINE_EXCEEDED`
diagnostic. The same deadline remains authoritative for fresh harness pages,
matrix, heap, lifecycle, and bounded cleanup. Workload sizes, gates, and
capture/reference semantics are unchanged.

Deterministic startup regressions hang initial `Page.enable`, assert structured
fail-closed rejection, and verify that time
spent in initial setup is charged against later fresh-page work. No Chrome
performance candidate was launched and no Chrome success is claimed.

### Initial-startup verification

- Focused runner: 1 file, 78 tests passed.
- Focused startup script: 1 file, 20 tests passed.
- `npm run typecheck`, `npm test`, `npm run test:release`, `npm run build`, and `npm run docs:check` passed.
- `npm run release:package:all` passed; package sizes are recorded in `/tmp/filter-impl-08-initial-startup-repair-result.txt`.
- No real Chrome performance candidate was launched, and no Chrome success is claimed.

### Prior deadline repair (2026-08-13)

The live timeout audit found that the performance proof's shared deadline stopped
at matrix shard operations: fresh harness `Target.createTarget` and
`Target.closeTarget` used unbounded control-CDP promises, and heap/lifecycle
work reset to independent one-hour or phase ceilings. The repair establishes one
absolute `deadlineAt` after authoritative preparation, threads it through matrix,
heap, forced-GC, lifecycle, and cleanup work, and bounds target creation/close
requests (including setup-failure cleanup). Expiry produces the existing
fail-closed `PerformanceOperationTimeout` evidence with the last operation and
progress status when available; cleanup remains bounded after expiry.

The hardening follow-up preserves a primary matrix, heap, lifecycle, or fresh-page
setup error when bounded target cleanup also fails, while standalone cleanup still
fails closed. Fresh-page attach, document setup, harness readiness, and foreground
activation consume the same absolute deadline; cleanup after expiry remains capped
by the control-request ceiling. Timeout evidence reports the elapsed time of the
timed-out request while retaining the prior operation id and progress.

Deterministic verification covers hung `Target.createTarget`, hung
`Target.closeTarget`, primary-error preservation with cleanup timeout, standalone
cleanup timeout, expired shared deadlines before heap and lifecycle, truthful
control-timeout elapsed time, declaration callback parity, and whole-run deadline
propagation. No real performance candidate was launched and no Chrome performance
success is claimed.

### Hardening verification

- Focused runner: 1 file, 78 tests passed.
- Isolated authoritative IndexedDB regression: 1 file, 65 tests passed.
- Isolated postings regression: 1 file, 3 tests passed.
- Isolated startup/timeout script tests: 1 file, 17 tests passed.
- `npm test`: ordinary phase 74 files / 830 tests passed; serialized phase passed.
- `npm run test:release`: 83 files / 1,026 tests passed.
- `npm run typecheck`, `npm run build`, and `npm run docs:check` passed; docs check covered 4 documents and 10 maintained commands.
- `npm run release:package:all` passed. ZIP: 326,633 bytes; CRX: 329,219 bytes.
- No real Chrome performance candidate was launched, and no Chrome success is claimed.

The IndexedDB query adapter uses one readonly transaction over `historyControl`,
`facetPostings`, `queryProjections`, and selected `evidence` payloads. The
authoritative v3 Evidence record shape remains exact; schema version 4 adds a
separate sequence-keyed `queryProjections` store. Commits and Clear update the
projection store atomically with Evidence, postings, and control. Empty v3
projection stores are backfilled only during the explicit old-database upgrade
path; ordinary opens do not hydrate replay payloads into a process cache.

Find runs over the complete latched retained projection interval independently
of Filter. Around anchors are validated against that complete interval before
Filter evaluation. A read point from the same interval may remain valid after a
later commit; the later boundary is excluded. Missing/corrupt projections and
selected replay payloads fail closed, and the last coherent query remains the
published diagnostic result.

Focused measured proof on 2026-08-13:

- `npx vitest run --no-file-parallelism --maxWorkers=1 tests/filter-impl-08-indexeddb-query.test.ts`: 9 tests passed.
- `npx vitest run --no-file-parallelism --maxWorkers=1 tests/authoritative-event-history-indexeddb.test.ts`: 65 tests passed before the final combined run; the combined focused pair passed 71 tests before adversarial additions, and the current query suite is 9/9.
- `npm test`: ordinary phase 74 files / 794 tests passed; serialized phase 9 files / 190 tests passed (40.95 seconds total for the two phases).
- `npm run test:release`: 83 files / 984 tests passed in 77.56 seconds.
- `npm run typecheck`, `npm run build`, and focused filter/posting/schema suites pass.
- `LSEW_BROWSER_HEADLESS=false LSEW_UI_HEADLESS=false LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run measure:event-history` was attempted with cached Chrome for Testing 151 installed, but fails closed before launch because `docs/reference/event-history-performance-reference.json` is empty and `PENDING_MAINTAINER_BASELINE`. No p95 claim is made and no machine-readable performance report was produced.
- The deterministic package audit measured a stored ZIP of 1,069,630 bytes after removing the unused extension favicon; this remains above the 1 MiB budget and is a release blocker.
- The performance harness proves the existing Around-only request with exact totals and the exact 50-record page length, newest-first order, sequence, and event identity on both its 10,000-record IndexedDB/3,842-key and 5,000-record memory fixtures. A focused gate test rejects wrong Around page size, order, and identity.

The deep tests cover Filter-independent current/nearest Find, an excluded but
retained Around anchor, same-timestamp ordering, old-schema projection
migration, Clear/read-point invalidation, terminal/fallback behavior inherited
from the authoritative suite, corrupt/missing selected data, concurrent-latch
boundary exclusion, compound facet algebra, and zero replay-payload hydration
for ordinary queries. Real-Chromium 10,000-record / 3,842-key evidence and
package-size closure remain outstanding.

## Locked-console non-interactive closure mode

The closure runner now has an explicit `non-interactive-layout-commit` proof
mode. It launches the cached real Chrome for Testing 151 with the centralized
unattended Chrome policy and a fresh temporary profile, skips all activation,
focus, occlusion, screencast, and headed-rAF experiments, and still executes
the production Workbench runtime with native IndexedDB, React, and the exact
36-cell/query/scenario/heap workloads. The existing absolute thresholds and
query/storage/correctness gates are unchanged.

In this mode the only replaced observation is compositor-dependent visible
paint: the production panel's existing React layout-effect telemetry reports a
bounded DOM publication boundary, and the harness verifies the Workbench React
root is connected and that every committed Evidence identity is covered. The
gate requires `headless=true`, the explicit proof mode, a coherent publication
boundary, `compositorFrameMeasured=false`, and zero missing boundaries. A
non-interactive report cannot be classified as headed proof; missing or
incoherent layout boundaries fail closed.

The ticket-scoped selection is explicit and narrower than the ordinary
full-release selection. Set `LSEW_EVENT_HISTORY_PERF_SELECTION=filter-impl-08`
with `LSEW_EVENT_HISTORY_PERF_MODE=non-interactive-layout-commit` to run the
complete native IndexedDB/memory query matrix, bounded hydration/index
telemetry, exact query thresholds, and the six-sample post-GC heap check.
It produces no terminal-pressure, checkpoint-pressure, or lifecycle evidence;
those remain in the ordinary full-release selection. Its artifact names the
`filter-impl-08-noninteractive-layout-commit` selection and explicitly does
not claim foreground scheduling or compositor proof.

The supplied headed artifact remains truthful environmental evidence: it is a
`TIMED_OUT` run at the real-rAF compositor boundary with no PASS or p95 claim.

The bounded `filter-impl-08` real-Chrome follow-up is recorded in
[`filter-impl-08-perf-followup-01.md`](filter-impl-08-perf-followup-01.md).
