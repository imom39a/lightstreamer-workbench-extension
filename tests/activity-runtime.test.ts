import { describe, expect, it } from "vitest";
import { activityScopeFor, createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createTypedFilterValue } from "../src/core/filter-algebra";
import { type TopologySelectionTarget } from "../src/extension/panel/topology-view-model";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function update(id: string, timestamp: number): LightstreamerEventEnvelope {
  return { id, timestamp, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: id, client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1", mode: "MERGE" }, item: { name: "item-1", position: 1 }, update: { isSnapshot: false } };
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

  it("includes a concise labelled Activity summary in supported runtime dossiers", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(runtime.getSnapshot().context.kind).toBe("runtime");
    expect(runtime.getSnapshot().context.fields).toContainEqual(["Activity", expect.stringContaining("2 Logical Updates")]);
    runtime.dispose();
  });
});
