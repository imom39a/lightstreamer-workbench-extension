import { type LightstreamerEventEnvelope } from "./event-envelope";

/** A normalized Capture event or a validated topology checkpoint staged for acceptance. */
export type TopologyCheckpointEvidenceCandidate = Readonly<{
  kind: "topology-checkpoint";
  id: string;
  checkpoint: Readonly<Record<string, unknown>>;
}>;

export type EvidenceCandidate = LightstreamerEventEnvelope | TopologyCheckpointEvidenceCandidate;

export type EvidenceRef = Readonly<{
  intervalId: string;
  sequence: number;
  eventId: string;
}>;

export type CommittedEvidence = EvidenceRef & Readonly<{
  candidate: EvidenceCandidate;
}>;

export type HistoryInterval = Readonly<{
  id: string;
  ordinal: number;
}>;

export type HistoryProblemCode =
  | "INVALID_CANDIDATE"
  | "HISTORY_STOPPED"
  | "HISTORY_CLOSED"
  | "JOURNAL_COMMIT_FAILED"
  | "CLEAR_FAILED"
  | "CLOSE_FAILED";

export type HistoryProblem = Readonly<{
  code: HistoryProblemCode;
  message: string;
}>;

export type Outcome<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; problem: HistoryProblem }>;

export type CaptureReceipt = Readonly<{
  intake: "QUEUED" | "REFUSED";
  settled: Promise<
    | Readonly<{ outcome: "BECAME_EVIDENCE"; evidence: EvidenceRef }>
    | Readonly<{
        outcome: "NOT_EVIDENCE";
        problem: HistoryProblem;
        committedEvidenceBoundary: EvidenceRef | null;
      }>
  >;
}>;

export type EvidenceQuery = Readonly<{
  intervalId?: string;
  afterSequence?: number;
  limit?: number;
}>;

export type EvidenceRead = Readonly<{
  interval: HistoryInterval;
  evidence: readonly CommittedEvidence[];
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
}>;

export type HistoryCapacityTier = "NORMAL" | "LOWER";
export type HistoryCapacityState = "AVAILABLE" | "NEAR_LIMIT" | "EXHAUSTED";

export type HistoryStatus = Readonly<{
  phase: "RUNNING" | "STOPPED" | "CLOSED";
  captureOperation: "RUNNING" | "STOPPED";
  interval: HistoryInterval;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
  capacity: Readonly<{
    tier: HistoryCapacityTier;
    state: HistoryCapacityState;
  }>;
  fallback: "PRIMARY_JOURNAL_UNAVAILABLE" | null;
  captured: number;
  awaitingAcceptance: number;
  accepted: number;
  notAccepted: number;
  retained: number;
}>;

export type ClearResult = Readonly<{
  previousInterval: HistoryInterval;
  interval: HistoryInterval;
}>;

export type CloseResult = Readonly<{
  finalCommittedEvidenceBoundary: EvidenceRef | null;
  dataDisposition: "ERASED" | "ERASURE_UNCONFIRMED";
  cleanupDisposition: "COMPLETE" | "DEFERRED";
}>;

export type HistoryPublication =
  | Readonly<{ type: "status"; status: HistoryStatus; problem?: HistoryProblem }>
  | Readonly<{
      type: "committed-evidence";
      interval: HistoryInterval;
      evidence: readonly CommittedEvidence[];
      committedEvidenceBoundary: EvidenceRef;
    }>
  | Readonly<{
      type: "interval-cleared";
      previousInterval: HistoryInterval;
      interval: HistoryInterval;
      status: HistoryStatus;
    }>
  | Readonly<{ type: "closed"; result: CloseResult }>;

export interface EventHistory {
  offer(candidate: EvidenceCandidate): CaptureReceipt;
  read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>>;
  clear(): Promise<Outcome<ClearResult>>;
  follow(
    options: { from: "CURRENT_INTERVAL_START" | "NOW" },
    observer: (publication: HistoryPublication) => void
  ): () => void;
  close(): Promise<Outcome<CloseResult>>;
}

export type OpenEventHistoryOptions = Readonly<{
  panelSessionId?: string;
}>;

type HistoryJournal = {
  commitBatch(batch: readonly PendingCandidate[]): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
};

type PendingCandidate = Readonly<{
  ordinal: number;
  candidate: EvidenceCandidate;
  resolve: (result: ReceiptResult) => void;
}>;

type ReceiptResult =
  | Readonly<{ outcome: "BECAME_EVIDENCE"; evidence: EvidenceRef }>
  | Readonly<{
      outcome: "NOT_EVIDENCE";
      problem: HistoryProblem;
      committedEvidenceBoundary: EvidenceRef | null;
    }>;

type Subscriber = {
  observer: (publication: HistoryPublication) => void;
  replaying: boolean;
  pending: HistoryPublication[];
};

type MemoryEventHistoryOptions = Readonly<{
  panelSessionId?: string;
  commitBatch?: (batch: readonly EvidenceCandidate[]) => Promise<void>;
  clearJournal?: () => Promise<void>;
  closeJournal?: () => Promise<void>;
  capacityTier?: HistoryCapacityTier;
  fallback?: "PRIMARY_JOURNAL_UNAVAILABLE" | null;
}>;

/**
 * Opens the dormant contract implementation. IndexedDB selection is deliberately
 * deferred to the integration train; this slice exposes the lower-capacity memory
 * adapter through the final public seam.
 */
export async function openEventHistory(
  options: OpenEventHistoryOptions = {}
): Promise<EventHistory> {
  return createMemoryHistory({
    panelSessionId: options.panelSessionId,
    capacityTier: "LOWER",
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
}

/** @internal Test-only adapter seam for deterministic commit and lifecycle timing. */
export async function createMemoryEventHistoryForTests(
  options: MemoryEventHistoryOptions = {}
): Promise<EventHistory> {
  return createMemoryHistory(options);
}

function createMemoryHistory(options: MemoryEventHistoryOptions): EventHistory {
  const sessionId = options.panelSessionId ?? `session-${nextId()}`;
  const journal: HistoryJournal = {
    async commitBatch(batch) {
      await options.commitBatch?.(batch.map((entry) => entry.candidate));
    },
    async clear() {
      await options.clearJournal?.();
    },
    async close() {
      await options.closeJournal?.();
    }
  };
  const capacityTier = options.capacityTier ?? "NORMAL";
  const fallback = options.fallback ?? null;
  const subscribers = new Set<Subscriber>();
  const committed: CommittedEvidence[] = [];
  const pending: PendingCandidate[] = [];
  const idleWaiters: Array<() => void> = [];
  let intervalOrdinal = 1;
  let interval = createInterval(sessionId, intervalOrdinal);
  let nextCaptureOrdinal = 1;
  let nextEvidenceSequence = 1;
  let committedEvidenceBoundary: EvidenceRef | null = null;
  let accepted = 0;
  let notAccepted = 0;
  let processing = false;
  let scheduled = false;
  let phase: HistoryStatus["phase"] = "RUNNING";
  let closing = false;
  let clearPromise: Promise<Outcome<ClearResult>> | null = null;
  let lastClearResult: ClearResult | null = null;
  let closePromise: Promise<Outcome<CloseResult>> | null = null;

  function status(problem?: HistoryProblem): HistoryStatus {
    const intervalEvidence = committed.filter((entry) => entry.intervalId === interval.id);
    const retainedRange = intervalEvidence.length
      ? {
          first: toRef(intervalEvidence[0]),
          last: toRef(intervalEvidence[intervalEvidence.length - 1])
        }
      : null;
    const base: HistoryStatus = deepFreeze({
      phase,
      captureOperation: phase === "RUNNING" && !closing ? "RUNNING" : "STOPPED",
      interval,
      committedEvidenceBoundary,
      retainedRange,
      capacity: {
        tier: capacityTier,
        state: phase === "STOPPED" ? "EXHAUSTED" : "AVAILABLE"
      },
      fallback,
      captured: nextCaptureOrdinal - 1,
      awaitingAcceptance: pending.length,
      accepted,
      notAccepted,
      retained: intervalEvidence.length
    });
    return problem ? deepFreeze({ ...base, problem }) as HistoryStatus : base;
  }

  function problem(code: HistoryProblemCode, message: string): HistoryProblem {
    return deepFreeze({ code, message });
  }

  function refusal(code: "HISTORY_STOPPED" | "HISTORY_CLOSED", message: string): CaptureReceipt {
    notAccepted += 1;
    const issue = problem(code, message);
    return {
      intake: "REFUSED",
      settled: Promise.resolve({
        outcome: "NOT_EVIDENCE",
        problem: issue,
        committedEvidenceBoundary
      })
    };
  }

  function offer(candidate: EvidenceCandidate): CaptureReceipt {
    if (phase === "CLOSED" || closing) {
      return refusal("HISTORY_CLOSED", "Event History is closed and cannot accept Capture.");
    }
    if (phase === "STOPPED") {
      return refusal("HISTORY_STOPPED", "Event History stopped at its committed boundary.");
    }

    let copied: EvidenceCandidate;
    try {
      copied = copyCandidate(candidate);
    } catch (error) {
      notAccepted += 1;
      const issue = problem(
        "INVALID_CANDIDATE",
        error instanceof Error ? error.message : "Candidate is not valid Evidence input."
      );
      return {
        intake: "REFUSED",
        settled: Promise.resolve({
          outcome: "NOT_EVIDENCE",
          problem: issue,
          committedEvidenceBoundary
        })
      };
    }

    let resolveReceipt!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((resolve) => {
      resolveReceipt = resolve;
    });
    pending.push({ ordinal: nextCaptureOrdinal++, candidate: copied, resolve: resolveReceipt });
    lastClearResult = null;
    scheduleProcessing();
    return { intake: "QUEUED", settled };
  }

  function scheduleProcessing(): void {
    if (scheduled || processing || pending.length === 0) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void processPending();
    });
  }

  async function processPending(): Promise<void> {
    if (processing) {
      return;
    }
    processing = true;
    try {
      while (pending.length > 0 && phase === "RUNNING") {
        const batch = pending.splice(0);
        try {
          await journal.commitBatch(batch);
        } catch (error) {
          const issue = problem(
            "JOURNAL_COMMIT_FAILED",
            error instanceof Error ? error.message : "The Evidence journal could not commit the batch."
          );
          stopAtBoundary(issue, batch);
          break;
        }

        const evidence = batch.map((entry) => {
          const reference = deepFreeze({
            intervalId: interval.id,
            sequence: nextEvidenceSequence++,
            eventId: candidateId(entry.candidate)
          });
          return deepFreeze({ ...reference, candidate: entry.candidate });
        });
        committed.push(...evidence);
        accepted += evidence.length;
        committedEvidenceBoundary = toRef(evidence[evidence.length - 1]);
        const publication = deepFreeze({
          type: "committed-evidence" as const,
          interval,
          evidence,
          committedEvidenceBoundary
        });
        publish(publication);
        for (const [index, entry] of batch.entries()) {
          entry.resolve({ outcome: "BECAME_EVIDENCE", evidence: toRef(evidence[index]) });
        }
      }
    } finally {
      processing = false;
      resolveIdleWaiters();
      if (pending.length > 0 && phase === "RUNNING") {
        scheduleProcessing();
      }
    }
  }

  function stopAtBoundary(issue: HistoryProblem, failedBatch: readonly PendingCandidate[]): void {
    phase = "STOPPED";
    const rejected = [...failedBatch, ...pending.splice(0)];
    notAccepted += rejected.length;
    const boundary = committedEvidenceBoundary;
    for (const entry of rejected) {
      entry.resolve({
        outcome: "NOT_EVIDENCE",
        problem: issue,
        committedEvidenceBoundary: boundary
      });
    }
    publish({ type: "status", status: status(issue), problem: issue });
  }

  function read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
    if (phase === "CLOSED") {
      return Promise.resolve({
        ok: false,
        problem: problem("HISTORY_CLOSED", "Event History is closed.")
      });
    }
    const intervalEvidence = committed.filter((entry) => entry.intervalId === (query.intervalId ?? interval.id));
    const snapshot = intervalEvidence.filter(
      (entry) => query.afterSequence === undefined || entry.sequence > query.afterSequence
    );
    const evidence = query.limit === undefined ? snapshot : snapshot.slice(0, Math.max(0, query.limit));
    const retainedRange = intervalEvidence.length
      ? {
          first: toRef(intervalEvidence[0]),
          last: toRef(intervalEvidence[intervalEvidence.length - 1])
        }
      : null;
    return Promise.resolve({
      ok: true,
      value: deepFreeze({
        interval,
        evidence: [...evidence],
        committedEvidenceBoundary,
        retainedRange
      })
    });
  }

  function clear(): Promise<Outcome<ClearResult>> {
    if (clearPromise) {
      return clearPromise;
    }
    if (lastClearResult && committed.length === 0 && pending.length === 0) {
      return Promise.resolve({ ok: true, value: lastClearResult });
    }
    clearPromise = waitForIdle().then(async () => {
      if (phase === "CLOSED") {
        return { ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed.") };
      }
      if (phase === "STOPPED") {
        return { ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") };
      }
      const previousInterval = interval;
      try {
        await journal.clear();
      } catch (error) {
        const issue = problem(
          "CLEAR_FAILED",
          error instanceof Error ? error.message : "The History Interval could not be cleared."
        );
        publish({ type: "status", status: status(issue), problem: issue });
        return { ok: false, problem: issue };
      }
      committed.length = 0;
      interval = createInterval(sessionId, ++intervalOrdinal);
      const result = deepFreeze({ previousInterval, interval });
      lastClearResult = result;
      publish(
        deepFreeze({
          type: "interval-cleared" as const,
          previousInterval,
          interval,
          status: status()
        })
      );
      return { ok: true, value: result };
    });
    void clearPromise.finally(() => {
      clearPromise = null;
    });
    return clearPromise;
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closePromise) {
      return closePromise;
    }
    if (phase === "CLOSED") {
      const result = closeResult();
      return Promise.resolve({ ok: true, value: result });
    }
    closing = true;
    closePromise = waitForIdle().then(async () => {
      try {
        await journal.clear();
        await journal.close();
      } catch (error) {
        const issue = problem(
          "CLOSE_FAILED",
          error instanceof Error ? error.message : "Event History cleanup could not be confirmed."
        );
        phase = "CLOSED";
        publish({ type: "status", status: status(issue), problem: issue });
        return {
          ok: false,
          problem: issue
        };
      }
      const result = closeResult();
      committed.length = 0;
      phase = "CLOSED";
      publish(deepFreeze({ type: "closed" as const, result }));
      return { ok: true, value: result };
    });
    return closePromise;
  }

  function closeResult(): CloseResult {
    return deepFreeze({
      finalCommittedEvidenceBoundary: committedEvidenceBoundary,
      dataDisposition: "ERASED" as const,
      cleanupDisposition: "COMPLETE" as const
    });
  }

  function waitForIdle(): Promise<void> {
    if (!processing && pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function resolveIdleWaiters(): void {
    if (processing || pending.length > 0) {
      return;
    }
    for (const resolve of idleWaiters.splice(0)) {
      resolve();
    }
  }

  function follow(
    followOptions: { from: "CURRENT_INTERVAL_START" | "NOW" },
    observer: (publication: HistoryPublication) => void
  ): () => void {
    const subscriber: Subscriber = { observer, replaying: followOptions.from === "CURRENT_INTERVAL_START", pending: [] };
    subscribers.add(subscriber);
    invoke(subscriber, { type: "status", status: status() });
    if (subscriber.replaying && subscribers.has(subscriber)) {
      const replay = committed
        .filter((entry) => entry.intervalId === interval.id)
        .reduce<HistoryPublication[]>((publications, entry) => {
          const last = publications.at(-1);
          if (last?.type === "committed-evidence") {
            publications[publications.length - 1] = deepFreeze({
              ...last,
              evidence: [...last.evidence, entry],
              committedEvidenceBoundary: toRef(entry)
            });
          } else {
            publications.push(
              deepFreeze({
                type: "committed-evidence" as const,
                interval,
                evidence: [entry],
                committedEvidenceBoundary: toRef(entry)
              })
            );
          }
          return publications;
        }, []);
      for (const publication of replay) {
        invoke(subscriber, publication);
      }
      subscriber.replaying = false;
      for (const publication of subscriber.pending.splice(0)) {
        invoke(subscriber, publication);
      }
    }
    return () => subscribers.delete(subscriber);
  }

  function publish(publication: HistoryPublication): void {
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying) {
        subscriber.pending.push(publication);
      } else {
        invoke(subscriber, publication);
      }
    }
  }

  function invoke(subscriber: Subscriber, publication: HistoryPublication): void {
    if (!subscribers.has(subscriber)) {
      return;
    }
    try {
      subscriber.observer(publication);
    } catch {
      subscribers.delete(subscriber);
      subscriber.pending.length = 0;
    }
  }

  return { offer, read, clear, follow, close };
}

function createInterval(sessionId: string, ordinal: number): HistoryInterval {
  return deepFreeze({ id: `${sessionId}:interval-${ordinal}`, ordinal });
}

function candidateId(candidate: EvidenceCandidate): string {
  return candidate.id;
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({
    intervalId: evidence.intervalId,
    sequence: evidence.sequence,
    eventId: evidence.eventId
  });
}

function copyCandidate(candidate: EvidenceCandidate): EvidenceCandidate {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Candidate must be an object.");
  }
  if (candidate.kind === "topology-checkpoint") {
    if (!candidate.id || typeof candidate.id !== "string" || !candidate.checkpoint) {
      throw new Error("Topology checkpoint candidate is incomplete.");
    }
    return deepFreeze(structuredClone(candidate));
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new Error("Capture candidate must have a stable event ID.");
  }
  return deepFreeze(structuredClone(candidate));
}

function nextId(): string {
  return Math.random().toString(36).slice(2);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
