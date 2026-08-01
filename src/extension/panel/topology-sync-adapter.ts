import {
  createCaptureMessage,
  type CaptureKind,
  type CapturePayload,
  type JsonObject,
  type JsonValue,
  type TopologyAbsoluteRecord,
  type TopologyObservation
} from "../../bridge/messages";
import { normalizeCaptureMessage } from "../../core/event-normalizer";
import { type LightstreamerEventEnvelope } from "../../core/event-envelope";
import {
  createTopologyStateIndex,
  type TopologyCommandGeneration,
  type TopologyEstablishment,
  type TopologyInferredChild,
  type TopologyState,
  type TopologyStateIndex
} from "../../core/topology-state";
import { type TopologySyncAdapter } from "../../core/topology-sync";

export type SemanticEventResolver = (
  observation: TopologyObservation
) => LightstreamerEventEnvelope | undefined;

type CheckpointAggregate = {
  listenerCount?: number;
  updateCount?: number;
  lostUpdates?: number;
  logicalUpdateIds: Set<string>;
};

const aggregatesByIndex = new WeakMap<
  TopologyStateIndex,
  Map<string, CheckpointAggregate>
>();

type CheckpointSubscriptionEvidence = {
  clientId: string | null;
  establishments: TopologyEstablishment[];
  establishmentEpoch: number;
  listenerAttachments: Map<
    string,
    Array<{ id: string; registrationCount: number | null }>
  >;
  commandGenerations: TopologyCommandGeneration[];
  commandGenerationEpochs: Map<string, number>;
  appliedLiveSequences: Set<number>;
};

const evidenceByIndex = new WeakMap<
  TopologyStateIndex,
  Map<string, CheckpointSubscriptionEvidence>
>();

/** Adapts semantic checkpoints to the established topology projection. */
export function createPanelTopologySyncAdapter(
  resolveLiveEvent: SemanticEventResolver
): TopologySyncAdapter<TopologyStateIndex> {
  return {
    empty() {
      return createTopologyStateIndex();
    },
    hydrate(pageEpoch, records) {
      const index = createTopologyStateIndex();
      const aggregates = new Map<string, CheckpointAggregate>();
      const evidence = checkpointEvidence(records);
      const subscriptionRecords = new Map(
        records
          .filter((record) => record.kind === "subscription")
          .map((record) => [record.id, record] as const)
      );
      for (const record of [...records].sort(recordOrder)) {
        if (record.kind === "aggregate" && record.subscriptionId) {
          const values = plainObject(record.values) ?? {};
          aggregates.set(record.subscriptionId, {
            listenerCount: numberValue(values.listenerCount),
            updateCount: numberValue(values.updateCount),
            lostUpdates: numberValue(values.lostUpdates),
            logicalUpdateIds: new Set()
          });
        }
        const event = eventFromAbsoluteRecord(
          pageEpoch,
          record,
          subscriptionRecords
        );
        if (event) {
          index.ingest(event);
        }
      }
      aggregatesByIndex.set(index, aggregates);
      evidenceByIndex.set(index, evidence);
      return index;
    },
    applyLive(current, observation) {
      const event =
        resolveLiveEvent(observation) ?? eventFromObservation(observation);
      if (event) {
        current.ingest(event);
        applyAggregateLiveEvent(current, event);
        applyLiveEvidence(current, observation, event);
      }
      return current;
    }
  };
}

function applyAggregateLiveEvent(
  index: TopologyStateIndex,
  event: LightstreamerEventEnvelope
): void {
  const aggregates = aggregatesByIndex.get(index);
  const aggregate = event.subscription?.id
    ? aggregates?.get(event.subscription.id)
    : undefined;
  if (!aggregates || !aggregate) return;
  if (event.kind === "item-update" && aggregate.updateCount !== undefined) {
    const logicalId = event.logicalEventId ?? event.id;
    if (!aggregate.logicalUpdateIds.has(logicalId)) {
      aggregate.logicalUpdateIds.add(logicalId);
      aggregate.updateCount += 1;
    }
  }
  if (event.kind === "lost-updates" && aggregate.lostUpdates !== undefined) {
    aggregate.lostUpdates += event.update?.lostUpdates ?? 0;
  }
  if (
    (event.kind === "listener-added" || event.kind === "listener-removed") &&
    aggregate.listenerCount !== undefined
  ) {
    aggregate.listenerCount =
      event.subscription?.listenerCount ??
      Math.max(
        0,
        aggregate.listenerCount + (event.kind === "listener-added" ? 1 : -1)
      );
  }
}

export function snapshotPanelTopologyState(
  index: TopologyStateIndex
): TopologyState {
  const state = index.snapshot();
  const aggregates = aggregatesByIndex.get(index);
  const evidence = evidenceByIndex.get(index);
  if ((!aggregates || aggregates.size === 0) && (!evidence || evidence.size === 0)) {
    return state;
  }
  const apply = <T extends TopologyState["unassignedSubscriptions"][number]>(
    subscription: T
  ): T => {
    const aggregate = aggregates?.get(subscription.id);
    const checkpoint = evidence?.get(subscription.id);
    if (!aggregate && !checkpoint) return subscription;
    return {
      ...subscription,
      listenerCount: aggregate?.listenerCount ?? subscription.listenerCount,
      updateCount: aggregate?.updateCount ?? subscription.updateCount,
      lostUpdateCount: aggregate?.lostUpdates ?? subscription.lostUpdateCount,
      establishments: checkpoint?.establishments ?? subscription.establishments,
      commandGenerations:
        checkpoint?.commandGenerations ?? subscription.commandGenerations,
      listeners: subscription.listeners.map((listener) => {
        const attachments = checkpoint?.listenerAttachments.get(listener.id) ?? [];
        return attachments.length === 0
          ? listener
          : {
              ...listener,
              attachmentIds: attachments.map(({ id }) => id),
              registrationCount: Math.max(
                listener.registrationCount,
                ...attachments.map(({ registrationCount }) => registrationCount ?? 0)
              )
            };
      })
    };
  };
  const clients = state.clients.map((client) => ({
    ...client,
    waitingSubscriptions: client.waitingSubscriptions.map(apply),
    sessions: client.sessions.map((session) => ({
      ...session,
      subscriptions: session.subscriptions.map(apply)
    }))
  }));
  const unassignedSubscriptions = state.unassignedSubscriptions.map(apply);
  const currentSubscriptions = [
    ...unassignedSubscriptions,
    ...clients.flatMap((client) => [
      ...client.waitingSubscriptions,
      ...client.sessions
        .filter((session) => !session.historical)
        .flatMap((session) => session.subscriptions)
    ])
  ];
  return {
    ...state,
    clients,
    unassignedSubscriptions,
    listenerCount: currentSubscriptions.reduce(
      (count, subscription) => count + subscription.listenerCount,
      0
    )
  };
}

function checkpointEvidence(
  records: readonly TopologyAbsoluteRecord[]
): Map<string, CheckpointSubscriptionEvidence> {
  const result = new Map<string, CheckpointSubscriptionEvidence>();
  const clientIds = new Map(
    records.flatMap((record) =>
      record.kind === "subscription" && record.clientId
        ? [[record.id, record.clientId] as const]
        : []
    )
  );
  const ensure = (subscriptionId: string): CheckpointSubscriptionEvidence => {
    const existing = result.get(subscriptionId);
    if (existing) return existing;
    const created: CheckpointSubscriptionEvidence = {
      clientId: clientIds.get(subscriptionId) ?? null,
      establishments: [],
      establishmentEpoch: 0,
      listenerAttachments: new Map(),
      commandGenerations: [],
      commandGenerationEpochs: new Map(),
      appliedLiveSequences: new Set()
    };
    result.set(subscriptionId, created);
    return created;
  };
  const childrenByGeneration = new Map<string, TopologyInferredChild[]>();
  for (const record of records) {
    if (record.kind !== "inferred-child" || !record.parentId) continue;
    const values = plainObject(record.values) ?? {};
    const children = childrenByGeneration.get(record.parentId) ?? [];
    children.push({
      id: record.id,
      label: stringValue(values.label) ?? "Inferred second-level child",
      key: stringValue(values.key) ?? null,
      captureKind: stringValue(values.captureKind) ?? null,
      callback: stringValue(values.callback) ?? null,
      provenance: stringValue(values.provenance) ?? "inferred-second-level",
      captureSequence: record.captureSequence
    });
    childrenByGeneration.set(record.parentId, children);
  }
  for (const record of records) {
    const subscriptionId = record.subscriptionId;
    if (!subscriptionId) continue;
    const values = plainObject(record.values) ?? {};
    const target = ensure(subscriptionId);
    if (record.kind === "establishment") {
      const epoch = numberValue(values.epoch) ?? numericIdSuffix(record.id);
      target.establishments.push({
        id: record.id,
        epoch,
        captureSequence: record.captureSequence
      });
      target.establishmentEpoch = Math.max(
        target.establishmentEpoch,
        epoch ?? 0
      );
    } else if (record.kind === "listener-attachment") {
      const listenerId = stringValue(values.listenerId);
      if (listenerId) {
        const attachments = target.listenerAttachments.get(listenerId) ?? [];
        attachments.push({
          id: record.id,
          registrationCount: numberValue(values.registrationCount) ?? null
        });
        target.listenerAttachments.set(listenerId, attachments);
      }
    } else if (record.kind === "command-generation") {
      const itemId = stringValue(values.itemId) ?? null;
      const key = stringValue(values.key) ?? null;
      target.commandGenerations.push({
        id: record.id,
        itemId,
        key,
        command: stringValue(values.command) ?? null,
        captureSequence: record.captureSequence,
        inferredChildren: childrenByGeneration.get(record.id) ?? []
      });
      if (key) {
        const generationKey = commandGenerationEpochKey(itemId, key);
        target.commandGenerationEpochs.set(
          generationKey,
          Math.max(
            target.commandGenerationEpochs.get(generationKey) ?? 0,
            numericIdSuffix(record.id) ?? 0
          )
        );
      }
    }
  }
  for (const target of result.values()) {
    target.establishments.sort(
      (left, right) => left.captureSequence - right.captureSequence
    );
    target.commandGenerations.sort(
      (left, right) => left.captureSequence - right.captureSequence
    );
  }
  return result;
}

function applyLiveEvidence(
  index: TopologyStateIndex,
  observation: TopologyObservation,
  event: LightstreamerEventEnvelope
): void {
  const evidence = evidenceByIndex.get(index) ?? new Map();
  evidenceByIndex.set(index, evidence);
  const clientId = event.client?.id ?? stringValue(observation.client?.id) ?? null;
  const clientStatus = event.client?.status?.toUpperCase() ?? "";
  if (
    event.kind === "client-status" &&
    clientId &&
    (clientStatus.startsWith("DISCONNECTED") || event.client?.sessionId === null)
  ) {
    for (const target of evidence.values()) {
      if (target.clientId === clientId) target.establishments = [];
    }
  }
  const subscriptionId =
    event.subscription?.id ?? stringValue(observation.subscription?.id);
  if (!subscriptionId) return;
  const target = ensureSubscriptionEvidence(evidence, subscriptionId, clientId);
  if (target.appliedLiveSequences.has(observation.captureSequence)) return;
  target.appliedLiveSequences.add(observation.captureSequence);
  while (target.appliedLiveSequences.size > 4_096) {
    const oldest = target.appliedLiveSequences.values().next().value as
      | number
      | undefined;
    if (oldest === undefined) break;
    target.appliedLiveSequences.delete(oldest);
  }

  if (observation.kind === "subscription-established") {
    const explicitEpoch =
      numberValue(observation.values?.establishmentEpoch) ??
      numberValue(observation.values?.epoch);
    const epoch = explicitEpoch ?? target.establishmentEpoch + 1;
    const id =
      stringValue(observation.values?.establishmentId) ??
      `establishment:${subscriptionId}:${epoch}`;
    upsertById(target.establishments, {
      id,
      epoch,
      captureSequence: observation.captureSequence
    });
    target.establishmentEpoch = Math.max(target.establishmentEpoch, epoch);
  }

  if (
    observation.kind === "subscription-ended" ||
    event.kind === "subscription-ended"
  ) {
    target.establishments = [];
    target.commandGenerations = [];
  }

  if (
    observation.kind === "listener-attached" ||
    observation.kind === "listener-added"
  ) {
    const listenerId =
      stringValue(observation.listenerAttachment?.listenerId) ??
      event.listener?.id ??
      stringValue(observation.listener?.id);
    const attachmentId = stringValue(observation.listenerAttachment?.id);
    if (listenerId && attachmentId) {
      target.listenerAttachments.set(listenerId, [
        {
          id: attachmentId,
          registrationCount:
            numberValue(observation.listenerAttachment?.registrationCount) ??
            event.listener?.registrationCount ??
            numberValue(observation.listener?.registrationCount) ??
            null
        }
      ]);
    }
  } else if (
    observation.kind === "listener-detached" ||
    observation.kind === "listener-removed"
  ) {
    const listenerId =
      stringValue(observation.listenerAttachment?.listenerId) ??
      event.listener?.id ??
      stringValue(observation.listener?.id);
    const attachmentId = stringValue(observation.listenerAttachment?.id);
    if (listenerId) {
      const retained = (target.listenerAttachments.get(listenerId) ?? []).filter(
        ({ id }) => attachmentId && id !== attachmentId
      );
      if (retained.length > 0) {
        target.listenerAttachments.set(listenerId, retained);
      } else {
        target.listenerAttachments.delete(listenerId);
      }
    }
  }

  applyLiveCommandGeneration(target, subscriptionId, observation, event);
  applyLiveInferredChild(target, observation, event);
}

function ensureSubscriptionEvidence(
  evidence: Map<string, CheckpointSubscriptionEvidence>,
  subscriptionId: string,
  clientId: string | null = null
): CheckpointSubscriptionEvidence {
  const existing = evidence.get(subscriptionId);
  if (existing) {
    existing.clientId ??= clientId;
    return existing;
  }
  const created: CheckpointSubscriptionEvidence = {
    clientId,
    establishments: [],
    establishmentEpoch: 0,
    listenerAttachments: new Map(),
    commandGenerations: [],
    commandGenerationEpochs: new Map(),
    appliedLiveSequences: new Set()
  };
  evidence.set(subscriptionId, created);
  return created;
}

function applyLiveCommandGeneration(
  target: CheckpointSubscriptionEvidence,
  subscriptionId: string,
  observation: TopologyObservation,
  event: LightstreamerEventEnvelope
): void {
  if (observation.kind !== "command-key-generation") return;
  const command = event.update?.command?.toUpperCase() ?? null;
  const key =
    event.update?.key ?? stringValue(observation.values?.commandKey) ?? null;
  if (!key || !command) return;
  const itemId =
    stringValue(observation.values?.itemId) ??
    semanticItemId(subscriptionId, event, observation);
  const matching = target.commandGenerations.filter(
    (generation) => generation.itemId === itemId && generation.key === key
  );
  if (command === "DELETE") {
    target.commandGenerations = target.commandGenerations.filter(
      (generation) => generation.itemId !== itemId || generation.key !== key
    );
    return;
  }
  if (command === "UPDATE" && matching.length > 0) return;
  const explicitId = stringValue(observation.values?.generationId);
  const explicitEpoch =
    numberValue(observation.values?.generationEpoch) ??
    (explicitId ? numericIdSuffix(explicitId) : null);
  const generationEpochKey = commandGenerationEpochKey(itemId, key);
  const epoch = explicitEpoch ??
    (target.commandGenerationEpochs.get(generationEpochKey) ?? 0) + 1;
  const id =
    explicitId ??
    `command-generation:${subscriptionId}:${itemId ?? "unknown-item"}:${key}:${epoch}`;
  target.commandGenerations = target.commandGenerations.filter(
    (generation) => generation.itemId !== itemId || generation.key !== key
  );
  target.commandGenerations.push({
    id,
    itemId,
    key,
    command,
    captureSequence: observation.captureSequence,
    inferredChildren: []
  });
  target.commandGenerationEpochs.set(
    generationEpochKey,
    Math.max(target.commandGenerationEpochs.get(generationEpochKey) ?? 0, epoch)
  );
}

function commandGenerationEpochKey(itemId: string | null, key: string): string {
  return `${itemId ?? "unknown-item"}\u0000${key}`;
}

function applyLiveInferredChild(
  target: CheckpointSubscriptionEvidence,
  observation: TopologyObservation,
  event: LightstreamerEventEnvelope
): void {
  if (observation.kind !== "second-level-observed") return;
  const key =
    stringValue(observation.values?.secondLevelKey) ?? event.update?.key ?? null;
  if (!key) return;
  const generation = [...target.commandGenerations]
    .reverse()
    .find((candidate) => candidate.key === key);
  if (!generation) return;
  const callback =
    typeof event.raw?.callback === "string" ? event.raw.callback : null;
  const provenance =
    stringValue(observation.values?.secondLevelProvenance) ??
    "inferred-second-level";
  const id =
    stringValue(observation.values?.inferredChildId) ??
    `inferred-child:${generation.id}:${callback ?? observation.captureSequence}`;
  const label =
    callback === "onCommandSecondLevelItemLostUpdates"
      ? "Second-level lost updates"
      : callback === "onCommandSecondLevelSubscriptionError"
        ? "Second-level subscription error"
        : "Inferred second-level child";
  upsertById(generation.inferredChildren, {
    id,
    label,
    key,
    captureKind: event.kind,
    callback,
    provenance,
    captureSequence: observation.captureSequence
  });
}

function semanticItemId(
  subscriptionId: string,
  event: LightstreamerEventEnvelope,
  observation: TopologyObservation
): string | null {
  const position =
    event.item?.position ?? numberValue(observation.item?.position) ?? null;
  const name = event.item?.name ?? stringValue(observation.item?.name) ?? null;
  return position !== null || name
    ? `item:${subscriptionId}:${position ?? name}`
    : null;
}

function numericIdSuffix(id: string): number | null {
  const suffix = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isInteger(suffix) && suffix >= 0 ? suffix : null;
}

function upsertById<T extends { id: string }>(values: T[], next: T): void {
  const index = values.findIndex(({ id }) => id === next.id);
  if (index >= 0) values[index] = next;
  else values.push(next);
}

export function resetPanelTopologyObservations(
  index: TopologyStateIndex,
  timestamp?: number
): TopologyState {
  const aggregates = aggregatesByIndex.get(index);
  if (aggregates) {
    aggregatesByIndex.set(
      index,
      new Map(
        [...aggregates].map(([id, aggregate]) => [
          id,
          {
            ...aggregate,
            updateCount: 0,
            lostUpdates: 0,
            logicalUpdateIds: new Set<string>()
          }
        ])
      )
    );
  }
  index.resetCurrentObservations(timestamp);
  return snapshotPanelTopologyState(index);
}

function eventFromAbsoluteRecord(
  pageEpoch: string,
  record: TopologyAbsoluteRecord,
  subscriptionRecords: ReadonlyMap<string, TopologyAbsoluteRecord>
): LightstreamerEventEnvelope | null {
  if (record.kind === "page" || record.kind === "aggregate") {
    return null;
  }
  const values = plainObject(record.values) ?? {};
  const explicitPayload = plainObject(values.payload);
  const subscriptionRecord = record.subscriptionId
    ? subscriptionRecords.get(record.subscriptionId)
    : undefined;
  const subscriptionValues = plainObject(subscriptionRecord?.values) ?? {};
  const clientId =
    stringValue(values.clientId) ??
    record.clientId ??
    subscriptionRecord?.clientId ??
    (record.kind === "client" ? record.id : undefined);
  const semanticValueStates = semanticStateObject(
    values,
    subscriptionValues.client,
    values.client
  );
  const client = mergeObjects(
    { ...(clientId ? { id: clientId } : {}) },
    plainObject(subscriptionValues.client),
    plainObject(values.client),
    semanticValueStates ? { semanticValueStates } : undefined
  );
  const sessionId =
    stringValue(values.sessionId) ?? stringValue(client.sessionId);
  if (sessionId) {
    client.sessionId = sessionId;
  }
  const subscriptionId = record.subscriptionId ??
    (record.kind === "subscription" ? record.id : undefined);
  const subscription = mergeObjects(
    { ...(subscriptionId ? { id: subscriptionId } : {}) },
    plainObject(subscriptionValues.subscription),
    plainObject(values.subscription)
  );

  let kind: CaptureKind;
  let payload: CapturePayload;
  switch (record.kind) {
    case "client":
      kind = "client-created";
      payload = explicitPayload ?? { client: mergeObjects({ id: record.id }, values, client) };
      break;
    case "session":
      kind = "client-status";
      payload = explicitPayload ?? {
        client: mergeObjects(
          { id: record.clientId ?? record.parentId ?? "unknown-client", sessionId: record.id },
          values,
          client
        )
      };
      break;
    case "subscription":
    case "establishment":
      kind = "subscription-started";
      payload = explicitPayload ?? {
        client,
        subscription: mergeObjects(
          {
            id: subscriptionId ?? record.id,
            active: record.clientActive ?? true,
            subscribed: record.serverEstablished ?? record.kind === "establishment"
          },
          values,
          subscription
        )
      };
      break;
    case "listener-attachment": {
      const active = booleanValue(values.active) ?? true;
      kind = active ? "listener-added" : "listener-removed";
      payload = explicitPayload ?? {
        client,
        subscription: mergeObjects(
          subscription,
          numberValue(values.listenerCount) === undefined
            ? undefined
            : { listenerCount: numberValue(values.listenerCount) as number }
        ),
        listener: mergeObjects(
          { id: stringValue(values.listenerId) ?? record.id },
          values,
          plainObject(values.listener)
        )
      };
      break;
    }
    case "item": {
      const sourceKind = stringValue(values.captureKind);
      if (!isItemEvidenceCaptureKind(sourceKind)) {
        return null;
      }
      kind = sourceKind;
      payload = explicitPayload ?? {
        client,
        subscription,
        item: mergeObjects(
          { name: stringValue(values.itemName) ?? record.id },
          plainObject(values.item)
        ),
        update: plainObject(values.update) ?? {}
      };
      break;
    }
    case "command-generation":
    case "inferred-child":
      return null;
  }
  return normalizeCaptureMessage(
    createCaptureMessage(
      kind,
      payload,
      numberValue(values.timestamp) ?? record.captureSequence
    ),
    `topology-sync:${pageEpoch}:${record.kind}:${record.id}`
  );
}

function isItemEvidenceCaptureKind(
  value: string | undefined
): value is "item-update" | "end-of-snapshot" | "lost-updates" | "clear-snapshot" {
  return (
    value === "item-update" ||
    value === "end-of-snapshot" ||
    value === "lost-updates" ||
    value === "clear-snapshot"
  );
}

function eventFromObservation(
  observation: TopologyObservation
): LightstreamerEventEnvelope | null {
  const kind = captureKindForObservation(observation.kind);
  if (!kind) {
    return null;
  }
  const payload: CapturePayload = {};
  for (const key of ["client", "subscription", "item", "listener"] as const) {
    const value = plainObject(observation[key]);
    if (value) {
      payload[key] = value;
    }
  }
  return normalizeCaptureMessage(
    createCaptureMessage(kind, payload, observation.captureSequence),
    `topology-live:${observation.pageEpoch}:${observation.captureSequence}`
  );
}

function captureKindForObservation(
  kind: TopologyObservation["kind"]
): CaptureKind | null {
  if (
    kind === "session-established" ||
    kind === "session-absent" ||
    kind === "client-status"
  ) return "client-status";
  if (kind === "subscription-active" || kind === "subscription-established") {
    return "subscription-started";
  }
  if (kind === "listener-attached") return "listener-added";
  if (kind === "listener-detached") return "listener-removed";
  if (
    kind === "callback-update" ||
    kind === "item-observed" ||
    kind === "command-key-generation" ||
    kind === "second-level-observed"
  ) return "item-update";
  if (kind === "callback-error") return "subscription-error";
  if (kind === "callback-loss") return "lost-updates";
  if (kind === "callback-eos") return "end-of-snapshot";
  if (kind === "callback-clear") return "clear-snapshot";
  return [
    "client-created",
    "subscription-created",
    "subscription-started",
    "subscription-snapshot",
    "subscription-frequency",
    "subscription-ended",
    "subscription-error",
    "listener-added",
    "listener-removed",
    "item-update",
    "end-of-snapshot",
    "lost-updates",
    "clear-snapshot"
  ].includes(kind)
    ? (kind as CaptureKind)
    : null;
}

function recordOrder(
  left: TopologyAbsoluteRecord,
  right: TopologyAbsoluteRecord
): number {
  const order: Record<TopologyAbsoluteRecord["kind"], number> = {
    page: 0,
    client: 1,
    session: 2,
    subscription: 3,
    establishment: 4,
    "listener-attachment": 5,
    item: 6,
    "command-generation": 7,
    "inferred-child": 8,
    aggregate: 9
  };
  return order[left.kind] - order[right.kind] || left.captureSequence - right.captureSequence;
}

function mergeObjects(...values: Array<JsonObject | undefined>): JsonObject {
  return Object.assign({}, ...values.filter(Boolean));
}

function plainObject(value: unknown): JsonObject | undefined {
  const unwrapped = unwrapTopologyValue(value);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(unwrapped).flatMap(([key, entry]) => {
      const plain = unwrapTopologyValue(entry);
      return plain === undefined ? [] : [[key, plain as JsonValue]];
    })
  );
}

function unwrapTopologyValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.state === "string") {
    return "value" in record ? unwrapTopologyValue(record.value) : undefined;
  }
  return value;
}

function semanticStateObject(...values: unknown[]): JsonObject | undefined {
  const states: JsonObject = {};
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.state !== "string") continue;
      states[key] = Object.fromEntries(
        ["state", "reason", "context"].flatMap((name) => {
          const candidate = record[name];
          return typeof candidate === "string" ? [[name, candidate]] : [];
        })
      );
    }
  }
  return Object.keys(states).length > 0 ? states : undefined;
}

function stringValue(value: unknown): string | undefined {
  const plain = unwrapTopologyValue(value);
  return typeof plain === "string" && plain.length > 0 ? plain : undefined;
}

function numberValue(value: unknown): number | undefined {
  const plain = unwrapTopologyValue(value);
  return typeof plain === "number" && Number.isFinite(plain) ? plain : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  const plain = unwrapTopologyValue(value);
  return typeof plain === "boolean" ? plain : undefined;
}
