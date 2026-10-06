import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { AGENT_RESPONSE_CONTRACT, AGENT_TOOLS, agentTimeoutCode, isReservedAgentCall, validateAgentCall } from "../protocol";
import metadata from "../../../agent/package.json";
import { connectPortableBroker } from "./portable-broker";
import type { PortableConfig } from "../portable-config";
import type { CompanionChannel } from "../portable-channel";
import { agentToolFailure, agentToolResult, agentToolResultBytes } from "./tool-result";
import { AGENT_MCP_INITIALIZATION_INSTRUCTIONS, AGENT_READ_CONTRACT_RESOURCE_URI, AGENT_READ_GUIDANCE, investigationPrompt } from "./guidance";

const cursorReads = new Set(["search_scope", "query_evidence", "search_evidence", "summarize_evidence", "query_command_rows"]);
const consequential = new Set(["execute_local_injection", "execute_server_injection", "control_scenario"]);

/** Build the MCP interface over one already-connected companion channel. */
export function createMcpServer(channel: CompanionChannel) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; reserved: boolean }>();
  channel.onMessage(message => {
    const callback = pending.get(String(message.id));
    if (!callback) return;
    pending.delete(String(message.id));
    if (typeof message.error === "string") callback.reject(new Error(message.error));
    else callback.resolve(message.result);
  });
  channel.send({ role: "agent" });
  const server = new Server({ name: "lightstreamer-workbench", version: metadata.version }, {
    capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: AGENT_MCP_INITIALIZATION_INSTRUCTIONS
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AGENT_TOOLS.map(({ mutation: _mutation, ...tool }) => tool) }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{
    uri: AGENT_READ_CONTRACT_RESOURCE_URI, name: "workbench-read-contract", title: "Workbench agent read contract",
    description: "Static, bounded guidance for scoped Evidence reads and safe Local Injection reproduction.", mimeType: "text/markdown"
  }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== AGENT_READ_CONTRACT_RESOURCE_URI) throw new Error("Unknown Workbench agent resource.");
    return { contents: [{ uri: AGENT_READ_CONTRACT_RESOURCE_URI, mimeType: "text/markdown", text: AGENT_READ_GUIDANCE }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{
    name: "investigate-lightstreamer", title: "Investigate Lightstreamer Evidence",
    description: "Guide a scoped Lightstreamer investigation and, when useful, a reviewed local reproduction.",
    arguments: [{ name: "question", description: "What behavior or Lightstreamer event sequence are you investigating?", required: false }]
  }] }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== "investigate-lightstreamer") throw new Error("Unknown Workbench agent prompt.");
    return { description: "Use bounded Workbench Evidence reads and keep application/server conclusions within the captured Evidence.", messages: [{ role: "user", content: { type: "text", text: investigationPrompt(request.params.arguments?.question) } }] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { validateAgentCall(request.params.name, request.params.arguments ?? {}); }
    catch (error) { return agentToolFailure(error, "INVALID_ARGUMENT"); }
    try {
      const reserved = isReservedAgentCall(request.params.name, request.params.arguments ?? {});
      const reservedCount = [...pending.values()].filter(call => call.reserved).length;
      if (pending.size >= 72 || (reserved ? reservedCount >= 8 : pending.size - reservedCount >= 64)) throw new Error("REQUEST_CAPACITY: Too many pending Workbench calls. Reserved status, receipt, recovery, pause and stop calls have bounded headroom.");
      const result = await new Promise<unknown>((resolve, reject) => {
        const id = randomUUID();
        const cancel = () => {
          try { channel.send({ type: "cancel", id }); } catch { /* Connection may already be closed. */ }
          const timeoutCode = agentTimeoutCode(request.params.name, request.params.arguments ?? {});
          const code = timeoutCode === "QUERY_FAILED" ? "QUERY_CANCELLED" : timeoutCode;
          settle(new Error(`${code}: The request was cancelled. Inspect its existing requestId before any further execution.`));
        };
        const timer = setTimeout(() => {
          try { channel.send({ type: "cancel", id }); } catch { /* The result remains uncertain. */ }
          settle(new Error(`${agentTimeoutCode(request.params.name, request.params.arguments ?? {})}: Workbench reply timed out. Inspect the existing operation before any further execution.`));
        }, 35000);
        function settle(error?: Error, value?: unknown) {
          pending.delete(id); clearTimeout(timer); extra.signal.removeEventListener("abort", cancel);
          if (error) reject(error); else resolve(value);
        }
        pending.set(id, { resolve: value => settle(undefined, value), reject: error => settle(error), reserved });
        extra.signal.addEventListener("abort", cancel, { once: true });
        if (extra.signal.aborted) { cancel(); return; }
        try { channel.send({ id, name: request.params.name, args: request.params.arguments ?? {} }); }
        catch (error) { settle(error instanceof Error ? error : new Error("COMPANION_UNAVAILABLE: Could not send the request.")); }
      });
      // Measure the complete text-plus-structured MCP result for every tool.
      // The panel fits its own pages; this also guards mixed companion/panel
      // builds and global tools that do not pass through the panel service.
      const args = request.params.arguments ?? {};
      const budget = args.cursor && cursorReads.has(request.params.name) ? AGENT_RESPONSE_CONTRACT.maxBytes : Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
      if (agentToolResultBytes(result) > budget) {
        if (consequential.has(request.params.name)) throw new Error(`DELIVERY_UNKNOWN: The connected panel returned an oversized operation receipt for requestId ${String(args.requestId).slice(0, 128)}. Inspect this existing operation; do not repeat execution with a new id.`);
        throw new Error("RESULT_BUDGET_EXCEEDED: The connected panel exceeded the MCP response budget. Use matching extension and companion builds, then request a smaller page or inspect the object in Workbench.");
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
