import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { unlink, lstat } from "node:fs/promises";
import { endpoint, messages, privateSocket, send as writeMessage, type Message } from "./ipc";
import { AGENT_PROTOCOL_VERSION, validateAgentCall } from "../protocol";

function send(socket: Socket, value: unknown) {
  try { if (!socket.destroyed) writeMessage(socket, value); }
  catch { socket.destroy(); } // One backpressured peer must not terminate sibling sessions.
}

export async function startBroker(directory?: string) {
  const location = await endpoint(directory);
  const panels = new Map<string, { socket: Socket; session: Message }>();
  const pending = new Map<string, { client: Socket; panel: Socket; id: string; timer: NodeJS.Timeout }>();
  const connections = new Set<Socket>();
  let idle: NodeJS.Timeout | undefined;
  const server = createServer(socket => {
    clearTimeout(idle); connections.add(socket);
    let role: "agent" | "panel" | null = null;
    let sessionId: string | null = null;
    const helloTimeout = setTimeout(() => socket.destroy(), 5000);
    socket.on("error", () => {});
    messages(socket, message => {
      if (!role) {
        if (message.token !== location.token || !["agent", "panel"].includes(String(message.role))) { socket.destroy(); return; }
        role = message.role as "agent" | "panel";
        clearTimeout(helloTimeout);
        if (role === "panel") {
          if (message.protocolVersion !== AGENT_PROTOCOL_VERSION || typeof message.panelSessionId !== "string" || panels.has(message.panelSessionId) || !["read", "local"].includes(String(message.permission))) { socket.destroy(); return; }
          sessionId = message.panelSessionId;
          const session = { panelSessionId: sessionId, connectionId: randomUUID(), tabId: message.tabId, permission: message.permission, extensionOrigin: message.extensionOrigin };
          panels.set(sessionId, { socket, session });
        }
        send(socket, { type: "ready" }); return;
      }
      if (role === "panel") {
        const request = typeof message.id === "string" ? pending.get(message.id) : null;
        if (!request || request.panel !== socket) return;
        clearTimeout(request.timer); pending.delete(String(message.id));
        send(request.client, { id: request.id, ...(message.error ? { error: message.error } : { result: message.result }) });
        return;
      }
      if (typeof message.id !== "string" || typeof message.name !== "string") { socket.destroy(); return; }
      try {
        validateAgentCall(message.name, message.args);
        if (message.name === "list_panel_sessions") { send(socket, { id: message.id, result: [...panels.values()].map(panel => panel.session) }); return; }
        const args = message.args as Message;
        const panel = panels.get(String(args.panelSessionId));
        if (!panel) throw new Error("Panel Session is not connected. Open Workbench and explicitly connect agent access.");
        if (pending.size >= 64) throw new Error("Companion request capacity reached.");
        const route = randomUUID();
        const id = message.id;
        const timer = setTimeout(() => {
          pending.delete(route);
          send(socket, { id, error: "Workbench reply timed out. An execution may have occurred; query its requestId instead of repeating it." });
        }, 30000);
        pending.set(route, { client: socket, panel: panel.socket, id, timer });
        send(panel.socket, { id: route, name: message.name, args });
      } catch (error) { send(socket, { id: message.id, error: error instanceof Error ? error.message : "Companion request failed." }); }
    });
    socket.on("close", () => {
      clearTimeout(helloTimeout); connections.delete(socket);
      if (sessionId) panels.delete(sessionId);
      for (const [key, request] of pending) {
        if (request.client === socket || request.panel === socket) {
          clearTimeout(request.timer); pending.delete(key);
          if (request.client !== socket) send(request.client, { id: request.id, error: "Panel connection closed. Delivery may be unknown; do not repeat it automatically." });
        }
      }
      if (!connections.size) idle = setTimeout(() => server.close(), 30000);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(location.path, resolve); });
  await privateSocket(location.path);
  const socketIdentity = await lstat(location.path);
  server.on("close", () => {
    void lstat(location.path).then(stat => { if (stat.ino === socketIdentity.ino) return unlink(location.path); }).catch(() => {});
  });
  idle = setTimeout(() => { if (!connections.size) server.close(); }, 30000);
  return { close: () => { clearTimeout(idle); for (const request of pending.values()) clearTimeout(request.timer); for (const socket of connections) socket.destroy(); server.close(); } };
}
