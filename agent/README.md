# Lightstreamer Workbench MCP companion

Connect an MCP agent to an open Lightstreamer Workbench DevTools panel. The
companion lets the agent inspect captured Lightstreamer Evidence and run reviewed
Local Injection experiments in the inspected page. It runs locally on Windows,
macOS, and Linux; it does not require a hosted service or Chrome native host.

## Requirements

- Node.js 22.12+ and npm on the computer running Chrome and your MCP client.
- A Lightstreamer Workbench extension build with **Agent access**. If your
  installed extension does not show **Agent access and setup** under **More
  actions**, load a compatible unpacked build from the [Agent companion workflow's
  release bundle](https://github.com/imom39a/lightstreamer-workbench-extension/actions/workflows/agent-companion.yml).
- An MCP client that can launch a local stdio server.

Use the extension and companion from the same release or source revision when
using newer tools. Check `get_status.capabilities` for the connected panel's
actual tool list.

## Set up

On macOS or Linux, run:

```sh
npx --yes lightstreamer-workbench-agent@latest setup
```

In Windows PowerShell, use `npx.cmd`:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup
```

For an unpacked extension, add `--extension-id YOUR_UNPACKED_EXTENSION_ID` to
that command. Copy the printed `mcpServers` entry into your MCP client's
configuration and start or reconnect the server. Setup only prints configuration;
it does not edit your settings. The generated entry pins the exact installed
package version so later releases do not silently change your agent runtime.

Open **Lightstreamer Workbench** in the intended tab's DevTools. Ask the agent
to call `list_panel_sessions`, choose the exact tab, and call `get_status` for
that Panel Session. The MCP client starts the companion automatically; no
separate broker terminal is needed. See [Windows setup and troubleshooting](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/WINDOWS.md)
if the client cannot find `npx` or Chrome runs on Windows.

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

The companion uses a shared broker on `127.0.0.1:24817` with authentication off.
Any local process that can reach it can use a connected panel's grant. Requested
Evidence may reach your MCP client's model provider. The companion does not
persist Evidence or log payloads, but redaction is not a general secret
detector. Local Injection can trigger application listener side effects. Use a
trusted development computer and review the data you share with an agent.

If you previously used the native-host companion, replace its MCP entry with
the setup output above and reload the extension. The former `install`,
`doctor`, `host`, and `--transport native` commands are no longer supported.
