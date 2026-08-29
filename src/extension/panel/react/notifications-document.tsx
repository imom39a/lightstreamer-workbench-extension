import { useLayoutEffect, useRef, useState, type JSX } from "react";

import { DIAGNOSTIC_FILTER_FACETS } from "../../../core/diagnostic-observation-index";
import type { WorkbenchCommand, WorkbenchDiagnostic, WorkbenchNotificationsSnapshot } from "../workbench-runtime";

type Props = Readonly<{
  open: boolean;
  notifications: WorkbenchNotificationsSnapshot;
  onBack(): void;
  onCommand(command: WorkbenchCommand): void;
  onInspect(route: NonNullable<WorkbenchDiagnostic["route"]>): boolean;
}>;

function notificationKey(entry: WorkbenchDiagnostic): string {
  return JSON.stringify([entry.code, entry.id, entry.affectedIdentity ?? entry.affected]);
}

/** One temporary document; its scroll and disclosures survive Evidence inspection. */
export function NotificationsDocument({ open, notifications, onBack, onCommand, onInspect }: Props): JSX.Element | null {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const filterSummary = useRef<HTMLElement | null>(null);
  const scrollTop = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inspectionUnavailable, setInspectionUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const { entries, total, limit, filter } = notifications;

  useLayoutEffect(() => {
    if (!open) return;
    setInspectionUnavailable(false);
    heading.current?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = scrollTop.current;
  }, [open]);

  if (!open) return null;

  const activeCriteria = DIAGNOSTIC_FILTER_FACETS.flatMap((facet) => {
    const criterion = filter.criteria[facet];
    if (!criterion) return [];
    const include = "include" in criterion ? criterion.include : criterion;
    const exclude = "exclude" in criterion ? criterion.exclude : [];
    return [
      ...include.map((value) => ({ facet, value, polarity: "include" as const })),
      ...exclude.map((value) => ({ facet, value, polarity: "exclude" as const }))
    ];
  });

  return <section className="workbench-react__notifications" id="workbench-notifications" aria-label="Notifications">
    <header className="workbench-react__pane-header">
      <h1 ref={heading} tabIndex={-1}>Notifications</h1>
      <button type="button" onClick={onBack}>Back to Evidence</button>
    </header>
    <div
      className="workbench-react__notifications-body"
      ref={body}
      tabIndex={0}
      aria-label="Notification entries"
      onScroll={(event) => { scrollTop.current = event.currentTarget.scrollTop; }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Home" && event.key !== "End")) return;
        event.preventDefault();
        event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
      }}
    >
      <div className="workbench-react__notifications-summary">
        <strong>{entries.length} of {total} notifications · All runtime Scopes</strong>
        <p>Active Workbench conditions and recent Lightstreamer diagnostics for this Panel Session, oldest first. Notification filters do not change Evidence.</p>
        <p>Dismissing an active footer condition keeps its notification here until that condition ends.</p>
        <p>Up to {limit} recent diagnostics are kept here. Supporting Evidence follows Event History retention.</p>
      </div>
      {inspectionUnavailable ? <p role="status">This notification’s inspection target is no longer available. Choose another notification or return to Evidence.</p> : null}
      <div className="workbench-react__notifications-filters">
        <details className="workbench-react__diagnostic-filter-options" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
          <summary ref={filterSummary}>Filter notifications</summary>
          {DIAGNOSTIC_FILTER_FACETS.map((facet) => <fieldset key={facet}>
            <legend>{facet === "diagnosticCode" ? "Code" : facet === "diagnosticSeverity" ? "Severity" : "Affected"}</legend>
            {filter.options[facet].length ? filter.options[facet].map(({ value, count }) => <span key={value.identity}>
              <span>{value.label} ({count})</span>
              <button type="button" onClick={() => onCommand({ type: "apply-diagnostic-filter", facet, value, polarity: "include" })}>Include {value.label}</button>
              <button type="button" onClick={() => onCommand({ type: "apply-diagnostic-filter", facet, value, polarity: "exclude" })}>Exclude {value.label}</button>
            </span>) : <span>No values recorded.</span>}
          </fieldset>)}
        </details>
        <button type="button" aria-disabled={!filter.active} onClick={() => {
          if (filter.active) onCommand({ type: "reset-diagnostic-filter" });
        }}>Reset notification filters</button>
      </div>
      {activeCriteria.length ? <div className="workbench-react__diagnostic-active-filters" aria-label="Active notification filters">
        {activeCriteria.map(({ facet, value, polarity }) => <button type="button" key={`${facet}-${polarity}-${value.identity}`} onClick={() => {
          onCommand({ type: "remove-diagnostic-filter", facet, value, polarity });
          filterSummary.current?.focus();
        }}>Remove {polarity === "include" ? "Include" : "Exclude"} {value.label}</button>)}
      </div> : null}
      {entries.length ? <ol className="workbench-react__notification-list">
        {entries.map((entry) => {
          const key = notificationKey(entry);
          return <li key={key}>
            <article className="workbench-react__notification" data-severity={entry.severity.toLowerCase()}>
              <div className="workbench-react__notification-heading">
                <strong>{entry.severity} · {entry.title}</strong>
                {entry.route ? <button type="button" onClick={() => setInspectionUnavailable(!onInspect(entry.route!))}>{entry.route.label}</button> : null}
              </div>
              <span>Affected: {entry.affected}</span>
              <p>{entry.detail}</p>
              {!entry.route && entry.recovery ? <p>Recovery: {entry.recovery}</p> : null}
              <details open={expanded.has(key)} onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setExpanded((previous) => {
                  if (previous.has(key) === isOpen) return previous;
                  const currentKeys = new Set(entries.map(notificationKey));
                  const next = new Set([...previous].filter((value) => currentKeys.has(value)));
                  if (isOpen) next.add(key);
                  else next.delete(key);
                  return next;
                });
              }}>
                <summary>Details</summary>
                {entry.limitation ? <p>Limit: {entry.limitation}</p> : null}
                {entry.consequence ? <p>Consequence: {entry.consequence}</p> : null}
                {entry.route && entry.recovery ? <p>Recovery: {entry.recovery}</p> : null}
                {entry.code ? <p>Code: <code>{entry.code}</code></p> : null}
                {!entry.route ? <p>No supporting Evidence or affected Scope route was captured.</p> : null}
              </details>
            </article>
          </li>;
        })}
      </ol> : <p className="workbench-react__notifications-empty">{filter.active
        ? "No notifications match the active notification filters."
        : "No notifications in this Panel Session."}</p>}
    </div>
  </section>;
}
