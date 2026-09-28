import type { DeterministicEvidenceRecord, EvidenceIdentity, EvidenceReadPoint, TypedFacetValue } from "../../core/evidence-filter-contract";
import { classifyInjectionSourceFieldExecutability } from "../../core/item-update-value-semantics";
import type { EventUpdate, ItemUpdateFieldValueState, LightstreamerEventEnvelope } from "../../core/event-envelope";

/** Hard limits keep discovery useful on large retained histories and hostile payloads. */
export const AGENT_STREAM_DISCOVERY_LIMITS = Object.freeze({
  records: 2_000,
  streams: 16,
  fieldsPerStream: 24,
  examplesPerStream: 12,
  jsonBytes: 16 * 1024,
  jsonDepth: 4,
  jsonNodes: 128,
  jsonParseBytes: 512 * 1024,
  jsonShapesPerField: 2,
  fieldNameBytes: 160,
  shapeBytes: 256,
  streamNameBytes: 160,
  identityBytes: 4_096,
  orientationValuesPerFacet: 8,
  orientationValueBytes: 64
});

/** Declarations are keyed by the canonical Subscription facet identity. */
export type DeclaredSubscriptionFields = Readonly<{ subscriptionIdentity: string; fields: readonly string[] }>;
export type AgentStreamDescriptionInput = Readonly<{
  /** Credential-safe semantic records from agent-service; raw/searchText/summary are ignored. */
  records: readonly DeterministicEvidenceRecord[];
  declaredFields?: readonly DeclaredSubscriptionFields[];
  limit?: number;
  readPoint?: EvidenceReadPoint;
  window?: "OLDEST_FIRST" | "NEWEST_FIRST" | "INPUT_ORDER";
  completeness?: "COMPLETE" | "LIMITED";
}>;

export type AgentStreamDescription = Readonly<{
  readPoint: EvidenceReadPoint | null;
  completeness: "COMPLETE" | "LIMITED";
  sample: Readonly<{ evidenceRecords: number; requestedLimit: number; window: "OLDEST_FIRST" | "NEWEST_FIRST" | "INPUT_ORDER"; capped: boolean }>;
  totals: Readonly<{ evidenceRecords: number; itemUpdateEvidenceRecords: number; identifiedLogicalUpdates: number; unidentifiedLogicalUpdateDeliveries: number }>;
  profileOmissions: Readonly<{ evidenceRecords: number; streams: number; identities: number; fields: number; oversizedIdentifiers: number; jsonShapes: number; orientationValues: number; examples: number; countsMayBeLowerBounds: true }>;
  streams: readonly Readonly<{
    scopeIdentity: string;
    subscriptionIdentity: string;
    subscriptionId: string;
    item: string | null;
    itemPosition: number | null;
    modes: readonly string[];
    provenances: readonly string[];
    phases: readonly string[];
    declaredFields: readonly string[];
    observedFields: readonly Readonly<{ name: string; types: readonly string[]; states: readonly string[]; jsonShapes: readonly string[] }>[];
    evidenceRecords: number;
    itemUpdateEvidenceRecords: number;
    identifiedLogicalUpdates: number;
    unidentifiedLogicalUpdateDeliveries: number;
    examples: readonly Readonly<{ identity: EvidenceIdentity; kind: string; operation: string | null; shape: string }>[];
  }>[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;
type Omissions = { evidenceRecords: number; streams: number; identities: number; fields: number; oversizedIdentifiers: number; jsonShapes: number; orientationValues: number; examples: number; countsMayBeLowerBounds: true };
const freshOmissions = (): Omissions => ({ evidenceRecords: 0, streams: 0, identities: 0, fields: 0, oversizedIdentifiers: 0, jsonShapes: 0, orientationValues: 0, examples: 0, countsMayBeLowerBounds: true });

/**
 * Summarize a bounded input page. Evidence counts describe only the sampled
 * records. Omission counts are lower bounds after a bounded scan stops.
 * Item-update Evidence records are Update Deliveries. Logical Updates
 * are counted only by distinct captured IDs within their canonical stream scope;
 * delivery records without an ID remain unidentified deliveries.
 */
export function describeAgentStreams(input: AgentStreamDescriptionInput): AgentStreamDescription {
  const rawLimit = input.limit ?? AGENT_STREAM_DISCOVERY_LIMITS.records;
  const requestedLimit = Number.isFinite(rawLimit) ? Math.max(0, Math.min(AGENT_STREAM_DISCOVERY_LIMITS.records, Math.floor(rawLimit))) : AGENT_STREAM_DISCOVERY_LIMITS.records;
  const omissions = freshOmissions();
  const records = input.records.slice(0, requestedLimit);
  omissions.evidenceRecords = Math.max(0, input.records.length - records.length);
  const declarations = new Map<string, Set<string>>();
  const declarationLimit = Math.min(input.declaredFields?.length ?? 0, AGENT_STREAM_DISCOVERY_LIMITS.streams);
  omissions.streams += Math.max(0, (input.declaredFields?.length ?? 0) - declarationLimit);
  for (const declaration of (input.declaredFields ?? []).slice(0, declarationLimit)) {
    if (!declaration || typeof declaration.subscriptionIdentity !== "string") continue;
    if (!boundedIdentity(declaration.subscriptionIdentity)) { omissions.identities++; continue; }
    const target = declarations.get(declaration.subscriptionIdentity) ?? new Set<string>();
    addDeclaredFields(target, declaration.fields, omissions);
    declarations.set(declaration.subscriptionIdentity, target);
  }

  const groups = new Map<string, MutableStream>();
  const jsonBudget = { remainingBytes: AGENT_STREAM_DISCOVERY_LIMITS.jsonParseBytes };
  let itemUpdateEvidenceRecords = 0;
  let unidentifiedLogicalUpdateDeliveries = 0;
  const logicalIds = new Set<string>();
  for (const record of records) {
    const envelope = isRecord(record.payload) ? record.payload as unknown as LightstreamerEventEnvelope : null;
    if (!envelope) continue;
    const subscriptionId = typeof envelope.subscription?.id === "string" ? envelope.subscription.id : "(unknown subscription)";
    const item = typeof envelope.item?.name === "string" ? envelope.item.name : null;
    const itemPosition = typeof envelope.item?.position === "number" ? envelope.item.position : null;
    const identity = streamIdentity(record, envelope, item, itemPosition);
    if (!identity) { omissions.identities++; omissions.streams++; continue; }
    const { subscriptionIdentity, scopeIdentity } = identity;
    let group = groups.get(scopeIdentity);
    if (!group) {
      if (groups.size >= AGENT_STREAM_DISCOVERY_LIMITS.streams) { omissions.streams++; continue; }
      group = { scopeIdentity, subscriptionIdentity, subscriptionId, item, itemPosition, modes: new Set(), provenances: new Set(), phases: new Set(), count: 0, updateCount: 0, logicalIds: new Set(), unidentified: 0, declaredFields: new Set(declarations.get(subscriptionIdentity) ?? []), fields: new Map(), examples: [], exampleKeys: new Set() };
      groups.set(scopeIdentity, group);
    }
    group.count++;
    collectOrientation(group.modes, record.facets.mode, "mode", omissions);
    collectOrientation(group.provenances, record.facets.provenance, "provenance", omissions);
    collectOrientation(group.phases, record.facets.phase, "phase", omissions);
    addDeclaredFields(group.declaredFields, envelope.subscription?.fields, omissions);

    const update = envelope.update;
    const fieldValues = boundedEntries(update?.fields, omissions);
    const changedValues = boundedEntries(update?.changedFields, omissions);
    const values = new Map(fieldValues);
    for (const [name, value] of changedValues) values.set(name, value);
    const fieldStates = classifiedStates(update, "fields", fieldValues, envelope.synthetic === true, omissions);
    const changedStates = classifiedStates(update, "changedFields", changedValues, envelope.synthetic === true, omissions);
    const states = new Map(fieldStates);
    for (const [name, state] of changedStates) states.set(name, state);
    const profiles = new Map<string, ProfileValue>();
    for (const [name, value] of values) if (states.get(name) === "concrete") profiles.set(name, profileValue(value, jsonBudget));
    const operation = typeof update?.command === "string" ? update.command.slice(0, 64) : null;
    const shape = shapeSignature(values, states, profiles, omissions);
    const exampleKey = JSON.stringify([envelope.kind, operation, shape]);
    if (!group.exampleKeys.has(exampleKey)) {
      if (group.examples.length < AGENT_STREAM_DISCOVERY_LIMITS.records) {
        group.exampleKeys.add(exampleKey);
        group.examples.push({ identity: record.identity, kind: envelope.kind, operation, shape });
      } else omissions.examples++;
    }
    if (envelope.kind !== "item-update" || !update) continue;
    itemUpdateEvidenceRecords++;
    group.updateCount++;
    if (typeof envelope.logicalEventId === "string" && envelope.logicalEventId.length) {
      const scopedId = JSON.stringify([scopeIdentity, envelope.logicalEventId]);
      logicalIds.add(scopedId);
      group.logicalIds.add(envelope.logicalEventId);
    } else {
      unidentifiedLogicalUpdateDeliveries++;
      group.unidentified++;
    }

    for (const [name, value] of values) {
      const state = states.get(name) ?? "unavailable";
      addObservedField(group, name, value, state, profiles.get(name), omissions);
    }
    for (const [name, state] of states) if (!values.has(name)) addObservedField(group, name, undefined, state, undefined, omissions);
  }

  const streams = [...groups.values()].sort((a, b) => a.scopeIdentity.localeCompare(b.scopeIdentity)).map(group => ({
    scopeIdentity: group.scopeIdentity,
    subscriptionIdentity: group.subscriptionIdentity,
    subscriptionId: boundedLabel(group.subscriptionId, AGENT_STREAM_DISCOVERY_LIMITS.streamNameBytes, omissions),
    item: group.item === null ? null : boundedLabel(group.item, AGENT_STREAM_DISCOVERY_LIMITS.streamNameBytes, omissions),
    itemPosition: group.itemPosition,
    modes: [...group.modes].sort(),
    provenances: [...group.provenances].sort(),
    phases: [...group.phases].sort(),
    declaredFields: [...group.declaredFields].sort().slice(0, AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream),
    observedFields: [...group.fields.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream).map(([name, field]) => ({ name, types: [...field.types].sort(), states: [...field.states].sort(), jsonShapes: [...field.shapes].sort() })),
    evidenceRecords: group.count,
    itemUpdateEvidenceRecords: group.updateCount,
    identifiedLogicalUpdates: group.logicalIds.size,
    unidentifiedLogicalUpdateDeliveries: group.unidentified,
    examples: selectExamples(group.examples, omissions)
  }));
  // Declared and observed field lists are both output-limited.
  for (const group of groups.values()) {
    omissions.fields += Math.max(0, group.declaredFields.size - AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream);
    omissions.fields += Math.max(0, group.fields.size - AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream);
  }
  const capped = [omissions.evidenceRecords, omissions.streams, omissions.identities, omissions.fields, omissions.oversizedIdentifiers, omissions.jsonShapes, omissions.orientationValues, omissions.examples].some(count => count > 0);
  return {
    readPoint: input.readPoint ?? null,
    completeness: input.completeness === "COMPLETE" && !capped ? "COMPLETE" : "LIMITED",
    sample: { evidenceRecords: records.length, requestedLimit, window: input.window ?? "INPUT_ORDER", capped },
    totals: { evidenceRecords: records.length, itemUpdateEvidenceRecords, identifiedLogicalUpdates: logicalIds.size, unidentifiedLogicalUpdateDeliveries },
    profileOmissions: omissions,
    streams
  };
}

type MutableStream = { scopeIdentity: string; subscriptionIdentity: string; subscriptionId: string; item: string | null; itemPosition: number | null; modes: Set<string>; provenances: Set<string>; phases: Set<string>; count: number; updateCount: number; logicalIds: Set<string>; unidentified: number; declaredFields: Set<string>; fields: Map<string, { types: Set<string>; states: Set<string>; shapes: Set<string> }>; examples: { identity: EvidenceIdentity; kind: string; operation: string | null; shape: string }[]; exampleKeys: Set<string> };

function boundedIdentity(value: string): boolean {
  // Avoid asking TextEncoder to allocate for obviously oversized identifiers.
  return value.length <= AGENT_STREAM_DISCOVERY_LIMITS.identityBytes && utf8Length(value) <= AGENT_STREAM_DISCOVERY_LIMITS.identityBytes;
}
function streamIdentity(record: DeterministicEvidenceRecord, event: LightstreamerEventEnvelope, item: string | null, itemPosition: number | null): { subscriptionIdentity: string; scopeIdentity: string } | null {
  const pageId = record.identity.pageId;
  const clientId = event.client?.id ?? null;
  const sessionId = event.client?.sessionId ?? null;
  const subscriptionId = event.subscription?.id ?? null;
  if ([pageId, clientId, sessionId, subscriptionId, item].some(part => part !== null && !boundedIdentity(part))) return null;
  const suppliedSubscriptionIdentity = record.facets.subscription?.identity;
  if (suppliedSubscriptionIdentity !== undefined && !boundedIdentity(suppliedSubscriptionIdentity)) return null;
  const subscriptionIdentity = suppliedSubscriptionIdentity ?? JSON.stringify(["agent-subscription-v1", pageId, clientId, sessionId, subscriptionId]);
  if (!boundedIdentity(subscriptionIdentity)) return null;
  const suppliedItemIdentity = record.facets.item?.identity;
  if (suppliedItemIdentity !== undefined && !boundedIdentity(suppliedItemIdentity)) return null;
  const itemIdentity = suppliedItemIdentity ?? JSON.stringify(["agent-item-v1", subscriptionIdentity, item, itemPosition]);
  if (!boundedIdentity(itemIdentity)) return null;
  const scopeIdentity = JSON.stringify(["agent-stream-v1", subscriptionIdentity, itemIdentity]);
  return boundedIdentity(scopeIdentity) ? { subscriptionIdentity, scopeIdentity } : null;
}
function collectOrientation(target: Set<string>, facet: TypedFacetValue | undefined, expectedName: string, omissions: Omissions): void {
  if (!facet || facet.facet !== expectedName || facet.type !== "enum" || typeof facet.value !== "string") return;
  if (!boundedOrientationValue(facet.value)) { omissions.orientationValues++; return; }
  if (!target.has(facet.value) && target.size >= AGENT_STREAM_DISCOVERY_LIMITS.orientationValuesPerFacet) { omissions.orientationValues++; return; }
  target.add(facet.value);
}
function boundedOrientationValue(value: string): boolean {
  return value.length <= AGENT_STREAM_DISCOVERY_LIMITS.orientationValueBytes && utf8Length(value) <= AGENT_STREAM_DISCOVERY_LIMITS.orientationValueBytes;
}
function boundedLabel(value: string, bytes: number, omissions: Omissions): string {
  if (utf8Length(value) <= bytes) return value;
  omissions.oversizedIdentifiers++;
  return "(oversized identifier omitted)";
}
function safeName(value: string): boolean { return value.length > 0 && utf8Length(value) <= AGENT_STREAM_DISCOVERY_LIMITS.fieldNameBytes; }
function addDeclaredFields(target: Set<string>, source: unknown, omissions: Omissions): void {
  if (!Array.isArray(source)) return;
  let visited = 0;
  for (const field of source) {
    if (visited++ >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; break; }
    if (typeof field !== "string") continue;
    if (!safeName(field)) { omissions.oversizedIdentifiers++; continue; }
    if (!target.has(field) && target.size >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; continue; }
    target.add(field);
  }
}
function boundedEntries(source: unknown, omissions: Omissions): Map<string, unknown> {
  const target = new Map<string, unknown>();
  if (!isRecord(source)) return target;
  let visited = 0;
  for (const name in source) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    if (visited++ >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; break; }
    if (!safeName(name)) { omissions.oversizedIdentifiers++; continue; }
    if (!target.has(name) && target.size >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; continue; }
    target.set(name, source[name]);
  }
  return target;
}
function boundedStates(source: unknown, omissions: Omissions): Map<string, ItemUpdateFieldValueState> {
  const target = new Map<string, ItemUpdateFieldValueState>();
  if (!isRecord(source)) return target;
  let visited = 0;
  for (const name in source) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    if (visited++ >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; break; }
    const state = source[name];
    if (!safeName(name)) { omissions.oversizedIdentifiers++; continue; }
    if (!target.has(name) && target.size >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; continue; }
    if (typeof state === "string") target.set(name, state as ItemUpdateFieldValueState);
  }
  return target;
}
function classifiedStates(update: EventUpdate | undefined, collection: "fields" | "changedFields", values: Map<string, unknown>, synthetic: boolean, omissions: Omissions): Map<string, ItemUpdateFieldValueState> {
  const explicitSource = collection === "fields" ? update?.fieldValueStates : update?.changedFieldValueStates;
  const explicit = boundedStates(explicitSource, omissions);
  for (const [name, value] of values) if (!explicit.has(name) && value === null) explicit.set(name, synthetic ? "concrete" : "ambiguous-null");
  const boundedValues = Object.fromEntries(values);
  const boundedStateObject = Object.fromEntries(explicit);
  const classification = classifyInjectionSourceFieldExecutability(collection === "fields"
    ? { fields: boundedValues as EventUpdate["fields"], fieldValueStates: boundedStateObject as EventUpdate["fieldValueStates"] }
    : { changedFields: boundedValues as EventUpdate["changedFields"], changedFieldValueStates: boundedStateObject as EventUpdate["changedFieldValueStates"] }, collection);
  return new Map(classification.map(entry => [entry.field, entry.classification === "executable" ? "concrete" : entry.classification === "ambiguous" ? "ambiguous-null" : entry.reason]));
}
type ProfileValue = { type: string; shape: string | null; shapeOmitted: boolean };
function addObservedField(group: MutableStream, name: string, value: unknown, state: ItemUpdateFieldValueState, profile: ProfileValue | undefined, omissions: Omissions): void {
  if (!safeName(name)) { omissions.oversizedIdentifiers++; return; }
  let field = group.fields.get(name);
  if (!field) {
    if (group.fields.size >= AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream) { omissions.fields++; return; }
    field = { types: new Set<string>(), states: new Set<string>(), shapes: new Set<string>() };
    group.fields.set(name, field);
  }
  field.states.add(state);
  if (state !== "concrete" || value === undefined) return;
  if (!profile) return;
  field.types.add(profile.type);
  if (profile.shape) {
    if (field.shapes.has(profile.shape)) return;
    if (field.shapes.size >= AGENT_STREAM_DISCOVERY_LIMITS.jsonShapesPerField) { omissions.jsonShapes++; return; }
    field.shapes.add(profile.shape);
  }
}
function shapeSignature(values: Map<string, unknown>, states: Map<string, ItemUpdateFieldValueState>, profiles: Map<string, ProfileValue>, omissions: Omissions): string {
  const parts: string[] = [];
  for (const [name, value] of values) {
    const state = states.get(name) ?? "unavailable";
    if (state !== "concrete") { parts.push(`${name}:${state}`); continue; }
    const profile = profiles.get(name);
    if (!profile) { parts.push(`${name}:string`); continue; }
    if (profile.shapeOmitted) omissions.jsonShapes++;
    parts.push(`${name}:${profile.type}${profile.shape ? `=${profile.shape}` : ""}`);
  }
  const signature = parts.sort().join(",");
  const bounded = boundedShape(signature);
  if (bounded.truncated) omissions.jsonShapes++;
  return bounded.value;
}
function selectExamples(candidates: MutableStream["examples"], omissions: Omissions): MutableStream["examples"] {
  const remaining = candidates.slice();
  const selected: MutableStream["examples"] = [];
  const addFirst = (predicate: (candidate: MutableStream["examples"][number]) => boolean) => {
    const index = remaining.findIndex(predicate);
    if (index >= 0) selected.push(...remaining.splice(index, 1));
  };
  for (const kind of [...new Set(remaining.map(candidate => candidate.kind))].sort()) {
    addFirst(candidate => candidate.kind === kind);
    if (selected.length >= AGENT_STREAM_DISCOVERY_LIMITS.examplesPerStream) break;
  }
  remaining.sort((a, b) => (a.operation ?? "").localeCompare(b.operation ?? "") || a.shape.localeCompare(b.shape) || a.kind.localeCompare(b.kind) || a.identity.sequence - b.identity.sequence);
  while (remaining.length && selected.length < AGENT_STREAM_DISCOVERY_LIMITS.examplesPerStream) selected.push(remaining.shift()!);
  omissions.examples += remaining.length;
  return selected;
}
function profileValue(value: unknown, budget: { remainingBytes: number }): ProfileValue {
  if (typeof value !== "string") return { type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, shape: null, shapeOmitted: false };
  const byteLength = utf8Length(value);
  if (byteLength > AGENT_STREAM_DISCOVERY_LIMITS.jsonBytes) return { type: "string", shape: null, shapeOmitted: /^\s*[\[{]/.test(value) };
  if (!/^\s*[\[{]/.test(value)) return { type: "string", shape: null, shapeOmitted: false };
  if (byteLength > budget.remainingBytes) return { type: "string", shape: null, shapeOmitted: true };
  budget.remainingBytes -= byteLength;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return { type: "string", shape: null, shapeOmitted: false };
    const prefix = `${Array.isArray(parsed) ? "json-array" : "json-object"} `;
    const described = jsonShape(parsed);
    const bounded = boundedShape(`${prefix}${described.shape}`);
    return { type: "string", shape: bounded.value, shapeOmitted: described.truncated || bounded.truncated };
  } catch { return { type: "string", shape: null, shapeOmitted: false }; }
}
function jsonShape(root: unknown): { shape: string; truncated: boolean } {
  let nodes = 0;
  let truncated = false;
  const visit = (value: unknown, depth: number): string => {
    if (++nodes > AGENT_STREAM_DISCOVERY_LIMITS.jsonNodes || depth >= AGENT_STREAM_DISCOVERY_LIMITS.jsonDepth) { truncated = true; return "…"; }
    if (value === null) return "null";
    if (Array.isArray(value)) return `array[${value.length ? visit(value[0], depth + 1) : ""}]`;
    if (isRecord(value)) {
      const keys = Object.keys(value).sort();
      if (keys.length > 16) truncated = true;
      return `{${keys.slice(0, 16).map(key => `${truncateName(key)}:${visit(value[key], depth + 1)}`).join(",")}${keys.length > 16 ? ",…" : ""}}`;
    }
    return typeof value;
  };
  const shape = visit(root, 0);
  return { shape, truncated };
}
/** Bound the complete emitted shape label, including any JSON kind prefix and ellipsis. */
function boundedShape(value: string): { value: string; truncated: boolean } {
  const maxBytes = AGENT_STREAM_DISCOVERY_LIMITS.shapeBytes;
  if (utf8Length(value) <= maxBytes) return { value, truncated: false };
  const suffix = "…";
  const budget = maxBytes - utf8Length(suffix);
  let output = "";
  let used = 0;
  for (const character of value) {
    const bytes = utf8Length(character);
    if (used + bytes > budget) break;
    output += character;
    used += bytes;
  }
  return { value: `${output}${suffix}`, truncated: true };
}
function truncateName(value: string): string { return utf8Length(value) <= 48 ? value : `${value.slice(0, 32)}…`; }
