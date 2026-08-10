import {
  admissionFailure,
  defaultHistoryTimer,
  estimateHistoryCandidateBytes,
  historyCapacityLimits,
  pendingAgeFailure,
  pressureFor,
  type HistoryCapacityOptions,
  type HistoryCapacityTier,
  type HistoryCapacityDimension,
  type HistoryTerminalReason,
  type HistoryPressureMeasurements,
  type HistoryTrigger
} from "./event-history-capacity";
import {
  AUTHORITATIVE_EVENT_CONTROL_KEY,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  openAuthoritativeEventDatabase,
  type AuthoritativeEventDatabase
} from "./indexeddb/authoritative-event-db";
import {
  deserializeJournalEvidenceCandidate,
  journalAccountedBytes,
  serializeJournalEvidenceCandidate
} from "./event-history-serialization";
import {
  type CaptureReceipt,
  type ClearResult,
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
  type CloseResult,
  matchesEvidenceQuery,
  type HistoryTerminalDiagnostic
} from "./event-history-authoritative";

export const AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT = 256;
export const AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES = 1_048_576;

type ControlRecord = {
  key: typeof AUTHORITATIVE_EVENT_CONTROL_KEY;
  schemaVersion: number;
  recordVersion: 3;
  panelSessionId: string;
  interval: HistoryInterval;
  phase: "RUNNING" | "DRAINING_TO_STOP" | "STOPPED";
  terminal: HistoryTerminalDiagnostic | null;
  nextSequence: number;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: { first: EvidenceRef; last: EvidenceRef } | null;
  retainedCount: number;
  replayPayloadBytes: number;
  accountedBytes: number;
};

type EvidenceRecord = {
  intervalId: string;
  sequence: number;
  eventId: string;
  replayPayload: string;
  serializedBytes: number;
  accountedBytes: number;
  facets: string[];
};

type Pending = {
  ordinal: number;
  candidate: EvidenceCandidate;
  serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
  bytes: number;
  offeredAt: number;
  resolve: (result: ReceiptResult) => void;
};

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
  pending: Array<HistoryPublication | PendingReplayRange>;
};

export type IndexedDbEventHistoryOptions = Readonly<{
  panelSessionId?: string;
  capacityTier?: HistoryCapacityTier;
  failure?: Readonly<{ commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void> }>;
  commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void>;
  finalizeTerminal?: (terminal: HistoryTerminalDiagnostic) => void | Promise<void>;
}> & HistoryCapacityOptions;

export async function createIndexedDbEventHistory(
  options: IndexedDbEventHistoryOptions = {}
): Promise<EventHistory> {
  const panelSessionId = options.panelSessionId ?? `session-${Math.random().toString(36).slice(2)}`;
  const database = await openAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  try {
    const loaded = await loadJournal(database, panelSessionId);
    return createHistory(database, loaded, options);
  } catch (error) {
    database.db.close();
    throw error;
  }
}

type LoadedJournal = {
  panelSessionId: string;
  interval: HistoryInterval;
  phase: "RUNNING" | "DRAINING_TO_STOP" | "STOPPED";
  terminal: HistoryTerminalDiagnostic | null;
  nextSequence: number;
  replayPayloadBytes: number;
  retainedBytes: number;
  durableAccountedBytes: number;
  retainedCount: number;
  retainedRange: { first: EvidenceRef; last: EvidenceRef } | null;
  committedEvidenceBoundary: EvidenceRef | null;
};

type ReadLatch = Readonly<{
  interval: HistoryInterval;
  generation: number;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: { first: EvidenceRef; last: EvidenceRef } | null;
  retainedCount: number;
}>;

type PendingReplayRange = Readonly<{
  type: "committed-range";
  interval: HistoryInterval;
  firstSequence: number;
  lastSequence: number;
  committedEvidenceBoundary: EvidenceRef;
}>;

function createHistory(database: AuthoritativeEventDatabase, loaded: LoadedJournal, options: IndexedDbEventHistoryOptions): EventHistory {
  const subscribers = new Set<Subscriber>();
  const pending: Pending[] = [];
  const inFlight: Pending[] = [];
  const terminalReceipts: Pending[] = [];
  const committedReceipts: Array<{ entry: Pending; evidence: EvidenceRef }> = [];
  const idleWaiters: Array<() => void> = [];
  let interval = loaded.interval;
  let phase: HistoryStatus["phase"] = loaded.phase;
  let terminal: HistoryTerminalDiagnostic | undefined = loaded.terminal ?? undefined;
  let nextSequence = loaded.nextSequence;
  let committedEvidenceBoundary = loaded.committedEvidenceBoundary;
  let replayPayloadBytes = loaded.replayPayloadBytes;
  let retainedBytes = loaded.retainedBytes;
  let durableAccountedBytes = loaded.durableAccountedBytes;
  let retainedCount = loaded.retainedCount;
  let retainedRange = loaded.retainedRange;
  let generation = 0;
  let captured = Math.max(0, nextSequence - 1);
  let accepted = Math.max(0, nextSequence - 1);
  let notAccepted = 0;
  let rejectedCount = 0;
  let rejectedBytes = 0;
  let discardedCount = 0;
  let discardedBytes = 0;
  let processing = false;
  let scheduled = false;
  let ageTimer: unknown = null;
  let closing = false;
  let clearPromise: Promise<Outcome<ClearResult>> | null = null;
  let lastClearResult: ClearResult | null = null;
  let closePromise: Promise<Outcome<CloseResult>> | null = null;
  let trigger: HistoryTrigger | null = terminal ? triggerFromTerminal(terminal) : null;
  let persistedTerminal: HistoryTerminalDiagnostic | undefined = terminal;
  let terminalPersistence: Promise<void> | null = null;
  let terminalFinalization: Promise<void> | null = null;
  let terminalSettled: Promise<void> | null = null;
  let resolveTerminalSettled: (() => void) | null = null;
  let terminalPersistenceFailed = false;
  let terminalIntentGeneration = 0;
  let lastNearLimit = false;
  const capacityTier = options.capacityTier ?? "NORMAL";
  const limits = historyCapacityLimits(capacityTier, options.capacity);
  const clock = options.clock ?? Date.now;
  const timer = options.timer ?? defaultHistoryTimer();

  function currentBoundary(): EvidenceRef | null { return committedEvidenceBoundary; }
  function currentRange(): { first: EvidenceRef; last: EvidenceRef } | null { return retainedRange; }
  function measurements(): HistoryPressureMeasurements {
    const awaiting = [...inFlight, ...pending].sort((left, right) => left.ordinal - right.ordinal);
    const oldest = awaiting[0];
    return Object.freeze({
      retainedCount,
      retainedBytes,
      pendingCount: awaiting.length,
      pendingBytes: awaiting.reduce((total, entry) => total + entry.bytes, 0),
      oldestPendingAgeMs: oldest ? Math.max(0, clock() - oldest.offeredAt) : null
    });
  }
  function status(problemValue?: HistoryProblem): HistoryStatus {
    const pressure = pressureFor(limits, measurements());
    const value: HistoryStatus = deepFreeze({
      phase,
      captureOperation: phase === "RUNNING" && !closing ? "RUNNING" : "STOPPED" as const,
      interval,
      committedEvidenceBoundary: currentBoundary(),
      retainedRange: currentRange(),
      capacity: { tier: capacityTier, state: phase !== "RUNNING" ? "EXHAUSTED" as const : pressure.nearLimit ? "NEAR_LIMIT" as const : "AVAILABLE" as const, limits, measurements: pressure.measurements },
      fallback: null,
      captured,
      awaitingAcceptance: pending.length + inFlight.length,
      accepted,
      notAccepted,
      retained: retainedCount,
      ...(terminal ? { terminal } : {})
    });
    return problemValue ? deepFreeze({ ...value, problem: problemValue }) as HistoryStatus : value;
  }
  function problem(code: HistoryProblem["code"], message: string, extras: Partial<HistoryProblem> = {}): HistoryProblem {
    return deepFreeze({ code, message, ...extras });
  }
  function terminalProblem(triggerValue: HistoryTrigger): HistoryProblem {
    return problem(triggerValue.reason, `Event History stopped because ${triggerValue.reason}.`, {
      reason: triggerValue.reason,
      dimension: triggerValue.dimension,
      ...(terminal ?? persistedTerminal ? { terminal: terminal ?? persistedTerminal } : {})
    });
  }
  function pressureChanged(): void {
    const near = pressureFor(limits, measurements()).nearLimit;
    if (near !== lastNearLimit) { lastNearLimit = near; publish({ type: "status", status: status() }); }
  }
  function makeTrigger(reason: HistoryTerminalReason, dimension: HistoryCapacityDimension | "JOURNAL", firstMissingEventId: string | null): HistoryTrigger {
    return deepFreeze({ reason, dimension, tier: capacityTier, triggerTime: clock(), interval, firstMissingEventId, measurements: measurements() });
  }
  function finishTerminal(): void {
    if (phase !== "DRAINING_TO_STOP" || processing || pending.length > 0 || inFlight.length > 0 || terminal || terminalFinalization || !trigger || !terminalSettled) return;
    terminalFinalization = (terminalPersistence ?? terminalSettled).then(async () => {
      if (terminalPersistenceFailed || phase !== "DRAINING_TO_STOP" || !trigger) return;
      const finalized = terminalDiagnostic();
      try {
        await options.finalizeTerminal?.(finalized);
        await finalizeTerminal(
          database,
          loaded.panelSessionId,
          interval,
          nextSequence,
          committedEvidenceBoundary,
          retainedRange,
          retainedCount,
          replayPayloadBytes,
          durableAccountedBytes,
          finalized
        );
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
    return deepFreeze({
      reason: trigger.reason,
      dimension: trigger.dimension,
      tier: trigger.tier,
      triggerTime: trigger.triggerTime,
      triggerInterval: trigger.interval,
      interval,
      committedEvidenceBoundary,
      retainedRange,
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
    const issue = terminalProblem(trigger);
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
      .then(() => persistTerminalIntent(
        database,
        loaded.panelSessionId,
        intent
      ))
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
    publish({ type: "status", status: status(terminalProblem(trigger)) });
    startTerminalPersistence();
    finishTerminal();
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
    // The terminal publication is the immutable accounting snapshot for the
    // stop boundary. Offers arriving after it are still refused, but cannot
    // retroactively change that published diagnostic.
    if (!terminal) {
      rejectedBytes += refusedCandidateBytes(candidate);
      rejectedCount += 1;
    }
    const receiptProblem = trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary.");
    const completion = terminalFinalization ?? terminalSettled;
    const settled = completion
      ? completion.then(() => ({ outcome: "NOT_EVIDENCE" as const, problem: receiptProblem, committedEvidenceBoundary: currentBoundary() }))
      : Promise.resolve({ outcome: "NOT_EVIDENCE" as const, problem: receiptProblem, committedEvidenceBoundary: currentBoundary() });
    return { intake: "REFUSED", settled };
  }
  function refuseClosed(): CaptureReceipt {
    notAccepted += 1;
    return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: problem("HISTORY_CLOSED", "Event History is closed."), committedEvidenceBoundary: currentBoundary() }) };
  }
  function scheduleAgeCheck(): void {
    if (ageTimer !== null) timer.clearTimeout(ageTimer);
    ageTimer = null;
    const oldest = [...inFlight, ...pending].sort((left, right) => left.ordinal - right.ordinal)[0];
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
    let copied: EvidenceCandidate;
    let serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
    let bytes: number;
    try {
      copied = copyCandidate(candidate);
      serialized = serializeJournalEvidenceCandidate(copied);
      bytes = estimateHistoryCandidateBytes(copied, options.byteEstimator);
    } catch (error) {
      notAccepted += 1;
      const issue = problem("INVALID_CANDIDATE", error instanceof Error ? error.message : "Candidate is not valid Evidence input.");
      return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() }) };
    }
    const failure = admissionFailure(limits, measurements(), bytes);
    if (failure) {
      notAccepted += 1;
      rejectedCount += 1;
      rejectedBytes += bytes;
      beginDrain(failure.reason, failure.dimension, copied.id);
      const receiptProblem = terminalProblem(trigger!);
      const completion = terminalFinalization ?? terminalSettled;
      const settled = completion
        ? completion.then(() => ({ outcome: "NOT_EVIDENCE" as const, problem: receiptProblem, committedEvidenceBoundary: currentBoundary() }))
        : Promise.resolve({ outcome: "NOT_EVIDENCE" as const, problem: receiptProblem, committedEvidenceBoundary: currentBoundary() });
      return { intake: "REFUSED", settled };
    }
    let resolve!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((finish) => { resolve = finish; });
    const ordinal = captured + 1;
    captured += 1;
    pending.push({ ordinal, candidate: copied, serialized, bytes, offeredAt: clock(), resolve });
    scheduleAgeCheck();
    pressureChanged();
    schedule();
    return { intake: "QUEUED", settled };
  }

  function schedule(): void {
    if (scheduled || processing || pending.length === 0) return;
    scheduled = true;
    globalThis.setTimeout(() => {
      scheduled = false;
      void processPending();
    }, 0);
  }

  async function processPending(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      while (pending.length > 0 && (phase === "RUNNING" || phase === "DRAINING_TO_STOP")) {
        const batch: Pending[] = [];
        let batchSerializedBytes = 0;
        while (pending.length > 0 && batch.length < AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT) {
          const next = pending[0];
          if (batch.length > 0 && batchSerializedBytes + next.serialized.bytes > AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES) break;
          batch.push(pending.shift()!);
          batchSerializedBytes += next.serialized.bytes;
        }
        const batchAccountedBytes = batch.reduce((sum, entry) => sum + entry.bytes, 0);
        inFlight.push(...batch);
        const evidence = batch.map((entry, index) => toCommittedEvidence(entry.candidate, interval, nextSequence + index));
        try {
          await options.failure?.commitBatch?.(batch.map((entry) => entry.candidate));
          await options.commitBatch?.(batch.map((entry) => entry.candidate));
          const controlPhase = phase === "RUNNING" ? "RUNNING" as const : "DRAINING_TO_STOP" as const;
          const controlTerminal = controlPhase === "DRAINING_TO_STOP" ? terminalDiagnostic() : null;
          const batchDurableAccountedBytes = batch.reduce((sum, entry) => sum + journalAccountedBytes(entry.serialized.bytes), 0);
          await commitBatch(
            database,
            loaded.panelSessionId,
            interval,
            nextSequence,
            retainedRange,
            retainedCount,
            evidence,
            replayPayloadBytes + batchSerializedBytes,
            durableAccountedBytes + batchDurableAccountedBytes,
            controlPhase,
            controlTerminal
          );
        } catch (error) {
          const reason: HistoryTerminalReason = isQuotaError(error) ? "QUOTA_EXCEEDED" : "JOURNAL_COMMIT_FAILED";
          const failedTrigger = makeTrigger(reason, "JOURNAL", batch[0]?.candidate.id ?? null);
          trigger = failedTrigger;
          phase = "DRAINING_TO_STOP";
          ensureTerminalSettled();
          const discarded = [...batch, ...pending.splice(0)];
          inFlight.length = 0;
          notAccepted += discarded.length;
          discardedCount += discarded.length;
          discardedBytes += discarded.reduce((sum, entry) => sum + entry.bytes, 0);
          terminalReceipts.push(...discarded);
          startTerminalPersistence();
          finishTerminal();
          break;
        }
        nextSequence += evidence.length;
        replayPayloadBytes += batchSerializedBytes;
        durableAccountedBytes += batch.reduce((sum, entry) => sum + journalAccountedBytes(entry.serialized.bytes), 0);
        inFlight.length = 0;
        committedEvidenceBoundary = toRef(evidence.at(-1)!);
        retainedBytes += batchAccountedBytes;
        retainedCount += evidence.length;
        retainedRange = retainedRange
          ? { first: retainedRange.first, last: committedEvidenceBoundary }
          : { first: toRef(evidence[0]), last: committedEvidenceBoundary };
        generation += 1;
        accepted += evidence.length;
        const boundary = currentBoundary()!;
        publish(deepFreeze({ type: "committed-evidence" as const, interval, evidence, committedEvidenceBoundary: boundary }));
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
      if (pending.length > 0 && phase === "RUNNING") schedule();
      finishTerminal();
      const completion = terminalFinalization ?? terminalSettled;
      const settleReceipts = () => {
        for (const { entry, evidence } of committedReceipts.splice(0)) entry.resolve({ outcome: "BECAME_EVIDENCE", evidence });
        const issue = trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary.");
        for (const entry of terminalReceipts.splice(0)) entry.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() });
      };
      if (completion) void completion.then(settleReceipts);
      else settleReceipts();
      resolveIdleWaiters();
    }
  }

  function read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
    if (phase === "CLOSED") return Promise.resolve({ ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed.") });
    const latch = latchForCurrentInterval();
    const requestedIntervalId = query.intervalId ?? latch.interval.id;
    if (requestedIntervalId !== latch.interval.id || latch.retainedRange === null) {
      return Promise.resolve({
        ok: true,
        value: deepFreeze({
          interval: latch.interval,
          evidence: [],
          total: 0,
          committedEvidenceBoundary: latch.committedEvidenceBoundary,
          retainedRange: requestedIntervalId === latch.interval.id ? latch.retainedRange : null
        })
      });
    }
    return readJournal(database, latch, query).then((selected) => ({
      ok: true as const,
      value: deepFreeze({
        interval: latch.interval,
        evidence: selected.evidence,
        total: selected.total,
        committedEvidenceBoundary: latch.committedEvidenceBoundary,
        retainedRange: latch.retainedRange
      })
    }));
  }

  function clear(): Promise<Outcome<ClearResult>> {
    if (clearPromise) return clearPromise;
    if (lastClearResult && retainedCount === 0 && pending.length === 0) return Promise.resolve({ ok: true, value: lastClearResult });
    clearPromise = waitForIdle().then(async () => {
      if (phase === "CLOSED") return { ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed.") };
      if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") return { ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") };
      const previousInterval = interval;
      const nextInterval = Object.freeze({ id: `${loaded.panelSessionId}:interval-${previousInterval.ordinal + 1}`, ordinal: previousInterval.ordinal + 1 });
      try {
        await clearJournal(database, loaded.panelSessionId, nextInterval, nextSequence, committedEvidenceBoundary);
      } catch (error) {
        const issue = problem("CLEAR_FAILED", error instanceof Error ? error.message : "The History Interval could not be cleared.");
        publish({ type: "status", status: status(issue), problem: issue });
        return { ok: false, problem: issue };
      }
      interval = nextInterval;
      retainedCount = 0;
      retainedRange = null;
      replayPayloadBytes = 0;
      retainedBytes = 0;
      durableAccountedBytes = 0;
      lastNearLimit = false;
      generation += 1;
      const result = deepFreeze({ previousInterval, interval });
      lastClearResult = result;
      publish(deepFreeze({ type: "interval-cleared" as const, previousInterval, interval, status: status() }));
      return { ok: true, value: result };
    });
    void clearPromise.finally(() => { clearPromise = null; });
    return clearPromise;
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closePromise) return closePromise;
    if (phase === "CLOSED") return Promise.resolve({ ok: true, value: closeResult() });
    closing = true;
    if (ageTimer !== null) timer.clearTimeout(ageTimer);
    ageTimer = null;
    closePromise = waitForIdle().then(() => waitForTerminalQuiescence()).then(async () => {
      const finalCommittedEvidenceBoundary = currentBoundary();
      try {
        await clearJournal(database, loaded.panelSessionId, interval, nextSequence, committedEvidenceBoundary);
        database.db.close();
      } catch (error) {
        phase = "CLOSED";
        return { ok: false, problem: problem("CLOSE_FAILED", error instanceof Error ? error.message : "Event History cleanup could not be confirmed.") };
      }
      phase = "CLOSED";
      retainedCount = 0;
      retainedRange = null;
      replayPayloadBytes = 0;
      retainedBytes = 0;
      const result = deepFreeze({ finalCommittedEvidenceBoundary, dataDisposition: "ERASED" as const, cleanupDisposition: "COMPLETE" as const });
      publish({ type: "closed", result });
      return { ok: true, value: result };
    });
    return closePromise;
  }

  function follow(options: { from: "CURRENT_INTERVAL_START" | "NOW" }, observer: (publication: HistoryPublication) => void): () => void {
    const subscriber: Subscriber = { observer, replaying: options.from === "CURRENT_INTERVAL_START", pending: [] };
    subscribers.add(subscriber);
    invoke(subscriber, { type: "status", status: status() });
    if (subscriber.replaying && subscribers.has(subscriber)) replayFromJournal(subscriber, latchForCurrentInterval());
    return () => subscribers.delete(subscriber);
  }

  function latchForCurrentInterval(): ReadLatch {
    return deepFreeze({ interval, generation, committedEvidenceBoundary, retainedRange, retainedCount });
  }

  function publish(publication: HistoryPublication): void {
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying && publication.type === "committed-evidence") {
        const first = publication.evidence[0];
        const last = publication.evidence.at(-1);
        if (first && last) {
          subscriber.pending.push({
            type: "committed-range",
            interval: publication.interval,
            firstSequence: first.sequence,
            lastSequence: last.sequence,
            committedEvidenceBoundary: publication.committedEvidenceBoundary
          });
        }
      } else if (subscriber.replaying) subscriber.pending.push(publication);
      else invoke(subscriber, publication);
    }
  }

  function invoke(subscriber: Subscriber, publication: HistoryPublication): void {
    if (!subscribers.has(subscriber)) return;
    try { subscriber.observer(publication); } catch { subscribers.delete(subscriber); subscriber.pending.length = 0; }
  }

  function replayFromJournal(subscriber: Subscriber, latch: ReadLatch): void {
    if (latch.retainedRange === null) {
      void finishReplay(subscriber);
      return;
    }
    const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
    const settled = transactionDone(transaction, "replaying Event History");
    const request = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).openCursor();
    request.onsuccess = () => {
      if (!subscribers.has(subscriber)) return;
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as EvidenceRecord;
      if (record.sequence > latch.retainedRange!.last.sequence) return;
      if (record.intervalId === latch.interval.id && record.sequence >= latch.retainedRange!.first.sequence) {
        invoke(subscriber, deepFreeze({
          type: "committed-evidence" as const,
          interval: latch.interval,
          evidence: [toCommittedEvidenceFromRecord(record)],
          committedEvidenceBoundary: { intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId }
        }));
      }
      if (subscribers.has(subscriber)) cursor.continue();
    };
    void settled.then(() => finishReplay(subscriber), () => subscribers.delete(subscriber));
  }

  async function finishReplay(subscriber: Subscriber): Promise<void> {
    if (!subscribers.has(subscriber)) return;
    while (subscriber.pending.length > 0 && subscribers.has(subscriber)) {
      const publication = subscriber.pending.shift()!;
      if (publication.type === "committed-range") {
        const evidence = await readCommittedRange(database, publication.interval, publication.firstSequence, publication.lastSequence);
        if (!subscribers.has(subscriber)) return;
        invoke(subscriber, deepFreeze({
          type: "committed-evidence" as const,
          interval: publication.interval,
          evidence,
          committedEvidenceBoundary: publication.committedEvidenceBoundary
        }));
      } else {
        invoke(subscriber, publication);
      }
    }
    if (subscribers.has(subscriber)) subscriber.replaying = false;
  }

  function waitForIdle(): Promise<void> {
    if (!processing && pending.length === 0) return Promise.resolve();
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
    if (processing || pending.length > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  function closeResult(): CloseResult {
    return deepFreeze({ finalCommittedEvidenceBoundary: currentBoundary(), dataDisposition: "ERASED" as const, cleanupDisposition: "COMPLETE" as const });
  }

  return { offer, read, clear, follow, close };
}

async function loadJournal(database: AuthoritativeEventDatabase, panelSessionId: string): Promise<LoadedJournal> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readonly");
  try {
    const control = await requestToPromise<ControlRecord | undefined>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY), "loading history control");
    await validateJournalRecords(panelSessionId, control, transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence));
    await transactionDone(transaction, "loading Event History");
    if (!control) {
      const interval = Object.freeze({ id: `${panelSessionId}:interval-1`, ordinal: 1 });
      await writeControl(database, createControl(panelSessionId, interval, "RUNNING", null, 1, null, null, 0, 0, 0));
      return { panelSessionId, interval, phase: "RUNNING", terminal: null, nextSequence: 1, replayPayloadBytes: 0, retainedBytes: 0, durableAccountedBytes: 0, retainedCount: 0, retainedRange: null, committedEvidenceBoundary: null };
    }
    if (control.phase === "DRAINING_TO_STOP") {
      if (!control.terminal) throw new Error("A draining history control must contain a terminal intent.");
      const recoveredTerminal = terminalAtDurableBoundary(control.terminal, control);
      await finalizeTerminal(
        database,
        panelSessionId,
        control.interval,
        control.nextSequence,
        control.committedEvidenceBoundary,
        control.retainedRange,
        control.retainedCount,
        control.replayPayloadBytes,
        control.accountedBytes,
        recoveredTerminal
      );
      return {
        panelSessionId,
        interval: control.interval,
        phase: "STOPPED",
        terminal: recoveredTerminal,
        nextSequence: control.nextSequence,
        replayPayloadBytes: control.replayPayloadBytes,
        retainedBytes: control.accountedBytes,
        durableAccountedBytes: control.accountedBytes,
        retainedCount: control.retainedCount,
        retainedRange: control.retainedRange,
        committedEvidenceBoundary: control.committedEvidenceBoundary
      };
    }
    return {
      panelSessionId,
      interval: control.interval,
      phase: control.phase,
      terminal: control.terminal,
      nextSequence: control.nextSequence,
      replayPayloadBytes: control.replayPayloadBytes,
      retainedBytes: control.accountedBytes,
      durableAccountedBytes: control.accountedBytes,
      retainedCount: control.retainedCount,
      retainedRange: control.retainedRange,
      committedEvidenceBoundary: control.committedEvidenceBoundary
    };
  } catch (error) {
    try { transaction.abort(); } catch { /* the transaction may already be complete */ }
    throw error;
  }
}

async function commitBatch(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, previousRange: { first: EvidenceRef; last: EvidenceRef } | null, previousCount: number, evidence: readonly CommittedEvidence[], replayPayloadBytes: number, accountedBytes: number, phase: "RUNNING" | "DRAINING_TO_STOP", terminal: HistoryTerminalDiagnostic | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readwrite");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  let serializedBatchBytes = 0;
  let accountedBatchBytes = 0;
  for (const [index, entry] of evidence.entries()) {
    const serialized = serializeJournalEvidenceCandidate(entry.candidate);
    const recordAccountedBytes = journalAccountedBytes(serialized.bytes);
    serializedBatchBytes += serialized.bytes;
    accountedBatchBytes += recordAccountedBytes;
    store.add({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes: recordAccountedBytes, facets: exactFacets(entry.candidate) } satisfies EvidenceRecord);
  }
  if (replayPayloadBytes < serializedBatchBytes || accountedBytes < accountedBatchBytes) throw new Error("The journal commit totals are incoherent.");
  const next = evidence.at(-1) ? evidence.at(-1)!.sequence + 1 : nextSequence;
  const last = evidence.at(-1);
  const boundary = last ? toRef(last) : previousRange?.last ?? null;
  const range = previousRange
    ? { first: previousRange.first, last: last ? toRef(last) : previousRange.last }
    : evidence.length
      ? { first: toRef(evidence[0]), last: toRef(last!) }
      : null;
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, phase, terminal, next, boundary, range, previousCount + evidence.length, replayPayloadBytes, accountedBytes));
  await transactionDone(transaction, "committing Evidence");
}

async function persistTerminalIntent(
  database: AuthoritativeEventDatabase,
  panelSessionId: string,
  terminal: HistoryTerminalDiagnostic
): Promise<void> {
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, "readwrite");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl);
  const current = await requestToPromise<ControlRecord | undefined>(store.get(AUTHORITATIVE_EVENT_CONTROL_KEY), "reading Event History terminal intent");
  if (!current || current.panelSessionId !== panelSessionId) throw new Error("The Event History terminal intent control is missing or belongs to another Panel Session.");
  store.put({ ...current, phase: "DRAINING_TO_STOP", terminal });
  await transactionDone(transaction, "persisting Event History terminal intent");
}

async function finalizeTerminal(
  database: AuthoritativeEventDatabase,
  panelSessionId: string,
  interval: HistoryInterval,
  nextSequence: number,
  boundary: EvidenceRef | null,
  range: { first: EvidenceRef; last: EvidenceRef } | null,
  retainedCount: number,
  replayPayloadBytes: number,
  accountedBytes: number,
  terminal: HistoryTerminalDiagnostic
): Promise<void> {
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(
    createControl(panelSessionId, interval, "STOPPED", terminal, nextSequence, boundary, range, retainedCount, replayPayloadBytes, accountedBytes)
  );
  await transactionDone(transaction, "finalizing Event History terminal state");
}

async function clearJournal(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, "RUNNING", null, nextSequence, boundary, null, 0, 0, 0));
  await transactionDone(transaction, "clearing Event History");
}

function validateJournalRecords(panelSessionId: string, control: ControlRecord | undefined, store: IDBObjectStore): Promise<void> {
  if (!control) {
    return requestToPromise<number>(store.count(), "checking for Evidence residue").then((count) => {
      if (count > 0) throw new Error("Evidence residue exists without a history control record.");
    });
  }
  if ((control as { recordVersion?: unknown }).recordVersion === 1) {
    throw new Error("The Event History recordVersion 1 is legacy and is not recovered across Panel Sessions.");
  }
  if ((control as { recordVersion?: unknown }).recordVersion === 2) {
    throw new Error("The Event History recordVersion 2 lacks durable terminal state and is not recovered across Panel Sessions.");
  }
  assertExactKeys(control, ["accountedBytes", "committedEvidenceBoundary", "interval", "key", "nextSequence", "panelSessionId", "phase", "recordVersion", "retainedCount", "retainedRange", "replayPayloadBytes", "schemaVersion", "terminal"]);
  if (control.key !== AUTHORITATIVE_EVENT_CONTROL_KEY || control.schemaVersion !== 2 || control.recordVersion !== 3 || control.panelSessionId !== panelSessionId) {
    throw new Error("The history control record does not match the authoritative schema or Panel Session.");
  }
  if ((control.phase !== "RUNNING" && control.phase !== "DRAINING_TO_STOP" && control.phase !== "STOPPED") || (control.phase === "RUNNING") !== (control.terminal === null) || (control.phase !== "RUNNING" && control.terminal === null)) {
    throw new Error("The history control terminal state is incoherent.");
  }
  if (control.terminal !== null) validateTerminalDiagnostic(panelSessionId, control.terminal);
  if (!isInterval(control.interval) || control.interval.id !== `${panelSessionId}:interval-${control.interval.ordinal}`) {
    throw new Error("The history control interval is incoherent.");
  }
  if (!Number.isSafeInteger(control.nextSequence) || control.nextSequence < 1 || !Number.isSafeInteger(control.retainedCount) || control.retainedCount < 0 || !Number.isSafeInteger(control.replayPayloadBytes) || control.replayPayloadBytes < 0 || !Number.isSafeInteger(control.accountedBytes) || control.accountedBytes < 0) {
    throw new Error("The history control counters are incoherent.");
  }

  if (control.committedEvidenceBoundary !== null) assertRef(control.committedEvidenceBoundary);
  if (control.retainedRange !== null) {
    assertRef(control.retainedRange.first);
    assertRef(control.retainedRange.last);
  }
  let count = 0;
  let payloadBytes = 0;
  let accountedBytes = 0;
  let previous: EvidenceRecord | null = null;
  let first: EvidenceRef | null = null;
  let last: EvidenceRef | null = null;
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB evidence validation failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        const expectedNext = last ? last.sequence + 1 : control.committedEvidenceBoundary ? control.committedEvidenceBoundary.sequence + 1 : 1;
        const expectedRange = first && last ? { first, last } : null;
        if (control.retainedCount !== count || control.replayPayloadBytes !== payloadBytes || control.accountedBytes !== accountedBytes || control.nextSequence !== expectedNext || !sameRange(control.retainedRange, expectedRange)) {
          reject(new Error("The history control totals or range do not match its evidence records."));
          return;
        }
        if (first && control.interval.ordinal === 1 && first.sequence !== 1) {
          reject(new Error("The first retained Evidence sequence is incoherent with the Panel Session interval."));
          return;
        }
        if (last && !sameRef(control.committedEvidenceBoundary, last)) {
          reject(new Error("The history control committed boundary is incoherent."));
          return;
        }
        if (control.phase === "STOPPED" && control.terminal && (!sameRef(control.terminal.committedEvidenceBoundary, control.committedEvidenceBoundary) || !sameRange(control.terminal.retainedRange, control.retainedRange))) {
          reject(new Error("The history terminal boundary is incoherent with its durable control boundary."));
          return;
        }
        if (control.phase !== "DRAINING_TO_STOP" && control.committedEvidenceBoundary !== null) {
          const boundaryOrdinal = intervalOrdinal(panelSessionId, control.committedEvidenceBoundary.intervalId);
          if (boundaryOrdinal === null || boundaryOrdinal > control.interval.ordinal || (!first && boundaryOrdinal >= control.interval.ordinal)) {
            reject(new Error("The history control committed boundary interval is incoherent."));
            return;
          }
        } else if (control.phase !== "DRAINING_TO_STOP" && control.committedEvidenceBoundary === null && control.interval.ordinal > 1 && control.nextSequence !== 1) {
          reject(new Error("A non-initial History Interval must retain its panel-lifetime boundary."));
          return;
        }
        resolve();
        return;
      }
      const record = cursor.value as EvidenceRecord;
      try {
        assertExactKeys(record, ["accountedBytes", "eventId", "facets", "intervalId", "replayPayload", "sequence", "serializedBytes"]);
        if (record.intervalId !== control.interval.id || typeof record.eventId !== "string" || record.eventId.length === 0 || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || (previous !== null && record.sequence !== previous.sequence + 1) || typeof record.replayPayload !== "string" || !Number.isSafeInteger(record.serializedBytes) || record.serializedBytes < 0 || !Number.isSafeInteger(record.accountedBytes) || record.accountedBytes !== journalAccountedBytes(record.serializedBytes) || !Array.isArray(record.facets) || record.facets.some((facetValue) => typeof facetValue !== "string")) {
          throw new Error("An evidence record is incoherent with the history control record.");
        }
        const candidate = copyCandidate(deserializeJournalEvidenceCandidate(record.replayPayload));
        const serialized = serializeJournalEvidenceCandidate(candidate);
        if (candidate.id !== record.eventId || serialized.payload !== record.replayPayload || serialized.bytes !== record.serializedBytes || JSON.stringify(exactFacets(candidate)) !== JSON.stringify(record.facets)) {
          throw new Error("An evidence record does not match its replay payload or facets.");
        }
        const reference = evidenceRef(record);
        if (first === null) first = reference;
        last = reference;
        previous = record;
        count += 1;
        payloadBytes += record.serializedBytes;
        accountedBytes += record.accountedBytes;
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

type JournalRead = Readonly<{ evidence: CommittedEvidence[]; total: number }>;

function readJournal(database: AuthoritativeEventDatabase, latch: ReadLatch, query: EvidenceQuery): Promise<JournalRead> {
  return new Promise((resolve, reject) => {
    const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
    const completed = transactionDone(transaction, "reading Event History");
    const request = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).openCursor();
    const selected: CommittedEvidence[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("IndexedDB Evidence read failed."));
    };
    const finish = (): void => {
      if (settled) return;
      void completed.then(
        () => {
          if (settled) return;
          settled = true;
          resolve({ evidence: pageJournalSelection(selected, query, total), total });
        },
        fail
      );
    };
    request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence read failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        finish();
        return;
      }
      const record = cursor.value as EvidenceRecord;
      if (latch.retainedRange === null || record.sequence > latch.retainedRange.last.sequence) {
        finish();
        return;
      }
      if (record.intervalId === latch.interval.id && record.sequence >= latch.retainedRange.first.sequence) {
        const evidence = toCommittedEvidenceFromRecord(record);
        if (matchesEvidenceQuery(evidence, query)) {
          total += 1;
          retainForJournalPage(selected, evidence, query);
        }
      }
      cursor.continue();
    };
    void completed.catch(fail);
  });
}

function pageJournalSelection(selected: readonly CommittedEvidence[], query: EvidenceQuery, total: number): CommittedEvidence[] {
  if (query.offsetFromNewest === undefined) {
    return query.order === "desc" ? [...selected].reverse() : [...selected];
  }
  const offset = Math.max(0, Math.floor(query.offsetFromNewest));
  const limit = query.limit === undefined ? undefined : Math.max(0, query.limit);
  const newestFirst = [...selected].reverse();
  const page = newestFirst.slice(offset, limit === undefined ? undefined : offset + limit);
  return query.order === "desc" ? page : page.reverse();
}

function retainForJournalPage(selected: CommittedEvidence[], evidence: CommittedEvidence, query: EvidenceQuery): void {
  const limit = query.limit === undefined ? undefined : Math.max(0, query.limit);
  if (query.offsetFromNewest === undefined) {
    if (query.order === "desc" && limit !== undefined) {
      if (limit === 0) return;
      selected.push(evidence);
      if (selected.length > limit) selected.shift();
      return;
    }
    if (limit === undefined || selected.length < limit) selected.push(evidence);
    return;
  }
  if (limit === 0) return;
  const keep = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(query.offsetFromNewest ?? 0)) + limit;
  selected.push(evidence);
  if (selected.length > keep) selected.shift();
}

function readCommittedRange(database: AuthoritativeEventDatabase, interval: HistoryInterval, firstSequence: number, lastSequence: number): Promise<CommittedEvidence[]> {
  return readJournal(database, {
    interval,
    generation: 0,
    committedEvidenceBoundary: null,
    retainedRange: {
      first: { intervalId: interval.id, sequence: firstSequence, eventId: "range-start" },
      last: { intervalId: interval.id, sequence: lastSequence, eventId: "range-end" }
    },
    retainedCount: Math.max(0, lastSequence - firstSequence + 1)
  }, {}).then((result) => result.evidence);
}

function assertExactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("An authoritative IndexedDB record has an unexpected schema.");
}

function isInterval(value: unknown): value is HistoryInterval {
  return Boolean(value && typeof value === "object" && Object.keys(value).sort().join(",") === "id,ordinal" && typeof (value as HistoryInterval).id === "string" && Number.isSafeInteger((value as HistoryInterval).ordinal) && (value as HistoryInterval).ordinal > 0);
}

function intervalOrdinal(panelSessionId: string, intervalId: string): number | null {
  const prefix = `${panelSessionId}:interval-`;
  if (!intervalId.startsWith(prefix)) return null;
  const ordinal = Number(intervalId.slice(prefix.length));
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

function assertRef(value: EvidenceRef): void {
  if (!value || Object.keys(value).sort().join(",") !== "eventId,intervalId,sequence" || typeof value.intervalId !== "string" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.eventId !== "string" || value.eventId.length === 0) throw new Error("An Evidence reference is incoherent.");
}

function validateTerminalDiagnostic(panelSessionId: string, terminal: HistoryTerminalDiagnostic): void {
  assertExactKeys(terminal, [
    "committedEvidenceBoundary", "discarded", "dimension", "firstMissingEventId", "interval",
    "reason", "rejected", "retainedRange", "tier", "triggerInterval", "triggerMeasurements", "triggerTime"
  ]);
  if (!isTerminalReason(terminal.reason) || !isTerminalDimension(terminal.dimension) || (terminal.tier !== "NORMAL" && terminal.tier !== "LOWER") || !Number.isFinite(terminal.triggerTime)) {
    throw new Error("The history terminal diagnostic has invalid identity fields.");
  }
  if (!isInterval(terminal.interval) || terminal.interval.id !== `${panelSessionId}:interval-${terminal.interval.ordinal}` || !isInterval(terminal.triggerInterval) || terminal.triggerInterval.id !== `${panelSessionId}:interval-${terminal.triggerInterval.ordinal}`) {
    throw new Error("The history terminal diagnostic intervals are incoherent.");
  }
  if (terminal.committedEvidenceBoundary !== null) assertRef(terminal.committedEvidenceBoundary);
  if (terminal.retainedRange !== null) {
    assertRef(terminal.retainedRange.first);
    assertRef(terminal.retainedRange.last);
  }
  if (terminal.firstMissingEventId !== null && (typeof terminal.firstMissingEventId !== "string" || terminal.firstMissingEventId.length === 0)) {
    throw new Error("The history terminal diagnostic first missing event is incoherent.");
  }
  validateTerminalTotals(terminal.rejected);
  validateTerminalTotals(terminal.discarded);
  assertExactKeys(terminal.triggerMeasurements, ["oldestPendingAgeMs", "pendingBytes", "pendingCount", "retainedBytes", "retainedCount"]);
  if (!Number.isSafeInteger(terminal.triggerMeasurements.retainedCount) || terminal.triggerMeasurements.retainedCount < 0 || !Number.isSafeInteger(terminal.triggerMeasurements.retainedBytes) || terminal.triggerMeasurements.retainedBytes < 0 || !Number.isSafeInteger(terminal.triggerMeasurements.pendingCount) || terminal.triggerMeasurements.pendingCount < 0 || !Number.isSafeInteger(terminal.triggerMeasurements.pendingBytes) || terminal.triggerMeasurements.pendingBytes < 0 || (terminal.triggerMeasurements.oldestPendingAgeMs !== null && (!Number.isFinite(terminal.triggerMeasurements.oldestPendingAgeMs) || terminal.triggerMeasurements.oldestPendingAgeMs < 0))) {
    throw new Error("The history terminal diagnostic measurements are incoherent.");
  }
}

function validateTerminalTotals(value: { count: number; bytes: number }): void {
  assertExactKeys(value, ["bytes", "count"]);
  if (!Number.isSafeInteger(value.count) || value.count < 0 || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error("The history terminal diagnostic totals are incoherent.");
  }
}

function terminalAtDurableBoundary(terminal: HistoryTerminalDiagnostic, control: ControlRecord): HistoryTerminalDiagnostic {
  return Object.freeze({
    ...terminal,
    interval: control.interval,
    committedEvidenceBoundary: control.committedEvidenceBoundary,
    retainedRange: control.retainedRange
  });
}

function isTerminalReason(value: unknown): value is HistoryTerminalDiagnostic["reason"] {
  return ["RETAINED_COUNT_LIMIT", "RETAINED_BYTE_LIMIT", "PENDING_BYTE_LIMIT", "PENDING_AGE_LIMIT", "QUOTA_EXCEEDED", "JOURNAL_COMMIT_FAILED"].includes(value as string);
}

function isTerminalDimension(value: unknown): value is HistoryTerminalDiagnostic["dimension"] {
  return ["RETAINED_COUNT", "RETAINED_BYTES", "PENDING_BYTES", "PENDING_AGE", "JOURNAL"].includes(value as string);
}

function triggerFromTerminal(terminal: HistoryTerminalDiagnostic): HistoryTrigger {
  return Object.freeze({
    reason: terminal.reason,
    dimension: terminal.dimension,
    tier: terminal.tier,
    triggerTime: terminal.triggerTime,
    interval: terminal.triggerInterval,
    firstMissingEventId: terminal.firstMissingEventId,
    measurements: terminal.triggerMeasurements
  });
}

function evidenceRef(record: EvidenceRecord): EvidenceRef {
  return { intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId };
}

function sameRef(left: EvidenceRef | null, right: EvidenceRef | null): boolean {
  return left === null || right === null ? left === right : left.intervalId === right.intervalId && left.sequence === right.sequence && left.eventId === right.eventId;
}

function sameRange(left: { first: EvidenceRef; last: EvidenceRef } | null, right: { first: EvidenceRef; last: EvidenceRef } | null): boolean {
  return left === null || right === null ? left === right : sameRef(left.first, right.first) && sameRef(left.last, right.last);
}

function createControl(panelSessionId: string, interval: HistoryInterval, phase: "RUNNING" | "DRAINING_TO_STOP" | "STOPPED", terminal: HistoryTerminalDiagnostic | null, nextSequence: number, boundary: EvidenceRef | null, range: { first: EvidenceRef; last: EvidenceRef } | null, retainedCount: number, replayPayloadBytes: number, accountedBytes: number): ControlRecord {
  return { key: AUTHORITATIVE_EVENT_CONTROL_KEY, schemaVersion: 2, recordVersion: 3, panelSessionId, interval, phase, terminal, nextSequence, committedEvidenceBoundary: boundary, retainedRange: range, retainedCount, replayPayloadBytes, accountedBytes };
}

async function writeControl(database: AuthoritativeEventDatabase, control: ControlRecord): Promise<void> {
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(control);
  await transactionDone(transaction, "initializing Event History");
}

function exactFacets(candidate: EvidenceCandidate): string[] {
  if (candidate.kind === "topology-checkpoint") return [facet("kind", candidate.kind)];
  return [
    facet("kind", candidate.kind), facet("clientId", candidate.client?.id ?? null),
    facet("sessionId", candidate.client?.sessionId ?? null), facet("subscriptionId", candidate.subscription?.id ?? null),
    facet("mode", candidate.subscription?.mode ?? null), facet("item", candidate.item?.name ?? null),
    facet("itemPosition", candidate.item?.position ?? null), facet("listenerId", candidate.listener?.id ?? null),
    facet("key", candidate.update?.key ?? null), facet("command", candidate.update?.command ?? null),
    facet("snapshot", Boolean(candidate.update?.isSnapshot)), facet("synthetic", candidate.synthetic)
  ];
}

function facet(name: string, value: unknown): string {
  return JSON.stringify(["v1", name, value]);
}

function toCommittedEvidence(candidate: EvidenceCandidate, interval: HistoryInterval, sequence: number): CommittedEvidence {
  return deepFreeze({ intervalId: interval.id, sequence, eventId: candidate.id, candidate });
}

function toCommittedEvidenceFromRecord(record: EvidenceRecord): CommittedEvidence {
  return deepFreeze({ intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId, candidate: deserializeJournalEvidenceCandidate(record.replayPayload) });
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({ intervalId: evidence.intervalId, sequence: evidence.sequence, eventId: evidence.eventId });
}

function copyCandidate(candidate: EvidenceCandidate): EvidenceCandidate {
  if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || candidate.id.length === 0) throw new Error("Candidate must have a stable event ID.");
  if (candidate.kind === "topology-checkpoint" && !candidate.checkpoint) throw new Error("Topology checkpoint candidate is incomplete.");
  return deepFreeze(structuredClone(candidate));
}

function candidateIdIfPresent(candidate: unknown): string | null {
  return candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string" && candidate.id.length > 0
    ? candidate.id
    : null;
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "QuotaExceededError" || value.code === "QUOTA_EXCEEDED";
}

function requestToPromise<T>(request: IDBRequest<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(`Timed out while ${operation}.`)), 2_000);
    const settle = (callback: () => void) => {
      globalThis.clearTimeout(timeout);
      callback();
    };
    request.onsuccess = () => settle(() => resolve(request.result));
    request.onerror = () => settle(() => reject(request.error ?? new Error("IndexedDB request failed.")));
  });
}

/** @internal Test-only timeout seam for deterministic IndexedDB transaction tests. */
export function transactionDone(transaction: IDBTransaction, operation: string, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let abortSucceeded = false;
    let observedError: DOMException | null = null;
    const timeoutError = new Error(`Timed out while ${operation}.`);
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback();
    };
    timeout = globalThis.setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        transaction.abort();
        abortSucceeded = true;
      } catch { /* the transaction may already be complete */ }
    }, timeoutMs);
    transaction.oncomplete = () => settle(resolve);
    transaction.onerror = () => {
      observedError = transaction.error;
    };
    transaction.onabort = () => settle(() => reject(
      transaction.error
        ?? (timedOut && abortSucceeded ? timeoutError : observedError)
        ?? (timedOut ? timeoutError : new Error("IndexedDB transaction aborted."))
    ));
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
