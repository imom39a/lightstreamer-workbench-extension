import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { RUNTIME_REINJECT_RESULT } from "../src/bridge/messages";
import { pageReinjectionExpression } from "../src/extension/panel/bridge-client";

describe("inspected-page reinjection result correlation", () => {
  it("rejects wrong outer and wrong nested Panel Session identities", () => {
    const sandbox = createPageSandbox();
    const expression = pageReinjectionExpression("request-1", "panel-00000000-0000-4000-8000-0000000000a1", {
      sourceEventId: "event-1",
      executionTarget: "captured-wire",
      target: { subscriptionId: "subscription-1", listenerId: null },
      item: { name: "item-1", position: 1 },
      command: "UPDATE",
      key: "key-1",
      fields: { value: 1 },
      changedFields: { value: 1 },
      isSnapshot: false,
      provenance: { source: "test" }
    });

    expect(vm.runInNewContext(expression, sandbox)).toMatchObject({ bridgeState: "pending" });
    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2",
      result: { requestId: "request-1", panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toMatchObject({ bridgeState: "pending" });

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1",
      result: { requestId: "request-1", panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toMatchObject({ bridgeState: "pending" });

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1",
      result: { requestId: "request-1", panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toEqual({
      bridgeState: "result",
      result: { requestId: "request-1", panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1", ok: true, status: "success", timestamp: 1 }
    });
  });

  it("keeps the same request independent for two Panel Sessions", () => {
    const sandbox = createPageSandbox();
    const requestId = "request-shared";
    const panelAExpression = pageReinjectionExpression(requestId, "panel-00000000-0000-4000-8000-0000000000a1", createDraft());
    const panelBExpression = pageReinjectionExpression(requestId, "panel-00000000-0000-4000-8000-0000000000b2", createDraft());

    expect(vm.runInNewContext(panelAExpression, sandbox)).toEqual({ bridgeState: "pending" });
    expect(vm.runInNewContext(panelBExpression, sandbox)).toEqual({ bridgeState: "pending" });
    expect(sandbox.postedMessages).toHaveLength(2);
    expect(sandbox.postedMessages).toEqual([
      expect.objectContaining({ requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1" }),
      expect.objectContaining({ requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2" })
    ]);

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1",
      result: { requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(panelAExpression, sandbox)).toEqual({
      bridgeState: "result",
      result: { requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(panelBExpression, sandbox)).toEqual({ bridgeState: "pending" });

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2",
      result: { requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2", ok: true, status: "success", timestamp: 2 }
    });
    expect(vm.runInNewContext(panelBExpression, sandbox)).toEqual({
      bridgeState: "result",
      result: { requestId, panelSessionId: "panel-00000000-0000-4000-8000-0000000000b2", ok: true, status: "success", timestamp: 2 }
    });
  });
});

function createPageSandbox() {
  const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
  let host: unknown;
  const postedMessages: unknown[] = [];
  const sandbox = {
    addEventListener(this: unknown, _type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      host = this;
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      listeners.delete(listener);
    },
    postedMessages,
    postMessage(message: unknown) {
      postedMessages.push(message);
    },
    emit(data: unknown) {
      for (const listener of [...listeners]) listener({ source: host, data });
    }
  };
  return sandbox;
}

function createDraft() {
  return {
    sourceEventId: "event-1",
    executionTarget: "captured-wire" as const,
    target: { subscriptionId: "subscription-1", listenerId: null },
    item: { name: "item-1", position: 1 },
    command: "UPDATE" as const,
    key: "key-1",
    fields: { value: 1 },
    changedFields: { value: 1 },
    isSnapshot: false,
    provenance: { source: "test" }
  };
}
