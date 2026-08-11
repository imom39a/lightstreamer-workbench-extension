import { describe, expect, it } from "vitest";

import {
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  type TopologyAbsoluteRecord,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame
} from "../src/bridge/messages";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";

const PAGE_EPOCH = "ticket09-page";
const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000009";

describe("history-impl-09 topology cutover", () => {
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

    expect(runtime.getSnapshot().evidence.total).toBe(1);
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

    expect(runtime.getSnapshot().evidence.total).toBe(1);
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

    expect(runtime.getSnapshot().evidence.total).toBe(1);
    expect(runtime.getSnapshot().scope.nodes[0]).toMatchObject({
      kind: "page",
      detail: "1 clients · 1 subscriptions"
    });

    runtime.dispose();
  });
});

function checkpointFrames(
  syncId = "complete-sync"
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
      id: "ticket09-subscription",
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
    cutoffCaptureSequence: 1,
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
