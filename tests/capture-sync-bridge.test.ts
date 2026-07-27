import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_REQUEST,
  CONTENT_REINJECT_RESULT,
  PAGE_CAPTURE_SYNC_REQUEST,
  PAGE_REINJECT_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  RUNTIME_REINJECT_RESULT,
  type ReinjectionDraftPayload
} from "../src/bridge/messages";

describe("active subscription capture synchronization bridge", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("requests a content-script sync when a panel registers its inspected tab", async () => {
    let connectListener: ((port: chrome.runtime.Port) => void) | null = null;
    const portMessageListeners: Array<(message: unknown) => void> = [];
    const sendMessage = vi.fn((_tabId: number, _message: unknown, callback: () => void) => {
      callback();
    });
    const port = {
      name: PANEL_PORT_NAME,
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          portMessageListeners.push(listener);
        }
      },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn()
    } as unknown as chrome.runtime.Port;

    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        lastError: undefined,
        onConnect: {
          addListener(listener: (port: chrome.runtime.Port) => void) {
            connectListener = listener;
          }
        },
        onMessage: { addListener: vi.fn() }
      },
      tabs: { sendMessage }
    } as unknown as typeof chrome;

    await import("../src/extension/background");
    const notifyConnect = connectListener as ((port: chrome.runtime.Port) => void) | null;
    expect(notifyConnect).not.toBeNull();
    notifyConnect?.(port);
    portMessageListeners[0]({ type: PANEL_REGISTER_MESSAGE, tabId: 42 });

    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { type: CONTENT_CAPTURE_SYNC_REQUEST },
      expect.any(Function)
    );
  });

  it("forwards a content sync request into the inspected page", async () => {
    let runtimeMessageListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: () => void) => boolean)
      | null = null;
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);

    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: {
          addListener(listener: NonNullable<typeof runtimeMessageListener>) {
            runtimeMessageListener = listener as typeof runtimeMessageListener;
          }
        }
      }
    } as unknown as typeof chrome;

    await import("../src/content/content-script");
    const forwardRuntimeMessage = runtimeMessageListener as
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: () => void) => boolean)
      | null;
    expect(forwardRuntimeMessage).not.toBeNull();
    const asyncResponse = forwardRuntimeMessage?.(
      { type: CONTENT_CAPTURE_SYNC_REQUEST },
      {} as chrome.runtime.MessageSender,
      vi.fn()
    );

    expect(asyncResponse).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({ type: PAGE_CAPTURE_SYNC_REQUEST }, "*");
  });

  it("returns the final page result through both feedback protocols", async () => {
    let runtimeMessageListener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean)
      | null = null;
    const sendMessage = vi.fn((_message: unknown, callback?: () => void) => callback?.());
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        (message as { type?: unknown }).type !== PAGE_REINJECT_REQUEST
      ) {
        return;
      }
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            type: RUNTIME_REINJECT_RESULT,
            result: {
              requestId: (message as { requestId: string }).requestId,
              ok: true,
              status: "success",
              timestamp: 1_784_737_272_925
            }
          }
        })
      );
    });

    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        lastError: undefined,
        sendMessage,
        onMessage: {
          addListener(listener: NonNullable<typeof runtimeMessageListener>) {
            runtimeMessageListener = listener as typeof runtimeMessageListener;
          }
        }
      }
    } as unknown as typeof chrome;

    await import("../src/content/content-script");
    const forwardRuntimeMessage = runtimeMessageListener as unknown as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean;
    const sendResponse = vi.fn();
    const asyncResponse = forwardRuntimeMessage(
      {
        type: CONTENT_REINJECT_REQUEST,
        requestId: "success-request",
        draft: wireDraft()
      },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(asyncResponse).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();

    const expectedResult = {
      requestId: "success-request",
      ok: true,
      status: "success",
      timestamp: 1_784_737_272_925
    };
    expect(sendResponse).toHaveBeenCalledWith(expectedResult);
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: CONTENT_REINJECT_RESULT,
        result: expectedResult
      },
      expect.any(Function)
    );
  });

  it("uses a request-scoped response port when the page window result is blocked", async () => {
    vi.useFakeTimers();
    let runtimeMessageListener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean)
      | null = null;
    const sendMessage = vi.fn((_message: unknown, callback?: () => void) => callback?.());
    const channel = new TestMessageChannel();
    const MessageChannelConstructor = vi.fn(function createTestMessageChannel() {
      return channel;
    });
    vi.stubGlobal(
      "MessageChannel",
      MessageChannelConstructor as unknown as typeof MessageChannel
    );
    let listenerDeliveries = 0;
    vi.spyOn(window, "postMessage").mockImplementation(
      ((
        message: unknown,
        _targetOrigin: string,
        transfer?: Transferable[]
      ) => {
        if (
          typeof message !== "object" ||
          message === null ||
          (message as { type?: unknown }).type !== PAGE_REINJECT_REQUEST
        ) {
          return;
        }
        listenerDeliveries += 1;
        const responsePort = transfer?.[0] as unknown as TestMessagePort | undefined;
        responsePort?.postMessage({
          type: RUNTIME_REINJECT_RESULT,
          result: {
            requestId: (message as { requestId: string }).requestId,
            ok: true,
            status: "success",
            timestamp: 1_784_737_272_925
          }
        });
        // Deliberately do not dispatch a window MessageEvent: production app
        // code has intercepted the shared result channel.
      }) as typeof window.postMessage
    );

    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        lastError: undefined,
        sendMessage,
        onMessage: {
          addListener(listener: NonNullable<typeof runtimeMessageListener>) {
            runtimeMessageListener = listener as typeof runtimeMessageListener;
          }
        }
      }
    } as unknown as typeof chrome;

    await import("../src/content/content-script");
    const forwardRuntimeMessage = runtimeMessageListener as unknown as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean;
    const sendResponse = vi.fn();
    const asyncResponse = forwardRuntimeMessage(
      {
        type: CONTENT_REINJECT_REQUEST,
        requestId: "request-scoped-channel",
        draft: wireDraft()
      },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(asyncResponse).toBe(true);
    expect(listenerDeliveries).toBe(1);
    await Promise.resolve();
    await Promise.resolve();

    const expectedResult = {
      requestId: "request-scoped-channel",
      ok: true,
      status: "success",
      timestamp: 1_784_737_272_925
    };
    expect(MessageChannelConstructor).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(expectedResult);
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: CONTENT_REINJECT_RESULT,
        result: expectedResult
      },
      expect.any(Function)
    );
  });

  it("returns a page timeout through both feedback protocols", async () => {
    vi.useFakeTimers();
    let runtimeMessageListener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean)
      | null = null;
    const sendMessage = vi.fn((_message: unknown, callback?: () => void) => callback?.());

    (globalThis as { chrome: typeof chrome }).chrome = {
      runtime: {
        lastError: undefined,
        sendMessage,
        onMessage: {
          addListener(listener: NonNullable<typeof runtimeMessageListener>) {
            runtimeMessageListener = listener as typeof runtimeMessageListener;
          }
        }
      }
    } as unknown as typeof chrome;

    await import("../src/content/content-script");
    const forwardRuntimeMessage = runtimeMessageListener as unknown as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean;
    const sendResponse = vi.fn();
    const asyncResponse = forwardRuntimeMessage(
      {
        type: CONTENT_REINJECT_REQUEST,
        requestId: "timeout-request",
        draft: wireDraft()
      },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(asyncResponse).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "timeout-request",
        ok: false,
        status: "bridge-error",
        error: "Timed out waiting for page reinjection result."
      })
    );
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: CONTENT_REINJECT_RESULT,
        result: expect.objectContaining({
          requestId: "timeout-request",
          ok: false,
          status: "bridge-error",
          error: "Timed out waiting for page reinjection result."
        })
      },
      expect.any(Function)
    );
  });
});

function wireDraft(): ReinjectionDraftPayload {
  return {
    sourceEventId: "event-17",
    executionTarget: "captured-wire",
    target: { subscriptionId: "subscription-3", listenerId: null },
    item: { name: "snappHome.SNAPP", position: 1 },
    command: "ADD",
    key: "MESSENGER_TICKER_6675530.MESSENGER",
    fields: {
      key: "MESSENGER_TICKER_6675530.MESSENGER",
      command: "ADD",
      modelId: "MESSENGER",
      modelValues: '{"messageText":"mutated"}'
    },
    changedFields: { modelValues: '{"messageText":"mutated"}' },
    isSnapshot: true,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}

class TestMessagePort {
  private peer: TestMessagePort | null = null;
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  connect(peer: TestMessagePort): void {
    this.peer = peer;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  postMessage(data: unknown): void {
    this.peer?.dispatch(data);
  }

  start(): void {}

  close(): void {
    this.listeners.clear();
  }

  private dispatch(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class TestMessageChannel {
  readonly port1 = new TestMessagePort();
  readonly port2 = new TestMessagePort();

  constructor() {
    this.port1.connect(this.port2);
    this.port2.connect(this.port1);
  }
}
