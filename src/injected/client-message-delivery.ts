import {
  type InjectionCorrelation,
  type ServerInjectionDraftPayload,
  type ServerInjectionStartResult
} from "../bridge/messages";
import {
  type LightstreamerClientLike,
  type LightstreamerClientMessageListenerLike
} from "../core/lightstreamer-types";

export const SERVER_INJECTION_LISTENER_CONTEXT = "__lsewServerInjectionContext" as const;

export type ServerInjectionListenerContext = InjectionCorrelation & {
  sourceEventId: string | null;
};

export type ClientMessageDeliveryRegistry = {
  register(clientId: string, client: LightstreamerClientLike): void;
  submit(
    correlation: InjectionCorrelation,
    draft: ServerInjectionDraftPayload
  ): ServerInjectionStartResult;
};

export type ClientMessageDeliveryDependencies = {
  pageEpoch: string;
  getSessionId(client: LightstreamerClientLike): string | null;
  getStatus(client: LightstreamerClientLike): string | null;
  now?: () => number;
};

const MAX_REMEMBERED_REQUESTS = 2_048;

/**
 * Owns exact-target lookup, preflight, and exactly-once invocation of the
 * inspected client's public sendMessage API. It deliberately has no retry path.
 */
export function createClientMessageDeliveryRegistry(
  dependencies: ClientMessageDeliveryDependencies
): ClientMessageDeliveryRegistry {
  const clients = new Map<string, LightstreamerClientLike>();
  const starts = new Map<string, ServerInjectionStartResult>();
  const now = dependencies.now ?? Date.now;

  return {
    register(clientId, client) {
      clients.set(clientId, client);
    },

    submit(correlation, draft) {
      const key = `${correlation.panelSessionId}:${correlation.requestId}`;
      const previous = starts.get(key);
      if (previous) {
        return {
          ...previous,
          ok: true,
          status: "duplicate",
          error: undefined
        };
      }

      const fail = (
        status: Exclude<ServerInjectionStartResult["status"], "started" | "duplicate">,
        error: string
      ): ServerInjectionStartResult => ({
        ...correlation,
        ok: false,
        status,
        timestamp: now(),
        error
      });

      if (draft.target.pageEpoch !== dependencies.pageEpoch) {
        return fail("stale-target", "The inspected page has reloaded since this Draft was created.");
      }

      const client = clients.get(draft.target.clientId);
      if (!client) {
        return fail("stale-target", "The selected Lightstreamer client is no longer available.");
      }
      if (typeof client.sendMessage !== "function") {
        return fail("unsupported", "The selected client does not expose LightstreamerClient.sendMessage.");
      }

      const sessionId = dependencies.getSessionId(client);
      const status = dependencies.getStatus(client);
      if (
        sessionId !== draft.target.sessionId ||
        !(status === "STALLED" || status?.startsWith("CONNECTED:"))
      ) {
        return fail("stale-target", "The selected client is no longer in the reviewed Session.");
      }

      const listener = createServerInjectionListener({
        ...correlation,
        sourceEventId: draft.sourceEventId
      });
      const started: ServerInjectionStartResult = {
        ...correlation,
        ok: true,
        status: "started",
        timestamp: now()
      };
      // Claim the correlation before crossing the page-owned API boundary. A
      // throwing implementation may already have caused effects.
      starts.set(key, started);
      trimRememberedRequests(starts);
      try {
        client.sendMessage(
          draft.message,
          draft.sequence,
          draft.delayTimeout ?? -1,
          listener,
          draft.enqueueWhileDisconnected
        );
      } catch (error) {
        const result = fail(
          "send-threw",
          error instanceof Error ? error.message : "LightstreamerClient.sendMessage threw."
        );
        starts.set(key, result);
        return result;
      }
      return started;
    }
  };
}

export function readServerInjectionListenerContext(
  listener: unknown
): ServerInjectionListenerContext | null {
  if (typeof listener !== "object" || listener === null) return null;
  const context = (listener as Record<string, unknown>)[SERVER_INJECTION_LISTENER_CONTEXT];
  if (typeof context !== "object" || context === null || Array.isArray(context)) return null;
  const value = context as Record<string, unknown>;
  if (
    typeof value.panelSessionId !== "string" ||
    typeof value.requestId !== "string" ||
    (value.sourceEventId !== null && typeof value.sourceEventId !== "string")
  ) {
    return null;
  }
  return {
    panelSessionId: value.panelSessionId,
    requestId: value.requestId,
    sourceEventId: value.sourceEventId as string | null
  };
}

function createServerInjectionListener(
  context: ServerInjectionListenerContext
): LightstreamerClientMessageListenerLike {
  const listener: LightstreamerClientMessageListenerLike = {
    onProcessed() {},
    onDeny() {},
    onDiscarded() {},
    onError() {},
    onAbort() {}
  };
  Object.defineProperty(listener, SERVER_INJECTION_LISTENER_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...context })
  });
  return listener;
}

function trimRememberedRequests(
  starts: Map<string, ServerInjectionStartResult>
): void {
  while (starts.size > MAX_REMEMBERED_REQUESTS) {
    const oldest = starts.keys().next().value;
    if (typeof oldest !== "string") return;
    starts.delete(oldest);
  }
}
