import { parseJsonContainerString } from "../../core/json-string-fields";
import { type EventUpdate, type ItemUpdateFieldValueState } from "../../core/event-envelope";

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

const VALUE_LIMITATIONS: Readonly<Record<Exclude<ItemUpdateFieldValueState, "concrete">, string>> = Object.freeze({
  "ambiguous-null": "Ambiguous null; the field value is not proven.",
  redacted: "Value redacted.",
  unavailable: "Value unavailable.",
  "unresolved-wire-difference": "Wire difference unresolved; the field value is not proven."
});

/**
 * Makes captured Item Update payloads legible without changing their evidence
 * semantics. Only complete object/array strings are decoded; scalar JSON and
 * malformed text remain visibly ordinary strings.
 */
export function selectedUpdateSnapshot(update: EventUpdate | undefined): SelectedUpdateSnapshot | null {
  if (!update) return null;
  return Object.freeze({
    fields: displayEntries(update.fields, update.fieldValueStates),
    changedFields: displayEntries(update.changedFields, update.changedFieldValueStates),
    jsonPatches: displayEntries(update.jsonPatches)
  });
}

function displayEntries(entries: Readonly<Record<string, unknown>> | undefined, states?: Readonly<Record<string, ItemUpdateFieldValueState>>): readonly SelectedUpdateValue[] {
  const names = new Set([...Object.keys(entries ?? {}), ...Object.keys(states ?? {})]);
  return Object.freeze([...names].map(name => {
    const value = entries?.[name];
    const state = states && Object.hasOwn(states, name) ? states[name] : undefined;
    if (state && state !== "concrete") return Object.freeze({ name, display: VALUE_LIMITATIONS[state], jsonString: false });
    if (states && !Object.hasOwn(entries ?? {}, name)) return Object.freeze({ name, display: "Value unavailable.", jsonString: false });
    const parsed = parseJsonContainerString(value);
    return Object.freeze({
      name,
      display: parsed === null ? displayValue(value) : formatEncodedJson(value as string),
      jsonString: parsed !== null
    });
  }));
}

/** Format source tokens without converting numbers, escaped names, or duplicate properties. */
function formatEncodedJson(source: string): string {
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
  const output: string[] = [];
  let depth = 0;
  const newline = () => output.push(`\n${"  ".repeat(depth)}`);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "{" || token === "[") {
      output.push(token);
      if (tokens[i + 1] === (token === "{" ? "}" : "]")) { output.push(tokens[++i]!); continue; }
      if (++depth > 64) return source;
      newline();
    } else if (token === "}" || token === "]") {
      depth--; newline(); output.push(token);
    } else if (token === ",") { output.push(token); newline(); }
    else if (token === ":") output.push(": ");
    else output.push(token);
  }
  return output.join("");
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
