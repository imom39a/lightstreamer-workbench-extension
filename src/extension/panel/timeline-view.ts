import { createTextElement } from "./panel-dom";

export type TimelineCodeFamily = "tlcp" | "workbench";

export type TimelineViewMode = "live" | "frozen";

export type TimelineViewState = {
  events: readonly import("../../core/event-envelope").LightstreamerEventEnvelope[];
  reconciledEvents: readonly import("../../core/event-envelope").LightstreamerEventEnvelope[];
  reconciledTotal: number;
  liveTail: import("../../core/event-envelope").LightstreamerEventEnvelope[];
  pendingCommitVisibility: Map<string, boolean>;
  queryVersion: number;
  latestQueryGeneration: number;
  latestQueryInFlight: boolean;
  latestQueryDirty: boolean;
  detailOpen: boolean;
  detailWidth: number;
  windowOffset: number;
  historyAnchor: number;
  viewMode: TimelineViewMode;
  newerEventCount: number;
  followLatest: boolean;
  visibleTotal: number;
  lastScrollTop: number;
  scrollNavigationPending: "older" | "newer" | null;
  selectionNeedsFilterReconciliation: boolean;
};

export function createTimelineViewState(defaultDetailWidth: number): TimelineViewState {
  return {
    events: [],
    reconciledEvents: [],
    reconciledTotal: 0,
    liveTail: [],
    pendingCommitVisibility: new Map(),
    queryVersion: 0,
    latestQueryGeneration: 0,
    latestQueryInFlight: false,
    latestQueryDirty: false,
    detailOpen: false,
    detailWidth: defaultDetailWidth,
    windowOffset: 0,
    historyAnchor: 0,
    viewMode: "live",
    newerEventCount: 0,
    followLatest: true,
    visibleTotal: 0,
    lastScrollTop: 0,
    scrollNavigationPending: null,
    selectionNeedsFilterReconciliation: false
  };
}

export type TimelineCodeDefinition = {
  code: string;
  label: string;
  description: string;
  family: TimelineCodeFamily;
};

/** Timeline presentation seam shared by the panel and browser scenarios. */
export function createTimelineCodeLegend(
  definitions: readonly TimelineCodeDefinition[]
): HTMLDetailsElement {
  const legend = document.createElement("details");
  legend.className = "timeline-code-legend";
  const summary = document.createElement("summary");
  summary.className = "timeline-code-legend-toggle";
  summary.textContent = "Codes";
  summary.setAttribute("aria-label", "Timeline code legend");

  const popover = document.createElement("div");
  popover.className = "timeline-code-legend-popover";
  popover.append(
    createTextElement(
      "p",
      "timeline-code-legend-intro",
      "Protocol tags stay aligned with Lightstreamer TLCP. Local capture lifecycle events use compact codes."
    )
  );

  for (const [family, heading] of [
    ["tlcp", "Lightstreamer TLCP"],
    ["workbench", "Local capture lifecycle"]
  ] as const) {
    const group = document.createElement("section");
    group.className = "timeline-code-legend-group";
    group.dataset.family = family;
    group.append(createTextElement("h3", "timeline-code-legend-heading", heading));
    const list = document.createElement("dl");
    list.className = "timeline-code-legend-list";
    for (const definition of definitions.filter((candidate) => candidate.family === family)) {
      list.append(
        createTextElement("dt", `timeline-legend-code code-${family}`, definition.code),
        createTextElement(
          "dd",
          "timeline-code-legend-description",
          `${definition.label} — ${definition.description}`
        )
      );
    }
    group.append(list);
    popover.append(group);
  }

  legend.append(summary, popover);
  return legend;
}

export function createTimelineHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "event-header";
  for (const heading of ["Time", "Code", "Item", "Command / Key", "Source"]) {
    header.append(createTextElement("span", "event-cell event-header-cell", heading));
  }
  return header;
}

export function createWindowNavigationButton(
  label: string,
  enabled: boolean,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "window-navigation-button";
  button.type = "button";
  button.textContent = label;
  button.dataset.windowAction = label.toLowerCase();
  button.disabled = !enabled;
  button.addEventListener("click", onClick);
  return button;
}
