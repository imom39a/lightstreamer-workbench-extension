# Connection

The Workbench extension must be loaded and the standalone Node companion
configured as an MCP stdio server. The installer-free path supports Windows,
macOS and Linux with Node 22.12+. Companion `setup` prints MCP configuration
without changing files or the registry. Authentication is off by default; there
is no credential, code comparison or approval handshake. Any local process can
use a connected panel's grant or impersonate the companion. Authentication is
optional, not a prerequisite for investigating an explicitly connected panel.
The companion and Chrome must run on the same host; WSL/containers/remote agents
need a host-side process and are not implicitly the same loopback connection.
For Windows setup or recovery, use the companion package's `WINDOWS.md`
(`agent/WINDOWS.md` in the source repo). It includes PowerShell commands, Windows
path quoting and MCP/Codex configuration. Setup is separate from approval.
An optional **Installed native host** path remains for macOS/Linux; only that
path uses `install`, `doctor` and `mcp --transport native`. Discover commands with
the companion's `--help`.
Do not install or change agent-wide configuration merely to answer a diagnostic question.

In the inspected tab's DevTools, open Lightstreamer Workbench, then **More actions →
Agent access**. The user chooses **Inspect Evidence** or **Inspect and inject locally**
and clicks **Connect agent**. In the default mode, call `list_panel_sessions`
and identify the intended tab. An empty list means no panel is connected, not
that the app lacks Lightstreamer. Check the running MCP server, extension ID,
port and selected authentication mode. Do not open a separate profile and claim
it is the original session.

## Optional authenticated mode

Use this branch only when the MCP configuration requires authentication and the
panel has **Require authentication** enabled under **Connection options**.
The private `LSEW_AGENT_CONNECTION` value stays out of reports, screenshots and
chat. It is not the short comparison code. For a pending authenticated connection:

1. Call `get_pairing_requests`. Show the user the short code and ask them to
   compare it with Workbench, then click **Approve connection** there. Never
   click that approval through browser tools or ask them to enter/paste a code.
2. If several requests exist, show their codes and resolve which is intended;
   do not choose the newest automatically. Wait for the user's approval. Recheck
   the intended request; `panelApproved` must be true and it must not be expired.
3. Call `confirm_pairing` with that exact `requestId` and `code`, then discover
   `list_panel_sessions` and identify the inspected page. A short code alone is
   not a page identity. If expired or cancelled, have the user reconnect and
   compare the fresh code; never reuse an earlier approval for a new request.

No Evidence access is granted before both approvals in this mode. Default
standalone and optional native connections do not use comparison codes.
Access is scoped to that Panel Session and resets when it closes.
The companion does not keep captured Evidence on disk. Requested data is still
shared with the agent and its model provider.

## Recovery and browser identity

Companion setup must name the actual extension id, including
unpacked builds. A busy port or failed pairing is not authorization to kill an
unrelated process or weaken origin/authentication checks. Correct the matching
configuration. Existing credential-bearing entries remain authenticated; switching
off is a deliberate configuration change, not error recovery. Follow the Windows
guide's migration steps only when requested. If setup uses a nondefault
port, use the same nonsecret port in Workbench's **Connection options**.

Browser automation is a separate connection. Confirm it controls the same page
and application state. If its identifiers cannot be mapped unambiguously to the
Workbench connection, resolve that uncertainty before a reproduction.

A remounted panel has a new Panel Session and empty history. Never reuse its old
execution tokens, cursors or mutation request ids. A disconnected or timed-out
execution can be unknown: reconnect to the same surviving Panel Session and query
the existing operation before deciding what happened.
