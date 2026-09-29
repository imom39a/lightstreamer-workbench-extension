## MCP companion 0.1.0 — published

The [npm package](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.0) was first published on September 28, 2026. It supports macOS, Windows, and Linux and includes the agent skill. Use the [MCP setup guide]({{site}}docs/agent-access/) for the current package. The Chrome extension is released separately.

- Find Subscriptions and items with Scope search.
- Count records and distinct keys before reading examples.
- Select fields and limit response size.
- Validate and run Local Injections or Scenarios.

Follow [MCP setup]({{site}}docs/agent-access/) to connect. The npm package does not install or update the Chrome extension.

## Extension 2.0.5 — MCP support

This build adds Agent access and the version-2 read contract. Chrome Web Store publication is separate from npm publication.

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
