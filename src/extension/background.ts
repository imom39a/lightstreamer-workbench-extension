import {
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_REQUEST,
  PANEL_CAPTURE_MESSAGE,
  PANEL_PORT_NAME,
  PANEL_REINJECT_RESULT,
  PANEL_STATUS_MESSAGE,
  PANEL_TOPOLOGY_SYNC_FRAME,
  type PanelSessionId,
  type ReinjectionResult,
  isContentReinjectResultMessage,
  isPanelRegisterMessage,
  isPanelReinjectRequestMessage,
  isRuntimeCaptureMessage,
  isRuntimeTopologySyncFrameMessage
} from "../bridge/messages";

type PanelRegistration = {
  tabId: number;
  panelSessionId: PanelSessionId;
  port: chrome.runtime.Port;
};

const panelPortsByTab = new Map<number, Map<PanelSessionId, PanelRegistration>>();
const registrationByPort = new WeakMap<chrome.runtime.Port, PanelRegistration>();
const pendingReinjections = new Map<
  string,
  {
    registration: PanelRegistration;
  }
>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) {
    return;
  }

  port.onMessage.addListener((message) => {
    if (isPanelRegisterMessage(message)) {
      registerPanel(port, message.tabId, message.panelSessionId);
      return;
    }

    if (!isPanelReinjectRequestMessage(message)) {
      return;
    }

    const registration = registrationByPort.get(port);
    if (
      !registration ||
      registration.panelSessionId !== message.panelSessionId
    ) {
      port.postMessage({
        type: PANEL_REINJECT_RESULT,
        panelSessionId: message.panelSessionId,
        result: createBridgeErrorResult(
          message.requestId,
          message.panelSessionId,
          "Panel is not registered to an inspected tab."
        )
      });
      return;
    }

    pendingReinjections.set(
      pendingReinjectionKey(registration.tabId, message.panelSessionId, message.requestId),
      { registration }
    );
    chrome.tabs.sendMessage(
      registration.tabId,
      {
        type: CONTENT_REINJECT_REQUEST,
        panelSessionId: message.panelSessionId,
        requestId: message.requestId,
        draft: message.draft
      },
      () => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (!runtimeError || isDetachedResultChannelClosedError(runtimeError)) {
          return;
        }
        deliverReinjectionResult(
          registration,
          runtimeError && !isMissingContentScriptReceiverError(runtimeError)
            ? createAcknowledgementUnknownResult(message.requestId, message.panelSessionId, runtimeError)
            : createBridgeErrorResult(
                message.requestId,
                message.panelSessionId,
                runtimeError ??
                  "Content script did not accept the reinjection request. Reload the inspected page and try again."
              )
        );
      }
    );
  });

  port.onDisconnect.addListener(() => {
    const registration = registrationByPort.get(port);
    if (!registration) {
      return;
    }
    removeRegistration(registration);
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (isContentReinjectResultMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return false;
    }
    const registration = panelPortsByTab.get(tabId)?.get(message.panelSessionId);
    if (registration) {
      deliverReinjectionResult(registration, message.result);
    }
    return false;
  }

  if (isRuntimeTopologySyncFrameMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return false;
    }
    const registrations = panelPortsByTab.get(tabId);
    if (!registrations) {
      return false;
    }
    const registration = registrations.get(message.panelSessionId);
    registration?.port.postMessage({
      type: PANEL_TOPOLOGY_SYNC_FRAME,
      panelSessionId: registration.panelSessionId,
      frame: message.frame
    });
    return false;
  }

  if (!isRuntimeCaptureMessage(message)) {
    return false;
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return false;
  }
  if (message.panelSessionId) {
    const registration = panelPortsByTab.get(tabId)?.get(message.panelSessionId);
    registration?.port.postMessage({
      type: PANEL_CAPTURE_MESSAGE,
      panelSessionId: registration.panelSessionId,
      message: message.message
    });
    return false;
  }
  for (const registration of panelPortsByTab.get(tabId)?.values() ?? []) {
    registration.port.postMessage({
      type: PANEL_CAPTURE_MESSAGE,
      panelSessionId: registration.panelSessionId,
      message: message.message
    });
  }

  return false;
});

function registerPanel(
  port: chrome.runtime.Port,
  tabId: number,
  panelSessionId: PanelSessionId
): void {
  const current = registrationByPort.get(port);
  if (current && current.tabId === tabId && current.panelSessionId === panelSessionId) {
    return;
  }
  if (current) {
    return;
  }
  for (const registrations of panelPortsByTab.values()) {
    if (registrations.has(panelSessionId)) {
      return;
    }
  }
  const registration: PanelRegistration = { tabId, panelSessionId, port };
  const registrations = panelPortsByTab.get(tabId) ?? new Map<PanelSessionId, PanelRegistration>();
  registrations.set(panelSessionId, registration);
  panelPortsByTab.set(tabId, registrations);
  registrationByPort.set(port, registration);
  port.postMessage({
    type: PANEL_STATUS_MESSAGE,
    panelSessionId,
    status: "bridge connected"
  });
  requestActiveSubscriptionSync(tabId, panelSessionId);
}

function removeRegistration(registration: PanelRegistration): void {
  const registrations = panelPortsByTab.get(registration.tabId);
  if (registrations?.get(registration.panelSessionId)?.port === registration.port) {
    registrations.delete(registration.panelSessionId);
    if (registrations.size === 0) {
      panelPortsByTab.delete(registration.tabId);
    }
  }
  if (registrationByPort.get(registration.port) === registration) {
    registrationByPort.delete(registration.port);
  }
  for (const [key, pending] of pendingReinjections) {
    if (pending.registration === registration) {
      pendingReinjections.delete(key);
    }
  }
}

function createBridgeErrorResult(
  requestId: string,
  panelSessionId: PanelSessionId,
  error: string
): ReinjectionResult {
  return {
    requestId,
    panelSessionId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}

function createAcknowledgementUnknownResult(
  requestId: string,
  panelSessionId: PanelSessionId,
  error: string
): ReinjectionResult {
  return {
    requestId,
    panelSessionId,
    ok: false,
    status: "acknowledgement-unknown",
    timestamp: Date.now(),
    error
  };
}

function isMissingContentScriptReceiverError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection")
  );
}

function isDetachedResultChannelClosedError(error: string): boolean {
  return error.toLowerCase().includes("message port closed before a response was received");
}

function deliverReinjectionResult(
  registration: PanelRegistration,
  result: ReinjectionResult
): boolean {
  const key = pendingReinjectionKey(
    registration.tabId,
    registration.panelSessionId,
    result.requestId
  );
  const pending = pendingReinjections.get(key);
  if (!pending || pending.registration.port !== registration.port) {
    return false;
  }

  pendingReinjections.delete(key);
  registration.port.postMessage({
    type: PANEL_REINJECT_RESULT,
    panelSessionId: registration.panelSessionId,
    result
  });
  return true;
}

function pendingReinjectionKey(
  tabId: number,
  panelSessionId: PanelSessionId,
  requestId: string
): string {
  return JSON.stringify([tabId, panelSessionId, requestId]);
}

function requestActiveSubscriptionSync(tabId: number, panelSessionId: PanelSessionId): void {
  chrome.tabs.sendMessage(
    tabId,
    { type: CONTENT_CAPTURE_SYNC_REQUEST, panelSessionId },
    () => {
      void chrome.runtime.lastError;
    }
  );
}
