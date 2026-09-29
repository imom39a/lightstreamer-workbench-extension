Connect an MCP agent to inspect Evidence and test Local Injections in an open Workbench panel.

## Requirements

- Chrome with a Workbench build that supports Agent access.
- Node.js 22.12 or later with npm.
- An agent app that supports local stdio MCP servers.
- Chrome, Node, and the agent app on the same computer.

The npm companion is currently unavailable after its September 29, 2026 unpublish. A tested 0.1.2 candidate is in the [matching release bundle](https://github.com/imom39a/lightstreamer-workbench-extension/actions/workflows/agent-companion.yml). Use the [source or bundle instructions](https://github.com/imom39a/lightstreamer-workbench-extension/tree/main/agent) until npm publication resumes. The companion does not install the Chrome extension. See [Release notes]({{site}}releases/) for extension availability.

## Set up MCP

1. After npm publication resumes, run the setup command for your system. Until then, use the source or bundle instructions above.

   macOS or Linux:

   ```sh
   npx --yes lightstreamer-workbench-agent@latest setup
   ```

   Windows PowerShell:

   ```powershell
   npx.cmd --yes lightstreamer-workbench-agent@latest setup
   ```

   For an unpacked extension, append `--extension-id YOUR_EXTENSION_ID`. Copy its ID from `chrome://extensions`.

2. Copy the printed `mcpServers` entry into your agent app's MCP settings.
3. Start that MCP server in the agent app.
4. Open Workbench on the application tab you want to inspect.
5. Ask the agent to call `list_panel_sessions`.
6. Ask it to call `get_status` with the selected `panelSessionId`.

The agent app starts the companion. Workbench connects automatically. No separate terminal, hosted service, or native installer is needed after setup.

If your extension lacks **Agent access and setup**, use a matching unpacked build. Follow the [release-bundle and source instructions](https://github.com/imom39a/lightstreamer-workbench-extension/tree/main/agent); use the extension ID assigned by Chrome.

## Check the connection

| Header status | Meaning |
| --- | --- |
| **On** | Connected and ready. This does not mean an agent is active. |
| **Waiting** | Access is enabled. Workbench retries the connection automatically. |
| **Off** | Access is disabled for this Panel Session. |

Select the header status to open the access control. A new panel enables access by default. Closing the panel ends access.

If the status stays **Waiting**, restart the MCP server in your agent app. Check the extension ID if you use an unpacked build. The default connection uses `127.0.0.1:24817` with authentication off.

On Windows, use Windows Node, not WSL or a container. If the agent app cannot find `npx`, use `npx.cmd`. Restart the app after installing Node. See [launcher troubleshooting](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/WINDOWS.md) for full-path setup.

## Query only what you need

1. Check that `get_status.readContract.version` is `2`.
2. Use `search_scope` to find the relevant Subscription or item.
3. Use `summarize_evidence` with its `scopeId` to count records or distinct keys.
4. Use `query_evidence` with that Scope, typed `where` filters, and selected `fields` to read a few examples.
5. Use `get_evidence` only when you need a complete event.

Queries and summaries default to an 8 KiB result limit. Summary counts describe retained records, not active COMMAND rows. Check Coverage before drawing conclusions from missing Evidence.

If the read contract is missing, update the extension and companion. Then reconnect MCP. See the [read contract and examples](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/READS.md) for details.

## Test a local update

Use observed Evidence to construct a Draft or Scenario. Validate and prepare it before execution. Check its result, then verify the application's response separately.

Keep the panel visible during a Scenario. Do not repeat an Injection with an unknown result. Read its existing outcome or Scenario trace first.

The package includes `skills/lightstreamer-workbench/SKILL.md`. Install the `lightstreamer-workbench` skill folder in your agent's skill directory. It teaches this investigation procedure.

## Access and data

Authentication is off. Any local process that can reach the companion can read Evidence or inject locally. Use a trusted development computer.

Requested Evidence may reach your agent's model provider. Do not share secrets. Client Message bodies are redacted in agent results.

Local Injection calls application listeners and can trigger app actions. It does not contact Lightstreamer Server. Agents cannot use Server Injection, clear history, or run arbitrary page code through this MCP interface.

Read the [Privacy policy]({{site}}privacy/) and [Security policy]({{site}}security/) before sharing application data.
