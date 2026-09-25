# Windows: connect an agent to Lightstreamer Workbench

Use the standalone Node companion with Chrome on the **same Windows machine**.
No Workbench installer, native messaging registration, registry changes, Windows
service, administrator terminal, WebMCP flag or remote-debugging port is needed.
The companion is an MCP tool server; your existing coding agent supplies the model.

After one-time setup, the daily flow is **Connect → compare the displayed codes
→ Approve**. You never type or paste a code into Workbench.

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

You still need a matching extension build with **Agent access** in More actions.
The companion tarball does not contain the Chrome extension. An older Store
extension without that control cannot use it. Source availability does not
imply that this feature has been published to the Chrome Web Store or npm.

## 2. Generate your private MCP configuration

Copy the exact extension ID shown on its `chrome://extensions` card. Unpacked
builds may have a different ID from the Store extension.

```powershell
$workbenchExtensionId = 'REPLACE_WITH_THE_32_CHARACTER_EXTENSION_ID'
$workbenchSetup = & $workbenchNode $workbenchCli setup --extension-id $workbenchExtensionId | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Workbench setup failed; check the extension ID and paths.' }
```

This captures the generated configuration in memory. To view it privately:

```powershell
$workbenchSetup | ConvertTo-Json -Depth 6
```

`setup` prints configuration; it does not edit agent settings, write a credential
file or start a service. Run it once for this connection. Each new invocation
generates a different credential, so do not regenerate it during ordinary reconnects.

The long `LSEW_AGENT_CONNECTION` value is a **private machine credential**, not
the short comparison code. Keep it out of Git, shared screenshots, logs and chat.
Workbench never asks you to enter it. Keep the Node and companion files at their
configured paths, including after extracting an update.

## 3. Configure your agent

Choose **stdio/local command**, not HTTP, SSE or a WebSocket URL. The agent starts
`node.exe`; the companion starts its loopback broker automatically. Do not run
`mcp` manually in a second terminal—it expects the agent's protocol on stdin.

### Clients using JSON MCP settings

Merge the generated **`mcpServers` entry** into your client's existing settings,
preserving its other servers. Do not paste the outer `port` or `next` fields.
Some clients use a different root key; adapt the wrapper, preserving `command`,
`args` and `env`. A source-build example has this shape:

```json
{
  "mcpServers": {
    "lightstreamer-workbench": {
      "command": "C:\\Tools\\node\\node.exe",
      "args": [
        "C:\\work\\lightstreamer-workbench-extension\\agent\\dist\\cli.mjs",
        "mcp", "--extension-id", "YOUR_ACTUAL_EXTENSION_ID"
      ],
      "env": {
        "LSEW_AGENT_CONNECTION": "COPY_THE_GENERATED_PRIVATE_VALUE_FROM_SETUP"
      }
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
args = ['C:\work\lightstreamer-workbench-extension\agent\dist\cli.mjs', 'mcp', '--extension-id', 'YOUR_ACTUAL_EXTENSION_ID']

[mcp_servers.lightstreamer-workbench.env]
LSEW_AGENT_CONNECTION = 'COPY_THE_GENERATED_PRIVATE_VALUE_FROM_SETUP'
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

## 5. Connect and approve

1. Open the application tab you intend to inspect. Open Chrome DevTools and
   select **Lightstreamer Workbench**. Reload the app if it created its
   Lightstreamer clients before instrumentation became available.
2. Open **More actions → Agent access**. Keep **Standalone companion (no
   installation)** selected. Choose **Inspect Evidence** initially, or explicitly
   choose **Inspect and inject locally** when you intend to reproduce updates.
3. Click **Connect agent**. Workbench shows an eight-digit comparison code.
4. Ask your agent: “Use Lightstreamer Workbench. Show the pending connection code
   from `get_pairing_requests` and wait for my approval.”
5. Compare the entire code shown by the agent with the one in Workbench. Only
   when they match, click **Approve connection** in Workbench. Nothing is entered.
6. The agent reads the approved request and calls `confirm_pairing` with that
   exact request ID and code, then calls `list_panel_sessions` and `get_status`
   to identify your tab. **Connected · inspection only** or **Connected ·
   inspection and Local Injection allowed** is the completion signal.

No Evidence or inspected-page identity is shared before approval and confirmation
complete. A code expires after two minutes. If it expires, is cancelled or does
not match, start a fresh attempt and compare again. The agent must leave your
Approve click to you. The short display code is safe to show in this exchange;
it is not the long credential stored in MCP settings.

Several agents using the same private configuration can access a granted Panel
Session. The grant is not an individual-agent identity. Each panel has its own
grant, and **Disconnect agent** revokes that panel's access.

## 6. Inspect and reproduce

Start read-only:

> Use the lightstreamer-workbench skill to identify my inspected tab, report its
> Capture/Coverage and retention limits, and inspect the recent COMMAND updates
> for the subscription I select. Do not inject anything yet.

To reproduce, disconnect, select **Inspect and inject locally**, reconnect and
approve the fresh code. Then give a bounded experiment, for example:

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

## Troubleshooting

| Symptom | Check / recovery |
| --- | --- |
| `node.exe` not found or startup fails | Verify the absolute executable and `cli.mjs` paths. The Node ZIP may contain an extra directory. Check `--version` and companion `--help` independently. |
| PowerShell blocks `npm.ps1` | Use the explicit `npm.cmd` commands above. No execution-policy change is required. |
| No Agent access control | Load/reload a matching extension build, select its DevTools panel and confirm its ID. Older Store builds may not have the feature. |
| Companion unavailable / no code | Confirm the MCP server is started, uses Windows Node on this host and has the generated environment entry. Confirm the exact extension ID and port. |
| Identity/authentication failure after running setup again | A previous broker may still use the old credential. Disconnect panels and stop matching MCP clients, wait at least 30 seconds for the idle broker to exit, then restart using one matching configuration. Do not kill an unrelated process. |
| Port 24817 is occupied | Choose another unused port with `setup --port 24818 --extension-id ...`, update the MCP configuration, and set the same port under Workbench's **Connection options**. Regenerating setup also rotates the private credential. |
| `get_pairing_requests` is empty | Click Connect in the intended panel while the MCP server is running. Check that the request has not expired and the extension ID/port match. No active request does not prove the app lacks Lightstreamer. |
| Waiting for agent / No access yet | Ask the agent to re-read pending requests and confirm the exact approved request and matching code. If expired, reconnect and compare the new code. |
| `list_panel_sessions` is empty | Finish both approval steps. An installed/configured MCP server alone does not grant access. Keep the intended DevTools panel open. |
| Local Injection is refused | Confirm the panel's Local Injection grant, current page/target, valid Draft and absence of conflicting human edits. Reconnect with the intended grant if necessary. |
| A Scenario pauses or a call times out | Keep the panel visible and inspect its original operation/Run trace. A lost reply does not prove non-delivery; do not repeat with a new request ID automatically. |
| Organization security software blocks loopback | Follow your organization's policy for this local process. Do not disable the firewall, add a public listener or bypass endpoint protection. |

Read-only port check in PowerShell:

```powershell
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 24817 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

A listener proves only that something occupies the port, not that it is the
authenticated Workbench companion. `doctor` and `install` are for the optional
macOS/Linux native host and are not Windows setup or repair commands.

## Reconnect, update and remove

Keep the same MCP configuration for normal reconnects. Closing/reloading a panel
ends its Panel Session and temporary operation ledger; reconnecting cannot prove
what an old unknown Injection did. Reopening requires fresh approval.

Before an update, disconnect panels and stop matching MCP clients. Update the
companion and extension together, preserve their configured paths (or update the
MCP entry), reload the extension and reconnect. To rotate credentials, wait for
the old broker to exit, run setup and replace the private MCP entry.

To remove agent access, disconnect panels, remove its MCP entry and stop its
matching clients. The broker exits after 30 seconds with no connections. Remove
only the companion directory and skill copy you installed if no longer needed;
there is no native-host/registry/service cleanup. Node may be shared with other
tools, so leave it in place unless you independently intend to remove it.
