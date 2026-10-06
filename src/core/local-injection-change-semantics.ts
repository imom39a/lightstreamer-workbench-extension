import type { ItemUpdateFieldValueState } from "./event-envelope";
import type { DraftFields, ReinjectionDraft } from "./reinjection-draft";

/** A baseline is supplied by the exact target projection or a preceding reviewed Step,
 * never by the immutable Source or an initial empty authoring document. */
export type NativeChangeBaseline = Readonly<{
  fields: Readonly<DraftFields>;
  fieldValueStates: Readonly<Record<string, ItemUpdateFieldValueState>>;
  basis: string;
}>;

export type NativeChangeContext = Readonly<{
  baseline?: NativeChangeBaseline | null;
  firstUpdate?: boolean;
  secondLevelFields?: readonly string[];
}>;

export type NativeChangeSemantics = Readonly<{
  version: 1;
  policy: "captured-bitmap" | "native-mode";
  basis: string;
  limitations: readonly string[];
  refusal?: string;
}>;

export type NativeReviewedChangeFacts = Readonly<{
  context: NativeChangeContext;
  fields: Readonly<DraftFields>;
  fieldValueStates: Readonly<Record<string, ItemUpdateFieldValueState>>;
  changedFields: Readonly<DraftFields>;
  semantics: NativeChangeSemantics;
}>;

export function draftFieldsMatchSource(draft: ReinjectionDraft): boolean {
  const names = Object.keys(draft.fields);
  return draft.command === draft.sourceCommand && draft.key === draft.sourceKey && draft.isSnapshot === draft.sourceIsSnapshot
    && names.length === Object.keys(draft.sourceFields).length
    && names.every(name => Object.hasOwn(draft.sourceFields, name) && Object.is(draft.fields[name], draft.sourceFields[name]));
}

/** Official ItemUpdate semantics. This does not modify the immutable captured Source. */
export function deriveNativeDraftChanges(draft: ReinjectionDraft, context: NativeChangeContext = {}): ReinjectionDraft {
  const limitations = ["JSON Patch callback fidelity is unavailable; Local Injection delivers complete field values."];
  if (draft.captureSource === "wire") limitations.push("Wire delivery submits complete values; the official client derives its own bitmap from its internal baseline.");
  if (draft.provenance.source === "clone" && draftFieldsMatchSource(draft)) {
    return { ...draft, changedFields: { ...draft.originalChangedFields }, changeSemantics: {
      version: 1, policy: "captured-bitmap", basis: draft.sourceEventId, limitations
    } };
  }
  const semantics = (basis: string, refusal?: string): NativeChangeSemantics => ({
    version: 1, policy: "native-mode", basis, limitations, ...(refusal ? { refusal } : {})
  });
  const refuse = (reason: string): ReinjectionDraft => ({ ...draft, changedFields: {}, changeSemantics: semantics("unavailable", reason) });
  const mode = draft.subscriptionMode;
  if (!["COMMAND", "MERGE", "DISTINCT"].includes(mode ?? "")) return refuse("Native changed-field derivation requires a supported Subscription mode.");
  if (context.secondLevelFields?.length || draft.sourceSubscription?.commandSecondLevelFields?.length || draft.sourceSubscription?.commandSecondLevelFieldSchema) return refuse("Generated second-level COMMAND updates require a modeled first/second-level delivery boundary.");
  if (mode === "COMMAND" && draft.command === "ADD") {
    return { ...draft, changedFields: { ...draft.fields }, changeSemantics: semantics("COMMAND ADD establishes every field") };
  }
  if (mode === "COMMAND" && draft.command === "DELETE") {
    // The official client retains command/key and clears every other value.
    const fields = Object.fromEntries(Object.entries(draft.fields).map(([field, value]) => [field, field === "key" || field === "command" ? value : null])) as DraftFields;
    const changedFields = Object.fromEntries(Object.keys(fields).filter(field => field !== "key").map(field => [field, fields[field]!])) as DraftFields;
    return { ...draft, fields, changedFields, fieldValueStates: Object.fromEntries(Object.keys(fields).map(field => [field, "concrete" as const])), changeSemantics: semantics("COMMAND DELETE clears non-key fields") };
  }
  if (mode === "COMMAND" && draft.command !== "UPDATE") return refuse("Native COMMAND changes require ADD, UPDATE or DELETE.");
  if (mode !== "COMMAND" && context.firstUpdate) {
    return { ...draft, changedFields: { ...draft.fields }, changeSemantics: semantics("first Item Update") };
  }
  const baseline = context.baseline;
  if (!baseline) return refuse("Native changed-field derivation requires a complete concrete baseline for this exact item/key.");
  if (mode === "COMMAND" && baseline.fields.key !== draft.key) return refuse("Native COMMAND baseline belongs to a different key.");
  const names = Object.keys(draft.fields);
  if (names.some(field => !Object.hasOwn(baseline.fields, field) || baseline.fieldValueStates[field] !== "concrete")) {
    return refuse("Native changed-field baseline contains absent, ambiguous, redacted or unavailable fields.");
  }
  const changedFields = Object.fromEntries(names.filter(field => !Object.is(baseline.fields[field], draft.fields[field])).map(field => [field, draft.fields[field]!])) as DraftFields;
  return { ...draft, changedFields, changeSemantics: semantics(baseline.basis) };
}

/** Advance a sequence baseline using the values actually delivered, including DELETE clearing. */
export function nativeBaselineFromDraft(draft: ReinjectionDraft, basis: string): NativeChangeBaseline {
  return { fields: { ...draft.fields }, fieldValueStates: { ...draft.fieldValueStates }, basis };
}
