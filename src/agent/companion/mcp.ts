import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { AGENT_TOOLS } from "../protocol";
import { connectBroker, messages, send } from "./ipc";

export async function runMcp(cli: string, directory?: string) {
  const { socket, token } = await connectBroker(cli, directory);
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  messages(socket, message => {
    const callback = pending.get(String(message.id));
    if (!callback) return;
    pending.delete(String(message.id));
    if (typeof message.error === "string") callback.reject(new Error(message.error));
    else callback.resolve(message.result);
  });
  send(socket, { role: "agent", token });
  const server = new Server({ name: "lightstreamer-workbench", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AGENT_TOOLS.map(({ mutation: _mutation, ...tool }) => tool) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const id = randomUUID(); pending.set(id, { resolve, reject });
        try { send(socket, { id, name: request.params.name, args: request.params.arguments ?? {} }); }
        catch (error) { pending.delete(id); reject(error); }
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Companion unavailable." }] }; }
  });
  socket.on("close", () => { for (const callback of pending.values()) callback.reject(new Error("Companion disconnected. In-flight delivery may be unknown.")); pending.clear(); void server.close(); });
  server.onclose = () => socket.end();
  await server.connect(new StdioServerTransport());
}
