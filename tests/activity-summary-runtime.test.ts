import { describe, expect, it } from "vitest";
import { createTypedFilterValue } from "../src/core/filter-algebra";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

function serverUpdate(sequence: number, subscriptionId: string, itemName = `${subscriptionId}-item`): LightstreamerEventEnvelope {
  return {
    id: `summary-${sequence}`,
    timestamp: sequence * 1_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    logicalEventId: `summary-logical-${sequence}`,
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: subscriptionId, mode: "MERGE" },
    item: { name: itemName, position: sequence },
    update: { isSnapshot: sequence === 1 }
  };
}

function localUpdate(sequence: number, subscriptionId: string): LightstreamerEventEnvelope {
  return { ...serverUpdate(sequence, subscriptionId), id: `summary-local-${sequence}`, source: "synthetic", synthetic: true, logicalEventId: `summary-local-logical-${sequence}` };
}

function clientStatus(sequence: number, subscriptionId: string): LightstreamerEventEnvelope {
  return {
    ...serverUpdate(sequence, subscriptionId),
    id: `summary-status-${sequence}`,
    kind: "client-status",
    client: { id: "client-1", sessionId: "session-1", status: "DISCONNECTED" },
    update: undefined
  };
}

function unidentifiedDelivery(sequence: number, snapshot = false): LightstreamerEventEnvelope {
  return {
    ...serverUpdate(sequence, "subscription-legacy"),
    id: `legacy-${sequence}`,
    logicalEventId: undefined,
    listener: { id: `legacy-listener-${sequence}`, metricOwner: false },
    update: { isSnapshot: snapshot }
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 80; index += 1) await Promise.resolve();
}

describe("Activity Context ranking filter", () => {
  it("publishes unknown Logical Update identity for legacy delivery-only Evidence without changing exact delivery totals", async () => {
    const history = createInMemoryEventHistory();
    for (let sequence = 1; sequence <= 5; sequence += 1) await history.offer(unidentifiedDelivery(sequence, sequence <= 2)).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();

    const projection = runtime.getSnapshot().activity!.projection;
    expect(projection.updateDeliveryTotal).toBe(5);
    expect(projection.logicalUpdateTotal).toBe(0);
    expect(projection.snapshotLogicalUpdateTotal).toBe(0);
    expect(projection.liveLogicalUpdateTotal).toBe(0);
    expect(projection.logicalUpdateIdentity.server).toEqual({
      unidentifiedDeliveries: 5,
      unidentifiedSnapshotDeliveries: 2,
      unidentifiedLiveDeliveries: 3
    });
    runtime.dispose();
  });

  it("keeps mixed identified and unavailable delivery evidence distinct in the public Activity snapshot", async () => {
    const history = createInMemoryEventHistory();
    await history.offer(serverUpdate(1, "subscription-mixed")).settled;
    await history.offer(unidentifiedDelivery(2)).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();

    const projection = runtime.getSnapshot().activity!.projection;
    expect(projection.logicalUpdateTotal).toBe(1);
    expect(projection.logicalUpdateIdentity.server).toMatchObject({ unidentifiedDeliveries: 1, unidentifiedLiveDeliveries: 1 });
    runtime.dispose();
  });

  it("keeps a pure zero and a normal identified workload exact in the public Activity snapshot", async () => {
    const pureZero = createInMemoryEventHistory();
    await pureZero.offer(clientStatus(1, "subscription-zero")).settled;
    const zeroRuntime = createWorkbenchRuntime({ history: pureZero });
    await settle();
    expect(zeroRuntime.getSnapshot().activity!.projection).toMatchObject({
      logicalUpdateTotal: 0,
      logicalUpdateIdentity: { server: { unidentifiedDeliveries: 0 }, local: { unidentifiedDeliveries: 0 } }
    });
    zeroRuntime.dispose();

    const normal = createAuthoritativeHistory({ precommitted: Array.from({ length: 1_692 }, (_, index) => serverUpdate(index + 1, "subscription-normal")) });
    const normalRuntime = createWorkbenchRuntime({ history: normal });
    await settle();
    expect(normalRuntime.getSnapshot().activity!.projection).toMatchObject({
      logicalUpdateTotal: 1_692,
      logicalUpdateIdentity: { server: { unidentifiedDeliveries: 0 }, local: { unidentifiedDeliveries: 0 } }
    });
    normalRuntime.dispose();
  });

  it("replaces the selected ranking facet while preserving exclusions, range, Scope, Find, selection, and Frozen read point", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "activity-summary" });
    await history.offer(serverUpdate(1, "subscription-a")).settled;
    await history.offer(serverUpdate(2, "subscription-b")).settled;
    await history.offer(localUpdate(3, "subscription-a")).settled;
    await history.offer(clientStatus(4, "subscription-a")).settled;
    await history.offer(serverUpdate(5, "subscription-b")).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();

    const initial = runtime.getSnapshot();
    const intervalId = initial.activity!.projection.intervalId;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: initial.evidence.investigation.filter.revision,
      operations: [{
        type: "replace-facet",
        facet: "subscription",
        criterion: {
          include: [
            createTypedFilterValue("subscription", "structural-subscription", "subscription-a"),
            createTypedFilterValue("subscription", "structural-subscription", "subscription-b")
          ],
          exclude: [createTypedFilterValue("subscription", "structural-subscription", "subscription-excluded")]
        }
      }, {
        type: "add-criterion",
        facet: "client",
        value: createTypedFilterValue("client", "structural-client", "client-1")
      }, {
        type: "set-around",
        around: { intervalId, start: 1_000, end: 5_001 }
      }]
    });
    await settle();
    runtime.dispatch({ type: "set-find", value: "client-1" });
    await settle();
    runtime.dispatch({ type: "freeze-evidence" });
    await settle();
    runtime.dispatch({ type: "select-evidence", eventId: "summary-5" });
    await settle();

    const before = runtime.getSnapshot();
    const ranking = before.activity!.projection.allRankings.find(({ subscriptionId }) => subscriptionId === "subscription-a")!;
    const selectedBefore = before.evidence.selectedEventId;
    const frozenBoundary = before.activity!.readPoint.committedEvidenceBoundary;
    expect(before.activity!.projection.allRankings).toHaveLength(2);
    expect(selectedBefore).toBe("summary-5");

    runtime.dispatch({
      type: "apply-activity-ranking-filter",
      expectedRevision: before.activity!.filter.revision,
      rankingId: ranking.identity
    });
    await settle();

    const after = runtime.getSnapshot();
    expect(after.evidence.investigation.filter.criteria.subscription).toMatchObject({
      include: [{ value: "subscription-a" }],
      exclude: [{ value: "subscription-excluded" }]
    });
    expect(after.evidence.investigation.filter.criteria.client).toMatchObject({ include: [{ value: "client-1" }] });
    expect(after.evidence.investigation.filter.criteria.session).toMatchObject({ include: [{ value: "session-1" }] });
    expect(after.evidence.investigation.filter.criteria.kind).toMatchObject({ include: [{ value: "ITEM-UPDATE" }] });
    expect(after.evidence.investigation.filter.criteria.provenance).toMatchObject({ include: [{ value: "SERVER" }] });
    expect(after.evidence.investigation.filter.around).toEqual({ intervalId, start: 1_000, end: 5_001 });
    expect(after.evidence.find).toBe("client-1");
    expect(after.scopeId).toBe(before.scopeId);
    expect(after.evidence.selectedEventId).toBe(selectedBefore);
    expect(after.evidence.mode).toBe("frozen");
    expect(after.activity!.readPoint.committedEvidenceBoundary).toEqual(frozenBoundary);
    expect(after.evidence.events.map((event) => event.id)).toEqual(["summary-1"]);

    runtime.dispatch({ type: "back-investigation" });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    runtime.dispose();
  });

  it("rejects stale revisions and rankings no longer represented by the current Filter", async () => {
    const history = createInMemoryEventHistory();
    await history.offer(serverUpdate(1, "subscription-a")).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const before = runtime.getSnapshot();
    const ranking = before.activity!.projection.allRankings[0]!;

    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: before.activity!.filter.revision - 1, rankingId: ranking.identity });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before.evidence.investigation.filter);

    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: before.activity!.filter.revision, rankingId: "missing-ranking" });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    runtime.dispose();
  });

  it("narrows a Subscription-scope item ranking with all represented SERVER identity constraints", async () => {
    const history = createInMemoryEventHistory();
    await history.offer(serverUpdate(1, "subscription-a", "item-a")).settled;
    await history.offer(serverUpdate(2, "subscription-a", "item-b")).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const subscriptionScope = runtime.getSnapshot().scope.nodes.find((node) => node.kind === "subscription" && node.label === "subscription-a");
    expect(subscriptionScope).toBeDefined();
    runtime.dispatch({ type: "set-scope", scopeId: subscriptionScope!.id });
    await settle();

    const before = runtime.getSnapshot();
    const ranking = before.activity!.projection.allRankings.find(({ itemName }) => itemName === "item-a")!;
    runtime.dispatch({ type: "apply-activity-ranking-filter", expectedRevision: before.activity!.filter.revision, rankingId: ranking.identity });
    await settle();

    const after = runtime.getSnapshot().evidence.investigation.filter.criteria;
    expect(after.item).toMatchObject({ include: [{ value: JSON.stringify(["item-a", 1]) }] });
    expect(after.subscription).toMatchObject({ include: [{ value: "subscription-a" }] });
    expect(after.client).toMatchObject({ include: [{ value: "client-1" }] });
    expect(after.session).toMatchObject({ include: [{ value: "session-1" }] });
    expect(after.kind).toMatchObject({ include: [{ value: "ITEM-UPDATE" }] });
    expect(after.provenance).toMatchObject({ include: [{ value: "SERVER" }] });
    runtime.dispose();
  });
});
