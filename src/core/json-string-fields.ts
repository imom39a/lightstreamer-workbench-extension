import { type JsonObject, type JsonValue } from "../bridge/messages";

/** A field value as it is captured and delivered by the Lightstreamer client. */
export type JsonStringFieldValue = string | number | boolean | null;

/** JSON containers are the only encoded strings Workbench expands for presentation. */
export type JsonContainer = JsonObject | JsonValue[];

export type ExpandedJsonStringFieldValue = JsonStringFieldValue | JsonContainer;

export type ExpandedJsonStringFields = Readonly<{
  fields: Readonly<Record<string, ExpandedJsonStringFieldValue>>;
  /** Stable frozen names whose captured string values were JSON containers. */
  encodedFieldNames: readonly string[];
}>;

type EncodedSource = Readonly<{
  text: string;
  value: JsonContainer;
}>;

const encodedSources = new WeakMap<ExpandedJsonStringFields, ReadonlyMap<string, EncodedSource>>();

/**
 * Parses only a complete JSON object or array. Scalars, quoted strings, malformed
 * text, non-strings, and ordinary strings intentionally remain ordinary field values.
 */
export function parseJsonContainerString(value: unknown): JsonContainer | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonContainer(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isCompleteJsonContainerString(value: string): boolean {
  return parseJsonContainerString(value) !== null;
}

/**
 * Produces a presentation/editing view without mutating captured fields. The
 * original encoded strings are retained privately so an unchanged edit can be
 * emitted byte-for-byte as it was captured.
 */
export function expandJsonStringFields(
  fields: Readonly<Record<string, JsonStringFieldValue>>
): ExpandedJsonStringFields {
  const expandedEntries: Array<readonly [string, ExpandedJsonStringFieldValue]> = [];
  const sources = new Map<string, EncodedSource>();
  const names = new Set<string>();

  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string") {
      expandedEntries.push([name, value]);
      continue;
    }
    const parsed = parseJsonContainerString(value);
    if (parsed === null) {
      expandedEntries.push([name, value]);
      continue;
    }
    names.add(name);
    sources.set(name, Object.freeze({ text: value, value: cloneAndFreezeJsonValue(parsed) }));
    expandedEntries.push([name, cloneAndFreezeJsonValue(parsed)]);
  }

  const result = Object.freeze({
    fields: Object.freeze(Object.fromEntries(expandedEntries)),
    encodedFieldNames: Object.freeze([...names])
  });
  encodedSources.set(result, sources);
  return result;
}

/**
 * Restores encoded containers to string fields for delivery. Passing editedFields
 * lets an editor replace immutable presentation values without mutating the
 * captured expansion. Structurally unchanged values retain their exact source
 * text, including whitespace and object-key order.
 */
export function serializeJsonStringFields(
  expansion: ExpandedJsonStringFields,
  editedFields: Readonly<Record<string, ExpandedJsonStringFieldValue>> = expansion.fields
): Readonly<Record<string, JsonStringFieldValue>> {
  const sources = encodedSources.get(expansion);
  const serializedEntries: Array<readonly [string, JsonStringFieldValue]> = [];

  for (const [name, value] of Object.entries(editedFields)) {
    if (!expansion.encodedFieldNames.includes(name)) {
      if (isJsonContainer(value)) {
        throw new TypeError(`Field "${name}" is not marked as an encoded JSON string.`);
      }
      serializedEntries.push([name, value]);
      continue;
    }

    if (!isJsonContainer(value)) {
      throw new TypeError(`Encoded JSON field "${name}" must remain a JSON object or array.`);
    }
    const source = sources?.get(name);
    if (source && jsonStructurallyEqual(source.value, value)) {
      serializedEntries.push([name, source.text]);
      continue;
    }
    serializedEntries.push([name, JSON.stringify(value)]);
  }

  return Object.freeze(Object.fromEntries(serializedEntries));
}

/** JSON objects ignore property insertion order; JSON arrays retain element order. */
export function jsonStructurallyEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonStructurallyEqual(value, right[index]!));
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && jsonStructurallyEqual(left[key], right[key]!));
  }
  return false;
}

/** Creates an immutable JSON snapshot without retaining mutable caller-owned containers. */
export function cloneAndFreezeJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezeJsonValue(entry))) as T;
  }
  if (isJsonObject(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJsonValue(entry)])
    )) as T;
  }
  return value;
}

function isJsonContainer(value: unknown): value is JsonContainer {
  return Array.isArray(value) || isJsonObject(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
