import { parseJsonContainerString } from "../../core/json-string-fields";
import { type EventUpdate } from "../../core/event-envelope";

export type SelectedUpdateValue = Readonly<{
  name: string;
  display: string;
  /** The captured value was a string whose complete contents encode a JSON object or array. */
  jsonString: boolean;
}>;

export type SelectedUpdateSnapshot = Readonly<{
  fields: readonly SelectedUpdateValue[];
  changedFields: readonly SelectedUpdateValue[];
  jsonPatches: readonly SelectedUpdateValue[];
}>;

/**
 * Makes captured Item Update payloads legible without changing their evidence
 * semantics. Only complete object/array strings are decoded; scalar JSON and
 * malformed text remain visibly ordinary strings.
 */
export function selectedUpdateSnapshot(update: EventUpdate | undefined): SelectedUpdateSnapshot | null {
  if (!update) return null;
  return Object.freeze({
    fields: displayEntries(update.fields),
    changedFields: displayEntries(update.changedFields),
    jsonPatches: displayEntries(update.jsonPatches)
  });
}

function displayEntries(entries: Readonly<Record<string, unknown>> | undefined): readonly SelectedUpdateValue[] {
  if (!entries) return Object.freeze([]);
  return Object.freeze(Object.entries(entries).map(([name, value]) => {
    const parsed = parseJsonContainerString(value);
    return Object.freeze({
      name,
      display: parsed === null ? displayValue(value) : JSON.stringify(parsed, null, 2),
      jsonString: parsed !== null
    });
  }));
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
