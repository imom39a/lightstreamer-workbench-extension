import {
  type CaptureMessage,
  type CaptureStatus,
  type PanelSessionId,
  type PageReinjectionExecutionTarget,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  type ServerInjectionDraftPayload,
  type ServerInjectionStartResult,
  type TopologySyncFrame,
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PAGE_SERVER_INJECTION_BRIDGE_GLOBAL,
  PAGE_SERVER_INJECTION_BRIDGE_VERSION,
  PANEL_PORT_NAME,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  createPanelSessionId,
  isPanelCaptureMessage,
  isPanelTopologySyncFrameMessage,
  isPanelReinjectResultMessage,
  isPanelStatusMessage,
  isServerInjectionDraftPayload,
  isServerInjectionStartResult
} from "../../bridge/messages";
import {
  type DraftFieldValue,
  type ReinjectionDraft,
  validateDraftForExecutionTarget
} from "../../core/reinjection-draft";
import {
  type ServerInjectionDraft,
  type ServerInjectionExecutionResult
} from "../../core/server-injection";

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
  sendServerInjection?(draft: ServerInjectionDraft): Promise<ServerInjectionExecutionResult>;
  disconnect(): void;
};

const RECONNECT_DELAY_MS = 500;
const REINJECT_TIMEOUT_MS = 8000;
const INSPECTED_PAGE_EVAL_TIMEOUT_MS = 5000;
const SERVER_INJECTION_OUTCOME_TIMEOUT_MS = 30_000;

type PageReinjectionEvaluation =
  | { bridgeState: "unavailable" }
  | { bridgeState: "result"; result: unknown };

export function connectPanelBridge(
  handlers: PanelBridgeHandlers,
  panelSessionId: PanelSessionId = createPanelSessionId()
): PanelBridgeConnection {
  if (typeof chrome === "undefined" || !chrome.runtime?.connect || !chrome.devtools) {
    handlers.onStatusChange("bridge disconnected");
    return {
      reinjectDraft() {
        return Promise.resolve(createBridgeErrorResult(createRequestId(), "Bridge is disconnected.", panelSessionId));
      },
      sendServerInjection() {
        return Promise.resolve(createServerBridgeErrorResult(
          createServerInjectionRequestId(),
          "Bridge is disconnected."
        ));
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
  const pendingServerInjections = new Map<
    string,
    {
      resolve(result: ServerInjectionExecutionResult): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const connect = () => {
    if (disposed) {
      return;
    }

    port = chrome.runtime.connect({ name: PANEL_PORT_NAME });

    port.onMessage.addListener((message) => {
      if (isPanelStatusMessage(message) && message.panelSessionId === panelSessionId) {
        handlers.onStatusChange(message.status);
        return;
      }

      if (isPanelCaptureMessage(message) && message.panelSessionId === panelSessionId) {
        resolveServerInjectionFromCapture(message.message);
        handlers.onCaptureMessage(message.message);
        return;
      }

      if (isPanelTopologySyncFrameMessage(message) && message.panelSessionId === panelSessionId) {
        handlers.onTopologySyncFrame?.(message.frame);
        return;
      }

      if (isPanelReinjectResultMessage(message) && message.panelSessionId === panelSessionId) {
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
      resolvePendingServerInjectionsUnknown(
        "Bridge disconnected before the Client Message outcome was observed."
      );
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    port.postMessage({
      type: PANEL_REGISTER_MESSAGE,
      tabId,
      panelSessionId
    });

  };

  connect();

  return {
    reinjectDraft(draft, executionTarget = "captured-listener") {
      const requestId = createRequestId();
      const payload = serializeDraft(draft, executionTarget);
      if (!payload) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Draft is not valid for reinjection.", panelSessionId));
      }

      if (!port) {
        return Promise.resolve(createBridgeErrorResult(requestId, "Bridge is disconnected.", panelSessionId));
      }

      if (typeof chrome.devtools.inspectedWindow.eval === "function") {
        return reinjectThroughInspectedPage(requestId, panelSessionId, payload).then((result) => {
          return result ?? reinjectThroughRuntime(requestId, payload);
        });
      }

      return reinjectThroughRuntime(requestId, payload);
    },
    sendServerInjection(draft) {
      const requestId = createServerInjectionRequestId();
      if (!isServerInjectionDraftPayload(draft)) {
        return Promise.resolve(createServerBridgeErrorResult(
          requestId,
          "Server Injection Draft is invalid."
        ));
      }
      if (!port || typeof chrome.devtools.inspectedWindow.eval !== "function") {
        return Promise.resolve(createServerBridgeErrorResult(
          requestId,
          "The inspected-page Server Injection bridge is unavailable. Reload the page with DevTools open."
        ));
      }
      return sendServerInjectionThroughInspectedPage(requestId, draft);
    },
    disconnect() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      resolvePendingWithAcknowledgementUnknown(
        "Bridge disconnected before reinjection completed."
      );
      resolvePendingServerInjectionsUnknown(
        "Bridge disconnected before the Client Message outcome was observed."
      );
      port?.disconnect();
    }
  };

  function reinjectThroughRuntime(
    requestId: string,
    payload: ReinjectionDraftPayload
  ): Promise<ReinjectionResult> {
    if (!port) {
      return Promise.resolve(createBridgeErrorResult(requestId, "Bridge is disconnected.", panelSessionId));
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingReinjections.delete(requestId);
        resolve(
          createAcknowledgementUnknownResult(
            requestId,
            "Timed out waiting for reinjection result.",
            panelSessionId
          )
        );
      }, REINJECT_TIMEOUT_MS);

      pendingReinjections.set(requestId, { resolve, timer });
      try {
        port?.postMessage({
          type: PANEL_REINJECT_REQUEST,
          requestId,
          panelSessionId,
          draft: payload
        });
      } catch (error) {
        pendingReinjections.delete(requestId);
        clearTimeout(timer);
        resolve(
          createBridgeErrorResult(
            requestId,
            error instanceof Error ? error.message : "Could not post the reinjection request.",
            panelSessionId
          )
        );
      }
    });
  }

  function resolvePendingWithAcknowledgementUnknown(error: string) {
    for (const [requestId, pending] of pendingReinjections.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(createAcknowledgementUnknownResult(requestId, error, panelSessionId));
    }
    pendingReinjections.clear();
  }

  function sendServerInjectionThroughInspectedPage(
    requestId: string,
    draft: ServerInjectionDraftPayload
  ): Promise<ServerInjectionExecutionResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingServerInjections.delete(requestId);
        resolve(createServerUnknownResult(
          requestId,
          "No terminal ClientMessageListener outcome was observed. Do not repeat automatically."
        ));
      }, Math.max(
        SERVER_INJECTION_OUTCOME_TIMEOUT_MS,
        (draft.delayTimeout ?? 0) + INSPECTED_PAGE_EVAL_TIMEOUT_MS
      ));
      pendingServerInjections.set(requestId, { resolve, timer });

      try {
        chrome.devtools.inspectedWindow.eval<unknown>(
          pageServerInjectionExpression(requestId, panelSessionId, draft),
          (value, exceptionInfo) => {
            const pending = pendingServerInjections.get(requestId);
            if (!pending) return;
            if (exceptionInfo?.isError || exceptionInfo?.isException) {
              finishServerInjection(createServerUnknownResult(
                requestId,
                exceptionInfo.description || exceptionInfo.value ||
                  "The page evaluation ended without a trustworthy acknowledgement. Do not repeat automatically."
              ));
              return;
            }
            const evaluation = readPageServerInjectionEvaluation(value);
            if (evaluation?.bridgeState === "unavailable") {
              finishServerInjection(createServerBridgeErrorResult(
                requestId,
                "The inspected page has no compatible Server Injection bridge. Reload it with DevTools open."
              ));
              return;
            }
            if (
              !evaluation ||
              evaluation.bridgeState !== "result" ||
              !isServerInjectionStartResult(evaluation.result) ||
              evaluation.result.panelSessionId !== panelSessionId ||
              evaluation.result.requestId !== requestId
            ) {
              finishServerInjection(createServerUnknownResult(
                requestId,
                "The inspected page returned an invalid acknowledgement. Do not repeat automatically."
              ));
              return;
            }
            if (!evaluation.result.ok) {
              finishServerInjection(resultFromServerInjectionStart(evaluation.result));
            }
            // started/duplicate remain pending for the captured listener outcome.
          }
        );
      } catch (error) {
        finishServerInjection(createServerBridgeErrorResult(
          requestId,
          error instanceof Error ? error.message : "The Server Injection evaluation could not be started."
        ));
      }
    });
  }

  function resolveServerInjectionFromCapture(message: CaptureMessage): void {
    const payload = asRecord(message.payload.clientMessage);
    const injection = asRecord(payload?.injection);
    const requestId = typeof injection?.requestId === "string" ? injection.requestId : null;
    if (
      !requestId ||
      injection?.panelSessionId !== panelSessionId ||
      !pendingServerInjections.has(requestId)
    ) return;
    const timestamp = message.timestamp;
    if (message.kind === "client-message-processed") {
      finishServerInjection({
        requestId,
        ok: true,
        status: "processed",
        timestamp,
        response: nullableString(payload?.response)
      });
    } else if (message.kind === "client-message-denied") {
      finishServerInjection({
        requestId,
        ok: false,
        status: "denied",
        timestamp,
        code: nullableNumber(payload?.code),
        error: nullableString(payload?.error) ?? "The server denied the Client Message."
      });
    } else if (message.kind === "client-message-discarded") {
      finishServerInjection({
        requestId,
        ok: false,
        status: "discarded",
        timestamp,
        error: "The Client Message did not reach the Metadata Adapter."
      });
    } else if (message.kind === "client-message-error") {
      finishServerInjection(createServerUnknownResult(
        requestId,
        "Lightstreamer reported an error with an unknown processing outcome.",
        timestamp
      ));
    } else if (message.kind === "client-message-aborted") {
      const sentOnNetwork = payload?.sentOnNetwork === true;
      finishServerInjection(sentOnNetwork
        ? {
            ...createServerUnknownResult(
              requestId,
              "The Client Message was aborted after network transmission; server effects are unknown.",
              timestamp
            ),
            sentOnNetwork: true
          }
        : {
            requestId,
            ok: false,
            status: "aborted",
            timestamp,
            sentOnNetwork: false,
            error: "The Client Message was aborted before network transmission."
          });
    }
  }

  function finishServerInjection(result: ServerInjectionExecutionResult): void {
    const pending = pendingServerInjections.get(result.requestId);
    if (!pending) return;
    pendingServerInjections.delete(result.requestId);
    clearTimeout(pending.timer);
    pending.resolve(Object.freeze(result));
  }

  function resolvePendingServerInjectionsUnknown(error: string): void {
    for (const requestId of [...pendingServerInjections.keys()]) {
      finishServerInjection(createServerUnknownResult(requestId, error));
    }
  }
}

type PageServerInjectionEvaluation =
  | { bridgeState: "unavailable" }
  | { bridgeState: "result"; result: unknown };

export function pageServerInjectionExpression(
  requestId: string,
  panelSessionId: PanelSessionId,
  draft: ServerInjectionDraftPayload
): string {
  const bridgeName = JSON.stringify(PAGE_SERVER_INJECTION_BRIDGE_GLOBAL);
  return `(() => {
    const bridge = globalThis[${bridgeName}];
    if (!bridge || bridge.version !== ${PAGE_SERVER_INJECTION_BRIDGE_VERSION} || typeof bridge.send !== "function") {
      return { bridgeState: "unavailable" };
    }
    return {
      bridgeState: "result",
      result: bridge.send(${JSON.stringify(requestId)}, ${JSON.stringify(panelSessionId)}, ${JSON.stringify(draft)})
    };
  })()`;
}

function readPageServerInjectionEvaluation(value: unknown): PageServerInjectionEvaluation | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.bridgeState === "unavailable") return { bridgeState: "unavailable" };
  if (record.bridgeState === "result" && Object.prototype.hasOwnProperty.call(record, "result")) {
    return { bridgeState: "result", result: record.result };
  }
  return null;
}

function resultFromServerInjectionStart(
  result: ServerInjectionStartResult
): ServerInjectionExecutionResult {
  if (result.status === "stale-target") {
    return {
      requestId: result.requestId,
      ok: false,
      status: "stale-target",
      timestamp: result.timestamp,
      error: result.error
    };
  }
  if (result.status === "send-threw") {
    return createServerUnknownResult(
      result.requestId,
      `${result.error ?? "LightstreamerClient.sendMessage threw."} The call may already have caused effects; do not repeat automatically.`,
      result.timestamp
    );
  }
  return createServerBridgeErrorResult(
    result.requestId,
    result.error ?? "Server Injection could not be started.",
    result.timestamp
  );
}

function createServerBridgeErrorResult(
  requestId: string,
  error: string,
  timestamp = Date.now()
): ServerInjectionExecutionResult {
  return { requestId, ok: false, status: "bridge-error", timestamp, error };
}

function createServerUnknownResult(
  requestId: string,
  error: string,
  timestamp = Date.now()
): ServerInjectionExecutionResult {
  return { requestId, ok: false, status: "unknown", timestamp, error };
}

function createServerInjectionRequestId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `server-injection-${Date.now()}-${random}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reinjectThroughInspectedPage(
  requestId: string,
  panelSessionId: PanelSessionId,
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
        createAcknowledgementUnknownResult(
          requestId,
          "The DevTools page evaluation did not complete. Reload the inspected page and try again.",
          panelSessionId
        )
      );
    }, INSPECTED_PAGE_EVAL_TIMEOUT_MS);

    evaluate(pageReinjectionExpression(requestId, panelSessionId, draft));

    function evaluate(expression: string): void {
      try {
        chrome.devtools.inspectedWindow.eval<unknown>(
          expression,
          (result, exceptionInfo) => {
            if (settled) {
              return;
            }
            if (exceptionInfo?.isError || exceptionInfo?.isException) {
              finish(
                createAcknowledgementUnknownResult(
                  requestId,
                  exceptionInfo.description ||
                    exceptionInfo.value ||
                    "The inspected page rejected the reinjection evaluation.",
                  panelSessionId
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
              panelSessionId,
              result: evaluation?.bridgeState === "result" ? evaluation.result : undefined
            };
            if (!isPanelReinjectResultMessage(message) || message.result.requestId !== requestId) {
              finish(
                createAcknowledgementUnknownResult(
                  requestId,
                  "The inspected page reinjection bridge returned an invalid result. Reload the inspected page and capture a fresh update.",
                  panelSessionId
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
              : "The inspected page reinjection evaluation could not be started.",
            panelSessionId
          )
        );
      }
    }
  });
}

export function pageReinjectionExpression(
  requestId: string,
  panelSessionId: PanelSessionId,
  draft: ReinjectionDraftPayload
): string {
  const bridgeName = JSON.stringify(PAGE_REINJECTION_BRIDGE_GLOBAL);
  const serializedRequestId = JSON.stringify(requestId);
  const serializedPanelSessionId = JSON.stringify(panelSessionId);
  const serializedDraft = JSON.stringify(draft);
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
        result: bridge.reinject(${serializedRequestId}, ${serializedPanelSessionId}, ${serializedDraft})
      };
    }
    return { bridgeState: "unavailable" };
  })()`;
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

function createBridgeErrorResult(
  requestId: string,
  error: string,
  panelSessionId: PanelSessionId
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
  error: string,
  panelSessionId: PanelSessionId
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
