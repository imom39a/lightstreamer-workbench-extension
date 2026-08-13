/**
 * Build 2 filtering contract.
 *
 * This module is deliberately storage- and renderer-neutral. It defines the
 * request/result seam that memory and IndexedDB adapters will implement in
 * later tickets, plus deterministic records used by the contract suite.
 */

export const EVIDENCE_FILTER_FACETS = Object.freeze([
  "client",
  "session",
  "subscription",
  "mode",
  "kind",
  "item",
  "listener",
  "key",
  "operation",
  "phase",
  "provenance",
  "observationPath"
] as const);

export type EvidenceFilterFacet = (typeof EVIDENCE_FILTER_FACETS)[number];
export type FilterPolarity = "include" | "exclude";

export type TypedFacetValue = Readonly<{
  facet: EvidenceFilterFacet;
  type: "client" | "session" | "subscription" | "item" | "listener" | "string" | "enum";
  value: string;
  label: string;
  identity: string;
}>;

export type FilterCriterion = Readonly<{
  id: string;
  facet: EvidenceFilterFacet;
  polarity: FilterPolarity;
  value: TypedFacetValue;
}>;

export type EvidenceFilter = Readonly<{
  revision: number;
  text: string;
  criteria: Readonly<Partial<Record<EvidenceFilterFacet, Readonly<{
    include: readonly TypedFacetValue[];
    exclude: readonly TypedFacetValue[];
  }>>>>;
  around: AroundEvidence | null;
  unsupported: readonly UnsupportedCriterion[];
}>;

export type AroundEvidence = Readonly<{
  intervalId: string;
  start: number;
  end: number;
}>;

export type UnsupportedCriterion = Readonly<{
  id: string;
  label: string;
  reason: "UNSUPPORTED_FACET" | "UNSUPPORTED_VALUE" | "UNSUPPORTED_OPERATOR";
}>;

export type EvidenceIdentity = Readonly<{
  intervalId: string;
  pageId: string;
  ownerId: string;
  sequence: number;
  eventId: string;
}>;

export type EvidenceReadPoint = Readonly<{
  interval: Readonly<{ id: string; ordinal: number }>;
  committedEvidenceBoundary: EvidenceIdentity | null;
  retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }> | null;
}>;

export type EvidencePageRequest = Readonly<{
  order: "NEWEST_FIRST" | "OLDEST_FIRST";
  size: number;
  cursor?: string;
}>;

export type FacetDiscoveryRequest = Readonly<{
  facet: EvidenceFilterFacet;
  search?: string;
  size: number;
  cursor?: string;
}>;

export type FacetCount = Readonly<{
  value: TypedFacetValue;
  count: number;
  pinned: boolean;
}>;

export type FacetDiscoveryResult =
  | Readonly<{
      state: "AVAILABLE";
      facet: EvidenceFilterFacet;
      values: readonly FacetCount[];
      distinctTotal: number;
      nextCursor: string | null;
      baseEvidenceCount: number;
    }>
  | Readonly<{
      state: "UNAVAILABLE";
      facet: EvidenceFilterFacet;
      reason: "NO_CONCRETE_VALUES" | "DISCOVERY_FAILED" | "UNSUPPORTED_AT_READ_POINT";
      values: readonly [];
      distinctTotal: null;
      nextCursor: null;
      baseEvidenceCount: number | null;
    }>;

export type RevealBlocker = Readonly<{
  id: string;
  criterion: FilterCriterion | UnsupportedCriterion | "free-text" | "around-evidence";
}>;

export type EvidenceLookupResult =
  | Readonly<{
      state: "RETAINED";
      evidence: DeterministicEvidenceRecord;
      inScope: boolean;
      matchesFilter: boolean;
      blockingCriteria: readonly RevealBlocker[];
    }>
  | Readonly<{
      state: "NOT_RETAINED" | "OTHER_INTERVAL";
      identity: EvidenceIdentity;
    }>;

export type EvidenceFindRequest = Readonly<{ text: string; current?: EvidenceIdentity }>;
export type EvidenceFindResult = Readonly<{
  text: string;
  total: number;
  current: EvidenceIdentity | null;
  previous: EvidenceIdentity | null;
  next: EvidenceIdentity | null;
}>;

export type EvidenceSnapshot = Readonly<{
  readPoint: EvidenceReadPoint;
  page: Readonly<{ evidence: readonly DeterministicEvidenceRecord[]; nextCursor: string | null }>;
  totals: Readonly<{ matching: number; inScope: number }>;
  discoveries: ReadonlyMap<EvidenceFilterFacet, FacetDiscoveryResult>;
  lookup: EvidenceLookupResult | null;
  find: EvidenceFindResult | null;
  evaluation: "COMPLETE" | "UNSUPPORTED_FILTER";
  coverage: "COMPLETE" | "LIMITED";
  storage: "INDEXED_DB" | "MEMORY_FALLBACK";
}>;

export type EvidenceQueryRequest = Readonly<{
  at: "LATEST_COMMITTED" | EvidenceReadPoint;
  page: EvidencePageRequest;
  filter: EvidenceFilter;
  discover?: readonly FacetDiscoveryRequest[];
  lookup?: EvidenceIdentity;
  find?: EvidenceFindRequest;
}>;

/** The single atomic read seam shared by memory and IndexedDB adapters. */
export interface EvidenceFilterQueryAdapter {
  query(request: EvidenceQueryRequest): Promise<
    | Readonly<{ ok: true; value: EvidenceSnapshot }>
    | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>
  >;
}

export type EvidenceFilterReadProblem = Readonly<{
  code: "HISTORY_INTERVAL_UNAVAILABLE" | "READ_POINT_UNAVAILABLE" | "QUERY_FAILED" | "HISTORY_TERMINAL";
  message: string;
}>;

export type DeterministicEvidenceRecord = Readonly<{
  identity: EvidenceIdentity;
  timestamp: number;
  summary: string;
  searchText: string;
  facets: Readonly<Partial<Record<EvidenceFilterFacet, TypedFacetValue>>>;
}>;

export type EvidenceFilterFixture = Readonly<{
  interval: Readonly<{ id: string; ordinal: number }>;
  records: readonly DeterministicEvidenceRecord[];
  committedEvidenceBoundary: EvidenceIdentity;
  retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }>;
  distinctCommandKeyCount: number;
  cases: Readonly<{
    includeAndExclude: Readonly<{ include: TypedFacetValue; exclude: TypedFacetValue }>;
    freeText: string;
    around: AroundEvidence;
    validZeroResult: Readonly<{ left: TypedFacetValue; right: TypedFacetValue }>;
    unsupported: UnsupportedCriterion;
    collisions: Readonly<{
      clients: readonly [TypedFacetValue, TypedFacetValue];
      sessions: readonly [TypedFacetValue, TypedFacetValue];
      listeners: readonly [TypedFacetValue, TypedFacetValue];
      missingItem: TypedFacetValue;
      literalNullItem: TypedFacetValue;
    }>;
  }>;
}>;

export const EVIDENCE_FILTER_LIFECYCLE_CASES = Object.freeze([
  "clear-invalidates-stale-read-point",
  "terminal-history-final-boundary",
  "lower-capacity-memory-fallback",
  "limited-observation-coverage",
  "concurrent-committed-capture"
] as const);

export type EvidenceFilterLifecycleCase = (typeof EVIDENCE_FILTER_LIFECYCLE_CASES)[number];

export type EvidenceFilterLifecycleState = Readonly<{
  phase: "ACTIVE" | "CLEARED" | "TERMINAL";
  interval: Readonly<{ id: string; ordinal: number }>;
  committedEvidenceBoundary: EvidenceIdentity | null;
  retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }> | null;
  coverage: "COMPLETE" | "LIMITED";
  storage: "INDEXED_DB" | "MEMORY_FALLBACK";
}>;

export const EVIDENCE_FILTER_PANEL_SCENARIOS = Object.freeze([
  "primary-include-exclude-reveal-reset",
  "empty-history",
  "valid-zero-result-conflict",
  "unsupported-criterion",
  "discovery-unavailable",
  "hidden-selection",
  "terminal-history",
  "memory-fallback",
  "high-volume-command-keys"
] as const);

export type EvidenceFilterPanelScenario = (typeof EVIDENCE_FILTER_PANEL_SCENARIOS)[number];

export const EVIDENCE_FILTER_PANEL_GEOMETRIES = Object.freeze([
  Object.freeze({ name: "compact", width: 563, height: 700 }),
  Object.freeze({ name: "normal", width: 900, height: 700 }),
  Object.freeze({ name: "shallow", width: 900, height: 320 }),
  Object.freeze({ name: "wide", width: 1440, height: 900 })
] as const);

export const DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE = 10_000;
export const MINIMUM_COMMAND_KEY_COUNT = 3_842;
export const DEFAULT_FILTER_INTERVAL = Object.freeze({ id: "filter-contract-interval-1", ordinal: 1 });

export function typedFacetValue(
  facet: EvidenceFilterFacet,
  type: TypedFacetValue["type"],
  value: string,
  label = value
): TypedFacetValue {
  return Object.freeze({ facet, type, value, label, identity: JSON.stringify(["v1", facet, type, value]) });
}

export function createEmptyEvidenceFilter(revision = 1): EvidenceFilter {
  return Object.freeze({ revision, text: "", criteria: Object.freeze({}), around: null, unsupported: Object.freeze([]) });
}

export function createEvidenceFilterFixture(count = DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE): EvidenceFilterFixture {
  if (!Number.isSafeInteger(count) || count < MINIMUM_COMMAND_KEY_COUNT) {
    throw new Error(`The deterministic filter fixture requires at least ${MINIMUM_COMMAND_KEY_COUNT} records.`);
  }
  let commandOrdinal = 0;
  const records = Array.from({ length: count }, (_, index) => {
    const record = createRecord(index + 1, commandOrdinal);
    if (record.facets.key) commandOrdinal += 1;
    return record;
  });
  const first = records[0]!.identity;
  const last = records.at(-1)!.identity;
  const commandValues = records.map((record) => record.facets.key?.value).filter(Boolean);
  const include = records.find((record) => record.facets.provenance?.value === "LOCAL")!.facets.provenance!;
  const exclude = records.find((record) => record.facets.provenance?.value === "SERVER")!.facets.provenance!;
  const around = { intervalId: DEFAULT_FILTER_INTERVAL.id, start: records[199]!.timestamp, end: records[399]!.timestamp + 1 };
  const collisions = Object.freeze({
    clients: Object.freeze([typedFacetValue("client", "client", "page-a/client-main", "Client client-main"), typedFacetValue("client", "client", "page-b/client-main", "Client client-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    sessions: Object.freeze([typedFacetValue("session", "session", "client-a/session-main", "Session session-main"), typedFacetValue("session", "session", "client-b/session-main", "Session session-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    listeners: Object.freeze([typedFacetValue("listener", "listener", "owner-a/listener-main", "Listener listener-main"), typedFacetValue("listener", "listener", "owner-b/listener-main", "Listener listener-main")]) as unknown as readonly [TypedFacetValue, TypedFacetValue],
    missingItem: typedFacetValue("item", "item", "missing:item", "null"),
    literalNullItem: typedFacetValue("item", "item", "null", "null")
  });
  return Object.freeze({
    interval: DEFAULT_FILTER_INTERVAL,
    records: Object.freeze(records),
    committedEvidenceBoundary: last,
    retainedRange: Object.freeze({ first, last }),
    distinctCommandKeyCount: new Set(commandValues).size,
    cases: Object.freeze({
      includeAndExclude: Object.freeze({ include, exclude }),
      freeText: "risk-reviewed",
      around: Object.freeze(around),
      validZeroResult: Object.freeze({ left: records[0]!.facets.kind!, right: records.find((record) => record.facets.kind?.value === "session-status")!.facets.kind! }),
      unsupported: Object.freeze({ id: "field:unsupported", label: "Field unsupported", reason: "UNSUPPORTED_FACET" as const })
      ,collisions
    })
  });
}

function createRecord(sequence: number, commandOrdinal: number): DeterministicEvidenceRecord {
  const isLifecycle = sequence % 97 === 0;
  const isDelivery = !isLifecycle && sequence % 41 === 0;
  const subscription = isLifecycle ? undefined : sequence === 1 ? "sub-collision-a" : sequence === 2 ? "sub-collision-b" : sequence <= 120 ? "sub-retired-0" : sequence % 5 === 0 ? "sub-merge-2" : "sub-command-1";
  const mode = subscription === "sub-merge-2" ? "MERGE" : subscription ? "COMMAND" : undefined;
  const kind = isLifecycle ? "session-status" : isDelivery ? "update-delivery" : "item-update";
  const item = sequence === 1 ? undefined : sequence === 2 ? "null" : subscription === "sub-retired-0" ? "orders.retired" : subscription === "sub-command-1" ? sequence % 2 ? "orders.eu" : "orders.us" : subscription ? "quotes.primary" : undefined;
  const key = sequence === 1 ? "ABC" : sequence === 2 ? "abc" : mode === "COMMAND" && !isDelivery ? `order-${String((commandOrdinal % (MINIMUM_COMMAND_KEY_COUNT - 2)) + 1).padStart(5, "0")}` : undefined;
  const provenance = isLifecycle ? undefined : sequence % 23 === 0 ? "LOCAL" : "SERVER";
  const facets: Partial<Record<EvidenceFilterFacet, TypedFacetValue>> = {
    client: typedFacetValue("client", "client", sequence === 1 ? "page-a/client-main" : sequence === 2 ? "page-b/client-main" : "client-main", "Client client-main"),
    session: typedFacetValue("session", "session", sequence === 1 ? "client-a/session-main" : sequence === 2 ? "client-b/session-main" : "session-9f2a", sequence <= 2 ? "Session session-main" : "Session session-9f2a"),
    kind: typedFacetValue("kind", "enum", kind, kind),
    ...(subscription ? { subscription: typedFacetValue("subscription", "subscription", subscription, `Subscription ${subscription}`) } : {}),
    ...(mode ? { mode: typedFacetValue("mode", "enum", mode) } : {}),
    ...(item ? { item: typedFacetValue("item", "item", sequence <= 2 ? item : `${subscription}:${item}`, sequence <= 2 ? "null" : item) } : {}),
    ...(isDelivery || sequence === 1 || sequence === 2 ? { listener: typedFacetValue("listener", "listener", sequence === 1 ? "owner-a/listener-main" : sequence === 2 ? "owner-b/listener-main" : sequence === 41 ? "owner-a/listener-main" : sequence === 82 ? "owner-b/listener-main" : sequence % 2 ? "listener-view" : "listener-metrics", sequence <= 82 ? "Listener listener-main" : undefined) } : {}),
    ...(key ? { key: typedFacetValue("key", "string", key) } : {}),
    ...(mode === "COMMAND" ? { operation: typedFacetValue("operation", "enum", sequence % 29 === 0 ? "DELETE" : sequence % 11 === 0 ? "ADD" : "UPDATE") } : {}),
    ...(!isLifecycle && !isDelivery ? { phase: typedFacetValue("phase", "enum", sequence <= 180 ? "SNAPSHOT" : "LIVE") } : {}),
    ...(provenance ? { provenance: typedFacetValue("provenance", "enum", provenance) } : {}),
    ...(provenance === "SERVER" ? { observationPath: typedFacetValue("observationPath", "enum", sequence % 7 === 0 ? "WIRE" : "LISTENER") } : {})
  };
  const summary = isLifecycle ? "Session connected and runtime lifecycle observed" : isDelivery ? `Update delivered to ${facets.listener?.label}` : `${item ?? "session"} ${key ?? "state"} ${provenance === "LOCAL" ? "risk-reviewed local state" : "state update"}`;
  return Object.freeze({
    identity: Object.freeze({
      intervalId: DEFAULT_FILTER_INTERVAL.id,
      pageId: sequence % 211 === 0 ? "page-secondary" : "page-main",
      ownerId: sequence % 173 === 0 ? "owner-secondary" : "owner-main",
      sequence,
      eventId: `filter-event-${String(sequence).padStart(5, "0")}`
    }),
    timestamp: Date.UTC(2026, 7, 12, 18, 0, 0) + Math.floor(sequence / 2) * 7,
    summary,
    searchText: Object.values(facets).map((value) => `${value!.label} ${value!.value}`).concat(summary).join(" ").toLowerCase(),
    facets: Object.freeze(facets)
  });
}

/* Reference evaluators and lifecycle harnesses intentionally live in tests/support. */
/* Production ends at the storage-neutral contract and immutable fixture types. */
/* The former implementation is retained below only as a migration note. */
