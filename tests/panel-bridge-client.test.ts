import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL,
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
  PAGE_SERVER_INJECTION_BRIDGE_GLOBAL,
  PAGE_SERVER_INJECTION_BRIDGE_VERSION,
  PANEL_CAPTURE_MESSAGE,
  PANEL_REGISTER_MESSAGE,
  PANEL_STATUS_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  createCaptureMessage
} from "../src/bridge/messages";
import { type ReinjectionDraft } from "../src/core/reinjection-draft";
import { connectPanelBridge as connectPanelBridgeImpl } from "../src/extension/panel/bridge-client";

const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000017";

function connectPanelBridge(handlers: Parameters<typeof connectPanelBridgeImpl>[0]) {
  return connectPanelBridgeImpl(handlers, PANEL_SESSION_ID);
}

type FakePort = {
  postedMessages: unknown[];
  messageListeners: Array<(message: unknown) => void>;
  disconnectListeners: Array<() => void>;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
  postMessage(message: unknown): void;
  disconnect(): void;
};

function createFakePort(): FakePort {
  const port: FakePort = {
    postedMessages: [],
    messageListeners: [],
    disconnectListeners: [],
    onMessage: {
      addListener(listener) {
        port.messageListeners.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener) {
        port.disconnectListeners.push(listener);
      }
    },
    postMessage(message) {
      port.postedMessages.push(message);
    },
    disconnect() {
      for (const listener of port.disconnectListeners) {
        listener();
      }
    }
  };
  return port;
}

describe("panel bridge client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as Record<string, unknown>)[PAGE_REINJECTION_BRIDGE_GLOBAL];
    delete (globalThis as Record<string, unknown>)[PAGE_SERVER_INJECTION_BRIDGE_GLOBAL];
    delete (globalThis as Record<string, unknown>)[PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL];
  });

  it("does not report bridge readiness until the background registration is acknowledged", () => {
    const port = createFakePort();
    const statuses: string[] = [];
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: { connect: vi.fn(() => port) }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange(status) {
        statuses.push(status);
      },
      onCaptureMessage: vi.fn()
    });

    expect(statuses).toEqual([]);
    port.messageListeners[0]({
      type: PANEL_STATUS_MESSAGE,
      panelSessionId: PANEL_SESSION_ID,
      status: "bridge connected"
    });
    expect(statuses).toEqual(["bridge connected"]);
    bridge.disconnect();
  });

  it("reconnects and re-registers the inspected tab after a port disconnect", () => {
    vi.useFakeTimers();
    const ports: FakePort[] = [];
    const connect = vi.fn(() => {
      const port = createFakePort();
      ports.push(port);
      return port;
    });
    const statuses: string[] = [];

    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange(status) {
        statuses.push(status);
      },
      onCaptureMessage: vi.fn()
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(ports[0].postedMessages).toEqual([
      { type: PANEL_REGISTER_MESSAGE, tabId: 42, panelSessionId: PANEL_SESSION_ID }
    ]);

    ports[0].disconnect();

    expect(statuses).toContain("bridge disconnected");
    vi.advanceTimersByTime(500);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(ports[1].postedMessages).toEqual([
      { type: PANEL_REGISTER_MESSAGE, tabId: 42, panelSessionId: PANEL_SESSION_ID }
    ]);

    bridge.disconnect();
    ports[1].disconnect();
    vi.advanceTimersByTime(500);

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("posts reinjection requests and resolves the matching result", async () => {
    const port = createFakePort();
    const connect = vi.fn(() => port);

    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });

    const resultPromise = bridge.reinjectDraft(createValidDraft());
    const request = port.postedMessages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
    ) as { requestId: string };

    expect(request.requestId).toMatch(/^reinject-/);

    port.messageListeners[0]({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: PANEL_SESSION_ID,
      result: {
        requestId: request.requestId,
        panelSessionId: PANEL_SESSION_ID,
        ok: true,
        status: "success",
        timestamp: 123
      }
    });

    await expect(resultPromise).resolves.toEqual({
      requestId: request.requestId,
      panelSessionId: PANEL_SESSION_ID,
      ok: true,
      status: "success",
      timestamp: 123
    });
  });

  it("executes reinjection directly in the inspected page without a runtime-message relay", async () => {
    vi.useFakeTimers();
    const port = createFakePort();
    let deliveredDraft: unknown = null;
    (globalThis as Record<string, unknown>)[PAGE_REINJECTION_BRIDGE_GLOBAL] = {
      version: PAGE_REINJECTION_BRIDGE_VERSION,
      reinject(requestId: string, _panelSessionId: string, draft: unknown) {
        deliveredDraft = draft;
        return {
          requestId,
          panelSessionId: PANEL_SESSION_ID,
          ok: true,
          status: "success",
          timestamp: 1_784_737_272_925
        };
      }
    };
    const evaluate = vi.fn(
      (
        expression: string,
        callback?: (
          result: unknown,
          exceptionInfo: chrome.devtools.inspectedWindow.EvaluationExceptionInfo
        ) => void
      ) => {
        callback?.(
          globalThis.eval(expression),
          {
            isError: false,
            code: "",
            description: "",
            details: [],
            isException: false,
            value: ""
          }
        );
      }
    );

    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42,
          eval: evaluate
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const wireDraft: ReinjectionDraft = {
      ...createJsonMutationDraft(),
      captureSource: "wire",
      target: {
        subscriptionId: "subscription-3",
        listenerId: null
      },
      item: {
        name: "snappHome.SNAPP",
        position: 1
      }
    };
    const resultPromise = bridge.reinjectDraft(wireDraft, "captured-wire");

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(
      port.postedMessages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
      )
    ).toBe(false);
    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      status: "success"
    });
    expect(deliveredDraft).toMatchObject({
      executionTarget: "captured-wire",
      target: {
        subscriptionId: "subscription-3",
        listenerId: null
      },
      item: {
        name: "snappHome.SNAPP",
        position: 1
      }
    });
    const deliveredFields = (deliveredDraft as { fields: Record<string, unknown> }).fields;
    expect(typeof deliveredFields.modelValues).toBe("string");
    expect(JSON.parse(String(deliveredFields.modelValues))).toMatchObject({
      passenger: { selected: true }
    });
  });

  it("falls back to the runtime relay when the inspected page bridge is version-skewed", async () => {
    const port = createFakePort();
    const staleReinject = vi.fn();
    (globalThis as Record<string, unknown>)[PAGE_REINJECTION_BRIDGE_GLOBAL] = {
      version: PAGE_REINJECTION_BRIDGE_VERSION - 1,
      reinject: staleReinject
    };
    const evaluate = vi.fn(
      (
        expression: string,
        callback?: (
          result: unknown,
          exceptionInfo: chrome.devtools.inspectedWindow.EvaluationExceptionInfo
        ) => void
      ) => {
        callback?.(
          globalThis.eval(expression),
          {
            isError: false,
            code: "",
            description: "",
            details: [],
            isException: false,
            value: ""
          }
        );
      }
    );
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42,
          eval: evaluate
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });

    const resultPromise = bridge.reinjectDraft(createValidDraft());
    await Promise.resolve();
    const request = port.postedMessages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
    ) as { requestId: string } | undefined;

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(staleReinject).not.toHaveBeenCalled();
    expect(request?.requestId).toMatch(/^reinject-/);

    port.messageListeners[0]({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: PANEL_SESSION_ID,
      result: {
        requestId: request?.requestId,
        panelSessionId: PANEL_SESSION_ID,
        ok: true,
        status: "success",
        timestamp: 456
      }
    });

    await expect(resultPromise).resolves.toMatchObject({
      requestId: request?.requestId,
      ok: true,
      status: "success"
    });
  });

  it("reports acknowledgement unknown and does not retry a direct reinjection whose result is lost", async () => {
    const port = createFakePort();
    const evaluate = vi.fn(
      (
        _expression: string,
        callback?: (
          result: unknown,
          exceptionInfo: chrome.devtools.inspectedWindow.EvaluationExceptionInfo
        ) => void
      ) => {
        callback?.(
          {
            requestId: "wrong-request",
            ok: true,
            status: "success",
            timestamp: 456
          },
          {
            isError: false,
            code: "",
            description: "",
            details: [],
            isException: false,
            value: ""
          }
        );
      }
    );
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42,
          eval: evaluate
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });

    await expect(bridge.reinjectDraft(createValidDraft())).resolves.toMatchObject({
      ok: false,
      status: "acknowledgement-unknown",
      error: expect.stringContaining("invalid result")
    });
    expect(
      port.postedMessages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
      )
    ).toBe(false);
  });

  it("does not duplicate a direct reinjection when its DevTools acknowledgement times out", async () => {
    vi.useFakeTimers();
    const port = createFakePort();
    const evaluate = vi.fn();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42,
          eval: evaluate
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const resultPromise = bridge.reinjectDraft(createValidDraft());

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      status: "acknowledgement-unknown",
      error: expect.stringContaining("did not complete")
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(
      port.postedMessages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
      )
    ).toHaveLength(0);
  });

  it("marks a posted runtime request acknowledgement unknown when the port disconnects", async () => {
    vi.useFakeTimers();
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const resultPromise = bridge.reinjectDraft(createValidDraft());

    expect(
      port.postedMessages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
      )
    ).toHaveLength(1);
    port.disconnect();

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      status: "acknowledgement-unknown",
      error: expect.stringContaining("disconnected")
    });
    bridge.disconnect();
  });

  it("resolves bounded Message Recipes from the inspected application's synchronous adapter", async () => {
    const port = createFakePort();
    let receivedContext: unknown;
    (globalThis as Record<string, unknown>)[PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL] = {
      version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
      list(context: unknown) {
        receivedContext = context;
        return [{
          id: "fixture.update-fields.v1",
          label: "Update fields for beta",
          description: "Uses the selected key and version.",
          message: '{"type":"update-fields","fields":{"qty":"20"}}',
          sequence: "LSEW_FIXTURE_FIELD_UPDATES",
          delayTimeout: null,
          enqueueWhileDisconnected: false
        }];
      }
    };
    const evaluate = vi.fn((
      expression: string,
      callback: (value: unknown, info: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => void
    ) => callback(globalThis.eval(expression), {
      isError: false,
      code: "",
      description: "",
      details: [],
      isException: false,
      value: ""
    }));
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42, eval: evaluate } },
      runtime: { connect: vi.fn(() => port) }
    } as unknown as typeof chrome;
    const bridge = connectPanelBridge({ onStatusChange: vi.fn(), onCaptureMessage: vi.fn() });
    const context = {
      source: { eventId: "event-6", kind: "item-update", direction: "inbound", provenance: "server" },
      target: { pageEpoch: "page-1", clientId: "client-1", sessionId: "session-1" },
      client: { adapterSet: "LSEW_FIXTURE" },
      subscription: { id: "subscription-1", mode: "COMMAND", dataAdapter: null },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: {
        command: "ADD",
        key: "beta",
        isSnapshot: true,
        fields: { qty: "20", version: "1" },
        changedFields: { qty: "20", version: "1" }
      }
    } as const;

    await expect(bridge.resolveClientMessageRecipes!(context)).resolves.toMatchObject({
      status: "available",
      items: [{ id: "fixture.update-fields.v1", sequence: "LSEW_FIXTURE_FIELD_UPDATES" }]
    });
    expect(receivedContext).toEqual(context);
    expect(evaluate).toHaveBeenCalledTimes(1);
    bridge.disconnect();
  });

  it("sends Server Injection through the page bridge and resolves from outbound Evidence", async () => {
    const port = createFakePort();
    let requestId = "";
    let deliveredDraft: unknown;
    (globalThis as Record<string, unknown>)[PAGE_SERVER_INJECTION_BRIDGE_GLOBAL] = {
      version: PAGE_SERVER_INJECTION_BRIDGE_VERSION,
      send(candidateRequestId: string, panelSessionId: string, draft: unknown) {
        requestId = candidateRequestId;
        deliveredDraft = draft;
        return {
          requestId,
          panelSessionId,
          ok: true,
          status: "started",
          timestamp: 100
        };
      }
    };
    const evaluate = vi.fn((expression: string, callback: (value: unknown, info: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => void) => {
      callback(globalThis.eval(expression), {
        isError: false,
        code: "",
        description: "",
        details: [],
        isException: false,
        value: ""
      });
    });
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42, eval: evaluate } },
      runtime: { connect: vi.fn(() => port) }
    } as unknown as typeof chrome;
    const onCaptureMessage = vi.fn();
    const bridge = connectPanelBridge({ onStatusChange: vi.fn(), onCaptureMessage });
    const draft = {
      sourceEventId: "event-1",
      target: { pageEpoch: "page-1", clientId: "client-1", sessionId: "session-1" },
      message: "hello",
      sequence: "orders",
      delayTimeout: null,
      enqueueWhileDisconnected: false
    };

    const resultPromise = bridge.sendServerInjection!(draft);
    expect(requestId).toMatch(/^server-injection-/);
    expect(deliveredDraft).toEqual(draft);
    port.messageListeners[0]({
      type: PANEL_CAPTURE_MESSAGE,
      panelSessionId: PANEL_SESSION_ID,
      message: createCaptureMessage("client-message-processed", {
        clientMessage: {
          id: "client-message-1",
          pageEpoch: "page-1",
          message: "hello",
          messageState: "available",
          sequence: "orders",
          delayTimeout: null,
          enqueueWhileDisconnected: false,
          listenerProvided: true,
          origin: "workbench",
          outcome: "processed",
          outcomeAvailability: "available",
          response: "accepted",
          injection: {
            panelSessionId: PANEL_SESSION_ID,
            requestId,
            sourceEventId: "event-1"
          }
        }
      }, 200)
    });

    await expect(resultPromise).resolves.toEqual({
      requestId,
      ok: true,
      status: "processed",
      timestamp: 200,
      response: "accepted"
    });
    expect(onCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps a synchronous runtime-post failure distinct as a pre-execution bridge error", async () => {
    const port = createFakePort();
    const originalPostMessage = port.postMessage.bind(port);
    port.postMessage = (message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
      ) {
        throw new Error("runtime port is closed");
      }
      originalPostMessage(message);
    };
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });

    await expect(bridge.reinjectDraft(createValidDraft())).resolves.toMatchObject({
      ok: false,
      status: "bridge-error",
      error: "runtime port is closed"
    });
    bridge.disconnect();
  });

  it("preserves an edited JSON-string field and its changed-field semantics across the panel bridge", async () => {
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const resultPromise = bridge.reinjectDraft(createJsonMutationDraft());
    const request = port.postedMessages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
    ) as {
      requestId: string;
      draft: {
        fields: Record<string, unknown>;
        changedFields: Record<string, unknown>;
      };
    };

    expect(typeof request.draft.fields.modelValues).toBe("string");
    expect(JSON.parse(String(request.draft.fields.modelValues))).toMatchObject({
      passenger: { selected: true, priority: false }
    });
    expect(Object.keys(request.draft.changedFields)).toEqual(["modelValues"]);
    expect(JSON.parse(String(request.draft.changedFields.modelValues))).toMatchObject({
      passenger: { selected: true }
    });

    port.messageListeners[0]({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: PANEL_SESSION_ID,
      result: {
        requestId: request.requestId,
        panelSessionId: PANEL_SESSION_ID,
        ok: true,
        status: "success",
        timestamp: 234
      }
    });
    await expect(resultPromise).resolves.toMatchObject({
      requestId: request.requestId,
      status: "success"
    });
  });

  it("serializes a listenerless wire draft for captured WebSocket delivery", async () => {
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const wireDraft: ReinjectionDraft = {
      ...createValidDraft(),
      captureSource: "wire",
      target: {
        subscriptionId: "subscription-3",
        listenerId: null
      }
    };
    const resultPromise = bridge.reinjectDraft(wireDraft, "captured-wire");
    const request = port.postedMessages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
    ) as {
      requestId: string;
      draft: {
        executionTarget: string;
        target: { subscriptionId: string; listenerId: string | null };
      };
    };

    expect(request.draft).toMatchObject({
      executionTarget: "captured-wire",
      target: {
        subscriptionId: "subscription-3",
        listenerId: null
      }
    });

    port.messageListeners[0]({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: PANEL_SESSION_ID,
      result: {
        requestId: request.requestId,
        panelSessionId: PANEL_SESSION_ID,
        ok: true,
        status: "success",
        timestamp: 345
      }
    });
    await expect(resultPromise).resolves.toMatchObject({
      requestId: request.requestId,
      status: "success"
    });
  });

  it("serializes a non-COMMAND listener draft with null command and key", async () => {
    const port = createFakePort();

    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: {
          tabId: 42
        }
      },
      runtime: {
        connect: vi.fn(() => port)
      }
    } as unknown as typeof chrome;

    const bridge = connectPanelBridge({
      onStatusChange: vi.fn(),
      onCaptureMessage: vi.fn()
    });
    const resultPromise = bridge.reinjectDraft(createValidMergeDraft());
    const request = port.postedMessages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PANEL_REINJECT_REQUEST
    ) as {
      requestId: string;
      draft: { command: string | null; key: string | null; fields: Record<string, unknown> };
    };

    expect(request.draft).toMatchObject({
      command: null,
      key: null,
      fields: { price: 101, status: "open" }
    });

    port.messageListeners[0]({
      type: PANEL_REINJECT_RESULT,
      panelSessionId: PANEL_SESSION_ID,
      result: {
        requestId: request.requestId,
        panelSessionId: PANEL_SESSION_ID,
        ok: true,
        status: "success",
        timestamp: 456
      }
    });

    await expect(resultPromise).resolves.toMatchObject({
      requestId: request.requestId,
      ok: true,
      status: "success"
    });
  });
});

function createValidDraft(): ReinjectionDraft {
  return {
    sourceEventId: "event-1",
    target: {
      subscriptionId: "subscription-1",
      listenerId: "listener-1"
    },
    item: {
      name: "portfolio",
      position: 1
    },
    command: "UPDATE",
    key: "item-1",
    sourceCommand: "UPDATE",
    sourceKey: "item-1",
    fields: {
      command: "UPDATE",
      key: "item-1",
      price: 101
    },
    sourceFields: {
      command: "UPDATE",
      key: "item-1",
      price: 100
    },
    fieldValueStates: { command: "concrete", key: "concrete", price: "concrete" },
    sourceFieldValueStates: { command: "concrete", key: "concrete", price: "concrete" },
    changedFields: {
      price: 101
    },
    originalChangedFields: {
      price: 100
    },
    isSnapshot: false,
    sourceIsSnapshot: false,
    manualChangedFieldsOverride: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}

function createJsonMutationDraft(): ReinjectionDraft {
  const sourceModelValues = JSON.stringify({
    passenger: { selected: false, priority: false }
  });
  const modelValues = JSON.stringify({
    passenger: { selected: true, priority: false }
  });
  return {
    sourceEventId: "event-json",
    subscriptionMode: "COMMAND",
    captureSource: "listener",
    target: {
      subscriptionId: "subscription-1",
      listenerId: "listener-1"
    },
    item: {
      name: "customerDetail",
      position: 1
    },
    command: "UPDATE",
    key: "customer-1",
    sourceCommand: "UPDATE",
    sourceKey: "customer-1",
    fields: {
      command: "UPDATE",
      key: "customer-1",
      modelId: "CUSTOMER_INIT_INFO",
      modelValues
    },
    sourceFields: {
      command: "UPDATE",
      key: "customer-1",
      modelId: "CUSTOMER_INIT_INFO",
      modelValues: sourceModelValues
    },
    fieldValueStates: {
      command: "concrete",
      key: "concrete",
      modelId: "concrete",
      modelValues: "concrete"
    },
    sourceFieldValueStates: {
      command: "concrete",
      key: "concrete",
      modelId: "concrete",
      modelValues: "concrete"
    },
    changedFields: {
      modelValues
    },
    originalChangedFields: {
      command: "UPDATE",
      key: "customer-1",
      modelId: "CUSTOMER_INIT_INFO",
      modelValues: sourceModelValues
    },
    isSnapshot: false,
    sourceIsSnapshot: false,
    manualChangedFieldsOverride: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}

function createValidMergeDraft(): ReinjectionDraft {
  return {
    sourceEventId: "event-merge",
    subscriptionMode: "MERGE",
    captureSource: "listener",
    target: {
      subscriptionId: "subscription-1",
      listenerId: "listener-1"
    },
    item: {
      name: "portfolio",
      position: 1
    },
    command: null,
    key: null,
    sourceCommand: null,
    sourceKey: null,
    fields: {
      price: 101,
      status: "open"
    },
    sourceFields: {
      price: 100,
      status: "open"
    },
    fieldValueStates: { price: "concrete", status: "concrete" },
    sourceFieldValueStates: { price: "concrete", status: "concrete" },
    changedFields: {
      price: 101
    },
    originalChangedFields: {
      price: 100
    },
    isSnapshot: false,
    sourceIsSnapshot: false,
    manualChangedFieldsOverride: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}
