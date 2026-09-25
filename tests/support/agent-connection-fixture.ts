import type { AgentConnection, AgentConnectionState } from "../../src/extension/panel/agent-connection";

/** UI-only fixture; production transports are exercised by the extension proof. */
export function agentConnectionFixture(fail = false): AgentConnection {
  let state: AgentConnectionState = { permission: "off", status: "off", detail: "Agent access is off for this Panel Session." };
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: AgentConnectionState) => { state = Object.freeze(next); listeners.forEach(listener => listener()); };
  const connected = (permission: "read" | "local", transport: "native" | "portable") => publish({ permission, status: "connected", transport, detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(permission, options) {
      if (fail) publish({ permission: "off", status: "error", detail: "Companion unavailable. Complete companion setup, then connect again." });
      else if (options?.transport === "portable") {
        publish({ permission: "off", requestedPermission: permission, transport: "portable", status: "connecting", detail: "Connecting to the local Workbench companion…" });
        pending = setTimeout(() => publish({ permission: "off", requestedPermission: permission, transport: "portable", status: "pairing", pairing: { requestId: "fixture-request", code: "1234 5678", expiresAt: Date.now() + 120000 }, detail: "No access yet. Compare this code with your agent, then approve the connection." }), 100);
      }
      else connected(permission, "native");
    },
    approvePairing() {
      if (state.status !== "pairing") return;
      const permission = state.requestedPermission!;
      publish({ ...state, status: "awaiting-agent", detail: "Approved here. Waiting for your agent to confirm the matching code. No access yet." });
      pending = setTimeout(() => connected(permission, "portable"), 300);
    },
    disconnect() { clearTimeout(pending); publish({ permission: "off", status: "off", detail: "Agent access is off for this Panel Session." }); },
    dispose() { clearTimeout(pending); listeners.clear(); }
  };
}
