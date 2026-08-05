import {
  type CaptureMessage,
  type CaptureStatus,
  type PageReinjectionExecutionTarget,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  type TopologySyncFrame,
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PAGE_REINJECT_REQUEST,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  RUNTIME_REINJECT_RESULT,
  isPanelCaptureMessage,
  isPanelTopologySyncFrameMessage,
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
  onTopologySyncFrame?(frame: TopologySyncFrame): void;
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
const LEGACY_PAGE_REINJECT_POLL_MS = 50;
const LEGACY_PAGE_REINJECT_STATE_PREFIX = "__LSEW_LEGACY_REINJECTION__";

type PageReinjectionEvaluation =
  | { bridgeState: "unavailable" }
  | { bridgeState: "pending" }
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


      if (isPanelTopologySyncFrameMessage(message)) {
        handlers.onTopologySyncFrame?.(message.frame);
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
      resolvePendingWithAcknowledgementUnknown(
        "Bridge disconnected before reinjection completed."
      );
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
      resolvePendingWithAcknowledgementUnknown(
        "Bridge disconnected before reinjection completed."
      );
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
        resolve(
          createAcknowledgementUnknownResult(
            requestId,
            "Timed out waiting for reinjection result."
          )
        );
      }, REINJECT_TIMEOUT_MS);

      pendingReinjections.set(requestId, { resolve, timer });
      try {
        port?.postMessage({
          type: PANEL_REINJECT_REQUEST,
          requestId,
          draft: payload
        });
      } catch (error) {
        pendingReinjections.delete(requestId);
        clearTimeout(timer);
        resolve(
          createBridgeErrorResult(
            requestId,
            error instanceof Error ? error.message : "Could not post the reinjection request."
          )
        );
      }
    });
  }

  function resolvePendingWithAcknowledgementUnknown(error: string) {
    for (const [requestId, pending] of pendingReinjections.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(createAcknowledgementUnknownResult(requestId, error));
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
    let legacyRequestStarted = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: ReinjectionResult | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      resolve(result);
    };
    timer = setTimeout(() => {
      if (legacyRequestStarted) {
        cleanupLegacyPageReinjection(requestId);
      }
      finish(
        createAcknowledgementUnknownResult(
          requestId,
          legacyRequestStarted
            ? "Timed out waiting for the inspected-page reinjection result."
            : "The DevTools page evaluation did not complete. Reload the inspected page and try again."
        )
      );
    }, INSPECTED_PAGE_EVAL_TIMEOUT_MS);

    evaluate(pageReinjectionExpression(requestId, draft));

    function evaluate(expression: string): void {
      try {
        chrome.devtools.inspectedWindow.eval<unknown>(
          expression,
          (result, exceptionInfo) => {
            if (settled) {
              return;
            }
            if (exceptionInfo?.isError || exceptionInfo?.isException) {
              if (legacyRequestStarted) {
                cleanupLegacyPageReinjection(requestId);
              }
              finish(
                createAcknowledgementUnknownResult(
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
              if (legacyRequestStarted) {
                finish(
                  createAcknowledgementUnknownResult(
                    requestId,
                    "The inspected-page reinjection request lost its result channel. Reload the inspected page and capture a fresh update."
                  )
                );
                return;
              }
              finish(null);
              return;
            }
            if (evaluation?.bridgeState === "pending") {
              legacyRequestStarted = true;
              pollTimer = setTimeout(() => {
                pollTimer = null;
                evaluate(legacyPageReinjectionResultExpression(requestId));
              }, LEGACY_PAGE_REINJECT_POLL_MS);
              return;
            }

            const message = {
              type: PANEL_REINJECT_RESULT,
              result: evaluation?.bridgeState === "result" ? evaluation.result : undefined
            };
            if (!isPanelReinjectResultMessage(message) || message.result.requestId !== requestId) {
              if (legacyRequestStarted) {
                cleanupLegacyPageReinjection(requestId);
              }
              finish(
                createAcknowledgementUnknownResult(
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
        if (legacyRequestStarted) {
          cleanupLegacyPageReinjection(requestId);
        }
        finish(
          createBridgeErrorResult(
            requestId,
            error instanceof Error
              ? error.message
              : "The inspected page reinjection evaluation could not be started."
          )
        );
      }
    }
  });
}

function pageReinjectionExpression(
  requestId: string,
  draft: ReinjectionDraftPayload
): string {
  const bridgeName = JSON.stringify(PAGE_REINJECTION_BRIDGE_GLOBAL);
  const stateName = JSON.stringify(legacyPageReinjectionStateName(requestId));
  const serializedRequestId = JSON.stringify(requestId);
  const serializedDraft = JSON.stringify(draft);
  const pageRequestType = JSON.stringify(PAGE_REINJECT_REQUEST);
  const pageResultType = JSON.stringify(RUNTIME_REINJECT_RESULT);
  return `(() => {
    const host = globalThis;
    const bridge = host[${bridgeName}];
    if (bridge) {
      if (
        bridge.version !== ${PAGE_REINJECTION_BRIDGE_VERSION} ||
        typeof bridge.reinject !== "function"
      ) {
        return { bridgeState: "unavailable" };
      }
      return {
        bridgeState: "result",
        result: bridge.reinject(${serializedRequestId}, ${serializedDraft})
      };
    }
    if (
      typeof host.addEventListener !== "function" ||
      typeof host.removeEventListener !== "function" ||
      typeof host.postMessage !== "function"
    ) {
      return { bridgeState: "unavailable" };
    }
    const stateName = ${stateName};
    const existing = host[stateName];
    if (existing?.status === "pending") {
      return { bridgeState: "pending" };
    }
    if (existing?.status === "result") {
      const result = existing.result;
      existing.cleanup?.();
      delete host[stateName];
      return { bridgeState: "result", result };
    }
    let responsePort = null;
    const state = {
      status: "pending",
      result: undefined,
      cleanup: undefined
    };
    const accept = (value) => {
      if (
        !value ||
        value.type !== ${pageResultType} ||
        value.result?.requestId !== ${serializedRequestId}
      ) {
        return;
      }
      state.status = "result";
      state.result = value.result;
      state.cleanup?.();
    };
    const onWindowMessage = (event) => {
      if (event.source === host) {
        accept(event.data);
      }
    };
    const onPortMessage = (event) => accept(event.data);
    state.cleanup = () => {
      host.removeEventListener("message", onWindowMessage);
      responsePort?.removeEventListener?.("message", onPortMessage);
      responsePort?.close?.();
      responsePort = null;
    };
    try {
      Object.defineProperty(host, stateName, {
        configurable: true,
        enumerable: false,
        value: state
      });
      host.addEventListener("message", onWindowMessage);
      const request = {
        type: ${pageRequestType},
        requestId: ${serializedRequestId},
        draft: ${serializedDraft}
      };
      if (typeof host.MessageChannel === "function") {
        const channel = new host.MessageChannel();
        responsePort = channel.port1;
        responsePort.addEventListener("message", onPortMessage);
        responsePort.start();
        host.postMessage(request, "*", [channel.port2]);
      } else {
        host.postMessage(request, "*");
      }
      return { bridgeState: "pending" };
    } catch {
      state.cleanup?.();
      delete host[stateName];
      return { bridgeState: "unavailable" };
    }
  })()`;
}

function legacyPageReinjectionResultExpression(requestId: string): string {
  const stateName = JSON.stringify(legacyPageReinjectionStateName(requestId));
  return `(() => {
    const stateName = ${stateName};
    const state = globalThis[stateName];
    if (!state) {
      return { bridgeState: "unavailable" };
    }
    if (state.status !== "result") {
      return { bridgeState: "pending" };
    }
    const result = state.result;
    state.cleanup?.();
    delete globalThis[stateName];
    return { bridgeState: "result", result };
  })()`;
}

function cleanupLegacyPageReinjection(requestId: string): void {
  const stateName = JSON.stringify(legacyPageReinjectionStateName(requestId));
  try {
    chrome.devtools.inspectedWindow.eval(
      `(() => {
        const stateName = ${stateName};
        const state = globalThis[stateName];
        state?.cleanup?.();
        delete globalThis[stateName];
      })()`
    );
  } catch {
    // The inspected page may already be gone; its listeners are gone with it.
  }
}

function legacyPageReinjectionStateName(requestId: string): string {
  return `${LEGACY_PAGE_REINJECT_STATE_PREFIX}${requestId}`;
}

function readPageReinjectionEvaluation(value: unknown): PageReinjectionEvaluation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.bridgeState === "unavailable") {
    return { bridgeState: "unavailable" };
  }
  if (record.bridgeState === "pending") {
    return { bridgeState: "pending" };
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

function createAcknowledgementUnknownResult(
  requestId: string,
  error: string
): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "acknowledgement-unknown",
    timestamp: Date.now(),
    error
  };
}
