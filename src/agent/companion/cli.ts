#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { NATIVE_HOST_NAME } from "../protocol";
import { runMcp } from "./mcp";
import { runNativeHost } from "./native-host";
import { startBroker } from "./broker";
import { install, installationPaths, OFFICIAL_EXTENSION_ID } from "./installer";

const cli = fileURLToPath(import.meta.url);
const [mode = "mcp", ...args] = process.argv.slice(2);
function option(name: string, fallback?: string) { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Missing value for ${name}.`); return args[i + 1]; }
async function main() {
  const directory = option("--directory");
  if (mode === "mcp") return runMcp(cli, directory);
  if (mode === "host") return runNativeHost(cli, args[0] ?? "", directory);
  if (mode === "broker") { await startBroker(directory); return; }
  if (mode === "install") {
    const paths = await install(cli, option("--extension-id", OFFICIAL_EXTENSION_ID)!, option("--browser", "chrome")!, undefined, option("--user-data-dir"));
    process.stdout.write(JSON.stringify({ installed: paths, mcpServers: { "lightstreamer-workbench": { command: process.execPath, args: [cli, "mcp"] } } }, null, 2) + "\n"); return;
  }
  if (mode === "doctor") {
    const paths = installationPaths(option("--browser", "chrome")!);
    const userDataDir = option("--user-data-dir");
    if (userDataDir) {
      if (!isAbsolute(userDataDir)) throw new Error("--user-data-dir must be an absolute Chrome user-data directory.");
      paths.manifest = join(userDataDir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
    }
    const manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
    process.stdout.write(JSON.stringify({ node: process.version, cli, manifest, next: "Open the installed Workbench panel, More actions → Agent access → Connect agent. The agent can then call list_panel_sessions." }, null, 2) + "\n"); return;
  }
  process.stdout.write("Lightstreamer Workbench agent companion\n\nCommands:\n  install [--extension-id ID] [--browser chrome|chromium|chrome-for-testing] [--user-data-dir ABSOLUTE_PATH]\n  mcp       Run the stdio MCP server\n  doctor    Inspect the installed native host manifest\n\nInstallation supports macOS and Linux. Keep this package at its installed path.\n");
}
main().catch(error => { process.stderr.write(`Workbench companion: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
