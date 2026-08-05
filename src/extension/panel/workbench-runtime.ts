import { type CaptureMessage, type CaptureStatus, type TopologySyncFrame } from "../../bridge/messages";
import { createCommandStateProjections, type CommandState } from "../../core/command-state";
import {
  toPersistableEventEnvelope,
  type LightstreamerEventEnvelope
} from "../../core/event-envelope";
import { createEventNormalizer, type EventNormalizer } from "../../core/event-normalizer";
import {
  createEventHistory,
  createInMemoryEventHistory,
  type EventHistory
} from "../../core/event-history";
import { createEventSearchText, matchesEventFilters, type EventFilterState } from "../../core/event-filter";
import { type EventStore, type EventStoreChange, type EventStoreStats } from "../../core/event-store";
import {
  createDisabledAnalytics,
  eventCountBucket,
  type AnalyticsConsent,
  type WorkbenchAnalytics,
  type WorkbenchAnalyticsEvent
} from "../analytics";
import { createTopologyProjection } from "./topology-projection";
import {
  createTopologyStructuredSnapshot,
  serializeTopologySnapshot,
  topologySensitiveCategoryCounts,
  topologySnapshotFilename,
  TOPOLOGY_SENSITIVE_CATEGORIES,
  type TopologySensitiveCategory,
  type TopologyStructuredSnapshot
} from "./topology-export";
import {
  topologyClientNodePresentation,
  topologyItemNodePresentation,
  topologyListenerNodePresentation,
  topologyPageNodePresentation,
  topologySessionNodePresentation,
  topologySubscriptionNodePresentation,
  findTopologySelection,
  type TopologySelection,
  type TopologySelectionTarget
} from "./topology-view-model";
import {
  type TopologyConnectionState,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";

export const DEFAULT_EVIDENCE_WINDOW_SIZE = 60;

export type WorkbenchCaptureSnapshot = Readonly<{
  operation: "RUNNING" | "IDLE" | "STOPPED";
  coverage: "USEFUL" | "LIMITED" | "UNAVAILABLE";
  detail?: string;
  recovery?: string;
}>;

export type WorkbenchEvidence = Readonly<{
  id: string;
  time: string;
  source: "SERVER" | "LOCAL" | "RUNTIME" | "WORKBENCH";
  phase: "SNAPSHOT" | "LIVE" | "END OF SNAPSHOT" | "—";
  command: string | null;
  kind: string;
  object: string;
  summary: string;
  raw: LightstreamerEventEnvelope;
}>;

export type WorkbenchStructuralScopeKind =
  | "page"
  | "client"
  | "session"
  | "subscription"
  | "item"
  | "listener";

export type WorkbenchScopeLifecycle =
  | "active"
  | "inactive"
  | "recovering"
  | "stalled"
  | "disconnected"
  | "retired"
  | "unknown";

export type WorkbenchScopeNode = Readonly<{
  id: string;
  kind: WorkbenchStructuralScopeKind;
  label: string;
  detail?: string;
  parentId: string | null;
  depth: number;
  tone: string;
  lifecycle: WorkbenchScopeLifecycle;
  retired: boolean;
  selected: boolean;
}>;

export type WorkbenchStorageSnapshot = Readonly<{
  mode: "indexeddb" | "memory";
  reason?: string;
}>;

export type WorkbenchRetentionSnapshot = Readonly<{
  retained: number;
  totalAppended: number;
  warningThreshold: number;
  warningActive: boolean;
  clearState: "idle" | "confirming" | "clearing" | "error";
  clearError?: string;
}>;

export type WorkbenchAnalyticsSnapshot = Readonly<{
  available: boolean;
  consent: AnalyticsConsent;
  pending: boolean;
  error?: string;
}>;

export type WorkbenchExportSnapshot = Readonly<{
  activeScopeId: string | null;
  redactions: readonly TopologySensitiveCategory[];
  sensitiveCounts: Readonly<Record<TopologySensitiveCategory, number>>;
  completeEvidence: boolean;
  document: Readonly<TopologyStructuredSnapshot> | null;
  json: string | null;
  filename: string | null;
}>;

export type WorkbenchContextSnapshot = Readonly<{
  kind: "evidence" | "runtime";
  title: string;
  fields: readonly (readonly [string, string])[];
}>;

export type WorkbenchCommandProjection = Readonly<{
  name: string;
  basis: string;
  rows: readonly (readonly [string, string])[];
}>;

export type WorkbenchDiagnostic = Readonly<{
  severity: "Information" | "Warning" | "Error";
  title: string;
  detail: string;
  recovery?: string;
}>;

export type WorkbenchEvidenceSnapshot = Readonly<{
  events: readonly WorkbenchEvidence[];
  loading: boolean;
  total: number;
  windowSize: number;
  mode: "live" | "frozen";
  newerCount: number;
  offset: number;
  visibleStart: number;
  visibleEnd: number;
  hasOlder: boolean;
  hasNewer: boolean;
  filters: Readonly<EventFilterState>;
  find: string;
  findState: Readonly<{
    query: string;
    matchCount: number;
    currentIndex: number;
    currentEventId: string | null;
  }>;
  focusedEventId: string | null;
  selectedEventId: string | null;
  hiddenSelection: Readonly<{
    eventId: string;
    message: "Selected event outside current results";
    canReveal: true;
    canClear: true;
  }> | null;
}>;

export type WorkbenchEvidenceCopySnapshot = Readonly<{
  state: "idle" | "preparing" | "ready" | "error";
  eventCount: number;
  text: string | null;
  error?: string;
}>;

/** The immutable, renderer-neutral investigation state for one panel session. */
export type WorkbenchSnapshot = Readonly<{
  version: number;
  visible: boolean;
  theme: "auto" | "dark" | "light";
  captureStatus: CaptureStatus;
  capture: WorkbenchCaptureSnapshot;
  scopeId: string | null;
  scope: Readonly<{
    label: string;
    status: string;
    nodes: readonly WorkbenchScopeNode[];
    focusedNodeId: string | null;
    selection: Readonly<{
      id: string;
      kind: WorkbenchStructuralScopeKind;
      retired: boolean;
    }> | null;
    coverage: Readonly<{
      semantic: boolean;
      status: "USEFUL" | "LIMITED";
      detail: string;
    }>;
  }>;
  selectionEventId: string | null;
  selectedEvidence?: WorkbenchEvidence | null;
  contextId: string | null;
  context: WorkbenchContextSnapshot;
  commandProjections: Readonly<{
    observed: WorkbenchCommandProjection;
    localEffective: WorkbenchCommandProjection;
    authoritativeLimit: string;
  }>;
  diagnostics: readonly WorkbenchDiagnostic[];
  storage: WorkbenchStorageSnapshot;
  retention: WorkbenchRetentionSnapshot;
  analytics: WorkbenchAnalyticsSnapshot;
  export: WorkbenchExportSnapshot;
  evidenceCopy: WorkbenchEvidenceCopySnapshot;
  evidence: WorkbenchEvidenceSnapshot;
}>;

export type WorkbenchCommand =
  | { type: "set-visible"; visible: boolean }
  | { type: "set-theme"; theme: "auto" | "dark" | "light" }
  | { type: "set-capture-status"; status: CaptureStatus }
  | { type: "ingest-capture-message"; message: CaptureMessage }
  | { type: "apply-topology-sync-frame"; frame: TopologySyncFrame }
  | { type: "set-scope"; scopeId: string | null }
  | { type: "set-scope-focus"; scopeId: string | null }
  | { type: "set-storage-state"; storage: WorkbenchStorageSnapshot }
  | { type: "request-clear-history" }
  | { type: "cancel-clear-history" }
  | { type: "confirm-clear-history" }
  | { type: "set-analytics-consent"; consent: Exclude<AnalyticsConsent, "unknown"> }
  | { type: "set-export-redactions"; redactions: readonly TopologySensitiveCategory[] }
  | { type: "set-export-complete-evidence"; complete: boolean }
  | { type: "set-filters"; filters: EventFilterState }
  | { type: "clear-filters" }
  | { type: "reveal-selected-evidence" }
  | { type: "clear-evidence-selection" }
  | { type: "set-find"; value: string }
  | { type: "find-next" }
  | { type: "find-previous" }
  | { type: "clear-find" }
  | { type: "show-older-evidence" }
  | { type: "show-newer-evidence" }
  | { type: "show-oldest-evidence" }
  | { type: "show-newest-evidence" }
  | { type: "prepare-scoped-evidence-copy" }
  | { type: "clear-scoped-evidence-copy" }
  | { type: "select-evidence"; eventId: string | null }
  | { type: "focus-evidence"; eventId: string | null }
  | { type: "set-context"; contextId: string | null }
  | { type: "open-context" }
  | { type: "open-scope" }
  | { type: "open-diagnostics" }
  | { type: "open-raw-evidence"; eventId: string }
  | { type: "export-scope" }
  | { type: "open-actions" }
  | { type: "freeze-evidence" }
  | { type: "follow-live" }
  | { type: "refresh-evidence" };

/**
 * The only renderer-facing seam. It intentionally leaves scheduling, history
 * queries, hidden-panel consolidation, and immutable snapshot caching inside
 * the runtime implementation.
 */
export interface WorkbenchRuntime {
  getSnapshot(): WorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: WorkbenchCommand): void;
  dispose(): void;
}

export type WorkbenchRuntimeScheduler = {
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type WorkbenchRuntimeOptions = {
  history?: EventHistory;
  /** @deprecated Prefer the storage-independent history seam. */
  store?: EventStore;
  visible?: boolean;
  theme?: "auto" | "dark" | "light";
  captureStatus?: CaptureStatus;
  capture?: Partial<WorkbenchCaptureSnapshot>;
  storage?: WorkbenchStorageSnapshot;
  analytics?: WorkbenchAnalytics;
  normalizer?: EventNormalizer;
  windowSize?: number;
  scheduler?: WorkbenchRuntimeScheduler;
};

type EvidenceData = {
  events: readonly LightstreamerEventEnvelope[];
  total: number;
  offset: number;
};

const emptyEvidence: EvidenceData = Object.freeze({ events: Object.freeze([]), total: 0, offset: 0 });

export function createWorkbenchRuntime(options: WorkbenchRuntimeOptions = {}): WorkbenchRuntime {
  return new Runtime(options);
}

class Runtime implements WorkbenchRuntime {
  private readonly history: EventHistory;
  private readonly scheduler: WorkbenchRuntimeScheduler;
  private readonly windowSize: number;
  private readonly captureOverride: Partial<WorkbenchCaptureSnapshot>;
  private readonly normalizer: EventNormalizer;
  private readonly listeners = new Set<() => void>();
  private readonly commandStateProjections = createCommandStateProjections();
  private readonly topologyProjection = createTopologyProjection();
  private readonly analytics: WorkbenchAnalytics;
  private readonly unsubscribeHistory: () => void;
  private visible: boolean;
  private theme: "auto" | "dark" | "light";
  private captureStatus: CaptureStatus;
  private scopeId: string | null = "page";
  private scopeFocusedNodeId: string | null = "page";
  private selectionEventId: string | null = null;
  private selectedEventEnvelope: LightstreamerEventEnvelope | null = null;
  private focusedEventId: string | null = null;
  private selectionHiddenByFilter = false;
  private contextId: string | null = null;
  private filters: EventFilterState = {};
  private find = "";
  private findCurrentEventId: string | null = null;
  private mode: "live" | "frozen" = "live";
  private liveEvidence: EvidenceData = emptyEvidence;
  private frozenEvidence: EvidenceData | null = null;
  private evidenceLoading = false;
  private snapshot: WorkbenchSnapshot;
  private version = 0;
  private disposed = false;
  private queryGeneration = 0;
  private selectionLookupGeneration = 0;
  private frameHandle: unknown | null = null;
  private fallbackHandle: unknown | null = null;
  private hiddenDirty = false;
  private topologyCoverage: WorkbenchCaptureSnapshot["coverage"] | null = null;
  private storage: WorkbenchStorageSnapshot;
  private storeStats: EventStoreStats = {
    retained: 0,
    totalAppended: 0,
    warningThreshold: 10_000,
    warningActive: false
  };
  private clearState: WorkbenchRetentionSnapshot["clearState"] = "idle";
  private clearError: string | null = null;
  private clearedSelectionEventId: string | null = null;
  private analyticsConsent: AnalyticsConsent;
  private analyticsPending = false;
  private analyticsError: string | null = null;
  private analyticsDetected = false;
  private analyticsSearchUsed = false;
  private analyticsCapturedEventCount = 0;
  private analyticsSummarySent = false;
  private exportRedactions = new Set<TopologySensitiveCategory>();
  private exportCompleteEvidence = false;
  private evidenceCopy: WorkbenchEvidenceCopySnapshot = Object.freeze({
    state: "idle",
    eventCount: 0,
    text: null
  });
  private evidenceCopyGeneration = 0;
  private preparedExport: {
    document: TopologyStructuredSnapshot;
    json: string;
    filename: string;
  } | null = null;

  constructor(options: WorkbenchRuntimeOptions) {
    this.history =
      options.history ?? (options.store ? createEventHistory(options.store) : createInMemoryEventHistory());
    this.scheduler = options.scheduler ?? browserScheduler();
    this.windowSize = normalizeWindowSize(options.windowSize);
    this.visible = options.visible ?? true;
    this.theme = options.theme ?? "auto";
    this.captureStatus = options.captureStatus ?? "idle";
    this.captureOverride = options.capture ?? {};
    this.normalizer = options.normalizer ?? createEventNormalizer();
    this.storage = options.storage ?? { mode: "indexeddb" };
    this.analytics = options.analytics ?? createDisabledAnalytics();
    this.analyticsConsent = this.analytics.getConsent();
    this.snapshot = this.createSnapshot();

    this.refreshEvidence("initial");
    this.unsubscribeHistory = this.history.subscribe((change, stats) =>
      this.handleHistoryChange(change, stats)
    );
    this.hydrateProjections();
    this.trackAnalytics({ name: "panel_view" });
  }

  readonly getSnapshot = (): WorkbenchSnapshot => {
    return this.snapshot;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch(command: WorkbenchCommand): void {
    if (this.disposed) {
      return;
    }

    switch (command.type) {
      case "set-visible":
        this.setVisible(command.visible);
        return;
      case "set-theme":
        this.theme = command.theme;
        this.publish();
        return;
      case "set-capture-status":
        this.captureStatus = command.status;
        this.publish();
        return;
      case "ingest-capture-message":
        this.ingestCaptureMessage(command.message);
        return;
      case "apply-topology-sync-frame":
        this.applyTopologySyncFrame(command.frame);
        return;
      case "set-scope":
        this.invalidateEvidenceCopy();
        this.scopeId = command.scopeId ?? "page";
        this.scopeFocusedNodeId = command.scopeId ?? "page";
        this.clearedSelectionEventId = null;
        this.preparedExport = null;
        this.refreshEvidence("scope");
        return;
      case "set-scope-focus":
        this.scopeFocusedNodeId = command.scopeId;
        this.publish();
        return;
      case "set-storage-state":
        this.storage = { ...command.storage };
        this.publish();
        return;
      case "request-clear-history":
        this.clearState = "confirming";
        this.clearError = null;
        this.publish();
        return;
      case "cancel-clear-history":
        this.clearState = "idle";
        this.clearError = null;
        this.publish();
        return;
      case "confirm-clear-history":
        this.clearHistory();
        return;
      case "set-analytics-consent":
        this.setAnalyticsConsent(command.consent);
        return;
      case "set-export-redactions":
        this.exportRedactions = new Set(
          command.redactions.filter((category) =>
            TOPOLOGY_SENSITIVE_CATEGORIES.includes(category)
          )
        );
        this.preparedExport = null;
        this.publish();
        return;
      case "set-export-complete-evidence":
        this.exportCompleteEvidence = command.complete;
        this.preparedExport = null;
        this.publish();
        return;
      case "set-filters":
        this.invalidateEvidenceCopy();
        this.filters = { ...command.filters };
        this.recordAnalyticsSearch(command.filters.query ?? "");
        this.refreshEvidence("filter");
        return;
      case "clear-filters":
        this.invalidateEvidenceCopy();
        this.filters = {};
        this.refreshEvidence("filter");
        return;
      case "reveal-selected-evidence":
        if (!this.selectionEventId || !this.selectionHiddenByFilter) return;
        this.filters = {};
        this.selectionHiddenByFilter = false;
        this.focusedEventId = this.selectionEventId;
        this.refreshEvidence("reveal-selection");
        return;
      case "clear-evidence-selection": {
        const selectedEventId = this.selectionEventId;
        this.selectionLookupGeneration += 1;
        this.selectionEventId = null;
        this.selectedEventEnvelope = null;
        this.selectionHiddenByFilter = false;
        if (
          selectedEventId &&
          (this.contextId === `context:${selectedEventId}` || this.contextId === `raw:${selectedEventId}`)
        ) {
          this.contextId = "context:scope";
        }
        this.publish();
        return;
      }
      case "set-find":
        this.find = command.value;
        this.reconcileFindCurrent();
        this.recordAnalyticsSearch(command.value);
        this.publish();
        return;
      case "find-next":
        this.navigateFind(1);
        return;
      case "find-previous":
        this.navigateFind(-1);
        return;
      case "clear-find":
        this.find = "";
        this.findCurrentEventId = null;
        this.publish();
        return;
      case "show-older-evidence":
        this.navigateEvidenceWindow("older");
        return;
      case "show-newer-evidence":
        this.navigateEvidenceWindow("newer");
        return;
      case "show-oldest-evidence":
        this.navigateEvidenceWindow("oldest");
        return;
      case "show-newest-evidence":
        this.navigateEvidenceWindow("newest");
        return;
      case "prepare-scoped-evidence-copy":
        this.prepareScopedEvidenceCopy();
        return;
      case "clear-scoped-evidence-copy":
        this.invalidateEvidenceCopy();
        this.publish();
        return;
      case "select-evidence":
        this.selectionEventId = command.eventId;
        this.focusedEventId = command.eventId;
        this.selectionHiddenByFilter = false;
        this.resolveSelectedEvent(command.eventId);
        if (command.eventId !== this.clearedSelectionEventId) {
          this.clearedSelectionEventId = null;
        }
        this.publish();
        return;
      case "focus-evidence":
        this.focusedEventId = command.eventId;
        this.selectionEventId = command.eventId;
        this.selectionHiddenByFilter = false;
        this.resolveSelectedEvent(command.eventId);
        if (command.eventId !== this.clearedSelectionEventId) {
          this.clearedSelectionEventId = null;
        }
        this.publish();
        return;
      case "set-context":
        this.contextId = command.contextId;
        this.publish();
        return;
      case "open-context":
        this.contextId = this.selectionEventId ? `context:${this.selectionEventId}` : "context:scope";
        this.publish();
        return;
      case "open-scope":
        this.contextId = "context:scope";
        this.publish();
        return;
      case "open-diagnostics":
        this.contextId = "context:diagnostics";
        this.publish();
        return;
      case "open-raw-evidence":
        this.selectionEventId = command.eventId;
        this.focusedEventId = command.eventId;
        this.resolveSelectedEvent(command.eventId, true);
        this.contextId = `raw:${command.eventId}`;
        this.publish();
        return;
      case "export-scope":
        this.contextId = "context:export";
        this.prepareExport();
        this.publish();
        return;
      case "open-actions":
        this.contextId = "context:actions";
        this.publish();
        return;
      case "freeze-evidence":
        this.mode = "frozen";
        this.frozenEvidence = this.liveEvidence;
        this.refreshEvidence("command");
        return;
      case "follow-live":
        this.mode = "live";
        this.frozenEvidence = null;
        this.refreshEvidence("command");
        return;
      case "refresh-evidence":
        this.refreshEvidence("command");
        return;
    }
  }

  private resolveSelectedEvent(
    eventId: string | null,
    reconcileFilterVisibility = false
  ): void {
    const generation = ++this.selectionLookupGeneration;
    if (!eventId) {
      this.selectedEventEnvelope = null;
      return;
    }
    const visible = this.displayedEvidence().events.find(({ id }) => id === eventId);
    if (visible) {
      this.selectedEventEnvelope = visible;
      if (reconcileFilterVisibility) this.reconcileSelectedEnvelopeFilterVisibility();
      return;
    }
    if (this.selectedEventEnvelope?.id === eventId) {
      if (reconcileFilterVisibility) this.reconcileSelectedEnvelopeFilterVisibility();
      return;
    }
    this.selectedEventEnvelope = null;
    if (reconcileFilterVisibility) this.selectionHiddenByFilter = false;
    let receiving = true;
    this.history.getEventById(eventId).receive(
      (event) => {
        if (
          this.disposed ||
          generation !== this.selectionLookupGeneration ||
          this.selectionEventId !== eventId
        ) return;
        this.selectedEventEnvelope = event;
        if (reconcileFilterVisibility) this.reconcileSelectedEnvelopeFilterVisibility();
        if (!receiving) this.publish();
      },
      () => undefined
    );
    receiving = false;
  }

  private reconcileSelectedEnvelopeFilterVisibility(): void {
    const selectedEvent = this.selectedEventEnvelope;
    if (!selectedEvent || selectedEvent.id !== this.selectionEventId) {
      this.selectionHiddenByFilter = false;
      return;
    }
    const scopeTarget = findTopologySelection(
      this.topologyProjection.snapshot(),
      this.scopeId ?? "page"
    );
    this.selectionHiddenByFilter = Boolean(
      scopeTarget &&
      eventMatchesScope(selectedEvent, scopeTarget) &&
      !matchesEventFilters(selectedEvent, this.filters)
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.flushAnalyticsSummary();
    this.disposed = true;
    this.cancelPassivePublication();
    this.unsubscribeHistory();
    this.listeners.clear();
  }

  private ingestCaptureMessage(message: CaptureMessage): void {
    const event = this.normalizer.normalize(message);
    this.captureStatus = "capturing";
    this.topologyProjection.ingestCapture(event);
    this.preparedExport = null;
    this.history.append(event).receive(
      () => undefined,
      () => {
        // Storage diagnostics are represented by the configured Capture state;
        // a failed append must never fabricate Evidence.
      }
    );
    // Capture arrival is a developer-visible state transition even when an
    // asynchronous history adapter has not committed its Evidence page yet.
    this.publish();
  }

  private applyTopologySyncFrame(frame: TopologySyncFrame): void {
    const result = this.topologyProjection.applySyncFrame(frame);
    this.preparedExport = null;
    this.topologyCoverage = frame.coverage.status === "partial" ? "LIMITED" : "USEFUL";
    if (!result.accepted) {
      this.topologyCoverage = "LIMITED";
    }
    this.publish();
  }

  private displayedEvidence(): EvidenceData {
    if (this.evidenceLoading) return emptyEvidence;
    return this.mode === "frozen" ? this.frozenEvidence ?? emptyEvidence : this.liveEvidence;
  }

  private findMatches(): readonly LightstreamerEventEnvelope[] {
    const query = this.find.trim().toLowerCase();
    if (!query) return [];
    return this.displayedEvidence().events.filter((event) =>
      createEvidenceFindText(event).includes(query)
    );
  }

  private reconcileFindCurrent(): void {
    const matches = this.findMatches();
    if (matches.length === 0) {
      this.findCurrentEventId = null;
      return;
    }
    if (!matches.some(({ id }) => id === this.findCurrentEventId)) {
      this.findCurrentEventId = matches[0]?.id ?? null;
    }
  }

  private navigateFind(direction: 1 | -1): void {
    const matches = this.findMatches();
    if (matches.length === 0) {
      this.findCurrentEventId = null;
      this.publish();
      return;
    }
    const current = matches.findIndex(({ id }) => id === this.findCurrentEventId);
    const base = current < 0 ? (direction > 0 ? -1 : 0) : current;
    const next = (base + direction + matches.length) % matches.length;
    this.findCurrentEventId = matches[next]?.id ?? null;
    this.publish();
  }

  private reconcileSelection(
    result: EvidenceData,
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility"
  ): void {
    if (!this.selectionEventId) {
      this.selectionHiddenByFilter = false;
      return;
    }
    const scopeTarget = findTopologySelection(
      this.topologyProjection.snapshot(),
      this.scopeId ?? "page"
    );
    const selectedEvent = this.selectedEventEnvelope;
    const selectedMatchesScope = Boolean(
      selectedEvent &&
      scopeTarget &&
      eventMatchesScope(selectedEvent, scopeTarget)
    );
    const hiddenByFilter = Boolean(
      selectedMatchesScope &&
      selectedEvent &&
      !matchesEventFilters(selectedEvent, this.filters)
    );
    if (hiddenByFilter) {
      this.selectionHiddenByFilter = true;
      if (source === "filter" && selectedEvent) {
        this.focusedEventId = nearestVisibleEventId(
          result.events,
          selectedEvent
        );
      }
      return;
    }
    this.selectionHiddenByFilter = false;
    const selectedStillMatches = selectedEvent
      ? selectedMatchesScope
      : result.total > this.windowSize || result.events.some(({ id }) => id === this.selectionEventId);
    if (selectedStillMatches) return;
    this.selectionEventId = null;
    this.focusedEventId = null;
    this.selectedEventEnvelope = null;
    if (this.contextId?.startsWith("context:") || this.contextId?.startsWith("raw:")) {
      this.contextId = null;
    }
  }

  private clearHistory(): void {
    if (this.clearState !== "confirming") {
      return;
    }
    this.clearState = "clearing";
    this.clearError = null;
    this.clearedSelectionEventId = this.selectionEventId;
    this.publish();
    this.history.clear().receive(
      () => {
        if (this.disposed) return;
        this.clearState = "idle";
        this.refreshEvidence("command");
      },
      (error) => {
        if (this.disposed) return;
        this.clearState = "error";
        this.clearError = errorMessage(error);
        this.publish();
      }
    );
  }

  private setAnalyticsConsent(consent: Exclude<AnalyticsConsent, "unknown">): void {
    if (this.analyticsPending) return;
    if (!this.analytics.available) {
      this.analyticsError = "Usage analytics is unavailable in this build. Nothing was sent.";
      this.publish();
      return;
    }
    this.analyticsPending = true;
    this.analyticsError = null;
    this.publish();
    void this.analytics
      .setConsent(consent)
      .then((updated) => {
        if (this.disposed) return;
        if (!updated) {
          this.analyticsError = "Usage analytics is unavailable in this build. Nothing was sent.";
          return;
        }
        this.analyticsConsent = consent;
        this.analyticsDetected = false;
        this.analyticsSearchUsed = false;
        this.analyticsCapturedEventCount = 0;
        this.analyticsSummarySent = false;
        if (consent === "granted") {
          this.trackAnalytics({ name: "analytics_enabled" });
          if (this.visible) this.trackAnalytics({ name: "panel_view" });
        }
      })
      .catch(() => {
        if (!this.disposed) {
          this.analyticsError = "Usage analytics could not be updated. Nothing was sent.";
        }
      })
      .finally(() => {
        if (this.disposed) return;
        this.analyticsPending = false;
        this.publish();
      });
  }

  private recordAnalyticsSearch(value: string): void {
    if (value.trim() === "" || this.analyticsSearchUsed) return;
    this.analyticsSearchUsed = true;
    this.trackAnalytics({ name: "search_used", view: "timeline" });
  }

  private trackAnalytics(event: WorkbenchAnalyticsEvent): void {
    if (!this.analytics.available || this.analyticsConsent !== "granted") return;
    void this.analytics.track(event).catch(() => undefined);
  }

  private flushAnalyticsSummary(): void {
    if (this.analyticsSummarySent || this.analyticsConsent !== "granted") return;
    this.analyticsSummarySent = true;
    this.trackAnalytics({
      name: "session_summary",
      eventCountBucket: eventCountBucket(this.analyticsCapturedEventCount),
      commandViewUsed: false,
      searchUsed: this.analyticsSearchUsed,
      replayUsed: false
    });
  }

  private prepareExport(): void {
    const topology = this.topologyProjection.snapshot();
    const scopedTopology = topologyStateForScope(topology, this.scopeId);
    const document = createTopologyStructuredSnapshot(
      scopedTopology,
      this.topologyProjection.status(),
      {
        retainedEventCount: this.storeStats.retained,
        completeEvidence: this.exportCompleteEvidence,
        redact: this.exportRedactions
      }
    );
    this.preparedExport = {
      document,
      json: serializeTopologySnapshot(document),
      filename: topologySnapshotFilename(document, "json")
    };
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.visible = visible;
    if (!visible) {
      this.cancelPassivePublication();
      this.publish();
      return;
    }

    this.hiddenDirty = false;
    this.trackAnalytics({ name: "panel_view" });
    this.refreshEvidence("visibility");
  }

  private handleHistoryChange(change: EventStoreChange, stats: EventStoreStats): void {
    if (this.disposed || change.type === "init") {
      this.storeStats = stats;
      return;
    }
    this.storeStats = stats;
    this.preparedExport = null;
    if (change.type === "clear") {
      this.commandStateProjections.clear();
      this.topologyProjection.clear();
    } else {
      const events = change.type === "append" ? [change.event] : change.events;
      this.analyticsCapturedEventCount += events.length;
      if (!this.analyticsDetected && events.length > 0) {
        this.analyticsDetected = true;
        this.trackAnalytics({ name: "lightstreamer_detected" });
      }
      for (const event of events) {
        this.commandStateProjections.apply(event);
        this.topologyProjection.ingestHistory(event);
      }
    }
    if (!this.visible) {
      this.hiddenDirty = true;
      return;
    }
    this.schedulePassivePublication();
  }

  private schedulePassivePublication(): void {
    if (this.frameHandle !== null || this.fallbackHandle !== null) {
      return;
    }
    this.frameHandle = this.scheduler.requestFrame(() => {
      this.frameHandle = null;
      if (this.fallbackHandle !== null) {
        this.scheduler.clearTimeout(this.fallbackHandle);
        this.fallbackHandle = null;
      }
      this.refreshEvidence("passive");
    });
    this.fallbackHandle = this.scheduler.setTimeout(() => {
      this.fallbackHandle = null;
      if (this.frameHandle !== null) {
        this.scheduler.cancelFrame(this.frameHandle);
        this.frameHandle = null;
      }
      this.refreshEvidence("passive");
    }, 32);
  }

  private cancelPassivePublication(): void {
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.fallbackHandle !== null) {
      this.scheduler.clearTimeout(this.fallbackHandle);
      this.fallbackHandle = null;
    }
  }

  private navigateEvidenceWindow(
    direction: "older" | "newer" | "oldest" | "newest"
  ): void {
    const displayed = this.displayedEvidence();
    const total = this.liveEvidence.total;
    const visibleEnd = Math.max(0, displayed.total - displayed.offset);
    const currentOffset = Math.max(0, total - visibleEnd);
    const oldestOffset = Math.max(0, total - Math.min(total, this.windowSize));
    const offset =
      direction === "older"
        ? Math.min(oldestOffset, currentOffset + this.windowSize)
        : direction === "newer"
          ? Math.max(0, currentOffset - this.windowSize)
          : direction === "oldest"
            ? oldestOffset
            : 0;
    if (offset === currentOffset && this.mode === "frozen") return;
    this.mode = "frozen";
    this.refreshEvidence("navigation", offset);
  }

  private invalidateEvidenceCopy(): void {
    this.evidenceCopyGeneration += 1;
    this.evidenceCopy = Object.freeze({ state: "idle", eventCount: 0, text: null });
  }

  private prepareScopedEvidenceCopy(): void {
    const generation = ++this.evidenceCopyGeneration;
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const filters = combineScopeAndUserFilters(eventFiltersForScope(target), this.filters);
    const scope = this.scopeSnapshot();
    const scopeId = this.scopeId ?? "page";
    const filterSnapshot = Object.freeze({ ...this.filters });
    this.evidenceCopy = Object.freeze({ state: "preparing", eventCount: 0, text: null });
    this.publish();
    this.history.queryEvents({ filters, order: "asc" }).receive(
      (result) => {
        if (this.disposed || generation !== this.evidenceCopyGeneration) return;
        const document = {
          format: "lightstreamer-workbench/scoped-evidence-copy/v1",
          scope: { id: scopeId, label: scope.label },
          filters: filterSnapshot,
          count: result.total,
          events: result.events.map(toPersistableEventEnvelope)
        };
        this.evidenceCopy = Object.freeze({
          state: "ready",
          eventCount: result.total,
          text: JSON.stringify(document, null, 2)
        });
        this.publish();
      },
      (error) => {
        if (this.disposed || generation !== this.evidenceCopyGeneration) return;
        this.evidenceCopy = Object.freeze({
          state: "error",
          eventCount: 0,
          text: null,
          error: errorMessage(error)
        });
        this.publish();
      }
    );
  }

  private refreshEvidence(
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility",
    offset = 0
  ): void {
    this.reconcileScopeIdentity();
    const generation = ++this.queryGeneration;
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const filters = combineScopeAndUserFilters(eventFiltersForScope(target), this.filters);
    const changesEvidenceIdentity =
      source === "scope" ||
      source === "filter" ||
      source === "reveal-selection";
    let completedSynchronously = false;
    this.history
      .queryEvents({
        filters,
        limit: this.windowSize,
        offset,
        order: "asc"
      })
      .receive(
        (result) => {
          completedSynchronously = true;
          if (this.disposed || generation !== this.queryGeneration) {
            return;
          }
          this.evidenceLoading = false;
          this.liveEvidence = freezeEvidence(
            result.events,
            result.total,
            offset
          );
          if (
            this.mode === "frozen" &&
            source !== "passive" &&
            source !== "visibility"
          ) {
            this.frozenEvidence = this.liveEvidence;
          }
          const displayed = this.displayedEvidence();
          if (this.clearedSelectionEventId !== this.selectionEventId) {
            this.reconcileSelection(displayed, source);
          }
          this.reconcileFindCurrent();
          if (source === "initial") {
            this.snapshot = this.createSnapshot();
            return;
          }
          if (!this.visible) {
            this.hiddenDirty = true;
            return;
          }
          this.publish();
        },
        () => {
          completedSynchronously = true;
          if (this.disposed || generation !== this.queryGeneration) return;
          if (changesEvidenceIdentity || this.evidenceLoading) {
            this.evidenceLoading = false;
            this.liveEvidence = emptyEvidence;
            if (this.mode === "frozen") this.frozenEvidence = emptyEvidence;
            if (this.visible) this.publish();
            else this.hiddenDirty = true;
          }
        }
      );
    if (!completedSynchronously && source !== "initial" && source !== "passive") {
      if (changesEvidenceIdentity) this.evidenceLoading = true;
      this.publish();
    }
  }

  private hydrateProjections(): void {
    this.history.queryEvents().receive(
      (result) => {
        if (this.disposed) {
          return;
        }
        this.commandStateProjections.clear();
        this.topologyProjection.replaceHistory(result.events);
        for (const event of result.events) {
          this.commandStateProjections.apply(event);
        }
        // Hydration is passive. The initial constructor snapshot can be replaced
        // without notification; later asynchronous hydration emits one update.
        if (this.version === 0) {
          this.snapshot = this.createSnapshot();
        } else if (this.visible) {
          this.publish();
        } else {
          this.hiddenDirty = true;
        }
      },
      () => undefined
    );
  }

  private reconcileScopeIdentity(): void {
    if (this.scopeId === "page") return;
    const nodes = topologyScopeNodes(
      this.topologyProjection.snapshot(),
      this.scopeId,
      this.captureStatus
    );
    if (nodes.some(({ id }) => id === this.scopeId)) return;
    this.scopeId = "page";
    this.scopeFocusedNodeId = "page";
    this.preparedExport = null;
    this.invalidateEvidenceCopy();
  }

  private publish(): void {
    if (this.disposed) {
      return;
    }
    this.reconcileScopeIdentity();
    this.version += 1;
    this.snapshot = this.createSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private createSnapshot(): WorkbenchSnapshot {
    const evidence = this.displayedEvidence();
    const visibleEnd = evidence.events.length > 0
      ? Math.max(0, evidence.total - evidence.offset)
      : 0;
    const visibleStart = evidence.events.length > 0
      ? Math.max(1, visibleEnd - evidence.events.length + 1)
      : 0;
    const newerCount = !this.evidenceLoading && this.mode === "frozen"
      ? Math.max(0, this.liveEvidence.total - visibleEnd)
      : 0;
    const findMatches = this.findMatches();
    const findIndex = findMatches.findIndex(({ id }) => id === this.findCurrentEventId);
    return Object.freeze({
      version: this.version,
      visible: this.visible,
      theme: this.theme,
      captureStatus: this.captureStatus,
      capture: this.captureSnapshot(),
      scopeId: this.scopeId,
      scope: this.scopeSnapshot(),
      selectionEventId: this.selectionEventId,
      selectedEvidence:
        this.selectedEventEnvelope?.id === this.selectionEventId
          ? toWorkbenchEvidence(this.selectedEventEnvelope)
          : null,
      contextId: this.contextId,
      context: this.contextSnapshot(evidence.events),
      commandProjections: this.commandProjectionSnapshot(),
      diagnostics: this.diagnosticSnapshot(),
      storage: Object.freeze({ ...this.storage }),
      retention: this.retentionSnapshot(),
      analytics: Object.freeze({
        available: this.analytics.available,
        consent: this.analyticsConsent,
        pending: this.analyticsPending,
        ...(this.analyticsError ? { error: this.analyticsError } : {})
      }),
      export: this.exportSnapshot(),
      evidenceCopy: this.evidenceCopy,
      evidence: Object.freeze({
        events: Object.freeze(evidence.events.map(toWorkbenchEvidence)),
        loading: this.evidenceLoading,
        total: this.evidenceLoading ? evidence.total : this.liveEvidence.total,
        windowSize: this.windowSize,
        mode: this.mode,
        newerCount,
        offset: newerCount,
        visibleStart,
        visibleEnd,
        hasOlder: visibleStart > 1,
        hasNewer: newerCount > 0,
        filters: Object.freeze({ ...this.filters }),
        find: this.find,
        findState: Object.freeze({
          query: this.find,
          matchCount: findMatches.length,
          currentIndex: findIndex,
          currentEventId: findIndex >= 0 ? findMatches[findIndex]?.id ?? null : null
        }),
        focusedEventId: this.focusedEventId,
        selectedEventId: this.selectionEventId,
        hiddenSelection:
          this.selectionHiddenByFilter && this.selectionEventId
            ? Object.freeze({
                eventId: this.selectionEventId,
                message: "Selected event outside current results" as const,
                canReveal: true as const,
                canClear: true as const
              })
            : null
      })
    });
  }

  private captureSnapshot(): WorkbenchCaptureSnapshot {
    const operation =
      this.captureStatus === "capturing"
        ? "RUNNING"
        : this.captureStatus === "bridge disconnected"
          ? "STOPPED"
          : "IDLE";
    return Object.freeze({
      operation: this.captureOverride.operation ?? operation,
      coverage: this.captureOverride.coverage ?? this.topologyCoverage ?? "USEFUL",
      ...(this.captureOverride.detail ? { detail: this.captureOverride.detail } : {}),
      ...(this.captureOverride.recovery ? { recovery: this.captureOverride.recovery } : {})
    });
  }

  private scopeSnapshot(): WorkbenchSnapshot["scope"] {
    const state = this.topologyProjection.snapshot();
    const projectionStatus = this.topologyProjection.status();
    const nodes = topologyScopeNodes(state, this.scopeId, this.captureStatus);
    const selected = nodes.find((node) => node.selected) ?? nodes[0];
    const limited = projectionStatus.coverage?.status === "partial";
    return Object.freeze({
      label: scopeBreadcrumb(nodes, selected),
      status: [
        selected ? scopeLifecycleLabel(selected.lifecycle) : "Unknown",
        selected?.detail,
        selected?.retired ? "Historical · read-only" : null
      ]
        .filter(Boolean)
        .join(" · "),
      nodes: Object.freeze(nodes),
      focusedNodeId: this.scopeFocusedNodeId,
      selection: selected
        ? Object.freeze({ id: selected.id, kind: selected.kind, retired: selected.retired })
        : null,
      coverage: Object.freeze({
        semantic: projectionStatus.semanticActive,
        status: limited ? "LIMITED" : "USEFUL",
        detail: projectionStatus.semanticActive
          ? limited
            ? "Partial semantic coverage; some runtime properties may be unavailable."
            : "Complete semantic coverage from the official Lightstreamer client API."
          : "Legacy capture coverage; unavailable runtime properties remain explicit."
      })
    });
  }

  private retentionSnapshot(): WorkbenchRetentionSnapshot {
    return Object.freeze({
      retained: this.storeStats.retained,
      totalAppended: this.storeStats.totalAppended,
      warningThreshold: this.storeStats.warningThreshold,
      warningActive: this.storeStats.warningActive,
      clearState: this.clearState,
      ...(this.clearError ? { clearError: this.clearError } : {})
    });
  }

  private exportSnapshot(): WorkbenchExportSnapshot {
    const state = topologyStateForScope(this.topologyProjection.snapshot(), this.scopeId);
    const redactions = TOPOLOGY_SENSITIVE_CATEGORIES.filter((category) =>
      this.exportRedactions.has(category)
    );
    return Object.freeze({
      activeScopeId: this.scopeId,
      redactions: Object.freeze(redactions),
      sensitiveCounts: Object.freeze(topologySensitiveCategoryCounts(state)),
      completeEvidence: this.exportCompleteEvidence,
      document: this.preparedExport?.document ?? null,
      json: this.preparedExport?.json ?? null,
      filename: this.preparedExport?.filename ?? null
    });
  }

  private contextSnapshot(events: readonly LightstreamerEventEnvelope[]): WorkbenchContextSnapshot {
    const selected =
      (this.selectedEventEnvelope?.id === this.selectionEventId
        ? this.selectedEventEnvelope
        : events.find((event) => event.id === this.selectionEventId)) ?? null;
    if (!selected) {
      const topology = this.topologyProjection.snapshot();
      const scope = this.scopeSnapshot();
      return runtimeObjectDossier(
        findTopologySelection(topology, this.scopeId ?? "page"),
        scope.label,
        scope.coverage,
        this.captureSnapshot(),
        events.length,
        this.liveEvidence.total
      );
    }
    return Object.freeze({
      kind: "evidence",
      title: `${selected.id} · ${humanizeKind(selected.kind)}`,
      fields: Object.freeze([
        ["Source", evidenceSource(selected)],
        ["Phase", evidencePhase(selected)],
        ["COMMAND operation", selected.update?.command ?? "—"],
        ["Evidence identity", selected.id],
        ["Runtime object", evidenceObject(selected)],
        ["Changed", evidenceSummary(selected)],
        ["Observation path", evidenceObservationPath(selected)],
        ["Evidence limitations", evidenceLimitations(selected)]
      ] as const)
    });
  }

  private commandProjectionSnapshot(): WorkbenchSnapshot["commandProjections"] {
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    return Object.freeze({
      observed: commandProjection(
        "Observed Server COMMAND State",
        "Captured Server Updates only",
        this.commandStateProjections.snapshot("observed-server"),
        target
      ),
      localEffective: commandProjection(
        "Local Effective COMMAND State",
        "Server Updates plus successfully delivered Local Injected Updates",
        this.commandStateProjections.snapshot("local-effective"),
        target
      ),
      authoritativeLimit: "Neither projection is Authoritative COMMAND State."
    });
  }

  private diagnosticSnapshot(): readonly WorkbenchDiagnostic[] {
    const capture = this.captureSnapshot();
    const diagnostics: WorkbenchDiagnostic[] = [];
    if (this.captureStatus === "bridge disconnected") {
      diagnostics.push({
        severity: "Error",
        title: "Capture disconnected",
        detail: "Workbench cannot observe new inspected-page activity. Retained Evidence remains readable.",
        recovery: "Reconnect the inspected page and DevTools panel"
      });
    }
    const topology = this.topologyProjection.snapshot();
    if (
      topology.clients.some(
        (client) =>
          client.normalizedStatus === "recovering" ||
          client.sessions.some((session) => session.normalizedStatus === "recovering")
      )
    ) {
      diagnostics.push({
        severity: "Warning",
        title: "Session recovering",
        detail: "The official client is attempting Session recovery. Evidence remains ordered, but current runtime availability may change."
      });
    }
    if (capture.coverage !== "USEFUL") {
      diagnostics.push({
        severity: capture.coverage === "UNAVAILABLE" ? "Error" : "Warning",
        title: `Coverage ${capture.coverage}`,
        detail:
          capture.detail ??
          "Some runtime properties are unavailable; Workbench will not infer values without evidence.",
        ...(capture.recovery ? { recovery: capture.recovery } : {})
      });
    }
    if (this.storage.mode === "memory") {
      diagnostics.push({
        severity: "Warning",
        title: "In-memory event history",
        detail: `${this.storage.reason ? `${this.storage.reason}. ` : ""}Evidence remains available only while this panel session stays open.`,
        recovery: "Restore IndexedDB availability and reopen DevTools"
      });
    }
    const scopeSelection = this.scopeSnapshot().selection;
    if (scopeSelection?.retired) {
      diagnostics.push({
        severity: "Information",
        title: "Retired Scope",
        detail: "This historical runtime object is read-only. Matching retained Evidence remains available."
      });
    }
    if (this.clearedSelectionEventId) {
      diagnostics.push({
        severity: "Information",
        title: "Selected Evidence cleared",
        detail: `Evidence ${this.clearedSelectionEventId} was deliberately removed from history; its selection identity is retained until you choose another Scope or Evidence row.`
      });
    }
    if (this.clearState === "error" && this.clearError) {
      diagnostics.push({
        severity: "Error",
        title: "History could not be cleared",
        detail: this.clearError,
        recovery: "Try clearing history again"
      });
    }
    if (this.analyticsError) {
      diagnostics.push({
        severity: "Warning",
        title: "Analytics preference unchanged",
        detail: this.analyticsError
      });
    }
    return Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic)));
  }
}

function runtimeObjectDossier(
  target: TopologySelectionTarget | null,
  title: string,
  topologyCoverage: WorkbenchSnapshot["scope"]["coverage"],
  capture: WorkbenchCaptureSnapshot,
  visibleEvidenceCount: number,
  matchingEvidenceCount: number
): WorkbenchContextSnapshot {
  const fields: Array<readonly [string, string]> = [];
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };

  if (!target) {
    add("Scope type", "Unknown");
    add("Identity", "Unknown");
  } else {
    switch (target.kind) {
      case "page":
        add("Scope type", "Page");
        add("Clients", target.state.clientCount);
        add("Active sessions", target.state.activeSessionCount);
        add("Historical sessions", target.state.historicalSessionCount);
        add("Subscriptions", target.state.subscriptionCount);
        add("Items", target.state.itemCount);
        add("Listeners", target.state.listenerCount);
        add("Observing since", dossierTimestamp(target.state.observingSince));
        break;
      case "client":
        add("Scope type", "Client");
        add("Client ID", target.client.id);
        add("Status", target.client.status);
        add("Normalized status", target.client.normalizedStatus);
        add("Current Session ID", target.client.sessionId);
        add("Server address", target.client.serverAddress);
        add("Adapter set", target.client.adapterSet);
        add("Library version", target.client.libraryVersion);
        add("Transport", target.client.transport);
        add("Active sessions", target.client.sessions.filter(({ active, historical }) => active && !historical).length);
        add("Historical sessions", target.client.sessions.filter(({ historical }) => historical).length);
        add("Waiting Subscriptions", target.client.waitingSubscriptions.length);
        break;
      case "session":
        add("Scope type", "Session");
        add("Session ID", target.session.id);
        add("Client ID", target.client.id);
        add("Status", target.session.normalizedStatus);
        add("Client status", target.session.status);
        add("Active", yesNo(target.session.active));
        add("Historical", yesNo(target.session.historical));
        add("Transport", target.session.transport);
        add("Subscriptions", target.session.subscriptions.length);
        add("Connection epochs", target.session.connectionEpochCount);
        add("Recoveries", target.session.recoveryCount);
        break;
      case "subscription":
        addSubscriptionDossier(fields, target);
        break;
      case "item":
        add("Scope type", "Item");
        add("Item name", target.item.name);
        add("Position", target.item.position);
        add("Resolution", target.item.resolution);
        add("Subscription ID", target.subscription.id);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Historical", yesNo(target.subscription.historical));
        add("Snapshot phase", target.item.snapshotPhase);
        add("Updates", target.item.updateCount);
        add("Synthetic updates", target.item.syntheticUpdateCount);
        add("Deliveries", target.item.deliveryCount);
        add("Lost updates", target.item.lostUpdateCount);
        add("Listeners", target.item.listenerIds.length);
        add("Last COMMAND operation", target.item.lastCommand);
        add("Active COMMAND keys", target.item.activeCommandKeyCount);
        add("Deleted COMMAND keys", target.item.deletedCommandKeyCount);
        break;
      case "listener":
        add("Scope type", "Listener");
        add("Listener ID", target.listener.id);
        add("Subscription ID", target.subscription.id);
        add("Item", target.item?.name);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Active", yesNo(target.listener.active));
        add("Callbacks", dossierList(target.listener.callbacks));
        add("Registration count", target.listener.registrationCount);
        add("Metric owner", yesNo(target.listener.metricOwner));
        add("Deliveries", target.listener.deliveryCount);
        add("First delivery", dossierTimestamp(target.listener.firstDeliveryAt));
        add("Last delivery", dossierTimestamp(target.listener.lastDeliveryAt));
        break;
      case "generation":
      case "inferred-child":
        // COMMAND generations are Evidence attached to structural Scope, never Scope peers.
        add("Scope type", "Unknown");
        add("Identity", "Unknown");
        break;
    }
  }

  add("Capture coverage", capture.coverage);
  add(
    "Topology coverage",
    `${topologyCoverage.semantic ? "Semantic" : "Legacy"} · ${topologyCoverage.status}`
  );
  add("Visible Evidence", visibleEvidenceCount);
  add("Matching retained Evidence", matchingEvidenceCount);

  return Object.freeze({
    kind: "runtime",
    title,
    fields: Object.freeze(fields)
  });
}

function addSubscriptionDossier(
  fields: Array<readonly [string, string]>,
  target: Extract<TopologySelectionTarget, { kind: "subscription" }>
): void {
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };
  const subscription = target.subscription;
  add("Scope type", "Subscription");
  add("Subscription ID", subscription.id);
  add("Client ID", target.client?.id);
  add("Session ID", target.session?.id);
  add("Mode", subscription.mode);
  add("Status", subscription.statusLabel);
  add("Active", yesNo(subscription.active));
  add("Server established", yesNo(subscription.serverEstablished));
  add("Historical", yesNo(subscription.historical));
  add("Configured items", dossierList(subscription.configuredItems));
  add("Fields", dossierList(subscription.fields));
  add("Requested snapshot", subscription.requestedSnapshot);
  add("Requested buffer size", subscription.requestedBufferSize);
  add("Requested max frequency", subscription.requestedMaxFrequency);
  add("Real max frequency", subscription.realMaxFrequency);
  add("Data Adapter", subscription.dataAdapter);
  add("Selector", subscription.selector);
  add("Snapshot phase", dossierSnapshotPhases(subscription.items));
  add("Items", subscription.items.length);
  add("Listeners", subscription.listenerCount);
  add("Updates", subscription.updateCount);
  add("Synthetic updates", subscription.syntheticUpdateCount);
  add("Deliveries", subscription.deliveryCount);
  add("Lost updates", subscription.lostUpdateCount);
  add("COMMAND generations", subscription.commandGenerations.length);
}

function dossierValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Unknown";
  return String(value);
}

function dossierList(values: readonly unknown[] | undefined): string {
  return values && values.length > 0 ? values.map(String).join(", ") : "Unknown";
}

function dossierSnapshotPhases(items: readonly { snapshotPhase: string }[]): string {
  const phases = [...new Set(items.map(({ snapshotPhase }) => snapshotPhase))];
  return phases.length > 0 ? phases.join(", ") : "Unknown";
}

function dossierTimestamp(value: number | null): string {
  return value === null ? "Unknown" : new Date(value).toISOString();
}

function yesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}

function freezeEvidence(
  events: readonly LightstreamerEventEnvelope[],
  total: number,
  offset: number
): EvidenceData {
  return Object.freeze({ events: Object.freeze([...events]), total, offset });
}

function toWorkbenchEvidence(event: LightstreamerEventEnvelope): WorkbenchEvidence {
  return Object.freeze({
    id: event.id,
    time: new Date(event.timestamp).toISOString().slice(11, 23),
    source: evidenceSource(event),
    phase: evidencePhase(event),
    command: event.update?.command ?? null,
    kind: humanizeKind(event.kind),
    object: evidenceObject(event),
    summary: evidenceSummary(event),
    raw: event
  });
}

function evidenceSource(event: LightstreamerEventEnvelope): WorkbenchEvidence["source"] {
  if (event.synthetic || event.source === "synthetic") {
    return "LOCAL";
  }
  return event.kind === "item-update" ? "SERVER" : "RUNTIME";
}

function evidencePhase(event: LightstreamerEventEnvelope): WorkbenchEvidence["phase"] {
  if (event.kind === "end-of-snapshot") return "END OF SNAPSHOT";
  if (event.update?.isSnapshot) return "SNAPSHOT";
  return event.update ? "LIVE" : "—";
}

function evidenceObject(event: LightstreamerEventEnvelope): string {
  return event.item?.name ?? event.subscription?.id ?? event.client?.id ?? "Inspected page";
}

function evidenceSummary(event: LightstreamerEventEnvelope): string {
  const changed = Object.keys(event.update?.changedFields ?? {});
  if (changed.length > 0) return changed.join(", ");
  const fields = Object.keys(event.update?.fields ?? {});
  return fields.length > 0 ? `${fields.length} fields` : "No field detail";
}

function evidenceObservationPath(event: LightstreamerEventEnvelope): string {
  if (event.synthetic || event.source === "synthetic") {
    return "Local Injection › synthetic delivery";
  }
  return `Server › ${event.captureSource ? `${event.captureSource} Capture` : "Capture source Unknown"}`;
}

function evidenceLimitations(event: LightstreamerEventEnvelope): string {
  if (event.synthetic || event.source === "synthetic") {
    return "Local Effective observation only; it is not Server Evidence or Authoritative COMMAND State.";
  }
  if (event.topology?.coverage.status === "partial") {
    return `Partial semantic observation${event.topology.coverage.reason ? ` (${event.topology.coverage.reason})` : ""}; unavailable properties remain Unknown and this is not Authoritative COMMAND State.`;
  }
  return "Captured observation; unavailable properties remain Unknown and this is not Authoritative COMMAND State.";
}

function humanizeKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function createEvidenceFindText(event: LightstreamerEventEnvelope): string {
  return `${createEventSearchText(event)} ${humanizeKind(event.kind)}`.toLowerCase();
}

function topologyScopeNodes(
  state: TopologyState,
  selectedId: string | null,
  captureStatus: CaptureStatus
): WorkbenchScopeNode[] {
  const nodes: WorkbenchScopeNode[] = [];
  const add = (
    presentation: ReturnType<typeof topologyPageNodePresentation>,
    parentId: string | null,
    depth: number,
    lifecycle: WorkbenchScopeLifecycle
  ): string => {
    const id = presentation.selection.key;
    const kind = presentation.selection.kind;
    if (!isStructuralScopeKind(kind)) {
      throw new Error(`Non-structural ${kind} cannot enter Workbench Scope.`);
    }
    nodes.push(
      Object.freeze({
        id,
        kind,
        label: presentation.label,
        detail: presentation.meta,
        parentId,
        depth,
        tone: presentation.tone,
        lifecycle,
        retired: lifecycle === "retired",
        selected: id === selectedId
      })
    );
    return id;
  };

  const pageId = add(
    topologyPageNodePresentation(state),
    null,
    0,
    pageScopeLifecycle(state, captureStatus)
  );
  const addSubscription = (
    client: TopologyState["clients"][number] | null,
    session: TopologyState["clients"][number]["sessions"][number] | null,
    subscription: TopologyState["clients"][number]["sessions"][number]["subscriptions"][number],
    parentId: string,
    depth: number,
    inheritedLifecycle: WorkbenchScopeLifecycle
  ) => {
    const lifecycle = subscriptionScopeLifecycle(subscription, inheritedLifecycle);
    const subscriptionId = add(
      topologySubscriptionNodePresentation(client, session, subscription),
      parentId,
      depth,
      lifecycle
    );
    for (const item of subscription.items) {
      const itemId = add(
        topologyItemNodePresentation(client, session, subscription, item),
        subscriptionId,
        depth + 1,
        lifecycle
      );
      for (const listenerId of item.listenerIds) {
        add(
          topologyListenerNodePresentation(client, session, subscription, item, listenerId),
          itemId,
          depth + 2,
          listenerScopeLifecycle(subscription, listenerId, lifecycle)
        );
      }
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        add(
          topologyListenerNodePresentation(client, session, subscription, null, listenerId),
          subscriptionId,
          depth + 1,
          listenerScopeLifecycle(subscription, listenerId, lifecycle)
        );
      }
    }
  };

  for (const client of state.clients) {
    const clientLifecycle = connectionScopeLifecycle(client.normalizedStatus);
    const clientId = add(
      topologyClientNodePresentation(client),
      pageId,
      1,
      clientLifecycle
    );
    for (const subscription of client.waitingSubscriptions) {
      addSubscription(client, null, subscription, clientId, 2, clientLifecycle);
    }
    for (const session of client.sessions) {
      const sessionLifecycle = session.historical
        ? "retired"
        : connectionScopeLifecycle(session.normalizedStatus);
      const sessionId = add(
        topologySessionNodePresentation(client, session),
        clientId,
        2,
        sessionLifecycle
      );
      for (const subscription of session.subscriptions) {
        addSubscription(client, session, subscription, sessionId, 3, sessionLifecycle);
      }
    }
  }
  for (const subscription of state.unassignedSubscriptions) {
    addSubscription(null, null, subscription, pageId, 1, "unknown");
  }
  if (!nodes.some((node) => node.selected)) {
    return nodes.map((node, index) =>
      Object.freeze({ ...node, selected: index === 0 })
    );
  }
  return nodes;
}

function connectionScopeLifecycle(
  state: TopologyConnectionState
): WorkbenchScopeLifecycle {
  switch (state) {
    case "connected":
      return "active";
    case "recovering":
      return "recovering";
    case "stalled":
      return "stalled";
    case "disconnected":
      return "disconnected";
    case "connecting":
    case "unknown":
      return "unknown";
  }
}

function pageScopeLifecycle(
  state: TopologyState,
  captureStatus: CaptureStatus
): WorkbenchScopeLifecycle {
  if (captureStatus === "bridge disconnected") return "disconnected";
  const clientLifecycles = state.clients.map(({ normalizedStatus }) =>
    connectionScopeLifecycle(normalizedStatus)
  );
  for (const lifecycle of ["recovering", "stalled", "active"] as const) {
    if (clientLifecycles.includes(lifecycle)) return lifecycle;
  }
  if (
    clientLifecycles.length > 0 &&
    clientLifecycles.every((lifecycle) => lifecycle === "disconnected")
  ) {
    return "disconnected";
  }
  return captureStatus === "capturing" ? "active" : "unknown";
}

function subscriptionScopeLifecycle(
  subscription: TopologySubscription,
  inheritedLifecycle: WorkbenchScopeLifecycle
): WorkbenchScopeLifecycle {
  if (subscription.historical || inheritedLifecycle === "retired") return "retired";
  if (subscription.active || subscription.serverEstablished) return "active";
  if (
    subscription.statusLabel === "Inactive" ||
    subscription.statusLabel === "Failed" ||
    subscription.waitingForSession ||
    subscription.pendingSince !== null ||
    subscription.endedAt !== null
  ) {
    return "inactive";
  }
  return "unknown";
}

function listenerScopeLifecycle(
  subscription: TopologySubscription,
  listenerId: string,
  inheritedLifecycle: WorkbenchScopeLifecycle
): WorkbenchScopeLifecycle {
  if (inheritedLifecycle === "retired") return "retired";
  const listener = subscription.listeners.find(({ id }) => id === listenerId);
  if (!listener) return "unknown";
  return listener.active ? "active" : "inactive";
}

function scopeLifecycleLabel(lifecycle: WorkbenchScopeLifecycle): string {
  return `${lifecycle.slice(0, 1).toUpperCase()}${lifecycle.slice(1)}`;
}

function isStructuralScopeKind(
  kind: TopologySelection["kind"]
): kind is WorkbenchStructuralScopeKind {
  return (
    kind === "page" ||
    kind === "client" ||
    kind === "session" ||
    kind === "subscription" ||
    kind === "item" ||
    kind === "listener"
  );
}

function scopeBreadcrumb(
  nodes: readonly WorkbenchScopeNode[],
  selected: WorkbenchScopeNode | undefined
): string {
  if (!selected) return "Inspected page";
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labels: string[] = [];
  let current: WorkbenchScopeNode | undefined = selected;
  while (current) {
    labels.unshift(current.label);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return labels.join(" › ");
}

function eventFiltersForScope(target: TopologySelectionTarget | null): EventFilterState {
  if (!target || target.kind === "generation" || target.kind === "inferred-child") {
    return { clientId: "\u0000workbench:no-structural-scope" };
  }
  switch (target.kind) {
    case "page":
      return {};
    case "client":
      return { clientId: target.client.id };
    case "session":
      return { clientId: target.client.id, sessionId: target.session.id };
    case "subscription":
      return {
        ...(target.client ? { clientId: target.client.id } : { clientId: null }),
        ...(target.session ? { sessionId: target.session.id } : {}),
        subscriptionId: target.subscription.id
      };
    case "item":
      return {
        ...(target.client ? { clientId: target.client.id } : { clientId: null }),
        ...(target.session ? { sessionId: target.session.id } : {}),
        subscriptionId: target.subscription.id,
        item: target.item.name ?? undefined,
        itemPosition: target.item.position ?? undefined
      };
    case "listener":
      return {
        ...(target.client ? { clientId: target.client.id } : { clientId: null }),
        ...(target.session ? { sessionId: target.session.id } : {}),
        subscriptionId: target.subscription.id,
        ...(target.item
          ? {
              item: target.item.name ?? undefined,
              itemPosition: target.item.position ?? undefined
            }
          : {}),
        listenerId: target.listener.id
      };
  }
}

function combineScopeAndUserFilters(
  scope: EventFilterState,
  user: EventFilterState
): EventFilterState {
  for (const key of [
    "clientId",
    "sessionId",
    "subscriptionId",
    "item",
    "itemPosition",
    "listenerId"
  ] as const) {
    if (
      scope[key] !== undefined &&
      user[key] !== undefined &&
      scope[key] !== user[key]
    ) {
      return { ...user, clientId: "\u0000workbench:no-filter-intersection" };
    }
  }
  return { ...user, ...scope };
}

function eventMatchesScope(
  event: LightstreamerEventEnvelope,
  target: TopologySelectionTarget
): boolean {
  switch (target.kind) {
    case "page":
      return true;
    case "client":
      return event.client?.id === target.client.id;
    case "session":
      return (
        event.client?.id === target.client.id &&
        (target.session.id
          ? event.client?.sessionId === target.session.id
          : !event.client?.sessionId)
      );
    case "subscription":
      return eventMatchesSubscription(event, target);
    case "item":
      return (
        eventMatchesSubscription(event, target) &&
        event.item?.name === target.item.name &&
        event.item?.position === target.item.position
      );
    case "listener":
      return (
        eventMatchesSubscription(event, target) &&
        event.listener?.id === target.listener.id &&
        (!target.item ||
          (event.item?.name === target.item.name &&
            event.item?.position === target.item.position))
      );
    case "generation":
      return eventMatchesGeneration(event, target);
    case "inferred-child":
      return (
        eventMatchesGeneration(event, target) &&
        (!target.child.callback || event.raw?.callback === target.child.callback)
      );
  }
}

function eventMatchesSubscription(
  event: LightstreamerEventEnvelope,
  target: Extract<
    TopologySelectionTarget,
    { kind: "subscription" | "item" | "listener" | "generation" | "inferred-child" }
  >
): boolean {
  if (event.subscription?.id !== target.subscription.id) return false;
  if (target.client && event.client?.id !== target.client.id) return false;
  if (target.session?.id && event.client?.sessionId !== target.session.id) return false;
  return true;
}

function eventMatchesGeneration(
  event: LightstreamerEventEnvelope,
  target: Extract<TopologySelectionTarget, { kind: "generation" | "inferred-child" }>
): boolean {
  if (!eventMatchesSubscription(event, target)) return false;
  if (target.generation.key && event.update?.key !== target.generation.key) return false;
  const eventSequence = event.topology?.captureSequence;
  if (eventSequence !== undefined) {
    const nextGeneration = target.subscription.commandGenerations
      .filter(
        (generation) =>
          generation.itemId === target.generation.itemId &&
          generation.key === target.generation.key &&
          generation.captureSequence > target.generation.captureSequence
      )
      .sort((left, right) => left.captureSequence - right.captureSequence)[0];
    if (
      eventSequence < target.generation.captureSequence ||
      (nextGeneration && eventSequence >= nextGeneration.captureSequence)
    ) {
      return false;
    }
  }
  const item = target.subscription.items.find(({ id }) => id === target.generation.itemId);
  return !item ||
    (event.item?.name === item.name && event.item?.position === item.position);
}

function topologyStateForScope(
  state: TopologyState,
  scopeId: string | null
): TopologyState {
  const target = findTopologySelection(state, scopeId ?? "page");
  if (!target || target.kind === "page") return state;
  if (target.kind === "client") {
    return topologyStateFromBranches(state, [target.client], []);
  }
  if (target.kind === "session") {
    return topologyStateFromBranches(
      state,
      [{ ...target.client, waitingSubscriptions: [], sessions: [target.session] }],
      []
    );
  }

  let subscription = target.subscription;
  if (target.kind === "item") {
    const listenerIds = new Set(target.item.listenerIds);
    subscription = {
      ...subscription,
      items: [target.item],
      listenerIds: [...listenerIds],
      listeners: subscription.listeners.filter(({ id }) => listenerIds.has(id)),
      commandGenerations: subscription.commandGenerations.filter(
        ({ itemId }) => itemId === target.item.id
      )
    };
  } else if (target.kind === "listener") {
    subscription = {
      ...subscription,
      listenerIds: [target.listener.id],
      listeners: [target.listener],
      items: target.item
        ? [{ ...target.item, listenerIds: [target.listener.id] }]
        : []
    };
  } else if (target.kind === "generation" || target.kind === "inferred-child") {
    const generation =
      target.kind === "inferred-child"
        ? { ...target.generation, inferredChildren: [target.child] }
        : target.generation;
    subscription = {
      ...subscription,
      commandGenerations: [generation],
      items: subscription.items.filter(({ id }) => id === generation.itemId)
    };
  }

  if (!target.client) {
    return topologyStateFromBranches(state, [], [subscription]);
  }
  if (!target.session) {
    return topologyStateFromBranches(
      state,
      [{ ...target.client, waitingSubscriptions: [subscription], sessions: [] }],
      []
    );
  }
  return topologyStateFromBranches(
    state,
    [
      {
        ...target.client,
        waitingSubscriptions: [],
        sessions: [{ ...target.session, subscriptions: [subscription] }]
      }
    ],
    []
  );
}

function topologyStateFromBranches(
  source: TopologyState,
  clients: TopologyState["clients"],
  unassignedSubscriptions: TopologyState["unassignedSubscriptions"]
): TopologyState {
  const subscriptions = [
    ...clients.flatMap((client) => [
      ...client.waitingSubscriptions,
      ...client.sessions.flatMap((session) => session.subscriptions)
    ]),
    ...unassignedSubscriptions
  ];
  const sessions = clients.flatMap((client) => client.sessions);
  return {
    observingSince: source.observingSince,
    clients,
    unassignedSubscriptions,
    clientCount: clients.length,
    activeSessionCount: sessions.filter(({ active, historical }) => active && !historical).length,
    historicalSessionCount: sessions.filter(({ historical }) => historical).length,
    subscriptionCount: subscriptions.length,
    activeSubscriptionCount: subscriptions.filter(({ active, historical }) => active && !historical).length,
    serverEstablishedSubscriptionCount: subscriptions.filter(
      ({ serverEstablished, historical }) => serverEstablished && !historical
    ).length,
    itemCount: subscriptions.reduce((total, subscription) => total + subscription.items.length, 0),
    listenerCount: subscriptions.reduce(
      (total, subscription) => total + subscription.listeners.length,
      0
    )
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandProjection(
  name: string,
  basis: string,
  state: CommandState,
  target: TopologySelectionTarget | null
): WorkbenchCommandProjection {
  const rows = commandSubscriptionsForScope(state, target).flatMap((subscription) =>
    subscription.items.flatMap((item) =>
      item.activeRows.map((row) =>
        Object.freeze([
          `${subscription.subscriptionId} / ${item.itemName ?? item.itemId} / ${row.key}`,
          Object.entries(row.fields)
            .map(([field, value]) => `${field}=${String(value)}`)
            .join(", ")
        ] as const)
      )
    )
  );
  return Object.freeze({ name, basis, rows: Object.freeze(rows) });
}

function commandSubscriptionsForScope(
  state: CommandState,
  target: TopologySelectionTarget | null
): CommandState["subscriptions"] {
  if (!target) return [];
  if (target.kind === "page") return state.subscriptions;

  let subscriptionIds: Set<string>;
  let itemTarget: Extract<TopologySelectionTarget, { kind: "item" }>['item'] | null = null;
  switch (target.kind) {
    case "client":
      subscriptionIds = new Set([
        ...target.client.waitingSubscriptions.map(({ id }) => id),
        ...target.client.sessions.flatMap((session) =>
          session.subscriptions.map(({ id }) => id)
        )
      ]);
      break;
    case "session":
      subscriptionIds = new Set(target.session.subscriptions.map(({ id }) => id));
      break;
    case "subscription":
      subscriptionIds = new Set([target.subscription.id]);
      break;
    case "item":
      subscriptionIds = new Set([target.subscription.id]);
      itemTarget = target.item;
      break;
    case "listener":
      subscriptionIds = new Set([target.subscription.id]);
      itemTarget = target.item;
      break;
    case "generation":
    case "inferred-child":
      return [];
  }

  return state.subscriptions
    .filter(({ subscriptionId }) => subscriptionIds.has(subscriptionId))
    .map((subscription) =>
      itemTarget
        ? {
            ...subscription,
            items: subscription.items.filter((item) =>
              commandItemMatchesTopologyItem(item, itemTarget)
            )
          }
        : subscription
    );
}

function commandItemMatchesTopologyItem(
  commandItem: CommandState["subscriptions"][number]["items"][number],
  topologyItem: Extract<TopologySelectionTarget, { kind: "item" }>['item']
): boolean {
  if (topologyItem.name !== null && commandItem.itemName !== topologyItem.name) return false;
  if (
    topologyItem.position !== null &&
    commandItem.itemPosition !== topologyItem.position
  ) return false;
  return topologyItem.name !== null || topologyItem.position !== null
    ? true
    : commandItem.itemId === topologyItem.id;
}

function normalizeWindowSize(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_EVIDENCE_WINDOW_SIZE));
}

function nearestVisibleEventId(
  events: readonly LightstreamerEventEnvelope[],
  selected: LightstreamerEventEnvelope
): string | null {
  if (events.length === 0) return null;
  return (
    events.find((event) => event.timestamp >= selected.timestamp)?.id ??
    events.at(-1)?.id ??
    null
  );
}

function browserScheduler(): WorkbenchRuntimeScheduler {
  return {
    requestFrame(callback) {
      return globalThis.requestAnimationFrame(callback);
    },
    cancelFrame(handle) {
      globalThis.cancelAnimationFrame(handle as number);
    },
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  };
}
