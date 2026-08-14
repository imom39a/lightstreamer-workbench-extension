import { describe, expect, it } from "vitest";

import {
  DORMANT_100K_QUERY_PROFILE,
  runDormant100kQueryProof
} from "../benchmarks/event-history-100k-query";
import { HISTORY_CAPACITY_LIMITS, MIB } from "../src/core/event-history-capacity";

describe("history-100k-02 activated query workload", () => {
  it("proves deterministic 100k bounded query classes without a payload collection", () => {
    const proof = runDormant100kQueryProof();
    const repeated = runDormant100kQueryProof();

    expect(proof).toEqual(repeated);
    expect(proof).toMatchObject({
      profileId: DORMANT_100K_QUERY_PROFILE.id,
      status: "ACTIVATED",
      retainedEvidence: 100_000,
      acceptedPage: { firstSequence: 1, lastSequence: 100, nextAnchorSequence: 100 },
      structuredQuery: {
        postingDriver: "key",
        postingDriverCandidateCount: 100,
        residualCriteriaEvaluated: 100,
        compoundCriteriaPostingSets: 1
      },
      residualQuery: { exactMatchingTotal: 100, firstUsefulSequence: 997 },
      discovery: { exactDistinctTotal: 1_000, materializedValueCount: 100, materializationBound: 100 },
      find: { exactTotal: 100, retainedMatchIdentityBound: 1_000, surroundingWindowBound: 8 },
      passiveCapture: { offeredEvents: 100_000, compactIncrementalEvents: 100_000, coalescedRefreshes: 1, completeRescans: 0 }
    });

    for (const operation of Object.values(proof.operations)) {
      expect(operation).toMatchObject({
        retainedEvidence: 100_000,
        completePayloadCollection: false,
        bounded: true
      });
      expect(operation.maxRetainedPayloadRecords).toBeLessThanOrEqual(101);
      expect(operation.maxRetainedPostingDriverSets).toBeLessThanOrEqual(1);
    }
    expect(proof.operations["find"].maxRetainedCompactIdentities).toBe(1_000);
    expect(proof.operations.discovery.maxRetainedCompactIdentities).toBe(100);
    expect(proof.operations["residual-query"].firstUsefulResultWork).toBe(1);

    expect(DORMANT_100K_QUERY_PROFILE.productionCapacityUnchanged).toBe(false);
    expect(DORMANT_100K_QUERY_PROFILE.productionNormalCapacity).toEqual({
      maxRetainedCount: HISTORY_CAPACITY_LIMITS.NORMAL.maxRetainedCount,
      maxRetainedBytes: 256 * MIB
    });
    expect(DORMANT_100K_QUERY_PROFILE.productionStartupMemoryCapacity).toEqual({
      maxRetainedCount: HISTORY_CAPACITY_LIMITS.LOWER.maxRetainedCount,
      maxRetainedBytes: 32 * MIB
    });
  });
});
