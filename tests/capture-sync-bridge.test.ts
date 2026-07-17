import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  PAGE_CAPTURE_SYNC_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE
} from "../src/bridge/messages";

describe("active subscription capture synchronization bridge", () => {
  afterEach(() => {
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
});
