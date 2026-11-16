import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_NAMESPACE, CAPTURE_VERSION, CONTENT_CAPTURE_SYNC_REQUEST, CONTENT_PANEL_ATTACHMENT,
  CONTENT_REINJECT_REQUEST, PAGE_REINJECT_REQUEST, RUNTIME_PANEL_ATTACHMENT_QUERY, RUNTIME_REINJECT_RESULT,
  RUNTIME_CAPTURE_MESSAGE, RUNTIME_TOPOLOGY_SYNC_FRAME, TOPOLOGY_SYNC_BEGIN, TOPOLOGY_SYNC_VERSION
} from "../src/bridge/messages";

const panelSessionId = "panel-00000000-0000-4000-8000-000000000010";
const captured = {
  namespace: CAPTURE_NAMESPACE, version: CAPTURE_VERSION, kind: "item-update",
  timestamp: 1, payload: { fields: { value: "original" } }
};
const frame = {
  type: TOPOLOGY_SYNC_BEGIN, version: TOPOLOGY_SYNC_VERSION, panelSessionId,
  syncId: "sync-1", pageEpoch: "page-1", cutoffCaptureSequence: 1,
  chunkCount: 0, recordCount: 0, coverage: { status: "complete", getters: {} }
};
const request = {
  type: CONTENT_REINJECT_REQUEST, panelSessionId, requestId: "request-1",
  draft: {
    sourceEventId: "event-1", executionTarget: "captured-wire",
    target: { subscriptionId: "subscription-1", listenerId: null },
    item: { name: "orders", position: 1 }, command: null, key: null,
    fields: { value: "edited" }, changedFields: { value: "edited" },
    isSnapshot: false, provenance: { source: "clone", sourceEventKind: "item-update", sourceSynthetic: false }
  }
};
const invalidated = () => new Error("Extension context invalidated.");
let added: ReturnType<typeof vi.spyOn>;
const errors: string[] = [];
function captureError(event: ErrorEvent) { errors.push(event.message); event.preventDefault(); }
function post(data: unknown) { window.dispatchEvent(new MessageEvent("message", { source: window, data })); }
const isQuery = (message: unknown) => (message as { type?: unknown }).type === RUNTIME_PANEL_ATTACHMENT_QUERY;
// Answers the load-time attachment query normally and invalidates on any other send.
const invalidatedAfterQuery = () => vi.fn((message: unknown) => { if (!isQuery(message)) throw invalidated(); });
const nonQueryCalls = (sendMessage: ReturnType<typeof vi.fn>) => sendMessage.mock.calls.filter(([message]) => !isQuery(message));
function installRuntime(sendMessage: ReturnType<typeof vi.fn>) {
  const onMessage = { addListener: vi.fn(), removeListener: vi.fn() };
  const runtime = { id: "test-extension", lastError: undefined as { message: string } | undefined, sendMessage, onMessage };
  vi.stubGlobal("chrome", { runtime });
  return runtime;
}

beforeEach(() => {
  vi.resetModules();
  errors.length = 0;
  window.addEventListener("error", captureError);
  added = vi.spyOn(window, "addEventListener");
});
afterEach(() => {
  for (const [type, listener] of added.mock.calls) window.removeEventListener(type as string, listener as EventListener);
  window.removeEventListener("error", captureError);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("content bridge context lifetime", () => {
  it.each([captured, frame])("retires a synchronously invalidated bridge after one send", async data => {
    const sendMessage = invalidatedAfterQuery();
    const runtime = installRuntime(sendMessage);
    await import("../src/content/content-script");
    for (let i = 0; i < 3; i++) post(data);
    expect(errors).toEqual([]);
    expect(nonQueryCalls(sendMessage)).toHaveLength(1);
    expect(runtime.onMessage.removeListener).toHaveBeenCalledWith(runtime.onMessage.addListener.mock.calls[0]![0]);
  });

  it("forwards healthy capture and topology unchanged and consumes callback errors without retiring on a missing receiver", async () => {
    let reads = 0;
    const sendMessage = vi.fn((_message, callback?: () => void) => callback?.());
    const runtime = installRuntime(sendMessage);
    Object.defineProperty(runtime, "lastError", { get() { reads++; return reads <= 2 ? { message: "Could not establish connection. Receiving end does not exist." } : undefined; } });
    await import("../src/content/content-script");
    post(captured); post(frame);
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: RUNTIME_PANEL_ATTACHMENT_QUERY }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: RUNTIME_CAPTURE_MESSAGE, message: captured }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: RUNTIME_TOPOLOGY_SYNC_FRAME, panelSessionId, frame }, expect.any(Function));
    expect(reads).toBe(3);
    expect(captured.payload.fields.value).toBe("original");
    expect(runtime.onMessage.removeListener).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("retires on asynchronous invalidation reported through runtime.lastError", async () => {
    const callbacks: Array<() => void> = [];
    const runtime = installRuntime(vi.fn((_message, callback?: () => void) => { if (callback) callbacks.push(callback); }));
    await import("../src/content/content-script");
    post(captured);
    runtime.lastError = { message: "Extension context invalidated." };
    expect(callbacks).toHaveLength(2);
    callbacks[1]!();
    post(captured);
    expect(nonQueryCalls(runtime.sendMessage)).toHaveLength(1);
    expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
  });

  it("handles invalidation during listener registration without claiming readiness", async () => {
    const runtime = installRuntime(vi.fn());
    runtime.onMessage.addListener.mockImplementation(() => { throw invalidated(); });
    await expect(import("../src/content/content-script")).resolves.toBeDefined();
    post(captured);
    expect(nonQueryCalls(runtime.sendMessage)).toHaveLength(0);
  });

  it("cleans pending page-response ports and timers when Capture discovers invalidation", async () => {
    vi.useFakeTimers();
    const responsePort = { addEventListener: vi.fn(), removeEventListener: vi.fn(), start: vi.fn(), close: vi.fn() };
    vi.stubGlobal("MessageChannel", vi.fn(function () { return { port1: responsePort, port2: {} }; }));
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const runtime = installRuntime(invalidatedAfterQuery());
    await import("../src/content/content-script");
    const receive = runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown) => boolean;
    receive(request);
    expect(vi.getTimerCount()).toBe(1);
    post(captured);
    expect(vi.getTimerCount()).toBe(0);
    expect(responsePort.close).toHaveBeenCalledTimes(1);
    receive(request);
    receive({ type: CONTENT_CAPTURE_SYNC_REQUEST, panelSessionId });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(nonQueryCalls(runtime.sendMessage)).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === PAGE_REINJECT_REQUEST)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("handles context loss after page delivery without retrying the Injection", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MessageChannel", undefined);
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const runtime = installRuntime(invalidatedAfterQuery());
    await import("../src/content/content-script");
    const receive = runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown) => boolean;
    receive(request);
    post({ type: RUNTIME_REINJECT_RESULT, panelSessionId, result: { requestId: request.requestId, panelSessionId, ok: true, status: "success", timestamp: 2 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(nonQueryCalls(runtime.sendMessage)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("does not hide unrelated synchronous send failures", async () => {
    const runtime = installRuntime(vi.fn(() => { throw new Error("Message exceeded its size limit."); }));
    await import("../src/content/content-script");
    post(captured);
    expect(errors).toEqual(["Message exceeded its size limit."]);
    expect(runtime.onMessage.removeListener).not.toHaveBeenCalled();
  });

  it("never writes a readiness marker into the inspected page document", async () => {
    const before = document.documentElement.getAttributeNames();
    installRuntime(vi.fn());
    await import("../src/content/content-script");
    expect(document.documentElement.getAttributeNames()).toEqual(before);
  });
});

describe("content bridge panel attachment gating", () => {
  function setup(response?: unknown) {
    const sendMessage = vi.fn((message: unknown, callback?: (response?: unknown) => void) => {
      if (isQuery(message)) callback?.(response);
      else callback?.();
    });
    const runtime = installRuntime(sendMessage);
    return { sendMessage, runtime };
  }
  const forwardedCaptures = (sendMessage: ReturnType<typeof vi.fn>) =>
    sendMessage.mock.calls.filter(([message]) => (message as { type?: unknown }).type === RUNTIME_CAPTURE_MESSAGE);

  it("forwards live Capture until the service worker answers the attachment query", async () => {
    const { sendMessage } = setup(undefined);
    await import("../src/content/content-script");
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(1);
  });

  it("drops unscoped live Capture while no panel is attached and resumes on attachment", async () => {
    const { sendMessage, runtime } = setup({ type: CONTENT_PANEL_ATTACHMENT, attached: false, revision: 10 });
    await import("../src/content/content-script");
    const receive = runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown) => boolean;
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(0);

    receive({ type: CONTENT_PANEL_ATTACHMENT, attached: true, revision: 11 });
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(1);

    // A stale notification cannot undo a newer attachment.
    receive({ type: CONTENT_PANEL_ATTACHMENT, attached: false, revision: 9 });
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(2);

    receive({ type: CONTENT_PANEL_ATTACHMENT, attached: false, revision: 12 });
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(2);
  });

  it("keeps forwarding sync replies and treats a sync request as attachment", async () => {
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const { sendMessage, runtime } = setup({ type: CONTENT_PANEL_ATTACHMENT, attached: false, revision: 10 });
    await import("../src/content/content-script");
    const receive = runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown) => boolean;

    post(frame);
    post({ ...captured, panelSessionId });
    expect(sendMessage.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual([
      RUNTIME_PANEL_ATTACHMENT_QUERY,
      RUNTIME_TOPOLOGY_SYNC_FRAME,
      RUNTIME_CAPTURE_MESSAGE
    ]);

    receive({ type: CONTENT_CAPTURE_SYNC_REQUEST, panelSessionId });
    post(captured);
    expect(forwardedCaptures(sendMessage)).toHaveLength(2);
  });

  it("re-queries attachment when the page is restored from the back/forward cache", async () => {
    const { sendMessage } = setup({ type: CONTENT_PANEL_ATTACHMENT, attached: false, revision: 10 });
    await import("../src/content/content-script");
    sendMessage.mockImplementation((message: unknown, callback?: (response?: unknown) => void) => {
      if (isQuery(message)) callback?.({ type: CONTENT_PANEL_ATTACHMENT, attached: true, revision: 20 });
      else callback?.();
    });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    post(captured);
    expect(sendMessage.mock.calls.filter(([message]) => isQuery(message))).toHaveLength(2);
    expect(forwardedCaptures(sendMessage)).toHaveLength(1);
  });
});
