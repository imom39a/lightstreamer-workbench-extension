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
for (const file of ["dist/cli.mjs", "dist/THIRD_PARTY_NOTICES.txt", "skills/lightstreamer-workbench/SKILL.md", "skills/lightstreamer-workbench/references/connection.md", "skills/lightstreamer-workbench/references/investigation.md", "skills/lightstreamer-workbench/references/local-injection.md", "skills/lightstreamer-workbench/references/application-context.md", "skills/lightstreamer-workbench/references/query-planning.md", "README.md", "READS.md", "WINDOWS.md", "LICENSE"]) {
  assert(artifact.files.some(entry => entry.path === file), `Missing package file ${file}`);
}
assert(artifact.files.every(entry => /^(dist\/|skills\/|README\.md$|READS\.md$|WINDOWS\.md$|LICENSE$|package\.json$)/.test(entry.path)), "Unexpected file in npm artifact");
npm(["install", "--prefix", directory, "--ignore-scripts", "--offline", "--no-audit", "--no-fund", suppliedTarball ?? join(directory, artifact.filename)]);
const cli = join(directory, "node_modules", ...metadata.name.split("/"), "dist/cli.mjs");
const installed = JSON.parse(await readFile(join(directory, "node_modules", ...metadata.name.split("/"), "package.json"), "utf8"));
assert.equal(installed.version, metadata.version);
assert.deepEqual(installed.dependencies, { skills: "1.5.18" }, "Use the upstream installer as a pinned dependency, without copying its implementation");
assert.equal(JSON.parse(await readFile(join(directory, "node_modules/skills/package.json"), "utf8")).version, "1.5.18");
const execute = ["exec", "--offline", "--prefix", directory, "--", "lightstreamer-workbench-agent"];
assert.equal(npm([...execute, "--version"], directory).trim(), metadata.version);
const setup = JSON.parse(npm([...execute, "setup"], directory));
assert.equal(setup.mcpServers["lightstreamer-workbench"].command, "npx");
assert.deepEqual(setup.mcpServers["lightstreamer-workbench"].args.slice(0, 3), ["--yes", `${metadata.name}@${metadata.version}`, "mcp"]);
assert.equal(setup.mcpServers["lightstreamer-workbench"].env, undefined);
assert.equal(setup.skill.version, metadata.version);
const project = join(directory, "application project with spaces");
await mkdir(project);
const installedSkills = [".agents/skills", ".claude/skills", ".kiro/skills"].map(path => join(project, path, "lightstreamer-workbench"));
const sourceSkill = join(directory, "node_modules", ...metadata.name.split("/"), "skills/lightstreamer-workbench");
npm([...execute, "setup", "--skill", "--agent", "codex", "claude-code", "kiro-cli", "--yes"], project);
for (const installedSkill of installedSkills) {
  for (const file of ["SKILL.md", "references/connection.md", "references/investigation.md", "references/local-injection.md", "references/application-context.md", "references/query-planning.md"]) {
    assert.equal(await readFile(join(installedSkill, file), "utf8"), await readFile(join(sourceSkill, file), "utf8"), `Installed skill matches this companion release: ${installedSkill}/${file}`);
  }
  await rm(join(installedSkill, "references/local-injection.md"));
}
npm([...execute, "update", "--skill", "--agent", "codex", "--agent", "claude-code", "kiro-cli", "--yes"], project);
for (const installedSkill of installedSkills) {
  assert.equal(await readFile(join(installedSkill, "references/local-injection.md"), "utf8"), await readFile(join(sourceSkill, "references/local-injection.md"), "utf8"), `Combined update restores the matching reference files: ${installedSkill}`);
}
console.log("Combined setup/update installed the complete skill for Codex, Claude Code and Kiro through the upstream installer.");

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
  assert.match(clients[0].getInstructions() ?? "", /list_panel_sessions/);
  assert.match(clients[0].getInstructions() ?? "", /exact inspected tab/);
  const catalog = await clients[0].listTools();
  const advertised = catalog.tools;
  const expectedTools = [
    "list_panel_sessions", "get_pairing_requests", "confirm_pairing", "get_status",
    "list_scope", "search_scope", "get_scope", "aggregate_evidence", "generate_agent_candidates",
    "read_bundle", "query_evidence", "search_evidence", "summarize_evidence", "describe_stream",
    "wait_for_evidence", "get_evidence", "query_diagnostics", "query_command_state",
    "query_command_rows", "query_command_keys", "update_agent_document", "prepare_local_injection",
    "prepare_server_injection", "execute_server_injection", "recover_server_injection",
    "abort_server_injection", "recover_agent_document", "abort_agent_document",
    "execute_local_injection", "get_operation", "wait_for_operation", "wait_for_scenario",
    "validate_agent_candidate", "prepare_scenario", "control_scenario", "get_scenario_trace",
    "finish_agent_document"
  ];
  assert.equal(advertised.length, 37, "The approved catalog retains all 37 tools");
  assert.deepEqual(advertised.map(tool => tool.name).sort(), expectedTools.sort(), "Installed tool names match the approved interface");
  const discoveryBytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
  assert(discoveryBytes <= 160 * 1024, `installed tool discovery is ${discoveryBytes} bytes against the user-approved 163,840-byte full-catalog ceiling`);
  console.log(`Installed discovery: ${advertised.length} tools, ${discoveryBytes} bytes; approved ceiling 163840 bytes, headroom ${163840 - discoveryBytes} bytes.`);
  assert(advertised.some(tool => tool.name === "prepare_scenario"));
  assert(advertised.some(tool => tool.name === "wait_for_scenario"));
  assert(advertised.find(tool => tool.name === "query_evidence")?.inputSchema.properties.workBudget, "query work budgets are discoverable");
  for (const name of ["search_evidence", "search_scope", "summarize_evidence"]) {
    assert.equal(advertised.find(tool => tool.name === name)?.annotations?.readOnlyHint, true, `${name} is discoverable and read-only in the installed artifact`);
  }
  for (const name of ["query_evidence", "summarize_evidence", "describe_stream", "validate_agent_candidate", "wait_for_evidence"]) {
    assert(advertised.some(tool => tool.name === name && tool.outputSchema?.type === "object"), `Missing structured tool contract: ${name}`);
  }
  const resources = await clients[0].listResources();
  assert.equal(resources.resources.length, 1);
  const readContract = await clients[0].readResource({ uri: resources.resources[0].uri });
  assert.match(readContract.contents[0].text ?? "", /Counts are retained Evidence records/);
  assert(new TextEncoder().encode(JSON.stringify(readContract)).byteLength <= 16 * 1024);
  const prompts = await clients[0].listPrompts();
  assert.deepEqual(prompts.prompts.map(prompt => prompt.name), ["investigate-lightstreamer"]);
  const prompt = await clients[0].getPrompt({ name: "investigate-lightstreamer", arguments: { question: "why did a COMMAND key disappear?" } });
  assert.match(prompt.messages[0].content.text, /why did a COMMAND key disappear\?/);
  panel = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: { Origin: `chrome-extension://${id}` } });
  const queue = [], readers = [];
  panel.on("message", data => { const message = JSON.parse(data.toString()); const read = readers.shift(); if (read) read(message); else queue.push(message); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => readers.push(resolve));
  await once(panel, "open");
  panel.send(JSON.stringify({ type: "connect", role: "panel", auth: "off" }));
  const connected = await next();
  assert.equal(connected.type, "connected");
  assert.equal(connected.auth, "off");
  assert.deepEqual(connected.identity, { identityVersion: 1, extensionId: "a".repeat(32), companionVersion: metadata.version, protocolVersion: 1, readContractVersion: 2 });
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
  const searchIdentity = sequence => ({ intervalId: "package-search-interval", pageId: "package-page", ownerId: "package-owner", sequence, eventId: `package-event-${sequence}` });
  const searchReadPoint = {
    interval: { id: "package-search-interval", ordinal: 1 }, committedEvidenceBoundary: searchIdentity(1002),
    retainedRange: { first: searchIdentity(1), last: searchIdentity(1002) }
  };
  const searchResults = {
    search_evidence: {
      readPoint: searchReadPoint, coverage: "COMPLETE", evaluation: "COMPLETE", storage: "MEMORY_FALLBACK",
      totals: { matching: 1002, inScope: 1002 },
      evidence: [{ identity: searchIdentity(1), timestamp: 1, fields: { message: { state: "concrete", value: "needle" } } }],
      nextCursor: "frozen-search-cursor"
    },
    search_scope: {
      snapshot: { pageEpoch: "installed-package-runtime", structureRevision: 1, history: { intervalId: "package-search-interval", committedSequence: 1002, retainedFirstSequence: 1 } },
      boundary: "ALL_STRUCTURAL_TOPOLOGY", match: "CASE_INSENSITIVE_SUBSTRING", text: "needle", total: 1002, offset: 0,
      scopes: [{ scopeId: "package-scope", kind: "subscription", label: "needle", path: "package-page/needle", ancestorIds: ["package-page"], matchedFields: ["label"] }],
      nextCursor: "frozen-search-cursor"
    }
  };
  for (const name of ["search_evidence", "search_scope"]) {
    const args = { panelSessionId: "npm-package-panel", text: "needle", limit: 1, ...(name === "search_evidence" ? { within: "page" } : {}) };
    const search = clients[0].callTool({ name, arguments: args });
    const request = await next();
    assert.equal(request.name, name);
    assert.deepEqual(request.args, args);
    panel.send(JSON.stringify({ id: request.id, result: searchResults[name] }));
    const searchReply = await search;
    assert.equal(searchReply.isError, undefined);
    assert.deepEqual(searchReply.structuredContent, searchResults[name], `${name} preserves its canonical structured search result through cached SDK validation`);
    assert.match(JSON.stringify(searchReply), /frozen-search-cursor/);
    const invalid = await clients[0].callTool({ name, arguments: { panelSessionId: "npm-package-panel", text: "needle", limit: 101 } });
    assert.equal(invalid.isError, true, `${name} validates its bound before panel routing`);
  }
  const queryResult = {
    readPoint: { interval: { id: "package-interval", ordinal: 1 }, committedEvidenceBoundary: null, retainedRange: null },
    totals: { matching: 0, inScope: 0 }, coverage: "COMPLETE", evaluation: "COMPLETE", storage: "MEMORY_FALLBACK",
    discoveries: {}, nextCursor: null, evidence: [], omissions: []
  };
  const query = clients[0].callTool({ name: "query_evidence", arguments: { panelSessionId: "npm-package-panel", within: "page", discover: [{ facet: "kind", limit: 5 }] } });
  const queryRequest = await next();
  assert.equal(queryRequest.name, "query_evidence");
  panel.send(JSON.stringify({ id: queryRequest.id, result: queryResult }));
  const queryReply = await query;
  assert.equal(queryReply.isError, undefined);
  assert.deepEqual(queryReply.structuredContent, queryResult, "The real SDK accepts and preserves the declared structured query result");
  const scenarioWait = clients[0].callTool({ name: "wait_for_scenario", arguments: { panelSessionId: "npm-package-panel", runId: "run-1", pageEpoch: "installed-package-runtime", afterRevision: 1, timeoutMs: 1000 } });
  const scenarioWaitRequest = await next();
  assert.equal(scenarioWaitRequest.name, "wait_for_scenario");
  assert.deepEqual(scenarioWaitRequest.args, { panelSessionId: "npm-package-panel", runId: "run-1", pageEpoch: "installed-package-runtime", afterRevision: 1, timeoutMs: 1000 });
  panel.send(JSON.stringify({ id: scenarioWaitRequest.id, result: { status: "TERMINAL", runId: "run-1", pageEpoch: "installed-package-runtime", revision: 2, scenario: {}, reason: "Run completed." } }));
  const scenarioWaitReply = await scenarioWait;
  assert.equal(scenarioWaitReply.isError, undefined);
  assert.equal(scenarioWaitReply.structuredContent.status, "TERMINAL");
  const invalid = await clients[0].callTool({ name: "query_evidence", arguments: { panelSessionId: "npm-package-panel", filter: { unknown: true } } });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, "INVALID_ARGUMENT");
  const inFlightWait = clients[0].callTool({ name: "wait_for_evidence", arguments: {
    panelSessionId: "npm-package-panel", pageEpoch: "installed-package-runtime", timeoutMs: 20000,
    after: { interval: { id: "package-interval", ordinal: 1 }, committedEvidenceBoundary: null, retainedRange: null }
  } });
  const waitRequest = await next();
  assert.equal(waitRequest.name, "wait_for_evidence");
  panel.close();
  const disconnected = await inFlightWait;
  assert.equal(disconnected.isError, true, "A lost Panel link must not look like a successful wait.");
  assert.equal(disconnected.structuredContent.error.code, "COMPANION_UNAVAILABLE", "An in-flight wait must expose connection loss as a machine-readable failure.");
  assert.match(disconnected.structuredContent.error.message, /may have an unknown outcome/i);
  assert.equal(disconnected.structuredContent.error.automaticRetry, false);
  const forbidden = await clients[0].callTool({ name: "execute_server_injection", arguments: {} });
  assert.equal(forbidden.isError, true);
} finally {
  panel?.terminate();
  await Promise.all(clients.map(client => client.close()));
  clearTimeout(timeout);
}
console.log(`Packaged MCP proof passed on ${process.platform}: ${artifact.filename}, ${artifact.size} bytes. npm bin, combined MCP/skill setup and update, shared broker, two MCP clients and exact panel routing.`);
console.log(`Installed test CLI: ${cli}`);
