import "./panel.css";

import {
  type CaptureMessage,
  type CaptureStatus,
  type ReinjectionResult,
  isPanelVisibilityMessage
} from "../../bridge/messages";
import { createEventNormalizer, type EventNormalizer } from "../../core/event-normalizer";
import {
  type EventStore,
  type EventStoreStats,
  type MaybePromise,
  createEventStore,
  createIndexedDbEventStore
} from "../../core/event-store";
import { type LightstreamerEventEnvelope } from "../../core/event-envelope";
import {
  hasActiveFilters,
  matchesEventFilters,
  type EventFilterState
} from "../../core/event-filter";
import {
  createCommandStateIndex,
  resolveCommandItemIdentity,
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
  createSourceReplayDraft,
  createNewCommandDraftFromContext,
  deriveChangedFields,
  updateDraftCommand,
  updateDraftField,
  updateDraftKey,
  updateDraftSnapshot,
  validateDraftForExecutionTarget,
  validateEditableDraft,
  validateNewCommandDraft,
  type CommandItemContext,
  type DraftFieldValue,
  type DraftFields,
  type NewCommandDraftDiagnostic,
  type ReinjectionDraft,
  type ReinjectionExecutionTarget
} from "../../core/reinjection-draft";
import { createSyntheticEventFromDraft } from "../../core/synthetic-event";
import { connectPanelBridge, type PanelBridgeConnection } from "./bridge-client";
import { createThemeManager, type ThemePreference } from "./theme";

type PanelState = {
  status: CaptureStatus;
};

export type PanelController = {
  setStatus(status: CaptureStatus): void;
  appendCaptureMessage(message: CaptureMessage): void;
  clearEvents(): void;
  setBridge(bridge: PanelReinjectBridge): void;
  setVisible(visible: boolean): void;
  dispose(): void;
};

export type RenderPanelOptions = {
  store?: EventStore;
  normalizer?: EventNormalizer;
  bridge?: PanelReinjectBridge;
  visible?: boolean;
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
type CommandItemEntry = {
  subscription: CommandSubscriptionGroup;
  item: CommandItemGroup;
};
type CommandFilterEvaluation = {
  filters: CommandFilterState;
  active: boolean;
  rowSearchText: WeakMap<CommandRow, CommandRowSearchProjection>;
  deletedSearchText: WeakMap<DeletedCommandKey, CommandRowSearchProjection>;
  diagnosticSearchText: WeakMap<CommandDiagnostic, string>;
  persistentSearchText: CommandSearchTextCache;
};
type CommandSearchProjection = {
  primary: readonly string[];
  lifecycle: CommandLifecycleSearchIndex;
};
type CommandLifecycleSearchIndex = {
  lifecycleLength: number;
  searchTextLength: number;
  lastEventId: string | null;
  lifecycleText: string[];
  tokenMatches: Map<string, boolean>;
  commands: Set<string>;
  diagnosticCodes: Set<string>;
  hasSnapshot: boolean;
  hasLive: boolean;
  hasSynthetic: boolean;
  hasServer: boolean;
};
type CommandRowSearchProjection = {
  searchText: CommandSearchProjection;
  lifecycle: CommandLifecycleSearchIndex;
};
type CommandSearchTextCache = {
  keys: Map<string, CommandLifecycleSearchIndex>;
};
type CommandDetailTarget =
  | { kind: "active"; row: CommandRow; item: CommandItemGroup }
  | { kind: "deleted"; row: DeletedCommandKey; item: CommandItemGroup }
  | { kind: "diagnostic"; diagnostic: CommandDiagnostic; item: CommandItemGroup };
type CommandKeyRow = CommandRow | DeletedCommandKey;
type CommandKeyDetailTarget = Extract<CommandDetailTarget, { kind: "active" | "deleted" }>;
type RenderOptions = {
  preservePaneState?: boolean;
};
type ScheduledRender = {
  cancel(): void;
};
type PaneState = {
  scrollTop: number;
  scrollLeft: number;
  focusSelector: string | null;
  selection: { start: number | null; end: number | null } | null;
  detailSections: Record<string, boolean>;
};
type CommandResizablePane = "subscriptions" | "keys" | "updates";
type CommandPaneWidths = Record<CommandResizablePane, number>;
type TimelineCodeFamily = "tlcp" | "workbench";
type TimelineCodeDefinition = {
  code: string;
  label: string;
  description: string;
  family: TimelineCodeFamily;
};

const initialState: PanelState = {
  status: "idle"
};

const TIMELINE_WINDOW_SIZE = 60;
const TIMELINE_LOAD_MORE_THRESHOLD = 32;
const COMMAND_ITEM_WINDOW_SIZE = 60;
const COMMAND_KEY_WINDOW_SIZE = 60;
const COMMAND_DIAGNOSTIC_WINDOW_SIZE = 32;
const COMMAND_LIFECYCLE_WINDOW_SIZE = 32;
const IMMEDIATE_APPEND_RENDER_BUDGET = 1;
const PANEL_RENDER_FALLBACK_MS = 32;
const COMMAND_DEFAULT_PANE_WIDTHS: CommandPaneWidths = {
  subscriptions: 250,
  keys: 360,
  updates: 420
};
const COMMAND_MIN_PANE_WIDTHS: CommandPaneWidths = {
  subscriptions: 180,
  keys: 220,
  updates: 240
};
const COMMAND_MAX_PANE_WIDTHS: CommandPaneWidths = {
  subscriptions: 520,
  keys: 780,
  updates: 860
};
const COMMAND_RESIZE_STEP = 24;
const COMMAND_RESIZE_LARGE_STEP = 80;
const TIMELINE_DEFAULT_DETAIL_WIDTH = 520;
const TIMELINE_MIN_DETAIL_WIDTH = 280;
const TIMELINE_MAX_DETAIL_WIDTH = 860;
const TIMELINE_RESIZE_STEP = 24;
const TIMELINE_RESIZE_LARGE_STEP = 80;
const TIMELINE_CODE_DEFINITIONS: readonly TimelineCodeDefinition[] = [
  {
    code: "U",
    label: "Update",
    description: "Item update; the TLCP U notification carries snapshot and live data.",
    family: "tlcp"
  },
  {
    code: "SUBOK",
    label: "Subscription active",
    description: "A non-COMMAND subscription is active.",
    family: "tlcp"
  },
  {
    code: "SUBCMD",
    label: "COMMAND subscription active",
    description: "A COMMAND subscription is active.",
    family: "tlcp"
  },
  {
    code: "UNSUB",
    label: "Unsubscribed",
    description: "The subscription ended.",
    family: "tlcp"
  },
  {
    code: "EOS",
    label: "End of snapshot",
    description: "The item snapshot is complete.",
    family: "tlcp"
  },
  {
    code: "CS",
    label: "Clear snapshot",
    description: "The item snapshot was cleared.",
    family: "tlcp"
  },
  {
    code: "OV",
    label: "Overflow",
    description: "One or more item updates were lost.",
    family: "tlcp"
  },
  {
    code: "C+",
    label: "Client observed",
    description: "Workbench captured a Lightstreamer client.",
    family: "workbench"
  },
  {
    code: "C~",
    label: "Client status",
    description: "Workbench captured a client status change.",
    family: "workbench"
  },
  {
    code: "S+",
    label: "Subscription observed",
    description: "Workbench captured subscription configuration before activation.",
    family: "workbench"
  },
  {
    code: "S~",
    label: "Subscription restored",
    description: "Workbench restored an already-active subscription into panel state.",
    family: "workbench"
  },
  {
    code: "S!",
    label: "Subscription error",
    description: "Workbench captured a subscription error callback.",
    family: "workbench"
  },
  {
    code: "L+",
    label: "Listener added",
    description: "Workbench observed a subscription listener being added.",
    family: "workbench"
  },
  {
    code: "L−",
    label: "Listener removed",
    description: "Workbench observed a subscription listener being removed.",
    family: "workbench"
  }
];
const activeTooltipDisposers = new WeakMap<HTMLElement, () => void>();
let helpTooltipIdCounter = 0;

function isBridgeReadyStatus(status: CaptureStatus): boolean {
  return status === "bridge connected" || status === "capturing";
}

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

function createProductLabel(): HTMLHeadingElement {
  const title = document.createElement("h1");
  title.className = "product-label";
  const icon = document.createElement("img");
  icon.className = "product-icon";
  icon.src = extensionAssetUrl("icons/title-icon.svg");
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.decoding = "async";
  const text = createTextElement("span", "product-label-text", "Lightstreamer Event Workbench");
  title.append(icon, text);
  return title;
}

function createTimelineCodeLegend(): HTMLDetailsElement {
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
      "Protocol tags stay aligned with Lightstreamer TLCP. Workbench-only capture lifecycle uses compact local codes."
    )
  );

  for (const [family, heading] of [
    ["tlcp", "Lightstreamer TLCP"],
    ["workbench", "Workbench lifecycle"]
  ] as const) {
    const group = document.createElement("section");
    group.className = "timeline-code-legend-group";
    group.dataset.family = family;
    group.append(createTextElement("h3", "timeline-code-legend-heading", heading));
    const definitions = document.createElement("dl");
    definitions.className = "timeline-code-legend-list";
    for (const definition of TIMELINE_CODE_DEFINITIONS.filter(
      (candidate) => candidate.family === family
    )) {
      definitions.append(
        createTextElement("dt", `timeline-legend-code code-${family}`, definition.code),
        createTextElement(
          "dd",
          "timeline-code-legend-description",
          `${definition.label} — ${definition.description}`
        )
      );
    }
    group.append(definitions);
    popover.append(group);
  }

  legend.append(summary, popover);
  return legend;
}

function extensionAssetUrl(path: string): string {
  const runtime = globalThis.chrome?.runtime;
  if (runtime && typeof runtime.getURL === "function") {
    return runtime.getURL(path);
  }
  return `/${path}`;
}

function createHelpIcon(label: string, help: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "command-help-icon";
  button.type = "button";
  button.setAttribute("aria-label", `${label}: ${help}`);
  button.dataset.tooltip = help;
  button.title = help;
  button.textContent = "?";
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

function createCommandHeaderCell(heading: string): HTMLSpanElement {
  return createTextElement("span", "command-current-cell", heading);
}

function installHelpTooltipOverlay(root: HTMLElement): { dispose(): void; hide(): void } {
  let tooltip: HTMLDivElement | null = null;
  let tooltipText: HTMLSpanElement | null = null;
  let activeTrigger: HTMLButtonElement | null = null;
  let activeTitle: string | null = null;

  const ensureTooltip = (): { tooltip: HTMLDivElement; text: HTMLSpanElement } => {
    if (tooltip && tooltipText) {
      return { tooltip, text: tooltipText };
    }
    tooltip = document.createElement("div");
    tooltip.className = "command-tooltip";
    tooltip.id = `command-help-tooltip-${++helpTooltipIdCounter}`;
    tooltip.role = "tooltip";
    tooltip.hidden = true;
    tooltipText = document.createElement("span");
    tooltipText.className = "command-tooltip-text";
    const tooltipArrow = document.createElement("span");
    tooltipArrow.className = "command-tooltip-arrow";
    tooltip.append(tooltipText, tooltipArrow);
    root.append(tooltip);
    return { tooltip, text: tooltipText };
  };

  const showTooltip = (trigger: HTMLButtonElement): void => {
    const tooltipValue = trigger.dataset.tooltip ?? trigger.getAttribute("title") ?? "";
    if (!tooltipValue) {
      return;
    }

    if (activeTrigger !== trigger) {
      restoreActiveTriggerTitle();
      activeTrigger = trigger;
      activeTitle = trigger.getAttribute("title");
      if (activeTitle !== null) {
        trigger.removeAttribute("title");
      }
    }

    const overlay = ensureTooltip();
    overlay.text.textContent = tooltipValue;
    overlay.tooltip.hidden = false;
    trigger.setAttribute("aria-describedby", overlay.tooltip.id);
    positionTooltip();
  };

  const hideTooltip = (trigger?: HTMLButtonElement | null): void => {
    if (trigger && trigger !== activeTrigger) {
      return;
    }
    restoreActiveTriggerTitle();
    activeTrigger = null;
    activeTitle = null;
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.remove();
      tooltip = null;
      tooltipText = null;
    }
  };

  const onPointerOver = (event: Event): void => {
    const trigger = findHelpTooltipTrigger(event.target);
    if (trigger) {
      showTooltip(trigger);
    }
  };

  const onPointerOut = (event: Event): void => {
    if (!activeTrigger) {
      return;
    }
    const pointerEvent = event as MouseEvent;
    if (pointerEvent.relatedTarget instanceof Node && activeTrigger.contains(pointerEvent.relatedTarget)) {
      return;
    }
    hideTooltip(findHelpTooltipTrigger(event.target));
  };

  const onFocusIn = (event: Event): void => {
    const trigger = findHelpTooltipTrigger(event.target);
    if (trigger) {
      showTooltip(trigger);
    }
  };

  const onFocusOut = (event: Event): void => {
    hideTooltip(findHelpTooltipTrigger(event.target));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      hideTooltip();
    }
  };

  function restoreActiveTriggerTitle(): void {
    if (!activeTrigger) {
      return;
    }
    if (activeTitle !== null) {
      activeTrigger.setAttribute("title", activeTitle);
    }
    activeTrigger.removeAttribute("aria-describedby");
  }

  function positionTooltip(): void {
    if (!activeTrigger || !tooltip || tooltip.hidden) {
      return;
    }
    if (!activeTrigger.isConnected || activeTrigger.closest("[hidden]")) {
      hideTooltip();
      return;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || root.clientWidth || 320;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || root.clientHeight || 320;
    const margin = 8;
    const gap = 8;
    const availableWidth = Math.max(160, viewportWidth - margin * 2);
    tooltip.style.maxWidth = `${Math.min(280, availableWidth)}px`;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";

    const triggerRect = activeTrigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = Math.min(tooltipRect.width || 280, availableWidth);
    const tooltipHeight = tooltipRect.height || 40;
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    const spaceAbove = triggerRect.top - margin;
    const spaceBelow = viewportHeight - triggerRect.bottom - margin;
    const placement = spaceAbove >= tooltipHeight + gap || spaceAbove >= spaceBelow ? "top" : "bottom";
    const unclampedTop = placement === "top" ? triggerRect.top - tooltipHeight - gap : triggerRect.bottom + gap;
    const left = clampNumber(triggerCenter - tooltipWidth / 2, margin, viewportWidth - margin - tooltipWidth);
    const top = clampNumber(unclampedTop, margin, viewportHeight - margin - tooltipHeight);
    const arrowLeft = clampNumber(triggerCenter - left, 12, tooltipWidth - 12);

    tooltip.dataset.placement = placement;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.setProperty("--tooltip-arrow-left", `${Math.round(arrowLeft)}px`);
  }

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("scroll", positionTooltip, true);
  window.addEventListener("resize", positionTooltip);

  const dispose = (): void => {
    hideTooltip();
    root.removeEventListener("pointerover", onPointerOver);
    root.removeEventListener("pointerout", onPointerOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("scroll", positionTooltip, true);
    window.removeEventListener("resize", positionTooltip);
    tooltip?.remove();
    tooltip = null;
    tooltipText = null;
  };
  activeTooltipDisposers.set(root, dispose);
  return {
    dispose,
    hide() {
      hideTooltip();
    }
  };
}

function findHelpTooltipTrigger(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLButtonElement>(".command-help-icon");
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function resolveMaybe<T>(
  value: MaybePromise<T>,
  onValue: (value: T) => void,
  onError: (error: unknown) => void = (error) => {
    console.error("Lightstreamer Event Workbench async operation failed", error);
  }
): void {
  if (value instanceof Promise) {
    void value.then(onValue, onError);
    return;
  }
  onValue(value);
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
  let timelineEvents: readonly LightstreamerEventEnvelope[] = [];
  let timelineQueryVersion = 0;
  let currentStoreStats: EventStoreStats = storeStatsSnapshot();
  let draft: ReinjectionDraft | null = null;
  let draftExecutionTarget: ReinjectionExecutionTarget = "captured-listener";
  let draftEditing = false;
  let draftJsonText: string | null = null;
  let draftJsonError: string | null = null;
  let detailCopyEventId: string | null = null;
  let detailCopyMessage: ReinjectionMessage | null = null;
  let workbenchSimulationSequence = 0;
  let bridge = options.bridge ?? null;
  // A bridge supplied at construction time is a test/embedded bridge with no
  // independent status channel. Production installs its bridge through
  // setBridge(), where readiness is gated by the reported capture status.
  let bridgeReady = Boolean(options.bridge);
  let reinjectionPending = false;
  let reinjectionMessage: ReinjectionMessage | null = null;
  let activeView: ActiveView = "timeline";
  let timelineDetailOpen = false;
  let timelineDetailWidth = TIMELINE_DEFAULT_DETAIL_WIDTH;
  let timelineWindowOffset = 0;
  let timelineHistoryAnchor = 0;
  let timelineFollowLatest = true;
  let timelineSelectionNeedsFilterReconciliation = false;
  let commandDetailOpen = true;
  const commandContextEvents: LightstreamerEventEnvelope[] = [];
  const commandContextEventIds = new Set<string>();
  const commandContextSubscriptionIds = new Set<string>();
  const commandStateIndex = createCommandStateIndex();
  let highVolumeNoticeDismissed = false;
  let selectedCommandItem: { subscriptionId: string; itemId: string } | null = null;
  let selectedCommandKey: CommandSelection = null;
  let selectedCommandUpdateEventId: string | null = null;
  let commandItemWindowOffset = 0;
  let commandKeyWindowOffset = 0;
  let commandDiagnosticWindowOffset = 0;
  let commandUpdateWindowOffset = 0;
  let commandUpdateHistoryAnchor = 0;
  let commandLifecycleExpanded = false;
  let commandWindowSelectionIdentity: string | null = null;
  let commandWindowLifecycleLength = 0;
  let visibleCommandUpdateEventIds = new Set<string>();
  const commandPaneWidths: CommandPaneWidths = { ...COMMAND_DEFAULT_PANE_WIDTHS };
  const filterState: EventFilterState = {};
  const commandFilterState: CommandFilterState = {};
  let pointerInteractionActive = false;
  let keyboardInteractionActive = false;
  let deferredInteractionRender: RenderOptions | null = null;
  let interactionFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let forceNextStoreRender = false;
  let pendingStoreRenderOptions: RenderOptions | null = null;
  let scheduledStoreRender: ScheduledRender | null = null;
  let immediateAppendRenderCount = 0;
  let appendRenderBudgetReset: ScheduledRender | null = null;
  let storeCloseStarted = false;
  let panelVisible = options.visible ?? true;
  const commandSearchTextCache: CommandSearchTextCache = {
    keys: new Map()
  };

  function storeStatsSnapshot(): EventStoreStats {
    return {
      retained: 0,
      totalAppended: 0,
      warningThreshold: 10_000,
      warningActive: false
    };
  }

  activeTooltipDisposers.get(root)?.();
  activeTooltipDisposers.delete(root);
  root.replaceChildren();
  root.className = "workbench-shell";
  const themeManager = createThemeManager({
    target: root,
    documentElement: document.documentElement
  });

  const toolbar = document.createElement("header");
  toolbar.className = "toolbar";

  const title = createProductLabel();

  const toolbarMeta = document.createElement("div");
  toolbarMeta.className = "toolbar-meta";

  const status = createTextElement("span", "status-badge", panelState.status);
  status.dataset.status = panelState.status;

  const eventCount = createTextElement("span", "event-count", "0");
  eventCount.setAttribute("aria-label", "0 captured events");

  const filteredCount = createTextElement("span", "filtered-count", "");
  filteredCount.hidden = true;

  const retentionNotice = document.createElement("span");
  retentionNotice.className = "retention-notice";
  retentionNotice.hidden = true;
  const eventVolumeText = createTextElement("span", "event-volume-text", "");
  const keepEventsButton = document.createElement("button");
  keepEventsButton.className = "event-volume-action";
  keepEventsButton.type = "button";
  keepEventsButton.textContent = "Keep events";
  keepEventsButton.title = "Dismiss this warning and keep captured events for this DevTools session.";
  keepEventsButton.addEventListener("click", () => {
    highVolumeNoticeDismissed = true;
    resolveMaybe(store.stats(), renderEventVolumeNotice);
  });
  retentionNotice.append(eventVolumeText, keepEventsButton);

  const clearButton = document.createElement("button");
  clearButton.className = "clear-button";
  clearButton.type = "button";
  clearButton.textContent = "Clear events";
  clearButton.title = "Clear events: remove captured events and COMMAND state from this DevTools session.";
  clearButton.addEventListener("click", () => {
    controller.clearEvents();
  });

  const themeControl = document.createElement("label");
  themeControl.className = "theme-control";
  themeControl.append(createTextElement("span", "theme-label", "Theme"));
  const themeSelect = document.createElement("select");
  themeSelect.className = "theme-select";
  themeSelect.setAttribute("aria-label", "Workbench theme");
  for (const [value, label] of [
    ["auto", "Auto"],
    ["dark", "Dark"],
    ["light", "Light"]
  ] as const satisfies ReadonlyArray<readonly [ThemePreference, string]>) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    themeSelect.append(option);
  }
  themeSelect.value = themeManager.preference;
  themeSelect.addEventListener("change", () => {
    themeManager.setPreference(themeSelect.value as ThemePreference);
  });
  themeControl.append(themeSelect);

  toolbarMeta.append(
    status,
    eventCount,
    filteredCount,
    retentionNotice,
    themeControl,
    clearButton
  );
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

  filterStrip.append(searchInput, createTimelineCodeLegend());

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

  commandFilterStrip.append(commandSearchInput);

  const workspace = document.createElement("section");
  workspace.className = "workspace";
  workspace.dataset.detailOpen = "false";

  const feed = document.createElement("section");
  feed.className = "event-feed";
  feed.setAttribute("aria-label", "Captured Lightstreamer events");

  const detail = document.createElement("aside");
  detail.className = "detail-pane";
  detail.setAttribute("aria-label", "Selected event detail");
  detail.hidden = true;

  const timelineDetailResizeHandle = createTimelineDetailResizeHandle();

  workspace.append(feed, timelineDetailResizeHandle, detail);
  applyTimelineDetailWidth();

  const commandWorkspace = document.createElement("section");
  commandWorkspace.className = "command-workspace";
  commandWorkspace.setAttribute("aria-label", "COMMAND state workbench");
  commandWorkspace.dataset.detailOpen = "true";

  const commandGroupPane = document.createElement("section");
  commandGroupPane.className = "command-group-pane";
  commandGroupPane.setAttribute("aria-label", "COMMAND subscription and item groups");

  const groupResizeHandle = createCommandResizeHandle("Subscriptions pane", "subscriptions");

  const commandCurrentTable = document.createElement("section");
  commandCurrentTable.className = "command-current-table";
  commandCurrentTable.setAttribute("aria-label", "COMMAND active current rows");

  const keysResizeHandle = createCommandResizeHandle("Keys pane", "keys");

  const commandUpdatePane = document.createElement("section");
  commandUpdatePane.className = "command-update-pane";
  commandUpdatePane.setAttribute("aria-label", "COMMAND updates for selected key");

  const updatesResizeHandle = createCommandResizeHandle("Updates pane", "updates");

  const commandDetailPane = document.createElement("aside");
  commandDetailPane.className = "command-detail-pane";
  commandDetailPane.setAttribute("aria-label", "COMMAND selected key detail");

  commandWorkspace.append(
    commandGroupPane,
    groupResizeHandle,
    commandCurrentTable,
    keysResizeHandle,
    commandUpdatePane,
    updatesResizeHandle,
    commandDetailPane
  );
  applyCommandPaneWidths();
  root.append(toolbar, viewSelector, filterStrip, commandFilterStrip, workspace, commandWorkspace);
  const helpTooltips = installHelpTooltipOverlay(root);
  feed.addEventListener("scroll", handleTimelineScroll);
  root.addEventListener("pointerdown", beginPointerInteraction, true);
  root.addEventListener("pointerup", endPointerInteraction, true);
  root.addEventListener("pointercancel", endPointerInteraction, true);
  root.addEventListener("click", endPointerInteraction, true);
  root.addEventListener("keydown", beginKeyboardInteraction, true);
  root.addEventListener("keyup", endKeyboardInteraction, true);
  window.addEventListener("pagehide", closeStore);
  window.addEventListener("beforeunload", closeStore);
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
    resetTimelineRenderLimit();
    timelineSelectionNeedsFilterReconciliation = true;
    renderFeed();
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
    resetCommandListWindows();
    renderCommandState();
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

  function renderActiveView(options: RenderOptions = {}): void {
    if (!panelVisible) {
      return;
    }
    if (activeView === "command") {
      renderCommandState(options);
      return;
    }
    renderFeed(options);
  }

  function renderActiveViewFromStoreUpdate(options: RenderOptions = {}): void {
    if (forceNextStoreRender) {
      forceNextStoreRender = false;
      deferredInteractionRender = null;
      renderActiveView(options);
      return;
    }

    if (isUserInteractionActive()) {
      deferredInteractionRender = mergeRenderOptions(deferredInteractionRender, options);
      return;
    }

    renderActiveView(options);
  }

  function renderActiveViewFromAppend(options: RenderOptions = {}): void {
    if (forceNextStoreRender) {
      cancelScheduledStoreRender();
      immediateAppendRenderCount = 0;
      renderActiveViewFromStoreUpdate(options);
      return;
    }

    if (scheduledStoreRender) {
      pendingStoreRenderOptions = mergeRenderOptions(pendingStoreRenderOptions, options);
      return;
    }

    if (immediateAppendRenderCount < IMMEDIATE_APPEND_RENDER_BUDGET) {
      immediateAppendRenderCount += 1;
      scheduleAppendRenderBudgetReset();
      renderActiveViewFromStoreUpdate(options);
      return;
    }

    scheduleStoreRender(options);
  }

  function scheduleStoreRender(options: RenderOptions = {}): void {
    pendingStoreRenderOptions = mergeRenderOptions(pendingStoreRenderOptions, options);
    if (scheduledStoreRender) {
      return;
    }

    scheduledStoreRender = schedulePanelFrame(() => {
      scheduledStoreRender = null;
      immediateAppendRenderCount = 0;
      const nextOptions = pendingStoreRenderOptions ?? {};
      pendingStoreRenderOptions = null;
      renderActiveViewFromStoreUpdate(nextOptions);
    });
  }

  function cancelScheduledStoreRender(): void {
    if (!scheduledStoreRender) {
      return;
    }

    cancelPanelFrame(scheduledStoreRender);
    scheduledStoreRender = null;
    pendingStoreRenderOptions = null;
  }

  function scheduleAppendRenderBudgetReset(): void {
    if (appendRenderBudgetReset) {
      return;
    }

    appendRenderBudgetReset = schedulePanelFrame(() => {
      appendRenderBudgetReset = null;
      immediateAppendRenderCount = 0;
    });
  }

  function cancelAppendRenderBudgetReset(): void {
    if (!appendRenderBudgetReset) {
      return;
    }

    cancelPanelFrame(appendRenderBudgetReset);
    appendRenderBudgetReset = null;
  }

  function schedulePanelFrame(callback: () => void): ScheduledRender {
    let completed = false;
    let animationFrameId: number | null = null;
    const timeoutId = window.setTimeout(run, PANEL_RENDER_FALLBACK_MS);

    if (typeof window.requestAnimationFrame === "function") {
      animationFrameId = window.requestAnimationFrame(run);
    }

    return { cancel };

    function run(): void {
      if (completed) {
        return;
      }
      completed = true;
      window.clearTimeout(timeoutId);
      if (animationFrameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrameId);
      }
      callback();
    }

    function cancel(): void {
      if (completed) {
        return;
      }
      completed = true;
      window.clearTimeout(timeoutId);
      if (animationFrameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrameId);
      }
    }
  }

  function cancelPanelFrame(render: ScheduledRender): void {
    render.cancel();
  }

  function beginPointerInteraction(): void {
    pointerInteractionActive = true;
    clearInteractionFlushTimer();
  }

  function endPointerInteraction(): void {
    if (!pointerInteractionActive) {
      return;
    }
    pointerInteractionActive = false;
    scheduleInteractionRenderFlush();
  }

  function beginKeyboardInteraction(event: KeyboardEvent): void {
    if (!isActivationKey(event)) {
      return;
    }
    keyboardInteractionActive = true;
    clearInteractionFlushTimer();
  }

  function endKeyboardInteraction(event: KeyboardEvent): void {
    if (!keyboardInteractionActive || !isActivationKey(event)) {
      return;
    }
    keyboardInteractionActive = false;
    scheduleInteractionRenderFlush();
  }

  function isActivationKey(event: KeyboardEvent): boolean {
    return event.key === "Enter" || event.key === " ";
  }

  function isUserInteractionActive(): boolean {
    return pointerInteractionActive || keyboardInteractionActive;
  }

  function mergeRenderOptions(left: RenderOptions | null, right: RenderOptions): RenderOptions {
    return {
      preservePaneState: Boolean(left?.preservePaneState || right.preservePaneState)
    };
  }

  function scheduleInteractionRenderFlush(): void {
    clearInteractionFlushTimer();
    interactionFlushTimer = setTimeout(() => {
      interactionFlushTimer = null;
      flushDeferredInteractionRender();
    }, 0);
  }

  function flushDeferredInteractionRender(): void {
    if (isUserInteractionActive() || !deferredInteractionRender) {
      return;
    }
    const options = deferredInteractionRender;
    deferredInteractionRender = null;
    renderActiveView(options);
  }

  function clearInteractionFlushTimer(): void {
    if (interactionFlushTimer) {
      clearTimeout(interactionFlushTimer);
      interactionFlushTimer = null;
    }
  }

  function resetTimelineRenderLimit(): void {
    timelineWindowOffset = 0;
    timelineHistoryAnchor = 0;
    timelineFollowLatest = true;
  }

  function handleTimelineScroll(): void {
    timelineFollowLatest = timelineWindowOffset === 0 && isTimelineNearBottom();
  }

  function isTimelineNearBottom(): boolean {
    const maximumScrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
    return maximumScrollTop - feed.scrollTop <= TIMELINE_LOAD_MORE_THRESHOLD;
  }

  function scrollTimelineToLatest(): void {
    feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
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

  function renderFeed(options: RenderOptions = {}, onRendered?: () => void): void {
    helpTooltips.hide();
    const queryVersion = ++timelineQueryVersion;
    resolveMaybe(
      store.queryEvents({
        filters: filterState,
        order: "asc",
        limit: TIMELINE_WINDOW_SIZE,
        offset: timelineWindowOffset
      }),
      (result) => {
        if (!panelVisible || queryVersion !== timelineQueryVersion) {
          return;
        }
        renderFeedResult(result.events, result.total, options);
        onRendered?.();
      }
    );
  }

  function renderFeedResult(
    renderedEvents: readonly LightstreamerEventEnvelope[],
    totalVisible: number,
    options: RenderOptions = {}
  ): void {
    const filtersActive = hasActiveFilters(filterState);
    timelineEvents = renderedEvents;

    filteredCount.hidden = !filtersActive;
    filteredCount.textContent = filtersActive ? `${totalVisible} shown` : "";
    filteredCount.setAttribute("aria-label", `${totalVisible} events shown`);

    if (currentStoreStats.retained === 0) {
      selectedEventId = null;
      selectedPinned = false;
      resetTimelineRenderLimit();
      clearDraftForSelection(null);
      renderEmptyState();
      renderDetail(null, options);
      return;
    }

    if (totalVisible === 0) {
      selectedEventId = null;
      resetTimelineRenderLimit();
      clearDraftForSelection(null);
      renderFilteredEmptyState();
      renderDetail(null, options);
      return;
    }

    const shouldFollowLatest = timelineFollowLatest;
    const feedState =
      options.preservePaneState || !shouldFollowLatest ? capturePaneState(feed) : null;

    const selectedStillVisible = renderedEvents.some((event) => event.id === selectedEventId);
    if (!selectedPinned) {
      selectedEventId = timelineDetailOpen ? renderedEvents[renderedEvents.length - 1]?.id ?? null : null;
    } else if (!selectedStillVisible && timelineSelectionNeedsFilterReconciliation) {
      selectedEventId = renderedEvents[renderedEvents.length - 1]?.id ?? null;
      timelineDetailOpen = Boolean(selectedEventId);
    }
    timelineSelectionNeedsFilterReconciliation = false;
    clearDraftForSelection(selectedEventId);

    const list = document.createElement("div");
    list.className = "event-list";
    list.append(createTimelineHeader());

    for (const event of renderedEvents) {
      const row = document.createElement("button");
      row.className = "event-row";
      row.type = "button";
      row.dataset.eventId = event.id;
      row.dataset.selected = String(event.id === selectedEventId);
      row.dataset.synthetic = String(event.synthetic || event.source === "synthetic");
      row.dataset.command = timelineCommandToken(event);
      row.dataset.kind = event.kind;
      row.dataset.source = timelineSourceToken(event);
      const codeDefinition = timelineCodeDefinition(event);
      row.dataset.code = codeDefinition.code;
      row.dataset.codeFamily = codeDefinition.family;
      row.title = timelineRowContextTitle(event);
      row.setAttribute("aria-label", timelineRowAccessibleLabel(event));
      row.addEventListener("click", () => {
        selectedEventId = event.id;
        selectedPinned = true;
        timelineDetailOpen = true;
        clearDraftForSelection(event.id);
        renderFeed();
        renderDetail(event);
      });

      const item = createTextElement("span", "event-cell event-item", formatTimelineItem(event));
      item.title = timelineItemTitle(event);
      const command = createTextElement(
        "span",
        "event-cell event-command",
        formatTimelineCommandKey(event)
      );
      command.title = timelineCommandKeyTitle(event);
      const marker = createTextElement("span", "event-cell event-marker", formatMarker(event));
      marker.title = timelineSourceTitle(event);

      row.append(
        createTimestampElement(event.timestamp, "event-cell event-time"),
        createTimelineCodeElement(event, "event-cell event-code"),
        item,
        command,
        marker
      );

      list.append(row);
    }

    const navigation =
      totalVisible > renderedEvents.length || timelineWindowOffset > 0
        ? createTimelineWindowNavigation(totalVisible, renderedEvents.length)
        : null;
    feed.replaceChildren(...(navigation ? [navigation, list] : [list]));
    restorePaneState(feed, feedState);
    if (shouldFollowLatest) {
      scrollTimelineToLatest();
    }
    renderSelectedTimelineDetail(options);
  }

  function createTimelineWindowNavigation(total: number, rendered: number): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "event-window-navigation";
    navigation.setAttribute("aria-label", "Timeline history window");

    const start = Math.max(1, total - timelineWindowOffset - rendered + 1);
    const end = Math.max(0, total - timelineWindowOffset);
    navigation.append(
      createTextElement(
        "span",
        "event-render-limit",
        `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} retained events.`
      )
    );

    const actions = document.createElement("span");
    actions.className = "window-navigation-actions";
    const older = createWindowNavigationButton("Older", timelineWindowOffset + rendered < total, () => {
      const nextOffset =
        timelineWindowOffset === 0 && timelineHistoryAnchor > 0
          ? timelineHistoryAnchor
          : timelineWindowOffset + TIMELINE_WINDOW_SIZE;
      timelineWindowOffset = Math.min(
        nextOffset,
        oldestWindowOffset(total, timelineHistoryAnchor, TIMELINE_WINDOW_SIZE)
      );
      timelineFollowLatest = false;
      renderFeed({ preservePaneState: true });
    });
    const newer = createWindowNavigationButton("Newer", timelineWindowOffset > 0, () => {
      timelineWindowOffset = Math.max(0, timelineWindowOffset - TIMELINE_WINDOW_SIZE);
      timelineFollowLatest = timelineWindowOffset === 0;
      renderFeed({ preservePaneState: true });
    });
    const latest = createWindowNavigationButton("Latest", timelineWindowOffset > 0, () => {
      timelineWindowOffset = 0;
      timelineFollowLatest = true;
      renderFeed({ preservePaneState: true });
    });
    actions.append(older, newer, latest);
    navigation.append(actions);
    return navigation;
  }

  function renderSelectedTimelineDetail(options: RenderOptions = {}): void {
    if (!selectedEventId) {
      renderDetail(null, options);
      return;
    }

    const cached = timelineEvents.find((event) => event.id === selectedEventId);
    if (cached) {
      renderDetail(cached, options);
      return;
    }

    const requestedEventId = selectedEventId;
    resolveMaybe(store.getEventById(requestedEventId), (event) => {
      if (selectedEventId !== requestedEventId || !timelineDetailOpen || !panelVisible) {
        return;
      }
      renderDetail(event, options);
    });
  }

  function renderDetail(
    event: LightstreamerEventEnvelope | null,
    options: RenderOptions = {}
  ): void {
    const paneState = options.preservePaneState ? capturePaneState(detail) : null;
    detail.replaceChildren();

    if (!event || !timelineDetailOpen) {
      detail.hidden = true;
      workspace.dataset.detailOpen = "false";
      return;
    }

    detail.hidden = false;
    workspace.dataset.detailOpen = "true";
    detail.append(createSelectedEventHeader(event));
    appendDraftSection(detail, event, draft?.sourceEventId === event.id ? draft : null);
    appendDetailSection(detail, "Changed fields", event.update?.changedFields ?? {}, {
      open: true,
      summary: `${Object.keys(event.update?.changedFields ?? {}).length} changed`
    });
    appendDetailSection(detail, "All current fields", event.update?.fields ?? {}, {
      summary: `${Object.keys(event.update?.fields ?? {}).length} fields`
    });
    appendDetailSection(
      detail,
      "Context",
      {
        envelope: {
          id: event.id,
          direction: event.direction,
          source: event.source,
          captureSource: event.captureSource ?? "listener",
          synthetic: event.synthetic,
          kind: event.kind
        },
        client: event.client ?? null,
        subscription: event.subscription ?? null,
        listener: event.listener ?? null,
        item: event.item ?? null,
        update: {
          command: event.update?.command ?? null,
          key: event.update?.key ?? null,
          isSnapshot: Boolean(event.update?.isSnapshot)
        }
      },
      { summary: `${event.subscription?.id ?? "no subscription"} · ${detailItemSummary(event.item)}` }
    );
    const syntheticProvenance = createSyntheticProvenance(event);
    if (syntheticProvenance) {
      appendDetailSection(detail, "Synthetic provenance", syntheticProvenance, {
        summary: String(event.raw?.sourceEventId ?? event.raw?.clonedSourceEventId ?? "synthetic")
      });
    }
    appendDetailSection(detail, "Raw capture", event.raw ?? {}, {
      summary: detailRawSummary(event.raw)
    });
    restorePaneState(detail, paneState);

    function createSelectedEventHeader(
      selectedEvent: LightstreamerEventEnvelope
    ): HTMLElement {
      const header = document.createElement("header");
      header.className = "selected-event-header";

      const summary = document.createElement("div");
      summary.className = "selected-event-summary";
      const sourceLabel = detailSourceLabel(selectedEvent);
      summary.append(
        createTimelineCodeElement(selectedEvent, "selected-event-kind"),
        createTextElement("strong", "selected-event-command", formatCommandKey(selectedEvent)),
        createTextElement(
          "span",
          `selected-event-source source-${safeClassSlug(sourceLabel)}`,
          sourceLabel
        ),
        createTextElement("span", "selected-event-id", selectedEvent.id)
      );

      const actions = document.createElement("div");
      actions.className = "selected-event-actions";
      const copyButton = document.createElement("button");
      copyButton.className = "copy-event-json-button";
      copyButton.type = "button";
      copyButton.textContent = "Copy JSON";
      copyButton.addEventListener("click", () => {
        void copyCanonicalEventJson(selectedEvent);
      });
      const closeButton = document.createElement("button");
      closeButton.className = "detail-collapse-button";
      closeButton.type = "button";
      closeButton.textContent = "Close";
      closeButton.setAttribute("aria-label", "Close selected event detail");
      closeButton.addEventListener("click", () => {
        timelineDetailOpen = false;
        renderFeed();
      });
      actions.append(copyButton, closeButton);

      const exactTime = document.createElement("p");
      exactTime.className = "detail-exact-time";
      exactTime.append(
        createTextElement("span", "detail-exact-time-label", "Captured"),
        createTimestampElement(selectedEvent.timestamp, "detail-exact-time-value", "precise")
      );
      header.append(summary, actions, exactTime);

      if (detailCopyEventId === selectedEvent.id && detailCopyMessage) {
        const message = createTextElement(
          "p",
          `detail-copy-message ${detailCopyMessage.kind}`,
          detailCopyMessage.text
        );
        if (detailCopyMessage.kind === "error") {
          message.setAttribute("role", "alert");
        } else {
          message.setAttribute("role", "status");
          message.setAttribute("aria-live", "polite");
        }
        header.append(message);
      }
      return header;
    }

    async function copyCanonicalEventJson(
      selectedEvent: LightstreamerEventEnvelope
    ): Promise<void> {
      detailCopyEventId = selectedEvent.id;
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard access is unavailable.");
        }
        await navigator.clipboard.writeText(JSON.stringify(selectedEvent, null, 2));
        detailCopyMessage = {
          kind: "success",
          text: "Copied the canonical selected event JSON."
        };
      } catch (error) {
        detailCopyMessage = {
          kind: "error",
          text: `Could not copy selected event JSON. ${error instanceof Error ? error.message : "Clipboard write failed."}`
        };
      }
      if (selectedEventId === selectedEvent.id) {
        renderDetail(selectedEvent, { preservePaneState: true });
      }
    }
  }

  function createTimelineDetailResizeHandle(): HTMLDivElement {
    const handle = document.createElement("div");
    handle.className = "timeline-resize-handle";
    handle.dataset.resizeTarget = "detail";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "Resize Event detail pane");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-valuemin", String(TIMELINE_MIN_DETAIL_WIDTH));
    handle.setAttribute("aria-valuemax", String(TIMELINE_MAX_DETAIL_WIDTH));
    handle.setAttribute("aria-valuenow", String(timelineDetailWidth));
    handle.title = "Drag to resize Event detail pane. Use Left and Right arrow keys for keyboard resizing.";
    handle.tabIndex = 0;
    handle.addEventListener("pointerdown", (event) => {
      startTimelineDetailResize(handle, event);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? 1 : -1;
      adjustTimelineDetailWidth(
        direction * (event.shiftKey ? TIMELINE_RESIZE_LARGE_STEP : TIMELINE_RESIZE_STEP)
      );
    });
    return handle;
  }

  function startTimelineDetailResize(handle: HTMLElement, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = timelineDetailWidth;
    workspace.dataset.resizing = "true";
    handle.dataset.resizing = "true";
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in tests or older embedded contexts.
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      setTimelineDetailWidth(startWidth + startX - moveEvent.clientX);
    };
    const stopResize = () => {
      delete workspace.dataset.resizing;
      delete handle.dataset.resizing;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures when capture was not established.
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function adjustTimelineDetailWidth(delta: number): void {
    setTimelineDetailWidth(timelineDetailWidth + delta);
  }

  function setTimelineDetailWidth(width: number): void {
    timelineDetailWidth = Math.round(
      clampNumber(width, TIMELINE_MIN_DETAIL_WIDTH, TIMELINE_MAX_DETAIL_WIDTH)
    );
    applyTimelineDetailWidth();
  }

  function applyTimelineDetailWidth(): void {
    workspace.style.setProperty("--timeline-detail-width", `${timelineDetailWidth}px`);
    timelineDetailResizeHandle.setAttribute("aria-valuenow", String(timelineDetailWidth));
  }

  function renderCommandState(options: RenderOptions = {}): void {
    helpTooltips.hide();
    const groupPaneState = options.preservePaneState ? capturePaneState(commandGroupPane) : null;
    const currentPaneState = options.preservePaneState
      ? capturePaneState(commandCurrentTable)
      : null;
    const updatePaneState = options.preservePaneState ? capturePaneState(commandUpdatePane) : null;
    const commandState = commandStateIndex.snapshot();
    const allItems = flattenCommandItems(commandState);
    const filterEvaluation = createCommandFilterEvaluation(
      commandFilterState,
      commandSearchTextCache
    );

    if (allItems.length === 0) {
      selectedCommandItem = null;
      selectedCommandKey = null;
      renderCommandEmptyState();
      return;
    }

    const items = filterCommandItems(allItems, filterEvaluation);
    if (items.length === 0) {
      selectedCommandKey = null;
      selectedCommandUpdateEventId = null;
      renderCommandNoMatchesState();
      return;
    }

    commandItemWindowOffset = clampStartWindowOffset(
      commandItemWindowOffset,
      items.length,
      COMMAND_ITEM_WINDOW_SIZE
    );
    const visibleItems = windowFromStart(
      items,
      commandItemWindowOffset,
      COMMAND_ITEM_WINDOW_SIZE
    );
    selectedCommandItem = validCommandItemSelection(visibleItems, selectedCommandItem) ?? {
      subscriptionId: visibleItems[0].subscription.subscriptionId,
      itemId: visibleItems[0].item.itemId
    };

    const selected = findSelectedCommandItem(visibleItems, selectedCommandItem) ?? visibleItems[0];
    renderCommandGroups(visibleItems, selected, items.length, allItems.length);
    renderCommandRowsAndResults(selected.subscription, selected.item, filterEvaluation);
    renderCommandDetail(selected.subscription, selected.item, commandState, options);
    restorePaneState(commandGroupPane, groupPaneState);
    restorePaneState(commandCurrentTable, currentPaneState);
    restorePaneState(commandUpdatePane, updatePaneState);
  }

  function renderCommandEmptyState(): void {
    commandDetailPane.hidden = true;
    commandWorkspace.dataset.detailOpen = "false";
    commandGroupPane.replaceChildren(
      createTextElement("h2", "command-pane-heading", "No COMMAND state yet"),
      createTextElement(
        "p",
        "command-empty-body",
        "Capture a COMMAND subscription or select a captured COMMAND item update. ADD snapshot and live updates will populate current rows."
      )
    );
    commandCurrentTable.replaceChildren(
      createTextElement("p", "command-empty-body", "Select a COMMAND subscription item to inspect keys.")
    );
    commandUpdatePane.replaceChildren(
      createTextElement("p", "command-empty-body", "Select a COMMAND key to inspect its updates.")
    );
    commandDetailPane.replaceChildren(
      createTextElement(
        "p",
        "command-empty-body",
        "Select a key or update to inspect its COMMAND details."
      )
    );
  }

  function renderCommandNoMatchesState(): void {
    commandDetailPane.hidden = true;
    commandWorkspace.dataset.detailOpen = "false";
    commandGroupPane.replaceChildren(
      createTextElement("h2", "command-pane-heading", "No matching COMMAND items"),
      createTextElement(
        "p",
        "command-empty-body",
        "No subscriptions or items match the current search. Clear the search or try a broader query."
      )
    );
    commandCurrentTable.replaceChildren(
      createTextElement(
        "p",
        "command-empty-body",
        "No keys to show because no COMMAND items match."
      )
    );
    commandUpdatePane.replaceChildren(
      createTextElement(
        "p",
        "command-empty-body",
        "No updates to show because no COMMAND items match."
      )
    );
    commandDetailPane.replaceChildren();
  }

  function renderCommandGroups(
    items: readonly CommandItemEntry[],
    selected: CommandItemEntry,
    matchingItems: number,
    totalItems: number
  ): void {
    commandGroupPane.replaceChildren(
      createTextElement(
        "h2",
        "command-pane-heading",
        matchingItems === totalItems
          ? "Subscriptions"
          : `Subscriptions (${matchingItems} of ${totalItems})`
      )
    );

    if (matchingItems > items.length || commandItemWindowOffset > 0) {
      commandGroupPane.append(
        createCommandCollectionNavigation({
          ariaLabel: "COMMAND subscription item window",
          statusClass: "command-item-window-status",
          noun: "items",
          total: matchingItems,
          rendered: items.length,
          offset: commandItemWindowOffset,
          windowSize: COMMAND_ITEM_WINDOW_SIZE,
          onOffset(nextOffset) {
            commandItemWindowOffset = nextOffset;
            selectedCommandItem = null;
            selectedCommandKey = null;
            selectedCommandUpdateEventId = null;
            resetCommandListWindows({ preserveItems: true });
            renderCommandState({ preservePaneState: true });
          }
        })
      );
    }

    let currentSubscriptionId = "";
    for (const entry of items) {
      if (entry.subscription.subscriptionId !== currentSubscriptionId) {
        currentSubscriptionId = entry.subscription.subscriptionId;
        const subscriptionSummary = createTextElement(
          "div",
          "command-subscription-summary",
          entry.subscription.subscriptionId
        );
        subscriptionSummary.setAttribute(
          "aria-label",
          `${entry.subscription.mode ?? "COMMAND"} subscription ${entry.subscription.subscriptionId}`
        );
        commandGroupPane.append(subscriptionSummary);
      }

      const itemButton = document.createElement("button");
      itemButton.className = "command-item-button";
      itemButton.type = "button";
      itemButton.dataset.subscriptionId = entry.subscription.subscriptionId;
      itemButton.dataset.itemId = entry.item.itemId;
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
        selectedCommandUpdateEventId = null;
        resetCommandListWindows({ preserveItems: true });
        resetCommandLifecycleWindow();
        renderCommandState();
      });
      itemButton.append(createTextElement("span", "command-item-title", commandItemLabel(entry.item)));
      commandGroupPane.append(itemButton);
    }
  }

  function renderCommandRowsAndResults(
    subscription: CommandSubscriptionGroup,
    item: CommandItemGroup,
    filterEvaluation: CommandFilterEvaluation
  ): void {
    const matchingRows = filterEvaluation.active
      ? item.activeRows.filter((row) =>
          matchesCommandRow(row, item, subscription, filterEvaluation)
        )
      : item.activeRows;
    const matchingDeleted = filterEvaluation.active
      ? item.deletedKeys.filter((row) =>
          matchesDeletedCommandKey(row, item, subscription, filterEvaluation)
        )
      : item.deletedKeys;
    const matchingDiagnostics = filterEvaluation.active
      ? item.diagnostics.filter((diagnostic) =>
          matchesCommandDiagnostic(diagnostic, item, filterEvaluation)
        )
      : [];
    const matchingKeys: CommandKeyRow[] = [...matchingRows, ...matchingDeleted];
    commandKeyWindowOffset = clampStartWindowOffset(
      commandKeyWindowOffset,
      matchingKeys.length,
      COMMAND_KEY_WINDOW_SIZE
    );
    commandDiagnosticWindowOffset = clampStartWindowOffset(
      commandDiagnosticWindowOffset,
      matchingDiagnostics.length,
      COMMAND_DIAGNOSTIC_WINDOW_SIZE
    );
    const visibleKeys = windowFromStart(
      matchingKeys,
      commandKeyWindowOffset,
      COMMAND_KEY_WINDOW_SIZE
    );
    const visibleRows = visibleKeys.filter((row): row is CommandRow => row.status === "active");
    const visibleDeleted = visibleKeys.filter(
      (row): row is DeletedCommandKey => row.status === "deleted"
    );
    const visibleDiagnostics = windowFromStart(
      matchingDiagnostics,
      commandDiagnosticWindowOffset,
      COMMAND_DIAGNOSTIC_WINDOW_SIZE
    );

    const previousSelection = selectedCommandKey;
    selectedCommandKey = reconcileCommandSelection(
      item,
      selectedCommandKey,
      visibleRows,
      visibleDeleted,
      visibleDiagnostics
    );
    if (!commandSelectionsEqual(previousSelection, selectedCommandKey)) {
      selectedCommandUpdateEventId = null;
      resetCommandLifecycleWindow();
    }

    const header = document.createElement("div");
    header.className = "command-current-header";
    for (const heading of ["Key", "Updates", "Last seen"]) {
      header.append(createCommandHeaderCell(heading));
    }

    const rows = document.createElement("div");
    rows.className = "command-current-rows";
    for (const row of visibleKeys) {
      const button = document.createElement("button");
      button.className = "command-current-row";
      button.type = "button";
      button.dataset.subscriptionId = row.subscriptionId;
      button.dataset.itemId = row.itemId;
      button.dataset.key = row.key;
      button.dataset.status = row.status;
      button.dataset.selected = String(commandSelectionMatchesKey(selectedCommandKey, row));
      button.setAttribute(
        "aria-label",
        `${row.key}, ${row.status}, ${row.lifecycle.length} updates, last seen ${formatExactLocalTime(latestKeyProvenance(row).timestamp)}`
      );
      button.addEventListener("click", () => {
        const nextSelection = commandSelectionForKey(row);
        selectedCommandUpdateEventId = null;
        selectedCommandKey = nextSelection;
        resetCommandLifecycleWindow();
        commandDetailOpen = true;
        renderCommandState();
      });
      button.append(
        createTextElement("span", "command-current-cell command-key-cell", row.key),
        createTextElement("span", "command-current-cell", String(row.lifecycle.length)),
        createTimestampElement(
          latestKeyProvenance(row).timestamp,
          "command-current-cell command-current-time"
        )
      );
      rows.append(button);
    }

    const selectedTarget = selectedCommandKey ? findCommandDetailTarget(item, selectedCommandKey) : null;
    const selectedLifecycle =
      selectedTarget?.kind === "active" || selectedTarget?.kind === "deleted"
        ? selectedTarget.row.lifecycle
        : [];
    const selectionIdentity = selectedTarget
      ? commandSelectionIdentity(selectedCommandKey)
      : null;
    if (
      selectionIdentity &&
      selectionIdentity === commandWindowSelectionIdentity &&
      selectedLifecycle.length > commandWindowLifecycleLength
    ) {
      if (commandUpdateWindowOffset > 0) {
        commandUpdateWindowOffset += selectedLifecycle.length - commandWindowLifecycleLength;
        commandUpdateHistoryAnchor =
          commandUpdateWindowOffset % COMMAND_LIFECYCLE_WINDOW_SIZE;
      } else {
        commandUpdateHistoryAnchor = 0;
      }
    }
    commandWindowSelectionIdentity = selectionIdentity;
    commandWindowLifecycleLength = selectedLifecycle.length;
    if (
      selectedCommandUpdateEventId &&
      !selectedLifecycle.some((entry) => entry.eventId === selectedCommandUpdateEventId)
    ) {
      selectedCommandUpdateEventId = null;
    }

    const updates = document.createElement("section");
    updates.className = "command-update-list";
    updates.append(
      createTextElement(
        "h3",
        "command-results-heading",
        selectedTarget?.kind === "diagnostic"
          ? "Selected diagnostic · no key lifecycle"
          : selectedCommandKey
            ? `Updates · ${selectedCommandKey.key ?? "selected key"} · ${selectedLifecycle.length}`
            : "Updates"
      )
    );

    if (selectedLifecycle.length > 0) {
      commandUpdateWindowOffset = clampWindowOffset(
        commandUpdateWindowOffset,
        selectedLifecycle.length,
        COMMAND_LIFECYCLE_WINDOW_SIZE
      );
      const visibleLifecycle = windowFromLatest(
        selectedLifecycle,
        commandUpdateWindowOffset,
        COMMAND_LIFECYCLE_WINDOW_SIZE
      );
      visibleCommandUpdateEventIds = new Set(visibleLifecycle.map((entry) => entry.eventId));
      if (selectedLifecycle.length > visibleLifecycle.length || commandUpdateWindowOffset > 0) {
        updates.append(
          createCommandLifecycleNavigation(selectedLifecycle.length, visibleLifecycle.length)
        );
      }
      updates.append(createCommandUpdateHeader());
      for (const entry of visibleLifecycle) {
        const updateRow = document.createElement("button");
        updateRow.className = "command-update-row";
        updateRow.type = "button";
        updateRow.dataset.eventId = entry.eventId;
        updateRow.dataset.selected = String(selectedCommandUpdateEventId === entry.eventId);
        updateRow.addEventListener("click", () => {
          selectedCommandUpdateEventId = entry.eventId;
          commandDetailOpen = true;
          renderCommandState();
        });
        updateRow.append(
          createTimestampElement(
            entry.timestamp,
            "command-update-cell command-update-time"
          ),
          createTextElement("span", "command-update-cell command-update-event", entry.eventId),
          createTextElement("span", "command-update-cell", entry.originalCommand ?? "-")
        );
        updates.append(updateRow);
      }
    } else {
      visibleCommandUpdateEventIds = new Set();
    }

    const emptyRows =
      matchingKeys.length === 0
        ? createTextElement(
            "p",
            "command-empty-body",
            matchingDiagnostics.length > 0
              ? "No keys match this search. Matching diagnostics are listed below."
              : "No keys match this item and search query."
          )
        : null;

    const diagnosticResults = document.createElement("section");
    diagnosticResults.className = "command-diagnostic-results";
    if (matchingDiagnostics.length > 0) {
      diagnosticResults.append(
        createTextElement(
          "h3",
          "command-results-heading",
          `Diagnostics (${matchingDiagnostics.length})`
        )
      );
      if (
        matchingDiagnostics.length > visibleDiagnostics.length ||
        commandDiagnosticWindowOffset > 0
      ) {
        diagnosticResults.append(
          createCommandCollectionNavigation({
            ariaLabel: "COMMAND diagnostic results window",
            statusClass: "command-diagnostic-window-status",
            noun: "diagnostics",
            total: matchingDiagnostics.length,
            rendered: visibleDiagnostics.length,
            offset: commandDiagnosticWindowOffset,
            windowSize: COMMAND_DIAGNOSTIC_WINDOW_SIZE,
            onOffset(nextOffset) {
              commandDiagnosticWindowOffset = nextOffset;
              selectedCommandKey = null;
              selectedCommandUpdateEventId = null;
              resetCommandLifecycleWindow();
              renderCommandState({ preservePaneState: true });
            }
          })
        );
      }
      for (const diagnostic of visibleDiagnostics) {
        const result = document.createElement("button");
        result.className = "command-diagnostic-result";
        result.type = "button";
        result.dataset.selected = String(
          commandSelectionMatchesDiagnostic(selectedCommandKey, item, diagnostic)
        );
        result.setAttribute(
          "aria-label",
          `${diagnostic.key ?? "unknown key"}, diagnostic ${diagnostic.code}, event ${diagnostic.eventId ?? "unknown"}`
        );
        result.addEventListener("click", () => {
          selectedCommandUpdateEventId = null;
          selectedCommandKey = commandSelectionForDiagnostic(item, diagnostic);
          resetCommandLifecycleWindow();
          commandDetailOpen = true;
          renderCommandState();
        });
        result.append(
          createTextElement("span", "command-diagnostic-key", diagnostic.key ?? "unknown key"),
          createTextElement("span", "command-diagnostic-code", diagnostic.code),
          createTextElement("span", "command-diagnostic-event", diagnostic.eventId ?? "-")
        );
        diagnosticResults.append(result);
      }
    }

    const keyNavigation =
      matchingKeys.length > visibleKeys.length || commandKeyWindowOffset > 0
        ? createCommandCollectionNavigation({
            ariaLabel: "COMMAND key results window",
            statusClass: "command-key-window-status",
            noun: "keys",
            total: matchingKeys.length,
            rendered: visibleKeys.length,
            offset: commandKeyWindowOffset,
            windowSize: COMMAND_KEY_WINDOW_SIZE,
            onOffset(nextOffset) {
              commandKeyWindowOffset = nextOffset;
              selectedCommandKey = null;
              selectedCommandUpdateEventId = null;
              resetCommandLifecycleWindow();
              renderCommandState({ preservePaneState: true });
            }
          })
        : null;
    commandCurrentTable.replaceChildren(...(keyNavigation ? [keyNavigation, header, rows] : [header, rows]));
    if (emptyRows) {
      commandCurrentTable.append(emptyRows);
    }
    if (matchingDiagnostics.length > 0) {
      commandCurrentTable.append(diagnosticResults);
    }
    commandUpdatePane.replaceChildren(updates);
  }

  function createCommandLifecycleNavigation(total: number, rendered: number): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "command-window-navigation";
    navigation.setAttribute("aria-label", "Selected key update history window");
    const start = Math.max(1, total - commandUpdateWindowOffset - rendered + 1);
    const end = Math.max(0, total - commandUpdateWindowOffset);
    navigation.append(
      createTextElement(
        "span",
        "command-window-status",
        `Showing updates ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}.`
      )
    );
    const actions = document.createElement("span");
    actions.className = "window-navigation-actions";
    actions.append(
      createWindowNavigationButton(
        "Older",
        commandUpdateWindowOffset + rendered < total,
        () => {
          const nextOffset =
            commandUpdateWindowOffset === 0 && commandUpdateHistoryAnchor > 0
              ? commandUpdateHistoryAnchor
              : commandUpdateWindowOffset + COMMAND_LIFECYCLE_WINDOW_SIZE;
          commandUpdateWindowOffset = Math.min(
            nextOffset,
            oldestWindowOffset(
              total,
              commandUpdateHistoryAnchor,
              COMMAND_LIFECYCLE_WINDOW_SIZE
            )
          );
          renderCommandState({ preservePaneState: true });
        }
      ),
      createWindowNavigationButton("Newer", commandUpdateWindowOffset > 0, () => {
        commandUpdateWindowOffset = Math.max(
          0,
          commandUpdateWindowOffset - COMMAND_LIFECYCLE_WINDOW_SIZE
        );
        renderCommandState({ preservePaneState: true });
      }),
      createWindowNavigationButton("Latest", commandUpdateWindowOffset > 0, () => {
        commandUpdateWindowOffset = 0;
        renderCommandState({ preservePaneState: true });
      })
    );
    navigation.append(actions);
    return navigation;
  }

  function createCommandCollectionNavigation(options: {
    ariaLabel: string;
    statusClass: string;
    noun: string;
    total: number;
    rendered: number;
    offset: number;
    windowSize: number;
    onOffset(offset: number): void;
  }): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "command-window-navigation command-collection-navigation";
    navigation.setAttribute("aria-label", options.ariaLabel);
    const start = options.total === 0 ? 0 : options.offset + 1;
    const end = Math.min(options.total, options.offset + options.rendered);
    navigation.append(
      createTextElement(
        "span",
        `command-window-status ${options.statusClass}`,
        `Showing ${options.noun} ${start.toLocaleString()}–${end.toLocaleString()} of ${options.total.toLocaleString()}.`
      )
    );
    const actions = document.createElement("span");
    actions.className = "window-navigation-actions";
    actions.append(
      createWindowNavigationButton("Previous", options.offset > 0, () => {
        options.onOffset(Math.max(0, options.offset - options.windowSize));
      }),
      createWindowNavigationButton(
        "Next",
        options.offset + options.rendered < options.total,
        () => {
          options.onOffset(
            Math.min(
              options.offset + options.windowSize,
              lastStartWindowOffset(options.total, options.windowSize)
            )
          );
        }
      )
    );
    navigation.append(actions);
    return navigation;
  }

  function resetCommandListWindows(options: { preserveItems?: boolean } = {}): void {
    if (!options.preserveItems) {
      commandItemWindowOffset = 0;
    }
    commandKeyWindowOffset = 0;
    commandDiagnosticWindowOffset = 0;
  }

  function resetCommandLifecycleWindow(): void {
    commandUpdateWindowOffset = 0;
    commandUpdateHistoryAnchor = 0;
    commandLifecycleExpanded = false;
    commandWindowSelectionIdentity = null;
    commandWindowLifecycleLength = 0;
  }

  function renderCommandDetail(
    subscription: CommandSubscriptionGroup,
    item: CommandItemGroup,
    commandState: CommandState,
    options: RenderOptions = {}
  ): void {
    const paneState = options.preservePaneState ? capturePaneState(commandDetailPane) : null;
    commandDetailPane.replaceChildren();
    if (!commandDetailOpen) {
      commandDetailPane.hidden = true;
      commandWorkspace.dataset.detailOpen = "false";
      return;
    }

    commandDetailPane.hidden = false;
    commandWorkspace.dataset.detailOpen = "true";
    const collapseCommandDetail = () => {
      commandDetailOpen = false;
      renderCommandState();
    };
    const context = createCommandItemContext(subscription, item, commandContextEvents);

    if (!selectedCommandKey) {
      commandDetailPane.append(
        createDetailPaneHeader("COMMAND detail", collapseCommandDetail),
        createTextElement(
          "p",
          "command-empty-body",
          "Select a key or update to inspect its COMMAND details."
        )
      );
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    const target = findCommandDetailTarget(item, selectedCommandKey);
    if (!target) {
      commandDetailPane.append(
        createDetailPaneHeader("COMMAND detail", collapseCommandDetail),
        createTextElement("p", "command-empty-body", "Selected COMMAND key is no longer available.")
      );
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    if (target.kind === "diagnostic") {
      renderCommandDiagnosticDetail(target.diagnostic, collapseCommandDetail);
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    if (selectedCommandUpdateEventId) {
      const update = target.row.lifecycle.find((entry) => entry.eventId === selectedCommandUpdateEventId);
      if (update) {
        renderCommandUpdateDetail(target, update, collapseCommandDetail);
        appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
        restorePaneState(commandDetailPane, paneState);
        return;
      }
    }

    if (target.kind === "active") {
      const row = target.row;
      commandDetailPane.append(
        createDetailPaneHeader(`Key ${row.key} - ${row.status}`, collapseCommandDetail)
      );

      const summary = document.createElement("section");
      summary.className = "command-detail-summary";
      summary.append(
        createCommandSummaryRow("Subscription", row.subscriptionId),
        createCommandSummaryRow("Item", commandItemLabel(item)),
        createCommandSummaryRow("Origin", provenanceLabel(row.origin)),
        createCommandSummaryRow("Latest", latestRowLabel(row))
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
      appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    const row = target.row;
    commandDetailPane.append(
      createDetailPaneHeader(`Key ${row.key} - ${row.status}`, collapseCommandDetail)
    );

    const summary = document.createElement("section");
    summary.className = "command-detail-summary";
    summary.append(
      createCommandSummaryRow("Subscription", row.subscriptionId),
      createCommandSummaryRow("Item", commandItemLabel(item)),
      createCommandSummaryRow("Origin", "deleted"),
      createCommandSummaryRow("Latest", "server DELETE")
    );
    commandDetailPane.append(summary);

    appendCommandLifecycle(row.lifecycle);
    appendNewCommandDraftSection(commandDetailPane, context, item, commandState);
    restorePaneState(commandDetailPane, paneState);
  }

  function createCommandResizeHandle(
    label: string,
    pane: CommandResizablePane
  ): HTMLDivElement {
    const handle = document.createElement("div");
    handle.className = "command-resize-handle";
    handle.dataset.resizeTarget = pane;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", `Resize ${label}`);
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-valuemin", String(COMMAND_MIN_PANE_WIDTHS[pane]));
    handle.setAttribute("aria-valuemax", String(COMMAND_MAX_PANE_WIDTHS[pane]));
    handle.setAttribute("aria-valuenow", String(commandPaneWidths[pane]));
    handle.title = `Drag to resize ${label}. Use Left and Right arrow keys for keyboard resizing.`;
    handle.tabIndex = 0;
    handle.addEventListener("pointerdown", (event) => {
      startCommandPaneResize(handle, pane, event);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      adjustCommandPaneWidth(
        pane,
        direction * (event.shiftKey ? COMMAND_RESIZE_LARGE_STEP : COMMAND_RESIZE_STEP)
      );
    });
    return handle;
  }

  function startCommandPaneResize(
    handle: HTMLElement,
    pane: CommandResizablePane,
    event: PointerEvent
  ): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = commandPaneWidths[pane];
    commandWorkspace.dataset.resizing = "true";
    handle.dataset.resizing = "true";
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in tests or older embedded contexts.
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      setCommandPaneWidth(pane, startWidth + moveEvent.clientX - startX);
    };
    const stopResize = () => {
      delete commandWorkspace.dataset.resizing;
      delete handle.dataset.resizing;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures when capture was not established.
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function adjustCommandPaneWidth(pane: CommandResizablePane, delta: number): void {
    setCommandPaneWidth(pane, commandPaneWidths[pane] + delta);
  }

  function setCommandPaneWidth(pane: CommandResizablePane, width: number): void {
    commandPaneWidths[pane] = Math.round(
      Math.min(COMMAND_MAX_PANE_WIDTHS[pane], Math.max(COMMAND_MIN_PANE_WIDTHS[pane], width))
    );
    applyCommandPaneWidths();
  }

  function applyCommandPaneWidths(): void {
    commandWorkspace.style.setProperty(
      "--command-subscriptions-width",
      `${commandPaneWidths.subscriptions}px`
    );
    commandWorkspace.style.setProperty("--command-keys-width", `${commandPaneWidths.keys}px`);
    commandWorkspace.style.setProperty("--command-updates-width", `${commandPaneWidths.updates}px`);
    for (const handle of commandWorkspace.querySelectorAll<HTMLElement>(".command-resize-handle")) {
      const pane = handle.dataset.resizeTarget as CommandResizablePane | undefined;
      if (pane && pane in commandPaneWidths) {
        handle.setAttribute("aria-valuenow", String(commandPaneWidths[pane]));
      }
    }
  }

  function renderCommandDiagnosticDetail(
    diagnostic: CommandDiagnostic,
    onCollapse: () => void
  ): void {
    commandDetailPane.append(createDetailPaneHeader("COMMAND diagnostic", onCollapse));
    const pre = document.createElement("pre");
    pre.className = "command-json";
    pre.textContent = JSON.stringify(diagnostic, null, 2);
    commandDetailPane.append(pre);
  }

  function renderCommandUpdateDetail(
    target: CommandKeyDetailTarget,
    entry: CommandLifecycleEntry,
    onCollapse: () => void
  ): void {
    commandDetailPane.append(createDetailPaneHeader(`Update ${entry.eventId}`, onCollapse));
    const summary = document.createElement("section");
    summary.className = "command-detail-summary";
    summary.append(
      createCommandSummaryRow("Subscription", target.row.subscriptionId),
      createCommandSummaryRow("Item", commandItemLabel(target.item)),
      createCommandSummaryRow("Key", entry.key),
      createCommandSummaryRow("Command", entry.originalCommand ?? "-"),
      createCommandSummaryRow("Source", provenanceLabel(entry.provenance))
    );
    if (!visibleCommandUpdateEventIds.has(entry.eventId)) {
      summary.append(createCommandSummaryTimeRow("Time", entry.timestamp));
    }
    commandDetailPane.append(summary);

    const fields = document.createElement("section");
    fields.className = "command-current-fields";
    fields.append(
      createHelpHeading(
        "h3",
        "command-detail-section-heading",
        "Update payload",
        "The fields and changed fields captured for this COMMAND update."
      )
    );
    const fieldsJson = document.createElement("pre");
    fieldsJson.className = "command-json";
    fieldsJson.textContent = JSON.stringify(
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
    fields.append(fieldsJson);
    commandDetailPane.append(fields);
  }

  function appendCommandLifecycle(lifecycle: readonly CommandLifecycleEntry[]): void {
    const section = document.createElement("section");
    section.className = "command-lifecycle";
    section.setAttribute("aria-label", "Selected key lifecycle");

    const toggle = document.createElement("button");
    toggle.className = "command-lifecycle-toggle";
    toggle.type = "button";
    toggle.textContent = commandLifecycleExpanded
      ? `Hide lifecycle payloads (${lifecycle.length})`
      : `Show lifecycle payloads (${lifecycle.length})`;
    toggle.setAttribute("aria-expanded", String(commandLifecycleExpanded));
    toggle.addEventListener("click", () => {
      commandLifecycleExpanded = !commandLifecycleExpanded;
      renderCommandState({ preservePaneState: true });
    });
    section.append(toggle);

    if (!commandLifecycleExpanded) {
      commandDetailPane.append(section);
      return;
    }

    const visibleLifecycle = windowFromLatest(
      lifecycle,
      commandUpdateWindowOffset,
      COMMAND_LIFECYCLE_WINDOW_SIZE
    );
    for (const entry of visibleLifecycle) {
      const lifecycleEntry = document.createElement("div");
      lifecycleEntry.className = "command-lifecycle-entry";
      lifecycleEntry.append(
        createTextElement(
          "div",
          "command-lifecycle-line",
          `${entry.eventId} ${entry.originalCommand ?? "-"} ${provenanceLabel(entry.provenance)}`
        ),
        createTextElement(
          "div",
          "command-lifecycle-line",
          `changed ${Object.keys(entry.changedFields).join(", ") || "none"}`
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
      renderCommandState();
    });

    section.append(createButton);

    if (draft?.provenance.source === "new-command" && !commandDraftMatchesContext(draft, context)) {
      draft = null;
      reinjectionMessage = null;
    }

    if (!draft || draft.provenance.source !== "new-command") {
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
    injectButton.disabled = !validation.valid || !bridgeReady || reinjectionPending;
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
    const activeBridge = bridgeReady ? bridge : null;
    const validation = validateNewCommandDraft(currentDraft, commandStateIndex.snapshot(), context);
    if (!activeBridge || !validation.valid) {
      return;
    }

    if (!commandDraftMatchesContext(currentDraft, context)) {
      draft = null;
      reinjectionMessage = {
        kind: "error",
        text: "Draft context changed. Create a new COMMAND update for the selected item before injecting."
      };
      renderCommandState();
      return;
    }

    reinjectionPending = true;
    reinjectionMessage = null;
    renderCommandState();

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
        selectedCommandUpdateEventId = null;
      }
      resolveMaybe(store.append(createSyntheticEventFromDraft(currentDraft, result)), () => undefined);
      return;
    }

    reinjectionMessage = createCommandFailureMessage(result);
    renderCommandState();
  }

  function renderCommandStatePreservingDraftEditorState(focusSelector: string): void {
    const scrollTop = commandDetailPane.scrollTop;
    const scrollLeft = commandDetailPane.scrollLeft;
    const activeElement = document.activeElement;
    const selection =
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? {
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd
          }
        : null;

    renderCommandState();

    const nextFocus = commandDetailPane.querySelector<HTMLElement>(focusSelector);
    nextFocus?.focus({ preventScroll: true });
    if (
      selection &&
      nextFocus instanceof HTMLInputElement &&
      isTextSelectionInput(nextFocus) &&
      typeof selection.start === "number" &&
      typeof selection.end === "number"
    ) {
      nextFocus.setSelectionRange(selection.start, selection.end);
    }
    commandDetailPane.scrollTop = scrollTop;
    commandDetailPane.scrollLeft = scrollLeft;
  }

  function rememberCommandContextEvent(event: LightstreamerEventEnvelope): void {
    const subscriptionId = event.subscription?.id ?? null;
    const mode = event.subscription?.mode ?? null;
    if (subscriptionId && mode === "COMMAND") {
      commandContextSubscriptionIds.add(subscriptionId);
    }
    const preservesCommandContext =
      mode === "COMMAND" ||
      Boolean(subscriptionId && mode === null && commandContextSubscriptionIds.has(subscriptionId));
    if (!preservesCommandContext || commandContextEventIds.has(event.id)) {
      return;
    }
    commandContextEventIds.add(event.id);
    commandContextEvents.push(event);
    commandStateIndex.apply(event);
  }

  function clearCommandContext(): void {
    commandContextEvents.length = 0;
    commandContextEventIds.clear();
    commandContextSubscriptionIds.clear();
    commandStateIndex.clear();
  }

  function closeStore(): void {
    if (storeCloseStarted) {
      return;
    }
    if (!store.close) {
      return;
    }
    storeCloseStarted = true;
    resolveMaybe(store.close(), () => undefined);
  }

  function renderEventVolumeNotice(stats: EventStoreStats): void {
    if (!stats.warningActive) {
      highVolumeNoticeDismissed = false;
      retentionNotice.hidden = true;
      eventVolumeText.textContent = "";
      retentionNotice.title = "";
      return;
    }

    if (highVolumeNoticeDismissed) {
      retentionNotice.hidden = true;
      return;
    }

    retentionNotice.hidden = false;
    eventVolumeText.textContent = `High volume: ${stats.retained.toLocaleString()} events retained`;
    retentionNotice.title = `All captured events are retained for this DevTools session. Threshold ${stats.warningThreshold.toLocaleString()} exceeded; clear only when you no longer need this session history.`;
  }

  const controller: PanelController = {
    setStatus(nextStatus) {
      const previousBridgeReady = bridgeReady;
      panelState.status = nextStatus;
      bridgeReady = Boolean(bridge) && isBridgeReadyStatus(nextStatus);
      if (!bridgeReady && draftExecutionTarget === "captured-listener") {
        draftExecutionTarget = "workbench-only";
      }
      if (!panelVisible) {
        return;
      }
      status.textContent = nextStatus;
      status.dataset.status = nextStatus;
      if (bridgeReady !== previousBridgeReady) {
        renderSelectedTimelineDetail();
      }
    },

    appendCaptureMessage(message) {
      resolveMaybe(store.append(normalizer.normalize(message)), () => undefined);
      controller.setStatus("capturing");
    },

    clearEvents() {
      selectedPinned = false;
      selectedEventId = null;
      timelineDetailOpen = false;
      resetCommandLifecycleWindow();
      commandSearchTextCache.keys.clear();
      if (draft?.provenance.source !== "new-command") {
        draft = null;
        draftEditing = false;
        draftJsonText = null;
        draftJsonError = null;
      }
      reinjectionMessage = null;
      resetTimelineRenderLimit();
      resetCommandListWindows();
      forceNextStoreRender = true;
      resolveMaybe(store.clear(), () => undefined);
    },

    setBridge(nextBridge) {
      bridge = nextBridge;
      bridgeReady = isBridgeReadyStatus(panelState.status);
      if (!bridgeReady && draftExecutionTarget === "captured-listener") {
        draftExecutionTarget = "workbench-only";
      }
      renderSelectedTimelineDetail();
    },

    setVisible(visible) {
      if (panelVisible === visible) {
        return;
      }
      panelVisible = visible;
      if (!visible) {
        timelineQueryVersion += 1;
        cancelScheduledStoreRender();
        cancelAppendRenderBudgetReset();
        clearInteractionFlushTimer();
        deferredInteractionRender = null;
        pointerInteractionActive = false;
        keyboardInteractionActive = false;
        helpTooltips.hide();
        return;
      }
      status.textContent = panelState.status;
      status.dataset.status = panelState.status;
      eventCount.textContent = String(currentStoreStats.retained);
      eventCount.setAttribute(
        "aria-label",
        `${currentStoreStats.retained} captured events`
      );
      renderEventVolumeNotice(currentStoreStats);
      immediateAppendRenderCount = 0;
      renderActiveView({ preservePaneState: true });
    },

    dispose() {
      cancelScheduledStoreRender();
      cancelAppendRenderBudgetReset();
      feed.removeEventListener("scroll", handleTimelineScroll);
      root.removeEventListener("pointerdown", beginPointerInteraction, true);
      root.removeEventListener("pointerup", endPointerInteraction, true);
      root.removeEventListener("pointercancel", endPointerInteraction, true);
      root.removeEventListener("click", endPointerInteraction, true);
      root.removeEventListener("keydown", beginKeyboardInteraction, true);
      root.removeEventListener("keyup", endKeyboardInteraction, true);
      window.removeEventListener("pagehide", closeStore);
      window.removeEventListener("beforeunload", closeStore);
      clearInteractionFlushTimer();
      helpTooltips.dispose();
      themeManager.dispose();
      activeTooltipDisposers.delete(root);
      closeStore();
    }
  };

  store.subscribe((change, stats) => {
    currentStoreStats = stats;

    if (change.type === "init") {
      resolveMaybe(store.queryEvents(), (result) => {
        clearCommandContext();
        for (const event of result.events) {
          rememberCommandContextEvent(event);
        }
        renderActiveViewFromStoreUpdate({ preservePaneState: true });
      });
    } else if (change.type === "append") {
      rememberCommandContextEvent(change.event);
      if (timelineWindowOffset > 0 && matchesEventFilters(change.event, filterState)) {
        timelineWindowOffset += 1;
        timelineHistoryAnchor = timelineWindowOffset % TIMELINE_WINDOW_SIZE;
      } else if (timelineWindowOffset === 0) {
        timelineHistoryAnchor = 0;
      }
    } else {
      cancelScheduledStoreRender();
      immediateAppendRenderCount = 0;
      timelineEvents = [];
      clearCommandContext();
    }

    if (!panelVisible) {
      return;
    }

    eventCount.textContent = String(stats.retained);
    eventCount.setAttribute("aria-label", `${stats.retained} captured events`);
    renderEventVolumeNotice(stats);

    if (change.type === "init") {
      return;
    }
    if (change.type === "append") {
      renderActiveViewFromAppend({ preservePaneState: true });
      return;
    }
    renderActiveViewFromStoreUpdate({ preservePaneState: true });
  });

  return controller;

  function appendDraftSection(
    parent: HTMLElement,
    selectedEvent: LightstreamerEventEnvelope,
    currentDraft: ReinjectionDraft | null
  ): void {
    const section = document.createElement("section");
    section.className = "replay-card draft-editor";
    section.setAttribute("aria-busy", String(reinjectionPending));
    section.append(createTextElement("h3", "detail-section-heading", "Replay"));

    const cloneButton = document.createElement("button");
    cloneButton.className = "clone-button";
    cloneButton.type = "button";
    cloneButton.textContent = "Clone";
    cloneButton.disabled = !canCloneEvent(selectedEvent) || reinjectionPending;
    cloneButton.addEventListener("click", () => {
      const nextDraft = createDraftFromEvent(selectedEvent);
      if (!nextDraft || !validateEditableDraft(nextDraft).valid) {
        return;
      }
      selectedEventId = selectedEvent.id;
      selectedPinned = true;
      draft = nextDraft;
      draftEditing = false;
      draftJsonText = formatDraftJson(nextDraft);
      draftJsonError = null;
      draftExecutionTarget = nextDraft.captureSource !== "wire" && nextDraft.target.listenerId && bridgeReady
        ? "captured-listener"
        : "workbench-only";
      reinjectionMessage = null;
      renderDetail(selectedEvent);
    });
    section.append(cloneButton);

    if (!currentDraft) {
      section.append(
        createTextElement(
          "p",
          "editor-placeholder",
          "Clone this captured item update to replay it unchanged or edit a staged copy."
        )
      );
      parent.append(section);
      return;
    }

    section.append(createSourceContext(currentDraft));
    section.append(createDraftExecutionTargets(currentDraft));

    if (reinjectionPending) {
      const pending = createTextElement(
        "p",
        "reinjection-message pending",
        draftExecutionTarget === "captured-listener"
          ? "Delivering locally to the original app listener…"
          : "Adding the synthetic update to Workbench…"
      );
      pending.setAttribute("role", "status");
      pending.setAttribute("aria-live", "polite");
      section.append(pending);
    } else if (reinjectionMessage) {
      section.append(createReinjectionMessageElement(reinjectionMessage));
    }

    const actionBar = document.createElement("div");
    actionBar.className = "replay-action-bar";
    const sourceReplay = createSourceReplayDraft(currentDraft);
    const sourceValidation = validateDraftForExecutionTarget(sourceReplay, draftExecutionTarget, {
      bridgeAvailable: bridgeReady
    });
    const reinjectButton = document.createElement("button");
    reinjectButton.className = "reinject-button replay-source-button";
    reinjectButton.type = "button";
    reinjectButton.textContent = reinjectionPending ? "Re-injecting…" : "Re-inject";
    reinjectButton.disabled = !sourceValidation.valid || reinjectionPending;
    reinjectButton.addEventListener("click", () => {
      const activeDraft = draft ?? currentDraft;
      void executeCurrentDraft(
        createSourceReplayDraft(activeDraft),
        draftExecutionTarget,
        "source"
      );
    });

    const mutateButton = document.createElement("button");
    mutateButton.className = "mutate-inject-button";
    mutateButton.type = "button";
    mutateButton.textContent = "Mutate & Inject…";
    mutateButton.disabled = reinjectionPending;
    mutateButton.setAttribute("aria-expanded", String(draftEditing));
    mutateButton.addEventListener("click", () => {
      draftEditing = true;
      draftJsonText = draftJsonText ?? formatDraftJson(draft ?? currentDraft);
      draftJsonError = null;
      reinjectionMessage = null;
      renderEventForDraft(draft ?? currentDraft, true);
    });
    actionBar.append(reinjectButton, mutateButton);
    section.append(actionBar);

    if (draftEditing) {
      section.append(createDraftControls(currentDraft));
    }
    parent.append(section);
  }

  function createDraftControls(currentDraft: ReinjectionDraft): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "draft-controls";
    controls.setAttribute("aria-label", "Edit staged replay draft");

    const validation = validateDraftForExecutionTarget(currentDraft, draftExecutionTarget, {
      bridgeAvailable: bridgeReady
    });
    const editorHeader = document.createElement("div");
    editorHeader.className = "draft-editor-header";
    editorHeader.append(
      createTextElement("h4", "draft-editor-heading", "Mutate & Inject"),
      createTextElement(
        "span",
        "draft-dirty-count",
        `${draftChangeCount(currentDraft)} changed`
      )
    );
    controls.append(editorHeader);

    if (!validation.valid) {
      const validationError = createTextElement(
        "p",
        "draft-validation-error",
        validationMessage(validation.errors)
      );
      validationError.setAttribute("role", "alert");
      controls.append(validationError);
    }

    const injectButton = document.createElement("button");
    injectButton.className = "inject-edited-button";
    injectButton.type = "button";
    injectButton.textContent = reinjectionPending
      ? draftExecutionTarget === "captured-listener"
        ? "Injecting…"
        : "Adding…"
      : "Inject edited draft";
    injectButton.disabled = !validation.valid || Boolean(draftJsonError) || reinjectionPending;
    injectButton.dataset.validationValid = String(validation.valid && !draftJsonError);
    injectButton.addEventListener("click", () => {
      const activeDraft = draft ?? currentDraft;
      void executeCurrentDraft(activeDraft, draftExecutionTarget, "edited");
    });

    const structuredError = createTextElement(
      "p",
      "draft-validation-error draft-structured-error",
      ""
    );
    structuredError.hidden = true;
    structuredError.setAttribute("role", "alert");
    controls.append(createStructuredDraftTable(currentDraft, injectButton, structuredError));
    controls.append(structuredError);

    const editorActions = document.createElement("div");
    editorActions.className = "draft-editor-actions";
    const resetButton = document.createElement("button");
    resetButton.className = "reset-draft-button";
    resetButton.type = "button";
    resetButton.textContent = "Reset to source";
    resetButton.disabled = reinjectionPending;
    resetButton.addEventListener("click", () => {
      draft = createSourceReplayDraft(draft ?? currentDraft);
      draftJsonText = formatDraftJson(draft);
      draftJsonError = null;
      reinjectionMessage = null;
      renderEventForDraft(draft, true);
    });

    const cancelButton = document.createElement("button");
    cancelButton.className = "cancel-editing-button";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel editing";
    cancelButton.disabled = reinjectionPending;
    cancelButton.addEventListener("click", () => {
      draftEditing = false;
      draftJsonError = null;
      draftJsonText = formatDraftJson(draft ?? currentDraft);
      renderEventForDraft(draft ?? currentDraft, true);
    });
    editorActions.append(resetButton, cancelButton);
    controls.append(editorActions);

    const advanced = document.createElement("details");
    advanced.className = "detail-section draft-advanced-json";
    advanced.dataset.detailSection = "Advanced Draft JSON";
    const advancedSummary = document.createElement("summary");
    advancedSummary.className = "detail-section-summary";
    advancedSummary.append(
      createTextElement("span", "detail-section-heading", "Advanced Draft JSON"),
      createTextElement("span", "detail-section-marker", "bulk edit")
    );
    advanced.append(advancedSummary);
    const draftLabel = document.createElement("label");
    draftLabel.className = "draft-json-label";
    draftLabel.append(
      createTextElement(
        "span",
        "draft-input-text",
        "Edit command, key, snapshot, and fields as one JSON object."
      )
    );

    const draftTextarea = document.createElement("textarea");
    draftTextarea.className = "draft-json";
    draftTextarea.setAttribute("aria-label", "Draft JSON");
    draftTextarea.spellcheck = false;
    draftTextarea.value = draftJsonText ?? formatDraftJson(currentDraft);
    draftTextarea.disabled = reinjectionPending;
    draftLabel.append(draftTextarea);

    const jsonError = createTextElement("p", "draft-validation-error draft-json-error", "");
    jsonError.textContent = draftJsonError ?? "";
    jsonError.hidden = !draftJsonError;
    jsonError.setAttribute("role", "alert");

    advanced.append(draftLabel, jsonError);
    controls.append(advanced);

    const derived = document.createElement("details");
    derived.className = "detail-section draft-derived-fields";
    derived.dataset.detailSection = "Derived changed fields";
    const derivedSummary = document.createElement("summary");
    derivedSummary.className = "detail-section-summary";
    derivedSummary.append(
      createTextElement("span", "detail-section-heading", "Derived changed fields"),
      createTextElement(
        "span",
        "detail-section-marker",
        `${Object.keys(currentDraft.changedFields).length} fields`
      )
    );
    const changedPreview = document.createElement("pre");
    changedPreview.className = "draft-changed-fields-preview";
    changedPreview.textContent = JSON.stringify(currentDraft.changedFields, null, 2);
    derived.append(derivedSummary, changedPreview);
    controls.append(derived);

    draftTextarea.addEventListener("input", () => {
      draftJsonText = draftTextarea.value;
      const result = parseDraftJson(currentDraft, draftTextarea.value);
      if (!result.draft) {
        draftJsonError = result.error ?? "Draft JSON is invalid.";
        jsonError.textContent = draftJsonError;
        jsonError.hidden = false;
        injectButton.disabled = true;
        injectButton.dataset.validationValid = "false";
        return;
      }

      draft = result.draft;
      draftJsonError = null;
      reinjectionMessage = null;
      const nextValidation = validateDraftForExecutionTarget(result.draft, draftExecutionTarget, {
        bridgeAvailable: bridgeReady
      });
      jsonError.textContent = nextValidation.valid
        ? ""
        : validationMessage(nextValidation.errors);
      jsonError.hidden = nextValidation.valid;
      changedPreview.textContent = JSON.stringify(result.draft.changedFields, null, 2);
      controls.querySelector<HTMLElement>(".draft-dirty-count")!.textContent =
        `${draftChangeCount(result.draft)} changed`;
      derivedSummary.querySelector<HTMLElement>(".detail-section-marker")!.textContent =
        `${Object.keys(result.draft.changedFields).length} fields`;
      injectButton.disabled = !nextValidation.valid || reinjectionPending;
      injectButton.dataset.validationValid = String(nextValidation.valid);
      controls
        .querySelector<HTMLTableElement>(".draft-field-diff")
        ?.replaceWith(createStructuredDraftTable(result.draft, injectButton, structuredError));
    });

    controls.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !reinjectionPending) {
        event.preventDefault();
        event.stopPropagation();
        draftEditing = false;
        draftJsonError = null;
        draftJsonText = formatDraftJson(draft ?? currentDraft);
        renderEventForDraft(draft ?? currentDraft, true);
        return;
      }
      if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey) &&
        !injectButton.disabled
      ) {
        event.preventDefault();
        void executeCurrentDraft(draft ?? currentDraft, draftExecutionTarget, "edited");
      }
    });

    controls.append(injectButton);
    return controls;
  }

  function createStructuredDraftTable(
    currentDraft: ReinjectionDraft,
    injectButton: HTMLButtonElement,
    structuredError: HTMLElement
  ): HTMLTableElement {
    const table = document.createElement("table");
    table.className = "draft-field-diff";
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    for (const heading of ["Field", "Original", "Draft"]) {
      headingRow.append(createTextElement("th", "draft-field-heading", heading));
    }
    head.append(headingRow);
    const body = document.createElement("tbody");

    const fieldNames = new Set([
      ...(currentDraft.subscriptionMode === "COMMAND" ? ["command", "key"] : []),
      ...Object.keys(currentDraft.sourceFields),
      ...Object.keys(currentDraft.fields)
    ]);
    for (const fieldName of fieldNames) {
      const original =
        fieldName === "command"
          ? currentDraft.sourceCommand
          : fieldName === "key"
            ? currentDraft.sourceKey
            : currentDraft.sourceFields[fieldName];
      const current =
        fieldName === "command"
          ? currentDraft.command
          : fieldName === "key"
            ? currentDraft.key
            : currentDraft.fields[fieldName];
      const expandedJson = shouldUseExpandedJsonEditor(original, current);
      const fieldChanged = !Object.is(original, current);
      const row = document.createElement("tr");
      row.dataset.fieldName = fieldName;
      row.dataset.state = fieldChanged ? "changed" : "unchanged";
      row.dataset.layout = expandedJson ? "json-summary" : "scalar";
      const name = createTextElement("th", "draft-field-name", fieldName);
      name.scope = "row";
      if (fieldChanged) {
        const changed = createTextElement("span", "draft-field-changed-indicator", "Δ");
        changed.title = "Changed from captured value";
        changed.setAttribute("aria-label", "changed");
        name.append(changed);
      }
      const originalCell = document.createElement("td");
      originalCell.className = "draft-field-original";
      originalCell.append(createPrimitiveValue(original, { showPreview: !expandedJson }));
      const draftCell = document.createElement("td");
      draftCell.className = "draft-field-value";
      if (expandedJson) {
        draftCell.append(createPrimitiveValue(current, { showPreview: false }));
      } else {
        draftCell.append(
          createStructuredFieldEditor(
            currentDraft,
            fieldName,
            current,
            injectButton,
            structuredError
          )
        );
      }
      row.append(name, originalCell, draftCell);
      body.append(row);
      if (expandedJson) {
        body.append(
          createExpandedJsonFieldRow(
            currentDraft,
            fieldName,
            original,
            current,
            injectButton,
            structuredError
          )
        );
      }
    }

    const snapshotRow = document.createElement("tr");
    snapshotRow.dataset.fieldName = "snapshot";
    const snapshotChanged = currentDraft.isSnapshot !== currentDraft.sourceIsSnapshot;
    snapshotRow.dataset.state = snapshotChanged ? "changed" : "unchanged";
    const snapshotName = createTextElement("th", "draft-field-name", "snapshot");
    snapshotName.scope = "row";
    if (snapshotChanged) {
      const changed = createTextElement("span", "draft-field-changed-indicator", "Δ");
      changed.title = "Changed from captured value";
      changed.setAttribute("aria-label", "changed");
      snapshotName.append(changed);
    }
    const snapshotOriginal = document.createElement("td");
    snapshotOriginal.className = "draft-field-original";
    snapshotOriginal.append(createPrimitiveValue(currentDraft.sourceIsSnapshot));
    const snapshotDraft = document.createElement("td");
    snapshotDraft.className = "draft-field-value";
    const snapshotLabel = document.createElement("label");
    snapshotLabel.className = "draft-snapshot-control";
    const snapshotInput = document.createElement("input");
    snapshotInput.className = "structured-snapshot-input";
    snapshotInput.type = "checkbox";
    snapshotInput.checked = currentDraft.isSnapshot;
    snapshotInput.disabled = reinjectionPending;
    snapshotInput.setAttribute("aria-label", "Draft snapshot state");
    snapshotInput.addEventListener("change", () => {
      applyStructuredDraftUpdate(
        updateDraftSnapshot(draft ?? currentDraft, snapshotInput.checked)
      );
    });
    snapshotLabel.append(snapshotInput, createTextElement("span", "draft-value-type", "boolean"));
    snapshotDraft.append(snapshotLabel);
    snapshotRow.append(snapshotName, snapshotOriginal, snapshotDraft);
    body.append(snapshotRow);

    table.append(head, body);
    return table;
  }

  function createExpandedJsonFieldRow(
    currentDraft: ReinjectionDraft,
    fieldName: string,
    original: DraftFieldValue | undefined,
    current: DraftFieldValue | undefined,
    injectButton: HTMLButtonElement,
    structuredError: HTMLElement
  ): HTMLTableRowElement {
    const row = document.createElement("tr");
    row.className = "draft-json-editor-row";
    row.dataset.fieldName = fieldName;
    row.dataset.layout = "json-editor";
    row.dataset.state = Object.is(original, current) ? "unchanged" : "changed";
    const cell = document.createElement("td");
    cell.className = "draft-json-editor-cell";
    cell.colSpan = 3;

    const workspace = document.createElement("section");
    workspace.className = "structured-json-workspace";
    workspace.setAttribute("aria-label", `${fieldName} JSON field editor`);
    const header = document.createElement("header");
    header.className = "structured-json-editor-header";
    header.append(
      createTextElement("strong", "structured-json-editor-title", fieldName),
      createTextElement(
        "span",
        "structured-json-editor-summary",
        structuredJsonSummary(current) ?? structuredJsonSummary(original) ?? "Large string"
      )
    );
    workspace.append(header);
    if (typeof original === "string") {
      const originalPreview = createParsedJsonDisclosure(original, "Original captured JSON");
      if (originalPreview) {
        originalPreview.classList.add("structured-json-original-preview");
        workspace.append(originalPreview);
      }
    }
    workspace.append(
      createStructuredFieldEditor(
        currentDraft,
        fieldName,
        current,
        injectButton,
        structuredError,
        "expanded-json"
      )
    );
    cell.append(workspace);
    row.append(cell);
    return row;
  }

  function createStructuredFieldEditor(
    currentDraft: ReinjectionDraft,
    fieldName: string,
    value: DraftFieldValue | undefined,
    injectButton: HTMLButtonElement,
    structuredError: HTMLElement,
    layout: "compact" | "expanded-json" = "compact"
  ): HTMLElement {
    const editor = document.createElement("div");
    editor.className = "structured-field-editor";
    editor.dataset.layout = layout;
    const typeSelect = document.createElement("select");
    typeSelect.className = "draft-field-type";
    typeSelect.dataset.fieldName = fieldName;
    typeSelect.setAttribute("aria-label", `Draft type ${fieldName}`);
    typeSelect.disabled = reinjectionPending || fieldName === "command" || fieldName === "key";
    for (const primitiveType of ["string", "number", "boolean", "null"] as const) {
      const option = document.createElement("option");
      option.value = primitiveType;
      option.textContent = primitiveType;
      typeSelect.append(option);
    }
    typeSelect.value = draftFieldType(value);
    typeSelect.addEventListener("change", () => {
      applyStructuredDraftUpdate(
        updateDraftField(
          draft ?? currentDraft,
          fieldName,
          defaultValueForDraftType(typeSelect.value, value)
        )
      );
    });
    editor.append(typeSelect);

    if (fieldName === "command") {
      const commandSelect = document.createElement("select");
      commandSelect.className = "structured-field-input structured-command-input";
      commandSelect.dataset.fieldName = fieldName;
      commandSelect.setAttribute("aria-label", "Draft COMMAND command");
      commandSelect.disabled = reinjectionPending;
      for (const command of ["", "ADD", "UPDATE", "DELETE"]) {
        const option = document.createElement("option");
        option.value = command;
        option.textContent = command || "Select command";
        commandSelect.append(option);
      }
      commandSelect.value = currentDraft.command ?? "";
      commandSelect.addEventListener("change", () => {
        applyStructuredDraftUpdate(
          updateDraftCommand(draft ?? currentDraft, commandSelect.value)
        );
      });
      editor.append(commandSelect);
      return editor;
    }

    if (fieldName === "key") {
      const keyInput = document.createElement("textarea");
      keyInput.className = "structured-field-input structured-string-input";
      keyInput.dataset.fieldName = fieldName;
      keyInput.rows = 1;
      keyInput.value = currentDraft.key ?? "";
      keyInput.disabled = reinjectionPending;
      keyInput.setAttribute("aria-label", "Draft COMMAND key");
      keyInput.addEventListener("input", () => {
        applyStructuredDraftUpdate(updateDraftKey(draft ?? currentDraft, keyInput.value));
      });
      editor.append(keyInput);
      return editor;
    }

    if (typeof value === "boolean") {
      const booleanSelect = document.createElement("select");
      booleanSelect.className = "structured-field-input";
      booleanSelect.dataset.fieldName = fieldName;
      booleanSelect.setAttribute("aria-label", `Draft field ${fieldName}`);
      booleanSelect.disabled = reinjectionPending;
      for (const booleanValue of ["true", "false"]) {
        const option = document.createElement("option");
        option.value = booleanValue;
        option.textContent = booleanValue;
        booleanSelect.append(option);
      }
      booleanSelect.value = String(value);
      booleanSelect.addEventListener("change", () => {
        applyStructuredDraftUpdate(
          updateDraftField(draft ?? currentDraft, fieldName, booleanSelect.value === "true")
        );
      });
      editor.append(booleanSelect);
      return editor;
    }

    if (value === null || value === undefined) {
      editor.append(createTextElement("span", "structured-null-value", "null"));
      return editor;
    }

    if (typeof value === "number") {
      const numberInput = document.createElement("input");
      numberInput.className = "structured-field-input";
      numberInput.dataset.fieldName = fieldName;
      numberInput.type = "number";
      numberInput.step = "any";
      numberInput.value = String(value);
      numberInput.disabled = reinjectionPending;
      numberInput.setAttribute("aria-label", `Draft field ${fieldName}`);
      numberInput.addEventListener("input", () => {
        const nextValue = Number(numberInput.value);
        if (numberInput.value.trim() === "" || !Number.isFinite(nextValue)) {
          structuredError.textContent = `${fieldName} must be a finite number.`;
          structuredError.hidden = false;
          injectButton.disabled = true;
          injectButton.dataset.validationValid = "false";
          numberInput.setAttribute("aria-invalid", "true");
          return;
        }
        applyStructuredDraftUpdate(
          updateDraftField(draft ?? currentDraft, fieldName, nextValue)
        );
      });
      editor.append(numberInput);
      return editor;
    }

    const textInput = document.createElement("textarea");
    textInput.className = "structured-field-input structured-string-input";
    if (layout === "expanded-json") {
      textInput.classList.add("structured-json-input");
    }
    textInput.dataset.fieldName = fieldName;
    textInput.rows = layout === "expanded-json" ? 10 : 1;
    textInput.value = layout === "expanded-json" ? formatJsonStringForEditor(value) : value;
    textInput.disabled = reinjectionPending;
    textInput.spellcheck = false;
    textInput.setAttribute("aria-label", `Draft field ${fieldName}`);
    textInput.addEventListener("input", () => {
      applyStructuredDraftUpdate(
        updateDraftField(draft ?? currentDraft, fieldName, textInput.value)
      );
    });
    editor.append(textInput);
    const parsed = createParsedJsonDisclosure(
      value,
      layout === "expanded-json" ? "Draft formatted preview" : "Formatted preview"
    );
    if (parsed) {
      editor.append(parsed);
    }
    return editor;
  }

  function applyStructuredDraftUpdate(nextDraft: ReinjectionDraft): void {
    draft = nextDraft;
    draftJsonText = formatDraftJson(nextDraft);
    draftJsonError = null;
    reinjectionMessage = null;
    renderEventForDraft(nextDraft, true);
  }

  function createDraftExecutionTargets(currentDraft: ReinjectionDraft): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "draft-execution-targets";
    fieldset.append(createTextElement("legend", "draft-target-legend", "Execution target"));

    const listenerAvailable = Boolean(
      currentDraft.captureSource !== "wire" && currentDraft.target.listenerId && bridgeReady
    );
    if (!listenerAvailable && draftExecutionTarget === "captured-listener") {
      draftExecutionTarget = "workbench-only";
    }
    const choices: Array<{
      value: ReinjectionExecutionTarget;
      label: string;
      helper: string;
      disabled: boolean;
    }> = [
      {
        value: "captured-listener",
        label: "Original app listener",
        helper: listenerAvailable
          ? "Calls the captured listener in the inspected page. No server is contacted."
          : "Unavailable because this capture has no live listener target or the panel bridge is disconnected.",
        disabled: !listenerAvailable
      },
      {
        value: "workbench-only",
        label: "Workbench only",
        helper: "Adds a synthetic update to Workbench state only. The inspected page is unchanged.",
        disabled: false
      }
    ];

    for (const choice of choices) {
      const option = document.createElement("label");
      option.className = "draft-target-option";
      option.dataset.target = choice.value;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "draft-execution-target";
      input.value = choice.value;
      input.checked = draftExecutionTarget === choice.value;
      input.disabled = choice.disabled || reinjectionPending;
      const helper = createTextElement("span", "draft-target-helper", choice.helper);
      helper.id = `draft-target-${choice.value}-help`;
      input.setAttribute("aria-describedby", helper.id);
      input.addEventListener("change", () => {
        if (!input.checked || input.disabled) {
          return;
        }
        draftExecutionTarget = choice.value;
        reinjectionMessage = null;
        renderEventForDraft(currentDraft, true);
      });
      const copy = document.createElement("span");
      copy.className = "draft-target-copy";
      copy.append(createTextElement("span", "draft-target-label", choice.label), helper);
      option.append(input, copy);
      fieldset.append(option);
    }

    return fieldset;
  }

  async function executeCurrentDraft(
    currentDraft: ReinjectionDraft,
    executionTarget: ReinjectionExecutionTarget,
    actionMode: "source" | "edited"
  ): Promise<void> {
    const activeBridge = bridgeReady ? bridge : null;
    const validation = validateDraftForExecutionTarget(currentDraft, executionTarget, {
      bridgeAvailable: bridgeReady
    });
    if (!validation.valid || (executionTarget === "captured-listener" && !activeBridge)) {
      return;
    }

    reinjectionPending = true;
    reinjectionMessage = null;
    renderEventForDraft(currentDraft, true);

    if (executionTarget === "workbench-only") {
      const timestamp = Date.now();
      const result: ReinjectionResult = {
        requestId: `workbench-${timestamp}-${++workbenchSimulationSequence}`,
        ok: true,
        status: "success",
        timestamp
      };
      reinjectionPending = false;
      reinjectionMessage = {
        kind: "success",
        text: `${actionMode === "source" ? "Source clone" : "Edited draft"} added to Workbench only. The inspected page was not reached.`
      };
      renderEventForDraft(currentDraft, true);
      resolveMaybe(
        store.append(createSyntheticEventFromDraft(currentDraft, result, executionTarget)),
        () => undefined
      );
      return;
    }

    // A captured-listener execution is intentionally strict: never fall back to a
    // Workbench-only simulation when page delivery fails.
    if (!activeBridge) {
      return;
    }
    const result = await activeBridge.reinjectDraft(currentDraft);
    reinjectionPending = false;

    if (result.ok && result.status === "success") {
      reinjectionMessage = {
        kind: "success",
        text: `${actionMode === "source" ? "Source clone" : "Edited draft"} delivered to the original app listener. The inspected page was reached.`
      };
      renderEventForDraft(currentDraft, true);
      resolveMaybe(
        store.append(createSyntheticEventFromDraft(currentDraft, result, executionTarget)),
        () => undefined
      );
      return;
    }

    reinjectionMessage = createFailureMessage(result);
    renderEventForDraft(currentDraft, true);
  }

  function renderEventForDraft(currentDraft: ReinjectionDraft, preservePaneState = false): void {
    resolveMaybe(selectedEventForDraft(currentDraft), (event) => {
      renderDetail(event, { preservePaneState });
    });
  }

  function selectedEventForDraft(
    currentDraft: ReinjectionDraft
  ): MaybePromise<LightstreamerEventEnvelope | null> {
    const cached =
      timelineEvents.find((event) => event.id === currentDraft.sourceEventId) ??
      timelineEvents.find((event) => event.id === selectedEventId) ??
      timelineEvents[timelineEvents.length - 1] ??
      null;
    if (cached || !currentDraft.sourceEventId) {
      return cached;
    }
    return store.getEventById(currentDraft.sourceEventId);
  }

  function clearDraftForSelection(nextEventId: string | null): void {
    if (detailCopyEventId !== nextEventId) {
      detailCopyEventId = null;
      detailCopyMessage = null;
    }
    if (!draft || draft.sourceEventId === nextEventId) {
      return;
    }
    draft = null;
    draftEditing = false;
    draftJsonText = null;
    draftJsonError = null;
    reinjectionMessage = null;
  }
}

function flattenCommandItems(
  state: CommandState
): CommandItemEntry[] {
  return state.subscriptions.flatMap((subscription) =>
    subscription.items.map((item) => ({ subscription, item }))
  );
}

function filterCommandItems(
  items: readonly CommandItemEntry[],
  evaluation: CommandFilterEvaluation
): CommandItemEntry[] {
  const { filters } = evaluation;
  if (!evaluation.active) {
    return [...items];
  }

  return items.filter((entry) => {
    const { item, subscription } = entry;
    if (
      item.activeRows.some((row) => matchesCommandRow(row, item, subscription, evaluation)) ||
      item.deletedKeys.some((row) =>
        matchesDeletedCommandKey(row, item, subscription, evaluation)
      ) ||
      item.diagnostics.some((diagnostic) =>
        matchesCommandDiagnostic(diagnostic, item, evaluation)
      )
    ) {
      return true;
    }

    const hasKeyHistory = item.activeRows.length > 0 || item.deletedKeys.length > 0;
    return !hasKeyHistory && matchesCommandItemMetadata(entry, filters);
  });
}

function createCommandFilterEvaluation(
  filters: CommandFilterState,
  persistentSearchText: CommandSearchTextCache
): CommandFilterEvaluation {
  return {
    filters,
    active: hasActiveCommandFilters(filters),
    rowSearchText: new WeakMap(),
    deletedSearchText: new WeakMap(),
    diagnosticSearchText: new WeakMap(),
    persistentSearchText
  };
}

function hasActiveCommandFilters(filters: CommandFilterState): boolean {
  return Object.values(filters).some((value) => Boolean(value?.trim()));
}

function matchesCommandItemMetadata(
  entry: CommandItemEntry,
  filters: CommandFilterState
): boolean {
  if (
    filters.key?.trim() ||
    filters.command?.trim() ||
    filters.source?.trim() ||
    filters.snapshot?.trim() ||
    filters.synthetic?.trim() ||
    filters.diagnostics?.trim()
  ) {
    return false;
  }

  const searchText = normalizeSearchText([
    entry.subscription.subscriptionId,
    entry.subscription.mode,
    commandItemLabel(entry.item),
    entry.item.itemId,
    entry.item.itemName,
    entry.item.itemPosition
  ]);
  return (
    matchesTokens(searchText, filters.query) &&
    matchesText(entry.subscription.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(entry.item), filters.item)
  );
}

function validCommandItemSelection(
  items: readonly CommandItemEntry[],
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

function isTextSelectionControl(
  element: Element
): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  return element instanceof HTMLInputElement && isTextSelectionInput(element);
}

function capturePaneState(pane: HTMLElement): PaneState {
  const activeElement = document.activeElement;
  const activeInPane = activeElement instanceof HTMLElement && pane.contains(activeElement);
  return {
    scrollTop: pane.scrollTop,
    scrollLeft: pane.scrollLeft,
    focusSelector: activeInPane ? focusSelectorForElement(activeElement) : null,
    selection:
      activeInPane && isTextSelectionControl(activeElement)
        ? {
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd
          }
        : null,
    detailSections: captureDetailSectionState(pane)
  };
}

function restorePaneState(pane: HTMLElement, state: PaneState | null): void {
  if (!state) {
    return;
  }

  restoreDetailSectionState(pane, state.detailSections);

  if (state.focusSelector) {
    const exactFocus = pane.querySelector<HTMLElement>(state.focusSelector);
    const nextFocus =
      exactFocus instanceof HTMLButtonElement && exactFocus.disabled
        ? pane.querySelector<HTMLElement>(".window-navigation-button:not(:disabled)")
        : exactFocus;
    nextFocus?.focus({ preventScroll: true });
    if (
      nextFocus &&
      state.selection &&
      isTextSelectionControl(nextFocus) &&
      typeof state.selection.start === "number" &&
      typeof state.selection.end === "number"
    ) {
      nextFocus.setSelectionRange(state.selection.start, state.selection.end);
    }
  }

  pane.scrollTop = state.scrollTop;
  pane.scrollLeft = state.scrollLeft;
}

function captureDetailSectionState(pane: HTMLElement): Record<string, boolean> {
  const sections: Record<string, boolean> = {};
  for (const section of pane.querySelectorAll<HTMLDetailsElement>("details.detail-section[data-detail-section]")) {
    const key = section.dataset.detailSection;
    if (key) {
      sections[key] = section.open;
    }
  }
  return sections;
}

function restoreDetailSectionState(
  pane: HTMLElement,
  sectionState: Record<string, boolean>
): void {
  for (const section of pane.querySelectorAll<HTMLDetailsElement>("details.detail-section[data-detail-section]")) {
    const key = section.dataset.detailSection;
    if (key && Object.prototype.hasOwnProperty.call(sectionState, key)) {
      section.open = sectionState[key];
    }
  }
}

function focusSelectorForElement(element: HTMLElement): string | null {
  if (
    element instanceof HTMLInputElement &&
    element.type === "radio" &&
    element.name &&
    element.value
  ) {
    return `input[type="radio"][name="${cssAttributeValue(
      element.name
    )}"][value="${cssAttributeValue(element.value)}"]`;
  }

  if (element.classList.contains("window-navigation-button") && element.dataset.windowAction) {
    return `.window-navigation-button[data-window-action="${cssAttributeValue(
      element.dataset.windowAction
    )}"]`;
  }

  if (element.classList.contains("command-lifecycle-toggle")) {
    return ".command-lifecycle-toggle";
  }

  if (element.classList.contains("event-row") && element.dataset.eventId) {
    return `.event-row[data-event-id="${cssAttributeValue(element.dataset.eventId)}"]`;
  }

  if (
    element.classList.contains("command-item-button") &&
    element.dataset.subscriptionId &&
    element.dataset.itemId
  ) {
    return `.command-item-button[data-subscription-id="${cssAttributeValue(
      element.dataset.subscriptionId
    )}"][data-item-id="${cssAttributeValue(element.dataset.itemId)}"]`;
  }

  if (
    element.classList.contains("command-current-row") &&
    element.dataset.subscriptionId &&
    element.dataset.itemId &&
    element.dataset.key &&
    element.dataset.status
  ) {
    return `.command-current-row[data-subscription-id="${cssAttributeValue(
      element.dataset.subscriptionId
    )}"][data-item-id="${cssAttributeValue(element.dataset.itemId)}"][data-key="${cssAttributeValue(
      element.dataset.key
    )}"][data-status="${cssAttributeValue(element.dataset.status)}"]`;
  }

  if (element.classList.contains("command-update-row") && element.dataset.eventId) {
    return `.command-update-row[data-event-id="${cssAttributeValue(element.dataset.eventId)}"]`;
  }

  if (element.classList.contains("command-help-icon")) {
    const label = element.getAttribute("aria-label");
    if (label) {
      return `.command-help-icon[aria-label="${cssAttributeValue(label)}"]`;
    }
  }

  if (
    element instanceof HTMLInputElement &&
    element.classList.contains("command-draft-field-input") &&
    element.dataset.fieldName
  ) {
    return `.command-draft-field-input[data-field-name="${cssAttributeValue(element.dataset.fieldName)}"]`;
  }

  if (
    element.dataset.fieldName &&
    (element.classList.contains("structured-field-input") ||
      element.classList.contains("draft-field-type"))
  ) {
    const className = element.classList.contains("draft-field-type")
      ? "draft-field-type"
      : "structured-field-input";
    return `.${className}[data-field-name="${cssAttributeValue(element.dataset.fieldName)}"]`;
  }

  for (const className of [
    "draft-json",
    "command-draft-command",
    "command-draft-key",
    "command-draft-snapshot",
    "reinject-button",
    "inject-command-button",
    "new-command-button",
    "clone-button",
    "mutate-inject-button",
    "inject-edited-button",
    "reset-draft-button",
    "cancel-editing-button",
    "structured-snapshot-input",
    "copy-event-json-button",
    "detail-collapse-button"
  ]) {
    if (element.classList.contains(className)) {
      return `.${className}`;
    }
  }

  return null;
}

function findSelectedCommandItem(
  items: readonly CommandItemEntry[],
  selected: { subscriptionId: string; itemId: string } | null
): CommandItemEntry | null {
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

function commandItemLabel(item: CommandItemGroup): string {
  if (item.itemName && item.itemId.startsWith("group:") && item.itemPosition !== null) {
    return `${item.itemName} position ${item.itemPosition}`;
  }
  if (item.itemName) {
    return item.itemName;
  }
  if (item.itemPosition !== null) {
    return `position ${item.itemPosition}`;
  }
  return "unknown item";
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

function latestKeyProvenance(row: CommandKeyRow): CommandProvenance {
  return row.status === "active" ? row.latest : row.deletedAt;
}

function latestLifecycle(row: CommandRow): CommandLifecycleEntry | null {
  return row.lifecycle[row.lifecycle.length - 1] ?? null;
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

function createCommandUpdateHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "command-update-header";
  for (const heading of ["Time", "Event", "Command"]) {
    header.append(createTextElement("span", "command-update-cell command-update-header-cell", heading));
  }
  return header;
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

function createCommandSummaryTimeRow(label: string, timestamp: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "command-summary-row";
  row.append(
    createTextElement("span", "command-summary-label", `${label} `),
    createTimestampElement(timestamp, "command-summary-value", "precise")
  );
  return row;
}

function createTimelineHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "event-header";
  for (const heading of ["Time", "Code", "Item", "Command / Key", "Source"]) {
    header.append(createTextElement("span", "event-cell event-header-cell", heading));
  }
  return header;
}

function createWindowNavigationButton(
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

function clampWindowOffset(offset: number, total: number, windowSize: number): number {
  return Math.min(Math.max(0, offset), Math.max(0, total - 1));
}

function oldestWindowOffset(total: number, offset: number, windowSize: number): number {
  if (total <= 0) {
    return 0;
  }
  const anchor = Math.max(0, offset) % windowSize;
  if (anchor >= total) {
    return total - 1;
  }
  return anchor + Math.floor((total - 1 - anchor) / windowSize) * windowSize;
}

function lastStartWindowOffset(total: number, windowSize: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.floor((total - 1) / windowSize) * windowSize;
}

function clampStartWindowOffset(offset: number, total: number, windowSize: number): number {
  return Math.min(Math.max(0, offset), lastStartWindowOffset(total, windowSize));
}

function windowFromLatest<T>(
  values: readonly T[],
  offset: number,
  windowSize: number
): readonly T[] {
  const safeOffset = clampWindowOffset(offset, values.length, windowSize);
  const end = Math.max(0, values.length - safeOffset);
  const start = Math.max(0, end - windowSize);
  return values.slice(start, end);
}

function windowFromStart<T>(
  values: readonly T[],
  offset: number,
  windowSize: number
): readonly T[] {
  const safeOffset = clampStartWindowOffset(offset, values.length, windowSize);
  return values.slice(safeOffset, safeOffset + windowSize);
}

function createDetailPaneHeader(title: string, onCollapse: () => void): HTMLElement {
  const header = document.createElement("div");
  header.className = "detail-pane-header";
  const heading = createTextElement("h2", "detail-heading", title);
  const collapseButton = document.createElement("button");
  collapseButton.className = "detail-collapse-button";
  collapseButton.type = "button";
  collapseButton.textContent = "Collapse";
  collapseButton.setAttribute("aria-label", `Collapse ${title}`);
  collapseButton.addEventListener("click", onCollapse);
  header.append(heading, collapseButton);
  return header;
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
        resolveCommandItemIdentity(event.subscription, event.item).itemId === item.itemId &&
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

function reconcileCommandSelection(
  item: CommandItemGroup,
  selection: CommandSelection,
  matchingRows: readonly CommandRow[],
  matchingDeleted: readonly DeletedCommandKey[],
  matchingDiagnostics: readonly CommandDiagnostic[]
): CommandSelection {
  if (
    selection &&
    findVisibleCommandDetailTarget(
      item,
      selection,
      matchingRows,
      matchingDeleted,
      matchingDiagnostics
    )
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

function commandSelectionForKey(row: CommandKeyRow): CommandRowSelection {
  return row.status === "active" ? commandSelectionForRow(row) : commandSelectionForDeleted(row);
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

function commandSelectionMatchesKey(selection: CommandSelection, row: CommandKeyRow): boolean {
  return row.status === "active"
    ? commandSelectionMatchesRow(selection, row)
    : commandSelectionMatchesDeleted(selection, row);
}

function commandSelectionsEqual(left: CommandSelection, right: CommandSelection): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.status !== right.status) {
    return false;
  }
  if (
    left.subscriptionId !== right.subscriptionId ||
    left.itemId !== right.itemId ||
    left.key !== right.key
  ) {
    return false;
  }
  if (left.status === "diagnostic" && right.status === "diagnostic") {
    return left.diagnosticCode === right.diagnosticCode && left.eventId === right.eventId;
  }
  return true;
}

function commandSelectionIdentity(selection: CommandSelection): string | null {
  if (!selection) {
    return null;
  }
  return [
    selection.subscriptionId,
    selection.itemId,
    selection.key ?? "",
    selection.status,
    selection.status === "diagnostic" ? selection.diagnosticCode : "",
    selection.status === "diagnostic" ? selection.eventId ?? "" : ""
  ].join("\u0000");
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
  subscription: CommandSubscriptionGroup,
  evaluation: CommandFilterEvaluation
): boolean {
  const { filters } = evaluation;
  const projection = commandRowSearchTextForEvaluation(row, item, subscription, evaluation);
  return (
    matchesTokens(projection?.searchText ?? "", filters.query) &&
    matchesText(row.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(row.key, filters.key) &&
    matchesCommandLifecycle(projection?.lifecycle, filters.command) &&
    matchesTokens(projection?.searchText ?? "", filters.source) &&
    matchesSnapshotFilter(projection?.lifecycle, filters.snapshot) &&
    matchesSyntheticFilter(projection?.lifecycle, filters.synthetic) &&
    matchesDiagnosticsFilter(projection?.lifecycle, filters.diagnostics)
  );
}

function matchesDeletedCommandKey(
  row: DeletedCommandKey,
  item: CommandItemGroup,
  subscription: CommandSubscriptionGroup,
  evaluation: CommandFilterEvaluation
): boolean {
  const { filters } = evaluation;
  const projection = deletedRowSearchTextForEvaluation(row, item, subscription, evaluation);
  return (
    matchesTokens(projection?.searchText ?? "", filters.query) &&
    matchesText(row.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(row.key, filters.key) &&
    matchesCommandLifecycle(projection?.lifecycle, filters.command) &&
    matchesTokens(projection?.searchText ?? "", filters.source) &&
    matchesSnapshotFilter(projection?.lifecycle, filters.snapshot) &&
    matchesSyntheticFilter(projection?.lifecycle, filters.synthetic) &&
    matchesDiagnosticsFilter(projection?.lifecycle, filters.diagnostics)
  );
}

function matchesCommandDiagnostic(
  diagnostic: CommandDiagnostic,
  item: CommandItemGroup,
  evaluation: CommandFilterEvaluation
): boolean {
  const { filters } = evaluation;
  let searchText = "";
  if (filters.query?.trim() || filters.diagnostics?.trim()) {
    searchText = evaluation.diagnosticSearchText.get(diagnostic) ?? "";
  }
  if ((filters.query?.trim() || filters.diagnostics?.trim()) && !searchText) {
    searchText = normalizeSearchText([
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
    evaluation.diagnosticSearchText.set(diagnostic, searchText);
  }
  return (
    matchesTokens(searchText, filters.query) &&
    matchesText(item.subscriptionId, filters.subscription) &&
    matchesText(commandItemLabel(item), filters.item) &&
    matchesText(diagnostic.key ?? "", filters.key) &&
    matchesText(diagnostic.command ?? diagnostic.code, filters.command) &&
    matchesTokens(searchText, filters.diagnostics)
  );
}

function commandRowSearchTextForEvaluation(
  row: CommandRow,
  item: CommandItemGroup,
  subscription: CommandSubscriptionGroup,
  evaluation: CommandFilterEvaluation
): CommandRowSearchProjection | null {
  if (!requiresCommandLifecycleProjection(evaluation.filters)) {
    return null;
  }
  const cached = evaluation.rowSearchText.get(row);
  if (cached !== undefined) {
    return cached;
  }
  const persistentKey = commandSearchTextKey(row.subscriptionId, row.itemId, row.key);
  const lifecycle = updateCommandLifecycleSearchIndex(
    row.lifecycle,
    evaluation.persistentSearchText,
    persistentKey,
    needsCommandSearchText(evaluation.filters)
  );
  const projection = {
    searchText: {
      primary: needsCommandSearchText(evaluation.filters)
        ? [
            normalizeSearchText([
              row.subscriptionId,
              subscription.mode,
              commandItemLabel(item),
              row.itemId,
              row.key,
              row.status,
              provenanceLabel(row.origin),
              latestRowLabel(row),
              lifecycle.diagnosticCodes.size === 0
                ? "none"
                : Array.from(lifecycle.diagnosticCodes).join(" "),
              JSON.stringify(row.fields)
            ])
          ]
        : [],
      lifecycle
    },
    lifecycle
  } satisfies CommandRowSearchProjection;
  evaluation.rowSearchText.set(row, projection);
  return projection;
}

function deletedRowSearchTextForEvaluation(
  row: DeletedCommandKey,
  item: CommandItemGroup,
  subscription: CommandSubscriptionGroup,
  evaluation: CommandFilterEvaluation
): CommandRowSearchProjection | null {
  if (!requiresCommandLifecycleProjection(evaluation.filters)) {
    return null;
  }
  const cached = evaluation.deletedSearchText.get(row);
  if (cached !== undefined) {
    return cached;
  }
  const persistentKey = commandSearchTextKey(row.subscriptionId, row.itemId, row.key);
  const lifecycle = updateCommandLifecycleSearchIndex(
    row.lifecycle,
    evaluation.persistentSearchText,
    persistentKey,
    needsCommandSearchText(evaluation.filters)
  );
  const projection = {
    searchText: {
      primary: needsCommandSearchText(evaluation.filters)
        ? [
            normalizeSearchText([
              row.subscriptionId,
              subscription.mode,
              commandItemLabel(item),
              row.itemId,
              row.key,
              row.status,
              "deleted",
              provenanceLabel(row.deletedAt),
              lifecycle.diagnosticCodes.size === 0
                ? "none"
                : Array.from(lifecycle.diagnosticCodes).join(" ")
            ])
          ]
        : [],
      lifecycle
    },
    lifecycle
  } satisfies CommandRowSearchProjection;
  evaluation.deletedSearchText.set(row, projection);
  return projection;
}

function commandSearchTextKey(
  subscriptionId: string,
  itemId: string | null,
  key: string
): string {
  return `${subscriptionId}\u0000${itemId ?? ""}\u0000${key}`;
}

function requiresCommandLifecycleProjection(filters: CommandFilterState): boolean {
  return Boolean(
    filters.query?.trim() ||
      filters.command?.trim() ||
      filters.source?.trim() ||
      filters.snapshot ||
      filters.synthetic ||
      filters.diagnostics?.trim()
  );
}

function needsCommandSearchText(filters: CommandFilterState): boolean {
  return Boolean(filters.query?.trim() || filters.source?.trim());
}

function updateCommandLifecycleSearchIndex(
  lifecycle: readonly CommandLifecycleEntry[],
  cache: CommandSearchTextCache,
  key: string,
  includeSearchText: boolean
): CommandLifecycleSearchIndex {
  let index = cache.keys.get(key);
  const lifecycleStillExtendsCache =
    index &&
    lifecycle.length >= index.lifecycleLength &&
    (index.lifecycleLength === 0 ||
      lifecycle[index.lifecycleLength - 1]?.eventId === index.lastEventId);

  if (!index || !lifecycleStillExtendsCache) {
    index = {
      lifecycleLength: 0,
      searchTextLength: 0,
      lastEventId: null,
      lifecycleText: [],
      tokenMatches: new Map(),
      commands: new Set(),
      diagnosticCodes: new Set(),
      hasSnapshot: false,
      hasLive: false,
      hasSynthetic: false,
      hasServer: false
    };
    cache.keys.set(key, index);
  }

  for (let entryIndex = index.lifecycleLength; entryIndex < lifecycle.length; entryIndex += 1) {
    indexCommandLifecycleEntry(index, lifecycle[entryIndex]);
  }
  index.lifecycleLength = lifecycle.length;
  index.lastEventId = lifecycle[lifecycle.length - 1]?.eventId ?? null;

  if (includeSearchText) {
    for (
      let entryIndex = index.searchTextLength;
      entryIndex < lifecycle.length;
      entryIndex += 1
    ) {
      const entry = lifecycle[entryIndex];
      const entryText = normalizeSearchText([
        JSON.stringify(entry),
        provenanceLabel(entry.provenance)
      ]);
      index.lifecycleText.push(entryText);
      for (const [token, matched] of index.tokenMatches) {
        if (!matched && entryText.includes(token)) {
          index.tokenMatches.set(token, true);
        }
      }
    }
    index.searchTextLength = lifecycle.length;
  }

  return index;
}

function indexCommandLifecycleEntry(
  index: CommandLifecycleSearchIndex,
  entry: CommandLifecycleEntry
): void {
  if (entry.originalCommand) {
    index.commands.add(entry.originalCommand.toLowerCase());
  }
  if (entry.effectiveCommand) {
    index.commands.add(entry.effectiveCommand.toLowerCase());
  }
  for (const code of entry.diagnosticCodes) {
    index.diagnosticCodes.add(code.toLowerCase());
  }
  index.hasSnapshot ||= entry.isSnapshot;
  index.hasLive ||= !entry.isSnapshot;
  index.hasSynthetic ||= entry.provenance.synthetic;
  index.hasServer ||= !entry.provenance.synthetic;
}

function normalizeSearchText(values: Array<unknown>): string {
  return values
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();
}

function matchesTokens(
  searchText: string | CommandSearchProjection,
  filter: string | undefined
): boolean {
  const tokens = filter?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  if (typeof searchText === "string") {
    return tokens.every((token) => searchText.includes(token));
  }
  return tokens.every(
    (token) =>
      searchText.primary.some((part) => part.includes(token)) ||
      commandLifecycleSearchMatchesToken(searchText.lifecycle, token)
  );
}

function commandLifecycleSearchMatchesToken(
  lifecycle: CommandLifecycleSearchIndex,
  token: string
): boolean {
  const cached = lifecycle.tokenMatches.get(token);
  if (cached !== undefined) {
    return cached;
  }
  const matched = lifecycle.lifecycleText.some((part) => part.includes(token));
  lifecycle.tokenMatches.set(token, matched);
  return matched;
}

function matchesText(value: string, filter: string | undefined): boolean {
  return !filter?.trim() || value.toLowerCase().includes(filter.trim().toLowerCase());
}

function matchesCommandLifecycle(
  lifecycle: CommandLifecycleSearchIndex | undefined,
  command: string | undefined
): boolean {
  if (!command?.trim()) {
    return true;
  }
  const normalized = command.trim().toLowerCase();
  return Array.from(lifecycle?.commands ?? []).some((candidate) =>
    candidate.includes(normalized)
  );
}

function matchesSnapshotFilter(
  lifecycle: CommandLifecycleSearchIndex | undefined,
  snapshot: string | undefined
): boolean {
  if (!snapshot) {
    return true;
  }
  return snapshot === "snapshot" ? Boolean(lifecycle?.hasSnapshot) : Boolean(lifecycle?.hasLive);
}

function matchesSyntheticFilter(
  lifecycle: CommandLifecycleSearchIndex | undefined,
  synthetic: string | undefined
): boolean {
  if (!synthetic) {
    return true;
  }
  return synthetic === "synthetic"
    ? Boolean(lifecycle?.hasSynthetic)
    : Boolean(lifecycle?.hasServer);
}

function matchesDiagnosticsFilter(
  lifecycle: CommandLifecycleSearchIndex | undefined,
  diagnostics: string | undefined
): boolean {
  if (!diagnostics?.trim()) {
    return true;
  }
  const normalized = diagnostics.trim().toLowerCase();
  if (normalized === "none") {
    return (lifecycle?.diagnosticCodes.size ?? 0) === 0;
  }
  return Array.from(lifecycle?.diagnosticCodes ?? []).some((code) =>
    code.includes(normalized)
  );
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

function detailSourceLabel(
  event: LightstreamerEventEnvelope
): "Listener" | "Wire" | "Listener replay" | "Workbench only" {
  if (event.synthetic || event.source === "synthetic") {
    return event.raw?.executionTarget === "workbench-only"
      ? "Workbench only"
      : "Listener replay";
  }
  return event.captureSource === "wire" ? "Wire" : "Listener";
}

function safeClassSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function createReinjectionMessageElement(message: ReinjectionMessage): HTMLParagraphElement {
  const element = createTextElement(
    "p",
    `reinjection-message ${message.kind}`,
    message.text
  );
  if (message.kind === "error") {
    element.setAttribute("role", "alert");
  } else {
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
  }
  if (message.detail) {
    element.append(createTextElement("span", "reinjection-detail", message.detail));
  }
  return element;
}

function draftChangeCount(draft: ReinjectionDraft): number {
  const changed = new Set(Object.keys(deriveChangedFields(draft.sourceFields, draft.fields)));
  if (draft.command !== draft.sourceCommand) {
    changed.add("command");
  }
  if (draft.key !== draft.sourceKey) {
    changed.add("key");
  }
  if (draft.isSnapshot !== draft.sourceIsSnapshot) {
    changed.add("snapshot");
  }
  return changed.size;
}

function draftFieldType(value: DraftFieldValue | undefined): "string" | "number" | "boolean" | "null" {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "string";
}

function defaultValueForDraftType(
  type: string,
  current: DraftFieldValue | undefined
): DraftFieldValue {
  switch (type) {
    case "string":
      return typeof current === "string" ? current : current === null || current === undefined ? "" : String(current);
    case "number":
      return typeof current === "number" ? current : 0;
    case "boolean":
      return typeof current === "boolean" ? current : false;
    default:
      return null;
  }
}

type PrimitiveValueOptions = {
  showPreview?: boolean;
};

function createPrimitiveValue(
  value: DraftFieldValue | undefined,
  options: PrimitiveValueOptions = {}
): HTMLElement {
  const container = document.createElement("div");
  container.className = "draft-primitive-value";
  const jsonSummary = structuredJsonSummary(value);
  container.append(
    createTextElement(
      "span",
      jsonSummary ? "draft-primitive-json-summary" : "draft-primitive-raw",
      jsonSummary ?? (value === undefined ? "—" : value === null ? "null" : String(value))
    )
  );
  if (typeof value === "string" && options.showPreview !== false) {
    const parsed = createParsedJsonDisclosure(value);
    if (parsed) {
      container.append(parsed);
    }
  }
  return container;
}

function shouldUseExpandedJsonEditor(
  original: DraftFieldValue | undefined,
  current: DraftFieldValue | undefined
): boolean {
  return [original, current].some(
    (value) =>
      typeof value === "string" &&
      value.length >= 160 &&
      parseStructuredJsonString(value) !== null
  );
}

function parseStructuredJsonString(value: string): Record<string, unknown> | unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) || isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function structuredJsonSummary(value: DraftFieldValue | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = parseStructuredJsonString(value);
  if (!parsed) {
    return null;
  }
  const shape = Array.isArray(parsed)
    ? `${parsed.length.toLocaleString()} ${parsed.length === 1 ? "item" : "items"}`
    : `${Object.keys(parsed).length.toLocaleString()} ${Object.keys(parsed).length === 1 ? "key" : "keys"}`;
  return `JSON ${Array.isArray(parsed) ? "array" : "object"} · ${shape} · ${formatTextSize(value.length)}`;
}

function formatTextSize(length: number): string {
  if (length < 1_000) {
    return `${length.toLocaleString()} chars`;
  }
  return `${(length / 1_000).toFixed(length < 10_000 ? 1 : 0)}k chars`;
}

function formatJsonStringForEditor(value: string): string {
  const parsed = parseStructuredJsonString(value);
  return parsed ? JSON.stringify(parsed, null, 2) : value;
}

function createParsedJsonDisclosure(
  value: string,
  label = "Formatted preview"
): HTMLDetailsElement | null {
  const parsed = parseStructuredJsonString(value);
  if (!parsed) {
    return null;
  }
  const disclosure = document.createElement("details");
  disclosure.className = "parsed-json-disclosure";
  const summary = document.createElement("summary");
  summary.textContent = label;
  const payload = document.createElement("pre");
  payload.className = "parsed-json-value";
  payload.textContent = JSON.stringify(parsed, null, 2);
  disclosure.append(summary, payload);
  return disclosure;
}

function createFilterInput(label: string, className: string, placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = `filter-control ${className}`;
  input.setAttribute("aria-label", label);
  input.placeholder = placeholder;
  return input;
}

type DetailSectionOptions = {
  open?: boolean;
  summary?: string | number | null;
};

function appendDetailSection(
  parent: HTMLElement,
  heading: string,
  value: unknown,
  options: DetailSectionOptions = {}
): void {
  if (value === undefined || value === null) {
    return;
  }

  const section = document.createElement("details");
  section.className = "detail-section";
  section.dataset.detailSection = heading;
  section.open = Boolean(options.open);

  const summary = document.createElement("summary");
  summary.className = "detail-section-summary";
  summary.append(createTextElement("span", "detail-section-heading", heading));
  if (options.summary !== undefined && options.summary !== null && options.summary !== "") {
    summary.append(createTextElement("span", "detail-section-marker", String(options.summary)));
  }
  section.append(summary);

  const appendPayload = (): void => {
    if (section.querySelector(".detail-json")) {
      return;
    }
    const pre = document.createElement("pre");
    pre.className = "detail-json";
    pre.textContent = JSON.stringify(value, null, 2);
    section.append(pre);
  };
  if (section.open) {
    appendPayload();
  }
  section.addEventListener("toggle", () => {
    if (section.open) {
      appendPayload();
    }
  });
  parent.append(section);
}

function detailItemSummary(item: LightstreamerEventEnvelope["item"]): string {
  if (item?.name) {
    return item.name;
  }
  if (item?.position !== undefined && item.position !== null) {
    return `position ${item.position}`;
  }
  return "no item";
}

function detailRawSummary(raw: LightstreamerEventEnvelope["raw"]): string {
  if (!raw) {
    return "no diagnostics";
  }
  const keys = Object.keys(raw);
  return keys.length > 0 ? keys.slice(0, 3).join(", ") : "diagnostics";
}

function detailUpdateSummary(event: LightstreamerEventEnvelope): string {
  const commandKey = formatCommandKey(event);
  const snapshot = event.update?.isSnapshot ? "snapshot" : "live";
  const changed = Object.keys(event.update?.changedFields ?? {}).length;
  return `${commandKey} ${snapshot} ${changed} changed`;
}

function canCloneEvent(event: LightstreamerEventEnvelope): boolean {
  if (event.source !== "server" || event.synthetic) {
    return false;
  }
  const draft = createDraftFromEvent(event);
  return validateEditableDraft(draft).valid;
}

function createSourceContext(draft: ReinjectionDraft): HTMLElement {
  const context = document.createElement("details");
  context.className = "draft-source-context";
  const summary = document.createElement("summary");
  summary.className = "draft-source-summary";
  summary.append(
    createTextElement("span", "draft-source-summary-title", "Staged source clone"),
    createTextElement(
      "span",
      "draft-source-summary-meta",
      `${draft.sourceCommand ?? "-"}/${draft.sourceKey ?? "-"} · ${draft.sourceIsSnapshot ? "snapshot" : "live"}`
    )
  );
  context.append(summary);

  const rows: Array<[string, string]> = [
    ["Source event", draft.sourceEventId],
    ["Subscription", draft.target.subscriptionId ?? "-"],
    ["Listener", draft.target.listenerId ?? "-"],
    ["Item", draft.item.name ?? String(draft.item.position ?? "-")],
    ["Command/key", `${draft.sourceCommand ?? "-"}/${draft.sourceKey ?? "-"}`],
    ["Snapshot", draft.sourceIsSnapshot ? "snapshot" : "live"]
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

  return context;
}

function createTimestampElement(
  timestamp: number,
  className: string,
  display: "compact" | "precise" = "compact"
): HTMLTimeElement {
  const time = document.createElement("time");
  const exactLocalTime = formatExactLocalTime(timestamp);
  time.className = className;
  time.dateTime = new Date(timestamp).toISOString();
  time.title = exactLocalTime;
  time.setAttribute("aria-label", `Local time ${exactLocalTime}`);
  time.textContent = display === "precise" ? exactLocalTime : formatCompactTime(timestamp);
  return time;
}

function formatCompactTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(
    date.getSeconds()
  )}.${threeDigits(date.getMilliseconds())}`;
}

function formatExactLocalTime(timestamp: number): string {
  const date = new Date(timestamp);
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(
    date.getDate()
  )} ${formatCompactTime(timestamp)} UTC${offsetSign}${twoDigits(
    Math.floor(absoluteOffset / 60)
  )}:${twoDigits(absoluteOffset % 60)}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function threeDigits(value: number): string {
  return String(value).padStart(3, "0");
}

function formatCommandKey(event: LightstreamerEventEnvelope): string {
  const command = event.update?.command ?? "-";
  const key = event.update?.key ?? "-";
  return `${command}/${key}`;
}

function timelineCodeDefinition(event: LightstreamerEventEnvelope): TimelineCodeDefinition {
  let code: string;
  switch (event.kind) {
    case "item-update":
      code = "U";
      break;
    case "end-of-snapshot":
      code = "EOS";
      break;
    case "clear-snapshot":
      code = "CS";
      break;
    case "lost-updates":
      code = "OV";
      break;
    case "subscription-started":
      code = event.subscription?.mode?.toUpperCase() === "COMMAND" ? "SUBCMD" : "SUBOK";
      break;
    case "subscription-ended":
      code = "UNSUB";
      break;
    case "client-created":
      code = "C+";
      break;
    case "client-status":
      code = "C~";
      break;
    case "subscription-created":
      code = "S+";
      break;
    case "subscription-snapshot":
      code = "S~";
      break;
    case "subscription-error":
      code = "S!";
      break;
    case "listener-added":
      code = "L+";
      break;
    case "listener-removed":
      code = "L−";
      break;
  }
  const definition = TIMELINE_CODE_DEFINITIONS.find((candidate) => candidate.code === code);
  if (!definition) {
    throw new Error(`Missing Timeline code definition for ${event.kind}.`);
  }
  return definition;
}

function createTimelineCodeElement(
  event: LightstreamerEventEnvelope,
  className: string
): HTMLSpanElement {
  const definition = timelineCodeDefinition(event);
  const code = createTextElement("span", className, definition.code);
  code.dataset.codeFamily = definition.family;
  code.title = `${definition.code} — ${definition.label} (${event.kind})`;
  code.setAttribute(
    "aria-label",
    `${definition.code}: ${definition.label}; captured as ${event.kind}`
  );
  return code;
}

function formatTimelineItem(event: LightstreamerEventEnvelope): string {
  const itemName = event.item?.name?.trim();
  if (itemName) {
    return itemName;
  }

  const subscriptionItems = (event.subscription?.items ?? []).filter(Boolean);
  const itemPosition = event.item?.position;
  if (itemPosition !== undefined && itemPosition !== null && subscriptionItems[itemPosition - 1]) {
    return subscriptionItems[itemPosition - 1];
  }
  if (subscriptionItems.length === 1) {
    return subscriptionItems[0];
  }
  if (subscriptionItems.length > 1) {
    return `${subscriptionItems[0]} +${subscriptionItems.length - 1}`;
  }
  if (event.subscription?.itemGroup) {
    return event.subscription.itemGroup;
  }
  if (itemPosition !== undefined && itemPosition !== null) {
    return `item ${itemPosition}`;
  }
  return "—";
}

function timelineItemTitle(event: LightstreamerEventEnvelope): string {
  const items = event.subscription?.items ?? [];
  if (event.item?.name) {
    return event.item.name;
  }
  if (items.length > 0) {
    return items.join(", ");
  }
  if (event.subscription?.itemGroup) {
    return event.subscription.itemGroup;
  }
  return event.item?.position !== undefined && event.item.position !== null
    ? `Item position ${event.item.position}`
    : "No item context";
}

function formatTimelineCommandKey(event: LightstreamerEventEnvelope): string {
  const command = event.update?.command?.trim() ?? "";
  const key = event.update?.key?.trim() ?? "";
  if (command && key) {
    return `${command}/${key}`;
  }
  return command || key || "—";
}

function timelineCommandKeyTitle(event: LightstreamerEventEnvelope): string {
  const command = event.update?.command ?? null;
  const key = event.update?.key ?? null;
  if (!command && !key) {
    return "No COMMAND command or key";
  }
  return `Command ${command ?? "none"}; key ${key ?? "none"}`;
}

function timelineRowContextTitle(event: LightstreamerEventEnvelope): string {
  const definition = timelineCodeDefinition(event);
  return [
    `${definition.code} — ${definition.label}`,
    event.kind,
    event.client?.id ? `client ${event.client.id}` : null,
    event.subscription?.id ? `subscription ${event.subscription.id}` : null,
    event.subscription?.mode ? `mode ${event.subscription.mode}` : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function timelineRowAccessibleLabel(event: LightstreamerEventEnvelope): string {
  const definition = timelineCodeDefinition(event);
  const item = formatTimelineItem(event);
  const commandKey = formatTimelineCommandKey(event);
  return [
    formatExactLocalTime(event.timestamp),
    `${definition.code}, ${definition.label}`,
    item === "—" ? null : `item ${item}`,
    commandKey === "—" ? null : `command and key ${commandKey}`,
    formatMarker(event),
    event.client?.id ? `client ${event.client.id}` : null,
    event.subscription?.id ? `subscription ${event.subscription.id}` : null,
    event.subscription?.mode ? `mode ${event.subscription.mode}` : null
  ]
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

function timelineSourceTitle(event: LightstreamerEventEnvelope): string {
  if (
    (event.synthetic || event.source === "synthetic") &&
    event.raw?.executionTarget === "workbench-only"
  ) {
    return "Synthetic update applied to Workbench state only";
  }
  if (event.synthetic || event.source === "synthetic") {
    return "Synthetic update replayed through the captured listener";
  }
  return event.captureSource === "wire"
    ? "Captured from the Lightstreamer wire protocol"
    : "Captured from a Lightstreamer client listener";
}

function timelineCommandToken(event: LightstreamerEventEnvelope): string {
  const command = event.update?.command?.trim().toUpperCase();
  if (command === "ADD" || command === "UPDATE" || command === "DELETE") {
    return command;
  }
  if (event.kind === "subscription-created" || event.kind === "subscription-started") {
    return "SUBSCRIBE";
  }
  if (event.kind === "end-of-snapshot") {
    return "EOS";
  }
  return "OTHER";
}

function timelineSourceToken(event: LightstreamerEventEnvelope): "listener" | "wire" | "workbench" {
  if (event.synthetic || event.source === "synthetic") {
    return "workbench";
  }
  return event.captureSource === "wire" ? "wire" : "listener";
}

function formatMarker(event: LightstreamerEventEnvelope): string {
  if (
    (event.synthetic || event.source === "synthetic") &&
    event.raw?.executionTarget === "workbench-only"
  ) {
    return event.update?.isSnapshot ? "workbench snapshot" : "workbench live";
  }
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
    return "This capture has no original listener target. Choose Workbench only to simulate it without changing the inspected page.";
  }
  if (errors.includes("Original listener bridge is unavailable.")) {
    return "The original listener bridge is unavailable. Choose Workbench only or reconnect the inspected page.";
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
    executionTarget: event.raw?.executionTarget ?? "captured-listener",
    deliveredToPage: event.raw?.deliveredToPage ?? true,
    serverContacted: event.raw?.serverContacted ?? false,
    editedFields: event.raw?.editedFields ?? event.update?.changedFields ?? {}
  };
}

async function bootPanel(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) {
    let visible = true;
    let panel: PanelController | null = null;
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || !isPanelVisibilityMessage(event.data)) {
        return;
      }
      visible = event.data.visible;
      panel?.setVisible(visible);
    });
    root.textContent = "Initializing event storage...";
    const store = await createPanelEventStore();
    panel = renderPanel(root, undefined, { store, visible });
    const bridge = connectPanelBridge({
      onStatusChange: panel.setStatus,
      onCaptureMessage: panel.appendCaptureMessage
    });
    panel.setBridge(bridge);
  }
}

async function createPanelEventStore(): Promise<EventStore> {
  try {
    return await createIndexedDbEventStore({
      sessionId: chrome.devtools?.inspectedWindow?.tabId ?? Date.now(),
      reset: true,
      clearOnClose: true
    });
  } catch (error) {
    console.error("Falling back to in-memory event storage.", error);
    return createEventStore();
  }
}

if (document.documentElement.dataset.storeListingHarness !== "true") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void bootPanel(), { once: true });
  } else {
    void bootPanel();
  }
}
