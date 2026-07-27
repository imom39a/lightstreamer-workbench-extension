import {
  type CaptureMessage,
  type CaptureStatus,
  type PageReinjectionExecutionTarget,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  isPanelCaptureMessage,
  isPanelReinjectResultMessage,
  isPanelStatusMessage
} from "../../bridge/messages";
import {
  type DraftFieldValue,
  type ReinjectionDraft,
  validateDraftForExecutionTarget
} from "../../core/reinjection-draft";

export type PanelBridgeHandlers = {
  onStatusChange(status: CaptureStatus): void;
  onCaptureMessage(message: CaptureMessage): void;
};

export type PanelBridgeConnection = {
  reinjectDraft(
    draft: ReinjectionDraft,
    executionTarget?: PageReinjectionExecutionTarget
  ): Promise<ReinjectionResult>;
  disconnect(): void;
};

const RECONNECT_DELAY_MS = 500;
const REINJECT_TIMEOUT_MS = 8000;
const INSPECTED_PAGE_EVAL_TIMEOUT_MS = 5000;

type PageReinjectionEvaluation =
  | { bridgeState: "unavailable" }
  | { bridgeState: "result"; result: unknown };

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
    reinjectDraft(draft, executionTarget = "captured-listener") {
      const requestId = createRequestId();
      const payload = serializeDraft(draft, executionTarget);
      if (!payload) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Draft is not valid for reinjection."));
      }

      if (!port) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Bridge is disconnected."));
      }

      if (typeof chrome.devtools.inspectedWindow.eval === "function") {
        return reinjectThroughInspectedPage(requestId, payload).then((result) => {
          return result ?? reinjectThroughRuntime(requestId, payload);
        });
      }

      return reinjectThroughRuntime(requestId, payload);
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

  function reinjectThroughRuntime(
    requestId: string,
    payload: ReinjectionDraftPayload
  ): Promise<ReinjectionResult> {
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
  }

  function resolvePendingWithBridgeError(error: string) {
    for (const [requestId, pending] of pendingReinjections.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(createBridgeErrorResult(requestId, error));
    }
    pendingReinjections.clear();
  }
}

function reinjectThroughInspectedPage(
  requestId: string,
  draft: ReinjectionDraftPayload
): Promise<ReinjectionResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: ReinjectionResult | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      finish(
        createBridgeErrorResult(
          requestId,
          "The DevTools page evaluation did not complete. Reload the inspected page and try again."
        )
      );
    }, INSPECTED_PAGE_EVAL_TIMEOUT_MS);

    try {
      chrome.devtools.inspectedWindow.eval<unknown>(
        pageReinjectionExpression(requestId, draft),
        (result, exceptionInfo) => {
          if (exceptionInfo?.isError || exceptionInfo?.isException) {
            finish(
              createBridgeErrorResult(
                requestId,
                exceptionInfo.description ||
                  exceptionInfo.value ||
                  "The inspected page rejected the reinjection evaluation."
              )
            );
            return;
          }

          const evaluation = readPageReinjectionEvaluation(result);
          if (evaluation?.bridgeState === "unavailable") {
            finish(null);
            return;
          }

          const message = {
            type: PANEL_REINJECT_RESULT,
            result: evaluation?.bridgeState === "result" ? evaluation.result : undefined
          };
          if (!isPanelReinjectResultMessage(message) || message.result.requestId !== requestId) {
            finish(
              createBridgeErrorResult(
                requestId,
                "The inspected page reinjection bridge returned an invalid result. Reload the inspected page and capture a fresh update."
              )
            );
            return;
          }
          finish(message.result);
        }
      );
    } catch (error) {
      finish(
        createBridgeErrorResult(
          requestId,
          error instanceof Error
            ? error.message
            : "The inspected page reinjection evaluation could not be started."
        )
      );
    }
  });
}

function pageReinjectionExpression(
  requestId: string,
  draft: ReinjectionDraftPayload
): string {
  const bridgeName = JSON.stringify(PAGE_REINJECTION_BRIDGE_GLOBAL);
  const serializedRequestId = JSON.stringify(requestId);
  const serializedDraft = JSON.stringify(draft);
  return `(() => { const bridge = globalThis[${bridgeName}]; if (!bridge || bridge.version !== ${PAGE_REINJECTION_BRIDGE_VERSION} || typeof bridge.reinject !== "function") return { bridgeState: "unavailable" }; return { bridgeState: "result", result: bridge.reinject(${serializedRequestId}, ${serializedDraft}) }; })()`;
}

function readPageReinjectionEvaluation(value: unknown): PageReinjectionEvaluation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.bridgeState === "unavailable") {
    return { bridgeState: "unavailable" };
  }
  if (record.bridgeState === "result" && Object.prototype.hasOwnProperty.call(record, "result")) {
    return { bridgeState: "result", result: record.result };
  }
  return null;
}

function serializeDraft(
  draft: ReinjectionDraft,
  executionTarget: PageReinjectionExecutionTarget
): ReinjectionDraftPayload | null {
  const validation = validateDraftForExecutionTarget(draft, executionTarget);
  if (!validation.valid || !draft.target.subscriptionId) {
    return null;
  }

  return {
    sourceEventId: draft.sourceEventId,
    executionTarget,
    target: {
      subscriptionId: draft.target.subscriptionId,
      listenerId: draft.target.listenerId ?? null
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
