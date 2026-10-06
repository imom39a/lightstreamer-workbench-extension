# Firefox verification

Firefox uses the shared Workbench panel, content scripts and core. The generated
manifest uses an MV3 module background script, permanent add-on ID
`lightstreamer-workbench@imom39a`, desktop Firefox 140+, native data permissions,
and no private browsing. Chrome keeps its own generated package.

Install the official desktop Firefox and the developer test dependencies:

```sh
python3 -m venv .cache/firefox-tools
.cache/firefox-tools/bin/python -m pip install -r scripts/firefox-requirements.txt
npm ci
npm run agent:build
LSEW_ANALYTICS_DISABLED=1 npm run build:firefox
```

On Windows, the virtual environment interpreter is
`.cache/firefox-tools/Scripts/python.exe`. Set `LSEW_FIREFOX_PYTHON` or
`LSEW_FIREFOX_BINARY` when the interpreter/browser is elsewhere.

For the official Lightstreamer Web Client proof, start the maintained fixture
with Docker and Maven available, then run the real Firefox DevTools panel:

```sh
npm run fixture:start
npm run test:firefox
npm run fixture:stop
```

The proof crosses stdio MCP, the companion, exact registered Firefox Origin,
the shipped DevTools panel, IndexedDB and real page instrumentation. It checks
scoped discovery/read budgets, duplicate Local Injection suppression, ordered
Scenario Steps and Checkpoints, actual application DOM changes and revocation.

The portable proof uses deterministic page messages through the real content
bridge and extension, without Docker. It checks MCP startup, retained Evidence,
restart and Off/On/Off behavior:

```sh
LSEW_FIREFOX_EXTENSION_ONLY=1 npm run test:firefox
```

For analytics consent, use fake ingestion configuration and the test's isolated
profile, which blocks external HTTP/HTTPS traffic and permits loopback only:

```sh
VITE_LSEW_GA_MEASUREMENT_ID=G-TEST123 VITE_LSEW_GA_API_SECRET=firefox-local-consent-proof \
node scripts/build-extension.mjs --browser firefox --outDir .cache/firefox-consent-dist
LSEW_FIREFOX_DIST=.cache/firefox-consent-dist LSEW_FIREFOX_CONSENT_PROOF=1 \
npm run test:firefox
```

The panel/helper controls receive trusted Marionette pointer events. The native
permission prompt is the actual Firefox UI; its choice is activated through its
own native button because headless popup widgets cannot be hit-tested by
WebDriver. The test never injects a permission grant or bypasses product gates.
Native permission reads and storage assertions verify the result.

Add `LSEW_FIREFOX_NATIVE_KEY_PROOF=1` to exercise native Deny and Allow with
trusted Enter after focusing the actual notification button. This verifies
activation and restored checkbox focus; it does not prove the complete browser
toolbar Tab order. Both consent choices are also checked after reopening
Workbench, without a new request window or native prompt.

Every run owns a fresh disposable Firefox profile and registered UUID mapping.
The privileged developer driver only observes/operates that test browser. Never
point it at a personal profile, publisher account or production page. It does
not change browser installation, user MCP settings or the normal Firefox profile.

`test-results/firefox*/` contains screenshots, browser diagnostics and result
records. `LSEW_FIREFOX_ARTIFACTS` selects a separate output directory for each
browser version. `LSEW_AGENT_TEST_CLI` selects the CLI installed from the exact
npm release tarball rather than the local build.

The companion CI workflow gates publication on Firefox stable on Windows,
macOS and Linux, plus the minimum version and both current ESR lines on Linux.
Linux adds the official-client proof. Node 24 runs pinned `web-ext@10.7.0` lint;
review vendor warnings with the submitted unminified source. Chrome's full panel,
extension and official-client checks remain independent release gates.
