#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import metadata from "../../../agent/package.json";
import { runMcp } from "./mcp";
import { DEFAULT_COMPANION_PORT, PAIRING_ENV, parsePairingCode, randomNonce } from "../pairing";
import { startPortableBroker } from "./portable-broker";
import { companionPort, type CompanionAuth, type PortableConfig } from "../portable-config";
import { companionMode, installWorkbenchSkill, offerWorkbenchSkill } from "./setup";

const cli = fileURLToPath(import.meta.url);
const officialExtensionId = "kfpgbhfphbhkebglopimjhfnnmbifocf";
const [requestedMode, ...args] = process.argv.slice(2);
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const mode = companionMode(requestedMode, interactive);
const help = `Lightstreamer Workbench MCP companion ${metadata.version}

Commands:
  setup [--extension-id ID] [--local] [--json] [--skip-skill]
    Print pinned MCP configuration and offer the matching skill in a terminal.
  setup --skill --agent APP [APP ...] [--global] [--yes]
    Print MCP configuration and install/update its bundled skill in one invocation.
  update
    Run the same combined setup with this package's current skill.
  mcp [--extension-id ID]
    Run stdio MCP and start the shared loopback companion automatically.
  --version
  --help

One Node runtime for Windows, macOS and Linux (Node 22.12+).
No native host, registry registration or background service installation.
The current panel uses port 24817, authentication off, and inspection plus Local Injection.
Any local process can use connected panel grants.
Legacy auth/port flags remain for protocol testing, not current panel setup.
Replace old authenticated/custom-port entries with default setup output.
Bare npx invocation opens setup in a terminal; redirected input runs stdio MCP.
--json prints configuration only. --skip-skill skips the optional skill.
The skills dependency handles all supported agent targets and project/user installation.
Select Codex (OpenAI), Claude Code, Kiro, or other supported apps in its native picker.
--agent accepts several apps or repeated flags, for example: --agent codex claude-code kiro-cli.
The --yes before the package name approves npx; setup's own --yes skips skill prompts.
`;

function options(allowed: readonly string[]) {
  const values = new Map<string, string>();
  const agents: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.includes(key)) throw new Error(`Unknown option ${key}. Run --help for npm companion setup.`);
    if (key === "--agent") {
      const start = agents.length;
      while (args[i + 1] && !args[i + 1]!.startsWith("-")) agents.push(args[++i]!);
      if (agents.length === start) throw new Error("Missing value for --agent.");
      values.set(key, "true");
      continue;
    }
    if (values.has(key)) throw new Error(`Duplicate option ${key}.`);
    if (["--local", "--json", "--skip-skill", "--skill", "--global", "--yes"].includes(key)) { values.set(key, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}.`);
    values.set(key, value);
  }
  return { values, agents: [...new Set(agents)] };
}
function extensionId(value = officialExtensionId) {
  if (!/^[a-p]{32}$/.test(value)) throw new Error("Expected the exact 32-character Chrome extension id.");
  return value;
}
function authMode(value: string): CompanionAuth {
  if (value !== "off" && value !== "required") throw new Error("--auth must be off or required.");
  return value;
}
async function main() {
  if (["--help", "-h", "help"].includes(mode)) { process.stdout.write(help); return; }
  if (["--version", "-v"].includes(mode)) { process.stdout.write(`${metadata.version}\n`); return; }
  if (["install", "doctor", "host", "broker"].includes(mode) || args.includes("--transport") || args.includes("--directory")) {
    throw new Error("Native-host and transport selection have been removed. Replace the old MCP entry with `setup` output and reload Workbench. See the companion README migration instructions.");
  }
  if (mode === "setup") {
    const { values, agents } = options(["--extension-id", "--port", "--auth", "--local", "--json", "--skip-skill", "--skill", "--agent", "--global", "--yes"]);
    const requestedSkill = values.has("--skill") || values.has("--agent");
    if (requestedSkill && (values.has("--json") || values.has("--skip-skill"))) throw new Error("Choose skill installation or configuration-only output; --skill/--agent cannot combine with --json/--skip-skill.");
    if (values.has("--yes") && !values.has("--agent")) throw new Error("Unattended skill setup requires --agent APP; use a terminal without --yes for agent selection.");
    if (values.has("--global") && (values.has("--json") || values.has("--skip-skill"))) throw new Error("--global selects skill installation scope and cannot combine with --json/--skip-skill.");
    if ((requestedSkill || values.has("--yes")) && !interactive && !values.has("--agent")) throw new Error("Unattended skill setup requires --agent APP and --yes.");
    if (requestedSkill && !interactive && !values.has("--yes")) throw new Error("Unattended skill setup requires --yes; use a terminal for agent selection and confirmation.");
    if (values.has("--global") && !requestedSkill && !interactive) throw new Error("--global requires skill installation. Use --skill --agent APP --global --yes.");
    const id = extensionId(values.get("--extension-id"));
    const port = companionPort(values.get("--port") ?? DEFAULT_COMPANION_PORT);
    const auth = authMode(values.get("--auth") ?? "off");
    const commandArgs = ["mcp", "--extension-id", id, "--auth", auth, "--port", String(port)];
    const config = {
      command: values.has("--local") ? process.execPath : "npx",
      args: values.has("--local") ? [cli, ...commandArgs] : ["--yes", `${metadata.name}@${metadata.version}`, ...commandArgs],
      ...(auth === "required" ? { env: { [PAIRING_ENV]: `wb1:${port}:${randomNonce()}` } } : {})
    };
    process.stdout.write(JSON.stringify({ port, auth, mcpServers: { "lightstreamer-workbench": config }, skill: { name: "lightstreamer-workbench", version: metadata.version,
      installation: "Bundled with this release. Interactive setup offers the upstream skills agent picker; unattended setup accepts --skill --agent APP [APP ...] --yes, optionally --global." }, next: auth === "off" && port === DEFAULT_COMPANION_PORT
      ? "Add this MCP configuration to your agent app. Starting its MCP server launches the companion automatically. Open Workbench: Agent access Waiting changes to On when ready. MCP configuration is printed for you to add; optional skill installation writes only the agent's skill files. Installing a companion does not update the extension."
      : "This retained protocol configuration is not supported by the current panel UI. Run setup without auth or port overrides and remove any old LSEW_AGENT_CONNECTION environment entry. The panel uses port 24817 with authentication off and inspection plus Local Injection." }, null, 2) + "\n");
    if (requestedSkill || (interactive && !values.has("--json") && !values.has("--skip-skill") && await offerWorkbenchSkill())) {
      process.stdout.write(`\nInstalling the Workbench skill bundled with companion ${metadata.version}. The upstream installer supports Codex (OpenAI), Claude Code, Kiro, and other agent apps.\n`);
      await installWorkbenchSkill(cli, { agents: agents.length ? agents : undefined,
        global: values.has("--global"), yes: values.has("--yes") });
    }
    return;
  }
  if (mode === "mcp") {
    const { values } = options(["--extension-id", "--port", "--auth"]);
    const id = extensionId(values.get("--extension-id"));
    const code = process.env[PAIRING_ENV];
    const auth = authMode(values.get("--auth") ?? (code ? "required" : "off"));
    if (auth === "off" && code) throw new Error(`Remove ${PAIRING_ENV} from the MCP configuration before turning authentication off.`);
    if (auth === "required" && !code) throw new Error(`Authentication requires ${PAIRING_ENV}. Run setup --auth required for configuration.`);
    const port = companionPort(values.get("--port") ?? (code ? parsePairingCode(code).port : DEFAULT_COMPANION_PORT));
    if (code && parsePairingCode(code).port !== port) throw new Error("Companion port does not match the authenticated configuration.");
    return runMcp(cli, { config: auth === "required" ? code! : { auth: "off", port }, extensionId: id });
  }
  if (mode === "portable-broker") {
    const { values } = options(["--extension-id"]);
    let input = "";
    for await (const chunk of process.stdin) { input += chunk.toString(); if (input.length > 256) throw new Error("Invalid startup configuration."); }
    await startPortableBroker(JSON.parse(input) as PortableConfig, extensionId(values.get("--extension-id")));
    return;
  }
  throw new Error(`Unknown command ${mode}. Run --help.`);
}
main().catch(error => { process.stderr.write(`Workbench companion: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
