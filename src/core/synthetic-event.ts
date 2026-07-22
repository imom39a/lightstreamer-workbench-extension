import { type ReinjectionResult } from "../bridge/messages";
import { type LightstreamerEventEnvelope } from "./event-envelope";
import {
  deriveChangedFields,
  draftFieldsMatchSource,
  type ReinjectionDraft,
  type ReinjectionExecutionTarget
} from "./reinjection-draft";

export function createSyntheticEventFromDraft(
  draft: ReinjectionDraft,
  result: ReinjectionResult,
  executionTarget: ReinjectionExecutionTarget = "captured-listener"
): LightstreamerEventEnvelope {
  const timestamp = result.timestamp || Date.now();
  const editedFields = deriveChangedFields(draft.sourceFields, draft.fields);
  const changedFields = draft.manualChangedFieldsOverride
    ? { ...draft.changedFields }
    : draftFieldsMatchSource(draft)
      ? { ...draft.originalChangedFields }
      : editedFields;

  return {
    id: `synthetic-${result.requestId}`,
    timestamp,
    direction: "inbound",
    source: "synthetic",
    synthetic: true,
    kind: "item-update",
    ...(draft.captureSource ? { captureSource: draft.captureSource } : {}),
    ...(draft.sourceClient ? { client: { ...draft.sourceClient } } : {}),
    subscription: {
      ...draft.sourceSubscription,
      ...(draft.sourceSubscription?.items
        ? { items: [...draft.sourceSubscription.items] }
        : {}),
      ...(draft.sourceSubscription?.fields
        ? { fields: [...draft.sourceSubscription.fields] }
        : {}),
      id: draft.target.subscriptionId ?? "unknown",
      mode: draft.subscriptionMode ?? "COMMAND"
    },
    ...(draft.target.listenerId ? { listener: { id: draft.target.listenerId } } : {}),
    item: {
      name: draft.item.name ?? null,
      position: draft.item.position ?? null
    },
    update: {
      isSnapshot: draft.isSnapshot,
      fields: { ...draft.fields },
      changedFields,
      command: draft.command,
      key: draft.key
    },
    raw: {
      sourceEventId: draft.sourceEventId,
      clonedSourceEventId: draft.provenance.source === "clone" ? draft.sourceEventId : null,
      targetSubscriptionId: draft.target.subscriptionId,
      targetListenerId: draft.target.listenerId,
      syntheticTimestamp: timestamp,
      editedFields,
      requestId: result.requestId,
      status: result.status,
      executionTarget,
      deliveredToPage: executionTarget !== "workbench-only",
      deliveryPath:
        executionTarget === "captured-wire"
          ? "captured-websocket"
          : executionTarget === "captured-listener"
            ? "captured-listener"
            : "workbench-state",
      serverContacted: false,
      manualChangedFieldsOverride: draft.manualChangedFieldsOverride,
      provenance: { ...draft.provenance }
    }
  };
}
