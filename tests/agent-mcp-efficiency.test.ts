import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import { startPortableBroker } from "../src/agent/companion/portable-broker";
import { AGENT_PROTOCOL_VERSION } from "../src/agent/protocol";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import type { EvidenceFilter } from "../src/core/evidence-filter-contract";
import { createFilter } from "../src/core/filter-algebra";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

/** Protocol and full-process MCP proof over an isolated ephemeral loopback companion. */
describe("MCP query efficiency contract", () => {
  it("publishes bounded query, exact field selection, and summary schemas", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const listeners = new Set<(message: Record<string, unknown>) => void>();
    let panelMessage: ((message: Record<string, unknown>) => void) | undefined;
    const channel = {
      send(value: Record<string, unknown>) { queueMicrotask(() => panelMessage?.(value)); },
      onMessage(callback: (value: Record<string, unknown>) => void) { listeners.add(callback); },
      onClose() {},
      close() { listeners.clear(); }
    };
    // This first tracer intentionally checks only the advertised public contract.
    // The linked MCP transport exercises the actual SDK server and ListTools response.
    const server = createMcpServer(channel);
    const client = new Client({ name: "mcp-efficiency-tracer", version: "1" });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const { tools } = await client.listTools();
      const query = tools.find(tool => tool.name === "query_evidence");
      const summary = tools.find(tool => tool.name === "summarize_evidence");
      expect(query, "the production MCP endpoint advertises query_evidence").toBeDefined();
      expect(summary, "the production MCP endpoint advertises summarize_evidence").toBeDefined();
      expect(JSON.stringify(query?.inputSchema)).toContain("fields");
      expect(JSON.stringify(query?.inputSchema)).toContain("maxBytes");
      expect(JSON.stringify(query?.inputSchema)).toContain("within");
      expect(JSON.stringify(summary?.inputSchema)).toContain("facet");
      expect(JSON.stringify(summary?.outputSchema)).toContain("distinctTotal");
    } finally { await server.close(); await client.close(); }
  });

  it("performs the bounded COMMAND investigation through the built stdio MCP companion", async () => {
    if (!process.env.LSEW_AGENT_TEST_CLI) execFileSync(process.execPath, [join(process.cwd(), "scripts/build-agent.mjs")], { cwd: process.cwd(), stdio: "pipe" });
    const cli = process.env.LSEW_AGENT_TEST_CLI ?? join(process.cwd(), "agent/dist/cli.mjs");
    expect(existsSync(cli), `build the companion first with npm run agent:build (${cli})`).toBe(true);
    const history = createInMemoryEventHistory({ panelSessionId: "query-efficiency-proof" });
    await appendEvents(history, 0, 2_000);
    const firstRead = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: createFilter() as unknown as EvidenceFilter, includePayload: false });
    expect(firstRead.ok).toBe(true);
    const firstReadPoint = firstRead.ok ? firstRead.value.readPoint : null;
    await appendEvents(history, 2_000, 8_000);
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    const resources = await connectRealMcp(runtime, cli);
    try {
      const { call, callMeasured, panelSessionId } = resources;
      await waitFor(() => runtime.getSnapshot().scope.nodes.some((node: any) => node.kind === "item" && String(node.label).includes("eff-target-item-1")), "runtime topology replays the 10,000 committed records");
      const sessions = await call("list_panel_sessions");
      expect(sessions.items.map((entry: any) => entry.panelSessionId)).toContain(panelSessionId);
      const status = await call("get_status", { panelSessionId });
      expect(status.readContract?.version).toBe(2);
      expect(resources.responseBytes("get_status")).toBeLessThanOrEqual(8192);
      expect(status.capabilities).toContain("summarize_evidence");

      const subscriptions = await call("search_scope", { panelSessionId, text: "eff-target-subscription", kind: "subscription", limit: 25 });
      expect(resources.responseBytes("search_scope")).toBeLessThanOrEqual(8192);
      const parent = subscriptions.scopes.find((scope: any) => scope.kind === "subscription" && String(scope.label).includes("eff-target-subscription"));
      expect(parent, "scope discovery locates the exact target Subscription").toBeDefined();
      const discovered = await call("search_scope", { panelSessionId, text: "eff-target-item-1", kind: "item", parentScopeId: parent.scopeId, limit: 25 });
      expect(resources.responseBytes("search_scope")).toBeLessThanOrEqual(8192);
      const target = discovered.scopes.find((scope: any) => scope.kind === "item" && String(scope.label).includes("eff-target-item-1"));
      expect(target, "scope discovery locates the exact COMMAND item").toBeDefined();

      // A human Scenario is open while the stdio companion performs independent
      // retained reads. Its 40-row capture workspace is not an MCP query window.
      runtime.dispatch({ type: "select-evidence", eventId: "eff-event-9996" });
      await waitFor(() => runtime.getSnapshot().selectedEvidence?.id === "eff-event-9996", "human selects a retained capture");
      runtime.dispatch({ type: "begin-local-injection-from-selection" });
      await waitFor(() => runtime.getSnapshot().localInjection.draft?.phase === "edit", "human Draft loads its exact retained source before Scenario conversion");
      runtime.dispatch({ type: "convert-local-injection-to-scenario" });
      await waitFor(() => runtime.getSnapshot().scenario?.captureWorkspace.queryState === "ready", "human capture workspace loads all retained target Evidence");
      runtime.dispatch({ type: "set-scenario-capture-search", text: "KEY-" });
      await waitFor(() => runtime.getSnapshot().scenario?.captureWorkspace.queryState === "ready", "human capture search settles");
      runtime.dispatch({ type: "show-older-scenario-captures" });
      await waitFor(() => runtime.getSnapshot().scenario?.captureWorkspace.queryState === "ready", "human capture page settles");
      const capture = runtime.getSnapshot().scenario!.captureWorkspace.rows.find(row => row.available)!;
      runtime.dispatch({ type: "toggle-scenario-capture", identity: capture.identity });
      runtime.dispatch({ type: "set-scenario-capture-scroll", scrollTop: 183 });
      runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "SHARED-KEY" }] });
      runtime.dispatch({ type: "set-find", value: "SHARED-KEY" });
      await waitFor(() => !runtime.getSnapshot().evidence.findState.loading, "human Evidence Find settles");
      const humanWorkspace = () => {
        const snapshot = runtime.getSnapshot();
        return { scopeId: snapshot.scopeId, selectionEventId: snapshot.selectionEventId, filter: snapshot.evidence.investigation.filter, find: snapshot.evidence.find, scenario: snapshot.scenario };
      };
      const humanBefore = humanWorkspace();
      expect(humanBefore.scenario!.captureWorkspace.total).toBeGreaterThan(1_000);
      expect(humanBefore.scenario!.captureWorkspace.pageOffset).toBe(40);
      const searched = await callMeasured("search_evidence", { panelSessionId, within: "page", text: "KEY-", limit: 100 });
      expect(searched.bytes).toBeLessThanOrEqual(8192);
      expect(searched.value.nextCursor).toBeTruthy();
      const searchedNext = await callMeasured("search_evidence", { panelSessionId, cursor: searched.value.nextCursor });
      expect(searchedNext.bytes).toBeLessThanOrEqual(8192);
      expect(searchedNext.value.readPoint).toEqual(searched.value.readPoint);
      expect(humanWorkspace()).toEqual(humanBefore);

      const summaryResult = await callMeasured("summarize_evidence", { panelSessionId, scopeId: target.scopeId, facet: "key", limit: 40 });
      const summary = summaryResult.value;
      expect(summary.readPoint.committedEvidenceBoundary.sequence).toBe(10_000);
      expect(summary.facet).toBe("key");
      expect(summary.distinctTotal).toBe(13);
      expect(summary.values).toHaveLength(13);
      expect(summary.totals.matching).toBe(Math.floor(10_000 / 12));
      expect(summary.values.reduce((total: number, entry: any) => total + entry.count, 0)).toBe(Math.floor(10_000 / 12));
      expect(summary.countMeaning).toContain("Evidence records");
      const summaryBytes = summaryResult.bytes;
      const summaryMs = summaryResult.elapsedMs;

      // Reuse the summary boundary for examples; later Capture must not move it.
      expect(summary.nextCursor).toBeNull();
      const finalAt = history.status().committedEvidenceBoundary!.sequence;
      expect(finalAt).toBe(10_000);

      const updateFilter = { kind: ["ITEM-UPDATE"], mode: ["COMMAND"], operation: ["UPDATE"] };
      const compactFirst = await callMeasured("query_evidence", { panelSessionId, scopeId: target.scopeId, at: summary.readPoint, where: updateFilter, fields: ["quantity", "status"], limit: 100 });
      expect(compactFirst.bytes).toBeLessThanOrEqual(8192);
      expect(compactFirst.value.readPoint.committedEvidenceBoundary.sequence).toBe(finalAt);
      expect(compactFirst.value.evidence.length).toBeGreaterThan(0);
      expect(compactFirst.value.evidence.every((row: any) => row.item === "eff-target-item-1")).toBe(true);
      expect(compactFirst.value.evidence.every((row: any) => Object.keys(row.fields).sort().join(",") === "quantity,status")).toBe(true);
      expect(JSON.stringify(compactFirst.value)).not.toContain("REDACTED-SECRET-SENTINEL");
      expect(compactFirst.value.nextCursor).toBeTruthy();
      expect(compactFirst.value.totals.matching).toBe(Math.floor(10_000 / 12));
      await appendEvents(history, 10_000, 1);

      const exact = await callMeasured("get_evidence", { panelSessionId, evidence: compactFirst.value.evidence[0].identity, fields: ["quantity", "status"] });
      expect(exact.value.lookup.state).toBe("RETAINED");
      expect(Object.keys(exact.value.lookup.evidence.fields).sort()).toEqual(["quantity", "status"]);
      expect(JSON.stringify(exact.value)).not.toContain("REDACTED-SECRET-SENTINEL");
      const goldenCalls = resources.callCount() - 2; // list_panel_sessions and get_status are setup discovery.

      const historical = await callMeasured("summarize_evidence", { panelSessionId, scopeId: target.scopeId, at: firstReadPoint, facet: "key", limit: 40 });
      expect(historical.value.readPoint.committedEvidenceBoundary.sequence).toBe(2_000);
      expect(historical.value.distinctTotal).toBe(13);
      expect(historical.value.totals.matching).toBe(166);
      expect(historical.value.values.reduce((sum: number, entry: any) => sum + entry.count, 0)).toBe(166);

      const continuation = await callMeasured("query_evidence", { panelSessionId, cursor: compactFirst.value.nextCursor });
      expect(continuation.value.readPoint).toEqual(compactFirst.value.readPoint);
      expect(continuation.value.readPoint.committedEvidenceBoundary.sequence).toBe(10_000);
      expect(continuation.value.evidence[0].identity.sequence).toBeGreaterThan(compactFirst.value.evidence.at(-1).identity.sequence);
      expect(continuation.value.evidence.every((row: any) => row.item === "eff-target-item-1")).toBe(true);
      await expectToolError(call, "query_evidence", { panelSessionId, cursor: compactFirst.value.nextCursor, limit: 1 }, "cursor");
      await expectToolError(call, "query_evidence", { panelSessionId, cursor: "expired-cursor" }, "cursor");

      const repeatedKey = await callMeasured("query_evidence", { panelSessionId, scopeId: target.scopeId, where: { ...updateFilter, key: ["SHARED-KEY"] }, fields: ["quantity", "status"], limit: 20 });
      expect(repeatedKey.value.totals.matching).toBe(8);
      expect(repeatedKey.value.evidence.every((row: any) => row.item === "eff-target-item-1")).toBe(true);

      // Measure the same three matching rows as full envelopes with explicit
      // payload opt-in, then compare the MCP CallToolResult wire structures.
      const legacy = await callMeasured("query_evidence", { panelSessionId, scopeId: target.scopeId, where: updateFilter, includePayload: true, limit: 3, maxBytes: 65_536 });
      const compactThree = await callMeasured("query_evidence", { panelSessionId, scopeId: target.scopeId, where: updateFilter, fields: ["quantity", "status"], limit: 3 });
      expect(legacy.value.evidence).toHaveLength(3);
      expect(compactThree.value.evidence).toHaveLength(3);
      expect(compactThree.value.evidence.map((row: any) => row.identity)).toEqual(legacy.value.evidence.map((row: any) => row.identity));
      const payloadNext = await callMeasured("query_evidence", { panelSessionId, cursor: legacy.value.nextCursor }, true);
      expect(payloadNext.value.readPoint).toEqual(legacy.value.readPoint);
      expect(payloadNext.value.evidence[0].identity.sequence).toBeGreaterThan(legacy.value.evidence.at(-1).identity.sequence);
      const humanAfterCapture = humanWorkspace();
      expect(humanBefore.scenario!.captureWorkspace.newerAcceptedEvidenceCount).toBe(0);
      expect(humanAfterCapture.scenario!.captureWorkspace.newerAcceptedEvidenceCount).toBe(1);
      expect({ ...humanAfterCapture, scenario: { ...humanAfterCapture.scenario!,
        captureWorkspace: { ...humanAfterCapture.scenario!.captureWorkspace, newerAcceptedEvidenceCount: 0 }
      } }).toEqual(humanBefore);
      const reduction = 1 - compactThree.bytes / legacy.bytes;
      expect(reduction).toBeGreaterThan(0.5);
      expect(resources.worstResponseBytes()).toBeLessThanOrEqual(8192);

      console.log(JSON.stringify({ proof: "stdio-mcp+loopback-ws+real-runtime", historyRecords: finalAt, goldenCalls, totalMcpCalls: resources.callCount(), worstDefaultResponseBytes: resources.worstResponseBytes(), summaryBytes, summaryMs: +summaryMs.toFixed(1), queryMs: +compactFirst.elapsedMs.toFixed(1), compactThreeBytes: compactThree.bytes, legacyThreeBytes: legacy.bytes, byteReductionPercent: +(reduction * 100).toFixed(2), matchingTargetUpdates: compactFirst.value.totals.matching, unrelatedRecords: 0, continuationCount: continuation.value.evidence.length }));
    } finally {
      await resources.close();
      await runtime.disposeAndWait();
    }
  }, 300_000);
});

async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Could not allocate an ephemeral port.");
  const port = address.port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}

async function connectRealMcp(runtime: WorkbenchRuntime, cli: string) {
  const extensionId = "a".repeat(32), port = await freePort(), panelSessionId = `mcp-efficiency-${port}`;
  let callCount = 0;
  let worstResponseBytes = 0;
  const responseBytes = new Map<string, number>();
  const broker = await startPortableBroker({ auth: "off", port }, extensionId);
  const panel = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: { Origin: `chrome-extension://${extensionId}` } });
  const queue: Record<string, unknown>[] = [], readers: ((value: Record<string, unknown>) => void)[] = [];
  panel.on("message", data => { const message = JSON.parse(data.toString()); const reader = readers.shift(); if (reader) reader(message); else queue.push(message); });
  const nextPanelMessage = () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, unknown>>(resolve => readers.push(resolve));
  await once(panel, "open");
  panel.send(JSON.stringify({ type: "connect", role: "panel", auth: "off" }));
  expect(await nextPanelMessage()).toEqual({ type: "connected", auth: "off", identity: expect.objectContaining({ extensionId, protocolVersion: AGENT_PROTOCOL_VERSION, readContractVersion: 2 }) });
  panel.send(JSON.stringify({ role: "panel", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, permission: "read" }));
  expect(await nextPanelMessage()).toEqual({ type: "ready" });
  const service = createAgentServiceForRuntime(runtime, panelSessionId);
  panel.on("message", data => {
    const message = JSON.parse(data.toString()) as Record<string, any>;
    if (message.type || typeof message.id !== "string") return;
    void service(message.name, message.args).then(result => panel.send(JSON.stringify({ id: message.id, result })), error => panel.send(JSON.stringify({ id: message.id, error: error instanceof Error ? error.message : String(error) })));
  });
  const client = new Client({ name: "mcp-efficiency-stdio-proof", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--extension-id", extensionId, "--port", String(port)], env: { LSEW_AGENT_CONNECTION: "" }, stderr: "inherit" });
  await client.connect(transport);
  return {
    panelSessionId,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      callCount++;
      const result = await client.callTool({ name, arguments: args });
      responseBytes.set(name, serializedResultBytes(result));
      worstResponseBytes = Math.max(worstResponseBytes, serializedResultBytes(result));
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
      return result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    },
    callMeasured: async (name: string, args: Record<string, unknown> = {}, inheritsLargerBudget = false) => {
      callCount++;
      const started = performance.now();
      const result = await client.callTool({ name, arguments: args });
      const bytes = serializedResultBytes(result);
      responseBytes.set(name, bytes);
      if (!inheritsLargerBudget && (args.maxBytes === undefined || Number(args.maxBytes) <= 8192)) worstResponseBytes = Math.max(worstResponseBytes, bytes);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
      return { value: result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0]!.text), bytes, elapsedMs: performance.now() - started };
    },
    callCount: () => callCount,
    responseBytes: (name: string) => responseBytes.get(name) ?? 0,
    worstResponseBytes: () => worstResponseBytes,
    close: async () => { await client.close(); panel.close(); broker.close(); }
  };
}

import { createAgentService } from "../src/extension/panel/agent-service";
function createAgentServiceForRuntime(runtime: WorkbenchRuntime, panelSessionId: string) {
  const service = createAgentService(runtime.agent!, panelSessionId, () => "read");
  return (name: string, args: Record<string, unknown>) => service.call(name, args);
}

function envelope(sequence: number): LightstreamerEventEnvelope {
  const ownItem = sequence % 2 === 0 ? `eff-target-item-${1 + Math.floor(sequence / 2) % 6}` : `eff-other-item-${1 + sequence % 2}`;
  const target = ownItem.startsWith("eff-target");
  const clientId = target || sequence % 3 !== 0 ? "eff-client-a" : "eff-client-b";
  const subscriptionId = target ? "eff-target-subscription" : `eff-unrelated-subscription-${clientId}`;
  const key = sequence % 97 === 0 ? "SHARED-KEY" : `KEY-${String(Math.floor(sequence / 12) % 12).padStart(2, "0")}`;
  const quantity = sequence % 100;
  const fields = { command: "UPDATE", key, quantity, status: sequence % 2 ? "open" : "closed", telemetry: "X".repeat(300), profile: "Y".repeat(300), note: sequence === 12 ? "REDACTED-SECRET-SENTINEL" : "Z".repeat(300), password: "[REDACTED:password]" };
  return {
    id: `eff-event-${sequence}`, timestamp: sequence, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: clientId, sessionId: `eff-session-${clientId}`, status: "CONNECTED:WS-STREAMING" },
    subscription: { id: subscriptionId, mode: "COMMAND", items: [ownItem], fields: Object.keys(fields), active: true, subscribed: true },
    listener: { id: `eff-listener-${subscriptionId}`, callbacks: ["onItemUpdate"] }, item: { name: ownItem, position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "eff-proof-page", captureSequence: sequence, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    update: { isSnapshot: false, command: "UPDATE", key, fields, changedFields: fields }
  } as LightstreamerEventEnvelope;
}

async function appendEvents(history: EventHistory, offset: number, count: number) {
  for (let start = 0; start < count; start += 100) {
    const batchCount = Math.min(100, count - start);
    const receipts = Array.from({ length: batchCount }, (_, index) => history.offer(envelope(offset + start + index + 1)));
    const outcomes = await Promise.all(receipts.map((receipt: any) => receipt.settled));
    const failures = outcomes.filter((outcome: any) => outcome.outcome !== "BECAME_EVIDENCE");
    expect(failures.length, `all ${batchCount} synthetic records enter real Event History; rejected=${failures.length}, problem=${failures[0]?.problem?.code ?? "none"}`).toBe(0);
  }
  return history.status().committedEvidenceBoundary!.sequence;
}

async function expectToolError(call: (name: string, args?: Record<string, unknown>) => Promise<any>, name: string, args: Record<string, unknown>, message: string) {
  await expect(call(name, args)).rejects.toThrow(new RegExp(message, "i"));
}

async function waitFor(check: () => boolean, description: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function serializedResultBytes(result: unknown) {
  const output = result as { content?: unknown; structuredContent?: unknown };
  return new TextEncoder().encode(JSON.stringify({ content: output.content, structuredContent: output.structuredContent })).byteLength;
}
