import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";
import { getPanelScenario } from "./support/panel-scenarios";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createFrameScheduler(): WorkbenchRuntimeScheduler & { flushFrame(): void } {
  let nextId = 0;
  const frames = new Map<number, () => void>();
  const fallbacks = new Map<number, () => void>();
  return {
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id as number);
    },
    setTimeout(callback) {
      const id = ++nextId;
      fallbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      fallbacks.delete(id as number);
    },
    flushFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    }
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("production React runtime performance boundary seam", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports identity-only runtime diagnostics without exposing Evidence payloads", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "performance-diagnostics" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      captureStatus: "capturing",
      performanceHooks: { onVisibleFrame() {} }
    });
    await flushPromises();

    const event = createEventHistoryWorkloadEvent("large-json-rich", 1, "diagnostics");
    await expect(history.offer(event).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    scheduler.flushFrame();
    await flushPromises();

    const beforeFrame = runtime.getPerformanceDiagnostics?.();
    expect(beforeFrame).toMatchObject({
      disposed: false,
      visible: true,
      committedEvidenceBoundary: { sequence: 1, eventId: event.id },
      renderedEvidenceBoundary: { sequence: 1, eventId: event.id },
      pendingVisibleCount: 1,
      pendingVisibleHead: { sequence: 1, eventId: event.id },
      pendingVisibleTail: { sequence: 1, eventId: event.id },
      evidenceQueryPending: false,
      passiveRefreshPending: false,
      liveEvidenceTotal: 1,
      liveEvidenceTail: { eventId: event.id },
      lastEvidenceQueryError: null,
      visibleFrameHeartbeat: 0,
      lastVisibleFrameAtMs: null
    });
    expect(JSON.stringify(beforeFrame)).not.toContain("payload");
    expect(Object.keys(beforeFrame?.panel ?? {})).toEqual([
      "rootMounted",
      "subscriptionActive",
      "lastLayoutEffectSnapshotVersion",
      "lastLayoutEffectBoundary",
      "animationFramePending",
      "animationFrameRequestCount",
      "lastAnimationFrameRequestedAtMs",
      "animationFrameCallbackCount",
      "lastAnimationFrameCallbackAtMs",
      "animationFrameCancelCount"
    ]);

    runtime.reportVisibleFrame?.();
    expect(runtime.getPerformanceDiagnostics?.()).toMatchObject({
      pendingVisibleCount: 0,
      visibleFrameHeartbeat: 1
    });
    expect(runtime.getPerformanceDiagnostics?.()?.lastVisibleFrameAtMs).toEqual(expect.any(Number));

    runtime.dispose();
    await history.close();
  });

  it("reports authoritative commit and later visible-frame observations for the same boundary", async () => {
    const committed: Array<{ sequence: number; at: number }> = [];
    const visible: Array<{ sequence: number; at: number }> = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-seam" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      captureStatus: "capturing",
      performanceHooks: {
        onCommittedEvidenceBoundary(boundary, timestampMs) {
          committed.push({ sequence: boundary.sequence, at: timestampMs });
        },
        onVisibleFrame(boundary, timestampMs) {
          visible.push({ sequence: boundary.sequence, at: timestampMs });
        }
      }
    });

    const receipt = history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "seam"));
    await expect(receipt.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } });
    scheduler.flushFrame();
    await flushPromises();
    runtime.reportVisibleFrame?.();

    expect(committed).toHaveLength(1);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.sequence).toBe(committed[0]?.sequence);
    expect(visible[0]?.at).toBeGreaterThanOrEqual(committed[0]?.at ?? 0);

    runtime.dispose();
    await history.close();
  });

  it("times only an accepted topology staging exchange, not duplicate or mismatched frames", async () => {
    const starts: string[] = [];
    const ends: string[] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-topology-staging" });
    const runtime = createWorkbenchRuntime({
      history,
      performanceHooks: {
        onCheckpointStagingStart(syncId) {
          starts.push(syncId);
        },
        onCheckpointStagingEnd(syncId) {
          ends.push(syncId);
        }
      }
    });
    const frames = getPanelScenario("topology-small").topologySyncFrames ?? [];
    const begin = frames[0];
    const complete = frames.at(-1);
    if (!begin || !complete) throw new Error("topology-small scenario is missing sync frames");

    runtime.dispatch({ type: "apply-topology-sync-frame", frame: complete });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: begin });
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: begin });
    runtime.dispatch({
      type: "apply-topology-sync-frame",
      frame: { ...complete, pageEpoch: "spoofed-page" }
    });
    expect(starts).toEqual([begin.syncId]);
    expect(ends).toEqual([]);

    for (const frame of frames.slice(1)) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    expect(ends).toEqual([begin.syncId]);

    runtime.dispose();
    await history.close();
  });

  it("reports every committed boundary covered by one coalesced visible frame", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-coalesced" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      captureStatus: "capturing",
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          covered.push((boundaries ?? []).map((boundary) => boundary.sequence));
        }
      }
    });

    const first = history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "coalesced"));
    const second = history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 2, "coalesced"));
    await Promise.all([first.settled, second.settled]);
    scheduler.flushFrame();
    await flushPromises();
    runtime.reportVisibleFrame?.();

    expect(covered).toEqual([[1, 2]]);
    runtime.dispose();
    await history.close();
  });

  it("reports only boundaries covered by the Evidence snapshot that actually rendered", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-rendered-boundary" });
    const scheduler = createFrameScheduler();
    type ReadResult = Awaited<ReturnType<typeof history.read>>;
    const deferredReads: Array<{ result: ReadResult; resolve(result: ReadResult): void }> = [];
    let deferReads = false;
    const runtime = createWorkbenchRuntime({
      history: {
        ...history,
        read(query) {
          const snapshot = history.read(query);
          if (!deferReads) return snapshot;
          return snapshot.then(
            (result) => new Promise<ReadResult>((resolve) => deferredReads.push({ result, resolve }))
          );
        }
      },
      scheduler,
      windowSize: 25,
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          covered.push((boundaries ?? []).map((boundary) => boundary.sequence));
        }
      }
    });
    await flushPromises();

    deferReads = true;
    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "rendered-boundary")).settled;
    scheduler.flushFrame();
    await flushPromises();
    expect(deferredReads).toHaveLength(1);

    const laterReceipts = Array.from({ length: 999 }, (_, index) =>
      history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", index + 2, "rendered-boundary")).settled
    );
    await Promise.all(laterReceipts);
    scheduler.flushFrame();
    await flushPromises();

    deferredReads[0]?.resolve(deferredReads[0].result);
    await flushPromises();
    expect(deferredReads).toHaveLength(2);
    runtime.reportVisibleFrame?.();
    expect(covered.flat()).toEqual([1]);
    expect(covered.flat()).not.toContain(1000);

    deferredReads[1]?.resolve(deferredReads[1].result);
    await flushPromises();
    runtime.reportVisibleFrame?.();
    expect(covered.flat()).toHaveLength(1000);
    expect(covered.flat().filter((sequence) => sequence === 1000)).toEqual([1000]);

    runtime.dispose();
    await history.close();
  });

  it("drains a passive refresh queued behind an unsuccessful Evidence read", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "performance-read-recovery" });
    const scheduler = createFrameScheduler();
    type ReadResult = Awaited<ReturnType<typeof history.read>>;
    let resolveInitialRead: ((result: ReadResult) => void) | undefined;
    let readCalls = 0;
    const runtime = createWorkbenchRuntime({
      history: {
        ...history,
        read(query) {
          readCalls += 1;
          if (readCalls === 1) {
            return new Promise<ReadResult>((resolve) => {
              resolveInitialRead = resolve;
            });
          }
          return history.read(query);
        }
      },
      scheduler
    });
    await flushPromises();
    // The runtime also performs an independent projection-hydration read.
    expect(readCalls).toBe(2);

    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "read-recovery")).settled;
    scheduler.flushFrame();
    await flushPromises();
    expect(readCalls).toBe(2);

    resolveInitialRead?.({
      ok: false,
      problem: { code: "HISTORY_CLOSED", message: "Synthetic unsuccessful read." }
    });
    await flushPromises();

    expect(readCalls).toBe(3);
    runtime.dispose();
    await history.close();
  });

  it("lets the production panel hook report the rendered boundary", async () => {
    const visible: number[] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-react-hook" });
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      performanceHooks: {
        onVisibleFrame(boundary) {
          visible.push(boundary.sequence);
        }
      }
    });
    const rootElement = document.createElement("main");
    document.body.append(rootElement);
    const root = createRoot(rootElement);

    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
    });
    await act(async () => {
      await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "react-hook")).settled;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(visible).toEqual([1]);

    await act(async () => root.unmount());
    runtime.dispose();
    await history.close();
    rootElement.remove();
  });

  it("keeps one visible-frame callback alive across rapid React snapshot commits", async () => {
    const visible: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-react-coalesced-frame" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      captureStatus: "capturing",
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          visible.push((boundaries ?? []).map((entry) => entry.sequence));
        }
      }
    });
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frame = ++nextFrame;
      callbacks.set(frame, callback);
      return frame;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      callbacks.delete(frame);
    });
    const rootElement = document.createElement("main");
    document.body.append(rootElement);
    const root = createRoot(rootElement);

    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    expect(callbacks.size).toBe(1);

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await act(async () => {
        await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", sequence, "react-coalesced-frame")).settled;
        scheduler.flushFrame();
        await flushPromises();
      });
    }

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(cancelFrame).not.toHaveBeenCalled();
    const callback = callbacks.values().next().value;
    expect(callback).toBeTypeOf("function");
    await act(async () => callback?.(performance.now()));
    expect(visible).toEqual([[1, 2, 3]]);

    for (let index = 0; index < 1_000; index += 1) {
      await act(async () => {
        runtime.dispatch({ type: "set-theme", theme: index % 2 === 0 ? "dark" : "light" });
      });
    }
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(2);

    await act(async () => root.unmount());
    runtime.dispose();
    await history.close();
    rootElement.remove();
  });

  it("attributes a visible frame to the exact immutable boundary React committed", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-versioned-frame" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          covered.push((boundaries ?? []).map((entry) => entry.sequence));
        }
      }
    });
    await flushPromises();

    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "versioned-frame")).settled;
    scheduler.flushFrame();
    await flushPromises();
    const firstBoundary = runtime.getSnapshot().renderedEvidenceBoundary;
    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 2, "versioned-frame")).settled;
    scheduler.flushFrame();
    await flushPromises();
    const secondBoundary = runtime.getSnapshot().renderedEvidenceBoundary;

    runtime.reportVisibleFrame?.(firstBoundary);
    runtime.reportVisibleFrame?.(secondBoundary);
    expect(covered).toEqual([[1], [2]]);

    runtime.dispose();
    await history.close();
  });

  it("ignores a held visible-frame callback after the panel becomes hidden", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-hidden-held-frame" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          covered.push((boundaries ?? []).map((entry) => entry.sequence));
        }
      }
    });
    await flushPromises();
    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "hidden-held-frame")).settled;
    scheduler.flushFrame();
    await flushPromises();
    const committedBoundary = runtime.getSnapshot().renderedEvidenceBoundary;

    runtime.dispatch({ type: "set-visible", visible: false });
    runtime.reportVisibleFrame?.(committedBoundary);
    expect(covered).toEqual([]);

    runtime.dispose();
    await history.close();
  });

  it("does not attribute a prior interval to a later visible frame", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-interval-boundary" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      captureStatus: "capturing",
      performanceHooks: {
        onVisibleFrame(_boundary, _timestampMs, boundaries) {
          covered.push((boundaries ?? []).map((boundary) => boundary.sequence));
        }
      }
    });

    await expect(history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "before-clear")).settled)
      .resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } });
    await expect(history.clear()).resolves.toMatchObject({ ok: true });
    await expect(history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 2, "after-clear")).settled)
      .resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 2 } });

    scheduler.flushFrame();
    await flushPromises();
    runtime.reportVisibleFrame?.();

    expect(covered).toEqual([[2]]);
    runtime.dispose();
    await history.close();
  });

  it("does not report a visible frame while the panel is hidden", async () => {
    const visibleReports: number[] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-hidden-frame" });
    const scheduler = createFrameScheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler,
      visible: false,
      performanceHooks: {
        onVisibleFrame(boundary) {
          visibleReports.push(boundary.sequence);
        }
      }
    });

    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "hidden")).settled;
    runtime.reportVisibleFrame?.();
    expect(visibleReports).toEqual([]);

    runtime.dispatch({ type: "set-visible", visible: true });
    await flushPromises();
    runtime.reportVisibleFrame?.();
    expect(visibleReports).toEqual([1]);
    runtime.dispose();
    await history.close();
  });
});
