import { randomUUID } from "node:crypto";
import { AGENT_PROTOCOL_VERSION, validateAgentCall } from "../protocol";
import type { Message } from "./ipc";

export interface BrokerPeer {
  send(value: Message): void;
  close(): void;
}

/** Transports enforce their configured connection policy before joining. Routing never owns Capture or grants. */
export function createBrokerRouter(pairing?: { list(): unknown; confirm(args: Message): unknown }) {
  const panels = new Map<string, { peer: BrokerPeer; session: Message }>();
  const pending = new Map<string, { client: BrokerPeer; panel: BrokerPeer; id: string; timer: NodeJS.Timeout }>();
  function send(peer: BrokerPeer, value: Message) {
    try { peer.send(value); } catch { peer.close(); }
  }
  return {
    join(peer: BrokerPeer, hello: Message) {
      const role = hello.role;
      if (role !== "agent" && role !== "panel") throw new Error("Invalid companion role.");
      let sessionId: string | null = null;
      if (role === "panel") {
        if (hello.protocolVersion !== AGENT_PROTOCOL_VERSION || typeof hello.panelSessionId !== "string" || panels.has(hello.panelSessionId) || !["read", "local"].includes(String(hello.permission))) throw new Error("Invalid Panel Session.");
        sessionId = hello.panelSessionId;
        panels.set(sessionId, { peer, session: { panelSessionId: sessionId, connectionId: randomUUID(), tabId: hello.tabId, permission: hello.permission, extensionOrigin: hello.extensionOrigin } });
      }
      send(peer, { type: "ready" });
      return {
        receive(message: Message) {
          if (role === "panel") {
            const request = typeof message.id === "string" ? pending.get(message.id) : null;
            if (!request || request.panel !== peer) return;
            clearTimeout(request.timer); pending.delete(String(message.id));
            send(request.client, { id: request.id, ...(message.error ? { error: message.error } : { result: message.result }) });
            return;
          }
          if (typeof message.id !== "string" || typeof message.name !== "string") { peer.close(); return; }
          try {
            validateAgentCall(message.name, message.args);
            if (message.name === "list_panel_sessions") { send(peer, { id: message.id, result: [...panels.values()].map(panel => panel.session) }); return; }
            if (message.name === "get_pairing_requests") { send(peer, { id: message.id, result: pairing?.list() ?? [] }); return; }
            if (message.name === "confirm_pairing") {
              if (!pairing) throw new Error("Pairing approval is only used when standalone authentication is required. Use list_panel_sessions for connected panels.");
              const id = message.id;
              void Promise.resolve(pairing.confirm(message.args as Message)).then(
                result => send(peer, { id, result }),
                error => send(peer, { id, error: error instanceof Error ? error.message : "Pairing confirmation failed." })
              ); return;
            }
            const panel = panels.get(String((message.args as Message).panelSessionId));
            if (!panel) throw new Error("Panel Session is not connected. Open Workbench and explicitly connect agent access.");
            if (pending.size >= 64) throw new Error("Companion request capacity reached.");
            const route = randomUUID(), id = message.id;
            const timer = setTimeout(() => {
              pending.delete(route);
              send(peer, { id, error: "Workbench reply timed out. An execution may have occurred; query its requestId instead of repeating it." });
            }, 30000);
            pending.set(route, { client: peer, panel: panel.peer, id, timer });
            send(panel.peer, { id: route, name: message.name, args: message.args });
          } catch (error) { send(peer, { id: message.id, error: error instanceof Error ? error.message : "Companion request failed." }); }
        },
        close() {
          if (sessionId && panels.get(sessionId)?.peer === peer) panels.delete(sessionId);
          for (const [key, request] of pending) {
            if (request.client === peer || request.panel === peer) {
              clearTimeout(request.timer); pending.delete(key);
              if (request.client !== peer) send(request.client, { id: request.id, error: "Panel connection closed. Delivery may be unknown; do not repeat it automatically." });
            }
          }
        }
      };
    },
    dispose() { for (const request of pending.values()) clearTimeout(request.timer); pending.clear(); panels.clear(); }
  };
}
