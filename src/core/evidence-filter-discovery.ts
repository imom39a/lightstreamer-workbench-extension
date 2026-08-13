import { FACET_DESCRIPTORS } from "./evidence-facets";
import { evaluateFilter, type FilterRecord } from "./filter-algebra";
import { type DeterministicEvidenceRecord, type EvidenceFilter, type EvidenceReadPoint, type FacetCount, type FacetDiscoveryRequest, type FacetDiscoveryResult, type TypedFacetValue } from "./evidence-filter-contract";

type Cursor = Readonly<{ version: 1; facet: string; search: string; size: number; filter: string; readPoint: string; position: number }>;

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

function readPointKey(readPoint: EvidenceReadPoint): string {
  return JSON.stringify(readPoint);
}

function cursorFor(cursor: Cursor): string {
  return encoded(JSON.stringify(cursor));
}

function parseCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(decoded(value)) as Cursor;
    if (cursor.version !== 1 || !Number.isSafeInteger(cursor.position) || cursor.position < 0) return null;
    return cursor;
  } catch {
    return null;
  }
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

function compareValues(left: TypedFacetValue, right: TypedFacetValue): number {
  return left.type.localeCompare(right.type) || left.value.localeCompare(right.value) || left.identity.localeCompare(right.identity);
}

export function discoverFacet(
  records: readonly DeterministicEvidenceRecord[],
  filter: EvidenceFilter,
  readPoint: EvidenceReadPoint,
  request: FacetDiscoveryRequest
): FacetDiscoveryResult {
  const descriptor = FACET_DESCRIPTORS.find((candidate) => candidate.key === request.facet);
  if (!descriptor || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 100) {
    return unavailable(request.facet, "UNSUPPORTED_AT_READ_POINT", null);
  }
  const search = text(request.search);
  const filterKey = JSON.stringify(filter);
  const pointKey = readPointKey(readPoint);
  const parsed = parseCursor(request.cursor);
  if (request.cursor && (!parsed || parsed.facet !== request.facet || parsed.search !== search || parsed.size !== request.size || parsed.filter !== filterKey || parsed.readPoint !== pointKey)) {
    return unavailable(request.facet, "DISCOVERY_FAILED", null);
  }
  const base = records.filter((record) => matchesBase(record, withoutFacet(filter, request.facet)));
  if (base.length === 0) return unavailable(request.facet, "ZERO_BASE", 0);
  const counts = new Map<string, { value: TypedFacetValue; count: number }>();
  for (const record of base) {
    const value = record.facets[request.facet];
    if (value && (!search || `${descriptor.label} ${value.label} ${value.value}`.toLocaleLowerCase().includes(search))) {
      const existing = counts.get(value.identity);
      if (existing) existing.count += 1;
      else counts.set(value.identity, { value, count: 1 });
    }
  }

  const active = [
    ...(filter.criteria[request.facet]?.include ?? []),
    ...(filter.criteria[request.facet]?.exclude ?? [])
  ];
  const ordered = [...counts.values()].sort((left, right) => compareValues(left.value, right.value));
  if (ordered.length === 0) return unavailable(request.facet, "NO_CONCRETE_VALUES", base.length);

  const position = parsed ? parsed.position : 0;
  const page = ordered.slice(position, position + request.size);
  const nextCursor = position + page.length < ordered.length
    ? cursorFor({ version: 1, facet: request.facet, search, size: request.size, filter: filterKey, readPoint: pointKey, position: position + page.length })
    : null;
  const values: FacetCount[] = page.map(({ value, count }) => Object.freeze({ value, count, pinned: active.some((candidate) => candidate.identity === value.identity) }));
  const pageIdentities = new Set(page.map(({ value }) => value.identity));
  for (const value of active) {
    if (search && !`${descriptor.label} ${value.label} ${value.value}`.toLocaleLowerCase().includes(search)) continue;
    if (!counts.has(value.identity) && !pageIdentities.has(value.identity)) values.push(Object.freeze({ value, count: 0, pinned: true }));
  }
  return Object.freeze({ state: "AVAILABLE", facet: request.facet, values: Object.freeze(values), distinctTotal: ordered.length, nextCursor, baseEvidenceCount: base.length });
}

function unavailable(facet: string, reason: "ZERO_BASE" | "NO_CONCRETE_VALUES" | "DISCOVERY_FAILED" | "UNSUPPORTED_AT_READ_POINT", baseEvidenceCount: number | null): FacetDiscoveryResult {
  return Object.freeze({ state: "UNAVAILABLE", facet, reason, values: Object.freeze([]) as readonly [], distinctTotal: null, nextCursor: null, baseEvidenceCount });
}
