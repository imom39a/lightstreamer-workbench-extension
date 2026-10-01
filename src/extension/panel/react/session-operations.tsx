import type { JSX, RefObject } from "react";
import type { WorkbenchCommand, WorkbenchSnapshot } from "../workbench-runtime";
import type { AnalyticsClient } from "../../analytics/client";
import type { AgentConnection } from "../agent-connection";
import { WORKBENCH_PUBLIC_RESOURCES } from "../public-resources";
import { UsageAnalytics } from "./usage-analytics";
import { AgentAccess } from "./agent-access";

type Props = Readonly<{
  snapshot: WorkbenchSnapshot;
  shown: number;
  analytics: AnalyticsClient;
  agentConnection?: AgentConnection;
  agentAccessDetails: RefObject<HTMLDetailsElement | null>;
  agentAccessControl: RefObject<HTMLButtonElement | null>;
  scopedCopyTrigger: RefObject<HTMLButtonElement | null>;
  exportTrigger: RefObject<HTMLButtonElement | null>;
  onCommand(command: WorkbenchCommand): void;
  onCopy(): void;
  onExport(): void;
}>;

/** Session actions; History ownership and operation focus remain in the panel. */
export function SessionOperations({
  snapshot, shown, analytics, agentConnection, agentAccessDetails, agentAccessControl,
  scopedCopyTrigger, exportTrigger, onCommand, onCopy, onExport
}: Props): JSX.Element {
  const historyStatus = snapshot.retention.historyStatus;
  return <section className="workbench-react__operations" aria-label="Session operations">
    <section className="workbench-react__operations-transfer" aria-label="Copy and Export">
      <div className="workbench-react__operations-transfer-actions">
        {snapshot.evidenceCopy.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Reading retained Evidence: {(snapshot.evidenceCopy.progress?.completed ?? 0).toLocaleString()} of {(snapshot.evidenceCopy.progress?.total ?? 0).toLocaleString()} Evidence · {snapshot.evidenceCopy.progress?.excludedAfterLatch ?? 0} accepted after the latched boundary excluded.</p><button type="button" onClick={() => onCommand({ type: "cancel-evidence-operation" })}>Cancel copy</button></> : <button ref={scopedCopyTrigger} type="button" onClick={() => { onCopy(); }}>Copy retained scoped Evidence</button>}
        {snapshot.export.operation?.state === "preparing" ? <><p className="workbench-react__operation-progress" role="status" aria-live="polite" aria-busy="true">Preparing retained-Evidence export: {(snapshot.export.operation.progress.completed ?? 0).toLocaleString()} of {(snapshot.export.operation.progress.total ?? 0).toLocaleString()} Evidence · {snapshot.export.operation.progress.excludedAfterLatch} accepted after the latched boundary excluded.</p><button type="button" onClick={() => onCommand({ type: "cancel-evidence-operation" })}>Cancel export</button></> : <button ref={exportTrigger} type="button" onClick={() => { onExport(); }}>Export Scope…</button>}
      </div>
      <p>Copy redacts Client Message bodies and outcomes. Export excludes credentials.</p>
    </section>
    <AgentAccess connection={agentConnection} detailsRef={agentAccessDetails} controlRef={agentAccessControl} />
    <details className="workbench-context-disclosure workbench-react__operations-details"><summary>History and privacy details</summary>
      <p>{historyStatus.captured.toLocaleString()} captured · {historyStatus.retained.toLocaleString()} retained · {shown.toLocaleString()} shown. Capacity {historyStatus.capacity.state.replaceAll("_", " ")} ({historyStatus.capacity.tier}).</p>
      <p>Copy covers retained Evidence in the current Scope and Filter. Copy and Export read an immutable latched boundary; later accepted Evidence is excluded.</p>
      <p>The current Panel Session owns one temporary Event History using <strong>{snapshot.storage.mode === "indexeddb" ? "IndexedDB" : "in-memory fallback"}</strong>. Closing attempts controlled erasure; abnormal termination relies on guarded cleanup, and residual data may remain until the extension next runs.</p>
    </details>
    <section>
      <h3>Help &amp; resources</h3>
      <nav className="workbench-react__resource-links" aria-label="Help and resources">{WORKBENCH_PUBLIC_RESOURCES.map((resource) => <a className="workbench-react__resource-link" href={resource.href} target="_blank" rel="noopener noreferrer" key={resource.href} onClick={() => analytics.track({ name: "feature_used", params: { feature: resource.label === "Documentation" ? "documentation" : resource.label === "Privacy" ? "privacy" : "support", action: "open" } })}>{resource.label}</a>)}</nav>
      <details className="workbench-context-disclosure"><summary>Notifications and retention</summary><p>Notifications span all runtime Scopes, oldest first. Their filters do not change Evidence. Dismissing a footer condition leaves its notification until the condition ends. Up to {snapshot.notifications.limit} recent diagnostics are kept; supporting Evidence follows Event History retention.</p></details>
      <UsageAnalytics client={analytics} />
    </section>
    <section className="workbench-react__operations-danger">
      {snapshot.retention.clearState === "confirming" ? <div className="workbench-react__confirmation"><strong>Clear all {historyStatus.retained.toLocaleString()} retained Evidence events for this Panel Session?</strong><span>Scope and Filter do not limit this action. This removes retained Evidence from this Panel Session and cannot be undone.</span><div><button className="workbench-react__confirmation-primary" type="button" onClick={() => onCommand({ type: "confirm-clear-history" })}>Clear retained events</button><button type="button" onClick={() => onCommand({ type: "cancel-clear-history" })}>Keep Evidence</button></div></div> : <button type="button" onClick={() => onCommand({ type: "request-clear-history" })}>Clear retained Evidence…</button>}
    </section>
  </section>;
}
