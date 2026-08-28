# Integrated Activity production evidence

Status: verified for maintainer review on the feature branch; not merged or published.

## Scope

This is the actual extension implementation of the [accepted integrated Activity direction](../WORKBENCH_INTEGRATED_ACTIVITY.md), not another prototype iteration. Classification: **Material UI**. The base is `82bd61b6dabf8060da8d00be0a2245dbad50b5af`; the implementation branch is `feat/integrated-activity-timeline`. The approved production work is tracked as `activity-main-01` through `activity-main-03` in [Project 2](https://github.com/users/imom39a/projects/2).

The main Evidence surface owns one elapsed-time SERVER/LOCAL timeline. Its range selection uses canonical Filter; captured marks select or inspect existing Evidence. One collapsed Activity summary in Context retains exact counts, SERVER Snapshot/Live, bounded busiest identities, and captured bandwidth/frequency facts. The separate Open Activity doorway and bucket-table document are retired. Scope, Find, Filter, selection, Frozen position, and protected Local Injection documents remain independent.

## Review and regression record

The unchanged base passed 138 browser checks and failed 17: fifteen image comparisons, one shallow stopped-Scenario geometry assertion, and one memory substring Filter case. These failures were recorded before production changes; no baseline was silently accepted as a fix.

- `1d581c1` separately fixes the existing memory-index substring candidate omission. The existing Filter-hidden-selection/passive-Capture browser test and public runtime regression verify the correction.
- `e95e982` separately corrects a stale performance-runner source assertion, reproduced on the unchanged base. It does not change the runner's classification behavior.
- `0880a9c` separately removes duplicated Scenario seed metadata from the fixed boundary while retaining its exact value in the Run ledger. The existing stopped-Scenario 100px outcome-area assertion remains intact.
- Independent code review found and verified corrections for a cancelled drag completing on pointer-up, focused source identity becoming inert after display aggregation changes, and clock regressions hidden by Scope/Filter. Untimed structural checkpoints never supply timestamps.
- Initial independent visual review blocked readiness on Evidence viewport starvation, an obsolete Context Activity fact displaying unknown logical counts as zero, and an initially clipped shallow Scenario Review button. These findings received rendered or Chromium regression coverage before correction.
- `b6b802e` corrects those presentation defects and preserves the accepted Context minimum. Additional Chromium checks cover pressure-triggered layout changes, restoration when Find closes or Capture recovers without a resize, focused timeline controls, explicit disclosure preference, and passive pager growth. The focused result is 30/30 browser checks and 18/18 rendered checks.
- `01d2775` gives the existing cold-esbuild module-resolution test an explicit 15-second functional timeout. The unchanged base and current code both exceeded the old default under host contention, with equivalent CPU work and approximately two-second isolated runs. All module-resolution assertions, global timeouts, and actual performance limits remain unchanged. The subsequent default `npm test` run passed all 1,598 tests, with one existing opt-in large-workload test skipped.
- The complete visual review then found wrapped Shown/Matching counts clipped beneath the folded timeline in the shallow forced-colors anomaly state. `09b5576` prevents fixed pane headers from shrinking below their contents. The added Chromium regression failed before the correction (counter top 73.59375px, timeline bottom 82.5px), then passed with every count and the Context action contained in the header and at least three full Evidence rows. The focused pressure and Activity suites passed 15/15 and 16/16 respectively.
- The first complete Darwin UI run at `09b5576` passed 175 checks and exposed eight failures: seven global Filter-text assertions now matched both Evidence and Context, and the timeline could obscure the temporary Scope picker. The matching Linux run was stopped after preserving its deterministic Filter failures. `e162d39` contains Evidence's stacking layers beneath the existing picker and targets the actual visible canonical Filter banner in tests. The contextual-action checks now verify the exact key and elapsed range, retained selection and Reset instead of matching unrelated ancestor text. Four focused checks passed, including normal/shallow populated and empty picker hit targets, ordinary Close clicks, Escape and exact-trigger focus restoration.
- The `e162d39` Darwin suite then passed all 183 checks. Its Linux run passed 180 and failed three: one Scenario focus image, one small text-raster image and the large Scenario fixture's readiness wait. Isolated unchanged reruns cleared the latter two. Current and unchanged-base DOM probes confirmed that closing a completed Scenario's picker tried to focus an unmounted Add button. `c4aeee7` separately restores the Scenario heading when that trigger is absent, while preserving Add-trigger return in edit mode. New rendered and browser regressions check actual focus and `:focus-visible` without assigning focus in the test. The focused rendered test, two Scenario browser tests and all three original Linux cases passed.

## Standards

The independent Standards review has **0 remaining findings; worst: none**. The initial pressure-allocation and restoration findings were corrected and re-reviewed. Scope: the implementation since the fixed base, including the final density, fixed-header, Scope stacking, Scenario focus and test corrections through `c4aeee7`.

## Spec

The independent Spec review has **0 findings; worst: none**. The implementation retains the approved shared-track/main-Evidence design, exact scoped Context details, canonical Filter, and protected investigation state. The elapsed-time contract explicitly excludes untimed structural checkpoints. The final `c4aeee7` delta was independently reviewed without a scope or behavior contradiction.

## Verification

The production modules last changed at `c4aeee77e87905b3a461ab0421aad48dbd79bb1c`. Verification uses that code and the reviewed baseline hash set in `test-results/integrated-activity-qa/final-baseline-hashes-c4aeee7.json`. The closing commit contains the approved baseline images and verification documentation only. All listed release gates completed.

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --no-file-parallelism` | 1,599 passed across all 127 test files; one existing opt-in large-workload test skipped |
| Focused pressure and integrated Activity Chromium suites | 15/15 and 16/16 passed |
| `npm run test:ui:visual` | Final source: 75/75 states; 64 axe checks; 51 focus checks; no browser diagnostics, shell/document overflow, or serious/critical axe violations. Independent final-delta review passed. |
| Darwin baseline updater | Original 70 passed; final focused update of three Scenario focus images passed 3/3 |
| Pinned-Linux baseline updater | Original 69 passed plus one existing retry; final two-image focus update had one pass and one existing retry pass |
| Full read-only Darwin UI suite | 184 passed (5.3 minutes), no retries; all 140 baseline hashes unchanged |
| Full read-only pinned-Linux UI suite | 184 passed (6.2 minutes), no retries; all 140 baseline hashes unchanged |
| Final-source shipped-extension smoke | Passed real MV3 DevTools Capture, two-panel session isolation and authentic panel-disposal cleanup |
| Final-source official-client fixture | Seven journeys passed (34.3 seconds), plus direct-wire, message-channel fallback and listener fallback Local Injection proof |
| `npm run build` | Passed MV3/CSP, local-script, lazy-editor and self-contained content-script checks |
| `npm run release:package -- --skip-tests --skip-typecheck` | Passed after separate final-source typecheck and all 1,599 unit tests; rebuild and package audit verified a 434,081-byte ZIP, below the 1 MiB limit. The options avoid repeating the already completed checks. |
| `npm run docs:check` | Passed with the final record |

The final Darwin command was `CI=1 LSEW_UI_UPDATE=0 npm run test:ui`. The pinned-Linux command was:

```sh
docker run --rm --ipc=host \
  --env HOME=/tmp/playwright-home \
  --env CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome \
  --env CI=1 --env LSEW_UI_UPDATE=0 \
  --volume /private/tmp/lsw-activity-linux-c4aeee7-zlzy9e7s:/work \
  --volume /private/tmp/lsw-activity-linux-deps-rl69oxxp/node_modules:/work/node_modules \
  --workdir /work \
  mcr.microsoft.com/playwright:v1.62.1-noble npm run test:ui
```

The Linux source copy was archived from `c4aeee7`, then supplied with the approved 140 baseline images and native Linux dependencies. The image was Linux ARM64 (`sha256:caa6083aa787e4cfcaa661c73dd6244e4fa38d754dab0cc3b472156b277b0394`), with Node 24.18.1 and Chromium 151.0.7922.34. The host used Node 23.1.0 and Chromium 151.0.7922.174 for the UI matrix. The shipped-extension runners use the repository's Chrome for Testing resolver and shared browser cache:

```sh
LSEW_BROWSER_CACHE_DIR=/Users/vinothshanmugam/code/lightstreamer-workbench-extension/.cache/lsew-browsers \
  npm run test:ui:extension

LIGHTSTREAMER_PORT=18080 \
  LSEW_FIXTURE_URL=http://localhost:18080/ \
  LSEW_LIGHTSTREAMER_CONTAINER=lsew-activity-main-verification \
  LSEW_BROWSER_CACHE_DIR=/Users/vinothshanmugam/code/lightstreamer-workbench-extension/.cache/lsew-browsers \
  npm run fixture:test:browser
```

These two shipped-extension commands ran sequentially. The package is `release/lightstreamer-workbench-v2.0.1.zip`, SHA-256 `d64845185c1e235bb9dcdffa77e5a4af4e4c909e2f974d45c89a25a662ee7a30`. All 24 archived files were compared byte-for-byte with the final `dist/` build used by the fixture.

Browser evidence comes from the maintained Chromium/Chrome for Testing runners and independent image review. The in-app preview was blocked by its URL policy; no interactive in-app browser verification is claimed, and no alternate browser or address was used to reopen that preview.

At `09b5576`, the initial package run overlapped three browser jobs and failed four test deadlines and three 500ms p95 checks. The unchanged command and source passed all 127 files and 1,598 tests when run without those jobs. The failed log is preserved alongside the isolated pass; no timing assertion, global timeout, or performance threshold was changed for this rerun. The Linux updater's initial scene-readiness failure also remains recorded; final verification is read-only.

At `c4aeee7`, the default parallel unit run hit six timing checks in three existing memory/checkpoint test files. The complete suite was rerun with files serialized: all 1,599 tests passed, including every original timing check. No assertion, global timeout or performance threshold was changed for this run; the failed parallel log and successful full serialized log are both retained.

The first complete `c4aeee7` browser runs each passed 181 checks and failed three. Darwin's three failures and two Linux failures differed only in the newly visible Scenario heading focus outline. The remaining Linux failure occurred before React scene readiness in the 200-member Scenario fixture and produced no visual result. Five focus images were deliberately regenerated through the updater; their hashes exactly match the preserved current captures. Final read-only comparisons run one platform at a time without another owned browser job.

The maintained matrix contains 75 deterministic states: compact 563×700, normal 900×700, shallow 900×320, and wide 1440×900; Dark/Light and representative forced-colors states. Seventy states have separate Darwin and pinned-Linux baselines; five storage-headroom states are evidence-only. The full packet includes accepted references, current production, and visual diffs. The baseline images are changed only through `npm run test:ui:update`; normal verification is read-only.

Intentional baseline changes replace the five former Activity-page states with scoped Context summaries, add four main-timeline states, and reflect the integrated timeline, compact Find row, useful Evidence allocation, and fixed headers in the existing shell matrix. The separately corrected shallow Scenario boundary also remains covered. Reviewed source and earlier failed comparisons are retained; a successful updater is not baseline approval.

The rebuilt `c4aeee7` official-client run passed the direct-wire, message-channel fallback and listener fallback Local Injection proof, then all seven shipped-extension journeys, including both normal/compact authoring and the 15-subscription issue-16 capture. The runner used its own `lsew-activity-main-verification` container on port 18080 and removed only that container on completion; the existing fixture on port 8080 remained running.

The immutable final-source packet is `test-results/integrated-activity-qa/final-full-review-c4aeee7/` (75 reference/current/diff sets). It builds on the independently approved `final-full-review-e162d39/`, `final-full-review-09b5576/` and `final-platform-review-09b5576/` (140 platform reference/current/diff sets with SHA-256 records). The five final platform deltas are in `final-focus-platform-review-c4aeee7/`. Earlier approved images, unapproved intermediate proposals and their hashes remain separate. An intermediate proposal is not reused as visual approval.

At `09b5576`, independent visual review cleared all 75 states and 140 platform images with **0 material findings**. That comparison covered all 19 changed full-packet states and verified the other 56 unchanged; platform review inspected all 72 images changed since the previously reviewed `088` packet and verified the remaining 68 by SHA-256. A separate independent review inspected all four final Scope-picker states plus the original normal failure and diff, with **0 findings**.

The final `e162d39` visual rerun was independently reviewed against the approved `09b5576` packet: seven changed states received current/reference/diff and prior-current inspection (28 artifacts), and 68 unchanged current images were independently matched by SHA-256. The outcome is **0 material findings; worst: none**. All 75 states have complete artifacts; three archived prototype-D references are JPG rather than PNG. The final Darwin read-only suite passed all 183 checks without changing any of the 140 baseline hashes.

The `c4aeee7` visual run completed all 75 states in 277,248ms. Independent review inspected the one changed current/reference/diff set and its approved prior current, verified the other 74 current images and all 75 references by SHA-256, and cleared the packet with **0 material findings; worst: none**. The same independent reviewer inspected all five final platform current/reference/diff sets and verified the other 135 platform hashes against the approved packet. Focus remains visibly distinct from Scenario step selection; protected boundaries and actions remain readable and reachable.

The shallow diagnostic-stress state has one full Evidence row and part of the next while three diagnostics and a hidden-selection notice are present. Counts, selection recovery, the Context action and bounded diagnostic scroll remain available; reviewers recorded this as a density observation rather than a clipped control or lost route.

Artifacts are retained under `test-results/integrated-activity-qa/` and `test-results/workbench-visual-qa/`. Final read-only reports are in `final-full-ui-darwin-c4aeee7/` and `final-full-ui-linux-c4aeee7/`; the final fixture report is in `final-official-client-c4aeee7/`. Final production logs and the result manifest are in `final-production-checks-c4aeee7/`. The first visual packet, prior platform images, and initial failed comparisons are preserved separately from later corrections. Reviewed D assets remain static design references in `docs/reference/integrated-activity/`.

The official-client verification uses its own container and port, preserving any existing fixture container. No merge, push, Chrome Web Store upload, or publication is part of this work.
