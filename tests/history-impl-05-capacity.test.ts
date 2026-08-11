import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  HISTORY_CAPACITY_LIMITS,
  MIB,
  openEventHistory,
  type CaptureReceipt,
  type EvidenceCandidate,
  type EventHistory,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import { historyCapacityLimits } from "../src/core/event-history-capacity";
import { estimateHistoryCandidateBytes } from "../src/core/event-history-capacity";
import { serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
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

async function readIndexedControl(id: string): Promise<Record<string, unknown>> {
  const request = indexedDB.open(authoritativeEventDatabaseName(id));
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction("historyControl", "readonly");
  const controlRequest = transaction.objectStore("historyControl").get("control");
  const control = await new Promise<Record<string, unknown>>((resolve, reject) => {
    controlRequest.onsuccess = () => resolve(controlRequest.result as Record<string, unknown>);
    controlRequest.onerror = () => reject(controlRequest.error);
  });
  database.close();
  return control;
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
  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY]
  ] as const)("rejects a %s byte-estimator result before admission", async (_label, estimate) => {
    const history = await create({ byteEstimator: () => estimate });

    const refused = history.offer(candidate(`invalid-estimate-${_label}`));

    expect(refused.intake).toBe("REFUSED");
    await expect(refused.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "INVALID_CANDIDATE" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { total: 0, evidence: [] }
    });
    await history.close();
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY]
  ] as const)("does not corrupt terminal refusal accounting for a %s result", async (_label, estimate) => {
    let calls = 0;
    const history = await create({
      capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 },
      byteEstimator: () => {
        calls += 1;
        return calls < 3 ? 8 : estimate;
      }
    });
    const publications = collect(history);

    await expect(history.offer(candidate(`accounted-${_label}-accepted`)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE"
    });
    const crossing = history.offer(candidate(`accounted-${_label}-crossing`));
    const afterStop = history.offer(candidate(`accounted-${_label}-after-stop`));

    await expect(crossing.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_COUNT_LIMIT" }
    });
    await expect(afterStop.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_COUNT_LIMIT" }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({ rejected: { count: 2, bytes: 8 } })
    }));
    await history.close();
  });

  it.each([
    ["NORMAL", {
      maxRetainedCount: 10_000,
      maxRetainedBytes: 64 * MIB,
      retainedWarningCount: 8_000,
      retainedWarningBytes: Math.ceil(64 * MIB * 0.8),
      pendingWarningBytes: 16 * MIB,
      pendingStopBytes: 32 * MIB,
      pendingAgeWarningMs: 10_000,
      pendingAgeStopMs: 30_000
    }],
    ["LOWER", {
      maxRetainedCount: 5_000,
      maxRetainedBytes: 32 * MIB,
      retainedWarningCount: 4_000,
      retainedWarningBytes: Math.ceil(32 * MIB * 0.8),
      pendingWarningBytes: 16 * MIB,
      pendingStopBytes: 32 * MIB,
      pendingAgeWarningMs: 1_000,
      pendingAgeStopMs: 5_000
    }]
  ] as const)("uses the exact %s capacity defaults", (tier, expected) => {
    expect(historyCapacityLimits(tier)).toEqual(expected);
    expect(HISTORY_CAPACITY_LIMITS[tier]).toEqual(expected);
  });

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

  it("settles a terminal refusal with the finalized fail-closed diagnostic", async () => {
    const history = await create({
      capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 }
    });
    await expect(history.offer(candidate("terminal-prefix")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE"
    });

    const refused = history.offer(candidate("terminal-missing"));
    await expect(refused.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: {
        code: "RETAINED_COUNT_LIMIT",
        terminal: {
          reason: "RETAINED_COUNT_LIMIT",
          committedEvidenceBoundary: { sequence: 1, eventId: "terminal-prefix" },
          firstMissingEventId: "terminal-missing"
        }
      },
      committedEvidenceBoundary: { sequence: 1, eventId: "terminal-prefix" }
    });
    await history.close();
  });

  it("uses canonical replay payload plus logical framing for exact retained equality and crossing", async () => {
    const framed = candidate("canonical-frame");
    const expectedBytes = estimateHistoryCandidateBytes(framed);
    expect(expectedBytes).toBe(serializeJournalEvidenceCandidate(framed).bytes + 8);
    const history = await create({ capacity: { maxRetainedCount: 10, maxRetainedBytes: expectedBytes } });
    const publications = collect(history);

    await expect(history.offer(framed).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "status",
      status: expect.objectContaining({ capacity: expect.objectContaining({ measurements: expect.objectContaining({ retainedBytes: expectedBytes }) }) })
    }));
    const crossing = history.offer(candidate("canonical-crossing"));
    expect(crossing.intake).toBe("REFUSED");
    await expect(crossing.settled).resolves.toMatchObject({ problem: { code: "RETAINED_BYTE_LIMIT", dimension: "RETAINED_BYTES" } });
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
    await history.close();
  });

  it("reports pending pressure in canonical journal-accounted bytes", async () => {
    const pendingCandidate = candidate("canonical-pending");
    const expectedBytes = estimateHistoryCandidateBytes(pendingCandidate);
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: {
        maxRetainedCount: 10,
        maxRetainedBytes: 1_000_000,
        pendingWarningBytes: expectedBytes,
        pendingStopBytes: expectedBytes * 2
      },
      commitBatch: async () => {
        started();
        await gate;
      }
    });
    const publications = collect(history);
    const receipt = history.offer(pendingCandidate);
    await startedPromise;

    expect(publications).toContainEqual(expect.objectContaining({
      type: "status",
      status: expect.objectContaining({
        capacity: expect.objectContaining({
          state: "NEAR_LIMIT",
          measurements: expect.objectContaining({ pendingBytes: expectedBytes })
        })
      })
    }));

    release();
    await expect(receipt.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await history.close();
  });

  it.each([
    ["retained count", { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 }, undefined],
    ["retained bytes", { maxRetainedCount: 20, maxRetainedBytes: 16 }, () => 8]
  ] as const)("reserves capacity for an in-flight batch before admitting the crossing %s", async (_label, capacity, byteEstimator) => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity,
      ...(byteEstimator ? { byteEstimator } : {}),
      commitBatch: async () => {
        started();
        await gate;
      }
    });
    const first = history.offer(candidate("in-flight-one"));
    await startedPromise;
    const second = history.offer(candidate("in-flight-two"));
    const crossing = history.offer(candidate("in-flight-crossing"));

    expect(second.intake).toBe("QUEUED");
    expect(crossing.intake).toBe("REFUSED");
    release();
    await expect(crossing.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE" });
    await expect(first.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await expect(second.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await history.close();
  });

  it("defers crossed offer settlement until terminal boundary advances", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      commitBatch: async () => {
        started();
        await gate;
      }
    });

    const first = history.offer(candidate("prefix-one"));
    const second = history.offer(candidate("prefix-two"));
    await startedPromise;
    const crossing = history.offer(candidate("crossing"));
    expect(first.intake).toBe("QUEUED");
    expect(second.intake).toBe("QUEUED");
    expect(crossing.intake).toBe("REFUSED");

    let crossingSettled = false;
    void crossing.settled.then(() => {
      crossingSettled = true;
    });
    await Promise.resolve();
    expect(crossingSettled).toBe(false);

    release();
    await Promise.all([first.settled, second.settled, crossing.settled]);
    await expect(crossing.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_COUNT_LIMIT", dimension: "RETAINED_COUNT" },
      committedEvidenceBoundary: { sequence: 2, eventId: "prefix-two" }
    });
    expect(crossingSettled).toBe(true);
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
    release();
    await expect(crossing.settled).resolves.toMatchObject({
      problem: { code, dimension }
    });
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
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({ firstMissingEventId: "age-crossing" })
    }));
    await history.close();
  });

  it.each(["NORMAL", "LOWER"] as const)("cancels a stale %s age timer after the pending prefix commits", async (capacityTier) => {
    const timer = manualTimer();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstCommit = true;
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: `impl-05-${capacityTier.toLowerCase()}-timer`,
      clock: timer.now,
      timer,
      capacityTier,
      capacity: { pendingAgeWarningMs: 10, pendingAgeStopMs: 30 },
      commitBatch: async () => {
        if (firstCommit) {
          firstCommit = false;
          started();
          await gate;
        }
      }
    });
    const publications = collect(history);
    const first = history.offer(candidate("timer-prefix"));
    await startedPromise;
    release();
    await expect(first.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    timer.advance(100);

    const next = history.offer(candidate("timer-next"));
    await expect(next.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(0);
    await history.close();
  });

  it("does not leave NEAR_LIMIT while a retained warning dimension remains at threshold", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: {
        maxRetainedCount: 10,
        maxRetainedBytes: 1_000,
        retainedWarningCount: 1,
        retainedWarningBytes: 8,
        pendingWarningBytes: 8
      },
      byteEstimator: () => 8,
      commitBatch: async () => gate
    });
    const publications = collect(history);
    const first = history.offer(candidate("retained-warning"));
    expect(publications.some((entry) => entry.type === "status" && entry.status.capacity.state === "NEAR_LIMIT")).toBe(true);
    release();
    await first.settled;
    expect(publications.slice(1).filter((entry) => entry.type === "status" && entry.status.capacity.state === "AVAILABLE")).toHaveLength(0);
    await expect(history.clear()).resolves.toMatchObject({ ok: true });
    expect(publications.some((entry) => entry.type === "interval-cleared" && entry.status.capacity.state === "AVAILABLE")).toBe(true);
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

  it("keeps journal-failure rejected and discarded diagnostics disjoint and exact", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await create({
      capacity: { maxRetainedCount: 3, maxRetainedBytes: 1_000_000 },
      byteEstimator: () => 8,
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
    const queuedTail = history.offer(candidate("queued-tail"));
    const proactive = history.offer(candidate("proactive-crossing"));
    expect(queuedTail.intake).toBe("QUEUED");
    expect(proactive.intake).toBe("REFUSED");
    release();

    await expect(failed.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(queuedTail.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(proactive.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });

    const terminal = publications.find((entry) => entry.type === "terminal");
    expect(terminal).toMatchObject({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        tier: "NORMAL",
        triggerInterval: { ordinal: 1 },
        interval: { ordinal: 1 },
        committedEvidenceBoundary: { sequence: 1, eventId: "prior" },
        retainedRange: {
          first: { sequence: 1, eventId: "prior" },
          last: { sequence: 1, eventId: "prior" }
        },
        firstMissingEventId: "fails",
        rejected: { count: 1, bytes: 8 },
        discarded: { count: 2, bytes: 16 },
        triggerMeasurements: { pendingCount: 2, pendingBytes: 16 }
      }
    });
    expect(Object.keys((terminal as Extract<HistoryPublication, { type: "terminal" }>).terminal).sort()).toEqual([
      "committedEvidenceBoundary",
      "discarded",
      "firstMissingEventId",
      "interval",
      "reason",
      "rejected",
      "retainedRange",
      "tier",
      "triggerInterval",
      "triggerMeasurements",
      "triggerTime",
      "dimension"
    ].sort());
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
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

  it("classifies quota failure as a terminal journal reason", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "impl-05-quota",
      failure: {
        commitBatch: () => { throw new DOMException("quota", "QuotaExceededError"); }
      }
    });
    const publications = collect(history);
    const refused = history.offer(candidate("quota-event"));
    await expect(refused.settled).resolves.toMatchObject({
      problem: { code: "QUOTA_EXCEEDED", reason: "QUOTA_EXCEEDED", dimension: "JOURNAL" }
    });
    expect(publications).toContainEqual(expect.objectContaining({
      type: "terminal",
      terminal: expect.objectContaining({ reason: "QUOTA_EXCEEDED", dimension: "JOURNAL" })
    }));
    await history.close();
  });

  it.each([
    "RETAINED_COUNT_LIMIT",
    "RETAINED_BYTE_LIMIT",
    "PENDING_BYTE_LIMIT",
    "PENDING_AGE_LIMIT",
    "QUOTA_EXCEEDED",
    "JOURNAL_COMMIT_FAILED"
  ] as const)("publishes exactly one terminal for %s", async (reason) => {
    let history: EventHistory;
    let refused: CaptureReceipt;
    let publications: HistoryPublication[];
    if (reason === "RETAINED_COUNT_LIMIT") {
      history = await create({ capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 } });
      publications = collect(history);
      await history.offer(candidate("count-admitted")).settled;
      refused = history.offer(candidate("count-crossing"));
    } else if (reason === "RETAINED_BYTE_LIMIT") {
      history = await create({ capacity: { maxRetainedCount: 20, maxRetainedBytes: 16 }, byteEstimator: () => 8 });
      publications = collect(history);
      await history.offer(candidate("bytes-one")).settled;
      await history.offer(candidate("bytes-two")).settled;
      refused = history.offer(candidate("bytes-crossing"));
    } else if (reason === "PENDING_BYTE_LIMIT") {
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let firstCommit = true;
      history = await create({
        capacity: { maxRetainedCount: 20, maxRetainedBytes: 1_000_000, pendingStopBytes: 16 },
        byteEstimator: () => 8,
        commitBatch: async () => {
          if (firstCommit) {
            firstCommit = false;
            started();
            await gate;
          }
        }
      });
      publications = collect(history);
      const first = history.offer(candidate("pending-one"));
      await startedPromise;
      const second = history.offer(candidate("pending-two"));
      refused = history.offer(candidate("pending-crossing"));
      release();
      await Promise.all([first.settled, second.settled]);
    } else if (reason === "PENDING_AGE_LIMIT") {
      const timer = manualTimer();
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      history = await create({
        clock: timer.now,
        timer,
        capacity: { pendingAgeWarningMs: 10, pendingAgeStopMs: 30 },
        commitBatch: async () => {
          started();
          await gate;
        }
      });
      publications = collect(history);
      const first = history.offer(candidate("age-one"));
      await startedPromise;
      timer.advance(30);
      refused = history.offer(candidate("age-crossing"));
      release();
      await first.settled;
    } else {
      history = await create({
        failure: {
          commitBatch: () => {
            throw new DOMException(reason === "QUOTA_EXCEEDED" ? "quota" : "failure", reason === "QUOTA_EXCEEDED" ? "QuotaExceededError" : "Error");
          }
        }
      });
      publications = collect(history);
      refused = history.offer(candidate("journal-failure"));
    }

    await expect(refused.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: reason } });
    expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
    expect(publications.some((entry) => entry.type === "terminal" && entry.terminal.reason === reason)).toBe(true);
    await history.close();
  });
});

it("preserves IndexedDB accounted bytes through reopen", async () => {
  const panelSessionId = "impl-05-indexeddb-reopen-bytes";
  const history = await indexedHistory(panelSessionId, {
    byteEstimator: () => 17,
    capacity: { maxRetainedBytes: 1_000 }
  });
  const accountedCandidate = candidate("accounted");
  await expect(history.offer(accountedCandidate).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  const canonicalAccountedBytes = serializeJournalEvidenceCandidate(accountedCandidate).bytes + 8;

  const reopened = await openEventHistory({
    panelSessionId,
    byteEstimator: () => 99,
    capacity: { maxRetainedBytes: 1_000 }
  });
  let reopenedStatus: unknown;
  reopened.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "status") reopenedStatus = publication.status;
  });
  expect(reopenedStatus).toMatchObject({
    capacity: { tier: "LOWER" },
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
  const control = await readIndexedControl(panelSessionId);
  expect(control).toMatchObject({
    phase: "RUNNING",
    retainedCount: 1,
    accountedBytes: canonicalAccountedBytes,
    terminal: null
  });
  await reopened.close();
  await history.close();
});

it("applies the pending-age proactive drain once in IndexedDB", async () => {
  const timer = manualTimer();
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const history = await indexedHistory("impl-05-indexeddb-pending-age", {
    clock: timer.now,
    timer,
    capacity: { pendingAgeWarningMs: 10, pendingAgeStopMs: 30 },
    commitBatch: async () => {
      started();
      await gate;
    }
  });
  const publications = collect(history);
  const queued = history.offer(candidate("age-queued"));
  await startedPromise;
  timer.advance(30);
  const crossing = history.offer(candidate("age-crossing"));
  expect(crossing.intake).toBe("REFUSED");
  release();
  await expect(queued.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  await expect(crossing.settled).resolves.toMatchObject({
    outcome: "NOT_EVIDENCE",
    problem: { code: "PENDING_AGE_LIMIT", dimension: "PENDING_AGE" }
  });
  expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(1);
  expect(publications).toContainEqual(expect.objectContaining({
    type: "terminal",
    terminal: expect.objectContaining({
      reason: "PENDING_AGE_LIMIT",
      dimension: "PENDING_AGE",
      firstMissingEventId: "age-crossing"
    })
  }));
  await history.close();
});

it("does not reopen a concurrently owned proactively stopped IndexedDB journal", async () => {
  const panelSessionId = "impl-05-reopen-proactive-stop";
  const history = await indexedHistory(panelSessionId, {
    capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 }
  });
  await expect(history.offer(candidate("proactive-retained")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  const crossing = history.offer(candidate("proactive-crossing"));
  await expect(crossing.settled).resolves.toMatchObject({
    outcome: "NOT_EVIDENCE",
    problem: { code: "RETAINED_COUNT_LIMIT", dimension: "RETAINED_COUNT" }
  });

  const reopened = await openEventHistory({ panelSessionId });
  let reopenedStatus: unknown;
  const publications = collect(reopened);
  reopened.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "status") reopenedStatus = publication.status;
  });
  expect(reopenedStatus).toMatchObject({
    capacity: { tier: "LOWER" },
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
  expect(publications.filter((entry) => entry.type === "terminal")).toHaveLength(0);
  const control = await readIndexedControl(panelSessionId);
  expect(control).toMatchObject({
    phase: "STOPPED",
    terminal: {
      reason: "RETAINED_COUNT_LIMIT",
      firstMissingEventId: "proactive-crossing",
      committedEvidenceBoundary: { sequence: 1, eventId: "proactive-retained" }
    },
    retainedCount: 1,
    retainedRange: {
      first: { sequence: 1, eventId: "proactive-retained" },
      last: { sequence: 1, eventId: "proactive-retained" }
    }
  });
  await reopened.close();
  await history.close();
});

it("does not reopen a concurrently owned journal-failed IndexedDB history", async () => {
  const panelSessionId = "impl-05-reopen-journal-failure";
  const history = await indexedHistory(panelSessionId, {
    commitBatch: async (batch: readonly EvidenceCandidate[]) => {
      if (batch.some((entry) => entry.id === "reopen-fails")) throw new Error("reopen journal failure");
    }
  });
  await expect(history.offer(candidate("reopen-prior")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  const failed = history.offer(candidate("reopen-fails"));
  const tail = history.offer(candidate("reopen-tail"));
  await expect(failed.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });
  await expect(tail.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });

  const reopened = await openEventHistory({ panelSessionId });
  let reopenedStatus: unknown;
  reopened.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "status") reopenedStatus = publication.status;
  });
  expect(reopenedStatus).toMatchObject({
    capacity: { tier: "LOWER" },
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
  const reopenedControl = await readIndexedControl(panelSessionId);
  expect(reopenedControl).toMatchObject({
    phase: "STOPPED",
    terminal: {
      reason: "JOURNAL_COMMIT_FAILED",
      dimension: "JOURNAL",
      firstMissingEventId: "reopen-fails",
      rejected: { count: 0, bytes: 0 },
      discarded: { count: 2 },
      committedEvidenceBoundary: { sequence: 1, eventId: "reopen-prior" }
    },
    retainedCount: 1,
    retainedRange: {
      first: { sequence: 1, eventId: "reopen-prior" },
      last: { sequence: 1, eventId: "reopen-prior" }
    }
  });
  await reopened.close();
  await history.close();
});

it("does not replace a concurrent terminal intent by reopening from the advanced durable boundary", async () => {
  const panelSessionId = "impl-05-reopen-draining-boundary";
  let releaseFinalization!: () => void;
  let finalizationStarted!: () => void;
  const finalizationGate = new Promise<void>((resolve) => { releaseFinalization = resolve; });
  const finalizationStartedPromise = new Promise<void>((resolve) => { finalizationStarted = resolve; });
  const history = await indexedHistory(panelSessionId, {
    capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
    finalizeTerminal: async () => {
      finalizationStarted();
      await finalizationGate;
    }
  });
  await expect(history.offer(candidate("durable-prior")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  const advanced = history.offer(candidate("durable-advanced"));
  const crossing = history.offer(candidate("durable-crossing"));
  expect(crossing.intake).toBe("REFUSED");
  await finalizationStartedPromise;

  const control = await readIndexedControl(panelSessionId);
  expect(control).toMatchObject({
    phase: "DRAINING_TO_STOP",
    committedEvidenceBoundary: { sequence: 2, eventId: "durable-advanced" },
    terminal: { committedEvidenceBoundary: { sequence: 1, eventId: "durable-prior" } }
  });

  const reopened = await openEventHistory({ panelSessionId });
  let reopenedStatus: unknown;
  reopened.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "status") reopenedStatus = publication.status;
  });
  expect(reopenedStatus).toMatchObject({
    capacity: { tier: "LOWER" },
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
  const reopenedControl = await readIndexedControl(panelSessionId);
  expect(reopenedControl).toMatchObject({
    terminal: {
      reason: "RETAINED_COUNT_LIMIT",
      committedEvidenceBoundary: { sequence: 1, eventId: "durable-prior" },
      retainedRange: {
        first: { sequence: 1, eventId: "durable-prior" },
        last: { sequence: 1, eventId: "durable-prior" }
      }
    },
    retainedCount: 2
  });

  releaseFinalization();
  await expect(advanced.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  await expect(crossing.settled).resolves.toMatchObject({ problem: { code: "RETAINED_COUNT_LIMIT" } });
  const finalizedControl = await readIndexedControl(panelSessionId);
  expect(finalizedControl).toMatchObject({
    phase: "STOPPED",
    terminal: {
      reason: "RETAINED_COUNT_LIMIT",
      committedEvidenceBoundary: { sequence: 2, eventId: "durable-advanced" },
      retainedRange: {
        first: { sequence: 1, eventId: "durable-prior" },
        last: { sequence: 2, eventId: "durable-advanced" }
      }
    }
  });
  await history.close();
  await reopened.close();
});

it("does not let Close erase the journal while terminal finalization is in flight", async () => {
  const order: string[] = [];
  let releaseFinalization!: () => void;
  let finalizationStarted!: () => void;
  const finalizationGate = new Promise<void>((resolve) => { releaseFinalization = resolve; });
  const finalizationStartedPromise = new Promise<void>((resolve) => { finalizationStarted = resolve; });
  const history = await createMemoryEventHistoryForTests({
    panelSessionId: "impl-05-close-terminal-race",
    capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 },
    finalizeTerminal: async () => {
      order.push("finalize-start");
      finalizationStarted();
      await finalizationGate;
      order.push("finalize-end");
    },
    clearJournal: async () => { order.push("clear"); }
  });
  await history.offer(candidate("close-prior")).settled;
  const crossing = history.offer(candidate("close-crossing"));
  await finalizationStartedPromise;
  const closing = history.close();
  await Promise.resolve();
  expect(order).toEqual(["finalize-start"]);
  releaseFinalization();
  await expect(crossing.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE" });
  await expect(closing).resolves.toMatchObject({ ok: true });
  expect(order).toEqual(["finalize-start", "finalize-end", "clear"]);
});

it("recovers a terminal-finalization failure as a durable journal-failed state", async () => {
  const panelSessionId = "impl-05-reopen-terminal-failure";
  const history = await indexedHistory(panelSessionId, {
    capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000_000 },
    finalizeTerminal: () => { throw new Error("terminal finalization unavailable"); }
  });
  await expect(history.offer(candidate("terminal-failure-prior")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
  const crossing = history.offer(candidate("terminal-failure-crossing"));
  await expect(crossing.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });

  const reopened = await openEventHistory({ panelSessionId });
  let reopenedStatus: unknown;
  reopened.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "status") reopenedStatus = publication.status;
  });
  expect(reopenedStatus).toMatchObject({
    capacity: { tier: "LOWER" },
    fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
  });
  const reopenedControl = await readIndexedControl(panelSessionId);
  expect(reopenedControl).toMatchObject({
    phase: "STOPPED",
    terminal: {
      reason: "JOURNAL_COMMIT_FAILED",
      committedEvidenceBoundary: { sequence: 1, eventId: "terminal-failure-prior" },
      firstMissingEventId: "terminal-failure-crossing"
    },
    retainedCount: 1
  });
  await history.close();
  await reopened.close();
});
