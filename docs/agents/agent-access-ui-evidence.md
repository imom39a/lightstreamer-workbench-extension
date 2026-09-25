# Standalone agent connection and approval evidence

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

Windows execution is not claimed from these macOS/Linux results. The new
`.github/workflows/agent-companion.yml` matrix runs focused transport tests and
the actual loaded-extension proof on Windows and Linux, plus the documented
PowerShell setup and packaged Windows guide. The maintainer authorized the push;
the remote result will be recorded after that run. No native host was installed into the user's browser.
This record does not imply Chrome Web Store publication or approval to publish.
