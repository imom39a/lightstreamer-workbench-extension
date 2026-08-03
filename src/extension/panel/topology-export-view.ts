import {
  TOPOLOGY_SENSITIVE_CATEGORIES,
  serializeTopologySnapshot,
  topologySensitiveCategoryCounts,
  topologySnapshotFilename,
  type TopologySensitiveCategory,
  type TopologyStructuredSnapshot
} from "./topology-export";
import { renderTopologyHtmlReport } from "./topology-html-report";
import { type TopologyState } from "../../core/topology-state";
import { clampNumber, createTextElement } from "./panel-dom";

export type TopologyExportViewOptions = {
  root: HTMLElement;
  state: TopologyState;
  redactions: Set<TopologySensitiveCategory>;
  getCompleteEvidence(): boolean;
  setCompleteEvidence(value: boolean): void;
  retainedEventCount: number;
  createSnapshot(options: {
    retainedEventCount: number;
    completeEvidence: boolean;
    redact: Set<TopologySensitiveCategory>;
  }): TopologyStructuredSnapshot;
};

/** Owns the Topology export menu, compact placement, and download actions. */
export function createTopologyExportMenu(
  options: TopologyExportViewOptions
): HTMLDetailsElement {
  const menu = document.createElement("details");
  menu.className = "topology-export-menu";
  const summary = document.createElement("summary");
  summary.className = "topology-action topology-export-toggle";
  summary.textContent = "Export";
  menu.append(summary);

  const panel = document.createElement("div");
  panel.className = "topology-export-panel";
  panel.append(
    createTextElement(
      "p",
      "topology-export-intro",
      "Download the current Topology as JSON or HTML. No redaction is applied by default; credential-like fields are always excluded."
    )
  );

  const advanced = document.createElement("details");
  advanced.className = "topology-export-advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.className = "topology-export-advanced-toggle";
  const updateAdvancedSummary = (): void => {
    const count = options.redactions.size;
    advancedSummary.textContent = count === 0
      ? "Advanced options"
      : `Advanced options · ${count} redaction${count === 1 ? "" : "s"} selected`;
  };
  updateAdvancedSummary();
  advanced.append(advancedSummary);

  const counts = topologySensitiveCategoryCounts(options.state);
  const categories = document.createElement("fieldset");
  categories.className = "topology-export-categories";
  categories.append(
    createTextElement("legend", "topology-export-heading", "Redact sensitive categories")
  );
  for (const category of TOPOLOGY_SENSITIVE_CATEGORIES) {
    const label = document.createElement("label");
    label.className = "topology-export-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = options.redactions.has(category);
    checkbox.dataset.category = category;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        options.redactions.add(category);
      } else {
        options.redactions.delete(category);
      }
      updateAdvancedSummary();
    });
    label.append(
      checkbox,
      createTextElement(
        "span",
        "topology-export-option-label",
        `${sensitiveCategoryLabel(category)} (${counts[category].toLocaleString()})`
      )
    );
    categories.append(label);
  }

  const completeLabel = document.createElement("label");
  completeLabel.className = "topology-export-option topology-export-complete";
  const complete = document.createElement("input");
  complete.type = "checkbox";
  complete.checked = options.getCompleteEvidence();
  complete.addEventListener("change", () => {
    options.setCompleteEvidence(complete.checked);
  });
  completeLabel.append(
    complete,
    createTextElement(
      "span",
      "topology-export-option-label",
      "Include complete establishment and COMMAND generation evidence"
    )
  );

  const actions = document.createElement("div");
  actions.className = "topology-export-actions";
  const downloadJson = document.createElement("button");
  downloadJson.className = "topology-action topology-export-json";
  downloadJson.type = "button";
  downloadJson.textContent = "Download JSON";
  const downloadHtml = document.createElement("button");
  downloadHtml.className = "topology-action topology-export-html";
  downloadHtml.type = "button";
  downloadHtml.textContent = "Download HTML";
  const createExportSnapshot = (): TopologyStructuredSnapshot =>
    options.createSnapshot({
      retainedEventCount: options.retainedEventCount,
      completeEvidence: options.getCompleteEvidence(),
      redact: options.redactions
    });
  downloadJson.addEventListener("click", () => {
    const snapshot = createExportSnapshot();
    downloadTextFile(
      topologySnapshotFilename(snapshot, "json"),
      serializeTopologySnapshot(snapshot),
      "application/json"
    );
  });
  downloadHtml.addEventListener("click", () => {
    const snapshot = createExportSnapshot();
    downloadTextFile(
      topologySnapshotFilename(snapshot, "html"),
      renderTopologyHtmlReport(snapshot),
      "text/html"
    );
  });
  actions.append(downloadJson, downloadHtml);
  advanced.append(categories, completeLabel);
  panel.append(actions, advanced);
  menu.append(panel);

  menu.addEventListener("toggle", () => {
    if (!menu.open) return;
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || options.root.clientWidth || 320;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || options.root.clientHeight || 320;
    const margin = 8;
    const gap = 6;
    const availableWidth = Math.max(0, viewportWidth - margin * 2);
    const availableHeight = Math.max(0, viewportHeight - margin * 2);
    panel.style.position = "fixed";
    panel.style.maxWidth = `${availableWidth}px`;
    panel.style.maxHeight = `${availableHeight}px`;
    panel.style.left = "0px";
    panel.style.top = "0px";

    const toggleRect = summary.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(panelRect.width, availableWidth);
    const panelHeight = Math.min(panelRect.height, availableHeight);
    const left = clampNumber(
      toggleRect.right - panelWidth,
      margin,
      Math.max(margin, viewportWidth - margin - panelWidth)
    );
    const top = clampNumber(
      toggleRect.bottom + gap,
      margin,
      Math.max(margin, viewportHeight - margin - panelHeight)
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    menu.open = false;
    summary.focus();
  });

  return menu;
}

function sensitiveCategoryLabel(category: TopologySensitiveCategory): string {
  switch (category) {
    case "server-addresses": return "Server addresses and URLs";
    case "client-ips": return "Client IPs";
    case "item-names": return "Item names and groups";
    case "command-keys": return "COMMAND keys";
    case "field-names": return "Configured fields and schemas";
    case "identifiers": return "Captured identifiers";
  }
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
