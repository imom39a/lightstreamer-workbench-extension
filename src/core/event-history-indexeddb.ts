import {
  defaultHistoryTimer,
  estimateHistoryCandidateBytes,
  historyCapacityLimits,
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
  type AuthoritativeEventDatabase,
  type AuthoritativeFacetAggregateRecord
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
  type HistoryFollowOptions,
  type HistoryStatus,
  type HistoryAcceptanceGap,
  type HistoryContinuityStatus,
  type HistoryPersistenceStatus,
  type HistoryRetentionAdvance,
  type HistoryRetentionStatus,
  type Outcome,
  type CloseResult,
  type EventHistoryStorage,
  assertCandidate,
  copyCandidate,
  freezeCandidate,
  matchesEvidenceQuery,
  assertBoundedPanelSessionId,
  isBoundedEvidenceRef,
  isBoundedEvidenceRefComponent,
  type HistoryTerminalDiagnostic
} from "./event-history-authoritative";
import { extractEvidenceFacets, canonicalEvidenceSearchText, canonicalEvidenceSearchTextWithExtraction, normalizeEvidenceSearchText, type EvidenceFacetExtraction } from "./evidence-facets";
import { discoverFacet, discoverFacetFromAccounting, discoverFacetFromAggregates, type DiscoveryAccountingEntry, type DiscoveryAggregateEntry } from "./evidence-filter-discovery";
import { evaluateFilter, type Filter, type FilterRecord } from "./filter-algebra";
import { findEvidence, isInAround, lookupEvidence, normalizeAround, type SelectionRecord } from "./evidence-filter-selection";
import { decodeEvidenceQueryCursor, encodeEvidenceQueryCursor, type EvidenceQueryCursor } from "./evidence-filter-cursor";
import {
  MAX_EVIDENCE_PAGE_SIZE,
  type DeterministicEvidenceRecord,
  type EvidenceFilterReadProblem,
  type EvidenceFilterQueryAdapter,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryResult,
  type TypedFacetValue
} from "./evidence-filter-contract";

export type { EventHistory };

export const AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT = 256;
export const AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES = 2_097_152;
/** Commit transactions may fan out to Evidence, projection, posting, and aggregate indexes. */
export const AUTHORITATIVE_EVENT_HISTORY_COMMIT_TRANSACTION_TIMEOUT_MS = 30_000;
const JOURNAL_COMMIT_MAX_ATTEMPTS = 3;
const RETENTION_LOW_WATER_RATIO = 0.9;
const EVIDENCE_FACET_COUNT = 12;
// Persist exact words for every projection, but only materialize trigrams for
// short semantic tokens. High-cardinality replay identifiers and JSON values
// otherwise create hundreds of multi-entry index rows per Evidence record.
// Projections that omit some trigrams carry a reserved marker; Find detects
// that marker and uses its exact bounded projection scan instead of returning
// an incomplete candidate set.
const SEARCH_TOKEN_TRIGRAM_WORD_MAX_LENGTH = 8;
const SEARCH_TOKEN_TRIGRAM_IDENTIFIER_MAX_LENGTH = 16;
const SEARCH_TOKEN_PARTIAL_MARKER = "\u0000lsew-search-partial-v1";
const SEARCH_TOKEN_FULL_INDEX_RECORD_LIMIT = 128;
// Controlled close erases a session by deleting its IndexedDB database after
// the connection is closed. Deletion avoids a giant read/write clear over all
// derived indexes; keep a bounded window for the browser's delete request.
const CLOSE_DATABASE_DELETE_TIMEOUT_MS = 120_000;

const LIVE_PANEL_LEASE_PREFIX = "lsew-events-panel-live-v2-";
const LIVE_PANEL_LEASE_TTL_MS = 30_000;
const LIVE_PANEL_LEASE_HEARTBEAT_MS = 5_000;
const inProcessLivePanelDatabases = new Set<string>();

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

type QueryProjection = {
  sequence: number;
  intervalId: string;
  eventId: string;
  timestamp: number;
  summary: string;
  searchText: string;
  searchTokens: string[];
  facets: Readonly<Record<string, unknown>>;
};

export const AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE = "facet-v2";

type FacetPostingRecord = {
  token: string;
  sequence: number;
  intervalId: string;
  eventId: string;
  facet: string;
  facetIdentity: string;
};

type Pending = {
  kind: "candidate";
  ordinal: number;
  eventId: string;
  serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
  bytes: number;
  offeredAt: number;
  settled: CaptureReceipt["settled"];
  resolve: (result: ReceiptResult) => void;
};

type PendingGapSeed = Readonly<{
  captureOrdinal: number;
  eventId: string;
  candidateBytes: number;
  occurredAt: number;
  dimension: HistoryAcceptanceGap["dimension"];
}>;

type PendingGapBarrier = {
  kind: "gap-barrier";
  count: number;
  first: PendingGapSeed;
  latest: PendingGapSeed;
  problem: HistoryProblem;
  settled: CaptureReceipt["settled"];
  resolve: (result: ReceiptResult) => void;
};

type PendingEntry = Pending | PendingGapBarrier;

type PreparedEvidence = Readonly<{
  evidence: CommittedEvidence;
  serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
  projection: QueryProjection;
  postings: readonly FacetPostingRecord[];
  aggregateValues: readonly Readonly<{ facet: string; facetIdentity: string; type: string; value: string; label: string; observation: Readonly<{ sequence: number; eventId: string }> }>[];
}>;

type VolatileEvidence = Readonly<{
  evidence: CommittedEvidence;
  capacityBytes: number;
}>;

type DurableRetentionEntry = Readonly<{
  evidence: EvidenceRef;
  replayPayloadBytes: number;
  accountedBytes: number;
  capacityBytes: number;
}>;

type RetentionTrimPlan = Readonly<{
  cutoffSequence: number;
  evictedCount: number;
  evictedReplayPayloadBytes: number;
  evictedAccountedBytes: number;
  evictedCapacityBytes: number;
  firstEvicted: EvidenceRef | null;
  lastEvicted: EvidenceRef | null;
  firstRetained: EvidenceRef | null;
}>;

type FacetAggregateCache = Map<string, AuthoritativeFacetAggregateRecord | null>;

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
  signalCleanup?: () => void;
  cooperativeReplay?: {
    interval: HistoryInterval;
    generation: number;
    nextSequence: number;
    lastSequence: number;
    chunkSize: number;
    after: EvidenceRef | null;
    signal?: AbortSignal;
    signalCleanup?: () => void;
  };
};

const DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE = 256;
const MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE = 2_048;

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
  assertBoundedPanelSessionId(panelSessionId);
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
        await deleteAuthoritativeEventDatabase(databaseName, CLOSE_DATABASE_DELETE_TIMEOUT_MS);
      };
      const baseHistory = createHistory(database, loaded, {
        ...options,
        closeJournal
      });
      const ownedDatabase = database;
      const ownedHistory: EventHistory = {
        get storage(): EventHistoryStorage { return baseHistory.storage; },
        status: baseHistory.status,
        offer: baseHistory.offer,
        read: baseHistory.read,
        query: baseHistory.query,
        clear: baseHistory.clear,
        follow: baseHistory.follow,
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
  inProcessLivePanelDatabases.add(databaseName);
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return () => { inProcessLivePanelDatabases.delete(databaseName); };
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
    inProcessLivePanelDatabases.delete(databaseName);
    globalThis.clearInterval(heartbeat);
    try {
      storage.removeItem(key);
    } catch {
      // Best effort; the lease will expire and be treated as an orphan.
    }
  };
}

function hasFreshLivePanelLease(databaseName: string): boolean {
  if (inProcessLivePanelDatabases.has(databaseName)) return true;
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
  durableRetentionEntries: readonly DurableRetentionEntry[];
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
  const pending: PendingEntry[] = [];
  const inFlight: Pending[] = [];
  const postClearPending: PendingEntry[] = [];
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
  let durableRetainedCount = loaded.retainedCount;
  let durableRetainedCapacityBytes = loaded.retainedBytes;
  let durableRetainedRange = loaded.retainedRange;
  let persistenceMode: "INDEXEDDB" | "MEMORY" = "INDEXEDDB";
  let persistenceFailure: string | null = null;
  let journalCommitAttempts = 0;
  let journalRetryCount = 0;
  let journalFailureCount = 0;
  let journalLastFailureAt: number | null = null;
  let journalLastProblem: HistoryProblem | undefined;
  let evictedCount = 0;
  let evictedBytes = 0;
  let lastRetentionAdvance: HistoryRetentionAdvance | null = null;
  let firstGap: HistoryAcceptanceGap | null = null;
  let latestGap: HistoryAcceptanceGap | null = null;
  let gapCount = 0;
  const volatileEvidence: VolatileEvidence[] = [];
  const durableRetentionEntries = [...loaded.durableRetentionEntries];
  const retainedEventIds = new Set(durableRetentionEntries.map((entry) => entry.evidence.eventId));
  const capacityBytesBySequence = new Map(
    durableRetentionEntries.map((entry) => [entry.evidence.sequence, entry.capacityBytes] as const)
  );
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
  // The history owns the current IndexedDB journal exclusively. Keep the
  // compact aggregate values warm between commits so a one-event capture does
  // not issue a read for every repeated facet identity. Cache entries are
  // published only after their containing journal transaction commits.
  const facetAggregateCache: FacetAggregateCache = new Map();
  let capacityTier = options.capacityTier ?? "NORMAL";
  let limits = historyCapacityLimits(capacityTier, options.capacity);
  const clock = options.clock ?? Date.now;
  const timer = options.timer ?? defaultHistoryTimer();

  function currentBoundary(): EvidenceRef | null { return committedEvidenceBoundary; }
  function currentRange(): { first: EvidenceRef; last: EvidenceRef } | null { return retainedRange; }
  function oldestAwaiting(): Pending | undefined {
    let oldest: Pending | undefined;
    const firstPending = pending.find((entry): entry is Pending => entry.kind === "candidate");
    const firstPostClearPending = postClearPending.find((entry): entry is Pending => entry.kind === "candidate");
    for (const candidate of [inFlight[0], firstPending, firstPostClearPending]) {
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

  function persistenceStatus(): HistoryPersistenceStatus {
    return deepFreeze({
      mode: persistenceMode === "INDEXEDDB" ? "JOURNAL" : "MEMORY_ONLY",
      health: persistenceMode === "INDEXEDDB" ? "HEALTHY" : "DEGRADED",
      commitAttempts: journalCommitAttempts,
      retryCount: journalRetryCount,
      failureCount: journalFailureCount,
      lastFailureAt: journalLastFailureAt,
      ...(journalLastProblem ? { lastProblem: journalLastProblem } : {})
    });
  }

  function continuityStatus(): HistoryContinuityStatus {
    return deepFreeze({
      state: gapCount > 0 ? "GAPPED" : "CONTIGUOUS",
      gapCount,
      firstGap,
      latestGap
    });
  }

  function retentionStatus(): HistoryRetentionStatus {
    return deepFreeze({
      policy: "ROLLING",
      highWater: { count: limits.maxRetainedCount, bytes: limits.maxRetainedBytes },
      lowWater: {
        count: retentionLowWater(limits.maxRetainedCount),
        bytes: retentionLowWater(limits.maxRetainedBytes)
      },
      evicted: { count: evictedCount, bytes: evictedBytes },
      lastAdvance: lastRetentionAdvance
    });
  }

  function clearQueueForEntry(): PendingEntry[] {
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
    const rejectedCandidates = rejected.filter((entry): entry is Pending => entry.kind === "candidate");
    const rejectedBarriers = rejected.filter((entry): entry is PendingGapBarrier => entry.kind === "gap-barrier");
    awaitingCount -= rejectedCandidates.length;
    awaitingBytes -= rejectedCandidates.reduce((total, entry) => total + entry.bytes, 0);
    notAccepted += rejectedCandidates.length;
    discardedCount += rejectedCandidates.length;
    discardedBytes += rejectedCandidates.reduce((sum, entry) => sum + entry.bytes, 0);
    terminalReceipts.push(...rejectedCandidates);
    for (const barrier of rejectedBarriers) settleGapBarrier(barrier);
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
      retention: retentionStatus(),
      persistence: persistenceStatus(),
      continuity: continuityStatus(),
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

  function retentionLowWater(maximum: number): number {
    if (maximum <= 0) return 0;
    return Math.max(1, Math.floor(maximum * RETENTION_LOW_WATER_RATIO));
  }

  function adoptMemoryCapacity(): void {
    capacityTier = "LOWER";
    limits = historyCapacityLimits(capacityTier, options.capacity);
  }

  function retainedFirstReference(): EvidenceRef | null {
    return durableRetainedRange?.first ?? volatileEvidence[0]?.evidence ?? null;
  }

  function refreshRetainedRange(): void {
    const first = retainedFirstReference();
    retainedRange = first && committedEvidenceBoundary
      ? { first: { intervalId: first.intervalId, sequence: first.sequence, eventId: first.eventId }, last: committedEvidenceBoundary }
      : null;
  }

  async function advanceRetentionIfNeeded(): Promise<import("./event-history-authoritative").HistoryRetentionAdvance | null> {
    if (retainedCount <= limits.maxRetainedCount && retainedBytes <= limits.maxRetainedBytes) return null;
    const previousRetainedRange = retainedRange;
    if (!previousRetainedRange) return null;

    const targetCount = retentionLowWater(limits.maxRetainedCount);
    const targetBytes = retentionLowWater(limits.maxRetainedBytes);
    const volatileCapacityBytes = volatileEvidence.reduce((total, entry) => total + entry.capacityBytes, 0);
    const targetDurableCount = Math.max(0, targetCount - volatileEvidence.length);
    const targetDurableBytes = Math.max(0, targetBytes - volatileCapacityBytes);
    let removedCount = 0;
    let removedBytes = 0;
    let firstRemoved: EvidenceRef | null = null;
    let lastRemoved: EvidenceRef | null = null;

    if (
      durableRetainedRange !== null
      && (durableRetainedCount > targetDurableCount || durableRetainedCapacityBytes > targetDurableBytes)
    ) {
      const trim = persistenceMode === "INDEXEDDB"
        ? await planJournalRetentionTrim(
            database,
            interval,
            durableRetainedRange,
            durableRetainedCount,
            durableRetainedCapacityBytes,
            targetDurableCount,
            targetDurableBytes,
            capacityBytesBySequence
          )
        : planCachedRetentionTrim(
            durableRetentionEntries,
            durableRetainedCount,
            durableRetainedCapacityBytes,
            targetDurableCount,
            targetDurableBytes
          );
      if (trim.evictedCount > 0) {
        const nextDurableCount = durableRetainedCount - trim.evictedCount;
        const nextReplayPayloadBytes = Math.max(0, replayPayloadBytes - trim.evictedReplayPayloadBytes);
        const nextDurableAccountedBytes = Math.max(0, durableAccountedBytes - trim.evictedAccountedBytes);
        const nextDurableRange = trim.firstRetained && durableRetainedRange
          ? { first: trim.firstRetained, last: durableRetainedRange.last }
          : null;
        if (persistenceMode === "INDEXEDDB") {
          await applyJournalRetentionTrim(
            database,
            loaded.panelSessionId,
            interval,
            nextSequence,
            committedEvidenceBoundary,
            nextDurableRange,
            nextDurableCount,
            nextReplayPayloadBytes,
            nextDurableAccountedBytes,
            trim.cutoffSequence
          );
          durableAccountedBytes = nextDurableAccountedBytes;
          facetAggregateCache.clear();
        }
        for (let sequence = durableRetainedRange.first.sequence; sequence <= trim.cutoffSequence; sequence += 1) {
          capacityBytesBySequence.delete(sequence);
        }
        for (const entry of durableRetentionEntries.slice(0, trim.evictedCount)) {
          retainedEventIds.delete(entry.evidence.eventId);
        }
        durableRetentionEntries.splice(0, trim.evictedCount);
        durableRetainedCount = nextDurableCount;
        durableRetainedCapacityBytes = Math.max(0, durableRetainedCapacityBytes - trim.evictedCapacityBytes);
        durableRetainedRange = nextDurableRange;
        replayPayloadBytes = nextReplayPayloadBytes;
        retainedCount -= trim.evictedCount;
        retainedBytes = Math.max(0, retainedBytes - trim.evictedCapacityBytes);
        evictedCount += trim.evictedCount;
        evictedBytes += trim.evictedCapacityBytes;
        removedCount += trim.evictedCount;
        removedBytes += trim.evictedCapacityBytes;
        firstRemoved ??= trim.firstEvicted;
        lastRemoved = trim.lastEvicted;
      }
    }

    while (
      volatileEvidence.length > 0
      && (retainedCount > targetCount || retainedBytes > targetBytes)
    ) {
      const removed = volatileEvidence.shift()!;
      retainedEventIds.delete(removed.evidence.eventId);
      retainedCount -= 1;
      retainedBytes = Math.max(0, retainedBytes - removed.capacityBytes);
      evictedCount += 1;
      evictedBytes += removed.capacityBytes;
      removedCount += 1;
      removedBytes += removed.capacityBytes;
      firstRemoved ??= toRef(removed.evidence);
      lastRemoved = toRef(removed.evidence);
    }
    refreshRetainedRange();
    if (removedCount === 0 || firstRemoved === null || lastRemoved === null) return null;
    lastRetentionAdvance = deepFreeze({
      interval,
      occurredAt: clock(),
      previousRetainedRange,
      retainedRange,
      evicted: { count: removedCount, bytes: removedBytes, first: firstRemoved, last: lastRemoved }
    });
    return lastRetentionAdvance;
  }

  function acceptVolatileBatch(batch: readonly Pending[], prepared: readonly PreparedEvidence[]): void {
    for (const [index, entry] of batch.entries()) {
      volatileEvidence.push({ evidence: prepared[index]!.evidence, capacityBytes: entry.bytes });
    }
  }

  async function snapshotDurablePrefix(): Promise<readonly VolatileEvidence[] | null> {
    const durableRange = durableRetainedRange;
    if (durableRange === null) return [];
    try {
      const snapshot = await readJournal(database, deepFreeze({
        interval,
        generation,
        committedEvidenceBoundary: durableRange.last,
        retainedRange: durableRange,
        retainedCount: durableRetainedCount
      }), {});
      if (
        snapshot.evidence.length !== durableRetainedCount
        || durableRetentionEntries.length !== durableRetainedCount
      ) return null;
      return snapshot.evidence.map((evidence, index) => {
        const metadata = durableRetentionEntries[index];
        const capacityBytes = capacityBytesBySequence.get(evidence.sequence);
        if (
          metadata === undefined
          || capacityBytes === undefined
          || metadata.capacityBytes !== capacityBytes
          || metadata.evidence.intervalId !== evidence.intervalId
          || metadata.evidence.sequence !== evidence.sequence
          || metadata.evidence.eventId !== evidence.eventId
        ) throw new Error("The durable Event History prefix changed during memory fallback.");
        return { evidence, capacityBytes };
      });
    } catch {
      return null;
    }
  }

  function detachDurablePrefix(snapshot: readonly VolatileEvidence[] | null): HistoryRetentionAdvance | null {
    const previousRetainedRange = retainedRange;
    const droppedRange = durableRetainedRange;
    const droppedCount = durableRetainedCount;
    const droppedBytes = durableRetainedCapacityBytes;
    const droppedReplayPayloadBytes = durableRetentionEntries.reduce((total, entry) => total + entry.replayPayloadBytes, 0);

    if (snapshot !== null) volatileEvidence.unshift(...snapshot);
    else if (droppedCount > 0) {
      for (const entry of durableRetentionEntries) {
        retainedEventIds.delete(entry.evidence.eventId);
      }
      retainedCount = Math.max(0, retainedCount - droppedCount);
      retainedBytes = Math.max(0, retainedBytes - droppedBytes);
      replayPayloadBytes = Math.max(0, replayPayloadBytes - droppedReplayPayloadBytes);
      evictedCount += droppedCount;
      evictedBytes += droppedBytes;
    }
    durableRetainedCount = 0;
    durableRetainedCapacityBytes = 0;
    durableRetainedRange = null;
    durableAccountedBytes = 0;
    durableRetentionEntries.length = 0;
    capacityBytesBySequence.clear();
    facetAggregateCache.clear();
    refreshRetainedRange();

    if (
      snapshot !== null
      || droppedCount === 0
      || droppedRange === null
      || previousRetainedRange === null
    ) return null;
    lastRetentionAdvance = deepFreeze({
      interval,
      occurredAt: clock(),
      previousRetainedRange,
      retainedRange,
      evicted: {
        count: droppedCount,
        bytes: droppedBytes,
        first: droppedRange.first,
        last: droppedRange.last
      }
    });
    return lastRetentionAdvance;
  }

  function refuseUnretainable(
    candidate: EvidenceCandidate,
    bytes: number,
    dimension: HistoryAcceptanceGap["dimension"]
  ): CaptureReceipt {
    const captureOrdinal = captured + 1;
    captured += 1;
    notAccepted += 1;
    rejectedCount += 1;
    rejectedBytes += bytes;
    const seed: PendingGapSeed = {
      captureOrdinal,
      eventId: candidate.id,
      candidateBytes: bytes,
      occurredAt: clock(),
      dimension
    };
    const queue = clearQueueForEntry();
    const tail = queue.at(-1);
    // Keep refusal metadata bounded while preserving its place between
    // accepted candidates. The barrier is finalized only after every earlier
    // candidate has a committed Evidence identity.
    if (tail?.kind === "gap-barrier" && tail.first.dimension === dimension) {
      tail.count += 1;
      tail.latest = seed;
      return { intake: "REFUSED", settled: tail.settled };
    }
    const issue = dimension === "PENDING_BYTES"
      ? problem("PENDING_OVERFLOW", `The candidate would exceed the ${limits.pendingStopBytes}-byte pending Capture budget; later Capture continues.`, { dimension })
      : problem(
          "CANDIDATE_UNRETAINABLE",
          dimension === "RETAINED_COUNT"
            ? "The candidate cannot enter a History configured to retain zero records."
            : `The candidate is above the ${limits.maxRetainedBytes}-byte retention budget.`,
          { dimension }
        );
    let resolve!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((finish) => { resolve = finish; });
    queue.push({
      kind: "gap-barrier",
      count: 1,
      first: seed,
      latest: seed,
      problem: issue,
      settled,
      resolve
    });
    if (!clearInProgress) schedule();
    return { intake: "REFUSED", settled };
  }

  function settleGapBarrier(barrier: PendingGapBarrier): void {
    const afterEvidence = currentBoundary();
    const toGap = (seed: PendingGapSeed): HistoryAcceptanceGap => deepFreeze({
      interval,
      ...seed,
      afterEvidence
    });
    const first = toGap(barrier.first);
    const latest = barrier.count === 1 ? first : toGap(barrier.latest);
    firstGap ??= first;
    latestGap = latest;
    gapCount += barrier.count;
    publish(deepFreeze({
      type: "acceptance-gap" as const,
      interval,
      gap: first,
      status: status(barrier.problem),
      problem: barrier.problem
    }));
    barrier.resolve({
      outcome: "NOT_EVIDENCE",
      problem: barrier.problem,
      committedEvidenceBoundary: afterEvidence
    });
  }

  function convertDuplicateIdentityToGap(index: number): void {
    const entry = pending[index];
    if (entry?.kind !== "candidate") return;
    const issue = problem(
      "INVALID_CANDIDATE",
      "The candidate event identity is already retained in this History Interval.",
      { dimension: "EVENT_IDENTITY" }
    );
    const seed: PendingGapSeed = {
      captureOrdinal: entry.ordinal,
      eventId: entry.eventId,
      candidateBytes: entry.bytes,
      occurredAt: clock(),
      dimension: "EVENT_IDENTITY"
    };
    pending[index] = {
      kind: "gap-barrier",
      count: 1,
      first: seed,
      latest: seed,
      problem: issue,
      settled: entry.settled,
      resolve: entry.resolve
    };
    awaitingCount -= 1;
    awaitingBytes -= entry.bytes;
    notAccepted += 1;
    rejectedCount += 1;
    rejectedBytes += entry.bytes;
    scheduleAgeCheck();
    pressureChanged();
  }

  function settleLeadingGapBarrier(): boolean {
    const head = pending[0];
    if (head?.kind !== "gap-barrier") return false;
    pending.shift();
    settleGapBarrier(head);
    return true;
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
      if (currentAge !== null && currentAge < limits.pendingAgeStopMs) scheduleAgeCheck();
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
    // A successful Clear is idempotent only until the next valid Capture
    // attempt. Even a candidate that cannot be retained creates a new
    // continuity fact that a following Clear must erase in a fresh interval.
    lastClearResult = null;
    if (limits.maxRetainedCount < 1) return refuseUnretainable(candidate, bytes, "RETAINED_COUNT");
    if (bytes > limits.maxRetainedBytes) return refuseUnretainable(candidate, bytes, "RETAINED_BYTES");
    if (awaitingBytes + bytes > limits.pendingStopBytes) return refuseUnretainable(candidate, bytes, "PENDING_BYTES");
    let resolve!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((finish) => { resolve = finish; });
    const ordinal = captured + 1;
    captured += 1;
    clearQueueForEntry().push({ kind: "candidate", ordinal, eventId: candidate.id, serialized, bytes, offeredAt: clock(), settled, resolve });
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
        if (settleLeadingGapBarrier()) continue;
        const batch: Pending[] = [];
        const batchEventIds = new Set<string>();
        let batchSerializedBytes = 0;
        const retentionBatchLimit = Math.max(1, Math.min(
          AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT,
          retentionLowWater(limits.maxRetainedCount) || 1
        ));
        while (pending.length > 0 && batch.length < retentionBatchLimit) {
          const next = pending[0]!;
          if (next.kind === "gap-barrier") break;
          if (batch.length > 0 && batchSerializedBytes + next.serialized.bytes > AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES) break;
          if (retainedEventIds.has(next.eventId) || batchEventIds.has(next.eventId)) {
            convertDuplicateIdentityToGap(0);
            break;
          }
          batchEventIds.add(next.eventId);
          batch.push(pending.shift() as Pending);
          batchSerializedBytes += next.serialized.bytes;
        }
        if (batch.length === 0) continue;
        const batchAccountedBytes = batch.reduce((sum, entry) => sum + entry.bytes, 0);
        inFlight.push(...batch);
        let evidence: CommittedEvidence[] = [];
        let prepared: PreparedEvidence[] = [];
        let candidates: EvidenceCandidate[] = [];
        prepared = batch.map((entry, index) => {
          const candidate = freezeCandidate(deserializeJournalEvidenceCandidate(entry.serialized.payload));
          registerJournalOwnedCandidate(candidate, entry.serialized.payload);
          const committed = toCommittedEvidence(candidate, interval, nextSequence + index);
          return prepareEvidence(committed, entry.serialized, retainedCount + index >= SEARCH_TOKEN_FULL_INDEX_RECORD_LIMIT);
        });
        evidence = prepared.map((entry) => entry.evidence);
        candidates = evidence.map((entry) => entry.candidate);
        let durableCommit = false;
        let commitFailure: unknown = null;
        let failuresThisBatch = 0;
        let durableSnapshot: readonly VolatileEvidence[] | null | undefined;
        if (persistenceMode === "INDEXEDDB") {
          for (let attempt = 1; attempt <= JOURNAL_COMMIT_MAX_ATTEMPTS; attempt += 1) {
            journalCommitAttempts += 1;
            try {
              await options.failure?.commitBatch?.(candidates);
              await options.commitBatch?.(candidates);
              const batchDurableAccountedBytes = batch.reduce((sum, entry) => sum + journalAccountedBytes(entry.serialized.bytes), 0);
              await commitBatch(
                database,
                loaded.panelSessionId,
                interval,
                nextSequence,
                durableRetainedRange,
                durableRetainedCount,
                prepared,
                facetAggregateCache,
                replayPayloadBytes + batchSerializedBytes,
                durableAccountedBytes + batchDurableAccountedBytes,
                "RUNNING",
                null
              );
              durableCommit = true;
              if (failuresThisBatch > 0) {
                publish(deepFreeze({
                  type: "persistence-state" as const,
                  interval,
                  transition: "RECOVERED" as const,
                  persistence: persistenceStatus(),
                  status: status()
                }));
              }
              break;
            } catch (error) {
              commitFailure = error;
              failuresThisBatch += 1;
              journalFailureCount += 1;
              journalLastFailureAt = clock();
              const reason = isQuotaError(error) ? "QUOTA_EXCEEDED" as const : "JOURNAL_COMMIT_FAILED" as const;
              journalLastProblem = problem(
                reason,
                describeJournalError(error),
                { reason, dimension: "JOURNAL" }
              );
              if (attempt < JOURNAL_COMMIT_MAX_ATTEMPTS) journalRetryCount += 1;
            }
          }
        }
        if (persistenceMode === "INDEXEDDB" && !durableCommit) {
          durableSnapshot = await snapshotDurablePrefix();
        }
        if (!durableCommit) {
          acceptVolatileBatch(batch, prepared);
        }
        nextSequence += evidence.length;
        replayPayloadBytes += batchSerializedBytes;
        if (durableCommit) {
          const batchDurableAccountedBytes = batch.reduce((sum, entry) => sum + journalAccountedBytes(entry.serialized.bytes), 0);
          durableAccountedBytes += batchDurableAccountedBytes;
          durableRetainedCount += evidence.length;
          durableRetainedCapacityBytes += batchAccountedBytes;
          durableRetainedRange = durableRetainedRange
            ? { first: durableRetainedRange.first, last: toRef(evidence.at(-1)!) }
            : { first: toRef(evidence[0]!), last: toRef(evidence.at(-1)!) };
          for (const [index, entry] of batch.entries()) {
            const reference = toRef(evidence[index]!);
            const accountedBytes = journalAccountedBytes(entry.serialized.bytes);
            capacityBytesBySequence.set(reference.sequence, entry.bytes);
            durableRetentionEntries.push({
              evidence: reference,
              replayPayloadBytes: entry.serialized.bytes,
              accountedBytes,
              capacityBytes: entry.bytes
            });
          }
        }
        inFlight.length = 0;
        awaitingCount -= batch.length;
        awaitingBytes -= batch.reduce((total, entry) => total + entry.bytes, 0);
        committedEvidenceBoundary = toRef(evidence.at(-1)!);
        for (const entry of evidence) retainedEventIds.add(entry.eventId);
        retainedBytes += batchAccountedBytes;
        retainedCount += evidence.length;
        refreshRetainedRange();
        generation += 1;
        accepted += evidence.length;
        const retentionAdvances: HistoryRetentionAdvance[] = [];
        if (persistenceMode === "INDEXEDDB" && !durableCommit) {
          const cutoverAdvance = detachDurablePrefix(durableSnapshot ?? null);
          if (cutoverAdvance) retentionAdvances.push(cutoverAdvance);
          persistenceMode = "MEMORY";
          adoptMemoryCapacity();
          persistenceFailure = describeJournalError(commitFailure);
          terminalFailureDetail = persistenceFailure;
          publish(deepFreeze({
            type: "persistence-state" as const,
            interval,
            transition: "MEMORY_FALLBACK" as const,
            persistence: persistenceStatus(),
            status: status(journalLastProblem),
            ...(journalLastProblem ? { problem: journalLastProblem } : {})
          }));
        }
        const boundary = currentBoundary()!;
        publish(deepFreeze({ type: "committed-evidence" as const, interval, evidence, committedEvidenceBoundary: boundary }));
        let retentionAdvance: HistoryRetentionAdvance | null = null;
        try {
          retentionAdvance = await advanceRetentionIfNeeded();
        } catch (error) {
          if (persistenceMode === "INDEXEDDB") {
            const snapshot = await snapshotDurablePrefix();
            const cutoverAdvance = detachDurablePrefix(snapshot);
            if (cutoverAdvance) retentionAdvances.push(cutoverAdvance);
            persistenceMode = "MEMORY";
            adoptMemoryCapacity();
            persistenceFailure = describeJournalError(error);
            journalFailureCount += 1;
            journalLastFailureAt = clock();
            journalLastProblem = problem("JOURNAL_COMMIT_FAILED", persistenceFailure, {
              reason: "JOURNAL_COMMIT_FAILED",
              dimension: "JOURNAL"
            });
            publish(deepFreeze({
              type: "persistence-state" as const,
              interval,
              transition: "MEMORY_FALLBACK" as const,
              persistence: persistenceStatus(),
              status: status(journalLastProblem),
              problem: journalLastProblem
            }));
            retentionAdvance = await advanceRetentionIfNeeded();
          } else {
            throw error;
          }
        }
        if (retentionAdvance) retentionAdvances.push(retentionAdvance);
        for (const advance of retentionAdvances) {
          for (const subscriber of [...subscribers]) {
            if (subscriber.replaying && subscriber.cooperativeReplay) {
              failCooperativeReplay(subscriber, replayFailure("Replay expired because retained History advanced."));
            }
          }
          publish(deepFreeze({
            type: "retention-advanced" as const,
            interval,
            previousRetainedRange: advance.previousRetainedRange,
            retainedRange: advance.retainedRange,
            evicted: advance.evicted,
            status: status()
          }));
        }
        for (const [index, entry] of batch.entries()) {
          const reference = toRef(evidence[index]);
          entry.resolve({ outcome: "BECAME_EVIDENCE", evidence: reference });
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
    const volatileSnapshot = volatileEvidence.map((entry) => entry.evidence);
    const selectedRead = persistenceMode === "MEMORY"
      ? readMemoryJournal(latch, query, volatileSnapshot)
      : readJournal(database, latch, query);
    return selectedRead.then((selected) => ({
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
        facetAggregateCache.clear();
      } catch (error) {
        rejoinPostClearQueue();
        const issue = problem("CLEAR_FAILED", error instanceof Error ? error.message : "The History Interval could not be cleared.");
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
      durableRetainedCount = 0;
      durableRetainedCapacityBytes = 0;
      durableRetainedRange = null;
      durableRetentionEntries.length = 0;
      volatileEvidence.length = 0;
      retainedEventIds.clear();
      capacityBytesBySequence.clear();
      evictedCount = 0;
      evictedBytes = 0;
      lastRetentionAdvance = null;
      gapCount = 0;
      firstGap = null;
      latestGap = null;
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
      retainedEventIds.clear();
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

  function follow(options: HistoryFollowOptions, observer: (publication: HistoryPublication) => void): () => void {
    const subscriber: Subscriber = { observer, replaying: options.from === "CURRENT_INTERVAL_START", pending: [] };
    subscribers.add(subscriber);
    invoke(subscriber, { type: "status", status: status() });
    if (subscriber.replaying && subscribers.has(subscriber)) {
      if (options.chunkSize !== undefined || options.after !== undefined || options.signal !== undefined) {
        startCooperativeReplay(subscriber, options, latchForCurrentInterval());
      } else {
        replayFromJournal(subscriber, latchForCurrentInterval());
      }
    }
    return () => {
      subscriber.signalCleanup?.();
      subscriber.signalCleanup = undefined;
      subscribers.delete(subscriber);
      subscriber.pending.length = 0;
    };
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
          if (subscriber.cooperativeReplay?.interval.id === immutablePublication.interval.id) {
            subscriber.cooperativeReplay.generation = generation;
          }
          appendPendingReplayRange(subscriber, {
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

  function replayChunkSize(options: HistoryFollowOptions): number {
    if (options.chunkSize === undefined) return DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE;
    if (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1) return DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE;
    return Math.min(MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE, options.chunkSize);
  }

  function replayFailure(message: string): HistoryProblem {
    return problem("REPLAY_FAILED", message);
  }

  function replayLatchIsAvailable(latch: ReadLatch): boolean {
    if (interval.id !== latch.interval.id || interval.ordinal !== latch.interval.ordinal) return false;
    if (latch.retainedRange === null) return retainedRange === null;
    return retainedRange !== null
      && retainedRange.first.sequence <= latch.retainedRange.first.sequence
      && retainedRange.last.sequence >= latch.retainedRange.last.sequence;
  }

  function cooperativeReplayIsCurrent(subscriber: Subscriber): boolean {
    const replay = subscriber.cooperativeReplay;
    return replay !== undefined
      && replay.interval.id === interval.id
      && replay.interval.ordinal === interval.ordinal
      && replay.generation === generation;
  }

  function expireChangedIntervalReplay(subscriber: Subscriber): void {
    failCooperativeReplay(subscriber, replayFailure("Replay expired because the History Interval changed."));
  }

  function startCooperativeReplay(subscriber: Subscriber, options: HistoryFollowOptions, latch: ReadLatch): void {
    const after = options.after ?? null;
    subscriber.cooperativeReplay = {
      interval: latch.interval,
      generation: latch.generation,
      nextSequence: after === null ? latch.retainedRange?.first.sequence ?? 1 : after.sequence + 1,
      lastSequence: latch.retainedRange?.last.sequence ?? 0,
      chunkSize: replayChunkSize(options),
      after,
      signal: options.signal
    };
    if (after !== null && after.intervalId !== latch.interval.id) {
      failCooperativeReplay(subscriber, replayFailure("Replay interval mismatch."));
      return;
    }
    invoke(subscriber, deepFreeze({
      type: "replay-started" as const,
      interval: latch.interval,
      after,
      retainedRange: latch.retainedRange
    }));
    if (!subscribers.has(subscriber)) return;
    const onAbort = (): void => cancelCooperativeReplay(subscriber);
    if (options.signal) {
      if (options.signal.aborted) {
        cancelCooperativeReplay(subscriber);
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
      subscriber.signalCleanup = () => options.signal?.removeEventListener("abort", onAbort);
    }
    void validateCooperativeBoundary(subscriber, latch).then((valid) => {
      if (!cooperativeReplayIsCurrent(subscriber)) {
        expireChangedIntervalReplay(subscriber);
        return;
      }
      if (!valid) {
        failCooperativeReplay(subscriber, replayFailure("Replay unavailable."));
        return;
      }
      queueMicrotask(() => runCooperativeReplayChunk(subscriber));
    }).catch((error) => {
      failCooperativeReplay(subscriber, replayFailure(error instanceof Error ? error.message : "Replay validation failed."));
    });
  }

  function validateCooperativeBoundary(subscriber: Subscriber, latch: ReadLatch): Promise<boolean> {
    const replay = subscriber.cooperativeReplay;
    if (!replay || replay.after === null) return Promise.resolve(true);
    if (latch.retainedRange === null || replay.after.sequence > latch.retainedRange.last.sequence) return Promise.resolve(false);
    if (replay.after.sequence < latch.retainedRange.first.sequence) return Promise.resolve(false);
    if (persistenceMode === "MEMORY") {
      const volatileBoundary = volatileEvidence.find((entry) => entry.evidence.sequence === replay.after!.sequence)?.evidence;
      return Promise.resolve(Boolean(
        volatileBoundary
        && volatileBoundary.intervalId === replay.interval.id
        && volatileBoundary.eventId === replay.after.eventId
      ));
    }
    return new Promise<boolean>((resolve, reject) => {
      const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
      const request = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).get(replay.after!.sequence);
      request.onerror = () => reject(request.error ?? new Error("Replay boundary read failed."));
      request.onsuccess = () => {
        const record = request.result as EvidenceRecord | undefined;
        resolve(Boolean(record && record.intervalId === replay.interval.id && record.eventId === replay.after!.eventId));
      };
    });
  }

  async function runCooperativeReplayChunk(subscriber: Subscriber): Promise<void> {
    if (!subscribers.has(subscriber) || !subscriber.replaying) return;
    const replay = subscriber.cooperativeReplay;
    if (!replay) return;
    if (!cooperativeReplayIsCurrent(subscriber)) {
      expireChangedIntervalReplay(subscriber);
      return;
    }
    if (replay.signal?.aborted) {
      cancelCooperativeReplay(subscriber);
      return;
    }
    if (replay.nextSequence > replay.lastSequence) {
      finishCooperativeReplay(subscriber);
      return;
    }
    try {
      const entries = persistenceMode === "MEMORY"
        ? await readMemoryReplayChunk(
            replay.interval,
            replay.nextSequence,
            replay.lastSequence,
            replay.chunkSize,
            volatileEvidence.map((entry) => entry.evidence)
          )
        : await readReplayChunk(database, replay.interval, replay.nextSequence, replay.lastSequence, replay.chunkSize);
      if (!subscribers.has(subscriber) || !subscriber.replaying) return;
      if (!cooperativeReplayIsCurrent(subscriber)) {
        expireChangedIntervalReplay(subscriber);
        return;
      }
      if (entries.length === 0) {
        failCooperativeReplay(subscriber, replayFailure("Evidence interval ended before boundary."));
        return;
      }
      const expectedFirst = replay.nextSequence;
      if (
        entries[0]!.sequence !== expectedFirst ||
        entries.some((entry, index) => entry.sequence !== expectedFirst + index)
      ) {
        failCooperativeReplay(subscriber, replayFailure("Interval sequence gap."));
        return;
      }
      replay.nextSequence = entries.at(-1)!.sequence + 1;
      invoke(subscriber, deepFreeze({
        type: "committed-evidence" as const,
        interval: replay.interval,
        evidence: entries,
        committedEvidenceBoundary: { intervalId: entries.at(-1)!.intervalId, sequence: entries.at(-1)!.sequence, eventId: entries.at(-1)!.eventId }
      }));
      if (!subscribers.has(subscriber)) return;
      if (replay.nextSequence <= replay.lastSequence) {
        globalThis.setTimeout(() => { void runCooperativeReplayChunk(subscriber); }, 0);
      } else {
        finishCooperativeReplay(subscriber);
      }
    } catch (error) {
      failCooperativeReplay(subscriber, replayFailure(error instanceof Error ? error.message : "Evidence replay failed."));
    }
  }

  function finishCooperativeReplay(subscriber: Subscriber): void {
    if (!subscribers.has(subscriber) || !subscriber.replaying) return;
    if (!cooperativeReplayIsCurrent(subscriber)) {
      expireChangedIntervalReplay(subscriber);
      return;
    }
    const replay = subscriber.cooperativeReplay;
    subscriber.replaying = false;
    replay?.signalCleanup?.();
    subscriber.signalCleanup = undefined;
    invoke(subscriber, deepFreeze({
      type: "replay-complete" as const,
      interval: replay?.interval ?? interval,
      committedEvidenceBoundary
    }));
    if (subscribers.has(subscriber)) void finishReplay(subscriber);
  }

  function cancelCooperativeReplay(subscriber: Subscriber): void {
    if (!subscribers.has(subscriber) || !subscriber.replaying) return;
    const replay = subscriber.cooperativeReplay;
    subscriber.replaying = false;
    replay?.signalCleanup?.();
    subscriber.signalCleanup = undefined;
    invoke(subscriber, deepFreeze({
      type: "replay-cancelled" as const,
      interval: replay?.interval ?? interval,
      committedEvidenceBoundary
    }));
    subscribers.delete(subscriber);
    subscriber.pending.length = 0;
  }

  function failCooperativeReplay(subscriber: Subscriber, issue: HistoryProblem): void {
    if (!subscribers.has(subscriber)) return;
    const replay = subscriber.cooperativeReplay;
    subscriber.replaying = false;
    replay?.signalCleanup?.();
    subscriber.signalCleanup = undefined;
    invoke(subscriber, deepFreeze({
      type: "replay-failed" as const,
      interval: replay?.interval ?? interval,
      committedEvidenceBoundary,
      problem: issue
    }));
    subscribers.delete(subscriber);
    subscriber.pending.length = 0;
  }

  function appendPendingReplayRange(subscriber: Subscriber, range: PendingReplayRange): void {
    const previous = subscriber.pending.at(-1);
    if (
      previous?.type === "committed-range" &&
      previous.interval.id === range.interval.id &&
      previous.lastSequence + 1 === range.firstSequence
    ) {
      subscriber.pending[subscriber.pending.length - 1] = {
        ...previous,
        lastSequence: range.lastSequence,
        committedEvidenceBoundary: range.committedEvidenceBoundary
      };
      return;
    }
    subscriber.pending.push(range);
  }

  function replayFromJournal(subscriber: Subscriber, latch: ReadLatch): void {
    if (latch.retainedRange === null) {
      void finishReplay(subscriber);
      return;
    }
    if (persistenceMode === "MEMORY") {
      const memorySnapshot = volatileEvidence.map((entry) => entry.evidence);
      globalThis.setTimeout(() => {
        void readMemoryJournal(latch, {}, memorySnapshot).then((replay) => {
          if (!subscribers.has(subscriber)) return;
          if (!replayLatchIsAvailable(latch)) {
            failCooperativeReplay(subscriber, replayFailure("Replay expired because retained History advanced."));
            return;
          }
          if (replay.evidence.length !== latch.retainedCount) {
            failCooperativeReplay(subscriber, replayFailure("Retained Evidence changed before replay completed."));
            return;
          }
          if (replay.evidence.length > 0) {
            invoke(subscriber, deepFreeze({
              type: "committed-evidence" as const,
              interval: latch.interval,
              evidence: replay.evidence,
              committedEvidenceBoundary: toRef(replay.evidence.at(-1)!)
            }));
          }
          void finishReplay(subscriber);
        }, (error) => {
          failCooperativeReplay(subscriber, replayFailure(error instanceof Error ? error.message : "Evidence replay failed."));
        });
      }, 0);
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
    try {
      while (subscriber.pending.length > 0 && subscribers.has(subscriber)) {
        const publication = subscriber.pending.shift()!;
        if (publication.type === "committed-range") {
          if (publication.interval.id !== interval.id || publication.interval.ordinal !== interval.ordinal) {
            expireChangedIntervalReplay(subscriber);
            return;
          }
          const evidence = persistenceMode === "MEMORY"
            ? await readMemoryReplayChunk(
                publication.interval,
                publication.firstSequence,
                publication.lastSequence,
                publication.lastSequence - publication.firstSequence + 1,
                volatileEvidence.map((entry) => entry.evidence)
              )
            : await readCommittedRange(database, publication.interval, publication.firstSequence, publication.lastSequence);
          if (!subscribers.has(subscriber)) return;
          if (publication.interval.id !== interval.id || publication.interval.ordinal !== interval.ordinal) {
            expireChangedIntervalReplay(subscriber);
            return;
          }
          if (evidence.length !== publication.lastSequence - publication.firstSequence + 1) {
            failCooperativeReplay(subscriber, replayFailure("Live crossed range."));
            return;
          }
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
    } catch (error) {
      failCooperativeReplay(
        subscriber,
        replayFailure(error instanceof Error ? error.message : "Queued live Evidence replay failed.")
      );
    }
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

  const query: EvidenceFilterQueryAdapter["query"] = (request) => {
    if (phase === "CLOSED") return Promise.resolve(queryFailure("HISTORY_TERMINAL", "Event History is closed."));
    const resultPromise = persistenceMode === "MEMORY"
      ? queryMemoryFallback(latchForCurrentInterval(), volatileEvidence.map((entry) => entry.evidence), request)
      : queryIndexedDb(database, loaded.panelSessionId, request, {
          tier: options.capacityTier ?? "NORMAL",
          fallback: null,
          terminal: Boolean(terminal),
          projectionStore: AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections
        });
    return resultPromise.then((result) => {
      if (result.ok) {
        lastCoherentQuery = result.value;
      } else if (result.problem.code !== "QUERY_CANCELLED") {
        publish({ type: "status", status: status({ code: "QUERY_FAILED", message: result.problem.message }) });
      }
      return result;
    });
  };
  return {
    get storage(): EventHistoryStorage {
      return persistenceMode === "INDEXEDDB"
        ? Object.freeze({ mode: "indexeddb" })
        : Object.freeze({ mode: "memory", reason: persistenceFailure ?? "IndexedDB became unavailable." });
    },
    status,
    offer,
    read,
    query,
    clear,
    follow,
    close
  };
}

async function loadJournal(database: AuthoritativeEventDatabase, panelSessionId: string): Promise<LoadedJournal> {
  const transaction = database.db.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES), "readonly");
  try {
    const control = await requestToPromise<ControlRecord | undefined>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY), "loading history control");
    const durableRetentionEntries = await validateJournalRecords(
      panelSessionId,
      control,
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence),
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings),
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates)
    );
    await transactionDone(transaction, "loading Event History");
    if (database.queryProjectionMigrationRequired) {
      await ensureQueryProjections(database, control, panelSessionId);
    }
    if (!control) {
      const interval = Object.freeze({ id: `${panelSessionId}:interval-1`, ordinal: 1 });
      await writeControl(database, createControl(panelSessionId, interval, "RUNNING", null, 1, null, null, 0, 0, 0));
      return { panelSessionId, interval, phase: "RUNNING", terminal: null, nextSequence: 1, replayPayloadBytes: 0, retainedBytes: 0, durableAccountedBytes: 0, retainedCount: 0, retainedRange: null, committedEvidenceBoundary: null, durableRetentionEntries };
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
        committedEvidenceBoundary: control.committedEvidenceBoundary,
        durableRetentionEntries,
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
      committedEvidenceBoundary: control.committedEvidenceBoundary,
      durableRetentionEntries,
    };
  } catch (error) {
    try { transaction.abort(); } catch { /* the transaction may already be complete */ }
    throw error;
  }
}

async function ensureQueryProjections(database: AuthoritativeEventDatabase, control: ControlRecord | undefined, panelSessionId: string): Promise<void> {
  if (!control || control.retainedCount === 0) return;
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections], "readwrite");
  const evidence = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  const projections = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections);
  await new Promise<void>((resolve, reject) => {
    const request = projections.openCursor();
    request.onerror = () => reject(request.error ?? new Error("Query projection migration failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      const projection = cursor.value as QueryProjection;
      const searchTokens = querySearchTokens(projection.searchText);
      if (!Array.isArray(projection.searchTokens) || JSON.stringify(projection.searchTokens) !== JSON.stringify(searchTokens)) {
        projections.put({ ...projection, searchTokens });
      }
      cursor.continue();
    };
  });
  const evidenceCount = await requestToPromise<number>(evidence.count(), "checking query projection migration state");
  const projectionCount = await requestToPromise<number>(projections.count(), "checking query projection migration state");
  if (projectionCount < evidenceCount) {
    await new Promise<void>((resolve, reject) => {
      const request = evidence.openCursor();
      request.onerror = () => reject(request.error ?? new Error("Query projection migration failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const record = cursor.value as EvidenceRecord;
        const get = projections.get(record.sequence);
        get.onerror = () => reject(get.error ?? new Error("Query projection migration failed."));
        get.onsuccess = () => {
          if (get.result === undefined) projections.put(queryProjection(deserializeJournalEvidenceCandidate(record.replayPayload), record.intervalId, record.sequence));
          cursor.continue();
        };
      };
    });
  }
  await transactionDone(transaction, `migrating query projections for ${panelSessionId}`);
}

type IndexedDbQueryOptions = Readonly<{
  tier: HistoryCapacityTier;
  fallback: "PRIMARY_JOURNAL_UNAVAILABLE" | "UNKNOWN_NEWER_SCHEMA" | null;
  terminal: boolean;
  projectionStore: string;
}>;

function hybridQueryReadPoint(latch: ReadLatch): EvidenceReadPoint {
  const identity = (reference: EvidenceRef): EvidenceIdentity => Object.freeze({
    intervalId: reference.intervalId,
    pageId: latch.interval.id,
    ownerId: "memory-event-history",
    sequence: reference.sequence,
    eventId: reference.eventId
  });
  return Object.freeze({
    interval: Object.freeze({ ...latch.interval }),
    committedEvidenceBoundary: latch.committedEvidenceBoundary ? identity(latch.committedEvidenceBoundary) : null,
    retainedRange: latch.retainedRange
      ? Object.freeze({ first: identity(latch.retainedRange.first), last: identity(latch.retainedRange.last) })
      : null
  });
}

function hybridQueryTelemetry(pageSize: number): QueryTelemetryMutable {
  return {
    postingReads: 0, postingCandidates: 0, postingDriver: null, postingDriverCandidateCount: 0,
    evidenceCursorReads: 0, payloadHydrations: 0, lookupPayloadHydrations: 0,
    candidateBound: 0, pageBound: pageSize, retainedCount: 0, cursorWorkBound: 0, aroundCursorBound: 0,
    findCursorBound: 0, findCursorReads: 0, fullRetainedScan: true, shortFindFallback: false, residualScan: true,
    aroundIndexReads: 0, aroundCandidates: 0, aroundAnchorValidated: false, elapsedMs: 0,
    projectionReads: 0, projectionCoverageReads: 0, fullEvidencePayloadHydrations: 0,
    discoveryProjectionReads: 0, discoveryCandidateCount: 0, discoveryMaterializedValues: 0,
    discoveryPostingValidationReads: 0, discoveryEvidencePayloadHydrations: 0, discoveryAggregateReads: 0,
    discoveryAggregateObservationReads: 0, discoveryCompactIdentityCount: 0,
    discoveryMaterializedCandidates: 0, discoveryMaterializationBound: 0
  };
}

async function queryMemoryFallback(
  latch: ReadLatch,
  memoryEvidence: readonly CommittedEvidence[],
  request: EvidenceQueryRequest
): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
  if (!Number.isSafeInteger(request.page.size) || request.page.size < 1 || request.page.size > MAX_EVIDENCE_PAGE_SIZE) {
    return queryFailure("QUERY_FAILED", request.page.size > MAX_EVIDENCE_PAGE_SIZE ? `Page size must not exceed ${MAX_EVIDENCE_PAGE_SIZE}.` : "Page size must be a positive integer.");
  }
  if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was read.");
  const startedAt = Date.now();
  const telemetry = hybridQueryTelemetry(request.page.size);
  const currentReadPoint = hybridQueryReadPoint(latch);
  const readPoint = request.at === "LATEST_COMMITTED" ? currentReadPoint : request.at;
  if (request.at !== "LATEST_COMMITTED") {
    if (readPoint.interval.id !== latch.interval.id || readPoint.interval.ordinal !== latch.interval.ordinal) {
      return queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "The requested History Interval is unavailable.");
    }
    if (!readPointFitsCurrentInterval(readPoint, currentReadPoint)) {
      return queryFailure("READ_POINT_UNAVAILABLE", "The requested Evidence read point is unavailable.");
    }
  }

  try {
    const read = await readMemoryJournal(latch, {}, memoryEvidence);
    if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
    const boundary = readPoint.committedEvidenceBoundary?.sequence ?? 0;
    const retained = readPoint.retainedRange;
    const retainedEntries = retained === null
      ? []
      : read.evidence.filter((entry) => entry.intervalId === readPoint.interval.id
          && entry.sequence >= retained.first.sequence
          && entry.sequence <= retained.last.sequence
          && entry.sequence <= boundary);
    const evidenceEntries = retainedEntries.filter((entry) => entry.candidate.kind !== "topology-checkpoint");
    const entriesBySequence = new Map(evidenceEntries.map((entry) => [entry.sequence, entry]));
    const records: SelectionRecord[] = evidenceEntries.map((entry) => deterministicQueryRecord(entry, latch.interval));
    telemetry.retainedCount = records.length;
    telemetry.cursorWorkBound = records.length;
    telemetry.candidateBound = records.length;
    telemetry.evidenceCursorReads = records.length;
    telemetry.projectionReads = records.length;

    const around = normalizeAround(request.filter.around, readPoint.retainedRange);
    const filter = around === request.filter.around ? request.filter : { ...request.filter, around };
    if (around !== null) {
      telemetry.aroundCursorBound = records.length;
      telemetry.aroundIndexReads = records.length;
      telemetry.aroundCandidates = records.filter((record) => isInAround(record, around)).length;
    }
    if (filter.around?.anchor) {
      const anchor = records.find((record) => sameQueryIdentity(record.identity, filter.around!.anchor!));
      if (!anchor || (filter.around.anchorSequence !== undefined && filter.around.anchorSequence !== anchor.identity.sequence)) {
        return queryFailure("AROUND_ANCHOR_UNAVAILABLE", "The Around Evidence anchor is no longer retained in this History Interval.");
      }
      telemetry.aroundAnchorValidated = true;
    }

    let cursor: EvidenceQueryCursor | null;
    try {
      cursor = decodeEvidenceQueryCursor(request.page.cursor, readPoint, request);
    } catch (error) {
      return queryFailure("QUERY_FAILED", error instanceof Error ? error.message : "The page cursor is invalid.");
    }

    const discoveries = new Map<string, FacetDiscoveryResult>();
    const recordWithPayload = (record: SelectionRecord): SelectionRecord => {
      const entry = entriesBySequence.get(record.identity.sequence);
      if (!entry) return record;
      return Object.freeze({ ...record, payload: copyCandidate(entry.candidate) });
    };
    let lookupRecords = records;
    if (request.lookup !== undefined) {
      lookupRecords = records.map((record) => sameQueryIdentity(record.identity, request.lookup!) ? recordWithPayload(record) : record);
      if (lookupRecords.some((record) => sameQueryIdentity(record.identity, request.lookup!))) {
        telemetry.payloadHydrations += 1;
        telemetry.lookupPayloadHydrations += 1;
        telemetry.fullEvidencePayloadHydrations += 1;
      }
    }

    if (filter.unsupported.length > 0) {
      for (const discoveryRequest of request.discover ?? []) {
        discoveries.set(discoveryRequest.facet, {
          state: "UNAVAILABLE", facet: discoveryRequest.facet, reason: "UNSUPPORTED_AT_READ_POINT",
          values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null
        });
      }
      const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
      const find = request.find === undefined ? null : findEvidence(records, request.find);
      telemetry.findCursorBound = request.find === undefined ? 0 : records.length;
      telemetry.findCursorReads = telemetry.findCursorBound;
      telemetry.elapsedMs = Math.max(0, Date.now() - startedAt);
      return {
        ok: true,
        value: querySnapshot(readPoint, [], 0, 0, discoveries, "UNSUPPORTED_FILTER", "COMPLETE", "MEMORY_FALLBACK", null, lookup, find, telemetry)
      };
    }

    const matchesFilter = (record: SelectionRecord): boolean => evaluateFilter({ ...filter, around: null } as unknown as Filter, {
      timestamp: record.timestamp,
      intervalId: record.identity.intervalId,
      searchText: record.searchText,
      facets: record.facets as unknown as FilterRecord["facets"]
    }).matches;
    const matchingRecords = records.filter(matchesFilter);
    const inScopeRecords = matchingRecords.filter((record) => isInAround(record, around));
    const ordered = [...inScopeRecords].sort((left, right) => request.page.order === "NEWEST_FIRST"
      ? right.identity.sequence - left.identity.sequence
      : left.identity.sequence - right.identity.sequence);
    let start = 0;
    if (cursor !== null) {
      const anchor = ordered.findIndex((record) => sameQueryIdentity(record.identity, cursor!.anchor));
      if (anchor < 0) return queryFailure("QUERY_FAILED", "The page cursor anchor is stale or is not part of the filtered Evidence result.");
      start = anchor + 1;
    }
    const selected = ordered.slice(start, start + request.page.size);
    const hasMore = start + selected.length < ordered.length;
    const page = request.includePayload === true ? selected.map(recordWithPayload) : selected;
    if (request.includePayload === true) {
      telemetry.payloadHydrations += page.length;
      telemetry.fullEvidencePayloadHydrations += page.length;
    }

    for (const discoveryRequest of request.discover ?? []) {
      if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
      try {
        discoveries.set(discoveryRequest.facet, discoverFacet(records, filter, readPoint, discoveryRequest, {
          onResult: (stats) => {
            telemetry.discoveryProjectionReads += records.length;
            telemetry.discoveryCandidateCount += stats.candidateCount;
            telemetry.discoveryMaterializedValues += stats.materializedCandidates;
            telemetry.discoveryCompactIdentityCount += stats.compactIdentityCount;
            telemetry.discoveryMaterializedCandidates += stats.materializedCandidates;
            telemetry.discoveryMaterializationBound += stats.materializationBound;
          }
        }));
      } catch {
        discoveries.set(discoveryRequest.facet, {
          state: "UNAVAILABLE", facet: discoveryRequest.facet, reason: "DISCOVERY_FAILED",
          values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null
        });
      }
    }

    const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
    let find: EvidenceFindResult | null = null;
    if (request.find !== undefined) {
      const eligible = request.find.scopeToFilter
        ? (record: SelectionRecord) => matchesFilter(record) && isInAround(record, around)
        : undefined;
      find = findEvidence(records, request.find, eligible);
      telemetry.findCursorBound = records.length;
      telemetry.findCursorReads = records.length;
    }
    telemetry.elapsedMs = Math.max(0, Date.now() - startedAt);
    const nextCursor = hasMore && page.length > 0
      ? encodeEvidenceQueryCursor(readPoint, request, page.at(-1)!.identity)
      : null;
    return {
      ok: true,
      value: querySnapshot(
        readPoint,
        page,
        matchingRecords.length,
        inScopeRecords.length,
        discoveries,
        "COMPLETE",
        "COMPLETE",
        "MEMORY_FALLBACK",
        nextCursor,
        lookup,
        find,
        telemetry
      )
    };
  } catch (error) {
    if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
    return queryFailure("QUERY_FAILED", error instanceof Error ? error.message : "Memory fallback Evidence query failed.");
  }
}

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
  if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was read.");
  const started = Date.now();
  const telemetry: QueryTelemetryMutable = {
    postingReads: 0, postingCandidates: 0, postingDriver: null, postingDriverCandidateCount: 0, evidenceCursorReads: 0, payloadHydrations: 0, lookupPayloadHydrations: 0,
    candidateBound: 0, pageBound: request.page.size, retainedCount: 0, cursorWorkBound: 0, aroundCursorBound: 0,
    findCursorBound: 0, findCursorReads: 0, fullRetainedScan: false, shortFindFallback: false, residualScan: false,
    aroundIndexReads: 0, aroundCandidates: 0, aroundAnchorValidated: false, elapsedMs: 0,
    projectionReads: 0, projectionCoverageReads: 0, fullEvidencePayloadHydrations: 0,
    discoveryProjectionReads: 0, discoveryCandidateCount: 0, discoveryMaterializedValues: 0,
    discoveryPostingValidationReads: 0, discoveryEvidencePayloadHydrations: 0, discoveryAggregateReads: 0,
    discoveryAggregateObservationReads: 0,
    discoveryCompactIdentityCount: 0, discoveryMaterializedCandidates: 0, discoveryMaterializationBound: 0
  };
  const transaction = database.db.transaction([
    AUTHORITATIVE_EVENT_STORE_NAMES.historyControl,
    AUTHORITATIVE_EVENT_STORE_NAMES.evidence,
    AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings,
    AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections,
    AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates
  ], "readonly");
  request.signal?.addEventListener("abort", () => {
    try { transaction.abort(); } catch { /* the readonly transaction may already be complete */ }
  }, { once: true });
  try {
    const evidenceStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
    const control = await requestToPromise<ControlRecord | undefined>(
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY),
      "reading Evidence query control"
    );
    if (!control || control.panelSessionId !== panelSessionId) return queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "The History Interval is unavailable.");
    const interval = control.interval;
    const currentReadPoint = queryReadPoint(control);
    const readPoint = request.at === "LATEST_COMMITTED" ? currentReadPoint : request.at;
    if (request.at !== "LATEST_COMMITTED") {
      if (readPoint.interval.id !== interval.id || readPoint.interval.ordinal !== interval.ordinal) {
        return queryFailure("HISTORY_INTERVAL_UNAVAILABLE", "The requested History Interval is unavailable.");
      }
      if (!readPointFitsCurrentInterval(readPoint, currentReadPoint)) {
        return queryFailure("READ_POINT_UNAVAILABLE", "The requested Evidence read point is unavailable.");
      }
    }
    const retained = readPoint.retainedRange;
    const boundary = readPoint.committedEvidenceBoundary?.intervalId === interval.id ? readPoint.committedEvidenceBoundary.sequence : 0;
    const firstSequence = retained?.first.sequence ?? 1;
    const lastSequence = Math.min(retained?.last.sequence ?? 0, boundary);
    const currentRetained = currentReadPoint.retainedRange;
    const currentBoundary = currentReadPoint.committedEvidenceBoundary?.intervalId === interval.id
      ? currentReadPoint.committedEvidenceBoundary.sequence
      : 0;
    const currentFirstSequence = currentRetained?.first.sequence ?? 1;
    const currentLastSequence = Math.min(currentRetained?.last.sequence ?? 0, currentBoundary);
    const expectedEvidenceCount = lastSequence >= firstSequence ? lastSequence - firstSequence + 1 : 0;
    telemetry.retainedCount = expectedEvidenceCount;
    telemetry.cursorWorkBound = expectedEvidenceCount;
    let pageCursor: EvidenceQueryCursor | null;
    try {
      pageCursor = decodeEvidenceQueryCursor(request.page.cursor, readPoint, request);
    } catch (error) {
      return queryFailure("QUERY_FAILED", error instanceof Error ? error.message : "The page cursor is invalid.");
    }
    if (pageCursor !== null && (pageCursor.anchor.intervalId !== interval.id
      || pageCursor.anchor.pageId !== interval.id
      || pageCursor.anchor.ownerId !== "memory-event-history"
      || pageCursor.anchor.sequence < firstSequence
      || pageCursor.anchor.sequence > lastSequence)) {
      return queryFailure("QUERY_FAILED", "The page cursor anchor is stale or outside the latched Evidence range.");
    }
    const around = normalizeAround(request.filter.around, readPoint.retainedRange);
    const filter = around === request.filter.around ? request.filter : { ...request.filter, around };
    const emptyFilterAround = request.filter.around !== null && isEmptyQueryFilter(request.filter);
    if (request.filter.around !== null) {
      telemetry.aroundIndexReads += 1;
      telemetry.aroundCursorBound = telemetry.retainedCount;
    }
    await validateProjectionCoverage(transaction.objectStore(options.projectionStore), evidenceStore, interval.id, firstSequence, lastSequence, expectedEvidenceCount, telemetry);
    const topologyCheckpointCount = await countTopologyCheckpoints(evidenceStore, firstSequence, lastSequence, telemetry);
    const expectedProjectionCount = expectedEvidenceCount - topologyCheckpointCount;
    const postingCandidates = await indexedDbPostingCandidates(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings), request.filter, interval.id, firstSequence, lastSequence, telemetry);
    const candidateSequences = postingCandidates;
    if (pageCursor !== null && candidateSequences !== null && !candidateSequences.has(pageCursor.anchor.sequence)) {
      return queryFailure("QUERY_FAILED", "The page cursor anchor is not part of the filtered Evidence result.");
    }
    const hasCriteria = Object.values(request.filter.criteria).some((group) => Boolean(group && (group.include.length > 0 || group.exclude.length > 0)));
    const simpleRecentPage = postingCandidates === null && !hasCriteria && request.filter.text.trim() === "" && request.filter.around === null;
    const pageCursorProjection = pageCursor === null
      ? null
      : await validatePageCursorAnchor(transaction.objectStore(options.projectionStore), pageCursor.anchor, interval.id, firstSequence, lastSequence, telemetry);
    if (pageCursorProjection !== null && !matchesProjectionFilter(pageCursorProjection, interval.id, filter, around)) {
      return queryFailure("QUERY_FAILED", "The page cursor anchor is not part of the filtered Evidence result.");
    }
    let projections: QueryProjection[];
    let streamedPage: StreamedProjectionPage | null = null;
    let simplePageHasMore = false;
    if (simpleRecentPage) {
      const pageRead = await readProjectionPage(transaction.objectStore(options.projectionStore), interval.id, firstSequence, lastSequence, request.page, pageCursor?.anchor ?? null, telemetry);
      projections = [...pageRead.projections];
      simplePageHasMore = pageRead.hasMore;
      telemetry.candidateBound = projections.length;
    } else if (emptyFilterAround) {
      streamedPage = await readAroundProjectionPage(
        transaction.objectStore(options.projectionStore),
        interval.id,
        firstSequence,
        lastSequence,
        request.page,
        pageCursor?.anchor ?? null,
        around!,
        request.signal,
        telemetry
      );
      projections = [...streamedPage.projections];
      telemetry.candidateBound = streamedPage.inScope;
    } else {
      telemetry.residualScan = request.filter.text.trim() !== "";
      streamedPage = await readEvaluatedProjectionPage(
        transaction.objectStore(options.projectionStore),
        interval.id,
        firstSequence,
        lastSequence,
        candidateSequences,
        request.page,
        pageCursor?.anchor ?? null,
        filter,
        around,
        request.signal,
        telemetry
      );
      projections = [...streamedPage.projections];
      telemetry.candidateBound = candidateSequences?.size ?? expectedEvidenceCount;
      if (!candidateSequences) telemetry.fullRetainedScan = true;
    }
    if (request.filter.around !== null && streamedPage !== null) telemetry.aroundCandidates = streamedPage.inScope;
    const findResult = request.find === undefined
      ? null
      : (await readFindProjectionResult(
        transaction.objectStore(options.projectionStore),
        interval.id,
        firstSequence,
        lastSequence,
        request.find,
        request.find.scopeToFilter ? filter : null,
        around,
        interval,
        request.signal,
        telemetry
      )).result;
    const anchorProjection = request.filter.around?.anchor === undefined
      ? null
      : await readProjectionByIdentity(transaction.objectStore(options.projectionStore), request.filter.around.anchor, interval, firstSequence, lastSequence, request.filter.around.anchorSequence, telemetry);
    const selectedPayload = request.lookup === undefined
      ? null
      : await readSelectedEvidence(evidenceStore, request.lookup, interval, firstSequence, lastSequence, telemetry);
    await validateProjectionEventIdentities(evidenceStore, interval.id, [
      ...projections,
      ...(anchorProjection === null ? [] : [anchorProjection])
    ], telemetry);
    const discoveries = new Map<string, FacetDiscoveryResult>();
    const postingStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings);
    const projectionStore = transaction.objectStore(options.projectionStore);
    const aggregateStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
    for (const discovery of request.discover ?? []) {
      try {
        const discoveryFilter: EvidenceQueryRequest["filter"] = {
          ...request.filter,
          criteria: Object.fromEntries(Object.entries(request.filter.criteria).filter(([facet]) => facet !== discovery.facet))
      };
      if (canUseFacetAggregate(request.filter, discovery.facet)) {
        const aggregateCatalog = await readFacetAggregates(aggregateStore, interval.id, discovery.facet, telemetry);
        const aggregateEntries = await validateAggregateFacetPostings(postingStore, evidenceStore, discovery.facet, interval.id, currentFirstSequence, currentLastSequence, firstSequence, lastSequence, aggregateCatalog, telemetry);
        const result = discoverFacetFromAggregates(aggregateEntries, expectedProjectionCount, request.filter, readPoint, discovery, {
          onResult: (stats) => {
            telemetry.discoveryCompactIdentityCount = Math.max(telemetry.discoveryCompactIdentityCount ?? 0, stats.compactIdentityCount);
            telemetry.discoveryMaterializedCandidates = Math.max(telemetry.discoveryMaterializedCandidates ?? 0, stats.materializedCandidates);
            telemetry.discoveryMaterializationBound = Math.max(telemetry.discoveryMaterializationBound ?? 0, stats.materializationBound);
            telemetry.discoveryCandidateCount = Math.max(telemetry.discoveryCandidateCount, stats.candidateCount);
            telemetry.discoveryMaterializedValues += stats.materializedCandidates;
          }
        });
        discoveries.set(discovery.facet, result);
      } else {
        const candidates = await indexedDbPostingCandidates(postingStore, discoveryFilter, interval.id, firstSequence, lastSequence, telemetry);
        const accounting = await readDiscoveryAccounting(
          projectionStore,
          postingStore,
          interval.id,
          firstSequence,
          lastSequence,
          candidates,
          discoveryFilter,
          discovery.facet,
          request.signal,
          telemetry
        );
        discoveries.set(discovery.facet, discoverFacetFromAccounting(accounting.entries, accounting.baseEvidenceCount, request.filter, readPoint, discovery, {
          onResult: (stats) => {
            telemetry.discoveryCompactIdentityCount = Math.max(telemetry.discoveryCompactIdentityCount ?? 0, stats.compactIdentityCount);
            telemetry.discoveryMaterializedCandidates = Math.max(telemetry.discoveryMaterializedCandidates ?? 0, stats.materializedCandidates);
            telemetry.discoveryMaterializationBound = Math.max(telemetry.discoveryMaterializationBound ?? 0, stats.materializationBound);
            telemetry.discoveryCandidateCount = Math.max(telemetry.discoveryCandidateCount, stats.candidateCount);
            telemetry.discoveryMaterializedValues += stats.materializedCandidates;
          }
        }));
      }
      } catch (error) {
        if (request.signal?.aborted || (error instanceof Error && error.message === "EVIDENCE_QUERY_CANCELLED")) throw error;
        // Discovery is optional. A malformed or incomplete posting index must
        // not erase an otherwise coherent base Evidence Snapshot.
        discoveries.set(discovery.facet, { state: "UNAVAILABLE", facet: discovery.facet, reason: "DISCOVERY_FAILED", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null });
      }
    }
    const selectionRecords = projections.map((record) => querySelectionRecord(record, interval));
    if (filter.around?.anchor && anchorProjection === null) {
      return queryFailure("AROUND_ANCHOR_UNAVAILABLE", "The Around Evidence anchor is no longer retained in this History Interval.");
    }
    telemetry.aroundAnchorValidated = filter.around?.anchor !== undefined;
    if (filter.unsupported.length > 0) {
      for (const discovery of request.discover ?? []) discoveries.set(discovery.facet, { state: "UNAVAILABLE", facet: discovery.facet, reason: "UNSUPPORTED_AT_READ_POINT", values: [], distinctTotal: null, nextCursor: null, baseEvidenceCount: null });
    }
    const lookupRecord = selectedPayload ? queryProjectionFromPayload(selectedPayload, interval) : null;
    const lookupRecordsWithPayload = lookupRecord
      ? [...selectionRecords.filter((record) => !sameQueryIdentity(record.identity, lookupRecord.identity)), Object.freeze({ ...lookupRecord, payload: copyCandidate(deserializeJournalEvidenceCandidate(selectedPayload!.replayPayload)) })]
      : selectionRecords;
    if (filter.unsupported.length > 0) {
      const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecordsWithPayload, readPoint, request.lookup, filter, around);
      await transactionDone(transaction, "querying Evidence");
      if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
      telemetry.elapsedMs = Date.now() - started;
      return { ok: true, value: querySnapshot(readPoint, [], 0, 0, discoveries, "UNSUPPORTED_FILTER", queryCoverage(options), queryStorage(options), null, lookup, findResult, telemetry) };
    }
    const page = selectionRecords;
    const payloadPage = request.includePayload === true
      ? await hydrateQueryPage(evidenceStore, page, interval, telemetry)
      : page;
    await transactionDone(transaction, "querying Evidence");
    const lookupRecords = lookupRecordsWithPayload;
    const lookup = request.lookup === undefined ? null : lookupEvidence(lookupRecords, readPoint, request.lookup, filter, around);
    telemetry.elapsedMs = Date.now() - started;
    if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
    const matchingTotal = simpleRecentPage || emptyFilterAround
      ? expectedProjectionCount
      : streamedPage?.matching ?? 0;
    const inScopeTotal = simpleRecentPage
      ? expectedProjectionCount
      : streamedPage?.inScope ?? 0;
    const hasMore = simpleRecentPage
      ? simplePageHasMore
      : streamedPage?.hasMore ?? false;
    const nextCursor = hasMore
      ? encodeEvidenceQueryCursor(readPoint, request, page.at(-1)!.identity)
      : null;
    return { ok: true, value: querySnapshot(readPoint, payloadPage, matchingTotal, inScopeTotal, discoveries, "COMPLETE", queryCoverage(options), queryStorage(options), nextCursor, lookup, findResult, telemetry) };
  } catch (error) {
    try { transaction.abort(); } catch { /* already completed */ }
    if (request.signal?.aborted) return queryFailure("QUERY_CANCELLED", "The Evidence query was cancelled before its snapshot was published.");
    return queryFailure("QUERY_FAILED", error instanceof Error ? error.message : "IndexedDB Evidence query failed.");
  }
}

type QueryTelemetryMutable = {
  postingReads: number; postingCandidates: number; postingDriver: string | null; postingDriverCandidateCount: number; evidenceCursorReads: number; payloadHydrations: number; lookupPayloadHydrations: number;
  candidateBound: number; pageBound: number; retainedCount: number; cursorWorkBound: number; aroundCursorBound: number;
  findCursorBound: number; findCursorReads: number; fullRetainedScan: boolean; shortFindFallback: boolean; residualScan: boolean;
  aroundIndexReads: number; aroundCandidates: number; aroundAnchorValidated: boolean; elapsedMs: number;
  projectionReads: number; projectionCoverageReads: number; fullEvidencePayloadHydrations: number;
  discoveryProjectionReads: number; discoveryCandidateCount: number; discoveryMaterializedValues: number;
  discoveryPostingValidationReads: number; discoveryEvidencePayloadHydrations: number; discoveryAggregateReads: number; discoveryAggregateObservationReads: number;
  discoveryCompactIdentityCount: number; discoveryMaterializedCandidates: number; discoveryMaterializationBound: number;
};

function recordProjectionCursorRead(telemetry: QueryTelemetryMutable, local: { reads: number; bound: number }, operation = "projection"): void {
  local.reads += 1;
  if (local.reads > local.bound) throw new Error(`Indexed ${operation} cursor exceeded the latched retained-count work bound (${local.reads}/${local.bound}).`);
  telemetry.evidenceCursorReads += 1;
  telemetry.projectionReads += 1;
}

/**
 * Validates only cardinality/range coverage. Replay payloads stay out of the
 * normal query path; selected projections are structurally validated when
 * they are actually read, and authoritative startup validation remains the
 * fail-closed payload/index reconciliation boundary.
 */
async function validateProjectionCoverage(store: IDBObjectStore, evidence: IDBObjectStore, _intervalId: string, first: number, last: number, expected: number, telemetry: QueryTelemetryMutable): Promise<void> {
  const range = last < first ? undefined : queryBoundRange(first, last);
  const [total, evidenceTotal, rangeTotal, rangeEvidenceTotal] = await Promise.all([
    requestToPromise<number>(store.count(), "validating query projection coverage"),
    requestToPromise<number>(evidence.count(), "validating query projection coverage"),
    last < first ? Promise.resolve(0) : requestToPromise<number>(store.count(range), "validating query projection range coverage"),
    last < first ? Promise.resolve(0) : requestToPromise<number>(evidence.count(range), "validating Evidence range coverage")
  ]);
  telemetry.projectionCoverageReads = (telemetry.projectionCoverageReads ?? 0) + 4;
  if (total !== evidenceTotal || rangeTotal !== expected || rangeEvidenceTotal !== expected || rangeTotal !== rangeEvidenceTotal) {
    throw new Error("The query projection store does not exactly cover Evidence records.");
  }
}

function countTopologyCheckpoints(evidence: IDBObjectStore, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<number> {
  if (last < first) return Promise.resolve(0);
  const result = queryOnlyRange(facet("kind", "topology-checkpoint"));
  let count = 0;
  return new Promise((resolve, reject) => {
    // A key cursor keeps replayPayload out of the query heap while still
    // counting checkpoint identities inside the latched sequence range.
    const request = evidence.index("facets").openKeyCursor(result);
    request.onerror = () => reject(request.error ?? new Error("Evidence checkpoint count failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(count); return; }
      telemetry.projectionCoverageReads = (telemetry.projectionCoverageReads ?? 0) + 1;
      const sequence = Number(cursor.primaryKey);
      if (sequence >= first && sequence <= last) count += 1;
      cursor.continue();
    };
  });
}

/** Cross-checks only the immutable Evidence identity index; replay payloads
 * remain unopened on ordinary page, filter, and discovery reads. */
async function validateProjectionEventIdentities(
  evidence: IDBObjectStore,
  intervalId: string,
  projections: readonly QueryProjection[],
  telemetry: QueryTelemetryMutable
): Promise<void> {
  const unique = new Map<number, QueryProjection>();
  for (const projection of projections) {
    if (projection.intervalId === intervalId) unique.set(projection.sequence, projection);
  }
  await Promise.all([...unique.values()].map(async (projection) => {
    telemetry.projectionCoverageReads = (telemetry.projectionCoverageReads ?? 0) + 1;
    const sequence = await requestToPromise<IDBValidKey | undefined>(
      evidence.index("eventIdentity").getKey(projection.eventId),
      "validating query projection identity"
    );
    if (sequence !== projection.sequence) throw new Error("The query projection does not match its Evidence identity.");
  }));
}

function isEmptyQueryFilter(filter: EvidenceQueryRequest["filter"]): boolean {
  return filter.text.trim() === "" && filter.unsupported.length === 0
    && Object.values(filter.criteria).every((group) => !group || (group.include.length === 0 && group.exclude.length === 0));
}

function canUseFacetAggregate(filter: EvidenceQueryRequest["filter"], facet: string): boolean {
  if (filter.text.trim() !== "" || filter.around !== null || filter.unsupported.length > 0) return false;
  return Object.entries(filter.criteria).every(([key, group]) => {
    if (key === facet || !group) return true;
    return group.include.length === 0 && group.exclude.length === 0;
  });
}

/** Reads identity metadata only; the facet posting cursor supplies exact counts
 * and ordered event observations for the current committed interval. */
function readFacetAggregates(
  store: IDBObjectStore,
  intervalId: string,
  facet: string,
  telemetry: QueryTelemetryMutable
): Promise<DiscoveryAggregateEntry[]> {
  const result: DiscoveryAggregateEntry[] = [];
  const range = queryBoundRange([intervalId, facet], [intervalId, facet]);
  return new Promise((resolve, reject) => {
    const request = store.index("intervalFacet").openCursor(range);
    request.onerror = () => reject(request.error ?? new Error("Facet discovery aggregate read failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(result);
        return;
      }
      try {
        telemetry.discoveryAggregateReads += 1;
        const aggregate = cursor.value as AuthoritativeFacetAggregateRecord;
        assertExactKeys(aggregate, ["facet", "facetIdentity", "intervalId", "label", "type", "value"]);
        const identityParts = facetIdentityParts(aggregate.facetIdentity);
        if (aggregate.intervalId !== intervalId || aggregate.facet !== facet || typeof aggregate.facetIdentity !== "string"
          || typeof aggregate.type !== "string" || typeof aggregate.value !== "string" || typeof aggregate.label !== "string"
          || identityParts === null || identityParts.facet !== aggregate.facet || identityParts.type !== aggregate.type || identityParts.value !== aggregate.value) {
          throw new Error("The facet discovery aggregate is corrupt.");
        }
        result.push({ value: { facet: aggregate.facet, type: aggregate.type, value: aggregate.value, label: aggregate.label, identity: aggregate.facetIdentity }, count: 0 });
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * Reconciles the compact aggregate catalog with exact versioned posting
 * observations without opening the Evidence payload store. Both sides are
 * checked in the same readonly query transaction, so a partial or forged
 * derived view can only produce an unavailable discovery.
 */
function validateAggregateFacetPostings(
  store: IDBObjectStore,
  evidence: IDBObjectStore,
  facet: string,
  intervalId: string,
  currentFirst: number,
  currentLast: number,
  requestedFirst: number,
  requestedLast: number,
  entries: readonly DiscoveryAggregateEntry[],
  telemetry: QueryTelemetryMutable
): Promise<DiscoveryAggregateEntry[]> {
  const expected = new Map<string, { entry: DiscoveryAggregateEntry; currentCount: number; requestedCount: number; lastSequence: number; foreignInterval: boolean }>();
  for (const entry of entries) {
    if (expected.has(entry.value.identity)) throw new Error("The facet discovery aggregate catalog is corrupt.");
    expected.set(entry.value.identity, { entry, currentCount: 0, requestedCount: 0, lastSequence: 0, foreignInterval: false });
  }
  return new Promise((resolve, reject) => {
    const request = store.index("facet").openCursor(queryOnlyRange(facet));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB facet posting reconciliation failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        try {
          const result: DiscoveryAggregateEntry[] = [];
          for (const state of expected.values()) {
            if (state.currentCount === 0) {
              // A posting from another History Interval is not evidence of a
              // current corruption. Preserve the compact catalog entry in
              // this compatibility case; same-interval omissions remain
              // fail-closed below.
              if (state.foreignInterval && requestedFirst <= requestedLast) result.push({ ...state.entry, count: 1 });
              else throw new Error("The facet discovery aggregate has no matching posting.");
            } else if (state.requestedCount > 0) {
              result.push({ ...state.entry, count: state.requestedCount });
            }
          }
          resolve(result);
        } catch (error) {
          reject(error);
        }
        return;
      }
      try {
        const posting = cursor.value as FacetPostingRecord;
        telemetry.discoveryPostingValidationReads += 1;
        if (posting.intervalId !== intervalId) {
          const foreign = expected.get(typeof posting.facetIdentity === "string" ? posting.facetIdentity : "");
          if (foreign) foreign.foreignInterval = true;
          cursor.continue();
          return;
        }
        assertExactKeys(posting, ["eventId", "facet", "facetIdentity", "intervalId", "sequence", "token"]);
        if (posting.facet !== facet || typeof posting.eventId !== "string" || posting.eventId.length === 0
          || typeof posting.facetIdentity !== "string" || facetFromIdentity(posting.facetIdentity) !== facet
          || posting.token !== facetPostingToken(posting.facetIdentity)
          || !Number.isSafeInteger(posting.sequence) || posting.sequence < currentFirst || posting.sequence > currentLast) {
          throw new Error("A facet discovery posting is corrupt or outside the requested Evidence range.");
        }
        const identity = evidence.index("eventIdentity").getKey(posting.eventId);
        identity.onerror = () => reject(identity.error ?? new Error("IndexedDB Evidence identity validation failed."));
        identity.onsuccess = () => {
          if (identity.result !== posting.sequence) {
            reject(new Error("A facet discovery posting does not match its authoritative Evidence identity."));
            return;
          }
          telemetry.discoveryAggregateObservationReads += 1;
          const aggregate = expected.get(posting.facetIdentity);
          if (!aggregate || posting.sequence <= aggregate.lastSequence) {
            reject(new Error("The facet discovery postings do not match the aggregate catalog."));
            return;
          }
          aggregate.currentCount += 1;
          if (posting.sequence >= requestedFirst && posting.sequence <= requestedLast) aggregate.requestedCount += 1;
          aggregate.lastSequence = posting.sequence;
          cursor.continue();
        };
      } catch (error) {
        reject(error);
      }
    };
  });
}

function querySelectionRecord(projection: QueryProjection, interval: HistoryInterval): SelectionRecord {
  validateQueryProjection(projection, interval.id, projection.sequence);
  return Object.freeze({ identity: Object.freeze({ intervalId: projection.intervalId, pageId: interval.id, ownerId: "memory-event-history", sequence: projection.sequence, eventId: projection.eventId }), timestamp: projection.timestamp, summary: projection.summary, searchText: projection.searchText, facets: Object.freeze(projection.facets) as SelectionRecord["facets"] });
}

function isTopologyCheckpointProjection(projection: QueryProjection): boolean {
  return projection.summary === "Topology checkpoint";
}

function findRecordsWithinFilter(
  records: readonly SelectionRecord[],
  filter: EvidenceQueryRequest["filter"],
  around: EvidenceQueryRequest["filter"]["around"]
): SelectionRecord[] {
  return records.filter((record) => {
    const evaluation = evaluateFilter({ ...filter, around: null } as unknown as Filter, {
      timestamp: record.timestamp,
      intervalId: record.identity.intervalId,
      searchText: record.searchText,
      facets: record.facets as unknown as FilterRecord["facets"]
    });
    return evaluation.matches && isInAround(record, around);
  });
}

function validateQueryProjection(projection: QueryProjection, intervalId: string, expectedSequence?: number): void {
  assertExactKeys(projection, ["eventId", "facets", "intervalId", "searchText", "searchTokens", "sequence", "summary", "timestamp"]);
  if (projection.intervalId !== intervalId || typeof projection.eventId !== "string" || projection.eventId.length === 0
    || !Number.isSafeInteger(projection.sequence) || projection.sequence < 1 || (expectedSequence !== undefined && projection.sequence !== expectedSequence) || !Number.isFinite(projection.timestamp)
    || typeof projection.summary !== "string" || typeof projection.searchText !== "string" || !Array.isArray(projection.searchTokens)
    || projection.searchTokens.some((token) => typeof token !== "string" || token.length === 0)
    || projection.facets === null || typeof projection.facets !== "object" || Array.isArray(projection.facets)
    || Object.entries(projection.facets).some(([key, value]) => key.length === 0 || !isValidProjectionValue(value))) {
    throw new Error("The query projection is missing or corrupt.");
  }
}

function isValidProjectionValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isValidProjectionValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isValidProjectionValue);
}

async function indexedDbPostingCandidates(store: IDBObjectStore, filter: EvidenceQueryRequest["filter"], intervalId: string, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<Set<number> | null> {
  const groups = Object.entries(filter.criteria).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]));
  if (groups.length === 0) return null;
  // Structural Scope and the legacy scalar bridge intentionally use labels or
  // raw item identities. They have no exact posting token; returning null
  // preserves the storage-neutral residual evaluator instead of turning a
  // valid criterion into an empty posting intersection.
  for (const [facet, group] of groups) {
    if (!group) continue;
    if ([...group.include, ...group.exclude].some((value) => !canUseFacetPosting(facet, value))) return null;
  }
  const drivers = groups.filter(([, group]) => group.include.length > 0);
  if (drivers.length === 0) return null;

  // A compound filter needs only one posting-derived candidate set. Choose
  // the smallest include-union as the driver; every other Include/Exclude and
  // free-text condition is evaluated against its compact projection metadata.
  // This avoids retaining one complete retained-sequence set per facet.
  let driver: [string, NonNullable<typeof groups[number][1]>] | null = null;
  let driverEstimate = Number.POSITIVE_INFINITY;
  for (const [facet, group] of drivers) {
    let estimate = 0;
    for (const value of group.include) {
      telemetry.postingReads += 1;
      estimate += await countPostingToken(store, facetPostingToken(value.identity), intervalId, first, last);
    }
    if (estimate < driverEstimate || (estimate === driverEstimate && (driver?.[0] ?? "").localeCompare(facet) > 0)) {
      driver = [facet, group];
      driverEstimate = estimate;
    }
  }
  if (driver === null) return null;
  telemetry.postingDriver = driver[0];
  const candidates = new Set<number>();
  for (const value of driver[1].include) {
    telemetry.postingReads += 1;
    const postings = await readPostingToken(store, facetPostingToken(value.identity), intervalId, first, last, telemetry);
    for (const sequence of postings.keys()) candidates.add(sequence);
  }
  telemetry.postingDriverCandidateCount = candidates.size;
  return candidates;
}

function countPostingToken(store: IDBObjectStore, token: string, intervalId: string, first: number, last: number): Promise<number> {
  if (last < first) return Promise.resolve(0);
  let count = 0;
  return new Promise((resolve, reject) => {
    const request = store.index("token").openCursor(queryOnlyRange(token));
    request.onerror = () => reject(request.error ?? new Error("Facet posting count failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(count); return; }
      const posting = cursor.value as FacetPostingRecord;
      if (posting.intervalId === intervalId && posting.sequence >= first && posting.sequence <= last) count += 1;
      cursor.continue();
    };
  });
}

function canUseFacetPosting(facet: string, value: TypedFacetValue): boolean {
  if (value.type === "structural-none") return true;
  if (value.type.startsWith("structural-")) return false;
  return !(value.type === "string" && ["client", "session", "subscription", "item", "listener", "kind"].includes(facet));
}

function readPostingToken(store: IDBObjectStore, token: string, intervalId: string, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (last < first) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const request = store.index("token").openCursor(queryOnlyRange(token));
    request.onerror = () => reject(request.error ?? new Error("Facet posting read failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      const posting = cursor.value as FacetPostingRecord;
      assertExactKeys(posting, ["eventId", "facet", "facetIdentity", "intervalId", "sequence", "token"]);
      if (posting.intervalId !== intervalId) {
        cursor.continue();
        return;
      }
      if (typeof posting.eventId !== "string" || posting.eventId.length === 0
        || typeof posting.facet !== "string" || typeof posting.facetIdentity !== "string"
        || facetFromIdentity(posting.facetIdentity) !== posting.facet
        || posting.token !== facetPostingToken(posting.facetIdentity)
        || !Number.isSafeInteger(posting.sequence) || posting.sequence < 1
        || posting.sequence < first || posting.sequence > last) {
        reject(new Error("A facet posting is corrupt or outside the requested Evidence range."));
        return;
      }
      if (posting.intervalId === intervalId && posting.sequence >= first && posting.sequence <= last) {
        result.set(posting.sequence, posting.eventId);
        telemetry.postingCandidates += 1;
      }
      cursor.continue();
    };
  });
}

type DiscoveryAccountingScan = Readonly<{
  entries: readonly DiscoveryAccountingEntry[];
  baseEvidenceCount: number;
}>;

/** Streams discovery projections into compact value counters. At most one
 * projection and one posting validation record are live per step; the
 * retained sequence set is never copied into a discovery-side array. */
async function readDiscoveryAccounting(
  projectionStore: IDBObjectStore,
  postingStore: IDBObjectStore,
  intervalId: string,
  first: number,
  last: number,
  candidates: Set<number> | null,
  filter: EvidenceQueryRequest["filter"],
  facet: string,
  signal: AbortSignal | undefined,
  telemetry: QueryTelemetryMutable
): Promise<DiscoveryAccountingScan> {
  const accounting = new Map<string, { value: TypedFacetValue; count: number }>();
  let baseEvidenceCount = 0;
  const consume = async (projection: QueryProjection): Promise<void> => {
    if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
    validateQueryProjection(projection, intervalId, projection.sequence);
    if (isTopologyCheckpointProjection(projection) || projection.intervalId !== intervalId) return;
    const evaluation = evaluateFilter({ ...filter, around: null } as unknown as Filter, {
      timestamp: projection.timestamp,
      intervalId: projection.intervalId,
      searchText: projection.searchText,
      facets: projection.facets as unknown as FilterRecord["facets"]
    });
    if (!evaluation.matches || !isInAround({ identity: identityOfProjection(projection, intervalId), timestamp: projection.timestamp }, filter.around)) return;
    baseEvidenceCount += 1;
    const candidate = projection.facets[facet] as Partial<TypedFacetValue> | undefined;
    if (!candidate || typeof candidate !== "object" || typeof candidate.identity !== "string" || typeof candidate.facet !== "string"
      || typeof candidate.type !== "string" || typeof candidate.value !== "string" || typeof candidate.label !== "string") return;
    if (candidate.facet !== facet) throw new Error("The query projection facet identity is corrupt.");
    const token = facetPostingToken(candidate.identity);
    const posting = await requestToPromise<FacetPostingRecord | undefined>(postingStore.get([token, projection.sequence]), "validating discovery facet posting");
    telemetry.discoveryPostingValidationReads += 1;
    if (!posting) throw new Error("Facet discovery postings are incomplete or corrupt.");
    assertExactKeys(posting, ["eventId", "facet", "facetIdentity", "intervalId", "sequence", "token"]);
    if (posting.intervalId !== intervalId || posting.facet !== facet || posting.facetIdentity !== candidate.identity
      || posting.token !== token || posting.sequence !== projection.sequence || posting.eventId !== projection.eventId) {
      throw new Error("Facet discovery postings are incomplete or corrupt.");
    }
    telemetry.discoveryAggregateObservationReads += 1;
    const value = candidate as TypedFacetValue;
    const existing = accounting.get(value.identity);
    if (existing) existing.count += 1;
    else accounting.set(value.identity, { value, count: 1 });
  };

  if (last < first) return { entries: [], baseEvidenceCount: 0 };
  if (candidates !== null) {
    const sequences = [...candidates].filter((sequence) => sequence >= first && sequence <= last).sort((left, right) => left - right);
    telemetry.discoveryCandidateCount += sequences.length;
    for (const sequence of sequences) {
      if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
      telemetry.discoveryProjectionReads += 1;
      const projection = await requestToPromise<QueryProjection | undefined>(projectionStore.get(sequence), "reading discovery query projection");
      if (!projection) throw new Error("The discovery query projection is missing.");
      await consume(projection);
    }
  } else {
    telemetry.fullRetainedScan = true;
    telemetry.discoveryCandidateCount += Math.max(0, last - first + 1);
    const range = queryBoundRange(first, last);
    await new Promise<void>((resolve, reject) => {
      const request = projectionStore.openCursor(range);
      const state = { reads: 0, bound: telemetry.cursorWorkBound };
      request.onerror = () => reject(request.error ?? new Error("Discovery projection cursor failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        void (async () => {
          recordProjectionCursorRead(telemetry, state, "discovery");
          telemetry.discoveryProjectionReads += 1;
          await consume(cursor.value as QueryProjection);
          cursor.continue();
        })().catch(reject);
      };
    });
  }
  return { entries: [...accounting.values()], baseEvidenceCount };
}

function identityOfProjection(projection: QueryProjection, intervalId: string): EvidenceIdentity {
  return { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence: projection.sequence, eventId: projection.eventId };
}

async function validateDiscoveryFacetPostings(store: IDBObjectStore, facet: string, intervalId: string, first: number, last: number, projections: readonly QueryProjection[], telemetry: QueryTelemetryMutable, cache: Map<string, Map<number, string>>): Promise<void> {
  const valuesByToken = new Map<string, Map<number, string>>();
  for (const projection of projections) {
    const value = projection.facets[facet] as { identity?: unknown } | undefined;
    if (!value || typeof value.identity !== "string") continue;
    const token = facetPostingToken(value.identity);
    let postings = valuesByToken.get(token) ?? cache.get(`${intervalId}:${token}`);
    if (!postings) {
      telemetry.discoveryPostingValidationReads += 1;
      postings = await readPostingToken(store, token, intervalId, first, last, telemetry);
      cache.set(`${intervalId}:${token}`, postings);
    }
    valuesByToken.set(token, postings);
    if (postings.get(projection.sequence) !== projection.eventId) throw new Error("Facet discovery postings are incomplete or corrupt.");
  }
}

type ProjectionPageRead = Readonly<{ projections: readonly QueryProjection[]; hasMore: boolean }>;

function readProjectionPage(store: IDBObjectStore, intervalId: string, first: number, last: number, page: EvidenceQueryRequest["page"], anchor: EvidenceIdentity | null, telemetry: QueryTelemetryMutable): Promise<ProjectionPageRead> {
  const result: QueryProjection[] = [];
  if (last < first) return Promise.resolve({ projections: Object.freeze(result), hasMore: false });
  let hasMore = false;
  return new Promise((resolve, reject) => {
    const direction = page.order === "NEWEST_FIRST" ? "prev" : "next";
    const range = anchor === null
      ? queryBoundRange(first, last)
      : page.order === "NEWEST_FIRST"
        ? queryOpenUpperBoundRange(first, Math.min(last, anchor.sequence))
        : queryOpenLowerBoundRange(Math.max(first, anchor.sequence), last);
    const request = store.openCursor(range, direction);
    request.onerror = () => reject(request.error ?? new Error("Evidence page cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve({ projections: Object.freeze(result), hasMore }); return; }
      const sequence = Number(cursor.key);
      if (sequence < first || sequence > last) { resolve({ projections: Object.freeze(result), hasMore }); return; }
      const probingForMore = result.length >= page.size;
      try { if (!probingForMore) recordProjectionCursorRead(telemetry, state, "page"); } catch (error) { reject(error); return; }
      const projection = cursor.value as QueryProjection;
      validateQueryProjection(projection, intervalId, sequence);
      if (isTopologyCheckpointProjection(projection)) { cursor.continue(); return; }
      if (projection.intervalId === intervalId) {
        result.push(projection);
        if (result.length > page.size) {
          hasMore = true;
          resolve({ projections: Object.freeze(result.slice(0, page.size)), hasMore });
          return;
        }
      }
      cursor.continue();
    };
    const state = { reads: 0, bound: telemetry.cursorWorkBound };
  });
}

async function validatePageCursorAnchor(
  store: IDBObjectStore,
  anchor: EvidenceIdentity,
  intervalId: string,
  first: number,
  last: number,
  telemetry: QueryTelemetryMutable
): Promise<QueryProjection> {
  telemetry.evidenceCursorReads += 1;
  telemetry.projectionReads += 1;
  const projection = await requestToPromise<QueryProjection | undefined>(store.get(anchor.sequence), "validating page cursor anchor");
  if (!projection || isTopologyCheckpointProjection(projection) || projection.intervalId !== intervalId || projection.eventId !== anchor.eventId
    || projection.sequence < first || projection.sequence > last) {
    throw new Error("The page cursor anchor is stale or no longer retained.");
  }
  validateQueryProjection(projection, intervalId, anchor.sequence);
  return projection;
}

function matchesProjectionFilter(
  projection: QueryProjection,
  intervalId: string,
  filter: EvidenceQueryRequest["filter"],
  around: EvidenceQueryRequest["filter"]["around"]
): boolean {
  if (isTopologyCheckpointProjection(projection) || projection.intervalId !== intervalId) return false;
  const evaluation = evaluateFilter({ ...filter, around: null } as unknown as Filter, {
    timestamp: projection.timestamp,
    intervalId: projection.intervalId,
    searchText: projection.searchText,
    facets: projection.facets as unknown as FilterRecord["facets"]
  });
  return evaluation.matches && isInAround({ identity: identityOfProjection(projection, intervalId), timestamp: projection.timestamp }, around);
}

function readQueryProjections(store: IDBObjectStore, intervalId: string, first: number, last: number, candidates: Set<number> | null, telemetry: QueryTelemetryMutable): Promise<QueryProjection[]> {
  const result: QueryProjection[] = [];
  if (last < first) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const range = queryBoundRange(first, last);
    if (range === undefined) telemetry.fullRetainedScan = true;
    const request = store.openCursor(range);
    const state = { reads: 0, bound: telemetry.cursorWorkBound };
    request.onerror = () => reject(request.error ?? new Error("Evidence projection cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      const sequence = Number(cursor.key);
      if (sequence < first || sequence > last) { resolve(result); return; }
      try { recordProjectionCursorRead(telemetry, state, "range"); } catch (error) { reject(error); return; }
      const projection = cursor.value as QueryProjection;
      validateQueryProjection(projection, intervalId, sequence);
      if (!isTopologyCheckpointProjection(projection) && projection.intervalId === intervalId && (candidates === null || candidates.has(projection.sequence))) result.push(projection);
      cursor.continue();
    };
  });
}

function readCandidateProjections(store: IDBObjectStore, candidates: Set<number>, intervalId: string, telemetry: QueryTelemetryMutable): Promise<QueryProjection[]> {
  if (candidates.size > telemetry.cursorWorkBound) throw new Error("Indexed query candidate work exceeded the latched retained-count bound.");
  return Promise.all([...candidates].map((sequence) => requestToPromise<QueryProjection | undefined>(store.get(sequence), "reading indexed query projection").then((projection) => {
    telemetry.evidenceCursorReads += 1;
    telemetry.projectionReads += 1;
    if (projection) validateQueryProjection(projection, intervalId, sequence);
    return projection;
  }))).then((values) => values.filter((projection): projection is QueryProjection => projection !== undefined && !isTopologyCheckpointProjection(projection)).sort((left, right) => left.sequence - right.sequence));
}

type StreamedProjectionPage = Readonly<{
  projections: readonly QueryProjection[];
  matching: number;
  inScope: number;
  hasMore: boolean;
}>;

/**
 * Evaluates compact projections in requested key order. The driver set is
 * retained once (or not at all for a residual scan); page payloads are kept
 * separately and never force the complete candidate projection collection
 * into heap. Exact totals are counters advanced while the stream runs.
 */
function readEvaluatedProjectionPage(
  store: IDBObjectStore,
  intervalId: string,
  first: number,
  last: number,
  candidates: Set<number> | null,
  page: EvidenceQueryRequest["page"],
  anchor: EvidenceIdentity | null,
  filter: EvidenceQueryRequest["filter"],
  around: EvidenceQueryRequest["filter"]["around"],
  signal: AbortSignal | undefined,
  telemetry: QueryTelemetryMutable
): Promise<StreamedProjectionPage> {
  const result: QueryProjection[] = [];
  let matching = 0;
  let inScope = 0;
  let hasMore = false;
  const isAfterAnchor = (sequence: number): boolean => anchor === null || (page.order === "NEWEST_FIRST" ? sequence < anchor.sequence : sequence > anchor.sequence);
  const consume = (projection: QueryProjection): void => {
    if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
    if (isTopologyCheckpointProjection(projection) || projection.intervalId !== intervalId) return;
    const evaluation = evaluateFilter({ ...filter, around: null } as unknown as Filter, {
      timestamp: projection.timestamp,
      intervalId: projection.intervalId,
      searchText: projection.searchText,
      facets: projection.facets as unknown as FilterRecord["facets"]
    });
    if (!evaluation.matches) return;
    matching += 1;
    if (!isInAround({
      identity: { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence: projection.sequence, eventId: projection.eventId },
      timestamp: projection.timestamp
    }, around)) return;
    inScope += 1;
    if (isAfterAnchor(projection.sequence)) {
      if (result.length < page.size) result.push(projection);
      else hasMore = true;
    }
  };
  if (last < first) return Promise.resolve({ projections: Object.freeze(result), matching, inScope, hasMore });
  if (candidates !== null) {
    const sequences = [...candidates].filter((sequence) => sequence >= first && sequence <= last).sort((left, right) => page.order === "NEWEST_FIRST" ? right - left : left - right);
    const state = { reads: 0, bound: sequences.length };
    return (async () => {
      for (const sequence of sequences) {
        recordProjectionCursorRead(telemetry, state, "candidate");
        const projection = await requestToPromise<QueryProjection | undefined>(store.get(sequence), "reading candidate query projection");
        if (projection === undefined) throw new Error("The indexed query candidate projection is missing.");
        validateQueryProjection(projection, intervalId, sequence);
        consume(projection);
      }
      return { projections: Object.freeze(result), matching, inScope, hasMore };
    })();
  }
  telemetry.fullRetainedScan = true;
  const range = anchor === null
    ? queryBoundRange(first, last)
    : page.order === "NEWEST_FIRST"
      ? queryOpenUpperBoundRange(first, Math.min(last, anchor.sequence))
      : queryOpenLowerBoundRange(Math.max(first, anchor.sequence), last);
  const state = { reads: 0, bound: telemetry.cursorWorkBound };
  return new Promise((resolve, reject) => {
    const request = store.openCursor(range, page.order === "NEWEST_FIRST" ? "prev" : "next");
    request.onerror = () => reject(request.error ?? new Error("Indexed residual projection scan failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve({ projections: Object.freeze(result), matching, inScope, hasMore }); return; }
      try {
        recordProjectionCursorRead(telemetry, state, "residual");
        const projection = cursor.value as QueryProjection;
        validateQueryProjection(projection, intervalId, Number(cursor.key));
        consume(projection);
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * The empty Around filter can use the timestamp index without materializing
 * every timestamp hit. A small sorted page buffer preserves sequence order
 * even though the index is timestamp-ordered; exact totals are counters.
 */
function readAroundProjectionPage(
  store: IDBObjectStore,
  intervalId: string,
  first: number,
  last: number,
  page: EvidenceQueryRequest["page"],
  anchor: EvidenceIdentity | null,
  around: NonNullable<EvidenceQueryRequest["filter"]["around"]>,
  signal: AbortSignal | undefined,
  telemetry: QueryTelemetryMutable
): Promise<StreamedProjectionPage> {
  const result: QueryProjection[] = [];
  let inScope = 0;
  let pageCandidates = 0;
  const isAfterAnchor = (sequence: number): boolean => anchor === null || (page.order === "NEWEST_FIRST" ? sequence < anchor.sequence : sequence > anchor.sequence);
  const insert = (projection: QueryProjection): void => {
    if (!isAfterAnchor(projection.sequence)) return;
    pageCandidates += 1;
    result.push(projection);
    result.sort((left, right) => page.order === "NEWEST_FIRST"
      ? right.sequence - left.sequence
      : left.sequence - right.sequence);
    if (result.length > page.size) result.pop();
  };
  const range = queryOpenUpperBoundRange(around.start, around.end);
  const state = { reads: 0, bound: telemetry.cursorWorkBound };
  return new Promise((resolve, reject) => {
    const request = store.index("timestamp").openCursor(range);
    request.onerror = () => reject(request.error ?? new Error("Indexed Around projection cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ projections: Object.freeze(result), matching: inScope, inScope, hasMore: pageCandidates > page.size });
        return;
      }
      try {
        if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
        recordProjectionCursorRead(telemetry, state, "Around");
        const projection = cursor.value as QueryProjection;
        validateQueryProjection(projection, intervalId, Number(cursor.primaryKey));
        if (!isTopologyCheckpointProjection(projection) && projection.intervalId === intervalId && projection.intervalId === around.intervalId
          && projection.sequence >= first && projection.sequence <= last
          && projection.timestamp >= around.start && projection.timestamp < around.end) {
          inScope += 1;
          insert(projection);
          if (inScope >= telemetry.retainedCount && telemetry.retainedCount > 0) telemetry.fullRetainedScan = true;
        }
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

function readProjectionByIdentity(store: IDBObjectStore, identity: EvidenceIdentity, interval: HistoryInterval, first: number, last: number, anchorSequence: number | undefined, telemetry: QueryTelemetryMutable): Promise<QueryProjection | null> {
  if (identity.intervalId !== interval.id || identity.sequence < first || identity.sequence > last || (anchorSequence !== undefined && anchorSequence !== identity.sequence)) return Promise.resolve(null);
  telemetry.evidenceCursorReads += 1;
  telemetry.projectionReads += 1;
  return requestToPromise<QueryProjection | undefined>(store.get(identity.sequence), "reading Around anchor projection").then((projection) => {
    if (!projection || isTopologyCheckpointProjection(projection) || projection.intervalId !== interval.id || projection.eventId !== identity.eventId || projection.sequence !== identity.sequence) return null;
    validateQueryProjection(projection, interval.id, identity.sequence);
    return projection;
  });
}

function readSearchProjections(store: IDBObjectStore, intervalId: string, first: number, last: number, find: NonNullable<EvidenceQueryRequest["find"]>, telemetry: QueryTelemetryMutable): Promise<QueryProjection[]> {
  const normalized = normalizeEvidenceSearchText(find.text);
  if (!normalized || last < first) return Promise.resolve([]);
  const codePoints = Array.from(normalized);
  const residual = (values: QueryProjection[]): QueryProjection[] => values.filter((value) =>
    value.sequence >= first && value.sequence <= last && normalizeEvidenceSearchText(value.searchText).includes(normalized));
  if (codePoints.length < 3) {
    telemetry.shortFindFallback = true;
    telemetry.fullRetainedScan = true;
    return readQueryProjections(store, intervalId, first, last, null, telemetry).then(residual);
  }
  const index = store.index("searchTokens");
  return rarestFindSearchToken(index, normalized)
    .then(({ token, count: rarestCount }) => {
      telemetry.findCursorBound = rarestCount;
      return readProjectionCursor(index, queryOnlyRange(token), intervalId, telemetry, rarestCount, "Find");
    })
    .then((values) => residual(values.filter((value) => value.sequence >= first && value.sequence <= last)));
}

type FindProjectionScan = Readonly<{
  result: EvidenceSnapshot["find"];
}>;

/** Finds exact totals and neighbors while retaining only compact identities
 * near the requested current match. Replay payloads are never read here. */
async function readFindProjectionResult(
  store: IDBObjectStore,
  intervalId: string,
  first: number,
  last: number,
  find: NonNullable<EvidenceQueryRequest["find"]>,
  scopeFilter: EvidenceQueryRequest["filter"] | null,
  around: EvidenceQueryRequest["filter"]["around"],
  interval: HistoryInterval,
  signal: AbortSignal | undefined,
  telemetry: QueryTelemetryMutable
): Promise<FindProjectionScan> {
  const normalized = normalizeEvidenceSearchText(find.text);
  if (!normalized || last < first) {
    return { result: Object.freeze({ text: find.text, total: 0, current: null, previous: null, next: null }) };
  }
  const firstMatches: EvidenceIdentity[] = [];
  const nearby: QueryProjection[] = [];
  let total = 0;
  let firstMatch: QueryProjection | null = null;
  const current = find.current;
  const distance = (projection: QueryProjection): number => current === undefined ? Number.POSITIVE_INFINITY : Math.abs(projection.sequence - current.sequence);
  const identityOf = (projection: QueryProjection): EvidenceIdentity => Object.freeze({ intervalId: projection.intervalId, pageId: interval.id, ownerId: "memory-event-history", sequence: projection.sequence, eventId: projection.eventId });
  const isCurrent = (projection: QueryProjection): boolean => current !== undefined
    && projection.intervalId === current.intervalId && projection.sequence === current.sequence && projection.eventId === current.eventId;
  const keepNearby = (projection: QueryProjection): void => {
    if (current === undefined) {
      if (nearby.length < 2) nearby.push(projection);
      return;
    }
    nearby.push(projection);
    nearby.sort((left, right) => distance(left) - distance(right) || left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
    if (nearby.length > 8) nearby.pop();
  };
  const consume = (projection: QueryProjection): void => {
    if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
    if (isTopologyCheckpointProjection(projection) || projection.intervalId !== intervalId) return;
    if (!normalizeEvidenceSearchText(projection.searchText).includes(normalized)) return;
    if (scopeFilter !== null) {
      const evaluation = evaluateFilter({ ...scopeFilter, around: null } as unknown as Filter, {
        timestamp: projection.timestamp,
        intervalId: projection.intervalId,
        searchText: projection.searchText,
        facets: projection.facets as unknown as FilterRecord["facets"]
      });
      if (!evaluation.matches || !isInAround({ identity: identityOf(projection), timestamp: projection.timestamp }, around)) return;
    }
    total += 1;
    firstMatch ??= projection;
    if (firstMatches.length < 1_000) firstMatches.push(identityOf(projection));
    keepNearby(projection);
  };
  const codePoints = Array.from(normalized);
  const searchIndex = store.index("searchTokens");
  // A projection with the partial marker deliberately omits some trigrams.
  // Do not let a rare retained token make the result incomplete: the exact
  // projection scan is still bounded by the latched retained range.
  const partialProjectionCount = codePoints.length < 3
    ? 0
    : await requestToPromise<number>(searchIndex.count(queryOnlyRange(SEARCH_TOKEN_PARTIAL_MARKER)), "checking partial Find index coverage");
  if (codePoints.length < 3 || partialProjectionCount > 0) {
    telemetry.shortFindFallback = codePoints.length < 3;
    telemetry.fullRetainedScan = true;
    if (partialProjectionCount > 0) telemetry.findCursorBound = telemetry.cursorWorkBound;
    const state = { reads: 0, bound: telemetry.cursorWorkBound };
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor(queryBoundRange(first, last));
      request.onerror = () => reject(request.error ?? new Error("Find projection scan failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        try {
          recordProjectionCursorRead(telemetry, state, "Find");
          const projection = cursor.value as QueryProjection;
          validateQueryProjection(projection, intervalId, Number(cursor.key));
          consume(projection);
          cursor.continue();
        } catch (error) { reject(error); }
      };
    });
  } else {
    const { token, count } = await rarestFindSearchToken(searchIndex, normalized);
    telemetry.findCursorBound = count;
    await new Promise<void>((resolve, reject) => {
      const request = searchIndex.openCursor(queryOnlyRange(token));
      const state = { reads: 0, bound: count };
      request.onerror = () => reject(request.error ?? new Error("Find search-token scan failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        try {
          recordProjectionCursorRead(telemetry, state, "Find");
          telemetry.findCursorReads += 1;
          const projection = cursor.value as QueryProjection;
          validateQueryProjection(projection, intervalId, Number(cursor.primaryKey));
          if (projection.sequence >= first && projection.sequence <= last) consume(projection);
          cursor.continue();
        } catch (error) { reject(error); }
      };
    });
  }
  let exact: QueryProjection | null = null;
  if (current !== undefined) {
    exact = nearby.find(isCurrent) ?? null;
  }
  const target = exact ?? (current === undefined ? (firstMatch as QueryProjection | null) : nearby[0] ?? null);
  const orderedNearby = [...nearby].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  const targetIndex = target === null ? -1 : orderedNearby.findIndex((projection) => projection.sequence === target.sequence && projection.eventId === target.eventId);
  const previous = targetIndex > 0 ? identityOf(orderedNearby[targetIndex - 1]!) : null;
  const next = targetIndex >= 0 && targetIndex + 1 < orderedNearby.length ? identityOf(orderedNearby[targetIndex + 1]!) : null;
  const base: EvidenceFindResult = Object.freeze({
    text: find.text,
    total,
    current: current === undefined ? null : (target === null ? null : identityOf(target)),
    previous,
    next
  });
  const firstMatchSequence: number | undefined = (firstMatch as QueryProjection | null)?.sequence;
  const targetSequence = target === null ? firstMatchSequence : target.sequence;
  const targetWindow = targetSequence === undefined
    ? []
    : await readFindProjectionWindow(store, intervalId, first, last, targetSequence, telemetry);
  const nextWindow = next === null
    ? []
    : await readFindProjectionWindow(store, intervalId, first, last, next.sequence, telemetry);
  return {
    result: Object.freeze({
      ...base,
      first: firstMatches[0] ?? null,
      window: Object.freeze(targetWindow.map((projection) => querySelectionRecord(projection, interval))),
      matches: Object.freeze(firstMatches),
      ...(nextWindow.length > 0 ? { nextWindow: Object.freeze(nextWindow.map((projection) => querySelectionRecord(projection, interval))) } : {})
    })
  };
}

async function rarestFindSearchToken(index: IDBIndex, normalized: string): Promise<Readonly<{ token: string; count: number }>> {
  const tokens = [...new Set([
    normalized,
    ...queryTrigrams(normalized)
  ])];
  const counts = await Promise.all(tokens.map(async (token) => ({
    token,
    count: await requestToPromise<number>(index.count(queryOnlyRange(token)), "counting Find search-token candidates")
  })));
  const positiveCounts = counts.filter(({ count }) => count > 0);
  return (positiveCounts.length > 0 ? positiveCounts : counts)
    .sort((left, right) => left.count - right.count || left.token.localeCompare(right.token))[0] ?? { token: normalized, count: 0 };
}

/**
 * A renderer-scoped Find needs bounded context around the active and next
 * matches, not only the postings that matched the search text. Keep the
 * candidate search indexed, then hydrate at most two 100-record windows so
 * the public Find window remains useful without turning every Find into a
 * full retained scan.
 */
async function readFindProjectionContext(
  store: IDBObjectStore,
  intervalId: string,
  first: number,
  last: number,
  matches: readonly QueryProjection[],
  find: NonNullable<EvidenceQueryRequest["find"]>,
  telemetry: QueryTelemetryMutable
): Promise<QueryProjection[]> {
  if (matches.length === 0 || last < first) return [];
  const ordered = [...matches].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  const currentIndex = find.current === undefined
    ? -1
    : ordered.findIndex((projection) => projection.sequence === find.current!.sequence && projection.eventId === find.current!.eventId && projection.intervalId === find.current!.intervalId);
  let activeIndex = currentIndex;
  if (activeIndex < 0 && find.current !== undefined) {
    activeIndex = ordered.reduce((best, projection, index) => {
      const bestDistance = Math.abs(ordered[best]!.sequence - find.current!.sequence);
      const distance = Math.abs(projection.sequence - find.current!.sequence);
      return distance < bestDistance || (distance === bestDistance && projection.sequence < ordered[best]!.sequence) ? index : best;
    }, 0);
  }
  if (activeIndex < 0) activeIndex = 0;
  const targetSequences = [ordered[activeIndex]!.sequence];
  if (activeIndex + 1 < ordered.length) targetSequences.push(ordered[activeIndex + 1]!.sequence);
  const windows = await Promise.all(targetSequences.map((sequence) => readFindProjectionWindow(store, intervalId, first, last, sequence, telemetry)));
  const result = new Map<number, QueryProjection>();
  for (const projection of [...matches, ...windows.flat()]) result.set(projection.sequence, projection);
  return [...result.values()].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
}

function readFindProjectionWindow(store: IDBObjectStore, intervalId: string, first: number, last: number, sequence: number, telemetry: QueryTelemetryMutable): Promise<QueryProjection[]> {
  const lower = Math.max(first, sequence - 50);
  const upper = Math.min(last, lower + 99);
  const range = queryBoundRange(lower, upper);
  if (range === undefined) return Promise.resolve([]);
  const result: QueryProjection[] = [];
  const state = { reads: 0, bound: Math.max(0, upper - lower + 1) };
  return new Promise((resolve, reject) => {
    const request = store.openCursor(range);
    request.onerror = () => reject(request.error ?? new Error("Find context projection cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= 100) { resolve(result); return; }
      try { recordProjectionCursorRead(telemetry, state, "Find context"); } catch (error) { reject(error); return; }
      const projection = cursor.value as QueryProjection;
      try { validateQueryProjection(projection, intervalId, Number(cursor.key)); } catch (error) { reject(error); return; }
      if (!isTopologyCheckpointProjection(projection) && projection.intervalId === intervalId) result.push(projection);
      cursor.continue();
    };
  });
}

function readProjectionCursor(index: IDBIndex, range: IDBKeyRange | IDBValidKey | undefined, intervalId: string, telemetry: QueryTelemetryMutable, bound: number, operation: "Around" | "Find"): Promise<QueryProjection[]> {
  const result: QueryProjection[] = [];
  if (range === undefined) telemetry.fullRetainedScan = true;
  return new Promise((resolve, reject) => {
    const request = index.openCursor(range);
    const state = { reads: 0, bound };
    request.onerror = () => reject(request.error ?? new Error("Indexed query projection cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      try { recordProjectionCursorRead(telemetry, state, "index"); } catch (error) { reject(error); return; }
      const projection = cursor.value as QueryProjection;
      try { validateQueryProjection(projection, intervalId, Number(cursor.primaryKey)); } catch (error) { reject(error); return; }
      if (operation === "Find") telemetry.findCursorReads += 1;
      if (!isTopologyCheckpointProjection(projection) && projection.intervalId === intervalId) result.push(projection);
      cursor.continue();
    };
  });
}

function queryOnlyRange(value: IDBValidKey): IDBKeyRange | IDBValidKey {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.only(value) : value;
}

function queryBoundRange(lower: IDBValidKey, upper: IDBValidKey): IDBKeyRange | undefined {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.bound(lower, upper) : undefined;
}

function queryOpenLowerBoundRange(lower: IDBValidKey, upper: IDBValidKey): IDBKeyRange | undefined {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.bound(lower, upper, true, false) : undefined;
}

function queryOpenUpperBoundRange(lower: IDBValidKey, upper: IDBValidKey): IDBKeyRange | undefined {
  const range = (globalThis as typeof globalThis & { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  return range ? range.bound(lower, upper, false, true) : undefined;
}

async function readSelectedEvidence(store: IDBObjectStore, identity: EvidenceIdentity, interval: HistoryInterval, first: number, last: number, telemetry: QueryTelemetryMutable): Promise<EvidenceRecord | null> {
  if (identity.intervalId !== interval.id || identity.sequence < first || identity.sequence > last) return null;
  telemetry.payloadHydrations += 1;
  telemetry.lookupPayloadHydrations += 1;
  telemetry.fullEvidencePayloadHydrations += 1;
  const record = await requestToPromise<EvidenceRecord | undefined>(store.get(identity.sequence), "reading selected Evidence payload");
  if (!record || record.intervalId !== interval.id || record.eventId !== identity.eventId || record.facets.includes(facet("kind", "topology-checkpoint"))) return null;
  return record;
}

async function hydrateQueryPage(store: IDBObjectStore, page: readonly SelectionRecord[], interval: HistoryInterval, telemetry: QueryTelemetryMutable): Promise<SelectionRecord[]> {
  return Promise.all(page.map(async (record) => {
    telemetry.payloadHydrations += 1;
    telemetry.fullEvidencePayloadHydrations += 1;
    const persisted = await requestToPromise<EvidenceRecord | undefined>(store.get(record.identity.sequence), "reading Evidence page payload");
    if (!persisted || persisted.intervalId !== interval.id || persisted.eventId !== record.identity.eventId) throw new Error("The Evidence page payload is missing or corrupt.");
    return Object.freeze({ ...record, payload: copyCandidate(deserializeJournalEvidenceCandidate(persisted.replayPayload)) });
  }));
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

function prepareEvidence(entry: CommittedEvidence, serialized: ReturnType<typeof serializeJournalEvidenceCandidate>, boundedSearchIndex = false): PreparedEvidence {
  if (entry.candidate.kind === "topology-checkpoint") {
    return {
      evidence: entry,
      serialized,
      projection: queryProjection(entry.candidate, entry.intervalId, entry.sequence),
      postings: [],
      aggregateValues: []
    };
  }
  const candidate = entry.candidate as Exclude<EvidenceCandidate, { kind: "topology-checkpoint" }>;
  const identity: EvidenceIdentity = { intervalId: entry.intervalId, pageId: entry.intervalId, ownerId: "memory-event-history", sequence: entry.sequence, eventId: entry.eventId };
  const context = { identity, pageId: entry.intervalId, listenerOwner: identity.ownerId, summary: candidate.kind };
  const extracted = extractEvidenceFacets(candidate, context);
  return {
    evidence: entry,
    serialized,
    projection: queryProjectionWithExtraction(candidate, entry.intervalId, entry.sequence, context, extracted, boundedSearchIndex),
    postings: facetPostingsFromExtraction(extracted, candidate.id, entry.intervalId, entry.sequence),
    aggregateValues: extracted.selectableValues.slice(0, EVIDENCE_FACET_COUNT).map((value) => ({
      facet: value.facet,
      facetIdentity: value.identity,
      type: value.type,
      value: value.value,
      label: value.label,
      observation: Object.freeze({ sequence: entry.sequence, eventId: entry.eventId })
    }))
  };
}

function queryProjection(candidate: EvidenceCandidate, intervalId: string, sequence: number): QueryProjection {
  const identity: EvidenceIdentity = { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence, eventId: candidate.id };
  if (candidate.kind === "topology-checkpoint") {
    const searchText = journalCandidateSearchText(candidate);
    return { sequence, intervalId, eventId: candidate.id, timestamp: 0, summary: "Topology checkpoint", searchText, searchTokens: querySearchTokens(searchText), facets: {} };
  }
  const context = { identity, pageId: intervalId, listenerOwner: identity.ownerId, summary: candidate.kind };
  return queryProjectionWithExtraction(candidate, intervalId, sequence, context, extractEvidenceFacets(candidate, context));
}

function queryProjectionWithExtraction(
  candidate: Exclude<EvidenceCandidate, { kind: "topology-checkpoint" }>,
  intervalId: string,
  sequence: number,
  context: { identity: EvidenceIdentity; pageId: string; listenerOwner: string; summary: string },
  extracted: EvidenceFacetExtraction,
  boundedSearchIndex = false
): QueryProjection {
  const searchText = canonicalEvidenceSearchTextWithExtraction(candidate, context, extracted);
  return {
    sequence, intervalId, eventId: candidate.id,
    timestamp: candidate.timestamp,
    summary: candidate.kind,
    searchText,
    searchTokens: querySearchTokens(searchText, boundedSearchIndex),
    facets: extracted.facets
  };
}

function querySearchTokens(value: string, boundedSearchIndex = false): string[] {
  const normalized = normalizeEvidenceSearchText(value);
  // Qualified facet identities are opaque ownership keys, not user-facing
  // search terms. Keep their exact words for residual matching, but avoid
  // indexing their nested page/session identity trigrams.
  const identityTokens = boundedSearchIndex ? normalized.split(/\s+/u).filter((token) => token.includes('["owner-v1"')) : [];
  const indexText = boundedSearchIndex ? normalized.split(/\s+/u).filter((token) => !token.includes('["owner-v1"')).join(" ") : normalized;
  const words = [...new Set(normalized.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))];
  const trigramWords = [...new Set(indexText.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))].filter(searchTokenSupportsTrigrams);
  const partial = boundedSearchIndex && (identityTokens.length > 0 || trigramWords.length !== words.length);
  return [...new Set([
    ...words,
    ...(partial ? [SEARCH_TOKEN_PARTIAL_MARKER] : []),
    ...trigramWords.flatMap(queryTrigrams)
  ])];
}

function searchTokenSupportsTrigrams(word: string): boolean {
  if (word.length <= SEARCH_TOKEN_TRIGRAM_WORD_MAX_LENGTH) return true;
  return word.length <= SEARCH_TOKEN_TRIGRAM_IDENTIFIER_MAX_LENGTH && /[-\d]/u.test(word);
}

function queryTrigrams(value: string): string[] {
  const codePoints = Array.from(value);
  if (codePoints.length < 3) return [];
  return codePoints.slice(0, -2).map((_, index) => codePoints.slice(index, index + 3).join(""));
}

function queryProjectionFromPayload(record: EvidenceRecord, interval: HistoryInterval): SelectionRecord {
  const candidate = deserializeJournalEvidenceCandidate(record.replayPayload);
  return querySelectionRecord(queryProjection(candidate, record.intervalId, record.sequence), interval);
}

function querySnapshot(readPoint: EvidenceReadPoint, page: readonly SelectionRecord[], matching: number, inScope: number, discoveries: ReadonlyMap<string, FacetDiscoveryResult>, evaluation: EvidenceSnapshot["evaluation"], coverage: EvidenceSnapshot["coverage"], storage: EvidenceSnapshot["storage"], nextCursor: string | null, lookup: EvidenceSnapshot["lookup"], find: EvidenceSnapshot["find"], telemetry?: EvidenceSnapshot["telemetry"]): EvidenceSnapshot {
  const publicPage = page.map((record) => ({ identity: record.identity, timestamp: record.timestamp, summary: record.summary, searchText: record.searchText, facets: record.facets, ...(record.payload === undefined ? {} : { payload: record.payload }) }));
  return Object.freeze({ readPoint, page: Object.freeze({ evidence: Object.freeze(publicPage), nextCursor }), totals: Object.freeze({ matching, inScope }), discoveries, lookup, find, evaluation, coverage, storage, ...(telemetry ? { telemetry } : {}) });
}

function queryCoverage(options: IndexedDbQueryOptions): EvidenceSnapshot["coverage"] { return options.tier === "LOWER" || options.fallback !== null || options.terminal ? "LIMITED" : "COMPLETE"; }
function queryStorage(options: IndexedDbQueryOptions): EvidenceSnapshot["storage"] { return options.fallback === null ? "INDEXED_DB" : "MEMORY_FALLBACK"; }
function queryCursor(cursor: string | undefined): number { const value = cursor === undefined ? 0 : Number(cursor); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Page cursor must be a non-negative integer."); return value; }
function isInQueryRange(sequence: number, range: ControlRecord["retainedRange"]): boolean { return range === null || (sequence >= range.first.sequence && sequence <= range.last.sequence); }
function sameQueryIdentity(left: EvidenceIdentity, right: EvidenceIdentity): boolean { return left.intervalId === right.intervalId && left.pageId === right.pageId && left.ownerId === right.ownerId && left.sequence === right.sequence && left.eventId === right.eventId; }
function sameQueryReadPoint(left: EvidenceReadPoint, right: EvidenceReadPoint): boolean { return left.interval.id === right.interval.id && left.interval.ordinal === right.interval.ordinal && sameNullableQueryIdentity(left.committedEvidenceBoundary, right.committedEvidenceBoundary) && sameNullableQueryRange(left.retainedRange, right.retainedRange); }
function readPointFitsCurrentInterval(point: EvidenceReadPoint, current: EvidenceReadPoint): boolean {
  if (point.interval.id !== current.interval.id || point.interval.ordinal !== current.interval.ordinal) return false;
  const pointBoundary = point.committedEvidenceBoundary?.sequence ?? 0;
  const currentBoundary = current.committedEvidenceBoundary?.sequence ?? 0;
  if (pointBoundary > currentBoundary) return false;
  if (point.retainedRange === null) return true;
  if (current.retainedRange === null) return false;
  return point.retainedRange.first.sequence >= current.retainedRange.first.sequence
    && point.retainedRange.last.sequence <= current.retainedRange.last.sequence;
}
function sameNullableQueryIdentity(left: EvidenceIdentity | null, right: EvidenceIdentity | null): boolean { return left === null || right === null ? left === right : sameQueryIdentity(left, right); }
function sameNullableQueryRange(left: EvidenceReadPoint["retainedRange"], right: EvidenceReadPoint["retainedRange"]): boolean { return left === null || right === null ? left === right : sameQueryIdentity(left.first, right.first) && sameQueryIdentity(left.last, right.last); }

function planCachedRetentionTrim(
  entries: readonly DurableRetentionEntry[],
  retainedCount: number,
  retainedCapacityBytes: number,
  targetCount: number,
  targetCapacityBytes: number
): RetentionTrimPlan {
  let remainingCount = retainedCount;
  let remainingCapacityBytes = retainedCapacityBytes;
  let evictedCount = 0;
  let evictedReplayPayloadBytes = 0;
  let evictedAccountedBytes = 0;
  let evictedCapacityBytes = 0;
  while (
    evictedCount < entries.length
    && (remainingCount > targetCount || remainingCapacityBytes > targetCapacityBytes)
  ) {
    const entry = entries[evictedCount]!;
    remainingCount -= 1;
    remainingCapacityBytes = Math.max(0, remainingCapacityBytes - entry.capacityBytes);
    evictedReplayPayloadBytes += entry.replayPayloadBytes;
    evictedAccountedBytes += entry.accountedBytes;
    evictedCapacityBytes += entry.capacityBytes;
    evictedCount += 1;
  }
  const firstEvicted = evictedCount > 0 ? entries[0]!.evidence : null;
  const lastEvicted = evictedCount > 0 ? entries[evictedCount - 1]!.evidence : null;
  const firstRetained = entries[evictedCount]?.evidence ?? null;
  return {
    cutoffSequence: lastEvicted?.sequence ?? (firstRetained?.sequence ?? 1) - 1,
    evictedCount,
    evictedReplayPayloadBytes,
    evictedAccountedBytes,
    evictedCapacityBytes,
    firstEvicted,
    lastEvicted,
    firstRetained
  };
}

async function planJournalRetentionTrim(
  database: AuthoritativeEventDatabase,
  interval: HistoryInterval,
  durableRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }>,
  retainedCount: number,
  retainedCapacityBytes: number,
  targetCount: number,
  targetCapacityBytes: number,
  capacityBytesBySequence: ReadonlyMap<number, number>
): Promise<RetentionTrimPlan> {
  if (retainedCount <= targetCount && retainedCapacityBytes <= targetCapacityBytes) {
    return {
      cutoffSequence: durableRange.first.sequence - 1,
      evictedCount: 0,
      evictedReplayPayloadBytes: 0,
      evictedAccountedBytes: 0,
      evictedCapacityBytes: 0,
      firstEvicted: null,
      lastEvicted: null,
      firstRetained: durableRange.first
    };
  }
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
  const completed = transactionDone(transaction, "planning Event History retention");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  let remainingCount = retainedCount;
  let remainingCapacityBytes = retainedCapacityBytes;
  let cutoffSequence = durableRange.first.sequence - 1;
  let evictedCount = 0;
  let evictedReplayPayloadBytes = 0;
  let evictedAccountedBytes = 0;
  let evictedCapacityBytes = 0;
  let firstEvicted: EvidenceRef | null = null;
  let lastEvicted: EvidenceRef | null = null;
  const plan = await new Promise<RetentionTrimPlan>((resolve, reject) => {
    const request = store.openCursor(queryBoundRange(durableRange.first.sequence, durableRange.last.sequence));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB retention planning failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ cutoffSequence, evictedCount, evictedReplayPayloadBytes, evictedAccountedBytes, evictedCapacityBytes, firstEvicted, lastEvicted, firstRetained: null });
        return;
      }
      const record = cursor.value as EvidenceRecord;
      if (record.intervalId !== interval.id) {
        reject(new Error("IndexedDB retention planning crossed a History Interval boundary."));
        return;
      }
      if (remainingCount <= targetCount && remainingCapacityBytes <= targetCapacityBytes) {
        resolve({
          cutoffSequence,
          evictedCount,
          evictedReplayPayloadBytes,
          evictedAccountedBytes,
          evictedCapacityBytes,
          firstEvicted,
          lastEvicted,
          firstRetained: evidenceRef(record)
        });
        return;
      }
      const capacityBytes = capacityBytesBySequence.get(record.sequence) ?? record.accountedBytes;
      remainingCount -= 1;
      remainingCapacityBytes = Math.max(0, remainingCapacityBytes - capacityBytes);
      cutoffSequence = record.sequence;
      evictedCount += 1;
      evictedReplayPayloadBytes += record.serializedBytes;
      evictedAccountedBytes += record.accountedBytes;
      evictedCapacityBytes += capacityBytes;
      firstEvicted ??= evidenceRef(record);
      lastEvicted = evidenceRef(record);
      cursor.continue();
    };
  });
  await completed;
  return plan;
}

async function applyJournalRetentionTrim(
  database: AuthoritativeEventDatabase,
  panelSessionId: string,
  interval: HistoryInterval,
  nextSequence: number,
  boundary: EvidenceRef | null,
  range: { first: EvidenceRef; last: EvidenceRef } | null,
  retainedCount: number,
  replayPayloadBytes: number,
  accountedBytes: number,
  cutoffSequence: number
): Promise<void> {
  if (cutoffSequence < 1) return;
  const transaction = database.db.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES), "readwrite");
  const completed = transactionDone(transaction, "rolling Event History retention", AUTHORITATIVE_EVENT_HISTORY_COMMIT_TRANSACTION_TIMEOUT_MS);
  const evidenceStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  const projectionStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections);
  const postingStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings);
  const aggregateStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
  const prefix = queryBoundRange(1, cutoffSequence);
  if (!prefix) throw new Error("IndexedDB retention requires bounded key ranges.");
  evidenceStore.delete(prefix);
  projectionStore.delete(prefix);
  aggregateStore.clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(
    createControl(panelSessionId, interval, "RUNNING", null, nextSequence, boundary, range, retainedCount, replayPayloadBytes, accountedBytes)
  );

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const request = postingStore.openCursor();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB retention posting cleanup failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const posting = cursor.value as FacetPostingRecord;
        if (posting.sequence <= cutoffSequence) cursor.delete();
        cursor.continue();
      };
    }),
    new Promise<void>((resolve, reject) => {
      const aggregates = new Map<string, AuthoritativeFacetAggregateRecord>();
      const request = evidenceStore.openCursor();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB retention aggregate rebuild failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          for (const aggregate of aggregates.values()) aggregateStore.add(aggregate);
          resolve();
          return;
        }
        const record = cursor.value as EvidenceRecord;
        if (record.intervalId === interval.id && record.sequence > cutoffSequence) {
          const candidate = deserializeJournalEvidenceCandidate(record.replayPayload);
          if (candidate.kind !== "topology-checkpoint") {
            const identity: EvidenceIdentity = {
              intervalId: record.intervalId,
              pageId: record.intervalId,
              ownerId: "memory-event-history",
              sequence: record.sequence,
              eventId: record.eventId
            };
            const extracted = extractEvidenceFacets(candidate, {
              identity,
              pageId: record.intervalId,
              listenerOwner: identity.ownerId,
              summary: candidate.kind
            });
            for (const value of extracted.selectableValues.slice(0, EVIDENCE_FACET_COUNT)) {
              aggregates.set(value.identity, {
                intervalId: record.intervalId,
                facet: value.facet,
                facetIdentity: value.identity,
                type: value.type,
                value: value.value,
                label: value.label
              });
            }
          }
        }
        cursor.continue();
      };
    })
  ]);
  await completed;
}

async function commitBatch(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, previousRange: { first: EvidenceRef; last: EvidenceRef } | null, previousCount: number, preparedBatch: readonly PreparedEvidence[], aggregateCache: FacetAggregateCache, replayPayloadBytes: number, accountedBytes: number, phase: "RUNNING" | "DRAINING_TO_STOP", terminal: HistoryTerminalDiagnostic | null): Promise<void> {
  const transaction = database.db.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES), "readwrite");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  const postingStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings);
  const projectionStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections);
  const aggregateStore = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
  let serializedBatchBytes = 0;
  let accountedBatchBytes = 0;
  const aggregateDeltas = new Map<string, {
    record: AuthoritativeFacetAggregateRecord;
    observations: Array<{ sequence: number; eventId: string }>;
  }>();
  const aggregateCacheUpdates = new Map<string, AuthoritativeFacetAggregateRecord>();
  for (const prepared of preparedBatch) {
    const serialized = prepared.serialized;
    const recordAccountedBytes = journalAccountedBytes(serialized.bytes);
    serializedBatchBytes += serialized.bytes;
    accountedBatchBytes += recordAccountedBytes;
    const entry = prepared.evidence;
    store.add({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes: recordAccountedBytes, facets: exactFacets(entry.candidate) } satisfies EvidenceRecord);
    projectionStore.add(prepared.projection);
    for (const posting of prepared.postings) {
      postingStore.add(posting);
    }
    for (const value of prepared.aggregateValues) {
      const key = JSON.stringify([entry.intervalId, value.facetIdentity]);
      const existing = aggregateDeltas.get(key);
      if (existing) existing.observations.push(value.observation);
      else aggregateDeltas.set(key, {
        record: { intervalId: entry.intervalId, facet: value.facet, facetIdentity: value.facetIdentity, type: value.type, value: value.value, label: value.label },
        observations: [value.observation]
      });
    }
  }
  if (replayPayloadBytes < serializedBatchBytes || accountedBytes < accountedBatchBytes) throw new Error("The journal commit totals are incoherent.");
  const evidence = preparedBatch.map((prepared) => prepared.evidence);
  const applyAggregateUpdate = (
    key: string,
    update: { record: AuthoritativeFacetAggregateRecord; observations: Array<{ sequence: number; eventId: string }> },
    current: AuthoritativeFacetAggregateRecord | null | undefined
  ): void => {
    try {
      if (current !== undefined && current !== null) {
        assertExactKeys(current, ["facet", "facetIdentity", "intervalId", "label", "type", "value"]);
        if (current.intervalId !== update.record.intervalId || current.facet !== update.record.facet || current.facetIdentity !== update.record.facetIdentity
          || current.type !== update.record.type || current.value !== update.record.value || current.label !== update.record.label) {
          throw new Error("The facet aggregate cache entry is corrupt.");
        }
      }
      validateAggregateObservations(update.observations);
      const next = current ?? update.record;
      if (current === null || current === undefined) aggregateStore.add(next);
      aggregateCacheUpdates.set(key, next);
    } catch {
      try { transaction.abort(); } catch { /* transaction failure is reported by transactionDone */ }
    }
  };
  for (const [key, update] of aggregateDeltas) {
    if (aggregateCache.has(key)) {
      applyAggregateUpdate(key, update, aggregateCache.get(key));
      continue;
    }
    const request = aggregateStore.get([update.record.intervalId, update.record.facetIdentity]);
    request.onerror = () => { try { transaction.abort(); } catch { /* transaction failure is reported by transactionDone */ } };
    request.onsuccess = () => applyAggregateUpdate(key, update, (request.result as AuthoritativeFacetAggregateRecord | undefined) ?? null);
  }
  const next = evidence.at(-1) ? evidence.at(-1)!.sequence + 1 : nextSequence;
  const last = evidence.at(-1);
  const boundary = last ? toRef(last) : previousRange?.last ?? null;
  const range = previousRange
    ? { first: previousRange.first, last: last ? toRef(last) : previousRange.last }
    : evidence.length
      ? { first: toRef(evidence[0]), last: toRef(last!) }
      : null;
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, phase, terminal, next, boundary, range, previousCount + evidence.length, replayPayloadBytes, accountedBytes));
  await transactionDone(transaction, "committing Evidence", AUTHORITATIVE_EVENT_HISTORY_COMMIT_TRANSACTION_TIMEOUT_MS);
  for (const [key, aggregate] of aggregateCacheUpdates) aggregateCache.set(key, aggregate);
}

function validateAggregateObservations(additions: readonly Readonly<{ sequence: number; eventId: string }>[]): void {
  let previousSequence = 0;
  for (const observation of additions) {
    if (!Number.isSafeInteger(observation.sequence) || observation.sequence < 1 || typeof observation.eventId !== "string" || observation.eventId.length === 0 || observation.sequence <= previousSequence) {
      throw new Error("The facet aggregate observations are duplicated or incoherent.");
    }
    previousSequence = observation.sequence;
  }
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

async function clearJournalRecords(
  database: AuthoritativeEventDatabase,
  panelSessionId: string,
  interval: HistoryInterval,
  nextSequence: number,
  boundary: EvidenceRef | null,
  timeoutMs = 2_000
): Promise<void> {
  const transaction = database.db.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES), "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, "RUNNING", null, nextSequence, boundary, null, 0, 0, 0));
  await transactionDone(transaction, "clearing Event History", timeoutMs);
}

function validateJournalRecords(panelSessionId: string, control: ControlRecord | undefined, store: IDBObjectStore, postingStore: IDBObjectStore, aggregateStore: IDBObjectStore): Promise<readonly DurableRetentionEntry[]> {
  if (!control) {
    return Promise.all([
      requestToPromise<number>(store.count(), "checking for Evidence residue"),
      requestToPromise<number>(postingStore.count(), "checking for facet posting residue"),
      requestToPromise<number>(aggregateStore.count(), "checking for facet aggregate residue")
    ]).then(([count, postingCount, aggregateCount]) => {
      if (count > 0 || postingCount > 0 || aggregateCount > 0) throw new Error("Evidence or derived facet residue exists without a history control record.");
      return [];
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
  const durableRetentionEntries: DurableRetentionEntry[] = [];
  let first: EvidenceRef | null = null;
  let last: EvidenceRef | null = null;
  return new Promise<readonly DurableRetentionEntry[]>((resolve, reject) => {
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
          if (boundaryOrdinal === null || boundaryOrdinal > control.interval.ordinal) {
            reject(new Error("The history control committed boundary interval is incoherent."));
            return;
          }
        } else if (control.phase !== "DRAINING_TO_STOP" && control.committedEvidenceBoundary === null && control.interval.ordinal > 1 && control.nextSequence !== 1) {
          reject(new Error("A non-initial History Interval must retain its panel-lifetime boundary."));
          return;
        }
        validateFacetPostingRecords(panelSessionId, control, postingStore, aggregateStore, evidenceBySequence)
          .then(() => resolve(durableRetentionEntries), reject);
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
        durableRetentionEntries.push({
          evidence: reference,
          replayPayloadBytes: record.serializedBytes,
          accountedBytes: record.accountedBytes,
          capacityBytes: record.accountedBytes
        });
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
  aggregateStore: IDBObjectStore,
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
        validateFacetAggregateRecords(control, aggregateStore, evidenceBySequence).then(resolve, reject);
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

function validateFacetAggregateRecords(
  control: ControlRecord,
  store: IDBObjectStore,
  evidenceBySequence: ReadonlyMap<number, EvidenceRecord>
): Promise<void> {
  const expected = new Map<string, AuthoritativeFacetAggregateRecord>();
  for (const evidence of evidenceBySequence.values()) {
    const candidate = deserializeJournalEvidenceCandidate(evidence.replayPayload);
    if (candidate.kind === "topology-checkpoint") continue;
    for (const value of extractEvidenceFacets(candidate, { pageId: evidence.intervalId, listenerOwner: "memory-event-history" }).selectableValues.slice(0, EVIDENCE_FACET_COUNT)) {
      const key = JSON.stringify([evidence.intervalId, value.identity]);
      const existing = expected.get(key);
      if (!existing) {
        expected.set(key, { intervalId: evidence.intervalId, facet: value.facet, facetIdentity: value.identity, type: value.type, value: value.value, label: value.label });
      }
    }
  }
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB facet aggregate validation failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        if (expected.size > 0) {
          reject(new Error("Facet aggregate metadata is incomplete."));
          return;
        }
        resolve();
        return;
      }
      try {
        const record = cursor.value as AuthoritativeFacetAggregateRecord;
        assertExactKeys(record, ["facet", "facetIdentity", "intervalId", "label", "type", "value"]);
        if (record.intervalId !== control.interval.id || typeof record.facet !== "string" || typeof record.facetIdentity !== "string"
          || typeof record.type !== "string" || typeof record.value !== "string" || typeof record.label !== "string"
          || facetIdentityParts(record.facetIdentity)?.facet !== record.facet
          || facetIdentityParts(record.facetIdentity)?.type !== record.type
          || facetIdentityParts(record.facetIdentity)?.value !== record.value) throw new Error("A facet aggregate record is incoherent.");
        const key = JSON.stringify([record.intervalId, record.facetIdentity]);
        const expectedRecord = expected.get(key);
        if (!expectedRecord || JSON.stringify(expectedRecord) !== JSON.stringify(record)) throw new Error("A facet aggregate does not match its Evidence records.");
        expected.delete(key);
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

function validateFacetPostingRecord(record: FacetPostingRecord, panelSessionId: string, intervalId: string, evidenceBySequence: ReadonlyMap<number, EvidenceRecord>): FacetPostingRecord {
  assertExactKeys(record, ["eventId", "facet", "facetIdentity", "intervalId", "sequence", "token"]);
  if (record.intervalId !== intervalId || typeof record.eventId !== "string" || record.eventId.length === 0
    || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || typeof record.facet !== "string" || typeof record.facetIdentity !== "string"
    || facetFromIdentity(record.facetIdentity) !== record.facet
    || record.token !== facetPostingToken(record.facetIdentity)) {
    throw new Error("A facet posting record is incoherent with the authoritative schema.");
  }
  const evidence = evidenceBySequence.get(record.sequence);
  if (!evidence || evidence.eventId !== record.eventId) {
    throw new Error("A facet posting does not match its Evidence record.");
  }
  const candidate = deserializeJournalEvidenceCandidate(evidence.replayPayload);
  if (!facetPostings(candidate, intervalId, record.sequence).some((posting) => posting.facet === record.facet && posting.facetIdentity === record.facetIdentity)) {
    throw new Error("A facet posting does not match its replay payload.");
  }
  if (!record.token.startsWith(`[\"${AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE}\",`)) {
    throw new Error(`A facet posting does not use the ${panelSessionId} token namespace.`);
  }
  return record;
}

function validateEvidenceRecord(record: EvidenceRecord, intervalId: string, expectedSequence?: number): EvidenceCandidate {
  assertExactKeys(record, ["accountedBytes", "eventId", "facets", "intervalId", "replayPayload", "sequence", "serializedBytes"]);
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
    let preserveSelectionOrder = false;
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
    const acceptRecord = (record: EvidenceRecord | undefined): void => {
      const readable = record !== undefined && latch.retainedRange !== null && record.intervalId === latch.interval.id
        && Number.isSafeInteger(record.sequence) && record.sequence >= latch.retainedRange.first.sequence
        && record.sequence <= latch.retainedRange.last.sequence;
      if (!readable) return;
      const evidence = toCommittedEvidenceFromRecord(record);
      if (matchesEvidenceQuery(evidence, query)) {
        total += 1;
        selected.push(evidence);
      }
    };
    const canPageCandidateKind = query.limit !== undefined
      && query.candidateKind !== undefined
      && query.eventId === undefined
      && query.afterSequence === undefined;
    if (canPageCandidateKind) {
      const checkpointToken = facet("kind", "topology-checkpoint");
      const countRequest = store.index("facets").count(queryOnlyRange(checkpointToken));
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
    const unfilteredPage = query.candidateKind === undefined && query.afterSequence === undefined;
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

function readMemoryJournal(
  latch: ReadLatch,
  query: EvidenceQuery,
  memoryEvidence: readonly CommittedEvidence[]
): Promise<JournalRead> {
  const retainedRange = latch.retainedRange;
  const selected = retainedRange === null
    ? []
    : memoryEvidence.filter((entry) => (
        entry.intervalId === latch.interval.id
        && entry.sequence >= retainedRange.first.sequence
        && entry.sequence <= retainedRange.last.sequence
        && matchesEvidenceQuery(entry, query)
      ));
  return Promise.resolve({
    evidence: pageJournalSelection(selected, query, selected.length),
    total: selected.length
  });
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

function readMemoryReplayChunk(
  interval: HistoryInterval,
  firstSequence: number,
  lastSequence: number,
  chunkSize: number,
  volatileEvidence: readonly CommittedEvidence[]
): CommittedEvidence[] {
  return volatileEvidence.filter((entry) =>
    entry.intervalId === interval.id
    && entry.sequence >= firstSequence
    && entry.sequence <= lastSequence
  ).slice(0, chunkSize);
}

function readReplayChunk(
  database: AuthoritativeEventDatabase,
  interval: HistoryInterval,
  firstSequence: number,
  lastSequence: number,
  chunkSize: number
): Promise<CommittedEvidence[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly");
    const completed = transactionDone(transaction, "reading replay chunk");
    const records: CommittedEvidence[] = [];
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("IndexedDB Evidence replay chunk failed."));
    };
    const finish = (): void => {
      void completed.then(
        () => {
          if (settled) return;
          settled = true;
          resolve(records);
        },
        fail
      );
    };
    const request = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence)
      .openCursor(queryBoundRange(firstSequence, lastSequence));
    request.onerror = () => fail(request.error ?? new Error("IndexedDB Evidence replay cursor failed."));
    request.onsuccess = () => {
      if (settled) return;
      const cursor = request.result;
      if (!cursor || records.length >= chunkSize) {
        finish();
        return;
      }
      const record = cursor.value as EvidenceRecord;
      if (record.intervalId === interval.id && record.sequence >= firstSequence && record.sequence <= lastSequence) {
        try {
          records.push(toCommittedEvidenceFromRecord(record));
        } catch (error) {
          fail(error);
          return;
        }
      }
      cursor.continue();
    };
    void completed.catch(fail);
  });
}

function assertExactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("An authoritative IndexedDB record has an unexpected schema.");
}

function isInterval(value: unknown): value is HistoryInterval {
  return Boolean(value && typeof value === "object" && Object.keys(value).sort().join(",") === "id,ordinal" && isBoundedEvidenceRefComponent((value as HistoryInterval).id) && Number.isSafeInteger((value as HistoryInterval).ordinal) && (value as HistoryInterval).ordinal > 0);
}

function intervalOrdinal(panelSessionId: string, intervalId: string): number | null {
  const prefix = `${panelSessionId}:interval-`;
  if (!intervalId.startsWith(prefix)) return null;
  const ordinal = Number(intervalId.slice(prefix.length));
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

function assertRef(value: EvidenceRef): void {
  if (!value || Object.keys(value).sort().join(",") !== "eventId,intervalId,sequence" || !isBoundedEvidenceRef(value)) throw new Error("An Evidence reference is incoherent.");
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

function facetFromIdentity(facetIdentity: string): string | null {
  return facetIdentityParts(facetIdentity)?.facet ?? null;
}

function facetIdentityParts(facetIdentity: string): { facet: string; type: string; value: string } | null {
  try {
    const parsed = JSON.parse(facetIdentity) as unknown;
    return Array.isArray(parsed) && parsed.length === 4 && parsed[0] === "v1" && typeof parsed[1] === "string"
      && typeof parsed[2] === "string" && typeof parsed[3] === "string"
      ? { facet: parsed[1], type: parsed[2], value: parsed[3] }
      : null;
  } catch {
    return null;
  }
}

function facetPostings(candidate: EvidenceCandidate, intervalId: string, sequence: number): FacetPostingRecord[] {
  if (candidate.kind === "topology-checkpoint") return [];
  const context = { pageId: intervalId, listenerOwner: "memory-event-history" };
  return facetPostingsFromExtraction(extractEvidenceFacets(candidate, context), candidate.id, intervalId, sequence);
}

function facetPostingsFromExtraction(extracted: EvidenceFacetExtraction, eventId: string, intervalId: string, sequence: number): FacetPostingRecord[] {
  return extracted.selectableValues.slice(0, EVIDENCE_FACET_COUNT).map((facetValue) => ({
    token: facetPostingToken(facetValue.identity),
    sequence,
    intervalId,
    eventId,
    facet: facetValue.facet,
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
