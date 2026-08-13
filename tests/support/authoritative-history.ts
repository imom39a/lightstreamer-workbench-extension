import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import {
  copyCandidate,
  pageEvidence,
  selectEvidence,
  type CaptureReceipt,
  type CloseResult,
  type CommittedEvidence,
  type EvidenceCandidate,
  type EvidenceQuery,
  type EvidenceRead,
  type EvidenceRef,
  type EventHistory,
  type HistoryInterval,
  type HistoryProblem,
  type HistoryPublication,
  type HistoryStatus,
  type Outcome,
  type TopologyCheckpointEvidenceCandidate
} from "../../src/core/event-history-authoritative";
import {
  type DeterministicEvidenceRecord,
  type EvidenceFilter,
  type EvidenceFilterReadProblem,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryResult
} from "../../src/core/evidence-filter-contract";
import { canonicalEvidenceSearchText, extractEvidenceFacets } from "../../src/core/evidence-facets";
import { typedFacetValue } from "../../src/core/evidence-filter-contract";
import { discoverFacet } from "../../src/core/evidence-filter-discovery";
import { findEvidence, isInAround, lookupEvidence, normalizeAround, type SelectionRecord } from "../../src/core/evidence-filter-selection";
import { evaluateFilter, type FilterInput, type FilterRecord } from "../../src/core/filter-algebra";

export type AuthoritativeHistoryOfferDecision = "commit" | "refuse";

export type AuthoritativeHistoryOptions = Readonly<{
  /** The first interval's complete, already-accepted Evidence in Capture order. */
  precommitted?: readonly (
    | LightstreamerEventEnvelope
    | TopologyCheckpointEvidenceCandidate
  )[];
  /** A fixed decision for each subsequent offer; unspecified offers commit. */
  offerDecisions?: readonly AuthoritativeHistoryOfferDecision[];
  /** Optional per-offer control, evaluated after the fixed decision list. */
  decideOffer?: (
    candidate: EvidenceCandidate,
    offerNumber: number
  ) => AuthoritativeHistoryOfferDecision;
  /** Optional test control for holding a read until the supplied release callback runs. */
  readControl?: (query: EvidenceQuery, release: () => void) => void;
  /** Fixed initial interval identity; the default is deterministic. */
  intervalId?: string;
}>;

type Subscriber = {
  observer: (publication: HistoryPublication) => void;
  replaying: boolean;
  pending: HistoryPublication[];
};

/**
 * Creates a synchronous, storage-free implementation of the raw authoritative
 * EventHistory seam for runtime tests. It deliberately does not use the legacy
 * EventHistory adapter or any production history factory.
 */
export function createAuthoritativeHistory(
  options: AuthoritativeHistoryOptions = {}
): EventHistory {
  const initialIntervalId = options.intervalId ?? "authoritative-test:interval-1";
  const sessionId = initialIntervalId.replace(/:interval-\d+$/, "");
  const subscribers = new Set<Subscriber>();
  const allEvidence: CommittedEvidence[] = [];
  let intervalOrdinal = 1;
  let interval = intervalFor(intervalOrdinal);
  let currentEvidence: CommittedEvidence[] = [];
  let nextSequence = 1;
  let offerNumber = 0;
  let notAccepted = 0;
  let closed = false;
  let closeOutcome: Outcome<CloseResult> | null = null;
  let historyObject: EventHistory;

  for (const candidate of options.precommitted ?? []) {
    appendCommitted(candidate);
  }

  function intervalFor(ordinal: number): HistoryInterval {
    return Object.freeze({
      id: ordinal === 1 ? initialIntervalId : `${sessionId}:interval-${ordinal}`,
      ordinal
    });
  }

  function currentBoundary(): EvidenceRef | null {
    const last = currentEvidence.at(-1);
    return last ? toRef(last) : null;
  }

  function retainedRange(): Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null {
    const first = currentEvidence[0];
    const last = currentEvidence.at(-1);
    return first && last ? { first: toRef(first), last: toRef(last) } : null;
  }

  function status(): HistoryStatus {
    return Object.freeze({
      phase: closed ? "CLOSED" : "RUNNING",
      captureOperation: closed ? "STOPPED" : "RUNNING",
      interval,
      committedEvidenceBoundary: currentBoundary(),
      retainedRange: retainedRange(),
      capacity: { tier: "NORMAL", state: "AVAILABLE" } as const,
      fallback: null,
      captured: allEvidence.length + notAccepted,
      awaitingAcceptance: 0,
      accepted: allEvidence.length,
      notAccepted,
      retained: currentEvidence.length
    });
  }

  function problem(code: HistoryProblem["code"], message: string): HistoryProblem {
    return Object.freeze({ code, message });
  }

  function appendCommitted(candidate: EvidenceCandidate): EvidenceRef {
    const copied = copyCandidate(candidate);
    const evidence = Object.freeze({
      intervalId: interval.id,
      sequence: nextSequence++,
      eventId: copied.id,
      candidate: copied
    });
    currentEvidence.push(evidence);
    allEvidence.push(evidence);
    return toRef(evidence);
  }

  function committedPublication(evidence: readonly CommittedEvidence[]): HistoryPublication {
    return Object.freeze({
      type: "committed-evidence",
      interval,
      evidence: Object.freeze([...evidence]),
      committedEvidenceBoundary: toRef(evidence.at(-1)!)
    });
  }

  function invoke(subscriber: Subscriber, publication: HistoryPublication): void {
    if (!subscribers.has(subscriber)) return;
    try {
      subscriber.observer(publication);
    } catch {
      subscribers.delete(subscriber);
      subscriber.pending.length = 0;
    }
  }

  function publish(publication: HistoryPublication): void {
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying) subscriber.pending.push(publication);
      else invoke(subscriber, publication);
    }
  }

  function offer(candidate: EvidenceCandidate): CaptureReceipt {
    if (closed) {
      notAccepted += 1;
      return {
        intake: "REFUSED",
        settled: Promise.resolve({
          outcome: "NOT_EVIDENCE",
          problem: problem("HISTORY_CLOSED", "Event History is closed."),
          committedEvidenceBoundary: currentBoundary()
        })
      };
    }

    let copied: EvidenceCandidate;
    try {
      copied = copyCandidate(candidate);
    } catch (error) {
      notAccepted += 1;
      return {
        intake: "REFUSED",
        settled: Promise.resolve({
          outcome: "NOT_EVIDENCE",
          problem: problem(
            "INVALID_CANDIDATE",
            error instanceof Error ? error.message : "Candidate is not valid Evidence input."
          ),
          committedEvidenceBoundary: currentBoundary()
        })
      };
    }
    const configuredDecision = options.offerDecisions?.[offerNumber];
    const decision = configuredDecision ?? options.decideOffer?.(copied, offerNumber) ?? "commit";
    offerNumber += 1;
    if (decision === "refuse") {
      notAccepted += 1;
      return {
        intake: "REFUSED",
        settled: Promise.resolve({
          outcome: "NOT_EVIDENCE",
          problem: problem("HISTORY_STOPPED", "The test history refused this offer."),
          committedEvidenceBoundary: currentBoundary()
        })
      };
    }

    const evidence = appendCommitted(copied);
    const committed = allEvidence.at(-1)!;
    publish(committedPublication([committed]));
    return {
      intake: "QUEUED",
      settled: Promise.resolve({ outcome: "BECAME_EVIDENCE", evidence })
    };
  }

  function readNow(query: EvidenceQuery): Outcome<EvidenceRead> {
    if (closed) {
      return {
        ok: false,
        problem: problem("HISTORY_CLOSED", "Event History is closed.")
      };
    }
    const intervalEvidence = currentEvidence.filter(
      (entry) => query.intervalId === undefined || entry.intervalId === query.intervalId
    );
    const matching = selectEvidence(intervalEvidence, query);
    return {
      ok: true,
      value: Object.freeze({
        interval,
        evidence: Object.freeze(pageEvidence(matching, query)),
        total: matching.length,
        committedEvidenceBoundary: currentBoundary(),
        retainedRange: retainedRange()
      })
    };
  }

  function read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
    if (!options.readControl) return Promise.resolve(readNow(query));
    return new Promise((resolve) => {
      options.readControl?.(query, () => resolve(readNow(query)));
    });
  }

  function queryReadPoint(): EvidenceReadPoint {
    const identity = (reference: EvidenceRef): EvidenceReadPoint["committedEvidenceBoundary"] => Object.freeze({
      intervalId: reference.intervalId,
      pageId: interval.id,
      ownerId: "memory-event-history",
      sequence: reference.sequence,
      eventId: reference.eventId
    });
    const boundary = currentBoundary();
    const range = retainedRange();
    return Object.freeze({
      interval: Object.freeze({ ...interval }),
      committedEvidenceBoundary: boundary ? identity(boundary) : null,
      retainedRange: range
        ? Object.freeze({ first: identity(range.first)!, last: identity(range.last)! })
        : null
    });
  }

  function query(request: EvidenceQueryRequest): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
    if (closed) return Promise.resolve(queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "Event History is closed."));
    const compatibilityQuery: EvidenceQuery = {
      candidateKind: "lightstreamer",
      filters: legacyFiltersFromEvidenceFilter(request.filter),
      ...(request.page.order === "OLDEST_FIRST" && request.page.cursor === undefined
        ? {}
        : { limit: request.page.size }),
      offsetFromNewest: request.page.cursor === undefined ? 0 : Number(request.page.cursor),
      order: "asc"
    };
    const compatibilityRead = options.readControl ? historyObject.read(compatibilityQuery) : null;
    if (!options.readControl) void historyObject.read(compatibilityQuery);
    const gated = <T>(value: T): Promise<T> => compatibilityRead
      ? compatibilityRead.then(() => value)
      : Promise.resolve(value);
    const readPoint = queryReadPoint();
    if (request.at !== "LATEST_COMMITTED" && !sameReadPoint(request.at, readPoint)) {
      return gated(queryFailure("READ_POINT_UNAVAILABLE", "The requested Evidence read point is unavailable."));
    }
    if (!Number.isSafeInteger(request.page.size) || request.page.size < 1 || request.page.size > 100) {
      return gated(queryFailure("QUERY_FAILED", "The Evidence page size is outside the bounded contract."));
    }

    const records: SelectionRecord[] = currentEvidence.flatMap((entry) => {
      if (entry.candidate.kind === "topology-checkpoint") return [];
      const identity = Object.freeze({
        intervalId: entry.intervalId,
        pageId: interval.id,
        ownerId: "memory-event-history",
        sequence: entry.sequence,
        eventId: entry.eventId
      });
      const event = entry.candidate;
      const extracted = extractEvidenceFacets(event, {
        identity,
        pageId: identity.pageId,
        listenerOwner: identity.ownerId,
        summary: event.kind
      });
      const facets = { ...extracted.facets };
      if (!facets.item && event.item && (event.item.name !== undefined || event.item.position !== undefined)) {
        const label = event.item.name ?? String(event.item.position);
        facets.item = typedFacetValue("item", "legacy-label", label, label);
      }
      return [Object.freeze({
        identity,
        timestamp: event.timestamp,
        summary: event.kind,
        searchText: canonicalEvidenceSearchText(event, {
          identity,
          pageId: identity.pageId,
          listenerOwner: identity.ownerId,
          summary: event.kind
        }),
        facets: Object.freeze(facets),
        payload: copyCandidate(event)
      })];
    });
    const around = normalizeAround(request.filter.around, readPoint.retainedRange);
    const filter = around === request.filter.around
      ? request.filter
      : { ...request.filter, around };
    const matching = records.filter((record) => evaluateFilter(
      filter as unknown as FilterInput,
      {
        timestamp: record.timestamp,
        intervalId: record.identity.intervalId,
        searchText: record.searchText,
        facets: record.facets as unknown as FilterRecord["facets"]
      }
    ).matches);
    const inScope = matching.filter((record) => isInAround(record, around));
    const ordered = request.page.order === "NEWEST_FIRST" ? [...inScope].reverse() : inScope;
    let offset = 0;
    if (request.page.cursor !== undefined) {
      offset = Number(request.page.cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return gated(queryFailure("QUERY_FAILED", "The Evidence page cursor is malformed."));
      }
    }
    if (offset > ordered.length) return gated(queryFailure("READ_POINT_UNAVAILABLE", "The Evidence page cursor is unavailable."));
    const page = ordered.slice(offset, offset + request.page.size);
    const nextCursor = offset + page.length < ordered.length ? String(offset + page.length) : null;
    const discoveries = new Map<string, FacetDiscoveryResult>();
    for (const discovery of request.discover ?? []) {
      try {
        discoveries.set(discovery.facet, discoverFacet(records, filter, readPoint, discovery));
      } catch {
        discoveries.set(discovery.facet, {
          state: "UNAVAILABLE",
          facet: discovery.facet,
          reason: "DISCOVERY_FAILED",
          values: [],
          distinctTotal: null,
          nextCursor: null,
          baseEvidenceCount: null
        });
      }
    }
    const lookup = request.lookup === undefined
      ? null
      : lookupEvidence(records, readPoint, request.lookup, filter, around);
    const find = request.find === undefined ? null : findEvidence(request.find.scopeToFilter ? inScope : records, request.find);
    return gated({
      ok: true,
      value: Object.freeze({
        readPoint,
        page: Object.freeze({ evidence: Object.freeze(page), nextCursor }),
        totals: Object.freeze({ matching: matching.length, inScope: inScope.length }),
        discoveries: new Map(discoveries),
        lookup,
        find,
        evaluation: filter.unsupported.length > 0 ? "UNSUPPORTED_FILTER" : "COMPLETE",
        coverage: "COMPLETE",
        storage: "MEMORY_FALLBACK"
      })
    });
  }

  function clear(): Promise<Outcome<{ previousInterval: HistoryInterval; interval: HistoryInterval }>> {
    if (closed) {
      return Promise.resolve({
        ok: false,
        problem: problem("HISTORY_CLOSED", "Event History is closed and cannot be cleared.")
      });
    }
    const previousInterval = interval;
    intervalOrdinal += 1;
    interval = intervalFor(intervalOrdinal);
    currentEvidence = [];
    const result = Object.freeze({ previousInterval, interval });
    publish(
      Object.freeze({
        type: "interval-cleared",
        previousInterval,
        interval,
        status: status()
      })
    );
    return Promise.resolve({ ok: true, value: result });
  }

  function follow(
    optionsForFollow: { from: "CURRENT_INTERVAL_START" | "NOW" },
    observer: (publication: HistoryPublication) => void
  ): () => void {
    const subscriber: Subscriber = {
      observer,
      replaying: optionsForFollow.from === "CURRENT_INTERVAL_START",
      pending: []
    };
    subscribers.add(subscriber);
    invoke(subscriber, Object.freeze({ type: "status", status: status() }));
    if (subscriber.replaying && subscribers.has(subscriber)) {
      if (currentEvidence.length > 0) {
        invoke(subscriber, committedPublication(currentEvidence));
      }
      subscriber.replaying = false;
      for (const publication of subscriber.pending.splice(0)) {
        invoke(subscriber, publication);
      }
    }
    return () => subscribers.delete(subscriber);
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closeOutcome) return Promise.resolve(closeOutcome);
    closed = true;
    subscribers.clear();
    closeOutcome = {
      ok: true,
      value: Object.freeze({
        finalCommittedEvidenceBoundary: currentBoundary(),
        dataDisposition: "ERASED",
        cleanupDisposition: "COMPLETE"
      })
    };
    publish(Object.freeze({ type: "closed", result: closeOutcome.value }));
    return Promise.resolve(closeOutcome);
  }

  historyObject = { storage: { mode: "memory" }, status, offer, read, query, clear, follow, close };
  return historyObject;
}

function legacyFiltersFromEvidenceFilter(filter: EvidenceFilter): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const first = (facet: string): { value: string; label: string; type: string } | undefined => {
    const value = filter.criteria[facet]?.include[0];
    return value ? { value: value.value, label: value.label, type: value.type } : undefined;
  };
  const client = first("client");
  const session = first("session");
  const subscription = first("subscription");
  const item = first("item");
  const itemPosition = first("legacy:item-position");
  const listener = first("listener");
  const mode = first("mode");
  const key = first("key");
  const operation = first("operation");
  const phase = first("phase");
  const provenance = first("provenance");
  const kind = first("kind");
  if (client) result.clientId = client.label;
  if (session) result.sessionId = session.label;
  if (subscription) result.subscriptionId = subscription.label;
  if (item) {
    if (item.type === "structural-item") {
      try {
        const parsed = JSON.parse(item.value) as [string | null, number | null];
        if (parsed[0] !== null) result.item = parsed[0];
        if (parsed[1] !== null) result.itemPosition = parsed[1];
      } catch {
        result.item = item.label;
      }
    } else {
      result.item = item.label;
    }
  }
  if (itemPosition && itemPosition.type === "number") {
    const position = Number(itemPosition.value);
    if (Number.isSafeInteger(position)) result.itemPosition = position;
  }
  if (listener) result.listenerId = listener.label;
  if (mode) result.mode = mode.label;
  if (key) result.key = key.label;
  if (operation) result.command = operation.label;
  if (phase) result.snapshot = phase.label === "SNAPSHOT";
  if (provenance) result.synthetic = provenance.label === "LOCAL";
  if (kind) result.kind = kind.label;
  if (filter.text) result.query = filter.text;
  return result;
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return Object.freeze({
    intervalId: evidence.intervalId,
    sequence: evidence.sequence,
    eventId: evidence.eventId
  });
}

function sameReadPoint(left: EvidenceReadPoint, right: EvidenceReadPoint): boolean {
  return left.interval.id === right.interval.id &&
    left.committedEvidenceBoundary?.eventId === right.committedEvidenceBoundary?.eventId &&
    left.committedEvidenceBoundary?.sequence === right.committedEvidenceBoundary?.sequence;
}

function queryFailure(
  code: EvidenceFilterReadProblem["code"],
  message: string
): Readonly<{ ok: false; problem: EvidenceFilterReadProblem }> {
  return { ok: false, problem: Object.freeze({ code, message }) };
}
