import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_REQUEST,
  PANEL_CAPTURE_MESSAGE,
  PANEL_PORT_NAME,
  PANEL_REINJECT_RESULT,
  PANEL_STATUS_MESSAGE,
  type ReinjectionResult,
  isContentReinjectResultMessage,
  isPanelRegisterMessage,
  isPanelReinjectRequestMessage,
  isPanelReinjectResultMessage,
  isRuntimeCaptureMessage
} from "../bridge/messages";

const panelPortsByTab = new Map<number, chrome.runtime.Port>();
const tabByPort = new WeakMap<chrome.runtime.Port, number>();
const pendingReinjections = new Map<
  string,
  {
    tabId: number;
    port: chrome.runtime.Port;
  }
>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) {
    return;
  }

  port.onMessage.addListener((message) => {
    if (isPanelRegisterMessage(message)) {
      panelPortsByTab.set(message.tabId, port);
      tabByPort.set(port, message.tabId);
      port.postMessage({
        type: PANEL_STATUS_MESSAGE,
        status: "bridge connected"
      });
      requestActiveSubscriptionSync(message.tabId);
      return;
    }

    if (!isPanelReinjectRequestMessage(message)) {
      return;
    }

    const tabId = tabByPort.get(port);
    if (tabId === undefined) {
      port.postMessage({
        type: PANEL_REINJECT_RESULT,
        result: createBridgeErrorResult(message.requestId, "Panel is not registered to an inspected tab.")
      });
      return;
    }

    pendingReinjections.set(pendingReinjectionKey(tabId, message.requestId), {
      tabId,
      port
    });
    chrome.tabs.sendMessage(
      tabId,
      {
        type: CONTENT_REINJECT_REQUEST,
        requestId: message.requestId,
        draft: message.draft
      },
      (response: unknown) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (!runtimeError && response === true) {
          return;
        }

        const resultMessage = {
          type: PANEL_REINJECT_RESULT,
          result: response
        };
        if (
          !runtimeError &&
          isPanelReinjectResultMessage(resultMessage) &&
          resultMessage.result.requestId === message.requestId
        ) {
          deliverReinjectionResult(tabId, resultMessage.result);
          return;
        }

        deliverReinjectionResult(
          tabId,
          createBridgeErrorResult(
            message.requestId,
            runtimeError ??
              "Content script did not accept the reinjection request. Reload the inspected page and try again."
          )
        );
      }
    );
  });

  port.onDisconnect.addListener(() => {
    const tabId = tabByPort.get(port);
    if (tabId !== undefined && panelPortsByTab.get(tabId) === port) {
      panelPortsByTab.delete(tabId);
    }
    for (const [key, pending] of pendingReinjections) {
      if (pending.port === port) {
        pendingReinjections.delete(key);
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (isContentReinjectResultMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return false;
    }
    deliverReinjectionResult(tabId, message.result);
    return false;
  }

  if (!isRuntimeCaptureMessage(message)) {
    return false;
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return false;
  }

  const panelPort = panelPortsByTab.get(tabId);
  panelPort?.postMessage({
    type: PANEL_CAPTURE_MESSAGE,
    message: message.message
  });

  return false;
});

function createBridgeErrorResult(requestId: string, error: string): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}

function deliverReinjectionResult(tabId: number, result: ReinjectionResult): boolean {
  const key = pendingReinjectionKey(tabId, result.requestId);
  const pending = pendingReinjections.get(key);
  if (!pending || pending.tabId !== tabId) {
    return false;
  }

  pendingReinjections.delete(key);
  pending.port.postMessage({
    type: PANEL_REINJECT_RESULT,
    result
  });
  return true;
}

function pendingReinjectionKey(tabId: number, requestId: string): string {
  return JSON.stringify([tabId, requestId]);
}

function requestActiveSubscriptionSync(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: CONTENT_CAPTURE_SYNC_REQUEST }, () => {
    void chrome.runtime.lastError;
  });
}
