import type { AgentConnection, AgentConnectionState } from "../../src/extension/panel/agent-connection";

const waitingDetail = "Waiting for the companion. Workbench retries automatically.";

/** UI-only fixture; production transports are exercised by the extension proof. */
export function agentConnectionFixture(fail = false, mismatchDetail?: string): AgentConnection {
  const failureDetail = mismatchDetail ?? waitingDetail;
  let state: AgentConnectionState = { enabled: true, permission: fail ? "off" : "local", requestedPermission: "local", port: 24817, auth: "off", status: fail ? "waiting" : "connected", detail: fail ? failureDetail : "Connected · inspection and Local Injection allowed." };
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: AgentConnectionState) => { state = Object.freeze(next); listeners.forEach(listener => listener()); };
  const connected = (permission: "read" | "local", auth: "off" | "required" = "off") => publish({ ...state, enabled: true, permission, pairing: undefined, status: "connected", auth, detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(permission = state.requestedPermission ?? "local", options = { auth: state.auth, port: state.port }) {
      clearTimeout(pending);
      publish({ ...state, enabled: true, permission: "off", requestedPermission: permission, pairing: undefined, auth: options.auth ?? "off", port: options.port ?? 24817 });
      if (fail) publish({ ...state, status: "waiting", detail: failureDetail });
      else {
        const auth = options.auth ?? "off";
        publish({ ...state, status: "connecting", detail: "Connecting to the local Workbench companion…" });
        pending = setTimeout(() => auth === "off" ? connected(permission) : publish({ ...state, status: "pairing", pairing: { requestId: "fixture-request", code: "1234 5678", expiresAt: Date.now() + 120000 }, detail: "No access yet. Compare this code with your agent, then approve the connection." }), 100);
      }
    },
    approvePairing() {
      if (state.status !== "pairing") return;
      const permission = state.requestedPermission!;
      publish({ ...state, status: "awaiting-agent", detail: "Approved here. Waiting for your agent to confirm the matching code. No access yet." });
      pending = setTimeout(() => connected(permission, "required"), 300);
    },
    disconnect() { clearTimeout(pending); publish({ ...state, enabled: false, permission: "off", pairing: undefined, status: "off", detail: "Agent access is off for this Panel Session." }); },
    dispose() { clearTimeout(pending); listeners.clear(); }
  };
}
