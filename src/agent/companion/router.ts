import { randomUUID } from "node:crypto";
import { AGENT_PROTOCOL_VERSION, AGENT_RESPONSE_CONTRACT, agentTimeoutCode, isReservedAgentCall, validateAgentCall } from "../protocol";
import type { Message } from "../protocol";
import { agentToolResultBytes } from "../tool-result";

export interface BrokerPeer {
  send(value: Message): void;
  close(): void;
}

function globalListResult(name: string, items: readonly unknown[], args: Message) {
  const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
  if (args.offset === undefined && args.limit === undefined) {
    if (agentToolResultBytes(items) > budget) throw new Error(`RESULT_BUDGET_EXCEEDED: ${name} exceeds the response budget. Request a page with offset:0 and limit:50, then continue at nextOffset.`);
    return items;
  }
  const offset = Number(args.offset ?? 0);
  let size = Number(args.limit ?? 50);
  for (;;) {
    const pageItems = items.slice(offset, offset + size);
    const nextOffset = offset + pageItems.length < items.length ? offset + pageItems.length : null;
    const page = { items: pageItems, total: items.length, offset, nextOffset };
    if (agentToolResultBytes(page) <= budget) return page;
    if (size <= 1) throw new Error(`RESULT_BUDGET_EXCEEDED: One ${name} entry exceeds maxBytes. Request a larger maxBytes, up to 65536.`);
    size = Math.max(1, Math.floor(size / 2));
  }
}

/** Transports enforce their configured connection policy before joining. Routing never owns Capture or grants. */
export function createBrokerRouter(pairing?: { list(): unknown; confirm(args: Message): unknown }) {
  const panels = new Map<string, { peer: BrokerPeer; session: Message }>();
  const pending = new Map<string, { client: BrokerPeer; panel: BrokerPeer; id: string; name: string; args: Message; reserved: boolean; timer: NodeJS.Timeout }>();
  function send(peer: BrokerPeer, value: Message) {
    try { peer.send(value); } catch { peer.close(); }
  }
  return {
    join(peer: BrokerPeer, hello: Message) {
      const role = hello.role;
      if (role !== "agent" && role !== "panel") throw new Error("Invalid companion role.");
      const agentConnectionId = role === "agent" ? randomUUID() : null;
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
          if (message.type === "cancel" && typeof message.id === "string") {
            for (const [route, request] of pending) {
              if (request.client !== peer || request.id !== message.id) continue;
              clearTimeout(request.timer); pending.delete(route);
              send(request.panel, { type: "cancel", id: route });
              const failure = agentTimeoutCode(request.name, request.args);
              const code = failure === "QUERY_FAILED" ? "QUERY_CANCELLED" : failure;
              send(peer, { id: message.id, error: `${code}: Request cancelled. Inspect the existing requestId before any further execution.` });
            }
            return;
          }
          if (typeof message.id !== "string" || typeof message.name !== "string") { peer.close(); return; }
          try {
            validateAgentCall(message.name, message.args);
            if (message.name === "list_panel_sessions") { send(peer, { id: message.id, result: globalListResult(message.name, [...panels.values()].map(panel => panel.session), message.args as Message) }); return; }
            if (message.name === "get_pairing_requests") {
              const listed = pairing?.list() ?? [];
              if (!Array.isArray(listed)) throw new Error("Pairing request list is unavailable.");
              send(peer, { id: message.id, result: globalListResult(message.name, listed, message.args as Message) }); return;
            }
            if (message.name === "confirm_pairing") {
              if (!pairing) throw new Error("Pairing approval is only used when standalone authentication is required. Use list_panel_sessions for connected panels.");
              const id = message.id;
              void Promise.resolve(pairing.confirm(message.args as Message)).then(
                result => send(peer, { id, result }),
                error => send(peer, { id, error: error instanceof Error ? error.message : "Pairing confirmation failed." })
              ); return;
            }
            const panel = panels.get(String((message.args as Message).panelSessionId));
            if (!panel) throw new Error("COMPANION_UNAVAILABLE: Panel Session is not connected. Open Workbench and check Agent access status.");
            const reserved = isReservedAgentCall(message.name, message.args);
            const owned = [...pending.values()].filter(request => request.client === peer);
            const reservedCount = [...pending.values()].filter(request => request.reserved).length;
            const ownedReserved = owned.filter(request => request.reserved).length;
            const ordinaryCount = pending.size - reservedCount;
            const ownedOrdinary = owned.length - ownedReserved;
            if (pending.size >= 72 || (reserved ? reservedCount >= 8 || ownedReserved >= 2 : ordinaryCount >= 64 || ownedOrdinary >= 16)) {
              throw new Error("REQUEST_CAPACITY: Companion request capacity reached. Reserved status, receipt, recovery, pause and stop calls have bounded headroom.");
            }
            const waiting = (name: string) => name === "wait_for_evidence" || name === "wait_for_operation" || name === "wait_for_scenario";
            if (waiting(message.name) && owned.filter(request => waiting(request.name)).length >= 2) {
              throw new Error("REQUEST_CAPACITY: This agent has two pending waits. Wait for one to settle before starting another.");
            }
            const route = randomUUID(), id = message.id, name = message.name, args = message.args as Message;
            const timer = setTimeout(() => {
              pending.delete(route);
              send(panel.peer, { type: "cancel", id: route });
              send(peer, { id, error: `${agentTimeoutCode(name, args)}: Workbench reply timed out. Inspect the existing operation requestId before any further execution.` });
            }, 30000);
            pending.set(route, { client: peer, panel: panel.peer, id, name, args, reserved, timer });
            // Panel accounting uses this trusted peer token even after a route
            // is cancelled while an uncooperative provider is still settling.
            send(panel.peer, { id: route, name, args, agentConnectionId, ...(reserved ? { admissionClass: "reserved" } : {}) });
          } catch (error) { send(peer, { id: message.id, error: error instanceof Error ? error.message : "Companion request failed." }); }
        },
        close() {
          if (sessionId && panels.get(sessionId)?.peer === peer) panels.delete(sessionId);
          for (const [key, request] of pending) {
            if (request.client === peer || request.panel === peer) {
              clearTimeout(request.timer); pending.delete(key);
              if (request.panel !== peer) send(request.panel, { type: "cancel", id: key });
              if (request.client !== peer) send(request.client, { id: request.id, error: "COMPANION_UNAVAILABLE: Panel connection closed. An in-flight operation may have an unknown outcome; inspect its existing requestId/receipt and do not retry automatically." });
            }
          }
        }
      };
    },
    dispose() { for (const [route, request] of pending) { clearTimeout(request.timer); send(request.panel, { type: "cancel", id: route }); } pending.clear(); panels.clear(); }
  };
}
