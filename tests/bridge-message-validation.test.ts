import { describe, expect, it } from "vitest";

import {
  CAPTURE_NAMESPACE,
  CAPTURE_VERSION,
  PANEL_REINJECT_REQUEST,
  createCaptureMessage,
  isCaptureMessage,
  isPanelReinjectRequestMessage
} from "../src/bridge/messages";
import { createStableIdAllocator } from "../src/core/ids";

describe("bridge capture message validation", () => {
  it("accepts valid client and subscription lifecycle messages", () => {
    expect(
      isCaptureMessage(
        createCaptureMessage("client-created", {
          client: { id: "client-1", status: "DISCONNECTED" }
        })
      )
    ).toBe(true);

    expect(
      isCaptureMessage(
        createCaptureMessage("subscription-started", {
          client: { id: "client-1" },
          subscription: { id: "subscription-1", mode: "COMMAND" }
        })
      )
    ).toBe(true);
  });

  it("rejects wrong namespace, unknown kind, missing payload, and non-object payload", () => {
    const valid = createCaptureMessage("client-created", {
      client: { id: "client-1" }
    });

    expect(isCaptureMessage({ ...valid, namespace: "wrong" })).toBe(false);
    expect(isCaptureMessage({ ...valid, kind: "unknown-kind" })).toBe(false);
    expect(isCaptureMessage({ ...valid, payload: undefined })).toBe(false);
    expect(isCaptureMessage({ ...valid, payload: "not-an-object" })).toBe(false);
  });

  it("rejects non-serializable payload content", () => {
    expect(
      isCaptureMessage({
        namespace: CAPTURE_NAMESPACE,
        version: CAPTURE_VERSION,
        kind: "client-created",
        timestamp: Date.now(),
        payload: { client: { id: "client-1" }, callback: () => null }
      })
    ).toBe(false);
  });
});

describe("bridge reinjection message validation", () => {
  it("accepts a valid panel reinjection request", () => {
    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-1",
        draft: createValidReinjectionDraftPayload()
      })
    ).toBe(true);
  });

  it("rejects reinjection requests missing the target listener id", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.target.listenerId = "";

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-1",
        draft
      })
    ).toBe(false);
  });

  it("rejects reinjection requests missing usable item context", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.item = { name: null, position: null };

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-1",
        draft
      })
    ).toBe(false);
  });
});

describe("stable id allocator", () => {
  it("keeps object IDs stable without mutating objects", () => {
    const ids = createStableIdAllocator("client");
    const client = {};

    expect(ids.getId(client)).toBe("client-1");
    expect(ids.getId(client)).toBe("client-1");
    expect(Object.keys(client)).toEqual([]);
  });
});

function createValidReinjectionDraftPayload() {
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
    changedFields: {
      price: 101
    },
    isSnapshot: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}
