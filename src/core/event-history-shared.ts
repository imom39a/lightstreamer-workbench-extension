/**
 * Types, constants, and pure helpers shared by the memory and IndexedDB Event
 * History coordinators. Everything here is storage-neutral and holds no
 * coordinator state, so both backends keep identical intake, gap, retry, and
 * replay vocabulary.
 */
import type {
  CaptureReceipt,
  CommittedEvidence,
  EvidenceRef,
  HistoryAcceptanceGap,
  HistoryContinuityStatus,
  HistoryFollowOptions,
  HistoryInterval,
  HistoryProblem,
  HistoryPublication
} from "./event-history-authoritative";
import type { SerializedJournalEvidence } from "./event-history-serialization";

/**
 * Owner component of every Evidence identity produced by Event History. Both
 * backends must emit the same identity for the same Evidence so durable and
 * volatile segments, page cursors, and storage parity agree; the value is a
 * historical stable token, not a description of the backing store.
 */
export const EVIDENCE_HISTORY_OWNER_ID = "memory-event-history";

export const DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE = 256;
export const MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE = 2_048;
/** One initial attempt plus at most two retries (ADR 0014). */
export const JOURNAL_COMMIT_MAX_ATTEMPTS = 3;
export const RETENTION_LOW_WATER_RATIO = 0.9;

export type ReceiptResult =
  | Readonly<{ outcome: "BECAME_EVIDENCE"; evidence: EvidenceRef }>
  | Readonly<{
      outcome: "NOT_EVIDENCE";
      problem: HistoryProblem;
      committedEvidenceBoundary: EvidenceRef | null;
    }>;

export type PendingCandidate = Readonly<{
  kind: "candidate";
  ordinal: number;
  eventId: string;
  serialized: SerializedJournalEvidence;
  bytes: number;
  offeredAt: number;
  settled: CaptureReceipt["settled"];
  resolve: (result: ReceiptResult) => void;
}>;

export type PendingGapSeed = Readonly<{
  captureOrdinal: number;
  eventId: string;
  candidateBytes: number;
  occurredAt: number;
  dimension: HistoryAcceptanceGap["dimension"];
}>;

/** Bounded refusal metadata that keeps its place between queued candidates. */
export type PendingGapBarrier = {
  kind: "gap-barrier";
  count: number;
  first: PendingGapSeed;
  latest: PendingGapSeed;
  problem: HistoryProblem;
  settled: CaptureReceipt["settled"];
  resolve: (result: ReceiptResult) => void;
};

export type PendingEntry = PendingCandidate | PendingGapBarrier;

export type PendingReplayRange = Readonly<{
  type: "committed-range";
  interval: HistoryInterval;
  firstSequence: number;
  lastSequence: number;
  committedEvidenceBoundary: EvidenceRef;
}>;

/** A follower; each backend supplies its own cooperative replay cursor shape. */
export type HistorySubscriber<CooperativeReplay> = {
  observer: (publication: HistoryPublication) => void;
  replaying: boolean;
  pending: Array<HistoryPublication | PendingReplayRange>;
  signalCleanup?: () => void;
  cooperativeReplay?: CooperativeReplay & { signal?: AbortSignal; signalCleanup?: () => void };
};

/**
 * Explicit Evidence Gap accounting for one History Interval. Retention
 * Advance never enters this ledger.
 */
export class HistoryContinuityLedger {
  private firstGap: HistoryAcceptanceGap | null = null;
  private latestGap: HistoryAcceptanceGap | null = null;
  private gapCount = 0;

  /** Record `count` missing ordinals spanning `first`..`latest`. */
  record(first: HistoryAcceptanceGap, latest: HistoryAcceptanceGap, count: number): void {
    this.firstGap ??= first;
    this.latestGap = latest;
    this.gapCount += count;
  }

  reset(): void {
    this.firstGap = null;
    this.latestGap = null;
    this.gapCount = 0;
  }

  status(): HistoryContinuityStatus {
    return deepFreeze({
      state: this.gapCount > 0 ? "GAPPED" as const : "CONTIGUOUS" as const,
      gapCount: this.gapCount,
      firstGap: this.firstGap,
      latestGap: this.latestGap
    });
  }
}

/** Materialize the gap facts for a barrier at its settled boundary. */
export function gapBarrierFacts(
  barrier: PendingGapBarrier,
  interval: HistoryInterval,
  afterEvidence: EvidenceRef | null
): Readonly<{ first: HistoryAcceptanceGap; latest: HistoryAcceptanceGap }> {
  const toGap = (seed: PendingGapSeed): HistoryAcceptanceGap => deepFreeze({ interval, ...seed, afterEvidence });
  const first = toGap(barrier.first);
  return { first, latest: barrier.count === 1 ? first : toGap(barrier.latest) };
}

/** Rolling retention trims toward this target once a high-water mark is crossed. */
export function retentionLowWater(highWater: number): number {
  if (highWater <= 0) return 0;
  return Math.max(1, Math.floor(highWater * RETENTION_LOW_WATER_RATIO));
}

export function replayChunkSize(options: HistoryFollowOptions): number {
  if (options.chunkSize === undefined) return DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE;
  if (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1) return DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE;
  return Math.min(MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE, options.chunkSize);
}

export function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({ intervalId: evidence.intervalId, sequence: evidence.sequence, eventId: evidence.eventId });
}

export function candidateIdIfPresent(candidate: unknown): string | null {
  return candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string" && candidate.id.length > 0
    ? candidate.id
    : null;
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "QuotaExceededError" || value.code === "QUOTA_EXCEEDED";
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** A deterministic journal defect: retrying the same batch cannot succeed. */
export class JournalIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalIntegrityError";
  }
}

const DETERMINISTIC_JOURNAL_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ConstraintError",
  "DataError",
  "DataCloneError",
  "InvalidAccessError",
  "JournalIntegrityError",
  "NotFoundError",
  "SyntaxError",
  "TypeError"
]);

/** Constraint, data, and integrity failures recur on every attempt. */
export function isDeterministicJournalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && DETERMINISTIC_JOURNAL_ERROR_NAMES.has(name);
}

const JOURNAL_COMMIT_RETRY_BASE_DELAY_MS = 10;
const JOURNAL_COMMIT_RETRY_MAX_DELAY_MS = 100;

/** Bounded exponential backoff before retrying a transient commit failure. */
export function journalRetryDelay(failedAttempt: number): Promise<void> {
  const delay = Math.min(JOURNAL_COMMIT_RETRY_MAX_DELAY_MS, JOURNAL_COMMIT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1));
  return new Promise((resolve) => { globalThis.setTimeout(resolve, delay); });
}
