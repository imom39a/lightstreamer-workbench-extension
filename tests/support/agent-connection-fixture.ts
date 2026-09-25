import type { AgentConnection, AgentConnectionState } from "../../src/extension/panel/agent-connection";

/** UI-only fixture; production transports are exercised by the extension proof. */
export function agentConnectionFixture(fail = false): AgentConnection {
  let state: AgentConnectionState = { enabled: true, permission: fail ? "off" : "local", requestedPermission: "local", transport: "portable", port: 24817, auth: "off", status: fail ? "waiting" : "connected", detail: fail ? "Waiting for the local companion. Connection retries automatically. Check the running MCP server, extension ID, port and authentication mode. Pending operations are never repeated." : "Connected · inspection and Local Injection allowed." };
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: AgentConnectionState) => { state = Object.freeze(next); listeners.forEach(listener => listener()); };
  const connected = (permission: "read" | "local", transport: "native" | "portable", auth: "off" | "required" = "off") => publish({ ...state, enabled: true, permission, pairing: undefined, status: "connected", transport, auth, detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(permission = state.requestedPermission ?? "local", options = state.transport === "native" ? { transport: "native" } : { transport: "portable", auth: state.auth, port: state.port }) {
      clearTimeout(pending);
      publish({ ...state, enabled: true, permission: "off", requestedPermission: permission, pairing: undefined, transport: options.transport, auth: options.transport === "portable" ? options.auth ?? "off" : undefined, port: options.transport === "portable" ? options.port ?? 24817 : undefined });
      if (fail) publish({ ...state, status: "waiting", detail: "Waiting for the local companion. Connection retries automatically. Check the running MCP server, extension ID, port and authentication mode. Pending operations are never repeated." });
      else if (options.transport === "portable") {
        const auth = options.auth ?? "off";
        publish({ ...state, status: "connecting", detail: "Connecting to the local Workbench companion…" });
        pending = setTimeout(() => auth === "off" ? connected(permission, "portable") : publish({ ...state, status: "pairing", pairing: { requestId: "fixture-request", code: "1234 5678", expiresAt: Date.now() + 120000 }, detail: "No access yet. Compare this code with your agent, then approve the connection." }), 100);
      }
      else connected(permission, "native");
    },
    approvePairing() {
      if (state.status !== "pairing") return;
      const permission = state.requestedPermission!;
      publish({ ...state, status: "awaiting-agent", detail: "Approved here. Waiting for your agent to confirm the matching code. No access yet." });
      pending = setTimeout(() => connected(permission, "portable", "required"), 300);
    },
    disconnect() { clearTimeout(pending); publish({ ...state, enabled: false, permission: "off", pairing: undefined, status: "off", detail: "Agent access is off for this Panel Session." }); },
    dispose() { clearTimeout(pending); listeners.clear(); }
  };
}
