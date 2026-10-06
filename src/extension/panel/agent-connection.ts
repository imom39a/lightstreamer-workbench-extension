import { AGENT_PROTOCOL_VERSION, AGENT_RESPONSE_CONTRACT, isReservedAgentCall, type AgentPermission } from "../../agent/protocol";
import { agentToolResultBytes } from "../../agent/tool-result";
import { connectPortable, type CompanionChannel } from "../../agent/portable-channel";
import type { CompanionAuth } from "../../agent/portable-config";
import { beginPanelPairing, type PanelPairing, type PairingDisplay } from "../../agent/panel-pairing";
import { DEFAULT_COMPANION_PORT } from "../../agent/pairing";
import { createAgentService } from "./agent-service";
import type { WorkbenchRuntime } from "./workbench-runtime";
import type { CompanionIdentity } from "../../agent/companion-identity";

export type AgentConnectionState = Readonly<{ enabled: boolean; permission: AgentPermission; status: "off" | "waiting" | "connecting" | "pairing" | "awaiting-agent" | "connected" | "error"; detail: string; port?: number; auth?: CompanionAuth; requestedPermission?: "read" | "local"; pairing?: PairingDisplay; companion?: CompanionIdentity }>;
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

// Slow or uncooperative providers retain their admission until actual settlement,
// even after cancellation/reconnection. Ordinary reads keep their normal limits;
// a separate bounded lane remains for status, receipts, recovery, pause and stop.
const PROVIDER_CAPACITY = 48;
const IMMEDIATE_CAPACITY = 16;
const AGENT_PROVIDER_CAPACITY = 16;
const RESERVED_CAPACITY = 8;
const AGENT_RESERVED_CAPACITY = 2;
const immediateReads = new Set(["get_status", "query_command_state", "get_operation"]);

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
  const outstanding = new Set<{ owner: string; immediate: boolean; reserved: boolean }>();
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
    publish({ ...settings(), enabled: false, permission: "off", status: "off", detail: "Agent access is off for this Panel Session." });
  }
  function start() {
    release();
    if (disposed || !service || typeof chrome === "undefined" || !chrome.devtools) {
      publish({ ...settings(), enabled: false, permission: "off", status: "error", detail: "Agent access requires the installed DevTools panel and companion." }); return;
    }
    const epoch = generation;
    const auth = options.auth ?? "off";
    const fail = (error?: unknown) => {
      if (epoch !== generation) return;
      release();
      const automatic = auth === "off";
      const mismatch = error instanceof Error && error.message.startsWith("COMPANION_INCOMPATIBLE:")
        ? error.message.slice("COMPANION_INCOMPATIBLE: ".length) : null;
      publish({ ...settings(), enabled: automatic, permission: "off", status: automatic ? "waiting" : "error", detail: automatic
        ? mismatch ? `${mismatch} Workbench retries automatically.` : "Waiting for the companion. Workbench retries automatically."
        : mismatch ?? "Companion unavailable or approval expired. Check connection settings, then enable agent access again. Inspect any pending outcome first." });
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
          const controller = pendingReads.get(value.id);
          pendingReads.delete(value.id);
          controller?.abort();
          return;
        }
        if (value.type === "ready") {
          clearTimeout(deadline); failures = 0;
          publish({ ...settings(), enabled: true, permission, status: "connected", companion: current.identity,
            detail: `${permission === "local" ? "Connected · inspection and Local Injection allowed." : "Connected · inspection only."}${current.identity ? ` Companion ${current.identity.companionVersion}.` : ""}` });
          return;
        }
        if (state.status !== "connected" || typeof value.id !== "string" || typeof value.name !== "string") return;
        const requestId = value.id;
        const reserved = isReservedAgentCall(value.name, value.args);
        const immediate = !reserved && immediateReads.has(value.name);
        // The broker supplies this identity; caller tool arguments cannot set it.
        // Direct/legacy adapters share one bounded owner for this connection.
        const owner = typeof value.agentConnectionId === "string" && value.agentConnectionId.length <= 128 ? value.agentConnectionId : `connection-${epoch}`;
        const admittedCalls = [...outstanding];
        const reservedCalls = admittedCalls.filter(entry => entry.reserved);
        const ordinaryCalls = admittedCalls.filter(entry => !entry.reserved);
        const providers = ordinaryCalls.filter(entry => !entry.immediate);
        const immediateCount = ordinaryCalls.length - providers.length;
        const ownedReserved = reservedCalls.filter(entry => entry.owner === owner).length;
        if (pendingReads.has(requestId) || pendingReads.size >= 72
          || (reserved ? reservedCalls.length >= RESERVED_CAPACITY || ownedReserved >= AGENT_RESERVED_CAPACITY
            : (immediate ? immediateCount >= IMMEDIATE_CAPACITY : providers.length >= PROVIDER_CAPACITY || providers.filter(entry => entry.owner === owner).length >= AGENT_PROVIDER_CAPACITY))) {
          reply({ id: requestId, error: "REQUEST_CAPACITY: Workbench request capacity reached. Cancelled provider work remains bounded until it settles; immediate inspection has reserved capacity." }); return;
        }
        const controller = new AbortController();
        pendingReads.set(requestId, controller);
        const admitted = { owner, immediate, reserved };
        outstanding.add(admitted);
        const response = service.call(value.name, value.args, { signal: controller.signal }).then(async result => {
          if (value.name !== "get_status") return result;
          const inspectedPage = await describeInspectedPage(controller.signal);
          if ((result as { pageEpoch: string }).pageEpoch !== (runtime.agent!.status() as { pageEpoch: string }).pageEpoch) throw new Error("TARGET_CHANGED: The inspected page changed while resolving its identity. Query status again.");
          return appendInspectedPageStatus({ ...(result as object), ...(current.identity ? { companion: current.identity } : {}) }, inspectedPage);
        });
        const callCurrent = () => !controller.signal.aborted && pendingReads.get(requestId) === controller;
        void response.then(result => { if (callCurrent()) reply({ id: requestId, result }); }, error => { if (callCurrent()) reply({ id: requestId, error: error instanceof Error ? error.message : "Workbench operation failed." }); }).finally(() => {
          outstanding.delete(admitted);
          if (pendingReads.get(requestId) === controller) pendingReads.delete(requestId);
        });
      });
      reply({ type: "hello", role: "panel", protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, tabId: chrome.devtools.inspectedWindow.tabId, permission });
    };
    try {
      if (auth === "off") {
        const extensionId = chrome.runtime.getURL("").replace(/^chrome-extension:\/\//, "").replace(/\/$/, "");
        void connectPortable({ auth: "off", port: options.port ?? DEFAULT_COMPANION_PORT }, "panel", { extensionId }).then(attach).catch(fail);
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

type InspectedPageIdentity = { chromeTabId: number; urlWithoutQuery: string | null };
export function appendInspectedPageStatus(status: object, inspectedPage: InspectedPageIdentity) {
  const full = { ...status, inspectedPage };
  if (agentToolResultBytes(full) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return full;
  if (inspectedPage.urlWithoutQuery === null) throw new Error("RESULT_BUDGET_EXCEEDED: Operational status exceeds the MCP response budget.");
  let origin: string | null = null;
  try { origin = new URL(inspectedPage.urlWithoutQuery).origin; } catch { /* Opaque and extension URLs may have no parseable origin. */ }
  const omitted = "The inspected path exceeded the status response budget. Identify this tab by chromeTabId or inspect its URL in Chrome.";
  const compact = { ...status, inspectedPage: { chromeTabId: inspectedPage.chromeTabId, origin, urlWithoutQuery: null, urlOmitted: omitted } };
  if (agentToolResultBytes(compact) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return compact;
  const minimal = { ...status, inspectedPage: { chromeTabId: inspectedPage.chromeTabId, urlWithoutQuery: null, urlOmitted: omitted } };
  if (agentToolResultBytes(minimal) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return minimal;
  throw new Error("RESULT_BUDGET_EXCEEDED: Operational status exceeds the MCP response budget even after omitting the inspected URL.");
}

function describeInspectedPage(signal?: AbortSignal): Promise<InspectedPageIdentity> {
  // Fixed read-only expression, never code supplied by the agent. Query/hash are not shared.
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); };
    const complete = (url: string | null) => { if (settled) return; settled = true; cleanup(); resolve({ chromeTabId: chrome.devtools.inspectedWindow.tabId, urlWithoutQuery: url }); };
    const aborted = () => { if (settled) return; settled = true; cleanup(); reject(new Error("QUERY_CANCELLED: Status identity read was cancelled.")); };
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    timer = setTimeout(() => complete(null), 1500);
    chrome.devtools.inspectedWindow.eval("location.origin + location.pathname", (value, exception) => {
      complete(!exception && typeof value === "string" ? value : null);
    });
  });
}
