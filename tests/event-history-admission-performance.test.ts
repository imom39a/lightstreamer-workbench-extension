import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  createMemoryEventHistoryForTests,
  type EvidenceCandidate,
  type HistoryStatus
} from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName, deleteAuthoritativeEventDatabase } from "../src/core/indexeddb/authoritative-event-db";

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

function statusFrom(publications: readonly unknown[]): HistoryStatus | undefined {
  const publication = [...publications].reverse().find((entry) =>
    typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "status"
  ) as { status?: HistoryStatus } | undefined;
  return publication?.status;
}

describe("Event History admission accounting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not sort the awaiting queues during a large synchronous burst", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const history = await createMemoryEventHistoryForTests({
      commitBatch: async () => commitGate
    });
    const sort = vi.spyOn(Array.prototype, "sort");

    const receipts = Array.from({ length: 1_692 }, (_, index) => history.offer(candidate(`burst-${index}`)));

    expect(receipts.every((receipt) => receipt.intake === "QUEUED")).toBe(true);
    expect(sort.mock.calls.filter(([compare]) => typeof compare === "function")).toHaveLength(0);
    releaseCommit();
    await expect(Promise.all(receipts.map((receipt) => receipt.settled))).resolves.toHaveLength(1_692);
    await history.close();
  });

  it("keeps pending count, bytes, and oldest identity correct across in-flight and pending queues", async () => {
    let releaseCommit!: () => void;
    let markCommitStarted!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
    const publications: unknown[] = [];
    const history = await createMemoryEventHistoryForTests({
      capacity: { pendingWarningBytes: 10, pendingStopBytes: 35 },
      byteEstimator: () => 10,
      commitBatch: async () => {
        markCommitStarted();
        await commitGate;
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    const first = history.offer(candidate("in-flight-first"));
    await commitStarted;
    const second = history.offer(candidate("pending-second"));
    const third = history.offer(candidate("pending-third"));
    const fourth = history.offer(candidate("pending-fourth"));
    expect(fourth.intake).toBe("REFUSED");
    releaseCommit();
    await expect(fourth.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "PENDING_BYTE_LIMIT" } });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({ triggerMeasurements: expect.objectContaining({ pendingCount: 3, pendingBytes: 30 }) })
    }));
    await expect(Promise.all([first, second, third].map((receipt) => receipt.settled))).resolves.toHaveLength(3);
  });

  it("retains post-clear pending pressure and rejoins it without changing order", async () => {
    let releaseClear!: () => void;
    let markClearStarted!: () => void;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const clearStarted = new Promise<void>((resolve) => { markClearStarted = resolve; });
    let clearCalls = 0;
    const publications: unknown[] = [];
    const history = await createMemoryEventHistoryForTests({
      capacity: { pendingWarningBytes: 10, pendingStopBytes: 100 },
      byteEstimator: () => 10,
      clearJournal: async () => {
        clearCalls += 1;
        if (clearCalls > 1) return;
        markClearStarted();
        await clearGate;
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await expect(history.offer(candidate("before-clear")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    const clear = history.clear();
    await clearStarted;
    const after = history.offer(candidate("after-clear"));
    expect(statusFrom(publications)?.capacity.measurements).toMatchObject({ pendingCount: 1, pendingBytes: 10 });

    releaseClear();
    await expect(clear).resolves.toMatchObject({ ok: true });
    await expect(after.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: "after-clear" } });
    await history.close();
  });

  it("uses the same O(1) admission accounting for IndexedDB in-flight and pending work", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const panelSessionId = "admission-indexeddb-counters";
    await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
    let releaseCommit!: () => void;
    let markCommitStarted!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
    const publications: unknown[] = [];
    const history = await createIndexedDbEventHistory({
      panelSessionId,
      capacity: { pendingWarningBytes: 10, pendingStopBytes: 35 },
      byteEstimator: () => 10,
      commitBatch: async () => {
        markCommitStarted();
        await commitGate;
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    const first = history.offer(candidate("idb-in-flight-first"));
    await commitStarted;
    const second = history.offer(candidate("idb-pending-second"));
    const third = history.offer(candidate("idb-pending-third"));
    const fourth = history.offer(candidate("idb-pending-fourth"));
    expect(fourth.intake).toBe("REFUSED");
    releaseCommit();
    await expect(fourth.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "PENDING_BYTE_LIMIT" } });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({ triggerMeasurements: expect.objectContaining({ pendingCount: 3, pendingBytes: 30 }) })
    }));
    await expect(Promise.all([first, second, third].map((receipt) => receipt.settled))).resolves.toHaveLength(3);
    await history.close();
  });
});
