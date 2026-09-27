# Unified npm companion verification

Recorded 2026-09-27 for runtime commit `b73e1f6`, compared with pre-cleanup
commit `0dd3cf5`. The npm companion cleanup is verified on Windows, macOS and
Linux. This record does not approve the extension release: the broader gates
below still have failures. Neither npm nor the Chrome Web Store was published.

## Contract and package

One TypeScript source bundles into one Node executable in
`@lightstreamer-workbench/agent@0.1.0`. Node 22.12+ runs the same package on
every supported OS. Agents launch stdio MCP through npm; panels use the common
loopback broker. Native-host code, installation commands, transport selection,
and the extension's `nativeMessaging` permission are removed. Version-pinned
setup, optional authentication, exact panel identity, revocation and the
Server Injection prohibition remain covered. EOF closes the MCP child even
when npm launches it through a shell; a regression test failed before that fix.

[Cross-platform CI run](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36355525289)
built one tarball on Linux and passed all three platform jobs with that exact
artifact. Each job tested offline installation, npm's executable launcher,
two MCP clients sharing a broker, routing, unit checks, type checking, and the
real loaded Chrome extension in default and authenticated modes. Windows also
checked the documented PowerShell setup and packaged guide. No OS-specific
runtime build is required.

The downloaded verified artifact is
`release/verified-unified-agent/lightstreamer-workbench-agent-0.1.0.tgz`.
Its SHA-256 is
`fc92abe74f7ac24ab1922a1581f9ca580fbb180ead7d8a7e9cabec3ad877eec9`.
The [companion guide](../../agent/README.md) documents source/tarball use before
publication and the common npm configuration after publication. npm login and
scope publication access have not been established on this machine.

## Bounded UI evidence

This is Bounded UI under the [UI standard](../WORKBENCH_UI_STANDARD.md): remove
the obsolete transport selector and update setup copy/link within the accepted
advanced connection surface. No new control, workflow, semantic pattern or
baseline is introduced. The affected browser regression failed before the
change (`test-results/unified-agent-red.log`).

The focused agent UI suite passed 24 checks, covering compact 563×700, normal
900×700, shallow 900×320 and wide 1440×900, Dark and Light, forced colors,
keyboard/focus, accessible controls, optional authentication, and port and
permission persistence. No serious/critical axe findings were reported.
Artifacts are under `test-results/unified-agent-ui/`. Visual inspection of
compact Dark instructions, normal Light approval, and shallow Dark approval
found readable setup copy and reachable controls without clipping. No committed
visual baseline was changed.

## Functional verification and remaining release gates

- `npm run typecheck` and `npm run docs:check` passed.
- Focused companion, connection and runtime unit suites: 34 passed.
- `npm run agent:test:extension` passed, including the production extension
  build/audit, authentic DevTools panel disposal, exact page discovery,
  retained Evidence and revocation in both authentication modes.
- `npm run agent:test:browser` passed the real MCP → Chrome panel → official
  Lightstreamer listener → application DOM proof, including duplicate
  suppression, ordered Scenarios and revocation. The wider official-client
  fixture suite passed 13 checks; its opt-in 100k stress case was skipped.
- `npm test`: 1,560 passed, one failed at the memory Filter performance gate;
  the separate IndexedDB phase was not reached. A serialized
  `npm run test:release` covered all unit files: 1,727 passed, one skipped,
  one failed (NORMAL lookup p95 516.9 ms against the 500 ms limit).
  Subsequent isolated runs passed both performance cases on the current source
  and pre-cleanup `0dd3cf5` using the same Node 25.9.0 binary. The full-run
  performance gate remains intermittent; no threshold was relaxed.
- Full `npm run test:ui`: 278 passed, four Local Injection editor screenshot
  mismatches. A focused rerun with the default test browser reproduced all
  four. Running those five Local Injection baselines against pre-cleanup
  `0dd3cf5` reproduced the same four failures. The inspected diff was at the
  existing “Tab inserts indentation” checkbox. Baselines were not refreshed
  to hide the failures.

Local logs use the `test-results/unified-agent-` prefix: `unit-final.log`,
`extension.log`, `official-client.log`, `full-unit.log`, `serial-unit.log`,
`full-ui.log`, `pinned-visual.log`, `baseline-visual.log`,
`filter-final-isolated.log`, and `baseline-performance-node25.log`. Performance
thresholds and screenshot failures require separate resolution before claiming
a green extension release. Core Filter source and its performance test are
unchanged by this cleanup.
