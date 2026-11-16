import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  type WorkbenchCommand,
  type WorkbenchDiagnostic,
  type WorkbenchPanelRuntime,
  type WorkbenchRuntime,
  type WorkbenchSnapshot
} from "../workbench-runtime";
import {
  topologySnapshotFilename,
  type TopologySensitiveCategory
} from "../topology-export";
import {
  filterSummary,
  type TypedFilterValue
} from "../../../core/filter-algebra";
import type { EvidenceFilterActionDescriptor } from "../../../core/evidence-filter-actions";
import { renderTopologyHtmlReport } from "../topology-html-report";
import { UNAVAILABLE_ANALYTICS, type AnalyticsClient } from "../../analytics/client";
import { AgentAccessStatus } from "./agent-access";
import type { AgentConnection } from "../agent-connection";
import { ActivityTimeline } from "./activity-timeline";
import { NotificationsDocument } from "./notifications-document";
import { activityRangeLabel } from "./activity-timeline-format";
import type { TimelineEvidenceAnchor } from "./activity-timeline-events";
import type { FilterValueState } from "./filter-value-control";
import { filterValueMutations } from "./filter-workflow";
export { filterValueState, filterValueMutations } from "./filter-workflow";
import { ScopeSearch } from "./scope-search";
import { ScopeTree, type ScopeTreeActions } from "./scope-tree";
import { EvidenceCodes, EvidenceRow, type EvidencePayloadMode, type EvidenceRowActions } from "./evidence-row";
import { FindBar } from "./find-bar";
import { FilterRegion } from "./filter-region";
import { ContextPane } from "./context-pane";
import { WorkbenchFooter } from "./workbench-footer";
import {
  CONTEXT_MAX_SIZE, EVIDENCE_ROW_HEIGHT, SCOPE_FALLBACK_VIEWPORT_ROWS, SCOPE_MAX_WIDTH, SCOPE_MAX_WINDOW_SIZE,
  SCOPE_MIN_WIDTH, SCOPE_NODE_HEIGHT, SCOPE_WINDOW_OVERSCAN, clamp
} from "./workbench-geometry";
import { usePaneFocusRestoration, usePaneLayout, usePaneResizeLifecycle, useWorkspacePressure } from "./hooks/use-pane-layout";
import { useFindController, useFindInputFocus, useFindReveal } from "./hooks/use-find-controller";
import { useFilterComposer, useFilterDraftSync, useFilterInputFocus, useFilterSubmitResult } from "./hooks/use-filter-composer";
import { useDiagnosticDismissFocus, useDocumentFocusRestoration, useNotificationsFocusRestoration } from "./hooks/use-focus-restoration";
import { useSessionOperationResults } from "./hooks/use-session-operation-results";
import { useLatestHandlers, useStructurallyStable } from "./hooks/use-stable-value";

import "./workbench-panel.css";

const LazyLocalInjectionDocument = lazy(async () => {
  const module = await import("./local-injection-document");
  return { default: module.LocalInjectionDocument };
});
const LazyLocalInjectionScenarioDocument = lazy(async () => {
  const module = await import("./local-injection-scenario-document");
  return { default: module.LocalInjectionScenarioDocument };
});
const LazyServerInjectionDocument = lazy(async () => {
  const module = await import("./server-injection-document");
  return { default: module.ServerInjectionDocument };
});

export type WorkbenchPanelProps = { runtime: WorkbenchPanelRuntime; analytics?: AnalyticsClient; agentConnection?: AgentConnection };

const NO_NOTIFICATION_ENTRIES: WorkbenchSnapshot["notifications"]["entries"] = Object.freeze([]);

function dispatch(runtime: WorkbenchRuntime, command: WorkbenchCommand): void {
  runtime.dispatch(command);
}

function uppercase(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replaceAll("-", "_").toUpperCase();
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** React presentation for the Slice 1 read-only Scoped Evidence Workspace. */
export function WorkbenchPanel({ runtime, analytics = UNAVAILABLE_ANALYTICS, agentConnection }: WorkbenchPanelProps): JSX.Element {
  const subscribe = useMemo(() => (listener: () => void) => {
    runtime.reportPanelPerformanceEvent?.({ type: "subscription-active", active: true });
    const unsubscribe = runtime.subscribe(listener);
    return () => {
      runtime.reportPanelPerformanceEvent?.({ type: "subscription-active", active: false });
      unsubscribe();
    };
  }, [runtime]);
  const snapshot = useSyncExternalStore(subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const evidenceRows = useRef(new Map<string, HTMLButtonElement>());
  const evidenceRowActions = useRef<EvidenceRowActions>({ select: () => undefined });
  const evidenceLedger = useRef<HTMLDivElement | null>(null);
  const preservedEvidenceScrollLeft = useRef<number | null>(null);
  const contextBody = useRef<HTMLDivElement | null>(null);
  const visibleFrame = useRef<number | null>(null);
  const latestCommittedEvidenceBoundary = useRef(snapshot.renderedEvidenceBoundary);

  useLayoutEffect(() => {
    latestCommittedEvidenceBoundary.current = snapshot.renderedEvidenceBoundary;
    runtime.reportPanelPerformanceEvent?.({
      type: "layout-effect",
      snapshotVersion: snapshot.version,
      boundary: snapshot.renderedEvidenceBoundary
    });
    if (!runtime.reportVisibleFrame) return;
    if (visibleFrame.current !== null) return;
    const scheduleVisibleFrame = () => {
      runtime.reportPanelPerformanceEvent?.({ type: "animation-frame-requested", timestampMs: performance.now() });
      let callbackRan = false;
      const frame = window.requestAnimationFrame(() => {
        callbackRan = true;
        visibleFrame.current = null;
        runtime.reportPanelPerformanceEvent?.({ type: "animation-frame-callback", timestampMs: performance.now() });
        runtime.reportVisibleFrame?.(latestCommittedEvidenceBoundary.current);
      });
      if (!callbackRan) {
        visibleFrame.current = frame;
      }
    };
    scheduleVisibleFrame();
  }, [runtime, snapshot.version]);
  useLayoutEffect(() => {
    runtime.reportPanelPerformanceEvent?.({ type: "root-mounted", mounted: true });
    return () => {
      if (visibleFrame.current !== null) {
        window.cancelAnimationFrame(visibleFrame.current);
        visibleFrame.current = null;
        runtime.reportPanelPerformanceEvent?.({ type: "animation-frame-cancelled" });
      }
      runtime.reportPanelPerformanceEvent?.({ type: "root-mounted", mounted: false });
    };
  }, [runtime]);
  const scopeTree = useRef<HTMLDivElement | null>(null);
  const scopeNodesById = useRef(new Map<string, HTMLButtonElement>());
  const scopeTreeActions = useRef<ScopeTreeActions>({
    scroll: () => undefined,
    focus: () => undefined,
    commit: () => undefined,
    key: () => undefined
  });
  const pendingEvidenceFocus = useRef<string | null>(null);
  const pendingTimelineReveal = useRef<string | null>(null);
  const pendingScopeFocus = useRef<string | null>(null);
  const pendingScopeSearchReveal = useRef<string | null>(null);
  const pendingScopeEntryFocus = useRef(false);
  const pendingContextFocus = useRef(false);
  const pendingRetainedBoundaryFocus = useRef<"oldest" | "newest" | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [exportDownloadStatus, setExportDownloadStatus] = useState("");
  const [scopeSearchOpen, setScopeSearchOpen] = useState(false);
  const [scopeSearchFocusRequest, setScopeSearchFocusRequest] = useState(0);
  const scopeSearchTrigger = useRef<HTMLButtonElement | null>(null);
  const scopeSearchOrigin = useRef<HTMLElement | null>(null);
  const [evidencePayloadMode, setEvidencePayloadMode] = useState<EvidencePayloadMode>("readable");
  const [evidenceCodesOpen, setEvidenceCodesOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  // Pane geometry and Find register no layout effects here; their effects
  // are called below at the positions the inline effects used to occupy.
  const layout = usePaneLayout();
  const {
    geometry, scopeCollapsed, setScopeCollapsed, contextCollapsed, setContextCollapsed,
    renderedScopeWidth, contextMinimum, contextMaximum, contextSize,
    isCompactGeometry, isNormalGeometry, collapsePane, restorePane, handleSeparatorKey, startResize,
    workspace, scopeSplitter, contextSplitter, scopeRestore, contextRestore, scopeCollapse, contextCollapse
  } = layout;
  const find = useFindController({
    runtime,
    findState: snapshot.evidence.findState,
    contextId: snapshot.contextId,
    compact: geometry === "compact",
    scopePickerOpen,
    setScopePickerOpen,
    evidenceLedger
  });
  const { findOpen, findDraft, findTrigger, openFind, clearFind, closeFind } = find;
  const [activitySummaryOpen, setActivitySummaryOpen] = useState(false);
  const [selectedFilterActionsOpen, setSelectedFilterActionsOpen] = useState(false);
  const [selectedEvidenceMetadataOpen, setSelectedEvidenceMetadataOpen] = useState(false);
  // Registers the facet-discovery layout effect, the first after the
  // performance-reporting effects above, as before.
  const filter = useFilterComposer({ runtime, evidence: snapshot.evidence, snapshotVersion: snapshot.version });
  const { filterOpen, filterTrigger, openFilter, closeFilter } = filter;
  const [collapsedScopeIds, setCollapsedScopeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [scopeWindowStart, setScopeWindowStart] = useState(0);
  const [scopeTreeHeight, setScopeTreeHeight] = useState(SCOPE_NODE_HEIGHT * SCOPE_FALLBACK_VIEWPORT_ROWS);
  const [scopeTreeHasDomFocus, setScopeTreeHasDomFocus] = useState(false);
  const scopeTypeahead = useRef("");
  const scopeTypeaheadReset = useRef<number | null>(null);
  const moreActionsTrigger = useRef<HTMLButtonElement | null>(null);
  const actionsReturnTrigger = useRef<HTMLButtonElement | null>(null);
  const agentAccessDetails = useRef<HTMLDetailsElement | null>(null);
  const agentAccessControl = useRef<HTMLButtonElement | null>(null);
  const actionsFocusAgent = useRef(false);
  const notificationsTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceModeTrigger = useRef<HTMLButtonElement | null>(null);
  const scopeTrigger = useRef<HTMLButtonElement | null>(null);
  const contextLens = useRef<HTMLElement | null>(null);
  const workbenchRoot = useRef<HTMLElement | null>(null);
  const serverInjectionTrigger = useRef<HTMLButtonElement | null>(null);
  const actionsEvidenceScrollTop = useRef(0);
  const actionsContextScrollTop = useRef(0);
  const pendingActionsRestoration = useRef(false);
  const pendingActionsFocus = useRef(false);
  const evidence = snapshot.evidence;
  const events = evidence.events;
  const selectedEventId = snapshot.selectionEventId;
  const focusedEventId = evidence.focusedEventId;
  const selected = snapshot.selectedEvidence ?? events.find((event) => event.id === selectedEventId) ?? null;
  const capture = snapshot.capture;
  const captureOperation = uppercase(capture.operation, "IDLE");
  const coverage = uppercase(capture.coverage, "USEFUL");
  const evidenceMode = evidence.mode === "live" ? "FOLLOW LIVE" : "FROZEN";
  const newerCount = evidence.newerCount;
  const scopeLabel = snapshot.scope.label;
  const scopeStatus = snapshot.scope.status;
  const findState = evidence.findState;
  const hiddenSelection = evidence.hiddenSelection;
  const scopeNodes = snapshot.scope.structure;
  const {
    scopeNodeById,
    scopeChildrenByParent,
    scopeSiblingPositionById,
    visibleScopeNodes,
    visibleScopeIndexById
  } = useMemo(() => {
    const nodeById = new Map(scopeNodes.map((node) => [node.id, node]));
    const childrenByParent = new Map<
      string | null,
      WorkbenchSnapshot["scope"]["structure"][number][]
    >();
    for (const node of scopeNodes) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentId, siblings);
    }
    const siblingPositionById = new Map<string, { position: number; size: number }>();
    for (const siblings of childrenByParent.values()) {
      for (let index = 0; index < siblings.length; index += 1) {
        siblingPositionById.set(siblings[index]!.id, { position: index + 1, size: siblings.length });
      }
    }
    const visibleNodes = scopeNodes.filter((node) => {
      let parentId = node.parentId;
      while (parentId) {
        if (collapsedScopeIds.has(parentId)) return false;
        parentId = nodeById.get(parentId)?.parentId ?? null;
      }
      return true;
    });
    return {
      scopeNodeById: nodeById,
      scopeChildrenByParent: childrenByParent,
      scopeSiblingPositionById: siblingPositionById,
      visibleScopeNodes: visibleNodes,
      visibleScopeIndexById: new Map(visibleNodes.map((node, index) => [node.id, index]))
    };
    // The runtime caches `scope.structure` per `structureRevision`, so its
    // identity changes exactly when the revision does; depending on the array
    // itself is equivalent in production and honest for every caller.
  }, [collapsedScopeIds, scopeNodes]);
  const requestedFocusedNode = snapshot.scope.focusedNodeId
    ? scopeNodeById.get(snapshot.scope.focusedNodeId)
    : undefined;
  let effectiveFocusedNode = requestedFocusedNode;
  while (effectiveFocusedNode && !visibleScopeIndexById.has(effectiveFocusedNode.id)) {
    effectiveFocusedNode = effectiveFocusedNode.parentId
      ? scopeNodeById.get(effectiveFocusedNode.parentId)
      : undefined;
  }
  const selectedStructure = snapshot.scope.selection
    ? scopeNodeById.get(snapshot.scope.selection.id)
    : undefined;
  effectiveFocusedNode ??= selectedStructure && visibleScopeIndexById.has(selectedStructure.id)
    ? selectedStructure
    : undefined;
  effectiveFocusedNode ??= visibleScopeNodes[0];
  const renderedFocusId = pendingScopeFocus.current ?? effectiveFocusedNode?.id ?? null;
  const focusedScopeIndex = renderedFocusId ? visibleScopeIndexById.get(renderedFocusId) ?? -1 : -1;
  const scopeWindowSize = clamp(
    Math.ceil(scopeTreeHeight / SCOPE_NODE_HEIGHT) + SCOPE_WINDOW_OVERSCAN * 2,
    1,
    SCOPE_MAX_WINDOW_SIZE
  );
  const maximumScopeWindowStart = Math.max(0, visibleScopeNodes.length - scopeWindowSize);
  const renderedScopeWindowStart = clamp(scopeWindowStart, 0, maximumScopeWindowStart);
  const scopeOwnsFocus = scopeTreeHasDomFocus || scopeTree.current?.contains(document.activeElement);
  const focusedScopeIsMounted = focusedScopeIndex >= renderedScopeWindowStart &&
    focusedScopeIndex < renderedScopeWindowStart + scopeWindowSize;
  const scopeTabStopId = scopeOwnsFocus || focusedScopeIsMounted
    ? renderedFocusId
    : visibleScopeNodes[renderedScopeWindowStart]?.id ?? null;
  // `snapshot.scope` is rebuilt on every publication, so the window entries
  // recompute each time; rows stay memoized through the runtime's stable
  // per-revision node presentations.
  const renderedScopeEntries = useMemo(() => {
    const entries = visibleScopeNodes
      .slice(renderedScopeWindowStart, renderedScopeWindowStart + scopeWindowSize)
      .map((structure, offset) => ({
        node: snapshot.scope.resolveNode(structure.id)!,
        index: renderedScopeWindowStart + offset
      }));
    if (scopeOwnsFocus && focusedScopeIndex >= 0 && !entries.some(({ index }) => index === focusedScopeIndex)) {
      const focusedStructure = visibleScopeNodes[focusedScopeIndex]!;
      entries.push({
        node: snapshot.scope.resolveNode(focusedStructure.id)!,
        index: focusedScopeIndex
      });
      entries.sort((left, right) => left.index - right.index);
    }
    return entries;
  }, [focusedScopeIndex, renderedScopeWindowStart, scopeWindowSize, visibleScopeNodes, snapshot.scope, scopeOwnsFocus]);
  const canAuthorCommandUpdate = snapshot.localInjection.availability.commandScope.available;
  const serverInjection = snapshot.serverInjection;
  const serverInjectionDraft = serverInjection?.draft ?? null;
  const total = evidence.total;
  const filterCounts = evidence.investigation.counts;
  const shown = filterCounts.shown;
  const matching = filterCounts.matching;
  const inScope = filterCounts.inScope;
  const historyStatus = snapshot.retention.historyStatus;
  const appliedFilter = evidence.investigation.filter;
  const rangeOrigin = snapshot.activity?.projection.timeline?.originTimestamp;
  const activeTimelineRange = appliedFilter.around;
  const appliedFilterSummary = activeTimelineRange && rangeOrigin !== null && rangeOrigin !== undefined
    ? [filterSummary({ ...appliedFilter, around: null }), `Range ${activityRangeLabel(activeTimelineRange, rangeOrigin)}`].filter(value => value !== "none").join(" · ")
    : filterSummary(appliedFilter);
  const hasActiveFilter = appliedFilterSummary !== "none";
  const applySelectedFilterAction = (action: EvidenceFilterActionDescriptor) => {
    dispatch(runtime, {
      type: "apply-contextual-filter-action",
      expectedRevision: appliedFilter.revision,
      action
    });
  };
  const applySelectedFilterValue = (value: TypedFilterValue, state: FilterValueState) => {
    if (state !== "off") {
      const action = snapshot.context.filterActions?.find((candidate) => candidate.kind === state && candidate.value?.identity === value.identity);
      if (action) {
        applySelectedFilterAction(action);
        return;
      }
    }
    dispatch(runtime, { type: "apply-filter-mutations", expectedRevision: appliedFilter.revision, operations: filterValueMutations(value, state) });
  };
  const compactSurface = snapshot.contextId === "context:scope" ? "scope" : snapshot.contextId ? "context" : undefined;
  const rawEvidence = snapshot.contextId?.startsWith("raw:") ? selected : null;
  const notificationsOpen = snapshot.contextId === "notifications";
  const notificationSeverity = snapshot.notifications.filter.options.diagnosticSeverity.some(({ value, count }) => value.value === "error" && count > 0)
    ? "Error"
    : snapshot.notifications.filter.options.diagnosticSeverity.some(({ value, count }) => value.value === "warning" && count > 0)
      ? "Warning"
      : null;
  const localInjection = snapshot.localInjection;
  const localInjectionDraft = localInjection.draft;
  const scenarioOpen = Boolean(snapshot.scenario && !snapshot.scenario.parked);
  const notificationsPresented = notificationsOpen && !localInjectionDraft?.open && !scenarioOpen && !serverInjectionDraft;
  const contextMode = snapshot.contextId === "context:actions"
    ? "actions"
    : snapshot.contextId === "context:export"
      ? "export"
      : "inspect";
  const workspaceAvailable = !localInjectionDraft?.open && !scenarioOpen && !serverInjectionDraft && !rawEvidence && !notificationsOpen;
  const scopeIsPresented = geometry === "wide"
    ? !scopeCollapsed
    : geometry === "compact"
      ? compactSurface === "scope"
      : scopePickerOpen;
  const selectedContextActionLabel = geometry === "compact"
    ? "Open selected Context"
    : contextCollapsed
      ? "Restore selected Context"
      : "Focus selected Context";
  const chromeLayoutKey = JSON.stringify([findOpen, snapshot.diagnostics.map(diagnostic => [
    diagnostic.severity, diagnostic.title, diagnostic.affected, diagnostic.detail,
    diagnostic.limitation, diagnostic.consequence, diagnostic.recovery, diagnostic.route?.label
  ])]);

  useWorkspacePressure(layout, workspaceAvailable, chromeLayoutKey);

  const { scopedCopyStatus, operationFocusOrigin, scopedCopyTrigger, exportTrigger } = useSessionOperationResults({
    runtime,
    analytics,
    evidenceCopy: snapshot.evidenceCopy,
    exportState: snapshot.export.operation?.state,
    contextLens
  });

  usePaneResizeLifecycle(layout);

  // Both read only refs, so they are identity-stable.
  const preserveEvidenceHorizontalScroll = useCallback(() => {
    preservedEvidenceScrollLeft.current = evidenceLedger.current?.scrollLeft ?? null;
  }, []);

  const restoreEvidenceHorizontalScroll = useCallback(() => {
    const horizontalOffset = preservedEvidenceScrollLeft.current;
    if (horizontalOffset === null || !evidenceLedger.current) return;
    evidenceLedger.current.scrollLeft = horizontalOffset;
    window.requestAnimationFrame(() => {
      if (evidenceLedger.current) evidenceLedger.current.scrollLeft = horizontalOffset;
    });
  }, []);

  const moveEvidence = (offset: number) => {
    preserveEvidenceHorizontalScroll();
    const currentIndex = Math.max(0, events.findIndex((event) => event.id === focusedEventId));
    const next = events[Math.min(Math.max(currentIndex + offset, 0), events.length - 1)];
    if (next) {
      pendingEvidenceFocus.current = next.id;
      dispatch(runtime, { type: "focus-evidence", eventId: next.id });
      restoreEvidenceHorizontalScroll();
    }
  };

  const moveEvidenceByViewport = (direction: -1 | 1) => {
    const measuredRowHeight = evidenceRows.current.values().next().value?.getBoundingClientRect().height ?? 0;
    const rowHeight = measuredRowHeight > 0 ? measuredRowHeight : EVIDENCE_ROW_HEIGHT;
    const visibleRows = Math.max(1, Math.floor((evidenceLedger.current?.clientHeight || rowHeight * 10) / rowHeight));
    moveEvidence(direction * visibleRows);
  };

  const navigateRetainedEvidence = (direction: "older" | "newer" | "oldest" | "newest", focusBoundary = false) => {
    if (focusBoundary && (direction === "oldest" || direction === "newest")) {
      const atBoundary = direction === "oldest" ? evidence.visibleStart === 1 : evidence.visibleEnd === total;
      if (atBoundary) {
        const target = direction === "oldest" ? events[0] : events[events.length - 1];
        if (target) {
          pendingEvidenceFocus.current = target.id;
          dispatch(runtime, { type: "select-evidence", eventId: target.id });
          window.requestAnimationFrame(() => {
            evidenceRows.current.get(target.id)?.focus();
            if (pendingEvidenceFocus.current === target.id) pendingEvidenceFocus.current = null;
          });
        }
        return;
      }
      pendingRetainedBoundaryFocus.current = direction;
    }
    dispatch(runtime, { type: `show-${direction}-evidence` as "show-older-evidence" | "show-newer-evidence" | "show-oldest-evidence" | "show-newest-evidence" });
  };

  const handleEvidenceKey = (keyEvent: ReactKeyboardEvent<HTMLElement>) => {
    if (keyEvent.key === "ArrowUp") { keyEvent.preventDefault(); moveEvidence(-1); }
    if (keyEvent.key === "ArrowDown") { keyEvent.preventDefault(); moveEvidence(1); }
    if (keyEvent.key === "PageUp") { keyEvent.preventDefault(); moveEvidenceByViewport(-1); }
    if (keyEvent.key === "PageDown") { keyEvent.preventDefault(); moveEvidenceByViewport(1); }
    if (keyEvent.key === "Home") { keyEvent.preventDefault(); if (keyEvent.metaKey || keyEvent.ctrlKey) navigateRetainedEvidence("oldest", true); else moveEvidence(-events.length); }
    if (keyEvent.key === "End") { keyEvent.preventDefault(); if (keyEvent.metaKey || keyEvent.ctrlKey) navigateRetainedEvidence("newest", true); else moveEvidence(events.length); }
    if (keyEvent.key === "Enter") { keyEvent.preventDefault(); openContext(); }
  };

  const restoreEvidenceFocus = () => {
    pendingEvidenceFocus.current = focusedEventId ?? selectedEventId;
    dispatch(runtime, { type: "set-context", contextId: null });
  };

  const openContext = () => {
    pendingEvidenceFocus.current = focusedEventId ?? selectedEventId;
    pendingContextFocus.current = true;
    if (contextCollapsed) setContextCollapsed(false);
    else if (geometry !== "compact" && contextMode === "inspect") {
      contextLens.current?.focus();
      pendingContextFocus.current = false;
    }
    dispatch(runtime, { type: "open-context" });
  };

  const selectTimelineEvidence = (anchor: TimelineEvidenceAnchor, inspect: boolean) => {
    dispatch(runtime, { type: "select-activity-evidence", ...anchor, inspect });
    if (runtime.getSnapshot().evidence.selectedEventId !== anchor.eventId) return;
    if (inspect && runtime.getSnapshot().contextId !== `context:${anchor.eventId}`) return;
    pendingTimelineReveal.current = anchor.eventId;
    if (inspect) {
      pendingContextFocus.current = true;
      pendingEvidenceFocus.current = anchor.eventId;
      setContextCollapsed(false);
    }
  };

  const openScopeContext = () => {
    pendingContextFocus.current = true;
    if (contextCollapsed) setContextCollapsed(false);
    dispatch(runtime, { type: "set-context", contextId: "context:scope-dossier" });
  };

  const openScope = (origin: HTMLButtonElement) => {
    scopeTrigger.current = origin;
    pendingScopeEntryFocus.current = !scopeSearchOpen;
    if (scopeSearchOpen) setScopeSearchFocusRequest(value => value + 1);
    if (isCompactGeometry()) {
      dispatch(runtime, { type: "open-scope" });
      return;
    }
    if (geometry === "wide") {
      if (scopeCollapsed) setScopeCollapsed(false);
      else if (!scopeSearchOpen) {
        const nodeId = renderedFocusId;
        if (nodeId) {
          revealScopeNode(nodeId);
          window.requestAnimationFrame(() => {
            scopeNodesById.current.get(nodeId)?.focus();
            pendingScopeEntryFocus.current = false;
          });
        }
      }
      return;
    }
    setScopePickerOpen(true);
  };

  const closeScope = () => {
    setScopeSearchOpen(false);
    setScopePickerOpen(false);
    scopeTrigger.current?.focus();
  };

  const openScopeSearch = (origin: HTMLElement) => {
    if (scopeSearchOpen) {
      setScopeSearchFocusRequest(value => value + 1);
      return;
    }
    scopeSearchOrigin.current = origin;
    pendingScopeEntryFocus.current = false;
    pendingScopeFocus.current = null;
    pendingScopeSearchReveal.current = null;
    setScopeSearchOpen(true);
    setScopeSearchFocusRequest(value => value + 1);
  };

  const closeScopeSearch = () => {
    setScopeSearchOpen(false);
    window.requestAnimationFrame(() => {
      const origin = scopeSearchOrigin.current;
      (origin?.isConnected ? origin : scopeSearchTrigger.current)?.focus({ preventScroll: true });
    });
  };

  const chooseSearchScope = (scopeId: string) => {
    if (!snapshot.scope.resolveNode(scopeId)) return;
    setScopeSearchOpen(false);
    setCollapsedScopeIds(ids => {
      const next = new Set(ids);
      let parent = scopeNodeById.get(scopeId)?.parentId;
      while (parent) { next.delete(parent); parent = scopeNodeById.get(parent)?.parentId; }
      return next;
    });
    if (geometry === "wide") {
      pendingScopeFocus.current = scopeId;
      pendingScopeSearchReveal.current = scopeId;
    }
    dispatch(runtime, { type: "set-scope-focus", scopeId });
    commitScope(scopeId);
  };

  const commitScope = (scopeId: string) => {
    const compact = isCompactGeometry();
    const evidenceId = compact ? focusedEventId ?? selectedEventId : null;
    if (evidenceId) pendingEvidenceFocus.current = evidenceId;
    dispatch(runtime, { type: "set-scope", scopeId });
    if (scopePickerOpen) closeScope();
    else if (compact) {
      dispatch(runtime, { type: "set-context", contextId: null });
      if (evidenceId) {
        const restore = () => {
          const row = evidenceRows.current.get(evidenceId);
          if (!row) return false;
          row.focus();
          if (document.activeElement === row) {
            pendingEvidenceFocus.current = null;
            return true;
          }
          return false;
        };
        window.requestAnimationFrame(() => {
          if (!restore()) window.requestAnimationFrame(restore);
        });
      }
    }
  };

  const revealScopeNode = (scopeId: string) => {
    const index = visibleScopeIndexById.get(scopeId) ?? -1;
    if (index < 0) return;
    if (index < renderedScopeWindowStart || index >= renderedScopeWindowStart + scopeWindowSize) {
      setScopeWindowStart(clamp(index - Math.floor(scopeWindowSize / 2), 0, maximumScopeWindowStart));
    }
    const tree = scopeTree.current;
    if (!tree) return;
    const nodeTop = index * SCOPE_NODE_HEIGHT;
    const nodeBottom = nodeTop + SCOPE_NODE_HEIGHT;
    if (nodeTop < tree.scrollTop) tree.scrollTop = nodeTop;
    else if (nodeBottom > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = Math.max(0, nodeBottom - tree.clientHeight);
    }
  };

  const moveScope = (offset: number) => {
    const nodes = visibleScopeNodes;
    const currentIndex = Math.max(0, renderedFocusId ? visibleScopeIndexById.get(renderedFocusId) ?? 0 : 0);
    const next = nodes[Math.min(Math.max(currentIndex + offset, 0), nodes.length - 1)];
    if (!next) return;
    revealScopeNode(next.id);
    pendingScopeFocus.current = next.id;
    dispatch(runtime, { type: "set-scope-focus", scopeId: next.id });
  };

  const focusScope = (scopeId: string) => {
    revealScopeNode(scopeId);
    pendingScopeFocus.current = scopeId;
    dispatch(runtime, { type: "set-scope-focus", scopeId });
  };

  const handleScopeKey = (keyEvent: ReactKeyboardEvent<HTMLButtonElement>, node: WorkbenchSnapshot["scope"]["nodes"][number]) => {
    const childNodes = scopeChildrenByParent.get(node.id) ?? [];
    const firstChild = childNodes[0];
    const isExpanded = childNodes.length > 0 && !collapsedScopeIds.has(node.id);
    if (keyEvent.key === "ArrowUp") { keyEvent.preventDefault(); moveScope(-1); return; }
    if (keyEvent.key === "ArrowDown") { keyEvent.preventDefault(); moveScope(1); return; }
    if (keyEvent.key === "Home") { keyEvent.preventDefault(); moveScope(-visibleScopeNodes.length); return; }
    if (keyEvent.key === "End") { keyEvent.preventDefault(); moveScope(visibleScopeNodes.length); return; }
    if (keyEvent.key === "ArrowRight") {
      keyEvent.preventDefault();
      if (childNodes.length && !isExpanded) {
        setCollapsedScopeIds((ids) => {
          const next = new Set(ids);
          next.delete(node.id);
          return next;
        });
      } else if (firstChild) {
        focusScope(firstChild.id);
      }
      return;
    }
    if (keyEvent.key === "ArrowLeft") {
      keyEvent.preventDefault();
      if (childNodes.length && isExpanded) {
        focusScope(node.id);
        setCollapsedScopeIds((ids) => new Set(ids).add(node.id));
      } else if (node.parentId) {
        focusScope(node.parentId);
      }
      return;
    }
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      commitScope(node.id);
      return;
    }
    if (keyEvent.key.length === 1 && !keyEvent.ctrlKey && !keyEvent.metaKey && !keyEvent.altKey) {
      scopeTypeahead.current += keyEvent.key.toLocaleLowerCase();
      if (scopeTypeaheadReset.current !== null) window.clearTimeout(scopeTypeaheadReset.current);
      scopeTypeaheadReset.current = window.setTimeout(() => {
        scopeTypeahead.current = "";
        scopeTypeaheadReset.current = null;
      }, 700);
      const currentIndex = visibleScopeIndexById.get(node.id) ?? 0;
      let match: WorkbenchSnapshot["scope"]["structure"][number] | undefined;
      for (let offset = 1; offset <= visibleScopeNodes.length; offset += 1) {
        const candidate = visibleScopeNodes[(currentIndex + offset) % visibleScopeNodes.length];
        if (candidate?.label.toLocaleLowerCase().startsWith(scopeTypeahead.current)) {
          match = candidate;
          break;
        }
      }
      if (match) {
        keyEvent.preventDefault();
        focusScope(match.id);
      }
    }
  };

  scopeTreeActions.current = {
    scroll(scrollTop) {
      const firstVisibleIndex = clamp(
        Math.ceil(scrollTop / SCOPE_NODE_HEIGHT),
        0,
        Math.max(0, visibleScopeNodes.length - 1)
      );
      setScopeWindowStart(clamp(
        firstVisibleIndex - SCOPE_WINDOW_OVERSCAN,
        0,
        maximumScopeWindowStart
      ));
    },
    focus: focusScope,
    commit: commitScope,
    key: handleScopeKey
  };
  evidenceRowActions.current = {
    select(eventId) {
      dispatch(runtime, { type: "select-evidence", eventId });
    }
  };

  const toggleExportRedaction = (category: TopologySensitiveCategory, checked: boolean) => {
    const next = new Set(snapshot.export.redactions);
    if (checked) next.add(category);
    else next.delete(category);
    dispatch(runtime, { type: "set-export-redactions", redactions: [...next] });
    dispatch(runtime, { type: "export-scope" });
  };

  const setCompleteEvidence = (complete: boolean) => {
    dispatch(runtime, { type: "set-export-complete-evidence", complete });
    dispatch(runtime, { type: "export-scope" });
  };

  const downloadExport = async (format: "json" | "html") => {
    const prepared = snapshot.export;
    if (!prepared.document || !prepared.json || !prepared.filename) return;
    try {
      if (format === "json") {
        downloadText(prepared.filename, prepared.json, "application/json");
        setExportDownloadStatus("Downloaded versioned JSON export.");
        analytics.track({ name: "export_result", params: { format, outcome: "success" } });
        return;
      }
      const { renderTopologyHtmlReport } = await import("../topology-html-report");
      downloadText(topologySnapshotFilename(prepared.document, "html"), renderTopologyHtmlReport(prepared.document), "text/html");
      setExportDownloadStatus("Downloaded offline HTML export.");
      analytics.track({ name: "export_result", params: { format, outcome: "success" } });
    } catch {
      setExportDownloadStatus("The export could not be downloaded. Try again or save the prepared JSON manually.");
      analytics.track({ name: "export_result", params: { format, outcome: "failed" } });
    }
  };

  const copyRawEvidence = async () => {
    if (!rawEvidence) return;
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("Raw Evidence copy is unavailable in this context.");
      analytics.track({ name: "export_result", params: { format: "raw", outcome: "unavailable" } });
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawEvidence.raw, null, 2));
      setCopyStatus(`Copied raw Evidence ${rawEvidence.id}.`);
      analytics.track({ name: "export_result", params: { format: "raw", outcome: "success" } });
    } catch {
      setCopyStatus("Raw Evidence could not be copied. Select and copy the document instead.");
      analytics.track({ name: "export_result", params: { format: "raw", outcome: "failed" } });
    }
  };

  useFilterSubmitResult(filter, evidence.filterMutation, snapshot.version);

  const { notificationsOrigin, inspectingNotification } = useNotificationsFocusRestoration({
    notificationsOpen,
    notificationsTrigger,
    evidenceLedger,
    contextBody,
    scopeTree
  });

  const dismissFocus = useDiagnosticDismissFocus({
    diagnostics: snapshot.diagnostics,
    notificationsTrigger,
    evidenceModeTrigger
  });

  // Reads only refs, so it is identity-stable.
  const focusActions = useCallback(() => {
    if (actionsFocusAgent.current && agentAccessDetails.current) {
      agentAccessDetails.current.open = true;
      agentAccessControl.current?.focus();
    } else contextLens.current?.focus();
  }, []);

  const openActions = (trigger: HTMLButtonElement, agent = false) => {
    actionsReturnTrigger.current = trigger;
    actionsFocusAgent.current = agent;
    if (contextMode === "actions") { focusActions(); return; }
    actionsEvidenceScrollTop.current = evidenceLedger.current?.scrollTop ?? 0;
    actionsContextScrollTop.current = contextBody.current?.scrollTop ?? 0;
    pendingActionsFocus.current = true;
    if (contextCollapsed) setContextCollapsed(false);
    dispatch(runtime, { type: "open-actions" });
  };

  const closeActions = () => {
    pendingActionsRestoration.current = true;
    dispatch(runtime, { type: "close-actions" });
  };

  const openNotifications = () => {
    notificationsOrigin.current = {
      evidenceScrollTop: evidenceLedger.current?.scrollTop ?? 0,
      contextScrollTop: contextBody.current?.scrollTop ?? 0,
      scopeScrollTop: scopeTree.current?.scrollTop ?? 0
    };
    dispatch(runtime, { type: "open-notifications" });
  };

  const inspectNotification = (route: NonNullable<WorkbenchDiagnostic["route"]>): boolean => {
    inspectingNotification.current = true;
    pendingContextFocus.current = true;
    setContextCollapsed(false);
    if (route.kind === "inspect-evidence") {
      pendingTimelineReveal.current = route.evidence.eventId;
      dispatch(runtime, { type: "inspect-diagnostic-evidence", evidence: route.evidence });
    } else dispatch(runtime, { type: "inspect-diagnostic-affected", affected: route.affected });
    if (runtime.getSnapshot().contextId === "notifications") {
      inspectingNotification.current = false;
      pendingContextFocus.current = false;
      pendingTimelineReveal.current = null;
      return false;
    }
    return true;
  };

  useLayoutEffect(() => {
    const tree = scopeTree.current;
    if (!tree) return;
    const measure = () => setScopeTreeHeight(Math.max(SCOPE_NODE_HEIGHT, tree.clientHeight));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => observer.disconnect();
    // Geometry, collapse, picker, and Context changes remount the tree host.
  }, [geometry, scopeCollapsed, scopePickerOpen, snapshot.contextId]);

  const effectiveFocusedNodeId = effectiveFocusedNode?.id;
  useLayoutEffect(() => {
    if (effectiveFocusedNodeId === undefined || effectiveFocusedNodeId === snapshot.scope.focusedNodeId) return;
    if (scopeTree.current?.contains(document.activeElement)) pendingScopeFocus.current = effectiveFocusedNodeId;
    dispatch(runtime, { type: "set-scope-focus", scopeId: effectiveFocusedNodeId });
  }, [runtime, effectiveFocusedNodeId, snapshot.scope.focusedNodeId]);

  useLayoutEffect(() => {
    if (scopeWindowStart <= maximumScopeWindowStart) return;
    setScopeWindowStart(maximumScopeWindowStart);
  }, [maximumScopeWindowStart, scopeWindowStart]);

  useLayoutEffect(() => {
    const eventId = pendingEvidenceFocus.current;
    if (!eventId || snapshot.contextId) return;
    const restore = () => {
      const row = evidenceRows.current.get(eventId);
      if (!row) return;
      const horizontalOffset = evidenceLedger.current?.scrollLeft;
      row.focus({ preventScroll: true });
      if (evidenceLedger.current && horizontalOffset !== undefined) evidenceLedger.current.scrollLeft = horizontalOffset;
      if (document.activeElement === row) pendingEvidenceFocus.current = null;
    };
    restore();
    window.requestAnimationFrame(() => {
      if (pendingEvidenceFocus.current === eventId) restore();
    });
    // Focus, publication, and picker changes are deliberate retry triggers.
  }, [focusedEventId, snapshot.contextId, snapshot.version, scopePickerOpen]);

  const hiddenSelectionEventId = hiddenSelection?.eventId;
  useLayoutEffect(() => {
    if (hiddenSelectionEventId === undefined || !focusedEventId || focusedEventId === hiddenSelectionEventId) return;
    if (pendingScopeFocus.current || scopeTree.current?.contains(document.activeElement)) return;
    if (isCompactGeometry() && snapshot.contextId) {
      pendingEvidenceFocus.current = focusedEventId;
      return;
    }
    const row = evidenceRows.current.get(focusedEventId);
    if (row?.isConnected && row.getClientRects().length > 0) row.focus({ preventScroll: true });
    // Geometry is read at the publication that hid the selection; a later
    // geometry change alone must not move focus to the Evidence row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedEventId, hiddenSelectionEventId, snapshot.contextId, snapshot.version]);

  useLayoutEffect(() => {
    if (evidence.filterMutation.state !== "revealed" || snapshot.contextId || !focusedEventId) return;
    const row = evidenceRows.current.get(focusedEventId);
    if (row?.isConnected && row.getClientRects().length > 0) row.focus({ preventScroll: true });
    // Each publication is a deliberate retry trigger.
  }, [evidence.filterMutation.state, focusedEventId, snapshot.contextId, snapshot.version]);

  useLayoutEffect(() => {
    const boundary = pendingRetainedBoundaryFocus.current;
    if (!boundary || !events.length) return;
    if ((boundary === "oldest" && evidence.visibleStart !== 1) || (boundary === "newest" && evidence.visibleEnd !== total)) return;
    const target = boundary === "oldest" ? events[0] : events[events.length - 1];
    if (!target) return;
    pendingRetainedBoundaryFocus.current = null;
    pendingEvidenceFocus.current = target.id;
    dispatch(runtime, { type: "select-evidence", eventId: target.id });
  }, [runtime, events, evidence.visibleStart, evidence.visibleEnd, total]);

  const revealEvidenceRowWithoutHorizontalJump = useCallback((row: HTMLButtonElement) => {
    const ledger = evidenceLedger.current;
    const horizontalOffset = ledger?.scrollLeft;
    row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (ledger && horizontalOffset !== undefined) ledger.scrollLeft = horizontalOffset;
  }, []);

  useLayoutEffect(() => {
    restoreEvidenceHorizontalScroll();
    // Focus and payload-mode changes are the triggers; the callback is stable.
  }, [restoreEvidenceHorizontalScroll, focusedEventId, evidencePayloadMode]);

  useFindReveal({ find, findState, evidenceRows, evidenceLedger, events, geometry, scopePickerOpen });

  useLayoutEffect(() => {
    const eventId = pendingTimelineReveal.current;
    if (!eventId || (geometry === "compact" && snapshot.contextId)) return;
    const row = evidenceRows.current.get(eventId);
    if (!row) return;
    revealEvidenceRowWithoutHorizontalJump(row);
    pendingTimelineReveal.current = null;
  }, [snapshot.version, geometry, snapshot.contextId, revealEvidenceRowWithoutHorizontalJump]);

  useLayoutEffect(() => {
    if (scopeSearchOpen) return;
    const nodeId = pendingScopeFocus.current;
    if (!nodeId) return;
    // Search can choose a node inside a collapsed or unmounted branch. Reveal
    // after expansion commits, without turning passive tree focus into scrolling.
    if (pendingScopeSearchReveal.current === nodeId) revealScopeNode(nodeId);
    const node = scopeNodesById.current.get(nodeId);
    if (!node) return;
    node.focus();
    pendingScopeFocus.current = null;
    pendingScopeSearchReveal.current = null;
    // `revealScopeNode` is rebuilt every render from the window values that
    // are already listed; the listed values are the intended triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.scope.focusedNodeId, renderedScopeWindowStart, scopeWindowSize, scopeSearchOpen, visibleScopeNodes]);

  useLayoutEffect(() => {
    if (!pendingScopeEntryFocus.current || !scopeIsPresented || scopeSearchOpen) return;
    const nodeId = renderedFocusId;
    if (!nodeId) return;
    revealScopeNode(nodeId);
    const node = scopeNodesById.current.get(nodeId);
    if (!node) return;
    node.focus();
    pendingScopeEntryFocus.current = false;
    // `revealScopeNode` is rebuilt every render from the window values that
    // are already listed; the listed values are the intended triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeIsPresented, renderedFocusId, renderedScopeWindowStart, scopeWindowSize, scopeSearchOpen]);

  useLayoutEffect(() => {
    if (!pendingContextFocus.current) return;
    if (geometry === "compact" && !snapshot.contextId) return;
    contextLens.current?.focus();
    pendingContextFocus.current = false;
  }, [contextCollapsed, geometry, snapshot.contextId]);

  useLayoutEffect(() => {
    if (!pendingActionsFocus.current || contextMode !== "actions") return;
    focusActions();
    pendingActionsFocus.current = false;
    // Collapse and Context changes are deliberate retry triggers.
  }, [focusActions, contextMode, contextCollapsed, snapshot.contextId]);

  useFindInputFocus(find);

  useFilterInputFocus(filter);

  useLayoutEffect(() => {
    if (!pendingActionsRestoration.current || contextMode === "actions") return;
    pendingActionsRestoration.current = false;
    window.requestAnimationFrame(() => {
      if (evidenceLedger.current) evidenceLedger.current.scrollTop = actionsEvidenceScrollTop.current;
      if (contextBody.current) contextBody.current.scrollTop = actionsContextScrollTop.current;
      (actionsReturnTrigger.current ?? moreActionsTrigger.current)?.focus();
    });
    // Context changes are a deliberate retry trigger.
  }, [contextMode, snapshot.contextId]);

  useFilterDraftSync(filter, appliedFilter);

  usePaneFocusRestoration(layout);

  const {
    resumeLocalInjection, parkedDiscardTrigger, parkedDiscardDialog, restoreParkedDiscardFocus,
    parkedScenarioDiscardTrigger, parkedScenarioDiscardDialog, restoreParkedScenarioDiscardFocus
  } = useDocumentFocusRestoration({
    geometry,
    localInjection,
    serverInjectionDraft,
    scenario: snapshot.scenario,
    focusedEventId: snapshot.evidence.focusedEventId,
    selectionEventId: snapshot.selectionEventId,
    contextId: snapshot.contextId,
    evidenceRows,
    scopeNodesById,
    scopeTrigger,
    contextLens,
    serverInjectionTrigger
  });

  useLayoutEffect(() => {
    // Clear whichever typeahead reset is pending at unmount.
    const pendingTypeaheadReset = scopeTypeaheadReset;
    return () => {
      if (pendingTypeaheadReset.current !== null) window.clearTimeout(pendingTypeaheadReset.current);
    };
  }, []);

  // The runtime rebuilds these sub-objects on every publication; restore
  // identity while their content is unchanged so the memoized panes skip.
  const stableContext = useStructurallyStable(snapshot.context);
  const stableExport = useStructurallyStable(snapshot.export);
  const stableAppliedFilter = useStructurallyStable(appliedFilter);
  const stableLocalInjectionSelectedUpdate = useStructurallyStable(snapshot.localInjection.availability.selectedUpdate);
  const stableServerInjectionAvailability = useStructurallyStable(serverInjection?.availability ?? null);
  const stableDiagnostics = useStructurallyStable(snapshot.diagnostics);
  const stableNotificationEntries = useStructurallyStable(snapshot.notifications.entries);
  const contextActions = useLatestHandlers({
    dispatch: (command: WorkbenchCommand) => dispatch(runtime, command),
    collapseContext: () => collapsePane("context", "collapse"),
    closeActions: () => closeActions(),
    restoreEvidenceFocus: () => restoreEvidenceFocus(),
    copyScopedEvidence: () => { operationFocusOrigin.current = "copy"; dispatch(runtime, { type: "prepare-scoped-evidence-copy" }); },
    exportScope: () => { operationFocusOrigin.current = "export"; dispatch(runtime, { type: "export-scope" }); },
    toggleExportRedaction,
    setCompleteEvidence,
    downloadExport,
    applySelectedFilterAction,
    applySelectedFilterValue,
    applyActivityRankingFilter: (expectedRevision: number, rankingId: string) => dispatch(runtime, { type: "apply-activity-ranking-filter", expectedRevision, rankingId }),
    resetFilter: () => dispatch(runtime, { type: "reset-filter", expectedRevision: appliedFilter.revision })
  });
  const footerActions = useLatestHandlers({
    dispatch: (command: WorkbenchCommand) => dispatch(runtime, command),
    openNotifications
  });

  return (
    <section
      ref={workbenchRoot}
      className="workbench-react"
      data-theme="dark"
      data-geometry={geometry}
      data-compact-surface={compactSurface}
      data-scope-picker-open={scopePickerOpen || undefined}
      data-scope-collapsed={scopeCollapsed || undefined}
      data-context-collapsed={contextCollapsed || undefined}
      data-snapshot-version={snapshot.version}
      style={{ "--wb-scope-width": `${renderedScopeWidth}px`, "--wb-context-size": `${contextSize}px` } as CSSProperties}
      aria-label="Lightstreamer Workbench"
      onKeyDown={(keyEvent) => {
        if (rawEvidence || notificationsOpen || keyEvent.defaultPrevented) return;
        if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === "f") {
          const target = keyEvent.target;
          if (target instanceof Element && target.closest('[aria-label="Local Injection Draft"], [aria-label="Server Injection Draft"]')) return;
          keyEvent.preventDefault();
          if (target instanceof HTMLElement && target.closest("#workbench-runtime-scope")) {
            openScopeSearch(target);
            return;
          }
          openFind(document.activeElement instanceof HTMLElement ? document.activeElement : keyEvent.currentTarget);
          return;
        }
        if (keyEvent.key === "Escape" && findOpen) {
          keyEvent.preventDefault();
          if (findDraft || findState.query) {
            clearFind();
          } else {
            closeFind();
          }
          return;
        }
        if (keyEvent.key === "Escape" && filterOpen) {
          keyEvent.preventDefault();
          closeFilter();
          return;
        }
        if (keyEvent.key === "Escape" && scopePickerOpen) {
          keyEvent.preventDefault();
          closeScope();
        }
      }}
    >
      <header className="workbench-react__operating">
        <strong className="workbench-react__operating-capture">Capture {captureOperation}</strong>
        <span className="workbench-react__operating-coverage" data-condition={coverage.toLowerCase()}>Coverage {coverage}</span>
        <span className="workbench-react__operating-view">View {evidenceMode}{newerCount ? ` · ${newerCount.toLocaleString()} newer` : ""}</span>
        <AgentAccessStatus connection={agentConnection} disabled={!workspaceAvailable} expanded={workspaceAvailable && contextMode === "actions"} onOpen={trigger => openActions(trigger, true)} />
        <div className="workbench-react__operating-actions">
          <button type="button" aria-label="Back investigation" disabled={!snapshot.evidence.restoration.canBack} onClick={() => dispatch(runtime, { type: "back-investigation" })}>Back</button>
          <button type="button" aria-label="Forward investigation" disabled={!snapshot.evidence.restoration.canForward} onClick={() => dispatch(runtime, { type: "forward-investigation" })}>Forward</button>
          <button className="workbench-react__evidence-operation" type="button" ref={findTrigger} title="Find in Evidence (Control/Command+F)" disabled={notificationsOpen} aria-expanded={findOpen && !notificationsOpen} onClick={(event) => findOpen ? closeFind() : openFind(event.currentTarget)}>Find</button>
          <button className="workbench-react__evidence-operation" type="button" ref={filterTrigger} disabled={notificationsOpen} aria-expanded={filterOpen && !notificationsOpen} aria-controls="workbench-filter" onClick={(event) => filterOpen ? closeFilter() : openFilter(event.currentTarget)}>Filter</button>
          <button ref={moreActionsTrigger} type="button" disabled={!workspaceAvailable} aria-controls={workspaceAvailable ? "workbench-context" : undefined} aria-expanded={workspaceAvailable && contextMode === "actions"} onClick={event => openActions(event.currentTarget)}>More actions</button>
        </div>
      </header>
      {findOpen && !notificationsOpen ? <FindBar runtime={runtime} find={find} findState={findState} onInspectMatch={() => {
        pendingContextFocus.current = true;
        if (contextCollapsed) setContextCollapsed(false);
        dispatch(runtime, { type: "inspect-find-match" });
      }} /> : null}
      <nav className="workbench-react__scope-strip" aria-label="Current runtime scope">
        <button type="button" ref={scopeTrigger} disabled={!workspaceAvailable} aria-controls={workspaceAvailable ? "workbench-runtime-scope" : undefined} aria-expanded={workspaceAvailable && scopeIsPresented} onClick={(event) => openScope(event.currentTarget)}>Scope</button>
        {scopeCollapsed ? <button ref={scopeRestore} className="workbench-react__restore-pane workbench-react__restore-pane--scope" type="button" onClick={() => restorePane("scope")}>Restore Scope</button> : null}
        {contextCollapsed ? <button ref={contextRestore} className="workbench-react__restore-pane" type="button" onClick={() => restorePane("context")}>Restore Context</button> : null}
        <strong className="workbench-react__scope-label">{scopeLabel}</strong>
        <span className="workbench-react__scope-status">{scopeStatus}</span>
        {canAuthorCommandUpdate ? <button type="button" onClick={() => dispatch(runtime, { type: "begin-local-injection-from-scope" })}>{`Author ${snapshot.localInjection.availability.commandScope.mode ?? "COMMAND"} Item Update`}</button> : null}
      </nav>
      {localInjection.entryError ? <div className="workbench-react__condition workbench-react__condition--warning" role="alert"><strong>Local Injection unavailable</strong><span>{localInjection.entryError}</span></div> : null}
      {serverInjection?.entryError ? <div className="workbench-react__condition workbench-react__condition--warning" role="alert"><strong>Server Injection unavailable</strong><span>{serverInjection.entryError}</span></div> : null}
      {snapshot.scenario ? <Suspense fallback={scenarioOpen ? <div className="workbench-react__local-loading" role="status">Loading Local Injection Scenario…</div> : null}><LazyLocalInjectionScenarioDocument runtime={runtime} snapshot={snapshot} /></Suspense> : null}
      {snapshot.scenario?.parked ? <section className="workbench-react__local-parked workbench-react__scenario-parked" aria-label="Parked Local Injection Scenario">
        <div><span className="workbench-react__eyebrow">Parked Local Injection Scenario</span><strong>{snapshot.scenario.scenario.target.subscriptionId} · revision {snapshot.scenario.scenario.revision}</strong></div>
        <span>{snapshot.scenario.scenario.steps.length} explicit Steps · {snapshot.scenario.phase.toUpperCase()} · edits preserved</span>
        <button type="button" disabled={snapshot.scenario.discardConfirmation} onClick={() => {
          if (notificationsOpen) dispatch(runtime, { type: "close-notifications" });
          dispatch(runtime, { type: "resume-scenario" });
        }}>Resume Scenario</button>
        <button type="button" ref={parkedScenarioDiscardTrigger} onClick={() => dispatch(runtime, { type: "request-discard-scenario" })}>Discard Scenario</button>
      </section> : null}
      {snapshot.scenario?.parked && snapshot.scenario.discardConfirmation ? <section className="workbench-react__local-confirmation workbench-react__local-confirmation--parked workbench-react__scenario-discard-confirmation" role="alertdialog" aria-label="Discard Local Injection Scenario" tabIndex={-1} ref={parkedScenarioDiscardDialog} onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        restoreParkedScenarioDiscardFocus.current = true;
        dispatch(runtime, { type: "cancel-discard-scenario" });
      }}><strong>Discard this Scenario?</strong><span>Steps, edits, and Run ledgers cannot be recovered. Discarding sends no further Injection.</span><div className="workbench-react__scenario-discard-actions"><button type="button" onClick={() => {
        restoreParkedScenarioDiscardFocus.current = true;
        dispatch(runtime, { type: "cancel-discard-scenario" });
      }}>Keep Scenario</button><button type="button" onClick={() => dispatch(runtime, { type: "confirm-discard-scenario" })}>Confirm discard Scenario</button></div></section> : null}
      {localInjectionDraft && !snapshot.scenario ? <Suspense fallback={<div className="workbench-react__local-loading" role="status">Loading Local Injection editor…</div>}><LazyLocalInjectionDocument
        runtime={runtime}
        localInjection={localInjection}
        hidden={!localInjectionDraft.open}
        inlineCompare={geometry !== "wide"}
      /></Suspense> : null}
      {serverInjectionDraft && serverInjection ? <Suspense fallback={<div className="workbench-react__local-loading" role="status">Loading Server Injection editor…</div>}><LazyServerInjectionDocument
        runtime={runtime}
        serverInjection={serverInjection}
      /></Suspense> : null}
      {localInjectionDraft?.parked && !snapshot.scenario ? <section className="workbench-react__local-parked" aria-label="Parked Local Injection Draft">
        <div><span className="workbench-react__eyebrow">Parked Local Injection Draft</span><strong>{localInjectionDraft.anchor.subscriptionId} · {localInjectionDraft.anchor.itemName ?? `Item #${localInjectionDraft.anchor.itemPosition ?? "Unknown"}`}</strong></div>
        <span>{localInjectionDraft.ready ? "READY" : "BLOCKED"} · Session {localInjectionDraft.anchor.sessionId ?? "Unknown"} · {localInjectionDraft.compareStatus === "no-source" ? "newly authored" : `Source ${localInjectionDraft.anchor.sourceEventId ?? "Unknown"}`}</span>
        <button type="button" ref={resumeLocalInjection} onClick={() => {
          if (notificationsOpen) dispatch(runtime, { type: "close-notifications" });
          dispatch(runtime, { type: "resume-local-injection" });
        }}>Resume Local Injection Draft</button>
        <button type="button" ref={parkedDiscardTrigger} onClick={() => dispatch(runtime, { type: "request-discard-local-injection" })}>Discard draft</button>
      </section> : null}
      {localInjectionDraft?.parked && localInjection.discardConfirmation ? <section className="workbench-react__local-confirmation workbench-react__local-confirmation--parked" role="alertdialog" aria-label="Discard Local Injection Draft" tabIndex={-1} ref={parkedDiscardDialog} onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        restoreParkedDiscardFocus.current = true;
        dispatch(runtime, { type: "cancel-discard-local-injection" });
      }}>
        <strong>Discard this Local Injection Draft?</strong><span>Its JSON, editor history, and protected target cannot be recovered.</span><button type="button" onClick={() => {
          restoreParkedDiscardFocus.current = true;
          dispatch(runtime, { type: "cancel-discard-local-injection" });
        }}>Keep draft</button><button type="button" onClick={() => dispatch(runtime, { type: "confirm-discard-local-injection" })}>Confirm discard</button>
      </section> : null}
      <NotificationsDocument
        open={notificationsPresented}
        notifications={snapshot.notifications}
        onBack={() => dispatch(runtime, { type: "close-notifications" })}
        onCommand={(command) => dispatch(runtime, command)}
        onInspect={inspectNotification}
      />
      {localInjectionDraft?.open || scenarioOpen || serverInjectionDraft ? null : rawEvidence ? <section className="workbench-react__document" aria-label="Complete raw Evidence">
        <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Complete raw Evidence</span><strong>{rawEvidence.id} · immutable {rawEvidence.source} Evidence</strong></div><div className="workbench-react__document-actions"><button type="button" onClick={() => void copyRawEvidence()}>Copy raw Evidence</button><button type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button></div></header>
        <div className="workbench-react__document-boundary"><span>Source <strong>{rawEvidence.source}</strong></span><span>Phase <strong>{rawEvidence.phase}</strong></span><span>Mutable <strong>NO</strong></span></div>
        <p className="workbench-react__document-status" role="status">{copyStatus}</p>
        <pre tabIndex={0}>{JSON.stringify(rawEvidence.raw, null, 2)}</pre>
      </section> : <main ref={workspace} className="workbench-react__workspace" hidden={notificationsOpen}>
        <nav className="workbench-react__pane workbench-react__scope" id="workbench-runtime-scope" aria-label="Structural runtime scope">
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Runtime Scope</span><strong>Inspected page</strong></div><div><button ref={scopeCollapse} className="workbench-react__scope-collapse" type="button" onClick={() => collapsePane("scope", "collapse")}>Collapse Scope</button><button className="workbench-react__scope-picker-close" type="button" onClick={closeScope}>Close Scope</button><button className="workbench-react__compact-back" type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button></div></header>
          {!scopeSearchOpen ? <div className="workbench-react__scope-search-entry"><button type="button" ref={scopeSearchTrigger} onClick={(event) => openScopeSearch(event.currentTarget)}>Search scopes</button></div> : <ScopeSearch structure={scopeNodes} resolveNode={snapshot.scope.resolveNode} selectedScopeId={snapshot.scope.selection?.id ?? null} onChoose={chooseSearchScope} onClose={closeScopeSearch} focusRequest={scopeSearchFocusRequest} />}
          <div className="workbench-react__scope-tree-host" hidden={scopeSearchOpen}>
          <ScopeTree
            logicalNodeCount={scopeNodes.length}
            visibleNodeCount={visibleScopeNodes.length}
            entries={renderedScopeEntries}
            logicalHeight={visibleScopeNodes.length * SCOPE_NODE_HEIGHT}
            childrenByParent={scopeChildrenByParent}
            siblingPositionById={scopeSiblingPositionById}
            collapsedIds={collapsedScopeIds}
            focusId={scopeTabStopId}
            onDomFocusChange={setScopeTreeHasDomFocus}
            treeRef={scopeTree}
            nodeRefs={scopeNodesById}
            actionsRef={scopeTreeActions}
          />
          </div>
        </nav>
        <div ref={scopeSplitter} className="workbench-react__splitter workbench-react__splitter--scope" role="separator" aria-label="Resize Scope" aria-orientation="vertical" aria-valuemin={SCOPE_MIN_WIDTH} aria-valuemax={SCOPE_MAX_WIDTH} aria-valuenow={renderedScopeWidth} tabIndex={0} onKeyDown={(event) => handleSeparatorKey("scope", event)} onPointerDown={(event) => startResize("scope", event)} />
        <section className="workbench-react__pane workbench-react__evidence" aria-label="Ordered Evidence">
          {snapshot.activity ? <ActivityTimeline projection={snapshot.activity.projection} filter={appliedFilter} frozen={evidence.mode === "frozen"} selectedEventId={selectedEventId} onSelect={selectTimelineEvidence} onShowEvidence={() => evidenceLedger.current?.focus()} onFilter={(expectedRevision, operations) => dispatch(runtime, { type: "apply-filter-mutations", expectedRevision, operations })} /> : null}
          <header className="workbench-react__pane-header"><div><strong>Ordered Evidence</strong></div><div className="workbench-react__evidence-summary">{!activeTimelineRange && shown === matching && matching === inScope ? <span title="All matching Evidence in the current Scope is shown">{shown.toLocaleString()} Evidence</span> : <><span>Shown {shown.toLocaleString()}</span>{!activeTimelineRange && matching === inScope ? <span>Matching {matching.toLocaleString()} in Scope</span> : <>{activeTimelineRange || matching !== shown ? <span>{activeTimelineRange ? "Before range" : "Matching"} {matching.toLocaleString()}</span> : null}<span>{activeTimelineRange ? "In range" : "In Scope"} {inScope.toLocaleString()}</span></>}</>}{hasActiveFilter ? <><span className="workbench-react__active-filter" title={`Filter: ${appliedFilterSummary}`}>Filter: {appliedFilterSummary}</span><button type="button" onClick={() => dispatch(runtime, { type: "reset-filter", expectedRevision: appliedFilter.revision })}>Reset Filter</button></> : null}{selected ? <button type="button" aria-controls="workbench-context" onClick={openContext}>{selectedContextActionLabel}</button> : <button type="button" aria-controls="workbench-context" onClick={openScopeContext}>Open Scope Context</button>}</div></header>
          {filterOpen ? <FilterRegion {...filter.documentProps} /> : null}
          {hiddenSelection ? <div className="workbench-react__condition workbench-react__condition--selection" role="status"><strong>{hiddenSelection.message}</strong><span>Evidence {hiddenSelection.eventId} remains selected in Context.</span><div>{hiddenSelection.canReveal ? <button type="button" onClick={() => dispatch(runtime, { type: "reveal-selected-evidence" })}>Reveal selected Evidence</button> : <button type="button" disabled aria-label="Reveal selected Evidence unavailable">Reveal selected Evidence · Unavailable</button>}{hiddenSelection.canClear ? <button type="button" onClick={() => dispatch(runtime, { type: "clear-evidence-selection" })}>Clear selection</button> : null}</div>{hiddenSelection.revealUnavailableReason ? <small>{hiddenSelection.revealUnavailableReason}</small> : null}</div> : null}
          <div className="workbench-react__evidence-window" data-complete-window={!evidence.hasOlder && !evidence.hasNewer || undefined} aria-label="Retained Evidence window"><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("oldest")}>Oldest</button><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("older")}>Older</button><span>{evidence.visibleStart.toLocaleString()}–{evidence.visibleEnd.toLocaleString()} of {total.toLocaleString()}</span><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newer")}>Newer</button><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newest")}>Newest</button></div>
          {scopedCopyStatus ? <p className="workbench-react__copy-status" role="status">{scopedCopyStatus}</p> : null}
          {evidence.loading && !events.length ? <div className="workbench-react__empty" role="status" aria-live="polite"><strong>Loading Evidence…</strong><span>Resolving the current Scope and Filter.</span></div> : events.length ? <><div className="workbench-react__evidence-stream-toolbar"><EvidenceCodes open={evidenceCodesOpen} onOpenChange={setEvidenceCodesOpen} /><div role="group" aria-label="Evidence payload presentation"><button type="button" aria-pressed={evidencePayloadMode === "readable"} onClick={() => { preserveEvidenceHorizontalScroll(); setEvidencePayloadMode("readable"); }}>Readable</button><button type="button" aria-pressed={evidencePayloadMode === "raw"} onClick={() => { preserveEvidenceHorizontalScroll(); setEvidencePayloadMode("raw"); }}>Raw fields</button></div></div><div className="workbench-react__ledger" role="grid" aria-busy={evidence.loading || undefined} aria-label="Ordered Lightstreamer Evidence" tabIndex={0} ref={evidenceLedger} onKeyDown={handleEvidenceKey}>
            <div className="workbench-react__ledger-header" role="row"><span role="columnheader">Op</span><span role="columnheader">Key / item</span><span role="columnheader">Data</span></div>
            {events.map((event) => {
              const isSelected = event.id === selectedEventId;
              const isFindCurrent = event.id === findState.currentEventId;
              return <EvidenceRow
                key={event.id}
                event={event}
                selected={isSelected}
                findPosition={isFindCurrent ? `Find ${findState.currentIndex + 1} of ${findState.matchCount}` : null}
                findQuery={findOpen ? findState.query : ""}
                rowRefs={evidenceRows}
                actionsRef={evidenceRowActions}
                payloadMode={evidencePayloadMode}
              />;
            })}
          </div></> : <div className="workbench-react__empty"><strong>No Evidence in the current Scope.</strong><span>Capture {captureOperation.toLowerCase()} with Coverage {coverage.toLowerCase()}.</span><button type="button" onClick={(event) => openScope(event.currentTarget)}>Change Scope</button></div>}
        </section>
        <div ref={contextSplitter} className="workbench-react__splitter workbench-react__splitter--context" role="separator" aria-label="Resize Context" aria-orientation={isNormalGeometry() ? "horizontal" : "vertical"} aria-valuemin={contextMinimum} aria-valuemax={Math.min(CONTEXT_MAX_SIZE, contextMaximum)} aria-valuenow={contextSize} tabIndex={0} onKeyDown={(event) => handleSeparatorKey("context", event)} onPointerDown={(event) => startResize("context", event)} />
        <ContextPane
          contextMode={contextMode}
          selected={selected}
          context={stableContext}
          appliedFilter={stableAppliedFilter}
          appliedFilterSummary={appliedFilterSummary}
          hasActiveFilter={hasActiveFilter}
          frozen={evidence.mode === "frozen"}
          activityProjection={snapshot.activity?.projection}
          localInjectionSelectedUpdate={stableLocalInjectionSelectedUpdate}
          serverInjectionAvailability={stableServerInjectionAvailability}
          exportSnapshot={stableExport}
          exportDownloadStatus={exportDownloadStatus}
          activitySummaryOpen={activitySummaryOpen}
          setActivitySummaryOpen={setActivitySummaryOpen}
          selectedFilterActionsOpen={selectedFilterActionsOpen}
          setSelectedFilterActionsOpen={setSelectedFilterActionsOpen}
          selectedEvidenceMetadataOpen={selectedEvidenceMetadataOpen}
          setSelectedEvidenceMetadataOpen={setSelectedEvidenceMetadataOpen}
          sessionSnapshot={contextMode === "actions" ? snapshot : null}
          shown={contextMode === "actions" ? shown : 0}
          analytics={analytics}
          agentConnection={agentConnection}
          contextLens={contextLens}
          contextCollapse={contextCollapse}
          contextBody={contextBody}
          serverInjectionTrigger={serverInjectionTrigger}
          scopedCopyTrigger={scopedCopyTrigger}
          exportTrigger={exportTrigger}
          agentAccessDetails={agentAccessDetails}
          agentAccessControl={agentAccessControl}
          actions={contextActions}
        />
      </main>}
      <WorkbenchFooter
        diagnostics={stableDiagnostics}
        historyAnnouncement={snapshot.historyAnnouncement}
        retained={historyStatus.retained}
        accepted={historyStatus.accepted}
        storageMode={snapshot.storage.mode}
        notificationsTotal={snapshot.notifications.total}
        notificationSeverity={notificationSeverity}
        notificationEntries={notificationsPresented ? stableNotificationEntries : NO_NOTIFICATION_ENTRIES}
        notificationsOpen={notificationsOpen}
        notificationsPresented={notificationsPresented}
        notificationsDisabled={Boolean(localInjectionDraft?.open || scenarioOpen || serverInjectionDraft || rawEvidence)}
        frozen={evidenceMode === "FROZEN"}
        compactDiagnostics={notificationsPresented || geometry === "shallow"}
        notificationsTrigger={notificationsTrigger}
        evidenceModeTrigger={evidenceModeTrigger}
        dismissFocus={dismissFocus}
        actions={footerActions}
      />
    </section>
  );
}
