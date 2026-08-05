import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { createInMemoryEventHistory } from "../src/core/event-history";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";
import {
  createTopologyPerformanceCaptureMessages,
  createTopologyPerformanceLogicalUpdateMessages
} from "../tests/support/panel-scenarios";

type TopologyPerformanceConfig = {
  durationMs: number;
  logicalUpdatesPerSecond: number;
  subscriptionCount: number;
  itemsPerSubscription: number;
  listenersPerSubscription: number;
};

type RenderSample = {
  phase: "collapsed" | "expanded";
  durationMs: number;
  paintCatchupMs: number;
  mountedNodeCount: number;
  uiLagMs: number;
};

type TopologyPerformanceResult = {
  config: TopologyPerformanceConfig;
  expected: { logicalUpdates: number; callbackDeliveries: number };
  actual: { logicalUpdates: number; callbackDeliveries: number };
  semanticNodes: {
    expected: number;
    expanded: number;
    collapsed: number;
    restored: number;
  };
  mountedNodes: {
    expanded: number;
    collapsed: number;
    restored: number;
    maximum: number;
  };
  navigation: {
    firstId: string;
    lastId: string;
    endFocusedId: string | null;
    homeFocusedId: string | null;
    scrollRangeAvailable: boolean;
    scrollPreservedFocus: boolean;
    scrollMountedOffscreen: boolean;
    oneTabStop: boolean;
    selectionStable: boolean;
  };
  backlogMs: number;
  maxUiLagMs: number;
  p95RenderMs: { collapsed: number; expanded: number };
  maxPaintCatchupMs: number;
  maxInteractionMs: number;
  longTasksOver50Ms: number;
  maxLongTaskMs: number;
};

declare global {
  interface Window {
    __LSEW_TOPOLOGY_PERFORMANCE__?: {
      run(config?: Partial<TopologyPerformanceConfig>): Promise<TopologyPerformanceResult>;
    };
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Topology performance harness requires #app.");

let publicationStartedAt = performance.now();
const scheduler: WorkbenchRuntimeScheduler = {
  requestFrame(callback) {
    return requestAnimationFrame(() => {
      publicationStartedAt = performance.now();
      callback();
    });
  },
  cancelFrame(handle) {
    cancelAnimationFrame(handle as number);
  },
  setTimeout(callback, delayMs) {
    return window.setTimeout(() => {
      publicationStartedAt = performance.now();
      callback();
    }, delayMs);
  },
  clearTimeout(handle) {
    window.clearTimeout(handle as number);
  }
};
const history = createInMemoryEventHistory();
const runtime = createWorkbenchRuntime({
  history,
  captureStatus: "capturing",
  theme: "dark",
  scheduler
});
const reactRoot = createRoot(root);
reactRoot.render(createElement(WorkbenchPanel, { runtime }));

window.__LSEW_TOPOLOGY_PERFORMANCE__ = {
  async run(overrides = {}) {
    const config: TopologyPerformanceConfig = {
      durationMs: overrides.durationMs ?? 60_000,
      logicalUpdatesPerSecond: overrides.logicalUpdatesPerSecond ?? 1_000,
      subscriptionCount: overrides.subscriptionCount ?? 20,
      itemsPerSubscription: overrides.itemsPerSubscription ?? 50,
      listenersPerSubscription: overrides.listenersPerSubscription ?? 3
    };
    validateConfig(config);

    const expectedLogicalUpdates = Math.floor(
      (config.durationMs * config.logicalUpdatesPerSecond) / 1_000
    );
    const expectedDeliveries = expectedLogicalUpdates * config.listenersPerSubscription;
    const expectedSemanticNodes =
      3 + config.subscriptionCount * (1 + config.itemsPerSubscription * (1 + config.listenersPerSubscription));
    const samples: RenderSample[] = [];
    const interactionDurations: number[] = [];
    const longTasks: number[] = [];
    let emittedLogicalUpdates = 0;
    const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (entry.duration > 50) longTasks.push(entry.duration);
          }
        })
      : null;
    longTaskObserver?.observe({ entryTypes: ["longtask"] });

    const initialVersion = runtime.getSnapshot().version;
    appendTopology(config);
    await waitForWorkbenchCommit(initialVersion);
    await nextFrame();

    const semanticExpanded = logicalVisibleScopeNodeCount();
    const mountedExpanded = mountedScopeNodeCount();
    const modelNodes = runtime.getSnapshot().scope.nodes;
    const firstId = modelNodes[0]?.id ?? "";
    const lastId = modelNodes.at(-1)?.id ?? "";
    const rootNode = scopeNode(firstId);
    if (!rootNode || !lastId) throw new Error("Topology harness could not resolve Scope boundaries.");

    rootNode.focus();
    interactionDurations.push(await pressScopeKey(rootNode, "End"));
    const endFocusedId = focusedScopeId();
    const lastNode = scopeNode(lastId);
    interactionDurations.push(await pressScopeKey(lastNode, "Home"));
    const homeFocusedId = focusedScopeId();

    const mountedBeforeScroll = new Set(mountedScopeIds());
    const scrollStartedAt = performance.now();
    const tree = scopeTree();
    const scrollRangeAvailable = tree.scrollHeight > tree.clientHeight;
    tree.scrollTop = Math.floor((tree.scrollHeight - tree.clientHeight) / 2);
    tree.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    await nextFrame();
    const mountedMiddleWindow = mountedScopeIds().some((id) => !mountedBeforeScroll.has(id));
    tree.scrollTop = tree.scrollHeight;
    tree.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    await nextFrame();
    interactionDurations.push(performance.now() - scrollStartedAt);
    const scrollPreservedFocus = focusedScopeId() === firstId;
    const scrollMountedOffscreen = mountedMiddleWindow && scopeNode(lastId) !== null;

    const currentRoot = scopeNode(firstId);
    interactionDurations.push(await pressScopeKey(currentRoot, "ArrowLeft"));
    const semanticCollapsed = logicalVisibleScopeNodeCount();
    const mountedCollapsed = mountedScopeNodeCount();

    const collapsedTarget = Math.floor(expectedLogicalUpdates / 2);
    await emitPhase("collapsed", collapsedTarget, config.durationMs / 2);

    const collapsedRoot = scopeNode(firstId);
    interactionDurations.push(await pressScopeKey(collapsedRoot, "ArrowRight"));
    const semanticRestored = logicalVisibleScopeNodeCount();
    const mountedRestored = mountedScopeNodeCount();
    await emitPhase("expanded", expectedLogicalUpdates, config.durationMs / 2);

    const emissionFinishedAt = performance.now();
    await waitForRuntimeCatchup();
    const caughtUpAt = performance.now();
    for (const entry of longTaskObserver?.takeRecords() ?? []) {
      if (entry.duration > 50) longTasks.push(entry.duration);
    }
    longTaskObserver?.disconnect();

    const retained = await history.list().toPromise();
    const deliveredUpdates = retained.filter((event) =>
      typeof event.raw?.logicalEventId === "string" &&
      event.raw.logicalEventId.startsWith("performance-logical-update-")
    );
    const observedLogicalIds = new Set(deliveredUpdates.map((event) => String(event.raw?.logicalEventId)));
    const collapsedSamples = samples.filter(({ phase }) => phase === "collapsed");
    const expandedSamples = samples.filter(({ phase }) => phase === "expanded");
    return {
      config,
      expected: {
        logicalUpdates: expectedLogicalUpdates,
        callbackDeliveries: expectedDeliveries
      },
      actual: {
        logicalUpdates: observedLogicalIds.size,
        callbackDeliveries: deliveredUpdates.length
      },
      semanticNodes: {
        expected: expectedSemanticNodes,
        expanded: semanticExpanded,
        collapsed: semanticCollapsed,
        restored: semanticRestored
      },
      mountedNodes: {
        expanded: mountedExpanded,
        collapsed: mountedCollapsed,
        restored: mountedRestored,
        maximum: maximum(samples.map(({ mountedNodeCount }) => mountedNodeCount).concat([
          mountedExpanded,
          mountedCollapsed,
          mountedRestored
        ]))
      },
      navigation: {
        firstId,
        lastId,
        endFocusedId,
        homeFocusedId,
        scrollRangeAvailable,
        scrollPreservedFocus,
        scrollMountedOffscreen,
        oneTabStop: document.querySelectorAll('.workbench-react__scope-node[tabindex="0"]').length === 1,
        selectionStable: runtime.getSnapshot().scopeId === "page"
      },
      backlogMs: caughtUpAt - emissionFinishedAt,
      maxUiLagMs: maximum(samples.map(({ uiLagMs }) => uiLagMs)),
      p95RenderMs: {
        collapsed: percentile(collapsedSamples.map(({ durationMs }) => durationMs), 0.95),
        expanded: percentile(expandedSamples.map(({ durationMs }) => durationMs), 0.95)
      },
      maxPaintCatchupMs: maximum(samples.map(({ paintCatchupMs }) => paintCatchupMs)),
      maxInteractionMs: maximum(interactionDurations),
      longTasksOver50Ms: longTasks.length,
      maxLongTaskMs: maximum(longTasks)
    };

    async function emitPhase(
      phase: RenderSample["phase"],
      targetLogicalUpdates: number,
      phaseDurationMs: number
    ): Promise<void> {
      const phaseStart = performance.now();
      const phaseStartCount = emittedLogicalUpdates;
      const phaseCount = targetLogicalUpdates - phaseStartCount;
      while (emittedLogicalUpdates < targetLogicalUpdates) {
        await nextFrame();
        const now = performance.now();
        const elapsed = Math.min(phaseDurationMs, now - phaseStart);
        const target = Math.min(
          targetLogicalUpdates,
          phaseStartCount + Math.max(1, Math.floor((elapsed / phaseDurationMs) * phaseCount))
        );
        const previousVersion = runtime.getSnapshot().version;
        while (emittedLogicalUpdates < target) {
          emittedLogicalUpdates += 1;
          appendLogicalUpdate(config, emittedLogicalUpdates);
        }
        await waitForWorkbenchCommit(previousVersion);
        const committedAt = performance.now();
        const durationMs = committedAt - publicationStartedAt;
        await nextFrame();
        const paintedAt = performance.now();
        const scheduledAt =
          phaseStart +
          ((emittedLogicalUpdates - phaseStartCount) / Math.max(1, phaseCount)) * phaseDurationMs;
        samples.push({
          phase,
          durationMs,
          paintCatchupMs: paintedAt - committedAt,
          mountedNodeCount: mountedScopeNodeCount(),
          uiLagMs: Math.max(0, paintedAt - scheduledAt)
        });
      }
    }
  }
};

function appendTopology(config: TopologyPerformanceConfig): void {
  for (const message of createTopologyPerformanceCaptureMessages(config)) {
    runtime.dispatch({ type: "ingest-capture-message", message });
  }
}

function appendLogicalUpdate(config: TopologyPerformanceConfig, logicalIndex: number): void {
  for (const message of createTopologyPerformanceLogicalUpdateMessages(config, logicalIndex)) {
    runtime.dispatch({ type: "ingest-capture-message", message });
  }
}

async function pressScopeKey(node: HTMLButtonElement | null, key: string): Promise<number> {
  if (!node) throw new Error(`Scope node for ${key} is not mounted.`);
  const startedAt = performance.now();
  node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await nextFrame();
  return performance.now() - startedAt;
}

function scopeNode(id: string): HTMLButtonElement | null {
  return document.querySelector(`.workbench-react__scope-node[data-scope-id="${CSS.escape(id)}"]`);
}

function focusedScopeId(): string | null {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.scopeId ?? null
    : null;
}

function scopeTree(): HTMLElement {
  const tree = document.querySelector<HTMLElement>('.workbench-react__scope-tree[role="tree"]');
  if (!tree) throw new Error("Scope tree is not mounted.");
  return tree;
}

function logicalVisibleScopeNodeCount(): number {
  return Number(scopeTree().dataset.visibleNodeCount ?? 0);
}

function mountedScopeNodeCount(): number {
  return document.querySelectorAll('.workbench-react__scope-node[role="treeitem"]').length;
}

function mountedScopeIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.workbench-react__scope-node[role="treeitem"]'))
    .map((node) => node.dataset.scopeId)
    .filter((id): id is string => typeof id === "string");
}

function currentWorkbenchVersion(): number {
  return Number(document.querySelector<HTMLElement>(".workbench-react")?.dataset.snapshotVersion ?? -1);
}

async function waitForWorkbenchCommit(previousVersion: number): Promise<void> {
  if (currentWorkbenchVersion() > previousVersion) return;
  const shell = document.querySelector<HTMLElement>(".workbench-react");
  if (!shell) {
    await nextFrame();
    return waitForWorkbenchCommit(previousVersion);
  }
  await new Promise<void>((resolveCommit, rejectCommit) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      rejectCommit(new Error(`Workbench did not commit after version ${previousVersion}.`));
    }, 2_000);
    const observer = new MutationObserver(() => {
      if (currentWorkbenchVersion() <= previousVersion) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolveCommit();
    });
    observer.observe(shell, { attributes: true, attributeFilter: ["data-snapshot-version"] });
  });
}

async function waitForRuntimeCatchup(): Promise<void> {
  const previousVersion = runtime.getSnapshot().version;
  await nextFrame();
  if (runtime.getSnapshot().version > previousVersion) {
    await waitForWorkbenchCommit(previousVersion);
  }
  await nextFrame();
}

function nextFrame(): Promise<void> {
  return new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
}

function percentile(values: number[], rank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1)] ?? 0;
}

function maximum(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function validateConfig(config: TopologyPerformanceConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number.`);
    }
  }
}

window.addEventListener("pagehide", () => {
  reactRoot.unmount();
  runtime.dispose();
}, { once: true });
