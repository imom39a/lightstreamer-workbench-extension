import {
  type AroundEvidence,
  type DeterministicEvidenceRecord,
  type EvidenceFilter,
  type EvidenceFindRequest,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceLookupResult,
  type EvidenceReadPoint,
  type EvidenceQueryRequest,
  type RevealBlocker,
  type TypedFacetValue
} from "./evidence-filter-contract";
import { normalizeEvidenceSearchText } from "./evidence-facets";
import { encodeEvidenceQueryCursor } from "./evidence-filter-cursor";
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
    const value = record.facets[facet];
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

/** One ordered projection scan supplies exact navigation while keeping bounded data. */
export function createEvidenceFindAccumulator(request: EvidenceFindRequest) {
  let total = 0;
  let first: SelectionRecord | null = null;
  let last: SelectionRecord | null = null;
  let target: SelectionRecord | null = null;
  let previous: SelectionRecord | null = null;
  let next: SelectionRecord | null = null;
  let currentIndex = -1;
  const matches: EvidenceIdentity[] = [];
  const results: SelectionRecord[] = [];
  const size = Math.max(1, Math.min(100, request.size ?? 50));
  let resultCount = 0;
  const distance = (record: SelectionRecord) => request.current === undefined ? record.identity.sequence : Math.abs(record.identity.sequence - request.current.sequence);
  return {
    add(record: SelectionRecord): void {
      first ??= record;
      if (matches.length < 1_000) matches.push(record.identity);
      if (request.after === undefined || record.identity.sequence > request.after.sequence) {
        resultCount += 1;
        if (results.length < size) results.push(record);
      }
      if (target !== null && next === null) next = record;
      if (target === null || distance(record) < distance(target)) {
        target = record;
        previous = last;
        next = null;
        currentIndex = total;
      }
      last = record;
      total += 1;
    },
    result(): EvidenceFindResult {
      return Object.freeze({
        text: request.text, total, currentIndex,
        current: request.current === undefined ? null : target?.identity ?? null,
        first: first?.identity ?? null, last: last?.identity ?? null,
        previous: previous?.identity ?? null, next: next?.identity ?? null,
        matches: Object.freeze(matches), results: Object.freeze(results), hasMore: resultCount > results.length
      });
    }
  };
}

export function findEvidence(records: readonly SelectionRecord[], request: EvidenceFindRequest, eligible: (record: SelectionRecord) => boolean = () => true): EvidenceFindResult {
  const text = normalizeEvidenceSearchText(request.text);
  const accumulator = createEvidenceFindAccumulator(request);
  if (text) for (const record of [...records].sort((a, b) => a.identity.sequence - b.identity.sequence)) {
    if (eligible(record) && normalizeEvidenceSearchText(record.searchText).includes(text)) accumulator.add(record);
  }
  return accumulator.result();
}

/** The reveal page is part of the same read point and query binding as Find. */
export function withEvidenceFindPage(
  find: EvidenceFindResult,
  eligibleRecords: readonly SelectionRecord[],
  request: EvidenceQueryRequest,
  readPoint: EvidenceReadPoint
): EvidenceFindResult {
  if (request.find?.reveal === false) return find;
  const ordered = [...eligibleRecords].sort((a, b) => request.page.order === "NEWEST_FIRST"
    ? b.identity.sequence - a.identity.sequence : a.identity.sequence - b.identity.sequence);
  const target = find.current ?? find.first;
  const targetIndex = target ? ordered.findIndex(record => sameIdentity(record.identity, target)) : -1;
  const offset = targetIndex < 0 ? 0 : Math.max(0, Math.min(ordered.length - request.page.size, targetIndex - Math.floor(request.page.size / 2)));
  const evidence = targetIndex < 0 ? [] : ordered.slice(offset, offset + request.page.size);
  const nextCursor = evidence.length > 0 && offset + evidence.length < ordered.length
    ? encodeEvidenceQueryCursor(readPoint, request, evidence.at(-1)!.identity) : null;
  return Object.freeze({ ...find,
    page: Object.freeze({ evidence: Object.freeze(evidence), nextCursor, offset }),
    window: Object.freeze(request.page.order === "NEWEST_FIRST" ? [...evidence].reverse() : evidence)
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
