import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_TOPOLOGY_SYNC_FRAME,
  RUNTIME_TOPOLOGY_SYNC_FRAME,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  type TopologyAbsoluteRecord,
  type TopologySyncBeginFrame
} from "../src/bridge/messages";
import { createTopologySyncCoordinator } from "../src/core/topology-sync";
import { connectPanelBridge } from "../src/extension/panel/bridge-client";

const frame: TopologySyncBeginFrame = {
  type: TOPOLOGY_SYNC_BEGIN,
  version: TOPOLOGY_SYNC_VERSION,
  syncId: "sync-a",
  pageEpoch: "page-a",
  cutoffCaptureSequence: 10,
  chunkCount: 0,
  recordCount: 0,
  coverage: { status: "complete", getters: {} }
};

describe("topology checkpoint bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("forwards validated page checkpoint frames through the content script", async () => {
    const sendMessage = vi.fn();
    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } }
    } as unknown as typeof chrome;
    await import("../src/content/content-script");

    window.dispatchEvent(new MessageEvent("message", { source: window, data: frame }));

    expect(sendMessage).toHaveBeenCalledWith({ type: RUNTIME_TOPOLOGY_SYNC_FRAME, frame });
  });

  it("routes validated runtime checkpoint frames only to the registered tab panel", async () => {
    let connectListener: ((port: chrome.runtime.Port) => void) | undefined;
    let runtimeListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender) => boolean)
      | undefined;
    const portMessages: Array<(message: unknown) => void> = [];
    const port = {
      name: PANEL_PORT_NAME,
      postMessage: vi.fn(),
      onMessage: { addListener: (listener: (message: unknown) => void) => portMessages.push(listener) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        lastError: undefined,
        onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => (connectListener = listener) },
        onMessage: {
          addListener: (listener: typeof runtimeListener) => (runtimeListener = listener)
        }
      },
      tabs: { sendMessage: vi.fn() }
    } as unknown as typeof chrome;
    await import("../src/extension/background");
    connectListener?.(port);
    portMessages[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 42 });

    runtimeListener?.(
      { type: RUNTIME_TOPOLOGY_SYNC_FRAME, frame },
      { tab: { id: 42 } as chrome.tabs.Tab }
    );

    expect(port.postMessage).toHaveBeenCalledWith({ type: PANEL_TOPOLOGY_SYNC_FRAME, frame });
  });

  it("delivers checkpoint frames through the optional panel bridge handler", () => {
    const messageListeners: Array<(message: unknown) => void> = [];
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: { connect: vi.fn(() => port) }
    } as unknown as typeof chrome;
    const onTopologySyncFrame = vi.fn();
    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn(),
      onTopologySyncFrame
    });

    messageListeners[0]({ type: PANEL_TOPOLOGY_SYNC_FRAME, frame });

    expect(onTopologySyncFrame).toHaveBeenCalledWith(frame);
    bridge.disconnect();
  });

  it("hydrates a getter-partial checkpoint delivered through the panel bridge", () => {
    const coverage = {
      status: "partial" as const,
      getters: { "ConnectionDetails.getSessionId": "missing" as const },
      reason: "getter-missing" as const
    };
    const records: TopologyAbsoluteRecord[] = [
      { kind: "page", id: "page-a", pageEpoch: "page-a", captureSequence: 1 },
      {
        kind: "client",
        id: "client-a",
        parentId: "page-a",
        pageEpoch: "page-a",
        captureSequence: 1
      }
    ];
    const metadata = {
      version: TOPOLOGY_SYNC_VERSION,
      syncId: "getter-partial",
      pageEpoch: "page-a",
      cutoffCaptureSequence: 10,
      chunkCount: 1,
      recordCount: records.length,
      coverage
    };
    const frames = [
      { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
      { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records },
      { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
    ] as const;
    const coordinator = createTopologySyncCoordinator("page-a");
    const messageListeners: Array<(message: unknown) => void> = [];
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: { connect: vi.fn(() => port) }
    } as unknown as typeof chrome;
    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn(),
      onTopologySyncFrame(received) {
        if (received.type === TOPOLOGY_SYNC_BEGIN) coordinator.begin(received);
        else if (received.type === TOPOLOGY_SYNC_CHUNK) coordinator.acceptChunk(received);
        else coordinator.complete(received);
      }
    });

    for (const checkpointFrame of frames) {
      messageListeners[0]({ type: PANEL_TOPOLOGY_SYNC_FRAME, frame: checkpointFrame });
    }

    expect(coordinator.snapshot().records.map((entry) => entry.id)).toEqual([
      "page-a",
      "client-a"
    ]);
    expect(coordinator.status()).toEqual({ state: "complete", retry: false, coverage });
    bridge.disconnect();
  });
});
