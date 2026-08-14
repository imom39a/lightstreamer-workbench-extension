import { describe, expect, it } from "vitest";
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
import {
  appendActivityEvidence,
  matchesActivityEvidence,
  rebuildActivityProjection,
  sortActivityRankings,
  type ActivityEvidence
} from "../src/core/activity-projection";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function evidence(sequence: number, timestamp: number, overrides: Partial<LightstreamerEventEnvelope> = {}): ActivityEvidence {
  return {
    intervalId: "interval-1",
    sequence,
    event: {
      id: `event-${sequence}`,
      timestamp,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      logicalEventId: `logical-${sequence}`,
      client: { id: "client-1", sessionId: "session-1" },
      subscription: { id: "subscription-1" },
      item: { name: "item-1", position: 1 },
      update: { isSnapshot: false },
      ...overrides
    }
  };
}

function readPoint(evidence: readonly ActivityEvidence[]) {
  return {
    intervalId: "interval-1",
    committedEvidenceBoundary: evidence.length ? { intervalId: "interval-1", sequence: evidence.at(-1)!.sequence, eventId: evidence.at(-1)!.event.id } : null,
    retainedRange: evidence.length ? { first: { timestamp: evidence[0].event.timestamp, sequence: evidence[0].sequence }, last: { timestamp: evidence.at(-1)!.event.timestamp, sequence: evidence.at(-1)!.sequence } } : null,
    coverage: "USEFUL" as const,
    terminal: false
  };
}

describe("Observed Activity projection", () => {
  it("counts accepted server logical updates once and exposes deterministic buckets", () => {
    const input = {
      evidence: [evidence(1, 1_000), evidence(2, 2_000), evidence(3, 2_500)],
      scope: { kind: "PAGE" as const },
      filter: createFilter(1),
      readPoint: readPoint([evidence(1, 1_000), evidence(2, 2_000), evidence(3, 2_500)])
    };
    const projection = rebuildActivityProjection(input);

    expect(projection.state).toBe("AVAILABLE");
    expect(projection.logicalUpdateTotal).toBe(3);
    expect(projection.buckets.length).toBeLessThanOrEqual(120);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.logicalUpdates, 0)).toBe(3);
    expect(projection.buckets[0]).toMatchObject({ firstPartial: false });
  });

  it("chooses duration and empty leading/trailing buckets from the retained span", () => {
    const entries = [evidence(1, 10_000), evidence(2, 11_000)];
    const projection = rebuildActivityProjection({
      evidence: entries,
      scope: { kind: "PAGE" },
      filter: createFilter(1),
      readPoint: {
        ...readPoint(entries),
        retainedRange: { first: { timestamp: 2_500, sequence: 0 }, last: { timestamp: 260_000, sequence: 99 } }
      }
    });

    expect(projection.bucketDuration).toBe(5_000);
    expect(projection.buckets.length).toBe(53);
    expect(projection.buckets[0]).toMatchObject({ logicalUpdates: 0, firstPartial: true });
    expect(projection.buckets.some((bucket) => bucket.logicalUpdates === 2)).toBe(true);
    expect(projection.buckets.at(-1)).toMatchObject({ logicalUpdates: 0, finalPartial: true, currentPartial: true });
  });

  it("keeps rebuild and incremental acceptance externally equivalent", () => {
    const first = evidence(1, 1_000);
    const second = evidence(2, 65_000);
    const input = { evidence: [first], scope: { kind: "PAGE" as const }, filter: createFilter(1), readPoint: readPoint([first]) };

    expect(appendActivityEvidence(input, [second], readPoint([first, second]))).toEqual(
      rebuildActivityProjection({ ...input, evidence: [first, second], readPoint: readPoint([first, second]) })
    );
  });

  it("keeps the current bucket identity stable while its count grows", () => {
    const first = evidence(1, 1_000);
    const grown = evidence(2, 1_500);
    const initial = rebuildActivityProjection({ evidence: [first], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([first]) });
    const afterGrowth = rebuildActivityProjection({ evidence: [first, grown], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([first, grown]) });

    expect(afterGrowth.buckets.find((bucket) => bucket.id === initial.buckets[0].id)).toMatchObject({
      start: initial.buckets[0].start,
      end: initial.buckets[0].end,
      logicalUpdates: 2
    });
  });

  it("rebuckets deterministically while retaining the selected absolute interval as an overlay", () => {
    const first = evidence(1, 1_000);
    const second = evidence(2, 2_000);
    const far = evidence(3, 200_000);
    const initial = rebuildActivityProjection({ evidence: [first, second], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([first, second]) });
    const rebucketed = rebuildActivityProjection({ evidence: [first, second, far], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([first, second, far]) });

    expect(initial.bucketDuration).toBe(1_000);
    expect(rebucketed.bucketDuration).toBe(2_000);
    expect(rebucketed.buckets[0]).toMatchObject({ start: 0, end: 2_000, logicalUpdates: 1 });
    expect(rebucketed.buckets.at(-1)).toMatchObject({ start: 200_000, end: 202_000, logicalUpdates: 1 });
  });

  it("applies structural scope and canonical filter before aggregation", () => {
    const filter = createFilter(2);
    const localOnly = createTypedFilterValue("provenance", "enum", "LOCAL");
    const scoped = rebuildActivityProjection({
      evidence: [
        evidence(1, 1_000, { subscription: { id: "subscription-1" } }),
        evidence(2, 2_000, { subscription: { id: "subscription-2" } }),
        evidence(3, 3_000, { source: "synthetic", synthetic: true })
      ],
      scope: { kind: "SUBSCRIPTION", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" },
      filter: { ...filter, criteria: { provenance: { include: [localOnly], exclude: [] } } },
      readPoint: readPoint([evidence(1, 1_000), evidence(2, 2_000), evidence(3, 3_000)])
    });

    expect(scoped.state).toBe("EMPTY_MATCH");
    expect(scoped.logicalUpdateTotal).toBe(0);
    expect(scoped.matchingEvidence).toBe(1);
  });

  it("matches newer Evidence against the active Scope, Filter, and provenance", () => {
    const local = evidence(3, 3_000, { source: "synthetic", synthetic: true });
    const serverOtherSubscription = evidence(4, 4_000, { subscription: { id: "subscription-2" } });
    const server = evidence(5, 5_000);
    const filter = {
      ...createFilter(2),
      criteria: {
        provenance: {
          include: [createTypedFilterValue("provenance", "enum", "SERVER")],
          exclude: []
        }
      }
    };
    const scope = { kind: "SUBSCRIPTION" as const, subscriptionId: "subscription-1" };

    expect([local, serverOtherSubscription, server].filter((entry) => matchesActivityEvidence(entry, filter, scope))).toEqual([server]);
  });

  it("retains evidence order and marks backward captured timestamps as discontinuities", () => {
    const projection = rebuildActivityProjection({
      evidence: [evidence(1, 5_000), evidence(2, 4_000)],
      scope: { kind: "PAGE" },
      filter: createFilter(1),
      readPoint: readPoint([evidence(1, 5_000), evidence(2, 4_000)])
    });

    expect(projection.logicalUpdateTotal).toBe(2);
    expect(projection.clockSegments).toHaveLength(2);
    expect(projection.clockSegments[1]).toMatchObject({ startSequence: 2, startTimestamp: 4_000 });
    expect(projection.committedEvidenceBoundary?.sequence).toBe(2);
  });

  it("keeps clock-regressed evidence in separate bucket segments", () => {
    const entries = [evidence(1, 10_000), evidence(2, 11_000), evidence(3, 1_000), evidence(4, 2_000)];
    const projection = rebuildActivityProjection({
      evidence: entries,
      scope: { kind: "PAGE" },
      filter: createFilter(1),
      readPoint: {
        ...readPoint(entries),
        retainedRange: { first: { timestamp: 1_000, sequence: 3 }, last: { timestamp: 11_000, sequence: 2 } }
      }
    });

    expect(projection.clockSegments).toHaveLength(2);
    expect(projection.buckets.filter((bucket) => bucket.segment === 0).reduce((n, bucket) => n + bucket.logicalUpdates, 0)).toBe(2);
    expect(projection.buckets.filter((bucket) => bucket.segment === 1).reduce((n, bucket) => n + bucket.logicalUpdates, 0)).toBe(2);
  });

  it("separates logical identity, metric-owner fallback, deliveries, phase, and provenance", () => {
    const first = evidence(1, 1_000, { logicalEventId: "same", update: { isSnapshot: true } });
    const callback = evidence(2, 1_000, { logicalEventId: "same", listener: { id: "listener-1" } });
    const owner = evidence(3, 2_000, { logicalEventId: undefined, listener: { id: "owner", metricOwner: true } });
    const local = evidence(4, 3_000, { source: "synthetic", synthetic: true, logicalEventId: "local" });
    const projection = rebuildActivityProjection({ evidence: [first, callback, owner, local], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([first, callback, owner, local]) });

    expect(projection.logicalUpdateTotal).toBe(2);
    expect(projection.snapshotLogicalUpdateTotal).toBe(1);
    expect(projection.liveLogicalUpdateTotal).toBe(1);
    expect(projection.updateDeliveryTotal).toBe(2);
    expect(projection.localLogicalUpdateTotal).toBe(1);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.localLogicalUpdates, 0)).toBe(1);
  });

  it("does not infer a boundary and rejects unsupported structural scopes", () => {
    const event = evidence(1, 1_000);
    const noBoundary = rebuildActivityProjection({ evidence: [event], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: { ...readPoint([event]), committedEvidenceBoundary: null } });
    const unsupported = rebuildActivityProjection({ evidence: [event], scope: { kind: "ITEM", subscriptionId: "subscription-1", item: "item-1" }, filter: createFilter(1), readPoint: readPoint([event]) });

    expect(noBoundary.state).toBe("EMPTY_INTERVAL");
    expect(noBoundary.logicalUpdateTotal).toBe(0);
    expect(unsupported.state).toBe("UNAVAILABLE");
    expect(unsupported.reason).toContain("ITEM");
  });

  it("keeps exactness and bounded presentation at the retained 10,000-record workload", () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => workloadEvidence(index + 1));
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.matchingEvidence).toBe(10_000);
    expect(projection.logicalUpdateTotal).toBe(10_000);
    expect(projection.updateDeliveryTotal).toBe(10_000);
    expect(projection.buckets.length).toBeLessThanOrEqual(120);
    expect(projection.rankings.length).toBeLessThanOrEqual(10);
    expect(projection.rankingOther).toMatchObject({ label: "Other" });
  });

  it("keeps degraded coverage distinct from an empty matching result and preserves marker identity", () => {
    const event = evidence(1, 1_000, {
      kind: "subscription-error",
      client: { id: "client-7", sessionId: "session-9", status: "CONNECTED" },
      subscription: { id: "subscription-4" },
      raw: { code: 17, message: "bad selector" }
    });
    const projection = rebuildActivityProjection({
      evidence: [event],
      scope: { kind: "PAGE" },
      filter: createFilter(1),
      readPoint: { ...readPoint([event]), coverage: "LIMITED" }
    });

    expect(projection.state).toBe("EMPTY_MATCH");
    expect(projection.reason).toContain("limited");
    expect(projection.markers[0]).toMatchObject({
      kind: "SUBSCRIPTION_ERROR",
      clientId: "client-7",
      sessionId: "session-9",
      subscriptionId: "subscription-4",
      errorCode: 17,
      errorMessage: "bad selector"
    });
  });

  it("distinguishes terminal completion from aggregation failure", () => {
    const event = evidence(1, 1_000);
    const terminal = rebuildActivityProjection({ evidence: [event], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: { ...readPoint([event]), terminal: true } });
    const failed = rebuildActivityProjection({ evidence: [event], scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint([event]), aggregate: () => { throw new Error("bucket failure"); } });

    expect(terminal.state).toBe("LIMITED");
    expect(terminal.reason).toContain("complete through the terminal");
    expect(failed.state).toBe("AGGREGATION_FAILED");
    expect(failed.reason).toBe("bucket failure");
  });

  it("sorts ranking rows by either exact metric with stable identity ties", () => {
    const rankings = [
      { identity: "b", label: "b", logicalUpdates: 2, updateDeliveries: 9 },
      { identity: "a", label: "a", logicalUpdates: 2, updateDeliveries: 9 },
      { identity: "c", label: "c", logicalUpdates: 1, updateDeliveries: 10 }
    ];

    expect(sortActivityRankings(rankings, "LOGICAL_UPDATES").map(({ identity }) => identity)).toEqual(["a", "b", "c"]);
    expect(sortActivityRankings(rankings, "UPDATE_DELIVERIES").map(({ identity }) => identity)).toEqual(["c", "a", "b"]);
  });
});

function workloadEvidence(sequence: number): ActivityEvidence {
  return evidence(sequence, 1_000 + sequence * 250, { logicalEventId: `logical-${sequence}`, listener: { id: `listener-${sequence % 4}` }, subscription: { id: `subscription-${sequence % 25}` } });
}
