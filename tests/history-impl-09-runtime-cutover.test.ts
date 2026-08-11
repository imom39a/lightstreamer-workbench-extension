import { describe, expect, it, vi } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
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
});

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
