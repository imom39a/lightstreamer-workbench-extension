import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  type WorkbenchCommand,
  type WorkbenchRuntime,
  type WorkbenchSnapshot
} from "../workbench-runtime";
import {
  TOPOLOGY_SENSITIVE_CATEGORIES,
  topologySnapshotFilename,
  type TopologySensitiveCategory
} from "../topology-export";
import { renderTopologyHtmlReport } from "../topology-html-report";
import { CommandProjectionComparison, CommandProjectionContextSummary } from "./command-projection-comparison";

import "./workbench-panel.css";

const LazyLocalInjectionDocument = lazy(async () => {
  const module = await import("./local-injection-document");
  return { default: module.LocalInjectionDocument };
});

export type WorkbenchPanelProps = { runtime: WorkbenchRuntime };

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
      style={{ top: `${index * SCOPE_NODE_HEIGHT}px` }}
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
    ><span>{node.label}</span><em>{node.detail ? `${node.detail} · ${lifecycleLabel(node.lifecycle)}` : lifecycleLabel(node.lifecycle)}</em></button>
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
  return (
    <button
      type="button"
      className="workbench-react__evidence-row"
      role="row"
      data-evidence-id={event.id}
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
    ><span role="gridcell"><time>{event.time}</time><small title={event.id}>{event.id}</small>{findPosition ? <small className="workbench-react__find-match">{findPosition}</small> : null}</span><strong role="gridcell">{event.source}</strong><span role="gridcell">{event.phase}</span><b role="gridcell">{event.command ?? "—"}</b><span role="gridcell" title={event.object}><strong>{event.kind}</strong><small>{event.object}</small></span><span role="gridcell" title={event.commandKey ?? "No COMMAND key"}>{event.commandKey ?? "—"}</span></button>
  );
});

function dispatch(runtime: WorkbenchRuntime, command: WorkbenchCommand): void {
  runtime.dispatch(command);
}

function uppercase(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replaceAll("-", "_").toUpperCase();
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
const SCOPE_NODE_HEIGHT = 27;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** React presentation for the Slice 1 read-only Scoped Evidence Workspace. */
export function WorkbenchPanel({ runtime }: WorkbenchPanelProps): JSX.Element {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const evidenceRows = useRef(new Map<string, HTMLButtonElement>());
  const evidenceRowActions = useRef<EvidenceRowActions>({ select: () => undefined });
  const evidenceLedger = useRef<HTMLDivElement | null>(null);
  const contextBody = useRef<HTMLDivElement | null>(null);
  const scopeTree = useRef<HTMLDivElement | null>(null);
  const scopeNodesById = useRef(new Map<string, HTMLButtonElement>());
  const scopeTreeActions = useRef<ScopeTreeActions>({
    scroll: () => undefined,
    focus: () => undefined,
    commit: () => undefined,
    key: () => undefined
  });
  const pendingEvidenceFocus = useRef<string | null>(null);
  const pendingScopeFocus = useRef<string | null>(null);
  const pendingScopeEntryFocus = useRef(false);
  const pendingContextFocus = useRef(false);
  const pendingRetainedBoundaryFocus = useRef<"oldest" | "newest" | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [scopedCopyStatus, setScopedCopyStatus] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [geometry, setGeometry] = useState<WorkbenchGeometry>(() => decideGeometry(window.innerWidth, window.innerHeight));
  const [scopeWidth, setScopeWidth] = useState(228);
  const [wideContextWidth, setWideContextWidth] = useState(350);
  const [normalContextHeight, setNormalContextHeight] = useState(260);
  const [shallowContextWidth, setShallowContextWidth] = useState(320);
  const [scopeCollapsed, setScopeCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState("");
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
  const moreActionsTrigger = useRef<HTMLButtonElement | null>(null);
  const scopeTrigger = useRef<HTMLButtonElement | null>(null);
  const contextLens = useRef<HTMLElement | null>(null);
  const commandProjectionTrigger = useRef<HTMLButtonElement | null>(null);
  const commandProjectionEvidenceScrollTop = useRef(0);
  const previousCommandProjectionContext = useRef(false);
  const pendingCommandProjectionReturnFocus = useRef<
    { target: "trigger" } | { target: "evidence"; eventId: string } | null
  >(null);
  const scopeSplitter = useRef<HTMLDivElement | null>(null);
  const contextSplitter = useRef<HTMLDivElement | null>(null);
  const scopeRestore = useRef<HTMLButtonElement | null>(null);
  const contextRestore = useRef<HTMLButtonElement | null>(null);
  const resumeLocalInjection = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardTrigger = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardDialog = useRef<HTMLElement | null>(null);
  const restoreParkedDiscardFocus = useRef(false);
  const previousLocalInjectionDraft = useRef<WorkbenchSnapshot["localInjection"]["draft"]>(null);
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
  const total = evidence.total;
  const shown = events.length;
  const limited = coverage === "LIMITED" || coverage === "UNAVAILABLE";
  const activeFilterEntries = Object.entries(evidence.filters).filter(
    ([, value]) => value !== undefined && value !== ""
  );
  const compactSurface = snapshot.contextId === "context:scope" ? "scope" : snapshot.contextId ? "context" : undefined;
  const rawEvidence = snapshot.contextId?.startsWith("raw:") ? selected : null;
  const commandProjectionComparison = snapshot.contextId === "command-projections";
  const supportingProjectionEvidenceId =
    snapshot.commandProjections.localEffective.supportingLocalEvidenceId ?? null;
  const localInjection = snapshot.localInjection;
  const localInjectionDraft = localInjection.draft;
  const contextMode = snapshot.contextId === "context:actions"
    ? "actions"
    : snapshot.contextId === "context:export"
      ? "export"
      : "inspect";
  const workspaceAvailable = !localInjectionDraft?.open && !commandProjectionComparison && !rawEvidence;
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
  const contextMaximum = geometry === "normal"
    ? Math.max(CONTEXT_MIN_HEIGHT, viewport.height - PERSISTENT_CHROME_HEIGHT - EVIDENCE_MIN_HEIGHT - SPLITTER_SIZE)
    : geometry === "shallow"
      ? Math.max(CONTEXT_MIN_WIDTH, viewport.width - EVIDENCE_MIN_WIDTH - SPLITTER_SIZE)
      : geometry === "wide"
        ? Math.max(CONTEXT_MIN_WIDTH, wideSideBudget - renderedScopeWidth)
        : CONTEXT_MAX_SIZE;
  const contextMinimum = geometry === "normal" ? CONTEXT_MIN_HEIGHT : CONTEXT_MIN_WIDTH;
  const contextPreference = geometry === "normal" ? normalContextHeight : geometry === "shallow" ? shallowContextWidth : wideContextWidth;
  const contextSize = clamp(contextPreference, contextMinimum, Math.min(CONTEXT_MAX_SIZE, contextMaximum));

  useLayoutEffect(() => {
    if (snapshot.evidenceCopy.state === "error") {
      setScopedCopyStatus(snapshot.evidenceCopy.error ?? "Could not prepare complete scoped Evidence.");
      dispatch(runtime, { type: "clear-scoped-evidence-copy" });
      return;
    }
    if (snapshot.evidenceCopy.state !== "ready" || !snapshot.evidenceCopy.text) return;
    if (!navigator.clipboard?.writeText) {
      setScopedCopyStatus("Could not copy complete scoped Evidence.");
      dispatch(runtime, { type: "clear-scoped-evidence-copy" });
      return;
    }
    void navigator.clipboard.writeText(snapshot.evidenceCopy.text).then(
      () => setScopedCopyStatus(`Copied complete scoped Evidence (${snapshot.evidenceCopy.eventCount.toLocaleString()} events).`),
      () => setScopedCopyStatus("Could not copy complete scoped Evidence.")
    ).finally(() => dispatch(runtime, { type: "clear-scoped-evidence-copy" }));
  }, [snapshot.evidenceCopy]);

  useLayoutEffect(() => () => resizeCleanup.current?.(), []);

  useLayoutEffect(() => {
    const updateGeometry = () => {
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
    const rowHeight = geometry === "compact" ? 48 : 27;
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
    if (compact) pendingEvidenceFocus.current = focusedEventId ?? selectedEventId;
    dispatch(runtime, { type: "set-scope", scopeId });
    if (scopePickerOpen) closeScope();
    else if (compact) dispatch(runtime, { type: "set-context", contextId: null });
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

  const downloadExport = (format: "json" | "html") => {
    const prepared = snapshot.export;
    if (!prepared.document || !prepared.json || !prepared.filename) return;
    if (format === "json") {
      downloadText(prepared.filename, prepared.json, "application/json");
      return;
    }
    downloadText(
      topologySnapshotFilename(prepared.document, "html"),
      renderTopologyHtmlReport(prepared.document),
      "text/html"
    );
  };

  const copyRawEvidence = async () => {
    if (!rawEvidence) return;
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("Raw Evidence copy is unavailable in this context.");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawEvidence.raw, null, 2));
      setCopyStatus(`Copied raw Evidence ${rawEvidence.id}.`);
    } catch {
      setCopyStatus("Raw Evidence could not be copied. Select and copy the document instead.");
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
    filterOrigin.current = origin;
    setFilterOpen(true);
  };

  const closeFilter = () => {
    setFilterOpen(false);
    window.requestAnimationFrame(() => {
      (filterOrigin.current?.isConnected ? filterOrigin.current : filterTrigger.current)?.focus();
    });
  };

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
    evidenceRows.current.get(eventId)?.focus();
    pendingEvidenceFocus.current = null;
  }, [focusedEventId, snapshot.contextId]);

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
    const wasOpen = previousCommandProjectionContext.current;
    if (wasOpen && !commandProjectionComparison) {
      const returnFocus = pendingCommandProjectionReturnFocus.current;
      pendingCommandProjectionReturnFocus.current = null;
      window.requestAnimationFrame(() => {
        if (returnFocus?.target === "evidence") {
          const evidenceTarget = evidenceRows.current.get(returnFocus.eventId);
          if (evidenceTarget) evidenceTarget.focus({ preventScroll: true });
          else commandProjectionTrigger.current?.focus();
        } else {
          commandProjectionTrigger.current?.focus();
        }
        window.requestAnimationFrame(() => {
          if (evidenceLedger.current) {
            evidenceLedger.current.scrollTop = commandProjectionEvidenceScrollTop.current;
          }
        });
      });
    }
    previousCommandProjectionContext.current = commandProjectionComparison;
  }, [commandProjectionComparison, snapshot.evidence.focusedEventId, snapshot.selectionEventId]);

  const closeCommandProjectionComparison = (action: "back" | "reveal") => {
    const eventId = action === "reveal"
      ? supportingProjectionEvidenceId
      : snapshot.evidence.focusedEventId ?? snapshot.selectionEventId;
    pendingCommandProjectionReturnFocus.current = eventId
      ? { target: "evidence", eventId }
      : { target: "trigger" };
    dispatch(runtime, { type: "close-command-projection-comparison" });
    if (action === "reveal" && eventId) {
      dispatch(runtime, { type: "focus-evidence", eventId });
    }
    if (geometry === "compact") {
      dispatch(runtime, { type: "set-context", contextId: null });
    }
  };

  const openCommandProjectionComparison = () => {
    commandProjectionEvidenceScrollTop.current = evidenceLedger.current?.scrollTop ?? 0;
    dispatch(runtime, { type: "open-command-projection-comparison" });
  };

  const revealSupportingProjectionEvidence = () => {
    const eventId = supportingProjectionEvidenceId;
    if (!eventId) return;
    dispatch(runtime, { type: "focus-evidence", eventId });
    if (geometry === "compact") {
      pendingEvidenceFocus.current = eventId;
      dispatch(runtime, { type: "set-context", contextId: null });
      return;
    }
    window.requestAnimationFrame(() => evidenceRows.current.get(eventId)?.focus());
  };

  useLayoutEffect(() => {
    if (findOpen) findInput.current?.focus();
  }, [findOpen]);

  useLayoutEffect(() => {
    if (filterOpen) filterInput.current?.focus();
  }, [filterOpen]);

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
    setFilterDraft(evidence.filters.query ?? "");
  }, [evidence.filters.query]);

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
        if (rawEvidence || keyEvent.defaultPrevented) return;
        if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === "f") {
          const target = keyEvent.target;
          if (target instanceof Element && target.closest('[aria-label="Local Injection Draft"]')) return;
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
        <strong>Capture {captureOperation}</strong>
        <span data-condition={coverage.toLowerCase()}>Coverage {coverage}</span>
        <span>View {evidenceMode}{newerCount ? ` · ${newerCount.toLocaleString()} newer` : ""}</span>
        <div className="workbench-react__operating-actions">
          {findOpen ? <div className="workbench-react__find" role="search" aria-label="Find in ordered Evidence">
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
          </div> : <button className="workbench-react__evidence-operation" type="button" ref={findTrigger} onClick={(event) => openFind(event.currentTarget)}>Find</button>}
          <button className="workbench-react__evidence-operation" type="button" ref={filterTrigger} aria-expanded={filterOpen} aria-controls="workbench-filter" onClick={(event) => filterOpen ? closeFilter() : openFilter(event.currentTarget)}>Filter</button>
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
      <nav className="workbench-react__scope-strip" aria-label="Current runtime scope">
        <button type="button" ref={scopeTrigger} disabled={!workspaceAvailable} aria-controls={workspaceAvailable ? "workbench-runtime-scope" : undefined} aria-expanded={workspaceAvailable && scopeIsPresented} onClick={(event) => openScope(event.currentTarget)}>Scope</button>
        {scopeCollapsed ? <button ref={scopeRestore} className="workbench-react__restore-pane workbench-react__restore-pane--scope" type="button" onClick={() => restorePane("scope")}>Restore Scope</button> : null}
        {contextCollapsed ? <button ref={contextRestore} className="workbench-react__restore-pane" type="button" onClick={() => restorePane("context")}>Restore Context</button> : null}
        <strong className="workbench-react__scope-label">{scopeLabel}</strong>
        <span className="workbench-react__scope-status">{scopeStatus}</span>
        {canAuthorCommandUpdate ? <button type="button" onClick={() => dispatch(runtime, { type: "begin-local-injection-from-scope" })}>Author COMMAND Item Update</button> : null}
      </nav>
      {localInjection.entryError ? <div className="workbench-react__condition workbench-react__condition--warning" role="alert"><strong>Local Injection unavailable</strong><span>{localInjection.entryError}</span></div> : null}
      {localInjectionDraft ? <Suspense fallback={<div className="workbench-react__local-loading" role="status">Loading Local Injection editor…</div>}><LazyLocalInjectionDocument
        runtime={runtime}
        localInjection={localInjection}
        hidden={!localInjectionDraft.open}
        inlineCompare={geometry !== "wide"}
      /></Suspense> : null}
      {localInjectionDraft?.parked ? <section className="workbench-react__local-parked" aria-label="Parked Local Injection Draft">
        <div><span className="workbench-react__eyebrow">Parked Local Injection Draft</span><strong>{localInjectionDraft.anchor.subscriptionId} · {localInjectionDraft.anchor.itemName ?? `Item #${localInjectionDraft.anchor.itemPosition ?? "Unknown"}`}</strong></div>
        <span>{localInjectionDraft.ready ? "READY" : "BLOCKED"} · Session {localInjectionDraft.anchor.sessionId ?? "Unknown"} · {localInjectionDraft.compareStatus === "no-source" ? "newly authored" : `Source ${localInjectionDraft.anchor.sourceEventId ?? "Unknown"}`}</span>
        <button type="button" ref={resumeLocalInjection} onClick={() => dispatch(runtime, { type: "resume-local-injection" })}>Resume Local Injection Draft</button>
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
      {localInjectionDraft?.open ? null : commandProjectionComparison ? <CommandProjectionComparison
        scope={scopeLabel}
        capture={snapshot.capture}
        projections={snapshot.commandProjections}
        hasSupportingLocalEvidence={Boolean(supportingProjectionEvidenceId)}
        onBack={() => closeCommandProjectionComparison("back")}
        onRevealEvidence={() => closeCommandProjectionComparison("reveal")}
      /> : rawEvidence ? <section className="workbench-react__document" aria-label="Complete raw Evidence">
        <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Complete raw Evidence</span><strong>{rawEvidence.id} · immutable {rawEvidence.source} Evidence</strong></div><div className="workbench-react__document-actions"><button type="button" onClick={() => void copyRawEvidence()}>Copy raw Evidence</button><button type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button></div></header>
        <div className="workbench-react__document-boundary"><span>Source <strong>{rawEvidence.source}</strong></span><span>Phase <strong>{rawEvidence.phase}</strong></span><span>Mutable <strong>NO</strong></span></div>
        <p className="workbench-react__document-status" role="status">{copyStatus}</p>
        <pre tabIndex={0}>{JSON.stringify(rawEvidence.raw, null, 2)}</pre>
      </section> : <main className="workbench-react__workspace">
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
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">Ordered Evidence</span><strong>{scopeLabel}</strong></div><div className="workbench-react__evidence-summary"><span>{shown.toLocaleString()} shown / {total.toLocaleString()}</span>{activeFilterEntries.length ? <><span className="workbench-react__active-filter">Filter: {activeFilterEntries.map(([, value]) => String(value)).join(" · ")}</span><button type="button" onClick={() => dispatch(runtime, { type: "clear-filters" })}>Clear filters</button></> : null}{selected ? <button type="button" aria-controls="workbench-context" onClick={openContext}>{selectedContextActionLabel}</button> : null}</div></header>
          {filterOpen ? <form className="workbench-react__filter" id="workbench-filter" aria-label="Filter ordered Evidence" onSubmit={(event) => {
            event.preventDefault();
            const query = filterDraft.trim();
            dispatch(runtime, query ? { type: "set-filters", filters: { query } } : { type: "clear-filters" });
            closeFilter();
          }}><label htmlFor="workbench-filter-query">Filter Evidence</label><input ref={filterInput} id="workbench-filter-query" value={filterDraft} onChange={(event) => setFilterDraft(event.currentTarget.value)} /><button type="submit">Apply Filter</button><button type="button" onClick={() => {
            setFilterDraft("");
            dispatch(runtime, { type: "clear-filters" });
          }}>Clear filters</button><button type="button" onClick={closeFilter}>Close Filter</button></form> : null}
          {hiddenSelection ? <div className="workbench-react__condition workbench-react__condition--selection" role="status"><strong>{hiddenSelection.message}</strong><span>Evidence {hiddenSelection.eventId} remains selected in Context.</span><div>{hiddenSelection.canReveal ? <button type="button" onClick={() => dispatch(runtime, { type: "reveal-selected-evidence" })}>Reveal selected Evidence</button> : null}{hiddenSelection.canClear ? <button type="button" onClick={() => dispatch(runtime, { type: "clear-evidence-selection" })}>Clear selection</button> : null}</div></div> : null}
          {limited && capture.detail ? <div className="workbench-react__condition workbench-react__condition--warning"><strong>! Coverage {coverage}</strong><span>{capture.detail}</span><button type="button" data-action="open-diagnostics" onClick={() => dispatch(runtime, { type: "open-diagnostics" })}>{capture.recovery ?? "Open diagnostics"}</button></div> : null}
          <div className="workbench-react__evidence-window" aria-label="Retained Evidence window"><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("oldest")}>Oldest</button><button type="button" aria-disabled={!evidence.hasOlder || undefined} onClick={() => evidence.hasOlder && navigateRetainedEvidence("older")}>Older</button><span>{evidence.visibleStart.toLocaleString()}–{evidence.visibleEnd.toLocaleString()} of {total.toLocaleString()}</span><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newer")}>Newer</button><button type="button" aria-disabled={!evidence.hasNewer || undefined} onClick={() => evidence.hasNewer && navigateRetainedEvidence("newest")}>Newest</button></div>
          {scopedCopyStatus ? <p className="workbench-react__copy-status" role="status">{scopedCopyStatus}</p> : null}
          {evidence.loading ? <div className="workbench-react__empty" role="status" aria-live="polite"><strong>Loading Evidence…</strong><span>Resolving the current Scope and Filter.</span></div> : events.length ? <div className="workbench-react__ledger" role="grid" aria-label="Ordered Lightstreamer Evidence" tabIndex={0} ref={evidenceLedger} onKeyDown={handleEvidenceKey}>
            <div className="workbench-react__ledger-header" role="row"><span role="columnheader">Time / #</span><span role="columnheader">Source</span><span role="columnheader">Phase</span><span role="columnheader">Op</span><span role="columnheader">Evidence / object</span><span role="columnheader">COMMAND key</span></div>
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
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Scoped export" : selected ? "Selected Evidence" : "Runtime object"}</span><strong ref={contextLens} role="heading" aria-level={2} tabIndex={-1}>{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Export current Scope" : snapshot.context.title}</strong></div><div>{contextMode !== "actions" ? <button ref={contextCollapse} className="workbench-react__context-collapse" type="button" onClick={() => collapsePane("context", "collapse")}>Collapse Context</button> : null}{contextMode === "actions" ? <button type="button" onClick={closeActions}>Back to prior investigation</button> : <button className="workbench-react__compact-back" type="button" onClick={restoreEvidenceFocus}>Back to Evidence</button>}</div></header>
          <div className="workbench-react__context-body" ref={contextBody}>
            {contextMode === "actions" ? <section className="workbench-react__operations" aria-label="Session operations">
              <p>The current DevTools session history uses <strong>{snapshot.storage.mode === "indexeddb" ? "IndexedDB" : "in-memory fallback"}</strong> and is cleared when this DevTools session closes.</p>
              {geometry === "compact" ? <section><h3>Panel appearance</h3><label htmlFor="workbench-actions-theme">Panel theme</label><select id="workbench-actions-theme" value={snapshot.theme} onChange={(event) => dispatch(runtime, { type: "set-theme", theme: event.currentTarget.value as "auto" | "dark" | "light" })}><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></section> : null}
              <section><h3>Retained Evidence copy</h3><p>{snapshot.retention.totalAppended.toLocaleString()} captured · {snapshot.retention.retained.toLocaleString()} retained · {shown.toLocaleString()} currently shown for the active Scope and Filter.</p><button type="button" disabled={snapshot.evidenceCopy.state === "preparing"} onClick={() => dispatch(runtime, { type: "prepare-scoped-evidence-copy" })}>{snapshot.evidenceCopy.state === "preparing" ? "Preparing complete Evidence…" : "Copy complete scoped Evidence"}</button></section>
              <section className="workbench-react__operations-danger"><h3>Clear retained Evidence</h3><p>Clear all {snapshot.retention.retained.toLocaleString()} retained Evidence events for this DevTools session. Scope and Filter do not limit this destructive action.</p>{snapshot.retention.clearState === "confirming" ? <div className="workbench-react__confirmation"><strong>Clear all {snapshot.retention.retained.toLocaleString()} retained Evidence events for this DevTools session?</strong><span>This removes current-session Evidence and cannot be undone.</span><div><button type="button" onClick={() => dispatch(runtime, { type: "confirm-clear-history" })}>Clear retained events</button><button type="button" onClick={() => dispatch(runtime, { type: "cancel-clear-history" })}>Keep Evidence</button></div></div> : <button type="button" onClick={() => dispatch(runtime, { type: "request-clear-history" })}>Clear retained Evidence…</button>}</section>
              <section><h3>Usage analytics</h3><p>{snapshot.analytics.consent === "granted" ? "Anonymous usage analytics is enabled." : snapshot.analytics.available ? "Usage analytics is off until you choose to enable it." : "Usage analytics is unavailable in this build. Nothing is sent."}</p>{snapshot.analytics.available ? <div><button type="button" disabled={snapshot.analytics.pending} onClick={() => dispatch(runtime, { type: "set-analytics-consent", consent: "granted" })}>Enable analytics</button><button type="button" disabled={snapshot.analytics.pending} onClick={() => dispatch(runtime, { type: "set-analytics-consent", consent: "denied" })}>Keep analytics off</button></div> : null}</section>
              <section><h3>Scoped export</h3><p>Prepare a versioned download for the current Scope. Credentials are always excluded.</p><button type="button" onClick={() => dispatch(runtime, { type: "export-scope" })}>Export Scope…</button></section>
            </section> : contextMode === "export" ? <section className="workbench-react__export" aria-label="Scoped export options">
              <p>Download the current Scope as versioned JSON or offline HTML. Credentials are always excluded.</p>
              <fieldset><legend>Redact sensitive categories</legend>{TOPOLOGY_SENSITIVE_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={snapshot.export.redactions.includes(category)} onChange={(event) => toggleExportRedaction(category, event.currentTarget.checked)} />{sensitiveCategoryLabel(category)} ({snapshot.export.sensitiveCounts[category].toLocaleString()})</label>)}</fieldset>
              <label><input type="checkbox" checked={snapshot.export.completeEvidence} onChange={(event) => setCompleteEvidence(event.currentTarget.checked)} />Include complete establishment and COMMAND generation evidence</label>
              <div className="workbench-react__context-actions"><button type="button" disabled={!snapshot.export.json} onClick={() => downloadExport("json")}>Download JSON</button><button type="button" disabled={!snapshot.export.document} onClick={() => downloadExport("html")}>Download HTML</button></div>
            </section> : <>
              <dl className="workbench-react__context-fields" aria-label="Evidence metadata">{contextFields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl>
              <SelectedUpdateDetails update={snapshot.context.selectedUpdate} />
              {snapshot.diagnostics.map((diagnostic, index) => <section className="workbench-react__diagnostic" key={`${diagnostic.title}-${index}`}><strong>{diagnostic.severity} · {diagnostic.title}</strong><span>{diagnostic.detail}</span>{diagnostic.recovery ? <button type="button" onClick={() => dispatch(runtime, { type: "open-diagnostics" })}>{diagnostic.recovery}</button> : null}</section>)}
              <CommandProjectionContextSummary
                projections={snapshot.commandProjections}
                hasSupportingLocalEvidence={Boolean(supportingProjectionEvidenceId)}
                compareButtonRef={commandProjectionTrigger}
                onCompare={openCommandProjectionComparison}
                onRevealEvidence={revealSupportingProjectionEvidence}
              />
              <div className="workbench-react__context-actions">
                {selected ? <>
                  <button
                    type="button"
                    disabled={!canCreateLocalInjectionDraft}
                    aria-describedby={!canCreateLocalInjectionDraft ? "workbench-local-injection-unavailable-reason" : undefined}
                    onClick={() => dispatch(runtime, { type: "begin-local-injection-from-selection" })}
                  >Create Local Injection Draft</button>
                  {!canCreateLocalInjectionDraft && snapshot.localInjection.availability.selectedUpdate.reason
                    ? <span className="workbench-react__action-reason" id="workbench-local-injection-unavailable-reason">{snapshot.localInjection.availability.selectedUpdate.reason}</span>
                    : null}
                  <button type="button" onClick={() => dispatch(runtime, { type: "open-raw-evidence", eventId: selected.id })}>Open complete raw</button>
                </> : <button type="button" onClick={() => dispatch(runtime, { type: "export-scope" })}>Export Scope…</button>}
              </div>
            </>}
          </div>
        </aside>
      </main>}
      <footer className="workbench-react__status"><span>{limited ? "Observation requires care; retained Evidence remains readable." : "Evidence is retained for this DevTools session."}</span><button type="button" onClick={() => dispatch(runtime, { type: evidenceMode === "FROZEN" ? "follow-live" : "freeze-evidence" })}>{evidenceMode === "FROZEN" ? "Follow Live" : "Freeze Evidence"}</button></footer>
    </section>
  );
}
