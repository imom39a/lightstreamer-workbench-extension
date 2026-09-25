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

`setup` only prints a private MCP entry with absolute Node
and companion paths. It does not write files, edit agent settings, install a
service, register a native host, or change the registry. Default setup targets
the official store extension id; an older store build without Agent access
cannot use the companion.

1. Copy the printed MCP entry into your agent client's settings, adapting to its
   configuration format. Preserve the private `LSEW_AGENT_CONNECTION` environment value.
2. Start or reconnect that MCP server in your agent. It starts a private local
   broker automatically; no extra terminal or background service installation
   is needed. Multiple agent processes with the same configuration share it.
3. Open Workbench in the inspected tab, then **More actions → Agent access**.
   Select **Standalone companion (no installation)**.
4. Choose inspection or inspection plus Local Injection, then **Connect agent**.
   Workbench displays a short comparison code. Nothing is typed or pasted.
5. Ask your agent to show its pending connection code (`get_pairing_requests`).
   Compare the two codes and click **Approve connection** only if they match.
   The agent confirms that exact request with `confirm_pairing`; it can then
   call `list_panel_sessions`. Codes expire after two minutes. **Cancel connection**
   discards an attempt without granting access.

The displayed comparison code is temporary and safe to show your agent; it is
not the private credential in MCP settings. Keep that configuration private:
anyone with its credential and local access can use an approved panel's grant.
Workbench never asks for or stores that credential. Browser and companion must run on the same host. A remote
MCP process, container or WSL environment is not automatically the Windows host;
use Windows Node for Windows Chrome. Remote listening is intentionally unsupported.

The default port is 24817. For an occupied port, generate configuration with
`setup --port 24818 --extension-id YOUR_ACTUAL_EXTENSION_ID`, update the MCP entry,
and set that port under **Connection options** in Workbench.
Authentication fails closed if another companion uses a different credential on that
port. Keep the companion and Node at their configured paths or update the MCP
entry after moving them.

## Grants and connection lifecycle

Permissions are temporary and owned by the exact Panel Session. Inspection is
the default; Local Injection is a separate choice. Disconnect revokes access
and pauses an agent Scenario, but an already sent update can still settle.
Closing or reloading the panel loses its temporary operation ledger. Reconnect
to the same surviving panel and inspect outstanding operations before another
experiment; an unknown old request does not establish non-delivery.

The broker binds only `127.0.0.1`, validates the exact extension origin and Host,
and rejects ordinary website origins. Agent connections use mutual, role-bound
HMAC challenges with a generated 256-bit credential. Panel connections use fresh
committed ECDH keys to derive a comparison code bound to that connection. Both
human approval in Workbench and authenticated agent confirmation are required
before page identity or Evidence can be shared. The private MCP credential is
never put into a URL or sent over the socket. Local WebSocket data is not
encrypted. No captured Evidence or credential file is persisted
by the portable companion. The broker exits 30 seconds after all connections close.

To rotate the MCP credential, disconnect panels and stop all matching MCP clients,
allow the broker to exit, then run setup and replace the MCP configuration. To remove portable
access, disconnect panels and remove the MCP configuration entry; no host or
registry cleanup is needed. Delete only your extracted companion package if it
is no longer wanted.

## Agent skill and tool contract

Install the bundled `skills/lightstreamer-workbench` directory into your agent's
skill directory. Source: `.agents/skills/lightstreamer-workbench` in the repository.
`npm pack ./agent` packages the built companion and skill.

For a pending connection, use `get_pairing_requests`, show its comparison code,
wait for the user's Workbench approval, then `confirm_pairing` that request id
and code. Do not automate the user's approval. Once connected, start with
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
MCP configuration without `LSEW_AGENT_CONNECTION`. Chrome for Testing requires
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
code comparison, approval, discovery, retained Evidence queries, exact inspected-page identity and revocation
through a real loaded Chrome DevTools panel. It requires the cached Chrome for
Testing browser, but no Docker or native host registration; Windows/Linux CI runs
this path.

`npm run agent:test:browser` additionally exercises the official Lightstreamer
client: read-only denial, Local Injection, ordered Scenario Steps, duplicate
suppression and the app's displayed response. Fixture prerequisites are in the
[contributor guide](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/CONTRIBUTING.md).
On macOS/Linux, `LSEW_AGENT_BROWSER_TRANSPORT=native` selects the optional native
proof, whose registration is confined to the disposable test Chrome profile.
