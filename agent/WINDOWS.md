# Windows launcher notes

Use the [shared MCP setup guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/)
first. The same npm package supports macOS, Windows, and Linux.

## PowerShell

Use Windows Node.js 22.12 or later with npm. Use `npx.cmd` to avoid PowerShell
execution-policy restrictions. Do not change the execution policy.

```powershell
npx.cmd --yes lightstreamer-workbench-agent@0.1.0 setup
```

For an unpacked extension, append `--extension-id YOUR_EXTENSION_ID`.
Copy the printed entry into your agent app. The app starts the companion.
You do not need a Windows service or a separate terminal after setup.

## The agent app cannot find Node or npx

1. Restart the agent app after installing Node.
2. Run `(Get-Command npx.cmd).Source` in PowerShell.
3. Use that full path as the MCP entry's `command`.

Keep each argument in a separate JSON array entry. Do not combine the command
and arguments into one shell string.

If the app cannot launch npm shims, use a stable local installation:

```powershell
npm.cmd install --prefix .\workbench-companion lightstreamer-workbench-agent@0.1.0
$workbenchNode = (Get-Command node.exe).Source
$workbenchCli = (Resolve-Path '.\workbench-companion\node_modules\lightstreamer-workbench-agent\dist\cli.mjs').Path
& $workbenchNode $workbenchCli setup --local
```

Append the extension ID for an unpacked build. Keep the installed directory in place.
A portable Node ZIP also works when its absolute `node.exe` path is used.

## Chrome and Node must share the computer

Use Windows Node when Chrome runs on Windows. WSL, containers, and remote hosts
do not automatically share Chrome's loopback connection.

For a panel that stays **Waiting**, use the
[connection checks](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/#check-the-connection).
Do not stop an unrelated process that uses port 24817.

For an old authenticated setup, follow the
[common migration procedure](README.md#switch-an-existing-setup-to-auth-off).
For offline builds, follow [local installation](README.md#local-installation-and-source-development).
