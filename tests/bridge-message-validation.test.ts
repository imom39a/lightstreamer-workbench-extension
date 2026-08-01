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
  TOPOLOGY_LIMITS,
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_LIMITS,
  TOPOLOGY_SYNC_VERSION,
  type ReinjectionDraftPayload,
  type JsonValue,
  type TopologyObservation,
  createCaptureMessage,
  isCaptureMessage,
  isContentCaptureSyncRequestMessage,
  isContentReinjectResultMessage,
  isPageCaptureSyncRequestMessage,
  isPanelReinjectRequestMessage,
  isPanelVisibilityMessage,
  isRuntimeReinjectResultMessage,
  isTopologyObservation,
  isTopologySyncFrame
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

describe("semantic topology trust-boundary validation", () => {
  it("preserves all seven evidence states without collapsing unavailable facts", () => {
    const states = [
      { state: "requested", value: "MERGE" },
      { state: "real", value: "MERGE" },
      { state: "inferred", value: "MERGE" },
      { state: "unknown" },
      { state: "unavailable", reason: "getter-missing" },
      { state: "redacted" },
      { state: "not-applicable" }
    ] as const;

    for (const fact of states) {
      expect(isTopologyObservation(observation({ values: { mode: fact } }))).toBe(true);
    }
  });

  it("accepts semantic topology on compatible legacy captures and rejects mismatches", () => {
    const topology = observation({ kind: "subscription-active" });
    expect(
      isCaptureMessage(
        createCaptureMessage("subscription-started", { subscription: { id: "sub-a" } }, 1, topology)
      )
    ).toBe(true);
    expect(
      isCaptureMessage({
        ...createCaptureMessage("client-created", { client: { id: "client-a" } }),
        topology
      })
    ).toBe(false);
  });

  it("rejects hostile semantic evidence at string, nesting, and credential bounds", () => {
    expect(
      isTopologyObservation(
        observation({ values: { label: { state: "real", value: "x".repeat(TOPOLOGY_LIMITS.valueString + 1) } } })
      )
    ).toBe(false);
    expect(
      isTopologyObservation(
        observation({ values: { nested: { state: "real", value: nested(TOPOLOGY_LIMITS.depth + 1) } } })
      )
    ).toBe(false);
    expect(
      isTopologyObservation({ ...observation(), client: { id: "client-a", authorization: "secret" } })
    ).toBe(false);
  });

  it("rejects malformed topology facts nested inside semantic evidence and checkpoints", () => {
    const malformedFacts = [
      { state: "real" },
      { state: "unavailable", value: "must-not-exist" },
      { state: "not-a-topology-state", value: "invalid" }
    ];

    for (const malformedFact of malformedFacts) {
      expect(
        isTopologyObservation(
          observation({
            client: {
              id: "client-a",
              nested: { connection: malformedFact }
            } as TopologyObservation["client"]
          })
        )
      ).toBe(false);

      expect(
        isTopologySyncFrame({
          type: TOPOLOGY_SYNC_CHUNK,
          version: TOPOLOGY_SYNC_VERSION,
          syncId: "malformed-fact",
          pageEpoch: "page-a",
          cutoffCaptureSequence: 20,
          chunkCount: 1,
          recordCount: 1,
          coverage: { status: "complete", getters: {} },
          chunkIndex: 0,
          records: [
            {
              kind: "page",
              id: "page-a",
              pageEpoch: "page-a",
              captureSequence: 20,
              values: { nested: { connection: malformedFact } }
            }
          ]
        })
      ).toBe(false);
    }
  });

  it("validates bounded checkpoint frames and their absolute records", () => {
    const metadata = {
      version: TOPOLOGY_SYNC_VERSION,
      syncId: "sync-a",
      pageEpoch: "page-a",
      cutoffCaptureSequence: 20,
      chunkCount: 1,
      recordCount: 1,
      coverage: { status: "complete" as const, getters: {} }
    };
    expect(isTopologySyncFrame({ type: TOPOLOGY_SYNC_BEGIN, ...metadata })).toBe(true);
    expect(
      isTopologySyncFrame({
        type: TOPOLOGY_SYNC_CHUNK,
        ...metadata,
        chunkIndex: 0,
        records: [{ kind: "page", id: "page-a", pageEpoch: "page-a", captureSequence: 20 }]
      })
    ).toBe(true);
    expect(
      isTopologySyncFrame({ ...metadata, type: TOPOLOGY_SYNC_BEGIN, chunkCount: TOPOLOGY_SYNC_LIMITS.maxChunks + 1 })
    ).toBe(false);
  });

  it("accepts cutoff zero only as a nonnegative empty-checkpoint boundary", () => {
    const emptyMetadata = {
      version: TOPOLOGY_SYNC_VERSION,
      syncId: "empty-sync",
      pageEpoch: "page-a",
      cutoffCaptureSequence: 0,
      chunkCount: 0,
      recordCount: 0,
      coverage: { status: "complete" as const, getters: {} }
    };

    expect(isTopologySyncFrame({ type: TOPOLOGY_SYNC_BEGIN, ...emptyMetadata })).toBe(true);
    expect(
      isTopologySyncFrame({
        type: "lsew:topology-sync-complete",
        ...emptyMetadata
      })
    ).toBe(true);
    expect(
      isTopologySyncFrame({
        type: TOPOLOGY_SYNC_BEGIN,
        ...emptyMetadata,
        cutoffCaptureSequence: -1
      })
    ).toBe(false);
    expect(
      isTopologySyncFrame({
        type: TOPOLOGY_SYNC_BEGIN,
        ...emptyMetadata,
        chunkCount: 1,
        recordCount: 1
      })
    ).toBe(false);
    expect(
      isTopologySyncFrame({
        type: TOPOLOGY_SYNC_CHUNK,
        ...emptyMetadata,
        chunkCount: 1,
        recordCount: 1,
        chunkIndex: 0,
        records: [
          {
            kind: "page",
            id: "page-a",
            pageEpoch: "page-a",
            captureSequence: 0
          }
        ]
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

  it("rejects malformed source listener provenance", () => {
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

  it("accepts Subscription-scoped listener delivery without source listener provenance", () => {
    const draft = createValidReinjectionDraftPayload();
    draft.target.listenerId = null;

    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-subscription",
        draft
      })
    ).toBe(true);
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

function observation(overrides: Partial<TopologyObservation> = {}): TopologyObservation {
  return {
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind: "subscription-active",
    pageEpoch: "page-a",
    captureSequence: 1,
    provenance: { instrumentationSource: "official-public-api" },
    coverage: { status: "complete", getters: {} },
    client: { id: "client-a" },
    subscription: { id: "sub-a" },
    ...overrides
  } as TopologyObservation;
}

function nested(depth: number): JsonValue {
  let value: JsonValue = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}
