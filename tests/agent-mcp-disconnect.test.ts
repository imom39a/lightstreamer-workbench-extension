import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CompanionChannel } from "../src/agent/portable-channel";
import { createMcpServer } from "../src/agent/companion/mcp";

describe("MCP companion loss", () => {
  it("returns a structured connection error for an in-flight call before closing the client", async () => {
    let closeCompanion: (() => void) | undefined;
    let sent: Record<string, unknown> | undefined;
    const channel: CompanionChannel = {
      send(value) { if (value.id) sent = value; },
      onMessage() {},
      onClose(callback) { closeCompanion = callback; },
      close() { closeCompanion?.(); }
    };
    const server = createMcpServer(channel);
    const client = new Client({ name: "mcp-disconnect-proof", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const inFlight = client.callTool({ name: "wait_for_evidence", arguments: {
      panelSessionId: "panel", pageEpoch: "page", timeoutMs: 20000,
      after: { interval: { id: "interval", ordinal: 1 }, committedEvidenceBoundary: null, retainedRange: null }
    } });
    await vi.waitFor(() => expect(sent?.name).toBe("wait_for_evidence"));
    closeCompanion!();

    const result = await inFlight;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "COMPANION_UNAVAILABLE",
        automaticRetry: false
      }
    });
    expect((result.structuredContent as any).error.message).toMatch(/may have an unknown outcome/);
    await client.close();
  });
});
