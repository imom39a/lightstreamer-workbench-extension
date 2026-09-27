import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import spawn from "cross-spawn";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, "test-results", "agent-package");
const metadata = JSON.parse(await readFile(join(root, "agent/package.json"), "utf8"));
function npm(args, cwd = root) {
  const result = spawn.sync("npm", args, { cwd, encoding: "utf8", timeout: 120000 });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const suppliedTarball = process.env.LSEW_AGENT_PACKAGE_TARBALL ? resolve(process.env.LSEW_AGENT_PACKAGE_TARBALL) : null;
const packed = JSON.parse(npm(suppliedTarball
  ? ["pack", suppliedTarball, "--dry-run", "--ignore-scripts", "--json"]
  : ["pack", "./agent", "--json", "--pack-destination", directory]));
assert.equal(packed.length, 1);
const artifact = packed[0];
for (const file of ["dist/cli.mjs", "dist/THIRD_PARTY_NOTICES.txt", "skills/lightstreamer-workbench/SKILL.md", "skills/lightstreamer-workbench/references/connection.md", "README.md", "LICENSE"]) {
  assert(artifact.files.some(entry => entry.path === file), `Missing package file ${file}`);
}
assert(artifact.files.every(entry => /^(dist\/|skills\/|README\.md$|WINDOWS\.md$|LICENSE$|package\.json$)/.test(entry.path)), "Unexpected file in npm artifact");
npm(["install", "--prefix", directory, "--ignore-scripts", "--offline", "--no-audit", "--no-fund", suppliedTarball ?? join(directory, artifact.filename)]);
const cli = join(directory, "node_modules", ...metadata.name.split("/"), "dist/cli.mjs");
const installed = JSON.parse(await readFile(join(directory, "node_modules", ...metadata.name.split("/"), "package.json"), "utf8"));
assert.equal(installed.version, metadata.version);
assert.equal(installed.dependencies, undefined, "The published runtime must be self-contained");
const execute = ["exec", "--offline", "--prefix", directory, "--", "lightstreamer-workbench-agent"];
assert.equal(npm([...execute, "--version"], directory).trim(), metadata.version);
const setup = JSON.parse(npm([...execute, "setup"], directory));
assert.equal(setup.mcpServers["lightstreamer-workbench"].command, "npx");
assert.deepEqual(setup.mcpServers["lightstreamer-workbench"].args.slice(0, 3), ["--yes", `${metadata.name}@${metadata.version}`, "mcp"]);
assert.equal(setup.mcpServers["lightstreamer-workbench"].env, undefined);

const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const id = "a".repeat(32);
const clients = [new Client({ name: "installed-npm-a", version: "1" }), new Client({ name: "installed-npm-b", version: "1" })];
let panel;
const timeout = setTimeout(() => { console.error("Packaged MCP proof timed out."); process.exit(1); }, 45000);
try {
  // Run the installed npm bin from outside the source tree, including npm's Windows shim.
  for (const client of clients) await client.connect(new StdioClientTransport({
    command: "npm", args: [...execute, "mcp", "--extension-id", id, "--port", String(port)],
    cwd: directory, env: { LSEW_AGENT_CONNECTION: "" }, stderr: "inherit"
  }));
  assert.equal(clients[0].getServerVersion().version, metadata.version);
  assert((await clients[0].listTools()).tools.some(tool => tool.name === "prepare_scenario"));
  panel = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: { Origin: `chrome-extension://${id}` } });
  const queue = [], readers = [];
  panel.on("message", data => { const message = JSON.parse(data.toString()); const read = readers.shift(); if (read) read(message); else queue.push(message); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => readers.push(resolve));
  await once(panel, "open");
  panel.send(JSON.stringify({ type: "connect", role: "panel", auth: "off" }));
  assert.deepEqual(await next(), { type: "connected", auth: "off" });
  panel.send(JSON.stringify({ role: "panel", protocolVersion: 1, panelSessionId: "npm-package-panel", permission: "read" }));
  assert.deepEqual(await next(), { type: "ready" });
  for (const client of clients) {
    const sessions = await client.callTool({ name: "list_panel_sessions", arguments: {} });
    assert(!sessions.isError); assert.match(JSON.stringify(sessions), /npm-package-panel/);
  }
  const call = clients[1].callTool({ name: "get_status", arguments: { panelSessionId: "npm-package-panel" } });
  const request = await next();
  panel.send(JSON.stringify({ id: request.id, result: { pageEpoch: "installed-package-runtime" } }));
  assert.match(JSON.stringify(await call), /installed-package-runtime/);
  const forbidden = await clients[0].callTool({ name: "execute_server_injection", arguments: {} });
  assert.equal(forbidden.isError, true);
} finally {
  panel?.terminate();
  await Promise.all(clients.map(client => client.close()));
  clearTimeout(timeout);
}
console.log(`Packaged MCP proof passed on ${process.platform}: ${artifact.filename}, ${artifact.size} bytes. npm bin, version-pinned setup, shared broker, two MCP clients and exact panel routing.`);
console.log(`Installed test CLI: ${cli}`);
