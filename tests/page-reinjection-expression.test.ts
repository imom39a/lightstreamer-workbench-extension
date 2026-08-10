import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { RUNTIME_REINJECT_RESULT } from "../src/bridge/messages";
import { pageReinjectionExpression } from "../src/extension/panel/bridge-client";

describe("inspected-page reinjection result correlation", () => {
  it("rejects wrong outer and wrong nested Panel Session identities", () => {
    const sandbox = createPageSandbox();
    const expression = pageReinjectionExpression("request-1", "panel-a", {
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
      panelSessionId: "panel-b",
      result: { requestId: "request-1", panelSessionId: "panel-a", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toMatchObject({ bridgeState: "pending" });

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-a",
      result: { requestId: "request-1", panelSessionId: "panel-b", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toMatchObject({ bridgeState: "pending" });

    sandbox.emit({
      type: RUNTIME_REINJECT_RESULT,
      panelSessionId: "panel-a",
      result: { requestId: "request-1", panelSessionId: "panel-a", ok: true, status: "success", timestamp: 1 }
    });
    expect(vm.runInNewContext(expression, sandbox)).toEqual({
      bridgeState: "result",
      result: { requestId: "request-1", panelSessionId: "panel-a", ok: true, status: "success", timestamp: 1 }
    });
  });
});

function createPageSandbox() {
  const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
  let host: unknown;
  const sandbox = {
    addEventListener(this: unknown, _type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      host = this;
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      listeners.delete(listener);
    },
    postMessage() {},
    emit(data: unknown) {
      for (const listener of [...listeners]) listener({ source: host, data });
    }
  };
  return sandbox;
}
