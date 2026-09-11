# Key and JSON stream verification

Classification: **Material UI**. Approved by the primary maintainer on 2026-09-11 in Codex thread `01a08ba4-a8cb-7e00-91e4-c44ab0337388`.

## Accepted behavior

- Op / Key or item / Data replaces the repeated four-column Evidence grammar.
- Only Op is pinned horizontally; complete keys occupy one line without truncation or wrapping and scroll with captured data.
- Historical TLCP and Workbench lifecycle codes have a grouped Codes reference; U remains Item Update for every COMMAND verb.
- Readable JSON and Raw fields preserve captured values and types, with explicitly bounded inline payload previews.
- Exact chronology/identity/metadata and injection boundaries remain available; existing bounded history windows, Scope/Find/Filter/focus/selection remain independent.
- Dark-only including forced-light system environments follows the prior maintainer decision.

## Approval and source

The maintainer selected Variant A at the local key-first prototype route, requested codes from earlier versions, corrected keys to single-line horizontal scrolling, and wrote “lets implement it”. Earlier authorization specifies merge and push to main without a PR. The maintainer then requested implementation, commit/push, Chrome Web Store release using the existing Chrome session, and explicitly confirmed “get all the pending changes release as well”. The prototype branch is `prototype/evidence-density-proposals` at `aa15e98`; production branch is `feat/key-json-stream` based on `1d070a1`.

The release includes the original checkout's pending documentation/tooling cleanup, new Markdown link checker, and consolidated prototype command. The original tracked patch and three new files were compared before integration; overlapping design-document and package changes were merged without conflicts. Earlier main commits supply the IndexedDB throughput, COMMAND Draft validation, stale content-bridge retirement, memory fallback, value-filter, and dark-only fixes.

The historical mapping is in `52c2076:src/extension/panel/main.ts`; its Codes disclosure is in `src/extension/panel/timeline-view.ts`. `34b9949` introduced the earlier definition set; `86c7717` removed the old renderer during the React cutover.

## Verification record

The full unit run (`npm test -- --no-file-parallelism`) passed 144 test files: 1,693 tests passed and one existing test was skipped. The ordinary 131-file phase and isolated 13-file IndexedDB phase both passed without changing performance thresholds. Node 24.18.1 and a dedicated temporary directory were used after the host's default Node 23 environment caused startup problems.

The implementation adds nine Chromium cases for full single-line keys, 30px rows, header/data alignment, horizontal scrolling with only Op pinned, Readable/Raw fields, and the grouped, bounded Codes disclosure. Coverage includes 563×700, 900×700, 900×320, and 1440×900, keyboard behavior and axe checks. The earlier visual packet passed 93 states; the final semantic suite subsequently found a selected-row CSS precedence problem and a shallow diagnostics viewport that clipped the first row. Both were repaired, their four focused browser regressions passed, and the definitive full matrix is rerun below.

Intentional screenshot changes replace the prior four-column row grammar, restore the full selected-row fill, retain the Op selection marker, and make room for one complete event row under shallow diagnostics. Baselines are generated separately with `npm run test:ui:update`; ordinary comparison runs never update them. The local reference/current/diff packet is under `test-results/workbench-visual-qa/`; Codes views and filter comparisons supplement it.

The five Store images are regenerated from the production component. The generator now waits for every scene's readiness marker and rejects page errors; it no longer accepts an old image after a Chrome timeout. Images are 1280×800, 24-bit RGB PNGs. The matching public site passed checks for all 18 generated pages and the documentation checker passed 108 Markdown files.

The full Darwin `CI=1 npm run test:ui -- --retries=0` comparison passed all 251 cases. A subsequent independent review found an open shallow History-gap disclosure whose summary moved below the footer viewport; its narrow repair and focused follow-up are recorded below. The normal/wide Filter reference images also needed a fresh update: the runner's bare `--update-snapshots` flag overrode the configured `all` mode with Playwright's `changed` default, retaining small visual changes within comparison tolerance. The runner now explicitly requests `--update-snapshots=all`; normal verification remains read-only.

The official-client transport proof passed direct wire, message-channel fallback and listener fallback. All nine loaded-extension fixture journeys passed, including normal/compact Local Injection, Server Injection, Message Recipes, Scenarios, server diagnostics, high-volume Capture and grouped issue-16 Scope. Physical clicks target the visible pinned Op cell, rather than invoking DOM click handlers or clicking the off-screen midpoint of a long row. Recipe verification now reads the adapter's current quantity/version, sends quantity +5 and requires exactly the next version and exactly one new update. Two consecutive runs without a fixture restart passed; this fixes the test's stale hard-coded adapter-state assumption without weakening its assertions.

The adapter was compiled using Maven in Docker because the host Maven launcher stalled. The maintained browser and panel targets were then executed against the ordinary Lightstreamer fixture. The fixture container was stopped after verification. A real extension reload additionally passed without uncaught context exceptions or interrupted page updates.

All four real-Chromium throughput checks passed, including the opt-in capacity proof:

| Workload | Accepted / refused | Result |
| --- | --- | --- |
| JSON-rich 2,500-event snapshot, 40 payload fields | 2,500 / 0 | 12,716,598 canonical bytes retained; healthy journal, no retries/failures |
| 200 events/second, 2,500 JSON-rich updates | 2,500 / 0 | Maximum pending age 153ms; healthy journal |
| 6,000 updates with a 2,500-record rolling window | 6,000 / 0 | Rolling retention continued and the latest event remained searchable |
| 100,500 updates, compact payloads, 100,000-record cap | 100,500 / 0 | Retention advanced to 90,404 records / 74,127,428 canonical bytes; latest event and exact Find result correct |

The capacity run took 498.3 seconds with no persistence retries or failures and no pending work at completion. This proves bounded rolling capacity; it is not a claim that arbitrary payload sizes fit 100,000 records under the separate byte limit. The exact command was `LSEW_HISTORY_THROUGHPUT_100K=1 npm exec -- playwright test --config playwright.extension.config.ts tests/extension-ui/history-throughput.spec.ts --output test-results/release-throughput --retries=0`. Results are in `test-results/release-throughput/` and `/tmp/lsw-key-json-throughput-final.log`.

The final shallow History-gap regression passed with a physical disclosure click, complete summary and 30px row containment, keyboard End/Home scrolling, and a physical Dismiss hit test. Independent review passed the refreshed reference/current/diff trio. The full 93-state packet is preserved at `test-results/workbench-visual-qa-full-final/`; the narrow follow-up is at `test-results/workbench-visual-qa/`.

Exact Darwin baseline generation passed all 105 selected checks after the runner correction. The read-only comparison plus both shallow diagnostic regressions passed all 107 cases (`npm run test:ui -- --grep 'visual baseline:|key/JSON stream|Codes reference|Readable JSON is|filter state visual:|opened shallow forced-color history|mixed-size footer diagnostics' --retries=0`). Independent review passed the exact normal, shallow and wide Darwin Filter context reference/current/diff images. The focused final unit run passed 94 tests across five files, and final type checking passed. The full 1,693-test run remains applicable; the subsequent changes were confined to shallow diagnostics, snapshot tooling and fixture-test typing.

Local Docker could no longer start the final Linux comparison because its containerd metadata database returned an I/O error. Other projects' containers were left untouched. A temporary GitHub-hosted verification branch is used to regenerate Linux baselines and run the full read-only comparison; its workflow is not part of the production release.

The first hosted Linux run passed all 105 baseline-generation checks and 251 of 252 read-only tests. Its single failure exposed a real shallow disclosure width defect: Chrome's `::details-content` wrapper occupied one grid column even when the outer `details` used `display: contents`. The same seeded 900px footer measured 211.22px of content width and an 80.94px recovery paragraph before the correction, versus 882px and 16.19px afterward. The shallow open wrapper now also uses `display: contents`; the original full-recovery containment assertion is preserved and a direct available-width regression was added. This was a layout defect, not an IndexedDB failure or a relaxed test threshold.

Final verification regenerated all 105 Linux baselines successfully, then passed both affected disclosure regressions in [the final Linux run](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/34602031379). The width guard measures the padded diagnostic section rather than the outer scrollport. Darwin regenerated and compared all 17 shallow baselines, passed the mixed-size diagnostic check, and passed both final disclosure checks. The earlier complete comparison's 251 passing cases and these focused repairs cover the final change without repeating unrelated workflows. The temporary remote verification branch was deleted after artifact retrieval.

Final independent visual QA passed the 93-state packet, Codes/key/Raw and dark-only evidence, all five Store screenshots, selection/hover behavior, and all six final Darwin/Linux Filter context trios. A live follow-up independently used keyboard End/Home for storage headroom in dark and forced-dark modes and the forced-dark History gap: recovery copy spans the footer, summary and Dismiss remain reachable, and two complete Evidence rows remain visible. Six supplemental screenshots are under `test-results/key-json-disclosure-final-review/`. No material visual findings remain.

`npm run release:package -- --skip-tests` passed final type checking, the configured production build, Manifest V3/CSP/local-script audits and ZIP integrity. The already completed full unit suite and final focused unit run are the test evidence for this packaging pass. The package is `release/lightstreamer-workbench-v2.0.4.zip`, 467,424 bytes, with SHA-256 `ba105d4cf2319ebd787b7a168a025cdb26d712a083fc08693fe9fb61cf896433`. All 26 packaged files are release assets; no source maps, source TypeScript, environment files or dependency directories are included. Permissions are unchanged from 2.0.3.

The final shipped-panel smoke passed same-tab two-DevTools-panel Capture, distinct Panel Session journals, real secondary-panel disposal and journal cleanup, and continuing Capture in the primary panel. The smoke suppresses analytics; afterward the configured production build was restored and every file was verified byte-for-byte against the release ZIP. Final documentation and static-site checks passed 108 Markdown files and 18 generated pages.

Chrome Web Store release is authorized. The existing Chrome session confirmed published version 2.0.3, but later access is blocked by the Mac lock screen. No 2.0.4 package or listing mutation has been made in the Store yet. Unlocking the Mac is required to upload and submit through that session.
