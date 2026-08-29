import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type EvidenceCandidate,
  type HistoryPublication,
  type OpenEventHistoryOptions
} from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

type Factory = (options?: OpenEventHistoryOptions) => Promise<EventHistory>;

const factories: readonly [string, Factory][] = [
  ["memory", (options = {}) => createMemoryEventHistoryForTests(options)],
  ["indexeddb", (options = {}) => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    return createIndexedDbEventHistory({
      ...options,
      panelSessionId: options.panelSessionId ?? `capacity-continuity-${Date.now()}-${Math.random()}`
    });
  }]
];

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

describe.each(factories)("history-impl-05 continuity-first capacity (%s)", (_name, createHistory) => {
  it("keeps estimator validation local to one invalid offer", async () => {
    let estimate = -1;
    const history = await createHistory({ byteEstimator: () => estimate });
    try {
      await expect(history.offer(candidate("invalid-estimate")).settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "INVALID_CANDIDATE" }
      });
      estimate = 10;
      await expect(history.offer(candidate("valid-after-estimate")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      expect(history.status()).toMatchObject({ phase: "RUNNING", accepted: 1, notAccepted: 1 });
    } finally {
      await history.close();
    }
  });

  it("rolls the oldest prefix toward low water and never publishes terminal capacity", async () => {
    const history = await createHistory({
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 3, maxRetainedBytes: 1_000 }
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    try {
      for (let sequence = 1; sequence <= 4; sequence += 1) {
        await expect(history.offer(candidate(`event-${sequence}`)).settled).resolves.toMatchObject({
          outcome: "BECAME_EVIDENCE",
          evidence: { sequence }
        });
      }
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ sequence: 3, eventId: "event-3" }),
            expect.objectContaining({ sequence: 4, eventId: "event-4" })
          ]
        }
      });
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        accepted: 4,
        retained: 2,
        continuity: { state: "CONTIGUOUS", gapCount: 0 },
        retention: { evicted: { count: 2, bytes: 20 } }
      });
      expect(publications.some(({ type }) => type === "retention-advanced")).toBe(true);
      expect(publications.some(({ type }) => type === "terminal")).toBe(false);
    } finally {
      await history.close();
    }
  });

  it("isolates an individually unretainable candidate as a gap and accepts later activity", async () => {
    const history = await createHistory({
      byteEstimator: (event) => event.id === "oversized" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });
    try {
      await expect(history.offer(candidate("oversized")).settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "CANDIDATE_UNRETAINABLE", dimension: "RETAINED_BYTES" }
      });
      await expect(history.offer(candidate("later")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "later" }
      });
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          firstGap: { captureOrdinal: 1, eventId: "oversized" }
        }
      });
    } finally {
      await history.close();
    }
  });

  it("bounds pending bytes by dropping only the crossing candidate, then resumes normally", async () => {
    let release!: () => void;
    const firstCommit = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const history = await createHistory({
      byteEstimator: () => 10,
      capacity: { pendingWarningBytes: 10, pendingStopBytes: 15 },
      commitBatch: () => {
        if (!first) return;
        first = false;
        return firstCommit;
      }
    });
    try {
      const queued = history.offer(candidate("queued"));
      await Promise.resolve();
      await expect(history.offer(candidate("overflow")).settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "PENDING_OVERFLOW", dimension: "PENDING_BYTES" }
      });
      release();
      await expect(queued.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
      await expect(history.offer(candidate("after-pressure")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { eventId: "after-pressure" }
      });
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        accepted: 2,
        notAccepted: 1,
        continuity: { state: "GAPPED", gapCount: 1 }
      });
    } finally {
      release?.();
      await history.close();
    }
  });

  it("opens a bounded memory circuit after three commit failures without losing the batch", async () => {
    const failure = vi.fn(async () => { throw new Error("journal unavailable"); });
    const history = await createHistory({ commitBatch: failure });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    try {
      await expect(history.offer(candidate("survives")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      await expect(history.offer(candidate("later")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });
      expect(failure).toHaveBeenCalledTimes(3);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        persistence: {
          mode: "MEMORY_ONLY",
          health: "DEGRADED",
          retryCount: 2,
          failureCount: 3
        },
        continuity: { state: "CONTIGUOUS", gapCount: 0 }
      });
      expect(publications).toContainEqual(expect.objectContaining({
        type: "persistence-state",
        transition: "MEMORY_FALLBACK"
      }));
      expect(publications.some(({ type }) => type === "terminal")).toBe(false);
    } finally {
      await history.close();
    }
  });
});
