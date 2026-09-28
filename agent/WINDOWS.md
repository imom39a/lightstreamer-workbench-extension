# Windows MCP companion

Windows and macOS use the same npm package, Node source and loopback connection.
Follow [the common setup guide](README.md#before-npm-publication) first. There is no
Windows build, native host, registry entry or administrator requirement.

## PowerShell

Install Node.js 22.12+ with npm. Until npm publication is confirmed, install the
tarball from the matching local release bundle and print an absolute local
configuration. Load the matching extension archive as unpacked and use its ID:

```powershell
npm.cmd --version
$workbenchExtensionId = 'YOUR_UNPACKED_EXTENSION_ID'
npm.cmd install --prefix .\workbench-companion .\agent\lightstreamer-workbench-agent-0.1.0.tgz
$workbenchNode = (Get-Command node.exe).Source
$workbenchCli = (Resolve-Path '.\workbench-companion\node_modules\lightstreamer-workbench-agent\dist\cli.mjs').Path
& $workbenchNode $workbenchCli setup --local --extension-id $workbenchExtensionId
```

From the extracted MCP bundle root, install the bundle's tarball using the
[local installation instructions](README.md#local-installation-and-source-development).
`npm.cmd`/`npx.cmd` avoid PowerShell execution-policy restrictions on `.ps1` shims;
you do not need to weaken that policy. The pinned `npx.cmd` setup applies after
the package is published. If the agent cannot resolve it then, use the path
returned by `Get-Command npx.cmd`.
Restart a GUI agent after installing Node so it receives the updated PATH.
After saving the local MCP configuration, start/reconnect that server in your agent
app. The app launches the companion automatically; no separate PowerShell
window, manually running server, Windows service or Chrome native host is needed.

After publication, `npx.cmd` is the Windows fallback for the pinned npm setup.
The companion includes `describe_stream`, `wait_for_evidence`,
`validate_agent_candidate`, `search_evidence`, `search_scope` and `summarize_evidence`. These also
require a compatible extension; check `get_status.capabilities`. Build and load
the extension from `main` if the installed Store version lacks them; see
[Evidence-guided experiments](README.md#evidence-guided-experiments).
The setup command and Windows connection path are the same for these tools.
Efficient reads require `get_status.readContract.version === 2`. If it is absent,
reload the matching extension build and restart the MCP server in the agent app
to refresh its tool schemas. Do not paginate an old connection's full envelopes
to work around missing filters. The [efficient read guide](READS.md) shows the
Scope → summary → selected fields workflow; it is identical on Windows.

If the client cannot launch npm shims, use a stable package installation and
print an absolute Node configuration:

```powershell
$workbenchNode = (Get-Command node.exe).Source
$workbenchCli = (Resolve-Path '.\workbench-companion\node_modules\lightstreamer-workbench-agent\dist\cli.mjs').Path
& $workbenchNode $workbenchCli setup --local --extension-id $workbenchExtensionId
```

Paths with spaces are separate JSON argument entries, not a shell command string.
For a portable Node ZIP, invoke its absolute `node.exe` path with the same CLI.
Use Windows Node when Chrome runs on Windows. WSL, containers and remote hosts
have different loopback environments and do not automatically reach that Chrome.

## Connection troubleshooting

Open the intended tab's Workbench panel. **Agent access Waiting** means access
is enabled but the companion connection is not ready. It changes to **On**
automatically when connected; no Connect button is needed. **Off** means access
is disabled. Click the header status to open **More actions → Agent access and setup**;
use the on/off control there to enable or disable access. The header itself
does not toggle access. Ask the
agent for `list_panel_sessions`; then identify the exact tab with `get_status`.
An empty list means no connected panel. Start/reconnect Workbench's MCP server
in the agent app, which launches the companion for you. If it is already running, check
that the extension includes Agent access and setup names its actual extension ID.
For unpacked extensions, copy the ID from `chrome://extensions` into setup's
`--extension-id` argument. Default setup targets the official Store extension.

The panel uses port 24817 with authentication off and inspection plus Local
Injection available together. Remove old custom port or authentication settings
from the MCP entry using the common migration instructions. If another process
owns port 24817, identify it before making changes; do not terminate an unrelated
process. There is no authentication, permission or port form in More actions.

## Switch an existing setup to auth off

Follow [the common migration procedure](README.md#switch-an-existing-setup-to-auth-off).
Remove the old `LSEW_AGENT_CONNECTION` setting from your MCP JSON or TOML as well
as replacing the command. Existing credentials keep authentication enabled.
Stop matching clients and disconnect panels before restarting so the old broker
can exit. A reconnect never replays an Injection or resumes a Scenario.
