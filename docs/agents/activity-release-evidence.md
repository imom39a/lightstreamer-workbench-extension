# Activity release evidence

Date: 2026-08-14

Scope: Activity 10k responsiveness, Material UI visual/browser evidence, and proportional release gates. The hydration implementation is already landed in `fbfe3c1`; this change does not duplicate or edit that runtime rewrite.

## Focused 10k proof

The pre-hydration focused browser proof timed out after 30 seconds while focusing the Activity grid at `tests/ui/workbench.spec.ts:240`. The landed hydration path now performs one authoritative ascending Event History read and merges post-latch accepted entries without the former page-by-page scan.

Evidence after the fix:

- `npx vitest run tests/activity-runtime.test.ts tests/activity-projection.test.ts --no-file-parallelism --maxWorkers=1`: 2 files, 21 tests passed.
- `npx playwright test --config playwright.config.ts tests/ui/activity-material.spec.ts tests/ui/workbench.spec.ts -g "Activity|exact 10,000-record orientation" --reporter=line`: 6 passed in 25.9 seconds.
- The exact 10k test observes 9,999 Logical Updates and 9,999 Update Deliveries, focuses the stable `Activity timeline buckets` grid, selects the final row with End, exposes `Show supporting Evidence`, activates Enter/drilldown, and observes the Filter state.

The stale zero-action expectation was replaced with the required visible Evidence action. The prior four failed 10k approaches and their follow-up remain open as `activity-followup-01`, with this before/after evidence retained rather than silently closing the follow-up.

## Material UI matrix

`npm run test:ui:visual` passed all 26 matrix scenarios, including five Activity cases:

- normal 900x700 Light exact 10k;
- narrow 563x700 Dark graphical Activity;
- wide 1440x900 Light graphical Activity;
- normal 900x700 Dark limited capture;
- narrow 563x700 Light memory fallback.

The run reported 26/26 captures, zero browser diagnostics, zero serious/critical axe violations, and no shell/document horizontal overflow. Reference/current/diff artifacts and the manifest are in `test-results/workbench-visual-qa/`. No visual baselines were updated.

The focused Material suite also covers forced-colors text meaning, keyboard focus, exact degraded-state boundaries, and the contract-level named grid. The Activity accessibility fix makes the persistent Scope button omit `aria-controls` while Activity replaces the referenced Scope subtree.

## Release gates

| Gate | Result | Exact disposition |
| --- | --- | --- |
| `npm run typecheck` | PASS | Completed successfully. |
| `npm run build` | PASS | MV3 build, CSP audit, and content/injected bundles verified. |
| `npm test` | CAPPED / FAILURES OBSERVED | Stopped at the requested three-minute cap with exit 130. Before the cap, failures were observed in `workbench-panel.test.ts` (protected draft), `production-extension-build.test.ts`, `workbench-runtime.test.ts` (4,000-event Find), `filter-impl-10-runtime-query.test.ts`, two `workbench-runtime-performance.test.ts` cases, two `release-package-script.test.ts` cases, `filter-impl-04-memory-performance.test.ts`, `history-100k-02-indexeddb.test.ts`, and three `event-history-performance-harness.test.ts` cases. |
| `npm run test:ui` (headless) | CAPPED / FAILURES OBSERVED | Stopped at the requested three-minute cap with exit 130. Focused Activity tests passed; broad existing `visual-regression.spec.ts` baselines failed for the normal/compact/shallow/wide Light/Dark, degraded, matching, JSON, recovery, and confirmation scenarios reached before the cap. No baseline update was run. |
| `npm run test:ui:visual` | PASS | 26/26 evidence captures; axe, diagnostics, and overflow checks clean. |
| `npm run test:ui:extension` | BLOCKED / FAIL | The required headless invocation is refused by the harness, which requires `LSEW_BROWSER_HEADLESS=false` and `LSEW_UI_HEADLESS=false`. The earlier headed attempt reached Chrome but timed out waiting for the selected real panel to retain `cdp-same-tab-three`; no further headed retry is authorized. |
| `npm run fixture:test:browser` | FAIL | The default headless fixture browser run started the fixture and timed out waiting for the production Evidence workspace to show the fixture Item Update. |
| `npm run release:package` | CAPPED / FAILURES OBSERVED | Stopped at the requested two-minute cap with exit 130. Before the cap, `release-package-script.test.ts` had two failures and `authoritative-event-history-contract.test.ts` had one failure. |
| `npm run docs:check` | PASS | 4 documents and 10 maintained commands checked. |

The broad failures are release blockers for `activity-impl-12`; they are recorded here without tuning tests or changing unrelated shared runtime/history work. `activity-impl-11` has its browser/visual packet, but independent maintainer visual approval remains pending.
