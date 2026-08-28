import { useMemo, useState, type JSX } from "react";
import type { ActivityProjection, ActivityRanking } from "../../../core/activity-projection";
import "./activity-context-summary.css";

function logicalCount(identified: number, unidentifiedDeliveries: number): string {
  return unidentifiedDeliveries ? identified ? `${identified.toLocaleString()} identified` : "Unknown" : identified.toLocaleString();
}

/** Scope-owned facts alongside Evidence; the parent retains disclosure state. */
export function ActivityContextSummary({ projection, scopeLabel, filterSummary, hasActiveFilter, frozen, open, onOpenChange, onRankingFilter, onResetFilter }: Readonly<{
  projection: ActivityProjection;
  scopeLabel: string;
  filterSummary: string;
  hasActiveFilter: boolean;
  frozen: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRankingFilter(expectedRevision: number, rankingId: string): void;
  onResetFilter(): void;
}>): JSX.Element {
  const signature = `${projection.intervalId}:${projection.filterRevision}:${JSON.stringify(projection.scope)}:${frozen ? projection.committedEvidenceBoundary?.sequence : "live"}`;
  const [pageState, setPageState] = useState({ signature, index: 0 });
  const [heldRankings, setHeldRankings] = useState<Readonly<{ signature: string; rankings: readonly ActivityRanking[] }> | null>(null);
  const rankings = useMemo(() => {
    if (heldRankings?.signature !== signature) return projection.allRankings;
    const current = new Map(projection.allRankings.map(rank => [rank.identity, rank]));
    const held = new Set(heldRankings.rankings.map(rank => rank.identity));
    return [...heldRankings.rankings.flatMap(rank => current.get(rank.identity) ?? []), ...projection.allRankings.filter(rank => !held.has(rank.identity))];
  }, [projection.allRankings, heldRankings, signature]);
  const pageCount = Math.max(1, Math.ceil(rankings.length / 5));
  const page = Math.min(pageState.signature === signature ? pageState.index : 0, pageCount - 1);
  const pageRankings = rankings.slice(page * 5, (page + 1) * 5);
  const rankingTitle = `Busiest SERVER ${projection.scope.kind === "SUBSCRIPTION" ? "items" : "Subscriptions"}`;
  const usable = projection.state === "AVAILABLE" || projection.state === "LIMITED" || projection.state === "EMPTY_MATCH" || projection.state === "EMPTY_INTERVAL";
  const identity = projection.logicalUpdateIdentity;
  return <details className="workbench-activity-summary" aria-label="Activity summary" open={open} onToggle={event => onOpenChange(event.currentTarget.open)}>
    <summary>Activity summary — {scopeLabel}</summary>
    <div className="workbench-activity-summary__content" aria-busy={projection.state === "LOADING"}>
      <p>Current Scope and Filter · {frozen ? "Frozen" : "Committed"} read point · {projection.readPoint.coverage} observation Coverage.</p>
      <div className="workbench-activity-summary__filter"><span>Filter: {filterSummary}</span>{hasActiveFilter ? <button type="button" onClick={onResetFilter}>Reset Filter</button> : null}</div>
      {projection.reason ? <p role="status">{projection.reason}</p> : null}
      {usable ? <>
        <table aria-label="Activity counts"><thead><tr><th scope="col">Source</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>
          <tr><th scope="row">SERVER</th><td>{logicalCount(projection.logicalUpdateTotal, identity.server.unidentifiedDeliveries)}</td><td>{projection.updateDeliveryTotal.toLocaleString()}</td></tr>
          <tr><th scope="row">LOCAL</th><td>{logicalCount(projection.localLogicalUpdateTotal, identity.local.unidentifiedDeliveries)}</td><td>{projection.localUpdateDeliveryTotal.toLocaleString()}</td></tr>
        </tbody></table>
        <p>SERVER Snapshot {logicalCount(projection.snapshotLogicalUpdateTotal, identity.server.unidentifiedSnapshotDeliveries)} · Live {logicalCount(projection.liveLogicalUpdateTotal, identity.server.unidentifiedLiveDeliveries)}</p>
        {identity.server.unidentifiedDeliveries ? <p>{identity.server.unidentifiedDeliveries.toLocaleString()} SERVER Update Deliveries lack logical update identity.</p> : null}
        {identity.local.unidentifiedDeliveries ? <p>{identity.local.unidentifiedDeliveries.toLocaleString()} LOCAL Update Deliveries lack logical update identity.</p> : null}
        <section aria-label={rankingTitle} onFocusCapture={() => { if (!heldRankings || heldRankings.signature !== signature) setHeldRankings({ signature, rankings }); }} onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHeldRankings(null); }}>
          <h3>{rankingTitle}</h3>
          {rankings.length ? <>
            {identity.server.unidentifiedDeliveries ? <p>Ranked by identified SERVER Logical Updates only.</p> : null}
            <table><thead><tr><th scope="col">Identity</th><th scope="col">Logical Updates</th><th scope="col">Update Deliveries</th></tr></thead><tbody>{pageRankings.map(rank => <tr key={rank.identity}><th scope="row"><button type="button" aria-label={`Filter Evidence to ${rank.label}`} title={`Filter Evidence to ${rank.label}`} onClick={() => onRankingFilter(projection.filterRevision, rank.identity)}>{rank.label}</button></th><td>{rank.logicalUpdates.toLocaleString()}</td><td>{rank.updateDeliveries.toLocaleString()}</td></tr>)}</tbody></table>
            <div className="workbench-activity-summary__pagination" role="group" aria-label="Activity ranking pages"><button type="button" aria-label="Previous Activity ranking page" disabled={page === 0} onClick={() => setPageState({ signature, index: page - 1 })}>Previous</button><span>Rows {page * 5 + 1}–{Math.min(rankings.length, (page + 1) * 5)} of {rankings.length}</span><button type="button" aria-label="Next Activity ranking page" disabled={page === pageCount - 1} onClick={() => setPageState({ signature, index: page + 1 })}>Next</button></div>
          </> : <p>{identity.server.unidentifiedDeliveries ? "Ranking unavailable: SERVER logical update identities were not captured." : "No matching SERVER Logical Updates to rank."}</p>}
        </section>
        <section aria-label="Captured bandwidth and frequency">
          <h3>Captured bandwidth and frequency</h3>
          {projection.contextFacts.length ? <>
            <p>Captured distinct values across matching owners; not current settings.</p>
            <dl className="workbench-activity-summary__facts">{projection.contextFacts.map(fact => <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.values.slice(0, 5).map(({ value }) => value).join(" · ")}{fact.values.length > 5 ? ` · ${fact.values.length - 5} more distinct values captured` : ""}</dd></div>)}</dl>
          </> : <p>No bandwidth or frequency facts in matching Evidence.</p>}
        </section>
      </> : null}
    </div>
  </details>;
}
