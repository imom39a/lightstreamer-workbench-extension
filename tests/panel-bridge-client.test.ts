import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT
} from "../src/bridge/messages";
import { type ReinjectionDraft } from "../src/core/reinjection-draft";
import { connectPanelBridge } from "../src/extension/panel/bridge-client";

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
    expect(ports[0].postedMessages).toEqual([{ type: PANEL_REGISTER_MESSAGE, tabId: 42 }]);

    ports[0].disconnect();

    expect(statuses).toContain("bridge disconnected");
    vi.advanceTimersByTime(500);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(ports[1].postedMessages).toEqual([{ type: PANEL_REGISTER_MESSAGE, tabId: 42 }]);

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
      result: {
        requestId: request.requestId,
        ok: true,
        status: "success",
        timestamp: 123
      }
    });

    await expect(resultPromise).resolves.toEqual({
      requestId: request.requestId,
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
      reinject(requestId: string, draft: unknown) {
        deliveredDraft = draft;
        return {
          requestId,
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
      version: PAGE_REINJECTION_BRIDGE_VERSION + 1,
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
      result: {
        requestId: request?.requestId,
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

  it("does not retry a direct reinjection that returns an invalid result", async () => {
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
      status: "bridge-error",
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
      result: {
        requestId: request.requestId,
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
      result: {
        requestId: request.requestId,
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
      result: {
        requestId: request.requestId,
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
