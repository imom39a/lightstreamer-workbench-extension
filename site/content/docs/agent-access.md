Workbench can share one open Panel Session with an MCP client. The agent can inspect retained Evidence, query the structural Scope, and prepare or run deliberate Local Injection. Use this guide when you need an agent to help investigate a Lightstreamer page.

## Requirements

- Google Chrome with the Lightstreamer Workbench extension.
- Node.js 22.12 or later and npm.
- An MCP client that can start a local stdio server.
- Chrome and the MCP client on the same computer.

The MCP companion runs as a local Node process. The MCP client starts it when it starts the configured stdio server. The companion starts or reuses a loopback broker at `127.0.0.1:24817`. Open Workbench panels connect to that broker automatically while the panel is open. You do not need a native installer, a hosted service, a background service, or a separate terminal to run a daemon.

## Prepare the source build

Until the npm package is published, use the matching local release bundle or source checkout. Do not use the version-pinned `npx` command yet: the package is not available from the npm registry.

Sign in to GitHub, open the [Agent companion workflow runs](https://github.com/imom39a/lightstreamer-workbench-extension/actions/workflows/agent-companion.yml), filter to the `main` branch, choose its latest successful run, and download the `workbench-mcp-release-bundle` artifact. GitHub downloads this artifact as a wrapper ZIP. Extract the wrapper ZIP, then extract the named `lightstreamer-workbench-mcp-v2.0.5.zip` bundle inside it. Check `release-manifest.json` in the MCP bundle root and verify its `source.commit` before using the artifacts. The MCP bundle contains `extension/lightstreamer-workbench-v2.0.5.zip` and `agent/lightstreamer-workbench-agent-0.1.0.tgz`. Extract the extension ZIP into its own directory and load that directory from `chrome://extensions`. Copy the unpacked extension ID. From the extracted MCP bundle root, install the tarball into a stable directory and print a local MCP configuration. If you cannot sign in or download the workflow artifact, build the extension and companion from a source checkout using the commands below.

```sh
npm install --prefix ./workbench-companion ./agent/lightstreamer-workbench-agent-0.1.0.tgz
node ./workbench-companion/node_modules/lightstreamer-workbench-agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Copy the printed `mcpServers` entry into your MCP client's configuration. `--local` prints an absolute Node and package path. Keep the installed package directory in place. The official Store extension is not required for this local candidate setup.

To build the same local package from source, run these commands from the repository root:

```sh
npm ci
npm run build
npm run agent:build
node agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Load the generated `dist/` directory as an unpacked extension and use its actual extension ID. Do not send private application Evidence when sharing the local package or build.

After npm publication is confirmed, use the version-pinned setup command `npx --yes lightstreamer-workbench-agent@0.1.0 setup` and copy its output. Keep the package version pinned in the MCP entry.

## Connect and choose a panel

1. Save the MCP entry and start or reconnect that server in your agent application.
2. Open the intended application's Workbench panel in Chrome DevTools.
3. Ask the agent to call `list_panel_sessions` and choose the exact browser tab.
4. Ask it to call `get_status` for that `panelSessionId` before using other tools.

The Workbench header shows **On**, **Waiting**, or **Off**. **On** means a companion connection is ready. **Waiting** means access is enabled but the companion is not ready. **Off** means access is disabled. The header status opens Agent access and setup; it does not toggle access. Use the on/off control under **More actions → Agent access and setup**. An open panel enables inspection and Local Injection by default.

The supported tools include `list_panel_sessions`, `get_status`, `list_scope`, `search_scope`, `get_scope`, `query_evidence`, `search_evidence`, `summarize_evidence`, `describe_stream`, `wait_for_evidence`, `get_evidence`, `query_diagnostics`, `validate_agent_candidate`, `prepare_local_injection`, `execute_local_injection`, `prepare_scenario`, `control_scenario`, and `get_scenario_trace`. Tool results are bounded and tied to one exact Panel Session. Ask `get_status` for the connected extension's actual capabilities when a tool is unavailable.

## Efficient reads on a large stream

Check `get_status.readContract.version === 2`. Reload matching extension and companion builds and reconnect MCP if it is missing; a newer companion alone does not update the panel. Reconnecting also refreshes the agent's tool schemas.

Find the smallest relevant Scope with `search_scope` (for example, `kind:"subscription"`). Use its exact `scopeId` in `summarize_evidence` to count matching records; add `facet:"key"` for distinct observed COMMAND keys. Then call `query_evidence` with `where:{key:["the-observed-key"]}` and `fields:["the-declared-field"]` for a few relevant examples. Use returned values, not the placeholder strings in this example.

Fresh Evidence reads require `scopeId` or explicit `within:"page"` / `within:"current-investigation"`. Compact metadata is the default. `fields` selects exact Item Update field names; `includePayload:true` deliberately requests the full permitted envelope instead. These reads default to an 8 KiB serialized MCP result budget, including compatibility text and structured data. `maxBytes` can explicitly select 4–64 KiB; `limit` is a maximum, not a guaranteed page size. Continue only when the question needs more results, using `panelSessionId` and `cursor` alone.

Summary counts refer to retained Evidence records, not currently active COMMAND rows. One item can contain many keys, and the same key can occur in multiple items. Inspect Coverage and the read point before drawing absence or completeness conclusions. Filtering, projection and aggregation run in the extension's owning panel over its existing history indexes; the companion routes requests and enforces a final size cap. There is no duplicate database or hosted query service. See the [read contract and examples](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/READS.md).

## Investigate and run a local experiment

Use this order so every proposed change has a source in observed Evidence:

1. Discover the exact panel and inspect its current status.
2. Find the relevant Scope and summarize matching Evidence or distinct keys. Use `describe_stream` only when a bounded field-shape profile is needed.
3. Read a few matching examples and selected fields with `query_evidence` or `search_evidence` at an explicit read point.
4. Validate a source-grounded Draft or explicit Scenario with `validate_agent_candidate`.
5. Review and prepare the deliberate Local Injection or Scenario.
6. Execute the reviewed operation once, then inspect its outcome and Evidence references.
7. Verify the inspected application's response separately with browser tools or the application's own test surface.

Local Injection delivers an Item Update to the selected Subscription's local listeners. A Workbench delivery result does not prove that the application's DOM, business logic, or server state changed. Scenario Checkpoints read Workbench outcomes and projections; they do not execute arbitrary page code or assert arbitrary application state.

If an operation result is unknown or a connection is lost, read the existing operation or Scenario trace before taking another action. Do not retry an Injection blindly. A new operation can deliver twice.

## Data and security boundary

Agent access uses port `24817` with authentication off. Any local process that can reach the broker can use a connected panel's grant or impersonate the companion. Loopback and Origin checks do not isolate processes or operating-system users. Use a trusted development computer.

Requested Evidence passes from the extension to the local MCP client and may reach the model provider configured in that client. Some application values, identifiers, diagnostics, and the inspected URL path can be private data. Review the provider's data handling and do not send production secrets. Client Message bodies remain redacted in agent results.

Agents can inspect Evidence and use Local Injection. They cannot perform Server Injection, clear Event History, or evaluate arbitrary page code. Local Injection listeners belong to the application and can cause application-side effects. Access off revokes the panel grant and pauses agent Scenarios, but it cannot undo an update already delivered.

For platform-specific launcher details, see [Windows setup](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/WINDOWS.md) and the [companion source guide](https://github.com/imom39a/lightstreamer-workbench-extension/tree/main/agent). For data handling, read the [Privacy policy]({{site}}privacy/) and [Security policy]({{site}}security/).

## Windows setup

Use Windows Node.js when Chrome runs on Windows. Do not run the companion under WSL or in a container; those environments do not share Chrome's loopback address. Install Node.js 22.12 or later with npm. In PowerShell, use `npm.cmd` and `npx.cmd` to avoid execution-policy restrictions on `.ps1` shims. Do not change the PowerShell execution policy.

From the extracted MCP bundle root, install the tarball with `npm.cmd install --prefix ./workbench-companion ./agent/lightstreamer-workbench-agent-0.1.0.tgz`, then run `node.exe ./workbench-companion/node_modules/lightstreamer-workbench-agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID`. Copy the printed entry into your agent app. If that app cannot find Node, use the full paths from `(Get-Command node.exe).Source` and `(Get-Command npm.cmd).Source`. Restart the agent app after installing Node so it receives the updated PATH.

After npm publication, use `npx.cmd --yes lightstreamer-workbench-agent@0.1.0 setup`. If the app cannot find `npx`, use the path from `(Get-Command npx.cmd).Source` as its command and keep each argument in a separate configuration entry. Check that the extension is loaded and its Agent access status is not Off. When the status is Waiting, start or reconnect the configured MCP server in the agent app. `list_panel_sessions` returns connected panels; use the exact session before calling `get_status`.

The companion package contains the `lightstreamer-workbench` skill at `skills/lightstreamer-workbench/SKILL.md`. Install that folder in your MCP client's agent-skill directory or ask the client to load that file. It describes the Evidence-guided investigation flow and bounded operation rules.
