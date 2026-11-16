import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL,
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
  PAGE_SERVER_INJECTION_BRIDGE_GLOBAL,
  PAGE_SERVER_INJECTION_BRIDGE_VERSION,
  PANEL_REGISTER_MESSAGE,
  PANEL_STATUS_MESSAGE
} from "../src/bridge/messages";
import {
  PendingRequests,
  connectPanelBridge,
  pageClientMessageRecipeExpression,
  pageServerInjectionExpression,
  panelBridgeReconnectDelay
} from "../src/extension/panel/bridge-client";

const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000099";

type FakePort = {
  postedMessages: unknown[];
  messageListeners: Array<(message: unknown) => void>;
  disconnectListeners: Array<() => void>;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  postMessage(message: unknown): void;
  disconnect(): void;
};

function createFakePort(): FakePort {
  const port: FakePort = {
    postedMessages: [],
    messageListeners: [],
    disconnectListeners: [],
    onMessage: { addListener(listener) { port.messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { port.disconnectListeners.push(listener); } },
    postMessage(message) { port.postedMessages.push(message); },
    disconnect() { for (const listener of port.disconnectListeners) listener(); }
  };
  return port;
}

function installChrome(connect: () => unknown, extra: Record<string, unknown> = {}) {
  const runtime = { id: "extension-id", connect: vi.fn(connect), ...extra };
  (globalThis as { chrome: unknown }).chrome = { devtools: { inspectedWindow: { tabId: 7 } }, runtime };
  return runtime;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("panel bridge reconnect", () => {
  it("uses a capped exponential delay that keeps the first retry at 500ms", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(panelBridgeReconnectDelay)).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000, 5000]);
  });

  it("backs off across repeated disconnects and resets after the background answers", () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    const runtime = installChrome(() => { const port = createFakePort(); ports.push(port); return port; });
    const bridge = connectPanelBridge({ onStatusChange: vi.fn(), onCaptureMessage: vi.fn() }, PANEL_SESSION_ID);

    ports[0]!.disconnect();
    vi.advanceTimersByTime(499);
    expect(runtime.connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(runtime.connect).toHaveBeenCalledTimes(2);

    ports[1]!.disconnect();
    vi.advanceTimersByTime(999);
    expect(runtime.connect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(runtime.connect).toHaveBeenCalledTimes(3);

    // A registration acknowledgement proves the port is live; the next loss
    // starts again from the initial delay.
    ports[2]!.messageListeners[0]!({ type: PANEL_STATUS_MESSAGE, panelSessionId: PANEL_SESSION_ID, status: "bridge connected" });
    ports[2]!.disconnect();
    vi.advanceTimersByTime(500);
    expect(runtime.connect).toHaveBeenCalledTimes(4);
    expect(ports[3]!.postedMessages).toEqual([{ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: PANEL_SESSION_ID }]);
    bridge.disconnect();
  });

  it("keeps retrying when a timer-driven connect throws a transient error", () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    let failures = 1;
    const statuses: string[] = [];
    const runtime = installChrome(() => {
      if (ports.length === 1 && failures-- > 0) throw new Error("Could not establish connection.");
      const port = createFakePort(); ports.push(port); return port;
    });
    const onBridgeTerminated = vi.fn();
    const bridge = connectPanelBridge({ onStatusChange: status => statuses.push(status), onCaptureMessage: vi.fn(), onBridgeTerminated }, PANEL_SESSION_ID);

    ports[0]!.disconnect();
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(runtime.connect).toHaveBeenCalledTimes(2);
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(runtime.connect).toHaveBeenCalledTimes(3);
    expect(ports).toHaveLength(2);
    expect(onBridgeTerminated).not.toHaveBeenCalled();
    expect(statuses).toEqual(["bridge disconnected"]);
    bridge.disconnect();
  });

  it("surfaces a terminal status and stops reconnecting when the extension context is invalidated", () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    const statuses: string[] = [];
    let invalidated = false;
    const runtime = installChrome(() => {
      if (invalidated) throw new Error("Extension context invalidated.");
      const port = createFakePort(); ports.push(port); return port;
    });
    const onBridgeTerminated = vi.fn();
    connectPanelBridge({ onStatusChange: status => statuses.push(status), onCaptureMessage: vi.fn(), onBridgeTerminated }, PANEL_SESSION_ID);

    invalidated = true;
    ports[0]!.disconnect();
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(onBridgeTerminated).toHaveBeenCalledTimes(1);
    expect(onBridgeTerminated.mock.calls[0]![0]).toMatchObject({ reason: "extension-context-invalidated" });
    expect(statuses.at(-1)).toBe("bridge disconnected");
    vi.advanceTimersByTime(60_000);
    expect(runtime.connect).toHaveBeenCalledTimes(2);
  });

  it("treats a missing runtime id after a failed connect as an invalidated context", () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    const runtime = installChrome(() => {
      if (ports.length) { runtime.id = undefined as unknown as string; throw new Error("unexpected"); }
      const port = createFakePort(); ports.push(port); return port;
    });
    const onBridgeTerminated = vi.fn();
    connectPanelBridge({ onStatusChange: vi.fn(), onCaptureMessage: vi.fn(), onBridgeTerminated }, PANEL_SESSION_ID);
    ports[0]!.disconnect();
    vi.advanceTimersByTime(500);
    expect(onBridgeTerminated).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(runtime.connect).toHaveBeenCalledTimes(2);
  });

  it("reports a terminal status when the very first connect fails on an invalidated context", () => {
    installChrome(() => { throw new Error("Extension context invalidated."); });
    const statuses: string[] = [];
    const onBridgeTerminated = vi.fn();
    const bridge = connectPanelBridge({ onStatusChange: status => statuses.push(status), onCaptureMessage: vi.fn(), onBridgeTerminated }, PANEL_SESSION_ID);
    expect(statuses).toEqual(["bridge disconnected"]);
    expect(onBridgeTerminated).toHaveBeenCalledTimes(1);
    bridge.disconnect();
  });

  it("resolves a pending Server Injection as Unknown on disconnect without resending it", async () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    const send = vi.fn((requestId: string, panelSessionId: string) => ({ requestId, panelSessionId, ok: true, status: "started", timestamp: 1 }));
    (globalThis as Record<string, unknown>)[PAGE_SERVER_INJECTION_BRIDGE_GLOBAL] = { version: PAGE_SERVER_INJECTION_BRIDGE_VERSION, send };
    const runtime = installChrome(() => { const port = createFakePort(); ports.push(port); return port; });
    (globalThis as { chrome: { devtools: { inspectedWindow: Record<string, unknown> } } }).chrome.devtools.inspectedWindow.eval =
      (expression: string, callback: (value: unknown, info?: unknown) => void) => callback(globalThis.eval(expression));
    const bridge = connectPanelBridge({ onStatusChange: vi.fn(), onCaptureMessage: vi.fn() }, PANEL_SESSION_ID);
    try {
      const result = bridge.sendServerInjection!({ sourceEventId: null, target: { pageEpoch: "p", clientId: "c", sessionId: "s" }, message: "m", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false }, "server-1");
      ports[0]!.disconnect();
      await expect(result).resolves.toMatchObject({ requestId: "server-1", ok: false, status: "unknown" });
      vi.advanceTimersByTime(500);
      expect(runtime.connect).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      bridge.disconnect();
      delete (globalThis as Record<string, unknown>)[PAGE_SERVER_INJECTION_BRIDGE_GLOBAL];
    }
  });
});

describe("PendingRequests", () => {
  it("settles once, times out to its fallback, and drains with a disconnect result", async () => {
    vi.useFakeTimers();
    const pending = new PendingRequests<{ id: string; state: string }>((id, reason) => ({ id, state: `unknown:${reason}` }));
    const settled = new Promise(resolve => pending.add("a", resolve, 100, () => ({ id: "a", state: "timeout" })));
    const timed = new Promise(resolve => pending.add("b", resolve, 100, () => ({ id: "b", state: "timeout" })));
    const drained = new Promise(resolve => pending.add("c", resolve, 1000, () => ({ id: "c", state: "timeout" })));
    expect(pending.settle("a", { id: "a", state: "ok" })).toBe(true);
    expect(pending.settle("a", { id: "a", state: "again" })).toBe(false);
    vi.advanceTimersByTime(100);
    expect(pending.has("b")).toBe(false);
    pending.settleAll("lost");
    expect(pending.has("c")).toBe(false);
    await expect(settled).resolves.toEqual({ id: "a", state: "ok" });
    await expect(timed).resolves.toEqual({ id: "b", state: "timeout" });
    await expect(drained).resolves.toEqual({ id: "c", state: "unknown:lost" });
    vi.advanceTimersByTime(10_000);
  });
});

describe("inspected-page bridge expressions", () => {
  it("calls a compatible Server Injection bridge and reports an incompatible one as unavailable", () => {
    const draft = { sourceEventId: null, target: { pageEpoch: "p", clientId: "c", sessionId: "s" }, message: "m", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false };
    const expression = pageServerInjectionExpression("r", PANEL_SESSION_ID, draft);
    expect(vm.runInNewContext(expression, {})).toEqual({ bridgeState: "unavailable" });
    expect(vm.runInNewContext(expression, { [PAGE_SERVER_INJECTION_BRIDGE_GLOBAL]: { version: -1, send() { return 1; } } })).toEqual({ bridgeState: "unavailable" });
    const sandbox = { [PAGE_SERVER_INJECTION_BRIDGE_GLOBAL]: { version: PAGE_SERVER_INJECTION_BRIDGE_VERSION, send: (...args: unknown[]) => args } };
    expect(JSON.parse(JSON.stringify(vm.runInNewContext(expression, sandbox)))).toEqual({ bridgeState: "result", result: ["r", PANEL_SESSION_ID, draft] });
    // A throwing send must surface as an evaluation exception, never a bridge error.
    expect(() => vm.runInNewContext(expression, { [PAGE_SERVER_INJECTION_BRIDGE_GLOBAL]: { version: PAGE_SERVER_INJECTION_BRIDGE_VERSION, send() { throw new Error("sent?"); } } })).toThrow("sent?");
  });

  it("reports Message Recipe adapter incompatibility, asynchrony and throws as errors", () => {
    const context = { pageEpoch: "p", clientId: "c", sessionId: "s" } as unknown as Parameters<typeof pageClientMessageRecipeExpression>[0];
    const expression = pageClientMessageRecipeExpression(context);
    const run = (adapter: unknown) => JSON.parse(JSON.stringify(vm.runInNewContext(expression, adapter === undefined ? {} : { [PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL]: adapter })));
    expect(run(undefined)).toEqual({ bridgeState: "unavailable" });
    expect(run({ version: -1, list() { return []; } })).toEqual({ bridgeState: "error", error: "The application exposes an incompatible Message Recipe adapter." });
    expect(run({ version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION, list: () => ({ then() {} }) })).toEqual({ bridgeState: "error", error: "Message Recipe adapters must return synchronously." });
    expect(run({ version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION, list() { throw "plain"; } })).toEqual({ bridgeState: "error", error: "The application Message Recipe adapter threw." });
    expect(run({ version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION, list: (value: unknown) => [value] })).toEqual({ bridgeState: "result", recipes: [context] });
  });
});
