# Agent access readiness and automatic startup

Material UI, approved by the maintainer on 2026-09-28. Project item:
`agent-readiness-01` in [Project #2](https://github.com/users/imom39a/projects/2).
Implementation base: `8081249`; the completed work is integrated in main.

## Accepted behavior

- The existing header status shows Waiting while enabled but not ready, On
  only after the companion handshake grants access, and Off when disabled.
  Clicking it opens More → Agent access and setup without changing access.
  The on/off control lives in that section, receives keyboard focus, and Back
  restores focus to the originating shortcut. There is no header pressed state.
- The configured agent app starts the npm MCP companion automatically. There
  is no manually hosted server, extra terminal or native installer.
- More actions contains the on/off control and setup instructions. The maintainer additionally
  removed the Advanced connection settings block: no port form, auth option,
  permission selector, Apply button or approval flow. Connections use port
  24817, auth off, and inspection plus Local Injection together. Underlying
  auth/read-only enforcement is retained, not removed or silently downgraded.
- No Server Injection, arbitrary evaluation or broader mutation authority was
  added. Reconnection never retries an Injection or resumes a Scenario.

## Regression and browser evidence

The rendered real-connection regression first failed with expected
`Agent access Waiting`, actual `Agent access On`. The browser regression for
settings removal first failed because the Advanced disclosure still existed.
The later header-navigation regression also started red: activation toggled
access rather than opening More. All three pass after correction. The longer
Waiting label exposed overlap at 761px; wrapping the actions through 799px fixes
it. An initial 800px breakpoint prematurely parked Context; the full suite
caught both 556px/568px-height regressions, and both pass at the corrected boundary.

Focused browser suite: 60 passed (45 agent checks and 15 Activity pressure checks).
It covers 700/760/761/799/800/801/846px widths
at both 700px and 320px heights, plus compact 563×700, normal 900×700,
shallow 900×320 and wide 1440×900; Dark/Light requests, forced colors,
Enter/Space navigation and access changes, preserved focus, hit testing and axe serious/critical
checks. The product retains its previously accepted dark-only rendering under
either theme request. Only the compact memory-fallback and help-resources baselines change:
the collapsed disclosure is renamed from Agent setup instructions to Agent
access and setup. Independent review inspected expected/actual/diff and approved
the label-only delta. Darwin and pinned-Linux baselines were regenerated with
`npm run test:ui:update -- tests/ui/visual-regression.spec.ts --grep 'visual baseline: compact-memory-fallback-dark'`
and the same command selecting `compact-help-resources-dark`. Normal read-only
comparison then passed on each platform: seven related operation scenes on
Darwin, and both changed baselines in `mcr.microsoft.com/playwright:v1.62.1-noble`
using `/ms-playwright/chromium-1234/chrome-linux/chrome`.

`node scripts/generate-agent-access-visual-evidence.mjs 8081249` exports the
base source into an isolated temporary directory and captures 24 actual
base/current/diff triplets, plus contact sheets, without changing baselines.
The packet includes empty Evidence, high volume, forced colors, dock transitions,
all readiness states and instructions, plus the 800×556 Context boundary. All 24 current scenes have no
serious/critical axe findings, shell overflow or obscured focus.
Artifacts: `test-results/agent-readiness-visual/manifest.json`, its `base/`,
`current/`, `diff/` and `contact-sheets/` directories. Chrome 153.0.8010.54
was used via `CHROME_PATH`. Independent review passed on `f9fdd0b`: every
contact-sheet triplet, all 24 full-resolution current scenes, and three
additional compact/normal/shallow keyboard screenshots were inspected. The
reviewer found no material issue; the access control has a clear, unobscured
keyboard-focus outline, including forced colors under the accepted dark-only policy.

## Verification checkpoint

- `npm run typecheck`: passed.
- `npm test` at `197f432`: 1,730 passed, one existing skip (134 ordinary and 13 isolated files).
- `npx vitest run tests/agent-connection.test.ts` after the header-navigation change: 10 passed.
- `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LSEW_UI_PORT=4261 npm run test:ui -- tests/ui/agent-access.spec.ts tests/ui/integrated-activity-pressure.spec.ts --output=test-results/agent-status-ui`: 60 passed.
- `npm run agent:test:extension` at `197f432`: passed. Installed npm artifact, real panel,
  Waiting → On → Waiting → On → Off, exact page, retained Evidence, full local
  access, explicit Off persisting beyond retry, and re-enabling without settings.
- `npm run agent:test:browser` at `197f432`: passed. The MCP client itself launches the
  companion, then the real panel delivers one Local Injection and two Scenario
  Steps to the official Lightstreamer client; app DOM, duplicate suppression,
  committed Local Evidence and revocation are verified separately. Wider fixture:
  13 passed, one opt-in 100k stress skip.
- Final [cross-platform CI](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36404555772)
  passed on `f9fdd0b`: one npm artifact installed and exercised on Windows,
  macOS and Linux, including real Chrome, automatic startup, restart,
  status-only header navigation, More access control, revocation and re-enable.
  Publication was skipped. A local rerun found a companion already serving
  the user's open Chrome panel, so it could not assert the initial Waiting
  state; that connection was preserved and isolated CI supplied the final proof.
- `npm run build`: passed within the real-extension proofs, including MV3 audit.
- `npm run docs:check`, skill quick validation and `git diff --check`: passed.
- Full UI: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LSEW_UI_PORT=4263 npm run test:ui -- --output=test-results/agent-status-full-ui`
  completed with 298 passed and five snapshot failures. One was the intentional
  compact help disclosure rename; after its reviewed baseline update, the
  seven related operation scenes all passed. The other four reproduce on base
  as detailed below. No functional browser failures remain.
- Final `npm run release:package` did not pass its all-tests gate: 1,711 passed,
  15 failed and five skipped, including a timed-out packaging hook. Rechecking
  all 12 affected test files serially on the same committed source produced
  208 passed and two failures, both existing 500ms filter-performance thresholds;
  the timeout, runtime-query, Scenario, build and packaging checks passed on rerun.
  Thresholds and timeouts were not relaxed. This is not a green release-gate claim.
  Running the two filter files on unchanged `8081249` also failed both
  thresholds (three failures, ten passes; the residual lookup failed at both
  capacity tiers). The remaining performance failures therefore reproduce
  without this feature. Logs: `agent-status-release-recheck.log` and
  `agent-status-base-performance.log` in the isolated verification checkout.
- Supplemental `npm run release:package -- --skip-tests` passed typecheck,
  production build, MV3 and package audits: ZIP 479,748 bytes, below 1 MiB.
  This isolates the packaging check from the failed test gate; it does not
  replace that gate. Nothing was published or merged.

Local command logs use `test-results/agent-readiness-` and `test-results/agent-status-` prefixes. The full UI
suite uses installed Chrome 153 to match the existing native-widget baselines;
the loaded-extension proof also runs against cached Chrome for Testing 151.
The four Local Injection native-widget snapshot mismatches also reproduced on
unchanged base `8081249` under the same browser (four failed, two pressure
controls passed). SHA-256 comparisons confirmed all four final actual images
are byte-for-byte identical to their base actual images. Their baselines are
not changed to hide that difference.
