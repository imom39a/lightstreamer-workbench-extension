import "./panel.css";

import {
  type CaptureKind,
  type CaptureMessage,
  type CaptureStatus,
  type ReinjectionResult
} from "../../bridge/messages";
import { createEventNormalizer, type EventNormalizer } from "../../core/event-normalizer";
import { createEventStore, type EventStore } from "../../core/event-store";
import { type LightstreamerEventEnvelope } from "../../core/event-envelope";
import {
  filterEvents,
  hasActiveFilters,
  type EventFilterState
} from "../../core/event-filter";
import {
  reduceCommandState,
  type CommandDiagnostic,
  type CommandItemGroup,
  type CommandLifecycleEntry,
  type CommandProvenance,
  type CommandRow,
  type CommandState,
  type CommandSubscriptionGroup,
  type DeletedCommandKey
} from "../../core/command-state";
import {
  createDraftFromEvent,
  createNewCommandDraftFromContext,
  deriveChangedFields,
  updateDraftCommand,
  updateDraftField,
  updateDraftKey,
  updateDraftSnapshot,
  validateEditableDraft,
  validateNewCommandDraft,
  validateReinjectionDraft,
  type CommandItemContext,
  type DraftFieldValue,
  type DraftFields,
  type NewCommandDraftDiagnostic,
  type ReinjectionDraft
} from "../../core/reinjection-draft";
import { createSyntheticEventFromDraft } from "../../core/synthetic-event";
import { connectPanelBridge, type PanelBridgeConnection } from "./bridge-client";

type PanelState = {
  status: CaptureStatus;
};

export type PanelController = {
  setStatus(status: CaptureStatus): void;
  appendCaptureMessage(message: CaptureMessage): void;
  clearEvents(): void;
  setBridge(bridge: PanelReinjectBridge): void;
};

export type RenderPanelOptions = {
  store?: EventStore;
  normalizer?: EventNormalizer;
  bridge?: PanelReinjectBridge;
};

type PanelReinjectBridge = Pick<PanelBridgeConnection, "reinjectDraft">;
type ReinjectionMessage = {
  kind: "success" | "error";
  text: string;
  detail?: string;
};
type DraftJsonParseResult = {
  draft: ReinjectionDraft | null;
  error: string | null;
};
type ActiveView = "timeline" | "command";
type CommandRowSelection = {
  subscriptionId: string;
  itemId: string;
  key: string;
  status: "active" | "deleted";
};
type CommandDiagnosticSelection = {
  subscriptionId: string;
  itemId: string;
  key: string | null;
  status: "diagnostic";
  diagnosticCode: CommandDiagnostic["code"];
  eventId: string | null;
};
type CommandSelection = CommandRowSelection | CommandDiagnosticSelection | null;
type CommandFilterState = {
  query?: string;
  subscription?: string;
  item?: string;
  key?: string;
  command?: string;
  source?: string;
  snapshot?: string;
  synthetic?: string;
  diagnostics?: string;
};
type CommandDetailTarget =
  | { kind: "active"; row: CommandRow; item: CommandItemGroup }
  | { kind: "deleted"; row: DeletedCommandKey; item: CommandItemGroup }
  | { kind: "diagnostic"; diagnostic: CommandDiagnostic; item: CommandItemGroup };

const initialState: PanelState = {
  status: "idle"
};

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createHelpIcon(label: string, help: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "command-help-icon";
  button.type = "button";
  button.setAttribute("aria-label", `${label}: ${help}`);
  button.title = help;
  button.textContent = "i";
  return button;
}

function createHelpHeading<K extends "h2" | "h3" | "h4">(
  tagName: K,
  className: string,
  title: string,
  help: string
): HTMLElementTagNameMap[K] {
  const heading = document.createElement(tagName);
  heading.className = className;
  heading.append(createTextElement("span", "command-heading-title", title), createHelpIcon(title, help));
  return heading;
}

function createPaneHelp(text: string): HTMLParagraphElement {
  return createTextElement("p", "command-pane-help", text);
}

function createCommandHeaderCell(heading: string): HTMLSpanElement {
  const helpByHeading: Record<string, string> = {
    Origin: "The event that created this active COMMAND key.",
    Latest: "The newest event that affected this key.",
    Updates: "How many captured or synthetic events are in this key lifecycle.",
    Diagnostics: "Reducer warnings or blocking issues found in this key lifecycle."
  };
  const cell = createTextElement("span", "command-current-cell", heading);
  const help = helpByHeading[heading];
  if (help) {
    cell.classList.add("command-current-cell-with-help");
    cell.append(createHelpIcon(heading, help));
  }
  return cell;
}

export function renderPanel(
  root: HTMLElement,
  state: PanelState = initialState,
  options: RenderPanelOptions = {}
): PanelController {
  const panelState = { ...state };
  const store = options.store ?? createEventStore();
  const normalizer = options.normalizer ?? createEventNormalizer();
  let selectedEventId: string | null = null;
  let selectedPinned = false;
  let allEvents: readonly LightstreamerEventEnvelope[] = [];
  let draft: ReinjectionDraft | null = null;
  let bridge = options.bridge ?? null;
  let reinjectionPending = false;
  let reinjectionMessage: ReinjectionMessage | null = null;
  let activeView: ActiveView = "timeline";
  let selectedCommandItem: { subscriptionId: string; itemId: string } | null = null;
  let selectedCommandKey: CommandSelection = null;
  const filterState: EventFilterState = {};
  const commandFilterState: CommandFilterState = {};

  root.replaceChildren();
  root.className = "workbench-shell";

  const toolbar = document.createElement("header");
  toolbar.className = "toolbar";

  const title = createTextElement("h1", "product-label", "Lightstreamer Event Workbench");

  const toolbarMeta = document.createElement("div");
  toolbarMeta.className = "toolbar-meta";

  const status = createTextElement("span", "status-badge", panelState.status);
  status.dataset.status = panelState.status;

  const eventCount = createTextElement("span", "event-count", "0");
  eventCount.setAttribute("aria-label", "0 captured events");

  const filteredCount = createTextElement("span", "filtered-count", "");
  filteredCount.hidden = true;

  const clearButton = document.createElement("button");
  clearButton.className = "clear-button";
  clearButton.type = "button";
  clearButton.textContent = "Clear events";
  clearButton.title = "Clear events: remove captured events from this DevTools session only.";
  clearButton.addEventListener("click", () => {
    controller.clearEvents();
  });

  toolbarMeta.append(status, eventCount, filteredCount, clearButton);
  toolbar.append(title, toolbarMeta);

  const viewSelector = document.createElement("nav");
  viewSelector.className = "view-selector";
  viewSelector.setAttribute("aria-label", "Workbench view");

  const timelineViewButton = createViewButton("Timeline", "timeline");
  const commandViewButton = createViewButton("COMMAND State", "command");
  viewSelector.append(timelineViewButton, commandViewButton);

  const filterStrip = document.createElement("section");
  filterStrip.className = "filter-strip";
  filterStrip.setAttribute("aria-label", "Event search and filters");

  const searchInput = createFilterInput(
    "Search captured events",
    "search-input",
    "Search events, fields, ids, command, key, or JSON"
  );
  searchInput.type = "search";
  searchInput.addEventListener("input", () => {
    setFilter("query", searchInput.value);
  });

  const modeInput = createFilterInput("Mode", "filter-mode", "Mode");
  modeInput.addEventListener("input", () => setFilter("mode", modeInput.value));

  const itemInput = createFilterInput("Item", "filter-item", "Item");
  itemInput.addEventListener("input", () => setFilter("item", itemInput.value));

  const keyInput = createFilterInput("Key", "filter-key", "Key");
  keyInput.addEventListener("input", () => setFilter("key", keyInput.value));

  const commandInput = createFilterInput("Command", "filter-command", "Command");
  commandInput.addEventListener("input", () => setFilter("command", commandInput.value));

  const snapshotSelect = createFilterSelect("Snapshot", "filter-snapshot", [
    ["", "Snapshot"],
    ["true", "Snapshot"],
    ["false", "Live"]
  ]);
  snapshotSelect.addEventListener("change", () => {
    setFilter("snapshot", parseBooleanFilter(snapshotSelect.value));
  });

  const syntheticSelect = createFilterSelect("Synthetic", "filter-synthetic", [
    ["", "Synthetic"],
    ["false", "Server"],
    ["true", "Synthetic"]
  ]);
  syntheticSelect.addEventListener("change", () => {
    setFilter("synthetic", parseBooleanFilter(syntheticSelect.value));
  });

  const kindInput = createFilterInput("Kind", "filter-kind", "Kind");
  kindInput.addEventListener("input", () => {
    setFilter("kind", kindInput.value as CaptureKind | "");
  });

  filterStrip.append(
    searchInput,
    modeInput,
    itemInput,
    keyInput,
    commandInput,
    snapshotSelect,
    syntheticSelect,
    kindInput
  );

  const commandFilterStrip = document.createElement("section");
  commandFilterStrip.className = "command-filter-strip";
  commandFilterStrip.setAttribute("aria-label", "COMMAND state filters");

  const commandSearchInput = createFilterInput(
    "COMMAND State search",
    "command-search",
    "Search COMMAND state, fields, diagnostics, event ids, or JSON"
  );
  commandSearchInput.type = "search";
  commandSearchInput.addEventListener("input", () => {
    setCommandFilter("query", commandSearchInput.value);
  });

  const commandSubscriptionInput = createFilterInput(
    "Subscription",
    "command-filter-subscription",
    "Subscription"
  );
  commandSubscriptionInput.addEventListener("input", () => {
    setCommandFilter("subscription", commandSubscriptionInput.value);
  });

  const commandItemInput = createFilterInput("Item", "command-filter-item", "Item");
  commandItemInput.addEventListener("input", () => {
    setCommandFilter("item", commandItemInput.value);
  });

  const commandKeyInput = createFilterInput("Key", "command-filter-key", "Key");
  commandKeyInput.addEventListener("input", () => {
    setCommandFilter("key", commandKeyInput.value);
  });

  const commandCommandInput = createFilterInput("Command", "command-filter-command", "Command");
  commandCommandInput.addEventListener("input", () => {
    setCommandFilter("command", commandCommandInput.value);
  });

  const commandSourceInput = createFilterInput("Source", "command-filter-source", "Source");
  commandSourceInput.addEventListener("input", () => {
    setCommandFilter("source", commandSourceInput.value);
  });

  const commandSnapshotSelect = createFilterSelect("Snapshot", "command-filter-snapshot", [
    ["", "Snapshot"],
    ["snapshot", "Snapshot"],
    ["live", "Live"]
  ]);
  commandSnapshotSelect.addEventListener("change", () => {
    setCommandFilter("snapshot", commandSnapshotSelect.value);
  });

  const commandSyntheticSelect = createFilterSelect("Synthetic", "command-filter-synthetic", [
    ["", "Synthetic"],
    ["server", "Server"],
    ["synthetic", "Synthetic"]
  ]);
  commandSyntheticSelect.addEventListener("change", () => {
    setCommandFilter("synthetic", commandSyntheticSelect.value);
  });

  const commandDiagnosticsInput = createFilterInput(
    "Diagnostics",
    "command-filter-diagnostics",
    "Diagnostics"
  );
  commandDiagnosticsInput.addEventListener("input", () => {
    setCommandFilter("diagnostics", commandDiagnosticsInput.value);
  });

  commandFilterStrip.append(
    commandSearchInput,
    commandSubscriptionInput,
    commandItemInput,
    commandKeyInput,
    commandCommandInput,
    commandSourceInput,
    commandSnapshotSelect,
    commandSyntheticSelect,
    commandDiagnosticsInput
  );

  const workspace = document.createElement("section");
  workspace.className = "workspace";

  const feed = document.createElement("section");
  feed.className = "event-feed";
  feed.setAttribute("aria-label", "Captured Lightstreamer events");

  const detail = document.createElement("aside");
  detail.className = "detail-pane";
  detail.setAttribute("aria-label", "Selected event detail");

  workspace.append(feed, detail);

  const commandWorkspace = document.createElement("section");
  commandWorkspace.className = "command-workspace";
  commandWorkspace.setAttribute("aria-label", "COMMAND state workbench");

  const commandGroupPane = document.createElement("section");
  commandGroupPane.className = "command-group-pane";
  commandGroupPane.setAttribute("aria-label", "COMMAND subscription and item groups");

  const commandCurrentTable = document.createElement("section");
  commandCurrentTable.className = "command-current-table";
  commandCurrentTable.setAttribute("aria-label", "COMMAND active current rows");

  const commandDetailPane = document.createElement("aside");
  commandDetailPane.className = "command-detail-pane";
  commandDetailPane.setAttribute("aria-label", "COMMAND selected key detail");

  commandWorkspace.append(commandGroupPane, commandCurrentTable, commandDetailPane);
  root.append(toolbar, viewSelector, filterStrip, commandFilterStrip, workspace, commandWorkspace);
  updateActiveViewChrome();

  function setFilter<K extends keyof EventFilterState>(
    key: K,
    value: EventFilterState[K] | ""
  ): void {
    if (value === "" || value === undefined) {
      delete filterState[key];
    } else {
      filterState[key] = value as EventFilterState[K];
    }
    renderFeed(allEvents);
  }

  function setCommandFilter<K extends keyof CommandFilterState>(
    key: K,
    value: CommandFilterState[K] | ""
  ): void {
    if (value === "" || value === undefined) {
      delete commandFilterState[key];
    } else {
      commandFilterState[key] = value;
    }
    renderCommandState(allEvents);
  }

  function createViewButton(label: string, view: ActiveView): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      activeView = view;
      updateActiveViewChrome();
      renderActiveView();
    });
    return button;
  }

  function updateActiveViewChrome(): void {
    timelineViewButton.dataset.active = String(activeView === "timeline");
    commandViewButton.dataset.active = String(activeView === "command");
    timelineViewButton.setAttribute("aria-current", activeView === "timeline" ? "page" : "false");
    commandViewButton.setAttribute("aria-current", activeView === "command" ? "page" : "false");
    filterStrip.hidden = activeView !== "timeline";
    workspace.hidden = activeView !== "timeline";
    commandFilterStrip.hidden = activeView !== "command";
    commandWorkspace.hidden = activeView !== "command";
  }

  function renderActiveView(): void {
    if (activeView === "command") {
      renderCommandState(allEvents);
      return;
    }
    renderFeed(allEvents);
  }

  function renderEmptyState(): void {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.append(
      createTextElement("h2", "empty-heading", "Waiting for Lightstreamer activity"),
      createTextElement(
        "p",
        "empty-body",
        "Open the fixture page or refresh the inspected app. Captured clients, subscriptions, and item updates will appear here."
      )
    );
    feed.replaceChildren(emptyState);
  }

  function renderFilteredEmptyState(): void {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.append(
      createTextElement("h2", "empty-heading", "No matching events"),
      createTextElement(
        "p",
        "empty-body",
        "No events match the active search and filters. Clear filters or broaden the search query."
      )
    );
    feed.replaceChildren(emptyState);
  }

  function renderFeed(events: readonly LightstreamerEventEnvelope[]): void {
    const filtersActive = hasActiveFilters(filterState);
    const visibleEvents = filterEvents(events, filterState);

    filteredCount.hidden = !filtersActive;
    filteredCount.textContent = filtersActive ? `${visibleEvents.length} shown` : "";
    filteredCount.setAttribute("aria-label", `${visibleEvents.length} events shown`);

    if (events.length === 0) {
      selectedEventId = null;
      selectedPinned = false;
      clearDraftForSelection(null);
      renderEmptyState();
      renderDetail(null);
      return;
    }

    if (visibleEvents.length === 0) {
      selectedEventId = null;
      clearDraftForSelection(null);
      renderFilteredEmptyState();
      renderDetail(null);
      return;
    }

    const selectedStillVisible = visibleEvents.some((event) => event.id === selectedEventId);
    if (!selectedPinned || !selectedStillVisible) {
      selectedEventId = visibleEvents[visibleEvents.length - 1]?.id ?? null;
    }
    clearDraftForSelection(selectedEventId);

    const list = document.createElement("div");
    list.className = "event-list";
    list.setAttribute("role", "list");

    for (const event of visibleEvents) {
      const row = document.createElement("button");
      row.className = "event-row";
      row.type = "button";
      row.dataset.selected = String(event.id === selectedEventId);
      row.dataset.synthetic = String(event.synthetic || event.source === "synthetic");
      row.addEventListener("click", () => {
        selectedEventId = event.id;
        selectedPinned = true;
        clearDraftForSelection(event.id);
        renderFeed(allEvents);
        renderDetail(event);
      });

      row.append(
        createTextElement("span", "event-cell event-time", formatTime(event.timestamp)),
        createTextElement("span", "event-cell event-kind", event.kind),
        createTextElement("span", "event-cell event-client", event.client?.id ?? "-"),
        createTextElement("span", "event-cell event-subscription", event.subscription?.id ?? "-"),
        createTextElement("span", "event-cell event-mode", event.subscription?.mode ?? "-"),
        createTextElement("span", "event-cell event-item", event.item?.name ?? "-"),
        createTextElement("span", "event-cell event-command", formatCommandKey(event)),
        createTextElement("span", "event-cell event-marker", formatMarker(event))
      );

      list.append(row);
    }

    feed.replaceChildren(list);
    renderDetail(visibleEvents.find((event) => event.id === selectedEventId) ?? null);
  }

  function renderDetail(event: LightstreamerEventEnvelope | null): void {
    detail.replaceChildren();
    detail.append(createTextElement("h2", "detail-heading", "Envelope"));

    if (!event) {
      detail.append(
        createTextElement("p", "detail-placeholder", "Select an event to inspect its envelope.")
      );
      return;
    }

    appendDetailSection(detail, "Envelope", {
      id: event.id,
      timestamp: event.timestamp,
      direction: event.direction,
      source: event.source,
      captureSource: event.captureSource ?? "listener",
      synthetic: event.synthetic,
      kind: event.kind
    });
    appendDetailSection(detail, "Subscription", event.subscription);
    appendDetailSection(detail, "Listener", event.listener);
    appendDetailSection(detail, "Item", event.item);
    appendDetailSection(detail, "Update", event.update);
    appendDetailSection(detail, "Fields", event.update?.fields);
    appendDetailSection(detail, "Changed Fields", event.update?.changedFields);
    appendDetailSection(detail, "Synthetic Provenance", createSyntheticProvenance(event));
    appendDetailSection(detail, "Raw Diagnostics", event.raw);
    appendDraftSection(detail, event, draft?.sourceEventId === event.id ? draft : null);
  }

  function renderCommandState(events: readonly LightstreamerEventEnvelope[]): void {
    const commandState = reduceCommandState(events);
    const items = flattenCommandItems(commandState);

    if (items.length === 0) {
      selectedCommandItem = null;
      selectedCommandKey = null;
      renderCommandEmptyState();
      return;
    }

    selectedCommandItem = validCommandItemSelection(items, selectedCommandItem) ?? {
      subscriptionId: items[0].subscription.subscriptionId,
      itemId: items[0].item.itemId
    };

    const selected = findSelectedCommandItem(items, selectedCommandItem) ?? items[0];
    renderCommandGroups(items, selected);
    renderCommandRowsAndResults(selected.item);
    renderCommandDetail(selected.subscription, selected.item, commandState);
  }

  function renderCommandEmptyState(): void {
    commandGroupPane.replaceChildren(
      createTextElement("h2", "command-pane-heading", "No COMMAND state yet"),
      createTextElement(
        "p",
        "command-empty-body",
        "Capture a COMMAND subscription or select a captured COMMAND item update. ADD snapshot and live updates will populate current rows."
      )
    );
    commandCurrentTable.replaceChildren(
      createTextElement("p", "command-empty-body", "Select a COMMAND subscription and item to inspect active keys.")
    );
    commandDetailPane.replaceChildren(
      createTextElement(
        "p",
        "command-empty-body",
        "Select an active key or matching result to inspect the events for that key only."
      )
    );
  }

  function renderCommandGroups(
    items: Array<{ subscription: CommandSubscriptionGroup; item: CommandItemGroup }>,
    selected: { subscription: CommandSubscriptionGroup; item: CommandItemGroup }
  ): void {
    commandGroupPane.replaceChildren(
      createHelpHeading(
        "h2",
        "command-pane-heading",
        "COMMAND groups",
        "Choose the COMMAND subscription and item that define the active-key table."
      ),
      createPaneHelp("Choose a subscription and item. The middle pane then shows active keys for that item.")
    );

    let currentSubscriptionId = "";
    for (const entry of items) {
      if (entry.subscription.subscriptionId !== currentSubscriptionId) {
        currentSubscriptionId = entry.subscription.subscriptionId;
        const subscriptionSummary = createTextElement(
          "div",
          "command-subscription-summary",
          `${entry.subscription.subscriptionId} ${entry.subscription.mode ?? "-"} ${entry.subscription.items.length} items ${countActiveRows(entry.subscription)} active ${countDeletedKeys(entry.subscription)} deleted`
        );
        commandGroupPane.append(subscriptionSummary);
      }

      const itemButton = document.createElement("button");
      itemButton.className = "command-item-button";
      itemButton.type = "button";
      itemButton.dataset.selected = String(
        selected.subscription.subscriptionId === entry.subscription.subscriptionId &&
          selected.item.itemId === entry.item.itemId
      );
      itemButton.addEventListener("click", () => {
        selectedCommandItem = {
          subscriptionId: entry.subscription.subscriptionId,
          itemId: entry.item.itemId
        };
        selectedCommandKey = null;
        renderCommandState(allEvents);
      });
      itemButton.append(
        createTextElement("span", "command-item-title", commandItemLabel(entry.item)),
        createTextElement(
          "span",
          "command-item-meta",
          `${entry.item.activeRows.length} active ${entry.item.deletedKeys.length} deleted ${latestItemSource(entry.item)}`
        )
      );
      commandGroupPane.append(itemButton);
    }
  }

  function renderCommandRowsAndResults(item: CommandItemGroup): void {
    const matchingRows = item.activeRows.filter((row) =>
      matchesCommandRow(row, item, commandFilterState)
    );
    const matchingDeleted = item.deletedKeys.filter((row) =>
      matchesDeletedCommandKey(row, item, commandFilterState)
    );
    const matchingDiagnostics = item.diagnostics.filter((diagnostic) =>
      matchesCommandDiagnostic(diagnostic, item, commandFilterState)
    );

    selectedCommandKey = reconcileCommandSelection(
      item,
      selectedCommandKey,
      matchingRows,
      matchingDeleted,
      matchingDiagnostics
    );

    const header = document.createElement("div");
    header.className = "command-current-header";
    for (const heading of ["Key", "Origin", "Latest", "Command", "Fields", "Updates", "Last seen", "Diagnostics"]) {
      header.append(createCommandHeaderCell(heading));
    }

    const rows = document.createElement("div");
    rows.className = "command-current-rows";
    for (const row of matchingRows) {
      const button = document.createElement("button");
      button.className = "command-current-row";
      button.type = "button";
      button.dataset.selected = String(commandSelectionMatchesRow(selectedCommandKey, row));
      button.addEventListener("click", () => {
        selectedCommandKey = commandSelectionForRow(row);
        renderCommandState(allEvents);
      });
      button.append(
        createTextElement("span", "command-current-cell command-key-cell", row.key),
        createTextElement("span", "command-current-cell command-origin-cell", provenanceLabel(row.origin)),
        createTextElement("span", "command-current-cell command-latest-cell", latestRowLabel(row)),
        createTextElement("span", "command-current-cell", latestLifecycleCommand(row.lifecycle)),
        createTextElement("span", "command-current-cell", fieldSummary(row.fields, latestLifecycle(row)?.changedFields)),
        createTextElement("span", "command-current-cell", String(row.lifecycle.length)),
        createTextElement("span", "command-current-cell", formatTime(row.latest.timestamp)),
        createTextElement("span", "command-current-cell", rowDiagnosticsLabel(row.lifecycle))
      );
      rows.append(button);
    }

    const results = document.createElement("section");
    results.className = "command-lifecycle-results";
    const matchCount = matchingRows.length + matchingDeleted.length + matchingDiagnostics.length;
    results.append(
      createHelpHeading(
        "h3",
        "command-results-heading",
        "Matching keys, deleted keys, and diagnostics",
        "Search and filter hits across active keys, deleted keys, and diagnostic events."
      ),
      createPaneHelp(`${matchCount} matches across active keys, deleted keys, and diagnostics for this item.`)
    );

    for (const row of matchingRows) {
      const result = createCommandResultButton(`${row.key} active ${lifecycleSearchSummary(row.lifecycle)}`);
      result.dataset.selected = String(commandSelectionMatchesRow(selectedCommandKey, row));
      result.addEventListener("click", () => {
        selectedCommandKey = commandSelectionForRow(row);
        renderCommandState(allEvents);
      });
      results.append(result);
    }

    for (const row of matchingDeleted) {
      const result = createCommandResultButton(`${row.key} deleted ${lifecycleSearchSummary(row.lifecycle)}`);
      result.dataset.selected = String(commandSelectionMatchesDeleted(selectedCommandKey, row));
      result.addEventListener("click", () => {
        selectedCommandKey = commandSelectionForDeleted(row);
        renderCommandState(allEvents);
      });
      results.append(result);
    }

    for (const diagnostic of matchingDiagnostics) {
      const result = createCommandResultButton(
        `${diagnostic.key ?? "unknown"} diagnostic ${diagnostic.code} ${diagnostic.eventId ?? ""} ${diagnostic.explanation}`
      );
      result.dataset.selected = String(
        commandSelectionMatchesDiagnostic(selectedCommandKey, item, diagnostic)
      );
      result.addEventListener("click", () => {
        selectedCommandKey = commandSelectionForDiagnostic(item, diagnostic);
        renderCommandState(allEvents);
      });
      results.append(result);
    }

    const emptyRows =
      matchingRows.length === 0
        ? createTextElement(
            "p",
            "command-empty-body",
            "No active keys for this item. Deleted keys remain available in lifecycle search."
          )
        : null;

    commandCurrentTable.replaceChildren(
      createHelpHeading(
        "h2",
        "command-pane-heading",
        "Active keys",
        "One row per currently active COMMAND key. Deleted keys are excluded from this table."
      ),
      createPaneHelp("Current COMMAND state for the selected item. Deleted keys stay available below in matching results."),
      header,
      rows
    );
    if (emptyRows) {
      commandCurrentTable.append(emptyRows);
    }
    commandCurrentTable.append(results);
  }

  function renderCommandDetail(
    subscription: CommandSubscriptionGroup,
    item: CommandItemGroup,
    commandState: CommandState
  ): void {
    commandDetailPane.replaceChildren();
    const context = createCommandItemContext(subscription, item, allEvents);

    if (!selectedCommandKey) {
      commandDetailPane.append(
        createTextElement(
          "p",
          "command-empty-body",
          "Select an active key or matching result to inspect the events for that key only."
        )
      );
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      return;
    }

    const target = findCommandDetailTarget(item, selectedCommandKey);
    if (!target) {
      commandDetailPane.append(createTextElement("p", "command-empty-body", "Selected COMMAND key is no longer available."));
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      return;
    }

    if (target.kind === "diagnostic") {
      renderCommandDiagnosticDetail(target.diagnostic);
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      return;
    }

    if (target.kind === "active") {
      const row = target.row;
      commandDetailPane.append(
        createTextElement("h2", "command-detail-heading", `Key ${row.key} - ${row.status}`)
      );

      const summary = document.createElement("section");
      summary.className = "command-detail-summary";
      summary.append(
        createCommandSummaryRow("Subscription", row.subscriptionId),
        createCommandSummaryRow("Item", commandItemLabel(item)),
        createCommandSummaryRow("Key", row.key),
        createCommandSummaryRow("Origin", provenanceLabel(row.origin)),
        createCommandSummaryRow("Latest", latestRowLabel(row)),
        createCommandSummaryRow("Updates", String(row.lifecycle.length))
      );
      commandDetailPane.append(summary);

      const fields = document.createElement("section");
      fields.className = "command-current-fields";
      fields.append(
        createHelpHeading(
          "h3",
          "command-detail-section-heading",
          "Current fields",
          "The latest field values for this active key after applying its lifecycle."
        )
      );
      const fieldsJson = document.createElement("pre");
      fieldsJson.className = "command-json";
      fieldsJson.textContent = JSON.stringify(row.fields, null, 2);
      fields.append(fieldsJson);
      commandDetailPane.append(fields);

      appendCommandLifecycle(row.lifecycle);
      appendCommandDiagnostics(row.lifecycle, item.diagnostics);
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      return;
    }

    const row = target.row;
    commandDetailPane.append(
      createTextElement("h2", "command-detail-heading", `Key ${row.key} - ${row.status}`)
    );

    const summary = document.createElement("section");
    summary.className = "command-detail-summary";
    summary.append(
      createCommandSummaryRow("Subscription", row.subscriptionId),
      createCommandSummaryRow("Item", commandItemLabel(item)),
      createCommandSummaryRow("Key", row.key),
      createCommandSummaryRow("Origin", "deleted"),
      createCommandSummaryRow("Latest", `server DELETE ${formatTime(row.deletedAt.timestamp)}`),
      createCommandSummaryRow("Updates", String(row.lifecycle.length))
    );
    commandDetailPane.append(summary);

    appendCommandLifecycle(row.lifecycle);
    appendCommandDiagnostics(row.lifecycle, item.diagnostics);
    appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
  }

  function renderCommandDiagnosticDetail(diagnostic: CommandDiagnostic): void {
    commandDetailPane.append(createTextElement("h2", "command-detail-heading", "COMMAND diagnostic"));
    const pre = document.createElement("pre");
    pre.className = "command-json";
    pre.textContent = JSON.stringify(diagnostic, null, 2);
    commandDetailPane.append(pre);
  }

  function appendCommandLifecycle(lifecycle: readonly CommandLifecycleEntry[]): void {
    const section = document.createElement("section");
    section.className = "command-lifecycle";
    section.append(
      createHelpHeading(
        "h3",
        "command-detail-section-heading",
        "Selected key lifecycle",
        "Events for the selected key only, shown from oldest to newest."
      ),
      createPaneHelp("Events for this key only. Cross-key ordering is not implied here.")
    );

    for (const entry of lifecycle) {
      const lifecycleEntry = document.createElement("div");
      lifecycleEntry.className = "command-lifecycle-entry";
      lifecycleEntry.append(
        createTextElement(
          "div",
          "command-lifecycle-line",
          `${entry.eventId} ${formatTime(entry.timestamp)} ${entry.originalCommand ?? "-"} ${provenanceLabel(entry.provenance)}`
        ),
        createTextElement(
          "div",
          "command-lifecycle-line",
          `changed ${Object.keys(entry.changedFields).join(", ") || "none"} diagnostics ${entry.diagnosticCodes.join(", ") || "none"}`
        )
      );
      const json = document.createElement("pre");
      json.className = "command-json";
      json.textContent = JSON.stringify(
        {
          eventId: entry.eventId,
          command: entry.originalCommand,
          effectiveCommand: entry.effectiveCommand,
          source: provenanceLabel(entry.provenance),
          fields: entry.fields,
          changedFields: entry.changedFields,
          diagnostics: entry.diagnosticCodes
        },
        null,
        2
      );
      lifecycleEntry.append(json);
      section.append(lifecycleEntry);
    }

    commandDetailPane.append(section);
  }

  function appendCommandDiagnostics(
    lifecycle: readonly CommandLifecycleEntry[],
    diagnostics: readonly CommandDiagnostic[]
  ): void {
    const codes = new Set(lifecycle.flatMap((entry) => entry.diagnosticCodes));
    const matching = diagnostics.filter((diagnostic) => codes.has(diagnostic.code));
    if (matching.length === 0) {
      return;
    }

    const section = document.createElement("section");
    section.className = "command-diagnostics";
    section.append(createTextElement("h3", "command-detail-section-heading", "Diagnostics"));
    const pre = document.createElement("pre");
    pre.className = "command-json";
    pre.textContent = JSON.stringify(matching, null, 2);
    section.append(pre);
    commandDetailPane.append(section);
  }

  function appendNewCommandDraftSection(
    parent: HTMLElement,
    context: CommandItemContext,
    item: CommandItemGroup,
    commandState: CommandState
  ): void {
    const section = document.createElement("section");
    section.className = "new-command-editor";
    section.setAttribute("aria-label", "New synthetic COMMAND update");

    const heading = createTextElement("h3", "detail-section-heading", "New COMMAND update");
    const createButton = document.createElement("button");
    createButton.className = "new-command-button";
    createButton.type = "button";
    createButton.textContent = "New COMMAND update";
    createButton.disabled = !createNewCommandDraftFromContext(context);
    createButton.addEventListener("click", () => {
      const nextDraft = createNewCommandDraftFromContext(context);
      if (!nextDraft) {
        return;
      }
      draft = nextDraft;
      reinjectionMessage = null;
      renderCommandState(allEvents);
    });

    section.append(heading, createButton);

    if (draft?.provenance.source === "new-command" && !commandDraftMatchesContext(draft, context)) {
      draft = null;
      reinjectionMessage = null;
    }

    if (!draft || draft.provenance.source !== "new-command") {
      section.append(
        createTextElement(
          "p",
          "editor-placeholder",
          "Select a captured COMMAND subscription and item, then create a synthetic update from that context."
        )
      );
      parent.append(section);
      return;
    }

    section.append(createCommandDraftContext(context));
    section.append(createCommandDraftControls(draft, context, item, commandState));
    parent.append(section);
  }

  function createCommandDraftControls(
    currentDraft: ReinjectionDraft,
    context: CommandItemContext,
    item: CommandItemGroup,
    commandState: CommandState
  ): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "command-draft-controls";

    const validation = validateNewCommandDraft(currentDraft, commandState, context);

    const commandLabel = document.createElement("label");
    commandLabel.className = "command-draft-label";
    commandLabel.append(createTextElement("span", "draft-input-text", "Command"));
    const commandSelect = document.createElement("select");
    commandSelect.className = "filter-control command-draft-command";
    commandSelect.setAttribute("aria-label", "COMMAND command");
    for (const [value, label] of [
      ["", "Command"],
      ["ADD", "ADD"],
      ["UPDATE", "UPDATE"],
      ["DELETE", "DELETE"]
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      commandSelect.append(option);
    }
    commandSelect.value = currentDraft.command ?? "";
    commandSelect.addEventListener("change", () => {
      draft = updateDraftCommand(draft ?? currentDraft, commandSelect.value);
      reinjectionMessage = null;
      renderCommandStatePreservingDraftEditorState(".command-draft-command");
    });
    commandLabel.append(commandSelect);

    const keyLabel = document.createElement("label");
    keyLabel.className = "command-draft-label";
    keyLabel.append(createTextElement("span", "draft-input-text", "Key"));
    const keyInput = document.createElement("input");
    keyInput.className = "filter-control command-draft-key";
    keyInput.setAttribute("aria-label", "COMMAND key");
    keyInput.value = currentDraft.key ?? "";
    keyInput.addEventListener("input", () => {
      draft = updateDraftKey(draft ?? currentDraft, keyInput.value);
      reinjectionMessage = null;
      renderCommandStatePreservingDraftEditorState(".command-draft-key");
    });
    keyLabel.append(keyInput);

    const snapshotLabel = document.createElement("label");
    snapshotLabel.className = "command-draft-checkbox-label";
    const snapshotInput = document.createElement("input");
    snapshotInput.className = "command-draft-snapshot";
    snapshotInput.type = "checkbox";
    snapshotInput.checked = currentDraft.isSnapshot;
    snapshotInput.setAttribute("aria-label", "Snapshot update");
    snapshotInput.addEventListener("change", () => {
      draft = updateDraftSnapshot(draft ?? currentDraft, snapshotInput.checked);
      reinjectionMessage = null;
      renderCommandStatePreservingDraftEditorState(".command-draft-snapshot");
    });
    snapshotLabel.append(snapshotInput, createTextElement("span", "draft-input-text", "Snapshot"));

    const fieldTable = createCommandDraftFieldTable(currentDraft, item);
    const diagnostics = createCommandDraftDiagnostics(validation.diagnostics);

    const injectButton = document.createElement("button");
    injectButton.className = "inject-command-button reinject-button";
    injectButton.type = "button";
    injectButton.textContent = reinjectionPending ? "Injecting..." : "Inject COMMAND update";
    injectButton.disabled = !validation.valid || !bridge || reinjectionPending;
    injectButton.addEventListener("click", () => {
      void injectCommandDraft(draft ?? currentDraft, context, item);
    });

    if (reinjectionMessage) {
      const message = createTextElement("p", `reinjection-message ${reinjectionMessage.kind}`, reinjectionMessage.text);
      if (reinjectionMessage.detail) {
        message.append(createTextElement("span", "reinjection-detail", reinjectionMessage.detail));
      }
      controls.append(message);
    }

    controls.append(commandLabel, keyLabel, snapshotLabel, fieldTable, diagnostics, injectButton);
    return controls;
  }

  function createCommandDraftFieldTable(currentDraft: ReinjectionDraft, item: CommandItemGroup): HTMLElement {
    const table = document.createElement("div");
    table.className = "command-draft-field-table";
    table.append(
      createTextElement("span", "command-draft-field-heading", "Field"),
      createTextElement("span", "command-draft-field-heading", "Current"),
      createTextElement("span", "command-draft-field-heading", "Draft"),
      createTextElement("span", "command-draft-field-heading", "Changed")
    );

    const currentRow = currentDraft.key
      ? item.activeRows.find((row) => row.key === currentDraft.key)
      : null;

    for (const [fieldName, value] of Object.entries(currentDraft.fields)) {
      const name = createTextElement("span", "command-draft-field-name", fieldName);
      const current = createTextElement(
        "span",
        "command-draft-field-current",
        formatDraftFieldValue(currentRow?.fields[fieldName])
      );
      const draftInput = document.createElement("input");
      draftInput.className = "filter-control command-draft-field-input";
      draftInput.setAttribute("aria-label", `Draft field ${fieldName}`);
      draftInput.dataset.fieldName = fieldName;
      draftInput.value = formatDraftFieldValue(value);
      draftInput.addEventListener("input", () => {
        draft = updateDraftField(draft ?? currentDraft, fieldName, draftInput.value === "" ? null : draftInput.value);
        reinjectionMessage = null;
        renderCommandStatePreservingDraftEditorState(
          `.command-draft-field-input[data-field-name="${cssAttributeValue(fieldName)}"]`
        );
      });
      const changed = createTextElement(
        "span",
        "command-draft-field-changed",
        Object.prototype.hasOwnProperty.call(currentDraft.changedFields, fieldName) ? "changed" : "-"
      );
      table.append(name, current, draftInput, changed);
    }

    return table;
  }

  function createCommandDraftDiagnostics(diagnostics: readonly NewCommandDraftDiagnostic[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "command-draft-diagnostics";
    section.append(createTextElement("h4", "draft-source-heading", "Diagnostics"));
    if (diagnostics.length === 0) {
      section.append(createTextElement("p", "command-draft-diagnostic info", "Draft is ready for local listener-path injection."));
      return section;
    }

    for (const diagnostic of diagnostics) {
      const message = createTextElement(
        "p",
        `command-draft-diagnostic ${diagnostic.severity}`,
        `${diagnostic.code}: ${diagnostic.serverLikeMessage ? `${diagnostic.serverLikeMessage}. ` : ""}${diagnostic.explanation} ${diagnostic.suggestion}`
      );
      section.append(message);
    }
    return section;
  }

  async function injectCommandDraft(
    currentDraft: ReinjectionDraft,
    context: CommandItemContext,
    item: CommandItemGroup
  ): Promise<void> {
    const activeBridge = bridge;
    const validation = validateNewCommandDraft(currentDraft, reduceCommandState(allEvents), context);
    if (!activeBridge || !validation.valid) {
      return;
    }

    if (!commandDraftMatchesContext(currentDraft, context)) {
      draft = null;
      reinjectionMessage = {
        kind: "error",
        text: "Draft context changed. Create a new COMMAND update for the selected item before injecting."
      };
      renderCommandState(allEvents);
      return;
    }

    reinjectionPending = true;
    reinjectionMessage = null;
    renderCommandState(allEvents);

    const result = await activeBridge.reinjectDraft(currentDraft);
    reinjectionPending = false;

    if (result.ok && result.status === "success") {
      reinjectionMessage = {
        kind: "success",
        text: "Synthetic COMMAND update injected through the captured listener."
      };
      if (currentDraft.key) {
        selectedCommandKey = {
          subscriptionId: item.subscriptionId,
          itemId: item.itemId,
          key: currentDraft.key,
          status: currentDraft.command === "DELETE" ? "deleted" : "active"
        };
      }
      store.append(createSyntheticEventFromDraft(currentDraft, result));
      return;
    }

    reinjectionMessage = createCommandFailureMessage(result);
    renderCommandState(allEvents);
  }

  function renderCommandStatePreservingDraftEditorState(focusSelector: string): void {
    const scrollTop = commandDetailPane.scrollTop;
    const activeElement = document.activeElement;
    const selection =
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? {
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd
          }
        : null;

    renderCommandState(allEvents);
    commandDetailPane.scrollTop = scrollTop;

    const nextFocus = commandDetailPane.querySelector<HTMLElement>(focusSelector);
    nextFocus?.focus();
    if (
      selection &&
      nextFocus instanceof HTMLInputElement &&
      isTextSelectionInput(nextFocus) &&
      typeof selection.start === "number" &&
      typeof selection.end === "number"
    ) {
      nextFocus.setSelectionRange(selection.start, selection.end);
    }
  }

  const controller: PanelController = {
    setStatus(nextStatus) {
      panelState.status = nextStatus;
      status.textContent = nextStatus;
      status.dataset.status = nextStatus;
    },

    appendCaptureMessage(message) {
      store.append(normalizer.normalize(message));
      controller.setStatus("capturing");
    },

    clearEvents() {
      selectedPinned = false;
      draft = null;
      reinjectionMessage = null;
      store.clear();
    },

    setBridge(nextBridge) {
      bridge = nextBridge;
      renderDetail(allEvents.find((event) => event.id === selectedEventId) ?? null);
    }
  };

  store.subscribe((events) => {
    allEvents = events;
    eventCount.textContent = String(events.length);
    eventCount.setAttribute("aria-label", `${events.length} captured events`);
    renderActiveView();
  });

  return controller;

  function appendDraftSection(
    parent: HTMLElement,
    selectedEvent: LightstreamerEventEnvelope,
    currentDraft: ReinjectionDraft | null
  ): void {
    const section = document.createElement("section");
    section.className = "draft-editor";
    section.append(createTextElement("h3", "detail-section-heading", "Reinjection Draft"));

    const cloneButton = document.createElement("button");
    cloneButton.className = "clone-button";
    cloneButton.type = "button";
    cloneButton.textContent = "Clone event";
    cloneButton.disabled = !canCloneEvent(selectedEvent);
    cloneButton.addEventListener("click", () => {
      const nextDraft = createDraftFromEvent(selectedEvent);
      if (!nextDraft || !validateEditableDraft(nextDraft).valid) {
        return;
      }
      selectedEventId = selectedEvent.id;
      selectedPinned = true;
      draft = nextDraft;
      reinjectionMessage = null;
      renderDetail(selectedEvent);
    });
    section.append(cloneButton);

    if (!currentDraft) {
      section.append(
        createTextElement(
          "p",
          "editor-placeholder",
          "Clone a captured item update to edit and reinject it locally."
        )
      );
      parent.append(section);
      return;
    }

    section.append(createSourceContext(currentDraft));
    section.append(createDraftControls(currentDraft));
    parent.append(section);
  }

  function createDraftControls(currentDraft: ReinjectionDraft): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "draft-controls";

    const validation = validateReinjectionDraft(currentDraft);
    if (!validation.valid) {
      controls.append(
        createTextElement(
          "p",
          "draft-validation-error",
          validationMessage(validation.errors)
        )
      );
    }

    const draftLabel = document.createElement("label");
    draftLabel.className = "draft-json-label";
    draftLabel.append(createTextElement("span", "draft-input-text", "Draft JSON"));

    const draftTextarea = document.createElement("textarea");
    draftTextarea.className = "draft-json";
    draftTextarea.setAttribute("aria-label", "Draft JSON");
    draftTextarea.spellcheck = false;
    draftTextarea.value = formatDraftJson(currentDraft);
    draftLabel.append(draftTextarea);

    const jsonError = createTextElement("p", "draft-validation-error draft-json-error", "");
    jsonError.hidden = true;

    const changedPreview = document.createElement("pre");
    changedPreview.className = "draft-changed-fields-preview";
    changedPreview.textContent = JSON.stringify(currentDraft.changedFields, null, 2);

    const reinjectButton = document.createElement("button");
    reinjectButton.className = "reinject-button";
    reinjectButton.type = "button";
    reinjectButton.textContent = reinjectionPending ? "Reinjecting..." : "Reinject draft";
    reinjectButton.disabled = !validation.valid || !bridge || reinjectionPending;
    reinjectButton.dataset.validationValid = String(validation.valid);
    reinjectButton.addEventListener("click", () => {
      const activeDraft = draft ?? currentDraft;
      void reinjectCurrentDraft(activeDraft);
    });

    draftTextarea.addEventListener("input", () => {
      const result = parseDraftJson(currentDraft, draftTextarea.value);
      if (!result.draft) {
        jsonError.textContent = result.error ?? "Draft JSON is invalid.";
        jsonError.hidden = false;
        reinjectButton.disabled = true;
        reinjectButton.dataset.validationValid = "false";
        return;
      }

      draft = result.draft;
      reinjectionMessage = null;
      const nextValidation = validateReinjectionDraft(result.draft);
      jsonError.textContent = nextValidation.valid
        ? ""
        : validationMessage(nextValidation.errors);
      jsonError.hidden = nextValidation.valid;
      changedPreview.textContent = JSON.stringify(result.draft.changedFields, null, 2);
      reinjectButton.disabled = !nextValidation.valid || !bridge || reinjectionPending;
      reinjectButton.dataset.validationValid = String(nextValidation.valid);
    });

    if (reinjectionMessage) {
      const message = createTextElement("p", `reinjection-message ${reinjectionMessage.kind}`, reinjectionMessage.text);
      if (reinjectionMessage.detail) {
        message.append(createTextElement("span", "reinjection-detail", reinjectionMessage.detail));
      }
      controls.append(message);
    }

    controls.append(
      draftLabel,
      jsonError,
      createTextElement("h4", "draft-source-heading", "Derived changed fields"),
      changedPreview,
      reinjectButton
    );
    return controls;
  }

  async function reinjectCurrentDraft(currentDraft: ReinjectionDraft): Promise<void> {
    const activeBridge = bridge;
    if (!activeBridge || !validateReinjectionDraft(currentDraft).valid) {
      return;
    }

    reinjectionPending = true;
    reinjectionMessage = null;
    renderDetail(selectedEventForDraft(currentDraft));

    const result = await activeBridge.reinjectDraft(currentDraft);
    reinjectionPending = false;

    if (result.ok && result.status === "success") {
      reinjectionMessage = {
        kind: "success",
        text: "Synthetic update reinjected through the original listener."
      };
      store.append(createSyntheticEventFromDraft(currentDraft, result));
      return;
    }

    reinjectionMessage = createFailureMessage(result);
    renderDetail(selectedEventForDraft(currentDraft));
  }

  function selectedEventForDraft(currentDraft: ReinjectionDraft): LightstreamerEventEnvelope {
    return (
      allEvents.find((event) => event.id === currentDraft.sourceEventId) ??
      allEvents.find((event) => event.id === selectedEventId) ??
      allEvents[allEvents.length - 1]
    );
  }

  function clearDraftForSelection(nextEventId: string | null): void {
    if (!draft || draft.sourceEventId === nextEventId) {
      return;
    }
    draft = null;
    reinjectionMessage = null;
  }
}

function flattenCommandItems(
  state: CommandState
): Array<{ subscription: CommandSubscriptionGroup; item: CommandItemGroup }> {
  return state.subscriptions.flatMap((subscription) =>
    subscription.items.map((item) => ({ subscription, item }))
  );
}

function validCommandItemSelection(
  items: Array<{ subscription: CommandSubscriptionGroup; item: CommandItemGroup }>,
  selected: { subscriptionId: string; itemId: string } | null
): { subscriptionId: string; itemId: string } | null {
  if (
    selected &&
    items.some(
      (entry) =>
        entry.subscription.subscriptionId === selected.subscriptionId &&
        entry.item.itemId === selected.itemId
    )
  ) {
    return selected;
  }
  return null;
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isTextSelectionInput(input: HTMLInputElement): boolean {
  return ["", "email", "number", "password", "search", "tel", "text", "url"].includes(input.type);
}

function findSelectedCommandItem(
  items: Array<{ subscription: CommandSubscriptionGroup; item: CommandItemGroup }>,
  selected: { subscriptionId: string; itemId: string } | null
): { subscription: CommandSubscriptionGroup; item: CommandItemGroup } | null {
  if (!selected) {
    return null;
  }
  return (
    items.find(
      (entry) =>
        entry.subscription.subscriptionId === selected.subscriptionId &&
        entry.item.itemId === selected.itemId
    ) ?? null
  );
}

function countActiveRows(subscription: CommandSubscriptionGroup): number {
  return subscription.items.reduce((total, item) => total + item.activeRows.length, 0);
}

function countDeletedKeys(subscription: CommandSubscriptionGroup): number {
  return subscription.items.reduce((total, item) => total + item.deletedKeys.length, 0);
}

function commandItemLabel(item: CommandItemGroup): string {
  if (item.itemName) {
    return item.itemName;
  }
  if (item.itemPosition !== null) {
    return `position ${item.itemPosition}`;
  }
  return "unknown item";
}

function latestItemSource(item: CommandItemGroup): string {
  const latest = item.lifecycle[item.lifecycle.length - 1];
  return latest ? provenanceLabel(latest.provenance) : "no updates";
}

function provenanceLabel(provenance: CommandProvenance): string {
  if (provenance.synthetic) {
    return provenance.isSnapshot ? "synthetic snapshot" : "synthetic live";
  }
  return provenance.isSnapshot ? "snapshot server" : "live server";
}

function latestRowLabel(row: CommandRow): string {
  const latest = latestLifecycle(row);
  const source = row.latest.synthetic ? "synthetic" : "server";
  return `${source} ${latest?.originalCommand ?? "-"}`;
}

function latestLifecycle(row: CommandRow): CommandLifecycleEntry | null {
  return row.lifecycle[row.lifecycle.length - 1] ?? null;
}

function latestLifecycleCommand(lifecycle: readonly CommandLifecycleEntry[]): string {
  return lifecycle[lifecycle.length - 1]?.originalCommand ?? "-";
}

function fieldSummary(
  fields: Record<string, string | number | boolean | null>,
  changedFields: Record<string, string | number | boolean | null> | undefined
): string {
  const fieldCount = Object.keys(fields).length;
  const changed = Object.keys(changedFields ?? {});
  if (changed.length === 0) {
    return `${fieldCount} fields`;
  }
  const visible = changed.slice(0, 2).join(", ");
  const rest = changed.length > 2 ? ` +${changed.length - 2}` : "";
  return `${fieldCount} fields ${visible}${rest}`;
}

function rowDiagnosticsLabel(lifecycle: readonly CommandLifecycleEntry[]): string {
  const codes = lifecycle.flatMap((entry) => entry.diagnosticCodes);
  return codes.length === 0 ? "none" : codes.join(", ");
}

function lifecycleSearchSummary(lifecycle: readonly CommandLifecycleEntry[]): string {
  return lifecycle
    .map(
      (entry) =>
        `${entry.eventId} ${entry.originalCommand ?? "-"} ${provenanceLabel(entry.provenance)} ${Object.keys(entry.changedFields).join(" ")}`
    )
    .join(" ");
}

function createCommandResultButton(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "command-lifecycle-result";
  button.type = "button";
  button.textContent = text;
  return button;
}

function createCommandSummaryRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "command-summary-row";
  row.append(
    createTextElement("span", "command-summary-label", `${label} `),
    createTextElement("span", "command-summary-value", value)
  );
  return row;
}

function createCommandItemContext(
  subscription: CommandSubscriptionGroup,
  item: CommandItemGroup,
  events: readonly LightstreamerEventEnvelope[]
): CommandItemContext {
  const sourceEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event.kind === "item-update" &&
        event.subscription?.id === subscription.subscriptionId &&
        event.subscription?.mode === "COMMAND" &&
        itemIdentityForEnvelope(event.item) === item.itemId &&
        event.listener?.id
    );

  return {
    subscriptionId: subscription.subscriptionId,
    mode: subscription.mode,
    listenerId: sourceEvent?.listener?.id ?? null,
    itemName: item.itemName,
    itemPosition: item.itemPosition,
    fields: sourceEvent?.subscription?.fields ?? subscription.subscription.fields ?? null
  };
}

function createCommandDraftContext(context: CommandItemContext): HTMLElement {
  const element = document.createElement("div");
  element.className = "command-draft-context";
  const rows: Array<[string, string]> = [
    ["Subscription", context.subscriptionId ?? "-"],
    ["Listener", context.listenerId ?? "-"],
    ["Item", context.itemName ?? String(context.itemPosition ?? "-")],
    ["Schema", context.fields?.join(", ") ?? "-"]
  ];

  for (const [label, value] of rows) {
    element.append(createCommandSummaryRow(label, value));
  }
  return element;
}

function commandDraftMatchesContext(draft: ReinjectionDraft, context: CommandItemContext): boolean {
  return (
    draft.target.subscriptionId === (context.subscriptionId ?? null) &&
    draft.target.listenerId === (context.listenerId ?? null) &&
    (draft.item.name ?? null) === (context.itemName ?? null) &&
    (draft.item.position ?? null) === (context.itemPosition ?? null)
  );
}

function itemIdentityForEnvelope(item: LightstreamerEventEnvelope["item"]): string {
  if (item?.name) {
    return `name:${item.name}`;
  }
  if (item?.position !== undefined && item.position !== null) {
    return `position:${item.position}`;
  }
  return "unknown-item";
}

function reconcileCommandSelection(
  item: CommandItemGroup,
  selection: CommandSelection,
  matchingRows: readonly CommandRow[],
  matchingDeleted: readonly DeletedCommandKey[],
  matchingDiagnostics: readonly CommandDiagnostic[]
): CommandSelection {
  if (
    selection &&
    findVisibleCommandDetailTarget(item, selection, matchingRows, matchingDeleted, matchingDiagnostics)
  ) {
    return selection;
  }

  if (matchingRows[0]) {
    return commandSelectionForRow(matchingRows[0]);
  }

  if (matchingDeleted[0]) {
    return commandSelectionForDeleted(matchingDeleted[0]);
  }

  if (matchingDiagnostics[0]) {
    return commandSelectionForDiagnostic(item, matchingDiagnostics[0]);
  }

  return null;
}

function findVisibleCommandDetailTarget(
  item: CommandItemGroup,
  selection: NonNullable<CommandSelection>,
  matchingRows: readonly CommandRow[],
  matchingDeleted: readonly DeletedCommandKey[],
  matchingDiagnostics: readonly CommandDiagnostic[]
): CommandDetailTarget | null {
  const target = findCommandDetailTarget(item, selection);
  if (!target) {
    return null;
  }

  if (target.kind === "active") {
    return matchingRows.some((row) => commandSelectionMatchesRow(selection, row)) ? target : null;
  }

  if (target.kind === "deleted") {
    return matchingDeleted.some((row) => commandSelectionMatchesDeleted(selection, row)) ? target : null;
  }

  return matchingDiagnostics.some((diagnostic) =>
    commandSelectionMatchesDiagnostic(selection, item, diagnostic)
  )
    ? target
    : null;
}

function commandSelectionForRow(row: CommandRow): CommandRowSelection {
  return {
    subscriptionId: row.subscriptionId,
    itemId: row.itemId,
    key: row.key,
    status: "active"
  };
}

function commandSelectionForDeleted(row: DeletedCommandKey): CommandRowSelection {
  return {
    subscriptionId: row.subscriptionId,
    itemId: row.itemId,
    key: row.key,
    status: "deleted"
  };
}

function commandSelectionForDiagnostic(
  item: CommandItemGroup,
  diagnostic: CommandDiagnostic
): CommandDiagnosticSelection {
  return {
    subscriptionId: item.subscriptionId,
    itemId: item.itemId,
    key: diagnostic.key ?? null,
    status: "diagnostic",
    diagnosticCode: diagnostic.code,
    eventId: diagnostic.eventId ?? null
  };
}

function commandSelectionMatchesRow(selection: CommandSelection, row: CommandRow): boolean {
  return (
    selection?.status === "active" &&
    selection.subscriptionId === row.subscriptionId &&
    selection.itemId === row.itemId &&
    selection.key === row.key
  );
}

function commandSelectionMatchesDeleted(
  selection: CommandSelection,
  row: DeletedCommandKey
): boolean {
  return (
    selection?.status === "deleted" &&
    selection.subscriptionId === row.subscriptionId &&
    selection.itemId === row.itemId &&
    selection.key === row.key
  );
}

function commandSelectionMatchesDiagnostic(
  selection: CommandSelection,
  item: CommandItemGroup,
  diagnostic: CommandDiagnostic
): boolean {
  return (
    selection?.status === "diagnostic" &&
    selection.subscriptionId === item.subscriptionId &&
    selection.itemId === item.itemId &&
    selection.key === (diagnostic.key ?? null) &&
    selection.diagnosticCode === diagnostic.code &&
    selection.eventId === (diagnostic.eventId ?? null)
  );
}

function findCommandDetailTarget(
  item: CommandItemGroup,
  selection: NonNullable<CommandSelection>
): CommandDetailTarget | null {
  if (selection.subscriptionId !== item.subscriptionId || selection.itemId !== item.itemId) {
    return null;
  }

  if (selection.status === "diagnostic") {
    const diagnostic = item.diagnostics.find((candidate) =>
      commandSelectionMatchesDiagnostic(selection, item, candidate)
    );
    return diagnostic ? { kind: "diagnostic", diagnostic, item } : null;
  }

  if (selection.status === "active") {
    const row = item.activeRows.find((candidate) => candidate.key === selection.key);
    return row ? { kind: "active", row, item } : null;
  }
  const row = item.deletedKeys.find((candidate) => candidate.key === selection.key);
  return row ? { kind: "deleted", row, item } : null;
}

function matchesCommandRow(
  row: CommandRow,
  item: CommandItemGroup,
  filters: CommandFilterState
): boolean {
  const searchText = commandRowSearchText(row, item);
  return (
    matchesTokens(searchText, filters.query) &&
    matchesText(row.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(row.key, filters.key) &&
    matchesCommandLifecycle(row.lifecycle, filters.command) &&
    matchesTokens(searchText, filters.source) &&
    matchesSnapshotFilter(row.lifecycle, filters.snapshot) &&
    matchesSyntheticFilter(row.lifecycle, filters.synthetic) &&
    matchesDiagnosticsFilter(row.lifecycle, filters.diagnostics)
  );
}

function matchesDeletedCommandKey(
  row: DeletedCommandKey,
  item: CommandItemGroup,
  filters: CommandFilterState
): boolean {
  const searchText = deletedRowSearchText(row, item);
  return (
    matchesTokens(searchText, filters.query) &&
    matchesText(row.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(row.key, filters.key) &&
    matchesCommandLifecycle(row.lifecycle, filters.command) &&
    matchesTokens(searchText, filters.source) &&
    matchesSnapshotFilter(row.lifecycle, filters.snapshot) &&
    matchesSyntheticFilter(row.lifecycle, filters.synthetic) &&
    matchesDiagnosticsFilter(row.lifecycle, filters.diagnostics)
  );
}

function matchesCommandDiagnostic(
  diagnostic: CommandDiagnostic,
  item: CommandItemGroup,
  filters: CommandFilterState
): boolean {
  const searchText = normalizeSearchText([
    item.subscriptionId,
    commandItemLabel(item),
    diagnostic.key,
    diagnostic.command,
    diagnostic.code,
    diagnostic.severity,
    diagnostic.eventId,
    diagnostic.field,
    diagnostic.serverLikeMessage,
    diagnostic.explanation,
    diagnostic.suggestion,
    JSON.stringify(diagnostic)
  ]);
  return (
    matchesTokens(searchText, filters.query) &&
    matchesText(item.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(diagnostic.key ?? "", filters.key) &&
    matchesText(diagnostic.command ?? diagnostic.code, filters.command) &&
    matchesTokens(searchText, filters.diagnostics)
  );
}

function commandRowSearchText(row: CommandRow, item: CommandItemGroup): string {
  return normalizeSearchText([
    row.subscriptionId,
    commandItemLabel(item),
    row.itemId,
    row.key,
    row.status,
    provenanceLabel(row.origin),
    latestRowLabel(row),
    rowDiagnosticsLabel(row.lifecycle),
    JSON.stringify(row.fields),
    JSON.stringify(row.lifecycle)
  ]);
}

function deletedRowSearchText(row: DeletedCommandKey, item: CommandItemGroup): string {
  return normalizeSearchText([
    row.subscriptionId,
    commandItemLabel(item),
    row.itemId,
    row.key,
    row.status,
    "deleted",
    provenanceLabel(row.deletedAt),
    JSON.stringify(row.lifecycle)
  ]);
}

function normalizeSearchText(values: Array<unknown>): string {
  return values
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();
}

function matchesTokens(searchText: string, filter: string | undefined): boolean {
  const tokens = filter?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return tokens.every((token) => searchText.includes(token));
}

function matchesText(value: string, filter: string | undefined): boolean {
  return !filter?.trim() || value.toLowerCase().includes(filter.trim().toLowerCase());
}

function matchesCommandLifecycle(
  lifecycle: readonly CommandLifecycleEntry[],
  command: string | undefined
): boolean {
  if (!command?.trim()) {
    return true;
  }
  const normalized = command.trim().toLowerCase();
  return lifecycle.some(
    (entry) =>
      entry.originalCommand?.toLowerCase().includes(normalized) ||
      entry.effectiveCommand?.toLowerCase().includes(normalized)
  );
}

function matchesSnapshotFilter(
  lifecycle: readonly CommandLifecycleEntry[],
  snapshot: string | undefined
): boolean {
  if (!snapshot) {
    return true;
  }
  return lifecycle.some((entry) => (snapshot === "snapshot" ? entry.isSnapshot : !entry.isSnapshot));
}

function matchesSyntheticFilter(
  lifecycle: readonly CommandLifecycleEntry[],
  synthetic: string | undefined
): boolean {
  if (!synthetic) {
    return true;
  }
  return lifecycle.some((entry) =>
    synthetic === "synthetic" ? entry.provenance.synthetic : !entry.provenance.synthetic
  );
}

function matchesDiagnosticsFilter(
  lifecycle: readonly CommandLifecycleEntry[],
  diagnostics: string | undefined
): boolean {
  if (!diagnostics?.trim()) {
    return true;
  }
  const normalized = diagnostics.trim().toLowerCase();
  const codes = lifecycle.flatMap((entry) => entry.diagnosticCodes);
  if (normalized === "none") {
    return codes.length === 0;
  }
  return codes.some((code) => code.toLowerCase().includes(normalized));
}

function formatDraftJson(draft: ReinjectionDraft): string {
  return JSON.stringify(
    {
      command: draft.command,
      key: draft.key,
      isSnapshot: draft.isSnapshot,
      fields: draft.fields
    },
    null,
    2
  );
}

function parseDraftJson(sourceDraft: ReinjectionDraft, value: string): DraftJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    return {
      draft: null,
      error: `Draft JSON parse error: ${error instanceof Error ? error.message : "invalid JSON"}`
    };
  }

  if (!isRecord(parsed)) {
    return {
      draft: null,
      error: "Draft JSON must be an object."
    };
  }

  const fields = parseDraftFields(parsed.fields);
  if (!fields) {
    return {
      draft: null,
      error: "Draft JSON fields must be an object with string, number, boolean, or null values."
    };
  }

  const command = stringOrNull(parsed.command ?? fields.command);
  const key = stringOrNull(parsed.key ?? fields.key);
  const isSnapshot =
    typeof parsed.isSnapshot === "boolean" ? parsed.isSnapshot : sourceDraft.isSnapshot;
  const nextFields = {
    ...fields,
    ...(command ? { command } : {}),
    ...(key ? { key } : {})
  };

  return {
    draft: {
      ...sourceDraft,
      command,
      key,
      isSnapshot,
      fields: nextFields,
      changedFields: deriveChangedFields(sourceDraft.sourceFields, nextFields),
      manualChangedFieldsOverride: false
    },
    error: null
  };
}

function parseDraftFields(value: unknown): DraftFields | null {
  if (!isRecord(value)) {
    return null;
  }

  const fields: DraftFields = {};
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    if (fieldName.trim() === "" || !isDraftFieldValue(fieldValue)) {
      return null;
    }
    fields[fieldName] = fieldValue;
  }
  return fields;
}

function isDraftFieldValue(value: unknown): value is DraftFieldValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFailureMessage(result: ReinjectionResult): ReinjectionMessage {
  if (result.status === "stale-target") {
    return {
      kind: "error",
      text: "Original listener is no longer available. Capture a fresh update for this subscription, then clone it again."
    };
  }

  return {
    kind: "error",
    text: "Reinjection failed before a synthetic event was appended. Review the listener error and adjust the draft.",
    detail: result.error
  };
}

function createCommandFailureMessage(result: ReinjectionResult): ReinjectionMessage {
  if (result.status === "stale-target") {
    return {
      kind: "error",
      text: "Captured listener target is no longer available. Capture a fresh update for this subscription, then create the synthetic update again."
    };
  }

  return {
    kind: "error",
    text: "Synthetic COMMAND update was not appended. Review the listener error and adjust the draft.",
    detail: result.error
  };
}

function formatDraftFieldValue(value: DraftFieldValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function createFilterInput(label: string, className: string, placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = `filter-control ${className}`;
  input.setAttribute("aria-label", label);
  input.placeholder = placeholder;
  return input;
}

function createFilterSelect(
  label: string,
  className: string,
  options: Array<[string, string]>
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = `filter-control ${className}`;
  select.setAttribute("aria-label", label);

  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }

  return select;
}

function parseBooleanFilter(value: string): boolean | "" {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return "";
}

function appendDetailSection(parent: HTMLElement, heading: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  const section = document.createElement("section");
  section.className = "detail-section";
  section.append(createTextElement("h3", "detail-section-heading", heading));

  const pre = document.createElement("pre");
  pre.className = "detail-json";
  pre.textContent = JSON.stringify(value, null, 2);
  section.append(pre);
  parent.append(section);
}

function canCloneEvent(event: LightstreamerEventEnvelope): boolean {
  if (event.source !== "server" || event.synthetic) {
    return false;
  }
  const draft = createDraftFromEvent(event);
  return validateEditableDraft(draft).valid;
}

function createSourceContext(draft: ReinjectionDraft): HTMLElement {
  const context = document.createElement("div");
  context.className = "draft-source-context";

  const rows: Array<[string, string]> = [
    ["Source event", draft.sourceEventId],
    ["Subscription", draft.target.subscriptionId ?? "-"],
    ["Listener", draft.target.listenerId ?? "-"],
    ["Item", draft.item.name ?? String(draft.item.position ?? "-")],
    ["Command/key", `${draft.command ?? "-"}/${draft.key ?? "-"}`],
    ["Snapshot", draft.isSnapshot ? "snapshot" : "live"]
  ];

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "draft-source-row";
    row.append(
      createTextElement("span", "draft-source-label", label),
      createTextElement("span", "draft-source-value", value)
    );
    context.append(row);
  }

  const originalFields = document.createElement("pre");
  originalFields.className = "draft-source-fields";
  originalFields.textContent = JSON.stringify(draft.sourceFields, null, 2);
  context.append(createTextElement("h4", "draft-source-heading", "Original field values"));
  context.append(originalFields);

  return context;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatCommandKey(event: LightstreamerEventEnvelope): string {
  const command = event.update?.command ?? "-";
  const key = event.update?.key ?? "-";
  return `${command}/${key}`;
}

function formatMarker(event: LightstreamerEventEnvelope): string {
  const source =
    event.synthetic || event.source === "synthetic"
      ? "synthetic"
      : event.captureSource === "wire"
        ? "wire"
        : "server";
  const snapshot = event.update?.isSnapshot ? "snapshot" : "live";
  return `${source} ${snapshot}`;
}

function validationMessage(errors: string[]): string {
  if (errors.includes("Missing original listener target.")) {
    return "This draft came from wire-level capture, so it can be inspected and edited but cannot be reinjected through an original listener.";
  }

  return "Draft is missing required COMMAND values. Add a captured subscription, item, command/key, and valid field names before reinjecting.";
}

function createSyntheticProvenance(event: LightstreamerEventEnvelope): Record<string, unknown> | null {
  if (!event.synthetic && event.source !== "synthetic") {
    return null;
  }

  return {
    source: event.source,
    synthetic: event.synthetic,
    sourceEventId: event.raw?.sourceEventId ?? event.raw?.clonedSourceEventId ?? null,
    targetSubscriptionId: event.subscription?.id ?? null,
    targetListenerId: event.listener?.id ?? null,
    syntheticTimestamp: event.timestamp,
    editedFields: event.update?.changedFields ?? {}
  };
}

function bootPanel(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) {
    const panel = renderPanel(root);
    const bridge = connectPanelBridge({
      onStatusChange: panel.setStatus,
      onCaptureMessage: panel.appendCaptureMessage
    });
    panel.setBridge(bridge);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPanel, { once: true });
} else {
  bootPanel();
}
