# Standalone agent connection evidence

The original approval-flow record below is historical. The maintainer's later
request makes authentication optional and off by default; see the final section.

## Change record

Class: Material UI. The maintainer requested installer-free Windows support,
then explicitly requested a displayed comparison code and Approve button instead
of entering a code. The workflow stays inside **More actions → Agent access**;
there is no new permanent surface, shared component, theme exception or baseline
replacement. The optional installed native connection remains macOS/Linux-only.

Acceptance criteria:

1. Standalone setup uses Node, prints MCP configuration, and writes no native-host
   registration, service or registry entries. The same path supports all three OSes.
2. Connect displays a fresh comparison code; there is no credential-entry field.
   The user compares it with the agent's display and clicks Approve. The agent
   confirms the exact approved request; neither step alone grants Evidence access.
3. Inspection is the default. Local Injection remains a separate explicit grant.
   Requested Evidence/model-provider sharing and local-listener effects stay visible.
4. Cancellation, expiry, disconnect and panel disposal revoke or withhold access.
   A late response cannot restore a revoked grant. Execution uncertainty is not retried.
5. Keyboard focus survives asynchronous connection and remains unobscured when
   the code appears. Approve and Cancel are reachable with ordinary Tab traversal.
6. Agent instructions distinguish the short display code from the private MCP
   credential and prohibit automating the human approval click.

## Browser and visual evidence

`tests/ui/agent-access.spec.ts` covers compact 563×700, normal 900×700,
shallow 900×320 and wide 1440×900 geometries, Dark/Light browser environments,
and asserted forced-colors activation. The accepted product theme remains dark.
States include off, asynchronous connecting, code approval, waiting for the
agent, connected, cancellation, missing companion and restored native selection.

- `npm run test:ui` — 263 passed. After the focus repair, the changed journey was
  rerun against a fresh scenario server (the server serves a static build):
  `LSEW_UI_PORT=4184 npm run test:ui -- --grep 'Agent access|Missing companion|Native connection|Cancelling a displayed' --output test-results/click-agent-ui`
  — 11 passed, including physical Tab/Enter, focus hit-testing before capture,
  Tab to Cancel, Shift+Tab back, zero serious/critical axe findings and no page errors.
- `npm run test:ui:visual` — 93 maintained scenarios captured successfully in
  `test-results/workbench-visual-qa/manifest.json`.
- `node test-results/portable-agent-packet.cjs` — local artifact helper produced
  33 reference/current/diff triplets under `test-results/click-agent-visual-qa`.
  New approval states use the former off state as their nearest reference;
  these are review artifacts, not replacement visual baselines.
- Independent reviewer `/root/portable_agent_visual_qa` inspected all 99 images,
  found one normal-height focus-visibility defect, then rechecked all 33 repaired
  current images and approval diffs. Final outcome: **pass, no material findings**.
  The focused primary action now remains focusable while busy, ignores repeated
  activation, and scrolls into view on state changes without stealing moved focus.

## Runtime and packaging evidence

- `npm run typecheck` — passed.
- `npm test` — 1,554 ordinary and 167 IndexedDB tests passed; one skipped.
- Linux container proof with `mcr.microsoft.com/playwright:v1.62.1-noble`, a
  disposable source copy and `npm ci --ignore-scripts`, then
  `npx vitest run tests/agent-portable.test.ts tests/agent-connection.test.ts tests/agent-runtime.test.ts --maxWorkers=1`
  — 24 passed. Includes real stdio MCP, path spaces, shared broker startup,
  approval, expiry, cancellation, forged proofs, request reuse and transport bounds.
- `npm run agent:test:extension` — real loaded Chrome panel, code comparison,
  no pre-approval discovery, Evidence query, exact page identity and revocation passed.
- `npm run agent:test:browser` — agent round trip through the official client,
  app DOM, duplicate suppression, ordered Scenario and revocation passed;
  the complete loaded-extension suite then passed 13 tests with one skipped.
- Production build/MV3 audit, `npm run agent:build`, `npm pack ./agent --dry-run`,
  skill quick validation, `npm run docs:check` and `git diff --check` passed.

One initial full-unit run exceeded an unrelated 500 ms lookup performance
threshold while broad suites ran concurrently. The complete unit suite passed
when rerun separately. The initial broad extension suite also timed out in its
compact manual-injection journey; the agent round trip itself passed. The
complete browser command passed when rerun separately, including that journey.

## Windows and Linux CI acceptance

The maintainer authorized the push. [Portable companion CI run 36156906857](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36156906857)
passed on **windows-latest and ubuntu-latest** for commit
`dbba04b07505a5d625807994334db43483b2e3be`, using Node 22.12.0 and Chrome for Testing 151.
Both jobs passed type checking, all 24 focused agent tests, and the real loaded
Chrome panel's code comparison, approval, Evidence query, inspected-page identity
and revocation proof without native registration. Windows additionally passed
the documented PowerShell setup/configuration checks and verified that
`WINDOWS.md` ships in the companion package.

The first Windows run exposed a test-ordering assumption: a client socket's close
event does not establish that the broker's separate close callback has executed.
The test now waits for the observable pending-request cleanup with a bounded
assertion, then verifies that confirming the cancelled request fails. No runtime
authentication or cancellation requirement was weakened.

The official Lightstreamer app/Local Injection/Scenario DOM proof above was run
locally on macOS; the Windows/Linux CI browser proof covers the portable
connection and Evidence boundary. No native host was installed into the user's
browser. This record does not imply Chrome Web Store publication or approval to publish.

## Optional authentication revision — 2026-09-25

Class: Material UI, explicitly requested by the maintainer to remove mandatory
authentication from the Windows workflow while retaining its implementation.
The same default applies to standalone access on all platforms. No permanent
surface, shared component, theme exception or maintained visual baseline changes.

Acceptance:

- Default setup prints command/arguments without credentials. Connect grants the
  selected panel access without a code or approval exchange; the UI discloses
  that any local process can use the grant. Read-only remains the default grant.
- Require authentication is optional under Connection options. Opt-in setup and
  the existing comparison/approval handshake remain supported. Existing configured
  credentials are not silently discarded; mismatched modes fail without fallback.
- Literal loopback, exact Host/path/extension Origin, bounded messages, explicit
  per-panel grants, revocation and Local Injection execution boundaries remain.
- Windows instructions and the agent skill route straight to session discovery
  by default; code comparison is conditional. Migration names the old environment
  setting, broker shutdown and matching panel option.

Evidence collected:

- Failing transport and panel-grant regressions preceded implementation.
- `LSEW_UI_PORT=4194 npm run test:ui -- tests/ui/agent-access.spec.ts --output=test-results/optional-auth-ui-fixed`
  passed 20 checks. Both modes cover 563×700, 900×700, 900×320 and 1440×900,
  dark/light browser preferences and forced colors (accepted dark-only product).
  Physical keyboard traversal/focus, approval hit-testing, revocation, cancellation,
  mode/native restoration and missing-companion recovery passed. All 16 matrix
  states had zero serious/critical axe findings, page errors or shell overflow.
- `node test-results/optional-auth-packet.cjs` produced 65 reference/current/diff
  triplets in `test-results/optional-auth-visual-qa`. References use the previous
  accepted click-approval UI; newly disclosed options use its off state.
- `npm run agent:test:extension` passed with the real loaded Chrome panel in
  both modes: MCP discovery, exact page identity, retained Evidence and revocation,
  without native registration.
- `npm test` passed 1,559 ordinary and 167 IndexedDB tests, with one skipped.
  After adding one further late-connect cancellation case and CLI conflict checks,
  `npx vitest run tests/agent-portable.test.ts tests/agent-connection.test.ts tests/agent-runtime.test.ts tests/agent-companion.test.ts --maxWorkers=1`
  passed all 34 focused checks.
- Type checking, documentation validation, skill validation, companion build,
  package dry run (nine files including Windows guide and skill) and diff checks passed.

- Independent reviewer `/root/portable_agent_visual_qa` inspected all 65 triplets
  (195 images) and passed with no material findings: default-off disclosure,
  optional authentication, approval focus, selected grants, keyboard reachability
  and failure recovery remain legible at every tested geometry.
- `LSEW_UI_PORT=4195 npm run test:ui` passed all 272 browser checks without
  baseline updates. The refreshed production-aligned missing-companion text
  passed `LSEW_UI_PORT=4196 npm run test:ui -- tests/ui/agent-access.spec.ts --grep 'Missing companion' --output=test-results/optional-auth-error-ui`
  and independent re-review of its error triplet, with no material findings.

- `npm run agent:test:browser` passed the no-auth stdio-to-panel-to-official-client
  round trip, read-only denial, exact-once Local Injection and ordered Scenario
  app-DOM checks, followed by all 13 loaded-extension checks with one skipped.

- `npm run test:ui:visual` produced all 93 maintained scenario captures.
- `npm run release:package -- --skip-tests --out-dir test-results/optional-auth-release`
  passed type checking, production build and MV3/package audit; ZIP 479,306 bytes.
  Tests had run separately as recorded above. Unrelated edits appeared in the
  shared workspace during final packaging; they are excluded from this change,
  and the pushed commit receives clean-checkout platform verification below.

Windows/Linux CI results will be recorded after completion.
