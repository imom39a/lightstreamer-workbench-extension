import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createMemoryEventHistoryForTests
} from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { createCaptureMessage } from "../src/bridge/messages";

describe("history-impl-09 final audit gaps", () => {
  it("discards a delayed export after scope, option, or clear mutations", async () => {
    const pendingReads: Array<() => void> = [];
    let deferExportReads = false;
    const history = createAuthoritativeHistory({
      precommitted: [
        topologyEvent("export-client-a", "export-client-a"),
        topologyEvent("export-client-b", "export-client-b")
      ],
      readControl(query, release) {
        if (deferExportReads && query.candidateKind === "lightstreamer" && query.order === "asc") {
          pendingReads.push(release);
          return;
        }
        release();
      }
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    deferExportReads = true;

    const assertDiscarded = async (mutation: () => void): Promise<void> => {
      runtime.dispatch({ type: "export-scope" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(pendingReads.length).toBeGreaterThan(0);
      mutation();
      pendingReads.splice(0).forEach((release) => release());
      await settle();
      expect(runtime.getSnapshot().export.document).toBeNull();
    };

    await assertDiscarded(() => runtime.dispatch({ type: "set-scope", scopeId: "page" }));
    await assertDiscarded(() => runtime.dispatch({ type: "set-export-redactions", redactions: ["identifiers"] }));
    await assertDiscarded(() => runtime.dispatch({ type: "set-export-complete-evidence", complete: true }));
    await assertDiscarded(() => {
      runtime.dispatch({ type: "request-clear-history" });
      runtime.dispatch({ type: "confirm-clear-history" });
    });

    runtime.dispose();
    await settle();
  });

  it("builds Topology export from the projection while Evidence uses the canonical query", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [topologyEvent("projection-event", "projection-client")]
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "export-scope" });
    await settle();

    expect(runtime.getSnapshot().export.document?.clients.map(({ id }) => id)).toEqual([
      "projection-client"
    ]);
    runtime.dispose();
  });

  it("preserves exact terminal Evidence fields in degraded runtime state", async () => {
    const commit = deferred<void>();
    const commitStarted = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-final-gaps-terminal",
      byteEstimator: () => 60,
      capacity: { maxRetainedBytes: 100, maxRetainedCount: 10 },
      commitBatch: async () => {
        commitStarted.resolve();
        await commit.promise;
      }
    });
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    runtime.dispatch({ type: "ingest-capture-message", message: captureMessage(1) });
    await commitStarted.promise;
    runtime.dispatch({ type: "ingest-capture-message", message: captureMessage(2) });

    expect(runtime.getSnapshot().capture).toMatchObject({
      operation: "STOPPED",
      coverage: "LIMITED"
    });

    commit.resolve();
    await settle();

    expect(runtime.getSnapshot().capture).toMatchObject({
      operation: "STOPPED",
      coverage: "LIMITED",
      firstMissingEventId: "event-2",
      committedEvidenceBoundary: {
        sequence: 1,
        eventId: "event-1"
      }
    });
    runtime.dispose();
    await settle();
  });
});

function topologyEvent(id: string, clientId: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "client-status",
    client: {
      id: clientId,
      sessionId: `${clientId}-session`,
      status: "CONNECTED:WS-STREAMING"
    }
  };
}

function captureMessage(sequence: number) {
  return createCaptureMessage(
    "item-update",
    {
      client: { id: "client-1", sessionId: "session-1" },
      subscription: {
        id: "command-sub",
        mode: "COMMAND",
        fields: ["command", "key", "value"]
      },
      item: { name: "orders", position: 1 },
      update: {
        command: "ADD",
        key: `order-${sequence}`,
        fields: { command: "ADD", key: `order-${sequence}`, value: sequence }
      }
    },
    sequence
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
  await import("../src/extension/panel/evidence-history-operation");
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function immediateScheduler(): WorkbenchRuntimeScheduler {
  let nextId = 0;
  const cancelled = new Set<number>();
  const enqueue = (callback: () => void): number => {
    const id = ++nextId;
    queueMicrotask(() => {
      if (cancelled.has(id)) return;
      cancelled.delete(id);
      callback();
    });
    return id;
  };
  return {
    requestFrame(callback) {
      return enqueue(callback);
    },
    cancelFrame(id) {
      cancelled.add(id as number);
    },
    setTimeout(callback) {
      return enqueue(callback);
    },
    clearTimeout(id) {
      cancelled.add(id as number);
    },
  };
}
