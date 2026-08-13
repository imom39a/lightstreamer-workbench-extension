import { type LightstreamerEventEnvelope } from "./event-envelope";
import { type EventFilterState, matchesEventFilters } from "./event-filter";
import {
  type DeterministicEvidenceRecord,
  type EvidenceFilterQueryAdapter,
  type EvidenceFilterReadProblem,
  type EvidenceIdentity,
  MAX_EVIDENCE_PAGE_SIZE,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryResult
} from "./evidence-filter-contract";
import { findEvidence, isInAround, lookupEvidence, normalizeAround, type SelectionRecord } from "./evidence-filter-selection";
import { evaluateFilter, type Filter, type FilterRecord } from "./filter-algebra";
import { discoverFacet, type DiscoveryInstrumentation } from "./evidence-filter-discovery";
import { canonicalEvidenceSearchText, extractEvidenceFacets } from "./evidence-facets";
import {
  deserializeJournalEvidenceCandidate,
  journalCandidateSearchText,
  registerJournalOwnedCandidate,
  journalAccountedBytes,
  serializeJournalEvidenceCandidate
} from "./event-history-serialization";
import { type AuthoritativeEventDatabaseRuntime } from "./indexeddb/authoritative-event-db";
import {
  admissionFailure,
  defaultHistoryTimer,
  estimateHistoryCandidateBytes,
  historyCapacityLimits,
  pendingAgeFailure,
  pressureFor,
  type HistoryCapacityDimension,
  type HistoryCapacityLimits,
  type HistoryCapacityOptions,
  type HistoryCapacityTier,
  type HistoryPressureMeasurements,
  type HistoryTrigger,
  type HistoryTerminalReason
} from "./event-history-capacity";

export {
  MIB,
  HISTORY_CAPACITY_LIMITS,
  type HistoryCapacityDimension,
  type HistoryCapacityLimits,
  type HistoryCapacityOptions,
  type HistoryCapacityOverrides,
  type HistoryCapacityTier,
  type HistoryTimer,
  type HistoryPressureMeasurements,
  type HistoryTerminalReason
} from "./event-history-capacity";

/** A normalized Capture event or a validated topology checkpoint staged for acceptance. */
export type TopologyCheckpointEvidenceCandidate = Readonly<{
  kind: "topology-checkpoint";
  id: string;
  checkpoint: Readonly<Record<string, unknown>>;
}>;

export type EvidenceCandidate = LightstreamerEventEnvelope | TopologyCheckpointEvidenceCandidate;

export type EvidenceCandidateKind = "lightstreamer" | "topology-checkpoint";

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
  | "CLEAR_IN_PROGRESS"
  | "JOURNAL_COMMIT_FAILED"
  | HistoryTerminalReason
  | "CLEAR_FAILED"
  | "CLOSE_FAILED"
  | "QUERY_FAILED";

export type HistoryProblem = Readonly<{
  code: HistoryProblemCode;
  message: string;
  reason?: HistoryTerminalReason;
  dimension?: HistoryCapacityDimension | "JOURNAL";
  terminal?: HistoryTerminalDiagnostic;
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
  candidateKind?: EvidenceCandidateKind;
  intervalId?: string;
  afterSequence?: number;
  limit?: number;
  offsetFromNewest?: number;
  order?: "asc" | "desc";
  filters?: EventFilterState;
  find?: string;
  eventId?: string;
}>;

export type EvidenceRead = Readonly<{
  interval: HistoryInterval;
  evidence: readonly CommittedEvidence[];
  total: number;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
}>;

export type HistoryCapacityState = "AVAILABLE" | "NEAR_LIMIT" | "EXHAUSTED";

export type HistoryTerminalDiagnostic = Readonly<{
  reason: HistoryTerminalReason;
  dimension: HistoryCapacityDimension | "JOURNAL";
  tier: "NORMAL" | "LOWER";
  triggerTime: number;
  triggerInterval: HistoryInterval;
  interval: HistoryInterval;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
  firstMissingEventId: string | null;
  rejected: Readonly<{ count: number; bytes: number }>;
  discarded: Readonly<{ count: number; bytes: number }>;
  triggerMeasurements: HistoryPressureMeasurements;
}>;

export type HistoryStatus = Readonly<{
  phase: "RUNNING" | "DRAINING_TO_STOP" | "STOPPED" | "CLOSED";
  captureOperation: "RUNNING" | "STOPPED";
  interval: HistoryInterval;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
  capacity: Readonly<{
    tier: HistoryCapacityTier;
    state: HistoryCapacityState;
    limits?: HistoryCapacityLimits;
    measurements?: HistoryPressureMeasurements;
  }>;
  fallback: "PRIMARY_JOURNAL_UNAVAILABLE" | "UNKNOWN_NEWER_SCHEMA" | null;
  captured: number;
  awaitingAcceptance: number;
  accepted: number;
  notAccepted: number;
  retained: number;
  terminal?: HistoryTerminalDiagnostic;
  /** Diagnostic-only last successful Evidence query retained across a failed publication. */
  lastCoherentQuery?: import("./evidence-filter-contract").EvidenceSnapshot;
}>;

export type EventHistoryStorage = Readonly<{
  mode: "indexeddb" | "memory";
  reason?: string;
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
  | Readonly<{ type: "closed"; result: CloseResult }>
  | Readonly<{ type: "terminal"; terminal: HistoryTerminalDiagnostic; status: HistoryStatus }>;

export interface EventHistory {
  readonly storage: EventHistoryStorage;
  status(): HistoryStatus;
  offer(candidate: EvidenceCandidate): CaptureReceipt;
  read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>>;
  /** Available on the in-memory semantic query implementation; durable adapters adopt it later. */
  query?: EvidenceFilterQueryAdapter["query"];
  clear(): Promise<Outcome<ClearResult>>;
  follow(
    options: { from: "CURRENT_INTERVAL_START" | "NOW" },
    observer: (publication: HistoryPublication) => void
  ): () => void;
  close(): Promise<Outcome<CloseResult>>;
}

export type MemoryEventHistory = EventHistory & EvidenceFilterQueryAdapter;

export type OpenEventHistoryOptions = Readonly<{
  panelSessionId?: string;
  runtime?: AuthoritativeEventDatabaseRuntime;
  clearJournal?: () => Promise<void | boolean> | void | boolean;
  closeJournal?: () => Promise<void>;
  commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void>;
  failure?: Readonly<{ commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void> }>;
  finalizeTerminal?: (terminal: HistoryTerminalDiagnostic) => void | Promise<void>;
}> & HistoryCapacityOptions;

type HistoryJournal = {
  commitBatch(batch: readonly EvidenceCandidate[]): Promise<void>;
  persistTerminalIntent(terminal: HistoryTerminalDiagnostic): Promise<void>;
  finalizeTerminal(terminal: HistoryTerminalDiagnostic): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
};

type PendingCandidate = Readonly<{
  ordinal: number;
  serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
  bytes: number;
  offeredAt: number;
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
  clearJournal?: () => Promise<void | boolean> | void | boolean;
  closeJournal?: () => Promise<void>;
  persistTerminalIntent?: (terminal: HistoryTerminalDiagnostic) => void | Promise<void>;
  finalizeTerminal?: (terminal: HistoryTerminalDiagnostic) => void | Promise<void>;
  capacityTier?: HistoryCapacityTier;
  fallback?: "PRIMARY_JOURNAL_UNAVAILABLE" | "UNKNOWN_NEWER_SCHEMA" | null;
  failure?: Readonly<{ commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void> }>;
  /** Internal memory-query seam used to prove discovery failure isolation and bounds. */
  discovery?: DiscoveryInstrumentation;
}> & HistoryCapacityOptions;

/**
 * Opens the dormant contract implementation. The primary IndexedDB journal is
 * selected before the first offer; startup failure selects the lower-capacity
 * memory journal for the rest of this Panel Session.
 */
export async function openEventHistory(
  options: OpenEventHistoryOptions = {}
): Promise<EventHistory> {
  try {
    const { createIndexedDbEventHistory } = await import("./event-history-indexeddb");
    return await createIndexedDbEventHistory(options);
  } catch (error) {
    const fallback =
      error && typeof error === "object" && "code" in error && error.code === "UNKNOWN_NEWER_SCHEMA"
        ? "UNKNOWN_NEWER_SCHEMA"
        : "PRIMARY_JOURNAL_UNAVAILABLE";
    return createMemoryHistory({
      panelSessionId: options.panelSessionId,
      capacityTier: "LOWER",
      fallback,
      clock: options.clock,
      timer: options.timer,
      byteEstimator: options.byteEstimator,
      capacity: options.capacity,
      clearJournal: options.clearJournal,
      closeJournal: options.closeJournal,
      commitBatch: options.commitBatch === undefined
        ? undefined
        : async (batch) => { await options.commitBatch!(batch); },
          failure: options.failure,
      finalizeTerminal: options.finalizeTerminal
    });
  }
}

/** @internal Test-only adapter seam for deterministic commit and lifecycle timing. */
export async function createMemoryEventHistoryForTests(
  options: MemoryEventHistoryOptions = {}
): Promise<EventHistory> {
  return createInMemoryEventHistory(options);
}

/** Synchronous memory authority used by synchronous runtime construction. */
export function createInMemoryEventHistory(
  options: MemoryEventHistoryOptions = {}
): EventHistory {
  return createMemoryHistory(options);
}

function createMemoryHistory(options: MemoryEventHistoryOptions): MemoryEventHistory {
  const sessionId = options.panelSessionId ?? `session-${nextId()}`;
  const journal: HistoryJournal = {
    async commitBatch(batch) {
      await options.failure?.commitBatch?.(batch);
      await options.commitBatch?.(batch);
    },
    async persistTerminalIntent(terminal) { await options.persistTerminalIntent?.(terminal); },
    async finalizeTerminal(terminal) { await options.finalizeTerminal?.(terminal); },
    async clear() {
      await options.clearJournal?.();
    },
    async close() { await options.closeJournal?.(); }
  };
  const capacityTier = options.capacityTier ?? "NORMAL";
  const limits = historyCapacityLimits(capacityTier, options.capacity);
  const clock = options.clock ?? Date.now;
  const timer = options.timer ?? defaultHistoryTimer();
  const fallback = options.fallback ?? null;
  const storage: EventHistoryStorage = deepFreeze({
    mode: "memory",
    ...(fallback
      ? {
          reason:
            fallback === "UNKNOWN_NEWER_SCHEMA"
              ? "IndexedDB journal schema is newer than this Workbench version"
              : "IndexedDB is unavailable"
        }
      : {})
  });
  const subscribers = new Set<Subscriber>();
  const committed: CommittedEvidence[] = [];
  const pending: PendingCandidate[] = [];
  const postClearPending: PendingCandidate[] = [];
  const inFlight: PendingCandidate[] = [];
  const terminalReceipts: PendingCandidate[] = [];
  const committedReceipts: Array<{ entry: PendingCandidate; evidence: EvidenceRef }> = [];
  const deterministicRecordCache = new WeakMap<object, DeterministicEvidenceRecord>();
  const idleWaiters: Array<() => void> = [];
  let intervalOrdinal = 1;
  let interval = createInterval(sessionId, intervalOrdinal);
  let nextCaptureOrdinal = 1;
  let nextEvidenceSequence = 1;
  let committedEvidenceBoundary: EvidenceRef | null = null;
  let retainedCount = 0;
  let retainedBytes = 0;
  let accepted = 0;
  let notAccepted = 0;
  let rejectedCount = 0;
  let rejectedBytes = 0;
  let discardedCount = 0;
  let discardedBytes = 0;
  let processing = false;
  let scheduled = false;
  let ageTimer: unknown = null;
  let phase: HistoryStatus["phase"] = "RUNNING";
  let closing = false;
  let clearPromise: Promise<Outcome<ClearResult>> | null = null;
  let lastClearResult: ClearResult | null = null;
  let lastCloseOutcome: Outcome<CloseResult> | null = null;
  let closePromise: Promise<Outcome<CloseResult>> | null = null;
  let clearInProgress = false;
  let trigger: HistoryTrigger | null = null;
  let terminal: HistoryTerminalDiagnostic | undefined;
  let persistedTerminal: HistoryTerminalDiagnostic | undefined;
  let terminalPersistence: Promise<void> | null = null;
  let terminalFinalization: Promise<void> | null = null;
  let terminalSettled: Promise<void> | null = null;
  let resolveTerminalSettled: (() => void) | null = null;
  let terminalPersistenceFailed = false;
  let terminalIntentGeneration = 0;
  let lastNearLimit = false;
  let awaitingCount = 0;
  let awaitingBytes = 0;

  function oldestAwaiting(): PendingCandidate | undefined {
    let oldest: PendingCandidate | undefined;
    for (const candidate of [inFlight[0], pending[0], postClearPending[0]]) {
      if (candidate !== undefined && (oldest === undefined || candidate.ordinal < oldest.ordinal)) {
        oldest = candidate;
      }
    }
    return oldest;
  }

  function measurements(): HistoryPressureMeasurements {
    return Object.freeze({
      retainedCount,
      retainedBytes,
      pendingCount: awaitingCount,
      pendingBytes: awaitingBytes,
      oldestPendingAgeMs: (() => {
        const oldest = oldestAwaiting();
        return oldest ? Math.max(0, clock() - oldest.offeredAt) : null;
      })()
    });
  }

  function status(problem?: HistoryProblem): HistoryStatus {
    const intervalEvidence = committed.filter((entry) => entry.intervalId === interval.id);
    const retainedRange = intervalEvidence.length ? { first: toRef(intervalEvidence[0]), last: toRef(intervalEvidence.at(-1)!) } : null;
    const pressure = pressureFor(limits, measurements());
    const base: HistoryStatus = deepFreeze({
      phase,
      captureOperation: phase === "RUNNING" && !closing ? "RUNNING" : "STOPPED",
      interval,
      committedEvidenceBoundary,
      retainedRange,
      capacity: { tier: capacityTier, state: phase !== "RUNNING" ? "EXHAUSTED" : pressure.nearLimit ? "NEAR_LIMIT" : "AVAILABLE", limits, measurements: pressure.measurements },
      fallback,
      captured: nextCaptureOrdinal - 1,
      awaitingAcceptance: awaitingCount,
      accepted,
      notAccepted,
      retained: intervalEvidence.length,
      ...(terminal ? { terminal } : {})
    });
    return problem ? deepFreeze({ ...base, problem }) as HistoryStatus : base;
  }

  function problem(code: HistoryProblemCode, message: string, extras: Partial<HistoryProblem> = {}): HistoryProblem {
    return deepFreeze({ code, message, ...extras });
  }

  function pressureChanged(): void {
    const near = pressureFor(limits, measurements()).nearLimit;
    if (near !== lastNearLimit) {
      lastNearLimit = near;
      publish({ type: "status", status: status() });
    }
  }

  function makeTrigger(reason: HistoryTerminalReason, dimension: HistoryCapacityDimension | "JOURNAL", firstMissingEventId: string | null): HistoryTrigger {
    return deepFreeze({ reason, dimension, tier: capacityTier, triggerTime: clock(), interval, firstMissingEventId, measurements: measurements() });
  }

  function terminalProblem(triggerValue: HistoryTrigger): HistoryProblem {
    return problem(triggerValue.reason, `Event History stopped because ${triggerValue.reason}.`, {
      reason: triggerValue.reason,
      dimension: triggerValue.dimension,
      ...(terminal ?? persistedTerminal ? { terminal: terminal ?? persistedTerminal } : {})
    });
  }

  function noteFirstMissingEvent(candidate: EvidenceCandidate): void {
    const id = candidateIdIfPresent(candidate);
    if (!terminal && trigger && trigger.firstMissingEventId === null && id !== null) {
      trigger = deepFreeze({ ...trigger, firstMissingEventId: id });
    }
  }

  function refusedCandidateBytes(candidate: EvidenceCandidate): number {
    try {
      return estimateHistoryCandidateBytes(copyCandidate(candidate), options.byteEstimator);
    } catch {
      return 0;
    }
  }

  function refuseStopped(candidate: EvidenceCandidate): CaptureReceipt {
    notAccepted += 1;
    noteFirstMissingEvent(candidate);
    const bytes = refusedCandidateBytes(candidate);
    // The terminal publication is the immutable accounting snapshot for the
    // stop boundary. Offers arriving after it are still refused, but cannot
    // retroactively change that published diagnostic.
    if (!terminal) {
      rejectedCount += 1;
      rejectedBytes += bytes;
    }
    const completion = terminalFinalization ?? terminalSettled;
    const settled = completion
      ? completion.then(() => ({
          outcome: "NOT_EVIDENCE" as const,
          problem: trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary."),
          committedEvidenceBoundary
        }))
      : Promise.resolve({
          outcome: "NOT_EVIDENCE" as const,
          problem: trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary."),
          committedEvidenceBoundary
        });
    return { intake: "REFUSED", settled };
  }

  function clearBlockedProblem(): HistoryProblem {
    if (trigger) {
      return terminalProblem(trigger);
    }
    if (terminal) {
      return problem("HISTORY_STOPPED", "Event History stopped at its committed boundary.", { terminal });
    }
    return problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.");
  }

  function refuseClosed(): CaptureReceipt {
    notAccepted += 1;
    return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: problem("HISTORY_CLOSED", "Event History is closed and cannot accept Capture."), committedEvidenceBoundary }) };
  }

  function clearQueueForCandidate(): PendingCandidate[] {
    return clearInProgress ? postClearPending : pending;
  }

  function rejoinPostClearQueue(): void {
    if (postClearPending.length === 0) {
      return;
    }
    pending.push(...postClearPending.splice(0));
    if (clearInProgress) {
      return;
    }
    scheduleAgeCheck();
    pressureChanged();
    lastClearResult = null;
    if (pending.length > 0) {
      scheduleProcessing();
    }
  }

  function resolveTerminalReceipts(issue: HistoryProblem): void {
    for (const entry of terminalReceipts.splice(0)) {
      entry.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary });
    }
  }

  function rejectPostClearDuringClearFailure(issue: HistoryProblem, settleNow: boolean = false): void {
    const rejected = [...postClearPending, ...pending];
    postClearPending.length = 0;
    if (rejected.length === 0) {
      return;
    }
    pending.length = 0;
    awaitingCount -= rejected.length;
    awaitingBytes -= rejected.reduce((total, entry) => total + entry.bytes, 0);
    notAccepted += rejected.length;
    discardedCount += rejected.length;
    discardedBytes += rejected.reduce((sum, entry) => sum + entry.bytes, 0);
    terminalReceipts.push(...rejected);
    const completion = terminalFinalization ?? terminalSettled;
    if (settleNow || !completion) {
      resolveTerminalReceipts(issue);
      return;
    }
    if (completion) {
      void completion.then(() => resolveTerminalReceipts(issue));
      return;
    }
    resolveTerminalReceipts(issue);
  }

  function offerForClearInProgress(
    serialized: ReturnType<typeof serializeJournalEvidenceCandidate>,
    bytes: number
  ): CaptureReceipt {
    let resolveReceipt!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((resolve) => { resolveReceipt = resolve; });
    clearQueueForCandidate().push({
      ordinal: nextCaptureOrdinal++,
      serialized,
      bytes,
      offeredAt: clock(),
      resolve: resolveReceipt
    });
    awaitingCount += 1;
    awaitingBytes += bytes;
    lastClearResult = null;
    scheduleAgeCheck();
    pressureChanged();
    if (!clearInProgress) {
      scheduleProcessing();
    }
    return { intake: "QUEUED", settled };
  }

  function finishTerminal(): void {
    if (phase !== "DRAINING_TO_STOP" || processing || pending.length > 0 || inFlight.length > 0 || terminal || terminalFinalization || !trigger || !terminalSettled) return;
    terminalFinalization = (terminalPersistence ?? terminalSettled).then(async () => {
      if (terminalPersistenceFailed || phase !== "DRAINING_TO_STOP" || !trigger) return;
      const finalized = terminalDiagnostic();
      try {
        await journal.finalizeTerminal(finalized);
      } catch (error) {
        failTerminalPersistence(error);
        return;
      }
      persistedTerminal = finalized;
      terminal = finalized;
      phase = "STOPPED";
      const issue = terminalProblem(trigger);
      publish({ type: "terminal", terminal, status: status(issue) });
      publish({ type: "status", status: status(issue), problem: issue });
    }).finally(() => {
      signalTerminalSettled();
      terminalFinalization = null;
    });
  }

  function ensureTerminalSettled(): void {
    if (terminalSettled) return;
    terminalSettled = new Promise<void>((resolve) => { resolveTerminalSettled = resolve; });
  }

  function signalTerminalSettled(): void {
    if (!resolveTerminalSettled) return;
    resolveTerminalSettled();
    resolveTerminalSettled = null;
  }

  function terminalDiagnostic(): HistoryTerminalDiagnostic {
    if (!trigger) throw new Error("Cannot create a terminal diagnostic without a trigger.");
    const intervalEvidence = committed.filter((entry) => entry.intervalId === interval.id);
    return deepFreeze({
      reason: trigger.reason,
      dimension: trigger.dimension,
      tier: trigger.tier,
      triggerTime: trigger.triggerTime,
      triggerInterval: trigger.interval,
      interval,
      committedEvidenceBoundary,
      retainedRange: intervalEvidence.length
        ? { first: toRef(intervalEvidence[0]), last: toRef(intervalEvidence.at(-1)!) }
        : null,
      firstMissingEventId: trigger.firstMissingEventId,
      rejected: { count: rejectedCount, bytes: rejectedBytes },
      discarded: { count: discardedCount, bytes: discardedBytes },
      triggerMeasurements: trigger.measurements
    });
  }

  function failTerminalPersistence(error: unknown): void {
    if (terminalPersistenceFailed) return;
    terminalPersistenceFailed = true;
    const reason = isQuotaError(error) ? "QUOTA_EXCEEDED" as const : "JOURNAL_COMMIT_FAILED" as const;
    trigger = makeTrigger(reason, "JOURNAL", trigger?.firstMissingEventId ?? null);
    const failedTerminal = terminalDiagnostic();
    persistedTerminal = failedTerminal;
    terminal = failedTerminal;
    phase = "STOPPED";
    const issue = terminalProblem(trigger);
    publish({ type: "terminal", terminal: failedTerminal, status: status(issue) });
    publish({ type: "status", status: status(issue), problem: issue });
    signalTerminalSettled();
  }

  function startTerminalPersistence(): void {
    if (!trigger) return;
    ensureTerminalSettled();
    const intent = terminalDiagnostic();
    const generation = ++terminalIntentGeneration;
    const previous = terminalPersistence ?? Promise.resolve();
    terminalPersistence = previous
      .then(() => journal.persistTerminalIntent(intent))
      .then(() => {
        if (generation === terminalIntentGeneration) {
          persistedTerminal = intent;
        }
      })
      .catch((error) => {
        failTerminalPersistence(error);
      });
  }

  function beginDrain(reason: HistoryTerminalReason, dimension: HistoryCapacityDimension | "JOURNAL", firstMissingEventId: string | null): void {
    if (phase === "STOPPED" || phase === "CLOSED") return;
    phase = "DRAINING_TO_STOP";
    ensureTerminalSettled();
    trigger = makeTrigger(reason, dimension, firstMissingEventId);
    publish({ type: "status", status: status(), problem: terminalProblem(trigger) });
    startTerminalPersistence();
    finishTerminal();
  }

  function scheduleAgeCheck(): void {
    if (ageTimer !== null) timer.clearTimeout(ageTimer);
    ageTimer = null;
    const oldest = oldestAwaiting();
    if (!oldest || phase !== "RUNNING") return;
    const age = Math.max(0, clock() - oldest.offeredAt);
    const delay = Math.max(0, (age < limits.pendingAgeWarningMs ? limits.pendingAgeWarningMs : limits.pendingAgeStopMs) - age);
    ageTimer = timer.setTimeout(() => {
      ageTimer = null;
      pressureChanged();
      const currentAge = measurements().oldestPendingAgeMs;
      if (pendingAgeFailure(limits, currentAge)) beginDrain("PENDING_AGE_LIMIT", "PENDING_AGE", null);
      else scheduleAgeCheck();
    }, delay);
  }

  function offer(candidate: EvidenceCandidate): CaptureReceipt {
    if (phase === "CLOSED" || closing) return refuseClosed();
    if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") return refuseStopped(candidate);
    let serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
    let bytes: number;
    try {
      assertCandidate(candidate);
      serialized = serializeJournalEvidenceCandidate(candidate);
      bytes = estimateHistoryCandidateBytes(candidate, options.byteEstimator, serialized.bytes);
    } catch (error) {
      notAccepted += 1;
      const issue = problem("INVALID_CANDIDATE", error instanceof Error ? error.message : "Candidate is not valid Evidence input.");
      return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary }) };
    }
    const current = measurements();
    const failure = admissionFailure(limits, current, bytes);
    if (failure) {
      notAccepted += 1;
      rejectedCount += 1;
      rejectedBytes += bytes;
      beginDrain(failure.reason, failure.dimension, candidate.id);
      const completion = terminalFinalization ?? terminalSettled;
      const settled = completion
        ? completion.then(() => ({ outcome: "NOT_EVIDENCE" as const, problem: terminalProblem(trigger!), committedEvidenceBoundary }))
        : Promise.resolve({ outcome: "NOT_EVIDENCE" as const, problem: terminalProblem(trigger!), committedEvidenceBoundary });
      return { intake: "REFUSED", settled };
    }
    return offerForClearInProgress(serialized, bytes);
  }

  function scheduleProcessing(): void {
    if (scheduled || processing || pending.length === 0) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; void processPending(); });
  }

  async function processPending(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      while (pending.length > 0 && (phase === "RUNNING" || phase === "DRAINING_TO_STOP")) {
        const batch = pending.splice(0);
        inFlight.push(...batch);
        let candidates: EvidenceCandidate[] = [];
        try {
          candidates = batch.map((entry) => {
            const candidate = freezeCandidate(deserializeJournalEvidenceCandidate(entry.serialized.payload));
            registerJournalOwnedCandidate(candidate, entry.serialized.payload);
            return candidate;
          });
          await journal.commitBatch(candidates);
        } catch (error) {
          const reason = isQuotaError(error) ? "QUOTA_EXCEEDED" as const : "JOURNAL_COMMIT_FAILED" as const;
          const failedTrigger = makeTrigger(reason, "JOURNAL", candidates[0]?.id ?? null);
          trigger = failedTrigger;
          ensureTerminalSettled();
          const discarded = [...batch, ...pending.splice(0)];
          inFlight.length = 0;
          awaitingCount -= discarded.length;
          awaitingBytes -= discarded.reduce((total, entry) => total + entry.bytes, 0);
          notAccepted += discarded.length;
          discardedCount += discarded.length;
          discardedBytes += discarded.reduce((sum, entry) => sum + entry.bytes, 0);
          terminalReceipts.push(...discarded);
          phase = "DRAINING_TO_STOP";
          startTerminalPersistence();
          finishTerminal();
          break;
        }
        const evidence = batch.map((entry, index) => {
          const candidate = candidates[index]!;
          const reference = deepFreeze({ intervalId: interval.id, sequence: nextEvidenceSequence++, eventId: candidateId(candidate) });
          return deepFreeze({ ...reference, candidate });
        });
        inFlight.length = 0;
        awaitingCount -= batch.length;
        awaitingBytes -= batch.reduce((total, entry) => total + entry.bytes, 0);
        committed.push(...evidence);
        retainedCount += evidence.length;
        retainedBytes += batch.reduce((sum, entry) => sum + entry.bytes, 0);
        accepted += evidence.length;
        committedEvidenceBoundary = toRef(evidence.at(-1)!);
        publish(deepFreeze({ type: "committed-evidence" as const, interval, evidence, committedEvidenceBoundary }));
        for (const [index, entry] of batch.entries()) {
          const reference = toRef(evidence[index]);
          if (phase === "DRAINING_TO_STOP") committedReceipts.push({ entry, evidence: reference });
          else entry.resolve({ outcome: "BECAME_EVIDENCE", evidence: reference });
        }
        scheduleAgeCheck();
        pressureChanged();
      }
    } finally {
      processing = false;
      if (pending.length > 0 && phase === "RUNNING") scheduleProcessing();
      finishTerminal();
      const completion = terminalFinalization ?? terminalSettled;
      const settleReceipts = () => {
        for (const { entry, evidence } of committedReceipts.splice(0)) entry.resolve({ outcome: "BECAME_EVIDENCE", evidence });
        const issue = trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary.");
        for (const entry of terminalReceipts.splice(0)) entry.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary });
      };
      if (completion) void completion.then(settleReceipts);
      else settleReceipts();
      resolveIdleWaiters();
    }
  }

  function read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
    if (phase === "CLOSED") {
      return Promise.resolve({
        ok: false,
        problem: problem("HISTORY_CLOSED", "Event History is closed.")
      });
    }
    if (clearInProgress || closing) {
      return Promise.resolve({
        ok: false,
        problem: problem("CLEAR_IN_PROGRESS", "A History Interval clear is currently pending.")
      });
    }
    const intervalEvidence = committed.filter((entry) => entry.intervalId === (query.intervalId ?? interval.id));
    const snapshot = selectEvidence(intervalEvidence, query);
    const evidence = pageEvidence(snapshot, query);
    const retainedRange = intervalEvidence.length
      ? {
          first: toRef(intervalEvidence[0]),
          last: toRef(intervalEvidence[intervalEvidence.length - 1])
        }
      : null;
    return Promise.resolve({
      ok: true,
      value: freezeCommittedRead({
        interval,
        evidence,
        total: snapshot.length,
        committedEvidenceBoundary,
        retainedRange
      })
    });
  }

  function query(request: EvidenceQueryRequest): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
    if (phase === "CLOSED") {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("HISTORY_TERMINAL", "Event History is closed.") });
    }
    if (clearInProgress || closing) {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("QUERY_FAILED", "A History Interval transition is currently pending.") });
    }
    if (!Number.isSafeInteger(request.page.size) || request.page.size < 1 || request.page.size > MAX_EVIDENCE_PAGE_SIZE) {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("QUERY_FAILED", request.page.size > MAX_EVIDENCE_PAGE_SIZE ? `Page size must not exceed ${MAX_EVIDENCE_PAGE_SIZE}.` : "Page size must be a positive integer.") });
    }

    // This is the sole read point. Everything below reads this immutable slice,
    // so a later commit cannot enter this result or change its totals.
    const intervalAtRead = interval;
    const entriesAtRead = committed.filter((entry) => entry.intervalId === intervalAtRead.id).slice();
    const readPoint = evidenceReadPoint(intervalAtRead, entriesAtRead, committedEvidenceBoundary);
    if (request.at !== "LATEST_COMMITTED" && !sameHistoryInterval(request.at, readPoint)) {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("HISTORY_INTERVAL_UNAVAILABLE", "The requested History Interval is unavailable.") });
    }
    if (request.at !== "LATEST_COMMITTED" && !matchesEvidenceReadPoint(request.at, readPoint)) {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("READ_POINT_UNAVAILABLE", "The requested Evidence read point is unavailable.") });
    }

    const records: SelectionRecord[] = entriesAtRead.map((entry) => {
      const cached = deterministicRecordCache.get(entry);
      if (cached) return cached;
      const record = toDeterministicEvidenceRecord(entry, intervalAtRead);
      deterministicRecordCache.set(entry, record);
      return record;
    });
    const around = normalizeAround(request.filter.around, readPoint.retainedRange);
    const filter = around === request.filter.around ? request.filter : { ...request.filter, around };
    if (filter.around?.anchor) {
      const anchor = filter.around.anchor;
      const anchorIndex = entriesAtRead.findIndex((entry) => sameEvidenceIdentity(evidenceIdentity(toRef(entry), intervalAtRead), anchor));
      if (anchor.intervalId !== intervalAtRead.id || anchorIndex < 0 || (filter.around.anchorSequence !== undefined && filter.around.anchorSequence !== anchor.sequence)) {
        return Promise.resolve({ ok: false, problem: evidenceReadProblem("AROUND_ANCHOR_UNAVAILABLE", "The Around Evidence anchor is no longer retained in this History Interval.") });
      }
    }
    const unsupported = filter.unsupported.length > 0;
    const discoveries = new Map<string, FacetDiscoveryResult>();
    let lookupRecords = records;
    if (request.lookup !== undefined) {
      const selectedIndex = records.findIndex((record) => sameEvidenceIdentity(record.identity, request.lookup!));
      if (selectedIndex >= 0) {
        lookupRecords = records.slice();
        lookupRecords[selectedIndex] = Object.freeze({ ...lookupRecords[selectedIndex]!, payload: copyCandidate(entriesAtRead[selectedIndex]!.candidate) });
      }
    }
    if (unsupported) {
      for (const discoveryRequest of request.discover ?? []) {
        discoveries.set(discoveryRequest.facet, {
          state: "UNAVAILABLE", facet: discoveryRequest.facet, reason: "UNSUPPORTED_AT_READ_POINT", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null
        });
      }
      const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
      const find = request.find === undefined ? null : findEvidence(records, request.find);
      return Promise.resolve({ ok: true, value: makeEvidenceSnapshot(readPoint, [], 0, 0, discoveries, "UNSUPPORTED_FILTER", coverageFor(capacityTier, fallback, Boolean(terminal)), "MEMORY_FALLBACK", null, lookup, find) });
    }

    try {
      const matching: DeterministicEvidenceRecord[] = [];
      const inScope: DeterministicEvidenceRecord[] = [];
      for (const record of records) {
        const evaluation = evaluateFilter({ ...filter, around: null } as unknown as Filter, {
          timestamp: record.timestamp,
          intervalId: record.identity.intervalId,
          searchText: record.searchText,
          facets: record.facets as unknown as FilterRecord["facets"]
        });
        if (!evaluation.matches) continue;
        matching.push(record);
        if (isInAround(record, around)) inScope.push(record);
      }
      for (const discoveryRequest of request.discover ?? []) {
        try {
          discoveries.set(discoveryRequest.facet, discoverFacet(records, request.filter, readPoint, discoveryRequest, options.discovery));
        } catch {
          discoveries.set(discoveryRequest.facet, {
            state: "UNAVAILABLE", facet: discoveryRequest.facet, reason: "DISCOVERY_FAILED", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null
          });
        }
      }
      const ordered = request.page.order === "NEWEST_FIRST" ? [...inScope].reverse() : inScope;
      const offset = readCursor(request.page.cursor);
      const page = ordered.slice(offset, offset + request.page.size);
      const nextCursor = offset + page.length < ordered.length ? String(offset + page.length) : null;
      const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
        const find = request.find === undefined ? null : findEvidence(records, request.find);
      return Promise.resolve({
        ok: true,
        value: makeEvidenceSnapshot(readPoint, page, matching.length, inScope.length, discoveries, "COMPLETE", coverageFor(capacityTier, fallback, Boolean(terminal)), "MEMORY_FALLBACK", nextCursor, lookup, find)
      });
    } catch (error) {
      return Promise.resolve({ ok: false, problem: evidenceReadProblem("QUERY_FAILED", error instanceof Error ? error.message : "Evidence query failed.") });
    }
  }

  function clear(): Promise<Outcome<ClearResult>> {
    if (clearPromise) {
      return clearPromise;
    }
    if (closing || phase === "CLOSED") {
      return Promise.resolve({ ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed and cannot be cleared.") });
    }
    if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") {
      return Promise.resolve({ ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") });
    }
    if (lastClearResult && committed.length === 0 && pending.length === 0 && postClearPending.length === 0 && inFlight.length === 0) {
        return Promise.resolve({ ok: true, value: lastClearResult });
      }
    clearInProgress = true;
    clearPromise = waitForIdle().then(async () => {
      if (phase === "CLOSED") {
        return { ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed and cannot be cleared.") };
      }
      if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") {
        rejectPostClearDuringClearFailure(clearBlockedProblem(), true);
        return { ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") };
      }
      const previousInterval = interval;
      const nextInterval = createInterval(sessionId, intervalOrdinal + 1);
      try {
        const applied = await options.clearJournal?.();
        if (applied === false) {
          const issue = problem("CLEAR_FAILED", "The History Interval could not be cleared.");
          rejoinPostClearQueue();
          lastClearResult = null;
          publish({ type: "status", status: status(issue), problem: issue });
          return { ok: false, problem: issue };
        }
        intervalOrdinal += 1;
        interval = nextInterval;
        committed.length = 0;
        retainedBytes = 0;
        retainedCount = 0;
        lastNearLimit = false;
        rejoinPostClearQueue();
        clearInProgress = false;
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
      } catch (error) {
        const clearFailureProblem = problem(
          "HISTORY_STOPPED",
          error instanceof Error ? error.message : "The History Interval could not be cleared."
        );
        if (phase === "RUNNING" && !terminal) {
          phase = "DRAINING_TO_STOP";
          trigger = makeTrigger("JOURNAL_COMMIT_FAILED", "JOURNAL", null);
          rejectPostClearDuringClearFailure(terminalProblem(trigger));
          startTerminalPersistence();
          finishTerminal();
        } else {
          rejoinPostClearQueue();
        }
        const issue = problem("CLEAR_FAILED", clearFailureProblem.message);
        publish({ type: "status", status: status(issue), problem: issue });
        return { ok: false, problem: issue };
      }
    });
    void clearPromise.finally(() => {
      clearInProgress = false;
      clearPromise = null;
      if (pending.length > 0 && !clearInProgress) {
        scheduleProcessing();
      }
    });
    return clearPromise;
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closePromise) {
      return closePromise;
    }
    if (clearPromise) {
      closing = true;
      return clearPromise.then(() => close());
    }
    if (phase === "CLOSED") {
      const result = lastCloseOutcome ?? { ok: true, value: closeResult() };
      return Promise.resolve(result);
    }
    closing = true;
    if (ageTimer !== null) timer.clearTimeout(ageTimer);
    ageTimer = null;
    closePromise = waitForIdle().then(() => waitForTerminalQuiescence()).then(async () => {
      const finalCommittedEvidenceBoundary = committedEvidenceBoundary;
      let dataDisposition: CloseResult["dataDisposition"] = "ERASURE_UNCONFIRMED";
      let cleanupDisposition: CloseResult["cleanupDisposition"] = "DEFERRED";
      try {
        const applied = await options.clearJournal?.();
        if (applied !== false) {
          dataDisposition = "ERASED";
          await journal.close();
          cleanupDisposition = "COMPLETE";
        }
      } catch (error) {
        const issue = problem(
          "CLOSE_FAILED",
          error instanceof Error ? error.message : "Event History cleanup could not be confirmed."
        );
        phase = "CLOSED";
        publish({ type: "status", status: status(issue), problem: issue });
        const result = closeResult({ finalCommittedEvidenceBoundary, dataDisposition, cleanupDisposition });
        const outcome = { ok: false, problem: issue, value: result } as Outcome<CloseResult>;
        lastCloseOutcome = outcome;
        return outcome;
      }
      if (clearInProgress) {
        const issue = problem("CLOSE_FAILED", "Event History clear is in progress.");
        publish({ type: "status", status: status(issue), problem: issue });
        const result = closeResult({ finalCommittedEvidenceBoundary, dataDisposition, cleanupDisposition });
        const outcome = { ok: false, problem: issue, value: result } as Outcome<CloseResult>;
        lastCloseOutcome = outcome;
        return outcome;
      }
        const result = closeResult({ finalCommittedEvidenceBoundary, dataDisposition, cleanupDisposition });
        committed.length = 0;
        retainedBytes = 0;
        retainedCount = 0;
        phase = "CLOSED";
        const outcome = { ok: true, value: result } as Outcome<CloseResult>;
        lastCloseOutcome = outcome;
        publish(deepFreeze({ type: "closed" as const, result }));
        return outcome;
      });
      return closePromise;
    }

  function closeResult(values: { finalCommittedEvidenceBoundary?: EvidenceRef | null; dataDisposition?: CloseResult["dataDisposition"]; cleanupDisposition?: CloseResult["cleanupDisposition"] } = {}): CloseResult {
    return deepFreeze({
      finalCommittedEvidenceBoundary: values.finalCommittedEvidenceBoundary ?? committedEvidenceBoundary,
      dataDisposition: values.dataDisposition ?? "ERASURE_UNCONFIRMED",
      cleanupDisposition: values.cleanupDisposition ?? "DEFERRED"
    });
  }

  function waitForIdle(): Promise<void> {
    if (!processing && pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  async function waitForTerminalQuiescence(): Promise<void> {
    while (phase === "DRAINING_TO_STOP") {
      finishTerminal();
      if (terminalPersistenceFailed) return;
      const completion = terminalFinalization ?? terminalSettled;
      if (!completion) return;
      await completion;
      if (phase === "DRAINING_TO_STOP" && !terminalFinalization && !terminalPersistence && terminalSettled) {
        finishTerminal();
      }
    }
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
    const immutablePublication = deepFreeze(publication);
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying) {
        subscriber.pending.push(immutablePublication);
      } else {
        invoke(subscriber, immutablePublication);
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

  return { storage, status, offer, read, query, clear, follow, close };
}

function createInterval(sessionId: string, ordinal: number): HistoryInterval {
  return deepFreeze({ id: `${sessionId}:interval-${ordinal}`, ordinal });
}

function candidateId(candidate: EvidenceCandidate): string {
  return candidate.id;
}

function candidateIdIfPresent(candidate: unknown): string | null {
  return candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string" && candidate.id.length > 0
    ? candidate.id
    : null;
}

export function selectEvidence(evidence: readonly CommittedEvidence[], query: EvidenceQuery): CommittedEvidence[] {
  return evidence.filter((entry) => matchesEvidenceQuery(entry, query));
}

export function matchesEvidenceQuery(entry: CommittedEvidence, query: EvidenceQuery): boolean {
  if (query.candidateKind === "lightstreamer" && entry.candidate.kind === "topology-checkpoint") return false;
  if (query.candidateKind === "topology-checkpoint" && entry.candidate.kind !== "topology-checkpoint") return false;
  if (query.afterSequence !== undefined && entry.sequence <= query.afterSequence) return false;
  if (query.eventId !== undefined && entry.eventId !== query.eventId) return false;
  if (query.filters && !matchesCandidateFilters(entry.candidate, query.filters)) return false;
  if (query.find) {
    const text = journalCandidateSearchText(entry.candidate);
    if (!text.includes(query.find.trim().toLowerCase())) return false;
  }
  return true;
}

export function pageEvidence(evidence: readonly CommittedEvidence[], query: EvidenceQuery): CommittedEvidence[] {
  const offset = Math.max(0, Math.floor(query.offsetFromNewest ?? 0));
  if (query.offsetFromNewest !== undefined) {
    const newestFirst = [...evidence].reverse();
    const page = newestFirst.slice(offset, query.limit === undefined ? undefined : offset + Math.max(0, query.limit));
    return query.order === "desc" ? page : page.reverse();
  }
  const ordered = query.order === "desc" ? [...evidence].reverse() : [...evidence];
  return query.limit === undefined ? ordered : ordered.slice(0, Math.max(0, query.limit));
}

function matchesCandidateFilters(candidate: EvidenceCandidate, filters: EventFilterState): boolean {
  if (candidate.kind !== "topology-checkpoint") return matchesEventFilters(candidate, filters);

  if (filters.query && !journalCandidateSearchText(candidate).includes(filters.query.trim().toLowerCase())) {
    return false;
  }
  return !Object.entries(filters).some(([key, value]) => key !== "query" && value !== undefined && value !== "");
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({
    intervalId: evidence.intervalId,
    sequence: evidence.sequence,
    eventId: evidence.eventId
  });
}

function evidenceReadProblem(code: EvidenceFilterReadProblem["code"], message: string): EvidenceFilterReadProblem {
  return Object.freeze({ code, message });
}

function evidenceIdentity(ref: EvidenceRef, interval: HistoryInterval): EvidenceIdentity {
  return Object.freeze({
    intervalId: ref.intervalId,
    pageId: interval.id,
    ownerId: "memory-event-history",
    sequence: ref.sequence,
    eventId: ref.eventId
  });
}

function evidenceReadPoint(interval: HistoryInterval, entries: readonly CommittedEvidence[], boundary: EvidenceRef | null): EvidenceReadPoint {
  const first = entries[0] ? evidenceIdentity(toRef(entries[0]), interval) : null;
  const last = entries.at(-1) ? evidenceIdentity(toRef(entries.at(-1)!), interval) : null;
  const committed = boundary ? evidenceIdentity(boundary, interval) : last;
  return Object.freeze({
    interval: Object.freeze({ id: interval.id, ordinal: interval.ordinal }),
    committedEvidenceBoundary: committed,
    retainedRange: first && last ? Object.freeze({ first, last }) : null
  });
}

function matchesEvidenceReadPoint(requested: EvidenceReadPoint, current: EvidenceReadPoint): boolean {
  if (requested.interval.id !== current.interval.id || requested.interval.ordinal !== current.interval.ordinal) return false;
  return sameEvidenceIdentity(requested.committedEvidenceBoundary, current.committedEvidenceBoundary)
    && sameEvidenceRange(requested.retainedRange, current.retainedRange);
}

function sameHistoryInterval(requested: EvidenceReadPoint, current: EvidenceReadPoint): boolean {
  return requested.interval.id === current.interval.id && requested.interval.ordinal === current.interval.ordinal;
}

function sameEvidenceIdentity(left: EvidenceIdentity | null, right: EvidenceIdentity | null): boolean {
  if (left === null || right === null) return left === right;
  return left.intervalId === right.intervalId && left.pageId === right.pageId && left.ownerId === right.ownerId && left.sequence === right.sequence && left.eventId === right.eventId;
}

function sameEvidenceRange(left: EvidenceReadPoint["retainedRange"], right: EvidenceReadPoint["retainedRange"]): boolean {
  if (left === null || right === null) return left === right;
  return sameEvidenceIdentity(left.first, right.first) && sameEvidenceIdentity(left.last, right.last);
}

function readCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Page cursor must be a non-negative integer.");
  return value;
}

function inEvidenceScope(record: DeterministicEvidenceRecord, around: EvidenceQueryRequest["filter"]["around"]): boolean {
  return around === null || (
    record.identity.intervalId === around.intervalId
    && record.timestamp >= around.start
    && record.timestamp < around.end
  );
}

function toDeterministicEvidenceRecord(entry: CommittedEvidence, interval: HistoryInterval): DeterministicEvidenceRecord {
  const identity = evidenceIdentity(toRef(entry), interval);
  if (entry.candidate.kind === "topology-checkpoint") {
    const searchText = journalCandidateSearchText(entry.candidate);
    return Object.freeze({ identity, timestamp: 0, summary: "Topology checkpoint", searchText, facets: Object.freeze({}) });
  }
  const facets = extractEvidenceFacets(entry.candidate, { identity, pageId: identity.pageId, listenerOwner: identity.ownerId }).facets;
  return Object.freeze({
    identity,
    timestamp: entry.candidate.timestamp,
    summary: entry.candidate.kind,
    searchText: canonicalEvidenceSearchText(entry.candidate, { identity, pageId: identity.pageId, listenerOwner: identity.ownerId, summary: entry.candidate.kind }),
    facets: Object.freeze(facets)
  });
}

function makeEvidenceSnapshot(
  readPoint: EvidenceReadPoint,
  page: readonly DeterministicEvidenceRecord[],
  matching: number,
  inScope: number,
  discoveries: ReadonlyMap<string, FacetDiscoveryResult>,
  evaluation: EvidenceSnapshot["evaluation"],
  coverage: EvidenceSnapshot["coverage"],
  storageName: EvidenceSnapshot["storage"],
  nextCursor: string | null = null
  , lookup: EvidenceSnapshot["lookup"] = null
  , find: EvidenceSnapshot["find"] = null
): EvidenceSnapshot {
  return Object.freeze({
    readPoint,
    page: Object.freeze({ evidence: Object.freeze([...page]), nextCursor }),
    totals: Object.freeze({ matching, inScope }),
    discoveries: immutableReadonlyMap(discoveries),
    lookup,
    find,
    evaluation,
    coverage,
    storage: storageName
  });
}

function coverageFor(tier: HistoryCapacityTier, fallback: MemoryEventHistoryOptions["fallback"], terminal: boolean): EvidenceSnapshot["coverage"] {
  return tier === "LOWER" || fallback !== null || terminal ? "LIMITED" : "COMPLETE";
}

function immutableReadonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const entries = [...source.entries()];
  const view: ReadonlyMap<K, V> = {
    get size() { return entries.length; },
    get(key) { return entries.find(([candidate]) => Object.is(candidate, key))?.[1]; },
    has(key) { return entries.some(([candidate]) => Object.is(candidate, key)); },
    entries() { return entries[Symbol.iterator](); },
    keys() { return entries.map(([key]) => key)[Symbol.iterator](); },
    values() { return entries.map(([, value]) => value)[Symbol.iterator](); },
    forEach(callback, thisArg) { for (const [key, value] of entries) callback.call(thisArg, value, key, view); },
    [Symbol.iterator]() { return entries[Symbol.iterator](); }
  };
  return Object.freeze(view);
}

export function copyCandidate(candidate: EvidenceCandidate): EvidenceCandidate {
  assertCandidate(candidate);
  return freezeCandidate(structuredClone(candidate));
}

/** @internal Validates an Evidence candidate without copying its payload. */
export function assertCandidate(candidate: unknown): asserts candidate is EvidenceCandidate {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Candidate must be an object.");
  }
  const value = candidate as { kind?: unknown; id?: unknown };
  if (value.kind === "topology-checkpoint") {
    if (!isTopologyCheckpointEvidenceCandidate(candidate)) {
      throw new Error("Topology checkpoint candidate is incomplete.");
    }
    return;
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Capture candidate must have a stable event ID.");
  }
}

/** @internal Freezes a candidate after its immutable serialized snapshot exists. */
export function freezeCandidate(candidate: EvidenceCandidate): EvidenceCandidate {
  return deepFreeze(candidate);
}

function isTopologyCheckpointEvidenceCandidate(candidate: unknown): candidate is TopologyCheckpointEvidenceCandidate {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const checkpointCandidate = candidate as {
    kind?: unknown;
    id?: unknown;
    checkpoint?: unknown;
  };
  return (
    checkpointCandidate.kind === "topology-checkpoint" &&
    typeof checkpointCandidate.id === "string" &&
    checkpointCandidate.id.length > 0 &&
    isPlainRecord(checkpointCandidate.checkpoint)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nextId(): string {
  return Math.random().toString(36).slice(2);
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "QuotaExceededError" || value.code === "QUOTA_EXCEEDED";
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

/**
 * Materializes a read without recursively walking every retained payload.
 *
 * This shortcut is intentionally limited to the committed journal read seam:
 * candidates are serialized at intake, deserialized into journal-owned values,
 * and deeply frozen before they enter `committed`. Callers therefore cannot
 * smuggle a shallow-frozen candidate past the ownership boundary. The response
 * containers remain newly frozen for each read.
 */
function freezeCommittedRead(value: EvidenceRead): EvidenceRead {
  const retainedRange = value.retainedRange === null
    ? null
    : Object.freeze({ first: value.retainedRange.first, last: value.retainedRange.last });
  return Object.freeze({
    interval: value.interval,
    evidence: Object.freeze([...value.evidence]),
    total: value.total,
    committedEvidenceBoundary: value.committedEvidenceBoundary,
    retainedRange
  });
}
