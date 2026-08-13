import {
  type AroundEvidence,
  type DeterministicEvidenceRecord,
  type EvidenceIdentity,
  type EvidenceFilter,
  type EvidenceFilterFacet,
  type TypedFacetValue,
  typedFacetValue
} from "../../src/core/evidence-filter-contract";

export type EvidenceFilterFixture = Readonly<{ interval: Readonly<{ id: string; ordinal: number }>; records: readonly DeterministicEvidenceRecord[]; committedEvidenceBoundary: EvidenceIdentity; retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }>; distinctCommandKeyCount: number; cases: Readonly<{ includeAndExclude: Readonly<{ include: TypedFacetValue; exclude: TypedFacetValue }>; freeText: string; around: AroundEvidence; validZeroResult: Readonly<{ left: TypedFacetValue; right: TypedFacetValue }>; unsupported: { id: string; label: string; reason: "UNSUPPORTED_FACET" }; collisions: Readonly<{ clients: readonly [TypedFacetValue, TypedFacetValue]; sessions: readonly [TypedFacetValue, TypedFacetValue]; listeners: readonly [TypedFacetValue, TypedFacetValue]; missingItem: TypedFacetValue; literalNullItem: TypedFacetValue }> }> }>;

export const EVIDENCE_FILTER_FACETS = Object.freeze([
  "client", "session", "subscription", "mode", "kind", "item", "listener", "key", "operation", "phase", "provenance", "observationPath"
] as const);
export const EVIDENCE_FILTER_LIFECYCLE_CASES = Object.freeze([
  "clear-invalidates-stale-read-point", "terminal-history-final-boundary", "lower-capacity-memory-fallback", "limited-observation-coverage", "concurrent-committed-capture"
] as const);
export const EVIDENCE_FILTER_PANEL_SCENARIOS = Object.freeze([
  "primary-include-exclude-reveal-reset", "empty-history", "valid-zero-result-conflict", "unsupported-criterion", "discovery-unavailable", "hidden-selection", "terminal-history", "memory-fallback", "high-volume-command-keys"
] as const);
export type EvidenceFilterPanelScenario = (typeof EVIDENCE_FILTER_PANEL_SCENARIOS)[number];
export const EVIDENCE_FILTER_PANEL_GEOMETRIES = Object.freeze([
  Object.freeze({ name: "compact", width: 563, height: 700 }), Object.freeze({ name: "normal", width: 900, height: 700 }), Object.freeze({ name: "shallow", width: 900, height: 320 }), Object.freeze({ name: "wide", width: 1440, height: 900 })
] as const);
export const DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE = 10_000;
export const MINIMUM_COMMAND_KEY_COUNT = 3_842;
export const DEFAULT_FILTER_INTERVAL = Object.freeze({ id: "filter-contract-interval-1", ordinal: 1 });

export function createEmptyEvidenceFilter(revision = 1): EvidenceFilter {
  return Object.freeze({ revision, text: "", criteria: Object.freeze({}), around: null, unsupported: Object.freeze([]) });
}

export function createEvidenceFilterFixture(count = DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE, options: Readonly<{ namespace?: string }> = {}): EvidenceFilterFixture {
  if (!Number.isSafeInteger(count) || count < MINIMUM_COMMAND_KEY_COUNT) throw new Error(`The deterministic filter fixture requires at least ${MINIMUM_COMMAND_KEY_COUNT} records.`);
  const namespace = options.namespace ?? "filter-contract";
  const interval = Object.freeze({ id: `${namespace}-interval-1`, ordinal: 1 });
  let commandOrdinal = 0;
  const records = Array.from({ length: count }, (_, index) => {
    const record = createRecord(index + 1, commandOrdinal, namespace, interval.id);
    if (record.facets.key) commandOrdinal += 1;
    return record;
  });
  const first = records[0]!.identity;
  const last = records.at(-1)!.identity;
  const include = records.find((record) => record.facets.provenance?.value === "LOCAL")!.facets.provenance!;
  const exclude = records.find((record) => record.facets.provenance?.value === "SERVER")!.facets.provenance!;
  const collisions = Object.freeze({
    clients: Object.freeze([typedFacetValue("client", "client", "page-a/client-main", "Client client-main"), typedFacetValue("client", "client", "page-b/client-main", "Client client-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    sessions: Object.freeze([typedFacetValue("session", "session", "client-a/session-main", "Session session-main"), typedFacetValue("session", "session", "client-b/session-main", "Session session-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    listeners: Object.freeze([typedFacetValue("listener", "listener", "owner-a/listener-main", "Listener listener-main"), typedFacetValue("listener", "listener", "owner-b/listener-main", "Listener listener-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    missingItem: typedFacetValue("item", "item", "missing:item", "null"), literalNullItem: typedFacetValue("item", "item", "null", "null")
  });
  const around: AroundEvidence = { intervalId: interval.id, start: records[199]!.timestamp, end: records[399]!.timestamp + 1 };
  return Object.freeze({
    interval, records: Object.freeze(records), committedEvidenceBoundary: last,
    retainedRange: Object.freeze({ first, last }), distinctCommandKeyCount: new Set(records.map((record) => record.facets.key?.value).filter(Boolean)).size,
    cases: Object.freeze({
      includeAndExclude: Object.freeze({ include, exclude }), freeText: "risk-reviewed", around: Object.freeze(around),
      validZeroResult: Object.freeze({ left: records[0]!.facets.kind!, right: records.find((record) => record.facets.kind?.value === "session-status")!.facets.kind! }),
      unsupported: Object.freeze({ id: "field:unsupported", label: "Field unsupported", reason: "UNSUPPORTED_FACET" as const }), collisions
    })
  });
}

function createRecord(sequence: number, commandOrdinal: number, namespace: string, intervalId: string): DeterministicEvidenceRecord {
  const lifecycle = sequence % 97 === 0;
  const delivery = !lifecycle && sequence % 41 === 0;
  const subscription = lifecycle ? undefined : sequence === 1 ? "sub-collision-a" : sequence === 2 ? "sub-collision-b" : sequence <= 120 ? "sub-retired-0" : sequence % 5 === 0 ? "sub-merge-2" : "sub-command-1";
  const mode = subscription === "sub-merge-2" ? "MERGE" : subscription ? "COMMAND" : undefined;
  const kind = lifecycle ? "session-status" : delivery ? "update-delivery" : "item-update";
  const item = sequence === 1 ? undefined : sequence === 2 ? "null" : subscription === "sub-retired-0" ? "orders.retired" : subscription === "sub-command-1" ? sequence % 2 ? "orders.eu" : "orders.us" : subscription ? "quotes.primary" : undefined;
  const key = sequence === 1 ? "ABC" : sequence === 2 ? "abc" : mode === "COMMAND" && !delivery ? `order-${String((commandOrdinal % (MINIMUM_COMMAND_KEY_COUNT - 2)) + 1).padStart(5, "0")}` : undefined;
  const provenance = lifecycle ? undefined : sequence % 23 === 0 ? "LOCAL" : "SERVER";
  const facets: Partial<Record<EvidenceFilterFacet, TypedFacetValue>> = {
    client: typedFacetValue("client", "client", sequence === 1 ? "page-a/client-main" : sequence === 2 ? "page-b/client-main" : "client-main", "Client client-main"),
    session: typedFacetValue("session", "session", sequence === 1 ? "client-a/session-main" : sequence === 2 ? "client-b/session-main" : "session-9f2a", sequence <= 2 ? "Session session-main" : "Session session-9f2a"),
    kind: typedFacetValue("kind", "enum", kind, kind),
    ...(subscription ? { subscription: typedFacetValue("subscription", "subscription", subscription, `Subscription ${subscription}`) } : {}), ...(mode ? { mode: typedFacetValue("mode", "enum", mode) } : {}),
    ...(item ? { item: typedFacetValue("item", "item", sequence <= 2 ? item : `${subscription}:${item}`, sequence <= 2 ? "null" : item) } : {}),
    ...(delivery || sequence === 1 || sequence === 2 ? { listener: typedFacetValue("listener", "listener", sequence === 1 ? "owner-a/listener-main" : sequence === 2 ? "owner-b/listener-main" : sequence % 2 ? "listener-view" : "listener-metrics", "Listener listener-main") } : {}),
    ...(key ? { key: typedFacetValue("key", "string", key) } : {}), ...(mode === "COMMAND" ? { operation: typedFacetValue("operation", "enum", sequence % 29 === 0 ? "DELETE" : sequence % 11 === 0 ? "ADD" : "UPDATE") } : {}),
    ...(!lifecycle && !delivery ? { phase: typedFacetValue("phase", "enum", sequence <= 180 ? "SNAPSHOT" : "LIVE") } : {}), ...(provenance ? { provenance: typedFacetValue("provenance", "enum", provenance) } : {}), ...(provenance === "SERVER" ? { observationPath: typedFacetValue("observationPath", "enum", sequence % 7 === 0 ? "WIRE" : "LISTENER") } : {})
  };
  const summary = lifecycle ? "Session connected and runtime lifecycle observed" : delivery ? `Update delivered to ${facets.listener?.label}` : `${item ?? "session"} ${key ?? "state"} ${provenance === "LOCAL" ? "risk-reviewed local state" : "state update"}`;
  return Object.freeze({ identity: Object.freeze({ intervalId, pageId: sequence % 211 === 0 ? `${namespace}-page-secondary` : `${namespace}-page-main`, ownerId: sequence % 173 === 0 ? `${namespace}-owner-secondary` : `${namespace}-owner-main`, sequence, eventId: `${namespace}-event-${String(sequence).padStart(5, "0")}` }), timestamp: Date.UTC(2026, 7, 12, 18) + Math.floor(sequence / 2) * 7, summary, searchText: Object.values(facets).map((value) => `${value!.label} ${value!.value}`).concat(summary).join(" ").toLowerCase(), facets: Object.freeze(facets) });
}
