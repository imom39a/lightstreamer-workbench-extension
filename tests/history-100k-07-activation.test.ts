import { describe, expect, it } from "vitest";

import {
  HISTORY_CAPACITY_LIMITS,
  MIB,
  historyCapacityLimits
} from "../src/core/event-history-capacity";
import { historyConditionFor } from "../src/extension/panel/history-condition";
import type { HistoryStatus } from "../src/core/event-history-authoritative";
import {
  HISTORY_100K_VISIBLE_CFT151_OVERRIDE_ARG,
  parseHistory100kActivationArguments
} from "../scripts/event-history-100k-activation-options.mjs";

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
    retained: limits.retainedWarningCount,
    retention: {
      policy: "ROLLING",
      highWater: { count: limits.maxRetainedCount, bytes: limits.maxRetainedBytes },
      lowWater: {
        count: Math.floor(limits.maxRetainedCount * 0.9),
        bytes: Math.floor(limits.maxRetainedBytes * 0.9)
      },
      evicted: { count: 0, bytes: 0 },
      lastAdvance: null
    },
    persistence: {
      mode: "JOURNAL",
      health: "HEALTHY",
      commitAttempts: limits.retainedWarningCount,
      retryCount: 0,
      failureCount: 0,
      lastFailureAt: null
    },
    continuity: {
      state: "CONTIGUOUS",
      gapCount: 0,
      firstGap: null,
      latestGap: null
    }
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
      maxRetainedCount: 25_000,
      maxRetainedBytes: 128 * MIB,
      retainedWarningCount: 20_000,
      retainedWarningBytes: Math.ceil(128 * MIB * 0.8),
      pendingWarningBytes: 16 * MIB,
      pendingStopBytes: 32 * MIB,
      pendingAgeWarningMs: 1_000,
      pendingAgeStopMs: 5_000
    });
  });

  it("keeps normal rolling-retention pressure quiet while preserving explicit count and byte bounds", () => {
    const status = normalNearLimitStatus();

    expect(historyConditionFor({ status })).toBeNull();
    expect(status.capacity.measurements).toMatchObject({
      retainedCount: 80_000,
      retainedBytes: Math.ceil(256 * MIB * 0.8)
    });
    expect(status.retention).toMatchObject({
      policy: "ROLLING",
      highWater: { count: 100_000, bytes: 256 * MIB },
      lowWater: { count: 90_000, bytes: Math.floor(256 * MIB * 0.9) }
    });
  });

  it("defaults the activation command to headless and requires the one visible override flag", () => {
    expect(parseHistory100kActivationArguments()).toEqual({ visibleCft151Override: false });
    expect(parseHistory100kActivationArguments([HISTORY_100K_VISIBLE_CFT151_OVERRIDE_ARG]))
      .toEqual({ visibleCft151Override: true });
    expect(() => parseHistory100kActivationArguments(["--visible"]))
      .toThrow(/unknown history 100k activation argument/i);
  });
});
