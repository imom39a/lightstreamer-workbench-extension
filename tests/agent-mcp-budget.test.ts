import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import type { CompanionChannel } from "../src/agent/portable-channel";
import { AGENT_TOOLS } from "../src/agent/protocol";

const identity = { intervalId: "i", pageId: "p", ownerId: "o", sequence: 1, eventId: "e" };
const readPoint = { interval: { id: "i", ordinal: 1 }, committedEvidenceBoundary: identity, retainedRange: { first: identity, last: identity } };

const argumentsByTool: Record<string, Record<string, unknown>> = {
  list_panel_sessions: {}, get_pairing_requests: {}, confirm_pairing: { requestId: "pairing", code: "1234-5678" },
  get_status: {}, list_scope: {}, search_scope: { text: "item" }, get_scope: { scopeId: "page" },
  query_evidence: { within: "page" }, search_evidence: { within: "page", text: "item" }, summarize_evidence: { within: "page" }, describe_stream: {},
  wait_for_evidence: { after: readPoint, pageEpoch: "epoch" }, get_evidence: { evidence: identity }, query_diagnostics: {},
  update_agent_document: { token: "token", document: "{}" }, prepare_local_injection: { pageEpoch: "epoch", scopeId: "page" },
  execute_local_injection: { token: "token", requestId: "injection" }, get_operation: { requestId: "injection" },
  validate_agent_candidate: { pageEpoch: "epoch", draft: { scopeId: "page" } },
  prepare_scenario: { pageEpoch: "epoch", steps: [{ scopeId: "page" }] },
  control_scenario: { runId: "run", requestId: "control", action: "pause" }, get_scenario_trace: {}, finish_agent_document: { token: "token" }
};

describe("MCP read budget backstop", () => {
  it("keeps the static tool catalog within its separate discovery budget", async () => {
    const channel: CompanionChannel = { send() {}, onMessage() {}, onClose() {}, close() {} };
    const server = createMcpServer(channel);
    const client = new Client({ name: "catalog-budget-proof", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const catalog = await client.listTools();
      // Discovery loads the complete callable contract once. It is deliberately
      // measured separately from the 8 KiB budget for each tool response.
      expect(new TextEncoder().encode(JSON.stringify(catalog)).byteLength).toBeLessThanOrEqual(80 * 1024);
    } finally { await client.close(); await server.close(); }
  });

  it("bounds every advertised tool before oversized internal data reaches an MCP client", async () => {
    // Include valid success fields for every declared output schema. This tests
    // the real transport guard, rather than relying on SDK schema rejection.
    const reply = {
      readPoint, totals: { matching: 0, inScope: 0 }, coverage: "COMPLETE", evaluation: "COMPLETE", storage: "MEMORY_FALLBACK",
      discoveries: {}, nextCursor: null, evidence: [], omissions: [], countMeaning: "Evidence records", values: [], distinctTotal: 0,
      matchingTotal: 0, sampled: 0, completeness: "COMPLETE", status: "TIMED_OUT", reason: "timeout", after: readPoint,
      mayHaveMoreMatches: false, legacyDump: "oversized-private-data".repeat(10_000)
    };
    let receive: (message: Record<string, unknown>) => void = () => {};
    const channel: CompanionChannel = {
      send(message) { if (message.id) queueMicrotask(() => receive({ id: message.id, result: reply })); },
      onMessage(callback) { receive = callback; }, onClose() {}, close() {}
    };
    const server = createMcpServer(channel);
    const client = new Client({ name: "all-tools-budget-proof", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(Object.keys(argumentsByTool).sort()).toEqual(AGENT_TOOLS.map(tool => tool.name).sort());
      for (const tool of AGENT_TOOLS) {
        const global = ["list_panel_sessions", "get_pairing_requests", "confirm_pairing"].includes(tool.name);
        const result = await client.callTool({ name: tool.name, arguments: { ...(global ? {} : { panelSessionId: "p" }), ...argumentsByTool[tool.name] } });
        const serialized = JSON.stringify(result);
        expect(new TextEncoder().encode(serialized).byteLength, `${tool.name} must have a serialized default budget`).toBeLessThanOrEqual(8192);
        expect(serialized, `${tool.name} must not leak the oversized source`).not.toContain("oversized-private-data");
        expect(result.isError).toBe(true);
        expect(result.structuredContent, `${tool.name} reports an actionable budget failure`).toMatchObject({ error: {
          code: ["execute_local_injection", "control_scenario"].includes(tool.name) ? "DELIVERY_UNKNOWN" : "RESULT_BUDGET_EXCEEDED",
          automaticRetry: false
        } });
      }
    } finally { await client.close(); await server.close(); }
  });

  it.each(["💥\\\"", "\u0000", "\ud800"])("bounds older-panel errors containing heavily escaped text (%j)", async marker => {
    let receive: (message: Record<string, unknown>) => void = () => {};
    const channel: CompanionChannel = {
      send(message) { if (message.id) queueMicrotask(() => receive({ id: message.id, error: `QUERY_FAILED: ${marker.repeat(30_000)}` })); },
      onMessage(callback) { receive = callback; }, onClose() {}, close() {}
    };
    const server = createMcpServer(channel);
    const client = new Client({ name: "error-budget-proof", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "get_status", arguments: { panelSessionId: "p" } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { code: "QUERY_FAILED", automaticRetry: false } });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(8192);
    } finally { await client.close(); await server.close(); }
  });

  it("refuses oversized replies from an incompatible panel before exposing their contents", async () => {
    let receive: (message: Record<string, unknown>) => void = () => {};
    let payloadSize = 6_000;
    const channel: CompanionChannel = {
      send(message) {
        if (message.id) queueMicrotask(() => receive({ id: message.id, result: { legacyDump: "private-sentinel".repeat(payloadSize) } }));
      },
      onMessage(callback) { receive = callback; }, onClose() {}, close() {}
    };
    const server = createMcpServer(channel);
    const client = new Client({ name: "mcp-budget-proof", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "get_evidence", arguments: { panelSessionId: "p", evidence: identity } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { code: "RESULT_BUDGET_EXCEEDED", automaticRetry: false } });
      expect(JSON.stringify(result)).not.toContain("private-sentinel");
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(4096);

      payloadSize = 300;
      const explicit = await client.callTool({ name: "get_evidence", arguments: { panelSessionId: "p", evidence: identity, maxBytes: 16_384 } });
      expect(explicit.isError).not.toBe(true);
      expect(explicit.structuredContent).toHaveProperty("legacyDump");

      payloadSize = 6_000;
      const cursor = await client.callTool({ name: "query_evidence", arguments: { panelSessionId: "p", cursor: "c" } });
      expect(cursor.structuredContent).toMatchObject({ error: { code: "RESULT_BUDGET_EXCEEDED" } });
    } finally { await client.close(); await server.close(); }
  });
});
