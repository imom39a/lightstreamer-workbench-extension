import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("production React runtime performance boundary seam", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports authoritative commit and later visible-frame observations for the same boundary", async () => {
    const committed: Array<{ sequence: number; at: number }> = [];
    const visible: Array<{ sequence: number; at: number }> = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-seam" });
    const runtime = createWorkbenchRuntime({
      history,
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
    runtime.reportVisibleFrame?.();

    expect(committed).toHaveLength(1);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.sequence).toBe(committed[0]?.sequence);
    expect(visible[0]?.at).toBeGreaterThanOrEqual(committed[0]?.at ?? 0);

    runtime.dispose();
    await history.close();
  });

  it("reports every committed boundary covered by one coalesced visible frame", async () => {
    const covered: number[][] = [];
    const history = createInMemoryEventHistory({ panelSessionId: "performance-coalesced" });
    const runtime = createWorkbenchRuntime({
      history,
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
    runtime.reportVisibleFrame?.();

    expect(covered).toEqual([[1, 2]]);
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
});
