import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import type { CompanionChannel } from "../src/agent/portable-channel";

const identity = { intervalId: "i", pageId: "p", ownerId: "o", sequence: 1, eventId: "e" };

describe("MCP read budget backstop", () => {
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
