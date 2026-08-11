import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import {
  copyCandidate,
  matchesEvidenceQuery,
  pageEvidence,
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
    const last = allEvidence.at(-1);
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
    const matching = currentEvidence.filter(
      (entry) =>
        (query.intervalId === undefined || entry.intervalId === query.intervalId) &&
        matchesEvidenceQuery(entry, query)
    );
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

  return { storage: { mode: "memory" }, offer, read, clear, follow, close };
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return Object.freeze({
    intervalId: evidence.intervalId,
    sequence: evidence.sequence,
    eventId: evidence.eventId
  });
}
