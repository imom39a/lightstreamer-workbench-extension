import { useState, type ReactElement } from "react";
import type { WorkbenchActivitySnapshot, WorkbenchRuntime } from "../workbench-runtime";

export function ObservedActivityDocument({ runtime, activity, scopeLabel }: { runtime: WorkbenchRuntime; activity: WorkbenchActivitySnapshot; scopeLabel: string }): ReactElement {
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [localSeries, setLocalSeries] = useState(false);
  const projection = activity.projection;
  const selected = selectedBucket === null ? null : projection.buckets[selectedBucket] ?? null;
  return <main className="workbench-react__document workbench-react__activity" aria-label="Observed Activity">
    <header className="workbench-react__pane-header">
      <div><span className="workbench-react__eyebrow">Observed Activity</span><strong>{scopeLabel}</strong></div>
      <div className="workbench-react__document-actions"><button type="button" onClick={() => runtime.dispatch({ type: "close-activity" })}>Back to Evidence</button></div>
    </header>
    <div className="workbench-react__document-boundary">
      <span>Scope <strong>{activity.scope.kind}</strong></span>
      <span>Filter <strong>{activity.filter.text || "None"}</strong></span>
      <span>History Interval <strong>{activity.readPoint.intervalId}</strong></span>
      <span>Committed Boundary <strong>{activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"}</strong></span>
      <span>Coverage <strong>{activity.readPoint.coverage}</strong></span>
      <span>View <strong>{projection.state === "UNAVAILABLE" ? "UNAVAILABLE" : "FOLLOW LIVE"}</strong></span>
    </div>
    {projection.reason ? <p className="workbench-react__document-status" role="status">{projection.reason}</p> : null}
    <section aria-label="Activity summary">
      <h2>Server activity</h2>
      <p>{projection.logicalUpdateTotal.toLocaleString()} Logical Updates · {projection.updateDeliveryTotal.toLocaleString()} Update Deliveries · {projection.snapshotLogicalUpdateTotal.toLocaleString()} snapshot · {projection.liveLogicalUpdateTotal.toLocaleString()} live</p>
      <label><input type="checkbox" checked={localSeries} onChange={(event) => setLocalSeries(event.currentTarget.checked)} /> Show separate <code>LOCAL</code> activity</label>{localSeries ? <p><code>LOCAL</code> · {projection.localLogicalUpdateTotal.toLocaleString()} Logical Updates · {projection.localUpdateDeliveryTotal.toLocaleString()} Update Deliveries</p> : null}
      <button type="button" onClick={() => runtime.dispatch({ type: "freeze-evidence" })}>Freeze Activity</button>{" "}
      <button type="button" onClick={() => runtime.dispatch({ type: "follow-live" })}>Follow Live</button>
    </section>
    <section aria-label="Activity timeline">
      <h2>Timeline · exact {projection.bucketDuration ?? "—"} ms buckets</h2>
      {projection.buckets.length === 0 ? <p>No matching accepted Server Logical Update Evidence.</p> : <table><caption>Server Logical Updates and Update Deliveries</caption><thead><tr><th>Interval</th><th>Snapshot</th><th>Live</th><th>Logical Updates</th><th>Update Deliveries</th></tr></thead><tbody>{projection.buckets.map((bucket, index) => <tr key={`${bucket.start}-${bucket.segment}`}><th scope="row"><button type="button" aria-pressed={selectedBucket === index} onClick={() => setSelectedBucket(index)}>{bucket.start}–{bucket.end}{bucket.currentPartial ? " · LIVE · PARTIAL" : bucket.firstPartial || bucket.finalPartial ? " · PARTIAL" : ""}</button></th><td>{bucket.snapshotLogicalUpdates}</td><td>{bucket.liveLogicalUpdates}</td><td>{bucket.logicalUpdates}</td><td>{bucket.updateDeliveries}</td></tr>)}</tbody></table>}
    </section>
    <section aria-label="Activity selection detail"><h2>Selection</h2>{selected ? <><p>{selected.start} ≤ timestamp &lt; {selected.end} · {selected.logicalUpdates} Server Logical Updates · segment {selected.segment}</p><button type="button" onClick={() => runtime.dispatch({ type: "show-activity-supporting-evidence", start: selected.start, end: selected.end })}>Show supporting Evidence</button></> : <p>Select a bucket, marker, or ranked identity to inspect exact supporting facts.</p>}</section>
    <section aria-label="Activity markers"><h2>Captured transitions, loss, and errors</h2>{projection.markers.length === 0 ? <p>No captured markers in the retained interval.</p> : <ul>{projection.markers.map((marker) => <li key={`${marker.sequence}-${marker.eventId}`}>{marker.timestamp} · {marker.label} · {marker.reportedCount === null ? "reported count unavailable" : `reported ${marker.reportedCount}`} · Evidence {marker.eventId}</li>)}</ul>}</section>
    <section aria-label="Activity ranking"><h2>Busiest {activity.scope.kind === "SUBSCRIPTION" ? "items" : "Subscriptions"}</h2>{projection.rankings.length === 0 ? <p>No ranked Server activity.</p> : <table><caption>Exact Server ranking</caption><thead><tr><th>Identity</th><th>Logical Updates</th><th>Update Deliveries</th></tr></thead><tbody>{projection.rankings.map((rank) => <tr key={rank.identity}><th scope="row">{rank.label}</th><td>{rank.logicalUpdates}</td><td>{rank.updateDeliveries}</td></tr>)}{projection.rankingOther ? <tr><th scope="row">Other</th><td>{projection.rankingOther.logicalUpdates}</td><td>{projection.rankingOther.updateDeliveries}</td></tr> : null}</tbody></table>}</section>
  </main>;
}
