import { describe, expect, it } from "vitest";
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
import {
  createActivityAccumulator,
  rebuildActivityProjection,
  type ActivityProjectionInput
} from "../src/core/activity-projection";
import {
  ACTIVITY_CAPACITY_BASE_TIMESTAMP,
  ACTIVITY_CAPACITY_RECORD_COUNT,
  createActivityCapacityCompoundFilter,
  createActivityCapacityReadPoint,
  createActivityCapacityWorkload,
  reduceActivityCapacity
} from "./support/activity-capacity-fixture";

const workload = createActivityCapacityWorkload();

function input(overrides: Partial<ActivityProjectionInput> = {}): ActivityProjectionInput {
  return {
    evidence: workload.evidence,
    scope: workload.scope,
    filter: workload.filter,
    readPoint: workload.readPoint,
    ...overrides
  };
}

function bucketSummary(projection: ReturnType<typeof rebuildActivityProjection>) {
  return projection.buckets.map(({ segment, start, end, logicalUpdates, snapshotLogicalUpdates, liveLogicalUpdates, updateDeliveries, localLogicalUpdates, localUpdateDeliveries }) => ({
    segment, start, end, logicalUpdates, snapshotLogicalUpdates, liveLogicalUpdates, updateDeliveries, localLogicalUpdates, localUpdateDeliveries
  }));
}

function segmentLogicalTotals(buckets: readonly { segment: number; logicalUpdates: number }[]) {
  return [...new Set(buckets.map(({ segment }) => segment))].sort((left, right) => left - right).map((segment) => ({
    segment,
    logicalUpdates: buckets.filter((bucket) => bucket.segment === segment).reduce((total, bucket) => total + bucket.logicalUpdates, 0)
  }));
}

describe("Activity exact 10,000-record capacity workload", () => {
  it("keeps independent totals exact while bounding buckets, rankings, and connection lanes", () => {
    expect(workload.evidence).toHaveLength(ACTIVITY_CAPACITY_RECORD_COUNT);
    expect(new Set(workload.evidence.map(({ sequence }) => sequence)).size).toBe(ACTIVITY_CAPACITY_RECORD_COUNT);

    const projection = rebuildActivityProjection(input());
    const oracle = reduceActivityCapacity(workload.evidence, workload.scope, workload.filter, workload.readPoint, projection.bucketDuration);

    expect({
      matchingEvidence: projection.matchingEvidence,
      logicalUpdates: projection.logicalUpdateTotal,
      snapshotLogicalUpdates: projection.snapshotLogicalUpdateTotal,
      liveLogicalUpdates: projection.liveLogicalUpdateTotal,
      updateDeliveries: projection.updateDeliveryTotal,
      localLogicalUpdates: projection.localLogicalUpdateTotal,
      localUpdateDeliveries: projection.localUpdateDeliveryTotal
    }).toEqual({
      matchingEvidence: 10_000,
      logicalUpdates: 8_400,
      snapshotLogicalUpdates: 2_000,
      liveLogicalUpdates: 6_400,
      updateDeliveries: 7_600,
      localLogicalUpdates: 240,
      localUpdateDeliveries: 240
    });
    expect({
      matchingEvidence: projection.matchingEvidence,
      logicalUpdates: projection.logicalUpdateTotal,
      snapshotLogicalUpdates: projection.snapshotLogicalUpdateTotal,
      liveLogicalUpdates: projection.liveLogicalUpdateTotal,
      updateDeliveries: projection.updateDeliveryTotal,
      localLogicalUpdates: projection.localLogicalUpdateTotal,
      localUpdateDeliveries: projection.localUpdateDeliveryTotal
    }).toEqual({
      matchingEvidence: oracle.matchingEvidence,
      logicalUpdates: oracle.logicalUpdates,
      snapshotLogicalUpdates: oracle.snapshotLogicalUpdates,
      liveLogicalUpdates: oracle.liveLogicalUpdates,
      updateDeliveries: oracle.updateDeliveries,
      localLogicalUpdates: oracle.localLogicalUpdates,
      localUpdateDeliveries: oracle.localUpdateDeliveries
    });

    expect(projection.buckets.length).toBeLessThanOrEqual(120);
    expect(projection.buckets.length).toBeGreaterThan(0);
    expect(bucketSummary(projection)).toEqual(oracle.buckets);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.logicalUpdates, 0)).toBe(oracle.logicalUpdates);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.updateDeliveries, 0)).toBe(oracle.updateDeliveries);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.localLogicalUpdates, 0)).toBe(oracle.localLogicalUpdates);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.localUpdateDeliveries, 0)).toBe(192);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.localUpdateDeliveries, 0)).toBe(oracle.buckets.reduce((total, bucket) => total + bucket.localUpdateDeliveries, 0));

    expect(projection.rankings).toHaveLength(10);
    expect(projection.allRankings).toHaveLength(24);
    expect(projection.rankingOther).toMatchObject({ label: "Other", logicalUpdates: oracle.otherRankingLogicalUpdates, updateDeliveries: oracle.otherRankingDeliveryCount });
    expect(projection.rankings.reduce((total, ranking) => total + ranking.logicalUpdates, 0)).toBe(oracle.topRankingLogicalUpdates);
    expect(projection.rankings.reduce((total, ranking) => total + ranking.updateDeliveries, 0)).toBe(oracle.topRankingDeliveryCount);

    expect(projection.markers.filter(({ kind }) => kind === "CLIENT_STATUS")).toHaveLength(100);
    expect(projection.markers.filter(({ kind }) => kind === "LOST_UPDATES")).toHaveLength(100);
    expect(projection.markers.filter(({ kind }) => kind === "SUBSCRIPTION_ERROR")).toHaveLength(100);
    expect(projection.connectionLanes).toHaveLength(4);
    expect(projection.connectionLanes.reduce((total, lane) => total + lane.sessions.length, 0)).toBe(8);
    expect(projection.connectionOverflow).toBeNull();
    expect(projection.committedEvidenceBoundary).toMatchObject({ sequence: 10_000 });
    expect(oracle.clientIds).toEqual(["client-1", "client-2", "client-3", "client-4"]);
    expect(oracle.sessionIds).toHaveLength(8);
    expect(oracle.markerCounts).toEqual({ "client-status": 100, "lost-updates": 100, "subscription-error": 100 });
  });

  it("keeps rebuild and bounded incremental acceptance equivalent for the full workload", () => {
    const split = 9_999;
    const prefix = workload.evidence.slice(0, split);
    const prefixReadPoint = createActivityCapacityReadPoint(prefix);
    const accumulator = createActivityAccumulator({ ...input(), evidence: prefix, readPoint: prefixReadPoint });
    const incremental = accumulator.append(workload.evidence[split]!, workload.readPoint);

    const rebuilt = rebuildActivityProjection(input());
    expect(incremental).toEqual(rebuilt);
    expect(incremental.buckets.length).toBeLessThanOrEqual(120);
    expect(incremental.logicalUpdateTotal).toBe(8_400);
    expect(incremental.updateDeliveryTotal).toBe(7_600);
  });

  it("keeps Client Scope, compound typed provenance, and exact around boundaries independent", () => {
    const around = { intervalId: workload.readPoint.intervalId, start: ACTIVITY_CAPACITY_BASE_TIMESTAMP + 10_000, end: ACTIVITY_CAPACITY_BASE_TIMESTAMP + 30_001 } as const;
    const scope = { kind: "CLIENT" as const, clientId: "client-2" };
    const filter = createActivityCapacityCompoundFilter(around);
    const projection = rebuildActivityProjection(input({ scope, filter }));
    const oracle = reduceActivityCapacity(workload.evidence, scope, filter, workload.readPoint, projection.bucketDuration);

    expect(filter.criteria.provenance?.include[0]).toMatchObject({ type: "enum", value: "SERVER" });
    expect(filter.criteria.kind?.include[0]).toMatchObject({ type: "enum", value: "ITEM-UPDATE" });
    expect(filter.around).toEqual(around);
    expect(oracle.matchingEvidence).toBeGreaterThan(0);
    expect(oracle.matchingEvidence).toBeLessThan(workload.evidence.length);
    expect(projection.matchingEvidence).toBe(oracle.matchingEvidence);
    expect(projection.logicalUpdateTotal).toBe(oracle.logicalUpdates);
    expect(projection.updateDeliveryTotal).toBe(oracle.updateDeliveries);
    expect(projection.localLogicalUpdateTotal).toBe(0);
    expect(projection.markers).toHaveLength(0);
    expect(projection.connectionLanes).toHaveLength(1);
    expect(projection.connectionLanes[0]?.clientId).toBe("client-2");
    expect(projection.connectionLanes[0]?.sessions).toHaveLength(2);
    expect(bucketSummary(projection)).toEqual(oracle.buckets);
    expect(projection.buckets.reduce((total, bucket) => total + bucket.logicalUpdates, 0)).toBe(oracle.logicalUpdates);
  });

  it("represents a frozen terminal boundary with a truncated prefix and exact totals", () => {
    const prefix = workload.evidence.slice(0, 9_750);
    const readPoint = createActivityCapacityReadPoint(prefix, { coverage: "LIMITED", terminal: true });
    const projection = rebuildActivityProjection(input({ evidence: prefix, readPoint }));
    const oracle = reduceActivityCapacity(prefix, workload.scope, workload.filter, readPoint, projection.bucketDuration);

    expect(readPoint.committedEvidenceBoundary).toMatchObject({ sequence: 9_750, eventId: "activity-capacity-event-09750" });
    expect(projection.state).toBe("LIMITED");
    expect(projection.matchingEvidence).toBe(9_750);
    expect(projection.logicalUpdateTotal).toBe(8_400);
    expect(projection.snapshotLogicalUpdateTotal).toBe(2_000);
    expect(projection.liveLogicalUpdateTotal).toBe(6_400);
    expect(projection.updateDeliveryTotal).toBe(7_600);
    expect(projection.localLogicalUpdateTotal).toBe(240);
    expect(projection.markers.filter(({ kind }) => kind === "LOST_UPDATES")).toHaveLength(50);
    expect(projection.markers.filter(({ kind }) => kind === "SUBSCRIPTION_ERROR")).toHaveLength(0);
    expect(projection.markers.filter(({ kind }) => kind === "CLIENT_STATUS")).toHaveLength(0);
    expect(projection.logicalUpdateTotal).toBe(oracle.logicalUpdates);
    expect(projection.updateDeliveryTotal).toBe(oracle.updateDeliveries);
    expect(bucketSummary(projection)).toEqual(oracle.buckets);
  });

  it("retains equal timestamps and backward timestamp boundaries as exact clock segments", () => {
    const projection = rebuildActivityProjection(input());
    const oracle = reduceActivityCapacity(workload.evidence, workload.scope, workload.filter, workload.readPoint, projection.bucketDuration);
    expect(projection.clockSegments).toHaveLength(2);
    expect(projection.clockSegments[1]).toMatchObject({ startSequence: 5_001, startTimestamp: ACTIVITY_CAPACITY_BASE_TIMESTAMP + 5_000 });
    expect(segmentLogicalTotals(projection.buckets)).toEqual(segmentLogicalTotals(oracle.buckets));
    expect(projection.logicalUpdateTotal).toBe(8_400);
    expect(projection.buckets.some(({ logicalUpdates }) => logicalUpdates > 1)).toBe(true);
  });

  it("accepts the production typed filter algebra shape without using it as the oracle", () => {
    const filter = {
      ...createFilter(2),
      criteria: {
        provenance: { include: [createTypedFilterValue("provenance", "enum", "SERVER")], exclude: [] }
      },
      around: { intervalId: workload.readPoint.intervalId, start: ACTIVITY_CAPACITY_BASE_TIMESTAMP, end: ACTIVITY_CAPACITY_BASE_TIMESTAMP + 1_000 }
    };
    expect(createTypedFilterValue("kind", "enum", "item-update").value).toBe("ITEM-UPDATE");
    const scope = { kind: "SESSION" as const, clientId: "client-1", sessionId: "client-1-session-1" };
    const projection = rebuildActivityProjection(input({ scope, filter }));
    const oracle = reduceActivityCapacity(workload.evidence, scope, filter, workload.readPoint, projection.bucketDuration);
    expect(projection.matchingEvidence).toBe(oracle.matchingEvidence);
    expect(projection.logicalUpdateTotal).toBe(oracle.logicalUpdates);
    expect(projection.updateDeliveryTotal).toBe(oracle.updateDeliveries);
  });
});
