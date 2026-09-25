# Automatic Agent access — verification record

Date: 2026-09-25. Class: Material UI. Internal Project item: `agent-auto-01 —
Make open panels automatically available to agents` in
[Lightstreamer Workbench Project #2](https://github.com/users/imom39a/projects/2).
Base: `2a40fdd`; isolated branch `codex/automatic-agent-access`. Unrelated Scenario
work in the original checkout is excluded.

## Maintainer-approved behavior

The maintainer explicitly requested removing the Connect step, chose inspection
plus Local Injection as the automatic grant, and requested only Agent access
On/Off next to View in the header. On denotes enabled access, not agent presence.
Opening a Panel Session connects to the default standalone port 24817. Missing
or restarted companions are retried with backoff capped at 15 seconds. Off and
panel disposal revoke access and cancel retries. Automatic reconnection never
replays an Injection or resumes a Scenario. All target, protected-document,
Evidence, duplicate-request and hidden-panel execution boundaries remain.

More actions contains collapsed setup instructions. Optional authentication,
native transport, read-only access and custom ports remain under an additional
advanced disclosure. No new pane, shared component or theme was introduced.
The UI standard, ADR 0016, Windows guide, agent skill and privacy/security policy
record the new defaults, local-process trust and Panel Session lifetime.

## Browser and visual evidence

- A failing automatic-grant test and a failing header browser test preceded
  implementation.
- `LSEW_UI_PORT=4197 npm run test:ui -- tests/ui/agent-access.spec.ts --output=test-results/automatic-agent-ui`
  initially passed all 19 checks. Coverage includes 563×700 compact, 900×700 normal,
  900×320 shallow and 1440×900 wide; dark/light browser preferences and forced
  colors (the product remains intentionally dark-only). Checks assert exact
  View adjacency, unobscured toggle/approval focus, physical Enter/Space/Tab,
  accessible On/Off state, no default connection controls, optional settings
  restoration, cancellation and zero serious/critical axe findings or overflow.
- Additional 700/800/846px transition captures exposed overlapping header actions
  at 700/800px. Left/center/right hit tests failed before the fix. Normal geometry
  now puts secondary actions on a second row below 851px while retaining View /
  Agent adjacency. The final agent suite passed all 22 tests, including physical
  keyboard Off/focus checks, under `test-results/automatic-agent-ui-final`.
- The header affects every maintained screenshot. Both Darwin and pinned-Linux
  baselines were intentionally regenerated: 84 integrated states, 12 filter-state
  states and 9 key/JSON-stream states, 210 images total. Normal verification does
  not update baselines. Supplemental filter/key comparisons passed all 25 tests
  on Darwin; Linux integrated/new-agent comparison passed all 103 checks.
- `LSEW_VISUAL_PROTOTYPE_PORT=4211 LSEW_VISUAL_PANEL_PORT=4212 npm run test:ui:visual`
  produced all 93 maintained captures: zero browser diagnostics or shell/document
  overflows, 86 axe-checked states with zero serious/critical findings, and
  77 visible/unobscured focus-checked states.
- `node test-results/automatic-agent-packet.cjs` generated
  `test-results/automatic-agent-visual-qa/manifest.json`: all 210 committed-base
  reference/current/diff baseline triplets plus 33 old/new agent-workflow
  triplets, arranged in 61 contact sheets. Full images accompany the sheets.
  Workflow comparisons intentionally contrast the former settings-based flow
  with the new header flow; maintained baselines compare identical scenes.

Baseline commands (run independently on Darwin and the pinned
`mcr.microsoft.com/playwright:v1.62.1-noble` container):

```text
npm run test:ui:update -- tests/ui/visual-regression.spec.ts
npm run test:ui:update -- tests/ui/filter-state-controls.spec.ts tests/ui/key-json-stream.spec.ts
npm run test:ui -- tests/ui/visual-regression.spec.ts tests/ui/agent-access.spec.ts
npm run test:ui -- tests/ui/filter-state-controls.spec.ts tests/ui/key-json-stream.spec.ts
```

The first full Darwin run passed 250 checks and failed only the 21 supplemental
screenshots still showing the old header; those were then explicitly regenerated
and passed the 25-test supplemental comparison on both Darwin and Linux. The next
full run passed 270 tests and encountered one existing asynchronous wheel timing
failure in `workbench.spec.ts:253` (pre-wheel scroll 1688 versus post-wheel 1448).
A fresh full 274-test comparison includes the three transition regressions.

Independent visual QA inspected all 243 reference/current/diff triplets and
native-size workflow images. It independently found the transition overlap,
then reviewed all three replacements and closed the blocker: PASS, no remaining
material findings. All 33 main Agent workflow screenshots remained byte-identical
after the transition-only fix. Review was read-only; no baseline changes were
made by the reviewer.

## Runtime, packaging and documentation

- Final `npm test` passed 1,564 ordinary and 167 IndexedDB tests with one skipped
  (1,731 passed total). The focused four-file agent suite passed all 38 tests.
  Coverage includes startup without UI, late
  companion availability, capped backoff, Off/disposal cancellation, stale
  channel/reply rejection, same-session restoration and retained optional auth.
- `npm run agent:test:extension` passed real loaded Chrome discovery at the
  default port without any panel setup click, exact tab identity, Evidence reads,
  Local Injection capability, companion restart with same-session reconnection,
  Off remaining off past the retry interval, and optional code approval.
- `npm run agent:test:browser` passed the stdio → real extension → official
  Lightstreamer listener → app DOM journey, read-only override denial, exact-once
  Local Injection, ordered Scenario and revocation. Direct wire/message-channel/
  listener fallback proof and all 13 loaded-extension tests passed; one skipped.
- Type checking, MV3/production build, documentation checks, skill validation,
  companion build and package dry run passed. The companion package contains
  nine files including the Windows guide and skill.
- `npm run release:package -- --skip-tests --out-dir test-results/automatic-agent-release-final`
  passed build and package audits: 478,808-byte ZIP, below the one-megabyte limit.
  Tests were run separately as recorded above. No native host was installed.

Final complete browser and Windows/Linux CI results pending.
No release publication or changes to a user's installed MCP configuration are
implied by this source-branch verification.
