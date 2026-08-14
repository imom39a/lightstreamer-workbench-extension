import { useMemo, type KeyboardEvent, type ReactElement } from "react";
import { sortActivityRankings } from "../../../core/activity-projection";
import type { WorkbenchActivitySnapshot, WorkbenchRuntime } from "../workbench-runtime";

function moveIndex(current: number, length: number, key: string): number {
  if (length === 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(length - 1, current + 1);
  return current;
}

function barPercent(value: number, maximum: number): number {
  return maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
}

export function ObservedActivityDocument({ runtime, activity, scopeLabel }: { runtime: WorkbenchRuntime; activity: WorkbenchActivitySnapshot; scopeLabel: string }): ReactElement {
  const projection = activity.projection;
  const document = activity.document;
  const selected = document?.selection ?? null;
  const selectedBucket = selected?.kind === "bucket" ? projection.buckets[Number(selected.id)] ?? null : null;
  const selectedMarker = selected?.kind === "marker" ? projection.markers[Number(selected.id)] ?? null : null;
  const selectedRanking = selected?.kind === "ranking" ? projection.allRankings.find((ranking) => ranking.identity === selected.id) ?? null : null;
  const rankings = useMemo(() => sortActivityRankings(projection.allRankings, document?.rankingSort ?? "LOGICAL_UPDATES"), [document?.rankingSort, projection.allRankings]);
  const selectBucket = (index: number) => runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: String(index) } });
  const selectionContext = (provenance: "SERVER" | "LOCAL") =>
    `provenance ${provenance} · Scope ${activity.scope.kind} · Filter ${activity.filter.text || "None"} · Committed Boundary ${activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"} · Observation Coverage ${activity.readPoint.coverage}`;
  const onTimelineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!projection.buckets.length) return;
    const current = selected?.kind === "bucket" ? Number(selected.id) : 0;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectBucket(moveIndex(current, projection.buckets.length, event.key));
    } else if (event.key === "Enter" && selectedBucket) {
      event.preventDefault();
      runtime.dispatch({ type: "show-activity-supporting-evidence", start: selectedBucket.start, end: selectedBucket.end });
    }
  };
  const selectionText = selectedBucket
    ? `${selectedBucket.start} ≤ timestamp < ${selectedBucket.end} · ${selectedBucket.logicalUpdates} Server Logical Updates · ${selectedBucket.updateDeliveries} Update Deliveries · segment ${selectedBucket.segment} · ${selectionContext("SERVER")}`
    : selectedMarker
      ? `${selectedMarker.timestamp} · ${selectedMarker.label} · ${selectedMarker.clientId ?? "client unknown"} · ${selectedMarker.sessionId ?? "Session unknown"} · ${selectedMarker.subscriptionId ?? "Subscription unknown"} · ${selectedMarker.reportedCount === null ? "reported count unavailable" : `reported ${selectedMarker.reportedCount}`} · ${selectedMarker.errorCode === null ? "error code unavailable" : `error ${selectedMarker.errorCode}`} · ${selectedMarker.errorMessage ?? "error message unavailable"} · ${selectedMarker.consequenceLimit} · Evidence ${selectedMarker.eventId} · ${selectionContext(selectedMarker.provenance)}`
      : selectedRanking
        ? `${selectedRanking.label} · ${selectedRanking.logicalUpdates} Logical Updates · ${selectedRanking.updateDeliveries} Update Deliveries · ${selectionContext("SERVER")}`
        : null;
  const selectedMarkerBucket = selectedMarker
    ? projection.buckets.find((bucket) => selectedMarker.timestamp >= bucket.start && selectedMarker.timestamp < bucket.end) ?? null
    : null;
  const supportingRange = selectedBucket ?? selectedMarkerBucket;

  return <main className="workbench-react__document workbench-react__activity" aria-label="Observed Activity">
    <header className="workbench-react__pane-header">
      <div><span className="workbench-react__eyebrow">Observed Activity</span><strong>{scopeLabel}</strong></div>
      <div className="workbench-react__document-actions"><button type="button" onClick={() => runtime.dispatch({ type: "close-activity" })}>Back to Evidence</button></div>
    </header>
    <div className="workbench-react__document-boundary" aria-label="Activity truth boundary">
      <span>Scope <strong>{activity.scope.kind}</strong></span>
      <span>Filter <strong>{activity.filter.text || "None"}</strong></span>
      <span>History Interval <strong>{activity.readPoint.intervalId}</strong></span>
      <span>Committed Boundary <strong>{activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"}</strong></span>
      <span>Coverage <strong>{activity.readPoint.coverage}</strong></span>
      <span>View <strong>{document?.view ?? "FOLLOW LIVE"}</strong>{document?.newerMatchingEvidence ? ` · ${document.newerMatchingEvidence} newer` : ""}</span>
    </div>
    {projection.reason ? <p className="workbench-react__document-status" role="status">{projection.reason}</p> : null}
    <div className="workbench-react__activity-scroll">
      <section className="workbench-react__activity-summary" aria-label="Activity summary">
        <h2>Observed Server activity</h2>
        <p>{projection.logicalUpdateTotal.toLocaleString()} Logical Updates · {projection.updateDeliveryTotal.toLocaleString()} Update Deliveries · {projection.snapshotLogicalUpdateTotal.toLocaleString()} snapshot · {projection.liveLogicalUpdateTotal.toLocaleString()} live</p>
        <label><input type="checkbox" checked={document?.localSeries ?? false} onChange={(event) => runtime.dispatch({ type: "set-activity-local-series", enabled: event.currentTarget.checked })} /> Show separate <code>LOCAL</code> activity</label>
        {document?.localSeries ? <p><code>LOCAL</code> · {projection.localLogicalUpdateTotal.toLocaleString()} Logical Updates · {projection.localUpdateDeliveryTotal.toLocaleString()} Update Deliveries</p> : null}
        <div className="workbench-react__activity-actions"><button type="button" onClick={() => runtime.dispatch({ type: "freeze-activity" })} disabled={document?.view === "FROZEN"}>Freeze Activity</button><button type="button" onClick={() => runtime.dispatch({ type: "follow-activity" })} disabled={document?.view !== "FROZEN"}>Follow Live</button></div>
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity timeline">
        <h2>Timeline · exact {projection.bucketDuration ?? "—"} ms buckets</h2>
        {projection.buckets.length === 0 ? <p>No matching accepted Server Logical Update Evidence.</p> : <div className="workbench-react__activity-plot" role="grid" aria-label="Activity timeline buckets" tabIndex={0} onKeyDown={onTimelineKeyDown}>
          <div className="workbench-react__activity-small-multiples" role="group" aria-label="Server activity small multiples">
            <p className="workbench-react__activity-scale-note">Server Logical Updates and Update Deliveries · zero-based linear scale · exact values remain in the table</p>
            {(["logicalUpdates", "updateDeliveries"] as const).map((metric) => {
              const maximum = Math.max(1, ...projection.buckets.map((bucket) => bucket[metric]));
              const label = metric === "logicalUpdates" ? "Server Logical Updates" : "Update Deliveries";
              return <div className="workbench-react__activity-multiple" key={metric} role="img" aria-label={`${label} small multiple, zero-based linear scale`}>
                <strong>{label}</strong>
                <div className="workbench-react__activity-bars" aria-hidden="true">{projection.buckets.map((bucket, index) => <span className="workbench-react__activity-bar" data-selected={selected?.kind === "bucket" && selected.id === String(index)} key={`${metric}-${bucket.start}-${bucket.segment}`}><span style={{ height: `${barPercent(bucket[metric], maximum)}%` }} /></span>)}</div>
              </div>;
            })}
          </div>
          <table><caption>Server Logical Updates and Update Deliveries</caption><thead><tr><th scope="col">Interval</th><th scope="col">Snapshot</th><th scope="col">Live</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{projection.buckets.map((bucket, index) => <tr key={`${bucket.start}-${bucket.segment}`} aria-selected={selected?.kind === "bucket" && selected.id === String(index)}><th scope="row"><button type="button" aria-pressed={selected?.kind === "bucket" && selected.id === String(index)} onClick={() => selectBucket(index)}>{bucket.start}–{bucket.end}{bucket.currentPartial ? " · LIVE · PARTIAL" : bucket.firstPartial || bucket.finalPartial ? " · PARTIAL" : ""}</button></th><td>{bucket.snapshotLogicalUpdates}</td><td>{bucket.liveLogicalUpdates}</td><td>{bucket.logicalUpdates}</td><td>{bucket.updateDeliveries}</td></tr>)}</tbody></table>
        </div>}
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity selection detail"><h2>Selection</h2>{selectionText ? <><p>{selectionText}</p>{supportingRange ? <button type="button" onClick={() => runtime.dispatch({ type: "show-activity-supporting-evidence", start: supportingRange.start, end: supportingRange.end })}>Show supporting Evidence</button> : <p>Show supporting Evidence is available for time selections.</p>}</> : <p>Select a bucket, marker, or ranked identity to inspect exact supporting facts.</p>}</section>
      <section className="workbench-react__activity-section" aria-label="Activity markers"><h2>Captured transitions, loss, and errors</h2>{projection.markers.length === 0 ? <p>No captured markers in the retained interval.</p> : <ul className="workbench-react__activity-markers">{projection.markers.map((marker, index) => <li key={`${marker.sequence}-${marker.eventId}`}><button type="button" aria-pressed={selected?.kind === "marker" && selected.id === String(index)} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "marker", id: String(index) } })}>{marker.timestamp} · {marker.label} · {marker.reportedCount === null ? "reported count unavailable" : `reported ${marker.reportedCount}`} · Evidence {marker.eventId}</button></li>)}</ul>}</section>
      <section className="workbench-react__activity-section" aria-label="Activity ranking"><div className="workbench-react__activity-section-heading"><h2>Busiest {activity.scope.kind === "SUBSCRIPTION" ? "items" : "Subscriptions"}</h2><div role="group" aria-label="Rank by"><button type="button" aria-pressed={document?.rankingSort === "LOGICAL_UPDATES"} onClick={() => runtime.dispatch({ type: "set-activity-ranking-sort", sort: "LOGICAL_UPDATES" })}>Logical Updates</button><button type="button" aria-pressed={document?.rankingSort === "UPDATE_DELIVERIES"} onClick={() => runtime.dispatch({ type: "set-activity-ranking-sort", sort: "UPDATE_DELIVERIES" })}>Update Deliveries</button></div></div>{rankings.length === 0 ? <p>No ranked Server activity.</p> : <><div className="workbench-react__activity-ranking-bars" role="group" aria-label="Busiest ranking bars"><p className="workbench-react__activity-scale-note">Server Logical Updates · zero-based linear scale · exact values remain in the table</p>{rankings.slice(0, 10).map((rank) => { const maximum = Math.max(1, ...rankings.map(({ logicalUpdates }) => logicalUpdates)); return <button key={`bar-${rank.identity}`} tabIndex={-1} type="button" aria-label={`${rank.label}, ${rank.logicalUpdates} Logical Updates, ${rank.updateDeliveries} Update Deliveries`} aria-pressed={selected?.kind === "ranking" && selected.id === rank.identity} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}><span>{rank.label}</span><span className="workbench-react__activity-ranking-track"><span style={{ width: `${barPercent(rank.logicalUpdates, maximum)}%` }} /></span><strong>{rank.logicalUpdates}</strong></button>; })}{projection.rankingOther ? <p>Other · {projection.rankingOther.logicalUpdates} Logical Updates · {projection.rankingOther.updateDeliveries} Update Deliveries</p> : null}</div><table><caption>Complete synchronized Server ranking; top 10 plus Other</caption><thead><tr><th scope="col">Identity</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{rankings.map((rank) => <tr key={rank.identity} aria-selected={selected?.kind === "ranking" && selected.id === rank.identity}><th scope="row"><button type="button" aria-pressed={selected?.kind === "ranking" && selected.id === rank.identity} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}>{rank.label}</button></th><td>{rank.logicalUpdates}</td><td>{rank.updateDeliveries}</td></tr>)}{projection.rankingOther ? <tr><th scope="row">Other</th><td>{projection.rankingOther.logicalUpdates}</td><td>{projection.rankingOther.updateDeliveries}</td></tr> : null}</tbody></table></>}</section>
    </div>
  </main>;
}
