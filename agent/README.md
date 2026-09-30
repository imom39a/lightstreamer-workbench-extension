# Lightstreamer Workbench MCP companion

Connect an MCP agent to an open Lightstreamer Workbench DevTools panel. The
companion lets the agent inspect captured Lightstreamer Evidence and run reviewed
Local Injection experiments in the inspected page. It runs locally on Windows,
macOS, and Linux; it does not require a hosted service or Chrome native host.

## Requirements

- Node.js 22.12+ and npm on the computer running Chrome and your MCP client.
- Lightstreamer Workbench extension 2.0.7 with **Agent access**. If the Chrome
  Web Store offers an older version, use the ready-built extension in the
  [matching release bundle](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.5).
- An MCP client that can launch a local stdio server.

Use the extension and companion from the same release or source revision when
using newer tools. Check `get_status.capabilities` for the connected panel's
actual tool list.

## Set up

Companion 0.1.5 pairs with extension 2.0.7. It verifies broker compatibility before connecting, supports exact COMMAND-key reads, and waits for existing operation receipts without repeating execution. It bounds serialized MCP replies to 8 KiB by default, allows up to 64 KiB where a tool supports `maxBytes`, and keeps cached Evidence query results out of operational status. Generate a version-pinned MCP configuration from npm:

On macOS or Linux:

```sh
npx --yes lightstreamer-workbench-agent@0.1.5 setup
```

In Windows PowerShell:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@0.1.5 setup
```

For an unpacked extension, add `--extension-id YOUR_UNPACKED_EXTENSION_ID` to
the setup command. Copy the printed `mcpServers` entry into your MCP client's
configuration and start or reconnect the server. Setup only prints configuration;
it does not edit your settings. The generated entry runs the pinned npm version
through `npx` whenever your MCP client starts it.

Open **Lightstreamer Workbench** in the intended tab's DevTools. Ask the agent
to call `list_panel_sessions`, choose the exact tab, and call `get_status` for
that Panel Session. The MCP client starts the companion automatically; no
separate broker terminal is needed. See [Windows setup and troubleshooting](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/WINDOWS.md)
if the client cannot find `npx` or Chrome runs on Windows.

## Matching extension build

The npm package does not install the Chrome extension. Download
`lightstreamer-workbench-mcp-v2.0.7.zip` from the
[0.1.5 GitHub release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.5)
if you need the matching extension before the Store update. Extract the bundle,
then extract `extension/lightstreamer-workbench-v2.0.7.zip` into its own folder.
In `chrome://extensions`, enable **Developer mode**, select **Load unpacked**,
and choose the folder containing `manifest.json`. Use Chrome's assigned ID with
`setup --extension-id`.

The bundle also contains the tested companion tarball, `release-manifest.json`,
and SHA-256 checksums. The companion normally comes from npm. For a local tarball
installation, extract `agent/lightstreamer-workbench-agent-0.1.5.tgz`, then run:

```sh
npm install --prefix ./workbench-companion ./lightstreamer-workbench-agent-0.1.5.tgz
node ./workbench-companion/node_modules/lightstreamer-workbench-agent/dist/cli.mjs setup --local
```

In Windows PowerShell, use `npm.cmd` and `node.exe`. Keep that installation
directory in place because `--local` configuration points to its installed CLI.

For a source checkout, run `npm ci`, `npm run build`, and `npm run agent:build`
from the repository root. Load `dist/` as an unpacked extension, then run
`node agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID`.
After pulling a newer revision, rebuild both artifacts, reload the extension
in `chrome://extensions`, and restart the MCP server in your client.
`agent:build` alone does not rebuild or reload the panel that serves Evidence.
The shared broker can also outlive an MCP client. To replace it during an
upgrade, first stop all Workbench MCP clients and close all Workbench DevTools
panels, then allow 30 seconds for the idle broker to exit before reconnecting.

## What the agent can do

- Find a Subscription or item with `search_scope`, then inspect retained Evidence
  with `summarize_evidence`, `query_evidence`, `search_evidence`, and
  `get_evidence`.
- Wait for matching Evidence with `wait_for_evidence` and inspect bounded stream
  shape with `describe_stream`.
- Validate a source-grounded candidate, prepare a Local Injection or Scenario,
  review it, and execute it once. Inspect the result and Evidence references
  before taking another action.

The [efficient read guide](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/READS.md)
shows the Scope → summary → selected fields workflow. The packaged
`skills/lightstreamer-workbench` directory contains the agent investigation
workflow. Local Injection reaches the application's subscription listeners;
it does not send an Item Update to the Lightstreamer Server. Agent tools do not
expose Server Injection or arbitrary page-code execution. Verify application
behavior separately from Workbench delivery results.

## Access and data

Each open Panel Session grants inspection and Local Injection by default. The
header shows **Waiting** until the companion connects, **On** when ready, and
**Off** when access is disabled. Use **More actions → Agent access and setup**
to change access. Turning it off revokes the panel grant; closing the panel
ends it. A lost connection does not replay an Injection or resume a Scenario.
Inspect an unknown outcome before deciding whether to send another update.

Before reusing a running broker, the companion verifies its extension ID,
protocol, and read contract. A mismatch returns `COMPANION_INCOMPATIBLE` and
keeps Agent access Waiting with recovery instructions. Stop existing Workbench
MCP servers and restart the matching package configured for the required
extension ID. The broker exits after 30 seconds without connections. The
panel's public `/identity` preflight contains only extension/package versions
and compatibility metadata; it exposes no Panel Session, grant, or Evidence.

For efficient reads, check `get_status.capabilities`, locate an exact Scope,
and request only needed fields. `query_command_state` reads one derived COMMAND
key with certainty and provenance; it never claims Authoritative COMMAND State.
`wait_for_operation` waits for an existing receipt without repeating execution.
Scenario control completion acknowledges the control, so use
`get_scenario_trace` to inspect the Run. Each agent may have 16 pending calls,
including at most two waits; wait for a call to settle before sending more.

The companion uses a shared broker on `127.0.0.1:24817` with authentication off.
Any local process that can reach it can use a connected panel's grant. Requested
Evidence may reach your MCP client's model provider. The companion does not
persist Evidence or log payloads, but redaction is not a general secret
detector. Local Injection can trigger application listener side effects. Use a
trusted development computer and review the data you share with an agent.

If you previously used the native-host companion, replace its MCP entry with
the setup output above and reload the extension. The former `install`,
`doctor`, `host`, and `--transport native` commands are no longer supported.
