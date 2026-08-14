import { describe, expect, it } from "vitest";
import { activityScopeFor, createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
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
});
