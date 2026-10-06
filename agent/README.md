# Lightstreamer Workbench MCP companion

Connect your AI agent to [Lightstreamer Workbench](https://imom39a.github.io/lightstreamer-workbench-extension/)
in Chrome DevTools or Firefox Developer Tools. Inspect captured Lightstreamer activity, find Subscriptions
and Item Updates, and test Local Injections with your agent.

## Requirements

- Install [Lightstreamer Workbench from the Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf).
- Install [Node.js 22.12 or later](https://nodejs.org/en/download), including npm.
- Firefox support requires desktop Firefox 140 or later and extension 2.0.9 or later. See the setup guide for Store availability.
- Use an agent app that supports local stdio MCP servers on the same computer as your browser.

Use this release with extension 2.0.9. See the
[setup guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/)
for current availability, installation help, and troubleshooting.

## Set up

Run this command on macOS or Linux:

```sh
npx --yes lightstreamer-workbench-agent@0.1.8 setup
```

In Windows PowerShell:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@0.1.8 setup
```

Copy the printed `mcpServers` entry into your agent app's MCP settings, then
enable the server. Setup prints configuration; it does not edit those settings.
Your agent app starts the companion.

Open **Lightstreamer Workbench** in your application's developer tools. When
**Agent access** shows **On**, ask your agent to find the open Panel Session
and inspect the Subscription or updates you want to investigate.

One companion supports Chrome and Firefox panels together. Keep the default
setup for the official Store extensions. Firefox's permanent add-on ID is
`lightstreamer-workbench@imom39a`; it is not a value for the Chrome
`--extension-id` override. The companion verifies Firefox's per-profile
extension origin using the add-on's UUID mapping in registered local profiles.
For a portable or custom profile registry, set `LSEW_FIREFOX_PROFILES_DIR` in
the MCP entry to the directory containing that registry's `profiles.ini`.
Match the exact Panel Session and browser when several panels are open.

## Access and data

Agent access allows inspection and Local Injection by default. Local Injection
can trigger application actions. Authentication is off, so use a trusted computer;
requested data may reach your agent's model provider. Review the
[privacy policy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/).

Firefox asks for required data-sharing consent at installation because MCP
can share inspected application data with the local companion and your agent.
Use **More actions → Agent access and setup** to turn access off in a panel.
Analytics has a separate optional Firefox consent and Workbench setting.
Agent Server Injection requires reviewing and approving each exact Client
Message in Workbench before the agent can execute it.

## Learn more

- [Release notes](https://imom39a.github.io/lightstreamer-workbench-extension/releases/)
- [Workbench user guide](https://imom39a.github.io/lightstreamer-workbench-extension/docs/)
- [Source code and contributor documentation](https://github.com/imom39a/lightstreamer-workbench-extension)
- [Report a problem](https://github.com/imom39a/lightstreamer-workbench-extension/issues)
