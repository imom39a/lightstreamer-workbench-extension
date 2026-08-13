import { FACET_DESCRIPTORS } from "./evidence-facets";
import { evaluateFilter, type FilterRecord } from "./filter-algebra";
import { type DeterministicEvidenceRecord, type EvidenceFilter, type EvidenceReadPoint, type FacetCount, type FacetDiscoveryRequest, type FacetDiscoveryResult, type TypedFacetValue } from "./evidence-filter-contract";

/**
 * Discovery keeps exact accounting compact, but bounds typed candidate
 * materialization to the requested page plus active pins. The bound is part
 * of the memory-only contract and is intentionally independent of history
 * cardinality.
 */
export const DISCOVERY_CANDIDATE_BOUND_DESCRIPTION = "page size + active pins";

export type DiscoveryInstrumentation = Readonly<{
  onResult?: (stats: Readonly<{ compactIdentityCount: number; materializedCandidates: number; materializationBound: number; candidateCount: number }>) => void;
  fail?: () => void;
}>;

export type DiscoveryAggregateObservation = Readonly<{ sequence: number; eventId: string }>;
export type DiscoveryAggregateEntry = Readonly<{ value: TypedFacetValue; count: number; observations: readonly DiscoveryAggregateObservation[] }>;

type Cursor = Readonly<{
  version: 1;
  facet: string;
  search: string;
  size: number;
  filter: string;
  readPoint: string;
  position: number;
  anchor: string | null;
}>;

type CompactValue = { facet: string; type: string; value: string; label: string; identity: string; sortKey: string; count: number };

const text = (value: string | undefined): string => (value ?? "").trim().toLocaleLowerCase();
function encoded(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decoded(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
function readPointKey(readPoint: EvidenceReadPoint): string { return JSON.stringify(readPoint); }
function cursorFor(cursor: Cursor): string { return encoded(JSON.stringify(cursor)); }

function parseCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(decoded(value)) as Partial<Cursor>;
    const size = cursor.size;
    const position = cursor.position;
    if (cursor.version !== 1 || typeof cursor.facet !== "string" || typeof cursor.search !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 ||
      typeof cursor.filter !== "string" || typeof cursor.readPoint !== "string" || typeof position !== "number" || !Number.isSafeInteger(position) || position < 1 ||
      (cursor.anchor !== null && typeof cursor.anchor !== "string")) return null;
    return cursor as Cursor;
  } catch { return null; }
}

function withoutFacet(filter: EvidenceFilter, facet: string): EvidenceFilter {
  const criteria = { ...filter.criteria };
  delete criteria[facet];
  return { ...filter, criteria };
}

function matchesBase(record: DeterministicEvidenceRecord, filter: EvidenceFilter): boolean {
  const evaluation = evaluateFilter({ ...filter, around: null } as never, {
    timestamp: record.timestamp,
    intervalId: record.identity.intervalId,
    searchText: record.searchText,
    facets: record.facets as unknown as FilterRecord["facets"]
  });
  return evaluation.matches && (filter.around === null || (
    record.identity.intervalId === filter.around.intervalId && record.timestamp >= filter.around.start && record.timestamp < filter.around.end
  ));
}

function compareValues(left: Pick<CompactValue, "type" | "value" | "identity">, right: Pick<CompactValue, "type" | "value" | "identity">): number {
  return left.type.localeCompare(right.type) || left.value.localeCompare(right.value) || left.identity.localeCompare(right.identity);
}

function compact(value: TypedFacetValue): CompactValue {
  return { facet: value.facet, type: value.type, value: value.value, label: value.label, identity: value.identity, sortKey: JSON.stringify([value.type, value.value, value.identity]), count: 1 };
}

function compareSortKey(value: CompactValue, anchor: string): number {
  try {
    const [type, rawValue, identity] = JSON.parse(anchor) as [string, string, string];
    return compareValues(value, { type, value: rawValue, identity });
  } catch {
    return 1;
  }
}

function matchesSearch(descriptorLabel: string, value: CompactValue, search: string): boolean {
  return !search || `${descriptorLabel} ${value.label} ${value.value}`.toLocaleLowerCase().includes(search);
}

/** Selects the first page after an anchor without retaining the preceding set. */
function selectPage(values: Iterable<CompactValue>, anchor: string | null, size: number): CompactValue[] {
  const selected: CompactValue[] = [];
  for (const candidate of values) {
    if (anchor !== null && compareSortKey(candidate, anchor) <= 0) continue;
    let index = selected.findIndex((entry) => compareValues(candidate, entry) < 0);
    if (index < 0) index = selected.length;
    selected.splice(index, 0, candidate);
    if (selected.length > size) selected.pop();
  }
  return selected;
}

function unavailable(facet: string, reason: "ZERO_BASE" | "NO_CONCRETE_VALUES" | "DISCOVERY_FAILED" | "UNSUPPORTED_AT_READ_POINT", baseEvidenceCount: number | null): FacetDiscoveryResult {
  return Object.freeze({ state: "UNAVAILABLE", facet, reason, values: Object.freeze([]) as readonly [], distinctTotal: null, nextCursor: null, baseEvidenceCount });
}

function discoverFromAccounting(
  accounting: Map<string, CompactValue>,
  baseEvidenceCount: number,
  filter: EvidenceFilter,
  readPoint: EvidenceReadPoint,
  request: FacetDiscoveryRequest,
  instrumentation: DiscoveryInstrumentation
): FacetDiscoveryResult {
  const descriptor = FACET_DESCRIPTORS.find((candidate) => candidate.key === request.facet);
  if (!descriptor || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 100) return unavailable(request.facet, "UNSUPPORTED_AT_READ_POINT", null);
  const search = text(request.search);
  const filterKey = JSON.stringify(filter);
  const pointKey = readPointKey(readPoint);
  const parsed = parseCursor(request.cursor);
  const hasCursor = request.cursor !== undefined;
  if (hasCursor && (!parsed || parsed.facet !== request.facet || parsed.search !== search || parsed.size !== request.size || parsed.filter !== filterKey || parsed.readPoint !== pointKey)) return unavailable(request.facet, "DISCOVERY_FAILED", null);

  const active = [...(filter.criteria[request.facet]?.include ?? []), ...(filter.criteria[request.facet]?.exclude ?? [])];
  const activeIdentities = new Set(active.map((value) => value.identity));
  let distinctTotal = 0;
  for (const value of accounting.values()) if (matchesSearch(descriptor.label, value, search)) distinctTotal += 1;
  const searched = function* (): Iterable<CompactValue> {
    for (const value of accounting.values()) if (matchesSearch(descriptor.label, value, search)) yield value;
  };
  const orderedPage = selectPage(searched(), parsed?.anchor ?? null, request.size);
  const position = parsed?.position ?? 0;
  if (parsed) {
    if (position >= distinctTotal || parsed.anchor === null) return unavailable(request.facet, "DISCOVERY_FAILED", null);
    let anchorRank = 0;
    let anchorFound = false;
    for (const candidate of searched()) {
      const relation = compareSortKey(candidate, parsed.anchor);
      if (relation < 0) anchorRank += 1;
      if (candidate.sortKey === parsed.anchor) anchorFound = true;
    }
    if (!anchorFound || anchorRank !== position - 1) return unavailable(request.facet, "DISCOVERY_FAILED", null);
  }
  if (baseEvidenceCount === 0) return unavailable(request.facet, "ZERO_BASE", 0);
  if (distinctTotal === 0 && active.length === 0) return unavailable(request.facet, "NO_CONCRETE_VALUES", baseEvidenceCount);
  const nextPosition = position + orderedPage.length;
  const values: FacetCount[] = orderedPage.map((entry) => Object.freeze({ value: Object.freeze({ facet: entry.facet, type: entry.type, value: entry.value, label: entry.label, identity: entry.identity }), count: entry.count, pinned: activeIdentities.has(entry.identity) }));
  const returned = new Set(values.map((entry) => entry.value.identity));
  // Pins intentionally bypass label search and page ordering. An observed
  // active value keeps its exact base count; an unobserved value is zero.
  for (const value of active) {
    if (returned.has(value.identity)) continue;
    const observed = accounting.get(value.identity);
    values.push(Object.freeze({ value, count: observed?.count ?? 0, pinned: true }));
  }
  const materializationBound = request.size + active.length;
  instrumentation.onResult?.({ compactIdentityCount: accounting.size, materializedCandidates: values.length, materializationBound, candidateCount: baseEvidenceCount });
  const nextCursor = nextPosition < distinctTotal && orderedPage.length > 0
    ? cursorFor({ version: 1, facet: request.facet, search, size: request.size, filter: filterKey, readPoint: pointKey, position: nextPosition, anchor: orderedPage.at(-1)!.sortKey })
    : null;
  return Object.freeze({ state: "AVAILABLE", facet: request.facet, values: Object.freeze(values), distinctTotal, nextCursor, baseEvidenceCount });
}

export function discoverFacet(
  records: readonly DeterministicEvidenceRecord[],
  filter: EvidenceFilter,
  readPoint: EvidenceReadPoint,
  request: FacetDiscoveryRequest,
  instrumentation: DiscoveryInstrumentation = {}
): FacetDiscoveryResult {
  instrumentation.fail?.();
  const base = records.filter((record) => matchesBase(record, withoutFacet(filter, request.facet)));
  if (base.length === 0 && request.cursor === undefined) return unavailable(request.facet, "ZERO_BASE", 0);

  // This is compact identity accounting: it retains no TypedFacetValue
  // objects and no complete sorted order. It is the exact source for counts
  // and distinctTotal; ordered selection below is bounded by page size.
  const accounting = new Map<string, CompactValue>();
  for (const record of base) {
    const value = record.facets[request.facet];
    if (!value) continue;
    const existing = accounting.get(value.identity);
    if (existing) existing.count += 1;
    else accounting.set(value.identity, compact(value));
  }
  return discoverFromAccounting(accounting, base.length, filter, readPoint, request, instrumentation);
}

/**
 * Exact discovery from a transactionally maintained aggregate catalog plus its
 * versioned posting observations. The catalog is only a compact identity
 * source; counts and event identities come from the postings, while paging,
 * pins, cursor validation, typed ordering, and unavailable states remain the
 * same oracle as record-backed discovery.
 */
export function discoverFacetFromAggregates(
  entries: readonly DiscoveryAggregateEntry[],
  baseEvidenceCount: number,
  filter: EvidenceFilter,
  readPoint: EvidenceReadPoint,
  request: FacetDiscoveryRequest,
  instrumentation: DiscoveryInstrumentation = {}
): FacetDiscoveryResult {
  instrumentation.fail?.();
  const accounting = new Map<string, CompactValue>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.count) || entry.count < 1 || entry.value.facet !== request.facet) {
      throw new Error("The facet discovery aggregate is corrupt.");
    }
    const existing = accounting.get(entry.value.identity);
    if (existing) {
      if (existing.facet !== entry.value.facet || existing.type !== entry.value.type || existing.value !== entry.value.value || existing.label !== entry.value.label) {
        throw new Error("The facet discovery aggregate contains conflicting identities.");
      }
      existing.count += entry.count;
    } else {
      accounting.set(entry.value.identity, { ...compact(entry.value), count: entry.count });
    }
  }
  return discoverFromAccounting(accounting, baseEvidenceCount, filter, readPoint, request, instrumentation);
}
