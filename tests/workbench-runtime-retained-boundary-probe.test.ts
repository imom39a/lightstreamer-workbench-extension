import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function scheduler(): WorkbenchRuntimeScheduler & { flushFrame(): void } {
  let next = 0;
  const frames = new Map<number, () => void>();
  return {
    requestFrame(callback) {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(handle) { frames.delete(handle as number); },
    setTimeout(callback) {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    clearTimeout(handle) { frames.delete(handle as number); },
    flushFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    }
  };
}

async function ticks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

describe("ticket 11 runtime boundary probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("reports a stale rendered boundary first, then the exact retained tail after the final panel render", async () => {
    const panelSessionId = `ticket11-boundary-probe-${Date.now()}`;
    const history: EventHistory = createInMemoryEventHistory({ panelSessionId });
    const runtimeScheduler = scheduler();
    const visible: Array<{ boundary: number; covered: number[]; snapshotTail: string | undefined }> = [];
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      performanceHooks: {
        onVisibleFrame(boundary, _at, covered) {
          visible.push({
            boundary: boundary.sequence,
            covered: covered.map((entry) => entry.sequence),
            snapshotTail: runtime.getSnapshot().evidence.events.at(-1)?.id
          });
        }
      }
    });
    const panelFrames = new Map<number, FrameRequestCallback>();
    let nextPanelFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextPanelFrame;
      panelFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      panelFrames.delete(handle);
    });
    const takePanelFrame = (): FrameRequestCallback | undefined => {
      const next = panelFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) return undefined;
      panelFrames.delete(next[0]);
      return next[1];
    };
    const rootElement = document.createElement("main");
    document.body.append(rootElement);
    const root = createRoot(rootElement);

    try {
      await act(async () => {
        root.render(createElement(WorkbenchPanel, { runtime }));
        await ticks(8);
      });
      // Consume the initial mounted frame(s), which have no Evidence boundary,
      // while the initial IndexedDB read settles.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        runtimeScheduler.flushFrame();
        await act(async () => {
          await ticks(8);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
        let callback: FrameRequestCallback | undefined;
        while ((callback = takePanelFrame())) await act(async () => callback?.(performance.now()));
      }

      const first = createEventHistoryWorkloadEvent("small-lifecycle", 0, panelSessionId);
      await act(async () => {
        await expect(history.offer(first).settled).resolves.toMatchObject({
          outcome: "BECAME_EVIDENCE",
          evidence: { sequence: 1 }
        });
      });
      await act(async () => {
        runtimeScheduler.flushFrame();
        await ticks(8);
      });
      for (let attempt = 0; attempt < 20 && runtime.getSnapshot().evidence.events.at(-1)?.id !== first.id; attempt += 1) {
        runtimeScheduler.flushFrame();
        await act(async () => {
          await ticks(8);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
      }
      expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe(first.id);

      const receipts = Array.from({ length: 999 }, (_, index) =>
        history.offer(createEventHistoryWorkloadEvent("small-lifecycle", index + 1, panelSessionId)).settled
      );
      await act(async () => {
        await Promise.all(receipts);
        await ticks(8);
      });

      const staleFrame = takePanelFrame();
      expect(staleFrame).toBeTypeOf("function");
      await act(async () => staleFrame?.(performance.now()));
      expect(visible[0]).toEqual({
        boundary: 1,
        covered: [1],
        snapshotTail: first.id
      });

      // The runtime now publishes the committed tail; the next production
      // panel frame must report that exact rendered boundary and tail event.
      await act(async () => runtime.dispatch({ type: "refresh-evidence" }));
      let finalFrame: FrameRequestCallback | undefined;
      for (let attempt = 0; attempt < 20 && !finalFrame; attempt += 1) {
        runtimeScheduler.flushFrame();
        await act(async () => {
          await ticks(8);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
        finalFrame = takePanelFrame();
      }
      expect(finalFrame).toBeTypeOf("function");
      await act(async () => finalFrame?.(performance.now()));

      expect(visible.at(-1)).toEqual({
        boundary: 1000,
        covered: Array.from({ length: 999 }, (_, index) => index + 2),
        snapshotTail: `${panelSessionId}-small-lifecycle-999`
      });
    } finally {
      await act(async () => root.unmount());
      runtime.dispose();
      await history.close();
    }
  });
});
