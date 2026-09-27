# Workbench MCP companion

One Node.js source and one npm package run on **Windows, macOS and Linux**.
The agent starts stdio MCP; the companion starts a shared broker on
`127.0.0.1:24817`; open Workbench panels connect automatically. There is no
native host, OS-specific installer, Chrome registration or remote debugging port.
Node.js 22.12+ and npm must be available to your agent application. Chrome and
the companion must run on the same computer. Windows Chrome needs Windows Node,
not Node inside WSL or a container.

## Connect with npm

The package is prepared for npm publication; the commands below become available
once `@lightstreamer-workbench/agent@0.1.0` is published. Use the source/tarball
instructions below before publication. The extension must include Agent access;
the published 2.0.4 extension predates it.

Run the same command in macOS Terminal or Windows PowerShell:

```sh
npx --yes @lightstreamer-workbench/agent@0.1.0 setup
```

Copy the printed `mcpServers` entry into your agent's MCP configuration. Its
standard JSON form is identical on both platforms:

```json
{
  "mcpServers": {
    "lightstreamer-workbench": {
      "command": "npx",
      "args": ["--yes", "@lightstreamer-workbench/agent@0.1.0", "mcp"]
    }
  }
}
```

Start/reconnect that MCP server, then open **Lightstreamer Workbench** in the
intended tab's DevTools. Ask the agent to call `list_panel_sessions` and
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
node ./workbench-companion/node_modules/@lightstreamer-workbench/agent/dist/cli.mjs setup --local
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

## Access and optional authentication

Each Panel Session enables inspection and Local Injection by default. The
header's **Agent access On/Off** controls access, not agent presence. Off revokes
access, stops retries and pauses an agent Scenario; closing the panel ends the
grant. A new panel uses defaults. Connection retries have a 15-second maximum
backoff. Reconnection never repeats an Injection or resumes a Scenario. Unknown
delivery must be inspected, never automatically retried.

Authentication is off by default. Any local process can use a connected panel's
grant or impersonate the broker. Exact Host/extension-Origin checks reject normal
websites but do not identify OS users or individual agents. Local WebSocket data
is unencrypted. Requested Evidence may reach your agent's model provider. The
companion does not persist Evidence or log payloads; redaction is not a general
secret detector. Local Injection invokes app listeners, which may cause other
application effects. Server Injection is not exposed to agents.

For opt-in authentication, add `--auth required` to `setup`. Preserve the private
`LSEW_AGENT_CONNECTION` entry in the generated configuration. In Workbench,
open **More actions → Agent setup instructions → Advanced connection settings**,
enable **Require authentication**, then apply settings. Ask the agent to show
`get_pairing_requests`, compare its short code, and click **Approve connection**.
The agent confirms that exact request with `confirm_pairing`. Neither approval
alone grants access. The credential is not the short code and never goes into
a Workbench field. Optional read-only permissions and a custom port are in the
same settings. For a custom port, set `--port` in setup and the matching panel
port. Neither side falls back when modes or ports differ.

### Switch an existing setup to auth off

Disconnect panels, stop matching MCP clients and let the idle broker exit.
Replace the old MCP entry with default setup output, remove its
`LSEW_AGENT_CONNECTION` setting, and reload Workbench. Existing credentials
continue to require authentication until deliberately removed. Use a separate
port if you must run both modes at once.

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

## Verification and publication

`npm run agent:test:package` packs and installs the artifact outside the source
tree, runs its npm executable, checks version-pinned setup, and drives two real
stdio MCP clients through its shared broker to an exact test panel.
`npm run agent:test:extension` repeats packaging and uses the installed artifact
with a loaded Chrome panel: automatic discovery, restart/revocation, retained
Evidence, exact inspected-page identity, and optional authentication.
`npm run agent:test:browser` adds official-client Local Injection, duplicate
suppression, Scenario Steps and the application's displayed result.
The same CI workflow runs on Windows, macOS and Linux.

Before publishing, run those checks plus type checking, the full unit/browser
regression gates, and `npm run docs:check`. Inspect `npm pack ./agent --dry-run`
and verify npm scope ownership. Publish the reviewed tarball with
`npm publish release/lightstreamer-workbench-agent-0.1.0.tgz --access public`.
Publishing requires a maintainer npm login with access to the scope; preparing
or testing a tarball does not publish it. The Chrome extension release is separate.
