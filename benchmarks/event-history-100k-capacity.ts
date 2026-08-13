import {
  HISTORY_CAPACITY_LIMITS,
  MIB,
  admissionFailure,
  pressureFor,
  type HistoryCapacityDimension,
  type HistoryCapacityLimits,
  type HistoryTerminalReason
} from "../src/core/event-history-capacity";
import {
  createEventHistoryWorkloadEvent,
  type EventHistoryShape
} from "./event-history-workloads";
import {
  journalAccountedBytes,
  serializeJournalEvidenceCandidate
} from "../src/core/event-history-serialization";

const normal = HISTORY_CAPACITY_LIMITS.NORMAL;

const activatedLimits: HistoryCapacityLimits = Object.freeze({
  ...normal,
  maxRetainedCount: 100_000,
  maxRetainedBytes: 256 * MIB,
  retainedWarningCount: 80_000,
  retainedWarningBytes: Math.ceil(256 * MIB * 0.8)
});

/**
 * Normal-tier limits used by the release proof. Pending pressure and the
 * lower startup-memory tier stay exactly on their shipped limits.
 */
export const DORMANT_100K_CAPACITY_PROFILE = Object.freeze({
  id: "normal-100k-canonical-256m",
  status: "ACTIVATED" as const,
  tier: "NORMAL" as const,
  fallback: null,
  limits: activatedLimits
});

export const DORMANT_100K_TARGET_COUNT = 100_000;

export const DORMANT_CAPACITY_WORKLOADS = Object.freeze([
  "small-lifecycle",
  "ordinary-item-update",
  "large-json-rich",
  "representative-50-40-10"
] as const);

export type DormantCapacityWorkload = (typeof DORMANT_CAPACITY_WORKLOADS)[number];

type IdentitySample = Readonly<{
  index: number;
  eventId: string;
}>;

export type DormantIdentityDigest = Readonly<{
  count: number;
  rollingDigest: string;
  firstEventId: string | null;
  lastEventId: string | null;
  samples: readonly IdentitySample[];
  firstMismatch: Readonly<{
    index: number;
    expectedEventId: string;
    actualEventId: string;
  }> | null;
}>;

export type DormantCapacityAccounting = Readonly<{
  /** Canonical replay-complete payload plus the logical journal frame. */
  canonicalLogicalBytes: number;
  rejectedCanonicalLogicalBytes: number;
  offeredCanonicalLogicalBytes: number;
  /** Optional physical measurement supplied by a real IndexedDB runner. */
  physicalIndexedDbUsageBytes: number | null;
  physicalIndexedDbUsageDeltaBytes: number | null;
  physicalIndexedDbUsageStatus: "MEASURED" | "NOT_MEASURED";
  quotaBytes: number | null;
  canonicalLogicalBytesIsQuotaReservation: false;
  physicalIndexedDbUsageIsQuotaReservation: false;
  quotaBytesIsReservation: false;
}>;

export type DormantCapacityProof = Readonly<{
  profileId: string;
  workload: DormantCapacityWorkload;
  requestedOfferCount: number;
  offeredCount: number;
  targetCount: number;
  acceptedCount: number;
  refusedCount: number;
  outcome: "REACHED_TARGET" | "REFUSED_BELOW_TARGET";
  warningReached: boolean;
  workloadCounts: Readonly<Record<EventHistoryShape, number>>;
  expected: DormantIdentityDigest;
  expectedAccepted: DormantIdentityDigest;
  published: DormantIdentityDigest;
  retained: DormantIdentityDigest;
  accounting: DormantCapacityAccounting;
  correctness: Readonly<{
    orderedPublication: boolean;
    orderedRetention: boolean;
    boundaryIdentity: boolean;
    exactFirstMissing: boolean;
  }>;
  terminal: Readonly<{
    reason: HistoryTerminalReason | null;
    dimension: HistoryCapacityDimension | null;
    committedBoundary: Readonly<{ sequence: number; eventId: string }> | null;
    firstMissingEventId: string | null;
  }>;
}>;

export type DormantCapacityProofOptions = Readonly<{
  workload: DormantCapacityWorkload;
  runId?: string;
  offeredCount?: number;
  physicalIndexedDbUsageBytes?: number | null;
  physicalIndexedDbUsageDeltaBytes?: number | null;
  quotaBytes?: number | null;
}>;

type IdentityDigestTracker = Readonly<{
  add(index: number, eventId: string): void;
  snapshot(): DormantIdentityDigest;
}>;

const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;

function deterministicSampleIndices(count: number): readonly number[] {
  const candidates = [
    0,
    1,
    2,
    Math.floor(count / 2),
    Math.max(0, count - 3),
    Math.max(0, count - 2),
    Math.max(0, count - 1)
  ];
  return Object.freeze([...new Set(candidates.filter((index) => index >= 0 && index < count))].sort((a, b) => a - b));
}

function rollIdentityDigest(hash: number, index: number, eventId: string): number {
  const value = `${index}\u0000${eventId}\u0000`;
  let next = hash;
  for (let character = 0; character < value.length; character += 1) {
    next ^= value.charCodeAt(character);
    next = Math.imul(next, FNV_PRIME) >>> 0;
  }
  return next >>> 0;
}

function createIdentityDigestTracker(
  count: number,
  expectedEventIdAt?: (index: number) => string
): IdentityDigestTracker {
  const sampleIndices = deterministicSampleIndices(count);
  const sampleIndexSet = new Set(sampleIndices);
  const samples: IdentitySample[] = [];
  let observedCount = 0;
  let rollingDigest = FNV_OFFSET;
  let firstEventId: string | null = null;
  let lastEventId: string | null = null;
  let firstMismatch: DormantIdentityDigest["firstMismatch"] = null;

  return {
    add(index, eventId) {
      if (firstEventId === null) firstEventId = eventId;
      lastEventId = eventId;
      observedCount += 1;
      rollingDigest = rollIdentityDigest(rollingDigest, index, eventId);
      if (sampleIndexSet.has(index)) samples.push(Object.freeze({ index, eventId }));
      if (firstMismatch === null && expectedEventIdAt !== undefined) {
        const expectedEventId = expectedEventIdAt(index);
        if (expectedEventId !== eventId) {
          firstMismatch = Object.freeze({ index, expectedEventId, actualEventId: eventId });
        }
      }
    },
    snapshot() {
      return Object.freeze({
        count: observedCount,
        rollingDigest: rollingDigest.toString(16).padStart(8, "0"),
        firstEventId,
        lastEventId,
        samples: Object.freeze(samples.slice()),
        firstMismatch
      });
    }
  };
}

function expectedEventIdAt(
  workload: DormantCapacityWorkload,
  sequence: number,
  runId: string
): string {
  const shape = shapeForWorkload(workload, sequence);
  return `${runId}-${shape}-${sequence}`;
}

function shapeForWorkload(workload: DormantCapacityWorkload, sequence: number): EventHistoryShape {
  if (workload !== "representative-50-40-10") return workload;
  const bucket = sequence % 10;
  return bucket < 5 ? "small-lifecycle" : bucket < 9 ? "ordinary-item-update" : "large-json-rich";
}

function createWorkloadCandidate(
  workload: DormantCapacityWorkload,
  sequence: number,
  runId: string
) {
  return createEventHistoryWorkloadEvent(shapeForWorkload(workload, sequence), sequence, runId);
}

function validateCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function validateOptionalBytes(value: number | null | undefined, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer or null.`);
  return value;
}

function sameDigest(left: DormantIdentityDigest, right: DormantIdentityDigest): boolean {
  return left.count === right.count
    && left.rollingDigest === right.rollingDigest
    && left.firstEventId === right.firstEventId
    && left.lastEventId === right.lastEventId
    && left.firstMismatch === null
    && right.firstMismatch === null
    && left.samples.length === right.samples.length
    && left.samples.every((sample, index) => {
      const other = right.samples[index];
      return other?.index === sample.index && other.eventId === sample.eventId;
    });
}

function emptyWorkloadCounts(): Record<EventHistoryShape, number> {
  return {
    "small-lifecycle": 0,
    "ordinary-item-update": 0,
    "large-json-rich": 0
  };
}

/**
 * Runs the activated capacity proof's deterministic admission model. It uses
 * the production serializer and admission decision, but it does not open
 * IndexedDB or claim that canonical bytes reserve physical storage/quota.
 * A physical usage sample can be supplied by a separate runner when one is
 * available; the proof remains truthful when that measurement is absent.
 */
export function runDormantCapacityProof(options: DormantCapacityProofOptions): DormantCapacityProof {
  const requestedOfferCount = validateCount(options.offeredCount ?? DORMANT_100K_TARGET_COUNT, "offeredCount");
  const runId = options.runId ?? `history-100k-${options.workload}`;
  const physicalIndexedDbUsageBytes = validateOptionalBytes(options.physicalIndexedDbUsageBytes, "physicalIndexedDbUsageBytes");
  const physicalIndexedDbUsageDeltaBytes = validateOptionalBytes(options.physicalIndexedDbUsageDeltaBytes, "physicalIndexedDbUsageDeltaBytes");
  const quotaBytes = validateOptionalBytes(options.quotaBytes, "quotaBytes");
  const sampleCount = Math.max(requestedOfferCount, DORMANT_100K_TARGET_COUNT);
  const expected = createIdentityDigestTracker(sampleCount);
  const expectedAccepted = createIdentityDigestTracker(sampleCount);
  const published = createIdentityDigestTracker(sampleCount, (index) => expectedEventIdAt(options.workload, index, runId));
  const retained = createIdentityDigestTracker(sampleCount, (index) => expectedEventIdAt(options.workload, index, runId));
  const workloadCounts = emptyWorkloadCounts();
  const measurements = {
    retainedCount: 0,
    retainedBytes: 0,
    pendingCount: 0,
    pendingBytes: 0,
    oldestPendingAgeMs: null
  };
  let offeredCount = 0;
  let acceptedCount = 0;
  let refusedCount = 0;
  let canonicalLogicalBytes = 0;
  let rejectedCanonicalLogicalBytes = 0;
  let warningReached = false;
  let terminalReason: HistoryTerminalReason | null = null;
  let terminalDimension: HistoryCapacityDimension | null = null;
  let firstMissingEventId: string | null = null;
  let firstMissingIndex: number | null = null;

  for (let sequence = 0; sequence < requestedOfferCount; sequence += 1) {
    const candidate = createWorkloadCandidate(options.workload, sequence, runId);
    const shape = shapeForWorkload(options.workload, sequence);
    workloadCounts[shape] += 1;
    offeredCount += 1;
    expected.add(sequence, candidate.id);
    const accountedBytes = journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes);
    const failure = terminalReason === null
      ? admissionFailure(DORMANT_100K_CAPACITY_PROFILE.limits, measurements, accountedBytes)
      : { reason: terminalReason, dimension: terminalDimension! };
    if (failure !== null) {
      refusedCount += 1;
      rejectedCanonicalLogicalBytes += accountedBytes;
      if (firstMissingEventId === null) {
        firstMissingEventId = candidate.id;
        firstMissingIndex = sequence;
        terminalReason = failure.reason;
        terminalDimension = failure.dimension;
      }
      // One refused candidate is enough to prove the exact terminal boundary;
      // do not manufacture a post-terminal identity collection.
      break;
    }
    acceptedCount += 1;
    canonicalLogicalBytes += accountedBytes;
    measurements.retainedCount += 1;
    measurements.retainedBytes += accountedBytes;
    expectedAccepted.add(sequence, candidate.id);
    published.add(sequence, candidate.id);
    retained.add(sequence, candidate.id);
    if (pressureFor(DORMANT_100K_CAPACITY_PROFILE.limits, measurements).nearLimit) warningReached = true;
  }

  const expectedDigest = expected.snapshot();
  const expectedAcceptedDigest = expectedAccepted.snapshot();
  const publishedDigest = published.snapshot();
  const retainedDigest = retained.snapshot();
  const committedBoundary = acceptedCount === 0
    ? null
    : { sequence: acceptedCount, eventId: retainedDigest.lastEventId! };
  const exactFirstMissing = firstMissingIndex === null
    ? firstMissingEventId === null
    : firstMissingEventId === expectedEventIdAt(options.workload, firstMissingIndex, runId);
  const orderedPublication = sameDigest(expectedAcceptedDigest, publishedDigest);
  const orderedRetention = sameDigest(expectedAcceptedDigest, retainedDigest);
  const boundaryIdentity = committedBoundary === null
    ? acceptedCount === 0
    : committedBoundary.sequence === acceptedCount
      && committedBoundary.eventId === expectedEventIdAt(options.workload, acceptedCount - 1, runId);
  return Object.freeze({
    profileId: DORMANT_100K_CAPACITY_PROFILE.id,
    workload: options.workload,
    requestedOfferCount,
    offeredCount,
    targetCount: DORMANT_100K_TARGET_COUNT,
    acceptedCount,
    refusedCount,
    outcome: acceptedCount >= DORMANT_100K_TARGET_COUNT ? "REACHED_TARGET" : "REFUSED_BELOW_TARGET",
    warningReached,
    workloadCounts: Object.freeze({ ...workloadCounts }),
    expected: expectedDigest,
    expectedAccepted: expectedAcceptedDigest,
    published: publishedDigest,
    retained: retainedDigest,
    accounting: Object.freeze({
      canonicalLogicalBytes,
      rejectedCanonicalLogicalBytes,
      offeredCanonicalLogicalBytes: canonicalLogicalBytes + rejectedCanonicalLogicalBytes,
      physicalIndexedDbUsageBytes,
      physicalIndexedDbUsageDeltaBytes,
      physicalIndexedDbUsageStatus: physicalIndexedDbUsageBytes === null ? "NOT_MEASURED" : "MEASURED",
      quotaBytes,
      canonicalLogicalBytesIsQuotaReservation: false as const,
      physicalIndexedDbUsageIsQuotaReservation: false as const,
      quotaBytesIsReservation: false as const
    }),
    correctness: Object.freeze({
      orderedPublication,
      orderedRetention,
      boundaryIdentity,
      exactFirstMissing
    }),
    terminal: Object.freeze({
      reason: terminalReason,
      dimension: terminalDimension,
      committedBoundary,
      firstMissingEventId
    })
  });
}

export function runDormant100kCandidateProofSuite(): readonly DormantCapacityProof[] {
  return Object.freeze([
    runDormantCapacityProof({
      workload: "small-lifecycle",
      runId: "history-100k-small-count",
      offeredCount: DORMANT_100K_TARGET_COUNT + 1
    }),
    runDormantCapacityProof({
      workload: "ordinary-item-update",
      runId: "history-100k-ordinary-envelope"
    }),
    runDormantCapacityProof({
      workload: "large-json-rich",
      runId: "history-100k-large-oversized"
    }),
    runDormantCapacityProof({
      workload: "representative-50-40-10",
      runId: "history-100k-representative-mix"
    })
  ]);
}
