import { describe, expect, it } from "vitest";
import { activityScopeFor, createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";
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

function scheduler() {
  const frames: Array<() => void> = [];
  const timers: Array<{ delay: number; callback: () => void }> = [];
  const value: WorkbenchRuntimeScheduler & { flushFrame(): void; flushTimers(): void; delays: number[] } = {
    requestFrame(callback) { frames.push(callback); return callback; },
    cancelFrame(handle) { const index = frames.indexOf(handle as () => void); if (index >= 0) frames.splice(index, 1); },
    setTimeout(callback, delayMs) { timers.push({ delay: delayMs, callback }); return callback; },
    clearTimeout(handle) { const index = timers.findIndex((timer) => timer.callback === handle); if (index >= 0) timers.splice(index, 1); },
    flushFrame() { const callbacks = frames.splice(0); callbacks.forEach((callback) => callback()); },
    flushTimers() { const callbacks = timers.splice(0); callbacks.forEach(({ callback }) => callback()); },
    delays: []
  };
  const originalSetTimeout = value.setTimeout;
  value.setTimeout = (callback, delayMs) => { value.delays.push(delayMs); return originalSetTimeout(callback, delayMs); };
  return value;
}

describe("Activity runtime seam", () => {
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

  it("publishes only committed Evidence with an explicit read point and supports promotion", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const activity = runtime.getSnapshot().activity!;

    expect(activity.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(activity.readPoint.retainedRange?.first.timestamp).toBe(1_000);
    expect(activity.projection.logicalUpdateTotal).toBe(2);
    expect(activity.projection.state).toBe("AVAILABLE");
    runtime.dispatch({ type: "open-activity" });
    expect(runtime.getSnapshot().activity?.open).toBe(true);
    runtime.dispose();
  });

  it("clips Activity supporting Evidence to the retained range", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "show-activity-supporting-evidence", start: -10_000, end: 10_000 });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().evidence.investigation.filter.around).toEqual({ intervalId: expect.any(String), start: 1_000, end: 2_001 });
    expect(runtime.getSnapshot().evidence.investigation.scope.kind).toBe("PAGE");
    runtime.dispose();
  });

  it("drills ranking identity, item-update type, Server provenance, and plotted interval into Evidence", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "open-activity" });
    const ranking = runtime.getSnapshot().activity?.projection.allRankings[0];
    expect(ranking?.supportingFilterMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "add-criterion", facet: "subscription", polarity: "include" }),
      expect.objectContaining({ type: "add-criterion", facet: "kind", polarity: "include" }),
      expect.objectContaining({ type: "add-criterion", facet: "provenance", polarity: "include" })
    ]));
    runtime.dispatch({ type: "show-activity-supporting-evidence", ...(ranking?.range ? { start: ranking.range.start, end: ranking.range.end } : {}), filterMutations: ranking?.supportingFilterMutations ?? [] });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const investigation = runtime.getSnapshot().evidence.investigation;
    expect(investigation.filter.around).toEqual({ intervalId: expect.any(String), start: 1_000, end: 2_001 });
    expect(investigation.filter.criteria.subscription.include).toHaveLength(1);
    expect(investigation.filter.criteria.kind.include[0].value).toBe("ITEM-UPDATE");
    expect(investigation.filter.criteria.provenance.include[0].value).toBe("SERVER");
    runtime.dispose();
  });

  it("keeps frozen Activity stable and reports newer committed Evidence until follow-live", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "freeze-activity" });
    history.offer(update("event-3", 3_000));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().activity?.document?.view).toBe("FROZEN");
    expect(runtime.getSnapshot().activity?.document?.newerMatchingEvidence).toBe(1);
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(2);

    runtime.dispatch({ type: "follow-activity" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().activity?.document?.view).toBe("FOLLOW LIVE");
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(3);
    runtime.dispose();
  });

  it("counts only newer Evidence matching the frozen provenance Filter", async () => {
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
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "freeze-activity" });
    history.offer({ ...update("local-1", 3_000), source: "synthetic", synthetic: true });
    history.offer(update("server-1", 4_000));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().activity?.document?.newerMatchingEvidence).toBe(1);
    runtime.dispose();
  });

  it("restores the Activity origin selection, scroll, and focus on Back to Evidence", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "select-evidence", eventId: "event-1" });
    runtime.dispatch({ type: "focus-evidence", eventId: "event-1" });
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 84 });
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "select-evidence", eventId: "event-2" });
    runtime.dispatch({ type: "focus-evidence", eventId: "event-2" });
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 999 });
    runtime.dispatch({ type: "close-activity" });

    expect(runtime.getSnapshot().selectionEventId).toBe("event-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("event-1");
    expect(runtime.getSnapshot().evidence.scrollTop).toBe(84);
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

  it("coalesces visible Activity graphical publication for approximately one second", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtimeScheduler = scheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler: runtimeScheduler });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "open-activity" });
    const before = runtime.getSnapshot().activity?.projection.logicalUpdateTotal;
    history.offer(update("event-2", 2_000));
    history.offer(update("event-3", 3_000));
    runtimeScheduler.flushFrame();

    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(before);
    expect(runtimeScheduler.delays).toContain(1_000);
    runtimeScheduler.flushTimers();
    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(3);
    runtime.dispose();
  });

  it("restores the exact Evidence Scope, Filter, position, and view on Back", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const originalFilter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({ type: "select-evidence", eventId: "event-1" });
    runtime.dispatch({ type: "focus-evidence", eventId: "event-1" });
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 84 });
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: originalFilter.revision, operations: [{ type: "set-text", text: "changed-in-activity" }] });
    runtime.dispatch({ type: "freeze-activity" });
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 999 });
    runtime.dispatch({ type: "close-activity" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.evidence.investigation.filter).toEqual(originalFilter);
    expect(snapshot.evidence.investigation.scope.kind).toBe("PAGE");
    expect(snapshot.evidence.mode).toBe("live");
    expect(snapshot.selectionEventId).toBe("event-1");
    expect(snapshot.evidence.focusedEventId).toBe("event-1");
    expect(snapshot.evidence.scrollTop).toBe(84);
    runtime.dispose();
  });

  it("reopens supporting Evidence in the exact Activity document state", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "open-activity" });
    const activity = runtime.getSnapshot().activity!;
    const bucketId = activity.projection.buckets[0]!.id;
    runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: bucketId } });
    runtime.dispatch({ type: "set-activity-timeline-series", series: "SERVER_LIVE" });
    runtime.dispatch({ type: "set-activity-local-series", enabled: true });
    runtime.dispatch({ type: "set-activity-ranking-sort", sort: "UPDATE_DELIVERIES" });
    runtime.dispatch({ type: "set-activity-scroll", documentTop: 84, plotLeft: 19 });
    runtime.dispatch({ type: "freeze-activity" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const before = runtime.getSnapshot().activity!.document!;
    runtime.dispatch({ type: "show-activity-supporting-evidence", start: 1_000, end: 2_001 });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().activity?.open).toBe(false);

    runtime.dispatch({ type: "back-investigation" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    const restored = runtime.getSnapshot().activity!;
    expect(restored.open).toBe(true);
    expect(restored.readPoint).toEqual(before.readPoint);
    expect(restored.document).toMatchObject({
      scope: before.scope,
      filter: before.filter,
      readPoint: before.readPoint,
      view: "FROZEN",
      selection: before.selection,
      selectionRange: before.selectionRange,
      timelineSeries: "SERVER_LIVE",
      localSeries: true,
      rankingSort: "UPDATE_DELIVERIES",
      documentScrollTop: 84,
      plotScrollLeft: 19
    });
    runtime.dispose();
  });

  it("exposes the Activity navigation cause for panel focus restoration", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "open-activity" });
    expect(runtime.getSnapshot().activity?.transition.kind).toBe("opened");

    runtime.dispatch({ type: "close-activity" });
    expect(runtime.getSnapshot().activity?.transition.kind).toBe("explicit-close");

    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "show-activity-supporting-evidence", start: 1_000, end: 2_001 });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().activity?.transition.kind).toBe("supporting-evidence");

    runtime.dispatch({ type: "back-investigation" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().activity?.transition.kind).toBe("back");
    runtime.dispose();
  });

  it("normalizes a legacy renderer bucket index to the stable Activity bucket identity", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    runtime.dispatch({ type: "open-activity" });
    const bucket = runtime.getSnapshot().activity!.projection.buckets[0]!;
    runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: "0" } });

    expect(runtime.getSnapshot().activity?.document?.selection).toEqual({ kind: "bucket", id: bucket.id });
    runtime.dispose();
  });

  it("invalidates Activity and terminal history on successful Clear", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "select-activity", selection: { kind: "bucket", id: "0" } });
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().retention.clearState).toBe("idle");
    expect(runtime.getSnapshot().retention.historyStatus.interval.ordinal).toBe(2);
    expect(runtime.getSnapshot().activity?.projection.state).toBe("EMPTY_INTERVAL");
    expect(runtime.getSnapshot().activity?.projection.committedEvidenceBoundary).toBeNull();
    expect(runtime.getSnapshot().activity?.document?.selection).toBeNull();
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
    runtime.dispatch({ type: "open-activity" });
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
    runtime.dispatch({ type: "open-activity" });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(runtime.getSnapshot().diagnostics.some(({ category }) => category === "activity")).toBe(false);
    expect(runtime.getSnapshot().notifications.entries.filter(({ code }) => code === "workbench.activity.aggregation-failed"))
      .toHaveLength(1);
    runtime.dispatch({ type: "close-activity" });
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
