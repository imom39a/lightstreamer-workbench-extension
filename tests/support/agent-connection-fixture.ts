import type { AgentConnection, AgentConnectionState } from "../../src/extension/panel/agent-connection";

/** UI-only fixture; production native transport is exercised by the extension proof. */
export function agentConnectionFixture(fail = false): AgentConnection {
  let state: AgentConnectionState = { permission: "off", status: "off", detail: "Agent access is off for this Panel Session." };
  const listeners = new Set<() => void>();
  const publish = (next: AgentConnectionState) => { state = Object.freeze(next); listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(permission) {
      publish(fail ? { permission: "off", status: "error", detail: "Companion unavailable. Complete companion setup, then connect again." }
        : { permission, status: "connected", detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
    },
    disconnect() { publish({ permission: "off", status: "off", detail: "Agent access is off for this Panel Session." }); },
    dispose() { listeners.clear(); }
  };
}
