# Connection

The Workbench extension must be loaded and the standalone Node companion
configured as an MCP stdio server. The installer-free path supports Windows,
macOS and Linux with Node 22.12+. Companion `setup` prints MCP configuration
without changing files or the registry. Authentication is off by default; there
is no credential, code comparison or approval handshake. Any local process can
use a connected panel's grant or impersonate the companion. Connected panels
allow inspection and Local Injection together. The underlying
authentication and read-only code is retained, but these controls are not exposed
by the current panel.
The companion and Chrome must run on the same host; WSL/containers/remote agents
need a host-side process and are not implicitly the same loopback connection.
Use the npm package `lightstreamer-workbench-agent` on every platform. Its
`setup` command prints version-pinned npm configuration; `setup --local` prints
absolute Node/package paths for an already installed artifact. The common guide
is `README.md` in the package (`agent/README.md` in source); Windows launcher
troubleshooting is in `WINDOWS.md`. Native transport and its installer are removed.
Old entries with `--transport native` must be replaced through the guide's migration.
Do not install or change agent-wide configuration merely to answer a diagnostic question.

Open Lightstreamer Workbench in the intended tab's DevTools. Inspection and Local
Injection are enabled automatically at port 24817; no Connect action is needed.
The configured MCP client launches the npm companion automatically; a separate
terminal or manually hosted broker is unnecessary. Call `list_panel_sessions`
and identify the intended tab. **Agent access Waiting** means enabled but not
ready, **On** means the companion connection has granted access, and **Off**
means disabled. On is not evidence of an agent actively using the panel.
An empty list means no panel is connected, not that the app lacks Lightstreamer.
For Waiting, start/reconnect the configured MCP server in the agent app; if it
is already running, check the extension ID, port and authentication mode. Startup order
does not matter: auth-off connections retry with backoff capped at 15 seconds.
If the user turned access Off, ask them to enable it; do not override that choice.
Setup guidance is under **More actions → Agent setup
instructions**. Do not open a separate profile and claim it is the original session.

## Access boundary

The current panel uses authentication off and port 24817. It has no pairing,
permission selector or advanced connection form. Existing credential-bearing or
custom-port MCP entries need deliberate migration through the common guide;
never weaken or rewrite agent configuration just to answer a diagnostic question.
Access is scoped to that Panel Session and resets when it closes.
The companion does not keep captured Evidence on disk. Requested data is still
shared with the agent and its model provider.

## Recovery and browser identity

Companion setup must name the actual extension id, including
unpacked builds. A busy port is not authorization to kill an unrelated process. Correct the
matching configuration through the common guide when authorized. Existing
credential-bearing entries remain authenticated; they are never silently downgraded.

Browser automation is a separate connection. Confirm it controls the same page
and application state. If its identifiers cannot be mapped unambiguously to the
Workbench connection, resolve that uncertainty before a reproduction.

A remounted panel has a new Panel Session, default access and empty history. Never reuse its old
execution tokens, cursors or mutation request ids. A disconnected or timed-out
execution can be unknown: reconnect to the same surviving Panel Session and query
the existing operation before deciding what happened. Automatic reconnection
never replays an operation or resumes a Scenario. Technical Local Injection
access is not authorization to inject outside the user's requested task.
