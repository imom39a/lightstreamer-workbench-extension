import vm from "node:vm";
import { describe, expect, it } from "vitest";

import {
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION
} from "../src/bridge/messages";
import { pageReinjectionExpression } from "../src/extension/panel/bridge-client";

describe("inspected-page reinjection expression", () => {
  it("reports an unavailable direct bridge without installing a page-global result slot", () => {
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

    expect(vm.runInNewContext(expression, sandbox)).toEqual({ bridgeState: "unavailable" });
    expect(sandbox.postedMessages).toEqual([]);
    expect(Object.getOwnPropertyNames(sandbox).some((name) => name.includes("LEGACY_REINJECTION"))).toBe(false);
  });

  it("executes the versioned direct bridge and returns its result", () => {
    const sandbox = createPageSandbox();
    const reinject = (requestId: string, _panelSessionId: string, _draft: unknown) => ({
      requestId,
      panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1",
      ok: true,
      status: "success",
      timestamp: 1
    });
    Object.defineProperty(sandbox, PAGE_REINJECTION_BRIDGE_GLOBAL, {
      value: { version: PAGE_REINJECTION_BRIDGE_VERSION, reinject },
      enumerable: false
    });

    expect(vm.runInNewContext(pageReinjectionExpression("request-2", "panel-00000000-0000-4000-8000-0000000000a1", createDraft()), sandbox)).toEqual({
      bridgeState: "result",
      result: {
        requestId: "request-2",
        panelSessionId: "panel-00000000-0000-4000-8000-0000000000a1",
        ok: true,
        status: "success",
        timestamp: 1
      }
    });
    expect(sandbox.postedMessages).toEqual([]);
  });
});

function createPageSandbox() {
  const postedMessages: unknown[] = [];
  const sandbox = {
    addEventListener() {},
    removeEventListener() {},
    postedMessages,
    postMessage(message: unknown) {
      postedMessages.push(message);
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
