import {
  type AroundEvidence,
  type DeterministicEvidenceRecord,
  type EvidenceFilter,
  type EvidenceFindRequest,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceLookupResult,
  type EvidenceReadPoint,
  type RevealBlocker,
  type TypedFacetValue
} from "./evidence-filter-contract";
import { normalizeEvidenceSearchText } from "./evidence-facets";
import { filterValueMatches } from "./filter-algebra";

export type SelectionRecord = DeterministicEvidenceRecord & Readonly<{ payload?: unknown }>;

export function normalizeAround(around: AroundEvidence | null, retainedRange: EvidenceReadPoint["retainedRange"]): AroundEvidence | null {
  if (!around) return null;
  const timestamp = around.anchorTimestamp;
  const start = timestamp === undefined ? around.start : timestamp - 5_000;
  const end = timestamp === undefined ? around.end : timestamp + 5_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return around;
  // The retained range is an identity/sequence range, not a timestamp range.
  // Retained records are the clipping source; never compare sequence numbers
  // with captured timestamps.
  void retainedRange;
  return Object.freeze({ ...around, start, end });
}

export function isInAround(record: Pick<SelectionRecord, "identity" | "timestamp">, around: AroundEvidence | null): boolean {
  return around === null || (
    record.identity.intervalId === around.intervalId
    && record.timestamp >= around.start && record.timestamp < around.end
  );
}

export function lookupEvidence(
  records: readonly SelectionRecord[],
  readPoint: EvidenceReadPoint,
  identity: EvidenceIdentity,
  filter: EvidenceFilter,
  around: AroundEvidence | null
): EvidenceLookupResult {
  const record = records.find((candidate) => sameIdentity(candidate.identity, identity));
  if (!record) return { state: identity.intervalId === readPoint.interval.id ? "NOT_RETAINED" : "OTHER_INTERVAL", identity };
  const blockingCriteria: RevealBlocker[] = [];
  if (filter.text.trim() && !record.searchText.includes(filter.text.trim().toLowerCase())) {
    blockingCriteria.push(Object.freeze({ id: "free-text", criterion: "free-text" }));
  }
  if (around && !isInAround(record, around)) {
    blockingCriteria.push(Object.freeze({ id: "around-evidence", criterion: "around-evidence" }));
  }
  for (const [facet, bucket] of Object.entries(filter.criteria)) {
    if (!bucket) continue;
    const value = facet === "legacy:item-position" ? record.facets.item : record.facets[facet];
    if (bucket.include.length > 0 && (!value || !bucket.include.some((candidate) => filterValueMatches(value, candidate)))) {
      for (const criterion of bucket.include) blockingCriteria.push(criterionBlocker(facet, "include", criterion));
    }
    if (value && bucket.exclude.some((candidate) => filterValueMatches(value, candidate))) {
      for (const criterion of bucket.exclude.filter((candidate) => filterValueMatches(value, candidate))) blockingCriteria.push(criterionBlocker(facet, "exclude", criterion));
    }
  }
  for (const unsupported of filter.unsupported) blockingCriteria.push(Object.freeze({ id: unsupported.id, criterion: unsupported }));
  const evidence = Object.freeze({ ...record, ...(record.payload === undefined ? {} : { payload: immutableClone(record.payload) }) });
  return Object.freeze({ state: "RETAINED", evidence, inScope: isInAround(record, around), matchesFilter: blockingCriteria.length === 0, blockingCriteria: Object.freeze(blockingCriteria) });
}

export function findEvidence(records: readonly SelectionRecord[], request: EvidenceFindRequest): EvidenceFindResult {
  const text = normalizeEvidenceSearchText(request.text);
  const orderedRecords = [...records].sort((left, right) => left.identity.sequence - right.identity.sequence || left.identity.eventId.localeCompare(right.identity.eventId));
  const matches = orderedRecords.filter((record) => normalizeEvidenceSearchText(record.searchText).includes(text));
  const currentIndex = request.current ? matches.findIndex((record) => sameIdentity(record.identity, request.current!)) : -1;
  const fallbackIndex = currentIndex >= 0 ? currentIndex : nearestIndex(matches, request.current);
  const current = currentIndex >= 0 || request.current !== undefined
    ? (fallbackIndex >= 0 ? matches[fallbackIndex]!.identity : null)
    : null;
  const windowRecord = fallbackIndex >= 0 ? matches[fallbackIndex] : matches[0];
  const windowStart = windowRecord
    ? Math.max(0, orderedRecords.findIndex((record) => sameIdentity(record.identity, windowRecord.identity)) - 50)
    : 0;
  const window = orderedRecords.slice(windowStart, windowStart + 100);
  const nextRecord = fallbackIndex >= 0 && fallbackIndex + 1 < matches.length ? matches[fallbackIndex + 1] : undefined;
  const nextWindowStart = nextRecord
    ? Math.max(0, orderedRecords.findIndex((record) => sameIdentity(record.identity, nextRecord.identity)) - 50)
    : -1;
  const result: EvidenceFindResult = {
    text: request.text,
    total: matches.length,
    current,
    previous: fallbackIndex >= 0 && fallbackIndex > 0 ? matches[fallbackIndex - 1]!.identity : null,
    next: fallbackIndex >= 0 && fallbackIndex + 1 < matches.length ? matches[fallbackIndex + 1]!.identity : null,
  };
  if (request.scopeToFilter) {
    return Object.freeze({
      ...result,
      first: matches[0]?.identity ?? null,
      window: Object.freeze(window),
      matches: Object.freeze(matches.slice(0, 1_000).map((record) => record.identity)),
      ...(nextWindowStart >= 0
        ? { nextWindow: Object.freeze(orderedRecords.slice(nextWindowStart, nextWindowStart + 100)) }
        : {})
    });
  }
  return Object.freeze(result);
}

/** Apply only the blockers returned for one retained selection. */
export function revealFilter(filter: EvidenceFilter, blockers: readonly RevealBlocker[]): EvidenceFilter {
  let next: EvidenceFilter = filter;
  for (const blocker of blockers) {
    if (blocker.criterion === "free-text") next = { ...next, text: "" };
    else if (blocker.criterion === "around-evidence") next = { ...next, around: null };
    else if (typeof blocker.criterion === "object" && "facet" in blocker.criterion && "polarity" in blocker.criterion) {
      const criterion = blocker.criterion;
      const bucket = next.criteria[criterion.facet];
      if (!bucket) continue;
      next = { ...next, criteria: { ...next.criteria, [criterion.facet]: {
        include: criterion.polarity === "include" ? bucket.include.filter((value) => value.identity !== criterion.value.identity) : bucket.include,
        exclude: criterion.polarity === "exclude" ? bucket.exclude.filter((value) => value.identity !== criterion.value.identity) : bucket.exclude
      } } };
    } else if (typeof blocker.criterion === "object" && "id" in blocker.criterion) {
      next = { ...next, unsupported: next.unsupported.filter((criterion) => criterion.id !== blocker.id) };
    }
  }
  return Object.freeze(next);
}

function nearestIndex(records: readonly SelectionRecord[], current: EvidenceIdentity | undefined): number {
  if (!current || records.length === 0) return records.length ? 0 : -1;
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < records.length; index += 1) {
    const candidate = records[index]!.identity;
    const candidateDistance = Math.abs(candidate.sequence - current.sequence);
    if (candidateDistance < distance || (candidateDistance === distance && candidate.sequence < records[best]!.identity.sequence)) {
      best = index;
      distance = candidateDistance;
    }
  }
  return best;
}

function criterionBlocker(facet: string, polarity: "include" | "exclude", value: TypedFacetValue): RevealBlocker {
  return Object.freeze({
    id: `${facet}:${polarity}:${value.identity}`,
    criterion: Object.freeze({ id: `${facet}:${polarity}:${value.identity}`, facet, polarity, value })
  });
}

function sameIdentity(left: EvidenceIdentity, right: EvidenceIdentity): boolean {
  return left.intervalId === right.intervalId && left.pageId === right.pageId && left.ownerId === right.ownerId && left.sequence === right.sequence && left.eventId === right.eventId;
}

function immutableClone(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutableClone));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutableClone(child)])));
}
