# Agent access readiness and automatic startup

Material UI, approved by the maintainer on 2026-09-28. Project item:
`agent-readiness-01` in [Project #2](https://github.com/users/imom39a/projects/2).
Base: `8081249`. Branch: `codex/agent-access-readiness`.

## Accepted behavior

- The existing header control shows Waiting while enabled but not ready, On
  only after the companion handshake grants access, and Off when disabled.
  Its pressed state represents enabled intent; Waiting and On both turn off.
- The configured agent app starts the npm MCP companion automatically. There
  is no manually hosted server, extra terminal, native installer or new control.
- More actions contains setup instructions only. The maintainer additionally
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
Both pass after the correction. The longer Waiting label exposed an overlapping
header at 761px; moving the action row below the status row through 800px fixes
it without changing the representative 563/900/1440px baselines.

Focused browser suite: 40 passed. It covers 700/760/761/800/801/846px widths
at both 700px and 320px heights, plus compact 563×700, normal 900×700,
shallow 900×320 and wide 1440×900; Dark/Light requests, forced colors,
Enter/Space toggling, preserved focus, hit testing and axe serious/critical
checks. The product retains its previously accepted dark-only rendering under
either theme request. No committed visual baseline was updated.

`node scripts/generate-agent-access-visual-evidence.mjs 8081249` exports the
base source into an isolated temporary directory and captures 23 actual
base/current/diff triplets, plus contact sheets, without changing baselines.
The packet includes empty Evidence, high volume, forced colors, dock transitions,
all readiness states and instructions. All 23 current scenes have no
serious/critical axe findings, shell overflow or obscured focus.
Artifacts: `test-results/agent-readiness-visual/manifest.json`, its `base/`,
`current/`, `diff/` and `contact-sheets/` directories. Chrome 153.0.8010.54
was used via `CHROME_PATH`. Independent review is in progress.

## Verification checkpoint

- `npm run typecheck`: passed.
- `npm test`: 1,730 passed, one existing skip (134 ordinary and 13 isolated files).
- `LSEW_UI_PORT=4257 npm run test:ui -- tests/ui/agent-access.spec.ts --output=test-results/agent-readiness-current`: 40 passed.
- `npm run agent:test:extension`: passed. Installed npm artifact, real panel,
  Waiting → On → Waiting → On → Off, exact page, retained Evidence, full local
  access, explicit Off persisting beyond retry, and re-enabling without settings.
- `npm run agent:test:browser`: passed. The MCP client itself launches the
  companion, then the real panel delivers one Local Injection and two Scenario
  Steps to the official Lightstreamer client; app DOM, duplicate suppression,
  committed Local Evidence and revocation are verified separately. Wider fixture:
  13 passed, one opt-in 100k stress skip.
- `npm run build`: passed within the real-extension proof, including MV3 audit.
- `npm run docs:check`, skill quick validation and `git diff --check`: passed.
- Full UI suite, release package and cross-platform CI: in progress.

Local command logs use `test-results/agent-readiness-` prefixes. The full UI
suite uses installed Chrome 153 to match the existing native-widget baselines;
the loaded-extension proof also runs against cached Chrome for Testing 151.
Final results and independent review will be appended before handoff.
