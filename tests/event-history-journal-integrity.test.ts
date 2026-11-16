import { IDBDatabase, IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvidenceCandidate, HistoryPublication } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { AUTHORITATIVE_EVENT_STORE_NAMES, authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";

function candidate(id: string): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "subscription-1", mode: "MERGE", items: ["item-1"], fields: ["price"] },
    item: { name: "item-1", position: 1 },
    update: { isSnapshot: false, fields: { price: "1" }, changedFields: { price: "1" } }
  } as EvidenceCandidate;
}

function countEvidenceRecords(databaseName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const count = database
        .transaction(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, "readonly")
        .objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence)
        .count();
      count.onerror = () => { database.close(); reject(count.error); };
      count.onsuccess = () => { database.close(); resolve(count.result); };
    };
  });
}

describe("IndexedDB journal commit integrity", () => {
  beforeEach(() => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts a commit whose request-issuing phase throws so no Evidence auto-commits without its control record", async () => {
    const panelSessionId = `journal-integrity-issue-${Date.now()}`;
    const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      if (this.name === AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections) {
        throw new DOMException("projection add refused", "DataError");
      }
      return originalAdd.apply(this, args);
    });
    const history = await createIndexedDbEventHistory({ panelSessionId });
    try {
      await expect(history.offer(candidate("issue-1")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      expect(history.status()).toMatchObject({
        persistence: {
          mode: "MEMORY_ONLY",
          // A deterministic DataError is not retried.
          commitAttempts: 1,
          retryCount: 0,
          lastProblem: { message: expect.stringContaining("projection add refused") }
        }
      });
      await expect(countEvidenceRecords(authoritativeEventDatabaseName(panelSessionId))).resolves.toBe(0);
    } finally {
      vi.restoreAllMocks();
      await history.close();
    }
  });

  it("reports the real cause when an aggregate update aborts the commit", async () => {
    const panelSessionId = `journal-integrity-aggregate-${Date.now()}`;
    const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      if (this.name === AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates) {
        throw new DOMException("aggregate add refused", "DataError");
      }
      return originalAdd.apply(this, args);
    });
    const history = await createIndexedDbEventHistory({ panelSessionId });
    try {
      await expect(history.offer(candidate("aggregate-1")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
      expect(history.status()).toMatchObject({
        persistence: {
          mode: "MEMORY_ONLY",
          commitAttempts: 1,
          lastProblem: { message: expect.stringContaining("aggregate add refused") }
        }
      });
      await expect(countEvidenceRecords(authoritativeEventDatabaseName(panelSessionId))).resolves.toBe(0);
    } finally {
      vi.restoreAllMocks();
      await history.close();
    }
  });

  it("does not retry a deterministic ConstraintError", async () => {
    let attempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-integrity-constraint-${Date.now()}`,
      failure: {
        commitBatch: () => {
          attempts += 1;
          throw new DOMException("duplicate key", "ConstraintError");
        }
      }
    });
    try {
      await expect(history.offer(candidate("constraint-1")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
      expect(attempts).toBe(1);
      expect(history.status()).toMatchObject({
        persistence: { mode: "MEMORY_ONLY", commitAttempts: 1, retryCount: 0, failureCount: 1 }
      });
    } finally {
      await history.close();
    }
  });

  it("backs off between bounded retries of a transient failure", async () => {
    const attemptTimes: number[] = [];
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-integrity-backoff-${Date.now()}`,
      failure: {
        commitBatch: () => {
          attemptTimes.push(performance.now());
          if (attemptTimes.length < 3) throw new DOMException("transaction aborted", "AbortError");
        }
      }
    });
    try {
      await expect(history.offer(candidate("transient-1")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1 }
      });
      expect(attemptTimes).toHaveLength(3);
      expect(attemptTimes[1]! - attemptTimes[0]!).toBeGreaterThanOrEqual(8);
      expect(attemptTimes[2]! - attemptTimes[1]!).toBeGreaterThanOrEqual(attemptTimes[1]! - attemptTimes[0]! - 2);
      expect(history.status()).toMatchObject({
        persistence: { mode: "JOURNAL", health: "HEALTHY", commitAttempts: 3, retryCount: 2, failureCount: 2 }
      });
    } finally {
      await history.close();
    }
  });
});

describe("IndexedDB journal fallback carry", () => {
  beforeEach(() => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records an unreadable durable prefix as an explicit Evidence Gap instead of a routine Retention Advance", async () => {
    let cutoverAttempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-carry-unreadable-${Date.now()}`,
      commitBatch: (batch) => {
        if (!batch.some((entry) => entry.id === "suffix-3")) return;
        cutoverAttempts += 1;
        if (cutoverAttempts === 3) {
          vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
            throw new Error("durable prefix unavailable");
          });
        }
        throw new Error("journal cutover");
      }
    });
    const publications: HistoryPublication[] = [];
    const unsubscribe = history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    try {
      await history.offer(candidate("durable-1")).settled;
      await history.offer(candidate("durable-2")).settled;
      await expect(history.offer(candidate("suffix-3")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 3 }
      });
      const gaps = publications.filter((publication) => publication.type === "acceptance-gap");
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({
        gap: { dimension: "JOURNAL", eventId: "durable-1", captureOrdinal: 1, afterEvidence: null },
        problem: { code: "JOURNAL_COMMIT_FAILED", dimension: "JOURNAL" }
      });
      expect(history.status()).toMatchObject({
        persistence: { mode: "MEMORY_ONLY" },
        retainedRange: { first: { sequence: 3 }, last: { sequence: 3 } },
        retained: 1,
        continuity: {
          state: "GAPPED",
          gapCount: 2,
          firstGap: { eventId: "durable-1", dimension: "JOURNAL" },
          latestGap: { eventId: "durable-2", dimension: "JOURNAL" }
        }
      });
      // The Retained Range still advances so projections drop removed rows.
      expect(publications).toContainEqual(expect.objectContaining({
        type: "retention-advanced",
        evicted: expect.objectContaining({ count: 2, first: expect.objectContaining({ sequence: 1 }), last: expect.objectContaining({ sequence: 2 }) })
      }));
    } finally {
      unsubscribe();
      vi.restoreAllMocks();
      await history.close();
    }
  });

  it("trims the durable prefix to the memory retention target before materializing it", async () => {
    let failing = false;
    let spied = false;
    const evidenceCursorLowerBounds: number[] = [];
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-carry-trim-${Date.now()}`,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 1_000_000 },
      fallbackCapacity: { maxRetainedCount: 4 },
      commitBatch: () => {
        if (!failing) return;
        if (!spied) {
          spied = true;
          const originalOpenCursor = IDBObjectStore.prototype.openCursor;
          vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["openCursor"]>) {
            const [range] = args;
            if (this.name === AUTHORITATIVE_EVENT_STORE_NAMES.evidence) {
              evidenceCursorLowerBounds.push(range instanceof IDBKeyRange ? Number(range.lower) : 0);
            }
            return originalOpenCursor.apply(this, args);
          });
        }
        throw new Error("journal cutover");
      }
    });
    const publications: HistoryPublication[] = [];
    const unsubscribe = history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    try {
      for (let index = 1; index <= 8; index += 1) await history.offer(candidate(`durable-${index}`)).settled;
      failing = true;
      await expect(history.offer(candidate("volatile-9")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 9 }
      });
      // Memory low water is 3: two durable records plus the failed batch.
      expect(history.status()).toMatchObject({
        persistence: { mode: "MEMORY_ONLY" },
        capacity: { tier: "LOWER", limits: { maxRetainedCount: 4 } },
        retainedRange: { first: { sequence: 7 }, last: { sequence: 9 } },
        retained: 3,
        continuity: { state: "CONTIGUOUS", gapCount: 0 }
      });
      expect(publications.some((publication) => publication.type === "acceptance-gap")).toBe(false);
      expect(evidenceCursorLowerBounds.length).toBeGreaterThan(0);
      expect(Math.min(...evidenceCursorLowerBounds)).toBe(7);
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 3,
          evidence: [
            expect.objectContaining({ eventId: "durable-7" }),
            expect.objectContaining({ eventId: "durable-8" }),
            expect.objectContaining({ eventId: "volatile-9" })
          ]
        }
      });
    } finally {
      unsubscribe();
      vi.restoreAllMocks();
      await history.close();
    }
  });

  it("carries the newest readable chunks and reports only the unreadable older records as a gap", async () => {
    const DURABLE = 1_500;
    let cutoverAttempts = 0;
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-carry-chunks-${Date.now()}`,
      commitBatch: (batch) => {
        if (!batch.some((entry) => entry.id === "volatile-tail")) return;
        cutoverAttempts += 1;
        if (cutoverAttempts === 3) {
          const originalTransaction = IDBDatabase.prototype.transaction;
          let reads = 0;
          vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
            reads += 1;
            if (reads > 1) throw new Error("older durable chunk unavailable");
            return originalTransaction.apply(this, args);
          });
        }
        throw new Error("journal cutover");
      }
    });
    const publications: HistoryPublication[] = [];
    const unsubscribe = history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    try {
      await Promise.all(Array.from({ length: DURABLE }, (_, index) => history.offer(candidate(`durable-${index + 1}`)).settled));
      await history.offer(candidate("volatile-tail")).settled;
      vi.restoreAllMocks();
      const status = history.status();
      expect(status.retained).toBeGreaterThan(1);
      expect(status.retained).toBeLessThan(DURABLE + 1);
      const firstCarried = status.retainedRange!.first.sequence;
      expect(status).toMatchObject({
        retainedRange: { last: { sequence: DURABLE + 1 } },
        continuity: {
          state: "GAPPED",
          gapCount: firstCarried - 1,
          firstGap: { eventId: "durable-1", dimension: "JOURNAL" },
          latestGap: { eventId: `durable-${firstCarried - 1}`, dimension: "JOURNAL" }
        }
      });
      const read = await history.read({ order: "asc" });
      expect(read.ok && read.value.evidence.map((entry) => entry.sequence)).toEqual(
        Array.from({ length: DURABLE + 2 - firstCarried }, (_, index) => firstCarried + index)
      );
      expect(publications.filter((publication) => publication.type === "acceptance-gap")).toHaveLength(1);
    } finally {
      unsubscribe();
      vi.restoreAllMocks();
      await history.close();
    }
  });
});

describe("IndexedDB journal reads", () => {
  beforeEach(() => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bounds evidence cursors by the latched Retained Range and afterSequence", async () => {
    const history = await createIndexedDbEventHistory({
      panelSessionId: `journal-read-ranges-${Date.now()}`,
      capacity: { maxRetainedCount: 5, maxRetainedBytes: 1_000_000 }
    });
    try {
      for (let index = 1; index <= 6; index += 1) await history.offer(candidate(`ranged-${index}`)).settled;
      const first = history.status().retainedRange!.first.sequence;
      expect(first).toBeGreaterThan(1);
      const ranges: Array<readonly [number, number] | null> = [];
      const originalOpenCursor = IDBObjectStore.prototype.openCursor;
      vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["openCursor"]>) {
        const [range] = args;
        if (this.name === AUTHORITATIVE_EVENT_STORE_NAMES.evidence) {
          ranges.push(range instanceof IDBKeyRange ? [Number(range.lower), Number(range.upper)] as const : null);
        }
        return originalOpenCursor.apply(this, args);
      });

      const after = await history.read({ afterSequence: 4 });
      expect(after.ok && after.value.evidence.map((entry) => entry.sequence)).toEqual([5, 6]);
      expect(ranges.at(-1)).toEqual([5, 6]);

      const all = await history.read({});
      expect(all.ok && all.value.evidence.map((entry) => entry.sequence)).toEqual(
        Array.from({ length: 7 - first }, (_, index) => first + index)
      );
      expect(ranges.at(-1)).toEqual([first, 6]);

      const kindPage = await history.read({ candidateKind: "lightstreamer", limit: 2, order: "desc" });
      expect(kindPage.ok && kindPage.value.evidence.map((entry) => entry.sequence)).toEqual([6, 5]);
      expect(ranges.at(-1)).toEqual([first, 6]);

      const count = ranges.length;
      const empty = await history.read({ afterSequence: 6 });
      expect(empty.ok && empty.value.evidence).toEqual([]);
      expect(ranges).toHaveLength(count);
    } finally {
      vi.restoreAllMocks();
      await history.close();
    }
  });
});
