import { describe, expect, it } from "vitest";

import {
  createCaptureMessage,
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  type TopologyAbsoluteRecord,
  type TopologyObservation,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame
} from "../src/bridge/messages";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createEventNormalizer } from "../src/core/event-normalizer";
import { type TopologyState } from "../src/core/topology-state";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";
import { createTopologyCheckpointEvidenceCandidate } from "../src/extension/panel/topology-checkpoint-evidence-codec";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";

const PAGE_EPOCH = "ticket09-page";
const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000009";

describe("history-impl-09 topology cutover", () => {
  it("keeps changed live observations in distinct candidates for one pending syncId", () => {
    const projection = createTopologyProjection();
    const normalizer = createEventNormalizer();
    const sequence = checkpointFrames("pending-live-observation-sync");

    projection.applySyncFrame(sequence[0]);
    projection.ingestCapture(normalizer.normalize(topologyCapture(observation("first", 2))));
    projection.applySyncFrame(sequence[1]);
    const first = projection.applySyncFrame(sequence[2]).candidate;

    projection.applySyncFrame(sequence[0]);
    projection.ingestCapture(normalizer.normalize(topologyCapture(observation("second", 3))));
    projection.applySyncFrame(sequence[1]);
    const second = projection.applySyncFrame(sequence[2]).candidate;

    expect(first?.checkpoint.observations).toEqual([
      expect.objectContaining({
        captureSequence: 2,
        subscription: { id: "first" }
      })
    ]);
    expect(second?.checkpoint.observations).toEqual([
      expect.objectContaining({
        captureSequence: 3,
        subscription: { id: "second" }
      })
    ]);
    expect(first?.checkpoint.syncId).toBe("pending-live-observation-sync");
    expect(second?.checkpoint.syncId).toBe(first?.checkpoint.syncId);
    expect(second?.id).not.toBe(first?.id);
  });

  it("offers one checkpoint per syncId when observations change while the candidate is pending", async () => {
    const commit = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID,
      commitBatch: () => commit.promise
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });
    const sequence = checkpointFrames("pending-observation-sync", "first-checkpoint");
    const changedSequence = checkpointFrames("pending-observation-sync", "second-checkpoint");

    runtime.dispatch({ type: "apply-topology-sync-frame", frame: sequence[0] });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: sequence[1] });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: sequence[2] });

    runtime.dispatch({ type: "apply-topology-sync-frame", frame: changedSequence[0] });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: changedSequence[1] });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: changedSequence[2] });

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    commit.resolve();
    await settle();

    const topologyCandidates = await committedTopologyCandidates(history);
    expect(topologyCandidates).toHaveLength(1);
    expect(topologyCandidates[0]?.checkpoint.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "first-checkpoint" })])
    );
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });

  it("keeps one committed checkpoint when the same syncId changes after commit", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    for (const frame of checkpointFrames("after-commit-sync", "first-checkpoint")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();
    for (const frame of checkpointFrames("after-commit-sync", "second-checkpoint")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    const topologyCandidates = await committedTopologyCandidates(history);
    expect(topologyCandidates).toHaveLength(1);
    expect(topologyCandidates[0]?.checkpoint.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "first-checkpoint" })])
    );
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });

  it("releases a syncId after NOT_EVIDENCE so a changed retry can commit", async () => {
    let refused = false;
    const history = createAuthoritativeHistory({
      decideOffer(candidate) {
        if (candidate.kind === "topology-checkpoint" && !refused) {
          refused = true;
          return "refuse";
        }
        return "commit";
      }
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    for (const frame of checkpointFrames("retryable-sync", "first-checkpoint")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();
    expect(await committedTopologyCandidates(history)).toHaveLength(0);

    for (const frame of checkpointFrames("retryable-sync", "second-checkpoint")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    const topologyCandidates = await committedTopologyCandidates(history);
    expect(topologyCandidates).toHaveLength(1);
    expect(topologyCandidates[0]?.checkpoint.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "second-checkpoint" })])
    );

    runtime.dispose();
  });

  it("does not recommit a replayed syncId after recovery", async () => {
    const replayFrames = checkpointFrames("replayed-sync", "recovered-checkpoint");
    const candidate = checkpointCandidate(replayFrames);
    const history = createAuthoritativeHistory({ precommitted: [candidate] });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    for (const frame of checkpointFrames("replayed-sync", "replayed-again")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    const topologyCandidates = await committedTopologyCandidates(history);
    expect(topologyCandidates).toHaveLength(1);
    expect(topologyCandidates[0]?.id).toBe(candidate.id);

    runtime.dispose();
  });

  it("rebuilds a committed checkpoint and applies persisted post-cutoff observations once on a fresh follower", () => {
    const frames = checkpointFrames("follower-recovery-sync");
    const candidate = checkpointCandidate(frames, [observation("recovered-tail", 2)]);
    const projection = createTopologyProjection();
    const committed = {
      intervalId: "interval-recovery",
      sequence: 1,
      eventId: candidate.id,
      candidate
    };

    expect(projection.ingestCommittedEvidence(committed)).toMatchObject({
      accepted: true
    });
    expect(projection.snapshot().subscriptionCount).toBe(2);
    expect(projection.snapshot().serverEstablishedSubscriptionCount).toBe(1);
    expect(subscriptionIds(projection.snapshot())).toEqual(
      expect.arrayContaining(["recovered-tail"])
    );

    expect(projection.ingestCommittedEvidence(committed)).toMatchObject({
      accepted: true
    });
    expect(projection.snapshot().subscriptionCount).toBe(2);
  });

  it("preserves a retained semantic tail while replaying persisted observations", () => {
    const projection = createTopologyProjection();
    const normalizer = createEventNormalizer();
    const retainedTail = observation("retained-tail", 3);
    projection.ingestCapture(normalizer.normalize(topologyCapture(retainedTail)));

    const frames = checkpointFrames("retained-tail-sync");
    const candidate = checkpointCandidate(frames, [observation("persisted-tail", 2)]);
    projection.ingestCommittedEvidence({
      intervalId: "interval-retained-tail",
      sequence: 1,
      eventId: candidate.id,
      candidate
    });

    expect(projection.snapshot().subscriptionCount).toBe(3);
    expect(subscriptionIds(projection.snapshot())).toEqual(
      expect.arrayContaining(["persisted-tail", "retained-tail"])
    );
  });

  it("rejects a stale committed checkpoint instead of reporting recovery success", () => {
    const projection = createTopologyProjection();
    const newer = checkpointCandidate(
      checkpointFrames("newer-checkpoint", "newer-subscription", 2),
      [observation("newer-tail-subscription", 3)]
    );
    const stale = checkpointCandidate(checkpointFrames("stale-checkpoint", "stale-subscription", 1));

    expect(projection.ingestCommittedEvidence({
      intervalId: "interval-recovery-order",
      sequence: 1,
      eventId: newer.id,
      candidate: newer
    })).toMatchObject({ accepted: true });
    expect(projection.snapshot().subscriptionCount).toBe(2);
    expect(projection.ingestCommittedEvidence({
      intervalId: "interval-recovery-order",
      sequence: 2,
      eventId: stale.id,
      candidate: stale
    })).toEqual({ accepted: false, resetConsumerState: false });
    expect(projection.snapshot().subscriptionCount).toBe(2);
    expect(projection.snapshot().serverEstablishedSubscriptionCount).toBe(1);
  });

  it("does not project a complete checkpoint until its candidate becomes committed Evidence", async () => {
    const commit = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID,
      commitBatch: () => commit.promise
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    for (const frame of checkpointFrames()) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }

    expect(runtime.getSnapshot().scope.nodes.map(({ id }) => id)).not.toContain(
      "ticket09-subscription"
    );
    expect(runtime.getSnapshot().evidence.total).toBe(0);

    commit.resolve();
    await settle();

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });

  it("does not project a checkpoint that settles as NOT_EVIDENCE and protects duplicate sync delivery", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID,
      commitBatch: async () => {
        throw new Error("ticket09 journal failure");
      }
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    for (const frame of checkpointFrames("rejected-sync")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().scope.nodes.map(({ id }) => id)).not.toContain(
      "ticket09-subscription"
    );

    runtime.dispose();
  });

  it("commits one checkpoint for one complete sequence even when the sequence is delivered twice", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });
    const sequence = checkpointFrames("duplicate-sync");

    for (const frame of [...sequence, ...sequence]) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });

  it("recovers from an invalid staged sequence and accepts the next complete checkpoint", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: PANEL_SESSION_ID
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });
    const [begin, chunk, complete] = checkpointFrames("recovery-sync");

    runtime.dispatch({ type: "apply-topology-sync-frame", frame: begin });
    runtime.dispatch({
      type: "apply-topology-sync-frame",
      frame: { ...chunk, records: [] }
    });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: complete });
    for (const frame of checkpointFrames("recovered-sync")) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    await settle();

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });
});

function checkpointFrames(
  syncId = "complete-sync",
  subscriptionId = "ticket09-subscription",
  cutoffCaptureSequence = 1
): readonly [
  TopologySyncBeginFrame,
  TopologySyncChunkFrame,
  TopologySyncCompleteFrame
] {
  const records: TopologyAbsoluteRecord[] = [
    {
      kind: "page",
      id: PAGE_EPOCH,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1
    },
    {
      kind: "client",
      id: "ticket09-client",
      parentId: PAGE_EPOCH,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      clientActive: true
    },
    {
      kind: "subscription",
      id: subscriptionId,
      parentId: "ticket09-client",
      clientId: "ticket09-client",
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      clientActive: true,
      serverEstablished: true
    }
  ];
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    panelSessionId: PANEL_SESSION_ID,
    pageEpoch: PAGE_EPOCH,
    cutoffCaptureSequence,
    chunkCount: 1,
    recordCount: records.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records },
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  ];
}

function observation(subscriptionId: string, captureSequence: number): TopologyObservation {
  return {
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind: "subscription-active",
    pageEpoch: PAGE_EPOCH,
    captureSequence,
    provenance: { instrumentationSource: "official-public-api" },
    coverage: { status: "complete", getters: {} },
    client: { id: "ticket09-client" },
    subscription: { id: subscriptionId }
  };
}

function topologyCapture(topology: TopologyObservation) {
  return createCaptureMessage(
    "subscription-started",
    {
      client: { id: "ticket09-client" },
      subscription: { id: topology.subscription?.id ?? "ticket09-subscription" }
    },
    topology.captureSequence,
    topology
  );
}

function checkpointCandidate(
  frames: readonly [TopologySyncBeginFrame, TopologySyncChunkFrame, TopologySyncCompleteFrame],
  observations: readonly TopologyObservation[] = []
) {
  const result = createTopologyCheckpointEvidenceCandidate(frames, observations);
  if (!result.ok) throw new Error(result.rejection.code);
  return result.value;
}

function subscriptionIds(state: TopologyState) {
  return [
    ...state.unassignedSubscriptions.map(({ id }) => id),
    ...state.clients.flatMap((client) => [
      ...client.waitingSubscriptions.map(({ id }) => id),
      ...client.sessions.flatMap((session) => session.subscriptions.map(({ id }) => id))
    ])
  ];
}

async function committedTopologyCandidates(history: Awaited<ReturnType<typeof createMemoryEventHistoryForTests>>) {
  const result = await history.read({ order: "asc" });
  if (!result.ok) throw new Error(result.problem.message);
  return result.value.evidence.flatMap(({ candidate }) =>
    candidate.kind === "topology-checkpoint" ? [candidate] : []
  );
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function immediateScheduler(): WorkbenchRuntimeScheduler {
  return {
    requestFrame(callback) {
      queueMicrotask(callback);
      return 1;
    },
    cancelFrame() {
      return;
    },
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {
      return;
    }
  };
}
