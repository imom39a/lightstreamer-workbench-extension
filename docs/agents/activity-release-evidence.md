# Activity release evidence

Date: 2026-08-14

Scope: final Observed Activity implementation, exact 10k proof, Material UI browser/visual evidence, restoration, and proportional release gates.

## Focused 10k proof

The pre-hydration focused browser proof timed out after 30 seconds while focusing the Activity grid at `tests/ui/workbench.spec.ts:240`. The landed hydration path now performs one authoritative ascending Event History read and merges post-latch accepted entries without the former page-by-page scan.

Evidence after the final integration:

- `npx vitest run tests/activity-capacity.test.ts tests/evidence-facets.test.ts tests/filter-algebra.test.ts tests/activity-projection.test.ts --no-file-parallelism --maxWorkers=1`: 4 files, 57 tests passed.
- `npx vitest run tests/activity-projection.test.ts tests/activity-document.test.ts tests/activity-runtime.test.ts --no-file-parallelism --maxWorkers=1`: 3 files, 54 tests passed.
- The exact 10,000-record fixture contains multiple clients, Session epochs, Subscriptions, items, listeners, snapshot/live and LOCAL updates, losses, errors, equal timestamps, and a backward-clock segment. Its independent oracle proves Scope, compound Filter, provenance, Frozen boundary, bounded Around criterion, dedupe, deliveries, markers, segments, top-10-plus-Other ranking, and a combined maximum of 120 buckets.
- Incremental parity seeds a 9,999-record accumulator and appends the final record, avoiding a quadratic test loop while still comparing the complete projection.
- The capacity proof exposed and fixed combined clock-segment bucket overflow and enum `kind` facet identity mismatch.

The stale zero-action expectation was replaced with the required visible Evidence action. The prior four failed 10k approaches and their follow-up remain open as `activity-followup-01`, with this before/after evidence retained rather than silently closing the follow-up.

## Material UI matrix

`npm run test:ui:visual` captured all 26 matrix scenarios, including five Activity cases:

- normal 900x700 Light exact 10k;
- narrow 563x700 Dark graphical Activity;
- wide 1440x900 Light graphical Activity;
- normal 900x700 Dark limited capture;
- narrow 563x700 Light memory fallback.

The run reported 26/26 captures, zero browser diagnostics, zero serious/critical axe violations, and no shell/document horizontal overflow. Reference/current/diff artifacts and the manifest are in `test-results/workbench-visual-qa/`. No tracked visual baselines were updated.

The headless Material suite passed 12/12 and the broader non-baseline UI suite passed 66/66. Coverage includes forced colors, complete composite keyboard traversal, exact Evidence drilldown, Back restoration, ranking pagination, compact table reachability, and explicit selection/footer separation for compact, limited, and memory states.

The first independent Luna review correctly rejected the top-only packet as insufficient reachability evidence. After bounding repeated contextual samples to actual change points, adding visible `0–maximum` chart scales, and adding explicit scrolled-state artifacts, the independent re-review returned **APPROVED** with no remaining clipping or reachability blocker. Supplemental evidence is retained as `test-results/workbench-visual-qa/current/activity-*-reachability.png`.

## Release gates

| Gate | Result | Exact disposition |
| --- | --- | --- |
| `npm run typecheck` | PASS | Completed successfully after final integration. |
| `npm run build` | PASS | MV3 build, CSP audit, and content/injected bundles verified. |
| `npm test` | CAPPED / FAILURES OBSERVED | The parallel gate remained CPU-bound without progress for more than seven minutes and was stopped with exit 130. Its release-package version assertions were repaired and passed 4/4 in isolation; the reported runtime frame-timing failure also passed in isolation. |
| `npm run test:release` | CAPPED / FAILURE OBSERVED | The serialized gate was stopped after seven CPU-bound minutes. It reported one failure in `authoritative-event-history-contract.test.ts`, overlapping separate unstaged topology-checkpoint work. |
| `npm run test:ui -- --grep-invert "visual baseline"` | PASS | 66/66 functional browser tests passed headlessly in 2.0 minutes. |
| `npm run test:ui:visual` | PASS | 26/26 evidence captures; axe, diagnostics, and overflow checks clean; independent Luna reachability review approved supplemental scrolled states. |
| `npm run test:ui:extension` | BLOCKED / FAIL | Two headless attempts built successfully, then timed out waiting for the selected real panel to retain `cdp-same-tab-three`. |
| `npm run fixture:test:browser` | BLOCKED / FAIL | The headless fixture started and became ready, then timed out waiting for the production Evidence workspace to show the fixture Item Update. This is the same real-panel capture boundary as the extension smoke failure. |
| `npm run release:package -- --skip-tests` | PASS | Typecheck, build, audits, and deterministic v2.0.1 ZIP packaging passed; artifact size 371,067 bytes. |
| `npm run docs:check` | PASS | 4 documents and 10 maintained commands checked. |

At that checkpoint, the repeated real-panel capture boundary and serialized topology-contract failure remained release blockers for `activity-impl-12` and were recorded on `activity-followup-03`. Tracked visual baselines and explicit maintainer approval also remained pending; no baseline was silently rewritten.

## Activity 11/12 completion pass — 2026-08-14

The bounded completion pass added deterministic headless Chromium cases for empty matching Evidence, active Filter exclusions, aggregation failure, clock discontinuity, successful Clear, terminal History, a partial live bucket, rebucketing with selection, and shallow forced-colors/non-color meaning. A browser-discovered rebucketing defect was fixed: a stable bucket identity whose duration changed is no longer mistaken for the original selected absolute interval. Activity now renders the preserved interval overlay instead. The Activity truth boundary and selection context also use the canonical Filter summary, so a structured `kind: item-update` criterion is never reported as `Filter None`.

Additional exactness evidence closes `activity-followup-04`: the Page-scope ranked Subscription drilldown was exercised through both memory and fake-IndexedDB investigation adapters. It applies one structural Subscription criterion, `ITEM-UPDATE`, `SERVER`, and the plotted half-open interval; applies no item criterion; waits for the current ready query; and returns both retained items.

The prior serialized release-contract failure was a real IndexedDB fallback defect. When `globalThis.IDBKeyRange` was unavailable, the candidate-kind fast path supplied `undefined`, accidentally turning a checkpoint index count into an unbounded count. The implementation now supplies the IndexedDB-valid primitive key fallback. The authoritative Event History contract passes 18/18 for memory and fake IndexedDB.

Updated verification:

- `npx vitest run tests/filter-algebra.test.ts tests/activity-document.test.ts tests/activity-projection.test.ts tests/activity-runtime.test.ts tests/activity-followup-04-runtime-query.test.ts tests/authoritative-event-history-contract.test.ts --no-file-parallelism --maxWorkers=1`: 6 files, 90 tests passed.
- `CI=1 npm run test:ui -- tests/ui/activity-impl-11.spec.ts tests/ui/activity-material.spec.ts`: 20 focused Activity tests passed headlessly.
- `CI=1 npm run test:ui -- --grep-invert "visual baseline"`: 74/74 functional browser tests passed headlessly in 2.0 minutes.
- `CI=1 npm run test:ui:visual`: 26/26 visual-evidence scenarios captured; the existing independent Luna Activity review remains **APPROVED**.
- `npm run typecheck`, `npm run build`, and `npm run docs:check`: passed.
- `npm run release:package -- --skip-tests`: passed; deterministic v2.0.1 ZIP size 371,174 bytes.

The full serialized `npm run test:release` gate received one uninterrupted 15-minute timebox after two earlier bounded runs. Its single Vitest worker remained active at approximately 115% CPU and emitted no failure after its initial production-boundary progress, but still did not publish a summary; it was stopped once at the ceiling. This is now a measured release-suite performance blocker rather than the repaired topology-contract assertion.

The shipped-extension boundary was retried headlessly through the four-attempt circuit breaker. Post-reload panel-target rebinding and explicit bridge/runtime readiness moved the failure later but did not make `cdp-same-tab-three` durable. All speculative harness changes were removed. The official-client fixture remains blocked at the same production Evidence capture boundary. Dedicated follow-up tickets retain both bounded blockers.

Tracked platform visual baselines were not rewritten because the Material UI gate still requires explicit primary-maintainer approval. `activity-impl-12` and the parent remain In Progress until that approval and the two release blockers are closed.

### Independent final-review closure

The final read-only Luna review found two concrete omissions. Commit follow-up work closes both:

- Session-absence Evidence whose concrete Session identity exists only in captured topology now exposes a matching Session facet. A red-to-green projection regression proves the generated structural Session criterion returns that supporting Evidence without treating unknown or redacted topology values as concrete.
- A deterministic seven-client browser scenario proves the five-lane bound plus **Other clients**, requested-versus-real bandwidth/frequency meaning, plot-versus-text behavior, composite keyboard focus/selection, and Enter supporting-Evidence drilldown.

Final integrated evidence after this review:

- Seven targeted unit/runtime files: 98/98 passed.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- Focused headless Activity Playwright matrix: 21/21 passed.
- Complete non-baseline headless Playwright suite: 75/75 passed in 2.1 minutes.
- No headed browser was opened and no tracked visual baseline was rewritten.

## Primary-maintainer approval — 2026-08-20

The primary maintainer explicitly approved the Activity Material UI and intentional baseline updates: **“I approve the Activity Material UI and intentional baseline updates.”**

The gated read-only baseline comparison on the approval date proved that all five maintained Activity baselines already match production exactly, so no Activity image required rewriting:

- `CI=1 npm run test:ui -- --grep 'visual baseline: activity-'`: 5/5 passed headlessly.
- `CI=1 npm run test:ui -- tests/ui/activity-impl-11.spec.ts tests/ui/activity-material.spec.ts`: 21/21 passed headlessly.

The broader baseline comparison exposed 15 differences belonging to newer Scenario/checkpoint work. Those unrelated images were deliberately not updated under the Activity approval. Activity therefore satisfies its explicit Material UI approval and baseline-decision gate without changing any baseline file.
