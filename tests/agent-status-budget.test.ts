import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createServer } from "node:net";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { startPortableBroker } from "../src/agent/companion/portable-broker";
import { AGENT_PROTOCOL_VERSION } from "../src/agent/protocol";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import type { EventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createFilter } from "../src/core/filter-algebra";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

const histories: EventHistory[] = [];

afterEach(async () => {
  await Promise.all(histories.splice(0).map(history => history.close()));
});

describe("MCP status response budget", () => {
  it("keeps IndexedDB diagnostics out of MCP context while preserving explicit Evidence reads", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    if (!process.env.LSEW_AGENT_TEST_CLI) {
      execFileSync(process.execPath, [join(process.cwd(), "scripts/build-agent.mjs")], { cwd: process.cwd(), stdio: "pipe" });
    }
    const cli = process.env.LSEW_AGENT_TEST_CLI ?? join(process.cwd(), "agent/dist/cli.mjs");
    expect(existsSync(cli), `build the companion first with npm run agent:build (${cli})`).toBe(true);

    const history = await createIndexedDbEventHistory({ panelSessionId: `agent-status-budget-${Date.now()}` });
    histories.push(history);
    await appendRealisticEvidence(history, 265);
    const cached = await history.query!({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: 60 },
      filter: createFilter() as any,
      includePayload: true
    });
    expect(cached.ok).toBe(true);
    if (!cached.ok) throw new Error(cached.problem.message);
    expect(cached.value.page.evidence).toHaveLength(60);
    expect(JSON.stringify(history.status())).toContain("lastCoherentQuery");

    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    const mcp = await connectRealMcp(runtime, cli);
    try {
      await waitFor(() => runtime.agent!.scopeSearchSnapshot().nodes.filter(node => node.kind === "subscription").length >= 9, "runtime topology replays all nine Subscriptions");
      const warmedCache = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 60 },
        filter: createFilter() as any,
        includePayload: true
      });
      expect(warmedCache.ok).toBe(true);
      const cachedStatus = JSON.stringify(history.status()).toLowerCase();
      expect(cachedStatus).toContain("lastcoherentquery");
      expect(cachedStatus).toContain("status-search-text-sentinel");

      const focusedNodeBefore = runtime.getSnapshot().scope.focusedNodeId;
      const status = await mcp.call("get_status", { panelSessionId: mcp.panelSessionId });
      expect(mcp.bytes("get_status")).toBeLessThanOrEqual(8192);
      const statusJson = JSON.stringify(status).toLowerCase();
      for (const secret of ["status-search-text-sentinel", "captured-field-sentinel", "client-message-sentinel", "client-message-response-sentinel", "raw-envelope-sentinel"]) {
        expect(statusJson).not.toContain(secret);
      }
      expect(statusJson).not.toContain("lastcoherentquery");
      expect(statusJson).not.toContain("searchtext");
      expect(status.readContract.version).toBe(2);
      console.log(JSON.stringify({ proof: "indexeddb+runtime+stdio-mcp-status-budget", statusResponseBytes: mcp.bytes("get_status"), cachedHistoryStatusBytes: new TextEncoder().encode(cachedStatus).byteLength }));

      const firstScopes = await mcp.call("list_scope", { panelSessionId: mcp.panelSessionId, limit: 100 });
      expect(mcp.bytes("list_scope")).toBeLessThanOrEqual(8192);
      expect(firstScopes.total).toBeGreaterThanOrEqual(9);
      expect(firstScopes.nodes.length).toBeGreaterThan(0);
      expect(firstScopes).toHaveProperty("nextOffset");
      if (typeof firstScopes.nextOffset === "number") {
        const remainingScopes = await mcp.call("list_scope", { panelSessionId: mcp.panelSessionId, offset: firstScopes.nextOffset, limit: 100 });
        expect(mcp.bytes("list_scope")).toBeLessThanOrEqual(8192);
        expect(remainingScopes.nodes.length).toBeGreaterThan(0);
        expect(remainingScopes.total).toBe(firstScopes.total);
        expect(remainingScopes.nodes[0].id).not.toBe(firstScopes.nodes[0].id);
      }

      const queried = await mcp.call("query_evidence", {
        panelSessionId: mcp.panelSessionId,
        within: "page",
        limit: 5,
        fields: ["quantity", "state"]
      });
      expect(mcp.bytes("query_evidence")).toBeLessThanOrEqual(8192);
      expect(queried.evidence.length).toBeGreaterThan(0);
      expect(queried.evidence.length).toBeLessThanOrEqual(5);
      expect(queried.readPoint.committedEvidenceBoundary.sequence).toBe(265);
      expect(queried.evidence.every((row: any) => row.fields.quantity !== undefined && row.fields.state !== undefined)).toBe(true);
      expect(JSON.stringify(queried).toLowerCase()).not.toContain("captured-field-sentinel");
      expect(runtime.getSnapshot().scope.focusedNodeId).toBe(focusedNodeBefore);
    } finally {
      await mcp.close();
      await runtime.disposeAndWait();
    }
  }, 120_000);
});

function event(sequence: number): LightstreamerEventEnvelope {
  const clientId = `budget-client-${sequence % 3}`;
  const itemName = `budget-item-${sequence % 9}`;
  const clientMessage = sequence % 23 === 0 ? "client-message-sentinel" : `message-${sequence}`;
  const fields = {
    command: sequence % 4 === 0 ? "DELETE" : "UPDATE",
    key: `budget-key-${sequence % 17}`,
    quantity: sequence,
    state: sequence % 2 ? "active" : "idle",
    largeDetail: `captured-field-sentinel-${"d".repeat(280)}`,
    privateNote: `status-search-text-sentinel-${"p".repeat(280)}`,
    rawEnvelope: `raw-envelope-sentinel-${"r".repeat(280)}`
  };
  return {
    id: `budget-event-${sequence}`,
    timestamp: sequence,
    direction: sequence % 23 === 0 ? "outbound" : "inbound",
    source: sequence % 23 === 0 ? "application" : "server",
    captureSource: "listener",
    synthetic: false,
    kind: sequence % 23 === 0 ? "client-message-processed" : "item-update",
    client: { id: clientId, sessionId: `budget-session-${clientId}`, status: "CONNECTED:WS-STREAMING" },
    subscription: { id: `budget-subscription-${sequence % 9}`, mode: "COMMAND", items: [itemName], fields: Object.keys(fields), active: true, subscribed: true },
    listener: { id: `budget-listener-${sequence % 9}`, callbacks: ["onItemUpdate"] },
    item: { name: itemName, position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "budget-page", captureSequence: sequence, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(sequence % 23 === 0 ? {
      clientMessage: { id: `budget-message-${sequence}`, pageEpoch: "budget-page", message: clientMessage, messageState: "available", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available", response: "client-message-response-sentinel" },
      raw: { duplicate: clientMessage }
    } : { update: { isSnapshot: false, command: fields.command, key: fields.key, fields, changedFields: fields } })
  };
}

async function appendRealisticEvidence(history: EventHistory, count: number) {
  for (let offset = 1; offset <= count; offset += 1) {
    const receipt = history.offer(event(offset));
    const outcome = await receipt.settled;
    expect(outcome.outcome, `Evidence ${offset} is accepted`).toBe("BECAME_EVIDENCE");
  }
}

async function waitFor(check: () => boolean, description: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate an ephemeral port.");
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function connectRealMcp(runtime: WorkbenchRuntime, cli: string) {
  const extensionId = "b".repeat(32);
  const port = await freePort();
  const panelSessionId = `mcp-status-budget-${port}`;
  const broker = await startPortableBroker({ auth: "off", port }, extensionId);
  const panel = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: { Origin: `chrome-extension://${extensionId}` } });
  const queue: Record<string, any>[] = [];
  const readers: ((value: Record<string, any>) => void)[] = [];
  panel.on("message", data => {
    const message = JSON.parse(data.toString());
    const reader = readers.shift();
    if (reader) reader(message);
    else queue.push(message);
  });
  const nextPanelMessage = () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, any>>(resolve => readers.push(resolve));
  await once(panel, "open");
  panel.send(JSON.stringify({ type: "connect", role: "panel", auth: "off" }));
  expect(await nextPanelMessage()).toEqual({ type: "connected", auth: "off" });
  panel.send(JSON.stringify({ role: "panel", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, permission: "read" }));
  expect(await nextPanelMessage()).toEqual({ type: "ready" });

  const service = createAgentService(runtime.agent!, panelSessionId, () => "read");
  panel.on("message", data => {
    const message = JSON.parse(data.toString()) as Record<string, any>;
    if (message.type || typeof message.id !== "string") return;
    void service.call(message.name, message.args).then(
      result => panel.send(JSON.stringify({ id: message.id, result })),
      error => panel.send(JSON.stringify({ id: message.id, error: error instanceof Error ? error.message : String(error) }))
    );
  });

  const client = new Client({ name: "mcp-status-budget-proof", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--extension-id", extensionId, "--port", String(port)],
    env: { LSEW_AGENT_CONNECTION: "" },
    stderr: "inherit"
  });
  await client.connect(transport);
  const responseBytes = new Map<string, number>();
  return {
    panelSessionId,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      responseBytes.set(name, new TextEncoder().encode(JSON.stringify({ content: result.content, structuredContent: result.structuredContent })).byteLength);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
      return result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    },
    bytes: (name: string) => responseBytes.get(name) ?? 0,
    close: async () => { await client.close(); panel.close(); broker.close(); }
  };
}
