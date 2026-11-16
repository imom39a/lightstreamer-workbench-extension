import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../../workbench-runtime";
import type { WorkbenchGeometry } from "../workbench-geometry";

type FindState = WorkbenchSnapshot["evidence"]["findState"];

/**
 * Find draft, debounce, open/close, and origin restoration for Find in
 * Evidence. The runtime owns the committed query and match navigation.
 *
 * The hook registers only passive effects; its layout effects are the
 * separately exported `useFindReveal` and `useFindInputFocus`, which the
 * panel calls at their original positions.
 */
export function useFindController({
  runtime,
  findState,
  contextId,
  compact,
  scopePickerOpen,
  setScopePickerOpen,
  evidenceLedger
}: Readonly<{
  runtime: WorkbenchRuntime;
  findState: FindState;
  contextId: string | null;
  compact: boolean;
  scopePickerOpen: boolean;
  setScopePickerOpen(open: boolean): void;
  evidenceLedger: RefObject<HTMLDivElement | null>;
}>) {
  const [findOpen, setFindOpen] = useState(false);
  const [findDraft, setFindDraft] = useState(findState.query);
  const findDebounce = useRef<number | null>(null);
  const completedFindReveal = useRef<number | null>(null);
  const findOriginScroll = useRef(0);
  const findParkedContext = useRef<string | null>(null);
  const findOriginScopePicker = useRef(false);
  const findInput = useRef<HTMLInputElement | null>(null);
  const findTrigger = useRef<HTMLButtonElement | null>(null);
  const findOrigin = useRef<HTMLElement | null>(null);

  const openFind = (origin: HTMLElement) => {
    if (findOpen) { findInput.current?.focus(); return; }
    findOrigin.current = origin;
    findOriginScopePicker.current = scopePickerOpen;
    if (scopePickerOpen) setScopePickerOpen(false);
    findParkedContext.current = compact ? contextId : null;
    if (findParkedContext.current) runtime.dispatch({ type: "set-context", contextId: null });
    findOriginScroll.current = evidenceLedger.current?.scrollTop ?? 0;
    setFindDraft(findState.query);
    setFindOpen(true);
  };

  const cancelFindDebounce = () => {
    if (findDebounce.current !== null) window.clearTimeout(findDebounce.current);
    findDebounce.current = null;
  };

  const submitFind = (value: string) => {
    cancelFindDebounce();
    runtime.dispatch({ type: "set-find", value });
  };

  const scheduleFind = (value: string) => {
    setFindDraft(value);
    cancelFindDebounce();
    findDebounce.current = window.setTimeout(() => submitFind(value), 150);
  };

  const clearFind = () => {
    cancelFindDebounce();
    setFindDraft("");
    runtime.dispatch({ type: "clear-find" });
  };

  const closeFind = () => {
    clearFind();
    setFindOpen(false);
    if (findParkedContext.current && runtime.getSnapshot().contextId === null) {
      runtime.dispatch({ type: "set-context", contextId: findParkedContext.current });
    }
    if (findOriginScopePicker.current) setScopePickerOpen(true);
    window.requestAnimationFrame(() => {
      if (evidenceLedger.current) evidenceLedger.current.scrollTop = findOriginScroll.current;
      (findOrigin.current?.isConnected ? findOrigin.current : findTrigger.current)?.focus();
    });
  };

  useEffect(() => { setFindDraft(findState.query); }, [findState.query]);
  useEffect(() => {
    // Clear whichever debounce is pending at unmount.
    const pendingDebounce = findDebounce;
    return () => {
      if (pendingDebounce.current !== null) window.clearTimeout(pendingDebounce.current);
    };
  }, []);

  return {
    findOpen, findDraft, findInput, findTrigger, completedFindReveal,
    openFind, submitFind, scheduleFind, clearFind, closeFind
  };
}

export type FindController = ReturnType<typeof useFindController>;

/**
 * Centers a deliberately revealed Find match inside the Evidence ledger once.
 * Passive publications never repeat an already completed reveal.
 */
export function useFindReveal({
  find,
  findState,
  evidenceRows,
  evidenceLedger,
  events,
  geometry,
  scopePickerOpen
}: Readonly<{
  find: FindController;
  findState: FindState;
  evidenceRows: RefObject<Map<string, HTMLButtonElement>>;
  evidenceLedger: RefObject<HTMLDivElement | null>;
  events: WorkbenchSnapshot["evidence"]["events"];
  geometry: WorkbenchGeometry;
  scopePickerOpen: boolean;
}>): void {
  const { completedFindReveal } = find;
  useLayoutEffect(() => {
    const eventId = findState.currentEventId;
    if (!eventId || findState.loading || completedFindReveal.current === findState.revealRevision) return;
    const row = evidenceRows.current.get(eventId);
    const ledger = evidenceLedger.current;
    if (!row || !ledger || ledger.clientHeight === 0) return;
    // Scroll only this ledger, and account for its sticky header. Passive
    // publications never repeat an already completed deliberate reveal.
    const bounds = ledger.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const headerHeight = ledger.querySelector(".workbench-react__ledger-header")?.getBoundingClientRect().height ?? 0;
    const usableHeight = Math.max(rowBounds.height, ledger.clientHeight - headerHeight);
    ledger.scrollTop += rowBounds.top - bounds.top - headerHeight - Math.max(0, (usableHeight - rowBounds.height) / 2);
    completedFindReveal.current = findState.revealRevision;
    // `events`, `geometry`, and `scopePickerOpen` are deliberate triggers: a
    // pending reveal retries once the target row mounts or the ledger resizes.
  }, [completedFindReveal, evidenceRows, evidenceLedger, findState.currentEventId, findState.revealRevision, findState.loading, events, geometry, scopePickerOpen]);
}

/** Focuses the Find input whenever Find opens. */
export function useFindInputFocus(find: FindController): void {
  const { findOpen, findInput } = find;
  useLayoutEffect(() => {
    if (findOpen) findInput.current?.focus();
  }, [findInput, findOpen]);
}
