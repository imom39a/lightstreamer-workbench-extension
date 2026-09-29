# Lightstreamer Workbench

A Chrome DevTools extension for applications that use the official Lightstreamer Web Client.

Inspect clients, Sessions, Subscriptions, Item Updates, snapshots, COMMAND keys, and outbound Client Messages. Test updates with Local Injection or send reviewed Client Messages with Server Injection.

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf) · [Get started](https://imom39a.github.io/lightstreamer-workbench-extension/docs/getting-started/) · [MCP setup](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/) · [Support](https://imom39a.github.io/lightstreamer-workbench-extension/support/)

## Use Workbench

- [Inspect activity](https://imom39a.github.io/lightstreamer-workbench-extension/docs/developer-guide/) with Scope, Ordered Evidence, and Context.
- [Trace COMMAND lifecycles](https://imom39a.github.io/lightstreamer-workbench-extension/docs/command-state/) for ADD, UPDATE, and DELETE.
- [Test Local Injections and Scenarios](https://imom39a.github.io/lightstreamer-workbench-extension/docs/local-injection/) without a server change.
- [Send a Client Message](https://imom39a.github.io/lightstreamer-workbench-extension/docs/server-injection/) through the inspected client's current Session.
- [Export Evidence](https://imom39a.github.io/lightstreamer-workbench-extension/docs/export-and-privacy/) as JSON or offline HTML.

Capture is observational. Workbench does not create clients or subscribe for the application. It is not a generic WebSocket inspector.

## Agent access

The MCP companion supports macOS, Windows, and Linux. It is temporarily unavailable on npm after a September 29, 2026 unpublish; a tested 0.1.2 candidate is in the [Agent companion workflow bundle](https://github.com/imom39a/lightstreamer-workbench-extension/actions/workflows/agent-companion.yml). Your agent app starts it. No hosted service or native installer is needed.

Follow the [shared MCP setup guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/).
Use the [read contract](agent/READS.md) for scoped queries, summaries, and selected fields.
See the [companion reference](agent/README.md) for local builds and migration.

The npm package and Chrome extension are separate releases. Use an extension build with Agent access and the required read contract.

## Data and safety

- Use Workbench only on pages you have permission to inspect.
- Each Panel Session owns temporary, rolling Event History. A new panel starts empty. Abnormal closure can leave residual data until cleanup.
- Local Injection calls application listeners. It does not contact Lightstreamer Server, but listeners can trigger other actions.
- Server Injection sends a real Client Message. Workbench does not automatically repeat an unknown result.
- Agent access allows inspection and Local Injection without authentication. Requested Evidence can reach your model provider.
- Configured builds enable usage analytics by default. It excludes captured data. Turn it off under **More actions → Help & resources → Usage analytics**.

Read [Privacy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/) before sharing data.
Report vulnerabilities through [Security](https://imom39a.github.io/lightstreamer-workbench-extension/security/), not a public issue.

## Develop and contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, tests, and pull requests.

- [Architecture](docs/ARCHITECTURE.md) — runtime, storage, capture, and delivery.
- [Domain model](CONTEXT.md) — terms and behavioral boundaries.
- [UI standard](docs/WORKBENCH_UI_STANDARD.md) — panel design and verification.
- [Release guide](RELEASE.md) and [maintainers](MAINTAINERS.md) — packaging and publication authority.
- [Release notes](https://imom39a.github.io/lightstreamer-workbench-extension/releases/) and [roadmap](https://imom39a.github.io/lightstreamer-workbench-extension/roadmap/).

Keep application-specific interpretation outside the generic Lightstreamer core.

## License and distribution

Source and documentation use the [Apache License 2.0](LICENSE), unless a file states otherwise.
The license does not grant access to the official Store listing, release credentials, or maintainer-controlled branding.
See [MAINTAINERS.md](MAINTAINERS.md) for distribution rules.

This independent project is not affiliated with Lightstreamer.
