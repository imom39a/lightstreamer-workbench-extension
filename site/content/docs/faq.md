## Which clients does Workbench support?

The official Lightstreamer Web Client. Workbench is not a generic WebSocket inspector. It observes the page's clients without connecting or subscribing for the application.

## Which browsers does Workbench support?

Chrome and desktop Firefox 140+ on Windows, macOS, and Linux. Firefox 2.0.9 is the first release candidate and private browsing is disabled. See [Release notes]({{site}}releases/) for actual store availability. Safari is not supported yet.

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

Yes. The 2.0.9 extension and matching 0.1.8 companion support inspection, Local Injection and Scenarios, and Server Injection after a person reviews and approves the exact Client Message in the panel. Follow [MCP setup]({{site}}docs/agent-access/) and check the release availability there.

## What do I need to install?

For browser inspection, install the extension for your browser. For agent access, also use the npm companion, Node.js 22.12 or later with npm, and an agent app that supports local stdio MCP. Add the setup command's printed entry to that app's MCP settings once. The app starts the companion.

The extension and npm package are ready to use. A repository checkout, compilation, Docker, and a separate Workbench server are not required. The included agent skill is optional.

## Is this an official Lightstreamer product?

No. This independent, [open-source project]({{github}}) uses the Apache-2.0 license.
