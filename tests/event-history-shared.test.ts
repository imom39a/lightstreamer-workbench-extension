import { describe, expect, it } from "vitest";

import {
  DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE,
  HistoryContinuityLedger,
  JournalIntegrityError,
  MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE,
  gapBarrierFacts,
  isDeterministicJournalError,
  replayChunkSize,
  retentionLowWater,
  type PendingGapBarrier
} from "../src/core/event-history-shared";

const interval = { id: "session:interval-1", ordinal: 1 };

function barrier(count: number): PendingGapBarrier {
  const seed = (captureOrdinal: number) => ({ captureOrdinal, eventId: `event-${captureOrdinal}`, candidateBytes: 10, occurredAt: 1, dimension: "PENDING_BYTES" as const });
  return {
    kind: "gap-barrier",
    count,
    first: seed(4),
    latest: seed(3 + count),
    problem: { code: "PENDING_OVERFLOW", message: "overflow" },
    settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: { code: "PENDING_OVERFLOW", message: "overflow" }, committedEvidenceBoundary: null }),
    resolve: () => undefined
  };
}

describe("shared Event History helpers", () => {
  it("accumulates and resets explicit Evidence Gaps", () => {
    const ledger = new HistoryContinuityLedger();
    expect(ledger.status()).toEqual({ state: "CONTIGUOUS", gapCount: 0, firstGap: null, latestGap: null });
    const after = { intervalId: interval.id, sequence: 3, eventId: "event-3" };
    const single = gapBarrierFacts(barrier(1), interval, after);
    expect(single.latest).toBe(single.first);
    ledger.record(single.first, single.latest, 1);
    const triple = gapBarrierFacts(barrier(3), interval, after);
    ledger.record(triple.first, triple.latest, 3);
    expect(ledger.status()).toMatchObject({
      state: "GAPPED",
      gapCount: 4,
      firstGap: { captureOrdinal: 4, afterEvidence: after, interval },
      latestGap: { captureOrdinal: 6 }
    });
    expect(Object.isFrozen(ledger.status())).toBe(true);
    ledger.reset();
    expect(ledger.status().state).toBe("CONTIGUOUS");
  });

  it("classifies deterministic journal failures for no-retry fallback", () => {
    expect(isDeterministicJournalError(new DOMException("dup", "ConstraintError"))).toBe(true);
    expect(isDeterministicJournalError(new DOMException("bad", "DataError"))).toBe(true);
    expect(isDeterministicJournalError(new JournalIntegrityError("incoherent"))).toBe(true);
    expect(isDeterministicJournalError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isDeterministicJournalError(new DOMException("full", "QuotaExceededError"))).toBe(false);
    expect(isDeterministicJournalError(new Error("Timed out while committing Evidence."))).toBe(false);
    expect(isDeterministicJournalError(null)).toBe(false);
  });

  it("bounds retention targets and replay chunks", () => {
    expect(retentionLowWater(0)).toBe(0);
    expect(retentionLowWater(1)).toBe(1);
    expect(retentionLowWater(25_000)).toBe(22_500);
    expect(replayChunkSize({ from: "NOW" })).toBe(DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE);
    expect(replayChunkSize({ from: "NOW", chunkSize: 0 })).toBe(DEFAULT_COOPERATIVE_FOLLOW_CHUNK_SIZE);
    expect(replayChunkSize({ from: "NOW", chunkSize: 10 })).toBe(10);
    expect(replayChunkSize({ from: "NOW", chunkSize: 1_000_000 })).toBe(MAX_COOPERATIVE_FOLLOW_CHUNK_SIZE);
  });
});
