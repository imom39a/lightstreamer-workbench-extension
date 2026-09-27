# Windows MCP companion

Windows and macOS use the same npm package, Node source and loopback connection.
Follow [the common setup guide](README.md#connect-with-npm) first. There is no
Windows build, native host, registry entry or administrator requirement.

## PowerShell

Install Node.js 22.12+ with npm, then verify the commands your agent needs:

```powershell
node --version
npm.cmd --version
npx.cmd --yes @lightstreamer-workbench/agent@0.1.0 setup
```

The npm command becomes available after publication. Before publication, install
the verified tarball using the [local installation instructions](README.md#local-installation-and-source-development).
`npm.cmd`/`npx.cmd` avoid PowerShell execution-policy restrictions on `.ps1` shims;
you do not need to weaken that policy. The common MCP JSON uses `npx`. If your
agent cannot resolve it, use the path returned by `Get-Command npx.cmd`.
Restart a GUI agent after installing Node so it receives the updated PATH.

If the client cannot launch npm shims, use a stable package installation and
print an absolute Node configuration:

```powershell
$workbenchNode = (Get-Command node.exe).Source
$workbenchCli = (Resolve-Path '.\workbench-companion\node_modules\@lightstreamer-workbench\agent\dist\cli.mjs').Path
& $workbenchNode $workbenchCli setup --local
```

Paths with spaces are separate JSON argument entries, not a shell command string.
For a portable Node ZIP, invoke its absolute `node.exe` path with the same CLI.
Use Windows Node when Chrome runs on Windows. WSL, containers and remote hosts
have different loopback environments and do not automatically reach that Chrome.

## Connection troubleshooting

Open the intended tab's Workbench panel and leave **Agent access On**. Ask the
agent for `list_panel_sessions`; then identify the exact tab with `get_status`.
An empty list means no connected panel. Check that the MCP server is running,
the extension includes Agent access, and setup names its actual extension ID.
For unpacked extensions, copy the ID from `chrome://extensions` into setup's
`--extension-id` argument. Default setup targets the official Store extension.

For a busy port, generate setup with `--port 24818` and apply the same port under
Workbench's Advanced connection settings. Do not terminate an unrelated process.
Both sides must use the same authentication mode. Default mode needs no code or
approval. Optional authentication and its comparison-code flow are described in
the common guide; never paste the private credential into Workbench or chat.

## Switch an existing setup to auth off

Follow [the common migration procedure](README.md#switch-an-existing-setup-to-auth-off).
Remove the old `LSEW_AGENT_CONNECTION` setting from your MCP JSON or TOML as well
as replacing the command. Existing credentials keep authentication enabled.
Stop matching clients and disconnect panels before restarting so the old broker
can exit. A reconnect never replays an Injection or resumes a Scenario.
