import { describe, expect, it } from "vitest";

import {
  DORMANT_100K_CAPACITY_PROFILE,
  DORMANT_100K_TARGET_COUNT,
  runDormant100kCandidateProofSuite,
  runDormantCapacityProof
} from "../benchmarks/event-history-100k-capacity";
import { HISTORY_CAPACITY_LIMITS, MIB } from "../src/core/event-history-capacity";

describe("history-100k-01 dormant capacity profile", () => {
  it("names a normal-only 100,000-record/256 MiB candidate and preserves production tiers", () => {
    expect(DORMANT_100K_CAPACITY_PROFILE).toMatchObject({
      id: "normal-100k-canonical-256m",
      status: "CANDIDATE_ONLY",
      tier: "NORMAL",
      fallback: null,
      limits: {
        maxRetainedCount: 100_000,
        maxRetainedBytes: 256 * MIB,
        retainedWarningCount: 80_000,
        retainedWarningBytes: Math.ceil(256 * MIB * 0.8),
        pendingWarningBytes: 16 * MIB,
        pendingStopBytes: 32 * MIB,
        pendingAgeWarningMs: 10_000,
        pendingAgeStopMs: 30_000
      }
    });
    expect(HISTORY_CAPACITY_LIMITS.NORMAL).toMatchObject({
      maxRetainedCount: 10_000,
      maxRetainedBytes: 64 * MIB,
      retainedWarningCount: 8_000,
      retainedWarningBytes: Math.ceil(64 * MIB * 0.8)
    });
    expect(HISTORY_CAPACITY_LIMITS.LOWER).toMatchObject({
      maxRetainedCount: 5_000,
      maxRetainedBytes: 32 * MIB,
      retainedWarningCount: 4_000,
      retainedWarningBytes: Math.ceil(32 * MIB * 0.8)
    });
  });

  it("proves count, byte, publication-order, and first-missing boundaries without identity arrays", { timeout: 30_000 }, () => {
    const proofs = runDormant100kCandidateProofSuite();
    expect(proofs.map((proof) => proof.workload)).toEqual([
      "small-lifecycle",
      "ordinary-item-update",
      "large-json-rich",
      "representative-50-40-10"
    ]);

    for (const proof of proofs) {
      expect(proof.profileId).toBe(DORMANT_100K_CAPACITY_PROFILE.id);
      expect(proof.correctness).toEqual({
        orderedPublication: true,
        orderedRetention: true,
        boundaryIdentity: true,
        exactFirstMissing: true
      });
      expect(proof.published.count).toBe(proof.acceptedCount);
      expect(proof.retained.count).toBe(proof.acceptedCount);
      expect(proof.expected.samples.length).toBeLessThanOrEqual(7);
      expect(proof.published.samples.length).toBeLessThanOrEqual(7);
      expect(proof.retained.samples.length).toBeLessThanOrEqual(7);
      expect("expectedEventIds" in proof).toBe(false);
      expect("publishedEventIds" in proof).toBe(false);
      expect("retainedEventIds" in proof).toBe(false);
    }

    const small = proofs[0]!;
    expect(small.acceptedCount).toBe(DORMANT_100K_TARGET_COUNT);
    expect(small.refusedCount).toBe(1);
    expect(small.outcome).toBe("REACHED_TARGET");
    expect(small.terminal).toMatchObject({
      reason: "RETAINED_COUNT_LIMIT",
      dimension: "RETAINED_COUNT",
      firstMissingEventId: "history-100k-small-count-small-lifecycle-100000",
      committedBoundary: {
        sequence: DORMANT_100K_TARGET_COUNT,
        eventId: "history-100k-small-count-small-lifecycle-99999"
      }
    });

    const ordinary = proofs[1]!;
    expect(ordinary.acceptedCount).toBe(DORMANT_100K_TARGET_COUNT);
    expect(ordinary.refusedCount).toBe(0);
    expect(ordinary.terminal.reason).toBeNull();

    const large = proofs[2]!;
    expect(large.acceptedCount).toBeLessThan(DORMANT_100K_TARGET_COUNT);
    expect(large.outcome).toBe("REFUSED_BELOW_TARGET");
    expect(large.terminal.reason).toBe("RETAINED_BYTE_LIMIT");
    expect(large.terminal.firstMissingEventId).toBeTruthy();
    expect(large.accounting.canonicalLogicalBytes).toBeLessThan(256 * MIB);

    const representative = proofs[3]!;
    expect(representative.acceptedCount).toBe(DORMANT_100K_TARGET_COUNT);
    expect(representative.refusedCount).toBe(0);
    expect(representative.workloadCounts).toEqual({
      "small-lifecycle": 50_000,
      "ordinary-item-update": 40_000,
      "large-json-rich": 10_000
    });
    expect(representative.accounting.canonicalLogicalBytes).toBeLessThan(256 * MIB);
    expect(representative.warningReached).toBe(true);
  });

  it("keeps logical bytes, physical IndexedDB usage, and quota estimates distinct", () => {
    const proof = runDormantCapacityProof({
      workload: "ordinary-item-update",
      offeredCount: 2,
      physicalIndexedDbUsageBytes: 12_345,
      physicalIndexedDbUsageDeltaBytes: 6_789,
      quotaBytes: 99_999
    });

    expect(proof.accounting).toMatchObject({
      canonicalLogicalBytes: expect.any(Number),
      physicalIndexedDbUsageBytes: 12_345,
      physicalIndexedDbUsageDeltaBytes: 6_789,
      physicalIndexedDbUsageStatus: "MEASURED",
      quotaBytes: 99_999,
      canonicalLogicalBytesIsQuotaReservation: false,
      physicalIndexedDbUsageIsQuotaReservation: false,
      quotaBytesIsReservation: false
    });
  });
});
