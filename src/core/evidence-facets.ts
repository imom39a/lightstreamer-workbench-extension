import { type EvidenceIdentity, typedFacetValue, type TypedFacetValue } from "./evidence-filter-contract";
import { type EventSemanticValueState, type LightstreamerEventEnvelope } from "./event-envelope";

export const EVIDENCE_FACET_KEYS = [
  "client", "session", "subscription", "mode", "kind", "item", "listener",
  "key", "operation", "phase", "provenance", "observationPath"
] as const;
export type EvidenceFacetKey = (typeof EVIDENCE_FACET_KEYS)[number];

export type EvidenceFacetContext = Readonly<{
  pageId?: string;
  listenerOwner?: string;
  summary?: string;
  identity?: EvidenceIdentity;
}>;

export type EvidenceFacetDescriptor = Readonly<{
  key: EvidenceFacetKey;
  label: string;
  valueType: "string" | "enum" | "number" | "boolean" | "null";
  extract: (event: LightstreamerEventEnvelope, context?: EvidenceFacetContext) => TypedFacetValue | undefined;
}>;

export type EvidenceFacetExtraction = Readonly<{
  facets: Readonly<Partial<Record<EvidenceFacetKey, TypedFacetValue>>>;
  selectableValues: readonly TypedFacetValue[];
  unavailable: readonly EvidenceFacetKey[];
}> & Readonly<Partial<Record<EvidenceFacetKey, TypedFacetValue>>>;

const value = (facet: EvidenceFacetKey, type: "string" | "enum" | "number", raw: string, label = raw): TypedFacetValue =>
  typedFacetValue(facet, type, raw, label);

function qualified(parts: readonly unknown[]): string {
  return JSON.stringify(["owner-v1", ...parts]);
}

function semanticState(event: LightstreamerEventEnvelope, facet: "mode" | "client" | "subscription", field: string): EventSemanticValueState["state"] | undefined {
  const owner = facet === "client" ? event.client : event.subscription;
  return owner?.semanticValueStates?.[field]?.state;
}

function concrete(state: EventSemanticValueState["state"] | undefined): boolean {
  return state === undefined || state === "requested" || state === "real" || state === "inferred";
}

function extractClient(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): TypedFacetValue | undefined {
  const id = event.client?.id;
  if (!id || !context.pageId || !concrete(semanticState(event, "client", "id"))) return undefined;
  return value("client", "string", qualified(["page", context.pageId, "client", id]), id);
}

function extractSession(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): TypedFacetValue | undefined {
  const client = extractClient(event, context);
  const sessionId = event.client?.sessionId;
  if (!client || !sessionId || !concrete(semanticState(event, "client", "sessionId"))) return undefined;
  return value("session", "string", qualified(["client", client.value, "session", sessionId]), sessionId);
}

function extractSubscription(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): TypedFacetValue | undefined {
  const session = extractSession(event, context);
  const id = event.subscription?.id;
  if (!session || !id || !concrete(semanticState(event, "subscription", "id"))) return undefined;
  return value("subscription", "string", qualified(["session", session.value, "subscription", id]), id);
}

function extractMode(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  const mode = event.subscription?.mode;
  return mode && concrete(semanticState(event, "subscription", "mode")) ? value("mode", "enum", mode) : undefined;
}

function extractKind(event: LightstreamerEventEnvelope): TypedFacetValue {
  return value("kind", "enum", event.kind);
}

function extractItem(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): TypedFacetValue | undefined {
  const subscription = extractSubscription(event, context);
  const item = event.item;
  if (!subscription || !item || (item.name === undefined || item.name === null) && item.position === undefined) return undefined;
  const parts = [item.name === undefined || item.name === null ? null : ["name", item.name], item.position === undefined ? null : ["position", item.position]];
  return value("item", "string", qualified(["subscription", subscription.value, "item", parts]), item.name ?? String(item.position));
}

function extractListener(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): TypedFacetValue | undefined {
  const id = event.listener?.id;
  if (!id || !context.listenerOwner) return undefined;
  return value("listener", "string", qualified(["owner", context.listenerOwner, "listener", id]), id);
}

function extractKey(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  const key = event.update?.key;
  return key === undefined || key === null ? undefined : value("key", "string", key);
}

function extractOperation(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  const command = event.update?.command;
  return command === undefined || command === null ? undefined : value("operation", "enum", command);
}

function extractPhase(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  if (event.kind === "end-of-snapshot") return value("phase", "enum", "END OF SNAPSHOT");
  if (event.update?.isSnapshot === true) return value("phase", "enum", "SNAPSHOT");
  if (event.update?.isSnapshot === false) return value("phase", "enum", "LIVE");
  return undefined;
}

function extractProvenance(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  if (event.synthetic || event.source === "synthetic") return value("provenance", "enum", "LOCAL");
  if (event.source === "server") return value("provenance", "enum", "SERVER");
  return undefined;
}

function extractObservationPath(event: LightstreamerEventEnvelope): TypedFacetValue | undefined {
  if (event.synthetic || event.source !== "server") return undefined;
  return value("observationPath", "enum", event.captureSource === "wire" ? "WIRE" : "LISTENER");
}

const descriptors: EvidenceFacetDescriptor[] = [
  { key: "client", label: "Client", valueType: "string", extract: extractClient },
  { key: "session", label: "Session", valueType: "string", extract: extractSession },
  { key: "subscription", label: "Subscription", valueType: "string", extract: extractSubscription },
  { key: "mode", label: "Mode", valueType: "enum", extract: extractMode },
  { key: "kind", label: "Evidence kind", valueType: "enum", extract: extractKind },
  { key: "item", label: "Item", valueType: "string", extract: extractItem },
  { key: "listener", label: "Listener", valueType: "string", extract: extractListener },
  { key: "key", label: "COMMAND key", valueType: "string", extract: extractKey },
  { key: "operation", label: "COMMAND operation", valueType: "enum", extract: extractOperation },
  { key: "phase", label: "Update phase", valueType: "enum", extract: extractPhase },
  { key: "provenance", label: "Provenance", valueType: "enum", extract: extractProvenance },
  { key: "observationPath", label: "Observation path", valueType: "enum", extract: extractObservationPath }
];
export const FACET_DESCRIPTORS = Object.freeze(descriptors.map((descriptor) => Object.freeze(descriptor)));

export function extractEvidenceFacets(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): EvidenceFacetExtraction {
  const facets = Object.fromEntries(FACET_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor.extract(event, context)]).filter(([, facet]) => facet !== undefined)) as Partial<Record<EvidenceFacetKey, TypedFacetValue>>;
  const unavailable = FACET_DESCRIPTORS.filter((descriptor) => facets[descriptor.key] === undefined).map((descriptor) => descriptor.key);
  return Object.freeze({ ...facets, facets: Object.freeze(facets), selectableValues: Object.freeze(Object.values(facets)), unavailable: Object.freeze(unavailable) });
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function stableFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, entry]) => [key, canonical(entry)]);
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${stableFields(value).join(",")}}`;
}

export function canonicalEvidenceSearchText(event: LightstreamerEventEnvelope, context: EvidenceFacetContext = {}): string {
  const extracted = extractEvidenceFacets(event, context);
  const facetText = FACET_DESCRIPTORS.flatMap((descriptor) => {
    const facet = extracted.facets[descriptor.key];
    return facet ? [descriptor.label, facet.label, facet.value] : [];
  });
  return normalizeText([
    event.id,
    event.kind,
    event.source,
    event.direction,
    context.summary,
    ...facetText,
    ...stableFields(event.update?.fields),
    ...stableFields(event.update?.changedFields),
    ...stableFields(event.update?.jsonPatches)
  ].filter((entry) => entry !== undefined && entry !== null && entry !== "").join(" "));
}
