import { describe, expect, it } from "vitest";

import {
  classifyEventHistoryPerformance,
  EVENT_HISTORY_PERFORMANCE_LIMITS,
  validateEventHistoryPerformanceReference,
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
  const identityPrefix = `${adapter}-${workload}-${shape}-${sample}`;
  const expectedEventIds = Array.from({ length: 1_692 }, (_, index) => `${identityPrefix}-expected-${index}`);
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
    longTasks: { supported: true, unattributed: 0, capture: [], commit: [], paint: [], query: [], unattributedReasons: [] },
    storage: adapter === "indexeddb"
      ? {
          transactionCount: 1,
          readwriteTransactionCount: 1,
          readonlyTransactionCount: 0,
          evidenceWriteCount: 1_692,
          controlWriteCount: 1,
          facetEntryCount: 1_692,
          indexEntryCount: 3_384
        }
      : {
          transactionCount: 0,
          readwriteTransactionCount: 0,
          readonlyTransactionCount: 0,
          evidenceWriteCount: 0,
          controlWriteCount: 0,
          facetEntryCount: 0,
          indexEntryCount: 0
        },
    storageEstimate: {
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: 1,
      quotaBytes: 2,
      failure: null
    },
    identityEvidence: {
      expectedEventIds,
      retainedEventIds: [...expectedEventIds],
      publishedEventIds: [...expectedEventIds]
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
    sessionId: `${adapter}-sample-${index}`,
    databaseName: adapter === "indexeddb" ? `${adapter}-database-${index}` : null,
    status: "PASS",
    failure: null,
    postGcHeapDeltaBytes: 1_024
  };
}

function heapRuns(): EventHistoryPerformanceReport["heapRuns"] {
  return ["indexeddb", "memory"].flatMap((adapter) => {
    const typedAdapter = adapter as EventHistoryPerformanceCell["adapter"];
    const databaseName = typedAdapter === "indexeddb" ? `${typedAdapter}-database-warmup` : null;
    return [
      {
        adapter: typedAdapter,
        phase: "warmup" as const,
        sample: null,
        eventCount: EVENT_HISTORY_PERFORMANCE_LIMITS[typedAdapter].heapEventCount,
        retained: EVENT_HISTORY_PERFORMANCE_LIMITS[typedAdapter].heapEventCount,
        sessionId: `${typedAdapter}-warmup`,
        databaseName,
        close: { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } },
        rootRemoved: true,
        frameYielded: true,
        gcPasses: 3,
        status: "PASS" as const,
        failure: null
      },
      ...[1, 2, 3].map((sample) => ({
        adapter: typedAdapter,
        phase: "cleanup" as const,
        sample,
        eventCount: EVENT_HISTORY_PERFORMANCE_LIMITS[typedAdapter].heapEventCount,
        retained: EVENT_HISTORY_PERFORMANCE_LIMITS[typedAdapter].heapEventCount,
        sessionId: `${typedAdapter}-sample-${sample}`,
        databaseName: typedAdapter === "indexeddb" ? `${typedAdapter}-database-${sample}` : null,
        close: { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } },
        rootRemoved: true,
        frameYielded: true,
        gcPasses: 3,
        status: "PASS" as const,
        failure: null
      }))
    ];
  });
}

function terminalEvidence(acceptedCount: number, refusedEventId: string) {
  const acceptedEventIds = Array.from({ length: acceptedCount }, (_, index) => `accepted-${index + 1}`);
  const refusedEventIds = [refusedEventId];
  return {
    offeredEventIds: [...acceptedEventIds, ...refusedEventIds],
    acceptedEventIds,
    retainedEventIds: [...acceptedEventIds],
    publishedEventIds: [...acceptedEventIds],
    refusedEventIds
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
    terminalScenarios: ["indexeddb", "memory"].flatMap((adapter) => [
      {
        adapter: adapter as "indexeddb" | "memory",
        trigger: "PENDING_BYTES" as const,
        tier: adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const,
        terminalReason: "PENDING_BYTE_LIMIT" as const,
        terminalReasonCorrect: true,
        ...terminalEvidence(16, "missing-bytes"),
        acceptedCount: 16,
        refusedCount: 1,
        firstMissingEventId: "missing-bytes",
        committedBoundary: { sequence: 16, eventId: "accepted-16" },
        terminalPublicationCount: 1,
        finalBoundaryCorrect: true,
        refusedIdentityCorrect: true,
        exactOneTerminalPublication: true,
        pressureTransitions: ["NEAR_LIMIT", "EXHAUSTED"]
      },
      {
        adapter: adapter as "indexeddb" | "memory",
        trigger: "PENDING_AGE" as const,
        tier: adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const,
        terminalReason: "PENDING_AGE_LIMIT" as const,
        terminalReasonCorrect: true,
        ...terminalEvidence(1, "missing-age"),
        acceptedCount: 1,
        refusedCount: 1,
        firstMissingEventId: "missing-age",
        committedBoundary: { sequence: 1, eventId: "accepted-1" },
        terminalPublicationCount: 1,
        finalBoundaryCorrect: true,
        refusedIdentityCorrect: true,
        exactOneTerminalPublication: true,
        pressureTransitions: ["NEAR_LIMIT", "EXHAUSTED"]
      }
    ]),
    checkpointScenarios: ["indexeddb", "memory"].flatMap((adapter) => [
      { name: "representative" as const, adapter: adapter as "indexeddb" | "memory", accepted: true, retained: 9, trafficBefore: 4, trafficAfter: 4, interleaved: true, canonicalBytes: 10_000, committedBoundaryCorrect: true, batchAcceptedAsOneOversizedUnit: true },
      { name: "maximum-2MiB" as const, adapter: adapter as "indexeddb" | "memory", accepted: true, retained: 9, trafficBefore: 4, trafficAfter: 4, interleaved: true, canonicalBytes: 2 * 1_048_576, committedBoundaryCorrect: true, batchAcceptedAsOneOversizedUnit: true }
    ]),
    heapSamples: [1, 2, 3].flatMap((index) => [heapSample("indexeddb", index), heapSample("memory", index)]),
    heapRuns: heapRuns(),
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

  it("accepts an initial AVAILABLE state before the terminal pressure transition", () => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario) => ({
        ...scenario,
        pressureTransitions: ["AVAILABLE", "NEAR_LIMIT", "EXHAUSTED"]
      }))
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("PASS");
    expect(decision.failures).toEqual([]);
  });

  it.each([
    ["reversed", ["EXHAUSTED", "NEAR_LIMIT"]],
    ["repeated exhausted", ["EXHAUSTED", "NEAR_LIMIT", "EXHAUSTED"]],
    ["trailing state", ["NEAR_LIMIT", "EXHAUSTED", "NEAR_LIMIT"]],
    ["unknown state", ["AVAILABLE", "NEAR_LIMIT", "PAUSED", "EXHAUSTED"]],
    ["missing exhausted", ["NEAR_LIMIT"]]
  ])("rejects a %s terminal pressure sequence", (_label, pressureTransitions) => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario) => ({
        ...scenario,
        pressureTransitions
      }))
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.filter((failure) => failure.includes("exact NEAR_LIMIT to EXHAUSTED"))).toHaveLength(4);
  });

  it.each(["acceptedEventIds", "retainedEventIds", "publishedEventIds"] as const)("rejects reversed terminal %s order", (field) => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario, index) => index === 0
        ? { ...scenario, [field]: [...scenario[field]].reverse() }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("identifiers"))).toBe(true);
  });

  it("rejects duplicate terminal refused identifiers", () => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario, index) => index === 0
        ? { ...scenario, refusedEventIds: [scenario.refusedEventIds[0]!, scenario.refusedEventIds[0]!] }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("duplicates"))).toBe(true);
  });

  it.each([
    ["boundary event", { eventId: "wrong-boundary" }],
    ["boundary sequence", { sequence: 15 }]
  ] as const)("rejects a mismatched terminal %s", (_label, boundaryPatch) => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario, index) => index === 0
        ? { ...scenario, committedBoundary: { ...scenario.committedBoundary, ...boundaryPatch } }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("committed boundary"))).toBe(true);
  });

  it("rejects a wrong PENDING_AGE first missing identifier", () => {
    const baseline = report();
    const current = report({
      terminalScenarios: baseline.terminalScenarios.map((scenario) => scenario.trigger === "PENDING_AGE"
        ? { ...scenario, firstMissingEventId: "wrong-age-missing" }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("first missing event identity"))).toBe(true);
  });

  it("rejects a nullable terminal committed boundary", () => {
    const baseline = report();
    const current = {
      ...baseline,
      terminalScenarios: baseline.terminalScenarios.map((scenario, index) => index === 0
        ? { ...scenario, committedBoundary: null }
        : scenario)
    } as unknown;

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("malformed performance report"))).toBe(true);
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

  it("fails missing, duplicate, and invalid heap sample slots", () => {
    const baseline = report();
    const missing = report({ heapSamples: baseline.heapSamples.slice(1) });
    const duplicate = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 2 ? { ...sample, sample: 1 } : sample)
    });
    const invalid = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 0
        ? { ...sample, status: "FAIL", failure: { code: "CLOSE_FAILED", message: "cleanup failed" }, postGcHeapDeltaBytes: null }
        : sample)
    });

    expect(classifyEventHistoryPerformance(missing, referenceFrom(baseline)).verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(duplicate, referenceFrom(baseline)).verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(invalid, referenceFrom(baseline)).verdict).toBe("FAIL");
  });

  it("retains a baseline GC timeout as a diagnostic FAIL slot without attempted identity", () => {
    const baseline = report();
    const timeoutFailure = { code: "CdpRequestTimeout", message: "CDP heap-gc-enable request timed out after 5 ms." };
    const timedOut = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 0
        ? { ...sample, sessionId: null, databaseName: null, status: "FAIL", failure: timeoutFailure, postGcHeapDeltaBytes: null }
        : sample),
      heapRuns: baseline.heapRuns.map((run) => run.adapter === "indexeddb" && run.phase === "cleanup" && run.sample === 1
        ? { ...run, sessionId: null, databaseName: null, retained: null, close: null, rootRemoved: false, frameYielded: false, gcPasses: null, status: "FAIL", failure: timeoutFailure }
        : run)
    });

    const decision = classifyEventHistoryPerformance(timedOut, referenceFrom(baseline));
    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("CdpRequestTimeout"))).toBe(true);
    expect(decision.failures.some((failure) => failure.includes("malformed"))).toBe(false);
  });

  it("requires each measured heap identity to match its cleanup evidence", () => {
    const baseline = report();
    expect(classifyEventHistoryPerformance(baseline, referenceFrom(baseline)).verdict).toBe("PASS");

    const mismatched = report({
      heapRuns: baseline.heapRuns.map((run, index) => index === 2 ? { ...run, sessionId: "wrong-session" } : run)
    });
    const duplicate = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 1 ? { ...sample, sessionId: baseline.heapSamples[0]!.sessionId } : sample)
    });

    expect(classifyEventHistoryPerformance(mismatched, referenceFrom(baseline)).verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(duplicate, referenceFrom(baseline)).verdict).toBe("FAIL");
  });

  it("enforces adapter-specific heap database identity", () => {
    const baseline = report();
    const invalidIndexedDb = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 0 ? { ...sample, databaseName: null } : sample)
    });
    const invalidMemory = report({
      heapSamples: baseline.heapSamples.map((sample, index) => index === 1 ? { ...sample, databaseName: "memory-database" } : sample)
    });
    const invalidCleanup = report({
      heapRuns: baseline.heapRuns.map((run, index) => index === 0 ? { ...run, databaseName: null } : run)
    });

    expect(classifyEventHistoryPerformance(invalidIndexedDb, referenceFrom(baseline)).verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(invalidMemory, referenceFrom(baseline)).verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(invalidCleanup, referenceFrom(baseline)).verdict).toBe("FAIL");
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

  it("fails closed when Long Task telemetry is unsupported or unattributed", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? { ...entry, longTasks: { ...entry.longTasks, supported: false, unattributed: 1 } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("Long Task telemetry"))).toBe(true);
  });

  it("keeps explicitly diagnosed ambiguity fail-closed", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? {
            ...entry,
            longTasks: {
              ...entry.longTasks,
              unattributed: 1,
              unattributedReasons: [{
                reason: "ambiguous",
                overlaps: [
                  { phase: "capture", duration: 5 },
                  { phase: "commit", duration: 5 }
                ]
              }]
            }
          }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("unattributed"))).toBe(true);
  });

  it("fails measured IndexedDB amplification that is not internally coherent", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? { ...entry, storage: { ...entry.storage, indexEntryCount: entry.storage.indexEntryCount + 1 } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("index amplification"))).toBe(true);
  });

  it("fails checkpoint evidence that does not prove interleaved sustained traffic", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) =>
        index === 0 ? { ...scenario, interleaved: false } : scenario
      )
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("interleaved"))).toBe(true);
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

  it("does not REVIEW a single current outlier when the comparable current median is unchanged", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? { ...entry, latency: { ...entry.latency, recentPageP95Ms: 20 } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("PASS");
    expect(decision.reviewReasons).toEqual([]);
  });

  it("REVIEWs when the comparable current median regresses over twenty percent", () => {
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

  it("requires exact independently auditable identity arrays", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? {
            ...entry,
            correctness: { ...entry.correctness, retainedInOrder: true },
            identityEvidence: { ...entry.identityEvidence, retainedEventIds: [...entry.identityEvidence.expectedEventIds].reverse() }
          }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("retained identifier order"))).toBe(true);
  });

  it("accepts unavailable storage-estimate telemetry without making it an authoritative gate", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry) => ({
        ...entry,
        storageEstimate: {
          source: "navigator.storage.estimate" as const,
          status: "UNAVAILABLE" as const,
          usageBytes: null,
          quotaBytes: null,
          failure: { code: "STORAGE_ESTIMATE_UNAVAILABLE", message: "navigator.storage.estimate is unavailable." }
        }
      }))
    });

    expect(classifyEventHistoryPerformance(current, referenceFrom(current)).verdict).toBe("PASS");
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

  it("accepts a negative post-GC heap delta when the sample is otherwise valid", () => {
    const baseline = report();
    const current = report({
      heapSamples: baseline.heapSamples.map((sample, index) =>
        index === 0 ? { ...sample, postGcHeapDeltaBytes: -1 } : sample
      )
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("PASS");
    expect(decision.failures).toEqual([]);
  });

  it("fails closed for a pinned reference with duplicate matrix samples", () => {
    const baseline = report();
    const reference = referenceFrom(baseline);
    const malformedReference = {
      ...reference,
      cells: [...reference.cells.slice(0, -1), reference.cells[0]!]
    };

    const decision = classifyEventHistoryPerformance(baseline, malformedReference);

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("reference"))).toBe(true);
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

  it("rejects a pending reference during preflight", () => {
    expect(validateEventHistoryPerformanceReference({
      referenceVersion: "history-impl-11-initial",
      disposition: "PENDING_MAINTAINER_BASELINE",
      rationale: "pending",
      schemaVersion: 2,
      environment: report().environment,
      cells: report().cells
    })).toBe(false);
  });
});
