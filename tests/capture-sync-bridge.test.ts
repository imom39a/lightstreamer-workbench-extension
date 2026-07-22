import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_REQUEST,
  CONTENT_REINJECT_RESULT,
  PAGE_CAPTURE_SYNC_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  type ReinjectionDraftPayload
} from "../src/bridge/messages";

describe("active subscription capture synchronization bridge", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("acknowledges reinjection immediately and relays a page timeout as an explicit result", async () => {
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

    expect(asyncResponse).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(true);

    await vi.advanceTimersByTimeAsync(5_000);

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
