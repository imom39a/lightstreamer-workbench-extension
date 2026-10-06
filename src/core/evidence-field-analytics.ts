import { containsCredentialJson, isCredentialFieldName } from "./credential-field";
import type { LightstreamerEventEnvelope, ItemUpdateFieldValueState } from "./event-envelope";
export type EvidenceFieldScalar = string | number | boolean | null;
export type EvidenceFieldPredicate = Readonly<{ field: string } & (
  | { op: "eq"; value: EvidenceFieldScalar }
  | { op: "in"; values: readonly EvidenceFieldScalar[] }
  | { op: "exists"; present?: boolean }
  | { op: "value-state"; state: ItemUpdateFieldValueState }
  | { op: "changed"; changed?: boolean }
  | { op: "range"; type: "string" | "number"; convert?: "number-string"; min?: string | number; max?: string | number }
)>;
export type EvidenceAggregateRequest = Readonly<{ unit: "evidence-records" | "distinct-logical-updates"; groupBy?: readonly string[]; timeBucketMs?: number; maxGroups?: number }>;
export type EvidenceAggregateField = Readonly<{ field: string; state: ItemUpdateFieldValueState; value?: EvidenceFieldScalar }>;
export type EvidenceAggregateResult = Readonly<{ unit: EvidenceAggregateRequest["unit"]; count: number; matchingEvidenceRecords: number; missingLogicalIds: number; groups: readonly Readonly<{ values: readonly EvidenceAggregateField[]; bucketStart?: number; count: number }>[]; omittedGroups: number; omittedGroupRecords: number }>;
export type EvidenceFieldEvaluation = Readonly<{ numericConversionFailures: number; unavailableFields: number }>;
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export function readEvidenceField(event: LightstreamerEventEnvelope, field: string): EvidenceAggregateField {
  const declared = [...(event.subscription?.fields ?? []), ...(event.subscription?.commandSecondLevelFields ?? [])];
  if (event.kind !== "item-update" || !declared.includes(field) || !event.update?.fields || !has(event.update.fields, field)) return { field, state: "unavailable" };
  if (isCredentialFieldName(field)) return { field, state: "redacted" };
  const value = event.update.fields[field];
  if (typeof value === "string" && containsCredentialJson(value)) return { field, state: "redacted" };
  const state = event.update.fieldValueStates?.[field] ?? (value === null && event.source === "server" ? "ambiguous-null" : "concrete");
  return { field, state, ...(state === "concrete" ? { value } : {}) };
}
export function validateEvidenceFieldQuery(predicates?: readonly EvidenceFieldPredicate[], aggregate?: EvidenceAggregateRequest): void {
  const field = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
  const scalar = (value: unknown) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
  if (predicates && (!Array.isArray(predicates) || predicates.length > 32)) throw new Error("At most 32 field predicates are supported.");
  for (const predicate of predicates ?? []) {
    if (!field(predicate.field) || !["eq", "in", "exists", "value-state", "changed", "range"].includes(predicate.op)) throw new Error("Invalid exact declared field predicate.");
    if (predicate.op === "eq" && !scalar(predicate.value)) throw new Error("Field equality requires a primitive value.");
    if (predicate.op === "in" && (!Array.isArray(predicate.values) || !predicate.values.length || predicate.values.length > 32 || !predicate.values.every(scalar))) throw new Error("Field membership requires 1..32 primitive values.");
    if (predicate.op === "range" && (!["string", "number"].includes(predicate.type) || (predicate.convert !== undefined && (predicate.type !== "number" || predicate.convert !== "number-string"))
      || (predicate.min === undefined && predicate.max === undefined) || [predicate.min, predicate.max].some(value => value !== undefined && (typeof value !== predicate.type || (typeof value === "number" && !Number.isFinite(value)))))) throw new Error("Ranges require explicit string/number bounds and explicit numeric-string conversion.");
    if (predicate.op === "value-state" && !["concrete", "ambiguous-null", "unavailable", "redacted", "unresolved-wire-difference"].includes(predicate.state)) throw new Error("Invalid field value state.");
    if (predicate.op === "exists" && predicate.present !== undefined && typeof predicate.present !== "boolean") throw new Error("Existence requires a boolean.");
    if (predicate.op === "changed" && predicate.changed !== undefined && typeof predicate.changed !== "boolean") throw new Error("Changed membership requires a boolean.");
  }
  if (aggregate && (!['evidence-records', 'distinct-logical-updates'].includes(aggregate.unit) || (aggregate.groupBy && (aggregate.groupBy.length < 1 || aggregate.groupBy.length > 4 || !aggregate.groupBy.every(field) || new Set(aggregate.groupBy).size !== aggregate.groupBy.length))
    || (aggregate.maxGroups !== undefined && (!Number.isSafeInteger(aggregate.maxGroups) || aggregate.maxGroups < 1 || aggregate.maxGroups > 100)) || (aggregate.timeBucketMs !== undefined && (!Number.isSafeInteger(aggregate.timeBucketMs) || aggregate.timeBucketMs < 1 || aggregate.timeBucketMs > 86400000)))) throw new Error("Invalid bounded field aggregate.");
}
/** One query-local evaluation/aggregation, bounded by canonical work and retention limits. */
export function createEvidenceFieldQuery(predicates?: readonly EvidenceFieldPredicate[], request?: EvidenceAggregateRequest) {
  validateEvidenceFieldQuery(predicates, request);
  const seen = new Map<number, boolean>(), logicalIds = new Set<string>(), omitted = new Set<string>();
  const groups = new Map<string, { values: EvidenceAggregateField[]; bucketStart?: number; count: number }>();
  let numericConversionFailures = 0, unavailableFields = 0, matchingEvidenceRecords = 0, missingLogicalIds = 0, count = 0, omittedGroupRecords = 0;
  const active = Boolean(predicates?.length || request);
  function matches(sequence: number, event: LightstreamerEventEnvelope, inScope = true): boolean {
    if (seen.has(sequence)) return seen.get(sequence)!;
    let result = true;
    for (const predicate of predicates ?? []) {
      const field = readEvidenceField(event, predicate.field);
      if (field.state === "unavailable") unavailableFields++;
      let matched = false;
      if (predicate.op === "exists") matched = (field.state !== "unavailable") === (predicate.present ?? true);
      else if (predicate.op === "value-state") matched = field.state === predicate.state;
      else if (predicate.op === "changed") matched = field.state !== "unavailable" && Boolean(event.update?.changedFields && has(event.update.changedFields, predicate.field)) === (predicate.changed ?? true);
      else if (field.state === "concrete") {
        if (predicate.op === "eq") matched = field.value === predicate.value;
        else if (predicate.op === "in") matched = predicate.values.some(value => value === field.value);
        else if (predicate.op === "range") {
          let value = field.value;
          if (predicate.type === "number" && typeof value === "string" && predicate.convert === "number-string") {
            const converted = value.trim() !== "" ? Number(value) : NaN;
            if (!Number.isFinite(converted)) numericConversionFailures++; else value = converted;
          }
          if (predicate.type === "number" && typeof value === "number") matched = (predicate.min === undefined || value >= (predicate.min as number)) && (predicate.max === undefined || value <= (predicate.max as number));
          if (predicate.type === "string" && typeof value === "string") matched = (predicate.min === undefined || value >= (predicate.min as string)) && (predicate.max === undefined || value <= (predicate.max as string));
        }
      }
      result &&= matched;
    }
    seen.set(sequence, result);
    if (!result || !request || !inScope) return result;
    matchingEvidenceRecords++;
    if (request.unit === "distinct-logical-updates") {
      if (event.kind !== "item-update") return result;
      if (!event.logicalEventId) { missingLogicalIds++; return result; }
      const logicalId = JSON.stringify([event.client?.id, event.client?.sessionId, event.subscription?.id, event.logicalEventId]);
      if (logicalIds.has(logicalId)) return result;
      logicalIds.add(logicalId);
    }
    count++;
    const values = (request.groupBy ?? []).map(field => readEvidenceField(event, field));
    const bucketStart = request.timeBucketMs ? Math.floor(event.timestamp / request.timeBucketMs) * request.timeBucketMs : undefined;
    const key = JSON.stringify([values, bucketStart]);
    let group = groups.get(key);
    if (!group && groups.size >= (request.maxGroups ?? 25)) {
      const largest = [...groups.keys()].sort().at(-1)!;
      if (key < largest) {
        omitted.add(largest);
        omittedGroupRecords += groups.get(largest)!.count;
        groups.delete(largest);
      }
    }
    if (!group && groups.size < (request.maxGroups ?? 25)) { group = { values, ...(bucketStart === undefined ? {} : { bucketStart }), count: 0 }; groups.set(key, group); }
    if (group) group.count++; else { omitted.add(key); omittedGroupRecords++; }
    return result;
  }
  return { active, matches, result: () => ({ fieldEvaluation: { numericConversionFailures, unavailableFields } as EvidenceFieldEvaluation,
    ...(request ? { aggregate: { unit: request.unit, count, matchingEvidenceRecords, missingLogicalIds, groups: [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => group), omittedGroups: omitted.size, omittedGroupRecords } as EvidenceAggregateResult } : {}) }) };
}
