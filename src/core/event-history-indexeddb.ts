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
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  authoritativeEventDatabaseRuntime,
  authoritativeEventDatabaseName,
  AUTHORITATIVE_EVENT_DB_NAME_PREFIX,
  deleteAuthoritativeEventDatabase,
  parseAuthoritativeEventDatabaseName,
  openAuthoritativeEventDatabase,
  AuthoritativeDatabaseOpenError,
  type AuthoritativeEventDatabaseIdentity,
  type AuthoritativeEventDatabaseRuntime,
  type AuthoritativeEventDatabase
} from "./indexeddb/authoritative-event-db";
import {
  deserializeJournalEvidenceCandidate,
  journalCandidateSearchText,
  registerJournalOwnedCandidate,
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
  type EventHistoryStorage,
  assertCandidate,
  copyCandidate,
  freezeCandidate,
  matchesEvidenceQuery,
  type HistoryTerminalDiagnostic
} from "./event-history-authoritative";
import { extractEvidenceFacets } from "./evidence-facets";
import { canonicalEvidenceSearchText } from "./evidence-facets";
import { evaluateFilter, type Filter, type FilterRecord } from "./filter-algebra";
import { findEvidence, isInAround, lookupEvidence, normalizeAround, type SelectionRecord } from "./evidence-filter-selection";
import {
  MAX_EVIDENCE_PAGE_SIZE,
  type DeterministicEvidenceRecord,
  type EvidenceFilterReadProblem,
  type EvidenceFilterQueryAdapter,
  type EvidenceIdentity,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryResult
} from "./evidence-filter-contract";

export type { EventHistory };

export const AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT = 256;
export const AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES = 2_097_152;
const EVIDENCE_FACET_COUNT = 12;

const LIVE_PANEL_LEASE_PREFIX = "lsew-events-panel-live-v2-";
const LIVE_PANEL_LEASE_TTL_MS = 30_000;
const LIVE_PANEL_LEASE_HEARTBEAT_MS = 5_000;

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
  /** v3 lightweight query projection. Replay payload remains the authoritative source. */
  projection?: {
    timestamp: number;
    summary: string;
    searchText: string;
    facets: Readonly<Record<string, unknown>>;
  };
};

export const AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE = "facet-v2";

type FacetPostingRecord = {
  token: string;
  sequence: number;
  intervalId: string;
  eventId: string;
  facetIdentity: string;
};

type Pending = {
  ordinal: number;
  eventId: string;
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
  runtime?: AuthoritativeEventDatabaseRuntime;
  capacityTier?: HistoryCapacityTier;
  clearJournal?: () => Promise<void | boolean> | void | boolean;
  closeJournal?: () => Promise<void>;
  failure?: Readonly<{ commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void> }>;
  commitBatch?: (batch: readonly EvidenceCandidate[]) => void | Promise<void>;
  finalizeTerminal?: (terminal: HistoryTerminalDiagnostic) => void | Promise<void>;
}> & HistoryCapacityOptions;

export async function createIndexedDbEventHistory(
  options: IndexedDbEventHistoryOptions = {}
): Promise<EventHistory> {
  const panelSessionId = options.panelSessionId ?? `session-${Math.random().toString(36).slice(2)}`;
  const runtime = authoritativeEventDatabaseRuntime(options.runtime);
  const databaseName = authoritativeEventDatabaseName(panelSessionId);
  const canonicalPanelSessionId = parseAuthoritativeEventDatabaseName(databaseName)?.panelSessionId ?? panelSessionId;
  const releaseLiveLease = claimLivePanelLease(databaseName);
  const ownerName = authoritativeOwnershipLockName(databaseName);
  let releaseOwnership: (() => void) | null = null;
  const ownershipRelease = new Promise<void>((resolve) => {
    releaseOwnership = resolve;
  });
  const startupSweep = async (): Promise<void> => {
    try {
      await runStartupSweep(runtime, databaseName);
    } catch (error) {
      throw error instanceof AuthoritativeDatabaseOpenError
        ? error
        : new AuthoritativeDatabaseOpenError("STARTUP_SWEEP_FAILED", "Startup journal sweep failed.", error);
    }
  };

  const closeCurrent = async (history: EventHistory, database: AuthoritativeEventDatabase): Promise<Outcome<CloseResult>> => {
    try {
      return await history.close();
    } finally {
      const release = releaseOwnership;
      releaseOwnership = null;
      if (release !== null) {
        release();
      }
      database.db.close();
      releaseLiveLease();
    }
  };

  let historyResolve!: (value: EventHistory) => void;
  let historyReject!: (error: unknown) => void;
  let settled = false;
  const historyReady = new Promise<EventHistory>((resolve, reject) => {
    historyResolve = resolve;
    historyReject = reject;
  });
  const settleHistoryFailure = (error: unknown): void => {
    if (settled) return;
    settled = true;
    historyReject(error);
  };

  const historyAcquisition = runtime.requestLock(ownerName, { mode: "exclusive", ifAvailable: true }, async () => {
    let database: AuthoritativeEventDatabase | null = null;
    try {
      database = await openAuthoritativeEventDatabase(databaseName);
      const loaded = await loadJournal(database, canonicalPanelSessionId);
      const closeJournal = async (): Promise<void> => {
        await options.closeJournal?.();
        await deleteAuthoritativeEventDatabase(databaseName);
      };
      const baseHistory = createHistory(database, loaded, {
        ...options,
        closeJournal
      });
      const ownedDatabase = database;
      const ownedHistory: EventHistory = {
        ...baseHistory,
        close: () => closeCurrent(baseHistory, ownedDatabase)
      };
      await startupSweep();
      settled = true;
      historyResolve(ownedHistory);
      await ownershipRelease;
      return ownedHistory;
    } catch (error) {
      database?.db.close();
      settleHistoryFailure(error);
      throw error;
    }
  });
  void historyAcquisition.then((owned) => {
    if (owned === null) {
      releaseLiveLease();
      settleHistoryFailure(new AuthoritativeDatabaseOpenError(
        "OWNERSHIP_COULD_NOT_BE_CONFIRMED",
        `Could not confirm exclusive ownership of ${databaseName}.`
      ));
    }
  }).catch((error) => {
    releaseLiveLease();
    settleHistoryFailure(error);
  });
  const history = await historyReady;
  void historyAcquisition.catch(() => undefined);
  return history;
}

const AUTHORITATIVE_OWNERSHIP_LOCK_NAME_PREFIX = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-owner-v${AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION}`;
const AUTHORITATIVE_EVENT_DATABASE_LEGACY_NAME_RE = /^lsew-history-(.+)$/;

function authoritativeOwnershipLockName(databaseName: string): string {
  return `${AUTHORITATIVE_OWNERSHIP_LOCK_NAME_PREFIX}-${databaseName}`;
}

function livePanelLeaseKey(databaseName: string): string {
  return `${LIVE_PANEL_LEASE_PREFIX}${databaseName}`;
}

function claimLivePanelLease(databaseName: string): () => void {
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return () => undefined;
  const key = livePanelLeaseKey(databaseName);
  let released = false;
  const refresh = (): void => {
    if (released) return;
    try {
      storage.setItem(key, String(Date.now()));
    } catch {
      // IndexedDB ownership remains authoritative when storage is unavailable.
    }
  };
  refresh();
  const heartbeat = globalThis.setInterval(refresh, LIVE_PANEL_LEASE_HEARTBEAT_MS);
  return () => {
    if (released) return;
    released = true;
    globalThis.clearInterval(heartbeat);
    try {
      storage.removeItem(key);
    } catch {
      // Best effort; the lease will expire and be treated as an orphan.
    }
  };
}

function hasFreshLivePanelLease(databaseName: string): boolean {
  if (typeof localStorage === "undefined") return false;
  const key = livePanelLeaseKey(databaseName);
  try {
    const timestamp = Number(localStorage.getItem(key));
    if (Number.isFinite(timestamp) && Date.now() - timestamp < LIVE_PANEL_LEASE_TTL_MS) {
      return true;
    }
    localStorage.removeItem(key);
  } catch {
    return false;
  }
  return false;
}

function parseLegacyAuthoritativeEventDatabaseName(
  name: string,
  schemaVersion?: number
): AuthoritativeEventDatabaseIdentity | null {
  const match = AUTHORITATIVE_EVENT_DATABASE_LEGACY_NAME_RE.exec(name);
  if (!match) {
    return null;
  }
  const enumeratedSchemaVersion = Number(schemaVersion);
  if (!Number.isSafeInteger(enumeratedSchemaVersion) || enumeratedSchemaVersion < 1) {
    return null;
  }
  return {
    panelSessionId: match[1],
    schemaVersion: enumeratedSchemaVersion,
    name
  };
}

function parseSweepCandidateEventDatabaseName(
  name: string,
  schemaVersion?: number
): AuthoritativeEventDatabaseIdentity | null {
  return parseAuthoritativeEventDatabaseName(name) ?? parseLegacyAuthoritativeEventDatabaseName(name, schemaVersion);
}

async function runStartupSweep(
  runtime: AuthoritativeEventDatabaseRuntime,
  databaseName: string
): Promise<void> {
  const databases = await runtime.listDatabases().catch((error) => {
    throw new AuthoritativeDatabaseOpenError("STARTUP_SWEEP_FAILED", "Startup journal sweep could not enumerate IndexedDB databases.", error);
  });
  let unknownNewerVersion = false;
  for (const descriptor of databases) {
    const name = descriptor.name;
    if (!name) {
      continue;
    }
    const identity = parseSweepCandidateEventDatabaseName(name, descriptor.version);
    if (!identity) {
      continue;
    }
    // The v2 database name is the stable application identity. Its embedded
    // version is not the physical schema version after an in-place upgrade.
    const physicalSchemaVersion = descriptor.version ?? identity.schemaVersion;
    if (physicalSchemaVersion > AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION) {
      unknownNewerVersion = true;
      continue;
    }
    if (name === databaseName) {
      continue;
    }
    // A current-schema journal with a fresh lease belongs to a live sibling
    // panel. Without a lease it is crash residue and may be swept under its
    // own Web Lock, just like an older-schema orphan.
    if (hasFreshLivePanelLease(name)) {
      continue;
    }
    const result = await runtime.requestLock(
      authoritativeOwnershipLockName(name),
      { mode: "exclusive", ifAvailable: true },
      () => deleteAuthoritativeEventDatabase(name)
    ).catch((error) => {
      throw new AuthoritativeDatabaseOpenError("STARTUP_SWEEP_FAILED", `Could not clean up ${name} during startup sweep.`, error);
    });
    if (result === null) {
      continue;
    }
  }
  if (unknownNewerVersion) {
    throw new AuthoritativeDatabaseOpenError("UNKNOWN_NEWER_SCHEMA", "A newer Workbench journal schema was detected.");
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
  const postClearPending: Pending[] = [];
  const terminalReceipts: Pending[] = [];
  const committedReceipts: Array<{ entry: Pending; evidence: EvidenceRef }> = [];
  const idleWaiters: Array<() => void> = [];
  let interval = loaded.interval;
  let phase: HistoryStatus["phase"] = loaded.phase;
  let terminal: HistoryTerminalDiagnostic | undefined = loaded.terminal ?? undefined;
  let terminalFailureDetail: string | undefined;
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
  let lastCloseOutcome: Outcome<CloseResult> | null = null;
  let clearInProgress = false;
  let trigger: HistoryTrigger | null = terminal ? triggerFromTerminal(terminal) : null;
  let persistedTerminal: HistoryTerminalDiagnostic | undefined = terminal;
  let terminalPersistence: Promise<void> | null = null;
  let terminalFinalization: Promise<void> | null = null;
  let terminalSettled: Promise<void> | null = null;
  let resolveTerminalSettled: (() => void) | null = null;
  let terminalPersistenceFailed = false;
  let terminalIntentGeneration = 0;
  let lastNearLimit = false;
  let lastCoherentQuery: EvidenceSnapshot | null = null;
  let awaitingCount = 0;
  let awaitingBytes = 0;
  const capacityTier = options.capacityTier ?? "NORMAL";
  const limits = historyCapacityLimits(capacityTier, options.capacity);
  const clock = options.clock ?? Date.now;
  const timer = options.timer ?? defaultHistoryTimer();

  function currentBoundary(): EvidenceRef | null { return committedEvidenceBoundary; }
  function currentRange(): { first: EvidenceRef; last: EvidenceRef } | null { return retainedRange; }
  function oldestAwaiting(): Pending | undefined {
    let oldest: Pending | undefined;
    for (const candidate of [inFlight[0], pending[0], postClearPending[0]]) {
      if (candidate !== undefined && (oldest === undefined || candidate.ordinal < oldest.ordinal)) oldest = candidate;
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

  function clearQueueForCandidate(): Pending[] {
    return clearInProgress ? postClearPending : pending;
  }

  function rejoinPostClearQueue(): void {
    if (postClearPending.length === 0) return;
    pending.push(...postClearPending.splice(0));
    clearInProgress = false;
    if (clearPromise) return;
    scheduleAgeCheck();
    pressureChanged();
    lastClearResult = null;
    if (pending.length > 0) {
      schedule();
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
      awaitingAcceptance: awaitingCount,
      accepted,
      notAccepted,
      retained: retainedCount,
      ...(terminal ? { terminal } : {}),
      ...(lastCoherentQuery ? { lastCoherentQuery } : {})
    });
    return problemValue ? deepFreeze({ ...value, problem: problemValue }) as HistoryStatus : value;
  }
  function problem(code: HistoryProblem["code"], message: string, extras: Partial<HistoryProblem> = {}): HistoryProblem {
    return deepFreeze({ code, message, ...extras });
  }
  function terminalProblem(triggerValue: HistoryTrigger): HistoryProblem {
    return problem(triggerValue.reason, `Event History stopped because ${triggerValue.reason}.${triggerValue.detail ? ` ${triggerValue.detail}` : terminalFailureDetail ? ` ${terminalFailureDetail}` : ""}`, {
      reason: triggerValue.reason,
      dimension: triggerValue.dimension,
      ...(terminal ?? persistedTerminal ? { terminal: terminal ?? persistedTerminal } : {})
    });
  }
  function pressureChanged(): void {
    const near = pressureFor(limits, measurements()).nearLimit;
    if (near !== lastNearLimit) { lastNearLimit = near; publish({ type: "status", status: status() }); }
  }
  function makeTrigger(reason: HistoryTerminalReason, dimension: HistoryCapacityDimension | "JOURNAL", firstMissingEventId: string | null, detail?: string): HistoryTrigger {
    return deepFreeze({ reason, dimension, tier: capacityTier, triggerTime: clock(), interval, firstMissingEventId, measurements: measurements(), ...(detail ? { detail } : {}) });
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
        await failTerminalPersistence(error);
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

  async function failTerminalPersistence(error: unknown): Promise<void> {
    if (terminalPersistenceFailed) return;
    terminalPersistenceFailed = true;
    const reason = isQuotaError(error) ? "QUOTA_EXCEEDED" as const : "JOURNAL_COMMIT_FAILED" as const;
    trigger = makeTrigger(reason, "JOURNAL", trigger?.firstMissingEventId ?? null);
    const failedTerminal = terminalDiagnostic();
    persistedTerminal = failedTerminal;
    terminal = failedTerminal;
    phase = "STOPPED";
    try {
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
        failedTerminal
      );
    } catch {
      // The emergency control update is best effort; local state remains fail-closed.
    }
    const issue = terminalProblem(trigger);
    publish({ type: "terminal", terminal: failedTerminal, status: status(issue) });
    publish({ type: "status", status: status(issue), problem: issue });
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
      .catch((error) => failTerminalPersistence(error));
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
  function noteFirstMissingEvent(candidate: EvidenceCandidate): void {
    const id = candidateIdIfPresent(candidate);
    if (!terminal && trigger && trigger.firstMissingEventId === null && id !== null) {
      trigger = deepFreeze({ ...trigger, firstMissingEventId: id });
    }
  }

  function refusedCandidateBytes(candidate: EvidenceCandidate): number {
    try {
      return estimateHistoryCandidateBytes(candidate, options.byteEstimator);
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
    const completion = terminalFinalization ?? terminalSettled;
    const settled = completion
      ? completion.then(() => ({
          outcome: "NOT_EVIDENCE" as const,
          problem: trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary."),
          committedEvidenceBoundary: currentBoundary()
        }))
      : Promise.resolve({
          outcome: "NOT_EVIDENCE" as const,
          problem: trigger ? terminalProblem(trigger) : problem("HISTORY_STOPPED", "Event History stopped at its committed boundary."),
          committedEvidenceBoundary: currentBoundary()
        });
    return { intake: "REFUSED", settled };
  }
  function refuseClosed(): CaptureReceipt {
    notAccepted += 1;
    return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: problem("HISTORY_CLOSED", "Event History is closed."), committedEvidenceBoundary: currentBoundary() }) };
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
      return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() }) };
    }
    const failure = admissionFailure(limits, measurements(), bytes);
    if (failure) {
      notAccepted += 1;
      rejectedCount += 1;
      rejectedBytes += bytes;
      beginDrain(failure.reason, failure.dimension, candidate.id);
      const completion = terminalFinalization ?? terminalSettled;
      const settled = completion
        ? completion.then(() => ({ outcome: "NOT_EVIDENCE" as const, problem: terminalProblem(trigger!), committedEvidenceBoundary: currentBoundary() }))
        : Promise.resolve({ outcome: "NOT_EVIDENCE" as const, problem: terminalProblem(trigger!), committedEvidenceBoundary: currentBoundary() });
      return { intake: "REFUSED", settled };
    }
    let resolve!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((finish) => { resolve = finish; });
    const ordinal = captured + 1;
    captured += 1;
    clearQueueForCandidate().push({ ordinal, eventId: candidate.id, serialized, bytes, offeredAt: clock(), resolve });
    awaitingCount += 1;
    awaitingBytes += bytes;
    scheduleAgeCheck();
    pressureChanged();
    if (!clearInProgress) schedule();
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
        let evidence: CommittedEvidence[] = [];
        let candidates: EvidenceCandidate[] = [];
        try {
          evidence = batch.map((entry, index) => {
            const candidate = freezeCandidate(deserializeJournalEvidenceCandidate(entry.serialized.payload));
            registerJournalOwnedCandidate(candidate, entry.serialized.payload);
            return toCommittedEvidence(candidate, interval, nextSequence + index);
          });
          candidates = evidence.map((entry) => entry.candidate);
          await options.failure?.commitBatch?.(candidates);
          await options.commitBatch?.(candidates);
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
            batch.map((entry) => entry.serialized),
            replayPayloadBytes + batchSerializedBytes,
            durableAccountedBytes + batchDurableAccountedBytes,
            controlPhase,
            controlTerminal
          );
        } catch (error) {
          const reason: HistoryTerminalReason = isQuotaError(error) ? "QUOTA_EXCEEDED" : "JOURNAL_COMMIT_FAILED";
          terminalFailureDetail = describeJournalError(error);
          const failedTrigger = makeTrigger(reason, "JOURNAL", batch[0]?.eventId ?? null, describeJournalError(error));
          trigger = failedTrigger;
          phase = "DRAINING_TO_STOP";
          ensureTerminalSettled();
          const discarded = [...batch, ...pending.splice(0)];
          inFlight.length = 0;
          awaitingCount -= discarded.length;
          awaitingBytes -= discarded.reduce((total, entry) => total + entry.bytes, 0);
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
        awaitingCount -= batch.length;
        awaitingBytes -= batch.reduce((total, entry) => total + entry.bytes, 0);
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
    if (clearInProgress || closing) {
      return Promise.resolve({ ok: false, problem: problem("CLEAR_IN_PROGRESS", "A History Interval clear is currently pending.") });
    }
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
    if (closing || phase === "CLOSED") {
      return Promise.resolve({ ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed and cannot be cleared.") });
    }
    if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") {
      rejectPostClearDuringClearFailure(clearBlockedProblem(), true);
      return Promise.resolve({ ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") });
    }
    if (lastClearResult && retainedCount === 0 && pending.length === 0 && postClearPending.length === 0 && inFlight.length === 0) {
      return Promise.resolve({ ok: true, value: lastClearResult });
    }
    clearInProgress = true;
    clearPromise = waitForIdle().then(async () => {
      if (phase === "CLOSED") return { ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed and cannot be cleared.") };
      if (phase === "STOPPED" || phase === "DRAINING_TO_STOP") {
        rejectPostClearDuringClearFailure(clearBlockedProblem(), true);
        return { ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") };
      }
      const previousInterval = interval;
      const nextInterval = Object.freeze({ id: `${loaded.panelSessionId}:interval-${previousInterval.ordinal + 1}`, ordinal: previousInterval.ordinal + 1 });
      try {
        const applied = await options.clearJournal?.();
        if (applied === false) {
          const issue = problem("CLEAR_FAILED", "The History Interval could not be cleared.");
          rejoinPostClearQueue();
          lastClearResult = null;
          publish({ type: "status", status: status(issue), problem: issue });
          return { ok: false, problem: issue };
        }
        await clearJournalRecords(database, loaded.panelSessionId, nextInterval, nextSequence, committedEvidenceBoundary);
      } catch (error) {
        const clearFailureProblem = problem("HISTORY_STOPPED", error instanceof Error ? error.message : "The History Interval could not be cleared.");
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
      clearInProgress = false;
      interval = nextInterval;
      retainedCount = 0;
      retainedRange = null;
      replayPayloadBytes = 0;
      retainedBytes = 0;
      durableAccountedBytes = 0;
      lastNearLimit = false;
      generation += 1;
      rejoinPostClearQueue();
      const result = deepFreeze({ previousInterval, interval });
      lastClearResult = result;
      publish(deepFreeze({ type: "interval-cleared" as const, previousInterval, interval, status: status() }));
      return { ok: true, value: result };
    });
    void clearPromise.finally(() => {
      clearInProgress = false;
      clearPromise = null;
      if (pending.length > 0 && !clearInProgress) {
        schedule();
      }
    });
    return clearPromise;
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closePromise) return closePromise;
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
      const finalCommittedEvidenceBoundary = currentBoundary();
      let dataDisposition: CloseResult["dataDisposition"] = "ERASURE_UNCONFIRMED";
      let cleanupDisposition: CloseResult["cleanupDisposition"] = "DEFERRED";
      try {
        const applied = await options.clearJournal?.();
        if (applied !== false) {
          await clearJournalRecords(database, loaded.panelSessionId, interval, nextSequence, committedEvidenceBoundary);
          dataDisposition = "ERASED";
          database.db.close();
          await options.closeJournal?.();
          cleanupDisposition = "COMPLETE";
        }
      } catch (error) {
        phase = "CLOSED";
        const issue = problem(
          "CLOSE_FAILED",
          error instanceof Error ? error.message : "Event History cleanup could not be confirmed."
        );
        publish({ type: "status", status: status(issue), problem: issue });
        const result = closeResult({ finalCommittedEvidenceBoundary, dataDisposition, cleanupDisposition });
        const outcome = { ok: false, problem: issue, value: result } as Outcome<CloseResult>;
        lastCloseOutcome = outcome;
        return outcome;
      }
      phase = "CLOSED";
      retainedCount = 0;
      retainedRange = null;
      replayPayloadBytes = 0;
      retainedBytes = 0;
      const result = closeResult({ finalCommittedEvidenceBoundary, dataDisposition, cleanupDisposition });
      const outcome = { ok: true, value: result } as Outcome<CloseResult>;
      lastCloseOutcome = outcome;
      publish({ type: "closed", result });
      return outcome;
    });
    void closePromise.finally(() => {
      closePromise = null;
      phase = "CLOSED";
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
    const immutablePublication = deepFreeze(publication);
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying && immutablePublication.type === "committed-evidence") {
        const first = immutablePublication.evidence[0];
        const last = immutablePublication.evidence.at(-1);
        if (first && last) {
          subscriber.pending.push({
            type: "committed-range",
            interval: immutablePublication.interval,
            firstSequence: first.sequence,
            lastSequence: last.sequence,
            committedEvidenceBoundary: immutablePublication.committedEvidenceBoundary
          });
        }
      } else if (subscriber.replaying) subscriber.pending.push(immutablePublication);
      else invoke(subscriber, immutablePublication);
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

  function closeResult(values: {
    finalCommittedEvidenceBoundary?: EvidenceRef | null;
    dataDisposition?: CloseResult["dataDisposition"];
    cleanupDisposition?: CloseResult["cleanupDisposition"];
  } = {}): CloseResult {
    return deepFreeze({
      finalCommittedEvidenceBoundary: values.finalCommittedEvidenceBoundary ?? currentBoundary(),
      dataDisposition: values.dataDisposition ?? "ERASURE_UNCONFIRMED",
      cleanupDisposition: values.cleanupDisposition ?? "DEFERRED"
    });
  }

  const storage: EventHistoryStorage = Object.freeze({ mode: "indexeddb" });
  const query: EvidenceFilterQueryAdapter["query"] = (request) => {
    if (phase === "CLOSED") return Promise.resolve(queryFailure("HISTORY_TERMINAL", "Event History is closed."));
    return queryIndexedDb(database, loaded.panelSessionId, request, {
      tier: options.capacityTier ?? "NORMAL",
      fallback: null,
      terminal: Boolean(terminal)
    }).then((result) => {
      if (result.ok) {
        lastCoherentQuery = result.value;
      } else {
        publish({ type: "status", status: status({ code: "QUERY_FAILED", message: result.problem.message }) });
      }
      return result;
    });
  };
  return { storage, status, offer, read, query, clear, follow, close };
}

async function loadJournal(database: AuthoritativeEventDatabase, panelSessionId: string): Promise<LoadedJournal> {
  // v2->v3 deployed journals may contain the authoritative replay payload and
  // postings but no lightweight projection. Backfill that derived data once at
  // open time so those records remain queryable without making normal queries
  // deserialize the journal.
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings], "readwrite");
  try {
    await backfillMissingQueryProjections(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence));
    const control = await requestToPromise<ControlRecord | undefined>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY), "loading history control");
    await validateJournalRecords(
      panelSessionId,
      control,
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence),
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings)
    );
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

function backfillMissingQueryProjections(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("Query projection migration failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      const record = cursor.value as EvidenceRecord;
      if (record.projection === undefined) {
        const candidate = deserializeJournalEvidenceCandidate(record.replayPayload);
        cursor.update({ ...record, projection: queryProjection(candidate, record.intervalId, record.sequence) });
      }
      cursor.continue();
    };
  });
}

type IndexedDbQueryOptions = Readonly<{
  tier: HistoryCapacityTier;
  fallback: "PRIMARY_JOURNAL_UNAVAILABLE" | "UNKNOWN_NEWER_SCHEMA" | null;
  terminal: boolean;
}>;

/**
 * The query transaction is deliberately separate from the legacy scalar read.
 * It latches control and Evidence together, then evaluates the storage-neutral
 * contract against that immutable transaction view.  The transaction is the
 * read point: no local history counters are consulted after it starts.
 */
async function queryIndexedDb(
  database: AuthoritativeEventDatabase,
  panelSessionId: string,
  request: EvidenceQueryRequest,
  options: IndexedDbQueryOptions
): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
  if (!Number.isSafeInteger(request.page.size) || request.page.size < 1 || request.page.size > MAX_EVIDENCE_PAGE_SIZE) {
    return queryFailure("QUERY_FAILED", request.page.size > MAX_EVIDENCE_PAGE_SIZE ? `Page size must not exceed ${MAX_EVIDENCE_PAGE_SIZE}.` : "Page size must be a positive integer.");
  }
  const started = Date.now();
  const telemetry = { postingReads: 0, postingCandidates: 0, evidenceCursorReads: 0, payloadHydrations: 0, candidateBound: 0, pageBound: request.page.size, residualScan: false, elapsedMs: 0 };
  const transaction = database.db.transaction([
    AUTHORITATIVE_EVENT_STORE_NAMES.historyControl,
    AUTHORITATIVE_EVENT_STORE_NAMES.evidence,
    AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings
  ], "readonly");
  try {
    const control = await requestToPromise<ControlRecord | undefined>(
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY),
      "reading Evidence query control"
    );
    if (!control || control.panelSessionId !== panelSessionId) return queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "The History Interval is unavailable.");
    const interval = control.interval;
    const readPoint = queryReadPoint(control);
    if (request.at !== "LATEST_COMMITTED") {
      if (request.at.interval.id !== interval.id || request.at.interval.ordinal !== interval.ordinal) {
        return queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "The requested History Interval is unavailable.");
      }
      if (!sameQueryReadPoint(request.at, readPoint)) {
        return queryFailure("READ_POINT_UNAVAILABLE", "The requested Evidence read point is unavailable.");
      }
    }
    const retained = control.retainedRange;
    const boundary = control.committedEvidenceBoundary?.intervalId === interval.id ? control.committedEvidenceBoundary.sequence : Number.POSITIVE_INFINITY;
    const firstSequence = retained?.first.sequence ?? 1;
    const lastSequence = Math.min(retained?.last.sequence ?? 0, boundary);
    const postingCandidates = await indexedDbPostingCandidates(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings), request.filter, interval.id, firstSequence, lastSequence, telemetry);
    const candidateSequences = postingCandidates;
    const simpleRecentPage = postingCandidates === null && request.filter.text.trim() === "" && request.filter.around === null && request.lookup === undefined && request.find === undefined;
    let projections: EvidenceRecord[];
    if (simpleRecentPage) {
      const offset = decodeQueryCursor(request.page.cursor, readPoint, request, 0);
      projections = await readEvidencePage(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence), firstSequence, lastSequence, request.page, offset, telemetry);
      telemetry.candidateBound = control.retainedCount;
    } else {
      telemetry.residualScan = request.filter.text.trim() !== "" || request.filter.around !== null || request.find !== undefined;
      projections = await readEvidenceProjections(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence), interval.id, firstSequence, lastSequence, candidateSequences, telemetry);
      telemetry.candidateBound = projections.length;
    }
    const selectedPayload = request.lookup === undefined
      ? null
      : await readSelectedEvidence(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence), request.lookup, interval, firstSequence, lastSequence, telemetry);
    await transactionDone(transaction, "querying Evidence");
    const selectionRecords = projections.map((record) => querySelectionRecord(record, interval));
    const around = normalizeAround(request.filter.around, readPoint.retainedRange);
    const filter = around === request.filter.around ? request.filter : { ...request.filter, around };
    if (filter.around?.anchor && !selectionRecords.some((record) => sameQueryIdentity(record.identity, filter.around!.anchor!) && (filter.around!.anchorSequence === undefined || filter.around!.anchorSequence === record.identity.sequence))) {
      return queryFailure("AROUND_ANCHOR_UNAVAILABLE", "The Around Evidence anchor is no longer retained in this History Interval.");
    }
    const discoveries = new Map<string, FacetDiscoveryResult>();
    for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, { state: "UNAVAILABLE", facet: discovery.facet, reason: "UNSUPPORTED_AT_READ_POINT", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null });
    const lookupRecord = selectedPayload ? querySelectionRecord(selectedPayload, interval) : null;
    const lookupRecordsWithPayload = lookupRecord
      ? [...selectionRecords.filter((record) => !sameQueryIdentity(record.identity, lookupRecord.identity)), Object.freeze({ ...lookupRecord, payload: copyQueryCandidate(deserializeJournalEvidenceCandidate(selectedPayload!.replayPayload)) })]
      : selectionRecords;
    if (filter.unsupported.length > 0) {
      const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecordsWithPayload, readPoint, request.lookup, filter, around);
      const find = request.find === undefined ? null : findEvidence(selectionRecords, request.find);
      telemetry.elapsedMs = Date.now() - started;
      return { ok: true, value: querySnapshot(readPoint, [], 0, 0, discoveries, "UNSUPPORTED_FILTER", queryCoverage(options), queryStorage(options), null, lookup, find, telemetry) };
    }
    const matching: SelectionRecord[] = [];
    const inScope: SelectionRecord[] = [];
    for (const record of selectionRecords) {
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
    const ordered = simpleRecentPage ? selectionRecords : (request.page.order === "NEWEST_FIRST" ? [...inScope].reverse() : inScope);
    const offset = decodeQueryCursor(request.page.cursor, readPoint, request, 0);
    const page = simpleRecentPage ? selectionRecords : ordered.slice(offset, offset + request.page.size);
    if (offset > (simpleRecentPage ? control.retainedCount : ordered.length)) throw new Error("The page cursor is beyond the committed result set.");
    const lookupRecords = lookupRecordsWithPayload;
    const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
    const find = request.find === undefined ? null : findEvidence(selectionRecords, request.find);
    telemetry.elapsedMs = Date.now() - started;
    const matchingTotal = simpleRecentPage ? control.retainedCount : matching.length;
    const inScopeTotal = simpleRecentPage ? control.retainedCount : inScope.length;
    return { ok: true, value: querySnapshot(readPoint, page, matchingTotal, inScopeTotal, discoveries, "COMPLETE", queryCoverage(options), queryStorage(options), simpleRecentPage ? (offset + page.length < control.retainedCount ? encodeQueryCursor(readPoint, request, offset + page.length) : null) : (offset + page.length < ordered.length ? encodeQueryCursor(readPoint, request, offset + page.length) : null), lookup, find, telemetry) };
  } catch (error) {
    try { transaction.abort(); } catch { /* already completed */ }
    return queryFailure("QUERY_FAILED", error instanceof Error ? error.message : "IndexedDB Evidence query failed.");
  }
}

type QueryTelemetryMutable = { postingReads: number; postingCandidates: number; evidenceCursorReads: number; payloadHydrations: number; candidateBound: number; pageBound: number; residualScan: boolean; elapsedMs: number };

function querySelectionRecord(record: EvidenceRecord, interval: HistoryInterval): SelectionRecord {
  const projection = record.projection;
  if (!projection) {
    throw new Error("Evidence record has no query projection; refusing an unbounded payload reconstruction.");
  }
  const identity: EvidenceIdentity = Object.freeze({ intervalId: record.intervalId, pageId: interval.id, ownerId: "memory-event-history", sequence: record.sequence, eventId: record.eventId });
  return Object.freeze({ identity, timestamp: projection.timestamp, summary: projection.summary, searchText: projection.searchText, facets: Object.freeze(projection.facets) as SelectionRecord["facets"] });
}

async function indexedDbPostingCandidates(store: IDBObjectStore, filter: EvidenceQueryRequest["filter"], intervalId: string, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<Set<number> | null> {
  const groups = Object.values(filter.criteria).filter((group): group is NonNullable<typeof group> => Boolean(group));
  if (groups.length === 0) return null;
  const all = new Set<number>();
  let initialized = false;
  for (const group of groups) {
    const include = new Set<number>();
    if (group.include.length === 0 && !initialized) {
      for (let sequence = first; sequence <= last; sequence += 1) all.add(sequence);
      initialized = true;
    }
    for (const value of group.include) {
      const token = facetPostingToken(value.identity);
      telemetry.postingReads += 1;
      const values = await readPostingToken(store, token, intervalId, first, last, telemetry);
      for (const sequence of values) include.add(sequence);
    }
    if (!initialized) { for (const sequence of include) all.add(sequence); initialized = true; }
    else if (group.include.length > 0) for (const sequence of [...all]) if (!include.has(sequence)) all.delete(sequence);
    for (const value of group.exclude) {
      telemetry.postingReads += 1;
      const excluded = await readPostingToken(store, facetPostingToken(value.identity), intervalId, first, last, telemetry);
      for (const sequence of excluded) all.delete(sequence);
    }
  }
  return all;
}

function readPostingToken(store: IDBObjectStore, token: string, intervalId: string, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<Set<number>> {
  const result = new Set<number>();
  if (last < first) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const request = store.index("token").openCursor(queryOnlyRange(token));
    request.onerror = () => reject(request.error ?? new Error("Facet posting read failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      const posting = cursor.value as FacetPostingRecord;
      if (posting.intervalId === intervalId && posting.sequence >= first && posting.sequence <= last) {
        result.add(posting.sequence);
        telemetry.postingCandidates += 1;
      }
      cursor.continue();
    };
  });
}

function readEvidencePage(store: IDBObjectStore, first: number, last: number, page: EvidenceQueryRequest["page"], offset: number, telemetry: QueryTelemetryMutable): Promise<EvidenceRecord[]> {
  const result: EvidenceRecord[] = [];
  if (last < first) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const direction = page.order === "NEWEST_FIRST" ? "prev" : "next";
    const request = store.openCursor(queryBoundRange(first, last), direction);
    let skipped = 0;
    request.onerror = () => reject(request.error ?? new Error("Evidence page cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= page.size) { resolve(result); return; }
      telemetry.evidenceCursorReads += 1;
      const sequence = Number(cursor.key);
      if (sequence < first || sequence > last) { cursor.continue(); return; }
      if (skipped++ < offset) { cursor.continue(); return; }
      result.push(cursor.value as EvidenceRecord);
      cursor.continue();
    };
  });
}

function readEvidenceProjections(store: IDBObjectStore, intervalId: string, first: number, last: number, candidates: Set<number> | null, telemetry: QueryTelemetryMutable): Promise<EvidenceRecord[]> {
  const result: EvidenceRecord[] = [];
  if (last < first) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const request = store.openCursor(queryBoundRange(first, last));
    request.onerror = () => reject(request.error ?? new Error("Evidence projection cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      telemetry.evidenceCursorReads += 1;
      const record = cursor.value as EvidenceRecord;
      if (record.sequence >= first && record.sequence <= last && record.intervalId === intervalId && (candidates === null || candidates.has(record.sequence))) result.push(record);
      cursor.continue();
    };
  });
}

function queryOnlyRange(value: IDBValidKey): IDBKeyRange | undefined {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.only(value) : undefined;
}

function queryBoundRange(lower: IDBValidKey, upper: IDBValidKey): IDBKeyRange | undefined {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.bound(lower, upper) : undefined;
}

async function readSelectedEvidence(store: IDBObjectStore, identity: EvidenceIdentity, interval: HistoryInterval, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<EvidenceRecord | null> {
  if (identity.intervalId !== interval.id || identity.sequence < first || identity.sequence > last) return null;
  telemetry.payloadHydrations += 1;
  const record = await requestToPromise<EvidenceRecord | undefined>(store.get(identity.sequence), "reading selected Evidence payload");
  if (!record || record.intervalId !== interval.id || record.eventId !== identity.eventId) return null;
  return record;
}

function stableQueryValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableQueryValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableQueryValue(entry)}`).join(",")}}`;
}

function cursorBoundary(readPoint: EvidenceReadPoint): string {
  return stableQueryValue({ interval: readPoint.interval, boundary: readPoint.committedEvidenceBoundary, range: readPoint.retainedRange });
}

function encodeQueryCursor(readPoint: EvidenceReadPoint, request: EvidenceQueryRequest, offset: number): string {
  return encodeURIComponent(JSON.stringify({ v: 1, offset, order: request.page.order, size: request.page.size, filter: stableQueryValue(request.filter), point: cursorBoundary(readPoint) }));
}

function decodeQueryCursor(cursor: string | undefined, readPoint: EvidenceReadPoint, request: EvidenceQueryRequest, _fallback: number): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as { v?: unknown; offset?: unknown; order?: unknown; size?: unknown; filter?: unknown; point?: unknown };
    if (value.v !== 1 || value.order !== request.page.order || value.size !== request.page.size || value.filter !== stableQueryValue(request.filter) || value.point !== cursorBoundary(readPoint) || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0) throw new Error("The page cursor is not bound to this read point.");
    return value.offset as number;
  } catch {
    throw new Error("The page cursor is malformed or no longer valid.");
  }
}

function queryFailure(code: EvidenceFilterReadProblem["code"], message: string): Readonly<{ ok: false; problem: EvidenceFilterReadProblem }> {
  return { ok: false, problem: Object.freeze({ code, message }) };
}

function queryReadPoint(control: ControlRecord): EvidenceReadPoint {
  const identity = (ref: EvidenceRef): EvidenceIdentity => ({ intervalId: ref.intervalId, pageId: control.interval.id, ownerId: "memory-event-history", sequence: ref.sequence, eventId: ref.eventId });
  const boundary = control.committedEvidenceBoundary ? identity(control.committedEvidenceBoundary) : null;
  return Object.freeze({
    interval: Object.freeze({ ...control.interval }),
    committedEvidenceBoundary: boundary,
    retainedRange: control.retainedRange ? Object.freeze({ first: identity(control.retainedRange.first), last: identity(control.retainedRange.last) }) : null
  });
}

function deterministicQueryRecord(entry: CommittedEvidence, interval: HistoryInterval): SelectionRecord {
  const identity: EvidenceIdentity = Object.freeze({ intervalId: entry.intervalId, pageId: interval.id, ownerId: "memory-event-history", sequence: entry.sequence, eventId: entry.eventId });
  if (entry.candidate.kind === "topology-checkpoint") return Object.freeze({ identity, timestamp: 0, summary: "Topology checkpoint", searchText: journalCandidateSearchText(entry.candidate), facets: Object.freeze({}) });
  const context = { identity, pageId: identity.pageId, listenerOwner: identity.ownerId, summary: entry.candidate.kind };
  return Object.freeze({ identity, timestamp: entry.candidate.timestamp, summary: entry.candidate.kind, searchText: canonicalEvidenceSearchText(entry.candidate, context), facets: Object.freeze(extractEvidenceFacets(entry.candidate, context).facets) });
}

function queryProjection(candidate: EvidenceCandidate, intervalId: string, sequence: number): NonNullable<EvidenceRecord["projection"]> {
  const identity: EvidenceIdentity = { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence, eventId: candidate.id };
  if (candidate.kind === "topology-checkpoint") {
    return { timestamp: 0, summary: "Topology checkpoint", searchText: journalCandidateSearchText(candidate), facets: {} };
  }
  const context = { identity, pageId: intervalId, listenerOwner: identity.ownerId, summary: candidate.kind };
  return {
    timestamp: candidate.timestamp,
    summary: candidate.kind,
    searchText: canonicalEvidenceSearchText(candidate, context),
    facets: extractEvidenceFacets(candidate, context).facets
  };
}

function querySnapshot(readPoint: EvidenceReadPoint, page: readonly SelectionRecord[], matching: number, inScope: number, discoveries: ReadonlyMap<string, FacetDiscoveryResult>, evaluation: EvidenceSnapshot["evaluation"], coverage: EvidenceSnapshot["coverage"], storage: EvidenceSnapshot["storage"], nextCursor: string | null, lookup: EvidenceSnapshot["lookup"], find: EvidenceSnapshot["find"], telemetry?: EvidenceSnapshot["telemetry"]): EvidenceSnapshot {
  const publicPage = page.map((record) => ({ identity: record.identity, timestamp: record.timestamp, summary: record.summary, searchText: record.searchText, facets: record.facets }));
  return Object.freeze({ readPoint, page: Object.freeze({ evidence: Object.freeze(publicPage), nextCursor }), totals: Object.freeze({ matching, inScope }), discoveries, lookup, find, evaluation, coverage, storage, ...(telemetry ? { telemetry } : {}) });
}

function queryCoverage(options: IndexedDbQueryOptions): EvidenceSnapshot["coverage"] { return options.tier === "LOWER" || options.fallback !== null || options.terminal ? "LIMITED" : "COMPLETE"; }
function queryStorage(options: IndexedDbQueryOptions): EvidenceSnapshot["storage"] { return options.fallback === null ? "INDEXED_DB" : "MEMORY_FALLBACK"; }
function queryCursor(cursor: string | undefined): number { const value = cursor === undefined ? 0 : Number(cursor); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Page cursor must be a non-negative integer."); return value; }
function isInQueryRange(sequence: number, range: ControlRecord["retainedRange"]): boolean { return range === null || (sequence >= range.first.sequence && sequence <= range.last.sequence); }
function sameQueryIdentity(left: EvidenceIdentity, right: EvidenceIdentity): boolean { return left.intervalId === right.intervalId && left.pageId === right.pageId && left.ownerId === right.ownerId && left.sequence === right.sequence && left.eventId === right.eventId; }
function sameQueryReadPoint(left: EvidenceReadPoint, right: EvidenceReadPoint): boolean { return left.interval.id === right.interval.id && left.interval.ordinal === right.interval.ordinal && sameNullableQueryIdentity(left.committedEvidenceBoundary, right.committedEvidenceBoundary) && sameNullableQueryRange(left.retainedRange, right.retainedRange); }
function sameNullableQueryIdentity(left: EvidenceIdentity | null, right: EvidenceIdentity | null): boolean { return left === null || right === null ? left === right : sameQueryIdentity(left, right); }
function sameNullableQueryRange(left: EvidenceReadPoint["retainedRange"], right: EvidenceReadPoint["retainedRange"]): boolean { return left === null || right === null ? left === right : sameQueryIdentity(left.first, right.first) && sameQueryIdentity(left.last, right.last); }
function copyQueryCandidate(candidate: EvidenceCandidate): unknown { return JSON.parse(JSON.stringify(candidate)); }

async function commitBatch(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, previousRange: { first: EvidenceRef; last: EvidenceRef } | null, previousCount: number, evidence: readonly CommittedEvidence[], serializedBatch: readonly ReturnType<typeof serializeJournalEvidenceCandidate>[], replayPayloadBytes: number, accountedBytes: number, phase: "RUNNING" | "DRAINING_TO_STOP", terminal: HistoryTerminalDiagnostic | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings], "readwrite");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  const postingStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings);
  let serializedBatchBytes = 0;
  let accountedBatchBytes = 0;
  for (const [index, entry] of evidence.entries()) {
    const serialized = serializedBatch[index];
    if (!serialized) throw new Error("The journal commit payload batch is incomplete.");
    const recordAccountedBytes = journalAccountedBytes(serialized.bytes);
    serializedBatchBytes += serialized.bytes;
    accountedBatchBytes += recordAccountedBytes;
    store.add({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes: recordAccountedBytes, facets: exactFacets(entry.candidate), projection: queryProjection(entry.candidate, entry.intervalId, entry.sequence) } satisfies EvidenceRecord);
    for (const posting of facetPostings(entry.candidate, entry.intervalId, entry.sequence)) {
      postingStore.add(posting);
    }
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
  try {
    store.put({ ...current, phase: "DRAINING_TO_STOP", terminal });
  } catch (error) {
    try { transaction.abort(); } catch { /* the transaction may already be complete */ }
    throw error;
  }
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
  try {
    transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(
      createControl(panelSessionId, interval, "STOPPED", terminal, nextSequence, boundary, range, retainedCount, replayPayloadBytes, accountedBytes)
    );
  } catch (error) {
    try { transaction.abort(); } catch { /* the transaction may already be complete */ }
    throw error;
  }
  await transactionDone(transaction, "finalizing Event History terminal state");
}

async function clearJournalRecords(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings], "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, "RUNNING", null, nextSequence, boundary, null, 0, 0, 0));
  await transactionDone(transaction, "clearing Event History");
}

function validateJournalRecords(panelSessionId: string, control: ControlRecord | undefined, store: IDBObjectStore, postingStore: IDBObjectStore): Promise<void> {
  if (!control) {
    return Promise.all([
      requestToPromise<number>(store.count(), "checking for Evidence residue"),
      requestToPromise<number>(postingStore.count(), "checking for facet posting residue")
    ]).then(([count, postingCount]) => {
      if (count > 0 || postingCount > 0) throw new Error("Evidence or facet posting residue exists without a history control record.");
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
  const evidenceBySequence = new Map<number, EvidenceRecord>();
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
        validateFacetPostingRecords(panelSessionId, control, postingStore, evidenceBySequence).then(resolve, reject);
        return;
      }
      const record = cursor.value as EvidenceRecord;
      try {
        const candidate = validateEvidenceRecord(record, control.interval.id);
        if (previous !== null && record.sequence !== previous.sequence + 1) {
          throw new Error("An evidence record sequence is incoherent with the history control record.");
        }
        const reference = evidenceRef(record);
        if (first === null) first = reference;
        last = reference;
        previous = record;
        evidenceBySequence.set(record.sequence, record);
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

function validateFacetPostingRecords(
  panelSessionId: string,
  control: ControlRecord,
  store: IDBObjectStore,
  evidenceBySequence: ReadonlyMap<number, EvidenceRecord>
): Promise<void> {
  const postingsBySequence = new Map<number, number>();
  const identitiesBySequence = new Map<number, Set<string>>();
  for (const [sequence, evidence] of evidenceBySequence) {
    const candidate = deserializeJournalEvidenceCandidate(evidence.replayPayload);
    identitiesBySequence.set(sequence, new Set(facetPostings(candidate, evidence.intervalId, sequence).map((posting) => posting.facetIdentity)));
  }
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB facet posting validation failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        if ([...identitiesBySequence.values()].some((identities) => identities.size > 0)) {
          reject(new Error("Facet posting metadata is incomplete."));
          return;
        }
        resolve();
        return;
      }
      try {
        const posting = validateFacetPostingRecord(cursor.value as FacetPostingRecord, panelSessionId, control.interval.id, evidenceBySequence);
        const count = (postingsBySequence.get(posting.sequence) ?? 0) + 1;
        if (count > EVIDENCE_FACET_COUNT) throw new Error("An Evidence record exceeds the facet posting bound.");
        postingsBySequence.set(posting.sequence, count);
        const identities = identitiesBySequence.get(posting.sequence);
        if (!identities?.delete(posting.facetIdentity)) throw new Error("A facet posting is duplicated or unexpected.");
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

function validateFacetPostingRecord(record: FacetPostingRecord, panelSessionId: string, intervalId: string, evidenceBySequence: ReadonlyMap<number, EvidenceRecord>): FacetPostingRecord {
  assertExactKeys(record, ["eventId", "facetIdentity", "intervalId", "sequence", "token"]);
  if (record.intervalId !== intervalId || typeof record.eventId !== "string" || record.eventId.length === 0
    || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || typeof record.facetIdentity !== "string"
    || record.token !== facetPostingToken(record.facetIdentity)) {
    throw new Error("A facet posting record is incoherent with the authoritative schema.");
  }
  const evidence = evidenceBySequence.get(record.sequence);
  if (!evidence || evidence.eventId !== record.eventId) {
    throw new Error("A facet posting does not match its Evidence record.");
  }
  const candidate = deserializeJournalEvidenceCandidate(evidence.replayPayload);
  if (!facetPostings(candidate, intervalId, record.sequence).some((posting) => posting.facetIdentity === record.facetIdentity)) {
    throw new Error("A facet posting does not match its replay payload.");
  }
  if (!record.token.startsWith(`[\"${AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE}\",`)) {
    throw new Error(`A facet posting does not use the ${panelSessionId} token namespace.`);
  }
  return record;
}

function validateEvidenceRecord(record: EvidenceRecord, intervalId: string, expectedSequence?: number): EvidenceCandidate {
  assertExactKeys(record, ["accountedBytes", "eventId", "facets", "intervalId", "replayPayload", "sequence", "serializedBytes", ...(record.projection === undefined ? [] : ["projection"])]);
  if (record.intervalId !== intervalId || (expectedSequence !== undefined && record.sequence !== expectedSequence)
    || typeof record.eventId !== "string" || record.eventId.length === 0 || !Number.isSafeInteger(record.sequence) || record.sequence < 1
    || typeof record.replayPayload !== "string" || !Number.isSafeInteger(record.serializedBytes) || record.serializedBytes < 0
    || !Number.isSafeInteger(record.accountedBytes) || record.accountedBytes !== journalAccountedBytes(record.serializedBytes)
    || !Array.isArray(record.facets) || record.facets.some((facetValue) => typeof facetValue !== "string")) {
    throw new Error("An evidence record is incoherent with the history control record.");
  }
  const candidate = copyCandidate(deserializeJournalEvidenceCandidate(record.replayPayload));
  const serialized = serializeJournalEvidenceCandidate(candidate);
  if (candidate.id !== record.eventId || serialized.payload !== record.replayPayload || serialized.bytes !== record.serializedBytes
    || JSON.stringify(exactFacets(candidate)) !== JSON.stringify(record.facets)) {
    throw new Error("An evidence record does not match its replay payload or facets.");
  }
  registerJournalOwnedCandidate(candidate, record.replayPayload);
  return candidate;
}

type JournalRead = Readonly<{ evidence: CommittedEvidence[]; total: number }>;

const JOURNAL_READ_MAX_RECORDS_PER_CHUNK = 64;
const JOURNAL_READ_TIME_BUDGET_MS = 8;

type JournalReadYield = Readonly<{
  yield: () => Promise<void>;
  dispose: () => void;
}>;

function createJournalReadYield(): JournalReadYield {
  const browserGlobals = globalThis as typeof globalThis & {
    MessageChannel?: typeof MessageChannel;
  };
  const MessageChannelConstructor = browserGlobals.MessageChannel;
  if (typeof MessageChannelConstructor === "function") {
    const channel = new MessageChannelConstructor();
    let resolveYield: (() => void) | null = null;
    let disposed = false;
    channel.port1.onmessage = () => {
      const resolve = resolveYield;
      resolveYield = null;
      resolve?.();
    };
    return {
      yield: () => {
        if (disposed) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resolveYield = resolve;
          channel.port2.postMessage(undefined);
        });
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        channel.port1.onmessage = null;
        const resolve = resolveYield;
        resolveYield = null;
        resolve?.();
        channel.port1.close();
        channel.port2.close();
      }
    };
  }
  let disposed = false;
  let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  let resolveYield: (() => void) | null = null;
  return {
    yield: () => {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveYield = resolve;
        timeout = globalThis.setTimeout(() => {
          timeout = null;
          const finish = resolveYield;
          resolveYield = null;
          finish?.();
        }, 0);
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      const resolve = resolveYield;
      resolveYield = null;
      resolve?.();
    }
  };
}

function journalReadNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

async function materializeJournalRead(
  records: readonly EvidenceRecord[],
  latch: ReadLatch,
  query: EvidenceQuery
): Promise<JournalRead> {
  const selected: CommittedEvidence[] = [];
  let total = 0;
  const retainedRange = latch.retainedRange;
  if (retainedRange === null) return { evidence: [], total: 0 };
  const orderedRecords = [...records].sort((left, right) => left.sequence - right.sequence);
  let offset = 0;
  let yieldJournalRead: JournalReadYield | null = null;
  try {
    while (offset < orderedRecords.length) {
      const startedAt = journalReadNow();
      let processed = 0;
      while (
        offset < orderedRecords.length
        && processed < JOURNAL_READ_MAX_RECORDS_PER_CHUNK
        && (processed === 0 || journalReadNow() - startedAt < JOURNAL_READ_TIME_BUDGET_MS)
      ) {
        const record = orderedRecords[offset];
        offset += 1;
        processed += 1;
        if (!record || record.intervalId !== latch.interval.id || record.sequence < retainedRange.first.sequence) continue;
        const evidence = toCommittedEvidenceFromRecord(record);
        if (matchesEvidenceQuery(evidence, query)) {
          total += 1;
          retainForJournalPage(selected, evidence, query);
        }
      }
      if (offset < orderedRecords.length) {
        if (yieldJournalRead === null) yieldJournalRead = createJournalReadYield();
        await yieldJournalRead.yield();
      }
    }
    return { evidence: pageJournalSelection(selected, query, total), total };
  } finally {
    yieldJournalRead?.dispose();
  }
}

function readJournal(database: AuthoritativeEventDatabase, latch: ReadLatch, query: EvidenceQuery): Promise<JournalRead> {
  return new Promise((resolve, reject) => {
    const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
    const completed = transactionDone(transaction, "reading Event History");
    const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
    const selected: CommittedEvidence[] = [];
    let total = 0;
    let totalKnownBeforePayloadRead = false;
    let preserveSelectionOrder = false;
    let validateExactFacetPayload = false;
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
          if (!preserveSelectionOrder) selected.sort((left, right) => left.sequence - right.sequence);
        resolve({
          evidence: preserveSelectionOrder
            ? selected
            : pageJournalSelection(selected, query, total),
          total
        });
        },
        fail
      );
    };
    const acceptRecord = (record: EvidenceRecord | undefined, requestedSequence?: number): void => {
      if (validateExactFacetPayload && record !== undefined && record.sequence !== requestedSequence) {
        fail(new Error("IndexedDB exact-facet page record does not match its requested sequence."));
        return;
      }
      const readable = record !== undefined && latch.retainedRange !== null && record.intervalId === latch.interval.id
        && Number.isSafeInteger(record.sequence) && record.sequence >= latch.retainedRange.first.sequence
        && record.sequence <= latch.retainedRange.last.sequence;
      if (!readable) {
        if (validateExactFacetPayload) fail(new Error("IndexedDB exact-facet page record is invalid."));
        return;
      }
      let evidence: CommittedEvidence;
      if (validateExactFacetPayload) {
        try {
          const candidate = validateEvidenceRecord(record, latch.interval.id, requestedSequence);
          evidence = deepFreeze({ intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId, candidate });
        } catch (error) {
          fail(error);
          return;
        }
      } else {
        evidence = toCommittedEvidenceFromRecord(record);
      }
      if (matchesEvidenceQuery(evidence, query)) {
        if (!totalKnownBeforePayloadRead) total += 1;
        selected.push(evidence);
      } else if (validateExactFacetPayload) {
        fail(new Error("IndexedDB exact-facet page payload does not match its query."));
      }
    };
    const readSequences = (sequences: readonly number[]): void => {
      let index = 0;
      const next = (): void => {
        if (settled) return;
        if (index >= sequences.length) {
          finish();
          return;
        }
        const requestedSequence = sequences[index++];
        const request = store.get(requestedSequence);
        request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence read failed."));
        request.onsuccess = () => nextRecord(request.result as EvidenceRecord | undefined, requestedSequence, next);
      };
      next();
    };
    const nextRecord = (record: EvidenceRecord | undefined, requestedSequence: number | undefined, next: () => void): void => {
      if (settled) return;
      acceptRecord(record, requestedSequence);
      if (!settled) next();
    };
    const readFacetMatches = (tokens: readonly string[]): void => {
      const sets: Set<number>[] = [];
      let tokenIndex = 0;
      const nextToken = (): void => {
        if (tokenIndex >= tokens.length) {
          const sequences = [...(sets[0] ?? new Set<number>())]
            .filter((sequence) => sets.every((set) => set.has(sequence)))
            .filter((sequence) => isReadableFacetSequence(sequence, latch, query))
            .sort((left, right) => left - right);
          if (canUseExactFacetPageFastPath(query, facetTokens, latch)) {
            total = sequences.length;
            totalKnownBeforePayloadRead = true;
            preserveSelectionOrder = true;
            validateExactFacetPayload = true;
            readSequences(pageSequenceSelection(sequences, query));
            return;
          }
          readSequences(query.order === "desc" ? [...sequences].reverse() : sequences);
          return;
        }
        const matches = new Set<number>();
        sets.push(matches);
        const request = store.index("facets").openCursor(exactFacetCursorKey(tokens[tokenIndex++]), query.order === "desc" ? "prev" : "next");
        request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence facet read failed."));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            nextToken();
            return;
          }
          if (typeof cursor.primaryKey !== "number" || !Number.isSafeInteger(cursor.primaryKey) || cursor.primaryKey < 1) {
            fail(new Error("IndexedDB exact-facet index contains an invalid sequence."));
            return;
          }
          matches.add(cursor.primaryKey);
          cursor.continue();
        };
      };
      nextToken();
    };
    const facetTokens = exactFacetQueryTokens(query);
    const canPageCandidateKind = query.limit !== undefined
      && query.candidateKind !== undefined
      && query.eventId === undefined
      && (query.filters === undefined || Object.keys(query.filters).length === 0)
      && query.find === undefined
      && query.afterSequence === undefined;
    if (canPageCandidateKind) {
      const checkpointToken = facet("kind", "topology-checkpoint");
      const countRequest = store.index("facets").count(exactFacetCursorKey(checkpointToken));
      let kindCountReady = false;
      let cursorDone = false;
      const finishCandidateKind = (): void => {
        if (!kindCountReady || !cursorDone || settled) return;
        finish();
      };
      countRequest.onerror = () => fail(countRequest.error ?? new Error("IndexedDB Evidence kind count failed."));
      countRequest.onsuccess = () => {
        const checkpointCount = countRequest.result;
        total = query.candidateKind === "topology-checkpoint"
          ? checkpointCount
          : Math.max(0, latch.retainedCount - checkpointCount);
        kindCountReady = true;
        finishCandidateKind();
      };
      const limit = Math.max(0, Math.floor(query.limit));
      if (limit === 0) {
        cursorDone = true;
        finishCandidateKind();
        return;
      }
      const offset = query.offsetFromNewest === undefined
        ? 0
        : Math.max(0, Math.floor(query.offsetFromNewest));
      const pageStop = offset + limit;
      preserveSelectionOrder = true;
      const direction = query.order === "desc" ? "prev" : "next";
      const request = store.openCursor(undefined, direction);
      let matched = 0;
      request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence candidate-kind read failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          cursorDone = true;
          finishCandidateKind();
          return;
        }
        const record = cursor.value as EvidenceRecord;
        if (latch.retainedRange !== null
          && record.sequence <= latch.retainedRange.last.sequence
          && record.sequence >= latch.retainedRange.first.sequence
          && record.intervalId === latch.interval.id
          && recordMatchesCandidateKind(record, query.candidateKind!)) {
          matched += 1;
          if (matched > offset) selected.push(toCommittedEvidenceFromRecord(record));
          if (matched >= pageStop) {
            cursorDone = true;
            finishCandidateKind();
            return;
          }
        }
        cursor.continue();
      };
      void completed.catch(fail);
      return;
    }
    if (query.eventId !== undefined) {
      const request = store.index("eventIdentity").get(query.eventId);
      request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence identity read failed."));
      request.onsuccess = () => {
        acceptRecord(request.result as EvidenceRecord | undefined);
        finish();
      };
      return;
    }
    if (facetTokens.length > 0) {
      readFacetMatches(facetTokens);
      return;
    }
    const unfilteredPage = query.candidateKind === undefined && query.find === undefined && !query.filters && query.afterSequence === undefined;
    const cooperativeRead = unfilteredPage && query.limit === undefined && query.offsetFromNewest === undefined;
    const limit = query.limit === undefined ? null : Math.max(0, Math.floor(query.limit));
    const offset = query.offsetFromNewest === undefined ? 0 : Math.max(0, Math.floor(query.offsetFromNewest));
    const pageStop = unfilteredPage && limit !== null ? offset + limit : null;
    if (pageStop === 0) {
      total = latch.retainedCount;
      finish();
      return;
    }
    if (unfilteredPage) total = latch.retainedCount;
    const direction = query.offsetFromNewest !== undefined || query.order === "desc" ? "prev" : "next";
    const request = store.openCursor(undefined, direction);
    const records: EvidenceRecord[] = [];
    let matched = 0;
    request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence read failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        if (cooperativeRead) {
          void completed.then(async () => {
            if (settled) return;
            try {
              const result = await materializeJournalRead(records, latch, query);
              if (settled) return;
              settled = true;
              resolve(result);
            } catch (error) {
              fail(error);
            }
          }, fail);
        } else finish();
        return;
      }
      const record = cursor.value as EvidenceRecord;
      if (latch.retainedRange !== null && record.sequence <= latch.retainedRange.last.sequence
        && record.sequence >= latch.retainedRange.first.sequence && record.intervalId === latch.interval.id) {
        if (cooperativeRead) {
          records.push(record);
        } else {
          const evidence = toCommittedEvidenceFromRecord(record);
          if (matchesEvidenceQuery(evidence, query)) {
            if (!unfilteredPage) total += 1;
            selected.push(evidence);
            matched += 1;
            if (pageStop !== null && matched >= pageStop) {
              finish();
              return;
            }
          }
        }
      }
      cursor.continue();
    };
    void completed.catch(fail);
  });
}

function exactFacetCursorKey(token: string): IDBKeyRange | string {
  const keyRange = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return keyRange ? keyRange.only(token) : token;
}

function isReadableFacetSequence(sequence: number, latch: ReadLatch, query: EvidenceQuery): boolean {
  if (latch.retainedRange === null || sequence < latch.retainedRange.first.sequence || sequence > latch.retainedRange.last.sequence) return false;
  if (query.afterSequence !== undefined && (typeof query.afterSequence !== "number" || !Number.isFinite(query.afterSequence))) return true;
  return query.afterSequence === undefined || sequence > query.afterSequence;
}

function hasResidualFind(query: EvidenceQuery): boolean {
  return Boolean(query.find?.trim() || query.filters?.query?.trim());
}

const EXACT_FACET_FILTER_NAMES = new Set([
  "clientId", "sessionId", "subscriptionId", "mode", "item", "itemPosition", "key", "command",
  "snapshot", "synthetic", "kind", "listenerId"
]);

function canUseExactFacetPageFastPath(query: EvidenceQuery, tokens: readonly string[], latch: ReadLatch): boolean {
  if (query.eventId !== undefined || tokens.length === 0 || latch.retainedRange === null || hasResidualFind(query)) return false;
  if (query.afterSequence !== undefined && (typeof query.afterSequence !== "number" || !Number.isFinite(query.afterSequence))) return false;
  if (query.candidateKind !== undefined && query.candidateKind !== "lightstreamer" && query.candidateKind !== "topology-checkpoint") return false;
  if (!hasCompleteExactFacetPredicates(query.filters)) return false;
  if (query.candidateKind === "lightstreamer" && !tokens.some((token) => token !== facet("kind", "topology-checkpoint"))) return false;
  return true;
}

function hasCompleteExactFacetPredicates(filters: EvidenceQuery["filters"]): boolean {
  if (!filters) return true;
  return Object.entries(filters).every(([name, value]) => {
    if (name === "query") return value === undefined || (typeof value === "string" && value.trim() === "");
    if (!EXACT_FACET_FILTER_NAMES.has(name)) return false;
    if (value === undefined) return true;
    return name === "clientId" || name === "sessionId" || value !== "";
  });
}

function pageSequenceSelection(sequences: readonly number[], query: EvidenceQuery): number[] {
  const ordered = query.order === "desc" ? [...sequences].reverse() : [...sequences];
  if (query.offsetFromNewest === undefined) {
    return query.limit === undefined ? ordered : ordered.slice(0, Math.max(0, Math.floor(query.limit)));
  }
  const offset = Math.max(0, Math.floor(query.offsetFromNewest));
  const limit = query.limit === undefined ? undefined : Math.max(0, Math.floor(query.limit));
  const page = [...sequences].reverse().slice(offset, limit === undefined ? undefined : offset + limit);
  return query.order === "desc" ? page : page.reverse();
}

function exactFacetQueryTokens(query: EvidenceQuery): string[] {
  const tokens: string[] = [];
  if (query.candidateKind === "topology-checkpoint") tokens.push(facet("kind", query.candidateKind));
  const filters = query.filters;
  if (!filters) return tokens;
  if (filters.clientId !== undefined) tokens.push(facet("clientId", filters.clientId));
  if (filters.sessionId !== undefined) tokens.push(facet("sessionId", filters.sessionId));
  const values: Array<[string, unknown]> = [
    ["subscriptionId", filters.subscriptionId],
    ["mode", filters.mode], ["item", filters.item], ["itemPosition", filters.itemPosition], ["key", filters.key],
    ["command", filters.command], ["snapshot", filters.snapshot], ["synthetic", filters.synthetic], ["kind", filters.kind],
    ["listenerId", filters.listenerId]
  ];
  for (const [name, value] of values) {
    if (value !== undefined && value !== "") tokens.push(facet(name, value));
  }
  return tokens;
}

function recordMatchesCandidateKind(record: EvidenceRecord, candidateKind: NonNullable<EvidenceQuery["candidateKind"]>): boolean {
  const isCheckpoint = record.facets.includes(facet("kind", "topology-checkpoint"));
  return candidateKind === "topology-checkpoint" ? isCheckpoint : !isCheckpoint;
}

function pageJournalSelection(selected: readonly CommittedEvidence[], query: EvidenceQuery, total: number): CommittedEvidence[] {
  if (query.offsetFromNewest === undefined) {
    const ordered = query.order === "desc" ? [...selected].reverse() : [...selected];
    return query.limit === undefined ? ordered : ordered.slice(0, Math.max(0, Math.floor(query.limit)));
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

function facetPostingToken(facetIdentity: string): string {
  return JSON.stringify([AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE, facetIdentity]);
}

function facetPostings(candidate: EvidenceCandidate, intervalId: string, sequence: number): FacetPostingRecord[] {
  if (candidate.kind === "topology-checkpoint") return [];
  return extractEvidenceFacets(candidate).selectableValues.slice(0, EVIDENCE_FACET_COUNT).map((facetValue) => ({
    token: facetPostingToken(facetValue.identity),
    sequence,
    intervalId,
    eventId: candidate.id,
    facetIdentity: facetValue.identity
  }));
}

/** The bounded logical index fan-out reserved for one persisted Evidence record. */
export function authoritativeEventFacetCount(candidate: EvidenceCandidate): number {
  return candidate.kind === "topology-checkpoint" ? 1 : EVIDENCE_FACET_COUNT;
}

function facet(name: string, value: unknown): string {
  return JSON.stringify(["v1", name, value]);
}

function toCommittedEvidence(candidate: EvidenceCandidate, interval: HistoryInterval, sequence: number): CommittedEvidence {
  return deepFreeze({ intervalId: interval.id, sequence, eventId: candidate.id, candidate });
}

function toCommittedEvidenceFromRecord(record: EvidenceRecord): CommittedEvidence {
  const candidate = freezeCandidate(deserializeJournalEvidenceCandidate(record.replayPayload));
  registerJournalOwnedCandidate(candidate, record.replayPayload);
  return deepFreeze({ intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId, candidate });
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({ intervalId: evidence.intervalId, sequence: evidence.sequence, eventId: evidence.eventId });
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

function describeJournalError(error: unknown): string {
  if (error instanceof Error) return `Journal cause ${error.name}: ${error.message}`;
  return `Journal cause ${String(error)}`;
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
