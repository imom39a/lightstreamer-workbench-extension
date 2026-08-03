import {
  type TopologyCommandGeneration,
  type TopologyItem,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";
import { createTextElement } from "./panel-dom";

export type TopologyActionsViewOptions = {
  state: TopologyState;
  treePane: HTMLElement;
  collapsedKeys: Set<string>;
  canExpandAll(state: TopologyState): boolean;
  setExpandAllItems(value: boolean): void;
  render(): void;
  resetCurrent(): void;
  clearHistory(): void;
  createExportMenu(state: TopologyState): HTMLElement;
};

export type TopologyEvidenceViewOptions = {
  subscription: TopologySubscription;
  expandedEvidence: Set<string>;
  evidenceLimits: Map<string, number>;
  onRender(): void;
};

const EVIDENCE_INITIAL_LIMIT = 25;
const EVIDENCE_CHUNK = 25;
const TOPOLOGY_FULL_ITEM_LIMIT = 1_000;

/** Owns Topology-wide actions while the panel shell supplies state transitions. */
export function createTopologyActions(options: TopologyActionsViewOptions): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "topology-actions";

  const resetCurrent = document.createElement("button");
  resetCurrent.className = "topology-action topology-reset-current";
  resetCurrent.type = "button";
  resetCurrent.textContent = "Reset current";
  resetCurrent.title =
    "Reset current-session topology counters and timestamps without removing captured events, COMMAND state, drafts, or reinjection targets.";
  resetCurrent.disabled = options.state.clientCount === 0;
  resetCurrent.addEventListener("click", () => {
    options.resetCurrent();
    options.render();
  });

  const clearHistory = document.createElement("button");
  clearHistory.className = "topology-action topology-clear-history";
  clearHistory.type = "button";
  clearHistory.textContent = "Clear history";
  clearHistory.title =
    "Delete frozen historical topology snapshots only. Captured timeline events remain available.";
  clearHistory.disabled = options.state.historicalSessionCount === 0;
  clearHistory.addEventListener("click", () => {
    options.clearHistory();
    options.render();
  });

  const expandItems = document.createElement("button");
  expandItems.className = "topology-action topology-expand-items";
  expandItems.type = "button";
  const canExpandAll = options.canExpandAll(options.state);
  expandItems.textContent = canExpandAll ? "Expand all" : "Collapse all";
  expandItems.title = canExpandAll
    ? `Expand every branch and render item nodes across the topology (bounded at ${TOPOLOGY_FULL_ITEM_LIMIT.toLocaleString()} items per subscription; the selected subscription may show more).`
    : "Collapse every branch in the Topology tree.";
  expandItems.disabled =
    options.state.clientCount === 0 && options.state.unassignedSubscriptions.length === 0;
  expandItems.setAttribute("aria-pressed", String(!canExpandAll));
  expandItems.addEventListener("click", () => {
    if (!canExpandAll) {
      for (const toggle of options.treePane.querySelectorAll<HTMLElement>(
        "[data-topology-collapse-key]"
      )) {
        const key = toggle.dataset.topologyCollapseKey;
        if (key) options.collapsedKeys.add(key);
      }
      options.setExpandAllItems(false);
    } else {
      options.collapsedKeys.clear();
      options.setExpandAllItems(true);
    }
    options.render();
  });

  actions.append(
    resetCurrent,
    clearHistory,
    expandItems,
    options.createExportMenu(options.state)
  );
  return actions;
}

/** Keeps high-cardinality COMMAND evidence bounded while preserving copy-complete access. */
export function createTopologyCommandEvidence(
  options: TopologyEvidenceViewOptions
): HTMLDetailsElement {
  const { subscription } = options;
  const evidence = document.createElement("details");
  evidence.className = "topology-command-evidence";
  evidence.open = options.expandedEvidence.has(subscription.id);
  evidence.addEventListener("toggle", () => {
    if (evidence.open) options.expandedEvidence.add(subscription.id);
    else options.expandedEvidence.delete(subscription.id);
  });

  const total = subscription.commandGenerations.length;
  const requested = options.evidenceLimits.get(subscription.id) ?? EVIDENCE_INITIAL_LIMIT;
  const included = Math.min(total, requested);
  const summary = document.createElement("summary");
  summary.className = "topology-command-evidence-summary";
  summary.textContent = `Raw COMMAND evidence · ${included.toLocaleString()} of ${total.toLocaleString()} shown`;
  evidence.append(summary);

  const controls = document.createElement("div");
  controls.className = "topology-command-evidence-controls";
  const copy = document.createElement("button");
  copy.className = "topology-action topology-copy-command-evidence";
  copy.type = "button";
  copy.textContent = "Copy complete evidence";
  copy.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(JSON.stringify(subscription.commandGenerations, null, 2));
      copy.textContent = `Copied ${total.toLocaleString()} entries`;
    } catch (error) {
      copy.textContent = "Copy failed";
      copy.title = error instanceof Error ? error.message : "Clipboard write failed.";
    }
  });
  controls.append(copy);

  if (included < total) {
    const showMore = document.createElement("button");
    showMore.className = "topology-action topology-show-more-command-evidence";
    showMore.type = "button";
    showMore.textContent = `Show ${Math.min(EVIDENCE_CHUNK, total - included).toLocaleString()} more`;
    showMore.addEventListener("click", () => {
      options.expandedEvidence.add(subscription.id);
      options.evidenceLimits.set(subscription.id, included + EVIDENCE_CHUNK);
      options.onRender();
    });
    controls.append(showMore);
  }
  evidence.append(controls);

  const list = document.createElement("ol");
  list.className = "topology-command-evidence-list";
  for (const generation of included === 0 ? [] : subscription.commandGenerations.slice(-included)) {
    const entry = document.createElement("li");
    entry.className = "topology-command-evidence-entry";
    entry.append(
      createTextElement("code", "topology-command-evidence-identity", generation.id),
      createTextElement(
        "span",
        "topology-command-evidence-meta",
        topologyLatestGenerationSummary(generation) ?? "Generation evidence"
      )
    );
    list.append(entry);
  }
  evidence.append(list);
  return evidence;
}

export function createOpenCommandStateAction(
  subscription: TopologySubscription,
  item: TopologyItem | null,
  onOpen: (subscription: TopologySubscription, item: TopologyItem | null) => void
): HTMLElement {
  const actions = document.createElement("section");
  actions.className = "topology-detail-actions";
  const button = document.createElement("button");
  button.className = "topology-action topology-open-command-state";
  button.type = "button";
  button.textContent = item
    ? "Open item in COMMAND State"
    : "Open Subscription in COMMAND State";
  button.addEventListener("click", () => onOpen(subscription, item));
  actions.append(button);
  return actions;
}

export function topologyLatestGenerationSummary(
  generation: TopologyCommandGeneration | null
): string | null {
  if (!generation) return null;
  return [generation.command, generation.key, generation.itemId, `sequence ${generation.captureSequence.toLocaleString()}`]
    .filter(Boolean)
    .join(" · ");
}

export function topologyLatestInferredChildSummary(
  generations: readonly TopologyCommandGeneration[]
): string | null {
  const child = generations.flatMap(({ inferredChildren }) => inferredChildren).at(-1);
  return child
    ? [child.label, child.provenance, `sequence ${child.captureSequence.toLocaleString()}`]
        .filter(Boolean)
        .join(" · ")
    : null;
}
