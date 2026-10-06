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

## Upcoming combined skill setup

The combined skill flow is implemented in source and awaits the next companion
release after 0.1.8. Published 0.1.8 prints MCP configuration and requires
copying the optional bundled skill manually. Once the new release is published:

```sh
npx --yes lightstreamer-workbench-agent@latest setup
```

Use `npx.cmd` on Windows. npx first downloads or reuses the companion package
and its `skills` dependency. In a terminal, setup prints the pinned MCP
configuration and offers to install or update the matching Workbench skill.
Accept the offer to use the upstream `skills` installer's native agent
selection and project or user scope prompts. It supports Codex (OpenAI),
Claude Code, Kiro, Cursor, and the other targets in the dependency's agent
registry. You can select several apps; its normal detection and selection
defaults apply. The complete skill folder is copied from the companion,
including its reference guides, and survives npx cache cleanup.

The `--yes` before the package name approves npx downloading and running the
package; it leaves the skill prompts available. Bare interactive
`npx lightstreamer-workbench-agent@latest` also opens setup. Run
`npx --yes lightstreamer-workbench-agent@latest update` to refresh the printed
MCP configuration and matching skill together.

For unattended project installation, choose one or several targets:

```sh
npx --yes lightstreamer-workbench-agent@latest setup --skill --agent codex claude-code kiro-cli --yes
```

| App | Target argument | Project skill directory |
| --- | --- | --- |
| Codex (OpenAI) | `codex` | `.agents/skills` |
| Claude Code | `claude-code` | `.claude/skills` |
| Kiro IDE or CLI | `kiro-cli` | `.kiro/skills` |

Add `--global` for user scope. Repeated `--agent` flags also work. The upstream
installer owns the [supported agent names and directories](https://github.com/vercel-labs/skills#available-agents);
Workbench does not maintain its own registry or picker. Setup's final `--yes`
skips skill prompts and requires an explicit target. `setup --json` or
`--skip-skill` prints configuration only; MCP startup never prompts. Setup
prints the MCP entry for you to copy into your app's settings.

The pinned installer currently reports an upstream error if you cancel inside
its agent picker before skill installation starts. The printed MCP
configuration remains usable. Decline the initial skill offer or use
`--skip-skill` for configuration only; rerun setup when ready to select targets.

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
