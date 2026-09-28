import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { AGENT_READ_CONTRACT, AGENT_TOOLS, validateAgentCall } from "../protocol";
import metadata from "../../../agent/package.json";
import { connectPortableBroker } from "./portable-broker";
import type { PortableConfig } from "../portable-config";
import type { CompanionChannel } from "../portable-channel";
import { agentToolFailure, agentToolResult, agentToolResultBytes } from "./tool-result";

const compactReads = new Set(["search_scope", "query_evidence", "search_evidence", "summarize_evidence", "get_evidence"]);

/** Build the MCP interface over one already-connected companion channel. */
export function createMcpServer(channel: CompanionChannel) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  channel.onMessage(message => {
    const callback = pending.get(String(message.id));
    if (!callback) return;
    pending.delete(String(message.id));
    if (typeof message.error === "string") callback.reject(new Error(message.error));
    else callback.resolve(message.result);
  });
  channel.send({ role: "agent" });
  const server = new Server({ name: "lightstreamer-workbench", version: metadata.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AGENT_TOOLS.map(({ mutation: _mutation, ...tool }) => tool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { validateAgentCall(request.params.name, request.params.arguments ?? {}); }
    catch (error) { return agentToolFailure(error, "INVALID_ARGUMENT"); }
    try {
      if (pending.size >= 64) throw new Error("REQUEST_CAPACITY: Too many pending Workbench calls.");
      const result = await new Promise<unknown>((resolve, reject) => {
        const id = randomUUID();
        const cancel = () => {
          try { channel.send({ type: "cancel", id }); } catch { /* Connection may already be closed. */ }
          settle(new Error("QUERY_CANCELLED: The request was cancelled. A delivery may already have occurred; inspect its existing requestId before any further execution."));
        };
        const timer = setTimeout(() => {
          try { channel.send({ type: "cancel", id }); } catch { /* The result remains uncertain. */ }
          settle(new Error("DELIVERY_UNKNOWN: Workbench reply timed out. Inspect the existing operation; do not repeat an execution."));
        }, 35000);
        function settle(error?: Error, value?: unknown) {
          pending.delete(id); clearTimeout(timer); extra.signal.removeEventListener("abort", cancel);
          if (error) reject(error); else resolve(value);
        }
        pending.set(id, { resolve: value => settle(undefined, value), reject: error => settle(error) });
        extra.signal.addEventListener("abort", cancel, { once: true });
        if (extra.signal.aborted) { cancel(); return; }
        try { channel.send({ id, name: request.params.name, args: request.params.arguments ?? {} }); }
        catch (error) { settle(error instanceof Error ? error : new Error("COMPANION_UNAVAILABLE: Could not send the request.")); }
      });
      // The owning panel fits each page to its saved budget. This final transport
      // cap also protects a new companion connected to an older panel build.
      // Cursor budgets live in the panel, so only the absolute ceiling is known
      // here for a continuation; never cache Evidence or query state in the broker.
      const args = request.params.arguments ?? {};
      const budget = args.cursor ? AGENT_READ_CONTRACT.maxBytes : Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
      if (compactReads.has(request.params.name) && agentToolResultBytes(result) > budget) {
        throw new Error("RESULT_BUDGET_EXCEEDED: The connected panel exceeded the read response budget. Use matching extension and companion builds, then start a fresh narrower query or select fewer fields.");
      }
      return agentToolResult(result);
    } catch (error) { return agentToolFailure(error); }
  });
  channel.onClose(() => {
    const unavailable = new Error("COMPANION_UNAVAILABLE: Companion connection closed. An in-flight operation may have an unknown outcome; inspect its existing requestId/receipt and do not retry automatically.");
    for (const callback of pending.values()) callback.reject(unavailable);
    pending.clear();
    // Let rejected handlers emit their structured failure envelopes before closing
    // the MCP transport, which otherwise aborts those in-flight requests.
    setImmediate(() => { void server.close(); });
  });
  return server;
}

export async function runMcp(cli: string, connection: { config: PortableConfig; extensionId: string }) {
  const channel = await connectPortableBroker(cli, connection.config, connection.extensionId);
  const server = createMcpServer(channel);
  // npm/npx may launch through a shell. EOF must close the MCP child itself;
  // relying on the client to signal its immediate child leaves this process alive.
  const shutdown = () => { void server.close(); };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  server.onclose = () => {
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    channel.close();
  };
  await server.connect(new StdioServerTransport());
  if (process.stdin.readableEnded || process.stdin.destroyed) shutdown();
}
