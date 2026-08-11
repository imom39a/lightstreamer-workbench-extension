import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type EvidenceRead
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
        if (deferExportReads && query.candidateKind === undefined && query.order === "asc") {
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
      expect(pendingReads).toHaveLength(1);
      mutation();
      pendingReads.shift()?.();
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

  it("builds Topology export from the typed boundary-qualified history read", async () => {
    const baseHistory = createAuthoritativeHistory({
      precommitted: [topologyEvent("projection-event", "projection-client")]
    });
    const originalRead = baseHistory.read.bind(baseHistory);
    const read = vi.fn(async (query: Parameters<EventHistory["read"]>[0]) => {
      const result = await originalRead(query);
      if (query.candidateKind !== undefined || query.order !== "asc" || !result.ok) {
        return result;
      }
      const candidate = topologyEvent("history-event", "history-client");
      const evidence = Object.freeze({
        intervalId: result.value.interval.id,
        sequence: 7,
        eventId: candidate.id,
        candidate
      });
      const boundary = Object.freeze({
        intervalId: result.value.interval.id,
        sequence: evidence.sequence,
        eventId: evidence.eventId
      });
      const value: EvidenceRead = Object.freeze({
        ...result.value,
        evidence: Object.freeze([evidence]),
        total: 1,
        committedEvidenceBoundary: boundary,
        retainedRange: { first: boundary, last: boundary }
      });
      return { ok: true as const, value };
    });
    const history: EventHistory = { ...baseHistory, read };

    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "export-scope" });
    await settle();

    expect(read.mock.calls.some(([query]) =>
      query.candidateKind === undefined && query.order === "asc"
    )).toBe(true);
    expect(runtime.getSnapshot().export.document?.clients.map(({ id }) => id)).toEqual([
      "history-client"
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
    cancelFrame() {},
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {}
  };
}
