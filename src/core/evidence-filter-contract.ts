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

export const EVIDENCE_FILTER_LIFECYCLE_CASES = [
  "clear-invalidates-stale-read-point",
  "terminal-history-final-boundary",
  "lower-capacity-memory-fallback",
  "limited-observation-coverage",
  "concurrent-committed-capture"
] as const;

export type EvidenceFilterLifecycleCase = (typeof EVIDENCE_FILTER_LIFECYCLE_CASES)[number];

export const EVIDENCE_FILTER_PANEL_SCENARIOS = [
  "primary-include-exclude-reveal-reset",
  "empty-history",
  "valid-zero-result-conflict",
  "unsupported-criterion",
  "discovery-unavailable",
  "hidden-selection",
  "terminal-history",
  "memory-fallback",
  "high-volume-command-keys"
] as const;

export type EvidenceFilterPanelScenario = (typeof EVIDENCE_FILTER_PANEL_SCENARIOS)[number];

export const EVIDENCE_FILTER_PANEL_GEOMETRIES = Object.freeze([
  Object.freeze({ name: "compact", width: 563, height: 700 }),
  Object.freeze({ name: "normal", width: 900, height: 700 }),
  Object.freeze({ name: "shallow", width: 900, height: 320 }),
  Object.freeze({ name: "wide", width: 1440, height: 900 })
] as const);

export const EVIDENCE_FILTER_PANEL_SCENARIO_DEFINITIONS = Object.freeze(
  EVIDENCE_FILTER_PANEL_SCENARIOS.map((id) => Object.freeze({
    id,
    geometries: EVIDENCE_FILTER_PANEL_GEOMETRIES,
    themes: Object.freeze(["Dark", "Light"] as const),
    forcedColors: true,
    setupActions: Object.freeze(panelScenarioActions(id))
  }))
);

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
  const subscription = isLifecycle ? undefined : sequence <= 120 ? "sub-retired-0" : sequence % 5 === 0 ? "sub-merge-2" : "sub-command-1";
  const mode = subscription === "sub-merge-2" ? "MERGE" : subscription ? "COMMAND" : undefined;
  const kind = isLifecycle ? "session-status" : isDelivery ? "update-delivery" : "item-update";
  const item = subscription === "sub-retired-0" ? "orders.retired" : subscription === "sub-command-1" ? sequence % 2 ? "orders.eu" : "orders.us" : subscription ? "quotes.primary" : undefined;
  const key = mode === "COMMAND" && !isDelivery ? `order-${String((commandOrdinal % MINIMUM_COMMAND_KEY_COUNT) + 1).padStart(5, "0")}` : undefined;
  const provenance = isLifecycle ? undefined : sequence % 23 === 0 ? "LOCAL" : "SERVER";
  const facets: Partial<Record<EvidenceFilterFacet, TypedFacetValue>> = {
    client: typedFacetValue("client", "client", sequence === 1 ? "page-a/client-main" : sequence === 2 ? "page-b/client-main" : "client-main", "Client client-main"),
    session: typedFacetValue("session", "session", sequence === 1 ? "client-a/session-main" : sequence === 2 ? "client-b/session-main" : "session-9f2a", sequence <= 2 ? "Session session-main" : "Session session-9f2a"),
    kind: typedFacetValue("kind", "enum", kind, kind),
    ...(subscription ? { subscription: typedFacetValue("subscription", "subscription", subscription, `Subscription ${subscription}`) } : {}),
    ...(mode ? { mode: typedFacetValue("mode", "enum", mode) } : {}),
    ...(item ? { item: typedFacetValue("item", "item", sequence === 1 ? "missing:item" : sequence === 2 ? "null" : `${subscription}:${item}`, sequence <= 2 ? "null" : item) } : {}),
    ...(isDelivery ? { listener: typedFacetValue("listener", "listener", sequence === 41 ? "owner-a/listener-main" : sequence === 82 ? "owner-b/listener-main" : sequence % 2 ? "listener-view" : "listener-metrics", sequence <= 82 ? "Listener listener-main" : undefined) } : {}),
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

function panelScenarioActions(id: EvidenceFilterPanelScenario): readonly Readonly<{ type: "select-row" | "click" | "set-value"; selector: string; text?: string; value?: string }>[] {
  switch (id) {
    case "primary-include-exclude-reveal-reset":
      return [
        { type: "click", selector: "[aria-label=Filter]" },
        { type: "set-value", selector: "#workbench-filter-query", value: "risk-reviewed" },
        { type: "click", selector: "[aria-label=Apply Filter]" },
        { type: "click", selector: "[aria-label='Reveal selected Evidence']" },
        { type: "click", selector: "[aria-label='Clear filters']" }
      ];
    case "hidden-selection":
      return [{ type: "click", selector: "[aria-label='Reveal selected Evidence']" }];
    case "empty-history":
    case "valid-zero-result-conflict":
    case "unsupported-criterion":
    case "discovery-unavailable":
    case "terminal-history":
    case "memory-fallback":
    case "high-volume-command-keys":
      return [];
  }
}

export type EvidenceFilterLifecycleState = Readonly<{
  phase: "ACTIVE" | "CLEARED" | "TERMINAL";
  interval: Readonly<{ id: string; ordinal: number }>;
  committedEvidenceBoundary: EvidenceIdentity | null;
  retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }> | null;
  coverage: "COMPLETE" | "LIMITED";
  storage: "INDEXED_DB" | "MEMORY_FALLBACK";
}>;

/** Deterministic reference adapter. Production storage adapters implement the same seam later. */
export class DeterministicEvidenceFilterAdapter implements EvidenceFilterQueryAdapter {
  private readonly records: readonly DeterministicEvidenceRecord[];
  private readonly interval: Readonly<{ id: string; ordinal: number }>;

  constructor(records: readonly DeterministicEvidenceRecord[], private readonly options: Readonly<{ storage?: "INDEXED_DB" | "MEMORY_FALLBACK"; coverage?: "COMPLETE" | "LIMITED"; interval?: Readonly<{ id: string; ordinal: number }> }> = {}) {
    this.records = Object.freeze([...records]);
    this.interval = options.interval ?? DEFAULT_FILTER_INTERVAL;
  }

  query(request: EvidenceQueryRequest): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
    const boundary = this.records.at(-1)?.identity ?? null;
    const readPoint: EvidenceReadPoint = Object.freeze({
      interval: this.interval,
      committedEvidenceBoundary: boundary,
      retainedRange: this.records.length ? Object.freeze({ first: this.records[0]!.identity, last: boundary! }) : null
    });
    if (request.at !== "LATEST_COMMITTED") {
      if (request.at.interval.id !== this.interval.id) return Promise.resolve({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE", message: "The requested History Interval is unavailable." } });
      if (request.at.committedEvidenceBoundary?.sequence !== boundary?.sequence) return Promise.resolve({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE", message: "The requested committed Evidence Boundary is unavailable." } });
    }
    if (!Number.isSafeInteger(request.page.size) || request.page.size < 1) return Promise.resolve({ ok: false, problem: { code: "QUERY_FAILED", message: "Page size must be a positive integer." } });
    const unsupported = request.filter.unsupported.length > 0;
    const discoveries = new Map<EvidenceFilterFacet, FacetDiscoveryResult>();
    if (unsupported) {
      for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, { state: "UNAVAILABLE", facet: discovery.facet, reason: "UNSUPPORTED_AT_READ_POINT", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null });
      return Promise.resolve({ ok: true, value: this.snapshot(readPoint, request, [], [], discoveries, "UNSUPPORTED_FILTER") });
    }
    const matching = this.records.filter((record) => matchesFilter(record, request.filter));
    const inScope = matching.filter((record) => inAround(record, request.filter.around));
    for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, discover(inScope, discovery));
    const pageStart = cursorValue(request.page.cursor);
    const ordered = request.page.order === "NEWEST_FIRST" ? [...inScope].reverse() : inScope;
    const page = ordered.slice(pageStart, pageStart + request.page.size);
    const snapshot = this.snapshot(readPoint, request, page, inScope, discoveries, "COMPLETE");
    return Promise.resolve({ ok: true, value: Object.freeze({ ...snapshot, page: Object.freeze({ evidence: Object.freeze(page), nextCursor: pageStart + page.length < ordered.length ? String(pageStart + page.length) : null }), totals: Object.freeze({ matching: matching.length, inScope: inScope.length }) }) });
  }

  private snapshot(readPoint: EvidenceReadPoint, request: EvidenceQueryRequest, page: readonly DeterministicEvidenceRecord[], inScope: readonly DeterministicEvidenceRecord[], discoveries: ReadonlyMap<EvidenceFilterFacet, FacetDiscoveryResult>, evaluation: EvidenceSnapshot["evaluation"]): EvidenceSnapshot {
    const lookup = request.lookup ? lookupRecord(this.records, request.lookup, request.filter) : null;
    const find = request.find ? findRecords(this.records, request.find) : null;
    return Object.freeze({ readPoint, page: Object.freeze({ evidence: Object.freeze(page), nextCursor: null }), totals: Object.freeze({ matching: inScope.length, inScope: inScope.length }), discoveries, lookup, find, evaluation });
  }
}

export class DeterministicEvidenceFilterLifecycleHarness implements EvidenceFilterQueryAdapter {
  private records: readonly DeterministicEvidenceRecord[];
  private interval: Readonly<{ id: string; ordinal: number }> = DEFAULT_FILTER_INTERVAL;
  private phase: EvidenceFilterLifecycleState["phase"] = "ACTIVE";
  private readonly storage: EvidenceFilterLifecycleState["storage"];
  private readonly coverage: EvidenceFilterLifecycleState["coverage"];
  private adapter: DeterministicEvidenceFilterAdapter;

  constructor(records: readonly DeterministicEvidenceRecord[], options: Readonly<{ storage?: EvidenceFilterLifecycleState["storage"]; coverage?: EvidenceFilterLifecycleState["coverage"] }> = {}) {
    this.records = Object.freeze([...records]);
    this.storage = options.storage ?? "INDEXED_DB";
    this.coverage = options.coverage ?? "COMPLETE";
    this.adapter = new DeterministicEvidenceFilterAdapter(this.records, { storage: this.storage, coverage: this.coverage, interval: this.interval });
  }

  query(request: EvidenceQueryRequest) {
    return this.adapter.query(request);
  }

  capture(record: DeterministicEvidenceRecord): void {
    if (this.phase !== "ACTIVE") throw new Error("Capture is unavailable after the history becomes terminal.");
    this.records = Object.freeze([...this.records, record]);
    this.adapter = new DeterministicEvidenceFilterAdapter(this.records, { storage: this.storage, coverage: this.coverage, interval: this.interval });
  }

  clear(): void {
    if (this.phase === "TERMINAL") throw new Error("Terminal history cannot be cleared.");
    this.records = Object.freeze([]);
    this.interval = Object.freeze({ id: `${this.interval.id}-cleared`, ordinal: this.interval.ordinal + 1 });
    this.adapter = new DeterministicEvidenceFilterAdapter(this.records, { storage: this.storage, coverage: this.coverage, interval: this.interval });
  }

  terminate(): void {
    this.phase = "TERMINAL";
  }

  state(): EvidenceFilterLifecycleState {
    const first = this.records[0]?.identity;
    const last = this.records.at(-1)?.identity ?? null;
    return Object.freeze({ phase: this.phase, interval: this.interval, committedEvidenceBoundary: last, retainedRange: first && last ? Object.freeze({ first, last }) : null, coverage: this.coverage, storage: this.storage });
  }
}

function cursorValue(cursor: string | undefined): number {
  const value = cursor === undefined ? 0 : Number(cursor);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function matchesFilter(record: DeterministicEvidenceRecord, filter: EvidenceFilter): boolean {
  if (filter.text.trim() && !record.searchText.includes(filter.text.trim().toLowerCase())) return false;
  for (const [facet, bucket] of Object.entries(filter.criteria) as [EvidenceFilterFacet, { include: readonly TypedFacetValue[]; exclude: readonly TypedFacetValue[] } | undefined][]) {
    if (!bucket) continue;
    const value = record.facets[facet];
    if (bucket.include.length && (!value || !bucket.include.some((candidate) => candidate.identity === value.identity))) return false;
    if (value && bucket.exclude.some((candidate) => candidate.identity === value.identity)) return false;
  }
  return true;
}

function inAround(record: DeterministicEvidenceRecord, around: AroundEvidence | null): boolean {
  return !around || (record.identity.intervalId === around.intervalId && record.timestamp >= around.start && record.timestamp < around.end);
}

function discover(records: readonly DeterministicEvidenceRecord[], request: FacetDiscoveryRequest): FacetDiscoveryResult {
  const all = new Map<string, { value: TypedFacetValue; count: number }>();
  for (const record of records) {
    const value = record.facets[request.facet];
    if (value && (!request.search || `${value.label} ${value.value}`.toLowerCase().includes(request.search.toLowerCase()))) {
      const existing = all.get(value.identity);
      if (existing) existing.count += 1; else all.set(value.identity, { value, count: 1 });
    }
  }
  const values = [...all.values()].sort((left, right) => left.value.identity.localeCompare(right.value.identity));
  const start = cursorValue(request.cursor);
  const selected = values.slice(start, start + request.size).map(({ value, count }) => Object.freeze({ value, count, pinned: false }));
  return Object.freeze({ state: "AVAILABLE", facet: request.facet, values: Object.freeze(selected), distinctTotal: values.length, nextCursor: start + selected.length < values.length ? String(start + selected.length) : null, baseEvidenceCount: records.length });
}

function lookupRecord(records: readonly DeterministicEvidenceRecord[], identity: EvidenceIdentity, filter: EvidenceFilter): EvidenceLookupResult {
  if (identity.intervalId !== DEFAULT_FILTER_INTERVAL.id) return { state: "OTHER_INTERVAL", identity };
  const record = records.find((candidate) => candidate.identity.eventId === identity.eventId);
  if (!record) return { state: "NOT_RETAINED", identity };
  const blockingCriteria: RevealBlocker[] = [];
  if (filter.text.trim() && !record.searchText.includes(filter.text.trim().toLowerCase())) blockingCriteria.push({ id: "free-text", criterion: "free-text" });
  if (filter.around && !inAround(record, filter.around)) blockingCriteria.push({ id: "around-evidence", criterion: "around-evidence" });
  for (const [facet, bucket] of Object.entries(filter.criteria) as [EvidenceFilterFacet, { include: readonly TypedFacetValue[]; exclude: readonly TypedFacetValue[] } | undefined][]) {
    if (!bucket) continue;
    const value = record.facets[facet];
    if (bucket.include.length && (!value || !bucket.include.some((candidate) => candidate.identity === value.identity))) blockingCriteria.push(...bucket.include.map((candidate) => ({ id: `${facet}:include:${candidate.identity}`, criterion: { id: `${facet}:include`, facet, polarity: "include" as const, value: candidate } })));
    if (value && bucket.exclude.some((candidate) => candidate.identity === value.identity)) blockingCriteria.push(...bucket.exclude.map((candidate) => ({ id: `${facet}:exclude:${candidate.identity}`, criterion: { id: `${facet}:exclude`, facet, polarity: "exclude" as const, value: candidate } })));
  }
  return { state: "RETAINED", evidence: record, inScope: inAround(record, filter.around), matchesFilter: matchesFilter(record, filter), blockingCriteria };
}

function findRecords(records: readonly DeterministicEvidenceRecord[], request: EvidenceFindRequest): EvidenceFindResult {
  const matches = records.filter((record) => record.searchText.includes(request.text.trim().toLowerCase()));
  const currentIndex = request.current ? matches.findIndex((record) => record.identity.eventId === request.current?.eventId) : -1;
  return { text: request.text, total: matches.length, current: currentIndex >= 0 ? matches[currentIndex]!.identity : null, previous: matches.length ? matches[(currentIndex - 1 + matches.length) % matches.length]!.identity : null, next: matches.length ? matches[(currentIndex + 1) % matches.length]!.identity : null };
}
