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
npx --yes lightstreamer-workbench-agent@latest setup
```

In Windows PowerShell:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup
```

npx first downloads or reuses the companion package and its `skills` dependency.
In a terminal, setup prints the pinned MCP configuration and offers to install
or update the matching Workbench skill. Accept the offer to use the upstream
`skills` installer's native agent selection and project or user scope prompts.
It supports Codex (OpenAI), Claude Code, Kiro, Cursor, and the other targets in
the dependency's agent registry. You can select several apps. Its normal agent
detection and selection defaults apply. The entire skill folder is copied from this companion
release, including its reference guides; it remains available after npx cache
cleanup. Bare `npx lightstreamer-workbench-agent@latest` also opens this setup
in a terminal.

The `--yes` before the package name approves npx downloading and running the
package; it leaves the skill prompts available. Copy the printed `mcpServers`
entry into your agent app's MCP settings, then enable the server. Setup prints
configuration; it does not edit those settings. Your agent app starts the companion.

Run `npx --yes lightstreamer-workbench-agent@latest update` to repeat the same
flow with the current release and refresh both the pinned MCP entry and skill.
For unattended project installation, choose one or several targets:

```sh
npx --yes lightstreamer-workbench-agent@latest setup --skill --agent codex claude-code kiro-cli --yes
```

| App | Target argument | Project skill directory |
| --- | --- | --- |
| Codex (OpenAI) | `codex` | `.agents/skills` |
| Claude Code | `claude-code` | `.claude/skills` |
| Kiro IDE or CLI | `kiro-cli` | `.kiro/skills` |

Add `--global` for user scope. Repeating `--agent` is also supported. The
upstream installer owns the [supported agent names and directories](https://github.com/vercel-labs/skills#available-agents);
Workbench does not maintain its own registry or picker. Setup's final `--yes`
skips skill prompts and requires an explicit target. `setup --json` or
`--skip-skill` prints configuration only; MCP
startup never prompts. The combined skill flow is new in the next companion
release after 0.1.7; check the setup guide for published availability.

The pinned installer currently reports an upstream error if you cancel inside
its agent picker, before skill installation starts. The printed MCP configuration
is still usable. Decline the initial skill offer or use `--skip-skill` for
configuration only; rerun setup when ready to select targets.

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
