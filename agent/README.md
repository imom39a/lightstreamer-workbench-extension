# Workbench MCP companion

One Node.js source and one npm package run on **Windows, macOS and Linux**.
The agent starts stdio MCP; the companion starts a shared broker on
`127.0.0.1:24817`; open Workbench panels connect automatically. There is no
native host, OS-specific installer, Chrome registration or remote debugging port.
Node.js 22.12+ and npm must be available to your agent application. Chrome and
the companion must run on the same computer. Windows Chrome needs Windows Node,
not Node inside WSL or a container.

## Connect with npm

The first public release is `lightstreamer-workbench-agent@0.1.0`, owned by the
`imom39a` npm account. The extension must include Agent access;
the published 2.0.4 extension predates it.

Run the same command in macOS Terminal or Windows PowerShell:

```sh
npx --yes lightstreamer-workbench-agent@0.1.0 setup
```

Copy the printed `mcpServers` entry into your agent's MCP configuration. Its
standard JSON form is identical on both platforms:

```json
{
  "mcpServers": {
    "lightstreamer-workbench": {
      "command": "npx",
      "args": ["--yes", "lightstreamer-workbench-agent@0.1.0", "mcp"]
    }
  }
}
```

Your agent application launches the npm companion when it starts this configured
MCP server. You do not need to run `mcp` in PowerShell or a terminal yourself,
keep a terminal open, or install a background service. The companion remains a
local Node process, not a hosted server or code running inside the Chrome extension.
Start/reconnect the MCP server in your agent app, then open **Lightstreamer Workbench**
in the intended tab's DevTools. Ask the agent to call `list_panel_sessions` and
`get_status` to identify the tab. No separate broker terminal is needed.
Multiple MCP clients share the broker. It exits 30 seconds after all agent and
panel connections close. MCP stdout contains protocol messages only.

Setup prints configuration and never edits agent settings. It pins this package
version so later publication does not silently replace your runtime. Update the
version in your MCP configuration deliberately. The first npm invocation needs
registry access; npm caches the package. Normal runtime traffic stays on loopback.
For unpacked extensions, add `--extension-id YOUR_ACTUAL_EXTENSION_ID` to setup
or the MCP arguments; the default is the official Store extension ID.

If an agent app cannot find `npx` on Windows, configure the full path to
`npx.cmd` from `Get-Command npx.cmd`, or use the installed Node entry below.
This changes only the launcher path; the package and runtime are identical.
See [Windows launch troubleshooting](WINDOWS.md).

## Local installation and source development

For offline deployments, install a downloaded tarball into a stable directory:

```sh
npm install --prefix ./workbench-companion ./lightstreamer-workbench-agent-0.1.0.tgz
node ./workbench-companion/node_modules/lightstreamer-workbench-agent/dist/cli.mjs setup --local
```

`--local` prints absolute Node and CLI paths. Keep those paths stable. This is
the same npm runtime, useful when a GUI agent cannot resolve npm on its PATH.
It does not register anything with Chrome.

To build from source, from the repository root:

```sh
npm ci
npm run build
npm run agent:build
node agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Load the repository's `dist/` as an unpacked extension. Build/pack commands run
from the root: `npm run agent:pack` rebuilds and writes the npm tarball to
`release/`. It includes the executable, bundled runtime dependencies, licenses,
this guide and the agent skill. It needs no consumer-side compilation or install
script. Install `skills/lightstreamer-workbench` from the package into your
agent's skill directory when you want the investigation workflow guidance.

## Access

Each Panel Session enables inspection and Local Injection by default. The header
shows **Agent access Waiting** until the companion connection is ready, **On**
once connected with access granted, and **Off** when disabled. On means access
is ready, not that an agent is actively using it. Clicking the header status opens
**More actions → Agent access and setup** without changing access. Use the
on/off control in that section; setup instructions stay there too.
Turning access off revokes the grant, stops retries and pauses an agent Scenario;
closing the panel ends the grant. A new panel uses defaults. Connection retries have a 15-second maximum
backoff. Reconnection never repeats an Injection or resumes a Scenario. Unknown
delivery must be inspected, never automatically retried.

Authentication is off. Connected agents have inspection and Local Injection
access; there is no permission selector, pairing step or advanced settings form. Any local process can use a connected panel's
grant or impersonate the broker. Exact Host/extension-Origin checks reject normal
websites but do not identify OS users or individual agents. Local WebSocket data
is unencrypted. Requested Evidence may reach your agent's model provider. The
companion does not persist Evidence or log payloads; redaction is not a general
secret detector. Local Injection invokes app listeners, which may cause other
application effects. Server Injection is not exposed to agents.

Authentication and read-only enforcement remain in the underlying protocol for
future controls and compatibility testing, but the current panel does not enable
them. Use the default auth-off configuration and port 24817 with this panel.

### Switch an existing setup to auth off

Disconnect panels, stop matching MCP clients and let the idle broker exit.
Replace the old MCP entry with default setup output, remove its
`LSEW_AGENT_CONNECTION` setting, and reload Workbench. Remove custom port overrides so both sides use 24817.
Existing credentials continue to require authentication until deliberately removed;
they are not silently ignored.

### Migrate from the native companion

Native transport, `install`, `doctor`, `host`, and `--transport native` have been
removed. Stop the old MCP entry, replace it with the npm entry above, and reload
the extension. Do not carry `--transport` or `--directory` into the new entry.
No automated migration changes installed browser profiles or agent settings.

The old installer printed its exact native-host manifest and launcher paths.
You may remove those two files after verifying the manifest name is
`dev.lightstreamer.workbench` and the launcher contains the Workbench managed
marker. Do not delete a whole browser profile or another application's host.
Leftover registration is unused by the new extension, which no longer requests
`nativeMessaging`.

## Search Evidence and Scope

`search_scope` searches the complete structural Topology, including collapsed
branches, by case-insensitive substring in labels, identities, types, ancestor
paths, details and lifecycle. Results include the exact `scopeId` and ancestor
path. Use that ID with `get_scope` or `search_evidence`; searching never changes
the human's selected Scope.

`search_evidence` applies the same canonical Find matching as the panel across
retained Evidence. Its `within` boundary is explicit:

- `page` (default) searches the page without the human's Filter. An optional
  `scopeId` narrows it to that exact structural Scope.
- `current-investigation` captures the human's current Scope and Filter and
  applies Find text independently. Both boundaries remain fixed during paging,
  even if the human later changes their investigation.

An unsupported current Filter rejects the search without returning matches.
Remove the unsupported criterion or explicitly choose `within:"page"`.

For example, after identifying the intended Panel Session:

```json
{"panelSessionId":"chosen-panel","text":"row-42","within":"current-investigation","limit":25}
```

Both search tools return up to 100 matches per page and an opaque `nextCursor`
when more matches exist. Continue with **only** `panelSessionId` and `cursor`.
Evidence searches preserve their read point, total and order while Capture adds
events; Scope searches preserve their Topology snapshot. All matches remain
reachable, including beyond 1,000 results. Start a new search to include newer
Evidence or Topology. Cursors expire after five minutes, bounded cursor-cache
eviction, retention removes the captured range, Clear, page change or access
revocation. An expired cursor requires a fresh search.

Neither search moves the human's Scope, Filter, Find, selection or Capture.
Evidence payloads require `includePayload:true`. Match explanations use only
fields permitted in the response; a canonical match in omitted payload data,
Client Message text or recognized credentials may have `NO_SHAREABLE_EXCERPT`.
Raw capture text and the internal search index are never returned. Existing
`query_evidence` and `get_evidence` remain available for general retained reads
and exact Evidence lookup. Check `get_status.capabilities` before using new
tools with an older loaded extension; both the extension and companion need
the search update.

## Verification and publication

`npm run agent:test:package` packs and installs the artifact outside the source
tree, runs its npm executable, checks version-pinned setup, and drives two real
stdio MCP clients through its shared broker to an exact test panel.
`npm run agent:test:extension` repeats packaging and uses the installed artifact
with a loaded Chrome panel: automatic discovery, restart/revocation, retained
Evidence, exact inspected-page identity, and full inspection/Local Injection access.
`npm run agent:test:browser` adds official-client Local Injection, duplicate
suppression, Scenario Steps and the application's displayed result.
CI builds one tarball and tests that exact artifact on Windows, macOS and Linux.

### Automatic releases from main

The `agent-companion.yml` GitHub Actions workflow watches companion source,
package files, bundled skill, dependency manifests, connection integration and
their tests. A matching push to `main` selects the next patch version from npm,
builds one tarball, and tests that exact tarball on Windows, macOS and Linux.
Only after all three pass does the `npm` environment publish it through npm
trusted publishing with provenance. Other branches and pull requests only test.
Manual workflow dispatch on `main` can retry a failed run.

The source `agent/package.json` version is the minimum release version. Ordinary
changes automatically publish `0.1.1`, `0.1.2`, and so on. Set a higher source
version for a deliberate minor or major release. CI sets the chosen version in
the artifact without writing version-only commits back to main. The installed
CLI reports that artifact version and prints its exact version in setup output.
The package's `gitHead` identifies the source commit. Retrying a commit already
published skips publication, and registry/network failures stop version selection.
Runs are serialized to prevent two builds allocating the same patch version.

The one-time bootstrap is a reviewed public `0.1.0` tarball publication, followed
by a trusted publisher for GitHub user `imom39a`, repository
`lightstreamer-workbench-extension`, workflow `agent-companion.yml`, environment
`npm`, with direct publishing allowed. The environment permits only `main`.
Set repository variable `AGENT_NPM_PUBLISH_ENABLED=true` after bootstrap;
`false` pauses publishing while keeping cross-platform verification enabled.
No npm token is stored in GitHub. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

For an authorized manual bootstrap, inspect the cross-platform CI artifact and
publish that tested tarball with
`npm publish release/lightstreamer-workbench-agent-0.1.0.tgz --access public --ignore-scripts`.
The extension's Chrome Web Store release is a separate operation with its own
full unit, browser, visual and package gates.
Publishing requires a maintainer npm login with access to the scope; preparing
or testing a tarball does not publish it. The Chrome extension release is separate.
