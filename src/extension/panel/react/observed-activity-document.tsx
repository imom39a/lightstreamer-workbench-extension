import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { sortActivityRankings, type ActivityRanking } from "../../../core/activity-projection";
import { createTypedFilterValue } from "../../../core/filter-algebra";
import type { ActivityDocumentState } from "../../../core/activity-document";
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

const RANKING_PAGE_SIZE = 50;

export function ObservedActivityDocument({ runtime, activity, scopeLabel }: { runtime: WorkbenchRuntime; activity: WorkbenchActivitySnapshot; scopeLabel: string }): ReactElement {
  const projection = activity.projection;
  const document = activity.document;
  const selected = document?.selection ?? null;
  const selectedBucket = selected?.kind === "bucket" ? projection.buckets[Number(selected.id)] ?? null : null;
  const selectedMarker = selected?.kind === "marker" ? projection.markers[Number(selected.id)] ?? null : null;
  const selectedRanking = selected?.kind === "ranking" ? projection.allRankings.find((ranking) => ranking.identity === selected.id) ?? null : null;
  const rankings = useMemo(() => sortActivityRankings(projection.allRankings, document?.rankingSort ?? "LOGICAL_UPDATES"), [document?.rankingSort, projection.allRankings]);
  const [rankingPage, setRankingPage] = useState(0);
  const rankingPageCount = Math.max(1, Math.ceil(rankings.length / RANKING_PAGE_SIZE));
  const boundedRankingPage = Math.min(rankingPage, rankingPageCount - 1);
  const pageRankings = rankings.slice(boundedRankingPage * RANKING_PAGE_SIZE, (boundedRankingPage + 1) * RANKING_PAGE_SIZE);
  const scopeKey = [activity.scope.kind, activity.scope.clientId, activity.scope.sessionId, activity.scope.subscriptionId, activity.scope.item, activity.scope.itemPosition].map((value) => value ?? "").join("|");
  useEffect(() => setRankingPage(0), [activity.filter.revision, scopeKey, document?.rankingSort]);
  useEffect(() => {
    if (selected?.kind !== "ranking") return;
    const selectedIndex = rankings.findIndex((ranking) => ranking.identity === selected.id);
    if (selectedIndex >= 0) setRankingPage(Math.floor(selectedIndex / RANKING_PAGE_SIZE));
  }, [rankings, selected?.id, selected?.kind]);
  const rankingMetric = document?.rankingSort === "UPDATE_DELIVERIES" ? "updateDeliveries" : "logicalUpdates";
  const rankingMetricLabel = rankingMetric === "logicalUpdates" ? "Logical Updates" : "Update Deliveries";
  const rankingMaximum = Math.max(1, ...rankings.map((ranking) => ranking[rankingMetric]));
  const rankingOther: ActivityRanking | null = rankings.length > 10
    ? {
        identity: "other",
        label: "Other",
        logicalUpdates: rankings.slice(10).reduce((total, ranking) => total + ranking.logicalUpdates, 0),
        updateDeliveries: rankings.slice(10).reduce((total, ranking) => total + ranking.updateDeliveries, 0)
      }
    : null;
  const graphRankings = rankingOther ? [...rankings.slice(0, 10), rankingOther] : rankings.slice(0, 10);
  const activeRanking = graphRankings.find((ranking) => selected?.kind === "ranking" && ranking.identity === selected.id) ?? graphRankings[0] ?? null;
  const provenanceCriteria = activity.filter.criteria.provenance;
  const localForcedByFilter = Boolean(provenanceCriteria?.include.some((value) => String(value.value) === "LOCAL"));
  const serverForcedByFilter = Boolean(provenanceCriteria?.include.some((value) => String(value.value) === "SERVER"));
  const timelineSeries = localForcedByFilter && !serverForcedByFilter ? "LOCAL_LOGICAL_UPDATES" : document?.timelineSeries ?? "SERVER_LOGICAL_UPDATES";
  const localExcludedByFilter = Boolean(provenanceCriteria?.exclude.some((value) => String(value.value) === "LOCAL"));
  const localVisible = Boolean(document?.localSeries || localForcedByFilter) && !localExcludedByFilter;
  const timelineSeriesOptions: readonly ActivityDocumentState["timelineSeries"][] = ["SERVER_LOGICAL_UPDATES", "UPDATE_DELIVERIES", "SERVER_SNAPSHOT", "SERVER_LIVE", ...(localVisible ? (["LOCAL_LOGICAL_UPDATES", "LOCAL_UPDATE_DELIVERIES"] as const) : [])];
  const localTimeline = timelineSeries.startsWith("LOCAL") && localVisible;
  const timelineSeriesLabel = timelineSeries.replaceAll("_", " ");
  const timelineProvenance = localTimeline ? "LOCAL" as const : "SERVER" as const;
  const timelineChartMetrics = [
    { key: "logicalUpdates", label: `${localTimeline ? "Local" : "Server"} Logical Updates`, value: (bucket: typeof projection.buckets[number]) => localTimeline ? bucket.localLogicalUpdates : bucket.logicalUpdates },
    { key: "updateDeliveries", label: `${localTimeline ? "Local" : "Server"} Update Deliveries`, value: (bucket: typeof projection.buckets[number]) => localTimeline ? bucket.localUpdateDeliveries : bucket.updateDeliveries }
  ];
  const selectBucket = (index: number) => runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: String(index) } });
  const timelineFilterMutations = selectedBucket ? [
    { type: "add-criterion" as const, facet: "kind", value: createTypedFilterValue("kind", "enum", "item-update"), polarity: "include" as const },
    { type: "add-criterion" as const, facet: "provenance", value: createTypedFilterValue("provenance", "enum", timelineSeries.startsWith("LOCAL") ? "LOCAL" : "SERVER"), polarity: "include" as const },
    ...(timelineSeries.endsWith("SNAPSHOT") || timelineSeries.endsWith("LIVE") ? [{ type: "add-criterion" as const, facet: "phase", value: createTypedFilterValue("phase", "enum", timelineSeries.endsWith("SNAPSHOT") ? "SNAPSHOT" : "LIVE"), polarity: "include" as const }] : [])
  ] : [];
  const showSupportingEvidence = (range: { start: number; end: number } | null) => runtime.dispatch({
    type: "show-activity-supporting-evidence",
    ...(range ? { start: range.start, end: range.end } : {}),
    filterMutations: selectedBucket ? timelineFilterMutations : selectedRanking?.supportingFilterMutations ?? selectedMarker?.supportingFilterMutations ?? []
  });
  const selectionContext = (provenance: "SERVER" | "LOCAL") =>
    `provenance ${provenance} · Scope ${activity.scope.kind} · Filter ${activity.filter.text || "None"} · Committed Boundary ${activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"} · Observation Coverage ${activity.readPoint.coverage}`;
  const onTimelineKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!projection.buckets.length) return;
    const current = selected?.kind === "bucket" ? Number(selected.id) : 0;
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const currentSeries = timelineSeriesOptions.indexOf(timelineSeries);
      const nextSeries = timelineSeriesOptions[moveIndex(currentSeries, timelineSeriesOptions.length, event.key === "ArrowUp" ? "ArrowLeft" : "ArrowRight")];
      runtime.dispatch({ type: "set-activity-timeline-series", series: nextSeries });
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectBucket(moveIndex(current, projection.buckets.length, event.key));
    } else if (event.key === "Enter" && selectedBucket) {
      event.preventDefault();
      showSupportingEvidence(selectedBucket);
    }
  };
  const onRankingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!graphRankings.length) return;
    const current = Math.max(0, graphRankings.findIndex((ranking) => selected?.kind === "ranking" && ranking.identity === selected.id));
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const ranking = graphRankings[moveIndex(current, graphRankings.length, event.key)];
      if (ranking.identity !== "other") runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: ranking.identity } });
    } else if (event.key === "Enter") {
      const ranking = graphRankings[current];
      if (ranking.identity !== "other" && (ranking.range || ranking.supportingFilterMutations?.length)) {
        event.preventDefault();
        showSupportingEvidence(ranking.range ?? null);
      }
    }
  };
  const selectionText = selectedBucket
    ? `${selectedBucket.start} ≤ timestamp < ${selectedBucket.end} · ${timelineSeries.includes("DELIVERIES") ? (localTimeline ? selectedBucket.localUpdateDeliveries : selectedBucket.updateDeliveries) : (localTimeline ? selectedBucket.localLogicalUpdates : selectedBucket.logicalUpdates)} ${localTimeline ? "Local" : "Server"} ${timelineSeries.includes("DELIVERIES") ? "Update Deliveries" : "Logical Updates"} · segment ${selectedBucket.segment} · series ${timelineSeriesLabel} · ${selectionContext(timelineProvenance)}`
    : selectedMarker
      ? `${selectedMarker.timestamp} · ${selectedMarker.label} · ${selectedMarker.clientId ?? "client unknown"} · ${selectedMarker.sessionId ?? "Session unknown"} · ${selectedMarker.subscriptionId ?? "Subscription unknown"} · ${selectedMarker.reportedCount === null ? "reported count unavailable" : `reported ${selectedMarker.reportedCount}`} · ${selectedMarker.errorCode === null ? "error code unavailable" : `error ${selectedMarker.errorCode}`} · ${selectedMarker.errorMessage ?? "error message unavailable"} · ${selectedMarker.consequenceLimit} · Evidence ${selectedMarker.eventId} · ${selectionContext(selectedMarker.provenance)}`
      : selectedRanking
        ? `${selectedRanking.subscriptionId ? `Subscription ${selectedRanking.subscriptionId}` : selectedRanking.label} · ${selectedRanking.itemName ? `Item ${selectedRanking.itemName}${selectedRanking.itemPosition === null || selectedRanking.itemPosition === undefined ? "" : ` [${selectedRanking.itemPosition}]`}` : "Item identity unavailable"} · ${selectedRanking.range ? `interval ${selectedRanking.range.start} ≤ timestamp < ${selectedRanking.range.end}` : selectedRanking.rangeReason ?? "interval unavailable"} · ${selectedRanking.logicalUpdates} Logical Updates · ${selectedRanking.updateDeliveries} Update Deliveries · ${selectionContext("SERVER")}`
        : null;
  const selectedMarkerBucket = selectedMarker
    ? projection.buckets.find((bucket) => selectedMarker.timestamp >= bucket.start && selectedMarker.timestamp < bucket.end) ?? null
    : null;
  const supportingRange = selectedBucket ?? selectedMarkerBucket ?? selectedRanking?.range ?? null;
  const canShowSupportingEvidence = Boolean(supportingRange || selectedRanking?.supportingFilterMutations?.length);

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
        <label><input type="checkbox" checked={localVisible} disabled={localForcedByFilter || localExcludedByFilter} onChange={(event) => runtime.dispatch({ type: "set-activity-local-series", enabled: event.currentTarget.checked })} /> Show separate <code>LOCAL</code> activity</label>
        {localForcedByFilter ? <p role="status">Local is required by the active provenance Filter.</p> : localExcludedByFilter ? <p role="status">Local is unavailable because the active provenance Filter excludes it.</p> : null}
        {localVisible ? <p><code>LOCAL</code> · {projection.localLogicalUpdateTotal.toLocaleString()} Logical Updates · {projection.localUpdateDeliveryTotal.toLocaleString()} Update Deliveries</p> : null}
        <div className="workbench-react__activity-actions"><button type="button" onClick={() => runtime.dispatch({ type: "freeze-activity" })} disabled={document?.view === "FROZEN"}>Freeze Activity</button><button type="button" onClick={() => runtime.dispatch({ type: "follow-activity" })} disabled={document?.view !== "FROZEN"}>Follow Live</button></div>
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity timeline">
        <div className="workbench-react__activity-section-heading"><h2>Timeline · exact {projection.bucketDuration ?? "—"} ms buckets</h2><div role="group" aria-label="Timeline series">{timelineSeriesOptions.map((series) => <button key={series} type="button" aria-pressed={timelineSeries === series} onClick={() => runtime.dispatch({ type: "set-activity-timeline-series", series })}>{series.replaceAll("_", " ")}</button>)}</div></div>
        {projection.buckets.length === 0 ? <p>No matching accepted Server Logical Update Evidence.</p> : <div className="workbench-react__activity-plot">
          <div className="workbench-react__activity-small-multiples" role="group" aria-label="Activity small multiples">
            <p className="workbench-react__activity-scale-note">{timelineSeriesLabel} · zero-based linear scale · exact values remain in the table</p>
            {timelineChartMetrics.map((metric) => {
              const maximum = Math.max(1, ...projection.buckets.map((bucket) => metric.value(bucket)));
              return <div className="workbench-react__activity-multiple" key={metric.key} role="img" aria-label={`${metric.label} small multiple, zero-based linear scale`}>
                <strong>{metric.label}</strong>
                <div className="workbench-react__activity-bars" aria-hidden="true">{projection.buckets.map((bucket, index) => <span className="workbench-react__activity-bar" data-selected={selected?.kind === "bucket" && selected.id === String(index)} key={`${metric.key}-${bucket.start}-${bucket.segment}`}><span style={{ height: `${barPercent(metric.value(bucket), maximum)}%` }} /></span>)}</div>
              </div>;
            })}
          </div>
          <table role="grid" aria-label="Activity timeline buckets" tabIndex={0} onKeyDown={onTimelineKeyDown}><caption>{timelineSeriesLabel}</caption><thead><tr><th scope="col">Interval</th><th scope="col">Snapshot</th><th scope="col">Live</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{projection.buckets.map((bucket, index) => <tr key={`${bucket.start}-${bucket.segment}`} aria-selected={selected?.kind === "bucket" && selected.id === String(index)}><th scope="row"><button type="button" aria-pressed={selected?.kind === "bucket" && selected.id === String(index)} onClick={() => selectBucket(index)}>{bucket.start}–{bucket.end}{bucket.currentPartial ? " · LIVE · PARTIAL" : bucket.firstPartial || bucket.finalPartial ? " · PARTIAL" : ""}</button></th><td>{localTimeline ? "—" : bucket.snapshotLogicalUpdates}</td><td>{localTimeline ? "—" : bucket.liveLogicalUpdates}</td><td>{localTimeline ? bucket.localLogicalUpdates : bucket.logicalUpdates}</td><td>{localTimeline ? bucket.localUpdateDeliveries : bucket.updateDeliveries}</td></tr>)}</tbody></table>
        </div>}
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity selection detail"><h2>Selection</h2>{selectionText ? <><p>{selectionText}</p>{canShowSupportingEvidence ? <button type="button" onClick={() => showSupportingEvidence(supportingRange)}>Show supporting Evidence</button> : <p>Show supporting Evidence is available for time selections.</p>}</> : <p>Select a bucket, marker, or ranked identity to inspect exact supporting facts.</p>}</section>
      <section className="workbench-react__activity-section" aria-label="Activity markers"><h2>Captured transitions, loss, and errors</h2>{projection.markers.length === 0 ? <p>No captured markers in the retained interval.</p> : <ul className="workbench-react__activity-markers">{projection.markers.map((marker, index) => <li key={`${marker.sequence}-${marker.eventId}`}><button type="button" aria-pressed={selected?.kind === "marker" && selected.id === String(index)} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "marker", id: String(index) } })}>{marker.timestamp} · {marker.label} · {marker.reportedCount === null ? "reported count unavailable" : `reported ${marker.reportedCount}`} · Evidence {marker.eventId}</button></li>)}</ul>}</section>
      <section className="workbench-react__activity-section" aria-label="Activity ranking"><div className="workbench-react__activity-section-heading"><h2>Busiest {activity.scope.kind === "SUBSCRIPTION" ? "items" : "Subscriptions"}</h2><div role="group" aria-label="Rank by"><button type="button" aria-pressed={document?.rankingSort === "LOGICAL_UPDATES"} onClick={() => { setRankingPage(0); runtime.dispatch({ type: "set-activity-ranking-sort", sort: "LOGICAL_UPDATES" }); }}>Logical Updates</button><button type="button" aria-pressed={document?.rankingSort === "UPDATE_DELIVERIES"} onClick={() => { setRankingPage(0); runtime.dispatch({ type: "set-activity-ranking-sort", sort: "UPDATE_DELIVERIES" }); }}>Update Deliveries</button></div></div>{rankings.length === 0 ? <p>No ranked Server activity.</p> : <><div className="workbench-react__activity-ranking-bars" role="grid" aria-label="Busiest ranking graph" aria-rowcount={graphRankings.length} aria-activedescendant={activeRanking ? `activity-ranking-${activeRanking.identity}` : undefined} tabIndex={0} onKeyDown={onRankingKeyDown}><p className="workbench-react__activity-scale-note">Server {rankingMetricLabel} · zero-based linear scale · exact values remain in the complete table</p>{graphRankings.map((rank, index) => <div key={`bar-${rank.identity}`} role="row" aria-rowindex={index + 1}><div id={`activity-ranking-${rank.identity}`} role="gridcell" data-ranking-identity={rank.identity} data-selected={selected?.kind === "ranking" && selected.id === rank.identity} aria-selected={selected?.kind === "ranking" && selected.id === rank.identity} aria-disabled={rank.identity === "other" || undefined} onClick={() => rank.identity === "other" ? undefined : runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}><span>{rank.label}</span><span className="workbench-react__activity-ranking-track"><span style={{ width: `${barPercent(rank[rankingMetric], rankingMaximum)}%` }} /></span><strong>{rank[rankingMetric]}</strong></div></div>)}</div><div className="workbench-react__activity-ranking-table-scroll"><table><caption>Complete synchronized Server ranking · rows {rankings.length === 0 ? 0 : boundedRankingPage * RANKING_PAGE_SIZE + 1}–{Math.min(rankings.length, (boundedRankingPage + 1) * RANKING_PAGE_SIZE)} of {rankings.length}</caption><thead><tr><th scope="col">Identity</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{pageRankings.map((rank) => <tr key={rank.identity} data-ranking-identity={rank.identity} aria-selected={selected?.kind === "ranking" && selected.id === rank.identity}><th scope="row"><button type="button" aria-pressed={selected?.kind === "ranking" && selected.id === rank.identity} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}>{rank.label}</button></th><td>{rank.logicalUpdates}</td><td>{rank.updateDeliveries}</td></tr>)}</tbody></table></div><div className="workbench-react__activity-ranking-pagination" role="group" aria-label="Ranking table pagination"><button type="button" disabled={boundedRankingPage === 0} onClick={() => setRankingPage(Math.max(0, boundedRankingPage - 1))}>Previous ranking rows</button><span>Rows {rankings.length === 0 ? 0 : boundedRankingPage * RANKING_PAGE_SIZE + 1}–{Math.min(rankings.length, (boundedRankingPage + 1) * RANKING_PAGE_SIZE)} of {rankings.length}</span><button type="button" disabled={boundedRankingPage >= rankingPageCount - 1} onClick={() => setRankingPage(Math.min(rankingPageCount - 1, boundedRankingPage + 1))}>Next ranking rows</button></div></>}</section>
    </div>
  </main>;
}
