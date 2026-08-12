import { describe, expect, it, vi } from "vitest";

import {
  createTopologyCheckpointEvidenceCandidate,
  decodeTopologyCheckpointEvidenceCandidate
} from "../src/extension/panel/topology-checkpoint-evidence-codec";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import {
  attributeLongTasks,
  bestEffortHeapPreparationCleanup,
  captureStorageEstimate,
  closeHeapSessionWithEvidence,
  cleanupHarnessResources,
  createPendingTelemetryTracker,
  createReceiptStageController,
  createStagedTopologyCheckpointCandidate,
  createHarnessStageGuard,
  captureCellWorkloadFactScalars,
  burstOfferedEventsPerSecond,
  collectGarbageBetweenCells,
  collectGarbageBetweenQuerySamples,
  HarnessStageTimeout,
  measureCheckpointLiveCapture,
  measureAuthoritativeFullQuery,
  measureQuery,
  offerSustained,
  settleOffers,
  settleReceiptStage,
  publishHarnessProgress,
  runCheckpointScenario,
  runCellThenCollectGarbage,
  runTerminalScenario,
  waitForBoundedFrame,
  withStageDeadline,
  type HarnessProgressInput
} from "../benchmarks/event-history-performance-harness";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import * as eventHistoryAuthoritative from "../src/core/event-history-authoritative";
import type { EventHistory } from "../src/core/event-history-authoritative";
import { TOPOLOGY_OBSERVATION_VERSION } from "../src/bridge/messages";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

describe("Event History performance checkpoint workload", () => {
  it("captures scalar workload facts before caller payloads are released", () => {
    const events = [createEventHistoryWorkloadEvent("small-lifecycle", 0, "released-workload")];
    const facts = captureCellWorkloadFactScalars("small-lifecycle", events[0]!);

    events.length = 0;

    expect(facts).toEqual({
      shapeBytes: expect.any(Number),
      persistedJsonBytes: expect.any(Number),
      indexedDbWritesPerEvent: expect.any(Number),
      searchTokenCount: expect.any(Number)
    });
    expect(Object.values(facts).every((value) => value > 0)).toBe(true);
    expect(Object.isFrozen(facts)).toBe(true);
  });

  it("derives burst offer rate from enqueue duration only", () => {
    expect(burstOfferedEventsPerSecond(1_692, 2_000)).toBe(846);
    expect(burstOfferedEventsPerSecond(10, 0)).toBe(10_000);
  });

  it("collects exactly three times only after the measured cell and cleanup resolve", async () => {
    const order: string[] = [];
    const result = await runCellThenCollectGarbage(
      async () => {
        order.push("query");
        await Promise.resolve();
        order.push("cleanup");
        return "cell-result";
      },
      7,
      createHarnessStageGuard(),
      async (afterCellIndex, guard) => {
        expect(order).toEqual(["query", "cleanup"]);
        return collectGarbageBetweenCells(afterCellIndex, guard, () => order.push("gc"));
      }
    );

    expect(order).toEqual(["query", "cleanup", "gc", "gc", "gc"]);
    expect(result).toEqual({ cell: "cell-result", gc: { afterCellIndex: 7, gcPasses: 3, phase: "BETWEEN_CELLS" } });
  });

  it("fails closed when exposed inter-cell garbage collection is unavailable", async () => {
    await expect(collectGarbageBetweenCells(1, createHarnessStageGuard(), null))
      .rejects.toThrow(/requires Chrome --expose-gc/u);
  });

  it("releases early query results and excludes inter-query GC from all three timings", async () => {
    const evidence: Array<Awaited<ReturnType<typeof collectGarbageBetweenQuerySamples>>> = [];
    const order: string[] = [];
    let now = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const p95 = await measureQuery(
        {} as EventHistory,
        async () => {
          order.push("query");
          now += 5;
          return { large: "payload" };
        },
        "full",
        () => progress("query"),
        createHarnessStageGuard(),
        evidence,
        async (query, afterSample) => {
          order.push("gc");
          now += 1_000;
          return { query, afterSample, gcPasses: 3, phase: "BETWEEN_QUERY_SAMPLES" };
        }
      );

      expect(p95).toBe(5);
      expect(order).toEqual(["query", "gc", "query", "gc", "query"]);
      expect(evidence.map(({ query, afterSample }) => `${query}:${afterSample}`)).toEqual(["full:1", "full:2"]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fails closed when exposed inter-query garbage collection is unavailable", async () => {
    await expect(collectGarbageBetweenQuerySamples("full", 1, createHarnessStageGuard(), null))
      .rejects.toThrow(/requires Chrome --expose-gc/u);
  });

  it("represents the real BEGIN/CHUNK/COMPLETE production staging sequence without journaling frames", () => {
    const complete = createStagedTopologyCheckpointCandidate("frame-sequence", "frame-sequence-sync", 64 * 1_024);
    expect(complete.kind).toBe("topology-checkpoint");
    if (complete.kind !== "topology-checkpoint") return;
    const frames = decodeTopologyCheckpointEvidenceCandidate(complete);
    expect(frames).not.toBeNull();
    expect(frames!.at(0)!.type).toBe("lsew:topology-sync-begin");
    expect(frames!.at(-1)!.type).toBe("lsew:topology-sync-complete");
    expect(frames!.slice(1, -1).every((frame) => frame.type === "lsew:topology-sync-chunk")).toBe(true);
  });

  it("fails closed for before-and-after-only traffic and accepts measured concurrent staging traffic", () => {
    const beforeAndAfter = measureCheckpointLiveCapture({
      checkpointStagingStartedAtMs: 20,
      checkpointStagingEndedAtMs: 30,
      liveCaptureEventTimesMs: [0, 5, 10]
    });
    expect(beforeAndAfter.interleavedWhileStaging).toBe(false);
    expect(beforeAndAfter.liveCaptureOverlapMs).toBe(0);
    expect(beforeAndAfter.liveCaptureOverlapEventCount).toBe(0);

    const shortBurst = measureCheckpointLiveCapture({
      checkpointStagingStartedAtMs: 90,
      checkpointStagingEndedAtMs: 120,
      liveCaptureEventTimesMs: [100, 101, 102, 103, 104, 105]
    });
    expect(shortBurst.liveCaptureRateEventsPerSecond).toBeGreaterThan(50);
    expect(shortBurst.liveCaptureOverlapMs).toBe(5);
    expect(shortBurst.interleavedWhileStaging).toBe(false);

    const concurrent = measureCheckpointLiveCapture({
      checkpointStagingStartedAtMs: 90,
      checkpointStagingEndedAtMs: 1_310,
      liveCaptureEventTimesMs: Array.from({ length: 72 }, (_, index) => 100 + index * (1_200 / 72))
    });
    const expectedDuration = 1_200 * 71 / 72;
    expect(concurrent.interleavedWhileStaging).toBe(true);
    expect(concurrent.liveCaptureOverlapMs).toBeCloseTo(expectedDuration, 10);
    expect(concurrent.liveCaptureOverlapEventCount).toBe(72);
    expect(concurrent.liveCaptureRateEventsPerSecond).toBeCloseTo(72_000 / expectedDuration, 10);
    expect(concurrent.liveCaptureMaxInterEventGapMs).toBeCloseTo(1_200 / 72, 10);
  });

  it("measures paced live capture while the production checkpoint stage is held", async () => {
    const scenario = await runCheckpointScenario("memory", "representative", null, createHarnessStageGuard());
    const overlapEventSpan = scenario.liveCaptureEventTimesMs.at(-1)! - scenario.liveCaptureEventTimesMs[0]!;

    expect(scenario.liveCaptureCount).toBe(scenario.liveCaptureEventIds.length);
    expect(scenario.liveCaptureDurationMs).toBeGreaterThanOrEqual(1_000);
    expect(scenario.checkpointStagingDurationMs).toBeGreaterThanOrEqual(1_000);
    expect(scenario.liveCaptureOverlapMs).toBeGreaterThanOrEqual(1_000);
    expect(overlapEventSpan).toBeGreaterThanOrEqual(1_000);
    expect(scenario.liveCaptureMaxInterEventGapMs).toBeLessThanOrEqual(250);
    expect(scenario.liveCaptureRateEventsPerSecond).toBeGreaterThanOrEqual(50);
    expect(scenario.interleavedWhileStaging).toBe(true);
    expect(scenario.observationProvenance).toBe("production-panel-committed-evidence-hook");
    expect(scenario.expectedCheckpointEventIds).toHaveLength(1);
    expect(scenario.offeredCheckpointEventIds).toEqual(scenario.expectedCheckpointEventIds);
    expect(scenario.offeredEventIds).toEqual(scenario.expectedEventIds);
    expect(scenario.retainedEventIds).toEqual(scenario.expectedEventIds);
    expect(scenario.publishedEventIds).toEqual(scenario.expectedEventIds);
    expect(scenario.productionObservedLiveEventIds).toEqual(scenario.liveCaptureEventIds);
    expect(scenario.productionObservedLiveEventTimesMs).toHaveLength(scenario.liveCaptureEventIds.length);
  });

  it("cleans checkpoint panel resources after cancellation immediately after panel acquisition", async () => {
    let thrown: unknown;
    const guard = createHarnessStageGuard();
    try {
      await runCheckpointScenario("memory", "representative", null, guard, {
        afterPanelMount: () => guard.invalidate()
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { message: string }).message).toContain("panel acquisition");
    expect((thrown as Error & { cleanupEvidence: { closeAttempted: boolean; rootRemovalAttempted: boolean } }).cleanupEvidence)
      .toMatchObject({ closeAttempted: true, rootRemovalAttempted: true });
  });

  it.each(["dispose", "root"] as const)(
    "fails closed when checkpoint success cleanup reports a %s failure",
    async (failureFacet) => {
      let thrown: unknown;
      let disposeCalls = 0;
      let rootCalls = 0;
      try {
        await runCheckpointScenario("memory", "representative", null, createHarnessStageGuard(), {
          cleanupOverrides: {
            disposePanel: (dispose) => {
                disposeCalls += 1;
                dispose();
                if (failureFacet === "dispose") throw new Error("injected panel disposal failure");
              },
            removeRoot: failureFacet === "root"
              ? (removeRoot) => {
                rootCalls += 1;
                removeRoot();
                return false;
              }
              : undefined
          }
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const cleanupEvidence = (thrown as Error & { cleanupEvidence?: { disposeError: string | null; rootRemoved: boolean; rootError: string | null; closeError: string | null } }).cleanupEvidence;
      expect(cleanupEvidence).toBeDefined();
      if (failureFacet === "dispose") {
        expect(cleanupEvidence).toMatchObject({ disposeError: "injected panel disposal failure", rootRemoved: true, closeError: null });
        expect(disposeCalls).toBe(1);
        expect(rootCalls).toBe(0);
      } else {
        expect(cleanupEvidence).toMatchObject({ disposeError: null, rootRemoved: false, rootError: null, closeError: null });
        expect(disposeCalls).toBe(1);
        expect(rootCalls).toBe(1);
      }
    }
  );

  const progress = (stage: string): HarnessProgressInput => ({
    operationId: null,
    phase: "cells",
    stage,
    substage: stage,
    sample: 1,
    trigger: null,
    scenario: null,
    cellIndex: 7,
    cellTotal: 36,
    adapter: "indexeddb",
    workload: "burst",
    shape: "large-json-rich",
    workloadPhase: "commit",
    offered: 1692,
    settled: 41,
    query: null
  });

  it("bounds a partial receipt stage and absorbs a late rejection without an unhandled rejection", async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: string) => void;
    let rejectLate!: (error: Error) => void;
    const observed: number[] = [];
    try {
      const pending = settleReceiptStage(
        [
          Promise.resolve("settled-first"),
          new Promise<string>((resolve) => { resolveLate = resolve; }),
          new Promise<never>((_, reject) => { rejectLate = reject; })
        ],
        "cell-7-receipts",
        100,
        (settled) => {
          observed.push(settled);
          return { ...progress("receipt-settlement"), settled };
        }
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "HarnessStageTimeout",
        code: "HARNESS_STAGE_TIMEOUT",
        stage: "cell-7-receipts",
        progress: { offered: 1692, settled: 1 }
      });
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      resolveLate("late-success");
      rejectLate(new Error("late receipt rejection"));
      await Promise.resolve();
      expect(observed.at(-1)).toBe(1);
      expect(observed).not.toContain(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects stale progress from a prior operation without overwriting the current operation", () => {
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previous = globalRecord[key];
    const currentOperation = { operationId: "new-operation", state: "pending", startedAt: 0, progress: { operationId: "new-operation" } };
    globalRecord[key] = currentOperation;
    try {
      publishHarnessProgress({ ...progress("stale"), operationId: "old-operation" });
      expect(currentOperation.progress).toEqual({ operationId: "new-operation" });
      publishHarnessProgress({ ...progress("current"), operationId: "new-operation" });
      expect(currentOperation.progress).toMatchObject({ operationId: "new-operation", stage: "current" });
    } finally {
      if (previous === undefined) delete globalRecord[key];
      else globalRecord[key] = previous;
    }
  });

  it("closes a receipt stage on rejection and suppresses a later success callback", async () => {
    let resolveLate!: (value: string) => void;
    const observed: number[] = [];
    const pending = settleReceiptStage(
      [
        Promise.reject(new Error("early rejection")),
        new Promise<string>((resolve) => { resolveLate = resolve; })
      ],
      "cell-7-receipts",
      100,
      (settled) => {
        observed.push(settled);
        return { ...progress("receipt-settlement"), settled };
      }
    );
    const rejected = expect(pending).rejects.toThrow("early rejection");
    await rejected;
    resolveLate("late success");
    await Promise.resolve();
    expect(observed).toEqual([1]);
  });

  it("closes a receipt stage on rejection and suppresses a later rejection callback", async () => {
    let rejectLate!: (error: Error) => void;
    const observed: number[] = [];
    const pending = settleReceiptStage(
      [
        Promise.reject(new Error("early rejection")),
        new Promise<never>((_, reject) => { rejectLate = reject; })
      ],
      "cell-7-receipts",
      100,
      (settled) => {
        observed.push(settled);
        return { ...progress("receipt-settlement"), settled };
      }
    );
    const rejected = expect(pending).rejects.toThrow("early rejection");
    await rejected;
    rejectLate(new Error("late rejection"));
    await Promise.resolve();
    expect(observed).toEqual([1]);
  });

  it("retires a receipt aggregate and absorbs every late settlement without progress", async () => {
    let resolveLate!: (value: string) => void;
    let rejectLater!: (error: Error) => void;
    const observed: number[] = [];
    const controller = createReceiptStageController(
      [
        new Promise<string>((resolve) => { resolveLate = resolve; }),
        new Promise<string>((_, reject) => { rejectLater = reject; })
      ],
      "retirable-receipts",
      (settled) => {
        observed.push(settled);
        return { ...progress("retirable-receipts"), settled };
      }
    );

    expect(controller.state()).toEqual({ terminal: false, retired: false, settled: 0, pending: 2 });
    controller.retire();
    expect(controller.state()).toEqual({ terminal: true, retired: true, settled: 0, pending: 2 });
    resolveLate("late-success");
    rejectLater(new Error("late-rejection"));
    await Promise.resolve();

    expect(controller.state()).toEqual({ terminal: true, retired: true, settled: 0, pending: 2 });
    expect(observed).toEqual([]);
  });

  it("retires a receipt aggregate immediately on rejection and suppresses later settlements", async () => {
    let resolveLate!: (value: string) => void;
    const observed: number[] = [];
    const controller = createReceiptStageController(
      [
        Promise.reject(new Error("first-receipt-failed")),
        new Promise<string>((resolve) => { resolveLate = resolve; })
      ],
      "rejected-receipts",
      (settled) => {
        observed.push(settled);
        return { ...progress("rejected-receipts"), settled };
      }
    );
    const rejected = expect(controller.promise).rejects.toThrow("first-receipt-failed");
    await rejected;
    expect(controller.state()).toEqual({ terminal: true, retired: true, settled: 1, pending: 1 });
    resolveLate("late-success");
    await Promise.resolve();
    expect(observed).toEqual([1]);
    expect(controller.state()).toEqual({ terminal: true, retired: true, settled: 1, pending: 1 });
  });

  it("invalidates a captured run when the operation registry is deleted or replaced", () => {
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previous = globalRecord[key];
    try {
      globalRecord[key] = { operationId: "captured", state: "pending" };
      const guard = createHarnessStageGuard("captured");
      expect(guard.isActive()).toBe(true);
      delete globalRecord[key];
      expect(guard.isActive()).toBe(false);

      globalRecord[key] = { operationId: "captured", state: "pending" };
      const replacementGuard = createHarnessStageGuard("captured");
      globalRecord[key] = { operationId: "replacement", state: "pending" };
      expect(replacementGuard.isActive()).toBe(false);
    } finally {
      if (previous === undefined) delete globalRecord[key];
      else globalRecord[key] = previous;
    }
  });

  it("rejects terminal work before it can offer after host cancellation", async () => {
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previous = globalRecord[key];
    try {
      globalRecord[key] = { operationId: "terminal-run", state: "pending" };
      const guard = createHarnessStageGuard("terminal-run");
      delete globalRecord[key];
      await expect(runTerminalScenario("memory", "PENDING_BYTES", "terminal-run", guard))
        .rejects.toThrow("Terminal scenario was cancelled.");
    } finally {
      if (previous === undefined) delete globalRecord[key];
      else globalRecord[key] = previous;
    }
  });

  it("cleans up an acquired terminal history when follow throws before publication", async () => {
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previous = globalRecord[key];
    const originalCreate = eventHistoryAuthoritative.createInMemoryEventHistory;
    const followError = new Error("terminal follow setup failed");
    let callbackInvoked = false;
    let followCalls = 0;
    let closeCalls = 0;
    let factorySpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      globalRecord[key] = { operationId: "terminal-follow-failure", state: "pending", progress: null };
      const underlying = originalCreate({ panelSessionId: "terminal-follow-failure" });
      const injectedHistory = {
        ...underlying,
        follow: ((..._args: unknown[]) => {
          followCalls += 1;
          const listener = _args[1];
          if (typeof listener === "function") {
            const wrappedListener = (...publication: unknown[]) => {
              callbackInvoked = true;
              listener(...publication);
            };
            void wrappedListener;
          }
          throw followError;
        }) as EventHistory["follow"],
        close: () => {
          closeCalls += 1;
          return underlying.close();
        }
      } as EventHistory;
      factorySpy = vi.spyOn(eventHistoryAuthoritative, "createInMemoryEventHistory").mockReturnValue(injectedHistory);

      const failure = await runTerminalScenario(
        "memory",
        "PENDING_BYTES",
        "terminal-follow-failure",
        createHarnessStageGuard("terminal-follow-failure")
      ).then(() => null, (error) => error as Error & { cleanupEvidence?: Record<string, unknown> });

      expect(failure).toMatchObject({
        message: "terminal follow setup failed",
        cleanupEvidence: {
          stage: "terminal-memory-PENDING_BYTES",
          closeAttempted: true,
          close: { ok: true },
          status: "FAIL"
        }
      });
      expect(closeCalls).toBe(1);
      expect(followCalls).toBe(1);
      expect(callbackInvoked).toBe(false);
      expect(globalRecord[key]).toMatchObject({ progress: null });
    } finally {
      factorySpy?.mockRestore();
      if (previous === undefined) delete globalRecord[key];
      else globalRecord[key] = previous;
    }
  });

  it("rejects checkpoint work before it can offer after host operation replacement", async () => {
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previous = globalRecord[key];
    try {
      globalRecord[key] = { operationId: "checkpoint-run", state: "pending" };
      const guard = createHarnessStageGuard("checkpoint-run");
      globalRecord[key] = { operationId: "new-run", state: "pending" };
      await expect(runCheckpointScenario("memory", "representative", "checkpoint-run", guard))
        .rejects.toThrow("Checkpoint scenario was cancelled");
    } finally {
      if (previous === undefined) delete globalRecord[key];
      else globalRecord[key] = previous;
    }
  });

  it("fails closed when a frame does not arrive before its stage deadline", async () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
    try {
      const pending = waitForBoundedFrame("cell-7-frame", () => progress("frame"));
      const rejected = expect(pending).rejects.toMatchObject({
        name: "HarnessStageTimeout",
        code: "HARNESS_STAGE_TIMEOUT",
        stage: "cell-7-frame",
        timeoutMs: 30_000
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      vi.useRealTimers();
    }
  });

  it("publishes frame progress before waiting for the RAF callback", async () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const previousOperation = globalRecord[key];
    const operation = { operationId: "frame-operation", state: "pending", startedAt: 0, progress: null as unknown };
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
    globalRecord[key] = operation;
    try {
      const pending = waitForBoundedFrame("cell-7-frame", () => ({ ...progress("frame"), operationId: "frame-operation" }));
      expect(operation.progress).toMatchObject({ stage: "frame", operationId: "frame-operation" });
      const rejected = expect(pending).rejects.toMatchObject({ stage: "cell-7-frame" });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      if (previousOperation === undefined) delete globalRecord[key];
      else globalRecord[key] = previousOperation;
      vi.useRealTimers();
    }
  });

  it("does not offer after an invalidated offer stage resumes", async () => {
    const guard = createHarnessStageGuard();
    let onOfferCalls = 0;
    const offer = vi.fn(() => ({ intake: "QUEUED" as const, settled: Promise.resolve({}) }));
    const history = { offer } as unknown as EventHistory;
    const events = [
      createEventHistoryWorkloadEvent("small-lifecycle", 0, "guarded-offer"),
      createEventHistoryWorkloadEvent("small-lifecycle", 1, "guarded-offer")
    ];

    await expect(offerSustained(
      history,
      events,
      { sustainedCount: 2, sustainedEventsPerSecond: 50, burstCount: 1692, burstPauseMs: 0 },
      new Map(),
      createPendingTelemetryTracker(),
      () => {
        onOfferCalls += 1;
        guard.invalidate();
      },
      () => undefined,
      guard
    )).rejects.toThrow("invalidated");

    expect(onOfferCalls).toBe(1);
    expect(offer).not.toHaveBeenCalled();
  });

  it("does not start another query or publish late progress after query timeout", async () => {
    vi.useFakeTimers();
    const guard = createHarnessStageGuard();
    let resolveLate!: (value: unknown) => void;
    let queryCalls = 0;
    let progressCalls = 0;
    try {
      const pending = measureQuery(
        undefined as unknown as EventHistory,
        () => {
          queryCalls += 1;
          return new Promise((resolve) => { resolveLate = resolve; });
        },
        "late-query",
        () => {
          progressCalls += 1;
          return progress("query");
        },
        guard
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "HarnessStageTimeout",
        stage: "query-late-query-1"
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      const callsAtTimeout = progressCalls;
      resolveLate({ late: true });
      await Promise.resolve();
      expect(queryCalls).toBe(1);
      expect(progressCalls).toBe(callsAtTimeout);
      expect(guard.isActive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the third bounded ascending full query as authoritative correctness evidence", async () => {
    const reads = [
      { ok: true as const, value: { total: 1, evidence: [{ eventId: "first" }] } },
      { ok: true as const, value: { total: 1, evidence: [{ eventId: "second" }] } },
      { ok: true as const, value: { total: 1, evidence: [{ eventId: "authoritative-third" }] } }
    ];
    const read = vi.fn(async () => reads.shift()!);
    const history = { read } as unknown as EventHistory;

    const measurement = await measureAuthoritativeFullQuery(
      history,
      () => progress("query"),
      createHarnessStageGuard()
    );

    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls).toEqual([
      [{ order: "asc" }],
      [{ order: "asc" }],
      [{ order: "asc" }]
    ]);
    expect(measurement.read).toMatchObject({
      ok: true,
      value: { evidence: [{ eventId: "authoritative-third" }] }
    });
  });

  it.each([
    "cell-7-query",
    "query-find-2",
    "cell-7-read",
    "cell-7-close",
    "terminal-memory-PENDING_AGE-receipts",
    "checkpoint-memory-representative-candidate",
    "sample-heap-receipts",
    "cleanup-close"
  ])("contextualizes bounded %s failures", async (stage) => {
    vi.useFakeTimers();
    try {
      const pending = withStageDeadline(new Promise<never>(() => undefined), stage, 50, () => progress(stage));
      const rejected = expect(pending).rejects.toBeInstanceOf(HarnessStageTimeout);
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("captures available page storage estimates as non-authoritative telemetry", async () => {
    await expect(captureStorageEstimate({ estimate: async () => ({ usage: 12, quota: 34 }) })).resolves.toEqual({
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: 12,
      quotaBytes: 34,
      failure: null
    });
  });

  it("retains storage-estimate unavailability and failures diagnostically", async () => {
    await expect(captureStorageEstimate(undefined)).resolves.toMatchObject({
      source: "navigator.storage.estimate",
      status: "UNAVAILABLE",
      usageBytes: null,
      quotaBytes: null,
      failure: { code: "STORAGE_ESTIMATE_UNAVAILABLE" }
    });
    await expect(captureStorageEstimate({ estimate: async () => { throw new Error("denied"); } })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      failure: { code: "STORAGE_ESTIMATE_FAILED", message: "denied" }
    });
  });

  it("continues prepare-failure cleanup after panel disposal throws", async () => {
    const calls: string[] = [];
    const evidence = await bestEffortHeapPreparationCleanup({
      adapter: "indexeddb",
      eventCount: 10_000,
      phase: "sample",
      sample: 2,
      sessionId: "prepare-session",
      databaseName: "prepare-database",
      originalError: new Error("prepare failed"),
      disposePanel: () => { calls.push("dispose"); throw new Error("dispose failed"); },
      closeHistory: async () => { calls.push("close"); return { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } }; },
      removeRoot: () => { calls.push("remove"); },
      yieldFrame: async () => { calls.push("yield"); }
    });

    expect(calls).toEqual(["dispose", "close", "remove", "yield"]);
    expect(evidence).toMatchObject({
      phase: "cleanup",
      sample: 2,
      sessionId: "prepare-session",
      databaseName: "prepare-database",
      disposeError: "dispose failed",
      close: { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } },
      rootRemoved: true,
      frameYielded: true
    });
  });

  it("bounds close cleanup and still removes the root and yields a frame", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    try {
      const cleanup = bestEffortHeapPreparationCleanup({
        adapter: "indexeddb",
        eventCount: 10_000,
        phase: "sample",
        sample: 2,
        sessionId: "hung-close-session",
        databaseName: "hung-close-database",
        originalError: new Error("prepare failed"),
        disposePanel: () => { calls.push("dispose"); },
        closeHistory: () => {
          calls.push("close");
          return new Promise<never>(() => undefined);
        },
        removeRoot: () => { calls.push("remove"); },
        yieldFrame: async () => { calls.push("yield"); }
      });
      const completed = expect(cleanup).resolves.toMatchObject({
        close: { ok: false, problem: { code: "CLEANUP_CLOSE_TIMEOUT" } },
        rootRemoved: true,
        frameYielded: true,
        failure: { message: expect.stringContaining("closeHistory:") }
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await completed;
      expect(calls).toEqual(["dispose", "close", "remove", "yield"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans every acquired resource after immediate cancellation", async () => {
    const calls: string[] = [];
    const guard = createHarnessStageGuard();
    guard.invalidate();
    const history = {
      close: vi.fn(async () => {
        calls.push("close");
        return { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } };
      })
    } as unknown as EventHistory;

    const evidence = await cleanupHarnessResources({
      history,
      stage: "cell-7",
      guard,
      progress: () => progress("cleanup"),
      unsubscribe: () => { calls.push("unsubscribe"); },
      disposePanel: () => { calls.push("dispose"); },
      removeRoot: () => { calls.push("root"); return true; }
    });

    expect(calls).toEqual(["unsubscribe", "dispose", "root", "close"]);
    expect(evidence).toMatchObject({
      stage: "cell-7",
      unsubscribeAttempted: true,
      disposeAttempted: true,
      rootRemovalAttempted: true,
      rootRemoved: true,
      closeAttempted: true,
      close: { ok: true },
      closeError: null
    });
  });

  it.each(["cell", "terminal", "checkpoint"] as const)(
    "bounds %s cleanup after cancellation without late progress",
    async (phase) => {
      vi.useFakeTimers();
      const key = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const previous = globalRecord[key];
      const operation = { operationId: `cleanup-${phase}`, state: "pending", progress: null as unknown };
      globalRecord[key] = operation;
      const guard = createHarnessStageGuard(operation.operationId);
      guard.invalidate();
      const calls: string[] = [];
      try {
        const cleanup = cleanupHarnessResources({
          history: {
            close: () => {
              calls.push("close");
              return new Promise<never>(() => undefined);
            }
          } as unknown as EventHistory,
          stage: `${phase}-7`,
          guard,
          progress: () => ({ ...progress(`${phase}-cleanup`), operationId: operation.operationId }),
          unsubscribe: () => { calls.push("unsubscribe"); },
          disposePanel: () => { calls.push("dispose"); },
          removeRoot: () => { calls.push("root"); return true; }
        });
        const completed = expect(cleanup).resolves.toMatchObject({
          stage: `${phase}-7`,
          close: { ok: false, problem: { code: "CLEANUP_CLOSE_TIMEOUT" } },
          closeError: expect.stringContaining("exceeded")
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await completed;
        expect(calls).toEqual(["unsubscribe", "dispose", "root", "close"]);
        expect(operation.progress).toBeNull();
      } finally {
        if (previous === undefined) delete globalRecord[key];
        else globalRecord[key] = previous;
        vi.useRealTimers();
      }
    }
  );

  it("bounds a failed heap cleanup frame independently after close completes", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    try {
      const cleanup = bestEffortHeapPreparationCleanup({
        adapter: "memory",
        eventCount: 5_000,
        phase: "warmup",
        sample: null,
        sessionId: "hung-frame-session",
        databaseName: null,
        originalError: new Error("warmup failed"),
        disposePanel: () => { calls.push("dispose"); },
        closeHistory: async () => { calls.push("close"); return { ok: true }; },
        removeRoot: () => { calls.push("remove"); },
        yieldFrame: async () => {
          calls.push("yield");
          await new Promise<never>(() => undefined);
        }
      });
      const completed = expect(cleanup).resolves.toMatchObject({
        close: { ok: true },
        rootRemoved: true,
        frameYielded: false,
        failure: { message: expect.stringContaining("yieldFrame:") }
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await completed;
      expect(calls).toEqual(["dispose", "close", "remove", "yield"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses late heap receipt progress after settleOffers timeout", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const guard = createHarnessStageGuard();
    const observed: number[] = [];
    const events = [
      createEventHistoryWorkloadEvent("small-lifecycle", 0, "late-heap"),
      createEventHistoryWorkloadEvent("small-lifecycle", 1, "late-heap")
    ];
    const history = {
      offer: vi.fn((event: { id: string }) => ({
        intake: "QUEUED" as const,
        settled: new Promise((resolve) => {
          if (event.id === events[0]!.id) resolveFirst = resolve;
          else resolveSecond = resolve;
        })
      }))
    } as unknown as EventHistory;
    try {
      const pending = settleOffers(
        history,
        events,
        "sample-heap-receipts",
        100,
        (settled) => {
          observed.push(settled);
          return progress("sample-heap-receipts");
        },
        guard
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "HarnessStageTimeout",
        stage: "sample-heap-receipts"
      });
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      resolveFirst({ ok: true });
      resolveSecond({ ok: true });
      await Promise.resolve();
      expect(observed).toEqual([0]);
      expect(guard.isActive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed warm-up in the warm-up evidence slot", async () => {
    const evidence = await bestEffortHeapPreparationCleanup({
      adapter: "memory",
      eventCount: 5_000,
      phase: "warmup",
      sample: null,
      sessionId: "warmup-session",
      databaseName: null,
      originalError: new Error("warmup failed"),
      disposePanel: () => undefined,
      closeHistory: async () => ({ ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } }),
      removeRoot: () => undefined,
      yieldFrame: async () => undefined
    });

    expect(evidence).toMatchObject({ phase: "warmup", sample: null, status: "FAIL", failure: { code: "PREPARE_FAILED" } });
  });

  it("attempts authoritative close even when panel disposal throws", async () => {
    const calls: string[] = [];
    const outcome = await closeHeapSessionWithEvidence({
      disposePanel: () => { calls.push("dispose"); throw new Error("dispose failed"); },
      closeHistory: async () => { calls.push("close"); return { ok: true, value: { finalCommittedEvidenceBoundary: null, dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } }; }
    });

    expect(calls).toEqual(["dispose", "close"]);
    expect(outcome).toMatchObject({
      ok: false,
      problem: { code: "PANEL_DISPOSE_FAILED", message: "dispose failed" },
      closeOutcome: { ok: true, value: { finalCommittedEvidenceBoundary: null, dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } },
      disposeError: { code: "PANEL_DISPOSE_FAILED", message: "dispose failed" }
    });
  });

  it("attributes every Long Task by deterministic greatest positive phase overlap", () => {
    const intervals = [
      { phase: "capture" as const, start: 0, end: 10 },
      { phase: "commit" as const, start: 10, end: 30 },
      { phase: "paint" as const, start: 30, end: 40 },
      { phase: "query" as const, start: 40, end: 50 }
    ];
    const entries = [
      { startTime: 2, duration: 4 },
      { startTime: 8, duration: 14 },
      { startTime: 20, duration: 15 },
      { startTime: 60, duration: 5 },
      { startTime: 10, duration: 0 }
    ] as PerformanceEntry[];

    const result = attributeLongTasks(entries, intervals);

    expect(result.capture).toEqual([4]);
    expect(result.commit).toEqual([14, 15]);
    expect(result.paint).toEqual([]);
    expect(result.query).toEqual([]);
    expect(result.unattributed).toBe(2);
    expect(result.unattributedReasons).toEqual([
      { reason: "no-overlap", startTime: 60, duration: 5 },
      { reason: "no-overlap", startTime: 10, duration: 0 }
    ]);
    expect(
      result.capture.length + result.commit.length + result.paint.length + result.query.length
      + result.unattributedReasons.length
    ).toBe(entries.length);
  });

  it("keeps equal overlap ties explicitly unattributed with deterministic phase evidence", () => {
    const result = attributeLongTasks(
      [{ startTime: 5, duration: 10 }] as PerformanceEntry[],
      [
        { phase: "capture" as const, start: 0, end: 10 },
        { phase: "commit" as const, start: 10, end: 20 }
      ]
    );

    expect(result.capture).toEqual([]);
    expect(result.commit).toEqual([]);
    expect(result.unattributed).toBe(1);
    expect(result.unattributedReasons).toEqual([{
      reason: "ambiguous",
      overlaps: [
        { phase: "capture", duration: 5 },
        { phase: "commit", duration: 5 }
      ]
    }]);
  });

  it("keeps pending telemetry exact across synchronous, asynchronous, and refused receipts without rescanning offers", () => {
    let now = 100;
    const tracker = createPendingTelemetryTracker(() => now);

    tracker.add("sync", { offeredAt: 90, bytes: 10 });
    tracker.sample();
    tracker.settle("sync");
    now = 110;
    tracker.sample();

    tracker.add("async-a", { offeredAt: 111, bytes: 20 });
    tracker.add("async-b", { offeredAt: 112, bytes: 30 });
    now = 120;
    tracker.sample();
    tracker.refuse("async-b");
    now = 130;
    tracker.sample();
    tracker.settle("async-a");
    now = 140;
    tracker.sample();

    expect(tracker.snapshot()).toEqual({
      pendingCount: 0,
      pendingBytes: 0,
      maxPendingCount: 2,
      maxPendingBytes: 50,
      maxOldestPendingAgeMs: 19
    });

    const burst = createPendingTelemetryTracker(() => now);
    for (let index = 0; index < 1_692; index += 1) {
      burst.add(`burst-${index}`, { offeredAt: index, bytes: index + 1 });
      burst.sample();
    }
    expect(burst.snapshot()).toMatchObject({ pendingCount: 1_692, maxPendingCount: 1_692 });
    expect(burst.diagnostics()).toEqual({ sampleCount: 1_692, oldestQueueAdvances: 0 });
    for (let index = 0; index < 1_692; index += 1) burst.settle(`burst-${index}`);
    burst.sample();
    expect(burst.snapshot()).toMatchObject({ pendingCount: 0, pendingBytes: 0 });
    expect(burst.diagnostics()).toEqual({ sampleCount: 1_693, oldestQueueAdvances: 1_692 });
  });

  it("constructs the exact browser checkpoint seeds at their requested sizes", () => {
    for (const [seed, syncId, minimumBytes] of [
      ["checkpoint-indexeddb-representative", "sync-representative", 64 * 1_024],
      ["checkpoint-indexeddb-maximum-2MiB", "sync-maximum-2MiB", 2 * 1_048_576]
    ] as const) {
      const candidate = createStagedTopologyCheckpointCandidate(seed, syncId, minimumBytes);
      expect(journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes)).toBe(minimumBytes);
    }
  }, 30_000);

  it("constructs representative and maximum checkpoints through production staging", () => {
    for (const [name, minimumBytes] of [
      ["representative", 64 * 1_024],
      ["maximum-2MiB", 2 * 1_048_576]
    ] as const) {
      const candidate = createStagedTopologyCheckpointCandidate(
        `harness-${name}`,
        `harness-sync-${name}`,
        minimumBytes
      );
      expect(candidate.kind).toBe("topology-checkpoint");
      expect(journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes)).toBe(minimumBytes);
      expect(decodeTopologyCheckpointEvidenceCandidate(candidate), name).not.toBeNull();
    }
  }, 30_000);

  it("rejects a checkpoint whose frames are not in begin/chunk/complete order", () => {
    const candidate = createStagedTopologyCheckpointCandidate("harness-order", "harness-order-sync", 64 * 1_024);
    const frames = decodeTopologyCheckpointEvidenceCandidate(candidate);
    expect(frames).not.toBeNull();

    const result = createTopologyCheckpointEvidenceCandidate([...frames!].reverse());

    expect(result).toEqual({ ok: false, rejection: { code: "UNSUPPORTED_FRAME_SEQUENCE" } });
  });

  it.each([
    ["representative", 64 * 1_024],
    ["maximum-2MiB", 2 * 1_048_576]
  ] as const)("keeps %s checkpoint staging valid while observations interleave between chunks", (_name, minimumBytes) => {
    const source = createStagedTopologyCheckpointCandidate(
      minimumBytes === 64 * 1_024 ? "harness-representative" : "harness-maximum-2MiB",
      `harness-interleave-sync-${minimumBytes}`,
      minimumBytes
    );
    expect(journalAccountedBytes(serializeJournalEvidenceCandidate(source).bytes)).toBe(minimumBytes);
    const frames = decodeTopologyCheckpointEvidenceCandidate(source);
    expect(frames).not.toBeNull();
    const projection = createTopologyProjection();
    const firstFrame = frames![0]!;
    const pageEpoch = firstFrame.pageEpoch;
    const cutoff = firstFrame.cutoffCaptureSequence;
    let observed = 0;

    let finalResult: ReturnType<typeof projection.applySyncFrame> | null = null;
    for (const frame of frames!) {
      if (frame.type === "lsew:topology-sync-complete") {
        finalResult = projection.applySyncFrame(frame);
        continue;
      }
      expect(projection.applySyncFrame(frame).accepted).toBe(true);
      if (frame.type !== "lsew:topology-sync-chunk") continue;
      observed += 1;
      expect(projection.ingestCapture({
        id: `interleaved-observation-${minimumBytes}-${observed}`,
        timestamp: cutoff + observed,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        topology: {
          version: TOPOLOGY_OBSERVATION_VERSION,
          kind: "item-update",
          pageEpoch,
          captureSequence: cutoff + observed,
          provenance: { instrumentationSource: "official-public-api" },
          coverage: { status: "complete", getters: {} },
          values: { interleaved: { state: "real", value: String(observed) } }
        }
      }).accepted).toBe(true);
    }

    expect(finalResult?.accepted).toBe(true);
    expect(finalResult?.candidate?.checkpoint.observations).toHaveLength(observed);
    expect(finalResult?.candidate).toBeDefined();
    expect(decodeTopologyCheckpointEvidenceCandidate(finalResult!.candidate!)).not.toBeNull();
  }, 30_000);
});
