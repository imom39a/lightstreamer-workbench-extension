import { memo, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";

import type { WorkbenchCommand, WorkbenchSnapshot } from "../workbench-runtime";
import { TOPOLOGY_SENSITIVE_CATEGORIES, type TopologySensitiveCategory } from "../topology-export";
import type { Filter, TypedFilterValue } from "../../../core/filter-algebra";
import type { EvidenceFilterActionDescriptor } from "../../../core/evidence-filter-actions";
import type { AnalyticsClient } from "../../analytics/client";
import type { AgentConnection } from "../agent-connection";
import { ActivityContextSummary } from "./activity-context-summary";
import type { FilterValueState } from "./filter-value-control";
import { SelectedFilterActions } from "./filter-workflow";
import { SessionOperations } from "./session-operations";

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


export type ContextPaneMode = "actions" | "export" | "inspect";

export type ContextPaneActions = Readonly<{
  dispatch(command: WorkbenchCommand): void;
  collapseContext(): void;
  closeActions(): void;
  restoreEvidenceFocus(): void;
  copyScopedEvidence(): void;
  exportScope(): void;
  toggleExportRedaction(category: TopologySensitiveCategory, checked: boolean): void;
  setCompleteEvidence(complete: boolean): void;
  downloadExport(format: "json" | "html"): Promise<void>;
  applySelectedFilterAction(action: EvidenceFilterActionDescriptor): void;
  applySelectedFilterValue(value: TypedFilterValue, state: FilterValueState): void;
  applyActivityRankingFilter(expectedRevision: number, rankingId: string): void;
  resetFilter(): void;
}>;

export type ContextPaneProps = Readonly<{
  contextMode: ContextPaneMode;
  selected: WorkbenchSnapshot["selectedEvidence"] | null;
  context: WorkbenchSnapshot["context"];
  appliedFilter: Filter;
  appliedFilterSummary: string;
  hasActiveFilter: boolean;
  frozen: boolean;
  activityProjection: NonNullable<WorkbenchSnapshot["activity"]>["projection"] | undefined;
  localInjectionSelectedUpdate: WorkbenchSnapshot["localInjection"]["availability"]["selectedUpdate"];
  serverInjectionAvailability: NonNullable<WorkbenchSnapshot["serverInjection"]>["availability"] | null;
  exportSnapshot: WorkbenchSnapshot["export"];
  exportDownloadStatus: string;
  activitySummaryOpen: boolean;
  setActivitySummaryOpen: Dispatch<SetStateAction<boolean>>;
  selectedFilterActionsOpen: boolean;
  setSelectedFilterActionsOpen: Dispatch<SetStateAction<boolean>>;
  selectedEvidenceMetadataOpen: boolean;
  setSelectedEvidenceMetadataOpen: Dispatch<SetStateAction<boolean>>;
  /** Full snapshot for Session operations; null outside Actions mode so publications do not invalidate the pane. */
  sessionSnapshot: WorkbenchSnapshot | null;
  shown: number;
  analytics: AnalyticsClient;
  agentConnection: AgentConnection | undefined;
  contextLens: RefObject<HTMLElement | null>;
  contextCollapse: RefObject<HTMLButtonElement | null>;
  contextBody: RefObject<HTMLDivElement | null>;
  serverInjectionTrigger: RefObject<HTMLButtonElement | null>;
  scopedCopyTrigger: RefObject<HTMLButtonElement | null>;
  exportTrigger: RefObject<HTMLButtonElement | null>;
  agentAccessDetails: RefObject<HTMLDetailsElement | null>;
  agentAccessControl: RefObject<HTMLButtonElement | null>;
  actions: ContextPaneActions;
}>;

/**
 * Context: the active runtime object or selected Evidence, scoped export
 * options, and Session operations. Memoized on narrow, identity-stable
 * props so Evidence-only publications do not re-render it; disclosure
 * state stays in the panel so it survives promoted documents.
 */
export const ContextPane = memo(function ContextPane({
  contextMode,
  selected,
  context,
  appliedFilter,
  appliedFilterSummary,
  hasActiveFilter,
  frozen,
  activityProjection,
  localInjectionSelectedUpdate,
  serverInjectionAvailability,
  exportSnapshot,
  exportDownloadStatus,
  activitySummaryOpen,
  setActivitySummaryOpen,
  selectedFilterActionsOpen,
  setSelectedFilterActionsOpen,
  selectedEvidenceMetadataOpen,
  setSelectedEvidenceMetadataOpen,
  sessionSnapshot,
  shown,
  analytics,
  agentConnection,
  contextLens,
  contextCollapse,
  contextBody,
  serverInjectionTrigger,
  scopedCopyTrigger,
  exportTrigger,
  agentAccessDetails,
  agentAccessControl,
  actions
}: ContextPaneProps): JSX.Element {
  const canCreateLocalInjectionDraft = localInjectionSelectedUpdate.available;
  const serverInjection = serverInjectionAvailability ? { availability: serverInjectionAvailability } : null;
  const canCloneClientMessage = serverInjection?.availability.cloneSelected.available ?? false;
  const canAuthorClientMessage = serverInjection?.availability.authorSelectedClient.available ?? false;
  return (
        <aside className="workbench-react__pane workbench-react__context" id="workbench-context" aria-label="Context">
          <header className="workbench-react__pane-header"><div><span className="workbench-react__eyebrow">{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Scoped export" : selected ? `Selected Evidence · ${selected.source}` : "Runtime object"}</span><strong ref={contextLens} role="heading" aria-level={2} tabIndex={-1}>{contextMode === "actions" ? "Session operations" : contextMode === "export" ? "Export current Scope" : context.title}</strong></div><div>{contextMode !== "actions" ? <button ref={contextCollapse} className="workbench-react__context-collapse" type="button" onClick={actions.collapseContext}>Collapse Context</button> : null}{contextMode === "actions" ? <button type="button" onClick={actions.closeActions}>Back to prior investigation</button> : <button className="workbench-react__compact-back" type="button" onClick={actions.restoreEvidenceFocus}>Back to Evidence</button>}</div></header>
          <div className="workbench-react__context-body" ref={contextBody}>
            {contextMode === "actions" && sessionSnapshot ? <SessionOperations snapshot={sessionSnapshot} shown={shown} analytics={analytics} agentConnection={agentConnection} agentAccessDetails={agentAccessDetails} agentAccessControl={agentAccessControl} scopedCopyTrigger={scopedCopyTrigger} exportTrigger={exportTrigger} onCommand={command => actions.dispatch(command)} onCopy={actions.copyScopedEvidence} onExport={actions.exportScope} /> : contextMode === "export" ? <section className="workbench-react__export" aria-label="Scoped export options">
              <p>Download the current Scope as versioned JSON or offline HTML. Credentials are always excluded.</p>
              {exportSnapshot.operation?.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Preparing retained-Evidence export: {exportSnapshot.operation.progress.completed.toLocaleString()} of {(exportSnapshot.operation.progress.total ?? 0).toLocaleString()} Evidence.</p><button type="button" onClick={() => actions.dispatch({ type: "cancel-evidence-operation" })}>Cancel export</button></> : null}
              {exportSnapshot.operation && exportSnapshot.operation.state !== "preparing" && exportSnapshot.operation.error ? <p className="workbench-react__copy-status" role="status">{exportSnapshot.operation.error} {exportSnapshot.operation.recovery ?? ""}</p> : null}
              <fieldset><legend>Redact sensitive categories</legend>{TOPOLOGY_SENSITIVE_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={exportSnapshot.redactions.includes(category)} onChange={(event) => actions.toggleExportRedaction(category, event.currentTarget.checked)} />{sensitiveCategoryLabel(category)} ({exportSnapshot.sensitiveCounts[category].toLocaleString()})</label>)}</fieldset>
              <label><input type="checkbox" checked={exportSnapshot.completeEvidence} onChange={(event) => actions.setCompleteEvidence(event.currentTarget.checked)} />Include complete establishment and COMMAND generation evidence</label>
              <div className="workbench-react__context-actions"><button type="button" disabled={!exportSnapshot.json} onClick={() => actions.downloadExport("json")}>Download JSON</button><button type="button" disabled={!exportSnapshot.document} onClick={() => actions.downloadExport("html")}>Download HTML</button></div>
              {exportDownloadStatus ? <p className="workbench-react__copy-status" role="status" aria-live="polite">{exportDownloadStatus}</p> : null}
            </section> : <>
              {activityProjection ? <ActivityContextSummary projection={activityProjection} filterSummary={appliedFilterSummary} hasActiveFilter={hasActiveFilter} frozen={frozen} open={activitySummaryOpen} onOpenChange={setActivitySummaryOpen} onRankingFilter={actions.applyActivityRankingFilter} onResetFilter={actions.resetFilter} /> : null}
              {selected ? <SelectedFilterActions
                actions={context.filterActions ?? []}
                filter={appliedFilter}
                open={selectedFilterActionsOpen}
                onOpenChange={setSelectedFilterActionsOpen}
                onAction={actions.applySelectedFilterAction}
                onValueChange={actions.applySelectedFilterValue}
              /> : null}
              {selected ? <details className="workbench-react__evidence-metadata workbench-context-disclosure" aria-label="Evidence metadata" open={selectedEvidenceMetadataOpen} onToggle={event => setSelectedEvidenceMetadataOpen(event.currentTarget.open)}>
                <summary>Evidence metadata</summary>
                <dl className="workbench-react__context-fields">{context.fields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl>
              </details> : <dl className="workbench-react__context-fields" aria-label="Runtime metadata">{context.fields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl>}
              {context.groups?.map(group => <details key={group.title} className="workbench-context-disclosure" aria-label={group.title}><summary>{group.title}</summary><dl className="workbench-react__context-fields">{group.fields.flatMap(([name, value]) => [<dt key={`${name}-term`}>{name}</dt>, <dd key={`${name}-value`}>{value}</dd>])}</dl></details>)}
              <SelectedUpdateDetails update={context.selectedUpdate} />
              <div className="workbench-react__context-actions">
                {selected ? <>
                  <button
                    type="button"
                    className={!canCreateLocalInjectionDraft ? "workbench-react__context-action--unavailable" : undefined}
                    disabled={!canCreateLocalInjectionDraft}
                    aria-describedby={!canCreateLocalInjectionDraft ? "workbench-local-injection-unavailable-reason" : undefined}
                    onClick={() => actions.dispatch({ type: "begin-local-injection-from-selection" })}
                  >Create Local Injection Draft{!canCreateLocalInjectionDraft ? " · Unavailable" : ""}</button>
                  {!canCreateLocalInjectionDraft && localInjectionSelectedUpdate.reason
                    ? <span className="workbench-react__action-reason" id="workbench-local-injection-unavailable-reason">{localInjectionSelectedUpdate.reason}</span>
                    : null}
                  {serverInjection ? selected.raw.clientMessage ? <>
                    <button
                      ref={serverInjectionTrigger}
                      type="button"
                      className={!canCloneClientMessage ? "workbench-react__context-action--unavailable" : undefined}
                      disabled={!canCloneClientMessage}
                      aria-describedby={!canCloneClientMessage ? "workbench-server-injection-unavailable-reason" : undefined}
                      onClick={() => actions.dispatch({ type: "begin-server-injection-from-selection" })}
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
                      onClick={() => actions.dispatch({ type: "begin-server-injection-from-selected-client" })}
                    >Author Client Message{!canAuthorClientMessage ? " · Unavailable" : ""}</button>
                    {!canAuthorClientMessage && serverInjection.availability.authorSelectedClient.reason
                      ? <span className="workbench-react__action-reason" id="workbench-server-author-unavailable-reason">{serverInjection.availability.authorSelectedClient.reason}</span>
                      : null}
                  </> : null}
                  <button type="button" onClick={() => actions.dispatch({ type: "open-raw-evidence", eventId: selected.id })}>Open complete raw</button>
                </> : <button type="button" onClick={() => actions.dispatch({ type: "export-scope" })}>Export Scope…</button>}
              </div>
            </>}
          </div>
        </aside>
  );
});
