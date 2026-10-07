# Captured-update Scenario workspace

The maintainer selected prototype C on 2026-10-01 and explicitly authorized
production implementation, thorough regression tests and MCP verification using
Sol 6.1 medium subagents. This is a Material UI change under the
[Workbench UI Standard](../WORKBENCH_UI_STANDARD.md), inside the existing
temporary Local Injection Scenario document.

## Acceptance

Captured Server Item Updates for the exact Scenario target remain searchable
through bounded metadata pages, independently of the main investigation's Scope,
Filter, Find and selection. Multi-selection survives search and paging. A
committed read point holds results steady; only explicit Refresh changes that
candidate boundary, and neither Capture nor Refresh changes membership.

Explicit Add resolves selected payloads asynchronously and rechecks retention,
target, revision and capacity before adding the entire batch in retained order.
Success and refusal remain visible beside selection. The 100-Step and 8 MiB
canonical accounted Scenario limits remain enforced. Used captures offer
deliberate reuse through Duplicate Step. Undo preserves surviving editor state,
prior removal history and allocated member identities.

An ordered queue represents all Steps and Checkpoints while one focused member
editor preserves immutable Source, editable Draft and editor state. Compact and
shallow geometry use Captured updates, Scenario queue and Focused editor surface
controls. Park restores the working surface and focus. Exact target, Session and
Local-only boundary remain protected; composition never executes an Injection.
Review freezes the separate immutable Run, and MCP reads preserve the human
workspace. Human-created Runs remain inspectable without giving an agent
permission to execute them.

## Regressions and diagnosis

Before implementation, deterministic memory and IndexedDB probes confirmed
ordinary individual adds. At 100 Steps, a real enabled Add refusal was hidden
behind the old absolute-positioned picker. Physical hit testing and a failing
browser regression captured that feedback defect. The exact click in the
maintainer's original live screenshot was not reproduced, so it is not assigned
an unverified cause.

Independent code review found two Undo regressions during implementation:
restoring the full pre-add definition reset surviving cursor/scroll state and
reused member identities after Review. Three failing regressions preceded the
fix. Undo now removes only the tracked added members from the current definition,
retains the allocator and recalculates canonical capacity with archived Runs.

Existing browser accessibility checks found that read-only capture results lost
their keyboard scroll target after Review disabled selection. The results scroll
owner now has a label and a native Tab stop; the renderer regression verifies
focus while the selection controls are disabled.

A real 5,000-record browser fixture also exposed a refresh loop when an Evidence
selection was outside the mounted window. Compact retained identities now hydrate
that selection without repeatedly issuing the same unresolved query. Memory and
IndexedDB regressions retain a bounded query-count guard. IndexedDB residual
filter totals remain global across cursor pages instead of shrinking on Older.

Native browser checks preceded fixes for automatic scroll anchoring after Add and
focused-editor heading geometry during pointer activation. Both now preserve the
intended scroll position and reachable Evidence action. MERGE and DISTINCT
renderer regressions ensure commandless captures say Item update and do not show
COMMAND operation filtering. Search excerpts are bounded metadata summaries;
immutable Source preserves original payload types and case.

## Original implementation verification record

The implementation evidence and command logs live in
`.scratch/scenario-builder-implementation/`. Production sources remained stable
through the original gates below. These results predate the subsequent correctness
review; current correction results are recorded separately below.

| Gate | Result | Evidence |
| --- | --- | --- |
| Unit suite | 188 files; 2,020 passed, one pre-existing opt-in fake-IndexedDB workload skipped | `reports/unit-release-closure.log` |
| Serialized release suite, typecheck and production build | 188 files; 2,020 passed, same opt-in skip; extension boundary verified | `reports/release-package-final.log` |
| Release ZIP | 523,230 bytes, below the 1 MiB budget | `release/lightstreamer-workbench-v2.0.7.zip` |
| Darwin full browser suite | 410/410 passed | `reports/darwin-ui-final.log` |
| Darwin follow-up after generic-mode label correction | 13 capture behaviors and 40 Scenario baselines passed | `reports/darwin-scenario-closure.log` |
| Pinned Linux full browser suite | 410/410 passed, zero retries | `reports/linux-ui-closure.log` |
| Maintained integrated visual packet | 115/115 states; no browser errors, horizontal overflow or serious/critical axe violations; 95 unobscured focus checks | `test-results/workbench-visual-qa/manifest.json` |
| Independent code and standards review | Final pass, no actionable regressions; 198 focused checks and 24 follow-up checks passed | `review/final-review.md` |
| Independent visual acceptance | Final pass, no material findings | `visual/independent-review.md` |
| Fresh installed companion MCP and official-client proof | Passed, with the loaded extension journeys passing 14 checks and the existing opt-in 100,000-record stress case skipped | `reports/mcp-official-client-final.log` |
| Shipped DevTools panel smoke | Passed, including separate same-tab Panel Sessions and authentic disposal | `reports/extension-smoke-final.log` |
| Final official-client fixture | Direct wire, message-channel and listener transport proofs passed; 14 loaded-extension checks passed, existing opt-in 100,000-record case skipped | `reports/official-fixture-final.log` |
| Documentation validation | 125 Markdown files, four command guides and ten maintained commands passed | `reports/docs-final.log` |

The Material UI packet preserves 40 exact task-start base/current/diff trios,
six accepted C prototype references and 80 deliberate Darwin/Linux baseline
images. New states cover four 5,000-event geometries, selected batch, empty,
failed-query recovery and 100-Step refusal. The scoped platform baselines were
generated through `npm run test:ui:update`. All 254 maintained PNG hashes stayed
unchanged during final normal comparisons; the independent reviewer verified
all 40 base hashes and all 80 platform-image hashes. Historical Light-named
Scenario IDs display actual Dark UI under the accepted Dark/forced-colors
amendment; new states do not introduce a Light theme.

The fake-IndexedDB unit file uses the existing serialized IndexedDB test lane.
Fixture bootstrap waits allow loading 5,000 records and resolving two off-window
Sources under concurrent host or pinned-VM load. Those readiness deadlines are
not latency assertions: all exact query-count guards, bounded rows, matching
totals and subsequent action checks remain enforced. Native memory/IndexedDB
browser coverage verifies the complete interaction.

An isolated-port fixture attempt is retained in
`reports/official-fixture-port-mismatch.log`: three legacy fixture pages target
port 8080, so starting their server on 8131 did not initialize their application
state. The corrected maintained run used the free expected port 8080, passed,
and removed its owned container. No product assertion was weakened to recover
this test setup error.

The real companion MCP proof installs a fresh package, loads a fresh production
extension, and uses the official Lightstreamer client fixture. It verifies bounded
reads, pagination and human workspace preservation, the prepared Scenario queue
and focused immutable Source/edited Draft, reviewed-plan authorization,
single-attempt execution, correlated committed Local Evidence and the inspected
application's callback/DOM response. The extended loaded-extension journey also
selects genuine captured Server snapshots, adds them without execution, edits and
reviews their Drafts, and delivers the three reviewed Steps exactly once.

These fixture proofs do not connect to or inspect the maintainer's private live
application.

## Post-review corrections

The maintainer authorized corrections to both P2 findings from the subsequent
requirements review. This is a **Bounded UI** correction inside the accepted C
surface and interaction model, with no new controls or baseline updates.

The focused member's visible pane now saves and restores scroll by stable
Scenario member identity. Switching Steps or Checkpoints, changing working
surfaces, reordering, Park/Resume and remove/Undo preserve the reading point.
Undoable removed Steps retain their saved positions for the same lifetime as
their retained Drafts; permanent removals prune them and a replacement Scenario
clears the saved positions. Heading focus no longer resets the reading point.
Immutable Source, Draft text and cursor selection remain protected, and only one
member editor mounts.

Real MERGE and DISTINCT captured Sources converted through the runtime now show
**Item update** in the queue when their Draft has no COMMAND operation. Genuine
COMMAND ADD, UPDATE and DELETE Steps retain their actual operation labels.

Failing tests preceded each correction. Normal and compact browser regressions
first reproduced the 600-to-0 reset; independent review then caught the same
reset after removal/Undo, which received its own failing regression before the
retention fix. Tests exercise separate Step positions, Checkpoint scroll and
unfinished input, stable identity through reorder/removal/Undo, rapid switching,
keyboard focus, Park/Resume, Source/Draft/cursor preservation and zero execution
during composition. The 100-Step test now checks a nonzero position on the actual
visible pane instead of accepting the inner CodeMirror scroller's zero position.

Current evidence lives under
`.scratch/scenario-builder-implementation/review/fixes/`:

| Gate | Result | Evidence |
| --- | --- | --- |
| Generic runtime-to-renderer regressions | 46 focused checks passed; both generic modes and all three COMMAND verbs covered | `generic/red.log`, `generic/green.log` |
| Actual-pane browser regressions | 3/3 passed at 900x700 and 563x700, including remove/Undo and 100 Steps; no browser diagnostics, shell overflow or serious/critical axe violations | `scroll/undo-red.log`, `scroll/undo-green.log`, `scroll/undo-green/` |
| Final full unit suite | 188 files; 2,023 passed, one existing optional workload skipped | `reports/unit-final.log` |
| Final full Darwin browser suite | 412/412 passed with no retries | `reports/ui-full-final.log` |
| Typecheck and production build | Passed on the final correction | `reports/typecheck-final.log`, `reports/package-final.log` |
| Fresh companion MCP and official-client fixture | Passed, including ordered delivery, duplicate suppression, human workspace preservation and inspected-app DOM response; 14 loaded-extension checks passed with the existing optional 100,000-record case skipped | `reports/mcp-official-client-final.log` |
| Shipped DevTools smoke | Two distinct same-tab Panel Sessions, authentic disposal and the semantic workspace passed | `reports/extension-smoke-final.log` |
| Independent standards and requirements reviews | No outstanding findings; removal/Undo and real generic-mode probes independently rerun | `standards-review.md`, `spec-review.md` |
| Independent visual follow-up | Final normal/compact restored-pane packet accepted with no material findings | `visual-review.md` |
| Refreshed local ZIP | 523,544 bytes; all 27 entries match final `dist`, below 1 MiB | `reports/package-final.log`, `package-match.json` |

The local ZIP reuses the completed final typecheck and full unit suite through
the packager's skip flags, then performs a fresh production build and package
audit. All 254 maintained PNG baseline hashes remained unchanged. Final source
and test hashes were pinned before verification and remained stable. The earlier
partial full-browser run was interrupted to address the independent Undo finding;
`reports/ui-interrupted-before-undo-fix.log` is not a completed verification gate.
Linux full-suite results above belong to the original implementation; this
bounded correction's full browser rerun used Darwin. The private live-app and
original-click diagnosis limitations remain unchanged.

## Design source and work tracking

The accepted captured-update composition workflow is implemented in the
production Scenario workspace and covered by the verification above. Disposable
design renderers and simulated delivery are retired; accepted target, Source,
Draft, explicit membership and immutable Review boundaries remain authoritative.

Work is tracked in the existing internal draft **scenario-builder-prototype-01 —
Make captured-update Scenario building explicit and responsive** in
[Lightstreamer Workbench Project #2](https://github.com/users/imom39a/projects/2).
The original completion read-back verified its body and confirmed the other 191
Project items remained unchanged. The same draft item records the post-review
corrections and their verification; its Done status follows the correction gates
and independent acceptance above.
