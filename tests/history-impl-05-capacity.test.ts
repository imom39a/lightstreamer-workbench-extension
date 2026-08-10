import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate,
  type EventHistory,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import {
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

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

type ManualTimer = {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  fireDue(): void;
  advance(ms: number): void;
};

function manualTimer(start = 0): ManualTimer & { now: () => number } {
  let now = start;
  let nextHandle = 1;
  const timers = new Map<number, { callback: () => void; due: number }>();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      timers.set(handle, { callback, due: now + Math.max(0, delay) });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fireDue() {
      for (const [handle, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
    advance(ms) {
      now += ms;
      this.fireDue();
    }
  };
}

async function indexedHistory(id: string, options: Record<string, unknown> = {}): Promise<EventHistory> {
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(id));
  return openEventHistory({ panelSessionId: id, ...options } as never);
}

function collect(history: EventHistory): HistoryPublication[] {
  const publications: HistoryPublication[] = [];
  history.follow({ from: "NOW" }, (publication) => publications.push(publication));
  return publications;
}

describe.each([
  ["memory", async (options: Record<string, unknown> = {}) => createMemoryEventHistoryForTests({ panelSessionId: "impl-05-memory", ...options } as never)],
  ["indexeddb", async (options: Record<string, unknown> = {}) => indexedHistory("impl-05-indexeddb", options)]
])("history-impl-05 %s", (_name, create) => {
  it("admits equality and refuses the first retained crossing with a terminal diagnostic", async () => {
    const history = await create({ capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 } });
    const publications = collect(history);
    await history.offer(candidate("one")).settled;
    await history.offer(candidate("two")).settled;
    const refused = history.offer(candidate("three"));

    expect(refused.intake).toBe("REFUSED");
    await expect(refused.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_COUNT_LIMIT", dimension: "RETAINED_COUNT" }
    });
    await expect(history.offer(candidate("four")).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_COUNT_LIMIT" }
    });
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({
        reason: "RETAINED_COUNT_LIMIT",
        dimension: "RETAINED_COUNT",
        firstMissingEventId: "three"
      })
    }));
    await history.close();
  });

  it.each([
    ["retained bytes", "RETAINED_BYTE_LIMIT", "RETAINED_BYTES", { maxRetainedCount: 20, maxRetainedBytes: 16 }],
    ["pending bytes", "PENDING_BYTE_LIMIT", "PENDING_BYTES", { maxRetainedCount: 20, maxRetainedBytes: 1_000, pendingStopBytes: 16 }]
  ] as const)("refuses the first %s crossing while equality remains admitted", async (_label, code, dimension, capacity) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity,
      byteEstimator: () => 8,
      commitBatch: async () => gate
    });
    const first = history.offer(candidate("equal-one"));
    const second = history.offer(candidate("equal-two"));
    expect(first.intake).toBe("QUEUED");
    expect(second.intake).toBe("QUEUED");
    const crossing = history.offer(candidate("crossing"));
    expect(crossing.intake).toBe("REFUSED");
    await expect(crossing.settled).resolves.toMatchObject({
      problem: { code, dimension }
    });
    release();
    await Promise.all([first.settled, second.settled]);
    await history.close();
  });

  it("clears NEAR_LIMIT only after retained and pending pressure are all below threshold", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: { maxRetainedCount: 20, maxRetainedBytes: 1_000, pendingWarningBytes: 16 },
      byteEstimator: () => 8,
      commitBatch: async () => gate
    });
    const publications = collect(history);
    const first = history.offer(candidate("warning-one"));
    const second = history.offer(candidate("warning-two"));
    expect(publications.some((entry) => entry.type === "status" && entry.status.capacity.state === "NEAR_LIMIT")).toBe(true);
    release();
    await Promise.all([first.settled, second.settled]);
    expect(publications.some((entry) => entry.type === "status" && entry.status.capacity.state === "AVAILABLE")).toBe(true);
    await history.close();
  });

  it("uses a deterministic estimator and timer for warning entry, age latching, and drain order", async () => {
    const timer = manualTimer();
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "impl-05-pressure",
      clock: timer.now,
      timer,
      byteEstimator: () => 8,
      capacityTier: "LOWER",
      capacity: {
        maxRetainedCount: 20,
        maxRetainedBytes: 1_000,
        pendingWarningBytes: 16,
        pendingStopBytes: 32,
        pendingAgeWarningMs: 10,
        pendingAgeStopMs: 30
      },
      commitBatch: async () => stalled
    });
    const publications = collect(history);
    const first = history.offer(candidate("first"));
    const second = history.offer(candidate("second"));
    const third = history.offer(candidate("third"));
    expect(first.intake).toBe("QUEUED");
    expect(second.intake).toBe("QUEUED");
    expect(third.intake).toBe("QUEUED");
    timer.advance(10);
    expect(publications).toContainEqual(expect.objectContaining({
      type: "status",
      status: expect.objectContaining({ capacity: expect.objectContaining({ state: "NEAR_LIMIT" }) })
    }));
    timer.advance(20);
    const refused = history.offer(candidate("age-crossing"));
    expect(refused.intake).toBe("REFUSED");
    expect(publications).toContainEqual(expect.objectContaining({
      type: "status",
      status: expect.objectContaining({ phase: "DRAINING_TO_STOP" })
    }));
    release();
    await expect(first.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await expect(second.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await expect(third.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await expect(refused.settled).resolves.toMatchObject({ problem: { code: "PENDING_AGE_LIMIT" } });
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
    await history.close();
  });

  it("lets a journal failure supersede an earlier proactive drain and rejects the queue without sequences", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "impl-05-failure",
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 1_000_000 },
      commitBatch: async (batch: readonly EvidenceCandidate[]) => {
        if (batch.some((entry) => entry.id === "fails")) throw new Error("injected failure");
      }
    });
    await history.offer(candidate("committed")).settled;
    const failed = history.offer(candidate("fails"));
    const tail = history.offer(candidate("tail"));
    await expect(failed.settled).resolves.toMatchObject({ problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(tail.settled).resolves.toMatchObject({ problem: { code: "JOURNAL_COMMIT_FAILED" } });
    const read = await history.read({});
    expect(read).toMatchObject({ ok: true, value: { evidence: [expect.objectContaining({ eventId: "committed", sequence: 1 })] } });
    await expect(history.offer(candidate("after-stop")).settled).resolves.toMatchObject({
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await history.close();
  });

  it("publishes the journal terminal reason when failure wins an active proactive drain", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: { maxRetainedCount: 3, maxRetainedBytes: 1_000_000 },
      commitBatch: async (batch: readonly EvidenceCandidate[]) => {
        if (batch.some((entry) => entry.id === "fails")) {
          started();
          await gate;
          throw new Error("injected failure");
        }
      }
    });
    const publications = collect(history);
    await history.offer(candidate("prior")).settled;
    const failed = history.offer(candidate("fails"));
    await startedPromise;
    const equal = history.offer(candidate("equal-after-failure-start"));
    const proactive = history.offer(candidate("crossing-after-failure-start"));
    expect(proactive.intake).toBe("REFUSED");
    release();
    await expect(failed.settled).resolves.toMatchObject({ problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(equal.settled).resolves.toMatchObject({ problem: { code: "JOURNAL_COMMIT_FAILED" } });
    const terminal = publications.find((entry) => entry.type === "terminal");
    expect(terminal).toMatchObject({ type: "terminal", terminal: { reason: "JOURNAL_COMMIT_FAILED" } });
    await expect(history.read({})).resolves.toMatchObject({ ok: true, value: { total: 1 } });
    await history.close();
  });
});
