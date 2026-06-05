import {
  CONTENT_REINJECT_REQUEST,
  PANEL_CAPTURE_MESSAGE,
  PANEL_PORT_NAME,
  PANEL_REINJECT_RESULT,
  PANEL_STATUS_MESSAGE,
  type ReinjectionResult,
  isPanelRegisterMessage,
  isPanelReinjectRequestMessage,
  isRuntimeCaptureMessage
} from "../bridge/messages";

const panelPortsByTab = new Map<number, chrome.runtime.Port>();
const tabByPort = new WeakMap<chrome.runtime.Port, number>();

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

    chrome.tabs.sendMessage(
      tabId,
      {
        type: CONTENT_REINJECT_REQUEST,
        requestId: message.requestId,
        draft: message.draft
      },
      (result: ReinjectionResult | undefined) => {
        const runtimeError = chrome.runtime.lastError?.message;
        port.postMessage({
          type: PANEL_REINJECT_RESULT,
          result:
            result ??
            createBridgeErrorResult(
              message.requestId,
              runtimeError ?? "Content script did not return a reinjection result."
            )
        });
      }
    );
  });

  port.onDisconnect.addListener(() => {
    const tabId = tabByPort.get(port);
    if (tabId !== undefined && panelPortsByTab.get(tabId) === port) {
      panelPortsByTab.delete(tabId);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
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
