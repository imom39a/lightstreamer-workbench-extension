import {
  type CaptureMessage,
  type CaptureStatus,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  isPanelCaptureMessage,
  isPanelReinjectResultMessage,
  isPanelStatusMessage
} from "../../bridge/messages";
import {
  type DraftFieldValue,
  type ReinjectionDraft,
  validateReinjectionDraft
} from "../../core/reinjection-draft";

export type PanelBridgeHandlers = {
  onStatusChange(status: CaptureStatus): void;
  onCaptureMessage(message: CaptureMessage): void;
};

export type PanelBridgeConnection = {
  reinjectDraft(draft: ReinjectionDraft): Promise<ReinjectionResult>;
  disconnect(): void;
};

const RECONNECT_DELAY_MS = 500;
const REINJECT_TIMEOUT_MS = 3000;

export function connectPanelBridge(handlers: PanelBridgeHandlers): PanelBridgeConnection {
  if (typeof chrome === "undefined" || !chrome.runtime?.connect || !chrome.devtools) {
    handlers.onStatusChange("bridge disconnected");
    return {
      reinjectDraft() {
        return Promise.resolve(createBridgeErrorResult(createRequestId(), "Bridge is disconnected."));
      },
      disconnect() {}
    };
  }

  const tabId = chrome.devtools.inspectedWindow.tabId;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let port: chrome.runtime.Port | null = null;
  const pendingReinjections = new Map<
    string,
    {
      resolve(result: ReinjectionResult): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const connect = () => {
    if (disposed) {
      return;
    }

    port = chrome.runtime.connect({ name: PANEL_PORT_NAME });

    port.onMessage.addListener((message) => {
      if (isPanelStatusMessage(message)) {
        handlers.onStatusChange(message.status);
        return;
      }

      if (isPanelCaptureMessage(message)) {
        handlers.onCaptureMessage(message.message);
        return;
      }

      if (isPanelReinjectResultMessage(message)) {
        const pending = pendingReinjections.get(message.result.requestId);
        if (!pending) {
          return;
        }
        pendingReinjections.delete(message.result.requestId);
        clearTimeout(pending.timer);
        pending.resolve(message.result);
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      if (disposed) {
        return;
      }

      handlers.onStatusChange("bridge disconnected");
      resolvePendingWithBridgeError("Bridge disconnected before reinjection completed.");
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    port.postMessage({
      type: PANEL_REGISTER_MESSAGE,
      tabId
    });

    handlers.onStatusChange("bridge connected");
  };

  connect();

  return {
    reinjectDraft(draft) {
      const requestId = createRequestId();
      const payload = serializeDraft(draft);
      if (!payload) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Draft is not valid for reinjection."));
      }

      if (!port) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Bridge is disconnected."));
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingReinjections.delete(requestId);
          resolve(createBridgeErrorResult(requestId, "Timed out waiting for reinjection result."));
        }, REINJECT_TIMEOUT_MS);

        pendingReinjections.set(requestId, { resolve, timer });
        port?.postMessage({
          type: PANEL_REINJECT_REQUEST,
          requestId,
          draft: payload
        });
      });
    },
    disconnect() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      resolvePendingWithBridgeError("Bridge disconnected before reinjection completed.");
      port?.disconnect();
    }
  };

  function resolvePendingWithBridgeError(error: string) {
    for (const [requestId, pending] of pendingReinjections.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(createBridgeErrorResult(requestId, error));
    }
    pendingReinjections.clear();
  }
}

function serializeDraft(draft: ReinjectionDraft): ReinjectionDraftPayload | null {
  const validation = validateReinjectionDraft(draft);
  if (!validation.valid || !draft.target.subscriptionId || !draft.target.listenerId) {
    return null;
  }

  if (!draft.command || !draft.key) {
    return null;
  }

  return {
    sourceEventId: draft.sourceEventId,
    target: {
      subscriptionId: draft.target.subscriptionId,
      listenerId: draft.target.listenerId
    },
    item: {
      name: draft.item.name ?? null,
      position: draft.item.position ?? null
    },
    command: draft.command,
    key: draft.key,
    fields: copyFields(draft.fields),
    changedFields: copyFields(draft.changedFields),
    isSnapshot: draft.isSnapshot,
    provenance: {
      ...draft.provenance,
      manualChangedFieldsOverride: draft.manualChangedFieldsOverride
    }
  };
}

function copyFields(fields: Record<string, DraftFieldValue>) {
  return { ...fields };
}

function createRequestId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `reinject-${Date.now()}-${random}`;
}

function createBridgeErrorResult(requestId: string, error: string): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}
