Connect an MCP agent to inspect Evidence and test Local Injections in an open Workbench panel.

## Requirements

- Chrome with a matching Workbench extension that supports Agent access.
- [Node.js 22.12 or later with npm](https://nodejs.org/en/download).
- An agent app that supports local stdio MCP servers.
- Chrome, Node, and the agent app on the same computer.

Companion [0.1.7 is available from npm](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.7) and pairs with extension 2.0.8. Install the extension separately. See [Release notes]({{site}}releases/) for the available versions.

Use the ready-built extension and npm package; no repository checkout or build tools are required.

## Install a matching extension

Follow [Getting started]({{site}}docs/getting-started/) for Store installation. Check `chrome://extensions`. The Store offers 2.0.7 while 2.0.8 awaits review; use the matching download below.

If Store availability differs, install the matching download:

1. Download the [packaged extension 2.0.8](https://github.com/imom39a/lightstreamer-workbench-extension/releases/download/agent-v0.1.7/lightstreamer-workbench-mcp-v2.0.8.zip).
2. Extract the downloaded bundle.
3. Extract `extension/lightstreamer-workbench-v2.0.8.zip` into a folder you will keep.
4. Open `chrome://extensions`.
5. Turn on **Developer mode**.
6. Select **Load unpacked**.
7. Choose the extracted extension folder that contains `manifest.json`.

Copy the ID Chrome assigns to this extension. Add it to the setup command below with `--extension-id YOUR_EXTENSION_ID`. The companion still comes from npm.

## Set up MCP

1. Run setup to download the companion and print its pinned MCP configuration:

   macOS or Linux:

   ```sh
   npx --yes lightstreamer-workbench-agent@0.1.7 setup
   ```

   Windows PowerShell:

   ```powershell
   npx.cmd --yes lightstreamer-workbench-agent@0.1.7 setup
   ```

   For a downloaded extension loaded unpacked, append `--extension-id YOUR_EXTENSION_ID`. Copy its ID from `chrome://extensions`.

2. Copy the printed `mcpServers` entry into your agent app's MCP settings.
3. Start that MCP server in the agent app.
4. Open Workbench on the application tab you want to inspect.
5. Ask the agent to call `list_panel_sessions`.
6. Ask it to call `get_status` with the selected `panelSessionId`.

The agent app starts the pinned npm companion. Workbench connects automatically.

## Check the connection

<figure>
  <img src="{{site}}assets/app-agent-access.png" alt="Workbench panel showing Agent access On and the expanded Agent access and setup controls under More actions." width="960" height="600">
  <figcaption>The header reports connection readiness. Open it to review the setup link, local access control, and data-sharing guidance.</figcaption>
</figure>

| Header status | Meaning |
| --- | --- |
| **On** | Connected and ready. This does not mean an agent is active. |
| **Waiting** | Access is enabled. Workbench retries the connection automatically. |
| **Off** | Access is disabled for this Panel Session. |

Select the header status to open the access control. A new panel enables access by default. Closing the panel ends access.

If the status stays **Waiting**, restart the MCP server in your agent app. Check the extension ID if you use an unpacked build. The default connection uses `127.0.0.1:24817` with authentication off.

When upgrading, close Workbench panels, stop its MCP servers, wait 30 seconds for the old broker to exit, then restart the matching pair.

On Windows, use Windows Node. If the agent app cannot find `npx`, set the MCP command to `npx.cmd`. Restart the app after installing Node.

## Work with your agent

Name the application tab and ask the agent to find relevant Subscriptions, count retained records, and inspect examples.

For example: “Find the orders Subscription. Count its retained updates, then show the last five with the key and quantity fields.” Summary counts describe retained records, not active COMMAND rows. Check Coverage before drawing conclusions from missing Evidence.

If the agent reports an unsupported tool or incompatible version, update both components to a matching pair from [Release notes]({{site}}releases/), then restart the MCP connection.

## Test a local update

Use observed Evidence to construct a Draft or Scenario. Validate and prepare it before execution. Check its result, then verify the application's response separately.

Keep the panel visible during a Scenario. Do not repeat an Injection with an unknown result. Read its existing outcome or Scenario trace first.

## Optional agent skill

The package bundles `skills/lightstreamer-workbench/SKILL.md` and its references.

The next release after 0.1.7 offers the skill during setup. Once published:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup
```

Use `npx` on macOS/Linux. npx first retrieves the companion and its installer dependency. Accept the skill offer to use the upstream `skills` installer's native agent selector and project/user scope prompts. Supported targets include Codex (OpenAI), Claude Code, Kiro, Cursor, and the rest of its agent registry; you can select several. It copies the complete skill; `update` refreshes it alongside printed MCP configuration. The outer `npx.cmd --yes` leaves the skill prompts available.

For unattended installation, append `--skill --agent codex claude-code kiro-cli --yes`, keeping only the targets you need, and optionally `--global`. Kiro IDE/CLI share `.kiro/skills`. Repeated `--agent` flags also work. `--json` skips installation; MCP startup never prompts.

Published 0.1.7 requires copying the optional bundled skill manually.

## Access and data

Authentication is off. Any local process that can reach the companion can read Evidence or inject locally. Use a trusted development computer.

Requested Evidence may reach your agent's model provider. Do not share secrets. Client Message bodies are redacted in agent results.

Local Injection calls application listeners and can trigger app actions. It does not contact Lightstreamer Server. Agents cannot use Server Injection, clear history, or run arbitrary page code through this MCP interface.

Read the [Privacy policy]({{site}}privacy/) and [Security policy]({{site}}security/) before sharing application data.
