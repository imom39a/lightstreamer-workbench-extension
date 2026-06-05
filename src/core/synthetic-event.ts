import { type ReinjectionResult } from "../bridge/messages";
import { type LightstreamerEventEnvelope } from "./event-envelope";
import { type ReinjectionDraft } from "./reinjection-draft";

export function createSyntheticEventFromDraft(
  draft: ReinjectionDraft,
  result: ReinjectionResult
): LightstreamerEventEnvelope {
  const timestamp = result.timestamp || Date.now();

  return {
    id: `synthetic-${result.requestId}`,
    timestamp,
    direction: "inbound",
    source: "synthetic",
    synthetic: true,
    kind: "item-update",
    subscription: {
      id: draft.target.subscriptionId ?? "unknown",
      mode: "COMMAND"
    },
    listener: {
      id: draft.target.listenerId ?? "unknown"
    },
    item: {
      name: draft.item.name ?? null,
      position: draft.item.position ?? null
    },
    update: {
      isSnapshot: draft.isSnapshot,
      fields: { ...draft.fields },
      changedFields: { ...draft.changedFields },
      command: draft.command,
      key: draft.key
    },
    raw: {
      sourceEventId: draft.sourceEventId,
      clonedSourceEventId: draft.provenance.source === "clone" ? draft.sourceEventId : null,
      targetSubscriptionId: draft.target.subscriptionId,
      targetListenerId: draft.target.listenerId,
      syntheticTimestamp: timestamp,
      editedFields: { ...draft.changedFields },
      requestId: result.requestId,
      status: result.status,
      manualChangedFieldsOverride: draft.manualChangedFieldsOverride,
      provenance: { ...draft.provenance }
    }
  };
}
