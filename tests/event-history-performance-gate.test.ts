import { describe, expect, it } from "vitest";

import {
  classifyEventHistoryPerformance,
  EVENT_HISTORY_PERFORMANCE_LIMITS,
  type EventHistoryPerformanceCell,
  type EventHistoryPerformanceHeapSample,
  type EventHistoryPerformanceReference,
  type EventHistoryPerformanceReport
} from "../benchmarks/event-history-performance-gate";

function cell(
  adapter: EventHistoryPerformanceCell["adapter"],
  workload: EventHistoryPerformanceCell["workload"],
  shape: EventHistoryPerformanceCell["shape"],
  sample: number,
  overrides: Partial<EventHistoryPerformanceCell> = {}
): EventHistoryPerformanceCell {
  return {
    adapter,
    workload,
    shape,
    sample,
    accepted: 1_692,
    published: 1_692,
    retained: 1_692,
    correctness: {
      retainedMatchesAccepted: true,
      publicationMatchesAccepted: true,
      retainedInOrder: true,
      publicationInOrder: true,
      finalBoundaryCorrect: true,
      terminalOutcomeCorrect: true
    },
    latency: {
      offerToPublicationP95Ms: 5,
      offerToVisibleFrameP95Ms: adapter === "indexeddb" ? 20 : 10,
      committedBoundaryToVisibleFrameP95Ms: 5,
      finalBoundaryVisibleMs: workload === "burst" ? adapter === "indexeddb" ? 100 : 50 : null,
      behindBacklogMs: 0,
      recentPageP95Ms: 5,
      structuredIndexedP95Ms: 10,
      findFullP95Ms: 20
    },
    longTasks: { capture: [], commit: [], paint: [], query: [] },
    storage: {
      transactionCount: 1,
      readwriteTransactionCount: 1,
      readonlyTransactionCount: 0,
      evidenceWriteCount: 1_692,
      controlWriteCount: 1,
      facetEntryCount: 1_692,
      indexEntryCount: 3_384
    },
    workloadFacts: {
      expectedCount: 1_692,
      offeredEventsPerSecond: 50,
      shapeBytes: 100,
      persistedJsonBytes: 100,
      indexedDbWritesPerEvent: 1,
      searchTokenCount: 1
    },
    pressure: {
      maxPendingBytes: 0,
      maxOldestPendingAgeMs: 0,
      transitions: [],
      limits: { retainedCount: 10_000, retainedBytes: 64 * 1_048_576, pendingBytes: 32 * 1_048_576, pendingAgeMs: 30_000 }
    },
    terminal: {
      phase: "RUNNING",
      reason: null,
      committedEvidenceBoundary: { sequence: 1_692, eventId: "sample-large-json-rich-1691" },
      firstMissingEventId: null,
      refusedCount: 0,
      discardedCount: 0
    },
    ...overrides
  };
}

function heapSample(adapter: EventHistoryPerformanceHeapSample["adapter"], index: number): EventHistoryPerformanceHeapSample {
  return {
    adapter,
    sample: index,
    eventCount: EVENT_HISTORY_PERFORMANCE_LIMITS[adapter].heapEventCount,
    postGcHeapDeltaBytes: 1_024
  };
}

function report(overrides: Partial<EventHistoryPerformanceReport> = {}): EventHistoryPerformanceReport {
  const cells = ["indexeddb", "memory"].flatMap((adapter) =>
    ["sustained", "burst"].flatMap((workload) =>
      ["small-lifecycle", "ordinary-item-update", "large-json-rich"].flatMap((shape) =>
        [1, 2, 3].map((sample) => cell(adapter as EventHistoryPerformanceCell["adapter"], workload as EventHistoryPerformanceCell["workload"], shape as EventHistoryPerformanceCell["shape"], sample))
      )
    )
  );
  return {
    schemaVersion: 2,
    source: { revision: "clean-reference-revision", dirty: false },
    environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64", headless: false },
    cells,
    heapSamples: [1, 2, 3].flatMap((index) => [heapSample("indexeddb", index), heapSample("memory", index)]),
    lifecycle: { retainedHeapBytes: [1, 2, 3], strictMonotonicGrowth: false },
    ...overrides
  };
}

function referenceFrom(reportValue: EventHistoryPerformanceReport): EventHistoryPerformanceReference {
  return {
    schemaVersion: 2,
    referenceVersion: "history-impl-11-initial",
    disposition: "ACCEPTED_INITIAL_CLEAN_REFERENCE",
    rationale: "Pinned from a clean visible Chrome for Testing 151 run after the gate implementation was committed.",
    environment: reportValue.environment,
    cells: reportValue.cells
  };
}

describe("Event History real-Chrome performance gate classifier", () => {
  it("returns PASS only when all three samples and the pinned reference pass", () => {
    const current = report();
    const decision = classifyEventHistoryPerformance(current, referenceFrom(current));

    expect(decision.verdict).toBe("PASS");
    expect(decision.checkedCells).toBe(12);
    expect(decision.checkedSamples).toBe(36);
  });

  it("fails a single incorrect sample instead of averaging it away", () => {
    const current = report({
      cells: report().cells.map((entry, index) => index === 0
        ? { ...entry, correctness: { ...entry.correctness, publicationInOrder: false } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(current));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("publicationInOrder"))).toBe(true);
  });

  it("fails incomplete telemetry and missing independent samples", () => {
    const current = report({
      cells: report().cells.filter((entry) => !(entry.adapter === "memory" && entry.workload === "burst" && entry.shape === "large-json-rich" && entry.sample === 3))
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(current));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("exactly independent samples"))).toBe(true);
  });

  it("enforces the absolute latency, Long Task, and post-GC heap gates per sample", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? {
            ...entry,
            latency: { ...entry.latency, offerToVisibleFrameP95Ms: 101, recentPageP95Ms: 51 },
            longTasks: { ...entry.longTasks, capture: [50.001] }
          }
        : entry),
      heapSamples: baseline.heapSamples.map((entry, index) => index === 0
        ? { ...entry, postGcHeapDeltaBytes: 8 * 1_048_576 + 1 }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("sustained offer-to-visible"))).toBe(true);
    expect(decision.failures.some((failure) => failure.includes("Long Task"))).toBe(true);
    expect(decision.failures.some((failure) => failure.includes("post-GC heap"))).toBe(true);
  });

  it("returns REVIEW for a comparable absolute pass that regresses over twenty percent", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry) => ({
        ...entry,
        latency: { ...entry.latency, recentPageP95Ms: 7 }
      }))
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("REVIEW");
    expect(decision.reviewReasons.some((reason) => reason.includes("recent-page p95"))).toBe(true);
  });

  it("fails closed when no reference is pinned", () => {
    const decision = classifyEventHistoryPerformance(report());

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures[0]).toContain("No separately pinned reference");
  });

  it.each([
    ["missing cells", { cells: undefined }],
    ["malformed environment", { environment: { chromeMajor: 151 } }],
    ["unsupported schema", { schemaVersion: 1 }]
  ])("fails closed for %s telemetry", (_label, override) => {
    const decision = classifyEventHistoryPerformance({ ...report(), ...override } as unknown);

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.length).toBeGreaterThan(0);
  });

  it("fails closed for an empty pinned reference", () => {
    const decision = classifyEventHistoryPerformance(report(), {
      referenceVersion: "history-impl-11-initial",
      disposition: "ACCEPTED_INITIAL_CLEAN_REFERENCE",
      rationale: "clean",
      schemaVersion: 2,
      environment: report().environment,
      cells: []
    });

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("reference") && failure.includes("empty"))).toBe(true);
  });

  it("fails closed for a pending reference disposition", () => {
    const baseline = report();
    const decision = classifyEventHistoryPerformance(baseline, {
      referenceVersion: "history-impl-11-initial",
      disposition: "PENDING_MAINTAINER_BASELINE",
      rationale: "pending",
      schemaVersion: 2,
      environment: baseline.environment,
      cells: baseline.cells
    });

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("pending") || failure.includes("disposition"))).toBe(true);
  });
});
