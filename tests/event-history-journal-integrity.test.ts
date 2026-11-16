import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvidenceCandidate } from "../src/core/event-history-authoritative";
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
