import { describe, expect, it } from "vitest";
import { createFilter } from "../src/core/filter-algebra";
import { rebuildActivityProjection, type ActivityEvidence } from "../src/core/activity-projection";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

function evidence(sequence: number, bandwidth: number): ActivityEvidence {
  const event: LightstreamerEventEnvelope = {
    id: `fact-${sequence}`,
    timestamp: sequence * 1_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    logicalEventId: `fact-logical-${sequence}`,
    client: { id: "client-1", sessionId: "session-1", requestedMaxBandwidth: bandwidth },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: "item-1", position: 1 },
    update: {}
  };
  return { intervalId: "summary-interval", sequence, event };
}

function readPoint(entries: readonly ActivityEvidence[]) {
  return {
    intervalId: "summary-interval",
    committedEvidenceBoundary: { intervalId: "summary-interval", sequence: entries.at(-1)!.sequence, eventId: entries.at(-1)!.event.id },
    retainedRange: { first: { timestamp: entries[0]!.event.timestamp, sequence: entries[0]!.sequence }, last: { timestamp: entries.at(-1)!.event.timestamp, sequence: entries.at(-1)!.sequence } },
    coverage: "USEFUL" as const,
    terminal: false
  };
}

describe("Activity Context summary projection", () => {
  it("qualifies delivery Evidence that cannot establish a Logical Update identity", () => {
    const identified = evidence(1, 10);
    const unknownLive = {
      ...evidence(2, 10),
      event: { ...evidence(2, 10).event, logicalEventId: undefined, listener: { id: "listener-2", metricOwner: false } }
    };
    const entries = [identified, unknownLive];
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.logicalUpdateTotal).toBe(1);
    expect(projection.snapshotLogicalUpdateTotal).toBe(0);
    expect(projection.liveLogicalUpdateTotal).toBe(1);
    expect(projection.logicalUpdateIdentity.server).toEqual({
      unidentifiedDeliveries: 1,
      unidentifiedSnapshotDeliveries: 0,
      unidentifiedLiveDeliveries: 1
    });
  });

  it("keeps a true zero distinct from an unavailable Logical Update identity", () => {
    const status = {
      ...evidence(1, 10),
      event: { ...evidence(1, 10).event, kind: "client-status" as const, logicalEventId: undefined, update: undefined }
    };
    const projection = rebuildActivityProjection({ evidence: [status], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([status]) });

    expect(projection.logicalUpdateTotal).toBe(0);
    expect(projection.logicalUpdateIdentity.server).toEqual({
      unidentifiedDeliveries: 0,
      unidentifiedSnapshotDeliveries: 0,
      unidentifiedLiveDeliveries: 0
    });
  });

  it("keeps a normal identified server workload exact", () => {
    const entries = Array.from({ length: 1_692 }, (_, index) => evidence(index + 1, index + 1));
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.logicalUpdateTotal).toBe(1_692);
    expect(projection.logicalUpdateIdentity.server).toEqual({
      unidentifiedDeliveries: 0,
      unidentifiedSnapshotDeliveries: 0,
      unidentifiedLiveDeliveries: 0
    });
  });

  it("keeps captured distinct values at their first observed occurrence, while retaining all numeric transitions", () => {
    const entries = [evidence(1, 10), evidence(2, 5), evidence(3, 10)];
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });
    const bandwidth = projection.contextFacts.find((fact) => fact.key === "REQUESTED_MAX_BANDWIDTH");

    expect(bandwidth?.values).toEqual([
      { value: "10", timestamp: 1_000 },
      { value: "5", timestamp: 2_000 }
    ]);
    expect(bandwidth?.plotValues).toEqual([
      { value: 10, timestamp: 1_000 },
      { value: 5, timestamp: 2_000 },
      { value: 10, timestamp: 3_000 }
    ]);
  });

  it("makes ITEM and LISTENER Context summaries explicitly unavailable", () => {
    const entries = [evidence(1, 10)];
    for (const scope of [
      { kind: "ITEM" as const, clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1", item: "item-1", itemPosition: 1 },
      { kind: "LISTENER" as const, listenerId: "listener-1" }
    ]) {
      const projection = rebuildActivityProjection({ evidence: entries, scope, filter: createFilter(1), readPoint: readPoint(entries) });
      expect(projection.state).toBe("UNAVAILABLE");
      expect(projection.reason).toContain("does not support");
      expect(projection.contextFacts).toEqual([]);
      expect(projection.allRankings).toEqual([]);
    }
  });

  it("keeps Subscription-scope ranking actions constrained to SERVER item updates and an item identity", () => {
    const entries = [evidence(1, 10)];
    const projection = rebuildActivityProjection({
      evidence: entries,
      scope: { kind: "SUBSCRIPTION", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" },
      filter: createFilter(1),
      readPoint: readPoint(entries)
    });
    const ranking = projection.allRankings[0]!;

    expect(ranking.supportingFilterMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "add-criterion", facet: "kind", value: expect.objectContaining({ value: "ITEM-UPDATE" }) }),
      expect.objectContaining({ type: "add-criterion", facet: "provenance", value: expect.objectContaining({ value: "SERVER" }) }),
      expect.objectContaining({ type: "add-criterion", facet: "item", value: expect.objectContaining({ value: JSON.stringify(["item-1", 1]) }) })
    ]));
  });

  it("keeps reused Subscription identifiers separated by their captured client and session identity", () => {
    const first = evidence(1, 10);
    const second = {
      ...evidence(2, 10),
      event: {
      ...evidence(2, 10).event,
      client: { id: "client-2", sessionId: "session-2" },
      subscription: { id: "subscription-1", mode: "MERGE" }
      }
    };
    const entries = [first, second];
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.allRankings).toHaveLength(2);
    expect(new Set(projection.allRankings.map(({ identity }) => identity)).size).toBe(2);
    expect(projection.allRankings.map(({ logicalUpdates }) => logicalUpdates)).toEqual([1, 1]);
    expect(projection.allRankings.map((ranking) => ranking.supportingFilterMutations?.find((mutation) => mutation.type === "add-criterion" && mutation.facet === "client" && mutation.value.value === "client-2"))).toContainEqual(expect.objectContaining({ facet: "client" }));
  });
});
