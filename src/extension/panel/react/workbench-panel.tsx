import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  type WorkbenchCommand,
  type WorkbenchDiagnostic,
  type WorkbenchRuntime,
  type WorkbenchSnapshot
} from "../workbench-runtime";
import {
  TOPOLOGY_SENSITIVE_CATEGORIES,
  topologySnapshotFilename,
  type TopologySensitiveCategory
} from "../topology-export";
import { FACET_DESCRIPTORS, type EvidenceFacetKey } from "../../../core/evidence-facets";
import {
  type FacetCount,
  type FacetDiscoveryResult,
  type TypedFacetValue
} from "../../../core/evidence-filter-contract";
import {
  createTypedFilterValue,
  filterSummary,
  type Filter,
  type FilterMutation,
  type FilterPolarity,
  type TypedFilterValue
} from "../../../core/filter-algebra";
import type { EvidenceFilterActionDescriptor } from "../../../core/evidence-filter-actions";
import { renderTopologyHtmlReport } from "../topology-html-report";
import { WORKBENCH_PUBLIC_RESOURCES } from "../public-resources";
import { UNAVAILABLE_ANALYTICS, type AnalyticsClient } from "../../analytics/client";
import { UsageAnalytics } from "./usage-analytics";
import { ActivityContextSummary } from "./activity-context-summary";
import { ActivityTimeline } from "./activity-timeline";
import { NotificationsDocument } from "./notifications-document";
import { activityRangeLabel } from "./activity-timeline-format";
import type { TimelineEvidenceAnchor } from "./activity-timeline-events";

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

export type WorkbenchPanelProps = { runtime: WorkbenchRuntime; analytics?: AnalyticsClient };

type ScopeNode = WorkbenchSnapshot["scope"]["nodes"][number];
type ScopeTreeEntry = { node: ScopeNode; index: number };
type ScopeTreeActions = {
  scroll(scrollTop: number): void;
  focus(scopeId: string): void;
  commit(scopeId: string): void;
  key(event: ReactKeyboardEvent<HTMLButtonElement>, node: ScopeNode): void;
};

function SelectedUpdateDetails({
  update
}: Readonly<{ update: WorkbenchSnapshot["context"]["selectedUpdate"] }>): JSX.Element | null {
  if (!update) return null;
  const fieldEntries = update.fields;
  return <section className="workbench-react__selected-update" aria-label="Selected update">
    <h3>Selected update</h3>
    <section aria-label="Fields">
      <h4>Fields</h4>
      {fieldEntries.length ? <dl>{fieldEntries.flatMap((entry) => [
        <dt key={`fields-${entry.name}-term`}>{entry.name}</dt>,
        <dd key={`fields-${entry.name}-value`}>
          {entry.jsonString ? <span className="workbench-react__json-string-marker">JSON string</span> : null}
          <pre>{entry.display}</pre>
        </dd>
      ])}</dl> : <p>No captured fields.</p>}
    </section>
  </section>;
}

function SelectedFilterActions({
  actions,
  expectedRevision,
  open,
  onOpenChange,
  onAction
}: Readonly<{
  actions: readonly EvidenceFilterActionDescriptor[];
  expectedRevision: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onAction(action: EvidenceFilterActionDescriptor): void;
}>): JSX.Element | null {
  const summaryRef = useRef<HTMLElement>(null);
  const focusWithin = useRef(false);
  const previousActionCount = useRef(actions.length);
  useLayoutEffect(() => {
    const actionsBecameUnavailable = previousActionCount.current > 0 && actions.length === 0;
    previousActionCount.current = actions.length;
    if (actionsBecameUnavailable && focusWithin.current) summaryRef.current?.focus();
  }, [actions.length]);
  return <details
    className="workbench-react__filter-actions workbench-context-disclosure"
    aria-label="Filter selected Evidence"
    open={open}
    onToggle={event => onOpenChange(event.currentTarget.open)}
    onFocusCapture={() => { focusWithin.current = true; }}
    onBlurCapture={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
    }}
  >
    <summary ref={summaryRef}>Filter selected Evidence</summary>
    <div className="workbench-react__filter-actions-content">
      {actions.length ? <>
        <p>Typed actions apply immediately to Filter revision {expectedRevision} and preserve unrelated Criteria.</p>
        <div className="workbench-react__filter-action-list" role="list" aria-label="Selected Evidence Filter actions">
          {actions.map((action) => {
            const valueLabel = action.kind === "around"
              ? "Retained Evidence interval"
              : `${action.facetDescriptor?.label ?? action.facet ?? "Evidence value"}: ${action.value?.label ?? "Unavailable"}`;
            const controlLabel = action.kind === "around"
              ? action.label
              : action.kind === "include"
                ? `Include ${valueLabel}; typed identity ${action.value?.identity ?? "unavailable"}`
                : `Exclude ${valueLabel}; typed identity ${action.value?.identity ?? "unavailable"}`;
            return <div className="workbench-react__filter-action-row" role="listitem" key={action.id} data-filter-action-kind={action.kind} data-filter-facet={action.facet}>
              <span>{valueLabel}</span>
              <button type="button" aria-label={controlLabel} onClick={() => onAction(action)}>{action.kind === "around" ? "Around" : action.kind === "include" ? "Include" : "Exclude"}</button>
            </div>;
          })}
        </div>
      </> : <p role="status">No typed Filter actions are available for this Evidence.</p>}
    </div>
  </details>;
}

const ScopeTreeRow = memo(function ScopeTreeRow({
  node,
  index,
  siblingPosition,
  hasChildren,
  collapsed,
  focused,
  nodeRefs,
  actionsRef
}: {
  node: ScopeNode;
  index: number;
  siblingPosition: { position: number; size: number } | undefined;
  hasChildren: boolean;
  collapsed: boolean;
  focused: boolean;
  nodeRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: ScopeTreeActions };
}): JSX.Element {
  return (
    <button
      className="workbench-react__scope-node workbench-react__scope-node--windowed"
      role="treeitem"
      aria-level={node.depth + 1}
      aria-posinset={siblingPosition?.position}
      aria-setsize={siblingPosition?.size}
      aria-selected={node.selected}
      aria-current={node.selected ? "true" : undefined}
      data-retired={node.retired || undefined}
      data-scope-id={node.id}
      aria-expanded={hasChildren ? !collapsed : undefined}
      tabIndex={focused ? 0 : -1}
      style={{
        top: `${index * SCOPE_NODE_HEIGHT}px`,
        "--workbench-scope-indent": `${node.depth * 10}px`
      } as CSSProperties}
      ref={(element) => {
        if (element) nodeRefs.current.set(node.id, element);
        else nodeRefs.current.delete(node.id);
      }}
      onClick={() => {
        actionsRef.current.focus(node.id);
        actionsRef.current.commit(node.id);
      }}
      onFocus={() => actionsRef.current.focus(node.id)}
      onKeyDown={(event) => actionsRef.current.key(event, node)}
    >
      <span className="workbench-react__scope-type">{scopeKindLabel(node.kind)}</span>
      <strong className="workbench-react__scope-identity" title={node.label}>{node.label}</strong>
      <em className="workbench-react__scope-state">{lifecycleLabel(node.lifecycle)}</em>
      {node.detail ? <span className="workbench-react__scope-facts" title={node.detail}>{node.detail}</span> : null}
    </button>
  );
});

const ScopeTree = memo(function ScopeTree({
  logicalNodeCount,
  visibleNodeCount,
  entries,
  logicalHeight,
  childrenByParent,
  siblingPositionById,
  collapsedIds,
  focusId,
  onDomFocusChange,
  treeRef,
  nodeRefs,
  actionsRef
}: {
  logicalNodeCount: number;
  visibleNodeCount: number;
  entries: readonly ScopeTreeEntry[];
  logicalHeight: number;
  childrenByParent: ReadonlyMap<
    string | null,
    readonly WorkbenchSnapshot["scope"]["structure"][number][]
  >;
  siblingPositionById: ReadonlyMap<string, { position: number; size: number }>;
  collapsedIds: ReadonlySet<string>;
  focusId: string | null;
  onDomFocusChange(hasFocus: boolean): void;
  treeRef: { current: HTMLDivElement | null };
  nodeRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: ScopeTreeActions };
}): JSX.Element {
  return (
    <div
      className="workbench-react__scope-tree"
      role="tree"
      aria-label={`Runtime Scope tree · ${logicalNodeCount.toLocaleString()} nodes`}
      data-logical-node-count={logicalNodeCount}
      data-visible-node-count={visibleNodeCount}
      data-mounted-node-count={entries.length}
      ref={treeRef}
      onScroll={(event) => actionsRef.current.scroll(event.currentTarget.scrollTop)}
      onFocusCapture={() => onDomFocusChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDomFocusChange(false);
      }}
    >
      <div
        className="workbench-react__scope-tree-window"
        role="presentation"
        style={{ height: `${logicalHeight}px` }}
      >
        {entries.map(({ node, index }) => {
          const siblingPosition = siblingPositionById.get(node.id);
          const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
          return (
            <ScopeTreeRow
              key={node.id}
              node={node}
              index={index}
              siblingPosition={siblingPosition}
              hasChildren={hasChildren}
              collapsed={collapsedIds.has(node.id)}
              focused={node.id === focusId}
              nodeRefs={nodeRefs}
              actionsRef={actionsRef}
            />
          );
        })}
      </div>
    </div>
  );
});

type EvidenceRowActions = { select(eventId: string): void };

const EvidenceRow = memo(function EvidenceRow({
  event,
  selected,
  findPosition,
  rowRefs,
  actionsRef
}: {
  event: WorkbenchSnapshot["evidence"]["events"][number];
  selected: boolean;
  findPosition: string | null;
  rowRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: EvidenceRowActions };
}): JSX.Element {
  const orderLabel = evidenceOrderLabel(event.sequence);
  return (
    <button
      type="button"
      className="workbench-react__evidence-row"
      role="row"
      data-evidence-id={event.id}
      data-evidence-sequence={event.sequence ?? undefined}
      data-find-current={findPosition ? true : undefined}
      aria-selected={selected}
      aria-current={findPosition ? "true" : undefined}
      title={`${event.id} — ${event.kind} — ${event.object} — ${event.commandKey ?? "No COMMAND key"}`}
      tabIndex={-1}
      ref={(element) => {
        if (element) rowRefs.current.set(event.id, element);
        else rowRefs.current.delete(event.id);
      }}
      onClick={() => actionsRef.current.select(event.id)}
    >
      <span className="workbench-react__evidence-order" role="gridcell" aria-label={`History sequence ${orderLabel}; Evidence identity ${event.id}`}>
        <small>Event</small>
        <strong title={event.id}>{orderLabel}</strong>
        {findPosition ? <small className="workbench-react__find-match">{findPosition}</small> : null}
      </span>
      <span className="workbench-react__evidence-meaning" role="gridcell">
        <strong>{event.kind}</strong>
        <small><time>{event.time}</time> · {event.source} · {event.phase}</small>
      </span>
      <b className="workbench-react__evidence-command" role="gridcell">{event.command ?? "—"}</b>
      <span className="workbench-react__evidence-object" role="gridcell">
        <strong title={event.object}>{event.object}</strong>
        <small title={event.commandKey ?? "No COMMAND key"}>Key {event.commandKey ?? "—"}</small>
      </span>
    </button>
  );
});

function dispatch(runtime: WorkbenchRuntime, command: WorkbenchCommand): void {
  runtime.dispatch(command);
}

function uppercase(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replaceAll("-", "_").toUpperCase();
}

function evidenceOrderLabel(sequence: number | null): string {
  return sequence === null ? "—" : String(sequence);
}

type FilterComposerStep = "composer" | "facets" | "explorer";

function cloneFilterCriteria(criteria: Filter["criteria"]): Filter["criteria"] {
  return Object.fromEntries(Object.entries(criteria).map(([facet, criterion]) => [facet, {
    include: [...criterion.include],
    exclude: [...criterion.exclude]
  }])) as Filter["criteria"];
}

function criterionSignature(criterion: Filter["criteria"][string] | undefined): string {
  if (!criterion) return "";
  return JSON.stringify({
    include: criterion.include.map(({ identity }) => identity).sort(),
    exclude: criterion.exclude.map(({ identity }) => identity).sort()
  });
}

function draftFilterOperations(
  applied: Filter,
  text: string,
  criteria: Filter["criteria"]
): readonly FilterMutation[] {
  const operations: FilterMutation[] = [];
  if (applied.text !== text.trim().toLocaleLowerCase()) operations.push({ type: "set-text", text });
  const facets = new Set([...Object.keys(applied.criteria), ...Object.keys(criteria)]);
  for (const facet of facets) {
    const current = applied.criteria[facet];
    const next = criteria[facet];
    if (criterionSignature(current) === criterionSignature(next)) continue;
    operations.push({
      type: "replace-facet",
      facet,
      criterion: next ?? { include: [], exclude: [] }
    });
  }
  return operations;
}

function filterValueForDraft(value: TypedFacetValue): TypedFilterValue {
  let scalar: string | number | boolean | null = value.value;
  if (value.type === "number") scalar = Number(value.value);
  else if (value.type === "boolean") scalar = value.value === "true";
  else if (value.type === "null") scalar = null;
  return createTypedFilterValue(value.facet, value.type, scalar, value.label);
}

function discoveryUnavailableMessage(result: Extract<FacetDiscoveryResult, { state: "UNAVAILABLE" }>): string {
  switch (result.reason) {
    case "ZERO_BASE": return "No Evidence is in the current Scope, so there are no values to discover.";
    case "NO_CONCRETE_VALUES": return "No observed concrete values exist for this facet at the current read point.";
    case "DISCOVERY_FAILED": return "Exact value discovery is unavailable for this read point. The Evidence query remains usable.";
    case "UNSUPPORTED_AT_READ_POINT": return "This facet is unavailable at the current read point.";
  }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
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

type WorkbenchGeometry = "wide" | "normal" | "shallow" | "compact";

const SCOPE_MIN_WIDTH = 216;
const SCOPE_MAX_WIDTH = 420;
const EVIDENCE_MIN_WIDTH = 520;
const EVIDENCE_MIN_HEIGHT = 220;
const EVIDENCE_STACK_BUDGET = 244;
const CONTEXT_MIN_WIDTH = 320;
const CONTEXT_MIN_HEIGHT = 210;
const CONTEXT_MAX_SIZE = 520;
const SPLITTER_SIZE = 6;
const PERSISTENT_CHROME_HEIGHT = 90;
const NORMAL_MIN_WIDTH = 700;
const NORMAL_MIN_HEIGHT = PERSISTENT_CHROME_HEIGHT + EVIDENCE_MIN_HEIGHT + CONTEXT_MIN_HEIGHT + SPLITTER_SIZE;
const SHALLOW_MIN_WIDTH = EVIDENCE_MIN_WIDTH + CONTEXT_MIN_WIDTH + SPLITTER_SIZE;
const WIDE_MIN_WIDTH = Math.max(1120, SCOPE_MIN_WIDTH + EVIDENCE_MIN_WIDTH + CONTEXT_MIN_WIDTH + SPLITTER_SIZE * 2);
const GEOMETRY_HYSTERESIS = 32;
const SCOPE_NODE_HEIGHT = 58;
const EVIDENCE_ROW_HEIGHT = 52;
const SCOPE_WINDOW_OVERSCAN = 8;
const SCOPE_FALLBACK_VIEWPORT_ROWS = 48;
const SCOPE_MAX_WINDOW_SIZE = 127;

function classifyGeometry(width: number, height: number): WorkbenchGeometry {
  if (width >= WIDE_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT) return "wide";
  if (width >= NORMAL_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT) return "normal";
  if (width >= SHALLOW_MIN_WIDTH) return "shallow";
  return "compact";
}

function geometryFits(geometry: WorkbenchGeometry, width: number, height: number): boolean {
  if (geometry === "wide") return width >= WIDE_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT;
  if (geometry === "normal") return width >= NORMAL_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT;
  if (geometry === "shallow") return width >= SHALLOW_MIN_WIDTH;
  return true;
}

function decideGeometry(width: number, height: number, previous?: WorkbenchGeometry): WorkbenchGeometry {
  if (!previous) return classifyGeometry(width, height);
  if (!geometryFits(previous, width, height)) return classifyGeometry(width, height);
  if (previous === "wide") return "wide";
  if (width >= WIDE_MIN_WIDTH + GEOMETRY_HYSTERESIS && height >= NORMAL_MIN_HEIGHT + GEOMETRY_HYSTERESIS) return "wide";
  if (previous === "normal") return "normal";
  if (width >= NORMAL_MIN_WIDTH + GEOMETRY_HYSTERESIS && height >= NORMAL_MIN_HEIGHT + GEOMETRY_HYSTERESIS) return "normal";
  if (previous === "shallow") return "shallow";
  if (width >= SHALLOW_MIN_WIDTH + GEOMETRY_HYSTERESIS) return "shallow";
  return "compact";
}

function lifecycleLabel(lifecycle: WorkbenchSnapshot["scope"]["nodes"][number]["lifecycle"]): string {
  return `${lifecycle.slice(0, 1).toUpperCase()}${lifecycle.slice(1)}`;
}

function scopeKindLabel(kind: WorkbenchSnapshot["scope"]["nodes"][number]["kind"]): string {
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** React presentation for the Slice 1 read-only Scoped Evidence Workspace. */
export function WorkbenchPanel({ runtime, analytics = UNAVAILABLE_ANALYTICS }: WorkbenchPanelProps): JSX.Element {
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
  const pendingScopeEntryFocus = useRef(false);
  const pendingContextFocus = useRef(false);
  const pendingRetainedBoundaryFocus = useRef<"oldest" | "newest" | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [scopedCopyStatus, setScopedCopyStatus] = useState("");
  const [exportDownloadStatus, setExportDownloadStatus] = useState("");
  const operationFocusOrigin = useRef<"copy" | "export" | null>(null);
  const scopedCopyTrigger = useRef<HTMLButtonElement | null>(null);
  const exportTrigger = useRef<HTMLButtonElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [geometry, setGeometry] = useState<WorkbenchGeometry>(() => decideGeometry(window.innerWidth, window.innerHeight));
  const [scopeWidth, setScopeWidth] = useState(228);
  const [wideContextWidth, setWideContextWidth] = useState(350);
  const [normalContextHeight, setNormalContextHeight] = useState(260);
  const workspace = useRef<HTMLElement | null>(null);
  const pressureChrome = useRef<string | null>(null);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [shallowContextWidth, setShallowContextWidth] = useState(320);
  const [scopeCollapsed, setScopeCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [activitySummaryOpen, setActivitySummaryOpen] = useState(false);
  const [selectedFilterActionsOpen, setSelectedFilterActionsOpen] = useState(false);
  const [selectedEvidenceMetadataOpen, setSelectedEvidenceMetadataOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState("");
  const [filterDraftCriteria, setFilterDraftCriteria] = useState<Filter["criteria"]>({});
  const [filterStep, setFilterStep] = useState<FilterComposerStep>("composer");
  const [filterFacet, setFilterFacet] = useState<EvidenceFacetKey | null>(null);
  const [filterDiscoverySearch, setFilterDiscoverySearch] = useState("");
  const [filterDiscoveryCursor, setFilterDiscoveryCursor] = useState<string | null>(null);
  const [filterDiscoveryValues, setFilterDiscoveryValues] = useState<readonly FacetCount[]>([]);
  const [filterDraftRevision, setFilterDraftRevision] = useState<number | null>(null);
  const [filterSubmitVersion, setFilterSubmitVersion] = useState<number | null>(null);
  const [collapsedScopeIds, setCollapsedScopeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [scopeWindowStart, setScopeWindowStart] = useState(0);
  const [scopeTreeHeight, setScopeTreeHeight] = useState(SCOPE_NODE_HEIGHT * SCOPE_FALLBACK_VIEWPORT_ROWS);
  const [scopeTreeHasDomFocus, setScopeTreeHasDomFocus] = useState(false);
  const scopeTypeahead = useRef("");
  const scopeTypeaheadReset = useRef<number | null>(null);
  const findInput = useRef<HTMLInputElement | null>(null);
  const findTrigger = useRef<HTMLButtonElement | null>(null);
  const filterInput = useRef<HTMLInputElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const structuredCriterionTrigger = useRef<HTMLButtonElement | null>(null);
  const facetPickerFirst = useRef<HTMLButtonElement | null>(null);
  const facetButtons = useRef(new Map<EvidenceFacetKey, HTMLButtonElement>());
  const facetReturnKey = useRef<EvidenceFacetKey | null>(null);
  const facetSearchInput = useRef<HTMLInputElement | null>(null);
  const moreActionsTrigger = useRef<HTMLButtonElement | null>(null);
  const notificationsTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceModeTrigger = useRef<HTMLButtonElement | null>(null);
  const diagnosticDismissButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusedDiagnosticDismiss = useRef<Readonly<{ dismissalId: string; index: number }> | null>(null);
  const pendingDiagnosticDismissFocus = useRef<number | null>(null);
  const notificationsOrigin = useRef({ evidenceScrollTop: 0, contextScrollTop: 0, scopeScrollTop: 0 });
  const previousNotificationsOpen = useRef(false);
  const inspectingNotification = useRef(false);
  const scopeTrigger = useRef<HTMLButtonElement | null>(null);
  const contextLens = useRef<HTMLElement | null>(null);
  const workbenchRoot = useRef<HTMLElement | null>(null);
  const scopeSplitter = useRef<HTMLDivElement | null>(null);
  const contextSplitter = useRef<HTMLDivElement | null>(null);
  const scopeRestore = useRef<HTMLButtonElement | null>(null);
  const contextRestore = useRef<HTMLButtonElement | null>(null);
  const resumeLocalInjection = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardTrigger = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardDialog = useRef<HTMLElement | null>(null);
  const restoreParkedDiscardFocus = useRef(false);
  const previousLocalInjectionDraft = useRef<WorkbenchSnapshot["localInjection"]["draft"]>(null);
  const serverInjectionTrigger = useRef<HTMLButtonElement | null>(null);
  const previousServerInjectionDraft = useRef<NonNullable<WorkbenchSnapshot["serverInjection"]>["draft"]>(null);
  const previousScenario = useRef<WorkbenchSnapshot["scenario"]>(null);
  const previousParkedDiscardConfirmation = useRef(false);
  const scopeCollapse = useRef<HTMLButtonElement | null>(null);
  const contextCollapse = useRef<HTMLButtonElement | null>(null);
  const paneRestoreDestination = useRef<{ scope: "splitter" | "collapse"; context: "splitter" | "collapse" }>({ scope: "splitter", context: "splitter" });
  const pendingPaneFocus = useRef<{ pane: "scope" | "context"; target: "restore" | "splitter" | "collapse" } | null>(null);
  const findOrigin = useRef<HTMLElement | null>(null);
  const filterOrigin = useRef<HTMLElement | null>(null);
  const actionsEvidenceScrollTop = useRef(0);
  const actionsContextScrollTop = useRef(0);
  const pendingActionsRestoration = useRef(false);
  const pendingActionsFocus = useRef(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
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
  const theme = snapshot.theme;
  const findState = evidence.findState;
  const hiddenSelection = evidence.hiddenSelection;
  const contextFields = snapshot.context.fields;
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
  }, [collapsedScopeIds, snapshot.scope.structureRevision]);
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
  const canCreateLocalInjectionDraft = snapshot.localInjection.availability.selectedUpdate.available;
  const serverInjection = snapshot.serverInjection;
  const serverInjectionDraft = serverInjection?.draft ?? null;
  const canCloneClientMessage = serverInjection?.availability.cloneSelected.available ?? false;
  const canAuthorClientMessage = serverInjection?.availability.authorSelectedClient.available ?? false;
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
  const activeFacetDescriptor = filterFacet
    ? FACET_DESCRIPTORS.find((descriptor) => descriptor.key === filterFacet) ?? null
    : null;
  const activeFacetDiscovery = filterFacet
    ? evidence.investigation.discoveries.get(filterFacet)
    : undefined;

  useLayoutEffect(() => {
    if (activeFacetDiscovery?.state !== "AVAILABLE" || evidence.investigation.queryState === "loading") return;
    setFilterDiscoveryValues((previous) => {
      if (!filterDiscoveryCursor) return activeFacetDiscovery.values;
      const identities = new Set(previous.map((entry) => entry.value.identity));
      return Object.freeze([...previous, ...activeFacetDiscovery.values.filter((entry) => !identities.has(entry.value.identity))]);
    });
  }, [activeFacetDiscovery, evidence.investigation.queryState, filterDiscoveryCursor]);

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
  const notificationsPresented = notificationsOpen && !localInjectionDraft?.open && !snapshot.scenario && !serverInjectionDraft;
  const contextMode = snapshot.contextId === "context:actions"
    ? "actions"
    : snapshot.contextId === "context:export"
      ? "export"
      : "inspect";
  const workspaceAvailable = !localInjectionDraft?.open && !snapshot.scenario && !serverInjectionDraft && !rawEvidence && !notificationsOpen;
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
  const wideSideBudget = Math.max(SCOPE_MIN_WIDTH + CONTEXT_MIN_WIDTH, viewport.width - EVIDENCE_MIN_WIDTH - SPLITTER_SIZE * 2);
  const renderedScopeWidth = geometry === "wide"
    ? clamp(scopeWidth, SCOPE_MIN_WIDTH, wideSideBudget - CONTEXT_MIN_WIDTH)
    : scopeWidth;
  const chromeLayoutKey = JSON.stringify([findOpen, snapshot.diagnostics.map(diagnostic => [
    diagnostic.severity, diagnostic.title, diagnostic.affected, diagnostic.detail,
    diagnostic.limitation, diagnostic.consequence, diagnostic.recovery, diagnostic.route?.label
  ])]);
  const availableWorkspaceHeight = workspaceHeight || viewport.height - PERSISTENT_CHROME_HEIGHT;
  const contextMaximum = geometry === "normal"
    ? Math.max(CONTEXT_MIN_HEIGHT, availableWorkspaceHeight - EVIDENCE_STACK_BUDGET - SPLITTER_SIZE)
    : geometry === "shallow"
      ? Math.max(CONTEXT_MIN_WIDTH, viewport.width - EVIDENCE_MIN_WIDTH - SPLITTER_SIZE)
      : geometry === "wide"
        ? Math.max(CONTEXT_MIN_WIDTH, wideSideBudget - renderedScopeWidth)
        : CONTEXT_MAX_SIZE;
  const contextMinimum = geometry === "normal" ? CONTEXT_MIN_HEIGHT : CONTEXT_MIN_WIDTH;
  const contextPreference = geometry === "normal" ? normalContextHeight : geometry === "shallow" ? shallowContextWidth : wideContextWidth;
  const contextSize = clamp(contextPreference, contextMinimum, Math.min(CONTEXT_MAX_SIZE, contextMaximum));

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height <= 0) return;
      setWorkspaceHeight(height);
      if (geometry === "normal") {
        if (!contextCollapsed && height < EVIDENCE_STACK_BUDGET + CONTEXT_MIN_HEIGHT + SPLITTER_SIZE) {
          pressureChrome.current = chromeLayoutKey;
          setGeometry(previous => previous === "normal" ? classifyGeometry(window.innerWidth, 0) : previous);
        } else pressureChrome.current = null;
      } else if (pressureChrome.current !== null && pressureChrome.current !== chromeLayoutKey) {
        // Retry after real chrome changes, never merely because Shallow rendered
        // a shorter footer. A failed retry records these inputs before demoting.
        pressureChrome.current = null;
        setGeometry(decideGeometry(window.innerWidth, window.innerHeight, "normal"));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspaceAvailable, geometry, contextCollapsed, chromeLayoutKey]);

  useLayoutEffect(() => {
    if (["error", "refused", "cancelled"].includes(snapshot.evidenceCopy.state)) {
      setScopedCopyStatus(snapshot.evidenceCopy.error ?? "Retained scoped Evidence was not copied.");
      dispatch(runtime, { type: "clear-scoped-evidence-copy" });
      return;
    }
    if (snapshot.evidenceCopy.state !== "ready" || !snapshot.evidenceCopy.text) return;
    if (!navigator.clipboard?.writeText) {
      setScopedCopyStatus("Could not copy retained scoped Evidence.");
      analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "unavailable" } });
      dispatch(runtime, { type: "clear-scoped-evidence-copy" });
      return;
    }
    void navigator.clipboard.writeText(snapshot.evidenceCopy.text).then(
      () => { setScopedCopyStatus(`Copied retained scoped Evidence (${snapshot.evidenceCopy.eventCount.toLocaleString()} events).`); analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "success" } }); },
      () => { setScopedCopyStatus("Could not copy retained scoped Evidence."); analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "failed" } }); }
    ).finally(() => dispatch(runtime, { type: "clear-scoped-evidence-copy" }));
  }, [snapshot.evidenceCopy, analytics]);

  useLayoutEffect(() => {
    const copyFinished = snapshot.evidenceCopy.state !== "preparing" && operationFocusOrigin.current === "copy";
    const exportFinished = snapshot.export.operation?.state !== "preparing" && operationFocusOrigin.current === "export";
    if (!copyFinished && !exportFinished) return;
    const origin = operationFocusOrigin.current;
    operationFocusOrigin.current = null;
    window.requestAnimationFrame(() => {
      const target = origin === "copy" ? scopedCopyTrigger.current : exportTrigger.current ?? contextLens.current;
      if (target?.isConnected) target.focus();
      else if (contextLens.current?.isConnected) contextLens.current.focus();
    });
  }, [snapshot.evidenceCopy.state, snapshot.export.operation?.state]);

  useLayoutEffect(() => () => resizeCleanup.current?.(), []);

  useLayoutEffect(() => {
    const updateGeometry = () => {
      pressureChrome.current = null;
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setViewport(nextViewport);
      setGeometry((previous) => decideGeometry(nextViewport.width, nextViewport.height, previous));
    };
    window.addEventListener("resize", updateGeometry);
    return () => window.removeEventListener("resize", updateGeometry);
  }, []);

  const moveEvidence = (offset: number) => {
    const currentIndex = Math.max(0, events.findIndex((event) => event.id === focusedEventId));
    const next = events[Math.min(Math.max(currentIndex + offset, 0), events.length - 1)];
    if (next) {
      pendingEvidenceFocus.current = next.id;
      dispatch(runtime, { type: "focus-evidence", eventId: next.id });
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

  const isCompactGeometry = () => geometry === "compact";
  const isNormalGeometry = () => geometry === "normal";
  const isShallowGeometry = () => geometry === "shallow";
  const adjustPane = (pane: "scope" | "context", delta: number) => {
    if (pane === "scope") setScopeWidth((size) => clamp(size + delta, SCOPE_MIN_WIDTH, SCOPE_MAX_WIDTH));
    else if (isNormalGeometry()) setNormalContextHeight((size) => clamp(size + delta, CONTEXT_MIN_HEIGHT, CONTEXT_MAX_SIZE));
    else if (isShallowGeometry()) setShallowContextWidth((size) => clamp(size + delta, CONTEXT_MIN_WIDTH, CONTEXT_MAX_SIZE));
    else setWideContextWidth((size) => clamp(size + delta, CONTEXT_MIN_WIDTH, CONTEXT_MAX_SIZE));
  };
  const setPaneBoundary = (pane: "scope" | "context", boundary: "start" | "end") => {
    if (pane === "scope") setScopeWidth(boundary === "start" ? SCOPE_MIN_WIDTH : SCOPE_MAX_WIDTH);
    else {
      const size = boundary === "start" ? CONTEXT_MAX_SIZE : isNormalGeometry() ? CONTEXT_MIN_HEIGHT : CONTEXT_MIN_WIDTH;
      if (isNormalGeometry()) setNormalContextHeight(size);
      else if (isShallowGeometry()) setShallowContextWidth(size);
      else setWideContextWidth(size);
    }
  };
  const collapsePane = (pane: "scope" | "context", restoreDestination: "splitter" | "collapse" = "splitter") => {
    paneRestoreDestination.current[pane] = restoreDestination;
    pendingPaneFocus.current = { pane, target: "restore" };
    if (pane === "scope") setScopeCollapsed(true);
    else setContextCollapsed(true);
  };
  const restorePane = (pane: "scope" | "context") => {
    pendingPaneFocus.current = { pane, target: paneRestoreDestination.current[pane] };
    if (pane === "scope") setScopeCollapsed(false);
    else setContextCollapsed(false);
  };
  const handleSeparatorKey = (pane: "scope" | "context", keyEvent: ReactKeyboardEvent<HTMLDivElement>) => {
    const horizontal = pane === "context" && isNormalGeometry();
    const increment = keyEvent.shiftKey ? 72 : 24;
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      collapsePane(pane);
      return;
    }
    if (keyEvent.key === "Home" || keyEvent.key === "End") {
      keyEvent.preventDefault();
      setPaneBoundary(pane, keyEvent.key === "Home" ? "start" : "end");
      return;
    }
    const decrease = horizontal ? "ArrowUp" : "ArrowLeft";
    const increase = horizontal ? "ArrowDown" : "ArrowRight";
    if (keyEvent.key === decrease || keyEvent.key === increase) {
      keyEvent.preventDefault();
      const splitterMovement = keyEvent.key === increase ? increment : -increment;
      adjustPane(pane, pane === "context" ? -splitterMovement : splitterMovement);
    }
  };
  const startResize = (pane: "scope" | "context", pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (isCompactGeometry() || (pane === "scope" && geometry !== "wide")) return;
    pointerEvent.preventDefault();
    resizeCleanup.current?.();
    let previous = pane === "context" && isNormalGeometry() ? pointerEvent.clientY : pointerEvent.clientX;
    const move = (event: PointerEvent) => {
      const current = pane === "context" && isNormalGeometry() ? event.clientY : event.clientX;
      const splitterMovement = current - previous;
      adjustPane(pane, pane === "context" ? -splitterMovement : splitterMovement);
      previous = current;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      resizeCleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    resizeCleanup.current = end;
  };

  const openScope = (origin: HTMLButtonElement) => {
    scopeTrigger.current = origin;
    pendingScopeEntryFocus.current = true;
    if (isCompactGeometry()) {
      dispatch(runtime, { type: "open-scope" });
      return;
    }
    if (geometry === "wide") {
      if (scopeCollapsed) setScopeCollapsed(false);
      else {
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
    setScopePickerOpen(false);
    scopeTrigger.current?.focus();
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

  const openFind = (origin: HTMLElement) => {
    findOrigin.current = origin;
    setFindOpen(true);
  };

  const closeFind = () => {
    if (findState.query) dispatch(runtime, { type: "clear-find" });
    setFindOpen(false);
    window.requestAnimationFrame(() => {
      (findOrigin.current?.isConnected ? findOrigin.current : findTrigger.current)?.focus();
    });
  };

  const openFilter = (origin: HTMLElement) => {
    clearFilterDiscovery();
    filterOrigin.current = origin;
    setFilterDraft(appliedFilter.text);
    setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    setFilterStep("composer");
    setFilterFacet(null);
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    facetReturnKey.current = null;
    setFilterDraftRevision(appliedFilter.revision);
    setFilterOpen(true);
  };

  const clearFilterDiscovery = () => {
    runtime.dispatch({ type: "request-filter-discovery", request: null });
  };

  const closeFilter = () => {
    clearFilterDiscovery();
    setFilterDraft(appliedFilter.text);
    setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    setFilterStep("composer");
    setFilterFacet(null);
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    facetReturnKey.current = null;
    setFilterDraftRevision(null);
    setFilterOpen(false);
    window.requestAnimationFrame(() => {
      (filterOrigin.current?.isConnected ? filterOrigin.current : filterTrigger.current)?.focus();
    });
  };

  const openStructuredCriteria = () => {
    setFilterStep("facets");
    window.requestAnimationFrame(() => facetPickerFirst.current?.focus());
  };

  const openFacetExplorer = (facet: EvidenceFacetKey) => {
    facetReturnKey.current = facet;
    setFilterFacet(facet);
    setFilterStep("explorer");
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    runtime.dispatch({ type: "request-filter-discovery", request: { facet, size: 12 } });
    window.requestAnimationFrame(() => facetSearchInput.current?.focus());
  };

  const requestFacetDiscovery = (search: string, cursor: string | null = null) => {
    if (!filterFacet) return;
    runtime.dispatch({
      type: "request-filter-discovery",
      request: {
        facet: filterFacet,
        size: 12,
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {})
      }
    });
  };

  const chooseFacetValue = (value: TypedFacetValue, polarity: FilterPolarity) => {
    const draftValue = filterValueForDraft(value);
    setFilterDraftCriteria((previous) => {
      const current = previous[value.facet] ?? { include: [], exclude: [] };
      const inInclude = current.include.some((candidate) => candidate.identity === draftValue.identity);
      const inExclude = current.exclude.some((candidate) => candidate.identity === draftValue.identity);
      const selected = polarity === "include" ? inInclude : inExclude;
      const include = current.include.filter((candidate) => candidate.identity !== draftValue.identity);
      const exclude = current.exclude.filter((candidate) => candidate.identity !== draftValue.identity);
      if (!selected) (polarity === "include" ? include : exclude).push(draftValue);
      return {
        ...previous,
        [value.facet]: { include, exclude }
      };
    });
  };

  const handleFilterEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (filterStep === "explorer") {
      clearFilterDiscovery();
      setFilterStep("facets");
      setFilterFacet(null);
      setFilterDiscoveryCursor(null);
      window.requestAnimationFrame(() => {
        const target = (facetReturnKey.current ? facetButtons.current.get(facetReturnKey.current) : null) ?? facetPickerFirst.current;
        target?.focus();
      });
      return;
    }
    if (filterStep === "facets") {
      setFilterStep("composer");
      window.requestAnimationFrame(() => structuredCriterionTrigger.current?.focus());
      return;
    }
    closeFilter();
  };

  useLayoutEffect(() => {
    if (filterSubmitVersion === null || snapshot.version <= filterSubmitVersion) return;
    const mutation = evidence.filterMutation;
    if (mutation.state === "stale") {
      setFilterDraftRevision(mutation.revision);
      setFilterSubmitVersion(null);
      return;
    }
    if (mutation.state === "invalid") {
      setFilterSubmitVersion(null);
      return;
    }
    if (mutation.state === "applied" || mutation.state === "no-op") {
      setFilterSubmitVersion(null);
      closeFilter();
    }
  }, [evidence.filterMutation, filterSubmitVersion, snapshot.version]);

  const openActions = () => {
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
    if (previousNotificationsOpen.current && !notificationsOpen) {
      if (!inspectingNotification.current) {
        const restore = () => {
          notificationsTrigger.current?.focus({ preventScroll: true });
          if (evidenceLedger.current) evidenceLedger.current.scrollTop = notificationsOrigin.current.evidenceScrollTop;
          if (contextBody.current) contextBody.current.scrollTop = notificationsOrigin.current.contextScrollTop;
          if (scopeTree.current) scopeTree.current.scrollTop = notificationsOrigin.current.scopeScrollTop;
        };
        restore();
        window.requestAnimationFrame(restore);
      }
      inspectingNotification.current = false;
    }
    previousNotificationsOpen.current = notificationsOpen;
  }, [notificationsOpen]);

  useLayoutEffect(() => {
    const focused = focusedDiagnosticDismiss.current;
    if (
      pendingDiagnosticDismissFocus.current === null &&
      focused &&
      !snapshot.diagnostics.some(({ dismissalId }) => dismissalId === focused.dismissalId)
    ) {
      pendingDiagnosticDismissFocus.current = focused.index;
    }
    const dismissedIndex = pendingDiagnosticDismissFocus.current;
    if (dismissedIndex !== null) {
      const dismissible = snapshot.diagnostics.filter(({ dismissalId }) => dismissalId !== undefined);
      const next = dismissible[dismissedIndex] ?? dismissible[dismissedIndex - 1];
      if (next?.dismissalId) {
        diagnosticDismissButtons.current.get(next.dismissalId)?.focus({ preventScroll: true });
      } else if (notificationsTrigger.current && !notificationsTrigger.current.disabled) {
        focusedDiagnosticDismiss.current = null;
        notificationsTrigger.current.focus({ preventScroll: true });
      } else {
        focusedDiagnosticDismiss.current = null;
        evidenceModeTrigger.current?.focus({ preventScroll: true });
      }
      pendingDiagnosticDismissFocus.current = null;
    }
  }, [snapshot.diagnostics]);

  useLayoutEffect(() => {
    const tree = scopeTree.current;
    if (!tree) return;
    const measure = () => setScopeTreeHeight(Math.max(SCOPE_NODE_HEIGHT, tree.clientHeight));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => observer.disconnect();
  }, [geometry, scopeCollapsed, scopePickerOpen, snapshot.contextId]);

  useLayoutEffect(() => {
    if (!effectiveFocusedNode || effectiveFocusedNode.id === snapshot.scope.focusedNodeId) return;
    if (scopeTree.current?.contains(document.activeElement)) pendingScopeFocus.current = effectiveFocusedNode.id;
    dispatch(runtime, { type: "set-scope-focus", scopeId: effectiveFocusedNode.id });
  }, [effectiveFocusedNode?.id, snapshot.scope.focusedNodeId]);

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
      row.focus();
      if (document.activeElement === row) pendingEvidenceFocus.current = null;
    };
    restore();
    window.requestAnimationFrame(() => {
      if (pendingEvidenceFocus.current === eventId) restore();
    });
  }, [focusedEventId, snapshot.contextId, snapshot.version, scopePickerOpen]);

  useLayoutEffect(() => {
    if (!hiddenSelection || !focusedEventId || focusedEventId === hiddenSelection.eventId) return;
    if (isCompactGeometry() && snapshot.contextId) {
      pendingEvidenceFocus.current = focusedEventId;
      return;
    }
    const row = evidenceRows.current.get(focusedEventId);
    if (row?.isConnected && row.getClientRects().length > 0) row.focus({ preventScroll: true });
  }, [focusedEventId, hiddenSelection?.eventId, snapshot.contextId, snapshot.version]);

  useLayoutEffect(() => {
    if (evidence.filterMutation.state !== "revealed" || snapshot.contextId || !focusedEventId) return;
    const row = evidenceRows.current.get(focusedEventId);
    if (row?.isConnected && row.getClientRects().length > 0) row.focus({ preventScroll: true });
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
  }, [events, evidence.visibleStart, evidence.visibleEnd, total]);

  useLayoutEffect(() => {
    const eventId = findState.currentEventId;
    if (!eventId) return;
    const row = evidenceRows.current.get(eventId);
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [findState.currentEventId]);

  useLayoutEffect(() => {
    const eventId = pendingTimelineReveal.current;
    if (!eventId || (geometry === "compact" && snapshot.contextId)) return;
    const row = evidenceRows.current.get(eventId);
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    pendingTimelineReveal.current = null;
  }, [snapshot.version, geometry, snapshot.contextId]);

  useLayoutEffect(() => {
    const nodeId = pendingScopeFocus.current;
    if (!nodeId) return;
    const node = scopeNodesById.current.get(nodeId);
    if (!node) return;
    node.focus();
    pendingScopeFocus.current = null;
  }, [snapshot.scope.focusedNodeId, renderedScopeWindowStart, scopeWindowSize]);

  useLayoutEffect(() => {
    if (!pendingScopeEntryFocus.current || !scopeIsPresented) return;
    const nodeId = renderedFocusId;
    if (!nodeId) return;
    revealScopeNode(nodeId);
    const node = scopeNodesById.current.get(nodeId);
    if (!node) return;
    node.focus();
    pendingScopeEntryFocus.current = false;
  }, [scopeIsPresented, renderedFocusId, renderedScopeWindowStart, scopeWindowSize]);

  useLayoutEffect(() => {
    if (!pendingContextFocus.current) return;
    if (isCompactGeometry() && !snapshot.contextId) return;
    contextLens.current?.focus();
    pendingContextFocus.current = false;
  }, [contextCollapsed, geometry, snapshot.contextId]);

  useLayoutEffect(() => {
    if (!pendingActionsFocus.current || contextMode !== "actions") return;
    contextLens.current?.focus();
    pendingActionsFocus.current = false;
  }, [contextMode, contextCollapsed, snapshot.contextId]);

  useLayoutEffect(() => {
    if (findOpen) findInput.current?.focus();
  }, [findOpen]);

  useLayoutEffect(() => {
    if (!filterOpen) return;
    if (filterStep === "composer") filterInput.current?.focus();
    if (filterStep === "explorer") facetSearchInput.current?.focus();
  }, [filterOpen, filterStep]);

  useLayoutEffect(() => {
    if (!pendingActionsRestoration.current || contextMode === "actions") return;
    pendingActionsRestoration.current = false;
    window.requestAnimationFrame(() => {
      if (evidenceLedger.current) evidenceLedger.current.scrollTop = actionsEvidenceScrollTop.current;
      if (contextBody.current) contextBody.current.scrollTop = actionsContextScrollTop.current;
      moreActionsTrigger.current?.focus();
    });
  }, [contextMode, snapshot.contextId]);

  useLayoutEffect(() => {
    if (!filterOpen) {
      setFilterDraft(appliedFilter.text);
      setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    }
  }, [appliedFilter.criteria, appliedFilter.text, filterOpen]);

  useLayoutEffect(() => {
    const pending = pendingPaneFocus.current;
    if (!pending) return;
    const collapsed = pending.pane === "scope" ? scopeCollapsed : contextCollapsed;
    if ((pending.target === "restore") !== collapsed) return;
    const target = pending.target === "restore"
      ? pending.pane === "scope" ? scopeRestore.current : contextRestore.current
      : pending.target === "collapse"
        ? pending.pane === "scope" ? scopeCollapse.current : contextCollapse.current
        : pending.pane === "scope" ? scopeSplitter.current : contextSplitter.current;
    target?.focus();
    pendingPaneFocus.current = null;
  }, [scopeCollapsed, contextCollapsed]);

  useLayoutEffect(() => {
    const previous = previousLocalInjectionDraft.current;
    const current = localInjectionDraft;
    if (previous?.open && current?.parked) {
      resumeLocalInjection.current?.focus();
    } else if (previous && !current) {
      const restoration = previous.restorationOrigin;
      const focus = (target: HTMLElement | null | undefined): boolean => {
        if (!target?.isConnected) return false;
        target.focus();
        return document.activeElement === target;
      };
      if (previous.source.kind === "authored") {
        if (!(geometry === "wide" && restoration.scopeId && focus(scopeNodesById.current.get(restoration.scopeId)))) {
          focus(scopeTrigger.current);
        }
      } else {
        const eventId = restoration.focusedEventId ?? restoration.selectionEventId;
        if (!(eventId && focus(evidenceRows.current.get(eventId)))) {
          if (!(restoration.contextId && focus(contextLens.current))) focus(scopeTrigger.current);
        }
      }
    }
    previousLocalInjectionDraft.current = current;
  }, [geometry, localInjectionDraft]);

  useLayoutEffect(() => {
    const previous = previousServerInjectionDraft.current;
    const current = serverInjectionDraft;
    if (previous && !current) {
      window.requestAnimationFrame(() => {
        if (serverInjectionTrigger.current?.isConnected) {
          serverInjectionTrigger.current.focus({ preventScroll: true });
          return;
        }
        const source = previous.source.eventId
          ? evidenceRows.current.get(previous.source.eventId)
          : null;
        if (source?.isConnected) source.focus({ preventScroll: true });
        else contextLens.current?.focus({ preventScroll: true });
      });
    }
    previousServerInjectionDraft.current = current;
  }, [serverInjectionDraft]);

  useLayoutEffect(() => {
    const previous = previousScenario.current;
    const current = snapshot.scenario;
    if (previous && !current) {
      const origin = previous.scenario.restorationOrigin;
      const eventId = origin.focusedEventId ?? origin.selectionEventId;
      window.requestAnimationFrame(() => {
        const target = eventId ? evidenceRows.current.get(eventId) : null;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else if (origin.contextId) contextLens.current?.focus({ preventScroll: true });
        else scopeTrigger.current?.focus({ preventScroll: true });
      });
    }
    previousScenario.current = current;
  }, [snapshot.scenario]);

  useLayoutEffect(() => {
    const confirmation = !!localInjectionDraft?.parked && localInjection.discardConfirmation;
    if (!previousParkedDiscardConfirmation.current && confirmation) {
      parkedDiscardDialog.current?.focus();
    } else if (previousParkedDiscardConfirmation.current && !confirmation && restoreParkedDiscardFocus.current) {
      restoreParkedDiscardFocus.current = false;
      parkedDiscardTrigger.current?.focus();
    }
    previousParkedDiscardConfirmation.current = confirmation;
  }, [localInjection.discardConfirmation, localInjectionDraft?.parked]);

  useLayoutEffect(() => () => {
    if (scopeTypeaheadReset.current !== null) window.clearTimeout(scopeTypeaheadReset.current);
  }, []);

  return (
    <section
      ref={workbenchRoot}
      className="workbench-react"
      data-theme={theme}
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
          openFind(document.activeElement instanceof HTMLElement ? document.activeElement : keyEvent.currentTarget);
          return;
        }
        if (keyEvent.key === "Escape" && findOpen) {
          keyEvent.preventDefault();
          if (findState.query) {
            dispatch(runtime, { type: "clear-find" });
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
        <div className="workbench-react__operating-actions">
          <button type="button" aria-label="Back investigation" disabled={!snapshot.evidence.restoration.canBack} onClick={() => dispatch(runtime, { type: "back-investigation" })}>Back</button>
          <button type="button" aria-label="Forward investigation" disabled={!snapshot.evidence.restoration.canForward} onClick={() => dispatch(runtime, { type: "forward-investigation" })}>Forward</button>
          <button className="workbench-react__evidence-operation" type="button" ref={findTrigger} disabled={notificationsOpen} aria-expanded={findOpen && !notificationsOpen} onClick={(event) => findOpen ? closeFind() : openFind(event.currentTarget)}>Find</button>
          <button className="workbench-react__evidence-operation" type="button" ref={filterTrigger} disabled={notificationsOpen} aria-expanded={filterOpen && !notificationsOpen} aria-controls="workbench-filter" onClick={(event) => filterOpen ? closeFilter() : openFilter(event.currentTarget)}>Filter</button>
          <label className="workbench-react__eyebrow" htmlFor="workbench-theme">Theme</label>
          <select
            id="workbench-theme"
            aria-label="Workbench theme"
            value={snapshot.theme}
            onChange={(event) => dispatch(runtime, { type: "set-theme", theme: event.currentTarget.value as "auto" | "dark" | "light" })}
          ><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
          <button ref={moreActionsTrigger} type="button" disabled={!workspaceAvailable} aria-controls={workspaceAvailable ? "workbench-context" : undefined} aria-expanded={workspaceAvailable && contextMode === "actions"} onClick={openActions}>More actions</button>
        </div>
      </header>
      {findOpen && !notificationsOpen ? <div className="workbench-react__find" role="search" aria-label="Find in ordered Evidence">
            <label className="workbench-react__eyebrow" htmlFor="workbench-find">Find</label>
            <input
              id="workbench-find"
              ref={findInput}
              aria-label="Find in ordered Evidence"
              value={findState.query}
              onChange={(event) => dispatch(runtime, { type: "set-find", value: event.currentTarget.value })}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter") {
                  keyEvent.preventDefault();
                  dispatch(runtime, { type: keyEvent.shiftKey ? "find-previous" : "find-next" });
                }
              }}
            />
            <span aria-live="polite">{findState.matchCount ? `${findState.currentIndex + 1} of ${findState.matchCount} matches` : "0 matches"}</span>
            <button type="button" onClick={() => dispatch(runtime, { type: "find-previous" })}>Previous</button>
            <button type="button" onClick={() => dispatch(runtime, { type: "find-next" })}>Next</button>
            <button type="button" onClick={closeFind}>Close Find</button>
          </div> : null}
      <nav className="workbench-react__scope-strip" aria-label="Current runtime scope">
        <button type="button" ref={scopeTrigger} disabled={!workspaceAvailable} aria-controls={workspaceAvailable ? "workbench-runtime-scope" : undefined} aria-expanded={workspaceAvailable && scopeIsPresented} onClick={(event) => openScope(event.currentTarget)}>Scope</button>
        {scopeCollapsed ? <button ref={scopeRestore} className="workbench-react__restore-pane workbench-react__restore-pane--scope" type="button" onClick={() => restorePane("scope")}>Restore Scope</button> : null}
        {contextCollapsed ? <button ref={contextRestore} className="workbench-react__restore-pane" type="button" onClick={() => restorePane("context")}>Restore Context</button> : null}
        <strong className="workbench-react__scope-label">{scopeLabel}</strong>
        <span className="workbench-react__scope-status">{scopeStatus}</span>
        {canAuthorCommandUpdate ? <button type="button" onClick={() => dispatch(runtime, { type: "begin-local-injection-from-scope" })}>Author COMMAND Item Update</button> : null}
      </nav>
      {localInjection.entryError ? <div className="workbench-react__condition workbench-react__condition--warning" role="alert"><strong>Local Injection unavailable</strong><span>{localInjection.entryError}</span></div> : null}
      {serverInjection?.entryError ? <div className="workbench-react__condition workbench-react__condition--warning" role="alert"><strong>Server Injection unavailable</strong><span>{serverInjection.entryError}</span></div> : null}
      {snapshot.scenario ? <Suspense fallback={<div className="workbench-react__local-loading" role="status">Loading Local Injection Scenario…</div>}><LazyLocalInjectionScenarioDocument runtime={runtime} snapshot={snapshot} /></Suspense> : null}
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
      {localInjectionDraft?.open || snapshot.scenario || serverInjectionDraft ? null : rawEvidence ? <section className="workbench-react__document" aria-label="Complete raw Evidence">
        <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Complete raw Evidence</span><strong>{rawEvidence.id} · immutable {rawEvidence.source} Evidence</strong></div><div className="workbench-react__document-actions"><button type="button" onClick={() => void copyRawEvidence()}>Copy raw Evidence</button><button type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button></div></header>
        <div className="workbench-react__document-boundary"><span>Source <strong>{rawEvidence.source}</strong></span><span>Phase <strong>{rawEvidence.phase}</strong></span><span>Mutable <strong>NO</strong></span></div>
        <p className="workbench-react__document-status" role="status">{copyStatus}</p>
        <pre tabIndex={0}>{JSON.stringify(rawEvidence.raw, null, 2)}</pre>
      </section> : <main ref={workspace} className="workbench-react__workspace" hidden={notificationsOpen}>
        <nav className="workbench-react__pane workbench-react__scope" id="workbench-runtime-scope" aria-label="Structural runtime scope">
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Runtime Scope</span><strong>Inspected page</strong></div><div><button ref={scopeCollapse} className="workbench-react__scope-collapse" type="button" onClick={() => collapsePane("scope", "collapse")}>Collapse Scope</button><button className="workbench-react__scope-picker-close" type="button" onClick={closeScope}>Close Scope</button><button className="workbench-react__compact-back" type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button></div></header>
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
        </nav>
        <div ref={scopeSplitter} className="workbench-react__splitter workbench-react__splitter--scope" role="separator" aria-label="Resize Scope" aria-orientation="vertical" aria-valuemin={SCOPE_MIN_WIDTH} aria-valuemax={SCOPE_MAX_WIDTH} aria-valuenow={renderedScopeWidth} tabIndex={0} onKeyDown={(event) => handleSeparatorKey("scope", event)} onPointerDown={(event) => startResize("scope", event)} />
        <section className="workbench-react__pane workbench-react__evidence" aria-label="Ordered Evidence">
          {snapshot.activity ? <ActivityTimeline projection={snapshot.activity.projection} filter={appliedFilter} frozen={evidence.mode === "frozen"} selectedEventId={selectedEventId} onSelect={selectTimelineEvidence} onShowEvidence={() => evidenceLedger.current?.focus()} onFilter={(expectedRevision, operations) => dispatch(runtime, { type: "apply-filter-mutations", expectedRevision, operations })} /> : null}
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Ordered Evidence</span><strong>{scopeLabel}</strong></div><div className="workbench-react__evidence-summary"><span>Shown {shown.toLocaleString()}</span><span>{activeTimelineRange ? "Before range" : "Matching"} {matching.toLocaleString()}</span><span>{activeTimelineRange ? "In range" : "In Scope"} {inScope.toLocaleString()}</span>{hasActiveFilter ? <><span className="workbench-react__active-filter" title={`Filter: ${appliedFilterSummary}`}>Filter: {appliedFilterSummary}</span><button type="button" onClick={() => dispatch(runtime, { type: "reset-filter", expectedRevision: appliedFilter.revision })}>Reset Filter</button></> : null}{selected ? <button type="button" aria-controls="workbench-context" onClick={openContext}>{selectedContextActionLabel}</button> : <button type="button" aria-controls="workbench-context" onClick={openScopeContext}>Open Scope Context</button>}</div></header>
          {filterOpen ? <form className={`workbench-react__filter${filterStep !== "composer" ? " workbench-react__filter--structured-open" : ""}${filterStep === "explorer" ? " workbench-react__filter--explorer-open" : ""}`} id="workbench-filter" aria-label="Filter ordered Evidence" onKeyDown={handleFilterEscape} onSubmit={(event) => {
            event.preventDefault();
            setFilterSubmitVersion(snapshot.version);
            dispatch(runtime, {
              type: "apply-filter-mutations",
              expectedRevision: filterDraftRevision ?? appliedFilter.revision,
              operations: draftFilterOperations(appliedFilter, filterDraft, filterDraftCriteria)
            });
          }}>
            {filterStep === "composer" ? <>
              <div className="workbench-react__filter-controls"><label htmlFor="workbench-filter-query">Filter Evidence</label><input ref={filterInput} id="workbench-filter-query" value={filterDraft} onChange={(event) => setFilterDraft(event.currentTarget.value)} /><button type="submit">Apply</button><button type="button" onClick={closeFilter}>Cancel</button></div>
              <div className="workbench-react__filter-draft-summary" aria-label="Structured criteria draft"><strong>Structured criteria draft</strong>{Object.entries(filterDraftCriteria).flatMap(([facet, criterion]) => [
                ...criterion.include.map((value) => <span key={`${facet}-include-${value.identity}`}>Include {facet}: {value.label}</span>),
                ...criterion.exclude.map((value) => <span key={`${facet}-exclude-${value.identity}`}>Exclude {facet}: {value.label}</span>)
              ])}{Object.values(filterDraftCriteria).every((criterion) => criterion.include.length === 0 && criterion.exclude.length === 0) ? <span>No structured criteria added.</span> : null}</div>
              <button ref={structuredCriterionTrigger} type="button" onClick={openStructuredCriteria}>Add structured criterion</button><span id="workbench-filter-structured-note" className="workbench-react__filter-note">Choose one of twelve Evidence facets to browse exact observed values.</span>
              {evidence.filterMutation.state === "stale" || evidence.filterMutation.state === "invalid" ? <p className="workbench-react__filter-status" role="alert">{evidence.filterMutation.message ?? "The Filter could not be applied."} Draft remains editable; review it and Apply again.</p> : null}
            </> : filterStep === "facets" ? <section className="workbench-react__filter-facet-step" role="dialog" aria-label="Choose structured facet">
              <header><div><strong>Add structured criterion</strong><span>Select a Lightstreamer-native facet.</span></div><button type="button" onClick={() => { setFilterStep("composer"); window.requestAnimationFrame(() => structuredCriterionTrigger.current?.focus()); }}>Back to Filter</button></header>
              <div className="workbench-react__filter-facet-grid" role="listbox" aria-label="Evidence facets">{FACET_DESCRIPTORS.map((descriptor, index) => <button ref={(element) => { if (index === 0) facetPickerFirst.current = element; if (element) facetButtons.current.set(descriptor.key, element); else facetButtons.current.delete(descriptor.key); }} type="button" role="option" key={descriptor.key} aria-label={`Add ${descriptor.label} criterion`} onClick={() => openFacetExplorer(descriptor.key)}><strong>{descriptor.label}</strong><span>{descriptor.valueType} · exact observed values</span></button>)}</div>
              <footer><span>All twelve facets are available without query syntax.</span><button type="button" onClick={closeFilter}>Cancel</button></footer>
            </section> : <section className="workbench-react__filter-explorer" role="dialog" aria-label={`${activeFacetDescriptor?.label ?? "Facet"} exact values`}>
              <header className="workbench-react__filter-explorer-header"><div><strong>{activeFacetDescriptor?.label ?? "Facet"} exact values</strong><span>Bounded contextual explorer · typed identities remain stable at this read point.</span></div><button type="button" onClick={() => { clearFilterDiscovery(); setFilterStep("facets"); setFilterFacet(null); setFilterDiscoveryCursor(null); window.requestAnimationFrame(() => facetPickerFirst.current?.focus()); }}>Back to facets</button></header>
              <div className="workbench-react__filter-explorer-search"><label htmlFor="workbench-filter-value-search">Search exact values</label><input ref={facetSearchInput} id="workbench-filter-value-search" value={filterDiscoverySearch} onChange={(event) => { const search = event.currentTarget.value; setFilterDiscoverySearch(search); setFilterDiscoveryCursor(null); requestFacetDiscovery(search); }} /><span aria-live="polite">{activeFacetDiscovery?.state === "AVAILABLE" ? countLabel(activeFacetDiscovery.distinctTotal, "exact value") : "Exact contextual counts"}</span></div>
              {!activeFacetDiscovery || evidence.investigation.queryState === "loading" ? <div className="workbench-react__filter-explorer-empty" role="status"><strong>Loading exact values…</strong><span>Reading the current Scope and Filter at one coherent Evidence read point.</span></div> : activeFacetDiscovery.state === "UNAVAILABLE" ? <div className="workbench-react__filter-explorer-empty" role="status"><strong>Exact values unavailable</strong><span>{discoveryUnavailableMessage(activeFacetDiscovery)}</span></div> : <>
                <p className="workbench-react__filter-explorer-counts" role="status">Exact contextual counts: {activeFacetDiscovery.baseEvidenceCount.toLocaleString()} Evidence · {countLabel(activeFacetDiscovery.distinctTotal, "distinct value")}{filterDiscoverySearch ? ` matching “${filterDiscoverySearch}”` : ""}.</p>
                <div className="workbench-react__filter-value-list" role="list" aria-label={`${activeFacetDescriptor?.label ?? "Facet"} values`}>
                  {filterDiscoveryValues.length ? filterDiscoveryValues.map((entry) => {
                    const draftValue = filterValueForDraft(entry.value);
                    const criterion = filterDraftCriteria[entry.value.facet];
                    const included = criterion?.include.some((value) => value.identity === draftValue.identity) ?? false;
                    const excluded = criterion?.exclude.some((value) => value.identity === draftValue.identity) ?? false;
                    const completeIdentity = `${entry.value.facet} · ${entry.value.type} · ${entry.value.identity}`;
                    return <div className="workbench-react__filter-value-row" role="listitem" data-filter-value-identity={entry.value.identity} key={entry.value.identity} title={completeIdentity}><span className="workbench-react__filter-value-label"><strong>{entry.value.label}</strong><small>{entry.value.type} · {entry.value.value}</small></span><span className="workbench-react__filter-value-count">{entry.count.toLocaleString()} in current Evidence{entry.pinned ? ` · pinned${entry.count === 0 ? " · zero" : ""}` : ""}</span><div className="workbench-react__filter-value-actions"><button type="button" aria-pressed={included} aria-label={`Include ${entry.value.label}; typed identity ${completeIdentity}`} onClick={() => chooseFacetValue(entry.value, "include")}>Include</button><button type="button" aria-pressed={excluded} aria-label={`Exclude ${entry.value.label}; typed identity ${completeIdentity}`} onClick={() => chooseFacetValue(entry.value, "exclude")}>Exclude</button></div></div>;
                  }) : <div className="workbench-react__filter-explorer-empty" role="status"><strong>No values match this search.</strong><span>Clear the label search to inspect the exhaustive observed set.</span></div>}
                </div>
                {activeFacetDiscovery.nextCursor ? <button className="workbench-react__filter-next" type="button" onClick={() => { const cursor = activeFacetDiscovery.nextCursor; setFilterDiscoveryCursor(cursor); requestFacetDiscovery(filterDiscoverySearch, cursor); }}>Show more exact values</button> : <span className="workbench-react__filter-complete">All exact values for this search are shown.</span>}
              </>}
              {evidence.filterMutation.state === "stale" || evidence.filterMutation.state === "invalid" ? <p className="workbench-react__filter-status" role="alert">{evidence.filterMutation.message ?? "The Filter could not be applied."} Draft remains editable; review it and Apply again.</p> : null}
              <footer><button type="submit">Apply</button><button type="button" onClick={closeFilter}>Cancel</button></footer>
            </section>}
          </form> : null}
          {hiddenSelection ? <div className="workbench-react__condition workbench-react__condition--selection" role="status"><strong>{hiddenSelection.message}</strong><span>Evidence {hiddenSelection.eventId} remains selected in Context.</span><div>{hiddenSelection.canReveal ? <button type="button" onClick={() => dispatch(runtime, { type: "reveal-selected-evidence" })}>Reveal selected Evidence</button> : <button type="button" disabled aria-label="Reveal selected Evidence unavailable">Reveal selected Evidence · Unavailable</button>}{hiddenSelection.canClear ? <button type="button" onClick={() => dispatch(runtime, { type: "clear-evidence-selection" })}>Clear selection</button> : null}</div>{hiddenSelection.revealUnavailableReason ? <small>{hiddenSelection.revealUnavailableReason}</small> : null}</div> : null}
          <div className="workbench-react__evidence-window" data-complete-window={!evidence.hasOlder && !evidence.hasNewer || undefined} aria-label="Retained Evidence window"><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("oldest")}>Oldest</button><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("older")}>Older</button><span>{evidence.visibleStart.toLocaleString()}–{evidence.visibleEnd.toLocaleString()} of {total.toLocaleString()}</span><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newer")}>Newer</button><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newest")}>Newest</button></div>
          {scopedCopyStatus ? <p className="workbench-react__copy-status" role="status">{scopedCopyStatus}</p> : null}
          {evidence.loading ? <div className="workbench-react__empty" role="status" aria-live="polite"><strong>Loading Evidence…</strong><span>Resolving the current Scope and Filter.</span></div> : events.length ? <div className="workbench-react__ledger" role="grid" aria-label="Ordered Lightstreamer Evidence" tabIndex={0} ref={evidenceLedger} onKeyDown={handleEvidenceKey}>
            <div className="workbench-react__ledger-header" role="row"><span role="columnheader">Order</span><span role="columnheader">Evidence</span><span role="columnheader">Command</span><span role="columnheader">Object</span></div>
            {events.map((event) => {
              const isSelected = event.id === selectedEventId;
              const isFindCurrent = event.id === findState.currentEventId;
              return <EvidenceRow
                key={event.id}
                event={event}
                selected={isSelected}
                findPosition={isFindCurrent ? `Find ${findState.currentIndex + 1} of ${findState.matchCount}` : null}
                rowRefs={evidenceRows}
                actionsRef={evidenceRowActions}
              />;
            })}
          </div> : <div className="workbench-react__empty"><strong>No Evidence in the current Scope.</strong><span>Capture {captureOperation.toLowerCase()} with Coverage {coverage.toLowerCase()}.</span><button type="button" onClick={(event) => openScope(event.currentTarget)}>Change Scope</button></div>}
        </section>
        <div ref={contextSplitter} className="workbench-react__splitter workbench-react__splitter--context" role="separator" aria-label="Resize Context" aria-orientation={isNormalGeometry() ? "horizontal" : "vertical"} aria-valuemin={contextMinimum} aria-valuemax={Math.min(CONTEXT_MAX_SIZE, contextMaximum)} aria-valuenow={contextSize} tabIndex={0} onKeyDown={(event) => handleSeparatorKey("context", event)} onPointerDown={(event) => startResize("context", event)} />
        <aside className="workbench-react__pane workbench-react__context" id="workbench-context" aria-label="Context">
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Scoped export" : selected ? `Selected Evidence · ${selected.source}` : "Runtime object"}</span><strong ref={contextLens} role="heading" aria-level={2} tabIndex={-1}>{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Export current Scope" : snapshot.context.title}</strong></div><div>{contextMode !== "actions" ? <button ref={contextCollapse} className="workbench-react__context-collapse" type="button" onClick={() => collapsePane("context", "collapse")}>Collapse Context</button> : null}{contextMode === "actions" ? <button type="button" onClick={closeActions}>Back to prior investigation</button> : <button className="workbench-react__compact-back" type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button>}</div></header>
          <div className="workbench-react__context-body" ref={contextBody}>
            {contextMode === "actions" ? <section className="workbench-react__operations" aria-label="Session operations">
              <p>The current Panel Session owns one temporary Event History using <strong>{snapshot.storage.mode === "indexeddb" ? "IndexedDB" : "in-memory fallback"}</strong>. Closing attempts controlled erasure; abnormal termination relies on guarded cleanup, and residual data may remain until the extension next runs.</p>
              {geometry === "compact" ? <section><h3>Panel appearance</h3><label htmlFor="workbench-actions-theme">Panel theme</label><select id="workbench-actions-theme" value={snapshot.theme} onChange={(event) => dispatch(runtime, { type: "set-theme", theme: event.currentTarget.value as "auto" | "dark" | "light" })}><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></section> : null}
              <section><h3>Retained Evidence copy</h3><p>{historyStatus.captured.toLocaleString()} captured · {historyStatus.retained.toLocaleString()} retained · {shown.toLocaleString()} currently shown for the active Scope and Filter. Capacity {historyStatus.capacity.state.replaceAll("_", " ")} ({historyStatus.capacity.tier}). Client Message bodies and outcome text are always redacted from this bulk copy.</p>{snapshot.evidenceCopy.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Reading retained Evidence: {(snapshot.evidenceCopy.progress?.completed ?? 0).toLocaleString()} of {(snapshot.evidenceCopy.progress?.total ?? 0).toLocaleString()} Evidence · {snapshot.evidenceCopy.progress?.excludedAfterLatch ?? 0} accepted after the latched boundary excluded.</p><button type="button" onClick={() => dispatch(runtime, { type: "cancel-evidence-operation" })}>Cancel copy</button></> : <button ref={scopedCopyTrigger} type="button" onClick={() => { operationFocusOrigin.current = "copy"; dispatch(runtime, { type: "prepare-scoped-evidence-copy" }); }}>Copy retained scoped Evidence</button>}</section>
              <section className="workbench-react__operations-danger"><h3>Clear retained Evidence</h3><p>Clear all {historyStatus.retained.toLocaleString()} retained Evidence events for this Panel Session. Scope and Filter do not limit this destructive action.</p>{snapshot.retention.clearState === "confirming" ? <div className="workbench-react__confirmation"><strong>Clear all {historyStatus.retained.toLocaleString()} retained Evidence events for this Panel Session?</strong><span>This removes retained Evidence from this Panel Session and cannot be undone.</span><div><button className="workbench-react__confirmation-primary" type="button" onClick={() => dispatch(runtime, { type: "confirm-clear-history" })}>Clear retained events</button><button type="button" onClick={() => dispatch(runtime, { type: "cancel-clear-history" })}>Keep Evidence</button></div></div> : <button type="button" onClick={() => dispatch(runtime, { type: "request-clear-history" })}>Clear retained Evidence…</button>}</section>
              <section><h3>Help &amp; resources</h3><p>Open first-party guides and reporting routes for this Workbench release.</p><nav className="workbench-react__resource-links" aria-label="Help and resources">{WORKBENCH_PUBLIC_RESOURCES.map((resource) => <a className="workbench-react__resource-link" href={resource.href} target="_blank" rel="noopener noreferrer" key={resource.href} onClick={() => analytics.track({ name: "feature_used", params: { feature: resource.label === "Documentation" ? "documentation" : resource.label === "Privacy" ? "privacy" : "support", action: "open" } })}>{resource.label}</a>)}</nav><UsageAnalytics client={analytics} /></section>
              <section><h3>Scoped export</h3><p>Prepare a versioned download for the current Scope. Credentials are always excluded.</p>{snapshot.export.operation?.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Preparing retained-Evidence export: {(snapshot.export.operation.progress.completed ?? 0).toLocaleString()} of {(snapshot.export.operation.progress.total ?? 0).toLocaleString()} Evidence · {snapshot.export.operation.progress.excludedAfterLatch} accepted after the latched boundary excluded.</p><button type="button" onClick={() => dispatch(runtime, { type: "cancel-evidence-operation" })}>Cancel export</button></> : <button ref={exportTrigger} type="button" onClick={() => { operationFocusOrigin.current = "export"; dispatch(runtime, { type: "export-scope" }); }}>Export Scope…</button>}</section>
            </section> : contextMode === "export" ? <section className="workbench-react__export" aria-label="Scoped export options">
              <p>Download the current Scope as versioned JSON or offline HTML. Credentials are always excluded.</p>
              {snapshot.export.operation?.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Preparing retained-Evidence export: {snapshot.export.operation.progress.completed.toLocaleString()} of {(snapshot.export.operation.progress.total ?? 0).toLocaleString()} Evidence.</p><button type="button" onClick={() => dispatch(runtime, { type: "cancel-evidence-operation" })}>Cancel export</button></> : null}
              {snapshot.export.operation && snapshot.export.operation.state !== "preparing" && snapshot.export.operation.error ? <p className="workbench-react__copy-status" role="status">{snapshot.export.operation.error} {snapshot.export.operation.recovery ?? ""}</p> : null}
              <fieldset><legend>Redact sensitive categories</legend>{TOPOLOGY_SENSITIVE_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={snapshot.export.redactions.includes(category)} onChange={(event) => toggleExportRedaction(category, event.currentTarget.checked)} />{sensitiveCategoryLabel(category)} ({snapshot.export.sensitiveCounts[category].toLocaleString()})</label>)}</fieldset>
              <label><input type="checkbox" checked={snapshot.export.completeEvidence} onChange={(event) => setCompleteEvidence(event.currentTarget.checked)} />Include complete establishment and COMMAND generation evidence</label>
              <div className="workbench-react__context-actions"><button type="button" disabled={!snapshot.export.json} onClick={() => downloadExport("json")}>Download JSON</button><button type="button" disabled={!snapshot.export.document} onClick={() => downloadExport("html")}>Download HTML</button></div>
              {exportDownloadStatus ? <p className="workbench-react__copy-status" role="status" aria-live="polite">{exportDownloadStatus}</p> : null}
            </section> : <>
              {snapshot.activity ? <ActivityContextSummary projection={snapshot.activity.projection} scopeLabel={scopeLabel} filterSummary={appliedFilterSummary} hasActiveFilter={hasActiveFilter} frozen={evidence.mode === "frozen"} open={activitySummaryOpen} onOpenChange={setActivitySummaryOpen} onRankingFilter={(expectedRevision, rankingId) => dispatch(runtime, { type: "apply-activity-ranking-filter", expectedRevision, rankingId })} onResetFilter={() => dispatch(runtime, { type: "reset-filter", expectedRevision: appliedFilter.revision })} /> : null}
              {selected ? <SelectedFilterActions
                actions={snapshot.context.filterActions ?? []}
                expectedRevision={appliedFilter.revision}
                open={selectedFilterActionsOpen}
                onOpenChange={setSelectedFilterActionsOpen}
                onAction={applySelectedFilterAction}
              /> : null}
              {selected ? <details className="workbench-react__evidence-metadata workbench-context-disclosure" aria-label="Evidence metadata" open={selectedEvidenceMetadataOpen} onToggle={event => setSelectedEvidenceMetadataOpen(event.currentTarget.open)}>
                <summary>Evidence metadata</summary>
                <dl className="workbench-react__context-fields">{contextFields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl>
              </details> : <dl className="workbench-react__context-fields" aria-label="Runtime metadata">{contextFields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl>}
              <SelectedUpdateDetails update={snapshot.context.selectedUpdate} />
              <div className="workbench-react__context-actions">
                {selected ? <>
                  <button
                    type="button"
                    className={!canCreateLocalInjectionDraft ? "workbench-react__context-action--unavailable" : undefined}
                    disabled={!canCreateLocalInjectionDraft}
                    aria-describedby={!canCreateLocalInjectionDraft ? "workbench-local-injection-unavailable-reason" : undefined}
                    onClick={() => dispatch(runtime, { type: "begin-local-injection-from-selection" })}
                  >Create Local Injection Draft{!canCreateLocalInjectionDraft ? " · Unavailable" : ""}</button>
                  {!canCreateLocalInjectionDraft && snapshot.localInjection.availability.selectedUpdate.reason
                    ? <span className="workbench-react__action-reason" id="workbench-local-injection-unavailable-reason">{snapshot.localInjection.availability.selectedUpdate.reason}</span>
                    : null}
                  {serverInjection ? selected.raw.clientMessage ? <>
                    <button
                      ref={serverInjectionTrigger}
                      type="button"
                      className={!canCloneClientMessage ? "workbench-react__context-action--unavailable" : undefined}
                      disabled={!canCloneClientMessage}
                      aria-describedby={!canCloneClientMessage ? "workbench-server-injection-unavailable-reason" : undefined}
                      onClick={() => dispatch(runtime, { type: "begin-server-injection-from-selection" })}
                    >Create Server Injection Draft{!canCloneClientMessage ? " · Unavailable" : ""}</button>
                    {!canCloneClientMessage && serverInjection.availability.cloneSelected.reason
                      ? <span className="workbench-react__action-reason" id="workbench-server-injection-unavailable-reason">{serverInjection.availability.cloneSelected.reason}</span>
                      : null}
                  </> : <>
                    <button
                      ref={serverInjectionTrigger}
                      type="button"
                      className={!canAuthorClientMessage ? "workbench-react__context-action--unavailable" : undefined}
                      disabled={!canAuthorClientMessage}
                      aria-describedby={!canAuthorClientMessage ? "workbench-server-author-unavailable-reason" : undefined}
                      onClick={() => dispatch(runtime, { type: "begin-server-injection-from-selected-client" })}
                    >Author Client Message{!canAuthorClientMessage ? " · Unavailable" : ""}</button>
                    {!canAuthorClientMessage && serverInjection.availability.authorSelectedClient.reason
                      ? <span className="workbench-react__action-reason" id="workbench-server-author-unavailable-reason">{serverInjection.availability.authorSelectedClient.reason}</span>
                      : null}
                  </> : null}
                  <button type="button" onClick={() => dispatch(runtime, { type: "open-raw-evidence", eventId: selected.id })}>Open complete raw</button>
                </> : <button type="button" onClick={() => dispatch(runtime, { type: "export-scope" })}>Export Scope…</button>}
              </div>
            </>}
          </div>
        </aside>
      </main>}
      <footer className="workbench-react__status" role="region" aria-label="Workbench diagnostics" tabIndex={snapshot.diagnostics.length ? 0 : -1}>
        <div className="workbench-react__history-live-region" aria-live="polite" aria-atomic="true">{snapshot.historyAnnouncement}</div>
        {snapshot.diagnostics.length ? <div className="workbench-react__status-diagnostics" tabIndex={0} aria-label="Workbench diagnostic entries" onKeyDown={(event) => {
          if (event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
        }}>
          {snapshot.diagnostics.length > 1 ? <span className="workbench-react__status-diagnostics-summary">{snapshot.diagnostics.length} diagnostics · Scroll to review all</span> : null}
          {snapshot.diagnostics.map((diagnostic, index) => <section className="workbench-react__status-diagnostic" data-category={diagnostic.category} data-history-condition={diagnostic.category === "history" ? "true" : undefined} data-severity={diagnostic.severity.toLowerCase()} key={diagnostic.dismissalId ?? (diagnostic.id ? `${diagnostic.code ?? diagnostic.title}:${diagnostic.id}` : `${diagnostic.title}-${index}`)}>
            <strong>{diagnostic.severity} · {diagnostic.title}</strong>
            <span className="workbench-react__status-affected">Affected: {diagnostic.affected}</span>
            {diagnostic.dismissalId ? <button
              className="workbench-react__status-dismiss"
              type="button"
              aria-label={`Dismiss ${diagnostic.title}`}
              data-diagnostic-dismissal-id={diagnostic.dismissalId}
              onFocus={() => {
                focusedDiagnosticDismiss.current = {
                  dismissalId: diagnostic.dismissalId!,
                  index: snapshot.diagnostics
                    .slice(0, index)
                    .filter(({ dismissalId }) => dismissalId !== undefined)
                    .length
                };
              }}
              onBlur={(event) => {
                const clear = () => {
                  if (focusedDiagnosticDismiss.current?.dismissalId === diagnostic.dismissalId) {
                    focusedDiagnosticDismiss.current = null;
                  }
                };
                if (event.relatedTarget) clear();
                else queueMicrotask(clear);
              }}
              ref={(element) => {
                if (element) diagnosticDismissButtons.current.set(diagnostic.dismissalId!, element);
                else diagnosticDismissButtons.current.delete(diagnostic.dismissalId!);
              }}
              onClick={() => {
                pendingDiagnosticDismissFocus.current = snapshot.diagnostics
                  .slice(0, index)
                  .filter(({ dismissalId }) => dismissalId !== undefined)
                  .length;
                dispatch(runtime, { type: "dismiss-diagnostic", dismissalId: diagnostic.dismissalId! });
              }}
            >Dismiss</button> : null}
            {geometry === "shallow" ? <details className="workbench-react__status-disclosure">
              <summary>Diagnostic details</summary>
              <span className="workbench-react__status-detail">{diagnostic.detail}</span>
              {diagnostic.limitation ? <span className="workbench-react__status-limitation">Limit: {diagnostic.limitation}</span> : null}
              {diagnostic.consequence ? <span className="workbench-react__status-consequence">Consequence: {diagnostic.consequence}</span> : null}
              {diagnostic.recovery ? <span className="workbench-react__status-recovery">Recovery: {diagnostic.recovery}</span> : null}
              {diagnostic.route ? <button type="button" onClick={() => diagnostic.route!.kind === "inspect-evidence"
                ? dispatch(runtime, { type: "inspect-diagnostic-evidence", evidence: diagnostic.route!.evidence })
                : dispatch(runtime, { type: "inspect-diagnostic-affected", affected: diagnostic.route!.affected })}>{diagnostic.route.label}</button> : null}
            </details> : <>
              <span className="workbench-react__status-detail">{diagnostic.detail}</span>
              {diagnostic.limitation ? <span className="workbench-react__status-limitation">Limit: {diagnostic.limitation}</span> : null}
              {diagnostic.consequence ? <span className="workbench-react__status-consequence">Consequence: {diagnostic.consequence}</span> : null}
              {diagnostic.recovery ? <span className="workbench-react__status-recovery">Recovery: {diagnostic.recovery}</span> : null}
              {diagnostic.route ? <button type="button" onClick={() => diagnostic.route!.kind === "inspect-evidence"
                ? dispatch(runtime, { type: "inspect-diagnostic-evidence", evidence: diagnostic.route!.evidence })
                : dispatch(runtime, { type: "inspect-diagnostic-affected", affected: diagnostic.route!.affected })}>{diagnostic.route.label}</button> : null}
            </>}
          </section>)}
        </div> : null}
        <div className="workbench-react__status-line"><span
          data-history-status
          aria-label={`${historyStatus.retained.toLocaleString()} retained Evidence of ${historyStatus.accepted.toLocaleString()} accepted`}
          title={`${historyStatus.retained.toLocaleString()} retained Evidence of ${historyStatus.accepted.toLocaleString()} accepted · ${snapshot.storage.mode === "indexeddb" ? "IndexedDB" : "Memory"}`}
        >{historyStatus.retained.toLocaleString()}/{historyStatus.accepted.toLocaleString()} Evidence · {snapshot.storage.mode === "indexeddb" ? "IndexedDB" : "Memory"}</span><button
              ref={notificationsTrigger}
              type="button"
              disabled={Boolean(localInjectionDraft?.open || snapshot.scenario || serverInjectionDraft || rawEvidence)}
              aria-expanded={notificationsPresented}
              aria-controls={notificationsPresented ? "workbench-notifications" : undefined}
              onClick={() => notificationsOpen ? dispatch(runtime, { type: "close-notifications" }) : openNotifications()}
            >Notifications ({snapshot.notifications.total}){notificationSeverity ? ` · ${notificationSeverity}` : ""}</button><button ref={evidenceModeTrigger} type="button" onClick={() => dispatch(runtime, { type: evidenceMode === "FROZEN" ? "follow-live" : "freeze-evidence" })}>{evidenceMode === "FROZEN" ? "Follow Live" : "Freeze Evidence"}</button></div>
      </footer>
    </section>
  );
}
