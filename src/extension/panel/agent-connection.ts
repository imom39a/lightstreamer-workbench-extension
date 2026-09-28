import { AGENT_PROTOCOL_VERSION, type AgentPermission } from "../../agent/protocol";
import { connectPortable, type CompanionChannel } from "../../agent/portable-channel";
import type { CompanionAuth } from "../../agent/portable-config";
import { beginPanelPairing, type PanelPairing, type PairingDisplay } from "../../agent/panel-pairing";
import { DEFAULT_COMPANION_PORT } from "../../agent/pairing";
import { createAgentService } from "./agent-service";
import type { WorkbenchRuntime } from "./workbench-runtime";

export type AgentConnectionState = Readonly<{ enabled: boolean; permission: AgentPermission; status: "off" | "waiting" | "connecting" | "pairing" | "awaiting-agent" | "connected" | "error"; detail: string; port?: number; auth?: CompanionAuth; requestedPermission?: "read" | "local"; pairing?: PairingDisplay }>;
export type AgentConnectionOptions = { port?: number; auth?: CompanionAuth };
export interface AgentConnection {
  getSnapshot(): AgentConnectionState;
  subscribe(listener: () => void): () => void;
  connect(permission?: "read" | "local", options?: AgentConnectionOptions): void;
  approvePairing(): void;
  disconnect(): void;
  dispose(): void;
}
const unavailable: AgentConnectionState = { enabled: false, permission: "off", status: "off", detail: "Available in the installed DevTools panel after companion setup." };
export const UNAVAILABLE_AGENT_CONNECTION: AgentConnection = { getSnapshot: () => unavailable, subscribe: () => () => {}, connect() {}, approvePairing() {}, disconnect() {}, dispose() {} };

export function createAgentConnection(runtime: WorkbenchRuntime, panelSessionId: string): AgentConnection {
  let permission: "read" | "local" = "local";
  let options: AgentConnectionOptions = { port: DEFAULT_COMPANION_PORT, auth: "off" };
  let state: AgentConnectionState = { enabled: false, permission: "off", status: "off", detail: "Agent access is off for this Panel Session." };
  let channel: CompanionChannel | null = null;
  let pairingAttempt: PanelPairing | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let generation = 0;
  let disposed = false;
  const pendingReads = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const service = runtime.agent ? createAgentService(runtime.agent, panelSessionId, () => state.permission) : null;
  const unsubscribe = runtime.subscribe(() => service?.refreshOperations());
  function publish(next: AgentConnectionState) { state = Object.freeze(next); listeners.forEach(listener => listener()); }
  function release() {
    generation++; clearTimeout(deadline); clearTimeout(retry);
    for (const controller of pendingReads.values()) controller.abort();
    pendingReads.clear();
    service?.revoke();
    const attempt = pairingAttempt; pairingAttempt = null; attempt?.close();
    const current = channel; channel = null; current?.close();
  }
  const settings = () => ({ requestedPermission: permission, port: options.port ?? DEFAULT_COMPANION_PORT, auth: options.auth ?? "off" });
  function disconnect() {
    release();
    publish({ ...settings(), enabled: false, permission: "off", status: "off", detail: "Agent access is off for this Panel Session. Opening a new panel enables default access." });
  }
  function start() {
    release();
    if (disposed || !service || typeof chrome === "undefined" || !chrome.devtools) {
      publish({ ...settings(), enabled: false, permission: "off", status: "error", detail: "Agent access requires the installed DevTools panel and companion." }); return;
    }
    const epoch = generation;
    const auth = options.auth ?? "off";
    const fail = () => {
      if (epoch !== generation) return;
      release();
      const automatic = auth === "off";
      publish({ ...settings(), enabled: automatic, permission: "off", status: automatic ? "waiting" : "error", detail: automatic
        ? "Waiting for the local companion. Connection retries automatically. Start or reconnect Workbench's MCP server in your agent app; it launches the companion for you. If it is already running, check the extension ID and use default setup (port 24817, authentication off). Pending operations are never repeated."
        : "Companion unavailable or approval expired. Check connection settings, then enable agent access again. Inspect any pending outcome first." });
      if (automatic) retry = setTimeout(start, Math.min(1000 * 2 ** Math.min(failures++, 4), 15000));
    };
    publish({ ...settings(), enabled: true, permission: "off", status: "connecting", detail: "Connecting to the local Workbench companion…" });
    deadline = setTimeout(fail, 10000);
    const attach = (current: CompanionChannel) => {
      if (epoch !== generation) { current.close(); return; }
      clearTimeout(deadline); deadline = setTimeout(fail, 10000);
      channel = current;
      current.onClose(fail);
      const reply = (value: Record<string, unknown>) => { if (epoch === generation) { try { current.send(value); } catch { fail(); } } };
      current.onMessage(value => {
        if (epoch !== generation) return;
        if (value.type === "cancel" && typeof value.id === "string") {
          pendingReads.get(value.id)?.abort();
          return;
        }
        if (value.type === "ready") {
          clearTimeout(deadline); failures = 0;
          publish({ ...settings(), enabled: true, permission, status: "connected", detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
          return;
        }
        if (state.status !== "connected" || typeof value.id !== "string" || typeof value.name !== "string") return;
        const requestId = value.id;
        if (pendingReads.has(requestId) || pendingReads.size >= 64) { reply({ id: requestId, error: "REQUEST_CAPACITY: Workbench request capacity reached." }); return; }
        const controller = new AbortController();
        pendingReads.set(requestId, controller);
        const response = service.call(value.name, value.args, { signal: controller.signal }).then(async result => {
          if (value.name !== "get_status") return result;
          const inspectedPage = await describeInspectedPage();
          if ((result as { pageEpoch: string }).pageEpoch !== (runtime.agent!.status() as { pageEpoch: string }).pageEpoch) throw new Error("The inspected page changed while resolving its identity. Query status again.");
          return { ...result as object, inspectedPage };
        });
        void response.then(result => reply({ id: requestId, result }), error => reply({ id: requestId, error: error instanceof Error ? error.message : "Workbench operation failed." })).finally(() => {
          if (pendingReads.get(requestId) === controller) pendingReads.delete(requestId);
        });
      });
      reply({ type: "hello", role: "panel", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, tabId: chrome.devtools.inspectedWindow.tabId, permission });
    };
    try {
      if (auth === "off") {
        void connectPortable({ auth: "off", port: options.port ?? DEFAULT_COMPANION_PORT }, "panel").then(attach).catch(fail);
        return;
      }
      const attempt = beginPanelPairing(options.port ?? DEFAULT_COMPANION_PORT, chrome.runtime.getURL("").replace(/\/$/, ""), pairing => {
        if (epoch !== generation) return;
        clearTimeout(deadline);
        publish({ ...settings(), enabled: true, permission: "off", status: "pairing", pairing, detail: "No access yet. Compare this code with your agent, then approve the connection." });
      });
      pairingAttempt = attempt;
      void attempt.ready.then(attach).catch(fail);
    } catch { fail(); }
  }
  const connection: AgentConnection = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect(nextPermission = permission, nextOptions = options) {
      if (disposed) return;
      permission = nextPermission; options = nextOptions; failures = 0; start();
    },
    approvePairing() {
      if (state.status !== "pairing" || !pairingAttempt || !state.pairing || state.pairing.expiresAt <= Date.now()) return;
      pairingAttempt.approve();
      publish({ ...state, status: "awaiting-agent", detail: "Approved here. Waiting for your agent to confirm the matching code. No access yet." });
    },
    disconnect,
    dispose() { disposed = true; disconnect(); unsubscribe(); listeners.clear(); }
  };
  // Panel-owned, not React-owned: hiding the settings never disables discovery.
  if (service && typeof chrome !== "undefined" && chrome.devtools) connection.connect();
  return connection;
}

function describeInspectedPage(): Promise<{ chromeTabId: number; urlWithoutQuery: string | null }> {
  // Fixed read-only expression, never code supplied by the agent. Query/hash are not shared.
  return new Promise(resolve => {
    const complete = (url: string | null) => resolve({ chromeTabId: chrome.devtools.inspectedWindow.tabId, urlWithoutQuery: url });
    const timer = setTimeout(() => complete(null), 1500);
    chrome.devtools.inspectedWindow.eval("location.origin + location.pathname", (value, exception) => {
      clearTimeout(timer); complete(!exception && typeof value === "string" ? value.slice(0, 4096) : null);
    });
  });
}
