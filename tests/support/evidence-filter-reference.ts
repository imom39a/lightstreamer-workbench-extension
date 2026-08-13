import {
  DEFAULT_FILTER_INTERVAL,
  type AroundEvidence,
  type DeterministicEvidenceRecord,
  type EvidenceFilter,
  type EvidenceFilterFacet,
  type EvidenceFilterLifecycleState,
  type EvidenceFilterQueryAdapter,
  type EvidenceFilterReadProblem,
  type EvidenceFindRequest,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceLookupResult,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryRequest,
  type FacetDiscoveryResult,
  type RevealBlocker,
  type UnsupportedCriterion
} from "../../src/core/evidence-filter-contract";

type ReferenceOptions = Readonly<{
  storage?: "INDEXED_DB" | "MEMORY_FALLBACK";
  coverage?: "COMPLETE" | "LIMITED";
  interval?: Readonly<{ id: string; ordinal: number }>;
  maxRecords?: number;
}>;

export function createReferenceFilterAdapter(
  records: readonly DeterministicEvidenceRecord[],
  options: ReferenceOptions = {}
): EvidenceFilterQueryAdapter {
  return new ReferenceFilterAdapter(records, options);
}

class ReferenceFilterAdapter implements EvidenceFilterQueryAdapter {
  private readonly records: readonly DeterministicEvidenceRecord[];
  private readonly interval: Readonly<{ id: string; ordinal: number }>;
  private readonly storage: ReferenceOptions["storage"];
  private readonly coverage: ReferenceOptions["coverage"];

  constructor(records: readonly DeterministicEvidenceRecord[], options: ReferenceOptions) {
    const capacity = options.maxRecords ?? (options.storage === "MEMORY_FALLBACK" ? 5_000 : 10_000);
    this.records = Object.freeze([...records].slice(-capacity));
    this.interval = options.interval ?? DEFAULT_FILTER_INTERVAL;
    this.storage = options.storage ?? "INDEXED_DB";
    this.coverage = options.coverage ?? "COMPLETE";
  }

  query(request: EvidenceQueryRequest): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
    const boundary = this.records.at(-1)?.identity ?? null;
    const readPoint: EvidenceReadPoint = Object.freeze({
      interval: this.interval,
      committedEvidenceBoundary: boundary,
      retainedRange: this.records.length ? Object.freeze({ first: this.records[0]!.identity, last: boundary! }) : null
    });
    if (request.at !== "LATEST_COMMITTED" && (request.at.interval.id !== this.interval.id || request.at.interval.ordinal !== this.interval.ordinal)) {
      return Promise.resolve({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE", message: "The requested History Interval is unavailable." } });
    }
    if (request.at !== "LATEST_COMMITTED" && !readPointMatches(request.at.committedEvidenceBoundary, boundary)) {
      return Promise.resolve({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE", message: "The requested committed Evidence Boundary is unavailable." } });
    }
    if (request.at !== "LATEST_COMMITTED" && !rangeMatches(request.at.retainedRange, readPoint.retainedRange)) {
      return Promise.resolve({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE", message: "The requested Retained Range is unavailable." } });
    }
    if (!Number.isSafeInteger(request.page.size) || request.page.size < 1) {
      return Promise.resolve({ ok: false, problem: { code: "QUERY_FAILED", message: "Page size must be a positive integer." } });
    }
    if (request.filter.unsupported.length > 0) {
      const discoveries = new Map<EvidenceFilterFacet, FacetDiscoveryResult>();
      for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, unavailableDiscovery(discovery.facet));
      return Promise.resolve({ ok: true, value: makeSnapshot(readPoint, this.records, request, [], 0, 0, discoveries, "UNSUPPORTED_FILTER", this.coverage!, this.storage!) });
    }
    const matching = this.records.filter((record) => matchesFilter(record, request.filter));
    const inScope = matching.filter((record) => inAround(record, request.filter.around));
    const discoveries = new Map<EvidenceFilterFacet, FacetDiscoveryResult>();
    for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, discover(inScope, discovery));
    const ordered = request.page.order === "NEWEST_FIRST" ? [...inScope].reverse() : inScope;
    const start = cursorValue(request.page.cursor);
    const page = ordered.slice(start, start + request.page.size);
    return Promise.resolve({ ok: true, value: makeSnapshot(readPoint, this.records, request, page, matching.length, inScope.length, discoveries, "COMPLETE", this.coverage!, this.storage!, start + page.length < ordered.length ? String(start + page.length) : null) });
  }
}

function makeSnapshot(
  readPoint: EvidenceReadPoint,
  records: readonly DeterministicEvidenceRecord[],
  request: EvidenceQueryRequest,
  page: readonly DeterministicEvidenceRecord[],
  matching: number,
  inScope: number,
  discoveries: ReadonlyMap<EvidenceFilterFacet, FacetDiscoveryResult>,
  evaluation: EvidenceSnapshot["evaluation"],
  coverage: "COMPLETE" | "LIMITED",
  storage: "INDEXED_DB" | "MEMORY_FALLBACK",
  nextCursor: string | null = null
): EvidenceSnapshot {
  return Object.freeze({
    readPoint,
    page: Object.freeze({ evidence: Object.freeze(page), nextCursor }),
    totals: Object.freeze({ matching, inScope }),
    discoveries,
    lookup: request.lookup ? lookupRecord(readPoint, records, request.lookup, request.filter) : null,
    find: request.find ? findRecords(records, request.find) : null,
    evaluation,
    coverage,
    storage
  });
}

export function createReferenceLifecycleHarness(records: readonly DeterministicEvidenceRecord[], options: ReferenceOptions = {}) {
  return new ReferenceLifecycleHarness(records, options);
}

class ReferenceLifecycleHarness implements EvidenceFilterQueryAdapter {
  private records: readonly DeterministicEvidenceRecord[];
  private interval: Readonly<{ id: string; ordinal: number }> = DEFAULT_FILTER_INTERVAL;
  private phase: EvidenceFilterLifecycleState["phase"] = "ACTIVE";
  private readonly options: ReferenceOptions;
  private adapter: EvidenceFilterQueryAdapter;

  constructor(records: readonly DeterministicEvidenceRecord[], options: ReferenceOptions) {
    const capacity = options.maxRecords ?? (options.storage === "MEMORY_FALLBACK" ? 5_000 : 10_000);
    this.records = Object.freeze([...records].slice(-capacity));
    this.options = options;
    this.adapter = createReferenceFilterAdapter(this.records, { ...options, interval: this.interval });
  }

  query(request: EvidenceQueryRequest) {
    return this.adapter.query(request);
  }

  capture(record: DeterministicEvidenceRecord): void {
    if (this.phase !== "ACTIVE") throw new Error("Capture is unavailable after the history becomes terminal.");
    this.records = Object.freeze([...this.records, record]);
    this.adapter = createReferenceFilterAdapter(this.records, { ...this.options, interval: this.interval });
  }

  clear(): void {
    if (this.phase === "TERMINAL") throw new Error("Terminal history cannot be cleared.");
    this.records = Object.freeze([]);
    this.interval = Object.freeze({ id: `${this.interval.id}-cleared`, ordinal: this.interval.ordinal + 1 });
    this.adapter = createReferenceFilterAdapter(this.records, { ...this.options, interval: this.interval });
  }

  terminate(): void {
    this.phase = "TERMINAL";
  }

  state(): EvidenceFilterLifecycleState {
    const first = this.records[0]?.identity;
    const last = this.records.at(-1)?.identity ?? null;
    return Object.freeze({
      phase: this.phase,
      interval: this.interval,
      committedEvidenceBoundary: last,
      retainedRange: first && last ? Object.freeze({ first, last }) : null,
      coverage: this.options.coverage ?? "COMPLETE",
      storage: this.options.storage ?? "INDEXED_DB"
    });
  }
}

export function readPointMatches(left: EvidenceIdentity | null, right: EvidenceIdentity | null): boolean {
  if (left === null || right === null) return left === right;
  return left.intervalId === right.intervalId && left.pageId === right.pageId && left.ownerId === right.ownerId && left.sequence === right.sequence && left.eventId === right.eventId;
}

function rangeMatches(left: EvidenceReadPoint["retainedRange"], right: EvidenceReadPoint["retainedRange"]): boolean {
  if (left === null || right === null) return left === right;
  return readPointMatches(left.first, right.first) && readPointMatches(left.last, right.last);
}

function cursorValue(cursor: string | undefined): number {
  const value = cursor === undefined ? 0 : Number(cursor);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function matchesFilter(record: DeterministicEvidenceRecord, filter: EvidenceFilter): boolean {
  if (filter.text.trim() && !record.searchText.includes(filter.text.trim().toLowerCase())) return false;
  for (const [facet, bucket] of Object.entries(filter.criteria) as [EvidenceFilterFacet, { include: readonly { identity: string }[]; exclude: readonly { identity: string }[] } | undefined][]) {
    if (!bucket) continue;
    const value = record.facets[facet];
    if (bucket.include.length > 0 && (!value || !bucket.include.some((candidate) => candidate.identity === value.identity))) return false;
    if (value && bucket.exclude.some((candidate) => candidate.identity === value.identity)) return false;
  }
  return true;
}

function inAround(record: DeterministicEvidenceRecord, around: AroundEvidence | null): boolean {
  return !around || (record.identity.intervalId === around.intervalId && record.timestamp >= around.start && record.timestamp < around.end);
}

function unavailableDiscovery(facet: EvidenceFilterFacet): FacetDiscoveryResult {
  return { state: "UNAVAILABLE", facet, reason: "UNSUPPORTED_AT_READ_POINT", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null };
}

function discover(records: readonly DeterministicEvidenceRecord[], request: FacetDiscoveryRequest): FacetDiscoveryResult {
  const values = new Map<string, { value: NonNullable<DeterministicEvidenceRecord["facets"][EvidenceFilterFacet]>; count: number }>();
  for (const record of records) {
    const value = record.facets[request.facet];
    if (!value || (request.search && !`${value.label} ${value.value}`.toLowerCase().includes(request.search.toLowerCase()))) continue;
    const existing = values.get(value.identity);
    if (existing) existing.count += 1; else values.set(value.identity, { value, count: 1 });
  }
  const ordered = [...values.values()].sort((left, right) => left.value.identity.localeCompare(right.value.identity));
  const start = cursorValue(request.cursor);
  const selected = ordered.slice(start, start + request.size).map(({ value, count }) => Object.freeze({ value, count, pinned: false }));
  return Object.freeze({ state: "AVAILABLE", facet: request.facet, values: Object.freeze(selected), distinctTotal: ordered.length, nextCursor: start + selected.length < ordered.length ? String(start + selected.length) : null, baseEvidenceCount: records.length });
}

function lookupRecord(readPoint: EvidenceReadPoint, records: readonly DeterministicEvidenceRecord[], identity: EvidenceIdentity, filter: EvidenceFilter): EvidenceLookupResult {
  const record = records.find((candidate) => readPointMatches(candidate.identity, identity));
  if (!record) return { state: identity.intervalId === readPoint.interval.id ? "NOT_RETAINED" : "OTHER_INTERVAL", identity };
  const blockingCriteria: RevealBlocker[] = [];
  if (filter.text.trim() && !record.searchText.includes(filter.text.trim().toLowerCase())) blockingCriteria.push({ id: "free-text", criterion: "free-text" });
  if (filter.around && !inAround(record, filter.around)) blockingCriteria.push({ id: "around-evidence", criterion: "around-evidence" });
  for (const [facet, bucket] of Object.entries(filter.criteria) as [EvidenceFilterFacet, { include: readonly { identity: string }[]; exclude: readonly { identity: string }[] } | undefined][]) {
    if (!bucket) continue;
    const value = record.facets[facet];
    if (bucket.include.length > 0 && (!value || !bucket.include.some((candidate) => candidate.identity === value.identity))) blockingCriteria.push({ id: `${facet}:include`, criterion: "free-text" });
    if (value && bucket.exclude.some((candidate) => candidate.identity === value.identity)) blockingCriteria.push({ id: `${facet}:exclude`, criterion: "free-text" });
  }
  return { state: "RETAINED", evidence: record, inScope: inAround(record, filter.around), matchesFilter: matchesFilter(record, filter), blockingCriteria };
}

function findRecords(records: readonly DeterministicEvidenceRecord[], request: EvidenceFindRequest): EvidenceFindResult {
  const matches = records.filter((record) => record.searchText.includes(request.text.trim().toLowerCase()));
  const currentIndex = request.current ? matches.findIndex((record) => readPointMatches(record.identity, request.current ?? null)) : -1;
  return { text: request.text, total: matches.length, current: currentIndex >= 0 ? matches[currentIndex]!.identity : null, previous: matches.length ? matches[(currentIndex - 1 + matches.length) % matches.length]!.identity : null, next: matches.length ? matches[(currentIndex + 1) % matches.length]!.identity : null };
}
