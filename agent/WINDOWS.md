# Windows: connect an agent to Lightstreamer Workbench

Use the standalone Node companion with Chrome on the **same Windows machine**.
No Workbench installer, native messaging registration, registry changes, Windows
service, administrator terminal, WebMCP flag or remote-debugging port is needed.
The companion is an MCP tool server; your existing coding agent supplies the model.

After one-time MCP setup, just open Workbench. Inspection and Local Injection
connect automatically on port **24817**. The header's **Agent access On/Off**
switch is on by default; there is no Connect step. Authentication is off by
default: no credential, code comparison or approval exchange is required.
Any local process can use a connected panel's grant. Use this default on a trusted
development machine; optional authentication remains available below.

Already configured the older authenticated version? Jump to
[Switch an existing setup to auth off](#switch-an-existing-setup-to-auth-off).

## 1. Prepare Node and the extension

You need Chrome, an agent client that supports **local stdio MCP**, and Node
22.12 or newer. Use a supported Node LTS release. An HTTP-only or cloud-hosted MCP
client cannot launch this local companion directly.

For installer-free Node, download a Windows ZIP matching your machine's x64 or
ARM64 architecture from the [official Node downloads](https://nodejs.org/en/download/).
Extract it into a directory you own. In the examples, `C:\Tools\node` is the
directory that directly contains `node.exe` and `npm.cmd`; adjust it if the ZIP
created an extra version-named directory. Existing compatible Node is also fine.

Open ordinary PowerShell, not an administrator terminal:

```powershell
$workbenchNodeDir = 'C:\Tools\node'
$workbenchNode = Join-Path $workbenchNodeDir 'node.exe'
& $workbenchNode --version
```

### Option A: build from this repository

Obtain this branch's source, including `package-lock.json`, and set its location.
The temporary PATH change below applies only to this PowerShell process and its
children; it does not edit the Windows registry or system PATH.

```powershell
$env:Path = "$workbenchNodeDir;$env:Path"
Set-Location 'C:\work\lightstreamer-workbench-extension'
& (Join-Path $workbenchNodeDir 'npm.cmd') ci
& (Join-Path $workbenchNodeDir 'npm.cmd') run build
& (Join-Path $workbenchNodeDir 'npm.cmd') run agent:build
$workbenchCli = (Resolve-Path '.\agent\dist\cli.mjs').Path
```

Stop if any command fails; continue only after both builds succeed. Using
`npm.cmd` avoids PowerShell's `npm.ps1` execution-policy issue without weakening
your execution policy. Builds download dependencies, but do not register a host.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select the repository's **`dist`** directory. This is the
extension build, not `agent\dist`. After later builds, use Reload on this
extension and reopen its DevTools panel.

### Option B: use a prebuilt companion

If a maintainer supplies the built companion tarball, extract it to a stable
directory, for example `C:\Tools\workbench-agent`. An `npm pack` archive has a
top-level `package` directory containing `dist\cli.mjs`, `skills`, this guide
and the license. No `npm install` is needed for the prebuilt companion.

```powershell
$workbenchCli = 'C:\Tools\workbench-agent\package\dist\cli.mjs'
& $workbenchNode $workbenchCli --help
```

You still need a matching extension build with **Agent access On/Off** in the header.
The companion tarball does not contain the Chrome extension. An older Store
extension without that control cannot use it. Source availability does not
imply that this feature has been published to the Chrome Web Store or npm.

## 2. Generate your MCP configuration

Copy the exact extension ID shown on its `chrome://extensions` card. Unpacked
builds may have a different ID from the Store extension.

```powershell
$workbenchExtensionId = 'REPLACE_WITH_THE_32_CHARACTER_EXTENSION_ID'
$workbenchSetup = & $workbenchNode $workbenchCli setup --extension-id $workbenchExtensionId | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Workbench setup failed; check the extension ID and paths.' }
```

Show the generated configuration:

```powershell
$workbenchSetup | ConvertTo-Json -Depth 6
```

`setup` prints configuration; it does not edit agent settings or start a service.
The default output has only a command and arguments—no credential or environment
entry. Keep Node and the companion at these paths after extracting updates.

## 3. Configure your agent

Choose **stdio/local command**, not HTTP, SSE or a WebSocket URL. The agent starts
`node.exe`; the companion starts its loopback broker automatically. Do not run
`mcp` manually in a second terminal—it expects the agent's protocol on stdin.

### Clients using JSON MCP settings

Merge the generated **`mcpServers` entry** into your client's existing settings,
preserving its other servers. Do not paste the outer `port`, `auth` or `next` fields.
Some clients use a different root key; adapt the wrapper, preserving `command`,
`args`. A source-build example has this shape:

```json
{
  "mcpServers": {
    "lightstreamer-workbench": {
      "command": "C:\\Tools\\node\\node.exe",
      "args": [
        "C:\\work\\lightstreamer-workbench-extension\\agent\\dist\\cli.mjs",
        "mcp", "--extension-id", "YOUR_ACTUAL_EXTENSION_ID",
        "--auth", "off", "--port", "24817"
      ]
    }
  }
}
```

Use the actual values generated on your machine, not these placeholders.
JSON backslashes are doubled; paths containing spaces stay one string in the
argument array. Do not embed extra shell quotes in `command` or use `cmd /c`.

### Codex on Windows

Codex uses TOML, not the JSON wrapper above. Its default user configuration is
`%USERPROFILE%\.codex\config.toml` (or the configured `CODEX_HOME` location).
Merge these tables into that file, preserving other settings and replacing the
example values with the generated entry. Single-quoted TOML paths keep Windows
backslashes literal. See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

```toml
[mcp_servers.lightstreamer-workbench]
command = 'C:\Tools\node\node.exe'
args = ['C:\work\lightstreamer-workbench-extension\agent\dist\cli.mjs', 'mcp', '--extension-id', 'YOUR_ACTUAL_EXTENSION_ID', '--auth', 'off', '--port', '24817']
```

Restart/reconnect the MCP server in your client after saving. With Codex CLI,
`codex mcp list` checks registration; an actual Workbench tool call verifies the
running connection. Preserve your client's normal tool-approval policy.

The MCP process must be a **Windows process on Chrome's host**. Use a local
Windows agent configuration for this guide. A Linux Node process in WSL, a
container or a remote host is not this setup; do not solve that mismatch by
opening the broker to the LAN or disabling Origin checks.

## 4. Add the agent skill

The source skill is `.agents\skills\lightstreamer-workbench`. The prebuilt
package carries the same folder under `skills\lightstreamer-workbench`.
Copy the entire folder, including `references`, into the skill location your
agent supports. Inspect an existing same-named skill before replacing it.

For Codex, use your target application's repository-local
`.agents\skills\lightstreamer-workbench`, or your user-level
`%USERPROFILE%\.agents\skills\lightstreamer-workbench` for multiple projects.
If you are already working inside the Workbench source repo, its local skill is
present. Restart Codex if the skill does not appear. These locations follow the
[Codex skill discovery documentation](https://learn.chatgpt.com/docs/build-skills).

The skill teaches target selection, bounded Evidence queries, deliberate Local
Injection, Scenarios, timeout recovery and separate browser verification. It does
not configure MCP, grant browser permissions or approve a connection for you.

## 5. Open Workbench

1. Open the application tab you intend to inspect. Open Chrome DevTools and
   select **Lightstreamer Workbench**. Reload the app if it created its
   Lightstreamer clients before instrumentation became available.
2. No extension setup click is needed. **Agent access On** appears beside View
   in the header. It means access is enabled, not that an agent is connected.
   Workbench waits for the companion and reconnects automatically with backoff
   capped at 15 seconds. Start order does not matter.
3. Ask your agent to call `list_panel_sessions` and `get_status` to identify
   your exact tab. A matching session with `permission: "local"` confirms both
   inspection and Local Injection are available.

Connecting shares that panel's selected grant with local clients. Authentication
off does not identify agents or the companion: another local process could use
the grant or impersonate the companion. Loopback and extension-Origin checks
still block remote connections and ordinary websites, but are not local-process
authentication. Each panel has its own grant; toggle **Agent access On** to **Off**
to revoke it and stop reconnecting. Closing the panel also ends access. A new
panel uses the defaults. Connection retries never replay an injection or resume
a Scenario. Setup help is under **More actions → Agent setup instructions**;
its collapsed **Advanced connection settings** offers optional read-only access,
authentication and custom ports. These options last for the current Panel Session.

## 6. Inspect and reproduce

Start read-only:

> Use the lightstreamer-workbench skill to identify my inspected tab, report its
> Capture/Coverage and retention limits, and inspect the recent COMMAND updates
> for the subscription I select. Do not inject anything yet.

No permission toggle is needed to reproduce. Give a bounded experiment, for example:

> On this local test app, use the selected COMMAND subscription's real schema
> to prepare an ADD followed by UPDATE for a test key. Show the target and changed
> values, run each once, and verify the displayed row in the same application tab.

Keep Workbench visible while running Scenarios. Local Injection invokes the
application's Subscription listeners; those listeners may cause application
effects. It does not inject updates into Lightstreamer Server. Browser tools
must separately observe the same tab to verify the app's response. Without that
connection, the agent can report local delivery but not a verified DOM change.
Server Injection and arbitrary page evaluation are not exposed by these MCP tools.

Requested Evidence can reach your agent's model provider. Recognized credentials
and Client Message bodies are omitted, but arbitrary Item Update fields may still
contain private data. Use data you are authorized to share.

## Switch an existing setup to auth off

An existing MCP entry containing `LSEW_AGENT_CONNECTION` remains authenticated;
upgrading does not silently discard an explicit credential. To switch:

1. Disconnect Workbench panels and stop only the matching Workbench MCP servers
   in your agent clients. Allow 30 seconds with no connections for the old broker
   to exit before starting the new configuration.
2. Update/rebuild the extension and companion together. Run `setup` again
   without `--auth required`, using the exact extension ID.
3. Replace only the Workbench MCP entry with the new command and arguments.
   Remove its old `LSEW_AGENT_CONNECTION` environment setting, including the
   old `[mcp_servers.lightstreamer-workbench.env]` TOML table if that table
   contains only that setting. If you manually exported the same variable,
   clear it from the MCP process environment too.
4. Restart the MCP server, reload the updated extension and open Workbench.
   Default access starts automatically; no extension-side Connect step is needed.

The two modes cannot share one port. A mode mismatch fails instead of silently
downgrading authentication. You can use a different unused port for the new
configuration if the old broker is still in use.

## Optional: enable authentication

This is not required for the default setup. To opt in, disconnect panels and
stop matching clients, allow the old broker to exit, then generate configuration:

```powershell
$workbenchSetup = & $workbenchNode $workbenchCli setup --auth required --extension-id $workbenchExtensionId | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Authenticated setup failed.' }
$workbenchSetup | ConvertTo-Json -Depth 6
```

Preserve its generated `env.LSEW_AGENT_CONNECTION` in JSON clients. For Codex,
use the generated command/arguments (including `--auth required`) and add:

```toml
[mcp_servers.lightstreamer-workbench.env]
LSEW_AGENT_CONNECTION = 'COPY_THE_GENERATED_PRIVATE_VALUE_FROM_SETUP'
```

This long value is private: keep it out of Git, screenshots and chat. Each
authenticated setup invocation generates a new credential; reuse the existing
configuration for ordinary reconnects.

In **More actions → Agent setup instructions → Advanced connection settings**,
enable **Require authentication**, then **Apply connection settings**:

1. Ask the agent to show `get_pairing_requests`.
2. Compare its short code with Workbench's code and click **Approve connection**
   only if they match. Nothing is typed. The agent must not click for you.
3. The agent calls `confirm_pairing` with that exact approved request ID and
   code, then discovers the panel. No Evidence is shared before both steps.

Requests expire after two minutes. Cancelled, expired or mismatched requests need
a fresh connection and comparison. Toggle access On again or apply settings;
authenticated connections do not retry approval automatically. A new panel uses
the default mode, so apply the authenticated option again. A required-auth broker
rejects default auth-off connections rather than downgrading. Credential possession plus local access can
use a connected panel's grant; this still is not individual-agent identity.

## Troubleshooting

| Symptom | Check / recovery |
| --- | --- |
| `node.exe` not found or startup fails | Verify the absolute executable and `cli.mjs` paths. The Node ZIP may contain an extra directory. Check `--version` and companion `--help` independently. |
| PowerShell blocks `npm.ps1` | Use the explicit `npm.cmd` commands above. No execution-policy change is required. |
| No Agent access header switch | Load/reload a matching extension build, select its DevTools panel and confirm its ID. Older Store builds may not have the feature. |
| Agent access is On but no session is listed | On means enabled. Confirm the MCP server is started with Windows Node on this host. Match the extension ID, port and authentication mode; allow up to 15 seconds for the next retry. Default mode has no environment entry or comparison code. |
| Authentication error after changing modes | Follow the migration steps above. An old broker may still occupy the port. Do not kill an unrelated process. |
| Port 24817 is occupied | Use `setup --port 24818 --extension-id ...`, update the MCP entry and apply the same port in Workbench's **Advanced connection settings**. |
| `get_pairing_requests` is empty | Expected with authentication off. Use `list_panel_sessions` instead. In optional authenticated mode, connect in Workbench and check expiry, ID and port. |
| Waiting for agent / No access yet | Optional authenticated mode only: ask the agent to confirm the exact approved request and matching code. If expired, reconnect and compare again. |
| `list_panel_sessions` is empty | Open Workbench for the intended tab and keep access On. Default discovery is automatic. Only authenticated mode needs code approval. Merely installing the extension without opening a Workbench panel does not create a Panel Session. |
| Local Injection is refused | Confirm access is On, the current page/target, valid Draft and absence of conflicting human edits. If you selected read-only access in advanced settings, restore **Inspect and inject locally** and apply settings. |
| A Scenario pauses or a call times out | Keep the panel visible and inspect its original operation/Run trace. A lost reply does not prove non-delivery; do not repeat with a new request ID automatically. |
| Organization security software blocks loopback | Follow your organization's policy for this local process. Do not disable the firewall, add a public listener or bypass endpoint protection. |

Read-only port check in PowerShell:

```powershell
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 24817 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

A listener proves only that something occupies the port, not that it is the
Workbench companion. `doctor` and `install` are for the optional
macOS/Linux native host and are not Windows setup or repair commands.

## Reconnect, update and remove

Keep the same MCP configuration for normal reconnects. Closing/reloading a panel
ends its Panel Session and temporary operation ledger; reconnecting cannot prove
what an old unknown Injection did. Reopening requires clicking Connect again.

Before an update, disconnect panels and stop matching MCP clients. Update the
companion and extension together, preserve their configured paths (or update the
MCP entry), reload the extension and reconnect. Optional authenticated mode uses
`setup --auth required` to rotate its credential after the old broker exits.

To remove agent access, disconnect panels, remove its MCP entry and stop its
matching clients. The broker exits after 30 seconds with no connections. Remove
only the companion directory and skill copy you installed if no longer needed;
there is no native-host/registry/service cleanup. Node may be shared with other
tools, so leave it in place unless you independently intend to remove it.
