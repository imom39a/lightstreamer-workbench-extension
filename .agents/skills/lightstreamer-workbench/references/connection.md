# Connection

The Workbench extension must be loaded and the standalone Node companion
configured as an MCP stdio server. The installer-free path supports Windows,
macOS and Linux with Node 22.12+. Companion `setup` prints MCP configuration
without changing files or the registry. Authentication is off by default; there
is no credential, code comparison or approval handshake. Any local process can
use a connected panel's grant or impersonate the companion. Authentication is
optional, not a prerequisite for investigating an open panel with access enabled.
The companion and Chrome must run on the same host; WSL/containers/remote agents
need a host-side process and are not implicitly the same loopback connection.
For Windows setup or recovery, use the companion package's `WINDOWS.md`
(`agent/WINDOWS.md` in the source repo). It includes PowerShell commands, Windows
path quoting and MCP/Codex configuration. Setup is separate from approval.
An optional **Installed native host** path remains for macOS/Linux; only that
path uses `install`, `doctor` and `mcp --transport native`. Discover commands with
the companion's `--help`.
Do not install or change agent-wide configuration merely to answer a diagnostic question.

Open Lightstreamer Workbench in the intended tab's DevTools. Inspection and Local
Injection are enabled automatically at port 24817; no Connect action is needed.
Call `list_panel_sessions` and identify the intended tab. The header's **Agent
access On/Off** switch expresses enabled access, not agent presence. An empty
list means no panel is connected, not that the app lacks Lightstreamer. Check
the running MCP server, extension ID, port and authentication mode. Startup order
does not matter: auth-off connections retry with backoff capped at 15 seconds.
If the user turned access Off, ask them to enable it; do not override that choice.
Setup guidance and optional settings are under **More actions → Agent setup
instructions**. Do not open a separate profile and claim it is the original session.

## Optional authenticated mode

Use this branch only when the MCP configuration requires authentication and the
panel has **Require authentication** enabled under **Advanced connection settings**
and **Apply connection settings** has been selected.
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
port, apply the same nonsecret port in Workbench's **Advanced connection settings**.

Browser automation is a separate connection. Confirm it controls the same page
and application state. If its identifiers cannot be mapped unambiguously to the
Workbench connection, resolve that uncertainty before a reproduction.

A remounted panel has a new Panel Session, default access and empty history. Never reuse its old
execution tokens, cursors or mutation request ids. A disconnected or timed-out
execution can be unknown: reconnect to the same surviving Panel Session and query
the existing operation before deciding what happened. Automatic reconnection
never replays an operation or resumes a Scenario. Technical Local Injection
access is not authorization to inject outside the user's requested task.
