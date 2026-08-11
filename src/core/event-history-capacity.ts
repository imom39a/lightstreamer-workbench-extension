import { type EvidenceCandidate } from "./event-history-authoritative";
import {
  journalAccountedBytes,
  serializeJournalEvidenceCandidate
} from "./event-history-serialization";

export const MIB = 1_048_576;

export type HistoryCapacityDimension =
  | "RETAINED_COUNT"
  | "RETAINED_BYTES"
  | "PENDING_BYTES"
  | "PENDING_AGE";

export type HistoryTerminalReason =
  | "RETAINED_COUNT_LIMIT"
  | "RETAINED_BYTE_LIMIT"
  | "PENDING_BYTE_LIMIT"
  | "PENDING_AGE_LIMIT"
  | "QUOTA_EXCEEDED"
  | "JOURNAL_COMMIT_FAILED";

export type HistoryCapacityTier = "NORMAL" | "LOWER";

export type HistoryCapacityLimits = Readonly<{
  maxRetainedCount: number;
  maxRetainedBytes: number;
  retainedWarningCount: number;
  retainedWarningBytes: number;
  pendingWarningBytes: number;
  pendingStopBytes: number;
  pendingAgeWarningMs: number;
  pendingAgeStopMs: number;
}>;

export type HistoryCapacityOverrides = Partial<HistoryCapacityLimits>;

export type HistoryTimer = Readonly<{
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type HistoryCapacityOptions = Readonly<{
  clock?: () => number;
  timer?: HistoryTimer;
  byteEstimator?: (candidate: EvidenceCandidate) => number;
  capacity?: HistoryCapacityOverrides;
}>;

export type HistoryPressureMeasurements = Readonly<{
  retainedCount: number;
  retainedBytes: number;
  pendingCount: number;
  pendingBytes: number;
  oldestPendingAgeMs: number | null;
}>;

export type HistoryPressure = Readonly<{
  nearLimit: boolean;
  measurements: HistoryPressureMeasurements;
}>;

export type HistoryTrigger = Readonly<{
  reason: HistoryTerminalReason;
  dimension: HistoryCapacityDimension | "JOURNAL";
  tier: HistoryCapacityTier;
  triggerTime: number;
  interval: Readonly<{ id: string; ordinal: number }>;
  firstMissingEventId: string | null;
  measurements: HistoryPressureMeasurements;
  detail?: string;
}>;

const DEFAULTS: Record<HistoryCapacityTier, HistoryCapacityLimits> = {
  NORMAL: {
    maxRetainedCount: 10_000,
    maxRetainedBytes: 64 * MIB,
    retainedWarningCount: 8_000,
    retainedWarningBytes: Math.ceil(64 * MIB * 0.8),
    pendingWarningBytes: 16 * MIB,
    pendingStopBytes: 32 * MIB,
    pendingAgeWarningMs: 10_000,
    pendingAgeStopMs: 30_000
  },
  LOWER: {
    maxRetainedCount: 5_000,
    maxRetainedBytes: 32 * MIB,
    retainedWarningCount: 4_000,
    retainedWarningBytes: Math.ceil(32 * MIB * 0.8),
    pendingWarningBytes: 16 * MIB,
    pendingStopBytes: 32 * MIB,
    pendingAgeWarningMs: 1_000,
    pendingAgeStopMs: 5_000
  }
};

export const HISTORY_CAPACITY_LIMITS: Readonly<Record<HistoryCapacityTier, HistoryCapacityLimits>> = Object.freeze(DEFAULTS);

export function historyCapacityLimits(
  tier: HistoryCapacityTier,
  overrides: HistoryCapacityOverrides = {}
): HistoryCapacityLimits {
  const defaults = DEFAULTS[tier];
  const merged = { ...defaults, ...overrides };
  if (overrides.maxRetainedCount !== undefined && overrides.retainedWarningCount === undefined) {
    merged.retainedWarningCount = Math.ceil(overrides.maxRetainedCount * 0.8);
  }
  if (overrides.maxRetainedBytes !== undefined && overrides.retainedWarningBytes === undefined) {
    merged.retainedWarningBytes = Math.ceil(overrides.maxRetainedBytes * 0.8);
  }
  return Object.freeze(merged);
}

export function estimateHistoryCandidateBytes(
  candidate: EvidenceCandidate,
  estimator?: (candidate: EvidenceCandidate) => number,
  serializedPayloadBytes?: number
): number {
  // The estimator remains a test-only seam for deterministic pressure tests.
  // Production accounting always includes the canonical payload and frame.
  const bytes = estimator
    ? estimator(candidate)
    : journalAccountedBytes(
        serializedPayloadBytes ?? serializeJournalEvidenceCandidate(candidate).bytes
      );
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("The replay-payload byte estimator must return a non-negative safe integer.");
  }
  return bytes;
}

export function pressureFor(
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements
): HistoryPressure {
  const oldestPendingAgeMs = measurements.oldestPendingAgeMs;
  const nearLimit =
    measurements.retainedCount >= limits.retainedWarningCount ||
    measurements.retainedBytes >= limits.retainedWarningBytes ||
    measurements.pendingBytes >= limits.pendingWarningBytes ||
    (oldestPendingAgeMs !== null && oldestPendingAgeMs >= limits.pendingAgeWarningMs);
  return Object.freeze({ nearLimit, measurements: Object.freeze({ ...measurements }) });
}

export function admissionFailure(
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements,
  candidateBytes: number
): Readonly<{ reason: HistoryTerminalReason; dimension: HistoryCapacityDimension }> | null {
  const retainedCount = measurements.retainedCount + measurements.pendingCount + 1;
  const retainedBytes = measurements.retainedBytes + measurements.pendingBytes + candidateBytes;
  if (measurements.pendingBytes + candidateBytes > limits.pendingStopBytes) {
    return { reason: "PENDING_BYTE_LIMIT", dimension: "PENDING_BYTES" };
  }
  if (
    measurements.oldestPendingAgeMs !== null &&
    measurements.oldestPendingAgeMs >= limits.pendingAgeStopMs
  ) {
    return { reason: "PENDING_AGE_LIMIT", dimension: "PENDING_AGE" };
  }
  if (retainedCount > limits.maxRetainedCount) {
    return { reason: "RETAINED_COUNT_LIMIT", dimension: "RETAINED_COUNT" };
  }
  if (retainedBytes > limits.maxRetainedBytes) {
    return { reason: "RETAINED_BYTE_LIMIT", dimension: "RETAINED_BYTES" };
  }
  return null;
}

export function pendingAgeFailure(
  limits: HistoryCapacityLimits,
  oldestPendingAgeMs: number | null
): boolean {
  return oldestPendingAgeMs !== null && oldestPendingAgeMs >= limits.pendingAgeStopMs;
}

export function defaultHistoryTimer(): HistoryTimer {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number)
  };
}
