import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { ActivityMarker, ActivityProjection, ActivityTimeRange } from "../../../core/activity-projection";
import { activityElapsed } from "./activity-timeline-format";

export type TimelineEvidenceAnchor = Readonly<{
  eventId: string;
  intervalId: string;
  sequence: number;
  timestamp: number;
  source: "SERVER" | "LOCAL";
}>;
type CapturedPoint = TimelineEvidenceAnchor & Readonly<{
  kind: "ITEM_UPDATE" | ActivityMarker["kind"];
  object: string;
  fact: string;
}>;
type PointGroup = Readonly<{ key: string; points: readonly CapturedPoint[] }>;
const markerNames = { CLIENT_STATUS: "Client status", SESSION_TRANSITION: "Session transition", LOST_UPDATES: "Lost updates", SUBSCRIPTION_ERROR: "Subscription error" } as const;
const markerSymbols = { CLIENT_STATUS: "●", SESSION_TRANSITION: "□", LOST_UPDATES: "!", SUBSCRIPTION_ERROR: "×" } as const;

function eventObject(event: Readonly<{ clientId?: string | null; sessionId?: string | null; subscriptionId?: string | null; itemName?: string | null; itemPosition?: number | null }>): string {
  return [event.clientId ? `Client ${event.clientId}` : null, event.sessionId ? `Session ${event.sessionId}` : null, event.subscriptionId ? `Subscription ${event.subscriptionId}` : null, event.itemName ? `Item ${event.itemName}` : event.itemPosition !== null && event.itemPosition !== undefined ? `Item ${event.itemPosition}` : null].filter(Boolean).join("; ");
}

function markerFact(marker: ActivityMarker): string {
  if (marker.kind === "LOST_UPDATES") return marker.reportedCount === null ? "Reported loss count unavailable" : `Reported ${marker.reportedCount} lost updates`;
  if (marker.kind === "SUBSCRIPTION_ERROR") return `Error ${marker.errorCode ?? "code unavailable"}${marker.errorMessage ? `: ${marker.errorMessage}` : ""}`;
  if (marker.kind === "SESSION_TRANSITION") return `${marker.label}${marker.status ? `; ${marker.status}` : ""}`;
  return marker.status ?? marker.label;
}

function pointLabel(point: CapturedPoint, origin: number): string {
  return `${point.kind === "ITEM_UPDATE" ? "Select" : "Inspect"} ${point.source} ${point.kind === "ITEM_UPDATE" ? "Item Update" : markerNames[point.kind]} at ${activityElapsed(point.timestamp, origin)} (${new Date(point.timestamp).toISOString()}); ${point.fact ? `${point.fact}; ` : ""}${point.object}; Evidence ${point.eventId}`;
}

function PointShape({ point }: Readonly<{ point: CapturedPoint }>): JSX.Element {
  if (point.kind !== "ITEM_UPDATE") return <span aria-hidden="true" className="workbench-activity-timeline__marker-symbol" data-source={point.source}>{markerSymbols[point.kind]}</span>;
  return <i aria-hidden="true" className={point.source === "LOCAL" ? "workbench-activity-timeline__local-mark" : "workbench-activity-timeline__server-point"} />;
}

/** Only the bounded public anchors enter this responsive collision chooser. */
export function ActivityTimelineEvents({ projection, domain, origin, frozen, selectedEventId, onSelect }: Readonly<{
  projection: ActivityProjection;
  domain: ActivityTimeRange;
  origin: number;
  frozen: boolean;
  selectedEventId: string | null;
  onSelect(anchor: TimelineEvidenceAnchor, inspect: boolean): void;
}>): JSX.Element {
  const toolbar = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const firstChoice = useRef<HTMLButtonElement | null>(null);
  const [width, setWidth] = useState(560);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [heldGroups, setHeldGroups] = useState<Readonly<{ signature: string; groups: readonly PointGroup[] }> | null>(null);
  const [chooserKey, setChooserKey] = useState<string | null>(null);
  const signature = `${projection.intervalId}:${projection.filterRevision}:${JSON.stringify(projection.scope)}:${frozen ? `frozen:${projection.committedEvidenceBoundary?.sequence}` : "live"}`;
  const position = (timestamp: number) => Math.max(12, Math.min(width - 12, (timestamp - domain.start) / Math.max(1, domain.end - domain.start) * width));
  const points = useMemo<readonly CapturedPoint[]>(() => [
    ...projection.timeline.sourcePoints.map(point => ({ ...point, object: eventObject(point), fact: "" })),
    ...projection.timeline.markers.map(marker => ({ ...marker, object: eventObject(marker), fact: markerFact(marker) }))
  ].sort((left, right) => left.timestamp - right.timestamp || left.sequence - right.sequence), [projection.timeline.sourcePoints, projection.timeline.markers]);
  const groups: PointGroup[] = [];
  for (const point of points) {
    const last = groups.at(-1);
    if (last && position(point.timestamp) - position(last.points.at(-1)!.timestamp) < 24) {
      groups[groups.length - 1] = { key: last.key, points: [...last.points, point] };
    } else groups.push({ key: point.eventId, points: [point] });
  }
  // Keep focusable identities and the open choice list stable during passive Capture.
  const visibleGroups = heldGroups?.signature === signature ? heldGroups.groups : groups;
  const rovingId = visibleGroups.some(group => group.key === focusedId) ? focusedId : visibleGroups[0]?.key;
  const chooser = heldGroups?.signature === signature ? visibleGroups.find(group => group.key === chooserKey) ?? null : null;
  const groupPosition = (group: PointGroup) => position((group.points[0]!.timestamp + group.points.at(-1)!.timestamp) / 2);

  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => { const next = element.getBoundingClientRect().width; if (next > 0) setWidth(next); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { if (chooser) firstChoice.current?.focus(); }, [chooserKey]);
  useEffect(() => {
    if (!chooser) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && toolbar.current?.contains(event.target)) return;
      setChooserKey(null);
      setHeldGroups(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [chooser !== null]);

  const closeChooser = () => {
    const trigger = chooserKey;
    setChooserKey(null);
    if (trigger) buttons.current.get(trigger)?.focus({ preventScroll: true });
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && chooser) {
      event.preventDefault();
      event.stopPropagation();
      closeChooser();
      return;
    }
    if ((event.target as HTMLElement).closest('[role="dialog"]') || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = visibleGroups.findIndex(group => buttons.current.get(group.key) === event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visibleGroups.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + visibleGroups.length) % visibleGroups.length;
    const nextGroup = visibleGroups[next];
    if (nextGroup) buttons.current.get(nextGroup.key)?.focus();
  };
  return <div ref={toolbar} className="workbench-activity-timeline__events" role="toolbar" aria-label="Captured Activity events" aria-orientation="horizontal" onKeyDown={navigate} onFocusCapture={() => { if (!heldGroups || heldGroups.signature !== signature) setHeldGroups({ signature, groups }); }} onBlurCapture={event => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setChooserKey(null);
    setHeldGroups(null);
  }}>
    {visibleGroups.map(group => {
      const point = group.points[0]!;
      const collision = group.points.length > 1;
      const label = collision ? `${group.points.length} captured Activity events; choose Evidence` : pointLabel(point, origin);
      return <button type="button" key={group.key} ref={element => { if (element) buttons.current.set(group.key, element); else buttons.current.delete(group.key); }} tabIndex={rovingId === group.key ? 0 : -1} onFocus={() => setFocusedId(group.key)} className="workbench-activity-timeline__event" data-source={point.source} aria-pressed={group.points.some(entry => entry.eventId === selectedEventId)} aria-expanded={collision ? chooser?.key === group.key : undefined} aria-label={label} aria-description={collision ? `${group.points.filter(entry => entry.source === "SERVER").length} SERVER and ${group.points.filter(entry => entry.source === "LOCAL").length} LOCAL events, ${activityElapsed(point.timestamp, origin)} to ${activityElapsed(group.points.at(-1)!.timestamp, origin)}. Choose one exact record.` : undefined} title={collision ? group.points.map(entry => pointLabel(entry, origin)).join("\n") : label} style={{ left: `${groupPosition(group)}px` }} onClick={() => { if (collision) { setHeldGroups({ signature, groups: visibleGroups }); setChooserKey(group.key); } else onSelect(point, point.kind !== "ITEM_UPDATE"); }}>
        {collision ? <><span aria-hidden="true" className="workbench-activity-timeline__cluster-count">{group.points.length}</span>{group.points.some(entry => entry.source === "LOCAL") ? <i aria-hidden="true" className="workbench-activity-timeline__local-mark workbench-activity-timeline__cluster-local" /> : null}</> : <PointShape point={point} />}
      </button>;
    })}
    {chooser ? <section role="dialog" aria-label="Choose captured Activity event" className="workbench-activity-timeline__chooser" style={{ left: `${Math.max(4, Math.min(width - Math.min(420, width - 8) - 4, groupPosition(chooser) - 180))}px`, width: `${Math.min(420, width - 8)}px` }}>
      <header><strong>{chooser.points.length} captured events</strong><button type="button" aria-label="Close Activity event choices" onClick={closeChooser}>Close</button></header>
      <div className="workbench-activity-timeline__choices">{chooser.points.map((point, index) => <button type="button" key={point.eventId} ref={index === 0 ? firstChoice : undefined} aria-label={pointLabel(point, origin)} title={pointLabel(point, origin)} onClick={() => { closeChooser(); onSelect(point, point.kind !== "ITEM_UPDATE"); }}>
        <strong>{point.source} · {point.kind === "ITEM_UPDATE" ? "Item Update" : markerNames[point.kind]} · {activityElapsed(point.timestamp, origin)}</strong><span>{point.fact ? `${point.fact} · ` : ""}{point.object}</span><small>{new Date(point.timestamp).toISOString()} · Evidence {point.eventId}</small>
      </button>)}</div>
    </section> : null}
  </div>;
}
