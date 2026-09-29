## MCP companion — 0.1.2 candidate

Version 0.1.0 was first published on September 28, 2026, then unpublished on September 29. The npm package is currently unavailable. Version 0.1.2 passed Windows, macOS, and Linux checks and is available as a [public GitHub release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.2). It includes the agent skill. The Chrome extension is released separately.

- Find Subscriptions and items with Scope search.
- Count records and distinct keys before reading examples.
- Select fields and limit response size.
- Validate and run Local Injections or Scenarios.

Follow [MCP setup]({{site}}docs/agent-access/) to connect a matching local build. The companion does not install or update the Chrome extension.

## Extension 2.0.5 — MCP support

This update adds Agent access and the version-2 read contract. Version 2.0.5 was submitted to the Chrome Web Store on September 29, 2026 and is pending review. It is set to publish publicly after approval; 2.0.4 remains public until then.

For the matching unpacked build, download `workbench-mcp-release-bundle` from a successful main-branch [Agent companion workflow run](https://github.com/imom39a/lightstreamer-workbench-extension/actions/workflows/agent-companion.yml). The bundle contains the extension, companion, and a manifest that identifies the source commit. See the [bundle instructions](https://github.com/imom39a/lightstreamer-workbench-extension/tree/main/agent) for installation.

## Extension 2.0.4

- Shows complete keys and readable JSON in the Evidence stream.
- Adds capture reliability and memory fallback improvements.
- Uses Off / Include / Exclude filter controls.
- Supports dark mode and forced colors.

## Extension 2.0.3

- Captures outbound Client Messages and their outcomes.
- Adds reviewed Server Injection.
- Adds optional usage analytics. See [Privacy]({{site}}privacy/) for data and controls.

## Extension 2.0.2

- Adds Local Injection Scenarios and Checkpoints.
- Adds Notifications for conditions and diagnostics.
- Improves Scope and Context.

## Extension 2.0.0

Introduces the shared Scope, Evidence, and Context workspace, Local Injection Drafts, and scoped exports.

Check `chrome://extensions` for your installed version. The [Chrome Web Store listing]({{store}}) shows the available Store release.
