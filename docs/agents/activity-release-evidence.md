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

The repeated real-panel capture boundary and the serialized topology-contract failure remain release blockers for `activity-impl-12` and are recorded on `activity-followup-03`. Tracked visual baselines and explicit maintainer approval remain pending; no baseline was silently rewritten.
