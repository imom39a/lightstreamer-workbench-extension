// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import { createBrokerRouter } from "../src/agent/companion/router";
import type { BrokerPeer } from "../src/agent/companion/router";
import type { CompanionChannel } from "../src/agent/portable-channel";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

async function fixture() {
  const pairingRequests = Array.from({ length: 80 }, (_, index) => ({
    requestId: `request-${index}-${"p".repeat(96)}`, code: `${index}`.padStart(9, "0"), expiresAt: 1_000_000
  }));
  const router = createBrokerRouter({ list: () => pairingRequests, confirm: () => ({ confirmed: true }) });
  const panelIds = Array.from({ length: 100 }, (_, index) => `panel-${index}-${"s".repeat(96)}`);
  for (const [index, panelSessionId] of panelIds.entries()) {
    const peer: BrokerPeer = { send() {}, close() { throw new Error("Panel unexpectedly closed."); } };
    router.join(peer, { role: "panel", protocolVersion: 1, panelSessionId, tabId: index + 1, permission: "read", extensionOrigin: "chrome-extension://fixture" });
  }
  let incoming: (message: Record<string, unknown>) => void = () => {};
  const agentPeer: BrokerPeer = { send(message) { if (message.type !== "ready") incoming(message); }, close() { throw new Error("Agent unexpectedly closed."); } };
  const route = router.join(agentPeer, { role: "agent" });
  const channel: CompanionChannel = {
    send(message) { if (message.role !== "agent") route.receive(message); },
    onMessage(callback) { incoming = callback; }, onClose() {}, close() {}
  };
  const server = createMcpServer(channel);
  const client = new Client({ name: "global-pagination-proof", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, router, panelIds, pairingRequests };
}

describe("global Workbench list pagination", () => {
  it("preserves small legacy arrays and gives large live lists truthful bounded pages", async () => {
    const { client, server, router, panelIds, pairingRequests } = await fixture();
    try {
      for (const [name, expected, key] of [
        ["list_panel_sessions", panelIds, "panelSessionId"],
        ["get_pairing_requests", pairingRequests.map(request => request.requestId), "requestId"]
      ] as const) {
        const legacy = await client.callTool({ name, arguments: {} });
        expect(legacy.isError).toBe(true);
        expect(legacy.structuredContent).toMatchObject({ error: { code: "RESULT_BUDGET_EXCEEDED" } });
        expect(JSON.stringify(legacy)).toContain("offset:0");
        const seen: string[] = [];
        let offset: number | null = 0;
        let pages = 0;
        while (offset !== null) {
          const response = await client.callTool({ name, arguments: { offset, limit: 100 } });
          expect(response.isError).not.toBe(true);
          expect(bytes(response)).toBeLessThanOrEqual(8192);
          const page = response.structuredContent as { items: Record<string, string>[]; total: number; offset: number; nextOffset: number | null };
          expect(page.total).toBe(expected.length);
          expect(page.offset).toBe(offset);
          expect(page.items.length).toBeGreaterThan(0);
          seen.push(...page.items.map(item => item[key]));
          expect(page.nextOffset).toBe(seen.length < expected.length ? seen.length : null);
          offset = page.nextOffset;
          expect(++pages).toBeLessThan(expected.length + 1);
        }
        expect(pages).toBeGreaterThan(1);
        expect(seen).toEqual(expected);
      }
    } finally { await client.close(); await server.close(); router.dispose(); }
  });

  it("keeps the legacy array shape when a global list is small", async () => {
    const router = createBrokerRouter();
    let reply: Record<string, unknown> | null = null;
    const peer: BrokerPeer = { send(value) { if (value.type !== "ready") reply = value; }, close() {} };
    const route = router.join(peer, { role: "agent" });
    route.receive({ id: "empty", name: "list_panel_sessions", args: {} });
    expect(reply).toMatchObject({ id: "empty", result: [] });
    route.receive({ id: "paged", name: "list_panel_sessions", args: { offset: 0, limit: 10 } });
    expect(reply).toMatchObject({ id: "paged", result: { items: [], total: 0, offset: 0, nextOffset: null } });
    router.dispose();
  });
});
