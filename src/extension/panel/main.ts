import "./panel.css";

import {
  type CaptureMessage,
  type CaptureStatus,
  type ReinjectionResult,
  type TopologySyncFrame,
  isPanelVisibilityMessage
} from "../../bridge/messages";
import { createEventNormalizer, type EventNormalizer } from "../../core/event-normalizer";
import {
  type EventStore,
  type EventStoreStats
} from "../../core/event-store";
import {
  createEventHistory,
  createInMemoryEventHistory,
  createIndexedDbEventHistory,
  type EventHistory
} from "../../core/event-history";
import {
  type LightstreamerEventEnvelope,
  toPersistableEventEnvelope
} from "../../core/event-envelope";
import {
  hasActiveFilters,
  matchesEventFilters,
  type EventFilterState
} from "../../core/event-filter";
import {
  createCommandStateProjections,
  resolveCommandItemIdentity,
  type CommandDiagnostic,
  type CommandItemGroup,
  type CommandLifecycleEntry,
  type CommandProvenance,
  type CommandRow,
  type CommandState,
  type CommandStateProjection,
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
import {
  type TopologyClient,
  type TopologyCommandGeneration,
  type TopologyInferredChild,
  type TopologyItem,
  type TopologyListener,
  type TopologySession,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";
import {
  createDisabledAnalytics,
  createGoogleAnalytics,
  eventCountBucket,
  type AnalyticsReplayOutcome,
  type AnalyticsReplaySurface,
  type AnalyticsReplayTarget,
  type WorkbenchAnalytics,
  type WorkbenchAnalyticsEvent
} from "../analytics";
import { connectPanelBridge, type PanelBridgeConnection } from "./bridge-client";
import { createThemeManager, type ThemePreference } from "./theme";
import {
  createCommandSummaryRow,
  createCommandSummaryTimeRow,
  createCommandUpdateHeader,
  createCommandViewState,
  type CommandDiagnosticSelection,
  type CommandRowSelection,
  type CommandSelection,
  type CommandViewState
} from "./command-view";
import { createTopologyInspector } from "./topology-inspector";
import {
  createTimelineCodeLegend,
  createTimelineHeader,
  createWindowNavigationButton,
  createTimelineViewState,
  type TimelineViewMode,
  type TimelineViewState
} from "./timeline-view";
import { createTopologyExportMenu } from "./topology-export-view";
import {
  createOpenCommandStateAction,
  createTopologyActions,
  createTopologyCommandEvidence,
  topologyLatestGenerationSummary,
  topologyLatestInferredChildSummary
} from "./topology-actions-view";
import { createTopologyStructuredSnapshot, type TopologySensitiveCategory } from "./topology-export";
import { clampNumber, createTextElement } from "./panel-dom";
import {
  applyTopologyNodePresentation,
  attachTopologyTreeChildren,
  createTopologyTreeGroup,
  createTopologyTreeNode,
  type RenderedTopologyNode,
  type TopologyTreeNode,
  type TopologyTreeViewOptions
} from "./topology-tree-view";
import { createTopologyProjection } from "./topology-projection";
import {
  createTopologyTreeViewModel,
  findTopologySelection,
  topologyClientNodePresentation,
  topologyItemLabel,
  topologyItemNodePresentation,
  topologyItemTone,
  topologyListenerNodePresentation,
  topologyPageNodePresentation,
  topologySessionNodePresentation,
  topologySessionTone,
  topologySubscriptionNodePresentation,
  topologySubscriptionTone,
  topologyToneLabel,
  type TopologyNodePresentation,
  type TopologySelection,
  type TopologySelectionTarget
} from "./topology-view-model";

type PanelState = {
  status: CaptureStatus;
};

export type PanelController = {
  setStatus(status: CaptureStatus): void;
  appendCaptureMessage(message: CaptureMessage): void;
  applyTopologySyncFrame(frame: TopologySyncFrame): void;
  clearEvents(): void;
  setBridge(bridge: PanelReinjectBridge): void;
  setVisible(visible: boolean): void;
  dispose(): void;
};

export type RenderPanelOptions = {
  history?: EventHistory;
  /** @deprecated Prefer the storage-independent history seam. */
  store?: EventStore;
  normalizer?: EventNormalizer;
  bridge?: PanelReinjectBridge;
  visible?: boolean;
  analytics?: WorkbenchAnalytics;
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
type ActiveView = "timeline" | "topology" | "command";
type LiveReinjectionTarget = {
  executionTarget: ReinjectionExecutionTarget;
  subscriptionId: string;
  listenerId: string | null;
  clientId: string | null;
  sessionId: string | null;
  connectionEpoch: number | null;
  available: boolean;
  confirmedAt: number;
};
type LiveClientConnection = {
  sessionId: string | null;
  status: string | null;
  transport: string | null;
  epoch: number;
};
type DraftTargetStatus = {
  live: boolean;
  state: "live" | "session-mismatch" | "stale";
  summary: string;
  error: string | null;
};
type TopologyRenderPerformanceSample = {
  durationMs: number;
  logicalUpdateCount: number;
  deliveryCount: number;
  visibleNodeCount: number;
};
type DeferredTopologyItemRender = {
  group: HTMLUListElement;
  render(): HTMLElement;
};
type DraftSurface = "timeline" | "command-replay" | "new-command";
const TOPOLOGY_INLINE_ITEM_LIMIT = 20;
const TOPOLOGY_SELECTED_ITEM_LIMIT = 200;
const TOPOLOGY_FULL_ITEM_LIMIT = 1_000;
const TOPOLOGY_DEFERRED_ITEM_THRESHOLD = 200;
const TOPOLOGY_ITEM_RENDER_CHUNK = 50;
const TOPOLOGY_EVIDENCE_INITIAL_LIMIT = 25;
const TOPOLOGY_EVIDENCE_CHUNK = 25;
const HISTORICAL_TOPOLOGY_NOTE =
  "Frozen record only. The Workbench does not maintain or reconnect this session. Historical topology is read-only; matching captured events remain available subject to event retention.";
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
  passiveStoreUpdate?: boolean;
};
type ScheduledRender = {
  cancel(): void;
};
type PaneState = {
  scrollTop: number;
  scrollLeft: number;
  focusSelector: string | null;
  selection: { start: number | null; end: number | null } | null;
  controlScroll: { top: number; left: number } | null;
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
    code: "SF",
    label: "Real max frequency",
    description: "Workbench captured the max update frequency accepted by the server.",
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

function createProductLabel(): HTMLHeadingElement {
  const title = document.createElement("h1");
  title.className = "product-label";
  const icon = document.createElement("img");
  icon.className = "product-icon";
  icon.src = extensionAssetUrl("icons/title-icon.svg");
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.decoding = "async";
  const text = createTextElement("span", "product-label-text", "Lightstreamer Workbench");
  title.append(icon, text);
  return title;
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

function reportHistoryError(error: unknown): void {
  console.error("Lightstreamer Workbench history operation failed", error);
}

export function renderPanel(
  root: HTMLElement,
  state: PanelState = initialState,
  options: RenderPanelOptions = {}
): PanelController {
  const panelState = { ...state };
  const history =
    options.history ??
    (options.store
      ? createEventHistory(options.store)
      : createInMemoryEventHistory());
  const normalizer = options.normalizer ?? createEventNormalizer();
  const analytics = options.analytics ?? createDisabledAnalytics();
  let selectedEventId: string | null = null;
  let selectedTimelineEvent: LightstreamerEventEnvelope | null = null;
  let selectedPinned = false;
  const timelineState: TimelineViewState = createTimelineViewState(
    TIMELINE_DEFAULT_DETAIL_WIDTH
  );
  let currentStoreStats: EventStoreStats = storeStatsSnapshot();
  let draft: ReinjectionDraft | null = null;
  let draftExecutionTarget: ReinjectionExecutionTarget = "captured-listener";
  let draftEditing = false;
  let draftJsonText: string | null = null;
  let draftJsonError: string | null = null;
  let draftRenderVersion = 0;
  let draftResultEventId: string | null = null;
  let draftSurface: DraftSurface | null = null;
  let detailCopyEventId: string | null = null;
  let detailCopyMessage: ReinjectionMessage | null = null;
  let bridge = options.bridge ?? null;
  // A bridge supplied at construction time is a test/embedded bridge with no
  // independent status channel. Production installs its bridge through
  // setBridge(), where readiness is gated by the reported capture status.
  let bridgeReady = Boolean(options.bridge);
  let reinjectionPending = false;
  let reinjectionMessage: ReinjectionMessage | null = null;
  let activeView: ActiveView = "timeline";
  const commandStateView: CommandViewState = createCommandViewState();
  const commandContextEvents: LightstreamerEventEnvelope[] = [];
  const commandContextEventIds = new Set<string>();
  const commandContextSubscriptionIds = new Set<string>();
  const commandStateProjections = createCommandStateProjections();
  let commandStateProjection: CommandStateProjection = "local-effective";
  const topologyProjection = createTopologyProjection();
  const liveReinjectionTargets = new Map<string, LiveReinjectionTarget>();
  const liveClientConnections = new Map<string, LiveClientConnection>();
  const sourceEventConnectionEpochs = new Map<string, number>();
  let topologySelection: TopologySelection = { key: "page", kind: "page" };
  let topologyExpandAllItems = false;
  let topologyTreeItemBudget = 0;
  let topologyDeferredItemCollector: DeferredTopologyItemRender[] | null = null;
  let pendingTopologyItemRenders: DeferredTopologyItemRender[] = [];
  let scheduledTopologyItemRender: ScheduledRender | null = null;
  let renderedTopologyStructureKey: string | null = null;
  const topologyRenderedNodes = new Map<string, RenderedTopologyNode>();
  const topologyNodeSelections = new Map<string, TopologySelection>();
  const topologyCollapsedKeys = new Set<string>();
  const topologyExpandedEvidence = new Set<string>();
  const topologyEvidenceLimits = new Map<string, number>();
  const topologyExportRedactions = new Set<TopologySensitiveCategory>();
  let topologyExportCompleteEvidence = false;
  let highVolumeNoticeDismissed = false;
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
  let analyticsDisclosureRequested =
    analytics.available && analytics.getConsent() === "unknown";
  let analyticsConsentPending = false;
  let analyticsControlError: string | null = null;
  let analyticsSummarySent = false;
  let analyticsDetected = false;
  let analyticsCapturedEventCount = 0;
  let analyticsCommandViewUsed = false;
  let analyticsReplayUsed = false;
  const analyticsSearchViews = new Set<ActiveView>();
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
  const clearTimelineFilters = document.createElement("button");
  clearTimelineFilters.className = "timeline-filter-clear";
  clearTimelineFilters.type = "button";
  clearTimelineFilters.textContent = "Clear Timeline filters";
  clearTimelineFilters.hidden = true;
  clearTimelineFilters.addEventListener("click", () => {
    for (const key of Object.keys(filterState) as Array<
      keyof EventFilterState
    >) {
      delete filterState[key];
    }
    searchInput.value = "";
    resetTimelineRenderLimit();
    timelineState.selectionNeedsFilterReconciliation = true;
    renderFeed();
  });

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
    history.stats().receive(renderEventVolumeNotice, reportHistoryError);
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

  const analyticsControlButton = document.createElement("button");
  analyticsControlButton.className = "analytics-control";
  analyticsControlButton.type = "button";
  analyticsControlButton.addEventListener("click", () => {
    if (analyticsConsentPending) {
      return;
    }
    if (analytics.getConsent() === "granted") {
      void setAnalyticsConsent("denied");
      return;
    }
    analyticsDisclosureRequested = true;
    analyticsControlError = null;
    renderAnalyticsControls();
    analyticsAllowButton.focus();
  });

  toolbarMeta.append(
    status,
    eventCount,
    filteredCount,
    clearTimelineFilters,
    retentionNotice,
    themeControl,
    analyticsControlButton,
    clearButton
  );
  toolbar.append(title, toolbarMeta);

  const analyticsDisclosure = document.createElement("section");
  analyticsDisclosure.className = "analytics-disclosure";
  analyticsDisclosure.setAttribute("aria-label", "Optional usage analytics");

  const analyticsDisclosureCopy = document.createElement("div");
  analyticsDisclosureCopy.className = "analytics-disclosure-copy";
  analyticsDisclosureCopy.append(
    createTextElement("strong", "analytics-disclosure-heading", "Optional usage analytics"),
    createTextElement(
      "p",
      "analytics-disclosure-body",
      "Help improve the workbench by sharing coarse feature usage: views used, whether search or local replay was used, replay result category, and a bucketed captured-event count. Google Analytics receives a random installation ID plus standard request and device information. The extension never sends inspected URLs, Lightstreamer server addresses, captured values, item, field, or key names, search text, or error details. Analytics is not used for advertising."
    )
  );

  const analyticsDisclosureActions = document.createElement("div");
  analyticsDisclosureActions.className = "analytics-disclosure-actions";

  const analyticsAllowButton = document.createElement("button");
  analyticsAllowButton.className = "analytics-allow-button";
  analyticsAllowButton.type = "button";
  analyticsAllowButton.textContent = "Allow analytics";
  analyticsAllowButton.addEventListener("click", () => {
    void setAnalyticsConsent("granted");
  });

  const analyticsDeclineButton = document.createElement("button");
  analyticsDeclineButton.className = "analytics-decline-button";
  analyticsDeclineButton.type = "button";
  analyticsDeclineButton.textContent = "Not now";
  analyticsDeclineButton.addEventListener("click", () => {
    void setAnalyticsConsent("denied");
  });

  const analyticsPrivacyLink = document.createElement("a");
  analyticsPrivacyLink.className = "analytics-privacy-link";
  analyticsPrivacyLink.href =
    "https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/PRIVACY.md";
  analyticsPrivacyLink.target = "_blank";
  analyticsPrivacyLink.rel = "noopener noreferrer";
  analyticsPrivacyLink.referrerPolicy = "no-referrer";
  analyticsPrivacyLink.textContent = "Privacy details";

  const analyticsControlMessage = createTextElement(
    "p",
    "analytics-control-message",
    ""
  );
  analyticsControlMessage.hidden = true;

  analyticsDisclosureActions.append(
    analyticsAllowButton,
    analyticsDeclineButton,
    analyticsPrivacyLink
  );
  analyticsDisclosure.append(
    analyticsDisclosureCopy,
    analyticsDisclosureActions,
    analyticsControlMessage
  );

  const viewSelector = document.createElement("nav");
  viewSelector.className = "view-selector";
  viewSelector.setAttribute("aria-label", "Workbench view");

  const timelineViewButton = createViewButton("Timeline", "timeline");
  const topologyViewButton = createViewButton("Topology", "topology");
  const commandViewButton = createViewButton("COMMAND State", "command");
  viewSelector.append(timelineViewButton, topologyViewButton, commandViewButton);

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
    recordAnalyticsSearch("timeline", searchInput.value);
    setFilter("query", searchInput.value);
  });

  const timelineDisplayState = document.createElement("div");
  timelineDisplayState.className = "timeline-display-state";
  timelineDisplayState.setAttribute("aria-label", "Timeline view state");
  const timelineDisplayBadge = createTextElement(
    "strong",
    "timeline-display-badge",
    "Live"
  );
  const timelineDisplaySummary = createTextElement(
    "span",
    "timeline-display-summary",
    "Following current activity"
  );
  const timelineDisplayAction = document.createElement("button");
  timelineDisplayAction.className = "timeline-display-action";
  timelineDisplayAction.type = "button";
  timelineDisplayAction.textContent = "Freeze view";
  timelineDisplayAction.addEventListener("click", () => {
    if (timelineState.viewMode === "live") {
      setTimelineViewMode("frozen");
      renderFeed({ preservePaneState: true });
      return;
    }
    followLiveTimeline();
  });
  timelineDisplayState.append(
    timelineDisplayBadge,
    timelineDisplaySummary,
    timelineDisplayAction
  );

  filterStrip.append(
    searchInput,
    createTimelineCodeLegend(TIMELINE_CODE_DEFINITIONS),
    timelineDisplayState
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
    recordAnalyticsSearch("command", commandSearchInput.value);
    setCommandFilter("query", commandSearchInput.value);
  });

  const commandProjectionLabel = document.createElement("label");
  commandProjectionLabel.className = "command-projection-control";
  commandProjectionLabel.append(
    createTextElement("span", "command-projection-label", "Projection")
  );
  const commandProjectionSelect = document.createElement("select");
  commandProjectionSelect.className = "filter-control command-projection-select";
  commandProjectionSelect.setAttribute("aria-label", "COMMAND state projection");
  commandProjectionSelect.append(
    createOption("local-effective", "Local Effective"),
    createOption("observed-server", "Observed Server")
  );
  commandProjectionSelect.value = commandStateProjection;
  commandProjectionSelect.addEventListener("change", () => {
    commandStateProjection =
      commandProjectionSelect.value === "observed-server"
        ? "observed-server"
        : "local-effective";
    resetCommandListWindows();
    renderCommandState();
  });
  commandProjectionLabel.append(commandProjectionSelect);

  commandFilterStrip.append(commandSearchInput, commandProjectionLabel);

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

  const topologyInspector = createTopologyInspector({
    onSelect(key) {
      const selection = topologyNodeSelections.get(key);
      if (!selection) {
        return;
      }
      topologySelection = selection;
      renderTopology();
    },
    onToggle(key, collapsed) {
      if (collapsed) {
        topologyCollapsedKeys.add(key);
      } else {
        topologyCollapsedKeys.delete(key);
      }
    }
  });
  const topologyWorkspace = topologyInspector.element;
  const topologyOverview = topologyInspector.overview;
  const topologyTreePane = topologyInspector.treePane;
  const topologyDetailPane = topologyInspector.detailPane;

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
  root.append(
    toolbar,
    analyticsDisclosure,
    viewSelector,
    filterStrip,
    commandFilterStrip,
    workspace,
    topologyWorkspace,
    commandWorkspace
  );
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
  renderAnalyticsControls();
  trackAnalytics({ name: "panel_view" });
  updateActiveViewChrome();

  function analyticsEnabled(): boolean {
    return analytics.available && analytics.getConsent() === "granted";
  }

  function trackAnalytics(event: WorkbenchAnalyticsEvent): void {
    if (!analyticsEnabled()) {
      return;
    }
    void analytics.track(event);
  }

  function resetAnalyticsSessionMetrics(): void {
    analyticsSummarySent = false;
    analyticsDetected = false;
    analyticsCapturedEventCount = 0;
    analyticsCommandViewUsed = false;
    analyticsReplayUsed = false;
    analyticsSearchViews.clear();
  }

  async function setAnalyticsConsent(
    nextConsent: "granted" | "denied"
  ): Promise<void> {
    if (analyticsConsentPending || !analytics.available) {
      return;
    }

    analyticsConsentPending = true;
    analyticsControlError = null;
    renderAnalyticsControls();
    try {
      const updated = await analytics.setConsent(nextConsent);
      if (!updated) {
        analyticsDisclosureRequested = true;
        analyticsControlError =
          "Usage analytics is unavailable in this build. Nothing was sent.";
        return;
      }

      analyticsDisclosureRequested = false;
      resetAnalyticsSessionMetrics();
      if (nextConsent === "granted") {
        trackAnalytics({ name: "analytics_enabled" });
        if (panelVisible) {
          trackAnalytics({ name: "panel_view" });
        }
      }
    } catch {
      analyticsDisclosureRequested = true;
      analyticsControlError = "Usage analytics could not be updated. Nothing was sent.";
    } finally {
      analyticsConsentPending = false;
      renderAnalyticsControls();
    }
  }

  function renderAnalyticsControls(): void {
    const consent = analytics.getConsent();
    analyticsControlButton.hidden = !analytics.available;
    analyticsControlButton.disabled = analyticsConsentPending;
    analyticsControlButton.dataset.enabled = String(consent === "granted");
    analyticsControlButton.textContent =
      consent === "granted" ? "Usage analytics: On" : "Usage analytics: Off";
    analyticsControlButton.title =
      consent === "granted"
        ? "Turn off usage analytics and remove its random installation ID."
        : "Review the optional usage analytics disclosure.";

    analyticsAllowButton.disabled = analyticsConsentPending;
    analyticsDeclineButton.disabled = analyticsConsentPending;
    analyticsAllowButton.textContent = analyticsConsentPending
      ? "Updating..."
      : "Allow analytics";
    analyticsDisclosure.hidden =
      !analytics.available || !analyticsDisclosureRequested;
    analyticsControlMessage.hidden = !analyticsControlError;
    analyticsControlMessage.textContent = analyticsControlError ?? "";
  }

  function flushAnalyticsSummary(): void {
    if (analyticsSummarySent || !analyticsEnabled()) {
      return;
    }
    analyticsSummarySent = true;
    trackAnalytics({
      name: "session_summary",
      eventCountBucket: eventCountBucket(analyticsCapturedEventCount),
      commandViewUsed: analyticsCommandViewUsed,
      searchUsed: analyticsSearchViews.size > 0,
      replayUsed: analyticsReplayUsed
    });
  }

  function recordAnalyticsReplayAttempt(
    surface: AnalyticsReplaySurface,
    executionTarget: ReinjectionExecutionTarget,
    edited: boolean
  ): void {
    if (!analyticsEnabled()) {
      return;
    }
    analyticsReplayUsed = true;
    trackAnalytics({
      name: "replay_attempt",
      surface,
      target: analyticsReplayTarget(executionTarget),
      edited
    });
  }

  function recordAnalyticsReplayResult(
    surface: AnalyticsReplaySurface,
    executionTarget: ReinjectionExecutionTarget,
    edited: boolean,
    result: ReinjectionResult
  ): void {
    trackAnalytics({
      name: "replay_result",
      surface,
      target: analyticsReplayTarget(executionTarget),
      edited,
      outcome: analyticsReplayOutcome(result)
    });
  }

  function currentAnalyticsReplaySurface(): AnalyticsReplaySurface {
    if (draftSurface === "command-replay") {
      return "command_state";
    }
    if (draftSurface === "new-command") {
      return "new_command";
    }
    return "timeline";
  }

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
    timelineState.selectionNeedsFilterReconciliation = true;
    renderFeed();
  }

  function recordAnalyticsSearch(view: ActiveView, value: string): void {
    if (!analyticsEnabled() || value.trim() === "" || analyticsSearchViews.has(view)) {
      return;
    }
    analyticsSearchViews.add(view);
    trackAnalytics({
      name: "search_used",
      view: view === "command" ? "command_state" : "timeline"
    });
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
      const changed = activeView !== view;
      activeView = view;
      if (changed && analyticsEnabled()) {
        analyticsCommandViewUsed ||= view === "command";
        trackAnalytics({
          name: "view_changed",
          view:
            view === "command"
              ? "command_state"
              : view === "topology"
                ? "topology"
                : "timeline"
        });
      }
      updateActiveViewChrome();
      renderActiveView();
    });
    return button;
  }

  function updateActiveViewChrome(): void {
    timelineViewButton.dataset.active = String(activeView === "timeline");
    topologyViewButton.dataset.active = String(activeView === "topology");
    commandViewButton.dataset.active = String(activeView === "command");
    timelineViewButton.setAttribute("aria-current", activeView === "timeline" ? "page" : "false");
    topologyViewButton.setAttribute(
      "aria-current",
      activeView === "topology" ? "page" : "false"
    );
    commandViewButton.setAttribute("aria-current", activeView === "command" ? "page" : "false");
    filterStrip.hidden = activeView !== "timeline";
    workspace.hidden = activeView !== "timeline";
    topologyInspector.setActive(activeView === "topology");
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
    if (activeView === "topology") {
      renderTopology();
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
      preservePaneState: Boolean(left?.preservePaneState || right.preservePaneState),
      passiveStoreUpdate: Boolean(left?.passiveStoreUpdate || right.passiveStoreUpdate)
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
    timelineState.windowOffset = 0;
    timelineState.historyAnchor = 0;
    timelineState.viewMode = "live";
    timelineState.newerEventCount = 0;
    timelineState.followLatest = true;
    timelineState.visibleTotal = 0;
    timelineState.lastScrollTop = 0;
    timelineState.scrollNavigationPending = null;
    resetTimelineLiveReconciliation();
    renderTimelineDisplayState();
  }

  function setTimelineViewMode(mode: TimelineViewMode): void {
    if (timelineState.viewMode !== mode) {
      timelineState.viewMode = mode;
      timelineState.newerEventCount = mode === "frozen" ? timelineState.windowOffset : 0;
    }
    timelineState.followLatest = mode === "live" && timelineState.windowOffset === 0;
    renderTimelineDisplayState();
  }

  function followLiveTimeline(): void {
    timelineState.windowOffset = 0;
    timelineState.scrollNavigationPending = null;
    setTimelineViewMode("live");
    renderFeed({ preservePaneState: true });
  }

  function renderTimelineDisplayState(): void {
    if (!timelineDisplayBadge) {
      return;
    }
    const live = timelineState.viewMode === "live";
    timelineDisplayState.dataset.mode = timelineState.viewMode;
    timelineDisplayBadge.textContent = live ? "Live" : "Frozen";
    timelineDisplaySummary.textContent = live
      ? `${currentStoreStats.retained.toLocaleString()} retained · following current activity`
      : `${timelineState.newerEventCount.toLocaleString()} newer · ${currentStoreStats.retained.toLocaleString()} retained`;
    timelineDisplayAction.textContent = live ? "Freeze view" : "Follow live";
    timelineDisplayAction.setAttribute(
      "aria-label",
      live ? "Freeze Timeline view" : `Follow live Timeline, ${timelineState.newerEventCount} newer events`
    );
  }

  function resetTimelineLiveReconciliation(): void {
    timelineState.latestQueryGeneration += 1;
    timelineState.latestQueryDirty = timelineState.latestQueryInFlight;
    timelineState.reconciledEvents = [];
    timelineState.reconciledTotal = 0;
    timelineState.liveTail = [];
  }

  function rememberTimelineLiveEvent(event: LightstreamerEventEnvelope): void {
    if (!matchesEventFilters(event, filterState)) {
      return;
    }
    const existing = timelineState.liveTail.findIndex(({ id }) => id === event.id);
    if (existing >= 0) {
      timelineState.liveTail.splice(existing, 1);
    }
    timelineState.liveTail.push(event);
    if (timelineState.liveTail.length > TIMELINE_WINDOW_SIZE) {
      timelineState.liveTail.splice(0, timelineState.liveTail.length - TIMELINE_WINDOW_SIZE);
    }
    if (timelineState.latestQueryInFlight) {
      timelineState.latestQueryDirty = true;
    }
  }

  function noteTimelineNewerEvent(event: LightstreamerEventEnvelope): void {
    if (
      timelineState.viewMode !== "frozen" ||
      !matchesEventFilters(event, filterState)
    ) {
      return;
    }
    timelineState.newerEventCount += 1;
    renderTimelineDisplayState();
  }

  function handleTimelineScroll(): void {
    const previousScrollTop = timelineState.lastScrollTop;
    const currentScrollTop = feed.scrollTop;
    timelineState.lastScrollTop = currentScrollTop;
    const scrollingUp = currentScrollTop < previousScrollTop;
    const scrollingDown = currentScrollTop > previousScrollTop;
    const nearBottom = isTimelineNearBottom();
    if (timelineState.viewMode === "live" && !(timelineState.windowOffset === 0 && nearBottom)) {
      setTimelineViewMode("frozen");
    }

    if (
      activeView !== "timeline" ||
      timelineState.scrollNavigationPending !== null
    ) {
      return;
    }
    if (scrollingUp && isTimelineNearTop()) {
      showOlderTimelineWindow(true);
      return;
    }
    if (scrollingDown && nearBottom && timelineState.windowOffset > 0) {
      showNewerTimelineWindow(true);
    }
  }

  function isTimelineNearTop(): boolean {
    return feed.scrollTop <= TIMELINE_LOAD_MORE_THRESHOLD;
  }

  function isTimelineNearBottom(): boolean {
    const maximumScrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
    return maximumScrollTop - feed.scrollTop <= TIMELINE_LOAD_MORE_THRESHOLD;
  }

  function scrollTimelineToLatest(): void {
    const latestScrollTop = Math.max(
      0,
      feed.scrollHeight - feed.clientHeight
    );
    feed.scrollTop = latestScrollTop;
    timelineState.lastScrollTop = latestScrollTop;
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
    if (timelineState.windowOffset === 0 && timelineState.followLatest) {
      renderLatestTimelineOverlay(options);
      reconcileLatestTimeline(options, onRendered);
      return;
    }
    const queryVersion = ++timelineState.queryVersion;
    history
      .queryEvents({
        filters: filterState,
        order: "asc",
        limit: TIMELINE_WINDOW_SIZE,
        offset: timelineState.windowOffset
      })
      .receive((result) => {
        if (!panelVisible || queryVersion !== timelineState.queryVersion) {
          return;
        }
        renderFeedResult(result.events, result.total, options);
        onRendered?.();
      }, reportHistoryError);
  }

  function reconcileLatestTimeline(
    options: RenderOptions = {},
    onRendered?: () => void
  ): void {
    if (timelineState.latestQueryInFlight) {
      timelineState.latestQueryDirty = true;
      return;
    }

    timelineState.latestQueryInFlight = true;
    timelineState.latestQueryDirty = false;
    const generation = timelineState.latestQueryGeneration;
    const filters = { ...filterState };
    history
      .queryEvents({
        filters,
        order: "asc",
        limit: TIMELINE_WINDOW_SIZE,
        offset: 0
      })
      .receive(
        (result) => {
          timelineState.latestQueryInFlight = false;
          if (
            panelVisible &&
            generation === timelineState.latestQueryGeneration &&
            timelineState.windowOffset === 0 &&
            timelineState.followLatest
          ) {
            timelineState.reconciledEvents = result.events;
            timelineState.reconciledTotal = result.total;
            const reconciledIds = new Set(result.events.map(({ id }) => id));
            timelineState.liveTail = timelineState.liveTail.filter(({ id }) => !reconciledIds.has(id));
            renderLatestTimelineOverlay(options);
            onRendered?.();
          }
          if (timelineState.latestQueryDirty) {
            timelineState.latestQueryDirty = false;
            if (panelVisible && timelineState.windowOffset === 0 && timelineState.followLatest) {
              reconcileLatestTimeline({
                preservePaneState: true,
                passiveStoreUpdate: true
              });
            }
          }
        },
        (error) => {
          timelineState.latestQueryInFlight = false;
          reportHistoryError(error);
          if (timelineState.latestQueryDirty) {
            timelineState.latestQueryDirty = false;
            if (panelVisible && timelineState.windowOffset === 0 && timelineState.followLatest) {
              reconcileLatestTimeline({
                preservePaneState: true,
                passiveStoreUpdate: true
              });
            }
          }
        }
      );
  }

  function renderLatestTimelineOverlay(options: RenderOptions = {}): void {
    const combined = new Map<string, LightstreamerEventEnvelope>();
    for (const event of timelineState.reconciledEvents) {
      combined.set(event.id, event);
    }
    for (const event of timelineState.liveTail) {
      combined.set(event.id, event);
    }
    const renderedEvents = Array.from(combined.values()).slice(-TIMELINE_WINDOW_SIZE);
    const reconciledIds = new Set(timelineState.reconciledEvents.map(({ id }) => id));
    const pendingCount = timelineState.liveTail.reduce(
      (total, { id }) => total + (reconciledIds.has(id) ? 0 : 1),
      0
    );
    renderFeedResult(
      renderedEvents,
      Math.max(
        renderedEvents.length,
        timelineState.reconciledTotal + pendingCount,
        hasActiveFilters(filterState) ? 0 : currentStoreStats.retained
      ),
      options
    );
  }

  function renderFeedResult(
    renderedEvents: readonly LightstreamerEventEnvelope[],
    totalVisible: number,
    options: RenderOptions = {}
  ): void {
    const filtersActive = hasActiveFilters(filterState);
    timelineState.events = renderedEvents;
    timelineState.visibleTotal = totalVisible;
    renderTimelineDisplayState();

    filteredCount.hidden = !filtersActive;
    filteredCount.textContent = filtersActive ? `${totalVisible} shown` : "";
    filteredCount.setAttribute("aria-label", `${totalVisible} events shown`);
    clearTimelineFilters.hidden = !filtersActive;

    if (currentStoreStats.retained === 0) {
      selectedEventId = null;
      selectedTimelineEvent = null;
      selectedPinned = false;
      resetTimelineRenderLimit();
      clearDraftForSelection(null);
      renderEmptyState();
      renderDetail(null, options);
      return;
    }

    if (totalVisible === 0) {
      selectedEventId = null;
      selectedTimelineEvent = null;
      resetTimelineRenderLimit();
      clearDraftForSelection(null);
      renderFilteredEmptyState();
      renderDetail(null, options);
      return;
    }

    const shouldFollowLatest = timelineState.followLatest;
    const feedState =
      options.preservePaneState || !shouldFollowLatest ? capturePaneState(feed) : null;

    const visibleSelectedEvent = renderedEvents.find((event) => event.id === selectedEventId) ?? null;
    if (!selectedPinned) {
      selectedEventId = timelineState.detailOpen ? renderedEvents[renderedEvents.length - 1]?.id ?? null : null;
      selectedTimelineEvent =
        renderedEvents.find((event) => event.id === selectedEventId) ?? null;
    } else if (!visibleSelectedEvent && timelineState.selectionNeedsFilterReconciliation) {
      selectedEventId = renderedEvents[renderedEvents.length - 1]?.id ?? null;
      selectedTimelineEvent =
        renderedEvents.find((event) => event.id === selectedEventId) ?? null;
      timelineState.detailOpen = Boolean(selectedEventId);
    } else if (visibleSelectedEvent) {
      selectedTimelineEvent = visibleSelectedEvent;
    }
    timelineState.selectionNeedsFilterReconciliation = false;
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
        selectedTimelineEvent = event;
        selectedPinned = true;
        timelineState.detailOpen = true;
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
      totalVisible > renderedEvents.length || timelineState.windowOffset > 0
        ? createTimelineWindowNavigation(totalVisible, renderedEvents.length)
        : null;
    feed.replaceChildren(...(navigation ? [navigation, list] : [list]));
    restorePaneState(feed, feedState);
    if (timelineState.scrollNavigationPending === "older") {
      scrollTimelineToLatest();
      timelineState.followLatest = false;
      timelineState.scrollNavigationPending = null;
    } else if (timelineState.scrollNavigationPending === "newer") {
      feed.scrollTop = 0;
      timelineState.lastScrollTop = 0;
      timelineState.followLatest = false;
      timelineState.scrollNavigationPending = null;
    } else if (shouldFollowLatest) {
      scrollTimelineToLatest();
    }
    const selectedDetailIsCurrent =
      timelineState.detailOpen &&
      selectedPinned &&
      detail.dataset.eventId === selectedEventId &&
      !detail.hidden;
    if (!options.passiveStoreUpdate || !selectedDetailIsCurrent) {
      renderSelectedTimelineDetail(options);
    }
  }

  function showOlderTimelineWindow(fromScroll: boolean): void {
    const rendered = timelineState.events.length;
    if (
      rendered === 0 ||
      timelineState.windowOffset + rendered >= timelineState.visibleTotal
    ) {
      return;
    }
    const nextOffset =
      timelineState.windowOffset === 0 && timelineState.historyAnchor > 0
        ? timelineState.historyAnchor
        : timelineState.windowOffset + TIMELINE_WINDOW_SIZE;
    const previousOffset = timelineState.windowOffset;
    const wasFrozen = timelineState.viewMode === "frozen";
    timelineState.windowOffset = Math.min(
      nextOffset,
      oldestWindowOffset(
        timelineState.visibleTotal,
        timelineState.historyAnchor,
        TIMELINE_WINDOW_SIZE
      )
    );
    setTimelineViewMode("frozen");
    if (wasFrozen) {
      timelineState.newerEventCount += timelineState.windowOffset - previousOffset;
      renderTimelineDisplayState();
    }
    timelineState.scrollNavigationPending = fromScroll ? "older" : null;
    renderFeed({ preservePaneState: true });
  }

  function showNewerTimelineWindow(fromScroll: boolean): void {
    if (timelineState.windowOffset <= 0) {
      return;
    }
    const previousOffset = timelineState.windowOffset;
    timelineState.windowOffset = Math.max(
      0,
      timelineState.windowOffset - TIMELINE_WINDOW_SIZE
    );
    setTimelineViewMode("frozen");
    timelineState.newerEventCount = Math.max(
      0,
      timelineState.newerEventCount - (previousOffset - timelineState.windowOffset)
    );
    renderTimelineDisplayState();
    timelineState.scrollNavigationPending = fromScroll ? "newer" : null;
    renderFeed({ preservePaneState: true });
  }

  function createTimelineWindowNavigation(total: number, rendered: number): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "event-window-navigation";
    navigation.dataset.mode = timelineState.viewMode;
    navigation.setAttribute("aria-label", "Timeline history window");

    const start = Math.max(1, total - timelineState.windowOffset - rendered + 1);
    const end = Math.max(0, total - timelineState.windowOffset);
    const range = createTextElement(
      "span",
      "event-render-limit",
      `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} retained events.`
    );
    if (timelineState.viewMode === "live") {
      range.hidden = true;
      navigation.append(
        createTextElement(
          "span",
          "event-live-summary",
          `${total.toLocaleString()} retained events · following current activity`
        ),
        range
      );
    } else {
      navigation.append(range);
    }

    const actions = document.createElement("span");
    actions.className = "window-navigation-actions";
    const older = createWindowNavigationButton(
      "Older",
      timelineState.windowOffset + rendered < total,
      () => {
        showOlderTimelineWindow(false);
      }
    );
    const newer = createWindowNavigationButton(
      "Newer",
      timelineState.windowOffset > 0,
      () => {
        showNewerTimelineWindow(false);
      }
    );
    const latest = createWindowNavigationButton("Follow live", true, followLiveTimeline);
    actions.append(older);
    if (timelineState.viewMode === "frozen") {
      actions.append(newer, latest);
    }
    navigation.append(actions);
    return navigation;
  }

  function renderSelectedTimelineDetail(options: RenderOptions = {}): void {
    if (!selectedEventId) {
      renderDetail(null, options);
      return;
    }

    const cached =
      selectedTimelineEvent?.id === selectedEventId
        ? selectedTimelineEvent
        : timelineState.events.find((event) => event.id === selectedEventId);
    if (cached) {
      selectedTimelineEvent = cached;
      renderDetail(cached, options);
      return;
    }

    const requestedEventId = selectedEventId;
    history.getEventById(requestedEventId).receive(
      (event) => {
        if (selectedEventId !== requestedEventId || !timelineState.detailOpen || !panelVisible) {
          return;
        }
        selectedTimelineEvent = event;
        renderDetail(event, options);
      },
      reportHistoryError
    );
  }

  function renderDetail(
    event: LightstreamerEventEnvelope | null,
    options: RenderOptions = {}
  ): void {
    const paneState = options.preservePaneState ? capturePaneState(detail) : null;
    detail.replaceChildren();

    if (!event || !timelineState.detailOpen) {
      delete detail.dataset.eventId;
      detail.hidden = true;
      workspace.dataset.detailOpen = "false";
      return;
    }

    detail.hidden = false;
    detail.dataset.eventId = event.id;
    if (selectedEventId === event.id) {
      selectedTimelineEvent = event;
    }
    workspace.dataset.detailOpen = "true";
    detail.append(createSelectedEventHeader(event));
    appendDraftSection(
      detail,
      event,
      draft && (draft.sourceEventId === event.id || draftResultEventId === event.id)
        ? draft
        : null
    );
    const currentFields = event.update?.fields ?? {};
    const changedFieldNames = Object.keys(event.update?.changedFields ?? {});
    appendDetailSection(detail, "Current item fields", currentFields, {
      open: true,
      summary: `${Object.keys(currentFields).length} fields · ${changedFieldNames.length} changed`,
      changedFieldNames
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
        timelineState.detailOpen = false;
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
    handle.setAttribute("aria-valuenow", String(timelineState.detailWidth));
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
    const startWidth = timelineState.detailWidth;
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
    setTimelineDetailWidth(timelineState.detailWidth + delta);
  }

  function setTimelineDetailWidth(width: number): void {
    timelineState.detailWidth = Math.round(
      clampNumber(width, TIMELINE_MIN_DETAIL_WIDTH, TIMELINE_MAX_DETAIL_WIDTH)
    );
    applyTimelineDetailWidth();
  }

  function applyTimelineDetailWidth(): void {
    workspace.style.setProperty("--timeline-detail-width", `${timelineState.detailWidth}px`);
    timelineDetailResizeHandle.setAttribute("aria-valuenow", String(timelineState.detailWidth));
  }

  function renderCommandState(options: RenderOptions = {}): void {
    helpTooltips.hide();
    const groupPaneState = options.preservePaneState ? capturePaneState(commandGroupPane) : null;
    const currentPaneState = options.preservePaneState
      ? capturePaneState(commandCurrentTable)
      : null;
    const updatePaneState = options.preservePaneState ? capturePaneState(commandUpdatePane) : null;
    const commandState = commandStateProjections.snapshot(commandStateProjection);
    const allItems = flattenCommandItems(commandState);
    const filterEvaluation = createCommandFilterEvaluation(
      commandFilterState,
      commandSearchTextCache
    );

    if (allItems.length === 0) {
      commandStateView.selectedItem = null;
      commandStateView.selectedKey = null;
      renderCommandEmptyState();
      return;
    }

    const items = filterCommandItems(allItems, filterEvaluation);
    if (items.length === 0) {
      commandStateView.selectedKey = null;
      commandStateView.selectedUpdateEventId = null;
      renderCommandNoMatchesState();
      return;
    }

    commandStateView.itemWindowOffset = clampStartWindowOffset(
      commandStateView.itemWindowOffset,
      items.length,
      COMMAND_ITEM_WINDOW_SIZE
    );
    const visibleItems = windowFromStart(
      items,
      commandStateView.itemWindowOffset,
      COMMAND_ITEM_WINDOW_SIZE
    );
    commandStateView.selectedItem = validCommandItemSelection(visibleItems, commandStateView.selectedItem) ?? {
      subscriptionId: visibleItems[0].subscription.subscriptionId,
      itemId: visibleItems[0].item.itemId
    };

    const selected = findSelectedCommandItem(visibleItems, commandStateView.selectedItem) ?? visibleItems[0];
    renderCommandGroups(visibleItems, selected, items.length, allItems.length);
    renderCommandRowsAndResults(selected.subscription, selected.item, filterEvaluation);
    const preserveActiveDraftEditor = shouldPreserveCommandDraftEditor(
      options,
      selected.subscription,
      selected.item
    );
    if (!preserveActiveDraftEditor) {
      renderCommandDetail(selected.subscription, selected.item, commandState, options);
    }
    restorePaneState(commandGroupPane, groupPaneState);
    restorePaneState(commandCurrentTable, currentPaneState);
    restorePaneState(commandUpdatePane, updatePaneState);
  }

  function shouldPreserveCommandDraftEditor(
    options: RenderOptions,
    subscription: CommandSubscriptionGroup,
    item: CommandItemGroup
  ): boolean {
    if (
      !options.passiveStoreUpdate ||
      !draft ||
      !commandDetailPane.querySelector(".command-draft-controls, .draft-controls") ||
      commandDetailPane.dataset.detailIdentity !==
        commandDetailIdentity(subscription, item, commandStateView.selectedKey, commandStateView.selectedUpdateEventId)
    ) {
      return false;
    }

    if (draftSurface === "new-command" && draft.provenance.source === "new-command") {
      return commandDraftMatchesContext(
        draft,
        createCommandItemContext(subscription, item, commandContextEvents)
      );
    }

    return (
      draftSurface === "command-replay" &&
      (commandStateView.selectedUpdateEventId === draft.sourceEventId ||
        commandStateView.selectedUpdateEventId === draftResultEventId)
    );
  }

  function renderCommandEmptyState(): void {
    delete commandDetailPane.dataset.detailIdentity;
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
    delete commandDetailPane.dataset.detailIdentity;
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

    if (matchingItems > items.length || commandStateView.itemWindowOffset > 0) {
      commandGroupPane.append(
        createCommandCollectionNavigation({
          ariaLabel: "COMMAND subscription item window",
          statusClass: "command-item-window-status",
          noun: "items",
          total: matchingItems,
          rendered: items.length,
          offset: commandStateView.itemWindowOffset,
          windowSize: COMMAND_ITEM_WINDOW_SIZE,
          onOffset(nextOffset) {
            commandStateView.itemWindowOffset = nextOffset;
            commandStateView.selectedItem = null;
            commandStateView.selectedKey = null;
            commandStateView.selectedUpdateEventId = null;
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
        clearCommandDraftForSelection(null);
        commandStateView.selectedItem = {
          subscriptionId: entry.subscription.subscriptionId,
          itemId: entry.item.itemId
        };
        commandStateView.selectedKey = null;
        commandStateView.selectedUpdateEventId = null;
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
    const selectedKeyIndex = matchingKeys.findIndex((row) =>
      commandSelectionMatchesStableKey(commandStateView.selectedKey, row)
    );
    if (
      selectedKeyIndex >= 0 &&
      (selectedKeyIndex < commandStateView.keyWindowOffset ||
        selectedKeyIndex >= commandStateView.keyWindowOffset + COMMAND_KEY_WINDOW_SIZE)
    ) {
      commandStateView.keyWindowOffset =
        Math.floor(selectedKeyIndex / COMMAND_KEY_WINDOW_SIZE) * COMMAND_KEY_WINDOW_SIZE;
    }
    commandStateView.keyWindowOffset = clampStartWindowOffset(
      commandStateView.keyWindowOffset,
      matchingKeys.length,
      COMMAND_KEY_WINDOW_SIZE
    );
    commandStateView.diagnosticWindowOffset = clampStartWindowOffset(
      commandStateView.diagnosticWindowOffset,
      matchingDiagnostics.length,
      COMMAND_DIAGNOSTIC_WINDOW_SIZE
    );
    const visibleKeys = windowFromStart(
      matchingKeys,
      commandStateView.keyWindowOffset,
      COMMAND_KEY_WINDOW_SIZE
    );
    const visibleRows = visibleKeys.filter((row): row is CommandRow => row.status === "active");
    const visibleDeleted = visibleKeys.filter(
      (row): row is DeletedCommandKey => row.status === "deleted"
    );
    const visibleDiagnostics = windowFromStart(
      matchingDiagnostics,
      commandStateView.diagnosticWindowOffset,
      COMMAND_DIAGNOSTIC_WINDOW_SIZE
    );

    const previousSelection = commandStateView.selectedKey;
    commandStateView.selectedKey = reconcileCommandSelection(
      item,
      commandStateView.selectedKey,
      visibleRows,
      visibleDeleted,
      visibleDiagnostics
    );
    if (!commandSelectionsEqual(previousSelection, commandStateView.selectedKey)) {
      commandStateView.selectedUpdateEventId = null;
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
      button.dataset.selected = String(commandSelectionMatchesKey(commandStateView.selectedKey, row));
      button.setAttribute(
        "aria-label",
        `${row.key}, ${row.status}, ${row.lifecycle.length} updates, last seen ${formatExactLocalTime(latestKeyProvenance(row).timestamp)}`
      );
      button.addEventListener("click", () => {
        const nextSelection = commandSelectionForKey(row);
        clearCommandDraftForSelection(null);
        commandStateView.selectedUpdateEventId = null;
        commandStateView.selectedKey = nextSelection;
        resetCommandLifecycleWindow();
        commandStateView.detailOpen = true;
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

    const selectedTarget = commandStateView.selectedKey ? findCommandDetailTarget(item, commandStateView.selectedKey) : null;
    const selectedLifecycle =
      selectedTarget?.kind === "active" || selectedTarget?.kind === "deleted"
        ? selectedTarget.row.lifecycle
        : [];
    const selectionIdentity = selectedTarget
      ? commandSelectionIdentity(commandStateView.selectedKey)
      : null;
    if (
      selectionIdentity &&
      selectionIdentity === commandStateView.windowSelectionIdentity &&
      selectedLifecycle.length > commandStateView.windowLifecycleLength
    ) {
      const selectedWindowWasFull =
        Boolean(commandStateView.selectedUpdateEventId) &&
        commandStateView.windowLifecycleLength >= COMMAND_LIFECYCLE_WINDOW_SIZE;
      if (commandStateView.updateWindowOffset > 0 || selectedWindowWasFull) {
        commandStateView.updateWindowOffset += selectedLifecycle.length - commandStateView.windowLifecycleLength;
        commandStateView.updateHistoryAnchor =
          commandStateView.updateWindowOffset % COMMAND_LIFECYCLE_WINDOW_SIZE;
      } else {
        commandStateView.updateHistoryAnchor = 0;
      }
    }
    commandStateView.windowSelectionIdentity = selectionIdentity;
    commandStateView.windowLifecycleLength = selectedLifecycle.length;
    if (
      commandStateView.selectedUpdateEventId &&
      !selectedLifecycle.some((entry) => entry.eventId === commandStateView.selectedUpdateEventId)
    ) {
      clearCommandDraftForSelection(null);
      commandStateView.selectedUpdateEventId = null;
    }

    const updates = document.createElement("section");
    updates.className = "command-update-list";
    updates.append(
      createTextElement(
        "h3",
        "command-results-heading",
        selectedTarget?.kind === "diagnostic"
          ? "Selected diagnostic · no key lifecycle"
          : commandStateView.selectedKey
            ? `Updates · ${commandStateView.selectedKey.key ?? "selected key"} · ${selectedLifecycle.length}`
            : "Updates"
      )
    );

    if (selectedLifecycle.length > 0) {
      commandStateView.updateWindowOffset = clampWindowOffset(
        commandStateView.updateWindowOffset,
        selectedLifecycle.length,
        COMMAND_LIFECYCLE_WINDOW_SIZE
      );
      const visibleLifecycle = windowFromLatest(
        selectedLifecycle,
        commandStateView.updateWindowOffset,
        COMMAND_LIFECYCLE_WINDOW_SIZE
      );
      commandStateView.visibleUpdateEventIds = new Set(visibleLifecycle.map((entry) => entry.eventId));
      if (selectedLifecycle.length > visibleLifecycle.length || commandStateView.updateWindowOffset > 0) {
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
        updateRow.dataset.selected = String(commandStateView.selectedUpdateEventId === entry.eventId);
        updateRow.addEventListener("click", () => {
          clearCommandDraftForSelection(entry.eventId);
          commandStateView.selectedUpdateEventId = entry.eventId;
          commandStateView.detailOpen = true;
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
      commandStateView.visibleUpdateEventIds = new Set();
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
        commandStateView.diagnosticWindowOffset > 0
      ) {
        diagnosticResults.append(
          createCommandCollectionNavigation({
            ariaLabel: "COMMAND diagnostic results window",
            statusClass: "command-diagnostic-window-status",
            noun: "diagnostics",
            total: matchingDiagnostics.length,
            rendered: visibleDiagnostics.length,
            offset: commandStateView.diagnosticWindowOffset,
            windowSize: COMMAND_DIAGNOSTIC_WINDOW_SIZE,
            onOffset(nextOffset) {
              commandStateView.diagnosticWindowOffset = nextOffset;
              commandStateView.selectedKey = null;
              commandStateView.selectedUpdateEventId = null;
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
          commandSelectionMatchesDiagnostic(commandStateView.selectedKey, item, diagnostic)
        );
        result.setAttribute(
          "aria-label",
          `${diagnostic.key ?? "unknown key"}, diagnostic ${diagnostic.code}, event ${diagnostic.eventId ?? "unknown"}`
        );
        result.addEventListener("click", () => {
          clearCommandDraftForSelection(null);
          commandStateView.selectedUpdateEventId = null;
          commandStateView.selectedKey = commandSelectionForDiagnostic(item, diagnostic);
          resetCommandLifecycleWindow();
          commandStateView.detailOpen = true;
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
      matchingKeys.length > visibleKeys.length || commandStateView.keyWindowOffset > 0
        ? createCommandCollectionNavigation({
            ariaLabel: "COMMAND key results window",
            statusClass: "command-key-window-status",
            noun: "keys",
            total: matchingKeys.length,
            rendered: visibleKeys.length,
            offset: commandStateView.keyWindowOffset,
            windowSize: COMMAND_KEY_WINDOW_SIZE,
            onOffset(nextOffset) {
              commandStateView.keyWindowOffset = nextOffset;
              commandStateView.selectedKey = null;
              commandStateView.selectedUpdateEventId = null;
              resetCommandLifecycleWindow();
              renderCommandState({ preservePaneState: true });
            }
          })
        : null;
    const newCommandAction = createNewCommandAction(
      createCommandItemContext(subscription, item, commandContextEvents)
    );
    commandCurrentTable.replaceChildren(
      ...(keyNavigation
        ? [newCommandAction, keyNavigation, header, rows]
        : [newCommandAction, header, rows])
    );
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
    const start = Math.max(1, total - commandStateView.updateWindowOffset - rendered + 1);
    const end = Math.max(0, total - commandStateView.updateWindowOffset);
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
        commandStateView.updateWindowOffset + rendered < total,
        () => {
          const nextOffset =
            commandStateView.updateWindowOffset === 0 && commandStateView.updateHistoryAnchor > 0
              ? commandStateView.updateHistoryAnchor
              : commandStateView.updateWindowOffset + COMMAND_LIFECYCLE_WINDOW_SIZE;
          commandStateView.updateWindowOffset = Math.min(
            nextOffset,
            oldestWindowOffset(
              total,
              commandStateView.updateHistoryAnchor,
              COMMAND_LIFECYCLE_WINDOW_SIZE
            )
          );
          renderCommandState({ preservePaneState: true });
        }
      ),
      createWindowNavigationButton("Newer", commandStateView.updateWindowOffset > 0, () => {
        commandStateView.updateWindowOffset = Math.max(
          0,
          commandStateView.updateWindowOffset - COMMAND_LIFECYCLE_WINDOW_SIZE
        );
        renderCommandState({ preservePaneState: true });
      }),
      createWindowNavigationButton("Latest", commandStateView.updateWindowOffset > 0, () => {
        commandStateView.updateWindowOffset = 0;
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
      commandStateView.itemWindowOffset = 0;
    }
    commandStateView.keyWindowOffset = 0;
    commandStateView.diagnosticWindowOffset = 0;
  }

  function resetCommandLifecycleWindow(): void {
    commandStateView.updateWindowOffset = 0;
    commandStateView.updateHistoryAnchor = 0;
    commandStateView.lifecycleExpanded = false;
    commandStateView.windowSelectionIdentity = null;
    commandStateView.windowLifecycleLength = 0;
  }

  function clearCommandDraftForSelection(nextEventId: string | null): void {
    if (!draft || (draftSurface !== "command-replay" && draftSurface !== "new-command")) {
      return;
    }
    if (
      draftSurface === "command-replay" &&
      (draft.sourceEventId === nextEventId || draftResultEventId === nextEventId)
    ) {
      return;
    }
    draftRenderVersion += 1;
    draft = null;
    draftSurface = null;
    draftResultEventId = null;
    draftEditing = false;
    draftJsonText = null;
    draftJsonError = null;
    reinjectionMessage = null;
  }

  function renderCommandDetail(
    subscription: CommandSubscriptionGroup,
    item: CommandItemGroup,
    commandState: CommandState,
    options: RenderOptions = {}
  ): void {
    const paneState = options.preservePaneState ? capturePaneState(commandDetailPane) : null;
    commandDetailPane.replaceChildren();
    if (!commandStateView.detailOpen) {
      delete commandDetailPane.dataset.detailIdentity;
      commandDetailPane.hidden = true;
      commandWorkspace.dataset.detailOpen = "false";
      return;
    }

    commandDetailPane.hidden = false;
    commandDetailPane.dataset.detailIdentity = commandDetailIdentity(
      subscription,
      item,
      commandStateView.selectedKey,
      commandStateView.selectedUpdateEventId
    );
    commandWorkspace.dataset.detailOpen = "true";
    const collapseCommandDetail = () => {
      commandStateView.detailOpen = false;
      renderCommandState();
    };
    const context = createCommandItemContext(subscription, item, commandContextEvents);

    if (renderActiveNewCommandDraft(commandDetailPane, context, item, commandState, collapseCommandDetail)) {
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    if (!commandStateView.selectedKey) {
      commandDetailPane.append(
        createDetailPaneHeader("COMMAND detail", collapseCommandDetail),
        createTextElement(
          "p",
          "command-empty-body",
          "Select a key or update to inspect its COMMAND details."
        )
      );
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    const target = findCommandDetailTarget(item, commandStateView.selectedKey);
    if (!target) {
      commandDetailPane.append(
        createDetailPaneHeader("COMMAND detail", collapseCommandDetail),
        createTextElement("p", "command-empty-body", "Selected COMMAND key is no longer available.")
      );
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    if (target.kind === "diagnostic") {
      renderCommandDiagnosticDetail(target.diagnostic, collapseCommandDetail);
      restorePaneState(commandDetailPane, paneState);
      return;
    }

    if (commandStateView.selectedUpdateEventId) {
      const update = target.row.lifecycle.find((entry) => entry.eventId === commandStateView.selectedUpdateEventId);
      if (update) {
        renderCommandUpdateDetail(target, update, collapseCommandDetail);
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

      commandDetailPane.append(
        createCommandFieldsSection(
          row.fields,
          row.lifecycle[row.lifecycle.length - 1]?.changedFields ?? {},
          "The latest field values for this active key after applying its lifecycle."
        )
      );

      appendLatestCommandReplay(row.lifecycle);

      appendCommandLifecycle(row.lifecycle);
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

    appendLatestCommandReplay(row.lifecycle);
    appendCommandLifecycle(row.lifecycle);
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
    pre.textContent = formatJsonForDisplay(diagnostic);
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
    if (!commandStateView.visibleUpdateEventIds.has(entry.eventId)) {
      summary.append(
        createCommandSummaryTimeRow("Time", entry.timestamp, createTimestampElement)
      );
    }
    commandDetailPane.append(summary);

    appendCommandReplay(entry.eventId);

    commandDetailPane.append(
      createCommandFieldsSection(
        entry.fields,
        entry.changedFields,
        "The current item values at this update. Changed field names are shown once above the payload."
      )
    );
  }

  function appendLatestCommandReplay(lifecycle: readonly CommandLifecycleEntry[]): void {
    const latest = lifecycle[lifecycle.length - 1];
    if (latest) {
      appendCommandReplay(latest.eventId);
    }
  }

  function appendCommandReplay(eventId: string): void {
    const selectedEvent = commandContextEvents.find((event) => event.id === eventId) ?? null;
    if (!selectedEvent) {
      return;
    }
    const currentDraft =
      draftSurface === "command-replay" &&
      draft &&
      (draft.sourceEventId === eventId || draftResultEventId === eventId)
        ? draft
        : null;
    appendDraftSection(commandDetailPane, selectedEvent, currentDraft, "command");
  }

  function createCommandFieldsSection(
    fields: Record<string, string | number | boolean | null>,
    changedFields: Record<string, string | number | boolean | null>,
    help: string
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "command-current-fields";
    section.append(
      createHelpHeading(
        "h3",
        "command-detail-section-heading",
        "Current item fields",
        help
      )
    );
    section.append(createChangedFieldsSummary("command-changed-fields", Object.keys(changedFields)));
    const fieldsJson = document.createElement("pre");
    fieldsJson.className = "command-json";
    fieldsJson.textContent = formatJsonForDisplay(fields);
    section.append(fieldsJson);
    return section;
  }

  function appendCommandLifecycle(lifecycle: readonly CommandLifecycleEntry[]): void {
    const section = document.createElement("section");
    section.className = "command-lifecycle";
    section.setAttribute("aria-label", "Selected key lifecycle");

    const toggle = document.createElement("button");
    toggle.className = "command-lifecycle-toggle";
    toggle.type = "button";
    toggle.textContent = commandStateView.lifecycleExpanded
      ? `Hide lifecycle payloads (${lifecycle.length})`
      : `Show lifecycle payloads (${lifecycle.length})`;
    toggle.setAttribute("aria-expanded", String(commandStateView.lifecycleExpanded));
    toggle.addEventListener("click", () => {
      commandStateView.lifecycleExpanded = !commandStateView.lifecycleExpanded;
      renderCommandState({ preservePaneState: true });
    });
    section.append(toggle);

    if (!commandStateView.lifecycleExpanded) {
      commandDetailPane.append(section);
      return;
    }

    const visibleLifecycle = windowFromLatest(
      lifecycle,
      commandStateView.updateWindowOffset,
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
      json.textContent = formatJsonForDisplay(
        {
          eventId: entry.eventId,
          command: entry.originalCommand,
          effectiveCommand: entry.effectiveCommand,
          source: provenanceLabel(entry.provenance),
          fields: entry.fields,
          changedFields: entry.changedFields,
          diagnostics: entry.diagnosticCodes
        }
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
    pre.textContent = formatJsonForDisplay(matching);
    section.append(pre);
    commandDetailPane.append(section);
  }

  function createNewCommandAction(context: CommandItemContext): HTMLElement {
    const section = document.createElement("section");
    section.className = "new-command-action";
    section.setAttribute("aria-label", "Create a new synthetic COMMAND key");

    const createButton = document.createElement("button");
    createButton.className = "new-command-button";
    createButton.type = "button";
    createButton.textContent = "New COMMAND key";
    createButton.disabled = !createNewCommandDraftFromContext(context);
    createButton.addEventListener("click", () => {
      const nextDraft = createNewCommandDraftFromContext(context);
      if (!nextDraft) {
        return;
      }
      draft = nextDraft;
      draftSurface = "new-command";
      draftResultEventId = null;
      draftEditing = false;
      draftJsonText = null;
      draftJsonError = null;
      draftExecutionTarget = preferredDraftExecutionTarget(nextDraft);
      reinjectionMessage = null;
      commandStateView.detailOpen = true;
      renderCommandState();
    });

    section.append(
      createButton,
      createTextElement(
        "span",
        "new-command-helper",
        "Create a key that does not exist in the selected item."
      )
    );
    return section;
  }

  function renderActiveNewCommandDraft(
    parent: HTMLElement,
    context: CommandItemContext,
    item: CommandItemGroup,
    commandState: CommandState,
    onCollapse: () => void
  ): boolean {
    if (draftSurface !== "new-command" || draft?.provenance.source !== "new-command") {
      return false;
    }

    if (!commandDraftMatchesContext(draft, context)) {
      draft = null;
      draftSurface = null;
      draftResultEventId = null;
      reinjectionMessage = null;
      return false;
    }

    parent.append(createDetailPaneHeader("New COMMAND key", onCollapse));
    const section = document.createElement("section");
    section.className = "new-command-editor";
    section.setAttribute("aria-label", "New synthetic COMMAND key editor");
    section.append(createCommandDraftContext(context, draft.target.listenerId));
    section.append(createCommandDraftControls(draft, context, item, commandState));
    parent.append(section);
    return true;
  }

  function createCommandDraftControls(
    currentDraft: ReinjectionDraft,
    context: CommandItemContext,
    item: CommandItemGroup,
    commandState: CommandState
  ): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "command-draft-controls";

    const validation = validateNewCommandDraft(
      currentDraft,
      commandState,
      context,
      draftExecutionTarget
    );
    const targetStatus = draftTargetStatus(
      currentDraft,
      draftExecutionTarget
    );

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
      applyNewCommandDraftControlUpdate(
        updateDraftCommand(draft ?? currentDraft, commandSelect.value),
        commandSelect,
        context,
        item
      );
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
      applyNewCommandDraftControlUpdate(
        updateDraftKey(draft ?? currentDraft, keyInput.value),
        keyInput,
        context,
        item
      );
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
      applyNewCommandDraftControlUpdate(
        updateDraftSnapshot(draft ?? currentDraft, snapshotInput.checked),
        snapshotInput,
        context,
        item
      );
    });
    snapshotLabel.append(snapshotInput, createTextElement("span", "draft-input-text", "Snapshot"));

    const fieldTable = createCommandDraftFieldTable(currentDraft, context, item);
    const diagnostics = createCommandDraftDiagnostics(
      validation.diagnostics,
      draftExecutionTarget,
      currentDraft
    );

    const injectButton = document.createElement("button");
    injectButton.className = "inject-command-button reinject-button";
    injectButton.type = "button";
    injectButton.textContent = reinjectionPending
      ? "Injecting..."
      : "Inject COMMAND update";
    injectButton.disabled =
      !validation.valid ||
      !targetStatus.live ||
      !bridgeReady ||
      reinjectionPending;
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

    controls.append(
      commandLabel,
      keyLabel,
      snapshotLabel,
      fieldTable,
      createDraftTargetStatus(currentDraft, draftExecutionTarget),
      diagnostics,
      injectButton
    );
    return controls;
  }

  function createCommandDraftFieldTable(
    currentDraft: ReinjectionDraft,
    context: CommandItemContext,
    item: CommandItemGroup
  ): HTMLElement {
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
      current.dataset.fieldName = fieldName;
      const draftInput = document.createElement("input");
      draftInput.className = "filter-control command-draft-field-input";
      draftInput.setAttribute("aria-label", `Draft field ${fieldName}`);
      draftInput.dataset.fieldName = fieldName;
      draftInput.value = formatDraftFieldValue(value);
      draftInput.addEventListener("input", () => {
        applyNewCommandDraftControlUpdate(
          updateDraftField(
            draft ?? currentDraft,
            fieldName,
            draftInput.value === "" ? null : draftInput.value
          ),
          draftInput,
          context,
          item
        );
      });
      const changed = createTextElement(
        "span",
        "command-draft-field-changed",
        Object.prototype.hasOwnProperty.call(currentDraft.changedFields, fieldName) ? "changed" : "-"
      );
      changed.dataset.fieldName = fieldName;
      table.append(name, current, draftInput, changed);
    }

    return table;
  }

  function applyNewCommandDraftControlUpdate(
    nextDraft: ReinjectionDraft,
    activeControl: HTMLInputElement | HTMLSelectElement,
    context: CommandItemContext,
    item: CommandItemGroup
  ): void {
    draft = nextDraft;
    reinjectionMessage = null;

    const controls = activeControl.closest<HTMLElement>(".command-draft-controls");
    if (!controls || !activeControl.isConnected) {
      renderCommandState({ preservePaneState: true });
      return;
    }

    controls.querySelector<HTMLElement>(".reinjection-message")?.remove();

    const currentState = commandStateProjections.snapshot("local-effective");
    const validation = validateNewCommandDraft(
      nextDraft,
      currentState,
      context,
      draftExecutionTarget
    );
    const targetStatus = draftTargetStatus(nextDraft, draftExecutionTarget);
    const latestItem =
      flattenCommandItems(currentState).find(
        (entry) =>
          entry.item.subscriptionId === item.subscriptionId &&
          entry.item.itemId === item.itemId
      )?.item ?? item;
    const currentRow = nextDraft.key
      ? latestItem.activeRows.find((row) => row.key === nextDraft.key)
      : null;

    const commandControl = controls.querySelector<HTMLSelectElement>(
      ".command-draft-command"
    );
    if (commandControl && commandControl !== activeControl) {
      commandControl.value = nextDraft.command ?? "";
    }
    const keyControl = controls.querySelector<HTMLInputElement>(".command-draft-key");
    if (keyControl && keyControl !== activeControl) {
      keyControl.value = nextDraft.key ?? "";
    }
    const snapshotControl = controls.querySelector<HTMLInputElement>(
      ".command-draft-snapshot"
    );
    if (snapshotControl) {
      snapshotControl.checked = nextDraft.isSnapshot;
    }

    for (const fieldInput of controls.querySelectorAll<HTMLInputElement>(
      ".command-draft-field-input[data-field-name]"
    )) {
      const fieldName = fieldInput.dataset.fieldName;
      if (fieldName && fieldInput !== activeControl) {
        fieldInput.value = formatDraftFieldValue(nextDraft.fields[fieldName]);
      }
    }
    for (const currentValue of controls.querySelectorAll<HTMLElement>(
      ".command-draft-field-current[data-field-name]"
    )) {
      const fieldName = currentValue.dataset.fieldName;
      if (fieldName) {
        currentValue.textContent = formatDraftFieldValue(currentRow?.fields[fieldName]);
      }
    }
    for (const changedValue of controls.querySelectorAll<HTMLElement>(
      ".command-draft-field-changed[data-field-name]"
    )) {
      const fieldName = changedValue.dataset.fieldName;
      if (fieldName) {
        changedValue.textContent = Object.prototype.hasOwnProperty.call(
          nextDraft.changedFields,
          fieldName
        )
          ? "changed"
          : "-";
      }
    }

    controls
      .querySelector<HTMLElement>(".command-draft-diagnostics")
      ?.replaceWith(
        createCommandDraftDiagnostics(
          validation.diagnostics,
          draftExecutionTarget,
          nextDraft
        )
      );
    controls
      .querySelector<HTMLElement>(".replay-target-status")
      ?.replaceWith(createDraftTargetStatus(nextDraft, draftExecutionTarget));
    const injectButton = controls.querySelector<HTMLButtonElement>(
      ".inject-command-button"
    );
    if (injectButton) {
      injectButton.disabled =
        !validation.valid ||
        !targetStatus.live ||
        !bridgeReady ||
        reinjectionPending;
    }
  }

  function createCommandDraftDiagnostics(
    diagnostics: readonly NewCommandDraftDiagnostic[],
    executionTarget: ReinjectionExecutionTarget,
    currentDraft: ReinjectionDraft
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "command-draft-diagnostics";
    section.append(createTextElement("h4", "draft-source-heading", "Diagnostics"));
    const targetStatus = draftTargetStatus(currentDraft, executionTarget);
    if (!targetStatus.live) {
      section.append(
        createTextElement(
          "p",
          "command-draft-diagnostic error",
          validationMessage(targetStatus.error ? [targetStatus.error] : [])
        )
      );
    }
    if (diagnostics.length === 0 && targetStatus.live) {
      section.append(
        createTextElement(
          "p",
          "command-draft-diagnostic info",
          executionTarget === "captured-listener"
            ? "Draft is ready for Subscription-scoped Local Injection."
            : "Draft is ready for local replay through the captured page WebSocket. No server request will be sent."
        )
      );
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
    const executionTarget = draftExecutionTarget;
    const validation = validateNewCommandDraft(
      currentDraft,
      commandStateProjections.snapshot("local-effective"),
      context,
      executionTarget
    );
    const targetStatus = draftTargetStatus(currentDraft, executionTarget);
    if (!validation.valid || !targetStatus.live || !activeBridge) {
      return;
    }

    if (!commandDraftMatchesContext(currentDraft, context)) {
      draft = null;
      draftSurface = null;
      draftResultEventId = null;
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

    recordAnalyticsReplayAttempt("new_command", executionTarget, true);
    const result = await activeBridge.reinjectDraft(currentDraft, executionTarget);
    reinjectionPending = false;
    recordAnalyticsReplayResult("new_command", executionTarget, true, result);

    if (result.ok && result.status === "success") {
      reinjectionMessage = {
        kind: "success",
        text:
          executionTarget === "captured-listener"
            ? "Synthetic COMMAND update delivered to every current listener on the target Subscription."
            : "Synthetic COMMAND update delivered locally through the captured page WebSocket. No server was contacted."
      };
      if (currentDraft.key) {
        commandStateView.selectedKey = {
          subscriptionId: item.subscriptionId,
          itemId: item.itemId,
          key: currentDraft.key,
          status: currentDraft.command === "DELETE" ? "deleted" : "active"
        };
        commandStateView.selectedUpdateEventId = null;
      }
      history
        .append(createSyntheticEventFromDraft(currentDraft, result, executionTarget))
        .receive(() => {
          renderCommandState({ preservePaneState: true });
        }, reportHistoryError);
      return;
    }

    reinjectionMessage = createCommandFailureMessage(result);
    renderCommandState();
  }

  function renderTopology(): void {
    const renderStartedAt = performance.now();
    const treeHadFocus = topologyTreePane.contains(document.activeElement);
    const treeScrollTop = topologyTreePane.scrollTop;
    const detailScrollTop = topologyDetailPane.scrollTop;
    const state = topologyProjection.snapshot();
    renderTopologyOverview(state);

    let target = findTopologySelection(state, topologySelection.key);
    if (!target) {
      topologySelection = { key: "page", kind: "page" };
      topologyExpandAllItems = false;
      target = { kind: "page", state };
    }
    const treeModel = createTopologyTreeViewModel(state, {
      selection: topologySelection,
      expandAllItems: topologyExpandAllItems,
      inlineItemLimit: TOPOLOGY_INLINE_ITEM_LIMIT,
      selectedItemLimit: TOPOLOGY_SELECTED_ITEM_LIMIT,
      fullItemLimit: TOPOLOGY_FULL_ITEM_LIMIT
    });
    const visibleTopologyKeys = new Set(
      treeModel.presentations.map(({ selection }) => selection.key)
    );
    for (const key of topologyCollapsedKeys) {
      if (!visibleTopologyKeys.has(key)) {
        topologyCollapsedKeys.delete(key);
      }
    }
    if (treeModel.structureKey !== renderedTopologyStructureKey) {
      cancelDeferredTopologyItemRendering();
      topologyRenderedNodes.clear();
      topologyNodeSelections.clear();
      const deferItems =
        topologyExpandAllItems &&
        state.itemCount > TOPOLOGY_DEFERRED_ITEM_THRESHOLD;
      const deferredItems: DeferredTopologyItemRender[] = [];
      topologyTreePane.replaceChildren(
        createTopologyTree(state, deferItems ? deferredItems : null)
      );
      renderedTopologyStructureKey = treeModel.structureKey;
      if (deferredItems.length > 0) {
        pendingTopologyItemRenders = deferredItems;
        topologyTreePane.setAttribute("aria-busy", "true");
        scheduleDeferredTopologyItemRendering();
      }
    } else {
      refreshTopologyTreeNodes(treeModel.presentations);
    }
    topologyDetailPane.replaceChildren(createTopologyDetail(target));
    topologyTreePane.scrollTop = treeScrollTop;
    topologyDetailPane.scrollTop = detailScrollTop;
    topologyInspector.update({
      selectedKey: topologySelection.key,
      restoreFocus: treeHadFocus,
      syncState: topologyProjection.status().syncState,
      coverageStatus: topologyProjection.status().coverage?.status ?? "legacy"
    });
    reportTopologyRenderPerformance(renderStartedAt, state);
  }

  function resetTopologyProjectionConsumerState(): void {
    liveReinjectionTargets.clear();
    liveClientConnections.clear();
    sourceEventConnectionEpochs.clear();
    topologySelection = { key: "page", kind: "page" };
    topologyExpandAllItems = false;
    renderedTopologyStructureKey = null;
    topologyRenderedNodes.clear();
    topologyNodeSelections.clear();
    topologyCollapsedKeys.clear();
  }

  function reportTopologyRenderPerformance(
    renderStartedAt: number,
    state: TopologyState
  ): void {
    const hook = (
      globalThis as typeof globalThis & {
        __LSEW_TOPOLOGY_RENDER_SAMPLE__?: (
          sample: TopologyRenderPerformanceSample
        ) => void;
      }
    ).__LSEW_TOPOLOGY_RENDER_SAMPLE__;
    if (typeof hook !== "function") {
      return;
    }

    const currentSubscriptions = [
      ...state.unassignedSubscriptions,
      ...state.clients.flatMap((client) => [
        ...client.waitingSubscriptions,
        ...client.sessions
          .filter((session) => !session.historical)
          .flatMap((session) => session.subscriptions)
      ])
    ];
    hook({
      durationMs: performance.now() - renderStartedAt,
      logicalUpdateCount: currentSubscriptions.reduce(
        (total, subscription) => total + subscription.updateCount,
        0
      ),
      deliveryCount: currentSubscriptions.reduce(
        (total, subscription) => total + subscription.deliveryCount,
        0
      ),
      visibleNodeCount:
        topologyTreePane.querySelectorAll(".topology-node").length
    });
  }

  function renderTopologyOverview(state: TopologyState): void {
    const projectionStatus = topologyProjection.status();
    const limitedClients = state.clients.filter(
      (client) => client.coverageStatus === "limited"
    ).length;
    const coverageLabel = projectionStatus.semanticActive
      ? projectionStatus.coverage?.status === "partial"
        ? "Partial semantic coverage"
        : "Complete semantic coverage"
      : state.clientCount === 0
        ? "Awaiting capture"
        : limitedClients === 0
          ? "Full API coverage"
          : limitedClients === state.clientCount
            ? "Limited wire coverage"
            : "Mixed coverage";
    const coverageTone = projectionStatus.semanticActive
      ? projectionStatus.coverage?.status === "partial"
        ? "warning"
        : "active"
      : state.clientCount === 0
        ? "idle"
        : limitedClients === 0
          ? "active"
          : "pending";

    topologyOverview.replaceChildren(
      createTopologyMetric("Clients", state.clientCount),
      createTopologyMetric(
        "Sessions",
        `${state.activeSessionCount} active · ${state.historicalSessionCount} historical`
      ),
      createTopologyMetric(
        "Subscriptions",
        `${state.serverEstablishedSubscriptionCount}/${state.activeSubscriptionCount} established`
      ),
      createTopologyMetric("Items", state.itemCount),
      createTopologyMetric("Listeners", state.listenerCount),
      createTopologyMetric("Coverage", coverageLabel, coverageTone),
      createTopologyMetric(
        "Sync",
        topologySyncLabel(),
        topologySyncTone()
      ),
      createTopologyActions({
        state,
        treePane: topologyTreePane,
        collapsedKeys: topologyCollapsedKeys,
        canExpandAll: (currentState) =>
          topologyCollapsedKeys.size > 0 || topologyHasOmittedItemNodes(currentState),
        setExpandAllItems(value) {
          topologyExpandAllItems = value;
          renderedTopologyStructureKey = null;
        },
        render: renderTopology,
        resetCurrent: () => topologyProjection.resetCurrentObservations(),
        clearHistory: () => topologyProjection.clearHistory(),
        createExportMenu: createTopologyExportForState
      })
    );
  }

  function topologySyncLabel(): string {
    const status = topologyProjection.status();
    if (!status.semanticActive) return "Legacy event projection";
    if (status.syncState === "staging") return "Synchronizing";
    if (status.syncState === "complete") return "Synchronized";
    if (status.syncState === "partial") return "Partial · retry needed";
    return "Live semantic capture";
  }

  function topologySyncTone(): string {
    const status = topologyProjection.status();
    if (!status.semanticActive) return "neutral";
    if (status.syncState === "partial") return "warning";
    if (status.syncState === "staging") return "pending";
    return "active";
  }

  function topologyHasOmittedItemNodes(state: TopologyState): boolean {
    if (topologyExpandAllItems) {
      return false;
    }
    const subscriptionOmitsItems = (
      client: TopologyClient | null,
      session: TopologySession | null,
      subscription: TopologySubscription
    ): boolean => {
      if (subscription.items.length <= TOPOLOGY_INLINE_ITEM_LIMIT) {
        return false;
      }
      const subscriptionKey = topologySubscriptionNodePresentation(
        client,
        session,
        subscription
      ).selection.key;
      const visibleLimit =
        topologySelection.ownerKey === subscriptionKey
          ? TOPOLOGY_SELECTED_ITEM_LIMIT
          : 0;
      return subscription.items.length > visibleLimit;
    };
    return (
      state.clients.some((client) =>
        client.waitingSubscriptions.some((subscription) =>
          subscriptionOmitsItems(client, null, subscription)
        ) ||
        client.sessions.some((session) =>
          session.subscriptions.some((subscription) =>
            subscriptionOmitsItems(client, session, subscription)
          )
        )
      ) ||
      state.unassignedSubscriptions.some((subscription) =>
        subscriptionOmitsItems(null, null, subscription)
      )
    );
  }

  function createTopologyExportForState(state: TopologyState): HTMLElement {
    return createTopologyExportMenu({
      root,
      state,
      redactions: topologyExportRedactions,
      getCompleteEvidence: () => topologyExportCompleteEvidence,
      setCompleteEvidence(value) {
        topologyExportCompleteEvidence = value;
      },
      retainedEventCount: currentStoreStats.retained,
      createSnapshot(options) {
        return createTopologyStructuredSnapshot(state, topologyProjection.status(), options);
      }
    });
  }

  function createTopologyMetric(
    label: string,
    value: string | number,
    tone = "neutral"
  ): HTMLElement {
    const metric = document.createElement("div");
    metric.className = "topology-metric";
    metric.dataset.tone = tone;
    metric.append(
      createTextElement("span", "topology-metric-label", label),
      createTextElement("strong", "topology-metric-value", String(value))
    );
    return metric;
  }

  function topologyTreeViewOptions(): TopologyTreeViewOptions {
    return {
      selectedKey: () => topologySelection.key,
      showItemStatus: () => topologyExpandAllItems,
      collapsedKeys: topologyCollapsedKeys,
      renderedNodes: topologyRenderedNodes,
      nodeSelections: topologyNodeSelections
    };
  }

  function createTopologyTree(
    state: TopologyState,
    deferredItems: DeferredTopologyItemRender[] | null = null
  ): HTMLElement {
    topologyTreeItemBudget = topologyExpandAllItems
      ? TOPOLOGY_FULL_ITEM_LIMIT
      : 0;
    topologyDeferredItemCollector = deferredItems;
    const tree = document.createElement("ul");
    tree.className = "topology-tree";
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Current Lightstreamer topology");

    const pagePresentation = topologyPageNodePresentation(state);
    const page = createTopologyTreeNode(pagePresentation, topologyTreeViewOptions());
    const pageChildren = createTopologyTreeGroup();

    for (const client of state.clients) {
      pageChildren.append(createClientTopologyTreeNode(client));
    }

    if (state.unassignedSubscriptions.length > 0) {
      const orphanGroup = document.createElement("li");
      orphanGroup.className = "topology-orphan-group";
      orphanGroup.append(
        createTextElement(
          "div",
          "topology-orphan-heading",
          `Unassigned subscriptions (${state.unassignedSubscriptions.length})`
        )
      );
      const orphanChildren = createTopologyTreeGroup();
      for (const subscription of state.unassignedSubscriptions) {
        orphanChildren.append(
          createSubscriptionTopologyTreeNode(null, null, subscription)
        );
      }
      orphanGroup.append(orphanChildren);
      pageChildren.append(orphanGroup);
    }

    attachTopologyTreeChildren(page, pageChildren, topologyTreeViewOptions());
    tree.append(page.item);
    topologyDeferredItemCollector = null;
    return tree;
  }

  function scheduleDeferredTopologyItemRendering(): void {
    if (scheduledTopologyItemRender || pendingTopologyItemRenders.length === 0) {
      return;
    }
    scheduledTopologyItemRender = schedulePanelFrame(() => {
      scheduledTopologyItemRender = null;
      if (!panelVisible || !topologyExpandAllItems || activeView !== "topology") {
        cancelDeferredTopologyItemRendering();
        return;
      }
      const fragments = new Map<HTMLUListElement, DocumentFragment>();
      for (const task of pendingTopologyItemRenders.splice(
        0,
        TOPOLOGY_ITEM_RENDER_CHUNK
      )) {
        const fragment =
          fragments.get(task.group) ?? document.createDocumentFragment();
        fragment.append(task.render());
        fragments.set(task.group, fragment);
      }
      for (const [group, fragment] of fragments) {
        group.append(fragment);
      }
      if (pendingTopologyItemRenders.length > 0) {
        scheduleDeferredTopologyItemRendering();
        return;
      }
      topologyTreePane.removeAttribute("aria-busy");
      renderTopology();
    });
  }

  function cancelDeferredTopologyItemRendering(): void {
    const incomplete =
      Boolean(scheduledTopologyItemRender) ||
      pendingTopologyItemRenders.length > 0;
    if (scheduledTopologyItemRender) {
      cancelPanelFrame(scheduledTopologyItemRender);
      scheduledTopologyItemRender = null;
    }
    pendingTopologyItemRenders = [];
    topologyDeferredItemCollector = null;
    topologyTreePane.removeAttribute("aria-busy");
    if (incomplete) {
      renderedTopologyStructureKey = null;
    }
  }

  function refreshTopologyTreeNodes(
    presentations: readonly TopologyNodePresentation[]
  ): void {
    for (const presentation of presentations) {
      const rendered = topologyRenderedNodes.get(presentation.selection.key);
      if (rendered) {
        applyTopologyNodePresentation(rendered, presentation, topologyTreeViewOptions());
      }
    }
  }

  function createClientTopologyTreeNode(client: TopologyClient): HTMLElement {
    const presentation = topologyClientNodePresentation(client);
    const node = createTopologyTreeNode(presentation, topologyTreeViewOptions());
    const children = createTopologyTreeGroup();

    if (client.waitingSubscriptions.length > 0) {
      const waitingGroup = document.createElement("li");
      waitingGroup.className = "topology-orphan-group topology-waiting-group";
      waitingGroup.append(
        createTextElement(
          "div",
          "topology-orphan-heading",
          `Waiting for session (${client.waitingSubscriptions.length})`
        )
      );
      const waitingChildren = createTopologyTreeGroup();
      for (const subscription of client.waitingSubscriptions) {
        waitingChildren.append(
          createSubscriptionTopologyTreeNode(client, null, subscription)
        );
      }
      waitingGroup.append(waitingChildren);
      children.append(waitingGroup);
    }

    for (const session of client.sessions) {
      children.append(createSessionTopologyTreeNode(client, session));
    }
    attachTopologyTreeChildren(node, children, topologyTreeViewOptions());
    return node.item;
  }

  function createSessionTopologyTreeNode(
    client: TopologyClient,
    session: TopologySession
  ): HTMLElement {
    const presentation = topologySessionNodePresentation(client, session);
    const node = createTopologyTreeNode(presentation, topologyTreeViewOptions());
    const children = createTopologyTreeGroup();
    for (const subscription of session.subscriptions) {
      children.append(
        createSubscriptionTopologyTreeNode(client, session, subscription)
      );
    }
    attachTopologyTreeChildren(node, children, topologyTreeViewOptions());
    return node.item;
  }

  function createSubscriptionTopologyTreeNode(
    client: TopologyClient | null,
    session: TopologySession | null,
    subscription: TopologySubscription
  ): HTMLElement {
    const presentation = topologySubscriptionNodePresentation(
      client,
      session,
      subscription
    );
    const selectionKey = presentation.selection.key;
    const node = createTopologyTreeNode(presentation, topologyTreeViewOptions());
    const children = createTopologyTreeGroup();

    const selectedBranch = topologySelection.ownerKey === selectionKey;
    const itemLimit = topologyExpandAllItems
      ? Math.min(subscription.items.length, topologyTreeItemBudget)
      : subscription.items.length <= TOPOLOGY_INLINE_ITEM_LIMIT
        ? subscription.items.length
        : selectedBranch
          ? TOPOLOGY_SELECTED_ITEM_LIMIT
          : 0;
    if (topologyExpandAllItems) {
      topologyTreeItemBudget -= itemLimit;
    }
    for (const item of subscription.items.slice(0, itemLimit)) {
      if (topologyDeferredItemCollector) {
        topologyDeferredItemCollector.push({
          group: children,
          render: () =>
            createItemTopologyTreeNode(client, session, subscription, item)
        });
      } else {
        children.append(
          createItemTopologyTreeNode(client, session, subscription, item)
        );
      }
    }
    if (subscription.items.length > itemLimit) {
      const label =
        itemLimit === 0
          ? `Select subscription to inspect ${subscription.items.length.toLocaleString()} items`
          : `${(subscription.items.length - itemLimit).toLocaleString()} more items omitted from the tree`;
      if (topologyDeferredItemCollector && itemLimit > 0) {
        topologyDeferredItemCollector.push({
          group: children,
          render: () => createTopologyPlaceholderNode(label)
        });
      } else {
        children.append(createTopologyPlaceholderNode(label));
      }
    }
    if (subscription.items.length === 0 && subscription.itemGroup) {
      children.append(
        createTopologyPlaceholderNode(
          `Item group ${subscription.itemGroup} · resolves from updates`
        )
      );
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        children.append(
          createListenerTopologyTreeNode(
            client,
            session,
            subscription,
            null,
            listenerId
          )
        );
      }
    }
    attachTopologyTreeChildren(
      node,
      children,
      topologyTreeViewOptions(),
      Boolean(topologyDeferredItemCollector && itemLimit > 0)
    );
    return node.item;
  }

  function createTopologyPlaceholderNode(label: string): HTMLLIElement {
    const item = document.createElement("li");
    item.setAttribute("role", "none");
    const row = createTextElement("div", "topology-placeholder-node", label);
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-disabled", "true");
    row.tabIndex = -1;
    item.append(row);
    return item;
  }

  function createItemTopologyTreeNode(
    client: TopologyClient | null,
    session: TopologySession | null,
    subscription: TopologySubscription,
    item: TopologyItem
  ): HTMLElement {
    const presentation = topologyItemNodePresentation(
      client,
      session,
      subscription,
      item
    );
    const node = createTopologyTreeNode(presentation, topologyTreeViewOptions());
    const children = createTopologyTreeGroup();
    const renderListeners =
      !topologyExpandAllItems ||
      subscription.items.length <= TOPOLOGY_INLINE_ITEM_LIMIT;
    if (renderListeners) {
      for (const listenerId of item.listenerIds) {
        children.append(
          createListenerTopologyTreeNode(
            client,
            session,
            subscription,
            item,
            listenerId
          )
        );
      }
    }
    if (children.childElementCount > 0) {
      attachTopologyTreeChildren(node, children, topologyTreeViewOptions());
    }
    return node.item;
  }

  function createListenerTopologyTreeNode(
    _client: TopologyClient | null,
    _session: TopologySession | null,
    subscription: TopologySubscription,
    item: TopologyItem | null,
    listenerId: string
  ): HTMLElement {
    const presentation = topologyListenerNodePresentation(
      _client,
      _session,
      subscription,
      item,
      listenerId
    );
    return createTopologyTreeNode(presentation, topologyTreeViewOptions()).item;
  }

  function createTopologyDetail(target: TopologySelectionTarget): HTMLElement {
    const content = document.createElement("div");
    content.className = "topology-detail-content";

    switch (target.kind) {
      case "page":
        renderTopologyPageDetail(content, target.state);
        break;
      case "client":
        renderTopologyClientDetail(content, target.client);
        break;
      case "session":
        renderTopologySessionDetail(content, target.client, target.session);
        break;
      case "subscription":
        renderTopologySubscriptionDetail(content, target.subscription);
        break;
      case "generation":
        renderTopologyCommandGenerationDetail(
          content,
          target.subscription,
          target.generation
        );
        break;
      case "inferred-child":
        renderTopologyInferredChildDetail(
          content,
          target.subscription,
          target.generation,
          target.child
        );
        break;
      case "item":
        renderTopologyItemDetail(content, target.subscription, target.item);
        break;
      case "listener":
        renderTopologyListenerDetail(
          content,
          target.subscription,
          target.item,
          target.listener
        );
        break;
    }
    return content;
  }

  function renderTopologyPageDetail(
    content: HTMLElement,
    state: TopologyState
  ): void {
    content.append(
      createTopologyDetailHeader(
        "Inspected page topology",
        state.clientCount > 0 ? "Capture coverage and runtime ownership" : "Waiting for activity",
        state.clientCount > 0 ? "active" : "idle"
      ),
      createTopologyDetailSection("Capture summary", [
        ["Clients", state.clientCount],
        ["Active sessions", state.activeSessionCount],
        ["Historical sessions retained", state.historicalSessionCount],
        ["Subscriptions", state.subscriptionCount],
        ["Active subscriptions", state.activeSubscriptionCount],
        ["Server-established subscriptions", state.serverEstablishedSubscriptionCount],
        ["Resolved items", state.itemCount],
        ["Unique listeners", state.listenerCount],
        ["Unassigned subscriptions", state.unassignedSubscriptions.length],
        ["Observing since", topologyTime(state.observingSince)]
      ])
    );
    if (state.clientCount === 0) {
      content.append(
        createTextElement(
          "p",
          "topology-detail-note",
          "Refresh the inspected application or create a Lightstreamer client. Topology appears as soon as constructor or wire activity is captured."
        )
      );
    } else {
      content.append(
        createTextElement(
          "p",
          "topology-detail-note",
          "Full coverage uses the official Lightstreamer public API. Limited coverage is reconstructed from captured WebSocket TLCP and may omit options, listeners, and server-provided session details."
        )
      );
    }
    content.append(
      createTextElement(
        "p",
        "topology-detail-note",
        "The Workbench only observes Lightstreamer clients and WebSockets owned by the inspected page. It does not create a client, call connect or subscribe, or open a server session."
      )
    );
  }

  function renderTopologyClientDetail(
    content: HTMLElement,
    client: TopologyClient
  ): void {
    const activeSession = client.sessions.find((session) => session.active);
    content.append(
      createTopologyDetailHeader(
        client.id,
        [
          client.libraryVersion ? `Lightstreamer Web Client ${client.libraryVersion}` : "Version unavailable",
          topologyProjection.status().semanticActive &&
            topologyProjection.status().coverage?.status === "partial"
            ? "Partial semantic coverage"
            : client.coverageStatus === "limited"
              ? "Limited coverage"
              : "Full API coverage"
        ].join(" · "),
        activeSession ? "active" : "inactive"
      ),
      createTopologyDetailSection("Client identity", [
        ["Client ID", client.id],
        ["Library version", client.libraryVersion],
        ["Instrumentation source", client.instrumentationSource],
        ["Coverage", client.coverageStatus],
        ["Connection state", client.normalizedStatus],
        ["Exact client status", semanticClientValue(client, "status", client.status)],
        ["Server address", semanticClientValue(client, "serverAddress", client.serverAddress)],
        ["Adapter Set", semanticClientValue(client, "adapterSet", client.adapterSet)],
        ["Client listeners", client.clientListenerIds.length],
        ["First seen", topologyTime(client.firstSeenAt)],
        ["Last seen", topologyTime(client.lastSeenAt)]
      ]),
      createTopologyDetailSection("Connection options", connectionOptionRows(client))
    );
  }

  function renderTopologySessionDetail(
    content: HTMLElement,
    client: TopologyClient,
    session: TopologySession
  ): void {
    content.append(
      createTopologyDetailHeader(
        session.id ?? "No established session",
        session.active
          ? "Current session"
          : session.historical
            ? "Frozen record from an ended page session"
            : "Awaiting server session",
        topologySessionTone(session)
      ),
      createTopologyDetailSection("Session", [
        ["Session ID", session.id],
        ["Client", client.id],
        [
          session.historical
            ? "Connection state when frozen"
            : "Connection state",
          session.normalizedStatus
        ],
        [
          session.historical
            ? "Exact client status when frozen"
            : "Exact client status",
          session.status
        ],
        [session.historical ? "Last transport" : "Transport", session.transport],
        ["Server instance", session.serverInstanceAddress],
        ["Server socket name", session.serverSocketName],
        ["Client IP", semanticClientValue(client, "clientIp", session.clientIp)],
        [
          "IP disclosure",
          client.semanticValueStates?.clientIp?.state === "redacted"
            ? "Redacted at capture boundary · exact unavailable"
            : session.clientIp
              ? "Masked at capture · exact unavailable"
              : semanticClientValue(client, "clientIp", null)
        ],
        [
          session.historical
            ? "Subscriptions active when frozen"
            : "Active subscriptions",
          session.subscriptions.filter((entry) => entry.active).length
        ],
        [
          session.historical
            ? "Server-established when frozen"
            : "Server-established",
          session.subscriptions.filter((entry) => entry.serverEstablished).length
        ],
        ["First seen", topologyTime(session.firstSeenAt)],
        ["Last seen", topologyTime(session.lastSeenAt)],
        ["Ended", topologyTime(session.endedAt)],
        ["Observing since", topologyTime(session.observingSince)],
        ["Connection epochs", session.connectionEpochCount],
        ["Recoveries", session.recoveryCount]
      ]),
      createTopologyDetailSection("Connection policy", connectionOptionRows(client))
    );
    if (session.historical) {
      content.append(
        createTextElement(
          "p",
          "topology-detail-note",
          `${HISTORICAL_TOPOLOGY_NOTE} Transport and connection values are the last values observed before the page session ended.`
        )
      );
    }
  }

  function renderTopologySubscriptionDetail(
    content: HTMLElement,
    subscription: TopologySubscription
  ): void {
    content.append(
      createTopologyDetailHeader(
        subscription.id,
        subscription.historical
          ? `${subscription.mode ?? "Unknown mode"} · frozen record`
          : `${subscription.mode ?? "Unknown mode"} · ${subscription.statusLabel}`,
        topologySubscriptionTone(subscription)
      ),
      createTopologyDetailSection("Subscription lifecycle", [
        ["Subscription ID", subscription.id],
        [
          subscription.historical
            ? "Derived status when frozen"
            : "Derived status",
          subscription.statusLabel
        ],
        [
          subscription.historical ? "Active when frozen" : "Active on client",
          topologyBoolean(subscription.active)
        ],
        [
          subscription.historical
            ? "Established when frozen"
            : "Established by server",
          topologyBoolean(subscription.serverEstablished)
        ],
        ["Last session", subscription.lastSessionId],
        ["Pending since", topologyTime(subscription.pendingSince)],
        ["Pending duration", topologyDurationSince(subscription.pendingSince)],
        [
          "Exact duplicate signal",
          subscription.exactDuplicateCount > 1
            ? `${subscription.exactDuplicateCount} active copies`
            : "No"
        ],
        [
          "Overlapping stream signal",
          subscription.overlapCount > 1
            ? `${subscription.overlapCount} active subscriptions`
            : "No"
        ],
        ["Capture source", subscription.captureSource],
        ["Historical snapshot", topologyBoolean(subscription.historical)],
        ["Created", topologyTime(subscription.createdAt)],
        ["Started", topologyTime(subscription.startedAt)],
        ["Ended", topologyTime(subscription.endedAt)]
      ]),
      createTopologyDetailSection("Requested configuration", [
        ["Mode", semanticSubscriptionValue(subscription, "mode", subscription.mode)],
        [
          "Items / group",
          subscription.configuredItems
            ? semanticSubscriptionValue(
                subscription,
                "items",
                subscription.configuredItems.join(", ")
              )
            : semanticSubscriptionValue(
                subscription,
                "itemGroup",
                subscription.itemGroup
              )
        ],
        [
          "Fields / schema",
          subscription.fields
            ? semanticSubscriptionValue(
                subscription,
                "fields",
                subscription.fields.join(", ")
              )
            : semanticSubscriptionValue(
                subscription,
                "fieldSchema",
                subscription.fieldSchema
              )
        ],
        [
          "Data Adapter",
          semanticSubscriptionValue(subscription, "dataAdapter", subscription.dataAdapter)
        ],
        ["Selector", semanticSubscriptionValue(subscription, "selector", subscription.selector)],
        [
          "Snapshot",
          semanticSubscriptionValue(
            subscription,
            "requestedSnapshot",
            subscription.requestedSnapshot
          )
        ],
        [
          "Buffer size",
          semanticSubscriptionValue(
            subscription,
            "requestedBufferSize",
            subscription.requestedBufferSize
          )
        ],
        [
          "Requested max frequency",
          semanticSubscriptionValue(
            subscription,
            "requestedMaxFrequency",
            subscription.requestedMaxFrequency,
            formatFrequency
          )
        ],
        [
          "Second-level Data Adapter",
          semanticSubscriptionValue(
            subscription,
            "commandSecondLevelDataAdapter",
            subscription.commandSecondLevelDataAdapter
          )
        ],
        [
          "Second-level fields / schema",
          subscription.commandSecondLevelFields?.join(", ") ??
            subscription.commandSecondLevelFieldSchema
        ]
      ]),
      createTopologyDetailSection("Observed runtime", [
        [
          "Real max frequency",
          semanticSubscriptionValue(
            subscription,
            "realMaxFrequency",
            subscription.realMaxFrequency,
            formatFrequency
          )
        ],
        ["Listeners", subscription.listenerCount],
        ["Resolved items", subscription.items.length],
        ["Logical real updates", subscription.updateCount],
        ["Synthetic updates", subscription.syntheticUpdateCount],
        ["Listener callback deliveries", subscription.deliveryCount],
        ["First update", topologyTime(subscription.firstUpdateAt)],
        ["Last update", topologyTime(subscription.lastUpdateAt)],
        ["Last synthetic update", topologyTime(subscription.lastSyntheticUpdateAt)],
        ["Lost updates", subscription.lostUpdateCount],
        ["Subscription errors", subscription.errorCount]
      ]),
      createTopologyDetailSection("Semantic lifecycle evidence", [
        ["Establishment epochs", subscription.establishments.length],
        [
          "Latest establishment",
          subscription.establishments.at(-1)?.id ?? null
        ],
        [
          "COMMAND generations",
          subscription.commandGenerations.length
        ],
        [
          "Active COMMAND keys",
          subscription.items.reduce(
            (total, item) => total + item.activeCommandKeyCount,
            0
          )
        ],
        [
          "Deleted COMMAND keys",
          subscription.items.reduce(
            (total, item) => total + item.deletedCommandKeyCount,
            0
          )
        ],
        [
          "Latest COMMAND generation",
          topologyLatestGenerationSummary(subscription.commandGenerations.at(-1) ?? null)
        ],
        [
          "Inferred second-level children",
          subscription.commandGenerations.reduce(
            (total, generation) => total + generation.inferredChildren.length,
            0
          )
        ],
        [
          "Latest second-level evidence",
          topologyLatestInferredChildSummary(subscription.commandGenerations)
        ]
      ])
    );
    if (subscription.mode === "COMMAND" || subscription.commandGenerations.length > 0) {
      content.append(
        createTopologyCommandEvidence({
          subscription,
          expandedEvidence: topologyExpandedEvidence,
          evidenceLimits: topologyEvidenceLimits,
          onRender: renderTopology
        }),
        createOpenCommandStateAction(
          subscription,
          subscription.items[0] ?? null,
          openTopologyCommandState
        )
      );
    }
    if (subscription.historical) {
      content.append(
        createTextElement(
          "p",
          "topology-detail-note",
          HISTORICAL_TOPOLOGY_NOTE
        )
      );
    }
  }

  function openTopologyCommandState(
    subscription: TopologySubscription,
    item: TopologyItem | null
  ): void {
    commandStateView.selectedItem = item
      ? {
          subscriptionId: subscription.id,
          itemId: resolveCommandItemIdentity(
            { ...subscription, items: subscription.configuredItems },
            item
          ).itemId
        }
      : null;
    commandStateView.selectedKey = null;
    commandStateView.selectedUpdateEventId = null;
    resetCommandListWindows();
    activeView = "command";
    updateActiveViewChrome();
    renderCommandState();
  }

  function renderTopologyItemDetail(
    content: HTMLElement,
    subscription: TopologySubscription,
    item: TopologyItem
  ): void {
    content.append(
      createTopologyDetailHeader(
        topologyItemLabel(item),
        `${item.snapshotPhase}${subscription.historical ? " when frozen" : ""} · ${item.updateCount} updates`,
        topologyItemTone(subscription, item)
      ),
      createTopologyDetailSection("Item", [
        ["Name", item.name],
        ["Position", item.position],
        ["Identity resolution", item.resolution],
        ["Subscription", subscription.id],
        [
          subscription.historical
            ? "Snapshot phase when frozen"
            : "Snapshot phase",
          item.snapshotPhase
        ],
        ["Logical real updates", item.updateCount],
        ["Synthetic updates", item.syntheticUpdateCount],
        ["Listener callback deliveries", item.deliveryCount],
        ["First update", topologyTime(item.firstUpdateAt)],
        ["Last update", topologyTime(item.lastUpdateAt)],
        ["Last synthetic update", topologyTime(item.lastSyntheticUpdateAt)],
        ["Lost updates", item.lostUpdateCount],
        ["Listeners", item.listenerIds.length],
        ["Listener identities", item.listenerIds],
        ["Active COMMAND keys", item.activeCommandKeyCount],
        ["Deleted COMMAND keys", item.deletedCommandKeyCount],
        ["Last real command", item.lastCommand]
      ])
    );
    if (subscription.historical) {
      content.append(createHistoricalItemEventsAction(subscription, item));
    }
    if (subscription.mode === "COMMAND") {
      content.append(
        createOpenCommandStateAction(subscription, item, openTopologyCommandState)
      );
    }
  }

  function renderTopologyCommandGenerationDetail(
    content: HTMLElement,
    subscription: TopologySubscription,
    generation: TopologyCommandGeneration
  ): void {
    content.append(
      createTopologyDetailHeader(
        generation.key ?? generation.id,
        "COMMAND generation",
        "active"
      ),
      createTopologyDetailSection("COMMAND generation", [
        ["Generation ID", generation.id],
        ["Subscription", subscription.id],
        ["Item identity", generation.itemId],
        ["Key", generation.key],
        ["Command", generation.command],
        ["Captured sequence", generation.captureSequence],
        ["Inferred children", generation.inferredChildren.length]
      ])
    );
  }

  function renderTopologyInferredChildDetail(
    content: HTMLElement,
    subscription: TopologySubscription,
    generation: TopologyCommandGeneration,
    child: TopologyInferredChild
  ): void {
    content.append(
      createTopologyDetailHeader(
        child.label,
        "Inferred child evidence",
        "warning"
      ),
      createTopologyDetailSection("Inferred child evidence", [
        ["Child ID", child.id],
        ["Generation", generation.id],
        ["Subscription", subscription.id],
        ["Key", child.key],
        ["Capture kind", child.captureKind],
        ["Callback", child.callback],
        ["Provenance", child.provenance],
        ["Captured sequence", child.captureSequence]
      ])
    );
  }

  function createHistoricalItemEventsAction(
    subscription: TopologySubscription,
    item: TopologyItem
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "topology-detail-actions";
    const button = document.createElement("button");
    button.className = "topology-action topology-view-matching-events";
    button.type = "button";
    button.textContent = "View matching timeline events";
    button.addEventListener("click", () => {
      for (const key of Object.keys(filterState) as Array<keyof EventFilterState>) {
        delete filterState[key];
      }
      filterState.subscriptionId = subscription.id;
      if (item.name) {
        filterState.item = item.name;
      } else if (item.position !== null) {
        filterState.itemPosition = item.position;
      }
      searchInput.value = "";
      activeView = "timeline";
      updateActiveViewChrome();
      resetTimelineRenderLimit();
      timelineState.selectionNeedsFilterReconciliation = true;
      renderFeed();
    });
    section.append(
      button,
      createTextElement(
        "p",
        "topology-detail-action-note",
        HISTORICAL_TOPOLOGY_NOTE
      )
    );
    return section;
  }

  function renderTopologyListenerDetail(
    content: HTMLElement,
    subscription: TopologySubscription,
    item: TopologyItem | null,
    listener: TopologyListener
  ): void {
    content.append(
      createTopologyDetailHeader(
        listener.id,
        "Subscription listener",
        "neutral"
      ),
      createTopologyDetailSection("Listener attachment", [
        ["Listener ID", listener.id],
        ["Attachment IDs", listener.attachmentIds],
        ["Implemented callbacks", listener.callbacks],
        ["Registration attempts", listener.registrationCount],
        ["Active registration", topologyBoolean(listener.active)],
        ["Logical metric owner", topologyBoolean(listener.metricOwner)],
        ["Callback deliveries", listener.deliveryCount],
        ["First delivery", topologyTime(listener.firstDeliveryAt)],
        ["Last delivery", topologyTime(listener.lastDeliveryAt)],
        ["Subscription", subscription.id],
        ["Item", item ? topologyItemLabel(item) : "All subscription items"],
        ["Subscription mode", subscription.mode],
        ["Subscription active", topologyBoolean(subscription.active)],
        ["Server-established", topologyBoolean(subscription.serverEstablished)]
      ]),
      createTextElement(
        "p",
        "topology-detail-note",
        "Lightstreamer subscription listeners receive callbacks for every configured item, so the same listener appears beneath each resolved item."
      )
    );
  }

  function createTopologyDetailHeader(
    title: string,
    subtitle: string,
    tone: string
  ): HTMLElement {
    const header = document.createElement("header");
    header.className = "topology-detail-header";
    header.dataset.tone = tone;
    const copy = document.createElement("div");
    copy.className = "topology-detail-title-group";
    copy.append(
      createTextElement("h2", "topology-detail-heading", title),
      createTextElement("p", "topology-detail-subtitle", subtitle)
    );
    header.append(
      copy,
      createTextElement("span", "topology-detail-status", topologyToneLabel(tone))
    );
    return header;
  }

  function createTopologyDetailSection(
    heading: string,
    rows: ReadonlyArray<readonly [string, unknown]>
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "topology-detail-section";
    section.append(
      createTextElement("h3", "topology-detail-section-heading", heading)
    );
    const properties = document.createElement("dl");
    properties.className = "topology-properties";
    for (const [label, value] of rows) {
      properties.append(
        createTextElement("dt", "topology-property-label", label),
        createTextElement("dd", "topology-property-value", topologyValue(value))
      );
    }
    section.append(properties);
    return section;
  }

  function connectionOptionRows(
    client: TopologyClient
  ): ReadonlyArray<readonly [string, unknown]> {
    return [
      ["Requested max bandwidth", semanticClientValue(client, "requestedMaxBandwidth", client.requestedMaxBandwidth, formatBandwidth)],
      ["Real max bandwidth", semanticClientValue(client, "realMaxBandwidth", client.realMaxBandwidth, formatBandwidth)],
      ["Keepalive interval", semanticClientValue(client, "keepaliveInterval", client.keepaliveInterval, formatTopologyMilliseconds)],
      ["Reverse heartbeat interval", semanticClientValue(client, "reverseHeartbeatInterval", client.reverseHeartbeatInterval, formatTopologyMilliseconds)],
      ["Polling interval", semanticClientValue(client, "pollingInterval", client.pollingInterval, formatTopologyMilliseconds)],
      ["Idle timeout", semanticClientValue(client, "idleTimeout", client.idleTimeout, formatTopologyMilliseconds)],
      ["Retry delay", semanticClientValue(client, "retryDelay", client.retryDelay, formatTopologyMilliseconds)],
      ["First retry max delay", semanticClientValue(client, "firstRetryMaxDelay", client.firstRetryMaxDelay, formatTopologyMilliseconds)],
      ["Stalled timeout", semanticClientValue(client, "stalledTimeout", client.stalledTimeout, formatTopologyMilliseconds)],
      ["Reconnect timeout", semanticClientValue(client, "reconnectTimeout", client.reconnectTimeout, formatTopologyMilliseconds)],
      [
        "Session recovery timeout",
        semanticClientValue(client, "sessionRecoveryTimeout", client.sessionRecoveryTimeout, formatTopologyMilliseconds)
      ],
      [
        "Forced transport",
        client.forcedTransport === null || client.forcedTransport === undefined
          ? client.semanticValueStates?.forcedTransport
            ? semanticClientValue(client, "forcedTransport", client.forcedTransport)
            : "Automatic"
          : client.forcedTransport
      ]
    ];
  }

  function semanticClientValue<T>(
    client: TopologyClient,
    key: string,
    value: T | null | undefined,
    format: (value: T) => string = (candidate) => String(candidate)
  ): unknown {
    if (value !== null && value !== undefined && value !== "") {
      return format(value);
    }
    switch (client.semanticValueStates?.[key]?.state) {
      case "unknown":
        return "Unknown";
      case "unavailable":
        return "Unavailable";
      case "redacted":
        return "Redacted";
      case "not-applicable":
        return "Not applicable";
      default:
        return value;
    }
  }

  function semanticSubscriptionValue<T>(
    subscription: TopologySubscription,
    key: string,
    value: T | null | undefined,
    format: (value: T) => string = (candidate) => String(candidate)
  ): unknown {
    const state = subscription.semanticValueStates?.[key]?.state;
    if (value !== null && value !== undefined && value !== "") {
      const formatted = format(value);
      switch (state) {
        case "requested":
          return `${formatted} · Requested`;
        case "real":
          return `${formatted} · Real`;
        case "inferred":
          return `${formatted} · Inferred`;
        default:
          return formatted;
      }
    }
    switch (state) {
      case "requested":
        return "Requested";
      case "real":
        return "Real";
      case "inferred":
        return "Inferred";
      case "unknown":
        return "Unknown";
      case "unavailable":
        return "Unavailable";
      case "redacted":
        return "Redacted";
      case "not-applicable":
        return "Not applicable";
      default:
        return value;
    }
  }

  function topologyValue(value: unknown): string {
    if (value === null || value === undefined || value === "") {
      return "Unavailable";
    }
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(", ") : "Unavailable";
    }
    return String(value);
  }

  function rememberLiveReinjectionTarget(
    event: LightstreamerEventEnvelope
  ): void {
    if (event.synthetic || event.source === "synthetic") {
      return;
    }

    const clientId = event.client?.id ?? null;
    const clientConnection = rememberLiveClientConnection(event);
    const targetSessionId =
      event.client?.sessionId !== undefined
        ? event.client.sessionId
        : clientConnection?.sessionId ?? null;
    if (
      clientConnection &&
      event.kind === "item-update" &&
      event.captureSource === "wire"
    ) {
      sourceEventConnectionEpochs.set(event.id, clientConnection.epoch);
    }

    const subscriptionId = event.subscription?.id ?? null;
    if (!subscriptionId) {
      return;
    }

    const listenerId = event.listener?.id ?? null;
    if (listenerId) {
      const explicitAvailability =
        typeof event.raw?.targetAvailable === "boolean"
          ? event.raw.targetAvailable
          : null;
      const confirmsListenerTarget =
        explicitAvailability !== null ||
        event.kind === "item-update" ||
        (event.kind === "listener-added" &&
          Boolean(event.listener?.callbacks?.includes("onItemUpdate")));
      if (event.kind === "listener-removed" || confirmsListenerTarget) {
        liveReinjectionTargets.set(
          reinjectionTargetKey("captured-listener", subscriptionId, listenerId),
          {
            executionTarget: "captured-listener",
            subscriptionId,
            listenerId,
            clientId,
            sessionId: targetSessionId,
            connectionEpoch: clientConnection?.epoch ?? null,
            available:
              event.kind !== "listener-removed" &&
              explicitAvailability !== false,
            confirmedAt: event.timestamp
          }
        );
      }
    }

    if (event.captureSource !== "wire") {
      return;
    }
    liveReinjectionTargets.set(
      reinjectionTargetKey("captured-wire", subscriptionId, null),
      {
        executionTarget: "captured-wire",
        subscriptionId,
        listenerId: null,
        clientId,
        sessionId: targetSessionId,
        connectionEpoch: clientConnection?.epoch ?? null,
        available:
          event.kind !== "subscription-ended" &&
          event.kind !== "subscription-error",
        confirmedAt: event.timestamp
      }
    );
  }

  function rememberLiveClientConnection(
    event: LightstreamerEventEnvelope
  ): LiveClientConnection | null {
    const client = event.client;
    if (!client?.id) {
      return null;
    }

    const previous = liveClientConnections.get(client.id);
    const sessionId =
      client.sessionId !== undefined
        ? client.sessionId
        : previous?.sessionId ?? null;
    const status =
      client.status !== undefined ? client.status : previous?.status ?? null;
    const transport =
      client.transport !== undefined
        ? client.transport
        : previous?.transport ?? null;
    const connectionChanged =
      Boolean(previous) &&
      ((client.sessionId !== undefined &&
        sessionId !== previous?.sessionId) ||
        (client.transport !== undefined &&
          transport !== previous?.transport) ||
        (isLiveRecoveryStatus(status) &&
          !isLiveRecoveryStatus(previous?.status ?? null)));
    const connection: LiveClientConnection = {
      sessionId,
      status,
      transport,
      epoch: previous ? previous.epoch + Number(connectionChanged) : 1
    };
    liveClientConnections.set(client.id, connection);
    return connection;
  }

  function isLiveRecoveryStatus(status: string | null): boolean {
    const normalized = status?.toUpperCase() ?? "";
    return (
      normalized.includes("WILL-RETRY") ||
      normalized.includes("TRYING-RECOVERY")
    );
  }

  function reinjectionTargetKey(
    executionTarget: ReinjectionExecutionTarget,
    subscriptionId: string,
    listenerId: string | null
  ): string {
    return JSON.stringify([executionTarget, subscriptionId, listenerId]);
  }

  function draftTargetStatus(
    currentDraft: ReinjectionDraft | null,
    executionTarget: ReinjectionExecutionTarget
  ): DraftTargetStatus {
    const subscriptionId = currentDraft?.target.subscriptionId ?? null;
    const listenerId = currentDraft?.target.listenerId ?? null;
    const staleError =
      executionTarget === "captured-listener"
        ? "Local Injection Target is stale."
        : "Captured wire target is stale.";
    if (!currentDraft || !subscriptionId) {
      return {
        live: false,
        state: "stale",
        summary: "Target: unavailable",
        error: staleError
      };
    }

    const target =
      executionTarget === "captured-listener"
        ? liveSubscriptionInjectionTarget(subscriptionId, listenerId)
        : liveReinjectionTargets.get(
            reinjectionTargetKey(executionTarget, subscriptionId, listenerId)
          );
    if (!target?.available) {
      return {
        live: false,
        state: "stale",
        summary:
          executionTarget === "captured-listener"
            ? "Target: stale Subscription"
            : "Target: stale captured page stream",
        error: staleError
      };
    }

    const sourceClientId = currentDraft.sourceClient?.id ?? null;
    const sourceSessionId = currentDraft.sourceClient?.sessionId ?? null;
    if (
      executionTarget === "captured-wire" &&
      ((sourceClientId && target.clientId && sourceClientId !== target.clientId) ||
        (sourceSessionId && target.sessionId !== sourceSessionId))
    ) {
      return {
        live: false,
        state: "stale",
        summary: "Target: stale captured page stream · connection epoch changed",
        error: staleError
      };
    }

    const currentConnection = target.clientId
      ? liveClientConnections.get(target.clientId)
      : undefined;
    const currentSessionId = currentConnection?.sessionId;
    if (
      executionTarget === "captured-wire" &&
      target.sessionId &&
      currentSessionId !== undefined &&
      currentSessionId !== target.sessionId
    ) {
      return {
        live: false,
        state: "stale",
        summary: "Target: stale captured page stream · session changed",
        error: staleError
      };
    }

    const sourceConnectionEpoch = sourceEventConnectionEpochs.get(
      currentDraft.sourceEventId
    );
    if (
      executionTarget === "captured-wire" &&
      ((sourceConnectionEpoch !== undefined &&
        target.connectionEpoch !== null &&
        sourceConnectionEpoch !== target.connectionEpoch) ||
        (currentConnection &&
          target.connectionEpoch !== null &&
          currentConnection.epoch !== target.connectionEpoch))
    ) {
      return {
        live: false,
        state: "stale",
        summary: "Target: stale captured page stream · connection epoch changed",
        error: staleError
      };
    }

    if (
      executionTarget === "captured-listener" &&
      sourceSessionId &&
      currentSessionId !== undefined &&
      currentSessionId !== sourceSessionId
    ) {
      return {
        live: true,
        state: "session-mismatch",
        summary:
          currentSessionId === null
            ? "Target: live Subscription · source session has ended"
            : `Target: live Subscription · current session ${shortTopologyId(currentSessionId)} differs from source`,
        error: null
      };
    }

    return {
      live: true,
      state: "live",
      summary:
        executionTarget === "captured-listener"
          ? "Target: live Subscription"
          : "Target: live captured page stream",
      error: null
    };
  }

  function liveSubscriptionInjectionTarget(
    subscriptionId: string,
    preferredListenerId: string | null
  ): LiveReinjectionTarget | undefined {
    const preferred = preferredListenerId
      ? liveReinjectionTargets.get(
          reinjectionTargetKey(
            "captured-listener",
            subscriptionId,
            preferredListenerId
          )
        )
      : undefined;
    if (preferred?.available) {
      return preferred;
    }
    return [...liveReinjectionTargets.values()]
      .filter(
        (target) =>
          target.executionTarget === "captured-listener" &&
          target.subscriptionId === subscriptionId &&
          target.available
      )
      .sort((left, right) => right.confirmedAt - left.confirmedAt)[0];
  }

  function validatePanelDraftTarget(
    currentDraft: ReinjectionDraft | null,
    executionTarget: ReinjectionExecutionTarget
  ): { valid: boolean; errors: string[] } {
    const validation = validateDraftForExecutionTarget(
      currentDraft,
      executionTarget,
      { bridgeAvailable: bridgeReady }
    );
    const target = draftTargetStatus(currentDraft, executionTarget);
    const errors = target.error
      ? [...validation.errors, target.error]
      : validation.errors;
    return {
      valid: errors.length === 0,
      errors
    };
  }

  function createDraftTargetStatus(
    currentDraft: ReinjectionDraft | null,
    executionTarget: ReinjectionExecutionTarget
  ): HTMLElement {
    const target = draftTargetStatus(currentDraft, executionTarget);
    const element = createTextElement(
      "p",
      "replay-target-status",
      target.summary
    );
    element.dataset.state = target.state;
    return element;
  }

  function topologyBoolean(value: boolean): string {
    return value ? "Yes" : "No";
  }

  function topologyTime(value: number | null): string {
    return value === null ? "Unavailable" : formatExactLocalTime(value);
  }

  function topologyDurationSince(value: number | null): string {
    if (value === null) {
      return "Unavailable";
    }
    const elapsed = Math.max(0, Date.now() - value);
    if (elapsed < 1_000) {
      return "< 1 s";
    }
    if (elapsed < 60_000) {
      return `${Math.floor(elapsed / 1_000).toLocaleString()} s`;
    }
    if (elapsed < 3_600_000) {
      return `${Math.floor(elapsed / 60_000).toLocaleString()} min`;
    }
    return `${(elapsed / 3_600_000).toLocaleString(undefined, {
      maximumFractionDigits: 1
    })} h`;
  }

  function formatTopologyMilliseconds(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return "Unavailable";
    }
    return value >= 1_000
      ? `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} s`
      : `${value.toLocaleString()} ms`;
  }

  function formatBandwidth(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return "Unavailable";
    }
    return typeof value === "number" ? `${value.toLocaleString()} kbps` : value;
  }

  function formatFrequency(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return "Unavailable";
    }
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value)) {
      return `${value} updates/s`;
    }
    return String(value);
  }

  function shortTopologyId(value: string): string {
    return value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;
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
    commandStateProjections.apply(event);
  }

  function clearCommandContext(): void {
    commandContextEvents.length = 0;
    commandContextEventIds.clear();
    commandContextSubscriptionIds.clear();
    commandStateProjections.clear();
  }

  function closeStore(): void {
    flushAnalyticsSummary();
    if (storeCloseStarted) {
      return;
    }
    storeCloseStarted = true;
    history.close().receive(() => undefined, reportHistoryError);
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
      if (!panelVisible) {
        return;
      }
      status.textContent = nextStatus;
      status.dataset.status = nextStatus;
      if (bridgeReady !== previousBridgeReady) {
        renderActiveView({ preservePaneState: true });
      }
    },

    appendCaptureMessage(message) {
      if (analyticsEnabled()) {
        analyticsCapturedEventCount += 1;
        if (!analyticsDetected) {
          analyticsDetected = true;
          trackAnalytics({ name: "lightstreamer_detected" });
        }
      }
      const event = normalizer.normalize(message);
      rememberTimelineLiveEvent(event);
      timelineState.pendingCommitVisibility.set(
        event.id,
        timelineState.windowOffset === 0 && timelineState.followLatest
      );
      noteTimelineNewerEvent(event);
      const topologyResult = topologyProjection.ingestCapture(event);
      if (topologyResult.resetConsumerState) {
        resetTopologyProjectionConsumerState();
      }
      const retainedBeforeAppend = currentStoreStats.retained;
      const appendOperation = history.append(toPersistableEventEnvelope(event));
      if (currentStoreStats.retained === retainedBeforeAppend) {
        currentStoreStats = {
          ...currentStoreStats,
          retained: retainedBeforeAppend + 1,
          totalAppended: currentStoreStats.totalAppended + 1,
          warningActive:
            retainedBeforeAppend + 1 > currentStoreStats.warningThreshold
        };
        if (panelVisible) {
          eventCount.textContent = String(currentStoreStats.retained);
          eventCount.setAttribute(
            "aria-label",
            `${currentStoreStats.retained} captured events`
          );
          renderEventVolumeNotice(currentStoreStats);
          renderTimelineDisplayState();
        }
      }
      appendOperation.receive(
        () => undefined,
        (error) => {
          timelineState.pendingCommitVisibility.delete(event.id);
          reportHistoryError(error);
          history.stats().receive(
            (stats) => {
              currentStoreStats = stats;
              if (panelVisible) {
                eventCount.textContent = String(stats.retained);
                eventCount.setAttribute("aria-label", `${stats.retained} captured events`);
                renderEventVolumeNotice(stats);
              }
            },
            reportHistoryError
          );
        }
      );
      controller.setStatus("capturing");
      if (
        panelVisible &&
        activeView === "timeline" &&
        timelineState.windowOffset === 0 &&
        timelineState.followLatest
      ) {
        renderActiveViewFromAppend({ preservePaneState: true, passiveStoreUpdate: true });
      }
    },

    applyTopologySyncFrame(frame) {
      const topologyResult = topologyProjection.applySyncFrame(frame);
      if (topologyResult.resetConsumerState) {
        resetTopologyProjectionConsumerState();
      }
      if (topologyResult.accepted && panelVisible && activeView === "topology") {
        renderTopology();
      }
    },

    clearEvents() {
      cancelDeferredTopologyItemRendering();
      selectedPinned = false;
      selectedEventId = null;
      selectedTimelineEvent = null;
      timelineState.detailOpen = false;
      draftRenderVersion += 1;
      resetCommandLifecycleWindow();
      commandSearchTextCache.keys.clear();
      topologySelection = { key: "page", kind: "page" };
      topologyExpandAllItems = false;
      renderedTopologyStructureKey = null;
      topologyRenderedNodes.clear();
      topologyNodeSelections.clear();
      topologyCollapsedKeys.clear();
      topologyExpandedEvidence.clear();
      topologyEvidenceLimits.clear();
      topologyProjection.clear();
      liveReinjectionTargets.clear();
      liveClientConnections.clear();
      sourceEventConnectionEpochs.clear();
      draft = null;
      draftSurface = null;
      draftEditing = false;
      draftJsonText = null;
      draftJsonError = null;
      draftResultEventId = null;
      reinjectionMessage = null;
      resetTimelineRenderLimit();
      timelineState.pendingCommitVisibility.clear();
      resetCommandListWindows();
      forceNextStoreRender = true;
      history.clear().receive(() => undefined, reportHistoryError);
    },

    setBridge(nextBridge) {
      bridge = nextBridge;
      bridgeReady = isBridgeReadyStatus(panelState.status);
      renderActiveView({ preservePaneState: true });
    },

    setVisible(visible) {
      if (panelVisible === visible) {
        return;
      }
      panelVisible = visible;
      if (!visible) {
        cancelDeferredTopologyItemRendering();
        timelineState.queryVersion += 1;
        timelineState.latestQueryGeneration += 1;
        timelineState.latestQueryDirty = timelineState.latestQueryInFlight;
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
      trackAnalytics({ name: "panel_view" });
      renderActiveView({ preservePaneState: true });
    },

    dispose() {
      cancelDeferredTopologyItemRendering();
      cancelScheduledStoreRender();
      cancelAppendRenderBudgetReset();
      feed.removeEventListener("scroll", handleTimelineScroll);
      topologyInspector.dispose();
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

  history.subscribe((change, stats) => {
    currentStoreStats = stats;

    if (change.type === "init") {
      history.queryEvents().receive(
        (result) => {
          clearCommandContext();
          topologyProjection.replaceHistory(result.events);
          liveReinjectionTargets.clear();
          liveClientConnections.clear();
          sourceEventConnectionEpochs.clear();
          for (const event of result.events) {
            rememberCommandContextEvent(event);
            rememberLiveReinjectionTarget(event);
          }
          renderActiveViewFromStoreUpdate({
            preservePaneState: true,
            passiveStoreUpdate: true
          });
        },
        reportHistoryError
      );
    } else if (change.type === "append" || change.type === "append-batch") {
      const appendedEvents = change.type === "append" ? [change.event] : change.events;
      for (const event of appendedEvents) {
        const wasCapturedBeforeCommit = timelineState.pendingCommitVisibility.has(event.id);
        const wasVisibleBeforeCommit =
          timelineState.pendingCommitVisibility.get(event.id) === true;
        timelineState.pendingCommitVisibility.delete(event.id);
        if (!wasCapturedBeforeCommit) {
          noteTimelineNewerEvent(event);
        }
        rememberTimelineLiveEvent(event);
        rememberCommandContextEvent(event);
        const currentTopologyPage = topologyProjection.ingestHistory(event);
        if (currentTopologyPage) {
          rememberLiveReinjectionTarget(event);
        }
        const shouldAnchorTimelineWindow =
          timelineState.windowOffset > 0 ||
          timelineState.viewMode === "frozen";
        if (
          shouldAnchorTimelineWindow &&
          !wasVisibleBeforeCommit &&
          matchesEventFilters(event, filterState)
        ) {
          timelineState.windowOffset += 1;
          timelineState.historyAnchor = timelineState.windowOffset % TIMELINE_WINDOW_SIZE;
        } else if (timelineState.windowOffset === 0) {
          timelineState.historyAnchor = 0;
        }
      }
    } else {
      cancelScheduledStoreRender();
      immediateAppendRenderCount = 0;
      timelineState.events = [];
      clearCommandContext();
      topologyProjection.replaceHistory([]);
      liveReinjectionTargets.clear();
      liveClientConnections.clear();
      sourceEventConnectionEpochs.clear();
    }

    if (!panelVisible) {
      return;
    }

    eventCount.textContent = String(stats.retained);
    eventCount.setAttribute("aria-label", `${stats.retained} captured events`);
    renderEventVolumeNotice(stats);
    renderTimelineDisplayState();

    if (change.type === "init") {
      return;
    }
    if (change.type === "append" || change.type === "append-batch") {
      renderActiveViewFromAppend({ preservePaneState: true, passiveStoreUpdate: true });
      return;
    }
    renderActiveViewFromStoreUpdate({ preservePaneState: true, passiveStoreUpdate: true });
  });

  return controller;

  function appendDraftSection(
    parent: HTMLElement,
    selectedEvent: LightstreamerEventEnvelope,
    currentDraft: ReinjectionDraft | null,
    surface: "timeline" | "command" = "timeline"
  ): void {
    const section = document.createElement("section");
    section.className = "replay-card draft-editor";
    section.setAttribute("aria-busy", String(reinjectionPending));
    section.append(createTextElement("h3", "detail-section-heading", "Replay"));

    const availableDraft = currentDraft ?? createReplayDraftFromEvent(selectedEvent);
    const executionTarget = availableDraft
      ? preferredDraftExecutionTarget(availableDraft)
      : "captured-listener";
    const sourceReplay = availableDraft ? createSourceReplayDraft(availableDraft) : null;
    const sourceValidation = validatePanelDraftTarget(sourceReplay, executionTarget);
    const editValidation = validateEditableDraft(availableDraft);
    const targetStatus = draftTargetStatus(availableDraft, executionTarget);

    const activateDraft = (editing: boolean): ReinjectionDraft | null => {
      if (!availableDraft) {
        return null;
      }
      if (!currentDraft) {
        draft = availableDraft;
        draftSurface = surface === "command" ? "command-replay" : "timeline";
        draftResultEventId = null;
        draftEditing = editing;
        draftJsonText = formatDraftJson(availableDraft);
        draftJsonError = null;
        reinjectionMessage = null;
        if (surface === "command") {
          commandStateView.selectedUpdateEventId = selectedEvent.id;
          commandStateView.detailOpen = true;
        } else {
          selectedEventId = selectedEvent.id;
          selectedPinned = true;
        }
      }
      draftExecutionTarget = executionTarget;
      return draft ?? availableDraft;
    };

    const actionBar = document.createElement("div");
    actionBar.className = "replay-action-bar";
    const reinjectButton = document.createElement("button");
    reinjectButton.className = "reinject-button replay-source-button";
    reinjectButton.type = "button";
    reinjectButton.textContent = reinjectionPending ? "Re-injecting…" : "Re-inject";
    reinjectButton.disabled = !sourceValidation.valid || reinjectionPending;
    if (!sourceValidation.valid) {
      reinjectButton.title = validationMessage(sourceValidation.errors);
    }
    reinjectButton.addEventListener("click", () => {
      const activeDraft = activateDraft(false);
      if (!activeDraft) {
        return;
      }
      void executeCurrentDraft(
        createSourceReplayDraft(activeDraft),
        executionTarget,
        "source"
      );
    });

    const mutateButton = document.createElement("button");
    mutateButton.className = "mutate-inject-button";
    mutateButton.type = "button";
    mutateButton.textContent = "Mutate & re-inject…";
    mutateButton.disabled =
      !editValidation.valid || !targetStatus.live || reinjectionPending;
    mutateButton.setAttribute("aria-expanded", String(draftEditing));
    if (!editValidation.valid || !targetStatus.live) {
      mutateButton.title = validationMessage([
        ...editValidation.errors,
        ...(targetStatus.error ? [targetStatus.error] : [])
      ]);
    }
    mutateButton.addEventListener("click", () => {
      const activeDraft = activateDraft(true);
      if (!activeDraft) {
        return;
      }
      draftEditing = true;
      draftJsonText = draftJsonText ?? formatDraftJson(activeDraft);
      draftJsonError = null;
      reinjectionMessage = null;
      renderDraftSurface(activeDraft, true);
    });
    actionBar.append(reinjectButton, mutateButton);
    section.append(
      createDraftTargetStatus(availableDraft, executionTarget),
      actionBar
    );

    if (currentDraft) {
      draftExecutionTarget = executionTarget;
      section.append(createSourceContext(currentDraft));
    }

    if (reinjectionPending) {
      const pending = createTextElement(
        "p",
        "reinjection-message pending",
        executionTarget === "captured-listener"
          ? "Delivering locally to every current Subscription listener…"
          : "Replaying locally through the captured page WebSocket…"
      );
      pending.setAttribute("role", "status");
      pending.setAttribute("aria-live", "polite");
      section.append(pending);
    } else if (reinjectionMessage) {
      section.append(createReinjectionMessageElement(reinjectionMessage));
    }

    if (currentDraft && draftEditing) {
      section.append(createDraftControls(currentDraft));
    }
    parent.append(section);
  }

  function createDraftControls(currentDraft: ReinjectionDraft): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "draft-controls";
    controls.setAttribute("aria-label", "Edit staged replay draft");

    const validation = validatePanelDraftTarget(
      currentDraft,
      draftExecutionTarget
    );
    const editorHeader = document.createElement("div");
    editorHeader.className = "draft-editor-header";
    editorHeader.append(
      createTextElement(
        "h4",
        "draft-editor-heading",
        "Mutate & re-inject"
      ),
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
      ? "Re-injecting…"
      : "Re-inject edited update";
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
      renderDraftSurface(draft, true);
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
      renderDraftSurface(draft ?? currentDraft, true);
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
    changedPreview.textContent = formatJsonForDisplay(currentDraft.changedFields);
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
      const nextValidation = validatePanelDraftTarget(
        result.draft,
        draftExecutionTarget
      );
      jsonError.textContent = nextValidation.valid
        ? ""
        : validationMessage(nextValidation.errors);
      jsonError.hidden = nextValidation.valid;
      changedPreview.textContent = formatJsonForDisplay(result.draft.changedFields);
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
        renderDraftSurface(draft ?? currentDraft, true);
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
      originalCell.append(
        createPrimitiveValue(original, {
          showPreview: !expandedJson,
          previewLabel: "Original captured JSON"
        })
      );
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
        applyStructuredInputDraftUpdate(
          updateDraftKey(draft ?? currentDraft, keyInput.value),
          fieldName,
          keyInput,
          injectButton,
          structuredError
        );
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
        numberInput.removeAttribute("aria-invalid");
        applyStructuredInputDraftUpdate(
          updateDraftField(draft ?? currentDraft, fieldName, nextValue),
          fieldName,
          numberInput,
          injectButton,
          structuredError
        );
      });
      editor.append(numberInput);
      return editor;
    }

    const textInput = document.createElement("textarea");
    textInput.className = "structured-field-input structured-string-input";
    const parsedJson = parseStructuredJsonString(value);
    const formattedValue = parsedJson ? JSON.stringify(parsedJson, null, 2) : value;
    if (layout === "expanded-json") {
      textInput.classList.add("structured-json-input");
    } else if (parsedJson) {
      textInput.classList.add("structured-json-inline-input");
    }
    textInput.dataset.fieldName = fieldName;
    textInput.rows =
      layout === "expanded-json"
        ? 10
        : parsedJson
          ? Math.min(8, Math.max(3, formattedValue.split("\n").length))
          : 1;
    textInput.value = formattedValue;
    textInput.disabled = reinjectionPending;
    textInput.spellcheck = false;
    textInput.setAttribute("aria-label", `Draft field ${fieldName}`);
    textInput.addEventListener("input", () => {
      applyStructuredInputDraftUpdate(
        updateDraftField(draft ?? currentDraft, fieldName, textInput.value),
        fieldName,
        textInput,
        injectButton,
        structuredError
      );
    });
    editor.append(textInput);
    return editor;
  }

  function applyStructuredDraftUpdate(nextDraft: ReinjectionDraft): void {
    draft = nextDraft;
    draftJsonText = formatDraftJson(nextDraft);
    draftJsonError = null;
    reinjectionMessage = null;
    renderDraftSurface(nextDraft, true);
  }

  function applyStructuredInputDraftUpdate(
    nextDraft: ReinjectionDraft,
    fieldName: string,
    input: HTMLInputElement | HTMLTextAreaElement,
    injectButton: HTMLButtonElement,
    structuredError: HTMLElement
  ): void {
    draft = nextDraft;
    draftJsonText = formatDraftJson(nextDraft);
    draftJsonError = null;
    reinjectionMessage = null;

    const controls = input.closest<HTMLElement>(".draft-controls");
    if (!controls || !input.isConnected) {
      renderDraftSurface(nextDraft, true);
      return;
    }

    controls
      .closest<HTMLElement>(".replay-card")
      ?.querySelector<HTMLElement>(".reinjection-message")
      ?.remove();

    const validation = validatePanelDraftTarget(
      nextDraft,
      draftExecutionTarget
    );
    injectButton.disabled = !validation.valid || reinjectionPending;
    injectButton.dataset.validationValid = String(validation.valid);
    structuredError.textContent = "";
    structuredError.hidden = true;

    const validationError = Array.from(controls.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.classList.contains("draft-validation-error") &&
        !child.classList.contains("draft-structured-error")
    );
    if (validation.valid) {
      validationError?.remove();
    } else if (validationError) {
      validationError.textContent = validationMessage(validation.errors);
    } else {
      const nextValidationError = createTextElement(
        "p",
        "draft-validation-error",
        validationMessage(validation.errors)
      );
      nextValidationError.setAttribute("role", "alert");
      controls.querySelector(".draft-editor-header")?.after(nextValidationError);
    }

    const dirtyCount = controls.querySelector<HTMLElement>(".draft-dirty-count");
    if (dirtyCount) {
      dirtyCount.textContent = `${draftChangeCount(nextDraft)} changed`;
    }

    const draftTextarea = controls.querySelector<HTMLTextAreaElement>(".draft-json");
    if (draftTextarea) {
      draftTextarea.value = draftJsonText;
    }
    const draftJsonErrorElement = controls.querySelector<HTMLElement>(".draft-json-error");
    if (draftJsonErrorElement) {
      draftJsonErrorElement.textContent = "";
      draftJsonErrorElement.hidden = true;
    }

    const changedPreview = controls.querySelector<HTMLElement>(
      ".draft-changed-fields-preview"
    );
    if (changedPreview) {
      changedPreview.textContent = formatJsonForDisplay(nextDraft.changedFields);
    }
    const changedFieldsMarker = controls.querySelector<HTMLElement>(
      ".draft-derived-fields .detail-section-marker"
    );
    if (changedFieldsMarker) {
      changedFieldsMarker.textContent =
        `${Object.keys(nextDraft.changedFields).length} fields`;
    }

    const original =
      fieldName === "command"
        ? nextDraft.sourceCommand
        : fieldName === "key"
          ? nextDraft.sourceKey
          : nextDraft.sourceFields[fieldName];
    const current =
      fieldName === "command"
        ? nextDraft.command
        : fieldName === "key"
          ? nextDraft.key
          : nextDraft.fields[fieldName];
    const fieldChanged = !Object.is(original, current);
    const jsonSummary = structuredJsonSummary(current);
    const currentSummary =
      jsonSummary ??
      (typeof current === "string"
        ? `Text · ${formatTextSize(current.length)}`
        : structuredJsonSummary(original) ?? "Large string");
    const fieldRows = Array.from(
      controls.querySelectorAll<HTMLTableRowElement>(
        ".draft-field-diff tr[data-field-name]"
      )
    ).filter((row) => row.dataset.fieldName === fieldName);
    for (const row of fieldRows) {
      row.dataset.state = fieldChanged ? "changed" : "unchanged";
      const fieldNameCell = row.querySelector<HTMLElement>(".draft-field-name");
      const changedIndicator = fieldNameCell?.querySelector<HTMLElement>(
        ".draft-field-changed-indicator"
      );
      if (fieldChanged && fieldNameCell && !changedIndicator) {
        const nextChangedIndicator = createTextElement(
          "span",
          "draft-field-changed-indicator",
          "Δ"
        );
        nextChangedIndicator.title = "Changed from captured value";
        nextChangedIndicator.setAttribute("aria-label", "changed");
        fieldNameCell.append(nextChangedIndicator);
      } else if (!fieldChanged) {
        changedIndicator?.remove();
      }

      if (row.dataset.layout === "json-summary") {
        const draftSummary = row.querySelector<HTMLElement>(
          ".draft-field-value .draft-primitive-value > span"
        );
        if (draftSummary) {
          draftSummary.className = jsonSummary
            ? "draft-primitive-json-summary"
            : "draft-primitive-raw";
          draftSummary.textContent = currentSummary;
        }
      }
      const editorSummary = row.querySelector<HTMLElement>(
        ".structured-json-editor-summary"
      );
      if (editorSummary) {
        editorSummary.textContent = currentSummary;
      }
    }
  }

  function draftPageExecutionTarget(
    currentDraft: ReinjectionDraft
  ): "captured-listener" | "captured-wire" {
    return currentDraft.captureSource === "wire" ? "captured-wire" : "captured-listener";
  }

  function preferredDraftExecutionTarget(
    currentDraft: ReinjectionDraft
  ): ReinjectionExecutionTarget {
    return draftPageExecutionTarget(currentDraft);
  }

  async function executeCurrentDraft(
    currentDraft: ReinjectionDraft,
    executionTarget: ReinjectionExecutionTarget,
    actionMode: "source" | "edited"
  ): Promise<void> {
    const activeBridge = bridgeReady ? bridge : null;
    const validation = validatePanelDraftTarget(
      currentDraft,
      executionTarget
    );
    if (!validation.valid || !activeBridge) {
      return;
    }

    reinjectionPending = true;
    reinjectionMessage = null;
    renderDraftSurface(currentDraft, true);

    const analyticsSurface = currentAnalyticsReplaySurface();
    const analyticsEdited = actionMode === "edited";
    recordAnalyticsReplayAttempt(analyticsSurface, executionTarget, analyticsEdited);
    const result = await activeBridge.reinjectDraft(currentDraft, executionTarget);
    reinjectionPending = false;
    recordAnalyticsReplayResult(
      analyticsSurface,
      executionTarget,
      analyticsEdited,
      result
    );

    if (result.ok && result.status === "success") {
      reinjectionMessage = {
        kind: "success",
        text:
          executionTarget === "captured-wire"
            ? `${actionMode === "source" ? "Source update" : "Edited update"} delivered locally through the captured page WebSocket. No server was contacted.`
            : `${actionMode === "source" ? "Source update" : "Edited update"} delivered to every current listener on the target Subscription. The inspected page was reached.`
      };
      renderDraftSurface(currentDraft, true);
      appendAndSelectSyntheticDraftResult(currentDraft, result, executionTarget);
      return;
    }

    reinjectionMessage = createFailureMessage(result);
    renderDraftSurface(currentDraft, true);
  }

  function appendAndSelectSyntheticDraftResult(
    currentDraft: ReinjectionDraft,
    result: ReinjectionResult,
    executionTarget: ReinjectionExecutionTarget
  ): void {
    const syntheticEvent = createSyntheticEventFromDraft(
      currentDraft,
      result,
      executionTarget
    );
    history.append(syntheticEvent).receive(
      (appendedEvent) => {
        draftResultEventId = appendedEvent.id;
        if (draftSurface === "command-replay") {
          commandStateView.selectedKey = commandSelectionForSyntheticDraft(currentDraft);
          commandStateView.selectedUpdateEventId = appendedEvent.id;
          commandStateView.detailOpen = true;
          renderCommandState({ preservePaneState: true });
          return;
        }
        selectedEventId = appendedEvent.id;
        selectedTimelineEvent = appendedEvent;
        selectedPinned = true;
        timelineState.detailOpen = true;
        timelineState.windowOffset = 0;
        timelineState.historyAnchor = 0;
        timelineState.selectionNeedsFilterReconciliation = false;
        // Reveal the explicit action result once, then pin it against passive live traffic.
        timelineState.followLatest = true;
        renderFeed({}, () => {
          if (selectedEventId === appendedEvent.id) {
            timelineState.followLatest = false;
          }
        });
      },
      reportHistoryError
    );
  }

  function commandSelectionForSyntheticDraft(currentDraft: ReinjectionDraft): CommandRowSelection {
    return {
      subscriptionId: currentDraft.target.subscriptionId ?? "",
      itemId: commandDraftItemId(currentDraft),
      key: currentDraft.key ?? currentDraft.sourceKey ?? "",
      status: currentDraft.command === "DELETE" ? "deleted" : "active"
    };
  }

  function commandDraftItemId(currentDraft: ReinjectionDraft): string {
    const matchingItem = flattenCommandItems(
      commandStateProjections.snapshot("local-effective")
    ).find(
      ({ subscription, item }) =>
        subscription.subscriptionId === currentDraft.target.subscriptionId &&
        item.itemName === (currentDraft.item.name ?? null) &&
        item.itemPosition === (currentDraft.item.position ?? null)
    );
    return matchingItem?.item.itemId ?? commandStateView.selectedItem?.itemId ?? "";
  }

  function renderDraftSurface(currentDraft: ReinjectionDraft, preservePaneState = false): void {
    if (draftSurface === "command-replay") {
      renderCommandState({ preservePaneState });
      return;
    }
    renderEventForDraft(currentDraft, preservePaneState);
  }

  function renderEventForDraft(currentDraft: ReinjectionDraft, preservePaneState = false): void {
    const renderVersion = ++draftRenderVersion;
    const detailEventId =
      selectedEventId === draftResultEventId && draftResultEventId
        ? draftResultEventId
        : currentDraft.sourceEventId;
    const renderSelectedDraftEvent = (event: LightstreamerEventEnvelope | null) => {
      if (
        renderVersion !== draftRenderVersion ||
        !event ||
        event.id !== detailEventId ||
        selectedEventId !== detailEventId ||
        !timelineState.detailOpen ||
        !panelVisible
      ) {
        return;
      }
      selectedTimelineEvent = event;
      renderDetail(event, { preservePaneState });
    };
    const cached =
      (selectedTimelineEvent?.id === detailEventId ? selectedTimelineEvent : null) ??
      timelineState.events.find((event) => event.id === detailEventId) ??
      null;
    if (cached) {
      renderSelectedDraftEvent(cached);
      return;
    }
    history
      .getEventById(detailEventId)
      .receive(renderSelectedDraftEvent, reportHistoryError);
  }

  function clearDraftForSelection(nextEventId: string | null): void {
    if (detailCopyEventId !== nextEventId) {
      detailCopyEventId = null;
      detailCopyMessage = null;
    }
    if (!draft) {
      draftSurface = null;
      draftResultEventId = null;
      return;
    }
    if (draft.sourceEventId === nextEventId || draftResultEventId === nextEventId) {
      return;
    }
    draftRenderVersion += 1;
    draft = null;
    draftSurface = null;
    draftResultEventId = null;
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
    controlScroll:
      activeInPane && isTextSelectionControl(activeElement)
        ? {
            top: activeElement.scrollTop,
            left: activeElement.scrollLeft
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
    if (nextFocus && state.controlScroll) {
      nextFocus.scrollTop = state.controlScroll.top;
      nextFocus.scrollLeft = state.controlScroll.left;
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
  const matchingEvents = [...events]
    .reverse()
    .filter(
      (event) =>
        event.kind === "item-update" &&
        event.subscription?.id === subscription.subscriptionId &&
        event.subscription?.mode === "COMMAND" &&
        resolveCommandItemIdentity(event.subscription, event.item).itemId === item.itemId
    );
  const listenerEvent = matchingEvents.find((event) => event.listener?.id);
  const sourceEvent = listenerEvent ?? matchingEvents[0];
  const fields = Array.from(
    new Set([
      ...(sourceEvent?.subscription?.fields ?? subscription.subscription.fields ?? []),
      ...matchingEvents.flatMap((event) => Object.keys(event.update?.fields ?? {}))
    ])
  );

  return {
    subscriptionId: subscription.subscriptionId,
    mode: subscription.mode,
    listenerId: listenerEvent?.listener?.id ?? null,
    captureSource:
      listenerEvent?.captureSource ?? sourceEvent?.captureSource ?? (listenerEvent ? "listener" : "wire"),
    itemName: item.itemName,
    itemPosition: item.itemPosition,
    fields
  };
}

function createCommandDraftContext(
  context: CommandItemContext,
  sourceListenerId: string | null
): HTMLElement {
  const element = document.createElement("div");
  element.className = "command-draft-context";
  const rows: Array<[string, string]> = [
    ["Subscription", context.subscriptionId ?? "-"],
    ["Source listener", sourceListenerId ?? "-"],
    [
      "Execution",
      context.captureSource === "wire"
        ? "Inspected page stream"
        : "Subscription listeners"
    ],
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

  if (selection?.status !== "diagnostic") {
    const transitionedRow = [...matchingRows, ...matchingDeleted].find((row) =>
      commandSelectionMatchesStableKey(selection, row)
    );
    if (transitionedRow) {
      return commandSelectionForKey(transitionedRow);
    }
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

function commandSelectionMatchesStableKey(
  selection: CommandSelection,
  row: CommandKeyRow
): boolean {
  return (
    selection !== null &&
    selection.status !== "diagnostic" &&
    selection.subscriptionId === row.subscriptionId &&
    selection.itemId === row.itemId &&
    selection.key === row.key
  );
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

function commandDetailIdentity(
  subscription: CommandSubscriptionGroup,
  item: CommandItemGroup,
  selection: CommandSelection,
  updateEventId: string | null
): string {
  return JSON.stringify([
    subscription.subscriptionId,
    item.itemId,
    commandSelectionIdentity(selection) ?? "",
    updateEventId ?? ""
  ]);
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

function analyticsReplayTarget(
  executionTarget: ReinjectionExecutionTarget
): AnalyticsReplayTarget {
  return executionTarget === "captured-wire" ? "wire" : "listener";
}

function analyticsReplayOutcome(result: ReinjectionResult): AnalyticsReplayOutcome {
  switch (result.status) {
    case "success":
      return "success";
    case "stale-target":
      return "stale_target";
    case "listener-error":
      return "listener_error";
    case "wire-error":
      return "wire_error";
    case "bridge-error":
      return "bridge_error";
  }
}

function createFailureMessage(result: ReinjectionResult): ReinjectionMessage {
  if (result.status === "stale-target") {
    return {
      kind: "error",
      text: "The inspected page can no longer receive this replay. Capture a fresh update for this subscription, then try again."
    };
  }

  if (result.status === "bridge-error") {
    return {
      kind: "error",
      text: "The inspected page did not acknowledge reinjection. Reload the inspected page, capture a fresh update, and try again.",
      detail: result.error
    };
  }

  return {
    kind: "error",
    text: "Reinjection failed before a synthetic event was appended. Review the delivery error and adjust the draft.",
    detail: result.error
  };
}

function createCommandFailureMessage(result: ReinjectionResult): ReinjectionMessage {
  if (result.status === "stale-target") {
    return {
      kind: "error",
      text: "The inspected page can no longer receive this update. Capture a fresh update for this subscription, then create the synthetic update again."
    };
  }

  if (result.status === "bridge-error") {
    return {
      kind: "error",
      text: "The inspected page did not acknowledge the COMMAND reinjection. Reload the inspected page, capture a fresh update, and try again.",
      detail: result.error
    };
  }

  return {
    kind: "error",
    text: "Synthetic COMMAND update was not appended. Review the delivery error and adjust the draft.",
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
): "Listener" | "Wire" | "Listener replay" | "Wire replay" {
  if (event.synthetic || event.source === "synthetic") {
    return event.raw?.executionTarget === "captured-wire"
      ? "Wire replay"
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
  previewLabel?: string;
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
    const parsed = createParsedJsonDisclosure(value, options.previewLabel);
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

function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

type DetailSectionOptions = {
  open?: boolean;
  summary?: string | number | null;
  changedFieldNames?: readonly string[];
};

function createChangedFieldsSummary(className: string, fieldNames: readonly string[]): HTMLElement {
  const summary = document.createElement("p");
  summary.className = className;
  if (fieldNames.length === 0) {
    summary.textContent = "No fields changed in this update.";
    return summary;
  }
  summary.append(createTextElement("span", `${className}-label`, "Changed in this update:"));
  for (const fieldName of fieldNames) {
    summary.append(createTextElement("code", `${className}-name`, fieldName));
  }
  return summary;
}

function expandStructuredJsonStrings(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    const parsed = parseStructuredJsonString(value);
    return parsed ? expandStructuredJsonStrings(parsed, seen) : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const expanded = value.map((entry) => expandStructuredJsonStrings(entry, seen));
    seen.delete(value);
    return expanded;
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const expanded = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandStructuredJsonStrings(entry, seen)])
    );
    seen.delete(value);
    return expanded;
  }
  return value;
}

function formatJsonForDisplay(value: unknown): string {
  return JSON.stringify(expandStructuredJsonStrings(value), null, 2) ?? String(value);
}

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
    if (options.changedFieldNames) {
      section.append(createChangedFieldsSummary("detail-changed-fields", options.changedFieldNames));
    }
    const pre = document.createElement("pre");
    pre.className = "detail-json";
    pre.textContent = formatJsonForDisplay(value);
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

function createReplayDraftFromEvent(
  event: LightstreamerEventEnvelope
): ReinjectionDraft | null {
  if (event.source !== "server" || event.synthetic) {
    return null;
  }
  const draft = createDraftFromEvent(event);
  return validateEditableDraft(draft).valid ? draft : null;
}

function createSourceContext(draft: ReinjectionDraft): HTMLElement {
  const context = document.createElement("details");
  context.className = "draft-source-context";
  const summary = document.createElement("summary");
  summary.className = "draft-source-summary";
  summary.append(
    createTextElement("span", "draft-source-summary-title", "Replay source"),
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
    case "subscription-frequency":
      code = "SF";
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
  if (event.synthetic || event.source === "synthetic") {
    return event.raw?.executionTarget === "captured-wire"
      ? "Synthetic update replayed locally through the captured page WebSocket"
      : "Synthetic update delivered to the target Subscription";
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
    event.raw?.executionTarget === "captured-wire"
  ) {
    return event.update?.isSnapshot ? "wire replay snapshot" : "wire replay live";
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
  if (errors.includes("Local Injection Target is stale.")) {
    return "The target Subscription has no current Item Update listeners. Capture a fresh update after a listener is attached.";
  }
  if (errors.includes("Captured wire target is stale.")) {
    return "The captured page stream belongs to a stale connection epoch. Capture a fresh wire update before replaying.";
  }
  if (errors.includes("Subscription listener bridge is unavailable.")) {
    return "The Subscription listener bridge is unavailable. Reconnect or reload the inspected page, then capture a fresh update.";
  }
  if (errors.includes("Captured wire bridge is unavailable.")) {
    return "The captured page WebSocket bridge is unavailable. Reconnect or reload the inspected page, then capture a fresh update.";
  }
  if (
    errors.includes("Draft is not backed by a wire capture target.") ||
    errors.includes("Missing wire item position.")
  ) {
    return "This draft lacks the wire subscription context required for inspected-page stream replay. Capture a fresh complete update.";
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
    sourceListenerId: event.raw?.sourceListenerId ?? null,
    executionTarget: event.raw?.executionTarget ?? "captured-listener",
    deliveryPath: event.raw?.deliveryPath ?? "captured-listener",
    deliveredToPage: event.raw?.deliveredToPage ?? true,
    serverContacted: event.raw?.serverContacted ?? false,
    editedFields: event.raw?.editedFields ?? event.update?.changedFields ?? {}
  };
}

function createPanelAnalytics(): WorkbenchAnalytics {
  try {
    return createGoogleAnalytics({
      measurementId: import.meta.env.VITE_LSEW_GA_MEASUREMENT_ID ?? "",
      apiSecret: import.meta.env.VITE_LSEW_GA_API_SECRET ?? "",
      extensionVersion: chrome.runtime.getManifest().version,
      storage: window.localStorage,
      fetcher: globalThis.fetch.bind(globalThis)
    });
  } catch {
    return createDisabledAnalytics();
  }
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
    const history = await createPanelEventHistory();
    panel = renderPanel(root, undefined, {
      history,
      visible,
      analytics: createPanelAnalytics()
    });
    const bridge = connectPanelBridge({
      onStatusChange: panel.setStatus,
      onCaptureMessage: panel.appendCaptureMessage,
      onTopologySyncFrame: panel.applyTopologySyncFrame
    });
    panel.setBridge(bridge);
  }
}

async function createPanelEventHistory(): Promise<EventHistory> {
  try {
    return await createIndexedDbEventHistory({
      sessionId: chrome.devtools?.inspectedWindow?.tabId ?? Date.now(),
      reset: true,
      clearOnClose: true
    });
  } catch (error) {
    console.error("Falling back to in-memory event storage.", error);
    return createInMemoryEventHistory();
  }
}

if (document.documentElement.dataset.storeListingHarness !== "true") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void bootPanel(), { once: true });
  } else {
    void bootPanel();
  }
}
