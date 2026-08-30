import { describe, expect, it } from "vitest";

import {
  createMemoryEventHistoryForTests,
  type EvidenceCandidate,
  type HistoryPublication
} from "../src/core/event-history-authoritative";

function candidate(id: string): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update"
  };
}

describe("continuous memory Event History", () => {
  it("rolls the oldest retained prefix toward the count low-water mark without stopping Capture", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "rolling-count",
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 5, maxRetainedBytes: 1_000 }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    for (let index = 1; index <= 6; index += 1) {
      await expect(history.offer(candidate(`event-${index}`)).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE"
      });
    }

    await expect(history.read({ order: "asc" })).resolves.toMatchObject({
      ok: true,
      value: {
        total: 4,
        evidence: [
          expect.objectContaining({ eventId: "event-3", sequence: 3 }),
          expect.objectContaining({ eventId: "event-4", sequence: 4 }),
          expect.objectContaining({ eventId: "event-5", sequence: 5 }),
          expect.objectContaining({ eventId: "event-6", sequence: 6 })
        ],
        retainedRange: {
          first: expect.objectContaining({ sequence: 3 }),
          last: expect.objectContaining({ sequence: 6 })
        }
      }
    });
    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      captureOperation: "RUNNING",
      accepted: 6,
      retained: 4,
      retention: {
        policy: "ROLLING",
        lowWater: { count: 4, bytes: 900 },
        evicted: { count: 2, bytes: 20 }
      },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "retention-advanced",
      evicted: {
        count: 2,
        bytes: 20,
        first: expect.objectContaining({ sequence: 1 }),
        last: expect.objectContaining({ sequence: 2 })
      }
    }));
    expect(publications.some((publication) => publication.type === "terminal")).toBe(false);
    await history.close();
  });

  it("settles one queued batch that crosses the retention high-water", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "rolling-queued-batch",
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 4, maxRetainedBytes: 1_000 }
    });

    const receipts = Array.from({ length: 8 }, (_, index) => history.offer(candidate(`batch-${index + 1}`)));
    await expect(Promise.all(receipts.map((receipt) => receipt.settled))).resolves.toEqual(
      expect.arrayContaining(Array.from({ length: 8 }, () => expect.objectContaining({ outcome: "BECAME_EVIDENCE" })))
    );
    await expect(history.read({ order: "asc" })).resolves.toMatchObject({
      ok: true,
      value: {
        total: 3,
        evidence: [
          expect.objectContaining({ sequence: 6, eventId: "batch-6" }),
          expect.objectContaining({ sequence: 7, eventId: "batch-7" }),
          expect.objectContaining({ sequence: 8, eventId: "batch-8" })
        ],
        retainedRange: {
          first: expect.objectContaining({ sequence: 6 }),
          last: expect.objectContaining({ sequence: 8 })
        }
      }
    });
    await history.close();
  });

  it("rolls by canonical bytes and retains the newest Evidence", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "rolling-bytes",
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 100, maxRetainedBytes: 25 }
    });

    for (let index = 1; index <= 3; index += 1) {
      await expect(history.offer(candidate(`event-${index}`)).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    }

    await expect(history.read({ order: "asc" })).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [
          expect.objectContaining({ eventId: "event-2" }),
          expect.objectContaining({ eventId: "event-3" })
        ]
      }
    });
    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      retention: { lowWater: { bytes: 22 }, evicted: { count: 1, bytes: 10 } }
    });
    await history.close();
  });

  it("retries a failed journal commit twice and reports recovery without losing Evidence", async () => {
    let attempts = 0;
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "commit-recovered",
      commitBatch: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary journal failure");
      }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await expect(history.offer(candidate("recovered")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "recovered" }
    });

    expect(attempts).toBe(3);
    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      persistence: {
        mode: "JOURNAL",
        health: "HEALTHY",
        commitAttempts: 3,
        retryCount: 2,
        failureCount: 2
      },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "persistence-state",
      transition: "RECOVERED",
      persistence: expect.objectContaining({ mode: "JOURNAL", health: "HEALTHY" })
    }));
    expect(publications.some((publication) => publication.type === "terminal")).toBe(false);
    await history.close();
  });

  it("opens the memory-only circuit after three failed commits and keeps accepting later Evidence", async () => {
    let attempts = 0;
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "commit-memory-circuit",
      commitBatch: async () => {
        attempts += 1;
        throw new Error("persistent journal failure");
      }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await expect(history.offer(candidate("survives-failure")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    await expect(history.offer(candidate("after-circuit")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2 }
    });

    expect(attempts).toBe(3);
    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      captureOperation: "RUNNING",
      accepted: 2,
      notAccepted: 0,
      persistence: {
        mode: "MEMORY_ONLY",
        health: "DEGRADED",
        commitAttempts: 3,
        retryCount: 2,
        failureCount: 3
      },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "persistence-state",
      transition: "MEMORY_FALLBACK",
      problem: expect.objectContaining({ code: "JOURNAL_COMMIT_FAILED" })
    }));
    expect(publications.some((publication) => publication.type === "terminal")).toBe(false);
    await history.close();
  });

  it("enforces the lower memory high-water when fallback happens after admission", async () => {
    const mib = 1024 * 1024;
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "commit-memory-lower-high-water",
      byteEstimator: (event) => event.id === "larger-than-memory-tier" ? 40 * mib : 1 * mib,
      capacity: { pendingStopBytes: 64 * mib },
      commitBatch: async () => { throw new Error("persistent journal failure"); }
    });

    await expect(history.offer(candidate("larger-than-memory-tier")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "larger-than-memory-tier" }
    });
    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      capacity: {
        tier: "LOWER",
        limits: { maxRetainedBytes: 32 * mib },
        measurements: { retainedBytes: 0 }
      },
      retained: 0,
      retainedRange: null,
      retention: { evicted: { count: 1, bytes: 40 * mib } },
      persistence: { mode: "MEMORY_ONLY" },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    await expect(history.read({ order: "asc" })).resolves.toMatchObject({
      ok: true,
      value: { total: 0, evidence: [], retainedRange: null }
    });

    await expect(history.offer(candidate("fits-memory-tier")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "fits-memory-tier" }
    });
    expect(history.status()).toMatchObject({ retained: 1, capacity: { measurements: { retainedBytes: 1 * mib } } });
    await history.close();
  });

  it("marks an individually unretainable candidate as an exact gap and accepts the next event", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "oversized-gap",
      byteEstimator: (event) => event.id === "too-large" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    const oversized = history.offer(candidate("too-large"));
    expect(oversized.intake).toBe("REFUSED");
    await expect(oversized.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "CANDIDATE_UNRETAINABLE", dimension: "RETAINED_BYTES" },
      committedEvidenceBoundary: null
    });
    await expect(history.offer(candidate("later")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "later" }
    });

    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      captureOperation: "RUNNING",
      captured: 2,
      accepted: 1,
      notAccepted: 1,
      continuity: {
        state: "GAPPED",
        gapCount: 1,
        latestGap: {
          captureOrdinal: 1,
          eventId: "too-large",
          candidateBytes: 11,
          afterEvidence: null
        }
      }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "acceptance-gap",
      gap: expect.objectContaining({ captureOrdinal: 1, eventId: "too-large" })
    }));
    expect(publications.some((publication) => publication.type === "terminal")).toBe(false);
    await history.close();
  });

  it("starts a fresh interval when Clear follows a new unretainable Capture", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "clear-after-new-gap",
      byteEstimator: () => 11,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });

    const firstClear = await history.clear();
    expect(firstClear).toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
    await expect(history.offer(candidate("too-large-after-clear")).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "CANDIDATE_UNRETAINABLE" }
    });
    expect(history.status()).toMatchObject({
      interval: { ordinal: 2 },
      continuity: { state: "GAPPED", gapCount: 1 }
    });

    await expect(history.clear()).resolves.toMatchObject({
      ok: true,
      value: { previousInterval: { ordinal: 2 }, interval: { ordinal: 3 } }
    });
    expect(history.status()).toMatchObject({
      interval: { ordinal: 3 },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    await history.close();
  });

  it("refuses only the offer that would overflow pending bytes and resumes after the queue drains", async () => {
    let markCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "pending-overflow-gap",
      byteEstimator: () => 6,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 100, pendingStopBytes: 10 },
      commitBatch: async () => {
        markCommitStarted();
        await commitGate;
      }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    const queued = history.offer(candidate("queued"));
    await commitStarted;
    const overflow = history.offer(candidate("overflow"));
    expect(overflow.intake).toBe("REFUSED");
    releaseCommit();
    await expect(overflow.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "PENDING_OVERFLOW", dimension: "PENDING_BYTES" },
      committedEvidenceBoundary: { sequence: 1, eventId: "queued" }
    });

    await expect(queued.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "queued" }
    });
    await expect(history.offer(candidate("after-pressure")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "after-pressure" }
    });

    expect(history.status()).toMatchObject({
      phase: "RUNNING",
      captured: 3,
      awaitingAcceptance: 0,
      accepted: 2,
      notAccepted: 1,
      continuity: {
        state: "GAPPED",
        gapCount: 1,
        latestGap: {
          captureOrdinal: 2,
          eventId: "overflow",
          candidateBytes: 6,
          dimension: "PENDING_BYTES",
          afterEvidence: { sequence: 1, eventId: "queued" }
        }
      }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "acceptance-gap",
      gap: expect.objectContaining({ captureOrdinal: 2, eventId: "overflow", dimension: "PENDING_BYTES" })
    }));
    expect(publications.some((publication) => publication.type === "terminal")).toBe(false);
    await history.close();
  });
});
