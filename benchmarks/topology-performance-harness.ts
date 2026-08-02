import { renderPanel } from "../src/extension/panel/main";
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
  logicalUpdateCount: number;
  deliveryCount: number;
  visibleNodeCount: number;
  uiLagMs: number;
};

type TopologyPerformanceResult = {
  config: TopologyPerformanceConfig;
  expected: {
    logicalUpdates: number;
    callbackDeliveries: number;
  };
  actual: {
    logicalUpdates: number;
    callbackDeliveries: number;
  };
  backlogMs: number;
  maxUiLagMs: number;
  p95RenderMs: {
    collapsed: number;
    expanded: number;
  };
  maxInteractionMs: number;
  longTasksOver50Ms: number;
  maxLongTaskMs: number;
  visibleNodes: {
    collapsed: number;
    expanded: number;
  };
};

declare global {
  interface Window {
    __LSEW_TOPOLOGY_PERFORMANCE__?: {
      run(config?: Partial<TopologyPerformanceConfig>): Promise<TopologyPerformanceResult>;
    };
    __LSEW_TOPOLOGY_RENDER_SAMPLE__?: (sample: Omit<RenderSample, "phase" | "uiLagMs">) => void;
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Topology performance harness requires #app.");
}

const panel = renderPanel(root);

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
    const expectedDeliveries =
      expectedLogicalUpdates * config.listenersPerSubscription;
    const samples: RenderSample[] = [];
    const interactionDurations: number[] = [];
    const longTasks: number[] = [];
    let phase: RenderSample["phase"] = "collapsed";
    let startedAt = 0;
    let latestSample:
      | Omit<RenderSample, "phase" | "uiLagMs">
      | null = null;

    const longTaskObserver =
      PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries()) {
              if (entry.duration > 50) {
                longTasks.push(entry.duration);
              }
            }
          })
        : null;

    window.__LSEW_TOPOLOGY_RENDER_SAMPLE__ = (sample) => {
      latestSample = sample;
      const scheduledAt =
        startedAt +
        (sample.logicalUpdateCount / config.logicalUpdatesPerSecond) * 1_000;
      samples.push({
        ...sample,
        phase,
        uiLagMs:
          startedAt === 0
            ? 0
            : Math.max(0, performance.now() - scheduledAt)
      });
    };

    appendTopology(config);
    await nextAnimationFrame();
    longTaskObserver?.observe({ entryTypes: ["longtask"] });
    const collapsedNodes =
      document.querySelectorAll(".topology-node").length;
    interactionDurations.push(measureInteraction(() => {
      document
        .querySelector<HTMLButtonElement>(".topology-mask-sensitive")
        ?.click();
    }));

    startedAt = performance.now();
    let emittedLogicalUpdates = 0;
    let expandedNodes = collapsedNodes;
    let expanded = false;
    let selectedExpandedItem = false;

    await new Promise<void>((resolve) => {
      const pump = (now: number) => {
        const elapsed = Math.min(config.durationMs, now - startedAt);
        if (!expanded && elapsed >= config.durationMs / 2) {
          expanded = true;
          phase = "expanded";
          interactionDurations.push(
            measureInteraction(() => {
              document
                .querySelector<HTMLButtonElement>(
                  ".topology-expand-items"
                )
                ?.click();
            })
          );
          expandedNodes =
            document.querySelectorAll(".topology-node").length;
          requestAnimationFrame(pump);
          return;
        }
        if (expanded && !selectedExpandedItem) {
          if (
            document
              .querySelector<HTMLElement>(".topology-tree-pane")
              ?.getAttribute("aria-busy") === "true"
          ) {
            requestAnimationFrame(pump);
            return;
          }
          selectedExpandedItem = true;
          const itemNode = firstTopologyItemNode();
          if (!itemNode) {
            throw new Error(
              "Expanded topology did not expose an item node."
            );
          }
          interactionDurations.push(
            measureInteraction(() => itemNode.click())
          );
          expandedNodes =
            document.querySelectorAll(".topology-node").length;
          requestAnimationFrame(pump);
          return;
        }

        const target = Math.min(
          expectedLogicalUpdates,
          Math.floor(
            (elapsed * config.logicalUpdatesPerSecond) / 1_000
          )
        );
        while (emittedLogicalUpdates < target) {
          emittedLogicalUpdates += 1;
          appendLogicalUpdate(config, emittedLogicalUpdates);
        }

        if (emittedLogicalUpdates >= expectedLogicalUpdates) {
          resolve();
          return;
        }
        requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    });

    const emissionFinishedAt = performance.now();
    await waitForTopologyCatchUp(
      () => latestSample,
      expectedLogicalUpdates,
      expectedDeliveries,
      2_000
    );
    const caughtUpAt = performance.now();
    await nextAnimationFrame();
    for (const entry of longTaskObserver?.takeRecords() ?? []) {
      if (entry.duration > 50) {
        longTasks.push(entry.duration);
      }
    }
    longTaskObserver?.disconnect();
    delete window.__LSEW_TOPOLOGY_RENDER_SAMPLE__;

    const collapsedSamples = samples.filter(
      (sample) => sample.phase === "collapsed"
    );
    const expandedSamples = samples.filter(
      (sample) => sample.phase === "expanded"
    );
    return {
      config,
      expected: {
        logicalUpdates: expectedLogicalUpdates,
        callbackDeliveries: expectedDeliveries
      },
      actual: {
        logicalUpdates: latestSample?.logicalUpdateCount ?? 0,
        callbackDeliveries: latestSample?.deliveryCount ?? 0
      },
      backlogMs: caughtUpAt - emissionFinishedAt,
      maxUiLagMs: maximum(samples.map((sample) => sample.uiLagMs)),
      p95RenderMs: {
        collapsed: percentile(
          collapsedSamples.map((sample) => sample.durationMs),
          0.95
        ),
        expanded: percentile(
          expandedSamples.map((sample) => sample.durationMs),
          0.95
        )
      },
      maxInteractionMs: maximum(interactionDurations),
      longTasksOver50Ms: longTasks.length,
      maxLongTaskMs: maximum(longTasks),
      visibleNodes: {
        collapsed: collapsedNodes,
        expanded: expandedNodes
      }
    };
  }
};

function appendTopology(config: TopologyPerformanceConfig): void {
  for (const message of createTopologyPerformanceCaptureMessages(config)) {
    panel.appendCaptureMessage(message);
  }
  clickView("Topology");
}

function appendLogicalUpdate(
  config: TopologyPerformanceConfig,
  logicalIndex: number
): void {
  for (const message of createTopologyPerformanceLogicalUpdateMessages(config, logicalIndex)) {
    panel.appendCaptureMessage(message);
  }
}

function clickView(label: string): void {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".view-selector button")
  ).find((candidate) => candidate.textContent === label);
  if (!button) {
    throw new Error(`Missing ${label} view.`);
  }
  button.click();
}

function firstTopologyItemNode(): HTMLButtonElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(".topology-node")
    ).find(
      (candidate) =>
        candidate.querySelector(".topology-node-kind")?.textContent === "ITEM"
    ) ?? null
  );
}

function measureInteraction(action: () => void): number {
  const startedAt = performance.now();
  action();
  return performance.now() - startedAt;
}

async function waitForTopologyCatchUp(
  sample: () => Omit<RenderSample, "phase" | "uiLagMs"> | null,
  expectedLogicalUpdates: number,
  expectedDeliveries: number,
  timeoutMs: number
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const current = sample();
    if (
      current?.logicalUpdateCount === expectedLogicalUpdates &&
      current.deliveryCount === expectedDeliveries
    ) {
      return;
    }
    await nextAnimationFrame();
  }
  throw new Error(
    `Topology did not catch up: ${JSON.stringify(sample())}`
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(values: number[], rank: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1)
  ];
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
