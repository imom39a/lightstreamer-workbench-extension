import { IDBDatabase, IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvidenceCandidate, HistoryPublication } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

function candidate(id: string): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update"
  } as EvidenceCandidate;
}

describe("continuity-first IndexedDB Event History", () => {
  beforeEach(() => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  });

  it("rolls the oldest retained prefix instead of stopping at the count high-water mark", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-roll-${Date.now()}`,
      capacity: { maxRetainedCount: 3, maxRetainedBytes: 1_000_000 }
    });

    const publications: string[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication.type));
    try {
      for (let sequence = 1; sequence <= 4; sequence += 1) {
        await expect(history.offer(candidate(`event-${sequence}`)).settled).resolves.toMatchObject({
          outcome: "BECAME_EVIDENCE",
          evidence: { sequence }
        });
      }

      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        committedEvidenceBoundary: { sequence: 4 },
        retainedRange: { first: { sequence: 3 }, last: { sequence: 4 } },
        retained: 2,
        retention: {
          policy: "ROLLING",
          lowWater: { count: 2 },
          evicted: { count: 2 },
          lastAdvance: { evicted: { count: 2 }, retainedRange: { first: { sequence: 3 } } }
        }
      });
      expect(publications).toContain("retention-advanced");
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ eventId: "event-3", sequence: 3 }),
            expect.objectContaining({ eventId: "event-4", sequence: 4 })
          ]
        }
      });
    } finally {
      await history.close();
    }
  });

  it("removes the entire durable prefix before rolling a newer volatile suffix", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-roll-${Date.now()}`,
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-2")) throw new Error("journal cutover");
      }
    });

    try {
      await expect(history.offer(candidate("durable-1")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      await expect(history.offer(candidate("volatile-2")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });
      await expect(history.offer(candidate("volatile-3")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 3 }
      });

      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        committedEvidenceBoundary: { sequence: 3 },
        retainedRange: { first: { sequence: 3 }, last: { sequence: 3 } },
        retained: 1,
        retention: {
          evicted: { count: 2 },
          lastAdvance: {
            evicted: { first: { sequence: 1 }, last: { sequence: 2 } },
            retainedRange: { first: { sequence: 3 }, last: { sequence: 3 } }
          }
        }
      });
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 1,
          retainedRange: { first: { sequence: 3 }, last: { sequence: 3 } },
          evidence: [expect.objectContaining({ eventId: "volatile-3", sequence: 3 })]
        }
      });
    } finally {
      await history.close();
    }
  });

  it("keeps bounded memory ingestion off the journal after circuit break", async () => {
    let failedJournalCalls = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-open-circuit-${Date.now()}`,
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "cutover-2")) {
          failedJournalCalls += 1;
          throw new Error("journal circuit opened");
        }
      }
    });
    let restoreTransaction: (() => void) | null = null;

    try {
      await expect(history.offer(candidate("durable-1")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      await expect(history.offer(candidate("cutover-2")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });
      expect(failedJournalCalls).toBe(3);
      expect(history.status()).toMatchObject({ persistence: { mode: "MEMORY_ONLY" } });

      const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
      restoreTransaction = () => transactionSpy.mockRestore();
      for (const [eventId, sequence] of [["memory-3", 3], ["memory-4", 4], ["memory-5", 5]] as const) {
        await expect(history.offer(candidate(eventId)).settled).resolves.toMatchObject({
          outcome: "BECAME_EVIDENCE",
          evidence: { eventId, sequence }
        });
      }

      expect(transactionSpy).not.toHaveBeenCalled();
      expect(failedJournalCalls).toBe(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        committedEvidenceBoundary: { sequence: 5 },
        retainedRange: { first: { sequence: 5 }, last: { sequence: 5 } },
        retained: 1,
        persistence: { mode: "MEMORY_ONLY" }
      });

      restoreTransaction();
      restoreTransaction = null;
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 1,
          evidence: [expect.objectContaining({ eventId: "memory-5", sequence: 5 })]
        }
      });
    } finally {
      restoreTransaction?.();
      await history.close();
    }
  });

  it("drops only the candidate that would overflow the pending heap budget", async () => {
    let releaseCommit!: () => void;
    let markStarted!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const commitStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-pending-${Date.now()}`,
      byteEstimator: () => 6,
      capacity: { maxRetainedBytes: 1_000, pendingStopBytes: 10 },
      commitBatch: async () => {
        markStarted();
        await commitGate;
      }
    });

    try {
      const first = history.offer(candidate("pending-first"));
      await commitStarted;
      const overflow = history.offer(candidate("pending-overflow"));
      expect(overflow.intake).toBe("REFUSED");
      releaseCommit();
      await expect(overflow.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "PENDING_OVERFLOW", dimension: "PENDING_BYTES" },
        committedEvidenceBoundary: { sequence: 1, eventId: "pending-first" }
      });
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          latestGap: {
            eventId: "pending-overflow",
            dimension: "PENDING_BYTES",
            afterEvidence: { sequence: 1, eventId: "pending-first" }
          }
        }
      });

      await expect(first.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } });
      await expect(history.offer(candidate("after-backlog")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "after-backlog" }
      });
      expect(history.status()).toMatchObject({ phase: "RUNNING", captureOperation: "RUNNING", accepted: 2, notAccepted: 1 });
    } finally {
      releaseCommit();
      await history.close();
    }
  });

  it("queries the durable prefix and volatile continuation as one ordered retained range", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile")) throw new Error("journal cutover");
      }
    });

    try {
      await expect(history.offer(candidate("durable")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      await expect(history.offer(candidate("volatile")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });

      const result = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          storage: "MEMORY_FALLBACK",
          totals: { matching: 2, inScope: 2 },
          page: { evidence: [
            expect.objectContaining({ identity: expect.objectContaining({ sequence: 1, eventId: "durable" }) }),
            expect.objectContaining({ identity: expect.objectContaining({ sequence: 2, eventId: "volatile" }) })
          ] }
        }
      });
    } finally {
      await history.close();
    }
  });

  it("reads the preserved durable prefix without returning to IndexedDB after cutover", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-detached-read-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "detached-volatile-2")) throw new Error("journal cutover");
      }
    });
    let restoreTransaction: (() => void) | null = null;

    try {
      await history.offer(candidate("detached-durable-1")).settled;
      await history.offer(candidate("detached-volatile-2")).settled;

      const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
        throw new Error("journal must remain detached");
      });
      restoreTransaction = () => transactionSpy.mockRestore();
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          retainedRange: { first: { sequence: 1 }, last: { sequence: 2 } },
          evidence: [
            expect.objectContaining({ eventId: "detached-durable-1", sequence: 1 }),
            expect.objectContaining({ eventId: "detached-volatile-2", sequence: 2 })
          ]
        }
      });
      await expect(history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
      })).resolves.toMatchObject({
        ok: true,
        value: {
          storage: "MEMORY_FALLBACK",
          totals: { matching: 2, inScope: 2 },
          page: { evidence: [
            expect.objectContaining({ identity: expect.objectContaining({ sequence: 1, eventId: "detached-durable-1" }) }),
            expect.objectContaining({ identity: expect.objectContaining({ sequence: 2, eventId: "detached-volatile-2" }) })
          ] }
        }
      });
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START" },
        (publication) => publications.push(publication)
      );
      try {
        await vi.waitFor(() => {
          expect(publications.flatMap((publication) =>
            publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
          )).toEqual(["detached-durable-1", "detached-volatile-2"]);
        });
      } finally {
        unsubscribe();
      }
      expect(publications.some((publication) => publication.type === "replay-failed")).toBe(false);
      const cooperativePublications: HistoryPublication[] = [];
      const unsubscribeCooperative = history.follow(
        { from: "CURRENT_INTERVAL_START", chunkSize: 1 },
        (publication) => cooperativePublications.push(publication)
      );
      try {
        await vi.waitFor(() => {
          expect(cooperativePublications.some((publication) => publication.type === "replay-complete")).toBe(true);
        });
      } finally {
        unsubscribeCooperative();
      }
      expect(cooperativePublications.flatMap((publication) =>
        publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
      )).toEqual(["detached-durable-1", "detached-volatile-2"]);
      expect(cooperativePublications.some((publication) => publication.type === "replay-failed")).toBe(false);
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      restoreTransaction?.();
      await history.close();
    }
  });

  it("advances retention to the volatile suffix when the durable prefix cannot be detached", async () => {
    let cutoverAttempts = 0;
    const cutoverState: { transactionCalls: number; restoreTransaction: (() => void) | null } = {
      transactionCalls: 0,
      restoreTransaction: null
    };
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-unreadable-prefix-${Date.now()}`,
      commitBatch: (batch) => {
        if (!batch.some((entry) => entry.id === "readable-suffix-2")) return;
        cutoverAttempts += 1;
        if (cutoverAttempts === 3) {
          const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
            cutoverState.transactionCalls += 1;
            throw new Error("durable prefix unavailable");
          });
          cutoverState.restoreTransaction = () => transactionSpy.mockRestore();
        }
        throw new Error("journal cutover");
      }
    });
    const publications: HistoryPublication[] = [];
    const unsubscribe = history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    try {
      await history.offer(candidate("unreadable-durable-1")).settled;
      await expect(history.offer(candidate("readable-suffix-2")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "readable-suffix-2" }
      });
      expect(cutoverAttempts).toBe(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        persistence: { mode: "MEMORY_ONLY" },
        committedEvidenceBoundary: { sequence: 2 },
        retainedRange: { first: { sequence: 2 }, last: { sequence: 2 } },
        retained: 1,
        retention: {
          evicted: { count: 1 },
          lastAdvance: {
            previousRetainedRange: { first: { sequence: 1 }, last: { sequence: 2 } },
            retainedRange: { first: { sequence: 2 }, last: { sequence: 2 } },
            evicted: { count: 1, first: { sequence: 1 }, last: { sequence: 1 } }
          }
        }
      });
      expect(publications).toContainEqual(expect.objectContaining({
        type: "retention-advanced",
        previousRetainedRange: { first: expect.objectContaining({ sequence: 1 }), last: expect.objectContaining({ sequence: 2 }) },
        retainedRange: { first: expect.objectContaining({ sequence: 2 }), last: expect.objectContaining({ sequence: 2 }) },
        evicted: expect.objectContaining({ count: 1, first: expect.objectContaining({ sequence: 1 }), last: expect.objectContaining({ sequence: 1 }) })
      }));
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 1,
          evidence: [expect.objectContaining({ sequence: 2, eventId: "readable-suffix-2" })]
        }
      });
      await expect(history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
      })).resolves.toMatchObject({
        ok: true,
        value: {
          totals: { matching: 1, inScope: 1 },
          page: { evidence: [expect.objectContaining({
            identity: expect.objectContaining({ sequence: 2, eventId: "readable-suffix-2" })
          })] }
        }
      });

      const replayed: HistoryPublication[] = [];
      const stopReplay = history.follow({ from: "CURRENT_INTERVAL_START", chunkSize: 1 }, (publication) => replayed.push(publication));
      try {
        await vi.waitFor(() => expect(replayed.some((publication) => publication.type === "replay-complete")).toBe(true));
      } finally {
        stopReplay();
      }
      expect(replayed.flatMap((publication) =>
        publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
      )).toEqual(["readable-suffix-2"]);
      await expect(history.offer(candidate("unreadable-durable-1")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 3, eventId: "unreadable-durable-1" }
      });
      expect(cutoverState.restoreTransaction).not.toBeNull();
      expect(cutoverState.transactionCalls).toBe(1);
    } finally {
      unsubscribe();
      cutoverState.restoreTransaction?.();
      await history.close();
    }
  });

  it("replays the durable prefix and volatile suffix through non-cooperative follow", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-follow-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-follow-2")) throw new Error("journal cutover");
      }
    });

    try {
      await history.offer(candidate("durable-follow-1")).settled;
      await history.offer(candidate("volatile-follow-2")).settled;
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => publications.push(publication));
      try {
        await vi.waitFor(() => {
          expect(publications.flatMap((publication) =>
            publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
          )).toEqual(["durable-follow-1", "volatile-follow-2"]);
        });
      } finally {
        unsubscribe();
      }
      expect(publications.some((publication) => publication.type === "replay-failed")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("expires non-cooperative memory replay when retention advances its latched range", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-memory-replay-retention-${Date.now()}`,
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "memory-replay-cutover-2")) throw new Error("journal cutover");
      }
    });

    try {
      await history.offer(candidate("memory-replay-durable-1")).settled;
      await history.offer(candidate("memory-replay-cutover-2")).settled;
      const state: { advanceReceipt: ReturnType<typeof history.offer> | null } = { advanceReceipt: null };
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
        publications.push(publication);
        if (state.advanceReceipt === null && publication.type === "status") {
          state.advanceReceipt = history.offer(candidate("memory-replay-retained-3"));
        }
      });
      try {
        await vi.waitFor(() => expect(state.advanceReceipt).not.toBeNull());
        if (state.advanceReceipt === null) throw new Error("Expected retention-advancing Capture.");
        await state.advanceReceipt.settled;
        await vi.waitFor(() => {
          expect(publications).toContainEqual(expect.objectContaining({
            type: "replay-failed",
            problem: expect.objectContaining({
              code: "REPLAY_FAILED",
              message: "Replay expired because retained History advanced."
            })
          }));
        });
      } finally {
        unsubscribe();
      }
      expect(publications.some((publication) => publication.type === "committed-evidence")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("replays the durable prefix and volatile suffix through cooperative follow", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-cooperative-follow-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-cooperative-2")) throw new Error("journal cutover");
      }
    });

    try {
      await history.offer(candidate("durable-cooperative-1")).settled;
      await history.offer(candidate("volatile-cooperative-2")).settled;
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START", chunkSize: 1 },
        (publication) => publications.push(publication)
      );
      try {
        await vi.waitFor(() => {
          expect(publications.some((publication) => publication.type === "replay-complete")).toBe(true);
        });
      } finally {
        unsubscribe();
      }

      expect(publications.flatMap((publication) =>
        publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
      )).toEqual(["durable-cooperative-1", "volatile-cooperative-2"]);
      expect(publications.some((publication) => publication.type === "replay-failed")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("validates a volatile cooperative replay boundary after journal fallback", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-after-follow-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-after-2")) throw new Error("journal cutover");
      }
    });

    try {
      await history.offer(candidate("durable-after-1")).settled;
      const afterReceipt = await history.offer(candidate("volatile-after-2")).settled;
      await history.offer(candidate("volatile-after-3")).settled;
      if (afterReceipt.outcome !== "BECAME_EVIDENCE") throw new Error("Expected volatile Evidence replay boundary.");

      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START", after: afterReceipt.evidence, chunkSize: 1 },
        (publication) => publications.push(publication)
      );
      try {
        await vi.waitFor(() => {
          expect(publications.some((publication) => publication.type === "replay-complete")).toBe(true);
        });
      } finally {
        unsubscribe();
      }

      expect(publications.flatMap((publication) =>
        publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
      )).toEqual(["volatile-after-3"]);
      expect(publications.some((publication) => publication.type === "replay-failed")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("drains a volatile live range queued behind cooperative replay", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-hybrid-live-follow-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-live-2")) throw new Error("journal cutover");
      }
    });

    try {
      await history.offer(candidate("durable-live-1")).settled;
      await history.offer(candidate("volatile-live-2")).settled;
      const publications: HistoryPublication[] = [];
      const replayState: { liveReceipt: ReturnType<typeof history.offer> | null } = { liveReceipt: null };
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START", chunkSize: 1 },
        (publication) => {
          publications.push(publication);
          if (
            replayState.liveReceipt === null
            && publication.type === "committed-evidence"
            && publication.evidence.some((entry) => entry.eventId === "durable-live-1")
          ) {
            replayState.liveReceipt = history.offer(candidate("queued-live-3"));
          }
        }
      );
      try {
        await vi.waitFor(() => expect(replayState.liveReceipt).not.toBeNull());
        if (replayState.liveReceipt === null) throw new Error("Expected a live receipt during replay.");
        await replayState.liveReceipt.settled;
        await vi.waitFor(() => {
          expect(publications.flatMap((publication) =>
            publication.type === "committed-evidence" ? publication.evidence.map((entry) => entry.eventId) : []
          )).toEqual(["durable-live-1", "volatile-live-2", "queued-live-3"]);
        });
      } finally {
        unsubscribe();
      }
      expect(publications.some((publication) => publication.type === "replay-failed")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("publishes replay failure when a queued live range read rejects", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-live-read-failure-${Date.now()}`
    });
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const state: {
      captureContinuation: boolean;
      continuation: (() => void) | null;
      liveReceipt: ReturnType<typeof history.offer> | null;
    } = { captureContinuation: false, continuation: null, liveReceipt: null };
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
      if (state.captureContinuation && delay === 0) {
        state.captureContinuation = false;
        state.continuation = () => callback(...args);
        return undefined as unknown as ReturnType<typeof setTimeout>;
      }
      return nativeSetTimeout(callback, delay, ...args);
    });
    let transactionSpy: ReturnType<typeof vi.spyOn> | null = null;

    try {
      await history.offer(candidate("live-read-replay-1")).settled;
      await history.offer(candidate("live-read-replay-2")).settled;
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START", chunkSize: 1 },
        (publication) => {
          publications.push(publication);
          if (
            state.liveReceipt === null
            && publication.type === "committed-evidence"
            && publication.evidence.some((entry) => entry.eventId === "live-read-replay-1")
          ) {
            state.liveReceipt = history.offer(candidate("queued-live-read-3"));
            state.captureContinuation = true;
          }
        }
      );
      try {
        await vi.waitFor(() => expect(state.continuation).not.toBeNull());
        if (state.liveReceipt === null) throw new Error("Expected a queued live receipt.");
        await state.liveReceipt.settled;

        let transactionCalls = 0;
        transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
          transactionCalls += 1;
          if (transactionCalls === 2) throw new Error("queued live range unavailable");
          return Reflect.apply(nativeTransaction, this, args);
        });
        if (state.continuation === null) throw new Error("Expected a queued replay continuation.");
        state.continuation();
        await vi.waitFor(() => {
          expect(publications).toContainEqual(expect.objectContaining({
            type: "replay-failed",
            problem: expect.objectContaining({ code: "REPLAY_FAILED", message: "queued live range unavailable" })
          }));
        });
        expect(transactionCalls).toBe(2);
      } finally {
        unsubscribe();
      }
    } finally {
      transactionSpy?.mockRestore();
      timeoutSpy.mockRestore();
      await history.close();
    }
  });

  it("expires cooperative replay when Clear changes its latched interval", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-clear-replay-${Date.now()}`
    });
    const nativeSetTimeout = globalThis.setTimeout;
    const state: {
      captureContinuation: boolean;
      continuation: (() => void) | null;
      clearPromise: ReturnType<typeof history.clear> | null;
    } = { captureContinuation: false, continuation: null, clearPromise: null };
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
      if (state.captureContinuation && delay === 0) {
        state.captureContinuation = false;
        state.continuation = () => callback(...args);
        return undefined as unknown as ReturnType<typeof setTimeout>;
      }
      return nativeSetTimeout(callback, delay, ...args);
    });

    try {
      await history.offer(candidate("clear-replay-1")).settled;
      await history.offer(candidate("clear-replay-2")).settled;
      const publications: HistoryPublication[] = [];
      const unsubscribe = history.follow(
        { from: "CURRENT_INTERVAL_START", chunkSize: 1 },
        (publication) => {
          publications.push(publication);
          if (
            state.clearPromise === null
            && publication.type === "committed-evidence"
            && publication.evidence.some((entry) => entry.eventId === "clear-replay-1")
          ) {
            state.clearPromise = history.clear();
            state.captureContinuation = true;
          }
        }
      );
      try {
        await vi.waitFor(() => expect(state.continuation).not.toBeNull());
        if (state.clearPromise === null) throw new Error("Expected Clear during cooperative replay.");
        await expect(state.clearPromise).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
        if (state.continuation === null) throw new Error("Expected a queued replay continuation.");
        state.continuation();
        await vi.waitFor(() => {
          expect(publications).toContainEqual(expect.objectContaining({
            type: "replay-failed",
            problem: expect.objectContaining({
              code: "REPLAY_FAILED",
              message: "Replay expired because the History Interval changed."
            })
          }));
        });
      } finally {
        unsubscribe();
      }
      expect(publications.some((publication) => publication.type === "replay-complete")).toBe(false);
    } finally {
      timeoutSpy.mockRestore();
      await history.close();
    }
  });

  it("retries a transient journal failure twice without exposing a stop", async () => {
    let attempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-retry-${Date.now()}`,
      commitBatch: () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary journal outage");
      }
    });

    try {
      await expect(history.offer(candidate("transient")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "transient" }
      });
      expect(attempts).toBe(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        retained: 1,
        persistence: { mode: "JOURNAL", health: "HEALTHY", commitAttempts: 3, retryCount: 2, failureCount: 2 }
      });
    } finally {
      await history.close();
    }
  });

  it("continues in a coherent volatile segment after persistent journal failure", async () => {
    let attempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-circuit-${Date.now()}`,
      commitBatch: () => {
        attempts += 1;
        throw new Error("journal remains unavailable");
      }
    });

    try {
      await expect(history.offer(candidate("first")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "first" }
      });
      await expect(history.offer(candidate("second")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "second" }
      });

      expect(attempts).toBe(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        committedEvidenceBoundary: { sequence: 2 },
        retained: 2,
        capacity: { tier: "LOWER" },
        persistence: { mode: "MEMORY_ONLY", health: "DEGRADED", commitAttempts: 3, retryCount: 2, failureCount: 3 }
      });
      expect(history.storage.mode).toBe("memory");
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ eventId: "first", sequence: 1 }),
            expect.objectContaining({ eventId: "second", sequence: 2 })
          ]
        }
      });
      const intervalId = history.status().interval.id;
      const hybridQuery = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 1 },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] },
        discover: [{ facet: "kind", size: 10 }],
        lookup: { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence: 1, eventId: "first" },
        find: { text: "second" }
      });
      expect(hybridQuery).toMatchObject({
        ok: true,
        value: {
          storage: "MEMORY_FALLBACK",
          coverage: "COMPLETE",
          totals: { matching: 2, inScope: 2 },
          page: { evidence: [expect.objectContaining({ identity: expect.objectContaining({ eventId: "first", sequence: 1 }) })] },
          lookup: { state: "RETAINED", evidence: { payload: expect.objectContaining({ id: "first" }) } },
          find: { total: 1, first: expect.objectContaining({ eventId: "second", sequence: 2 }) }
        }
      });
      if (!hybridQuery.ok) throw new Error("Expected a hybrid query snapshot.");
      expect(hybridQuery.value.discoveries.get("kind")).toMatchObject({
        state: "AVAILABLE",
        baseEvidenceCount: 2,
        values: [expect.objectContaining({ count: 2, value: expect.objectContaining({ value: "ITEM-UPDATE" }) })]
      });
      expect(hybridQuery.value.page.nextCursor).not.toBeNull();
      const secondPage = await history.query!({
        at: hybridQuery.value.readPoint,
        page: { order: "OLDEST_FIRST", size: 1, cursor: hybridQuery.value.page.nextCursor! },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] },
        discover: [{ facet: "kind", size: 10 }],
        lookup: { intervalId, pageId: intervalId, ownerId: "memory-event-history", sequence: 1, eventId: "first" },
        find: { text: "second" }
      });
      expect(secondPage).toMatchObject({
        ok: true,
        value: { page: { evidence: [expect.objectContaining({ identity: expect.objectContaining({ eventId: "second", sequence: 2 }) })] } }
      });

      const filtered = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: { revision: 1, text: "second", criteria: {}, around: null, unsupported: [] }
      });
      expect(filtered).toMatchObject({
        ok: true,
        value: {
          totals: { matching: 1, inScope: 1 },
          page: { evidence: [expect.objectContaining({ identity: expect.objectContaining({ eventId: "second" }) })] }
        }
      });
    } finally {
      await history.close();
    }
  });

  it("evicts a sole volatile record above the adopted lower byte high-water", async () => {
    const mib = 1_048_576;
    let attempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-lower-bytes-${Date.now()}`,
      byteEstimator: (event) => event.id === "larger-than-memory-tier" ? 40 * mib : 1 * mib,
      capacity: { pendingStopBytes: 64 * mib },
      commitBatch: () => {
        attempts += 1;
        throw new Error("journal remains unavailable");
      }
    });

    try {
      await expect(history.offer(candidate("larger-than-memory-tier")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "larger-than-memory-tier" }
      });

      expect(attempts).toBe(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        committedEvidenceBoundary: { sequence: 1 },
        retainedRange: null,
        retained: 0,
        capacity: {
          tier: "LOWER",
          limits: { maxRetainedBytes: 32 * mib },
          measurements: { retainedBytes: 0 }
        },
        retention: {
          evicted: { count: 1, bytes: 40 * mib },
          lastAdvance: { retainedRange: null, evicted: { first: { sequence: 1 }, last: { sequence: 1 } } }
        }
      });
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: { total: 0, retainedRange: null, evidence: [] }
      });

      await expect(history.offer(candidate("fits-memory-tier")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "fits-memory-tier" }
      });
      expect(history.status()).toMatchObject({
        retained: 1,
        retainedRange: { first: { sequence: 2 }, last: { sequence: 2 } },
        capacity: { measurements: { retainedBytes: 1 * mib } }
      });
    } finally {
      await history.close();
    }
  });

  it("reports Clear failure when durable-prefix erasure fails after journal fallback", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-fallback-clear-${Date.now()}`,
      commitBatch: (batch) => {
        if (batch.some((entry) => entry.id === "volatile-after-durable")) throw new Error("journal cutover");
      }
    });
    let restoreTransaction: (() => void) | null = null;

    try {
      await expect(history.offer(candidate("durable-before-fallback")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      await expect(history.offer(candidate("volatile-after-durable")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });
      const previousInterval = history.status().interval;

      const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
        throw new Error("durable erasure unavailable");
      });
      restoreTransaction = () => transactionSpy.mockRestore();
      await expect(history.clear()).resolves.toMatchObject({
        ok: false,
        problem: { code: "CLEAR_FAILED", message: "durable erasure unavailable" }
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        interval: previousInterval,
        committedEvidenceBoundary: { sequence: 2 },
        retainedRange: { first: { sequence: 1 }, last: { sequence: 2 } },
        retained: 2,
        persistence: { mode: "MEMORY_ONLY" }
      });

      restoreTransaction();
      restoreTransaction = null;
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          interval: previousInterval,
          evidence: [
            expect.objectContaining({ eventId: "durable-before-fallback", sequence: 1 }),
            expect.objectContaining({ eventId: "volatile-after-durable", sequence: 2 })
          ]
        }
      });
      await expect(history.offer(candidate("after-clear-failure")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { eventId: "after-clear-failure", sequence: 3 }
      });
    } finally {
      restoreTransaction?.();
      await history.close();
    }
  });

  it("starts a fresh interval when Clear follows a new unretainable Capture", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-clear-after-gap-${Date.now()}`,
      byteEstimator: () => 11,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });

    try {
      await expect(history.clear()).resolves.toMatchObject({
        ok: true,
        value: { interval: { ordinal: 2 } }
      });
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
    } finally {
      await history.close();
    }
  });

  it("keeps queued intake running when a Clear journal transaction fails", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `continuity-idb-clear-${Date.now()}`,
      clearJournal: () => {
        throw new Error("clear unavailable");
      }
    });

    try {
      await history.offer(candidate("before-clear")).settled;
      const clearing = history.clear();
      const duringClear = history.offer(candidate("during-clear"));

      await expect(clearing).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_FAILED" } });
      await expect(duringClear.settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "during-clear" }
      });
      expect(history.status()).toMatchObject({ phase: "RUNNING", captureOperation: "RUNNING" });
    } finally {
      await history.close();
    }
  });
});
