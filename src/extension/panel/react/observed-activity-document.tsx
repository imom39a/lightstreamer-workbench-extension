import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { sortActivityRankings, type ActivityConnectionLane, type ActivityMarker, type ActivityRanking } from "../../../core/activity-projection";
import { createTypedFilterValue, type FilterMutation } from "../../../core/filter-algebra";
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

type ConnectionPoint = Readonly<{
  kind: "marker" | "epoch";
  timestamp: number;
  label: string;
  marker?: ActivityMarker;
  epoch?: ActivityConnectionLane["sessions"][number];
}>;

type ConnectionSelection = Readonly<{ lane: number; point: number }>;

function connectionPoints(lane: ActivityConnectionLane): readonly ConnectionPoint[] {
  return [
    ...lane.markers.map((marker) => ({ kind: "marker" as const, timestamp: marker.timestamp, label: `${marker.label} marker`, marker })),
    ...lane.sessions.map((epoch) => ({ kind: "epoch" as const, timestamp: epoch.latestTimestamp, label: epoch.label, epoch }))
  ].sort((left, right) => left.timestamp - right.timestamp || left.kind.localeCompare(right.kind));
}

export function ObservedActivityDocument({ runtime, activity, scopeLabel }: { runtime: WorkbenchRuntime; activity: WorkbenchActivitySnapshot; scopeLabel: string }): ReactElement {
  const projection = activity.projection;
  const document = activity.document;
  const selected = document?.selection ?? null;
  const selectedBucket = selected?.kind === "bucket"
    ? projection.buckets.find((bucket) => bucket.id === selected.id) ?? projection.buckets[Number(selected.id)] ?? null
    : null;
  const selectedBucketIndex = selectedBucket ? projection.buckets.indexOf(selectedBucket) : -1;
  const selectedBucketRange = selected?.kind === "bucket" ? document?.selectionRange ?? null : null;
  const selectedMarker = selected?.kind === "marker" ? projection.markers[Number(selected.id)] ?? null : null;
  const selectedRanking = selected?.kind === "ranking" ? projection.allRankings.find((ranking) => ranking.identity === selected.id) ?? null : null;
  const rankings = useMemo(() => sortActivityRankings(projection.allRankings, document?.rankingSort ?? "LOGICAL_UPDATES"), [document?.rankingSort, projection.allRankings]);
  const [rankingPage, setRankingPage] = useState(0);
  const [connectionFocus, setConnectionFocus] = useState({ lane: 0, point: 0 });
  const [selectedConnection, setSelectedConnection] = useState<ConnectionSelection | null>(null);
  const selectedConnectionLane = selectedConnection ? projection.connectionLanes[selectedConnection.lane] ?? null : null;
  const selectedConnectionPoint = selectedConnection && selectedConnectionLane ? connectionPoints(selectedConnectionLane)[selectedConnection.point] ?? null : null;
  const rankingPageCount = Math.max(1, Math.ceil(rankings.length / RANKING_PAGE_SIZE));
  const boundedRankingPage = Math.min(rankingPage, rankingPageCount - 1);
  const pageRankings = rankings.slice(boundedRankingPage * RANKING_PAGE_SIZE, (boundedRankingPage + 1) * RANKING_PAGE_SIZE);
  const scopeKey = [activity.scope.kind, activity.scope.clientId, activity.scope.sessionId, activity.scope.subscriptionId, activity.scope.item, activity.scope.itemPosition].map((value) => value ?? "").join("|");
  useEffect(() => setRankingPage(0), [activity.filter.revision, scopeKey, document?.rankingSort]);
  useEffect(() => {
    setConnectionFocus({ lane: 0, point: 0 });
    setSelectedConnection(null);
  }, [activity.filter.revision, scopeKey, projection.connectionLanes.length]);
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
  const serverLogicalMetric = timelineSeries === "SERVER_SNAPSHOT"
    ? { key: "snapshotLogicalUpdates", label: "Server Snapshot Logical Updates", value: (bucket: typeof projection.buckets[number]) => bucket.snapshotLogicalUpdates }
    : timelineSeries === "SERVER_LIVE"
      ? { key: "liveLogicalUpdates", label: "Server Live Logical Updates", value: (bucket: typeof projection.buckets[number]) => bucket.liveLogicalUpdates }
      : { key: "logicalUpdates", label: `${localTimeline ? "Local" : "Server"} Logical Updates`, value: (bucket: typeof projection.buckets[number]) => localTimeline ? bucket.localLogicalUpdates : bucket.logicalUpdates };
  const timelineChartMetrics = [
    serverLogicalMetric,
    { key: "updateDeliveries", label: `${localTimeline ? "Local" : "Server"} Update Deliveries`, value: (bucket: typeof projection.buckets[number]) => localTimeline ? bucket.localUpdateDeliveries : bucket.updateDeliveries }
  ];
  const selectBucket = (index: number) => runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: projection.buckets[index]?.id ?? String(index) } });
  const timelineFilterMutations = selectedBucket ? [
    { type: "add-criterion" as const, facet: "kind", value: createTypedFilterValue("kind", "enum", "item-update"), polarity: "include" as const },
    { type: "add-criterion" as const, facet: "provenance", value: createTypedFilterValue("provenance", "enum", timelineSeries.startsWith("LOCAL") ? "LOCAL" : "SERVER"), polarity: "include" as const },
    ...(timelineSeries.endsWith("SNAPSHOT") || timelineSeries.endsWith("LIVE") ? [{ type: "add-criterion" as const, facet: "phase", value: createTypedFilterValue("phase", "enum", timelineSeries.endsWith("SNAPSHOT") ? "SNAPSHOT" : "LIVE"), polarity: "include" as const }] : [])
  ] : [];
  const connectionSupportingFilterMutations = selectedConnectionPoint?.marker?.supportingFilterMutations ?? selectedConnectionPoint?.epoch?.supportingFilterMutations ?? selectedConnectionLane?.supportingFilterMutations ?? [];
  const defaultSupportingFilterMutations = selectedBucket ? timelineFilterMutations : selectedRanking?.supportingFilterMutations ?? selectedMarker?.supportingFilterMutations ?? connectionSupportingFilterMutations;
  const showSupportingEvidence = (range: { start: number; end: number } | null, filterMutations: readonly FilterMutation[] = defaultSupportingFilterMutations) => runtime.dispatch({
    type: "show-activity-supporting-evidence",
    ...(range ? { start: range.start, end: range.end } : {}),
    filterMutations
  });
  const selectionContext = (provenance: "SERVER" | "LOCAL") =>
    `provenance ${provenance} · Scope ${activity.scope.kind} · Filter ${activity.filter.text || "None"} · Committed Boundary ${activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"} · Observation Coverage ${activity.readPoint.coverage}`;
  const onTimelineKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!projection.buckets.length) return;
    const current = selectedBucketIndex >= 0
      ? selectedBucketIndex
      : selectedBucketRange
        ? Math.max(0, projection.buckets.findIndex((bucket) => bucket.start <= selectedBucketRange.start && selectedBucketRange.start < bucket.end))
        : 0;
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
  const connectionPointRange = (point: ConnectionPoint): { start: number; end: number } => {
    if (point.kind === "marker") {
      const bucket = projection.buckets.find((candidate) => point.timestamp >= candidate.start && point.timestamp < candidate.end);
      return bucket ? { start: bucket.start, end: bucket.end } : { start: point.timestamp, end: point.timestamp + 1 };
    }
    return { start: point.epoch?.firstTimestamp ?? point.timestamp, end: (point.epoch?.latestTimestamp ?? point.timestamp) + 1 };
  };
  const drillConnectionPoint = (laneIndex: number, pointIndex: number): void => {
    const lane = projection.connectionLanes[laneIndex];
    const point = lane ? connectionPoints(lane)[pointIndex] : undefined;
    if (!point) return;
    setConnectionFocus({ lane: laneIndex, point: pointIndex });
    setSelectedConnection({ lane: laneIndex, point: pointIndex });
    if (point.marker) {
      const markerIndex = projection.markers.findIndex((marker) => marker.eventId === point.marker?.eventId && marker.sequence === point.marker?.sequence);
      if (markerIndex >= 0) runtime.dispatch({ type: "select-activity", selection: { kind: "marker", id: String(markerIndex) } });
      showSupportingEvidence(connectionPointRange(point), point.marker.supportingFilterMutations ?? []);
      return;
    }
    showSupportingEvidence(connectionPointRange(point), point.epoch?.supportingFilterMutations ?? lane.supportingFilterMutations);
  };
  const selectConnectionPoint = (laneIndex: number, pointIndex: number): void => {
    setConnectionFocus({ lane: laneIndex, point: pointIndex });
    setSelectedConnection({ lane: laneIndex, point: pointIndex });
    runtime.dispatch({ type: "select-activity", selection: null });
  };
  const onConnectionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!projection.connectionLanes.length) return;
    const laneIndex = Math.min(connectionFocus.lane, projection.connectionLanes.length - 1);
    const points = connectionPoints(projection.connectionLanes[laneIndex]!);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextLane = moveIndex(laneIndex, projection.connectionLanes.length, event.key === "ArrowUp" ? "ArrowLeft" : "ArrowRight");
      const nextPoints = connectionPoints(projection.connectionLanes[nextLane]!);
      setConnectionFocus({ lane: nextLane, point: Math.min(connectionFocus.point, Math.max(0, nextPoints.length - 1)) });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setConnectionFocus({ lane: laneIndex, point: moveIndex(connectionFocus.point, points.length, event.key) });
    } else if (event.key === "Enter") {
      event.preventDefault();
      drillConnectionPoint(laneIndex, connectionFocus.point);
    }
  };
  const selectedTimelineCount = selectedBucket
    ? timelineSeries === "SERVER_SNAPSHOT"
      ? selectedBucket.snapshotLogicalUpdates
      : timelineSeries === "SERVER_LIVE"
        ? selectedBucket.liveLogicalUpdates
        : timelineSeries.includes("DELIVERIES")
          ? (localTimeline ? selectedBucket.localUpdateDeliveries : selectedBucket.updateDeliveries)
          : (localTimeline ? selectedBucket.localLogicalUpdates : selectedBucket.logicalUpdates)
    : null;
  const selectionText = selectedBucket
    ? `${selectedBucket.start} ≤ timestamp < ${selectedBucket.end} · ${selectedTimelineCount} ${timelineSeriesLabel} · segment ${selectedBucket.segment} · provenance ${timelineProvenance} · Scope ${activity.scope.kind} · Filter ${activity.filter.text || "None"} · Committed Boundary ${activity.readPoint.committedEvidenceBoundary?.sequence ?? "None"} · Observation Coverage ${activity.readPoint.coverage}`
    : selected?.kind === "bucket" && selectedBucketRange
      ? `${selectedBucketRange.start} ≤ selected timestamp < ${selectedBucketRange.end} · preserved absolute interval overlay after rebucketing; select a current bucket to inspect its exact count · series ${timelineSeriesLabel} · ${selectionContext(timelineProvenance)}`
    : selectedMarker
      ? `status ${selectedMarker.status ?? selectedMarker.label} · client ${selectedMarker.clientId ?? "client unknown"} · session ${selectedMarker.sessionId ?? "Session unknown"} · timestamp ${selectedMarker.timestamp} · kind ${selectedMarker.kind} · provenance ${selectedMarker.provenance} · subscription ${selectedMarker.subscriptionId ?? "Subscription unavailable"} · item ${selectedMarker.itemName ?? (selectedMarker.itemPosition === null ? "Item unavailable" : `${selectedMarker.itemPosition}`)} · ${selectedMarker.reportedCount === null ? "reported count unavailable" : `reported ${selectedMarker.reportedCount}`} · ${selectedMarker.errorCode === null ? "error code unavailable" : `error ${selectedMarker.errorCode}`} · ${selectedMarker.errorMessage ?? "error message unavailable"} · ${selectedMarker.consequenceLimit} · Evidence ${selectedMarker.eventId} · ${selectionContext(selectedMarker.provenance)}`
      : selectedRanking
        ? `${selectedRanking.subscriptionId ? `Subscription ${selectedRanking.subscriptionId}` : selectedRanking.label} · ${selectedRanking.itemName ? `Item ${selectedRanking.itemName}${selectedRanking.itemPosition === null || selectedRanking.itemPosition === undefined ? "" : ` [${selectedRanking.itemPosition}]`}` : "Item identity unavailable"} · ${selectedRanking.range ? `interval ${selectedRanking.range.start} ≤ timestamp < ${selectedRanking.range.end}` : selectedRanking.rangeReason ?? "interval unavailable"} · ${selectedRanking.logicalUpdates} Logical Updates · ${selectedRanking.updateDeliveries} Update Deliveries · ${selectionContext("SERVER")}`
        : selectedConnectionPoint?.marker
          ? `status ${selectedConnectionPoint.marker.status ?? selectedConnectionPoint.marker.label} · client ${selectedConnectionPoint.marker.clientId ?? "client unknown"} · session ${selectedConnectionPoint.marker.sessionId ?? "Session unknown"} · timestamp ${selectedConnectionPoint.marker.timestamp} · kind ${selectedConnectionPoint.marker.kind} · provenance ${selectedConnectionPoint.marker.provenance} · subscription ${selectedConnectionPoint.marker.subscriptionId ?? "Subscription unavailable"} · item ${selectedConnectionPoint.marker.itemName ?? (selectedConnectionPoint.marker.itemPosition === null ? "Item unavailable" : `${selectedConnectionPoint.marker.itemPosition}`)} · ${selectedConnectionPoint.marker.consequenceLimit} · Evidence ${selectedConnectionPoint.marker.eventId} · ${selectionContext(selectedConnectionPoint.marker.provenance)}`
          : selectedConnectionPoint?.epoch && selectedConnectionLane
            ? `client ${selectedConnectionLane.clientId} · session ${selectedConnectionPoint.epoch.sessionId ?? "Session unknown"} · status ${selectedConnectionPoint.epoch.status ?? "status unavailable"} · timestamps ${selectedConnectionPoint.epoch.firstTimestamp}–${selectedConnectionPoint.epoch.latestTimestamp} · Session epoch is bounded by captured observations; no duration or inferred silence · ${selectionContext("SERVER")}`
        : null;
  const selectedMarkerBucket = selectedMarker
    ? projection.buckets.find((bucket) => selectedMarker.timestamp >= bucket.start && selectedMarker.timestamp < bucket.end) ?? null
    : null;
  const supportingConnectionRange = selectedConnectionPoint ? connectionPointRange(selectedConnectionPoint) : null;
  const supportingRange = selectedBucket ?? selectedBucketRange ?? selectedMarkerBucket ?? selectedRanking?.range ?? supportingConnectionRange;
  const canShowSupportingEvidence = Boolean(supportingRange || selectedRanking?.supportingFilterMutations?.length || selectedConnectionPoint);

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
      <section className="workbench-react__activity-section" aria-label="Connection activity lanes">
        <div className="workbench-react__activity-section-heading"><h2>Connection activity</h2><span className="workbench-react__activity-scale-note">Up/Down lanes · Left/Right markers and Session epochs · Enter drilldown</span></div>
        {projection.connectionLanes.length === 0 ? <p>No client connection activity has a concrete captured identity in this Scope.</p> : <div className="workbench-react__activity-connection-grid" role="grid" aria-label="Connection activity lanes" tabIndex={0} onKeyDown={onConnectionKeyDown} aria-rowcount={projection.connectionLanes.length} aria-activedescendant={`activity-connection-${connectionFocus.lane}-${connectionFocus.point}`}>
          {projection.connectionLanes.map((lane, laneIndex) => {
            const points = connectionPoints(lane);
            return <div role="row" aria-rowindex={laneIndex + 1} key={lane.clientId}>
              <div role="gridcell" className="workbench-react__activity-connection-lane" aria-selected={connectionFocus.lane === laneIndex}>
                <strong>{lane.label}</strong><span>latest matching activity {lane.latestTimestamp}</span>
                <div className="workbench-react__activity-connection-points" role="group" aria-label={`${lane.label} markers and Session epochs`}>
                  {points.map((point, pointIndex) => <button id={`activity-connection-${laneIndex}-${pointIndex}`} type="button" tabIndex={-1} key={`${point.kind}-${point.timestamp}-${point.label}`} aria-pressed={selectedConnection?.lane === laneIndex && selectedConnection?.point === pointIndex} data-focused={connectionFocus.lane === laneIndex && connectionFocus.point === pointIndex} onClick={() => selectConnectionPoint(laneIndex, pointIndex)}>{point.kind === "marker" ? `${point.timestamp} · ${point.label}` : `${point.label} · through ${point.timestamp}`}</button>)}
                </div>
              </div>
            </div>;
          })}
        </div>}
        {projection.connectionOverflow ? <p className="workbench-react__activity-filter-warning"><strong>{projection.connectionOverflow.label}</strong> · {projection.connectionOverflow.clientIds.length} additional client lanes are outside the bounded Page view. <button type="button" onClick={() => runtime.dispatch({ type: "show-activity-supporting-evidence", filterMutations: projection.connectionOverflow?.supportingFilterMutations ?? [] })}>Reset Filter broadly, then apply the Other-client filter</button></p> : null}
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity contextual facts">
        <h2>Contextual bandwidth and frequency</h2>
        {projection.contextFacts.length === 0 ? <p>No requested or real bandwidth/frequency facts were captured in this Scope.</p> : <dl className="workbench-react__activity-context-facts">{projection.contextFacts.map((fact) => <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.values.map(({ value, timestamp }) => `${value} @ ${timestamp}`).join(" · ")}{fact.plotValues.length >= 2 ? <div className="workbench-react__activity-context-plot" role="img" aria-label={`${fact.label} captured changes plot`} data-contextual-plot={fact.key}>{fact.plotValues.map(({ value, timestamp }) => <span key={`${timestamp}-${value}`}>{value} @ {timestamp}</span>)}</div> : null}</dd></div>)}</dl>}
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity timeline">
        <div className="workbench-react__activity-section-heading"><h2>Timeline · exact {projection.bucketDuration ?? "—"} ms buckets</h2><div role="group" aria-label="Timeline series">{timelineSeriesOptions.map((series) => <button key={series} type="button" aria-pressed={timelineSeries === series} onClick={() => runtime.dispatch({ type: "set-activity-timeline-series", series })}>{series.replaceAll("_", " ")}</button>)}</div></div>
        {projection.buckets.length === 0 ? <p>No matching accepted Server Logical Update Evidence.</p> : <div className="workbench-react__activity-plot">
          <div className="workbench-react__activity-small-multiples" role="group" aria-label="Activity small multiples">
            <p className="workbench-react__activity-scale-note">{timelineSeriesLabel} · zero-based linear scale · exact values remain in the table</p>
            {timelineChartMetrics.map((metric) => {
              const maximum = Math.max(1, ...projection.buckets.map((bucket) => metric.value(bucket)));
              return <div className="workbench-react__activity-multiple" key={metric.key} role="img" aria-label={`${metric.label} small multiple, zero to ${maximum}, linear scale`}>
                <strong>{metric.label}<span>0–{maximum}</span></strong>
                <div className="workbench-react__activity-bars" aria-hidden="true">{projection.buckets.map((bucket) => <span className="workbench-react__activity-bar" data-selected={selected?.kind === "bucket" && selected.id === bucket.id} data-selection-overlay={selectedBucketRange && bucket.start < selectedBucketRange.end && selectedBucketRange.start < bucket.end || undefined} key={`${metric.key}-${bucket.start}-${bucket.segment}`}><span style={{ height: `${barPercent(metric.value(bucket), maximum)}%` }} /></span>)}</div>
              </div>;
            })}
          </div>
          <table role="grid" aria-label="Activity timeline buckets" aria-activedescendant={selectedBucket ? `activity-bucket-${selectedBucket.id}` : undefined} tabIndex={0} onKeyDown={onTimelineKeyDown}><caption>{timelineSeriesLabel}</caption><thead><tr><th scope="col">Interval</th><th scope="col">Snapshot</th><th scope="col">Live</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{projection.buckets.map((bucket, index) => <tr key={`${bucket.start}-${bucket.segment}`} aria-selected={selected?.kind === "bucket" && selected.id === bucket.id} data-selection-overlay={selectedBucketRange && bucket.start < selectedBucketRange.end && selectedBucketRange.start < bucket.end || undefined}><th scope="row"><button id={`activity-bucket-${bucket.id}`} type="button" tabIndex={-1} aria-pressed={selected?.kind === "bucket" && selected.id === bucket.id} onClick={() => selectBucket(index)}>{bucket.start}–{bucket.end}{bucket.currentPartial ? " · LIVE · PARTIAL" : bucket.firstPartial || bucket.finalPartial ? " · PARTIAL" : ""}</button></th><td>{localTimeline ? "—" : bucket.snapshotLogicalUpdates}</td><td>{localTimeline ? "—" : bucket.liveLogicalUpdates}</td><td>{localTimeline ? bucket.localLogicalUpdates : bucket.logicalUpdates}</td><td>{localTimeline ? bucket.localUpdateDeliveries : bucket.updateDeliveries}</td></tr>)}</tbody></table>
        </div>}
      </section>
      <section className="workbench-react__activity-section" aria-label="Activity selection detail"><h2>Selection</h2>{selectionText ? <><p>{selectionText}</p>{canShowSupportingEvidence ? <button type="button" onClick={() => showSupportingEvidence(supportingRange)}>Show supporting Evidence</button> : <p>Show supporting Evidence is available for time selections.</p>}</> : <p>Select a bucket, marker, or ranked identity to inspect exact supporting facts.</p>}</section>
      <section className="workbench-react__activity-section" aria-label="Activity markers"><h2>Captured transitions, loss, and errors</h2>{projection.markers.length === 0 ? <p>No captured markers in the retained interval.</p> : <ul className="workbench-react__activity-markers">{projection.markers.map((marker, index) => <li key={`${marker.sequence}-${marker.eventId}`}><button type="button" aria-pressed={selected?.kind === "marker" && selected.id === String(index)} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "marker", id: String(index) } })}>{marker.timestamp} · {marker.label} · {marker.reportedCount === null ? "reported count unavailable" : `reported ${marker.reportedCount}`} · Evidence {marker.eventId}</button></li>)}</ul>}</section>
      {projection.excludedLayers.length > 0 ? <section className="workbench-react__activity-section" aria-label="Activity Filter exclusions"><h2>Layers excluded by active Filter</h2><ul className="workbench-react__activity-filter-exclusions">{projection.excludedLayers.map((layer) => { const broad = layer.filterMutations.some((mutation) => mutation.type === "reset" || mutation.type === "clear-facet"); return <li key={layer.layer}><span>{layer.label} excluded by the active Filter; no unfiltered fallback is shown.</span> <button type="button" onClick={() => runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: activity.filter.revision, operations: layer.filterMutations })}>{broad ? `Amend Filter broadly to include ${layer.label}` : `Amend Filter to include ${layer.label}`}</button></li>; })}</ul></section> : null}
      <section className="workbench-react__activity-section" aria-label="Activity ranking"><div className="workbench-react__activity-section-heading"><h2>Busiest {activity.scope.kind === "SUBSCRIPTION" ? "items" : "Subscriptions"}</h2><div role="group" aria-label="Rank by"><button type="button" aria-pressed={document?.rankingSort === "LOGICAL_UPDATES"} onClick={() => { setRankingPage(0); runtime.dispatch({ type: "set-activity-ranking-sort", sort: "LOGICAL_UPDATES" }); }}>Logical Updates</button><button type="button" aria-pressed={document?.rankingSort === "UPDATE_DELIVERIES"} onClick={() => { setRankingPage(0); runtime.dispatch({ type: "set-activity-ranking-sort", sort: "UPDATE_DELIVERIES" }); }}>Update Deliveries</button></div></div>{rankings.length === 0 ? <p>No ranked Server activity.</p> : <><div className="workbench-react__activity-ranking-bars" role="grid" aria-label="Busiest ranking graph" aria-rowcount={graphRankings.length} aria-activedescendant={activeRanking ? `activity-ranking-${activeRanking.identity}` : undefined} tabIndex={0} onKeyDown={onRankingKeyDown}><p className="workbench-react__activity-scale-note">Server {rankingMetricLabel} · zero-based linear scale · exact values remain in the complete table</p>{graphRankings.map((rank, index) => <div key={`bar-${rank.identity}`} role="row" aria-rowindex={index + 1}><div id={`activity-ranking-${rank.identity}`} role="gridcell" data-ranking-identity={rank.identity} data-selected={selected?.kind === "ranking" && selected.id === rank.identity} aria-selected={selected?.kind === "ranking" && selected.id === rank.identity} aria-disabled={rank.identity === "other" || undefined} onClick={() => rank.identity === "other" ? undefined : runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}><span>{rank.label}</span><span className="workbench-react__activity-ranking-track"><span style={{ width: `${barPercent(rank[rankingMetric], rankingMaximum)}%` }} /></span><strong>{rank[rankingMetric]}</strong></div></div>)}</div><div className="workbench-react__activity-ranking-table-scroll"><table><caption>Complete synchronized Server ranking · rows {rankings.length === 0 ? 0 : boundedRankingPage * RANKING_PAGE_SIZE + 1}–{Math.min(rankings.length, (boundedRankingPage + 1) * RANKING_PAGE_SIZE)} of {rankings.length}</caption><thead><tr><th scope="col">Identity</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{pageRankings.map((rank) => <tr key={rank.identity} data-ranking-identity={rank.identity} aria-selected={selected?.kind === "ranking" && selected.id === rank.identity}><th scope="row"><button type="button" aria-pressed={selected?.kind === "ranking" && selected.id === rank.identity} onClick={() => runtime.dispatch({ type: "select-activity", selection: { kind: "ranking", id: rank.identity } })}>{rank.label}</button></th><td>{rank.logicalUpdates}</td><td>{rank.updateDeliveries}</td></tr>)}</tbody></table></div><div className="workbench-react__activity-ranking-pagination" role="group" aria-label="Ranking table pagination"><button type="button" disabled={boundedRankingPage === 0} onClick={() => setRankingPage(Math.max(0, boundedRankingPage - 1))}>Previous ranking rows</button><span>Rows {rankings.length === 0 ? 0 : boundedRankingPage * RANKING_PAGE_SIZE + 1}–{Math.min(rankings.length, (boundedRankingPage + 1) * RANKING_PAGE_SIZE)} of {rankings.length}</span><button type="button" disabled={boundedRankingPage >= rankingPageCount - 1} onClick={() => setRankingPage(Math.min(rankingPageCount - 1, boundedRankingPage + 1))}>Next ranking rows</button></div></>}</section>
    </div>
  </main>;
}
