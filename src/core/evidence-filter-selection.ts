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

export function findEvidence(records: readonly SelectionRecord[], request: EvidenceFindRequest, eligible: (record: SelectionRecord) => boolean = () => true): EvidenceFindResult {
  const text = normalizeEvidenceSearchText(request.text);
  const orderedRecords = [...records].sort((left, right) => left.identity.sequence - right.identity.sequence || left.identity.eventId.localeCompare(right.identity.eventId));
  const firstMatches: EvidenceIdentity[] = [];
  const nearby: SelectionRecord[] = [];
  let total = 0;
  let firstMatch: SelectionRecord | undefined;
  let lastMatch: SelectionRecord | undefined;
  let exactCurrent: SelectionRecord | undefined;
  let previousExact: SelectionRecord | undefined;
  let nextExact: SelectionRecord | undefined;
  const addNearby = (record: SelectionRecord): void => {
    if (request.current === undefined) {
      if (nearby.length < 2) nearby.push(record);
      return;
    }
    nearby.push(record);
    nearby.sort((left, right) => Math.abs(left.identity.sequence - request.current!.sequence) - Math.abs(right.identity.sequence - request.current!.sequence)
      || left.identity.sequence - right.identity.sequence || left.identity.eventId.localeCompare(right.identity.eventId));
    if (nearby.length > 8) nearby.pop();
  };
  for (const record of orderedRecords) {
    if (!eligible(record) || !normalizeEvidenceSearchText(record.searchText).includes(text)) continue;
    total += 1;
    firstMatch ??= record;
    if (firstMatches.length < 1_000) firstMatches.push(record.identity);
    addNearby(record);
    if (request.current !== undefined && sameIdentity(record.identity, request.current)) {
      exactCurrent = record;
      previousExact = lastMatch;
    } else if (exactCurrent !== undefined && nextExact === undefined) {
      nextExact = record;
    }
    lastMatch = record;
  }
  const nearbyOrdered = [...nearby].sort((left, right) => left.identity.sequence - right.identity.sequence || left.identity.eventId.localeCompare(right.identity.eventId));
  const fallback = request.current === undefined ? firstMatch : (exactCurrent ?? nearby[0]);
  const fallbackIndex = fallback === undefined ? -1 : nearbyOrdered.findIndex((record) => sameIdentity(record.identity, fallback.identity));
  const target = fallback ?? null;
  const current = request.current === undefined ? null : target?.identity ?? null;
  const previous = exactCurrent
    ? previousExact?.identity ?? null
    : fallbackIndex > 0 ? nearbyOrdered[fallbackIndex - 1]!.identity : null;
  const next = exactCurrent
    ? nextExact?.identity ?? null
    : fallbackIndex >= 0 && fallbackIndex + 1 < nearbyOrdered.length ? nearbyOrdered[fallbackIndex + 1]!.identity : null;
  const windowRecord = target ?? firstMatch;
  const windowStart = windowRecord
    ? Math.max(0, orderedRecords.findIndex((record) => sameIdentity(record.identity, windowRecord.identity)) - 50)
    : 0;
  const window = windowRecord === undefined ? [] : orderedRecords.slice(windowStart, windowStart + 100);
  const nextRecord = next === null ? undefined : orderedRecords.find((record) => sameIdentity(record.identity, next));
  const nextWindowStart = nextRecord
    ? Math.max(0, orderedRecords.findIndex((record) => sameIdentity(record.identity, nextRecord.identity)) - 50)
    : -1;
  const result: EvidenceFindResult = {
    text: request.text,
    total,
    current,
    previous,
    next,
  };
  return Object.freeze({
    ...result,
    first: firstMatch?.identity ?? null,
    window: Object.freeze(window),
    matches: Object.freeze(firstMatches),
    ...(nextWindowStart >= 0
      ? { nextWindow: Object.freeze(orderedRecords.slice(nextWindowStart, nextWindowStart + 100)) }
      : {})
  });
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
