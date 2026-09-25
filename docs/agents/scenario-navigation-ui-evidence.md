# Scenario navigation and discard UI evidence

Classification: **Material UI** under `docs/WORKBENCH_UI_STANDARD.md`. This change adds Scenario navigation and a destructive action within the accepted temporary promoted document. It adds no permanent workspace surface.

## Behavior

- **Back to Evidence** parks an edited, reviewed, paused, complete, or stopped Scenario. A visible parked strip resumes the same Scenario, Steps, editor history, and Run state.
- **Discard Scenario** requires inline confirmation in both the active document and parked strip. **Keep Scenario** and Escape cancel and restore focus to the discard trigger.
- An active Run must be stopped before leaving or discarding. The disabled controls explain that boundary beside the actions.
- Discard from the active document restores its originating investigation. Discard from the parked strip retains the investigation the developer reached while the Scenario was parked.
- Finishing a terminal Run still uses **Finish Scenario** and restores the origin.

## Verification

- Runtime tests cover park/resume, unchanged Step identities and revision, cancelled and confirmed discard, current-Evidence retention after parked discard, and refusal to leave an active Run.
- Browser tests cover a two-Step edit, CodeMirror undo after park/resume, Evidence selection and focus restoration, Review parking, active and parked confirmation, Escape, and compact layout.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run docs:check`, `npm run test:ui:extension`, and `LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run fixture:test:browser` passed.
- `npm run release:package` passed after updating the visual-matrix count check for the four new states: 1,729 release tests passed, one was skipped, and the ZIP remained below the one-megabyte limit.
- The full Darwin browser suite passed 278 tests. After the final restoration and copy adjustments, the focused navigation tests and all 32 affected Darwin and pinned-Linux Scenario baselines passed again.
- `npm run test:ui:visual -- --grep scenario-` generated 32 reference/current/diff captures at compact, normal, shallow, and wide geometry, including Light, Dark, and forced-colors states. The packet recorded zero browser diagnostics, zero shell/document overflows, and zero serious or critical axe findings. It is at `test-results/workbench-visual-qa/manifest.json`.
- Exact pre-change/current/diff triplets for all 64 affected Darwin and Linux baseline files are at `test-results/scenario-navigation-baseline-review/` (56 changed, 8 new). The author inspected representative compact, shallow, wide, and Linux pairs.

The author inspected the active edit, parked, active and parked confirmation, shallow stopped, forced-colors, wide high-volume, and Linux confirmation images. The new actions remain visible, the parked strip leaves a useful Evidence workspace, and both confirmation actions remain reachable at compact width. Existing and new affected Scenario baselines were updated intentionally on Darwin and pinned Linux. Formal independent visual QA remains the merge gate under `docs/agents/ui-visual-qa.md`.
