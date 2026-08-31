import { describe, expect, it, vi } from "vitest";

import { type ServerInjectionDraftPayload } from "../src/bridge/messages";
import {
  createClientMessageDeliveryRegistry,
  readServerInjectionListenerContext
} from "../src/injected/client-message-delivery";

const correlation = {
  panelSessionId: "panel-00000000-0000-4000-8000-000000000017",
  requestId: "send-1"
};

function draft(): ServerInjectionDraftPayload {
  return {
    sourceEventId: "event-7",
    target: {
      pageEpoch: "page-1",
      clientId: "client-1",
      sessionId: "session-1"
    },
    message: "COMMAND|ADD|key-7",
    sequence: "orders",
    delayTimeout: 2_000,
    enqueueWhileDisconnected: false
  };
}

describe("client message delivery registry", () => {
  it("sends once through the exact live client and supplies a complete outcome listener", () => {
    const sendMessage = vi.fn();
    const client = { sendMessage };
    const registry = createClientMessageDeliveryRegistry({
      pageEpoch: "page-1",
      getSessionId: () => "session-1",
      getStatus: () => "CONNECTED:WS-STREAMING",
      now: () => 123
    });
    registry.register("client-1", client);

    expect(registry.submit(correlation, draft())).toEqual({
      ...correlation,
      ok: true,
      status: "started",
      timestamp: 123
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      "COMMAND|ADD|key-7",
      "orders",
      2_000,
      expect.objectContaining({
        onProcessed: expect.any(Function),
        onDeny: expect.any(Function),
        onDiscarded: expect.any(Function),
        onError: expect.any(Function),
        onAbort: expect.any(Function)
      }),
      false
    );
    const listener = sendMessage.mock.calls[0][3];
    expect(readServerInjectionListenerContext(listener)).toEqual({
      ...correlation,
      sourceEventId: "event-7"
    });
  });

  it("deduplicates a repeated correlation without calling sendMessage again", () => {
    const sendMessage = vi.fn();
    const registry = createClientMessageDeliveryRegistry({
      pageEpoch: "page-1",
      getSessionId: () => "session-1",
      getStatus: () => "STALLED"
    });
    registry.register("client-1", { sendMessage });

    registry.submit(correlation, draft());
    expect(registry.submit(correlation, draft())).toMatchObject({
      ok: true,
      status: "duplicate"
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed Session without sending", () => {
    const sendMessage = vi.fn();
    const registry = createClientMessageDeliveryRegistry({
      pageEpoch: "page-1",
      getSessionId: () => "session-2",
      getStatus: () => "CONNECTED:HTTP-STREAMING"
    });
    registry.register("client-1", { sendMessage });

    expect(registry.submit(correlation, draft())).toMatchObject({
      ok: false,
      status: "stale-target"
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("claims the request before a throwing page API so retries cannot duplicate effects", () => {
    const sendMessage = vi.fn(() => {
      throw new Error("page failure");
    });
    const registry = createClientMessageDeliveryRegistry({
      pageEpoch: "page-1",
      getSessionId: () => "session-1",
      getStatus: () => "CONNECTED:WS-STREAMING"
    });
    registry.register("client-1", { sendMessage });

    expect(registry.submit(correlation, draft())).toMatchObject({
      ok: false,
      status: "send-threw"
    });
    expect(registry.submit(correlation, draft())).toMatchObject({
      ok: true,
      status: "duplicate"
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
