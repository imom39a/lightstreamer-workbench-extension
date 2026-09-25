import { AGENT_PROTOCOL_VERSION, NATIVE_HOST_NAME, type AgentPermission } from "../../agent/protocol";
import { connectPortable, type CompanionChannel } from "../../agent/portable-channel";
import type { CompanionAuth } from "../../agent/portable-config";
import { beginPanelPairing, type PanelPairing, type PairingDisplay } from "../../agent/panel-pairing";
import { DEFAULT_COMPANION_PORT } from "../../agent/pairing";
import { createAgentService } from "./agent-service";
import type { WorkbenchRuntime } from "./workbench-runtime";

export type AgentConnectionState = Readonly<{ enabled: boolean; permission: AgentPermission; status: "off" | "waiting" | "connecting" | "pairing" | "awaiting-agent" | "connected" | "error"; detail: string; transport?: "native" | "portable"; port?: number; auth?: CompanionAuth; requestedPermission?: "read" | "local"; pairing?: PairingDisplay }>;
export type AgentConnectionOptions = { transport: "portable"; port?: number; auth?: CompanionAuth } | { transport: "native" };
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
  let options: AgentConnectionOptions = { transport: "portable", port: DEFAULT_COMPANION_PORT, auth: "off" };
  let state: AgentConnectionState = { enabled: false, permission: "off", status: "off", detail: "Agent access is off for this Panel Session." };
  let channel: CompanionChannel | null = null;
  let pairingAttempt: PanelPairing | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const service = runtime.agent ? createAgentService(runtime.agent, panelSessionId, () => state.permission) : null;
  const unsubscribe = runtime.subscribe(() => service?.refreshOperations());
  function publish(next: AgentConnectionState) { state = Object.freeze(next); listeners.forEach(listener => listener()); }
  function release() {
    generation++; clearTimeout(deadline); clearTimeout(retry);
    service?.revoke();
    const attempt = pairingAttempt; pairingAttempt = null; attempt?.close();
    const current = channel; channel = null; current?.close();
  }
  const settings = () => ({ requestedPermission: permission, transport: options.transport, port: options.transport === "portable" ? options.port ?? DEFAULT_COMPANION_PORT : undefined, auth: options.transport === "portable" ? options.auth ?? "off" : undefined });
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
    const auth = options.transport === "portable" ? options.auth ?? "off" : undefined;
    const fail = () => {
      if (epoch !== generation) return;
      release();
      const automatic = options.transport === "portable" && auth === "off";
      publish({ ...settings(), enabled: automatic, permission: "off", status: automatic ? "waiting" : "error", detail: automatic
        ? "Waiting for the local companion. Connection retries automatically. Check the running MCP server, extension ID, port and authentication mode. Pending operations are never repeated."
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
        if (value.type === "ready") {
          clearTimeout(deadline); failures = 0;
          publish({ ...settings(), enabled: true, permission, status: "connected", detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
          return;
        }
        if (state.status !== "connected" || typeof value.id !== "string" || typeof value.name !== "string") return;
        const response = service.call(value.name, value.args).then(async result => {
          if (value.name !== "get_status") return result;
          const inspectedPage = await describeInspectedPage();
          if ((result as { pageEpoch: string }).pageEpoch !== (runtime.agent!.status() as { pageEpoch: string }).pageEpoch) throw new Error("The inspected page changed while resolving its identity. Query status again.");
          return { ...result as object, inspectedPage };
        });
        void response.then(result => reply({ id: value.id, result }), error => reply({ id: value.id, error: error instanceof Error ? error.message : "Workbench operation failed." }));
      });
      reply({ type: "hello", role: "panel", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, tabId: chrome.devtools.inspectedWindow.tabId, permission });
    };
    try {
      if (options.transport === "portable") {
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
      }
      else attach(nativeChannel());
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

function nativeChannel(): CompanionChannel {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  return {
    send: value => port.postMessage(value), close: () => port.disconnect(),
    onMessage: callback => port.onMessage.addListener(value => { if (value && typeof value === "object" && !Array.isArray(value)) callback(value); }),
    onClose: callback => port.onDisconnect.addListener(() => { void chrome.runtime.lastError; callback(); })
  };
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
