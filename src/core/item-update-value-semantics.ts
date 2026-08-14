import type { JsonPrimitive } from "../bridge/messages";
import type {
  EventUpdate,
  ItemUpdateFieldValueState,
  LightstreamerEventEnvelope
} from "./event-envelope";

export type ItemUpdateFieldCollection = "fields" | "changedFields";

export type InjectionSourceFieldExecutability =
  | Readonly<{
      field: string;
      classification: "executable";
      value: JsonPrimitive;
    }>
  | Readonly<{
      field: string;
      classification: "ambiguous";
      reason: "ambiguous-null";
    }>
  | Readonly<{
      field: string;
      classification: "replacement-required";
      reason: "redacted" | "unavailable" | "unresolved-wire-difference";
    }>;

export type ItemUpdateAssertionObservedValue =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "concrete"; value: JsonPrimitive }>
  | Readonly<{ state: "ambiguous"; reason: "ambiguous-null" }>
  | Readonly<{
      state: "unavailable";
      reason: "redacted" | "unavailable" | "unresolved-wire-difference";
    }>;

export type ItemUpdateAssertionValueResult = Readonly<{
  result: "equal" | "not-equal" | "not-evaluable";
  observed: ItemUpdateAssertionObservedValue;
  provenance: ItemUpdateAssertionValueProvenance;
}>;

export type ItemUpdateAssertionValueProvenance =
  | Readonly<{ source: "server"; observationPath: "listener" | "wire" }>
  | Readonly<{ source: "local"; requestId: string | null }>;

export function classifyInjectionSourceFieldExecutability(
  update: EventUpdate,
  collection: ItemUpdateFieldCollection = "fields"
): readonly InjectionSourceFieldExecutability[] {
  const { values, states } = fieldCollection(update, collection);
  const names = new Set([...Object.keys(values), ...Object.keys(states)]);
  return [...names].map((field) => {
    const observed = readObservedValue(values, states, field);
    switch (observed.state) {
      case "concrete":
        return { field, classification: "executable", value: observed.value };
      case "ambiguous":
        return { field, classification: "ambiguous", reason: observed.reason };
      case "unavailable":
        return {
          field,
          classification: "replacement-required",
          reason: observed.reason
        };
      case "missing":
        return { field, classification: "replacement-required", reason: "unavailable" };
    }
  });
}

export function evaluateItemUpdateAssertionValue(
  event: LightstreamerEventEnvelope,
  field: string,
  expected: JsonPrimitive,
  collection: ItemUpdateFieldCollection = "fields"
): ItemUpdateAssertionValueResult {
  const update = event.update ?? {};
  const { values, states } = fieldCollection(update, collection);
  const observed = readObservedValue(values, states, field);
  const provenance = assertionValueProvenance(event);
  if (observed.state === "missing") {
    return { result: "not-equal", observed, provenance };
  }
  if (observed.state !== "concrete") {
    return { result: "not-evaluable", observed, provenance };
  }
  return {
    result: observed.value === expected ? "equal" : "not-equal",
    observed,
    provenance
  };
}

function assertionValueProvenance(
  event: LightstreamerEventEnvelope
): ItemUpdateAssertionValueProvenance {
  if (event.source === "synthetic") {
    return {
      source: "local",
      requestId: typeof event.raw?.requestId === "string" ? event.raw.requestId : null
    };
  }
  return {
    source: "server",
    observationPath: event.captureSource === "wire" ? "wire" : "listener"
  };
}

function fieldCollection(
  update: EventUpdate,
  collection: ItemUpdateFieldCollection
): {
  values: Record<string, JsonPrimitive>;
  states: Record<string, ItemUpdateFieldValueState>;
} {
  return collection === "fields"
    ? {
        values: update.fields ?? {},
        states: update.fieldValueStates ?? {}
      }
    : {
        values: update.changedFields ?? {},
        states: update.changedFieldValueStates ?? {}
      };
}

function readObservedValue(
  values: Record<string, JsonPrimitive>,
  states: Record<string, ItemUpdateFieldValueState>,
  field: string
): ItemUpdateAssertionObservedValue {
  const hasValue = Object.prototype.hasOwnProperty.call(values, field);
  const state = states[field] ?? inferLegacyState(hasValue ? values[field] : undefined);
  if (!state) return { state: "missing" };
  if (state === "ambiguous-null") {
    return { state: "ambiguous", reason: state };
  }
  if (state !== "concrete") {
    return { state: "unavailable", reason: state };
  }
  return hasValue
    ? { state: "concrete", value: values[field] }
    : { state: "unavailable", reason: "unavailable" };
}

function inferLegacyState(
  value: JsonPrimitive | undefined
): ItemUpdateFieldValueState | undefined {
  if (value === undefined) return undefined;
  return value === null ? "ambiguous-null" : "concrete";
}
