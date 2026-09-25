import { AGENT_PROTOCOL_VERSION, NATIVE_HOST_NAME, type AgentPermission } from "../../agent/protocol";
import { createAgentService } from "./agent-service";
import type { WorkbenchRuntime } from "./workbench-runtime";

export type AgentConnectionState = Readonly<{ permission: AgentPermission; status: "off" | "connecting" | "connected" | "error"; detail: string }>;
export interface AgentConnection {
  getSnapshot(): AgentConnectionState;
  subscribe(listener: () => void): () => void;
  connect(permission: "read" | "local"): void;
  disconnect(): void;
  dispose(): void;
}
const unavailable: AgentConnectionState = { permission: "off", status: "off", detail: "Available in the installed DevTools panel after companion setup." };
export const UNAVAILABLE_AGENT_CONNECTION: AgentConnection = { getSnapshot: () => unavailable, subscribe: () => () => {}, connect() {}, disconnect() {}, dispose() {} };

export function createAgentConnection(runtime: WorkbenchRuntime, panelSessionId: string): AgentConnection {
  let state: AgentConnectionState = { permission: "off", status: "off", detail: "Agent access is off for this Panel Session." };
  let port: chrome.runtime.Port | null = null;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const service = runtime.agent ? createAgentService(runtime.agent, panelSessionId, () => state.permission) : null;
  const unsubscribe = runtime.subscribe(() => service?.refreshOperations());
  function publish(next: AgentConnectionState) { state = Object.freeze(next); listeners.forEach(listener => listener()); }
  function disconnect() {
    generation++;
    publish({ permission: "off", status: "off", detail: "Agent access is off for this Panel Session." });
    service?.revoke();
    const current = port; port = null; current?.disconnect();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect(permission) {
      disconnect();
      if (disposed || !service || typeof chrome === "undefined" || !chrome.runtime?.connectNative || !chrome.devtools) {
        publish({ permission: "off", status: "error", detail: "Agent access requires the installed DevTools panel and companion." }); return;
      }
      const epoch = generation;
      publish({ permission, status: "connecting", detail: "Connecting to the local Workbench companion…" });
      try {
        const current = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        port = current;
        current.onMessage.addListener((message: unknown) => {
          if (epoch !== generation || !message || typeof message !== "object") return;
          const value = message as Record<string, unknown>;
          if (value.type === "ready") {
            publish({ permission, status: "connected", detail: permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only." });
            return;
          }
          if (typeof value.id !== "string" || typeof value.name !== "string") return;
          const response = service.call(value.name, value.args).then(async result => {
            if (value.name !== "get_status") return result;
            const inspectedPage = await describeInspectedPage();
            if ((result as { pageEpoch: string }).pageEpoch !== (runtime.agent!.status() as { pageEpoch: string }).pageEpoch) throw new Error("The inspected page changed while resolving its identity. Query status again.");
            return { ...result as object, inspectedPage };
          });
          void response.then(
            result => { if (epoch === generation) current.postMessage({ id: value.id, result }); },
            error => { if (epoch === generation) current.postMessage({ id: value.id, error: error instanceof Error ? error.message : "Workbench operation failed." }); }
          );
        });
        current.onDisconnect.addListener(() => {
          const reason = chrome.runtime.lastError?.message;
          if (epoch !== generation) return;
          port = null; generation++;
          publish({ permission: "off", status: "error", detail: reason ? "Companion unavailable. Complete companion setup, then connect again." : "Companion disconnected. Inspect any pending outcome before reconnecting." });
          service.revoke();
        });
        current.postMessage({ type: "hello", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, tabId: chrome.devtools.inspectedWindow.tabId, permission });
      } catch {
        publish({ permission: "off", status: "error", detail: "Companion unavailable. Complete companion setup, then connect again." });
      }
    },
    disconnect,
    dispose() { disposed = true; disconnect(); unsubscribe(); listeners.clear(); }
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
