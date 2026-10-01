import { useLayoutEffect, useRef, type JSX } from "react";
import type { WorkbenchRuntime, WorkbenchScenarioSnapshot } from "../workbench-runtime";

/** Retained Evidence is a candidate set. Only the explicit batch action adds members. */
export function ScenarioCapturePanel({ runtime, state }: Readonly<{ runtime: WorkbenchRuntime; state: NonNullable<WorkbenchScenarioSnapshot> }>): JSX.Element {
  const workspace = state.captureWorkspace;
  const scroll = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (scroll.current && scroll.current.scrollTop !== workspace.scrollTop) scroll.current.scrollTop = workspace.scrollTop;
    if (panel.current && panel.current.scrollTop !== workspace.scrollTop) panel.current.scrollTop = workspace.scrollTop;
  }, [workspace.scrollTop]);
  const busy = workspace.queryState === "loading" || workspace.adding;
  const editable = state.phase === "edit";
  const remainingSteps = workspace.remainingStepCapacity;
  const capacityBlocked = workspace.selected.length > remainingSteps;
  const capacityReason = remainingSteps === 0 ? "100-Step capacity reached. Remove a Step before adding more." : capacityBlocked ? `Only ${remainingSteps} Step slots remain. Reduce the selection or remove a Step.` : null;
  const start = workspace.rows.length ? workspace.pageOffset + 1 : 0;
  const end = workspace.pageOffset + workspace.rows.length;
  return <section ref={panel} onScroll={(event) => { if (event.target === event.currentTarget) runtime.dispatch({ type: "set-scenario-capture-scroll", scrollTop: event.currentTarget.scrollTop }); }} className="workbench-react__scenario-capture" aria-label="Scenario captured updates" aria-busy={busy}>
    <header><strong>Captured updates</strong><span>Exact Scenario target · retained Evidence · newest first</span></header>
    <div className="workbench-react__scenario-capture-filter">
      <label>Search <input type="search" aria-label="Search captured updates" value={workspace.search} disabled={!editable || workspace.adding} onChange={(event) => runtime.dispatch({ type: "set-scenario-capture-search", text: event.currentTarget.value })} /></label>
      {state.scenario.target.mode === "COMMAND" ? <label>Operation <select aria-label="Captured operation" value={workspace.commandFilter} disabled={!editable || workspace.adding} onChange={(event) => runtime.dispatch({ type: "set-scenario-capture-filter", command: event.currentTarget.value as typeof workspace.commandFilter })}><option value="ALL">All operations</option><option value="ADD">ADD</option><option value="UPDATE">UPDATE</option><option value="DELETE">DELETE</option></select></label> : null}
      <button type="button" disabled={!editable || workspace.adding || (!workspace.search && workspace.commandFilter === "ALL")} onClick={() => {
        runtime.dispatch({ type: "set-scenario-capture-search", text: "" });
        runtime.dispatch({ type: "set-scenario-capture-filter", command: "ALL" });
      }}>Reset</button>
      <button type="button" disabled={!editable || busy} onClick={() => runtime.dispatch({ type: "refresh-scenario-captures" })}>Refresh captures</button>
    </div>
    <p className="workbench-react__scenario-capture-count">{workspace.total} matching · {start}–{end} shown{workspace.search || workspace.commandFilter !== "ALL" ? ` · Filter: ${workspace.search || "all text"} / ${workspace.commandFilter}` : ""}</p>
    {workspace.expired ? <p className="workbench-react__scenario-capture-notice" role="status">Retained results expired. Refresh captures; selected identities are preserved for explicit recovery.</p> : null}
    {workspace.newerAcceptedEvidenceCount > 0 ? <p className="workbench-react__scenario-capture-notice" role="status">{workspace.newerAcceptedEvidenceCount} newer accepted Evidence records. Refresh captures to include current retained updates for this target.</p> : null}
    {workspace.error ? <p className="workbench-react__scenario-capture-notice" role="alert">{workspace.error} <span>Refresh captures to recover retained results.</span></p> : null}
    {capacityReason ? <p id="scenario-capture-capacity" className="workbench-react__scenario-capture-notice" role="status">{capacityReason}</p> : null}
    {workspace.feedback ? <p className="workbench-react__scenario-capture-notice" role="status">{workspace.feedback}{state.canUndoCaptureAddition ? <> <button type="button" onClick={() => runtime.dispatch({ type: "undo-scenario-capture-addition" })}>Undo added updates</button></> : null}</p> : null}
    <div ref={scroll} role="region" tabIndex={0} aria-label="Captured update results" className="workbench-react__scenario-capture-scroll" onScroll={(event) => runtime.dispatch({ type: "set-scenario-capture-scroll", scrollTop: event.currentTarget.scrollTop })}>
      {workspace.queryState === "loading" ? <p role="status">Loading captured updates… Selection is preserved.</p> : null}
      {workspace.queryState === "idle" ? <p>Captured updates have not loaded. Refresh captures to load retained Evidence.</p> : null}
      {workspace.queryState === "ready" && !workspace.rows.length ? <p>{workspace.search || workspace.commandFilter !== "ALL" ? "No captured updates match this Filter. Reset to see retained updates for this target." : "No retained captured updates are available for this exact target."}</p> : null}
      <ul>{workspace.rows.map((row) => {
        const { event, identity } = row;
        const id = `scenario-capture-${identity.sequence}-${event.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const blocked = !row.available || row.alreadyUsed;
        const fieldValues = Object.entries(event.update?.fields ?? {}).filter(([field]) => field !== "command" && field !== "key").slice(0, 3).map(([field, value]) => `${field}: ${String(value).slice(0, 80)}`).join(" · ");
        const values = fieldValues || ("preview" in row && typeof row.preview === "string" ? row.preview.slice(0, 240) : "");
        return <li key={`${identity.intervalId}:${identity.sequence}:${identity.eventId}`} data-used={row.alreadyUsed || undefined}>
          <label><input type="checkbox" aria-label={`Select captured update ${event.id}`} aria-describedby={blocked ? `${id}-reason` : remainingSteps === 0 && !row.selected ? "scenario-capture-capacity" : undefined} checked={row.selected} disabled={!editable || busy || (!row.selected && (blocked || remainingSteps === 0))} onChange={() => runtime.dispatch({ type: "toggle-scenario-capture", identity })} /><span><strong>{event.update?.command ?? "Item update"}</strong><span>{event.update?.key ?? event.item?.name ?? `item ${event.item?.position ?? "unknown"}`}</span><small>{event.id} · Server · {event.update?.isSnapshot === true ? "Snapshot" : event.update?.isSnapshot === false ? "Live" : "Snapshot unknown"} · retained sequence {identity.sequence}</small>{values ? <small>Search excerpt · {values}</small> : null}{blocked ? <small id={`${id}-reason`}>{row.alreadyUsed ? "Already used · Duplicate Step to reuse" : `Unavailable · ${row.reason ?? "source compatibility cannot be proven"}`}</small> : null}</span></label>
        </li>;
      })}</ul>
    </div>
    <div className="workbench-react__scenario-capture-pagination"><button type="button" aria-label="Show newer captured updates" disabled={!editable || busy || !workspace.canShowNewer} onClick={() => runtime.dispatch({ type: "show-newer-scenario-captures" })}>Newer</button><button type="button" aria-label="Show older captured updates" disabled={!editable || busy || !workspace.canShowOlder} onClick={() => runtime.dispatch({ type: "show-older-scenario-captures" })}>Older</button><span>New Capture requires Refresh.</span></div>
    <div className="workbench-react__scenario-capture-add"><button type="button" disabled={!editable || workspace.adding || !workspace.selected.length} onClick={() => runtime.dispatch({ type: "clear-scenario-capture-selection" })}>Clear selection</button><span>{workspace.selected.length} selected across pages · append in captured order</span><button type="button" aria-label="Add selected updates" aria-describedby={capacityReason ? "scenario-capture-capacity" : undefined} disabled={!editable || busy || capacityBlocked || !workspace.selected.length} onClick={() => runtime.dispatch({ type: "add-scenario-captures" })}>{workspace.adding ? "Adding updates…" : `Add ${workspace.selected.length} update${workspace.selected.length === 1 ? "" : "s"}`}</button></div>
  </section>;
}
