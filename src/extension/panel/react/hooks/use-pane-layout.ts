import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  CONTEXT_MAX_SIZE, CONTEXT_MIN_HEIGHT, CONTEXT_MIN_WIDTH, EVIDENCE_MIN_WIDTH, EVIDENCE_STACK_BUDGET,
  PERSISTENT_CHROME_HEIGHT, SCOPE_MAX_WIDTH, SCOPE_MIN_WIDTH, SPLITTER_SIZE,
  clamp, classifyGeometry, decideGeometry, type WorkbenchGeometry
} from "../workbench-geometry";

export type WorkbenchPane = "scope" | "context";
type PaneRestoreDestination = "splitter" | "collapse";

/**
 * Elastic Triad geometry, pane preferences, collapse state, splitter
 * keyboard/pointer resizing, and the refs pane focus restoration uses.
 *
 * Registers no effects: the panel calls `useWorkspacePressure`,
 * `usePaneResizeLifecycle`, and `usePaneFocusRestoration` at their original
 * positions so layout-effect order across the panel is unchanged.
 */
export function usePaneLayout() {
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
  const scopeSplitter = useRef<HTMLDivElement | null>(null);
  const contextSplitter = useRef<HTMLDivElement | null>(null);
  const scopeRestore = useRef<HTMLButtonElement | null>(null);
  const contextRestore = useRef<HTMLButtonElement | null>(null);
  const scopeCollapse = useRef<HTMLButtonElement | null>(null);
  const contextCollapse = useRef<HTMLButtonElement | null>(null);
  const paneRestoreDestination = useRef<{ scope: PaneRestoreDestination; context: PaneRestoreDestination }>({ scope: "splitter", context: "splitter" });
  const pendingPaneFocus = useRef<{ pane: WorkbenchPane; target: "restore" | "splitter" | "collapse" } | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);

  const wideSideBudget = Math.max(SCOPE_MIN_WIDTH + CONTEXT_MIN_WIDTH, viewport.width - EVIDENCE_MIN_WIDTH - SPLITTER_SIZE * 2);
  const renderedScopeWidth = geometry === "wide"
    ? clamp(scopeWidth, SCOPE_MIN_WIDTH, wideSideBudget - CONTEXT_MIN_WIDTH)
    : scopeWidth;
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

  const isCompactGeometry = () => geometry === "compact";
  const isNormalGeometry = () => geometry === "normal";
  const isShallowGeometry = () => geometry === "shallow";
  const adjustPane = (pane: WorkbenchPane, delta: number) => {
    if (pane === "scope") setScopeWidth((size) => clamp(size + delta, SCOPE_MIN_WIDTH, SCOPE_MAX_WIDTH));
    else if (isNormalGeometry()) setNormalContextHeight((size) => clamp(size + delta, CONTEXT_MIN_HEIGHT, CONTEXT_MAX_SIZE));
    else if (isShallowGeometry()) setShallowContextWidth((size) => clamp(size + delta, CONTEXT_MIN_WIDTH, CONTEXT_MAX_SIZE));
    else setWideContextWidth((size) => clamp(size + delta, CONTEXT_MIN_WIDTH, CONTEXT_MAX_SIZE));
  };
  const setPaneBoundary = (pane: WorkbenchPane, boundary: "start" | "end") => {
    if (pane === "scope") setScopeWidth(boundary === "start" ? SCOPE_MIN_WIDTH : SCOPE_MAX_WIDTH);
    else {
      const size = boundary === "start" ? CONTEXT_MAX_SIZE : isNormalGeometry() ? CONTEXT_MIN_HEIGHT : CONTEXT_MIN_WIDTH;
      if (isNormalGeometry()) setNormalContextHeight(size);
      else if (isShallowGeometry()) setShallowContextWidth(size);
      else setWideContextWidth(size);
    }
  };
  const collapsePane = (pane: WorkbenchPane, restoreDestination: PaneRestoreDestination = "splitter") => {
    paneRestoreDestination.current[pane] = restoreDestination;
    pendingPaneFocus.current = { pane, target: "restore" };
    if (pane === "scope") setScopeCollapsed(true);
    else setContextCollapsed(true);
  };
  const restorePane = (pane: WorkbenchPane) => {
    pendingPaneFocus.current = { pane, target: paneRestoreDestination.current[pane] };
    if (pane === "scope") setScopeCollapsed(false);
    else setContextCollapsed(false);
  };
  const handleSeparatorKey = (pane: WorkbenchPane, keyEvent: ReactKeyboardEvent<HTMLDivElement>) => {
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
  const startResize = (pane: WorkbenchPane, pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    if (isCompactGeometry() || (pane === "scope" && geometry !== "wide")) return;
    pointerEvent.preventDefault();
    resizeCleanup.current?.();
    let previous = pane === "context" && isNormalGeometry() ? pointerEvent.clientY : pointerEvent.clientX;
    // The drag keeps the geometry of the render that started it, as before.
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

  return {
    viewport, setViewport, geometry, setGeometry, setWorkspaceHeight,
    scopeCollapsed, setScopeCollapsed, contextCollapsed, setContextCollapsed,
    renderedScopeWidth, contextMinimum, contextMaximum, contextSize,
    workspace, pressureChrome, scopeSplitter, contextSplitter, scopeRestore, contextRestore,
    scopeCollapse, contextCollapse, pendingPaneFocus, resizeCleanup,
    isCompactGeometry, isNormalGeometry, collapsePane, restorePane, handleSeparatorKey, startResize
  };
}

export type PaneLayout = ReturnType<typeof usePaneLayout>;

/** Measures the workspace and demotes Normal geometry under vertical chrome pressure. */
export function useWorkspacePressure(layout: PaneLayout, workspaceAvailable: boolean, chromeLayoutKey: string): void {
  const { workspace, pressureChrome, geometry, contextCollapsed, setWorkspaceHeight, setGeometry } = layout;
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
    // `workspaceAvailable` is a deliberate trigger: the workspace element
    // remounts when promoted documents close and must be observed again.
  }, [workspace, pressureChrome, setWorkspaceHeight, setGeometry, workspaceAvailable, geometry, contextCollapsed, chromeLayoutKey]);
}

/** Ends an in-flight splitter drag on unmount and tracks viewport geometry. */
export function usePaneResizeLifecycle(layout: PaneLayout): void {
  const { resizeCleanup, pressureChrome, setViewport, setGeometry } = layout;
  useLayoutEffect(() => {
    // Read the drag in progress at unmount, not the one at mount.
    const latestResize = resizeCleanup;
    return () => latestResize.current?.();
  }, [resizeCleanup]);

  useLayoutEffect(() => {
    const updateGeometry = () => {
      pressureChrome.current = null;
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setViewport(nextViewport);
      setGeometry((previous) => decideGeometry(nextViewport.width, nextViewport.height, previous));
    };
    window.addEventListener("resize", updateGeometry);
    return () => window.removeEventListener("resize", updateGeometry);
  }, [pressureChrome, setViewport, setGeometry]);
}

/** Moves focus to the restore, splitter, or collapse control after a pane collapses or restores. */
export function usePaneFocusRestoration(layout: PaneLayout): void {
  const { pendingPaneFocus, scopeCollapsed, contextCollapsed, scopeRestore, contextRestore, scopeCollapse, contextCollapse, scopeSplitter, contextSplitter } = layout;
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
  }, [pendingPaneFocus, scopeRestore, contextRestore, scopeCollapse, contextCollapse, scopeSplitter, contextSplitter, scopeCollapsed, contextCollapsed]);
}
