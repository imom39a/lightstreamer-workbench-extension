import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
