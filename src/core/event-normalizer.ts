import { type CaptureMessage, type JsonObject, type JsonValue } from "../bridge/messages";
import {
  type EventCaptureSource,
  type EventClient,
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

  return {
    id,
    timestamp: message.timestamp,
    direction: "inbound",
    source: "server",
    captureSource: toCaptureSource(payload.raw),
    synthetic: false,
    kind: message.kind,
    client: toClient(payload.client),
    subscription: toSubscription(payload.subscription),
    listener: toListener(payload.listener),
    item: toItem(payload.item),
    update,
    raw: toRaw(payload.raw)
  };
}

function toClient(value: JsonValue | undefined): EventClient | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) {
    return undefined;
  }

  return {
    id,
    status: asString(record.status),
    serverAddress: asNullableString(record.serverAddress),
    adapterSet: asNullableString(record.adapterSet)
  };
}

function toSubscription(value: JsonValue | undefined): EventSubscription | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) {
    return undefined;
  }

  return {
    id,
    mode: asNullableString(record.mode),
    items: asStringArray(record.items),
    itemGroup: asNullableString(record.itemGroup),
    fields: asStringArray(record.fields),
    fieldSchema: asNullableString(record.fieldSchema),
    dataAdapter: asNullableString(record.dataAdapter),
    requestedSnapshot: asSnapshotRequest(record.requestedSnapshot),
    keyPosition: asNumberOrString(record.keyPosition),
    commandPosition: asNumberOrString(record.commandPosition)
  };
}

function toListener(value: JsonValue | undefined): EventListener | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  return id ? { id } : undefined;
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
    key
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
