import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";

import type { WorkbenchSnapshot } from "../../workbench-runtime";
import type { WorkbenchGeometry } from "../workbench-geometry";

type ElementRef<T extends HTMLElement = HTMLElement> = RefObject<T | null>;

/**
 * Restores the investigation's focus and scroll after the promoted
 * Notifications document closes, unless an entry was inspected.
 */
export function useNotificationsFocusRestoration({
  notificationsOpen,
  notificationsTrigger,
  evidenceLedger,
  contextBody,
  scopeTree
}: Readonly<{
  notificationsOpen: boolean;
  notificationsTrigger: ElementRef<HTMLButtonElement>;
  evidenceLedger: ElementRef<HTMLDivElement>;
  contextBody: ElementRef<HTMLDivElement>;
  scopeTree: ElementRef<HTMLDivElement>;
}>) {
  const notificationsOrigin = useRef({ evidenceScrollTop: 0, contextScrollTop: 0, scopeScrollTop: 0 });
  const previousNotificationsOpen = useRef(false);
  const inspectingNotification = useRef(false);

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
  }, [notificationsTrigger, evidenceLedger, contextBody, scopeTree, notificationsOpen]);

  return { notificationsOrigin, inspectingNotification };
}

/**
 * After a footer condition is dismissed, or disappears while its Dismiss
 * control is focused, moves focus to the next dismissible condition, the
 * Notifications entry, or the Live/Frozen control.
 *
 * Runs on every `diagnostics` identity change, as before: the runtime
 * rebuilds that array on each publication.
 */
export function useDiagnosticDismissFocus({
  diagnostics,
  notificationsTrigger,
  evidenceModeTrigger
}: Readonly<{
  diagnostics: WorkbenchSnapshot["diagnostics"];
  notificationsTrigger: ElementRef<HTMLButtonElement>;
  evidenceModeTrigger: ElementRef<HTMLButtonElement>;
}>) {
  const diagnosticDismissButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusedDiagnosticDismiss = useRef<Readonly<{ dismissalId: string; index: number }> | null>(null);
  const pendingDiagnosticDismissFocus = useRef<number | null>(null);

  useLayoutEffect(() => {
    const focused = focusedDiagnosticDismiss.current;
    if (
      pendingDiagnosticDismissFocus.current === null &&
      focused &&
      !diagnostics.some(({ dismissalId }) => dismissalId === focused.dismissalId)
    ) {
      pendingDiagnosticDismissFocus.current = focused.index;
    }
    const dismissedIndex = pendingDiagnosticDismissFocus.current;
    if (dismissedIndex !== null) {
      const dismissible = diagnostics.filter(({ dismissalId }) => dismissalId !== undefined);
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
  }, [notificationsTrigger, evidenceModeTrigger, diagnostics]);

  // Identity-stable so the memoized footer is not invalidated by this handle.
  return useMemo(
    () => ({ diagnosticDismissButtons, focusedDiagnosticDismiss, pendingDiagnosticDismissFocus }),
    [diagnosticDismissButtons, focusedDiagnosticDismiss, pendingDiagnosticDismissFocus]
  );
}

export type DiagnosticDismissFocus = ReturnType<typeof useDiagnosticDismissFocus>;

/**
 * Focus restoration for promoted and parked documents: standalone Local
 * Injection Draft park/close, Server Injection Draft close, Scenario
 * park/close, and the parked discard confirmations. The five effects keep
 * their original relative order.
 */
export function useDocumentFocusRestoration({
  geometry,
  localInjection,
  serverInjectionDraft,
  scenario,
  focusedEventId,
  selectionEventId,
  contextId,
  evidenceRows,
  scopeNodesById,
  scopeTrigger,
  contextLens,
  serverInjectionTrigger
}: Readonly<{
  geometry: WorkbenchGeometry;
  localInjection: WorkbenchSnapshot["localInjection"];
  serverInjectionDraft: NonNullable<WorkbenchSnapshot["serverInjection"]>["draft"];
  scenario: WorkbenchSnapshot["scenario"];
  focusedEventId: string | null;
  selectionEventId: string | null;
  contextId: string | null;
  evidenceRows: RefObject<Map<string, HTMLButtonElement>>;
  scopeNodesById: RefObject<Map<string, HTMLButtonElement>>;
  scopeTrigger: ElementRef<HTMLButtonElement>;
  contextLens: ElementRef;
  serverInjectionTrigger: ElementRef<HTMLButtonElement>;
}>) {
  const localInjectionDraft = localInjection.draft;
  const resumeLocalInjection = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardTrigger = useRef<HTMLButtonElement | null>(null);
  const parkedDiscardDialog = useRef<HTMLElement | null>(null);
  const restoreParkedDiscardFocus = useRef(false);
  const previousLocalInjectionDraft = useRef<WorkbenchSnapshot["localInjection"]["draft"]>(null);
  const previousServerInjectionDraft = useRef<NonNullable<WorkbenchSnapshot["serverInjection"]>["draft"]>(null);
  const previousScenario = useRef<WorkbenchSnapshot["scenario"]>(null);
  const previousParkedDiscardConfirmation = useRef(false);
  const parkedScenarioDiscardTrigger = useRef<HTMLButtonElement | null>(null);
  const parkedScenarioDiscardDialog = useRef<HTMLElement | null>(null);
  const restoreParkedScenarioDiscardFocus = useRef(false);
  const previousParkedScenarioDiscardConfirmation = useRef(false);

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
  }, [scopeNodesById, scopeTrigger, evidenceRows, contextLens, geometry, localInjectionDraft]);

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
  }, [serverInjectionTrigger, evidenceRows, contextLens, serverInjectionDraft]);

  useLayoutEffect(() => {
    const previous = previousScenario.current;
    const current = scenario;
    if (previous && (!current || (!previous.parked && current.parked))) {
      const origin = previous.scenario.restorationOrigin;
      const keepCurrentInvestigation = previous.parked && !current;
      const eventId = keepCurrentInvestigation
        ? focusedEventId ?? selectionEventId
        : origin.focusedEventId ?? origin.selectionEventId;
      const restoredContextId = keepCurrentInvestigation ? contextId : origin.contextId;
      window.requestAnimationFrame(() => {
        const target = eventId ? evidenceRows.current.get(eventId) : null;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else if (restoredContextId) contextLens.current?.focus({ preventScroll: true });
        else scopeTrigger.current?.focus({ preventScroll: true });
      });
    }
    previousScenario.current = current;
    // Runs only on Scenario transitions; the investigation identities are
    // read from the transition's render and must not retrigger restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  useLayoutEffect(() => {
    const confirmation = Boolean(scenario?.parked && scenario.discardConfirmation);
    if (!previousParkedScenarioDiscardConfirmation.current && confirmation) {
      parkedScenarioDiscardDialog.current?.focus();
    } else if (previousParkedScenarioDiscardConfirmation.current && !confirmation && restoreParkedScenarioDiscardFocus.current) {
      restoreParkedScenarioDiscardFocus.current = false;
      parkedScenarioDiscardTrigger.current?.focus();
    }
    previousParkedScenarioDiscardConfirmation.current = confirmation;
  }, [scenario?.parked, scenario?.discardConfirmation]);

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

  return {
    resumeLocalInjection, parkedDiscardTrigger, parkedDiscardDialog, restoreParkedDiscardFocus,
    parkedScenarioDiscardTrigger, parkedScenarioDiscardDialog, restoreParkedScenarioDiscardFocus
  };
}
