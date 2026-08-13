import { describe, expect, it } from "vitest";

import {
  bindCommittedEvidencePipeline,
  type CommittedEvidencePipelineProgress
} from "../src/extension/panel/committed-evidence-pipeline";
import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type EvidenceCandidate,
  type EvidenceRef
} from "../src/core/event-history-authoritative";

function candidate(sequence: number): EvidenceCandidate {
  return {
    id: `history-100k-04-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "recovery-subscription", mode: "MERGE" },
    update: { isSnapshot: false, fields: { sequence } }
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Timed out waiting for recovery.");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function assertLive(progress: CommittedEvidencePipelineProgress): void {
  expect(progress.phase).toBe("LIVE");
  expect(progress.exceptionalGapCount).toBeLessThanOrEqual(64);
}

describe("history-100k-04 bounded committed-Evidence recovery", () => {
  it("replays in cooperative chunks and reports interval identity plus contiguous applied progress", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-100k-04-chunks",
      capacity: { maxRetainedCount: 2_000, maxRetainedBytes: 8 * 1024 * 1024 }
    });
    for (let sequence = 1; sequence <= 600; sequence += 1) {
      await history.offer(candidate(sequence)).settled;
    }

    const committed: number[] = [];
    const publicationSizes: number[] = [];
    const pipeline = bindCommittedEvidencePipeline({
      history,
      replayChunkSize: 64,
      onCommittedEvidence: (entry) => committed.push(entry.sequence),
      onHistoryPublication: (publication) => {
        if (publication.type === "committed-evidence") publicationSizes.push(publication.evidence.length);
      }
    });

    pipeline.start();
    await waitFor(() => pipeline.progress().phase === "LIVE");

    expect(committed).toEqual(Array.from({ length: 600 }, (_, index) => index + 1));
    expect(publicationSizes.length).toBeGreaterThan(1);
    expect(Math.max(...publicationSizes)).toBeLessThanOrEqual(64);
    expect(pipeline.progress()).toMatchObject({
      phase: "LIVE",
      intervalId: "history-100k-04-chunks:interval-1",
      highestContiguousAppliedSequence: 600,
      appliedBoundary: {
        intervalId: "history-100k-04-chunks:interval-1",
        sequence: 600,
        eventId: "history-100k-04-600"
      },
      exceptionalGapCount: 0
    });
    assertLive(pipeline.progress());

    await pipeline.close();
  });

  it("restarts after an explicit boundary while new Capture continues without duplicate effects", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-100k-04-restart",
      capacity: { maxRetainedCount: 2_000, maxRetainedBytes: 8 * 1024 * 1024 }
    });
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      await history.offer(candidate(sequence)).settled;
    }

    const committed: number[] = [];
    const pipeline = bindCommittedEvidencePipeline({
      history,
      replayChunkSize: 32,
      onCommittedEvidence: (entry) => committed.push(entry.sequence)
    });
    pipeline.start();
    await waitFor(() => pipeline.progress().phase === "LIVE");

    const boundary: EvidenceRef = {
      intervalId: "history-100k-04-restart:interval-1",
      sequence: 250,
      eventId: "history-100k-04-250"
    };
    pipeline.restart(boundary);
    for (let sequence = 301; sequence <= 340; sequence += 1) {
      await history.offer(candidate(sequence)).settled;
    }
    await waitFor(() => pipeline.progress().highestContiguousAppliedSequence === 340);

    expect(committed).toEqual(Array.from({ length: 340 }, (_, index) => index + 1));
    expect(new Set(committed).size).toBe(340);
    expect(pipeline.progress()).toMatchObject({
      phase: "LIVE",
      highestContiguousAppliedSequence: 340,
      exceptionalGapCount: 0
    });

    await pipeline.close();
  });

  it("cancels a populated recovery without publishing stale replay effects", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-100k-04-cancel",
      capacity: { maxRetainedCount: 2_000, maxRetainedBytes: 8 * 1024 * 1024 }
    });
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      await history.offer(candidate(sequence)).settled;
    }

    const committed: number[] = [];
    const pipeline = bindCommittedEvidencePipeline({
      history,
      replayChunkSize: 1,
      onCommittedEvidence: (entry) => committed.push(entry.sequence)
    });
    pipeline.start();
    pipeline.cancelRecovery();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(pipeline.progress().phase).toBe("CANCELLED");
    expect(committed.length).toBeLessThan(1_000);
    expect(pipeline.progress().highestContiguousAppliedSequence ?? 0).toBeLessThan(1_000);

    await pipeline.close();
  });

  it("retains coherent interval truth when Clear cuts across a replay", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-100k-04-clear",
      capacity: { maxRetainedCount: 2_000, maxRetainedBytes: 8 * 1024 * 1024 }
    });
    for (let sequence = 1; sequence <= 600; sequence += 1) {
      await history.offer(candidate(sequence)).settled;
    }

    const pipeline = bindCommittedEvidencePipeline({
      history,
      replayChunkSize: 1,
      onCommittedEvidence: () => undefined
    });
    pipeline.start();
    const cleared = await history.clear();
    expect(cleared).toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
    const next = pipeline.offer(candidate(601));
    await expect(next.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 601, intervalId: "history-100k-04-clear:interval-2" }
    });
    await waitFor(() => pipeline.progress().highestContiguousAppliedSequence === 601);
    expect(pipeline.progress()).toMatchObject({
      phase: "LIVE",
      intervalId: "history-100k-04-clear:interval-2",
      highestContiguousAppliedSequence: 601,
      exceptionalGapCount: 0
    });
    await pipeline.close();
  });

  it("uses a bounded exceptional-gap structure to merge reordered publications exactly once", async () => {
    const source = await createMemoryEventHistoryForTests({ panelSessionId: "history-100k-04-gaps" });
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await source.offer(candidate(sequence)).settled;
    }
    const read = await source.read({ order: "asc" });
    if (!read.ok) throw new Error("Expected committed Evidence for the gap fixture.");
    const evidence = read.value.evidence;
    const interval = read.value.interval;
    const fakeHistory: EventHistory = {
      ...source,
      follow: (options, observer) => {
        observer({ type: "status", status: source.status() });
        observer({
          type: "replay-started",
          interval,
          after: null,
          retainedRange: read.value.retainedRange
        });
        observer({
          type: "committed-evidence",
          interval,
          evidence: [evidence[2]!],
          committedEvidenceBoundary: evidence[2]!
        });
        observer({
          type: "committed-evidence",
          interval,
          evidence: [evidence[0]!],
          committedEvidenceBoundary: evidence[0]!
        });
        observer({
          type: "committed-evidence",
          interval,
          evidence: [evidence[1]!, evidence[1]!],
          committedEvidenceBoundary: evidence[1]!
        });
        observer({ type: "replay-complete", interval, committedEvidenceBoundary: evidence[2]! });
        return () => undefined;
      }
    };
    const applied: number[] = [];
    const pipeline = bindCommittedEvidencePipeline({
      history: fakeHistory,
      replayChunkSize: 2,
      onCommittedEvidence: (entry) => applied.push(entry.sequence)
    });
    pipeline.start();
    await waitFor(() => pipeline.progress().phase === "LIVE");

    expect(applied).toEqual([1, 2, 3]);
    expect(pipeline.progress()).toMatchObject({
      highestContiguousAppliedSequence: 3,
      exceptionalGapCount: 0,
      maxExceptionalGapCount: 1
    });
    await pipeline.close();
  });

  it("keeps 100,000-Evidence restart progress bounded and deterministic", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-100k-04-100k",
      capacity: { maxRetainedCount: 100_000, maxRetainedBytes: 256 * 1024 * 1024 }
    });
    const receipts = Array.from({ length: 100_000 }, (_, index) => history.offer(candidate(index + 1)));
    await Promise.all(receipts.map(({ settled }) => settled));

    const committed: number[] = [];
    const baselineHeap = process.memoryUsage().heapUsed;
    const replayHeapSamples: number[] = [];
    const pipeline = bindCommittedEvidencePipeline({
      history,
      replayChunkSize: 256,
      onCommittedEvidence: (entry) => {
        if (entry.sequence === 1 || entry.sequence % 10_000 === 0) committed.push(entry.sequence);
        if (entry.sequence % 10_000 === 0) replayHeapSamples.push(process.memoryUsage().heapUsed);
      }
    });
    pipeline.start();
    await waitFor(() => pipeline.progress().phase === "LIVE", 30_000);

    expect(committed).toEqual([1, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000]);
    expect(pipeline.progress()).toMatchObject({
      intervalId: "history-100k-04-100k:interval-1",
      highestContiguousAppliedSequence: 100_000,
      exceptionalGapCount: 0,
      maxExceptionalGapCount: 0
    });
    assertLive(pipeline.progress());
    const peakReplayHeap = Math.max(baselineHeap, ...replayHeapSamples);
    expect(peakReplayHeap - baselineHeap).toBeLessThan(128 * 1024 * 1024);

    const restartBoundary = pipeline.progress().appliedBoundary;
    if (!restartBoundary) throw new Error("Expected a committed restart boundary.");
    pipeline.restart(restartBoundary);
    await waitFor(() => pipeline.progress().phase === "LIVE", 30_000);
    expect(pipeline.progress().highestContiguousAppliedSequence).toBe(100_000);
    expect(pipeline.progress().maxExceptionalGapCount).toBeLessThanOrEqual(64);

    await pipeline.close();
  }, 60_000);
});
