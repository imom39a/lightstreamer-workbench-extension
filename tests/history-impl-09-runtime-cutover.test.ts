import { describe, expect, it, vi } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { createMemoryEventHistoryForTests, type HistoryPublication } from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";

describe("history-impl-09 runtime cutover", () => {
  it("keeps pending Capture absent, then exposes one committed Evidence row", async () => {
    const commit = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-runtime",
      commitBatch: () => commit.promise
    });
    const close = vi.spyOn(history, "close");
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: immediateScheduler()
    });

    await settle();
    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage(
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
            key: "order-1",
            fields: { command: "ADD", key: "order-1", value: "pending" }
          }
        },
        1
      )
    });

    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().commandProjections.observed.rows).toHaveLength(0);

    commit.resolve();
    await settle();

    expect(runtime.getSnapshot().evidence.total).toBe(1);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      expect.any(String)
    ]);
    expect(runtime.getSnapshot().commandProjections.observed.rows).toHaveLength(1);

    runtime.dispose();
    runtime.dispose();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces STOPPED and LIMITED at the first refused committed boundary once", async () => {
    const commit = deferred<void>();
    const commitStarted = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-refusal-boundary",
      byteEstimator: () => 60,
      capacity: { maxRetainedBytes: 100, maxRetainedCount: 10 },
      commitBatch: async () => {
        commitStarted.resolve();
        await commit.promise;
      }
    });
    const stopPublications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (
        (publication.type === "status" && publication.status.phase !== "RUNNING") ||
        publication.type === "terminal"
      ) {
        stopPublications.push(publication);
      }
    });
    const runtime = createWorkbenchRuntime({ history, scheduler: immediateScheduler() });
    const degradedCaptures: Array<{ operation: string; coverage: string; detail?: string }> = [];
    let lastDegradedCapture: string | null = null;
    runtime.subscribe(() => {
      const capture = runtime.getSnapshot().capture;
      if (capture.operation === "STOPPED" || capture.coverage === "LIMITED") {
        const identity = JSON.stringify(capture);
        if (identity !== lastDegradedCapture) {
          degradedCaptures.push(capture);
          lastDegradedCapture = identity;
        }
      }
    });

    runtime.dispatch({ type: "ingest-capture-message", message: captureMessage(1) });
    await commitStarted.promise;

    runtime.dispatch({ type: "ingest-capture-message", message: captureMessage(2) });

    expect(runtime.getSnapshot()).toMatchObject({
      capture: {
        operation: "STOPPED",
        coverage: "LIMITED",
        detail: expect.stringContaining("RETAINED_BYTE_LIMIT")
      },
      evidence: { total: 0 }
    });

    commit.resolve();
    await settle();
    expect(runtime.getSnapshot().evidence.total).toBe(1);
    expect(degradedCaptures).toHaveLength(2);
    expect(degradedCaptures[0]).toMatchObject({
      operation: "STOPPED",
      coverage: "LIMITED",
      detail: expect.stringContaining("RETAINED_BYTE_LIMIT")
    });
    expect(degradedCaptures[1]).toMatchObject({
      operation: "STOPPED",
      coverage: "LIMITED",
      firstMissingEventId: "event-2",
      committedEvidenceBoundary: { sequence: 1, eventId: "event-1" }
    });
    expect(stopPublications).toHaveLength(3);
    expect(stopPublications[0]).toMatchObject({
      type: "status",
      status: { phase: "DRAINING_TO_STOP", captureOperation: "STOPPED" },
      problem: { reason: "RETAINED_BYTE_LIMIT" }
    });
    expect(stopPublications[1]).toMatchObject({
      type: "terminal",
      terminal: { reason: "RETAINED_BYTE_LIMIT" },
      status: { phase: "STOPPED", captureOperation: "STOPPED" }
    });
    expect(stopPublications[2]).toMatchObject({
      type: "status",
      status: { phase: "STOPPED", captureOperation: "STOPPED" },
      problem: { reason: "RETAINED_BYTE_LIMIT" }
    });
    expect(stopPublications.filter((publication) => publication.type === "terminal")).toHaveLength(1);

    runtime.dispose();
    await settle();
  });

  it("keeps coverage USEFUL when startup selects the lower-capacity journal tier", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-lower-capacity",
      capacityTier: "LOWER",
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });
    const runtime = createWorkbenchRuntime({ history, scheduler: immediateScheduler() });

    await settle();
    expect(runtime.getSnapshot().capture.coverage).toBe("USEFUL");

    runtime.dispatch({ type: "ingest-capture-message", message: captureMessage(1) });
    await settle();

    expect(runtime.getSnapshot().capture).toMatchObject({
      operation: "RUNNING",
      coverage: "USEFUL"
    });
    runtime.dispose();
    await settle();
  });

  it("handles a typed close failure during runtime disposal", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-close-failure",
      closeJournal: async () => {
        throw new Error("close unavailable");
      }
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = createWorkbenchRuntime({ history, scheduler: immediateScheduler() });

    runtime.dispose();
    await settle();

    expect(error).toHaveBeenCalledWith(
      "Failed to close panel event history.",
      "close unavailable"
    );
    error.mockRestore();
  });
});

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
