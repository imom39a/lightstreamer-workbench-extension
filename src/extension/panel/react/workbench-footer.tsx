import { memo, type JSX, type RefObject } from "react";

import type { WorkbenchCommand, WorkbenchDiagnostic, WorkbenchSnapshot } from "../workbench-runtime";
import { DiagnosticDetails } from "./diagnostic-details";
import { notificationEntryId, notificationForCondition } from "./notifications-document";
import type { DiagnosticDismissFocus } from "./hooks/use-focus-restoration";

export type WorkbenchFooterActions = Readonly<{
  dispatch(command: WorkbenchCommand): void;
  openNotifications(): void;
}>;

type FooterDiagnosticsProps = Readonly<{
  diagnostics: readonly WorkbenchDiagnostic[];
  notificationEntries: WorkbenchSnapshot["notifications"]["entries"];
  notificationsPresented: boolean;
  compact: boolean;
  dismissFocus: DiagnosticDismissFocus;
  actions: WorkbenchFooterActions;
}>;

const FooterDiagnostics = memo(function FooterDiagnostics({
  diagnostics,
  notificationEntries,
  notificationsPresented,
  compact,
  dismissFocus,
  actions
}: FooterDiagnosticsProps): JSX.Element {
  const { diagnosticDismissButtons, focusedDiagnosticDismiss, pendingDiagnosticDismissFocus } = dismissFocus;
  return <div className="workbench-react__status-diagnostics" tabIndex={0} aria-label="Workbench diagnostic entries" onKeyDown={(event) => {
          if (event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
        }}>
          {diagnostics.length > 1 ? <span className="workbench-react__status-diagnostics-summary">{diagnostics.length} diagnostics · Scroll to review all</span> : null}
          {diagnostics.map((diagnostic, index) => <section className="workbench-react__status-diagnostic" data-category={diagnostic.category} data-history-condition={diagnostic.category === "history" ? "true" : undefined} data-severity={diagnostic.severity.toLowerCase()} key={diagnostic.dismissalId ?? (diagnostic.id ? `${diagnostic.code ?? diagnostic.title}:${diagnostic.id}` : `${diagnostic.title}-${index}`)}>
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
                  index: diagnostics
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
                pendingDiagnosticDismissFocus.current = diagnostics
                  .slice(0, index)
                  .filter(({ dismissalId }) => dismissalId !== undefined)
                  .length;
                actions.dispatch({ type: "dismiss-diagnostic", dismissalId: diagnostic.dismissalId! });
              }}
            >Dismiss</button> : null}
            {notificationsPresented && notificationForCondition(notificationEntries, diagnostic) ? <button type="button" aria-label={`View ${diagnostic.title} for ${diagnostic.affected} in Notifications`} onClick={() => {
              const notification = notificationForCondition(notificationEntries, diagnostic);
              const entry = notification ? document.getElementById(notificationEntryId(notification)) : null;
              entry?.focus({ preventScroll: true });
              entry?.scrollIntoView({ block: "nearest" });
            }}>View in Notifications</button> : <DiagnosticDetails diagnostic={diagnostic} compact={compact} onInspect={() => {
              if (!diagnostic.route) return;
              actions.dispatch(diagnostic.route.kind === "inspect-evidence" ? { type: "inspect-diagnostic-evidence", evidence: diagnostic.route.evidence } : { type: "inspect-diagnostic-affected", affected: diagnostic.route.affected });
            }} />}
          </section>)}
        </div>;
});

export type WorkbenchFooterProps = Readonly<{
  diagnostics: readonly WorkbenchDiagnostic[];
  historyAnnouncement: string;
  retained: number;
  accepted: number;
  storageMode: WorkbenchSnapshot["storage"]["mode"];
  notificationsTotal: number;
  notificationSeverity: "Error" | "Warning" | null;
  notificationEntries: WorkbenchSnapshot["notifications"]["entries"];
  notificationsOpen: boolean;
  notificationsPresented: boolean;
  notificationsDisabled: boolean;
  frozen: boolean;
  compactDiagnostics: boolean;
  notificationsTrigger: RefObject<HTMLButtonElement | null>;
  evidenceModeTrigger: RefObject<HTMLButtonElement | null>;
  dismissFocus: DiagnosticDismissFocus;
  actions: WorkbenchFooterActions;
}>;

/**
 * Global footer: History announcement, active Capture/History/storage
 * conditions with Dismiss, retained-History status, Notifications, and
 * Live/Frozen. Memoized on narrow props; the panel keeps dismiss-focus
 * restoration so its effect order is unchanged.
 */
export const WorkbenchFooter = memo(function WorkbenchFooter({
  diagnostics,
  historyAnnouncement,
  retained,
  accepted,
  storageMode,
  notificationsTotal,
  notificationSeverity,
  notificationEntries,
  notificationsOpen,
  notificationsPresented,
  notificationsDisabled,
  frozen,
  compactDiagnostics,
  notificationsTrigger,
  evidenceModeTrigger,
  dismissFocus,
  actions
}: WorkbenchFooterProps): JSX.Element {
  const storageLabel = storageMode === "indexeddb" ? "IndexedDB" : "Memory";
  return <footer className="workbench-react__status" role="region" aria-label="Workbench diagnostics" tabIndex={diagnostics.length ? 0 : -1}>
        <div className="workbench-react__history-live-region" aria-live="polite" aria-atomic="true">{historyAnnouncement}</div>
        {diagnostics.length ? <FooterDiagnostics
          diagnostics={diagnostics}
          notificationEntries={notificationEntries}
          notificationsPresented={notificationsPresented}
          compact={compactDiagnostics}
          dismissFocus={dismissFocus}
          actions={actions}
        /> : null}
        <div className="workbench-react__status-line"><span
          data-history-status
          aria-label={`${retained.toLocaleString()} retained Evidence of ${accepted.toLocaleString()} accepted`}
          title={`${retained.toLocaleString()} retained Evidence of ${accepted.toLocaleString()} accepted · ${storageLabel}`}
        >{retained.toLocaleString()}/{accepted.toLocaleString()} Evidence · {storageLabel}</span><button
              ref={notificationsTrigger}
              type="button"
              disabled={notificationsDisabled}
              aria-expanded={notificationsPresented}
              aria-controls={notificationsPresented ? "workbench-notifications" : undefined}
              onClick={() => notificationsOpen ? actions.dispatch({ type: "close-notifications" }) : actions.openNotifications()}
            >Notifications ({notificationsTotal}){notificationSeverity ? ` · ${notificationSeverity}` : ""}</button><button ref={evidenceModeTrigger} type="button" onClick={() => actions.dispatch({ type: frozen ? "follow-live" : "freeze-evidence" })}>{frozen ? "Follow Live" : "Freeze Evidence"}</button></div>
      </footer>;
});
