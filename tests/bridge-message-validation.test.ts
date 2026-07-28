import { describe, expect, it } from "vitest";

import {
  CAPTURE_NAMESPACE,
  CAPTURE_VERSION,
  CONTENT_CAPTURE_SYNC_REQUEST,
  CONTENT_REINJECT_RESULT,
  PAGE_CAPTURE_SYNC_REQUEST,
  PANEL_REINJECT_REQUEST,
  PANEL_VISIBILITY_MESSAGE,
  RUNTIME_REINJECT_RESULT,
  type ReinjectionDraftPayload,
  createCaptureMessage,
  isCaptureMessage,
  isContentCaptureSyncRequestMessage,
  isContentReinjectResultMessage,
  isPageCaptureSyncRequestMessage,
  isPanelReinjectRequestMessage,
  isPanelVisibilityMessage,
  isRuntimeReinjectResultMessage
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

describe("bridge capture synchronization message validation", () => {
  it("accepts only the content and page active-subscription sync request types", () => {
    expect(isContentCaptureSyncRequestMessage({ type: CONTENT_CAPTURE_SYNC_REQUEST })).toBe(true);
    expect(isPageCaptureSyncRequestMessage({ type: PAGE_CAPTURE_SYNC_REQUEST })).toBe(true);
    expect(isContentCaptureSyncRequestMessage({ type: PAGE_CAPTURE_SYNC_REQUEST })).toBe(false);
    expect(isPageCaptureSyncRequestMessage({ type: CONTENT_CAPTURE_SYNC_REQUEST })).toBe(false);
  });
});

describe("panel visibility message validation", () => {
  it("accepts only boolean panel visibility notifications", () => {
    expect(
      isPanelVisibilityMessage({ type: PANEL_VISIBILITY_MESSAGE, visible: true })
    ).toBe(true);
    expect(
      isPanelVisibilityMessage({ type: PANEL_VISIBILITY_MESSAGE, visible: false })
    ).toBe(true);
    expect(
      isPanelVisibilityMessage({ type: PANEL_VISIBILITY_MESSAGE, visible: "false" })
    ).toBe(false);
    expect(isPanelVisibilityMessage({ type: "wrong", visible: true })).toBe(false);
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

  it("accepts null COMMAND metadata for a non-COMMAND listener payload", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.command = null;
    draft.key = null;
    draft.fields = { price: 101 };
    draft.changedFields = { price: 101 };

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-merge",
        draft
      })
    ).toBe(true);
  });

  it("rejects empty COMMAND metadata strings while allowing null", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.command = "";
    draft.key = null;

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-empty-command",
        draft
      })
    ).toBe(false);
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

  it("accepts a listenerless captured-wire request with explicit page delivery", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.executionTarget = "captured-wire";
    draft.target.listenerId = null;

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-wire",
        draft
      })
    ).toBe(true);
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

  it("accepts a wire delivery error result across the runtime boundary", () => {
    expect(
      isRuntimeReinjectResultMessage({
        type: RUNTIME_REINJECT_RESULT,
        result: {
          requestId: "request-wire-error",
          ok: false,
          status: "wire-error",
          timestamp: 123,
          error: "Captured wire field schema is unavailable."
        }
      })
    ).toBe(true);
  });

  it("accepts a content-script result relay and rejects malformed status values", () => {
    expect(
      isContentReinjectResultMessage({
        type: CONTENT_REINJECT_RESULT,
        result: {
          requestId: "request-relay",
          ok: true,
          status: "success",
          timestamp: 123
        }
      })
    ).toBe(true);
    expect(
      isContentReinjectResultMessage({
        type: CONTENT_REINJECT_RESULT,
        result: {
          requestId: "request-relay",
          ok: false,
          status: "not-a-status",
          timestamp: 123
        }
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

function createValidReinjectionDraftPayload(): ReinjectionDraftPayload {
  return {
    sourceEventId: "event-1",
    executionTarget: "captured-listener",
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
