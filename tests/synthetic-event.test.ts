import { describe, expect, it } from "vitest";

import { createSyntheticEventFromDraft } from "../src/core/synthetic-event";
import { type ReinjectionDraft } from "../src/core/reinjection-draft";

describe("synthetic reinjection event", () => {
  it("creates a synthetic item-update envelope with provenance", () => {
    const event = createSyntheticEventFromDraft(createDraft(), {
      requestId: "request-1",
      ok: true,
      status: "success",
      timestamp: 123
    });

    expect(event.source).toBe("synthetic");
    expect(event.synthetic).toBe(true);
    expect(event.kind).toBe("item-update");
    expect(event.raw).toMatchObject({
      sourceEventId: "event-1",
      targetSubscriptionId: "subscription-1",
      targetListenerId: "listener-1",
      requestId: "request-1",
      status: "success",
      executionTarget: "captured-listener",
      deliveredToPage: true,
      serverContacted: false
    });
  });

  it("creates a listener-free Workbench simulation with derived edits and source semantics", () => {
    const draft = createDraft();
    draft.target.listenerId = null;
    draft.subscriptionMode = "MERGE";
    draft.captureSource = "wire";
    draft.changedFields = { price: 999 };

    const event = createSyntheticEventFromDraft(
      draft,
      {
        requestId: "workbench-1",
        ok: true,
        status: "success",
        timestamp: 456
      },
      "workbench-only"
    );

    expect(event.subscription?.mode).toBe("MERGE");
    expect(event.captureSource).toBe("wire");
    expect(event.listener).toBeUndefined();
    expect(event.update?.changedFields).toEqual({ price: 101 });
    expect(event.raw).toMatchObject({
      executionTarget: "workbench-only",
      deliveredToPage: false,
      serverContacted: false,
      editedFields: { price: 101 }
    });
  });

  it("keeps manual changed-field semantics separate from actual edited-field provenance", () => {
    const draft = createDraft();
    draft.manualChangedFieldsOverride = true;
    draft.changedFields = { command: "UPDATE" };

    const event = createSyntheticEventFromDraft(draft, {
      requestId: "manual-1",
      ok: true,
      status: "success",
      timestamp: 789
    });

    expect(event.update?.changedFields).toEqual({ command: "UPDATE" });
    expect(event.raw?.editedFields).toEqual({ price: 101 });
  });

  it("marks captured-wire delivery and retains the source stream context", () => {
    const draft = createDraft();
    draft.captureSource = "wire";
    draft.target.listenerId = null;
    draft.sourceClient = {
      id: "client-1",
      serverAddress: "wss://example.test/lightstreamer",
      adapterSet: "PME_ADAPTER"
    };
    draft.sourceSubscription = {
      id: "subscription-1",
      mode: "COMMAND",
      items: ["snappHome.SNAPP"],
      fields: ["key", "command", "modelId", "modelValues"],
      dataAdapter: "PME_DATA_PROVIDER",
      requestedSnapshot: "true",
      keyPosition: 1,
      commandPosition: 2
    };

    const event = createSyntheticEventFromDraft(
      draft,
      {
        requestId: "wire-1",
        ok: true,
        status: "success",
        timestamp: 790
      },
      "captured-wire"
    );

    expect(event.client).toMatchObject({
      id: "client-1",
      adapterSet: "PME_ADAPTER"
    });
    expect(event.subscription).toMatchObject({
      id: "subscription-1",
      mode: "COMMAND",
      items: ["snappHome.SNAPP"],
      fields: ["key", "command", "modelId", "modelValues"],
      keyPosition: 1,
      commandPosition: 2
    });
    expect(event.raw).toMatchObject({
      executionTarget: "captured-wire",
      deliveryPath: "captured-websocket",
      deliveredToPage: true,
      serverContacted: false
    });
  });
});

function createDraft(): ReinjectionDraft {
  return {
    sourceEventId: "event-1",
    subscriptionMode: "COMMAND",
    captureSource: "listener",
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
