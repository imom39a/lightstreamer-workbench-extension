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
  createPendingTelemetryTracker,
  createStagedTopologyCheckpointCandidate,
  HarnessStageTimeout,
  settleReceiptStage,
  withStageDeadline,
  type HarnessProgress
} from "../benchmarks/event-history-performance-harness";
import { TOPOLOGY_OBSERVATION_VERSION } from "../src/bridge/messages";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

describe("Event History performance checkpoint workload", () => {
  const progress = (stage: string): HarnessProgress => ({
    phase: "cells",
    stage,
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
    let rejectLate!: (error: Error) => void;
    try {
      const pending = settleReceiptStage(
        [
          Promise.resolve("settled-first"),
          new Promise<never>((_, reject) => { rejectLate = reject; })
        ],
        "cell-7-receipts",
        100,
        (settled) => ({ ...progress("receipt-settlement"), settled })
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).rejects.toMatchObject({
        name: "HarnessStageTimeout",
        code: "HARNESS_STAGE_TIMEOUT",
        stage: "cell-7-receipts",
        progress: { offered: 1692, settled: 1 }
      });
      rejectLate(new Error("late receipt rejection"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["query-find-2", "cell-7-read", "cell-7-close"])("contextualizes bounded %s failures", async (stage) => {
    vi.useFakeTimers();
    try {
      const pending = withStageDeadline(new Promise<never>(() => undefined), stage, 50, () => progress(stage));
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).rejects.toBeInstanceOf(HarnessStageTimeout);
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
