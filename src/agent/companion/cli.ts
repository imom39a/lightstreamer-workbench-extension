#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import metadata from "../../../agent/package.json";
import { runMcp } from "./mcp";
import { DEFAULT_COMPANION_PORT, PAIRING_ENV, parsePairingCode, randomNonce } from "../pairing";
import { startPortableBroker } from "./portable-broker";
import { companionPort, type CompanionAuth, type PortableConfig } from "../portable-config";

const cli = fileURLToPath(import.meta.url);
const officialExtensionId = "kfpgbhfphbhkebglopimjhfnnmbifocf";
const [mode = "mcp", ...args] = process.argv.slice(2);
const help = `Lightstreamer Workbench MCP companion ${metadata.version}

Commands:
  setup [--extension-id ID] [--port PORT] [--auth off|required] [--local]
    Print version-pinned npm MCP configuration. --local uses this Node/package path.
  mcp [--extension-id ID] [--port PORT] [--auth off|required]
    Run stdio MCP and start the shared loopback companion automatically.
  --version
  --help

One Node runtime for Windows, macOS and Linux (Node 22.12+).
No native host, registry registration or background service installation.
Authentication is off by default; any local process can use connected panel grants.
Existing LSEW_AGENT_CONNECTION configurations still require authentication.
`;

function options(allowed: readonly string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.includes(key)) throw new Error(`Unknown option ${key}. Run --help for npm companion setup.`);
    if (values.has(key)) throw new Error(`Duplicate option ${key}.`);
    if (key === "--local") { values.set(key, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}.`);
    values.set(key, value);
  }
  return values;
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
    const values = options(["--extension-id", "--port", "--auth", "--local"]);
    const id = extensionId(values.get("--extension-id"));
    const port = companionPort(values.get("--port") ?? DEFAULT_COMPANION_PORT);
    const auth = authMode(values.get("--auth") ?? "off");
    const commandArgs = ["mcp", "--extension-id", id, "--auth", auth, "--port", String(port)];
    const config = {
      command: values.has("--local") ? process.execPath : "npx",
      args: values.has("--local") ? [cli, ...commandArgs] : ["--yes", `${metadata.name}@${metadata.version}`, ...commandArgs],
      ...(auth === "required" ? { env: { [PAIRING_ENV]: `wb1:${port}:${randomNonce()}` } } : {})
    };
    process.stdout.write(JSON.stringify({ port, auth, mcpServers: { "lightstreamer-workbench": config }, next: (auth === "off"
      ? "Add this MCP configuration to your agent and start it. Open Workbench; Agent access automatically enables inspection and Local Injection. No Connect click, credential or pairing is required. The header's Agent access On/Off switch disables access. Any local process can use a connected panel's grant. Setup writes no files or registry entries."
      : "Add this private MCP configuration to your agent and start it. Under Workbench → More actions → Agent setup instructions → Advanced connection settings, enable Require authentication and Apply connection settings. Ask your agent to show get_pairing_requests, compare the code and click Approve connection. The agent finishes with confirm_pairing.") + (port === DEFAULT_COMPANION_PORT ? "" : ` Apply Companion port ${port} in Workbench's Advanced connection settings too.`) }, null, 2) + "\n");
    return;
  }
  if (mode === "mcp") {
    const values = options(["--extension-id", "--port", "--auth"]);
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
    const values = options(["--extension-id"]);
    let input = "";
    for await (const chunk of process.stdin) { input += chunk.toString(); if (input.length > 256) throw new Error("Invalid startup configuration."); }
    await startPortableBroker(JSON.parse(input) as PortableConfig, extensionId(values.get("--extension-id")));
    return;
  }
  throw new Error(`Unknown command ${mode}. Run --help.`);
}
main().catch(error => { process.stderr.write(`Workbench companion: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
