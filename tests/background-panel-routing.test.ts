import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_CAPTURE_MESSAGE,
  CONTENT_REINJECT_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  RUNTIME_CAPTURE_MESSAGE,
  RUNTIME_TOPOLOGY_SYNC_FRAME,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_VERSION,
  createCaptureMessage
} from "../src/bridge/messages";

const panelA = "panel-00000000-0000-4000-8000-000000000001";
const panelB = "panel-00000000-0000-4000-8000-000000000002";

describe("Panel Session background routing", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("broadcasts one tab's live Capture to both registered panels without replacement", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );

    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelB });

    const firstCapture = createCaptureMessage("client-created", { client: { id: "client-1" } });
    const secondCapture = createCaptureMessage("client-created", { client: { id: "client-2" } });
    onMessage?.(
      { type: RUNTIME_CAPTURE_MESSAGE, message: firstCapture },
      { tab: { id: 7 } } as chrome.runtime.MessageSender
    );
    onMessage?.(
      { type: RUNTIME_CAPTURE_MESSAGE, message: secondCapture },
      { tab: { id: 7 } } as chrome.runtime.MessageSender
    );

    expect(firstMessages.filter((message) => (message as { type?: unknown }).type === PANEL_CAPTURE_MESSAGE)).toEqual([
      {
        type: PANEL_CAPTURE_MESSAGE,
        panelSessionId: panelA,
        message: firstCapture
      },
      {
        type: PANEL_CAPTURE_MESSAGE,
        panelSessionId: panelA,
        message: secondCapture
      }
    ]);
    expect(secondMessages.filter((message) => (message as { type?: unknown }).type === PANEL_CAPTURE_MESSAGE)).toEqual([
      {
        type: PANEL_CAPTURE_MESSAGE,
        panelSessionId: panelB,
        message: firstCapture
      },
      {
        type: PANEL_CAPTURE_MESSAGE,
        panelSessionId: panelB,
        message: secondCapture
      }
    ]);
  });

  it("isolates different tabs and removes only the disconnected registration", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const otherTabMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    const otherTab = fakePort(otherTabMessages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );
    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelB });
    onConnect?.(otherTab.port);
    otherTab.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 8, panelSessionId: "panel-00000000-0000-4000-8000-000000000003" });

    first.port.disconnect();
    const tabSevenCapture = createCaptureMessage("client-created", { client: { id: "tab-7" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: tabSevenCapture }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    const tabEightCapture = createCaptureMessage("client-created", { client: { id: "tab-8" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: tabEightCapture }, { tab: { id: 8 } } as chrome.runtime.MessageSender);

    expect(firstMessages.filter((message) => (message as { type?: unknown }).type === PANEL_CAPTURE_MESSAGE)).toHaveLength(0);
    expect(secondMessages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: panelB, message: tabSevenCapture });
    expect(otherTabMessages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: "panel-00000000-0000-4000-8000-000000000003", message: tabEightCapture });
    expect(otherTabMessages).not.toContainEqual(expect.objectContaining({ message: tabSevenCapture }));
  });

  it("keeps sync replay request-scoped while subsequent live captures broadcast", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );
    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelB });
    const replay = createCaptureMessage("item-update", { update: { key: "replay" }, replay: true });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, panelSessionId: panelB, message: { ...replay, panelSessionId: panelB } }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    const live = createCaptureMessage("item-update", { update: { key: "live" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: live }, { tab: { id: 7 } } as chrome.runtime.MessageSender);

    expect(firstMessages).not.toContainEqual(expect.objectContaining({ message: replay }));
    expect(secondMessages).toContainEqual({
      type: PANEL_CAPTURE_MESSAGE,
      panelSessionId: panelB,
      message: { ...replay, panelSessionId: panelB }
    });
    expect(firstMessages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: panelA, message: live });
    expect(secondMessages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: panelB, message: live });
  });

  it("ignores stale re-registration and preserves the original route", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const messages: unknown[] = [];
    const portState = fakePort(messages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );
    await import("../src/extension/background");
    onConnect?.(portState.port);
    portState.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    portState.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 8, panelSessionId: panelB });
    const tabSevenCapture = createCaptureMessage("client-created", { client: { id: "tab-7" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: tabSevenCapture }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    const tabEightCapture = createCaptureMessage("client-created", { client: { id: "tab-8" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: tabEightCapture }, { tab: { id: 8 } } as chrome.runtime.MessageSender);
    expect(messages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: panelA, message: tabSevenCapture });
    expect(messages).not.toContainEqual(expect.objectContaining({ message: tabEightCapture }));
  });

  it("rejects a second port claiming an existing Panel Session without evicting its owner", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );
    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 8, panelSessionId: panelA });

    const capture = createCaptureMessage("client-created", { client: { id: "original-owner" } });
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: capture }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    onMessage?.({ type: RUNTIME_CAPTURE_MESSAGE, message: capture }, { tab: { id: 8 } } as chrome.runtime.MessageSender);

    expect(firstMessages).toContainEqual({ type: PANEL_CAPTURE_MESSAGE, panelSessionId: panelA, message: capture });
    expect(secondMessages).not.toContainEqual(expect.objectContaining({ type: PANEL_CAPTURE_MESSAGE }));
  });

  it("does not deliver a detached injection result after the callback already completed", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const messages: unknown[] = [];
    const portState = fakePort(messages);
    const sendMessage = vi.fn((_tabId: number, _message: unknown, callback?: (response?: unknown) => void) => {
      callback?.({ requestId: "request-detached", panelSessionId: panelA, ok: true, status: "success", timestamp: 1 });
    });
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener),
      sendMessage
    );
    await import("../src/extension/background");
    onConnect?.(portState.port);
    portState.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    portState.listeners[0]({ type: PANEL_REINJECT_REQUEST, panelSessionId: panelA, requestId: "request-detached", draft: validDraft() });
    const resultCount = () => messages.filter((message) => (message as { type?: unknown }).type === PANEL_REINJECT_RESULT).length;
    expect(resultCount()).toBe(1);
    onMessage?.({ type: "lsew:content-reinject-result", panelSessionId: panelA, result: { requestId: "request-detached", panelSessionId: panelA, ok: true, status: "success", timestamp: 2 } }, { tab: { id: 7 } } as chrome.runtime.MessageSender);
    expect(resultCount()).toBe(1);
  });

  it("keeps duplicate registration idempotent so disconnect removes pending work", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    const firstMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    let oldResponseCallback: ((response?: unknown) => void) | undefined;
    const sendMessage = vi.fn((_tabId: number, message: unknown, callback?: (response?: unknown) => void) => {
      if ((message as { type?: unknown }).type === CONTENT_REINJECT_REQUEST) {
        oldResponseCallback = callback;
      }
    });
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      () => undefined,
      sendMessage
    );
    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    first.listeners[0]({
      type: PANEL_REINJECT_REQUEST,
      panelSessionId: panelA,
      requestId: "request-duplicate-registration",
      draft: validDraft()
    });

    first.port.disconnect();
    oldResponseCallback?.({
      requestId: "request-duplicate-registration",
      panelSessionId: panelA,
      ok: true,
      status: "success",
      timestamp: 1
    });

    expect(
      sendMessage.mock.calls.filter(([_, message]) =>
        (message as { type?: unknown }).type === CONTENT_REINJECT_REQUEST
      )
    ).toHaveLength(1);
    expect(firstMessages).not.toContainEqual(
      expect.objectContaining({ type: PANEL_REINJECT_RESULT })
    );
  });

  it("delivers an injection result exactly once to its originating Panel Session", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    const sendMessage = vi.fn((_tabId: number, _message: unknown, callback?: (response?: unknown) => void) => {
      callback?.({
        requestId: "request-1",
        panelSessionId: panelA,
        ok: true,
        status: "success",
        timestamp: 1
      });
    });
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener),
      sendMessage
    );

    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelB });
    first.listeners[0]({
      type: PANEL_REINJECT_REQUEST,
      panelSessionId: panelA,
      requestId: "request-1",
      draft: validDraft()
    });

    expect(firstMessages).toContainEqual({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: panelA,
      result: expect.objectContaining({ requestId: "request-1", panelSessionId: panelA })
    });
    expect(secondMessages).not.toContainEqual(
      expect.objectContaining({ type: PANEL_REINJECT_RESULT, panelSessionId: panelA })
    );
    expect(sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ panelSessionId: panelA }), expect.any(Function));
  });

  it("targets a topology checkpoint to its requesting Panel Session", async () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => boolean) | undefined;
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = fakePort(firstMessages);
    const second = fakePort(secondMessages);
    (globalThis as { chrome: typeof chrome }).chrome = fakeChrome(
      (listener) => (onConnect = listener),
      (listener) => (onMessage = listener)
    );
    await import("../src/extension/background");
    onConnect?.(first.port);
    first.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelA });
    onConnect?.(second.port);
    second.listeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 7, panelSessionId: panelB });

    const frame = {
      type: TOPOLOGY_SYNC_BEGIN,
      version: TOPOLOGY_SYNC_VERSION,
      syncId: "sync-1",
      pageEpoch: "page-1",
      panelSessionId: panelA,
      cutoffCaptureSequence: 0,
      chunkCount: 0,
      recordCount: 0,
      coverage: { status: "complete" as const, getters: {} }
    };
    onMessage?.(
      { type: RUNTIME_TOPOLOGY_SYNC_FRAME, panelSessionId: panelA, frame },
      { tab: { id: 7 } } as chrome.runtime.MessageSender
    );

    expect(firstMessages).toContainEqual({
      type: "lsew:panel-topology-sync-frame",
      panelSessionId: panelA,
      frame
    });
    expect(secondMessages).not.toContainEqual(
      expect.objectContaining({ type: "lsew:panel-topology-sync-frame" })
    );
  });
});

function fakePort(messages: unknown[]) {
  const listeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const port = {
    name: PANEL_PORT_NAME,
    postMessage(message: unknown) {
      messages.push(message);
    },
    onMessage: { addListener(listener: (message: unknown) => void) { listeners.push(listener); } },
    onDisconnect: { addListener(listener: () => void) { disconnectListeners.push(listener); } },
    disconnect() {
      for (const listener of disconnectListeners) listener();
    }
  } as unknown as chrome.runtime.Port;
  return { port, listeners };
}

function fakeChrome(
  register: (listener: (port: chrome.runtime.Port) => void) => void,
  message: (listener: (value: unknown, sender: chrome.runtime.MessageSender) => boolean) => void,
  sendMessage: ReturnType<typeof vi.fn> = vi.fn((_tabId: number, _message: unknown, callback?: () => void) => callback?.())
) {
  return {
    runtime: {
      lastError: undefined,
      onConnect: { addListener: register },
      onMessage: { addListener: message }
    },
    tabs: { sendMessage }
  } as unknown as typeof chrome;
}

function validDraft() {
  return {
    sourceEventId: "event-1",
    executionTarget: "captured-wire" as const,
    target: { subscriptionId: "subscription-1", listenerId: null },
    item: { name: "item-1", position: 1 },
    command: "UPDATE",
    key: "key-1",
    fields: { value: 1 },
    changedFields: { value: 1 },
    isSnapshot: false,
    provenance: { source: "test" }
  };
}
