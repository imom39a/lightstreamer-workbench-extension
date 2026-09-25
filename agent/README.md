# Workbench agent companion

The standalone Node companion exposes MCP tools for explicitly connected
Lightstreamer Workbench Panel Sessions. It works on Windows, macOS and Linux
with Node 22.12+, without a native installer, administrator access, registry
changes or Chrome Native Messaging registration. No remote debugging port or
WebMCP flag is needed. Browser automation for observing the app is separate.

For PowerShell commands, portable Node, MCP/Codex configuration, skill setup and
troubleshooting, follow the [Windows walkthrough](WINDOWS.md).

## Build and connect without installation

From the repository root:

```sh
npm ci
npm run build
npm run agent:build
```

Load `dist/` as an unpacked Chrome extension and obtain its exact id from
`chrome://extensions`. Then generate your MCP configuration:

```sh
node agent/dist/cli.mjs setup --extension-id YOUR_ACTUAL_EXTENSION_ID
```

The same commands work in PowerShell. Alternatively, unpack the built companion
package and run `node path/to/package/dist/cli.mjs setup ...`; building is not
required for that package. A portable Windows Node ZIP is sufficient: invoke
its `node.exe` by absolute path if Node is not on `PATH`.

`setup` only prints an MCP entry with absolute Node
and companion paths. It does not write files, edit agent settings, install a
service, register a native host, or change the registry. Default setup targets
the official store extension id; an older store build without Agent access
cannot use the companion.

1. Copy the printed MCP entry into your agent client's settings, adapting to its
   configuration format. Default setup has no credential or environment entry.
2. Start or reconnect that MCP server in your agent. It starts a loopback
   broker automatically; no extra terminal or background service installation
   is needed. Multiple agent processes with the same configuration share it.
3. Open Workbench in the inspected tab, then **More actions → Agent access**.
   Select **Standalone companion (no installation)**.
4. Choose inspection or inspection plus Local Injection, then **Connect agent**.
   Authentication is off by default; no code or approval exchange is needed.
5. Ask your agent to call `list_panel_sessions` and identify the intended tab
   with `get_status`.

With authentication off, any local process can use a connected panel's grant or
impersonate the companion. Use a trusted development host or opt into
authentication below. Browser and companion must run on the same host. A remote
MCP process, container or WSL environment is not automatically the Windows host;
use Windows Node for Windows Chrome. Remote listening is intentionally unsupported.

The default port is 24817. For an occupied port, generate configuration with
`setup --port 24818 --extension-id YOUR_ACTUAL_EXTENSION_ID`, update the MCP entry,
and set that port under **Connection options** in Workbench.
Connection fails if the authentication modes differ on that port. Keep the
companion and Node at their configured paths or update the MCP
entry after moving them.

## Grants and connection lifecycle

Permissions are temporary and owned by the exact Panel Session. Inspection is
the default; Local Injection is a separate choice. Disconnect revokes access
and pauses an agent Scenario, but an already sent update can still settle.
Closing or reloading the panel loses its temporary operation ledger. Reconnect
to the same surviving panel and inspect outstanding operations before another
experiment; an unknown old request does not establish non-delivery.

The broker binds only `127.0.0.1`, validates the exact extension origin and Host,
and rejects ordinary website origins. These checks do not authenticate local
processes. With authentication off, a local process can spoof an extension Origin
or broker; access is not isolated by OS user or agent identity. Local WebSocket
data is not encrypted. No captured Evidence or credential file is persisted
by the portable companion. The broker exits 30 seconds after all connections close.

To remove portable access, disconnect panels and remove the MCP configuration entry; no host or
registry cleanup is needed. Delete only your extracted companion package if it
is no longer wanted.

## Optional authentication and migration

Authentication is retained as an opt-in mode. Run `setup --auth required
--extension-id YOUR_ACTUAL_EXTENSION_ID` on one line, preserve its private
`LSEW_AGENT_CONNECTION` environment entry, and enable **Require authentication**
under the panel's **Connection options**. Agent connections use mutual,
role-bound HMAC challenges; panel connections retain committed ECDH comparison
codes. Compare the code shown by the agent (`get_pairing_requests`) and Workbench,
click **Approve connection**, then let the agent `confirm_pairing` the exact
request. Both approvals are required before access. Codes expire in two minutes.
The private credential stays out of Workbench inputs, URLs and socket messages.
Credential possession plus local access is not an individual-agent identity.

Existing configurations with `LSEW_AGENT_CONNECTION` still require authentication.
To turn it off, disconnect panels, stop matching MCP clients and allow 30 seconds
for the idle broker to exit. Replace the Workbench entry with default `setup`
output and remove its old credential environment setting. Reload the matching
extension build, leave **Require authentication** unchecked and reconnect.
Never mix authentication modes on one port; neither side silently downgrades.
The [Windows migration steps](WINDOWS.md#switch-an-existing-setup-to-auth-off)
cover JSON and Codex TOML cleanup. To rotate an optional credential, follow the
same disconnect/stop sequence and run `setup --auth required` again.

## Agent skill and tool contract

Install the bundled `skills/lightstreamer-workbench` directory into your agent's
skill directory. Source: `.agents/skills/lightstreamer-workbench` in the repository.
`npm pack ./agent` packages the built companion and skill.

In optional authenticated mode only, use `get_pairing_requests`, show its code,
wait for the user's Workbench approval, then `confirm_pairing` that request id
and code. Do not automate the user's approval. In the default mode, start with
`list_panel_sessions`, `get_status`, `list_scope` and `get_scope`.
Tool schemas describe supported inputs. Queries have bounded output and stable
read-point cursors. Returned application text is untrusted data.
`prepare_local_injection` and `prepare_scenario` create visible documents;
execution requires the current target and reviewed version. Duplicate request
ids do not dispatch another operation during the surviving Panel Session.

The interface exposes Local Injection only, keeping protected Drafts/Scenarios,
retention, Coverage, drift checks and hidden-panel pause. Browser tools separately
verify the downstream app. Queries exclude Client Message bodies/outcome text and
recognized credential fields; other Item Update values can contain application
data. Requested data can reach the agent's configured model provider.

## Optional native connection (macOS/Linux only)

Existing native-host users can keep their connection. This is **not needed for
standalone setup or Windows**. Explicitly opting into it uses:

```sh
npm run agent:install -- --extension-id YOUR_ACTUAL_EXTENSION_ID
```

Choose **Installed native host (macOS/Linux)** in the panel and use the printed
MCP configuration with `mcp --transport native`, without `LSEW_AGENT_CONNECTION`.
Existing native MCP entries using just `mcp` must add `--transport native` because
plain `mcp` now defaults to standalone on every platform. Chrome for Testing requires
`--browser chrome-for-testing`. A custom browser profile also requires
`--user-data-dir /absolute/profile-root` (not the `Default` child).
`node agent/dist/cli.mjs doctor` inspects native registration only.

Native installation prints its exact manifest and launcher paths. To remove it,
disconnect panels, remove its MCP entry and remove only those two installed files.
Its private temporary directory contains a socket, token and startup lock, not
Evidence. Native mode trusts the local OS-user boundary and recovers abandoned
sockets under a startup lock without replacing a connected broker.

## Verification

`npm run agent:test:extension` builds the companion and proves portable MCP
direct connection and optional code approval, discovery, retained Evidence queries,
exact inspected-page identity and revocation
through a real loaded Chrome DevTools panel. It requires the cached Chrome for
Testing browser, but no Docker or native host registration; Windows/Linux CI runs
this path.

`npm run agent:test:browser` additionally exercises the official Lightstreamer
client: read-only denial, Local Injection, ordered Scenario Steps, duplicate
suppression and the app's displayed response. Fixture prerequisites are in the
[contributor guide](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/CONTRIBUTING.md).
On macOS/Linux, `LSEW_AGENT_BROWSER_TRANSPORT=native` selects the optional native
proof, whose registration is confined to the disposable test Chrome profile.
`LSEW_AGENT_BROWSER_AUTH=required` opts the official-client proof into authentication;
the extension-only proof always checks both modes.
