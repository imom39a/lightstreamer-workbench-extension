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
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL,
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
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
import {
  errorClientMessageRecipes,
  normalizeClientMessageRecipes,
  unavailableClientMessageRecipes,
  type ClientMessageRecipeContext,
  type ClientMessageRecipeResolution
} from "../../core/client-message-recipe";

export type PanelBridgeHandlers = {
  onStatusChange(status: CaptureStatus): void;
  onCaptureMessage(message: CaptureMessage): void;
  onTopologySyncFrame?(frame: TopologySyncFrame): void;
  /**
   * The bridge can never reconnect from this panel document, for example after
   * the extension was reloaded or updated. The panel must be reopened.
   */
  onBridgeTerminated?(detail: PanelBridgeTermination): void;
};

export type PanelBridgeTermination = Readonly<{
  reason: "extension-context-invalidated";
  message: string;
}>;

export type PanelBridgeConnection = {
  reinjectDraft(
    draft: ReinjectionDraft,
    executionTarget?: PageReinjectionExecutionTarget
  ): Promise<ReinjectionResult>;
  sendServerInjection?(draft: ServerInjectionDraft, requestId?: string): Promise<ServerInjectionExecutionResult>;
  resolveClientMessageRecipes?(
    context: ClientMessageRecipeContext
  ): Promise<ClientMessageRecipeResolution>;
  disconnect(): void;
};

const RECONNECT_INITIAL_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;
const REINJECT_TIMEOUT_MS = 8000;
const INSPECTED_PAGE_EVAL_TIMEOUT_MS = 5000;
const SERVER_INJECTION_OUTCOME_TIMEOUT_MS = 30_000;

/** Capped exponential reconnect delay; the first retry keeps the historical 500ms. */
export function panelBridgeReconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_INITIAL_DELAY_MS * 2 ** Math.max(0, Math.min(attempt, 16)));
}

/**
 * Request ids awaiting a terminal result. Each entry resolves exactly once:
 * by settle(), by its own timeout fallback, or by settleAll() on disconnect.
 * Draining never retries a request; callers choose an Unknown-style result.
 */
export class PendingRequests<T> {
  private readonly entries = new Map<string, { resolve(result: T): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly disconnectedResult: (requestId: string, reason: string) => T) {}

  add(requestId: string, resolve: (result: T) => void, timeoutMs: number, timedOut: () => T): void {
    const timer = setTimeout(() => {
      this.entries.delete(requestId);
      resolve(timedOut());
    }, timeoutMs);
    this.entries.set(requestId, { resolve, timer });
  }

  has(requestId: string): boolean {
    return this.entries.has(requestId);
  }

  settle(requestId: string, result: T): boolean {
    const pending = this.entries.get(requestId);
    if (!pending) return false;
    this.entries.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(result);
    return true;
  }

  settleAll(reason: string): void {
    for (const requestId of [...this.entries.keys()]) {
      this.settle(requestId, this.disconnectedResult(requestId, reason));
    }
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/extension context invalidated/i.test(message)) return true;
  const runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;
  return !runtime || !runtime.id;
}

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
      resolveClientMessageRecipes() {
        return Promise.resolve(unavailableClientMessageRecipes(
          "The inspected-page bridge is disconnected, so application Message Recipes are unavailable."
        ));
      },
      disconnect() {}
    };
  }

  const tabId = chrome.devtools.inspectedWindow.tabId;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let port: chrome.runtime.Port | null = null;
  let reconnectAttempt = 0;
  let terminated = false;
  const pendingReinjections = new PendingRequests<ReinjectionResult>(
    (requestId, reason) => createAcknowledgementUnknownResult(requestId, reason, panelSessionId)
  );
  // Server Injection is never retried: a lost outcome stays Unknown.
  const pendingServerInjections = new PendingRequests<ServerInjectionExecutionResult>(
    (requestId, reason) => Object.freeze(createServerUnknownResult(requestId, reason))
  );

  const scheduleReconnect = () => {
    if (disposed || terminated) return;
    reconnectTimer = setTimeout(connect, panelBridgeReconnectDelay(reconnectAttempt));
    reconnectAttempt += 1;
  };

  const terminate = (error: unknown) => {
    terminated = true;
    port = null;
    handlers.onStatusChange("bridge disconnected");
    handlers.onBridgeTerminated?.({
      reason: "extension-context-invalidated",
      message: error instanceof Error && error.message
        ? error.message
        : "The extension context was invalidated. Close and reopen DevTools to reconnect Workbench."
    });
  };

  const connect = () => {
    reconnectTimer = null;
    if (disposed || terminated) {
      return;
    }

    let connected: chrome.runtime.Port;
    try {
      connected = chrome.runtime.connect({ name: PANEL_PORT_NAME });
    } catch (error) {
      // A timer-driven reconnect must never throw into the event loop and
      // silently end reconnection.
      if (isExtensionContextInvalidated(error)) {
        terminate(error);
        return;
      }
      if (reconnectAttempt === 0) handlers.onStatusChange("bridge disconnected");
      scheduleReconnect();
      return;
    }
    port = connected;

    connected.onMessage.addListener((message) => {
      // Any background reply proves the port is live; restart the backoff.
      reconnectAttempt = 0;
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
        pendingReinjections.settle(message.result.requestId, message.result);
      }
    });

    connected.onDisconnect.addListener(() => {
      if (port === connected) port = null;
      if (disposed || terminated) {
        return;
      }

      handlers.onStatusChange("bridge disconnected");
      resolvePendingAfterDisconnect();
      scheduleReconnect();
    });

    try {
      connected.postMessage({
        type: PANEL_REGISTER_MESSAGE,
        tabId,
        panelSessionId
      });
    } catch (error) {
      // The port was lost before registration; its disconnect listener
      // schedules the retry. Only an invalidated context is terminal.
      if (isExtensionContextInvalidated(error)) {
        resolvePendingAfterDisconnect();
        terminate(error);
      }
    }
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
    sendServerInjection(draft, reservedRequestId) {
      const requestId = reservedRequestId ?? createServerInjectionRequestId();
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
    resolveClientMessageRecipes(context) {
      if (!port || typeof chrome.devtools.inspectedWindow.eval !== "function") {
        return Promise.resolve(errorClientMessageRecipes(
          "Workbench could not inspect the application's Message Recipe adapter. Reload the page with DevTools open."
        ));
      }
      return resolveClientMessageRecipesThroughInspectedPage(context);
    },
    disconnect() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      resolvePendingAfterDisconnect();
      port?.disconnect();
    }
  };

  function resolvePendingAfterDisconnect(): void {
    pendingReinjections.settleAll("Bridge disconnected before reinjection completed.");
    pendingServerInjections.settleAll("Bridge disconnected before the Client Message outcome was observed.");
  }

  function reinjectThroughRuntime(
    requestId: string,
    payload: ReinjectionDraftPayload
  ): Promise<ReinjectionResult> {
    if (!port) {
      return Promise.resolve(createBridgeErrorResult(requestId, "Bridge is disconnected.", panelSessionId));
    }

    return new Promise((resolve) => {
      pendingReinjections.add(requestId, resolve, REINJECT_TIMEOUT_MS, () =>
        createAcknowledgementUnknownResult(
          requestId,
          "Timed out waiting for reinjection result.",
          panelSessionId
        )
      );
      try {
        port?.postMessage({
          type: PANEL_REINJECT_REQUEST,
          requestId,
          panelSessionId,
          draft: payload
        });
      } catch (error) {
        pendingReinjections.settle(
          requestId,
          createBridgeErrorResult(
            requestId,
            error instanceof Error ? error.message : "Could not post the reinjection request.",
            panelSessionId
          )
        );
      }
    });
  }

  function sendServerInjectionThroughInspectedPage(
    requestId: string,
    draft: ServerInjectionDraftPayload
  ): Promise<ServerInjectionExecutionResult> {
    return new Promise((resolve) => {
      pendingServerInjections.add(requestId, resolve, Math.max(
        SERVER_INJECTION_OUTCOME_TIMEOUT_MS,
        (draft.delayTimeout ?? 0) + INSPECTED_PAGE_EVAL_TIMEOUT_MS
      ), () => createServerUnknownResult(
        requestId,
        "No terminal ClientMessageListener outcome was observed. Do not repeat automatically."
      ));

      try {
        chrome.devtools.inspectedWindow.eval<unknown>(
          pageServerInjectionExpression(requestId, panelSessionId, draft),
          (value, exceptionInfo) => {
            if (!pendingServerInjections.has(requestId)) return;
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
    pendingServerInjections.settle(result.requestId, Object.freeze(result));
  }

  function resolveClientMessageRecipesThroughInspectedPage(
    context: ClientMessageRecipeContext
  ): Promise<ClientMessageRecipeResolution> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ClientMessageRecipeResolution) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish(errorClientMessageRecipes(
          "The inspected application's Message Recipe adapter did not respond in time."
        ));
      }, INSPECTED_PAGE_EVAL_TIMEOUT_MS);

      try {
        chrome.devtools.inspectedWindow.eval<unknown>(
          pageClientMessageRecipeExpression(context),
          (value, exceptionInfo) => {
            if (exceptionInfo?.isError || exceptionInfo?.isException) {
              finish(errorClientMessageRecipes(
                exceptionInfo.description || exceptionInfo.value ||
                  "The inspected application rejected the Message Recipe request."
              ));
              return;
            }
            const evaluation = readPageClientMessageRecipeEvaluation(value);
            if (evaluation?.bridgeState === "unavailable") {
              finish(unavailableClientMessageRecipes(
                "This application does not expose a Workbench Message Recipe adapter."
              ));
              return;
            }
            if (evaluation?.bridgeState === "error") {
              finish(errorClientMessageRecipes(evaluation.error));
              return;
            }
            if (!evaluation || evaluation.bridgeState !== "result") {
              finish(errorClientMessageRecipes(
                "The inspected application returned an invalid Message Recipe response."
              ));
              return;
            }
            finish(normalizeClientMessageRecipes(evaluation.recipes));
          }
        );
      } catch (error) {
        finish(errorClientMessageRecipes(
          error instanceof Error
            ? error.message
            : "The Message Recipe evaluation could not be started."
        ));
      }
    });
  }
}

type PageBridgeEvaluation<K extends string> =
  | { bridgeState: "unavailable" }
  | { bridgeState: "error"; error: string }
  | ({ bridgeState: "result" } & { [key in K]: unknown });

type PageBridgeCall = Readonly<{
  global: string;
  version: number;
  method: string;
  args: readonly unknown[];
  resultKey: string;
  /** Report a present but incompatible bridge as an error instead of unavailable. */
  incompatibleError?: string;
  /**
   * Contain synchronous throws and thenables as error evaluations. Without a
   * guard a throw propagates as an evaluation exception, which Server
   * Injection must keep treating as an Unknown outcome.
   */
  guard?: Readonly<{ asynchronousError: string; thrownError: string }>;
}>;

/** Build one versioned inspected-page bridge call. Arguments are JSON literals only. */
function pageBridgeCallExpression(call: PageBridgeCall): string {
  const name = JSON.stringify(call.global);
  const method = JSON.stringify(call.method);
  const resultKey = JSON.stringify(call.resultKey);
  const args = call.args.map((value) => JSON.stringify(value)).join(", ");
  const compatible = `bridge.version === ${call.version} && typeof bridge[${method}] === "function"`;
  const availability = call.incompatibleError === undefined
    ? `if (!bridge || !(${compatible})) return { bridgeState: "unavailable" };`
    : `if (!bridge) return { bridgeState: "unavailable" };
    if (!(${compatible})) return { bridgeState: "error", error: ${JSON.stringify(call.incompatibleError)} };`;
  const invoke = call.guard === undefined
    ? `return { bridgeState: "result", [${resultKey}]: bridge[${method}](${args}) };`
    : `try {
      const value = bridge[${method}](${args});
      if (value && typeof value.then === "function") {
        return { bridgeState: "error", error: ${JSON.stringify(call.guard.asynchronousError)} };
      }
      return { bridgeState: "result", [${resultKey}]: value };
    } catch (error) {
      return { bridgeState: "error", error: error instanceof Error ? error.message : ${JSON.stringify(call.guard.thrownError)} };
    }`;
  return `(() => {
    const bridge = globalThis[${name}];
    ${availability}
    ${invoke}
  })()`;
}

function readPageBridgeEvaluation<K extends string>(
  value: unknown,
  resultKey: K,
  acceptErrors: boolean
): PageBridgeEvaluation<K> | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.bridgeState === "unavailable") return { bridgeState: "unavailable" };
  if (acceptErrors && record.bridgeState === "error" && typeof record.error === "string") {
    return { bridgeState: "error", error: record.error };
  }
  if (record.bridgeState === "result" && Object.prototype.hasOwnProperty.call(record, resultKey)) {
    return { bridgeState: "result", [resultKey]: record[resultKey] } as PageBridgeEvaluation<K>;
  }
  return null;
}

export function pageClientMessageRecipeExpression(
  context: ClientMessageRecipeContext
): string {
  return pageBridgeCallExpression({
    global: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL,
    version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
    method: "list",
    args: [context],
    resultKey: "recipes",
    incompatibleError: "The application exposes an incompatible Message Recipe adapter.",
    guard: {
      asynchronousError: "Message Recipe adapters must return synchronously.",
      thrownError: "The application Message Recipe adapter threw."
    }
  });
}

function readPageClientMessageRecipeEvaluation(value: unknown) {
  return readPageBridgeEvaluation(value, "recipes", true);
}

export function pageServerInjectionExpression(
  requestId: string,
  panelSessionId: PanelSessionId,
  draft: ServerInjectionDraftPayload
): string {
  return pageBridgeCallExpression({
    global: PAGE_SERVER_INJECTION_BRIDGE_GLOBAL,
    version: PAGE_SERVER_INJECTION_BRIDGE_VERSION,
    method: "send",
    args: [requestId, panelSessionId, draft],
    resultKey: "result"
  });
}

function readPageServerInjectionEvaluation(value: unknown) {
  return readPageBridgeEvaluation(value, "result", false);
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
  return pageBridgeCallExpression({
    global: PAGE_REINJECTION_BRIDGE_GLOBAL,
    version: PAGE_REINJECTION_BRIDGE_VERSION,
    method: "reinject",
    args: [requestId, panelSessionId, draft],
    resultKey: "result"
  });
}

function readPageReinjectionEvaluation(value: unknown) {
  return readPageBridgeEvaluation(value, "result", false);
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
