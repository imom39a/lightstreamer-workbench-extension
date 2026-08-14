import { describe, expect, it } from "vitest";

import {
  HISTORY_CAPACITY_LIMITS,
  MIB,
  historyCapacityLimits
} from "../src/core/event-history-capacity";
import { historyConditionFor } from "../src/extension/panel/history-condition";
import type { HistoryStatus } from "../src/core/event-history-authoritative";

const interval = { id: "panel:history-100k-07", ordinal: 1 } as const;

function normalNearLimitStatus(): HistoryStatus {
  const limits = historyCapacityLimits("NORMAL");
  return {
    phase: "RUNNING",
    captureOperation: "RUNNING",
    interval,
    committedEvidenceBoundary: {
      intervalId: interval.id,
      sequence: limits.retainedWarningCount,
      eventId: `event-${limits.retainedWarningCount}`
    },
    retainedRange: {
      first: { intervalId: interval.id, sequence: 1, eventId: "event-1" },
      last: { intervalId: interval.id, sequence: limits.retainedWarningCount, eventId: `event-${limits.retainedWarningCount}` }
    },
    capacity: {
      tier: "NORMAL",
      state: "NEAR_LIMIT",
      limits,
      measurements: {
        retainedCount: limits.retainedWarningCount,
        retainedBytes: limits.retainedWarningBytes,
        pendingCount: 0,
        pendingBytes: 0,
        oldestPendingAgeMs: null
      }
    },
    fallback: null,
    captured: limits.retainedWarningCount,
    awaitingAcceptance: 0,
    accepted: limits.retainedWarningCount,
    notAccepted: 0,
    retained: limits.retainedWarningCount
  };
}

describe("history-100k-07 production activation contract", () => {
  it("activates only the normal IndexedDB tier and preserves the lower fallback", () => {
    expect(HISTORY_CAPACITY_LIMITS.NORMAL).toMatchObject({
      maxRetainedCount: 100_000,
      maxRetainedBytes: 256 * MIB,
      retainedWarningCount: 80_000,
      retainedWarningBytes: Math.ceil(256 * MIB * 0.8),
      pendingWarningBytes: 16 * MIB,
      pendingStopBytes: 32 * MIB,
      pendingAgeWarningMs: 10_000,
      pendingAgeStopMs: 30_000
    });
    expect(HISTORY_CAPACITY_LIMITS.LOWER).toMatchObject({
      maxRetainedCount: 5_000,
      maxRetainedBytes: 32 * MIB,
      retainedWarningCount: 4_000,
      retainedWarningBytes: Math.ceil(32 * MIB * 0.8),
      pendingWarningBytes: 16 * MIB,
      pendingStopBytes: 32 * MIB,
      pendingAgeWarningMs: 1_000,
      pendingAgeStopMs: 5_000
    });
  });

  it("states count and byte pressure without promising arbitrary-size payloads", () => {
    const condition = historyConditionFor({ status: normalNearLimitStatus() });
    expect(condition?.detail).toContain("80,000 / 100,000 Evidence records");
    expect(condition?.detail).toContain("/ 268,435,456 bytes (256 MiB)");
    expect(condition?.detail).not.toMatch(/arbitrary|any size|unlimited/i);
  });
});
