# Automatic Agent access / Scenario navigation merge

Date: 2026-09-25. Maintainer-requested merge of `codex/automatic-agent-access`
(`49272a2`) into `codex/workbench-agent-access` (`10a889b`). The target working
tree was clean before merging; its Scenario navigation work was already committed.
Classification: Material UI integration because screenshot baselines overlap.

## Resolution

All source and documentation merged without conflicts. Both parents' behavior
is retained: automatic Agent access On/Off beside View, inspection plus Local
Injection by default, setup under More actions, and Scenario park/resume,
Back to Evidence and explicit active/parked discard confirmation. No new runtime
behavior or UI contract was introduced during conflict resolution.

The 56 conflicts were binary Scenario screenshots changed by both parents.
Choosing either parent's image would omit the other parent's UI. An initial
read-only compact Scenario comparison failed as expected. The 32 affected
Scenario states were regenerated on Darwin and pinned Linux from the combined
source, including four target-only states that also needed the Agent header.
This resolves 56 conflicts and refreshes eight additional images, 64 in total.

## Verification

- `npm run typecheck` passed.
- Both platform updates passed all 32 Scenario states. Pinned Linux read-only
  comparison passed all 56 agent-access and Scenario checks, including the five
  dock-transition widths and optional authentication.
- `LSEW_VISUAL_PROTOTYPE_PORT=4221 LSEW_VISUAL_PANEL_PORT=4222 npm run test:ui:visual -- --grep scenario-`
  generated all 32 maintained Scenario captures: zero browser diagnostics,
  zero shell/document overflows, zero serious/critical findings in 32 axe checks,
  and visible/unobscured controls in all 24 focus-checked states.
- `node test-results/agent-merge-packet.cjs` generated
  `test-results/agent-merge-visual-qa/manifest.json`: 120 full-size
  reference/current/diff triplets (64 against the target parent and 56 against
  the incoming parent), arranged in 30 contact sheets. This supplements the
  maintained prototype/current/diff packet.
- Initial unit execution overlapped platform screenshot generation and exceeded
  two existing 500ms performance limits; the remaining 1,564 ordinary checks
  passed. The full rerun without those competing browser jobs passed all
  **1,733 tests** (1,566 ordinary and 167 IndexedDB), with one skipped. The
  performance limits and tests were not changed.
- Independent visual QA: **PASS, no material findings**. The read-only reviewer
  inspected all 120 triplets through all 30 sheets, seven full-size Scenario
  captures and seven post-merge Agent captures, including the 760/761px header
  transition. Both the Scenario-navigation and merge-baseline visual gates are
  satisfied. Active Run refusal is covered by runtime tests; park/resume,
  retained editor undo/Review and confirmation focus/cancellation have browser
  coverage. No baseline or implementation file was edited by the reviewer.
- Real loaded-extension checks passed both `npm run agent:test:browser` and
  `npm run agent:test:extension`: default automatic discovery, same-session
  reconnection after companion restart, revocation and optional approval, plus
  official-client Local Injection and Scenario delivery to the app DOM. The
  loaded-extension fixture suite passed 13 tests with one skipped.
- `npm run release:package -- --skip-tests --out-dir test-results/agent-merge-release`
  passed type checking, production/MV3 and package audits; ZIP size is 480,163
  bytes. Tests ran separately above. Documentation checks passed for 118 files.
- The cached Chrome for Testing 151 and the incoming Darwin baselines' Chrome
  153 render the native textarea resize grip differently. Three Server Injection
  comparisons differed by only 19 pixels each in that grip. All three passed
  read-only comparison using explicit `CHROME_PATH` to Chrome 153.0.8010.54;
  their accepted baselines were not changed. The final complete comparison uses
  that same Chrome 153 executable.

Final full browser and merge CI
results are recorded here after completion. No native installer, release
publication or installed agent configuration change is part of this merge.
