# Windows MCP companion

Use Windows Node.js 22.12+ and npm when Chrome runs on Windows. The companion
and Chrome must share the same loopback network; Node inside WSL, a container,
or a remote host does not automatically connect to Windows Chrome. No native
host, registry entry, Windows service, or administrator permission is needed.

## PowerShell setup

Follow the [common setup guide](README.md#set-up). PowerShell can block the
`npx.ps1` shim, so use `npx.cmd` without changing your execution policy:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup
```

If you loaded Workbench as an unpacked extension, include its ID from
`chrome://extensions`:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Copy the printed `mcpServers` entry into your agent application's configuration.
Start or reconnect that MCP server, then open the intended Workbench DevTools
panel. Ask the agent for `list_panel_sessions` and use `get_status` to confirm
the exact tab. The agent application launches the companion; keep no separate
PowerShell window open for it.

If the application cannot find `npx`, use the full path returned by
`(Get-Command npx.cmd).Source` as the entry's `command`. Keep each argument in
a separate JSON array entry. Restart the application after installing Node so
it receives the updated PATH.

## Offline tarball

If you received a matching release bundle, extract it and load its extension
ZIP as unpacked. From the extracted bundle root, install its companion tarball
into a stable directory:

```powershell
$workbenchTarball = (Resolve-Path '.\agent\lightstreamer-workbench-agent-*.tgz').Path
npm.cmd install --prefix .\workbench-companion $workbenchTarball
$workbenchNode = (Get-Command node.exe).Source
$workbenchCli = (Resolve-Path '.\workbench-companion\node_modules\lightstreamer-workbench-agent\dist\cli.mjs').Path
& $workbenchNode $workbenchCli setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Keep the installed directory in place; `--local` prints its absolute Node and
CLI paths. This is the same npm runtime as the registry package.

## Connection troubleshooting

**Waiting** means panel access is enabled but the companion is not connected.
Start or reconnect the configured MCP server and check that the extension ID
matches the loaded build. **Off** means access is disabled; use **More actions →
Agent access and setup** to enable it. **On** means the connection is ready,
not that an agent is actively using it.

The panel and companion use port 24817 with authentication off. If you have an
older MCP entry, remove custom port settings and `LSEW_AGENT_CONNECTION`, then
restart the MCP server and reload the panel. Existing credentials are not
silently ignored. Do not retry an Injection after an unknown outcome without
inspecting its operation or Scenario trace.
