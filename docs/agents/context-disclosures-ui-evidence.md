# Selected-Evidence Context disclosures UI evidence

Date: 2026-08-29. Internal Project item: `context-density-01 — Collapse selected-Evidence supporting Context` in [Project #2](https://github.com/users/imom39a/projects/2).

Classification: **Material UI**. The maintainer requested that `Filter selected Evidence` and the supporting Evidence metadata follow the existing `Activity summary — Inspected page` disclosure pattern so selected update Fields become the immediate debugging surface. This changes selected-Evidence Context hierarchy, keyboard interaction, and visual baselines. It adds no permanent surface or shared component. The independent visual review passed without material findings, and the maintainer explicitly approved committing and pushing the integrated local `main` changes.

## Changed workflow and acceptance

- Selected-Evidence Context presents `Activity summary — Inspected page`, `Filter selected Evidence`, and `Evidence metadata` as three collapsed native disclosures, in that order.
- The disclosures precede `Selected update`, leaving Fields visible by default at compact, normal, shallow, and wide geometries.
- Expanding `Filter selected Evidence` exposes the existing Include, Exclude, and Around actions without changing their semantics or the current Evidence Filter.
- Expanding `Evidence metadata` exposes Source, phase, identities, COMMAND operation and key, observation path, and Evidence limitations.
- Enter and Space toggle each native disclosure while focus remains visible on its summary. The controls have stable accessible names and expanded/collapsed state.
- Runtime Scope dossiers without selected Evidence retain their visible metadata. The progressive disclosure applies only to supporting data for a selected Evidence item.
- Selected Evidence keeps its `SERVER`, `LOCAL`, `RUNTIME`, or `WORKBENCH` provenance visible in the Context header while Evidence metadata is collapsed.
- If typed Filter actions become unavailable, the Filter disclosure stays mounted with an explicit unavailable message; focus on a removed action returns to the disclosure summary.
- Selection, Scope, Find, Filter, Live/Frozen position, scroll, and Local Injection state are otherwise unchanged.

The Workbench UI Standard and the directly affected information-architecture, density, and keyboard contracts are amended in the same change.

## Regression evidence

The renderer regression was added before the implementation. It failed because `Filter selected Evidence` was still a permanently visible section. The extended regression then failed because Evidence metadata remained an always-visible description list. The final renderer test proves both disclosures start closed, their exact order, their position before `Selected update`, and the retained Around action after expansion.

The browser regression proves the same DOM and accessible-state contract, visible selected provenance and Fields in the Context viewport, metadata hidden until expansion, and physical Enter/Space toggling. Existing filter actions still apply through the expanded disclosure. The renderer regression also proves that passive loss of typed Filter actions retains the disclosure and restores focus from the removed action to its summary. A separate deterministic geometry matrix covers:

| Geometry | Viewport | Theme | Result |
| --- | ---: | --- | --- |
| Compact | 563×700 | Dark | Three supporting disclosures closed; Fields visible in Context |
| Normal | 900×700 | Light | Three supporting disclosures closed; Fields visible in Context |
| Shallow | 900×320 | Dark, forced colors | Disclosure summaries and the start of Fields remain in the short Context pane |
| Wide | 1440×900 | Light | Supporting rows remain compact and Fields is the dominant detail |

All focused disclosure scenarios passed their serious/critical axe checks. The selected Item Update and long-identity regressions expand metadata deliberately before checking supporting values, while continuing to assert that Fields is visible first.

## Browser and visual evidence

Representative direct screenshots:

- `test-results/context-disclosures-qa/current/context-disclosures-compact-dark.png`
- `test-results/context-disclosures-qa/current/context-disclosures-normal-light.png`
- `test-results/context-disclosures-qa/current/context-disclosures-shallow-forced-dark.png`
- `test-results/context-disclosures-qa/current/context-disclosures-wide-light.png`

All four direct captures show the default collapsed presentation. Normal is part of the same deterministic geometry loop as compact, shallow, and wide, preventing a stale direct-review artifact from surviving a later visual change.

The pre-change production baselines are preserved at `test-results/context-disclosures-qa/base/`, with hashes in `test-results/context-disclosures-qa/base-manifest.json`. Actual current and pixel-diff artifacts are recorded under `test-results/context-disclosures-qa/baseline-review/`. Sixteen selected-Context states per platform cover compact, normal, shallow, and wide geometry, Dark and Light themes, selected JSON/high-volume cases, and visible provenance. The intended differences remove the always-visible filter actions and metadata ledger from selected-Evidence Context, introduce three compact disclosure rows, keep provenance textual in the header, and move Fields upward without clipping, overlap, lost controls, or changed semantic color.

The final base comparison reports 44 changed states per platform. Sixteen are the selected-Evidence Context states above. The other 28 reflect the concurrently integrated Notifications/footer and approved readability work and are not attributed to this request. An unrelated Codex task updated and exercised the shared Darwin baselines during the first comparison attempt; those overlapping results were excluded. After that process ended, the complete local suite passed read-only and the pinned-Linux baselines were regenerated and immediately rechecked. No process owned by the other task was stopped.

The freshly regenerated maintained packet at `test-results/workbench-visual-qa/manifest.json` contains 82 reference/current/diff states, 71 axe-checked states, and 62 focus-checked states. Chrome for Testing recorded zero browser diagnostics, zero horizontal shell/document overflow, and zero serious/critical axe findings. All focus-checked controls were visible and unobscured.

The independent reviewer inspected the four direct captures, affected Darwin/Linux platform snapshots, the maintained manifest, and the maintained contact sheets. The first follow-up correctly rejected one stale normal direct capture; normal was added to the deterministic direct-capture loop and regenerated. The final review passed with no material visual or accessibility findings. It confirmed visible selected provenance, consistent native disclosure order and carets, initial Fields visibility at all four target geometries, visible focus and keyboard behavior, expanded runtime metadata when no Evidence is selected, and readable Evidence, diagnostics, Dismiss actions, and footer controls without collision.

## Commands and results

| Check | Result |
| --- | --- |
| Focused renderer regression | 58/58 passed, including stable unavailable Filter disclosure and focus restoration |
| Focused Chromium disclosure and action regression | 3/3 passed; compact/normal/shallow/wide placement, provenance, keyboard, and axe assertions passed |
| Selected Item Update and long-identity browser regressions | 3 passed, including the existing Notifications operational regression exercised in the same run |
| `npm run typecheck` | Passed on the final source |
| `npm run docs:check` | Passed after contract amendments |
| `git diff --check` | Passed before and after full-gate verification |
| Full `npm test` | 127 files passed; 1,612 tests passed and 1 skipped. One load-sensitive Find p95 attempt missed its budget; the isolated rerun and complete repeat both passed. |
| `CI=1 npm run test:ui` | All 195 tests passed in a stable, read-only Darwin comparison |
| Darwin and pinned-Linux `test:ui:update` | All 195 tests passed on each platform after intentional paired baseline updates |
| Pinned-Linux read-only visual-baseline comparison | All 77 baselines passed |
| `npm run test:ui:visual` | 82/82 captures passed; packet checks clean |
| `npm run test:ui:extension` | Passed authentic DevTools panel, two Panel Sessions, and controlled disposal |
| `npm run fixture:test:browser` | Transport proof and all 7 official-client panel journeys passed. The issue-16 readiness check now waits on the retained-Evidence contract instead of assuming the retained-record count equals the fixture's logical-update count. |
| `npm run release:package` | Typecheck, all 1,612 release tests with 1 intentional skip, build, extension audit, and ZIP audit passed; 438,490-byte ZIP below the 1 MiB budget |

## Review outcome

Independent visual QA: **PASS — no material findings after regenerating one correctly rejected stale normal artifact**. Maintainer approval: **recorded** through the explicit request to commit and push all integrated local `main` changes.

The local packet is ignored by git; attach its artifacts when sharing this change for review. No private production Capture data is included.
