import { describe, expect, it } from "vitest";

import {
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  type TopologyAbsoluteRecord,
  type TopologyCoverage,
  type TopologyObservation,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame,
  isTopologySyncFrame
} from "../src/bridge/messages";
import { createTopologySyncCoordinator } from "../src/core/topology-sync";

const record = (id: string, sequence = 1): TopologyAbsoluteRecord => ({
  kind: "subscription",
  id,
  parentId: "client-a",
  clientId: "client-a",
  pageEpoch: "page-a",
  captureSequence: sequence,
  clientActive: true,
  serverEstablished: false
});

const live = (id: string, sequence: number): TopologyObservation => ({
  version: TOPOLOGY_OBSERVATION_VERSION,
  kind: "subscription-active",
  pageEpoch: "page-a",
  captureSequence: sequence,
  provenance: { instrumentationSource: "official-public-api" },
  coverage: { status: "complete", getters: {} },
  client: { id: "client-a" },
  subscription: { id }
});

function frames(
  records: readonly TopologyAbsoluteRecord[],
  syncId = "sync-a",
  cutoffCaptureSequence = 10
) {
  const graph: TopologyAbsoluteRecord[] = [
    { kind: "page", id: "page-a", pageEpoch: "page-a", captureSequence: 1 },
    { kind: "client", id: "client-a", parentId: "page-a", pageEpoch: "page-a", captureSequence: 1 },
    ...records
  ];
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    pageEpoch: "page-a",
    cutoffCaptureSequence,
    chunkCount: 1,
    recordCount: graph.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return {
    begin: { type: TOPOLOGY_SYNC_BEGIN, ...metadata } satisfies TopologySyncBeginFrame,
    chunk: {
      type: TOPOLOGY_SYNC_CHUNK,
      ...metadata,
      chunkIndex: 0,
      records: graph
    } satisfies TopologySyncChunkFrame,
    complete: { type: TOPOLOGY_SYNC_COMPLETE, ...metadata } satisfies TopologySyncCompleteFrame
  };
}

describe("bounded atomic topology synchronization", () => {
  it("accepts an empty boundary checkpoint and applies sequence one exactly once", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    const metadata = {
      version: TOPOLOGY_SYNC_VERSION,
      syncId: "empty",
      pageEpoch: "page-a",
      cutoffCaptureSequence: 0,
      chunkCount: 0,
      recordCount: 0,
      coverage: { status: "complete" as const, getters: {} }
    };
    const begin = {
      type: TOPOLOGY_SYNC_BEGIN,
      ...metadata
    } satisfies TopologySyncBeginFrame;
    const complete = {
      type: TOPOLOGY_SYNC_COMPLETE,
      ...metadata
    } satisfies TopologySyncCompleteFrame;

    expect(isTopologySyncFrame(begin)).toBe(true);
    expect(isTopologySyncFrame(complete)).toBe(true);
    expect(coordinator.begin(begin)).toEqual({ accepted: true });
    expect(coordinator.snapshot()).toEqual({
      pageEpoch: "page-a",
      records: [],
      observations: []
    });
    expect(coordinator.complete(complete)).toEqual({ accepted: true });
    expect(coordinator.status()).toEqual({ state: "complete", retry: false });
    expect(coordinator.snapshot()).toEqual({
      pageEpoch: "page-a",
      records: [],
      observations: []
    });

    expect(coordinator.applyLive(live("first", 1))).toEqual({ accepted: true });
    expect(coordinator.applyLive(live("first", 1))).toEqual({
      accepted: true,
      duplicate: true
    });
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual([
      "first"
    ]);
  });

  it("keeps current state while staging, atomically replaces it, and applies the post-cutoff tail once", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    coordinator.applyLive(live("old", 1));
    const sync = frames([record("checkpoint", 5)]);

    expect(coordinator.begin(sync.begin)).toEqual({ accepted: true });
    expect(coordinator.acceptChunk(sync.chunk)).toEqual({ accepted: true });
    coordinator.applyLive(live("before-cutoff", 10));
    coordinator.applyLive(live("after-cutoff", 12));
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual(["old"]);

    expect(coordinator.complete(sync.complete)).toEqual({ accepted: true });
    expect(coordinator.snapshot().records.map((entry) => entry.id)).toContain("checkpoint");
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual(["after-cutoff"]);
    expect(coordinator.complete(sync.complete)).toEqual({ accepted: true, duplicate: true });
    expect(coordinator.snapshot().observations).toHaveLength(1);
  });

  it("hydrates getter-partial checkpoints while retaining semantic coverage without retry", () => {
    const coverages: TopologyCoverage[] = [
      {
        status: "partial" as const,
        getters: { "ConnectionDetails.getSessionId": "missing" as const },
        reason: "getter-missing" as const
      },
      {
        status: "partial" as const,
        getters: { "ConnectionOptions.getRetryDelay": "threw" as const }
      }
    ];
    for (const coverage of coverages) {
      const coordinator = createTopologySyncCoordinator("page-a");
      const checkpoint = frames([record("semantic-partial", 5)], `semantic-${coverage.reason ?? "implicit"}`);
      const begin = { ...checkpoint.begin, coverage };
      const chunk = { ...checkpoint.chunk, coverage };
      const complete = { ...checkpoint.complete, coverage };

      expect(coordinator.begin(begin)).toEqual({ accepted: true });
      expect(coordinator.acceptChunk(chunk)).toEqual({ accepted: true });
      expect(coordinator.complete(complete)).toEqual({ accepted: true });
      expect(coordinator.snapshot().records.map((entry) => entry.id)).toContain(
        "semantic-partial"
      );
      expect(coordinator.status()).toEqual({
        state: "complete",
        retry: false,
        coverage
      });
    }
  });

  it("retains confirmed state on missing chunks, partial coverage, and conflicting duplicates", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    coordinator.applyLive(live("confirmed", 1));
    const missing = frames([record("candidate")], "missing");
    coordinator.begin(missing.begin);
    expect(coordinator.complete(missing.complete)).toMatchObject({ accepted: false, reason: "missing-chunks" });
    expect(coordinator.snapshot().observations[0]?.subscription?.id).toBe("confirmed");

    const partial = frames([], "partial");
    const partialBegin = {
      ...partial.begin,
      coverage: { status: "partial" as const, getters: {}, reason: "limit-exceeded" as const }
    };
    const partialComplete = {
      ...partial.complete,
      coverage: partialBegin.coverage,
      reason: "limit-exceeded" as const
    };
    coordinator.begin(partialBegin);
    coordinator.applyLive(live("partial-tail", 12));
    expect(coordinator.complete(partialComplete)).toEqual({ accepted: true });
    expect(coordinator.status()).toMatchObject({
      state: "partial",
      retry: true,
      coverage: partialBegin.coverage
    });
    expect(coordinator.snapshot().records).toEqual([]);
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual([
      "confirmed",
      "partial-tail"
    ]);
    expect(coordinator.complete(partialComplete)).toEqual({ accepted: true, duplicate: true });
    expect(coordinator.snapshot().observations).toHaveLength(2);

    const conflict = frames([record("one")], "conflict");
    coordinator.begin(conflict.begin);
    coordinator.acceptChunk(conflict.chunk);
    expect(coordinator.acceptChunk({ ...conflict.chunk, records: [record("two")] })).toMatchObject({
      accepted: false,
      reason: "conflicting-duplicate-chunk"
    });
    expect(coordinator.snapshot().observations[0]?.subscription?.id).toBe("confirmed");
  });

  it("applies a failed checkpoint's buffered live tail to confirmed state exactly once", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    coordinator.applyLive(live("confirmed", 1));
    const missing = frames([record("candidate")], "missing-with-tail");

    coordinator.begin(missing.begin);
    coordinator.applyLive(live("tail", 12));

    expect(coordinator.complete(missing.complete)).toMatchObject({
      accepted: false,
      reason: "missing-chunks"
    });
    expect(coordinator.status()).toMatchObject({ state: "partial", retry: true });
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual([
      "confirmed",
      "tail"
    ]);
    expect(coordinator.applyLive(live("tail", 12))).toEqual({
      accepted: true,
      duplicate: true
    });
    expect(coordinator.snapshot().observations).toHaveLength(2);
  });

  it("rejects unrelated and conflicting frames without aborting the valid active stage", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    const active = frames([record("checkpoint", 5)], "active");
    const unrelated = frames([record("unrelated", 5)], "unrelated");

    expect(coordinator.begin(active.begin)).toEqual({ accepted: true });
    expect(coordinator.acceptChunk(active.chunk)).toEqual({ accepted: true });
    expect(coordinator.begin(unrelated.begin)).toMatchObject({
      accepted: false,
      reason: "conflicting-stage"
    });
    expect(coordinator.acceptChunk(unrelated.chunk)).toMatchObject({
      accepted: false,
      reason: "unknown-or-conflicting-chunk"
    });
    expect(
      coordinator.acceptChunk({
        ...active.chunk,
        records: [
          active.chunk.records[0],
          active.chunk.records[1],
          record("conflicting", 5)
        ]
      })
    ).toMatchObject({ accepted: false, reason: "conflicting-duplicate-chunk" });
    expect(coordinator.status()).toMatchObject({ state: "staging", retry: false });
    expect(coordinator.complete(active.complete)).toEqual({ accepted: true });
    expect(coordinator.snapshot().records.map((entry) => entry.id)).toContain("checkpoint");
  });

  it("rejects an older checkpoint without replacing current state or disturbing a newer stage", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    const accepted = frames([record("accepted", 5)], "accepted", 10);
    coordinator.begin(accepted.begin);
    coordinator.acceptChunk(accepted.chunk);
    coordinator.complete(accepted.complete);
    coordinator.applyLive(live("confirmed-tail", 12));

    const stale = frames([record("stale", 5)], "stale", 5);
    expect(coordinator.begin(stale.begin)).toMatchObject({
      accepted: false,
      reason: "stale-checkpoint"
    });
    expect(coordinator.acceptChunk(stale.chunk)).toMatchObject({ accepted: false });
    expect(coordinator.complete(stale.complete)).toMatchObject({ accepted: false });
    expect(coordinator.status()).toMatchObject({ state: "complete", retry: false });
    expect(coordinator.snapshot().records.map((entry) => entry.id)).toContain("accepted");
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual([
      "confirmed-tail"
    ]);

    const newer = frames([record("newer", 15)], "newer", 20);
    expect(coordinator.begin(newer.begin)).toEqual({ accepted: true });
    expect(coordinator.acceptChunk(newer.chunk)).toEqual({ accepted: true });
    expect(coordinator.begin(stale.begin)).toMatchObject({
      accepted: false,
      reason: "stale-checkpoint"
    });
    expect(coordinator.status()).toMatchObject({ state: "staging", retry: false });
    expect(coordinator.complete(newer.complete)).toEqual({ accepted: true });
    expect(coordinator.snapshot().records.map((entry) => entry.id)).toContain("newer");
  });

  it("rejects duplicate absolute identities without replacing current state", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    coordinator.applyLive(live("confirmed", 1));
    const duplicate = frames([record("same"), record("same")], "duplicate-records");
    coordinator.begin(duplicate.begin);
    coordinator.acceptChunk(duplicate.chunk);
    expect(coordinator.complete(duplicate.complete)).toMatchObject({ accepted: false, reason: "invalid-record-set" });
    expect(coordinator.snapshot().observations[0]?.subscription?.id).toBe("confirmed");
  });

  it("retires the old page epoch and ignores its late traffic after navigation", () => {
    const coordinator = createTopologySyncCoordinator("page-a");
    coordinator.applyLive(live("old", 1));
    coordinator.retirePageEpoch("page-b");
    coordinator.applyLive(live("late-old", 2));
    coordinator.applyLive({ ...live("new", 1), pageEpoch: "page-b" });

    expect(coordinator.pageEpoch()).toBe("page-b");
    expect(coordinator.snapshot().observations.map((entry) => entry.subscription?.id)).toEqual(["new"]);
    expect(coordinator.status()).toMatchObject({ state: "retired", retry: false });
  });
});
