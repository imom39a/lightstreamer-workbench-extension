import { describe, expect, it } from "vitest";
import { activityScopeFor, createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createActivityProjection } from "../src/core/activity-projection";
import { createTypedFilterValue } from "../src/core/filter-algebra";
import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";
import { type EventHistory, type HistoryPublication } from "../src/core/event-history-authoritative";
import { type TopologySelectionTarget } from "../src/extension/panel/topology-view-model";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function update(id: string, timestamp: number): LightstreamerEventEnvelope {
  return { id, timestamp, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: id, client: { id: "client-1", sessionId: "session-1", semanticValueStates: { id: { state: "requested" }, sessionId: { state: "requested" } } }, subscription: { id: "subscription-1", mode: "MERGE", semanticValueStates: { id: { state: "requested" } } }, item: { name: "item-1", position: 1 }, update: { isSnapshot: false } };
}

describe("Activity runtime seam", () => {
  it("restores integrated ranking Scope, Filter and Frozen read point on Back", async () => {
    const runtime = createWorkbenchRuntime({ history: createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] }) });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "freeze-evidence" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "event" }] });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const before = runtime.getSnapshot();
    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: before.evidence.investigation.filter.revision, rankingId: before.activity!.projection.allRankings[0]!.identity });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "back-investigation" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const after = runtime.getSnapshot();
    expect(after.evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    expect(after.scope.selection).toEqual(before.scope.selection);
    expect(after.evidence.mode).toBe("frozen");
    expect(after.activity!.readPoint).toEqual(before.activity!.readPoint);
    expect(after.activity).not.toHaveProperty("document");
    runtime.dispose();
  });


  it("routes item and listener selections to their owning Subscription scope", () => {
    const subscription = { id: "subscription-1" } as never;
    const client = { id: "client-1" } as never;
    const session = { id: "session-1" } as never;
    const item = { name: "item-1", position: 1 } as never;
    const listener = { id: "listener-1" } as never;
    const itemTarget = { kind: "item", client, session, subscription, item } as TopologySelectionTarget;
    const listenerTarget = { kind: "listener", client, session, subscription, item, listener } as TopologySelectionTarget;

    expect(activityScopeFor(itemTarget)).toEqual({ kind: "SUBSCRIPTION", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" });
    expect(activityScopeFor(listenerTarget)).toEqual({ kind: "SUBSCRIPTION", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" });
  });

  it("publishes only committed Evidence with an explicit read point", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const activity = runtime.getSnapshot().activity!;

    expect(activity.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(activity.readPoint.retainedRange?.first.timestamp).toBe(1_000);
    expect(activity.projection.logicalUpdateTotal).toBe(2);
    expect(activity.projection.state).toBe("AVAILABLE");
    expect(runtime.getSnapshot().activity).not.toHaveProperty("document");
    runtime.dispose();
  });

  it("applies integrated ranking without inventing a time restriction", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const ranking = runtime.getSnapshot().activity!.projection.allRankings[0]!;
    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, rankingId: ranking.identity });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().evidence.investigation.filter.around).toBeNull();
    expect(runtime.getSnapshot().evidence.investigation.scope.kind).toBe("PAGE");
    runtime.dispose();
  });

  it("drills ranking identity, item-update type, and Server provenance into Evidence", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const ranking = runtime.getSnapshot().activity?.projection.allRankings[0];
    expect(ranking?.supportingFilterMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "add-criterion", facet: "subscription", polarity: "include" }),
      expect.objectContaining({ type: "add-criterion", facet: "kind", polarity: "include" }),
      expect.objectContaining({ type: "add-criterion", facet: "provenance", polarity: "include" })
    ]));
    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, rankingId: ranking!.identity });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const investigation = runtime.getSnapshot().evidence.investigation;
    expect(investigation.filter.around).toBeNull();
    expect(investigation.filter.criteria.subscription.include).toHaveLength(1);
    expect(investigation.filter.criteria.kind.include[0].value).toBe("ITEM-UPDATE");
    expect(investigation.filter.criteria.provenance.include[0].value).toBe("SERVER");
    runtime.dispose();
  });

  it("keeps integrated Activity stable at Frozen Evidence until follow-live", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "freeze-evidence" });
    history.offer(update("event-3", 3_000));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().evidence.mode).toBe("frozen");
    expect(runtime.getSnapshot().activity?.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(2);

    runtime.dispatch({ type: "follow-live" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(3);
    runtime.dispose();
  });

  it("keeps Frozen provenance counts and includes matching Evidence on follow-live", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const filter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: filter.revision,
      operations: [{ type: "add-criterion", facet: "provenance", value: createTypedFilterValue("provenance", "enum", "SERVER") }]
    });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "freeze-evidence" });
    history.offer({ ...update("local-1", 3_000), source: "synthetic", synthetic: true });
    history.offer(update("server-1", 4_000));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().activity?.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    runtime.dispatch({ type: "follow-live" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(3);
    expect(runtime.getSnapshot().activity?.projection.localLogicalUpdateTotal).toBe(0);
    runtime.dispose();
  });

  it("isolates an unexpected Activity projection failure from Capture and History", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({
      history,
      activityProjectionFactory: () => { throw new Error("projection exploded"); }
    });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.activity?.projection.state).toBe("AGGREGATION_FAILED");
    expect(snapshot.activity?.projection.reason).toBe("projection exploded");
    expect(snapshot.evidence.investigation.readPoint?.committedEvidenceBoundary?.sequence).toBe(1);
    expect(snapshot.retention.historyStatus.retained).toBe(1);
    runtime.dispose();
  });

  it("normalizes an empty Activity aggregation error into a usable condition", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({
      history,
      activityProjectionFactory: () => { throw new Error(); }
    });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().activity?.projection).toMatchObject({
      state: "AGGREGATION_FAILED",
      reason: "Activity aggregation failed."
    });
    expect(runtime.getSnapshot().notifications.entries).toContainEqual(expect.objectContaining({
      code: "workbench.activity.aggregation-failed",
      detail: "Activity aggregation failed."
    }));
    runtime.dispose();
  });

  it("publishes exact Activity counts without a duplicate runtime-dossier Activity fact", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.context.kind).toBe("runtime");
    expect(snapshot.context.fields.some(([name]) => name === "Activity")).toBe(false);
    // These logical records have no captured listener-delivery identity.
    expect(snapshot.activity?.projection).toMatchObject({ logicalUpdateTotal: 2, updateDeliveryTotal: 0 });
    runtime.dispose();
  });

  it("invalidates Activity and terminal history on successful Clear", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().retention.clearState).toBe("idle");
    expect(runtime.getSnapshot().retention.historyStatus.interval.ordinal).toBe(2);
    expect(runtime.getSnapshot().activity?.projection.state).toBe("EMPTY_INTERVAL");
    expect(runtime.getSnapshot().activity?.projection.committedEvidenceBoundary).toBeNull();
    expect(runtime.getSnapshot().activity).not.toHaveProperty("document");
    runtime.dispose();
  });

  it("leaves Activity and History intact after a failed Clear", async () => {
    const base = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const history = Object.freeze({
      ...base,
      clear: () => Promise.resolve({ ok: false as const, problem: { code: "CLEAR_FAILED" as const, message: "journal refused clear" } })
    }) as unknown as EventHistory;
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().retention.clearState).toBe("error");
    expect(runtime.getSnapshot().retention.historyStatus.retained).toBe(1);
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(1);
    expect(runtime.getSnapshot().diagnostics).toContainEqual(expect.objectContaining({ title: "History could not be cleared" }));
    runtime.dispose();
  });

  it("publishes one Activity diagnostic for aggregation failure and recovers from retained Evidence", async () => {
    let failed = true;
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({ history, activityProjectionFactory: (input) => {
      if (failed) throw new Error("aggregation unavailable");
      return createActivityProjection(input);
    } });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().activity?.projection.state).toBe("AGGREGATION_FAILED");
    const activityDiagnostic = runtime.getSnapshot().diagnostics.find(({ category }) => category === "activity");
    expect(activityDiagnostic).toMatchObject({
      title: "Activity aggregation unavailable",
      dismissalId: "activity:aggregation-failed:error"
    });
    expect(runtime.getSnapshot().notifications.entries).toContainEqual(expect.objectContaining({
      code: "workbench.activity.aggregation-failed",
      title: "Activity aggregation unavailable"
    }));
    runtime.dispatch({ type: "dismiss-diagnostic", dismissalId: activityDiagnostic!.dismissalId! });
    expect(runtime.getSnapshot().diagnostics.some(({ category }) => category === "activity")).toBe(false);
    expect(runtime.getSnapshot().notifications.entries).toContainEqual(expect.objectContaining({
      code: "workbench.activity.aggregation-failed"
    }));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().diagnostics.some(({ category }) => category === "activity")).toBe(false);
    expect(runtime.getSnapshot().notifications.entries.filter(({ code }) => code === "workbench.activity.aggregation-failed"))
      .toHaveLength(1);
    failed = false;
    runtime.dispatch({ type: "refresh-evidence" });
    expect(runtime.getSnapshot().activity?.projection.state).toBe("AVAILABLE");
    expect(runtime.getSnapshot().diagnostics.some(({ category }) => category === "activity")).toBe(false);
    expect(runtime.getSnapshot().notifications.entries.some(({ code }) => code === "workbench.activity.aggregation-failed")).toBe(false);
    expect(runtime.getSnapshot().retention.historyStatus.retained).toBe(1);
    runtime.dispose();
  });

  it("expires a dismissed Activity failure across hidden recovery and recurrence", async () => {
    let failed = true;
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "hidden-activity-diagnostics" });
    const baseHistory = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    let follower: ((publication: HistoryPublication) => void) | null = null;
    const history: EventHistory = {
      ...baseHistory,
      follow: (options, observer) => {
        follower = observer;
        return baseHistory.follow(options, observer);
      }
    };
    const runtime = createWorkbenchRuntime({
      history,
      diagnosticObservations,
      activityProjectionFactory: (input) => {
        if (failed) throw new Error("aggregation unavailable");
        return createActivityProjection(input);
      }
    });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "dismiss-diagnostic", dismissalId: "activity:aggregation-failed:error" });
    runtime.dispatch({ type: "set-visible", visible: false });
    failed = false;
    const status = history.status();
    const publishReplay = (publication: HistoryPublication): void => {
      if (!follower) throw new Error("History follower is unavailable.");
      follower(publication);
    };
    publishReplay({ type: "replay-started", interval: status.interval, after: null, retainedRange: status.retainedRange });
    publishReplay({ type: "replay-complete", interval: status.interval, committedEvidenceBoundary: status.committedEvidenceBoundary });
    failed = true;
    await history.offer(update("event-2", 2_000)).settled;
    await runtime.settleDiagnosticObservations?.();
    runtime.dispatch({ type: "set-visible", visible: true });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().diagnostics).toContainEqual(expect.objectContaining({
      title: "Activity aggregation unavailable",
      dismissalId: "activity:aggregation-failed:error"
    }));
    expect((await diagnosticObservations.query({ codes: ["workbench.activity.aggregation-failed"] })).observations)
      .toEqual([
        expect.objectContaining({ lifecycle: expect.objectContaining({ state: "active" }) }),
        expect.objectContaining({ lifecycle: expect.objectContaining({ state: "resolved" }) }),
        expect.objectContaining({ lifecycle: expect.objectContaining({ state: "active" }) })
      ]);
    runtime.dispose();
  });
});
