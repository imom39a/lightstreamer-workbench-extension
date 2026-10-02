# Lightstreamer Workbench MCP companion

Connect your AI agent to [Lightstreamer Workbench](https://imom39a.github.io/lightstreamer-workbench-extension/)
in Chrome DevTools. Inspect captured Lightstreamer activity, find Subscriptions
and Item Updates, and test Local Injections with your agent.

## Requirements

- Install [Lightstreamer Workbench from the Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf).
- Install [Node.js 22.12 or later](https://nodejs.org/en/download), including npm.
- Use an agent app that supports local stdio MCP servers on the same computer as Chrome.

Use this release with extension 2.0.8. See the
[setup guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/)
for current availability, installation help, and troubleshooting.

## Set up

Run this command on macOS or Linux:

```sh
npx --yes lightstreamer-workbench-agent@0.1.7 setup
```

In Windows PowerShell:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@0.1.7 setup
```

Copy the printed `mcpServers` entry into your agent app's MCP settings, then
enable the server. Setup prints configuration; it does not edit those settings.
Your agent app starts the companion.

Open **Lightstreamer Workbench** in your application's Chrome DevTools. When
**Agent access** shows **On**, ask your agent to find the open Panel Session
and inspect the Subscription or updates you want to investigate.

## Access and data

Agent access allows inspection and Local Injection by default. Local Injection
can trigger application actions. Authentication is off, so use a trusted computer;
requested data may reach your agent's model provider. Review the
[privacy policy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/).

## Learn more

- [Release notes](https://imom39a.github.io/lightstreamer-workbench-extension/releases/)
- [Workbench user guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/)
- [Source code and contributor documentation](https://github.com/imom39a/lightstreamer-workbench-extension)
- [Report a problem](https://github.com/imom39a/lightstreamer-workbench-extension/issues)
