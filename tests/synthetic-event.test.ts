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
      status: "success"
    });
  });
});

function createDraft(): ReinjectionDraft {
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
    manualChangedFieldsOverride: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}
