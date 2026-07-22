import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_RESULT,
  PAGE_REINJECT_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  RUNTIME_REINJECT_RESULT,
  type ReinjectionDraftPayload
} from "../src/bridge/messages";

describe("reinjection bridge round trip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("returns a page delivery result through content, background, and the registered panel", async () => {
    let registrationContext: "background" | "content" = "background";
    let connectListener: ((port: chrome.runtime.Port) => void) | null = null;
    let backgroundMessageListener: RuntimeMessageListener | null = null;
    let contentMessageListener: RuntimeMessageListener | null = null;
    const portMessageListeners: Array<(message: unknown) => void> = [];
    const panelMessages: unknown[] = [];

    const port = {
      name: PANEL_PORT_NAME,
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          portMessageListeners.push(listener);
        }
      },
      onDisconnect: { addListener: vi.fn() },
      postMessage(message: unknown) {
        panelMessages.push(message);
      }
    } as unknown as chrome.runtime.Port;

    const chromeApi = {
      runtime: {
        lastError: undefined,
        onConnect: {
          addListener(listener: (port: chrome.runtime.Port) => void) {
            connectListener = listener;
          }
        },
        onMessage: {
          addListener(listener: RuntimeMessageListener) {
            if (registrationContext === "background") {
              backgroundMessageListener = listener;
            } else {
              contentMessageListener = listener;
            }
          }
        },
        sendMessage(message: unknown, callback?: () => void) {
          backgroundMessageListener?.(
            message,
            { tab: { id: 42 } } as chrome.runtime.MessageSender,
            vi.fn()
          );
          callback?.();
        }
      },
      tabs: {
        sendMessage(
          _tabId: number,
          message: unknown,
          callback?: (response?: boolean) => void
        ) {
          if (!contentMessageListener) {
            callback?.(undefined);
            return;
          }
          let responded = false;
          contentMessageListener(
            message,
            {} as chrome.runtime.MessageSender,
            (response?: unknown) => {
              responded = true;
              callback?.(response === true);
            }
          );
          if (!responded && isCaptureSyncRequest(message)) {
            callback?.(undefined);
          }
        }
      }
    } as unknown as typeof chrome;
    (globalThis as { chrome: typeof chrome }).chrome = chromeApi;

    await import("../src/extension/background");
    registrationContext = "content";
    await import("../src/content/content-script");

    const postMessage = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      if (!isPageReinjectRequest(message)) {
        return;
      }
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            type: RUNTIME_REINJECT_RESULT,
            result: {
              requestId: message.requestId,
              ok: true,
              status: "success",
              timestamp: 1_784_737_272_925
            }
          }
        })
      );
    });

    const notifyConnect = connectListener as ((port: chrome.runtime.Port) => void) | null;
    expect(notifyConnect).not.toBeNull();
    notifyConnect?.(port);
    portMessageListeners[0]?.({ type: PANEL_REGISTER_MESSAGE, tabId: 42 });
    portMessageListeners[0]?.({
      type: PANEL_REINJECT_REQUEST,
      requestId: "roundtrip-1",
      draft: wireDraft()
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PAGE_REINJECT_REQUEST,
        requestId: "roundtrip-1"
      }),
      "*"
    );
    expect(panelMessages).toContainEqual({
      type: PANEL_REINJECT_RESULT,
      result: {
        requestId: "roundtrip-1",
        ok: true,
        status: "success",
        timestamp: 1_784_737_272_925
      }
    });
    expect(panelMessages).not.toContainEqual(
      expect.objectContaining({
        type: CONTENT_REINJECT_RESULT
      })
    );
  });
});

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

function isCaptureSyncRequest(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === CONTENT_CAPTURE_SYNC_REQUEST
  );
}

function isPageReinjectRequest(
  message: unknown
): message is { type: typeof PAGE_REINJECT_REQUEST; requestId: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === PAGE_REINJECT_REQUEST &&
    typeof (message as { requestId?: unknown }).requestId === "string"
  );
}

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
      modelValues: '{"messageText":"!!!!Attention - DDE QA testing."}'
    },
    changedFields: {
      modelValues: '{"messageText":"!!!!Attention - DDE QA testing."}'
    },
    isSnapshot: true,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}
