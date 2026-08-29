import { describe, expect, it } from "vitest";

import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createMemoryEventHistoryForTests,
  type HistoryStatus
} from "../src/core/event-history-authoritative";
import {
  historyConditionFor,
  historyConditionsFor,
  type HistoryConditionInput
} from "../src/extension/panel/history-condition";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";

const interval = { id: "panel:interval-1", ordinal: 1 } as const;
const boundary = { intervalId: interval.id, sequence: 41, eventId: "event-41" } as const;
const limits = {
  maxRetainedCount: 100_000,
  maxRetainedBytes: 256 * 1_048_576,
  retainedWarningCount: 80_000,
  retainedWarningBytes: 256 * 1_048_576 * 0.8,
  pendingWarningBytes: 16 * 1_048_576,
  pendingStopBytes: 32 * 1_048_576,
  pendingAgeWarningMs: 10_000,
  pendingAgeStopMs: 30_000
} as const;

function status(overrides: Partial<HistoryStatus> = {}): HistoryStatus {
  return {
    phase: "RUNNING",
    captureOperation: "RUNNING",
    interval,
    committedEvidenceBoundary: boundary,
    retainedRange: {
      first: { intervalId: interval.id, sequence: 1, eventId: "event-1" },
      last: boundary
    },
    capacity: {
      tier: "NORMAL",
      state: "AVAILABLE",
      limits,
      measurements: {
        retainedCount: 41,
        retainedBytes: 41_000,
        pendingCount: 0,
        pendingBytes: 0,
        oldestPendingAgeMs: null
      }
    },
    fallback: null,
    captured: 41,
    awaitingAcceptance: 0,
    accepted: 41,
    notAccepted: 0,
    retained: 41,
    ...overrides
  };
}

function input(overrides: Partial<HistoryStatus> = {}): HistoryConditionInput {
  return { status: status(overrides) };
}

function candidate(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: "orders", position: 1 },
    update: { fields: { value: id } }
  };
}

async function flushRuntime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function immediateScheduler(): WorkbenchRuntimeScheduler {
  let nextHandle = 0;
  const cancelled = new Set<number>();
  const schedule = (callback: () => void): number => {
    const handle = ++nextHandle;
    queueMicrotask(() => {
      if (cancelled.delete(handle)) return;
      callback();
    });
    return handle;
  };
  return {
    requestFrame: schedule,
    cancelFrame: (handle) => { if (typeof handle === "number") cancelled.add(handle); },
    setTimeout: (callback) => schedule(callback),
    clearTimeout: (handle) => { if (typeof handle === "number") cancelled.add(handle); }
  };
}

describe("history-impl-10 continuity-first History condition", () => {
  it("keeps routine rolling retention out of the footer", () => {
    expect(historyConditionFor(input({
      retention: {
        policy: "ROLLING",
        highWater: { count: 100_000, bytes: 256 * 1_048_576 },
        lowWater: { count: 90_000, bytes: Math.floor(256 * 1_048_576 * 0.9) },
        evicted: { count: 10_000, bytes: 10_000_000 },
        lastAdvance: null
      }
    }))).toBeNull();
  });

  it("shows one catching-up warning for pending pressure", () => {
    const condition = historyConditionFor(input({
      capacity: {
        tier: "NORMAL",
        state: "NEAR_LIMIT",
        limits,
        measurements: {
          retainedCount: 41,
          retainedBytes: 41_000,
          pendingCount: 2,
          pendingBytes: 17_000_000,
          oldestPendingAgeMs: 11_000
        }
      }
    }));

    expect(condition).toMatchObject({
      kind: "pending-pressure",
      title: "History catching up",
      severity: "Warning"
    });
    expect(condition?.detail).toContain("Capture remains running");
    expect(condition?.detail).not.toContain("stop threshold");
  });

  it("shows memory fallback without lowering Observation Coverage", () => {
    const condition = historyConditionFor(input({
      persistence: {
        mode: "MEMORY_ONLY",
        health: "DEGRADED",
        commitAttempts: 3,
        retryCount: 2,
        failureCount: 3,
        lastFailureAt: 1,
        lastProblem: { code: "JOURNAL_COMMIT_FAILED", message: "journal unavailable" }
      },
      retention: {
        policy: "ROLLING",
        highWater: { count: 5_000, bytes: 32 * 1_048_576 },
        lowWater: { count: 4_500, bytes: Math.floor(32 * 1_048_576 * 0.9) },
        evicted: { count: 0, bytes: 0 },
        lastAdvance: null
      }
    }));

    expect(condition).toMatchObject({
      kind: "memory-fallback",
      title: "History using memory",
      severity: "Warning"
    });
    expect(condition?.detail).toContain("Capture continues");
    expect(condition?.detail).toContain("Observation Coverage is unchanged");
  });

  it("prioritizes an exact Evidence gap while Capture remains running", () => {
    const gap = {
      interval,
      captureOrdinal: 42,
      eventId: "event-42",
      candidateBytes: 300,
      occurredAt: 1,
      dimension: "RETAINED_BYTES" as const,
      afterEvidence: boundary
    };
    const condition = historyConditionFor(input({
      continuity: { state: "GAPPED", gapCount: 1, firstGap: gap, latestGap: gap }
    }));

    expect(condition).toMatchObject({
      kind: "evidence-gap",
      title: "History has an Evidence gap",
      severity: "Warning"
    });
    expect(condition?.detail).toContain("#42 (event-42)");
    expect(condition?.detail).toContain("Later Capture continues");
    expect(condition?.detail).toContain("LIMITED");
  });

  it("keeps simultaneous Evidence-gap and memory-fallback conditions independently visible", () => {
    const gap = {
      interval,
      captureOrdinal: 42,
      eventId: "event-42",
      candidateBytes: 300,
      occurredAt: 1,
      dimension: "RETAINED_BYTES" as const,
      afterEvidence: boundary
    };
    const conditions = historyConditionsFor(input({
      continuity: { state: "GAPPED", gapCount: 1, firstGap: gap, latestGap: gap },
      persistence: {
        mode: "MEMORY_ONLY",
        health: "DEGRADED",
        commitAttempts: 3,
        retryCount: 2,
        failureCount: 3,
        lastFailureAt: 1,
        lastProblem: { code: "JOURNAL_COMMIT_FAILED", message: "journal unavailable" }
      }
    }));

    expect(conditions.map(({ kind }) => kind)).toEqual(["evidence-gap", "memory-fallback"]);
  });

  it("coalesces rollover into Notifications without a footer warning", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-rollover",
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000 }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await history.offer(candidate(`event-${sequence}`)).settled;
    }
    await flushRuntime();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.capture).toMatchObject({ operation: "RUNNING", coverage: "USEFUL" });
    expect(snapshot.historyCondition).toBeNull();
    expect(snapshot.notifications.entries.filter(({ title }) => title === "Older Evidence removed")).toHaveLength(1);
    runtime.dispose();
  });

  it("keeps Capture running and records one warning when the journal falls back to memory", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-memory-fallback",
      commitBatch: async () => { throw new Error("journal unavailable"); }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    await history.offer(candidate("accepted-in-memory")).settled;
    await flushRuntime();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.capture).toMatchObject({ operation: "RUNNING", coverage: "USEFUL" });
    expect(snapshot.historyCondition).toMatchObject({ kind: "memory-fallback", title: "History using memory" });
    expect(snapshot.notifications.entries.filter(({ title }) => title === "History using memory")).toHaveLength(1);
    runtime.dispose();
  });

  it("keeps later Capture running while one Evidence gap limits continuity", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-gap",
      byteEstimator: (event) => event.id === "too-large" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    await history.offer(candidate("too-large")).settled;
    await history.offer(candidate("later")).settled;
    await flushRuntime();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.capture).toMatchObject({
      operation: "RUNNING",
      coverage: "LIMITED",
      firstMissingEventId: "too-large"
    });
    expect(snapshot.evidence.total).toBe(1);
    expect(snapshot.historyCondition).toMatchObject({ kind: "evidence-gap" });
    expect(snapshot.notifications.entries.filter(({ title }) => title === "History has an Evidence gap")).toHaveLength(1);
    runtime.dispose();
  });

  it("restores useful Capture coverage when Clear starts a fresh interval after an Evidence gap", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-gap-clear",
      byteEstimator: (event) => event.id === "too-large" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    await history.offer(candidate("too-large")).settled;
    await flushRuntime();
    expect(runtime.getSnapshot().capture).toMatchObject({
      operation: "RUNNING",
      coverage: "LIMITED",
      firstMissingEventId: "too-large"
    });

    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushRuntime();

    expect(history.status()).toMatchObject({
      interval: { ordinal: 2 },
      continuity: { state: "CONTIGUOUS", gapCount: 0 }
    });
    expect(runtime.getSnapshot()).toMatchObject({
      capture: {
        operation: "RUNNING",
        coverage: "USEFUL",
        firstMissingEventId: null,
        committedEvidenceBoundary: null
      },
      historyCondition: null,
      retention: { clearState: "idle" }
    });
    runtime.dispose();
  });

  it("preserves the gap boundary and reports an unsuccessful durable Clear", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-gap-clear-failed",
      byteEstimator: (event) => event.id === "too-large" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 },
      clearJournal: () => { throw new Error("durable Clear unavailable"); }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    await history.offer(candidate("too-large")).settled;
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushRuntime();

    expect(history.status()).toMatchObject({
      interval: { ordinal: 1 },
      continuity: { state: "GAPPED", gapCount: 1 }
    });
    expect(runtime.getSnapshot()).toMatchObject({
      capture: {
        operation: "RUNNING",
        coverage: "LIMITED",
        firstMissingEventId: "too-large"
      },
      historyCondition: { kind: "evidence-gap" },
      retention: {
        clearState: "error",
        clearError: "durable Clear unavailable"
      }
    });
    runtime.dispose();
  });

  it("keeps a later memory fallback in Notifications when an Evidence gap owns the footer", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-gap-then-memory-fallback",
      byteEstimator: (event) => event.id === "too-large" ? 11 : 5,
      capacity: { maxRetainedCount: 10, maxRetainedBytes: 10 },
      commitBatch: async () => { throw new Error("journal unavailable"); }
    });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", scheduler: immediateScheduler() });

    await history.offer(candidate("too-large")).settled;
    await history.offer(candidate("later-in-memory")).settled;
    await flushRuntime();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.capture).toMatchObject({ operation: "RUNNING", coverage: "LIMITED" });
    expect(snapshot.historyCondition).toMatchObject({ kind: "evidence-gap" });
    expect(snapshot.diagnostics.map(({ title }) => title)).toEqual(expect.arrayContaining([
      "History has an Evidence gap",
      "History using memory"
    ]));
    expect(snapshot.notifications.entries.filter(({ title }) => title === "History has an Evidence gap")).toHaveLength(1);
    expect(snapshot.notifications.entries.filter(({ title }) => title === "History using memory")).toHaveLength(1);
    runtime.dispose();
  });
});
