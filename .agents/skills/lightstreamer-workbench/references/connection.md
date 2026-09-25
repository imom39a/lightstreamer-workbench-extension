# Connection

The Workbench extension and local companion must both be installed. The companion
exposes standard MCP over stdio; Chrome connects through a registered native host.
It currently supports macOS and Linux. Discover the installed companion's commands
with `lightstreamer-workbench-agent --help`; use its `doctor` command for setup.
Do not install or change agent-wide configuration merely to answer a diagnostic question.

In the inspected tab's DevTools, open Lightstreamer Workbench, then **More actions →
Agent access**. The user chooses **Inspect Evidence** or **Inspect and inject locally**
and connects. Access is scoped to that Panel Session and resets when it closes.
The companion does not keep captured Evidence on disk. Requested data is still
shared with the agent and its model provider.

An empty `list_panel_sessions` means no panel has connected. It does not prove
that the app lacks Lightstreamer. Check the native host installation and panel
permission rather than opening a separate browser profile and claiming it is the
original session. The host registration must match the actual installed extension
id, including unpacked builds.

Browser automation is a separate connection. Confirm it controls the same page
and application state. If its identifiers cannot be mapped unambiguously to the
Workbench connection, resolve that uncertainty before a reproduction.

A remounted panel has a new Panel Session and empty history. Never reuse its old
execution tokens, cursors or mutation request ids. A disconnected or timed-out
execution can be unknown: reconnect to the same surviving Panel Session and query
the existing operation before deciding what happened.
