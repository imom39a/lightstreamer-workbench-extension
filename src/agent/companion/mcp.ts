import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { AGENT_TOOLS, validateAgentCall } from "../protocol";
import metadata from "../../../agent/package.json";
import { connectPortableBroker } from "./portable-broker";
import type { PortableConfig } from "../portable-config";
import { agentToolFailure, agentToolResult } from "./tool-result";

export async function runMcp(cli: string, connection: { config: PortableConfig; extensionId: string }) {
  const channel = await connectPortableBroker(cli, connection.config, connection.extensionId);
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
      return agentToolResult(result);
    } catch (error) { return agentToolFailure(error); }
  });
  channel.onClose(() => { for (const callback of pending.values()) callback.reject(new Error("Companion disconnected. In-flight delivery may be unknown.")); pending.clear(); void server.close(); });
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
