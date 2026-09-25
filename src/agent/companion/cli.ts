#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { NATIVE_HOST_NAME } from "../protocol";
import { runMcp } from "./mcp";
import { runNativeHost } from "./native-host";
import { startBroker } from "./broker";
import { install, installationPaths, OFFICIAL_EXTENSION_ID } from "./installer";
import { DEFAULT_COMPANION_PORT, PAIRING_ENV, parsePairingCode, randomNonce } from "../pairing";
import { startPortableBroker } from "./portable-broker";
import { companionPort, type CompanionAuth, type PortableConfig } from "../portable-config";

const cli = fileURLToPath(import.meta.url);
const [mode = "mcp", ...args] = process.argv.slice(2);
function option(name: string, fallback?: string) { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Missing value for ${name}.`); return args[i + 1]; }
function authMode(fallback: CompanionAuth): CompanionAuth {
  const mode = option("--auth", fallback);
  if (mode !== "off" && mode !== "required") throw new Error("--auth must be off or required.");
  return mode;
}
async function main() {
  const directory = option("--directory");
  if (mode === "setup") {
    const extensionId = option("--extension-id", OFFICIAL_EXTENSION_ID)!;
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Expected the exact 32-character Chrome extension id.");
    const port = companionPort(option("--port", String(DEFAULT_COMPANION_PORT)));
    const auth = authMode("off");
    const config = { command: process.execPath, args: [cli, "mcp", "--extension-id", extensionId, "--auth", auth, "--port", String(port)], ...(auth === "required" ? { env: { [PAIRING_ENV]: `wb1:${port}:${randomNonce()}` } } : {}) };
    process.stdout.write(JSON.stringify({ port, auth, mcpServers: { "lightstreamer-workbench": config }, next: (auth === "off"
      ? "Add this MCP configuration to your agent and start it. Open Workbench; agent access automatically enables inspection and Local Injection. No Connect click, credential or pairing is required. Use the header's Agent access On/Off switch to disable access. Authentication is off: any local process can use a connected panel's grant. Setup writes no files or registry entries."
      : "Add this private MCP configuration to your agent and start it. In Workbench → More actions → Agent setup instructions → Advanced connection settings, enable Require authentication and Apply connection settings. Ask your agent to show get_pairing_requests, compare the code and click Approve connection. The agent finishes with confirm_pairing.") + (port === DEFAULT_COMPANION_PORT ? "" : ` This configuration uses custom port ${port}; apply the same Companion port under Agent setup instructions → Advanced connection settings in Workbench.`) }, null, 2) + "\n"); return;
  }
  if (mode === "mcp") {
    const code = process.env[PAIRING_ENV];
    const transport = option("--transport", directory ? "native" : "portable");
    if (transport === "native") {
      if (code || args.includes("--auth") || args.includes("--port")) throw new Error("Native transport does not use portable authentication or port settings.");
      return runMcp(cli, directory);
    }
    if (transport !== "portable") throw new Error("--transport must be portable or native.");
    const auth = authMode(code ? "required" : "off");
    if (auth === "off" && code) throw new Error(`Remove ${PAIRING_ENV} from the MCP configuration before turning authentication off.`);
    if (auth === "required" && !code) throw new Error(`Authentication requires ${PAIRING_ENV}. Run setup --auth required for configuration.`);
    const port = companionPort(option("--port", code ? String(parsePairingCode(code).port) : String(DEFAULT_COMPANION_PORT)));
    if (code && parsePairingCode(code).port !== port) throw new Error("Companion port does not match the authenticated configuration.");
    return runMcp(cli, directory, { config: auth === "required" ? code! : { auth: "off", port }, extensionId: option("--extension-id", OFFICIAL_EXTENSION_ID)! });
  }
  if (mode === "portable-broker") {
    let input = "";
    for await (const chunk of process.stdin) { input += chunk.toString(); if (input.length > 256) throw new Error("Invalid startup configuration."); }
    await startPortableBroker(JSON.parse(input) as PortableConfig, option("--extension-id", OFFICIAL_EXTENSION_ID)!); return;
  }
  if (mode === "host") return runNativeHost(cli, args[0] ?? "", directory);
  if (mode === "broker") { await startBroker(directory); return; }
  if (mode === "install") {
    const paths = await install(cli, option("--extension-id", OFFICIAL_EXTENSION_ID)!, option("--browser", "chrome")!, undefined, option("--user-data-dir"));
    process.stdout.write(JSON.stringify({ installed: paths, mcpServers: { "lightstreamer-workbench": { command: process.execPath, args: [cli, "mcp", "--transport", "native"] } } }, null, 2) + "\n"); return;
  }
  if (mode === "doctor") {
    const paths = installationPaths(option("--browser", "chrome")!);
    const userDataDir = option("--user-data-dir");
    if (userDataDir) {
      if (!isAbsolute(userDataDir)) throw new Error("--user-data-dir must be an absolute Chrome user-data directory.");
      paths.manifest = join(userDataDir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
    }
    const manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
    process.stdout.write(JSON.stringify({ node: process.version, cli, manifest, next: "Open Workbench → More actions → Agent setup instructions → Advanced connection settings, select Installed native host (macOS/Linux), then Apply connection settings. The agent can then call list_panel_sessions." }, null, 2) + "\n"); return;
  }
  process.stdout.write("Lightstreamer Workbench agent companion\n\nCommands:\n  setup [--extension-id ID] [--port PORT] [--auth off|required]  Print MCP configuration\n  mcp [--extension-id ID] [--port PORT] [--auth off|required]   Run standalone stdio MCP\n  mcp --transport native   Use the optional installed native host\n  install [--extension-id ID] [--browser chrome|chromium|chrome-for-testing] [--user-data-dir ABSOLUTE_PATH]\n  doctor    Inspect the optional installed native host manifest\n\nStandalone setup supports Windows, macOS and Linux with Node 22.12+. Authentication is off by default; any local process can use connected panel grants. Existing LSEW_AGENT_CONNECTION configurations still require authentication. Native installation is optional and supports macOS/Linux only. Keep this package at its configured path.\n");
}
main().catch(error => { process.stderr.write(`Workbench companion: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
