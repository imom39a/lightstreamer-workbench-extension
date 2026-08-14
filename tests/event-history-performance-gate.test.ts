import { describe, expect, it } from "vitest";

import {
  classifyEventHistoryPerformance,
  EVENT_HISTORY_PERFORMANCE_PROOF_MODES,
  EVENT_HISTORY_PERFORMANCE_SELECTION_MODES,
  FILTER_IMPL_08_EXCLUDED_SCENARIOS,
  FILTER_IMPL_08_PROOF_GATES,
  EVENT_HISTORY_PERFORMANCE_LIMITS,
  isExactQueryPage,
  validateEventHistoryPerformanceReference,
  type EventHistoryPerformanceCell,
  type EventHistoryPerformanceCheckpointScenario,
  type EventHistoryPerformanceHeapSample,
  type EventHistoryPerformanceReference,
  type EventHistoryPerformanceReport,
  type EventHistoryPerformanceQueryCell
} from "../benchmarks/event-history-performance-gate";

function queryCell(adapter: "indexeddb" | "memory", sample: number): EventHistoryPerformanceQueryCell {
  const operation = (payloadHydrations = 0) => ({ candidateBound: 3, projectionReads: 3, payloadHydrations, bounded: true, residualScan: false });
  return {
    adapter, sample,
    fixture: { eventCount: adapter === "indexeddb" ? 10_000 : 5_000, distinctCommandKeyCount: 3_842 },
    latency: { recentSimplePage50P95Ms: 5, recentSimplePage100P95Ms: 5, structuredPage50P95Ms: 10, structuredPage100P95Ms: 10, findP95Ms: 10, lookupP95Ms: 10, aroundP95Ms: 10 },
    correctness: { totalsExact: true, orderExact: true, collisionExact: true, findIndependent: true, lookupExact: true, aroundExact: true },
    telemetry: { operations: { recent50: operation(), recent100: operation(), structured50: operation(), structured100: operation(), find: operation(), lookup: operation(1), around: operation() } },
    longTasks: [],
    longTaskObserverSupported: true,
    querySampleGc: Array.from({ length: 14 }, (_, index) => ({ query: `q-${index}`, afterSample: (index % 2 === 0 ? 1 : 2) as 1 | 2, gcPasses: 3 as const, phase: "BETWEEN_QUERY_SAMPLES" as const }))
  };
}

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
    longTasks: { supported: true, unattributed: 0, capture: [], commit: [], paint: [], query: [], hygiene: [], unattributedReasons: [] },
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
    querySampleGc: ["recent-page", "structured-indexed", "find", "full"].flatMap((query) => [1, 2].map((afterSample) => ({
      query,
      afterSample: afterSample as 1 | 2,
      gcPasses: 3 as const,
      phase: "BETWEEN_QUERY_SAMPLES" as const
    }))),
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

function checkpointEvidence(name: "representative" | "maximum-2MiB", adapter: "indexeddb" | "memory") {
  const liveCaptureEventIds = Array.from({ length: 72 }, (_, index) => `${adapter}-${name}-live-${index + 1}`);
  const checkpointEventId = `${adapter}-${name}-checkpoint-complete`;
  const liveCaptureEventTimesMs = Array.from({ length: 72 }, (_, index) => 100 + index * (1_200 / 71));
  const retainedEventIds = [
    ...Array.from({ length: 4 }, (_, index) => `${adapter}-${name}-before-${index}`),
    ...liveCaptureEventIds,
    checkpointEventId,
    ...Array.from({ length: 4 }, (_, index) => `${adapter}-${name}-after-${index}`)
  ];
  const expectedEventIds = [...retainedEventIds];
  return {
    name,
    adapter,
    accepted: true,
    retained: retainedEventIds.length,
    trafficBefore: 4,
    trafficAfter: 4,
    liveCaptureEventIds,
    expectedCheckpointEventIds: [checkpointEventId],
    offeredCheckpointEventIds: [checkpointEventId],
    offeredEventIds: [...expectedEventIds],
    productionObservedLiveEventIds: [...liveCaptureEventIds],
    productionObservedLiveEventTimesMs: [...liveCaptureEventTimesMs],
    observationProvenance: "production-panel-committed-evidence-hook" as const,
    offeredLiveCaptureEventTimesMs: [...liveCaptureEventTimesMs],
    liveCaptureEventTimesMs,
    retainedEventIds,
    publishedEventIds: [...retainedEventIds],
    expectedEventIds,
    liveCaptureCount: liveCaptureEventIds.length,
    liveCaptureStartedAtMs: 100,
    liveCaptureEndedAtMs: 1_300,
    liveCaptureDurationMs: 1_200,
    checkpointStagingStartedAtMs: 90,
    checkpointStagingEndedAtMs: 1_310,
    checkpointStagingDurationMs: 1_220,
    liveCaptureOverlapMs: 1_200,
    liveCaptureOverlapEventCount: 72,
    liveCaptureMaxInterEventGapMs: 1_200 / 72,
    liveCaptureRateEventsPerSecond: 60,
    liveCaptureRateSatisfied: true,
    interleavedWhileStaging: true,
    canonicalBytes: name === "representative" ? 10_000 : 2 * 1_048_576,
    committedBoundaryCorrect: true,
    batchAcceptedAsOneOversizedUnit: true
  };
}

function checkpointWithProductionTimes(
  scenario: EventHistoryPerformanceCheckpointScenario,
  times: number[]
): EventHistoryPerformanceCheckpointScenario {
  const startedAt = times[0]!;
  const endedAt = times.at(-1)!;
  const duration = endedAt - startedAt;
  const maxGap = times.slice(1).reduce((maximum, timestamp, index) => Math.max(maximum, timestamp - times[index]!), 0);
  return {
    ...scenario,
    productionObservedLiveEventTimesMs: times,
    offeredLiveCaptureEventTimesMs: [...times],
    liveCaptureEventTimesMs: [...times],
    liveCaptureStartedAtMs: startedAt,
    liveCaptureEndedAtMs: endedAt,
    liveCaptureDurationMs: duration,
    checkpointStagingStartedAtMs: startedAt - 10,
    checkpointStagingEndedAtMs: endedAt + 10,
    checkpointStagingDurationMs: duration + 20,
    liveCaptureOverlapMs: duration,
    liveCaptureOverlapEventCount: times.length,
    liveCaptureMaxInterEventGapMs: maxGap,
    liveCaptureRateEventsPerSecond: times.length * 1_000 / duration,
    liveCaptureRateSatisfied: times.length * 1_000 / duration >= 50,
    interleavedWhileStaging: duration >= 1_000 && maxGap <= 250
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
    capabilities: {
      interCellGc: "EXPOSED_THREE_PASS_V1",
      interQuerySampleGc: "EXPOSED_THREE_PASS_V1",
      interQueryGcLongTasks: "EXPLICIT_HYGIENE_PHASE_V1"
    },
    cells,
    queryCells: [1, 2, 3].flatMap((sample) => [queryCell("indexeddb", sample), queryCell("memory", sample)]),
    cellCleanupGc: Array.from({ length: 35 }, (_, index) => ({
      afterCellIndex: index + 1,
      gcPasses: 3 as const,
      phase: "BETWEEN_CELLS" as const
    })),
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
      checkpointEvidence("representative", adapter as "indexeddb" | "memory"),
      checkpointEvidence("maximum-2MiB", adapter as "indexeddb" | "memory")
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
    proofMode: reportValue.proofMode,
    cells: reportValue.cells,
    queryCells: reportValue.queryCells
  };
}

describe("Event History real-Chrome performance gate classifier", () => {
  it("keeps the non-interactive proof mode distinct from headed visible-frame proof", () => {
    const headed = report();
    const nonInteractive = {
      ...headed,
      environment: { ...headed.environment, headless: true },
      proofMode: EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT,
      frameProof: {
        publicationBoundary: "react-layout-commit-dom-publication" as const,
        compositorFrameMeasured: false,
        coherent: true,
        missingBoundaryCount: 0
      }
    };
    expect(classifyEventHistoryPerformance(nonInteractive, undefined, "ordinary").verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(headed, referenceFrom(headed), "non-interactive").verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(nonInteractive, referenceFrom(nonInteractive), "non-interactive").verdict).toBe("PASS");
  });

  it("applies the unchanged absolute thresholds in non-interactive mode", () => {
    const candidate = report({
      environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64", headless: true },
      proofMode: EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT,
      frameProof: {
        publicationBoundary: "react-layout-commit-dom-publication",
        compositorFrameMeasured: false,
        coherent: true,
        missingBoundaryCount: 0
      },
      cells: report().cells.map((entry, index) => index === 0
        ? { ...entry, latency: { ...entry.latency, offerToVisibleFrameP95Ms: EVENT_HISTORY_PERFORMANCE_LIMITS.indexeddb.sustainedVisibleP95Ms + 1 } }
        : entry)
    });
    expect(classifyEventHistoryPerformance(candidate, undefined, "non-interactive-capture-only").verdict).toBe("FAIL");
    expect(classifyEventHistoryPerformance(candidate, undefined, "non-interactive-capture-only").failures.join(" ")).toMatch(/exceeds 100 ms/u);
  });

  it("classifies the scoped filter-impl-08 query and heap proof without lifecycle or terminal evidence", () => {
    const scoped = report({
      environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64", headless: true },
      selectionMode: EVENT_HISTORY_PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08,
      selection: {
        mode: EVENT_HISTORY_PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08,
        proofSelection: "filter-impl-08-noninteractive-layout-commit",
        includedGates: FILTER_IMPL_08_PROOF_GATES,
        excludedScenarios: FILTER_IMPL_08_EXCLUDED_SCENARIOS,
        disclaimer: "Scoped noninteractive layout-commit proof only; it does not prove foreground scheduling or compositor frames."
      },
      proofMode: EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT,
      frameProof: {
        publicationBoundary: "react-layout-commit-dom-publication",
        compositorFrameMeasured: false,
        coherent: true,
        missingBoundaryCount: 0
      },
      capabilities: { interQuerySampleGc: "EXPOSED_THREE_PASS_V1", interQueryGcLongTasks: "EXPLICIT_HYGIENE_PHASE_V1" },
      cells: [],
      cellCleanupGc: [],
      terminalScenarios: [],
      checkpointScenarios: [],
      lifecycle: { retainedHeapBytes: [], strictMonotonicGrowth: false }
    });
    const candidate = classifyEventHistoryPerformance(scoped, undefined, "filter-impl-08-capture-only");
    expect(candidate.verdict).toBe("NOT_CLASSIFIED");
    expect(candidate.failures).toEqual([]);

    const reference: EventHistoryPerformanceReference = {
      ...referenceFrom(scoped),
      selectionMode: EVENT_HISTORY_PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08,
      environment: scoped.environment,
      proofMode: scoped.proofMode,
      cells: []
    };
    expect(validateEventHistoryPerformanceReference(reference)).toBe(true);
    expect(classifyEventHistoryPerformance({ ...scoped, source: { revision: "comparison-revision", dirty: false } }, reference, "filter-impl-08").verdict).toBe("PASS");
  });

  it("rejects an Around page with the wrong size, order, or identity", () => {
    const expected = [
      { sequence: 1_999, eventId: "event-1999" },
      { sequence: 1_998, eventId: "event-1998" },
      { sequence: 1_997, eventId: "event-1997" }
    ];
    const page = { evidence: expected.map((identity) => ({ identity })) };

    expect(isExactQueryPage(page, expected)).toBe(true);
    expect(isExactQueryPage({ evidence: page.evidence.slice(0, 2) }, expected)).toBe(false);
    expect(isExactQueryPage({ evidence: [page.evidence[1]!, page.evidence[0]!, page.evidence[2]!] }, expected)).toBe(false);
    expect(isExactQueryPage({ evidence: [{ identity: { ...expected[0]!, eventId: "wrong-event" } }, ...page.evidence.slice(1)] }, expected)).toBe(false);
  });

  it("fails unless all 35 ordered inter-cell three-pass GC boundaries are recorded", () => {
    const baseline = report();
    const evidence = baseline.cellCleanupGc!;
    const missing = classifyEventHistoryPerformance({ ...baseline, cellCleanupGc: evidence.slice(0, -1) }, referenceFrom(baseline));
    const reordered = classifyEventHistoryPerformance({ ...baseline, cellCleanupGc: [...evidence].reverse() }, referenceFrom(baseline));

    expect(missing.verdict).toBe("FAIL");
    expect(reordered.verdict).toBe("FAIL");
    expect(missing.failures.some((failure) => failure.includes("cells 1 through 35"))).toBe(true);
  });

  it("fails a current capable candidate when inter-cell GC evidence is missing", () => {
    const baseline = report();
    const current = { ...baseline, cellCleanupGc: undefined };

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("cells 1 through 35"))).toBe(true);
  });

  it("keeps an unmarked schema-v2 report and reference backward compatible", () => {
    const baseline = report();
    const legacy = {
      ...baseline,
      capabilities: undefined,
      cellCleanupGc: undefined,
      cells: baseline.cells.map(({ querySampleGc: _querySampleGc, ...cellValue }) => cellValue)
    };
    const reference = referenceFrom(baseline);

    expect(classifyEventHistoryPerformance(legacy, reference).verdict).toBe("PASS");
    expect(validateEventHistoryPerformanceReference(reference)).toBe(true);
  });

  it("fails a current capable candidate when inter-query GC evidence is missing", () => {
    const baseline = report();
    const current = { ...baseline, cells: baseline.cells.map(({ querySampleGc: _querySampleGc, ...cellValue }) => cellValue) };

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("inter-query GC boundaries"))).toBe(true);
  });

  it("returns PASS only when all three samples and the pinned reference pass", () => {
    const current = report();
    const decision = classifyEventHistoryPerformance(current, referenceFrom(current));

    expect(decision.verdict).toBe("PASS");
    expect(decision.checkedCells).toBe(12);
    expect(decision.checkedSamples).toBe(36);
  });

  it("runs capture-only absolute gates without accepting a reference operand", () => {
    const current = report();
    const decision = classifyEventHistoryPerformance(current, current, "capture-only");

    expect(decision.verdict).toBe("NOT_CLASSIFIED");
    expect(decision.failures).toEqual([]);
    expect(decision.reviewReasons).toEqual([
      "Candidate capture is not classified until a maintainer adopts a separately pinned reference."
    ]);
  });

  it.each([
    ["dirty source", () => ({ source: { revision: "dirty", dirty: true } })],
    ["correctness", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, correctness: { ...entry.correctness, retainedInOrder: false } } : entry) })],
    ["sustained latency", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, latency: { ...entry.latency, offerToVisibleFrameP95Ms: 101 } } : entry) })],
    ["burst boundary latency", () => ({ cells: report().cells.map((entry, index) => index === 9 ? { ...entry, latency: { ...entry.latency, finalBoundaryVisibleMs: 30_001 } } : entry) })],
    ["query latency", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, latency: { ...entry.latency, recentPageP95Ms: 51, structuredIndexedP95Ms: 101, findFullP95Ms: 501 } } : entry) })],
    ["capture Long Task", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, longTasks: { ...entry.longTasks, capture: [50.001] } } : entry) })],
    ["commit Long Task", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, longTasks: { ...entry.longTasks, commit: [50.001] } } : entry) })],
    ["paint Long Task", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, longTasks: { ...entry.longTasks, paint: [50.001] } } : entry) })],
    ["query Long Task", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, longTasks: { ...entry.longTasks, query: [126] } } : entry) })],
    ["unsupported Long Task telemetry", () => ({ cells: report().cells.map((entry, index) => index === 0 ? { ...entry, longTasks: { ...entry.longTasks, supported: false } } : entry) })],
    ["heap limit", () => ({ heapSamples: report().heapSamples.map((entry, index) => index === 0 ? { ...entry, postGcHeapDeltaBytes: 8 * 1_048_576 + 1 } : entry) })],
    ["memory burst boundary latency", () => ({ cells: report().cells.map((entry, index) => index === 27 ? { ...entry, latency: { ...entry.latency, finalBoundaryVisibleMs: 1_001 } } : entry) })],
    ["heap cleanup", () => ({ heapSamples: report().heapSamples.map((entry, index) => index === 0 ? { ...entry, status: "FAIL", failure: { code: "CLOSE_FAILED", message: "cleanup failed" }, postGcHeapDeltaBytes: null } : entry) })],
    ["terminal scenario", () => ({ terminalScenarios: report().terminalScenarios.map((entry, index) => index === 0 ? { ...entry, pressureTransitions: ["EXHAUSTED"] } : entry) })],
    ["checkpoint scenario", () => ({ checkpointScenarios: report().checkpointScenarios.map((entry, index) => index === 0 ? { ...entry, accepted: false } : entry) })],
    ["lifecycle growth", () => ({ lifecycle: { retainedHeapBytes: [1, 2, 3], strictMonotonicGrowth: true } })]
  ])("keeps capture-only mode fail-closed for %s", (_label, override) => {
    const decision = classifyEventHistoryPerformance({ ...report(), ...override() } as unknown, undefined, "capture-only");

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.length).toBeGreaterThan(0);
  });

  it("fails when production-hook timestamps are a short burst despite sustained offer timestamps", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => index === 0
        ? {
            ...scenario,
            productionObservedLiveEventTimesMs: scenario.productionObservedLiveEventTimesMs.map((_timestamp, eventIndex) => 100 + eventIndex * 5)
          }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("checkpoint"))).toBe(true);
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

  it("reports proven inter-query GC hygiene without treating it as query production work", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? { ...entry, longTasks: { ...entry.longTasks, hygiene: [100] } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(current.cells[0]!.longTasks.hygiene).toEqual([100]);
    expect(decision.verdict).toBe("PASS");
  });

  it("fails closed when hygiene attribution is capability-marked but absent", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => {
        if (index !== 0) return entry;
        const { hygiene: _hygiene, ...longTasks } = entry.longTasks;
        return { ...entry, longTasks };
      })
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("hygiene Long Task attribution"))).toBe(true);
  });

  it("still rejects a real query-overlap Long Task when hygiene evidence is supported", () => {
    const baseline = report();
    const current = report({
      cells: baseline.cells.map((entry, index) => index === 0
        ? { ...entry, longTasks: { ...entry.longTasks, query: [60] } }
        : entry)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("too many query Long Tasks"))).toBe(true);
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
        index === 0 ? { ...scenario, interleavedWhileStaging: false } : scenario
      )
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("concurrent live capture"))).toBe(true);
  });

  it.each([
    [999, false],
    [1_000, true]
  ] as const)("enforces the checkpoint production-overlap boundary at %i ms", (duration, accepted) => {
    const baseline = report();
    const times = Array.from({ length: 72 }, (_, index) => 100 + index * duration / 71);
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) =>
        index === 0 ? checkpointWithProductionTimes(scenario, times) : scenario
      )
    });
    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));
    expect(decision.failures.some((failure) => failure.includes("concurrent live capture"))).toBe(!accepted);
  });

  it.each([
    [250, true],
    [251, false]
  ] as const)("enforces the checkpoint production gap boundary at %i ms", (firstGap, accepted) => {
    const baseline = report();
    const times = [100, ...Array.from({ length: 71 }, (_, index) => 100 + firstGap + index * (1_000 / 70))];
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) =>
        index === 0 ? checkpointWithProductionTimes(scenario, times) : scenario
      )
    });
    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));
    expect(decision.failures.some((failure) => failure.includes("concurrent live capture"))).toBe(!accepted);
  });

  it("rejects internally consistent checkpoint-before-live evidence", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => {
        if (index !== 0) return scenario;
        const before = scenario.expectedEventIds.slice(0, scenario.trafficBefore);
        const after = scenario.expectedEventIds.slice(-scenario.trafficAfter);
        const wrongOrder = [...before, ...scenario.expectedCheckpointEventIds, ...scenario.liveCaptureEventIds, ...after];
        return {
          ...scenario,
          expectedEventIds: wrongOrder,
          offeredEventIds: [...wrongOrder],
          retainedEventIds: [...wrongOrder],
          publishedEventIds: [...wrongOrder]
        };
      })
    });
    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));
    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("checkpoint evidence"))).toBe(true);
  });

  it("fails checkpoint traffic that only surrounds staging without overlapping it", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => index === 0
        ? {
            ...scenario,
            liveCaptureStartedAtMs: 0,
            liveCaptureEndedAtMs: 10,
            liveCaptureDurationMs: 10,
            checkpointStagingStartedAtMs: 20,
            checkpointStagingEndedAtMs: 30,
            checkpointStagingDurationMs: 10,
            liveCaptureOverlapMs: 0,
            liveCaptureOverlapEventCount: 0,
            liveCaptureRateEventsPerSecond: 7200,
            liveCaptureRateSatisfied: true,
            interleavedWhileStaging: false
          }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("concurrent live capture"))).toBe(true);
  });

  it.each(["dropped", "substituted", "reordered"] as const)(
    "fails checkpoint evidence with a %s retained or published identifier",
    (mutation) => {
      const baseline = report();
      const current = report({
        checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => {
          if (index !== 0) return scenario;
          const mutated = [...scenario.retainedEventIds];
          if (mutation === "dropped") {
            mutated.splice(5, 1);
          } else if (mutation === "substituted") {
            mutated[5] = `${mutated[5]}-substituted`;
          } else {
            [mutated[5], mutated[6]] = [mutated[6]!, mutated[5]!];
          }
          return { ...scenario, retainedEventIds: mutated, publishedEventIds: [...mutated] };
        })
      });

      const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

      expect(decision.verdict).toBe("FAIL");
    }
  );

  it.each(["dropped", "substituted", "reordered"] as const)(
    "fails checkpoint evidence with a %s offered identifier",
    (mutation) => {
      const baseline = report();
      const current = report({
        checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => {
          if (index !== 0) return scenario;
          const mutated = [...scenario.offeredEventIds];
          if (mutation === "dropped") {
            mutated.splice(5, 1);
          } else if (mutation === "substituted") {
            mutated[5] = `${mutated[5]}-substituted`;
          } else {
            [mutated[5], mutated[6]] = [mutated[6]!, mutated[5]!];
          }
          return { ...scenario, offeredEventIds: mutated };
        })
      });

      const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

      expect(decision.verdict).toBe("FAIL");
    }
  );

  it("fails a short high-rate burst even when it overlaps staging", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => index === 0
        ? {
            ...scenario,
            liveCaptureEventTimesMs: Array.from({ length: 72 }, (_, eventIndex) => 100 + eventIndex * (10 / 72)),
            liveCaptureStartedAtMs: 100,
            liveCaptureEndedAtMs: 110,
            liveCaptureDurationMs: 10,
            checkpointStagingStartedAtMs: 90,
            checkpointStagingEndedAtMs: 120,
            checkpointStagingDurationMs: 30,
            liveCaptureOverlapMs: 10,
            liveCaptureOverlapEventCount: 72,
            liveCaptureMaxInterEventGapMs: 10 / 72,
            liveCaptureRateEventsPerSecond: 7_200,
            liveCaptureRateSatisfied: true,
            interleavedWhileStaging: true
          }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("concurrent live capture"))).toBe(true);
  });

  it("fails checkpoint overlap that does not sustain the required live rate", () => {
    const baseline = report();
    const current = report({
      checkpointScenarios: baseline.checkpointScenarios.map((scenario, index) => index === 0
        ? { ...scenario, liveCaptureRateEventsPerSecond: 49, liveCaptureRateSatisfied: false }
        : scenario)
    });

    const decision = classifyEventHistoryPerformance(current, referenceFrom(baseline));

    expect(decision.verdict).toBe("FAIL");
    expect(decision.failures.some((failure) => failure.includes("50 events/sec"))).toBe(true);
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

  it.each([
    ["duplicate query sample", (queryCells: readonly EventHistoryPerformanceQueryCell[]) => [
      ...queryCells.slice(0, -1),
      queryCells[0]!
    ]],
    ["missing query sample", (queryCells: readonly EventHistoryPerformanceQueryCell[]) => queryCells.slice(0, -1)]
  ])("fails closed for a pinned reference with %s", (_label, mutateQueryCells) => {
    const baseline = report();
    const reference = referenceFrom(baseline);
    const malformedReference = {
      ...reference,
      queryCells: mutateQueryCells(reference.queryCells)
    };

    expect(validateEventHistoryPerformanceReference(malformedReference)).toBe(false);
    const decision = classifyEventHistoryPerformance(baseline, malformedReference);

    expect(decision.verdict).toBe("FAIL");
    expect(decision.reviewReasons).toEqual([]);
  });

  it.each([
    ["malformed telemetry", (queryCells: readonly EventHistoryPerformanceQueryCell[]) => queryCells.map((cell, index) => index === 0
      ? { ...cell, telemetry: { operations: { ...cell.telemetry.operations, find: undefined } } }
      : cell)],
    ["invalid absolute threshold", (queryCells: readonly EventHistoryPerformanceQueryCell[]) => queryCells.map((cell, index) => index === 0
      ? { ...cell, latency: { ...cell.latency, findP95Ms: EVENT_HISTORY_PERFORMANCE_LIMITS.query.findFullP95Ms + 1 } }
      : cell)]
  ])("fails closed for a pinned reference with %s query cells", (_label, mutateQueryCells) => {
    const baseline = report();
    const reference = referenceFrom(baseline);
    const malformedReference = {
      ...reference,
      queryCells: mutateQueryCells(reference.queryCells)
    };

    expect(validateEventHistoryPerformanceReference(malformedReference)).toBe(false);
    const decision = classifyEventHistoryPerformance(baseline, malformedReference);

    expect(decision.verdict).toBe("FAIL");
    expect(decision.reviewReasons).toEqual([]);
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
