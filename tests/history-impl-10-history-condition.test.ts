import { describe, expect, it } from "vitest";

import {
  historyConditionFor,
  type HistoryConditionInput
} from "../src/extension/panel/history-condition";
import type {
  HistoryProblem,
  HistoryStatus
} from "../src/core/event-history-authoritative";
import {
  createMemoryEventHistoryForTests
} from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const interval = { id: "panel:interval-1", ordinal: 1 } as const;
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
    committedEvidenceBoundary: {
      intervalId: interval.id,
      sequence: 41,
      eventId: "event-41"
    },
    retainedRange: {
      first: { intervalId: interval.id, sequence: 1, eventId: "event-1" },
      last: { intervalId: interval.id, sequence: 41, eventId: "event-41" }
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

function input(
  statusOverrides: Partial<HistoryStatus> = {},
  problem?: HistoryProblem
): HistoryConditionInput {
  return { status: status(statusOverrides), problem };
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
}

describe("history-impl-10 footer condition", () => {
  it("uses journal failure before capacity stop, drain, pressure, and fallback", () => {
    const condition = historyConditionFor(input({
      phase: "STOPPED",
      capacity: {
        tier: "LOWER",
        state: "EXHAUSTED",
        limits,
        measurements: {
          retainedCount: 80_001,
          retainedBytes: 214_748_365,
          pendingCount: 4,
          pendingBytes: 20_000_000,
          oldestPendingAgeMs: 30_000
        }
      },
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        tier: "LOWER",
        triggerTime: 1_700_000_000_000,
        triggerInterval: interval,
        interval,
        committedEvidenceBoundary: {
          intervalId: interval.id,
          sequence: 41,
          eventId: "event-41"
        },
        retainedRange: {
          first: { intervalId: interval.id, sequence: 1, eventId: "event-1" },
          last: { intervalId: interval.id, sequence: 41, eventId: "event-41" }
        },
        firstMissingEventId: "event-42",
        rejected: { count: 2, bytes: 200 },
        discarded: { count: 3, bytes: 300 },
        triggerMeasurements: {
          retainedCount: 80_001,
          retainedBytes: 214_748_365,
          pendingCount: 4,
          pendingBytes: 20_000_000,
          oldestPendingAgeMs: 30_000
        }
      }
    }));

    expect(condition).toMatchObject({
      kind: "journal-failure",
      severity: "Error",
      title: "Capture stopped — History commit failed",
      affected: "History Interval panel:interval-1"
    });
    expect(condition?.detail).toContain("JOURNAL_COMMIT_FAILED");
    expect(condition?.detail).toContain("event-42");
    expect(condition?.detail).toContain("Committed Evidence Boundary");
    expect(condition?.detail).toContain("Retained Range");
    expect(condition?.detail).toContain("rejected 2 / 200 bytes");
    expect(condition?.detail).toContain("discarded 3 / 300 bytes");
    expect(condition?.detail).toContain("did not affect Topology or COMMAND projections");
    expect(condition?.detail).toContain("Clear cannot restart Capture");
    expect(condition?.recovery).toContain("restore storage");
  });

  it("selects one pending pressure condition before retained pressure and fallback", () => {
    const condition = historyConditionFor(input({
      capacity: {
        tier: "LOWER",
        state: "NEAR_LIMIT",
        limits: { ...limits, pendingAgeWarningMs: 1_000, pendingAgeStopMs: 5_000 },
        measurements: {
          retainedCount: 4_200,
          retainedBytes: 27_000_000,
          pendingCount: 2,
          pendingBytes: 17_000_000,
          oldestPendingAgeMs: 1_100
        }
      },
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    }));

    expect(condition).toMatchObject({
      kind: "pending-pressure",
      title: "History backlog near stop",
      affected: "History Interval panel:interval-1"
    });
    expect(condition?.detail).toContain("17,000,000 bytes");
    expect(condition?.detail).toContain("1,100 ms");
    expect(condition?.detail).toContain("Capture continues while commits catch up");
    expect(condition?.detail).toContain("Committed Evidence Boundary");
  });

  it("renders retained pressure, drain, capacity stop, fallback, and healthy history distinctly", () => {
    const retained = historyConditionFor(input({
      capacity: {
        tier: "NORMAL",
        state: "NEAR_LIMIT",
        limits,
        measurements: {
          retainedCount: 80_001,
          retainedBytes: 50_000_000,
          pendingCount: 0,
          pendingBytes: 0,
          oldestPendingAgeMs: null
        }
      }
    }));
    expect(retained).toMatchObject({ kind: "retained-pressure", title: "History near capacity" });
    expect(retained?.detail).toContain("80,001 / 100,000 Evidence records");

    const draining = historyConditionFor(input(
      {
        phase: "DRAINING_TO_STOP",
        captureOperation: "STOPPED",
        capacity: {
          tier: "NORMAL",
          state: "EXHAUSTED",
          limits,
          measurements: {
            retainedCount: 41,
            retainedBytes: 41_000,
            pendingCount: 2,
            pendingBytes: 800,
            oldestPendingAgeMs: 50
          }
        }
      },
      {
        code: "PENDING_BYTE_LIMIT",
        reason: "PENDING_BYTE_LIMIT",
        dimension: "PENDING_BYTES",
        message: "stopping"
      }
    ));
    expect(draining).toMatchObject({ kind: "draining-to-stop", title: "History stopping" });
    expect(draining?.detail).toContain("provisional");
    expect(draining?.detail).toContain("queued 2 / 800 bytes");
    expect(draining?.detail).toContain("PENDING_BYTE_LIMIT");

    const capacityStop = historyConditionFor(input({
      phase: "STOPPED",
      captureOperation: "STOPPED",
      capacity: { ...status().capacity, state: "EXHAUSTED" },
      terminal: {
        reason: "RETAINED_COUNT_LIMIT",
        dimension: "RETAINED_COUNT",
        tier: "NORMAL",
        triggerTime: 1,
        triggerInterval: interval,
        interval,
        committedEvidenceBoundary: status().committedEvidenceBoundary,
        retainedRange: status().retainedRange,
        firstMissingEventId: "event-42",
        rejected: { count: 1, bytes: 100 },
        discarded: { count: 0, bytes: 0 },
        triggerMeasurements: status().capacity.measurements!
      }
    }));
    expect(capacityStop).toMatchObject({ kind: "capacity-stop", title: "Capture stopped — History Capacity exhausted" });
    expect(capacityStop?.detail).toContain("RETAINED_COUNT_LIMIT");
    expect(capacityStop?.detail).toContain("Clear cannot restart Capture");

    const fallback = historyConditionFor(input({
      capacity: { tier: "LOWER", state: "AVAILABLE", limits, measurements: status().capacity.measurements },
      fallback: "UNKNOWN_NEWER_SCHEMA"
    }));
    expect(fallback).toMatchObject({ kind: "lower-capacity-fallback", title: "Lower History Capacity" });
    expect(fallback?.detail).toContain("UNKNOWN_NEWER_SCHEMA");
    expect(fallback?.detail).toContain("5,000 Evidence records or 32 MiB");
    expect(fallback?.detail).toContain("Observation Coverage is unchanged");

    expect(historyConditionFor(input())).toBeNull();
  });

  it("publishes the semantic condition once, suppresses history-caused Coverage, and announces terminal transition once", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-runtime",
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 1, maxRetainedBytes: 1_000 }
    });
    const runtime = createWorkbenchRuntime({ history });
    await flushRuntime();

    await history.offer(candidate("accepted")).settled;
    await history.offer(candidate("missing")).settled;
    await flushRuntime();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.historyCondition).toMatchObject({
      kind: "capacity-stop",
      title: "Capture stopped — History Capacity exhausted"
    });
    expect(snapshot.diagnostics.filter((diagnostic) => diagnostic.category === "history")).toHaveLength(1);
    expect(snapshot.diagnostics.map(({ title }) => title)).not.toContain("Coverage LIMITED");
    expect(snapshot.historyAnnouncement).toBe(
      "Capture stopped because History Capacity is exhausted."
    );

    await flushRuntime();
    expect(runtime.getSnapshot().historyAnnouncement).toBe(
      "Capture stopped because History Capacity is exhausted."
    );
    runtime.dispose();
  });

  it("uses lower-capacity semantic fallback without limiting Coverage", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-10-fallback",
      capacityTier: "LOWER",
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });
    const runtime = createWorkbenchRuntime({ history });
    await flushRuntime();

    expect(runtime.getSnapshot().historyCondition).toMatchObject({
      kind: "lower-capacity-fallback",
      title: "Lower History Capacity"
    });
    expect(runtime.getSnapshot().capture.coverage).toBe("USEFUL");
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).not.toContain("Coverage LIMITED");
    runtime.dispose();
  });
});
