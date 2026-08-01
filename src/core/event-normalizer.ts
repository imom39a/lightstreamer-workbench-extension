import { type CaptureMessage, type JsonObject, type JsonValue } from "../bridge/messages";
import {
  type EventCaptureSource,
  type EventClient,
  type EventSemanticValueState,
  type EventItem,
  type EventListener,
  type EventSubscription,
  type EventUpdate,
  type LightstreamerEventEnvelope
} from "./event-envelope";

export type EventNormalizer = {
  normalize(message: CaptureMessage): LightstreamerEventEnvelope;
};

export function createEventNormalizer(startAt = 1): EventNormalizer {
  let nextId = startAt;

  return {
    normalize(message) {
      const event = normalizeCaptureMessage(message, `event-${nextId}`);
      nextId += 1;
      return event;
    }
  };
}

export function normalizeCaptureMessage(
  message: CaptureMessage,
  id = "event-1"
): LightstreamerEventEnvelope {
  const payload = message.payload;
  const update = toEventUpdate(payload.update);
  const raw = toRaw(payload.raw);

  return {
    id,
    timestamp: message.timestamp,
    direction: "inbound",
    source: "server",
    captureSource: toCaptureSource(payload.raw),
    synthetic: false,
    kind: message.kind,
    logicalEventId: asString(raw?.logicalEventId),
    client: toClient(payload.client, message.topology?.client),
    subscription: toSubscription(payload.subscription, message.topology?.subscription),
    listener: toListener(payload.listener),
    item: toItem(payload.item),
    update,
    raw,
    ...(message.topology ? { topology: message.topology } : {})
  };
}

function toClient(
  value: JsonValue | undefined,
  semanticEvidence?: Record<string, unknown>
): EventClient | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) {
    return undefined;
  }

  const semanticValueStates = {
    ...toSemanticValueStates(asRecord(record.semanticValueStates)),
    ...toSemanticValueStates(semanticEvidence)
  };
  return {
    id,
    status: asString(record.status),
    serverAddress: asNullableString(record.serverAddress),
    adapterSet: asNullableString(record.adapterSet),
    libraryVersion: asNullableString(record.libraryVersion),
    instrumentationSource: asNullableString(record.instrumentationSource),
    coverageStatus: asNullableString(record.coverageStatus),
    sessionId: asNullableString(record.sessionId),
    serverInstanceAddress: asNullableString(record.serverInstanceAddress),
    serverSocketName: asNullableString(record.serverSocketName),
    clientIp: asNullableString(record.clientIp),
    transport: asNullableString(record.transport),
    requestedMaxBandwidth: asNumberOrString(record.requestedMaxBandwidth),
    realMaxBandwidth: asNumberOrString(record.realMaxBandwidth),
    keepaliveInterval: asNullableNumber(record.keepaliveInterval),
    reverseHeartbeatInterval: asNullableNumber(record.reverseHeartbeatInterval),
    pollingInterval: asNullableNumber(record.pollingInterval),
    idleTimeout: asNullableNumber(record.idleTimeout),
    retryDelay: asNullableNumber(record.retryDelay),
    firstRetryMaxDelay: asNullableNumber(record.firstRetryMaxDelay),
    stalledTimeout: asNullableNumber(record.stalledTimeout),
    reconnectTimeout: asNullableNumber(record.reconnectTimeout),
    sessionRecoveryTimeout: asNullableNumber(record.sessionRecoveryTimeout),
    forcedTransport: asNullableString(record.forcedTransport),
    ...(Object.keys(semanticValueStates).length > 0 ? { semanticValueStates } : {})
  };
}

function toSemanticValueStates(
  evidence: Record<string, unknown> | undefined
): Record<string, EventSemanticValueState> | undefined {
  if (!evidence) return undefined;
  const states = Object.entries(evidence).flatMap(([key, value]) => {
    const record = asRecord(value as JsonValue);
    const state = record?.state;
    if (
      state !== "requested" &&
      state !== "real" &&
      state !== "inferred" &&
      state !== "unknown" &&
      state !== "unavailable" &&
      state !== "redacted" &&
      state !== "not-applicable"
    ) {
      return [];
    }
    const semanticState: EventSemanticValueState = { state };
    const reason = asString(record?.reason);
    const context = asString(record?.context);
    if (reason) {
      semanticState.reason = reason as EventSemanticValueState["reason"];
    }
    if (context) semanticState.context = context;
    return [[key, semanticState] as const];
  });
  return states.length > 0 ? Object.fromEntries(states) : undefined;
}

function toSubscription(
  value: JsonValue | undefined,
  semanticEvidence?: Record<string, unknown>
): EventSubscription | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) {
    return undefined;
  }

  const semanticValueStates = {
    ...toSemanticValueStates(asRecord(record.semanticValueStates)),
    ...toSemanticValueStates(semanticEvidence)
  };
  return {
    id,
    mode: asNullableString(record.mode),
    items: asStringArray(record.items),
    itemGroup: asNullableString(record.itemGroup),
    fields: asStringArray(record.fields),
    fieldSchema: asNullableString(record.fieldSchema),
    dataAdapter: asNullableString(record.dataAdapter),
    selector: asNullableString(record.selector),
    requestedSnapshot: asSnapshotRequest(record.requestedSnapshot),
    requestedBufferSize: asNumberOrString(record.requestedBufferSize),
    requestedMaxFrequency: asNumberOrString(record.requestedMaxFrequency),
    realMaxFrequency: asNumberOrString(record.realMaxFrequency),
    active: asBoolean(record.active),
    subscribed: asBoolean(record.subscribed),
    listenerCount: asNullableNumber(record.listenerCount),
    commandSecondLevelDataAdapter: asNullableString(record.commandSecondLevelDataAdapter),
    commandSecondLevelFields: asStringArray(record.commandSecondLevelFields),
    commandSecondLevelFieldSchema: asNullableString(record.commandSecondLevelFieldSchema),
    keyPosition: asNumberOrString(record.keyPosition),
    commandPosition: asNumberOrString(record.commandPosition),
    ...(Object.keys(semanticValueStates).length > 0 ? { semanticValueStates } : {})
  };
}

function toListener(value: JsonValue | undefined): EventListener | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  return id
    ? {
        id,
        callbacks: asStringArray(record?.callbacks),
        registrationCount: asNullableNumber(record?.registrationCount) ?? undefined,
        metricOwner: asBoolean(record?.metricOwner)
      }
    : undefined;
}

function toItem(value: JsonValue | undefined): EventItem | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const name = asNullableString(record.name);
  const position = asNumber(record.position);
  if (name === undefined && position === undefined) {
    return undefined;
  }

  return {
    name,
    position: position ?? null
  };
}

function toEventUpdate(value: JsonValue | undefined): EventUpdate | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const fields = asFieldRecord(record.fields);
  const changedFields = asFieldRecord(record.changedFields);
  const command = asNullableString(record.command ?? fields?.command ?? changedFields?.command);
  const key = asNullableString(record.key ?? fields?.key ?? changedFields?.key);

  return {
    isSnapshot: asBoolean(record.isSnapshot),
    fields,
    changedFields,
    jsonPatches: asObjectRecord(record.jsonPatches),
    command,
    key,
    lostUpdates: asNullableNumber(record.lostUpdates)
  };
}

function toRaw(value: JsonValue | undefined): JsonObject | undefined {
  return asRecord(value);
}

function toCaptureSource(value: JsonValue | undefined): EventCaptureSource {
  const record = asRecord(value);
  return record?.captureSource === "websocket-tlcp" ? "wire" : "listener";
}

function asRecord(value: JsonValue | undefined): JsonObject | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function asObjectRecord(value: JsonValue | undefined): Record<string, unknown> | undefined {
  return asRecord(value);
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNullableString(value: JsonValue | undefined): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function asStringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((entry) => String(entry));
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNullableNumber(value: JsonValue | undefined): number | null | undefined {
  if (value === null) {
    return null;
  }
  return asNumber(value);
}

function asNumberOrString(value: JsonValue | undefined): number | string | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function asBoolean(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asSnapshotRequest(value: JsonValue | undefined): string | boolean | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function asFieldRecord(
  value: JsonValue | undefined
): Record<string, string | number | boolean | null> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, fieldValue] of Object.entries(record)) {
    if (
      fieldValue === null ||
      typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean"
    ) {
      fields[key] = fieldValue;
    }
  }
  return fields;
}
