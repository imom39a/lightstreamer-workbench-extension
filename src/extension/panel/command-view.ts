import { createTextElement } from "./panel-dom";
import { type CommandDiagnostic } from "../../core/command-state";

export type CommandRowSelection = {
  subscriptionId: string;
  itemId: string;
  key: string;
  status: "active" | "deleted";
};

export type CommandDiagnosticSelection = {
  subscriptionId: string;
  itemId: string;
  key: string | null;
  status: "diagnostic";
  diagnosticCode: CommandDiagnostic["code"];
  eventId: string | null;
};

export type CommandSelection = CommandRowSelection | CommandDiagnosticSelection | null;

export type CommandViewState = {
  detailOpen: boolean;
  selectedItem: { subscriptionId: string; itemId: string } | null;
  selectedKey: CommandSelection;
  selectedUpdateEventId: string | null;
  itemWindowOffset: number;
  keyWindowOffset: number;
  diagnosticWindowOffset: number;
  updateWindowOffset: number;
  updateHistoryAnchor: number;
  lifecycleExpanded: boolean;
  windowSelectionIdentity: string | null;
  windowLifecycleLength: number;
  visibleUpdateEventIds: Set<string>;
};

export function createCommandViewState(): CommandViewState {
  return {
    detailOpen: true,
    selectedItem: null,
    selectedKey: null,
    selectedUpdateEventId: null,
    itemWindowOffset: 0,
    keyWindowOffset: 0,
    diagnosticWindowOffset: 0,
    updateWindowOffset: 0,
    updateHistoryAnchor: 0,
    lifecycleExpanded: false,
    windowSelectionIdentity: null,
    windowLifecycleLength: 0,
    visibleUpdateEventIds: new Set()
  };
}

export type CommandTimestampFactory = (
  timestamp: number,
  className: string,
  display: "compact" | "precise"
) => HTMLTimeElement;

/** Focused COMMAND State presentation helpers; selection and draft state stay in the shell seam. */
export function createCommandUpdateHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "command-update-header";
  for (const heading of ["Time", "Event", "Command"]) {
    header.append(createTextElement("span", "command-update-cell command-update-header-cell", heading));
  }
  return header;
}

export function createCommandSummaryRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "command-summary-row";
  row.append(
    createTextElement("span", "command-summary-label", `${label} `),
    createTextElement("span", "command-summary-value", value)
  );
  return row;
}

export function createCommandSummaryTimeRow(
  label: string,
  timestamp: number,
  createTimestamp: CommandTimestampFactory
): HTMLElement {
  const row = document.createElement("div");
  row.className = "command-summary-row";
  row.append(
    createTextElement("span", "command-summary-label", `${label} `),
    createTimestamp(timestamp, "command-summary-value", "precise")
  );
  return row;
}
