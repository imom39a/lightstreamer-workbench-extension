import { useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import type { ActivityProjection, ActivityTimeRange } from "../../../core/activity-projection";
import { createTypedFilterValue, type Filter, type FilterMutation } from "../../../core/filter-algebra";
import { activityElapsed, activityRangeLabel } from "./activity-timeline-format";
import { ActivityTimelineEvents, type TimelineEvidenceAnchor } from "./activity-timeline-events";
import "./activity-timeline.css";

/** Bounded density overview owned by Evidence; never a second history reader. */
export function ActivityTimeline({ projection, filter, frozen, selectedEventId, onSelect, onShowEvidence, onFilter }: Readonly<{
  projection: ActivityProjection;
  filter: Filter;
  frozen: boolean;
  selectedEventId: string | null;
  onSelect(anchor: TimelineEvidenceAnchor, inspect: boolean): void;
  onShowEvidence(): void;
  onFilter(expectedRevision: number, operations: readonly FilterMutation[]): void;
}>): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [focusedBurst, setFocusedBurst] = useState<string | null>(null);
  const [draft, setDraft] = useState<Readonly<{ range: ActivityTimeRange; intervalId: string; revision: number }> | null>(null);
  const gesture = useRef<Readonly<{ pointerId: number; start: number; domain: ActivityTimeRange; left: number; width: number; intervalId: string; revision: number }> | null>(null);
  const timeline = projection.timeline;
  const domain = timeline?.domain;
  const origin = timeline?.originTimestamp;
  const loading = projection.state === "LOADING";
  const usable = projection.state === "AVAILABLE" || projection.state === "LIMITED";
  const available = Boolean(usable && !timeline.clockAmbiguous && domain && origin !== null && origin !== undefined);
  const activeRange = filter.around?.intervalId === projection.intervalId ? filter.around : null;
  const draftRange = draft?.intervalId === projection.intervalId && draft.revision === filter.revision ? draft.range : null;
  const selectedRange = draftRange ?? activeRange;
  const omittedEvents = (timeline.sourcePointsOverflow?.omitted ?? 0) + (timeline.markersOverflow?.omitted ?? 0);
  const singleBurst = timeline.snapshotBursts.length === 1 ? timeline.snapshotBursts[0] : null;
  const markerOnly = !projection.logicalUpdateTotal && !projection.localLogicalUpdateTotal && timeline.markers.length > 0;
  const burstKey = (burst: typeof timeline.snapshotBursts[number]) => `${burst.segment}:${burst.startSequence}`;
  const focusedBurstKey = timeline.snapshotBursts.some(burst => burstKey(burst) === focusedBurst) ? focusedBurst : timeline.snapshotBursts[0] ? burstKey(timeline.snapshotBursts[0]) : null;
  const position = (timestamp: number) => domain ? Math.max(0, Math.min(100, (timestamp - domain.start) / Math.max(1, domain.end - domain.start) * 100)) : 0;
  const applyRange = (range: ActivityTimeRange, revision = filter.revision) => {
    onFilter(revision, [{ type: "set-around", around: { intervalId: projection.intervalId, ...range } }]);
    setDraft(null);
  };
  const applySnapshotBurst = (burst: ActivityTimeRange) => {
    setDraft(null);
    onFilter(filter.revision, [
      { type: "replace-facet", facet: "provenance", criterion: { include: [createTypedFilterValue("provenance", "enum", "SERVER")], exclude: [] } },
      { type: "replace-facet", facet: "phase", criterion: { include: [createTypedFilterValue("phase", "enum", "SNAPSHOT")], exclude: [] } },
      { type: "set-around", around: { intervalId: projection.intervalId, start: burst.start, end: burst.end } }
    ]);
  };
  const preview = (range: ActivityTimeRange) => setDraft({ range, intervalId: projection.intervalId, revision: filter.revision });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !available || !domain) return;
    if (event.key === "Escape" && draftRange) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      applyRange(selectedRange ?? domain);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault();
    const base = selectedRange ?? domain;
    const edge = event.shiftKey ? "start" : "end";
    const step = Math.max(1, Math.round((domain.end - domain.start) / 100));
    const direction = event.key === "ArrowLeft" || event.key === "PageDown" ? -1 : 1;
    const next = event.key === "Home" ? domain.start : event.key === "End" ? domain.end : base[edge] + direction * step * (event.key.startsWith("Page") ? 10 : 1);
    preview(edge === "start"
      ? { start: Math.max(domain.start, Math.min(base.end - 1, next)), end: base.end }
      : { start: base.start, end: Math.max(base.start + 1, Math.min(domain.end, next)) });
  };
  const pointerRange = (event: PointerEvent<HTMLDivElement>): ActivityTimeRange | null => {
    const active = gesture.current;
    if (!available || !active || active.pointerId !== event.pointerId || active.intervalId !== projection.intervalId || active.revision !== filter.revision) return null;
    const at = Math.max(active.domain.start, Math.min(active.domain.end - 1, Math.floor(active.domain.start + (event.clientX - active.left) / active.width * (active.domain.end - active.domain.start))));
    return { start: Math.min(at, active.start), end: Math.max(at, active.start) + 1 };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!available || !domain || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const at = Math.max(domain.start, Math.min(domain.end - 1, Math.floor(domain.start + (event.clientX - rect.left) / rect.width * (domain.end - domain.start))));
    gesture.current = { pointerId: event.pointerId, start: at, domain, left: rect.left, width: rect.width, intervalId: projection.intervalId, revision: filter.revision };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    preview({ start: at, end: at + 1 });
  };
  return <section className="workbench-activity-timeline" aria-label="Activity timeline" aria-busy={loading}>
    <header>
      <button type="button" aria-expanded={!collapsed} aria-controls="workbench-activity-timeline-content" onClick={() => { setDraft(null); gesture.current = null; setCollapsed(!collapsed); }}><span aria-hidden="true">{collapsed ? "▸" : "▾"}</span> Timeline</button>
      <span className="workbench-activity-timeline__origin" title="Elapsed time since first retained event; Scope and Filter do not change this origin.">{collapsed && selectedRange && origin !== null ? `Range ${activityRangeLabel(selectedRange, origin)}` : "Elapsed since first retained event"}</span>
      <span className="workbench-activity-timeline__legend" role="group" aria-label="Update source legend"><span><i aria-hidden="true" />SERVER</span><span><i className="workbench-activity-timeline__local" aria-hidden="true" />LOCAL</span></span>
    </header>
    {!collapsed ? <div id="workbench-activity-timeline-content">
      <div className="workbench-activity-timeline__axis" role="group" aria-label="Elapsed time since first retained event">{available && domain && origin !== null ? [0, .25, .5, .75, 1].map(fraction => <span key={fraction} style={{ left: `${fraction * 100}%` }}>{activityElapsed(domain.start + fraction * (domain.end - domain.start), origin)}</span>) : null}</div>
      <div className="workbench-activity-timeline__track" role="group" tabIndex={available ? 0 : -1} aria-disabled={!available} aria-label="Select Activity time range" aria-describedby="workbench-activity-timeline-help workbench-activity-timeline-range" onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={event => { const range = pointerRange(event); if (range) preview(range); }} onPointerUp={event => { const range = pointerRange(event); const revision = gesture.current?.revision; gesture.current = null; if (range) applyRange(range, revision); }} onPointerCancel={() => { gesture.current = null; setDraft(null); }}>
        {selectedRange && domain ? <span className="workbench-activity-timeline__range" aria-hidden="true" style={{ left: `${position(selectedRange.start)}%`, width: `${position(selectedRange.end) - position(selectedRange.start)}%` }} /> : null}
        {available && singleBurst ? <span className="workbench-activity-timeline__burst workbench-activity-timeline__burst-visual" aria-hidden="true" style={{ left: `${position(singleBurst.start)}%`, width: `${Math.max(.3, position(singleBurst.end) - position(singleBurst.start))}%` }} /> : null}
        {available && origin !== null && timeline.snapshotBursts.length > 1 ? <div className="workbench-activity-timeline__bursts" role="toolbar" aria-label="Snapshot bursts" aria-orientation="horizontal" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>{timeline.snapshotBursts.map(burst => <button key={burstKey(burst)} type="button" tabIndex={focusedBurstKey === burstKey(burst) ? 0 : -1} onFocus={() => setFocusedBurst(burstKey(burst))} className="workbench-activity-timeline__burst" style={{ left: `${position(burst.start)}%`, width: `${Math.max(.3, position(burst.end) - position(burst.start))}%` }} aria-label={`Show snapshot burst ${activityRangeLabel(burst, origin)} in Evidence`} title={`${burst.logicalUpdates.toLocaleString()} SERVER Snapshot Logical Updates · applies exact Snapshot phase and time range`} onClick={() => applySnapshotBurst(burst)} />)}</div> : null}
        {available && origin !== null ? projection.buckets.map(bucket => {
          const exact = timeline.sourcePoints.filter(point => point.timestamp >= bucket.start && point.timestamp < bucket.end);
          const serverCount = Math.max(0, bucket.logicalUpdates - exact.filter(point => point.source === "SERVER").length);
          const localCount = Math.max(0, bucket.localLogicalUpdates - exact.filter(point => point.source === "LOCAL").length);
          if (!serverCount && !localCount) return null;
          return <span key={bucket.id} className="workbench-activity-timeline__density" style={{ left: `${position(bucket.start)}%`, width: `${Math.max(.3, position(bucket.end) - position(bucket.start))}%` }}>
            {serverCount ? <span role="img" aria-label={`${serverCount} SERVER Logical Updates, aggregate interval ${activityRangeLabel(bucket, origin)}`} title={`${serverCount} SERVER Logical Updates · aggregate interval`} className="workbench-activity-timeline__server-mark" /> : null}
            {localCount ? <span role="img" aria-label={`${localCount} LOCAL Logical Updates, aggregate interval ${activityRangeLabel(bucket, origin)}`} title={`${localCount} LOCAL Logical Updates · aggregate interval`} className="workbench-activity-timeline__local-mark" /> : null}
          </span>;
        }) : null}
        {available && domain && origin !== null ? <ActivityTimelineEvents projection={projection} domain={domain} origin={origin} frozen={frozen} selectedEventId={selectedEventId} onSelect={onSelect} /> : null}
        {!available || (!projection.logicalUpdateTotal && !projection.localLogicalUpdateTotal && !markerOnly) ? <span className="workbench-activity-timeline__empty" role="status">{timeline.clockAmbiguous ? "Timeline unavailable across a clock change" : projection.reason ?? "No matching captured updates"}</span> : null}
      </div>
      <div className="workbench-activity-timeline__caption">
        {available && singleBurst && origin !== null ? <button type="button" className="workbench-activity-timeline__snapshot-legend" aria-label={`Show snapshot burst ${activityRangeLabel(singleBurst, origin)} in Evidence`} title={`${singleBurst.logicalUpdates.toLocaleString()} SERVER Snapshot Logical Updates · applies exact Snapshot phase and time range`} onClick={() => applySnapshotBurst(singleBurst)}><i aria-hidden="true" />{singleBurst.logicalUpdates.toLocaleString()} snapshot updates</button> : available && timeline.snapshotBursts.length > 1 ? <span className="workbench-activity-timeline__snapshot-legend"><i aria-hidden="true" />{timeline.snapshotBursts.length} snapshot bursts</span> : null}
        {available && markerOnly ? <span role="status">No matching captured updates</span> : null}
        <span id="workbench-activity-timeline-help">{available ? "Drag to filter · ←/→ end · Shift start · Enter apply" : "Time range selection unavailable"}</span>
        {omittedEvents ? <button type="button" onClick={onShowEvidence}>{omittedEvents.toLocaleString()} more events in Evidence</button> : null}
        <strong id="workbench-activity-timeline-range" aria-live="polite">{selectedRange && origin !== null ? `${draftRange ? "Preview" : "Range"} ${activityRangeLabel(selectedRange, origin)}` : "All retained time"}</strong>
      </div>
      {timeline.clockAmbiguous ? <p className="workbench-activity-timeline__caveat">Clock changed; elapsed duration across segments is ambiguous.</p> : null}
      {timeline.snapshotBurstsTruncated ? <p className="workbench-activity-timeline__caveat">First 64 snapshot bursts shown. Narrow Scope or Filter to inspect more.</p> : null}
    </div> : null}
  </section>;
}
