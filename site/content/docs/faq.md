## Which clients does Workbench support?

The official Lightstreamer Web Client. Workbench is not a generic WebSocket inspector. It observes the page's clients without connecting or subscribing for the application.

## Does Local Injection reach the server?

No. It delivers an Item Update locally. Application listeners can still trigger other actions. See [Local Injection]({{site}}docs/local-injection/).

## What does Server Injection send?

One reviewed Client Message through the page-owned client. It does not create an inbound Server Update. See [Server Injection]({{site}}docs/server-injection/).

## Does Workbench show the server COMMAND state?

No. It shows captured operations and diagnostics. Derived state supports validation and Scenarios but is not direct access to server state.

## Can captured data leave the browser?

Yes. Agent access can share requested Evidence with your model provider. You can also create exports. Usage analytics excludes captured data. See [Export and privacy]({{site}}docs/export-and-privacy/).

## How long is Evidence retained?

Only within the current Panel Session. Rolling limits remove the oldest Evidence while Capture continues. See [retained history]({{site}}docs/evidence/#retained-history) for capacity and cleanup details.

## Can an MCP agent use Workbench?

Yes. The published companion supports inspection and Local Injection. Follow [MCP setup]({{site}}docs/agent-access/).

## What do I need to install?

For browser inspection, install the Chrome extension. For agent access, also use the npm companion, Node.js 22.12 or later with npm, and an agent app that supports local stdio MCP. Add the setup command's printed entry to that app's MCP settings once. The app starts the companion.

The extension and npm package are ready to use. A repository checkout, compilation, Docker, and a separate Workbench server are not required. The included agent skill is optional.

## Is this an official Lightstreamer product?

No. This independent, [open-source project]({{github}}) uses the Apache-2.0 license.
