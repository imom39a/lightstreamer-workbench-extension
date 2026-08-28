import { describe, expect, it } from "vitest";
import { createFilter } from "../src/core/filter-algebra";
import { rebuildActivityProjection, type ActivityEvidence } from "../src/core/activity-projection";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function evidence(
  sequence: number,
  timestamp: number,
  overrides: Partial<LightstreamerEventEnvelope> = {}
): ActivityEvidence {
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

function readPoint(entries: readonly ActivityEvidence[]) {
  return {
    intervalId: "interval-1",
    committedEvidenceBoundary: entries.length
      ? { intervalId: "interval-1", sequence: entries.at(-1)!.sequence, eventId: entries.at(-1)!.event.id }
      : null,
    retainedRange: entries.length
      ? { first: { timestamp: entries[0]!.event.timestamp, sequence: entries[0]!.sequence }, last: { timestamp: entries.at(-1)!.event.timestamp, sequence: entries.at(-1)!.sequence } }
      : null,
    coverage: "USEFUL" as const,
    terminal: false
  };
}

describe("compact Activity timeline exact anchors", () => {
  it("keeps low-density source points and coincident marker identities exact while classifying topology session transitions first", () => {
    const entries = [
      evidence(1, 1_000),
      evidence(2, 1_000, { id: "local-2", source: "synthetic", synthetic: true, logicalEventId: "local-2" }),
      evidence(3, 2_000, {
        kind: "client-status",
        client: { id: "client-1", sessionId: "session-1", status: "DISCONNECTED" },
        topology: {
          version: 1,
          kind: "session-absent",
          pageEpoch: "page-1",
          captureSequence: 3,
          provenance: { instrumentationSource: "official-public-api" },
          coverage: { status: "complete", getters: {} },
          client: { id: "client-1", sessionId: { state: "real", value: "session-1" }, status: "DISCONNECTED" }
        }
      }),
      evidence(4, 2_000, { id: "lost-4", kind: "lost-updates", update: { lostUpdates: 4 } }),
      evidence(5, 2_000, { id: "error-5", kind: "subscription-error", raw: { code: 17, message: "bad selector" } }),
      evidence(6, 3_000, { id: "other-subscription", subscription: { id: "subscription-2" } })
    ];

    const projection = rebuildActivityProjection({
      evidence: entries,
      scope: { kind: "SUBSCRIPTION", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" },
      filter: createFilter(1),
      readPoint: readPoint(entries)
    });

    expect(projection.timeline.sourcePoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "event-1", intervalId: "interval-1", sequence: 1, timestamp: 1_000, source: "SERVER", kind: "ITEM_UPDATE" }),
      expect.objectContaining({ eventId: "local-2", intervalId: "interval-1", sequence: 2, timestamp: 1_000, source: "LOCAL", kind: "ITEM_UPDATE" })
    ]));
    expect(projection.timeline.sourcePoints.map((point) => point.eventId)).not.toContain("other-subscription");
    expect(projection.timeline.markers.map((marker) => [marker.eventId, marker.sequence, marker.timestamp, marker.kind])).toEqual([
      ["event-3", 3, 2_000, "SESSION_TRANSITION"],
      ["lost-4", 4, 2_000, "LOST_UPDATES"],
      ["error-5", 5, 2_000, "SUBSCRIPTION_ERROR"]
    ]);
  });

  it("bounds exact anchors and exposes overflow through the current filtered Evidence route", () => {
    const entries = Array.from({ length: 120 }, (_, index) => [
      evidence(index * 2 + 1, (index + 1) * 1_000),
      evidence(index * 2 + 2, (index + 1) * 1_000, { id: `local-${index + 1}`, source: "synthetic", synthetic: true, logicalEventId: `local-${index + 1}` })
    ]).flat();
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.timeline.sourcePoints).toHaveLength(128);
    expect(projection.timeline.sourcePointsOverflow).toEqual({ omitted: 112, evidenceRoute: "CURRENT_FILTERED_EVIDENCE" });
  });

  it("keeps nearby LOCAL injection identities exact before low-density SERVER points", () => {
    const entries = [
      evidence(1, 1_000),
      evidence(2, 1_000, { id: "local-2", source: "synthetic", synthetic: true, logicalEventId: "local-2" }),
      evidence(3, 1_001, { id: "local-3", source: "synthetic", synthetic: true, logicalEventId: "local-3" }),
      evidence(4, 1_002, { id: "local-4", source: "synthetic", synthetic: true, logicalEventId: "local-4" })
    ];
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.buckets[0]).toMatchObject({ localLogicalUpdates: 3 });
    expect(projection.timeline.sourcePoints.filter((point) => point.source === "LOCAL").map((point) => point.eventId)).toEqual(["local-2", "local-3", "local-4"]);
  });

  it("bounds captured marker identities and exposes their overflow through current filtered Evidence", () => {
    const entries = Array.from({ length: 130 }, (_, index) => evidence(index + 1, index + 1, {
      kind: "client-status",
      client: { id: "client-1", sessionId: "session-1", status: "CONNECTED" }
    }));
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });

    expect(projection.timeline.markers).toHaveLength(128);
    expect(projection.timeline.markersOverflow).toEqual({ omitted: 2, evidenceRoute: "CURRENT_FILTERED_EVIDENCE" });
  });

  it("projects 100k dense retained updates into bounded timeline geometry and anchors", () => {
    const entries = Array.from({ length: 100_000 }, (_, index) => {
      const entry = evidence(index + 1, index + 1);
      return {
        ...entry,
        filterRecord: { timestamp: entry.event.timestamp, intervalId: entry.intervalId, searchText: "", facets: {} }
      };
    });
    const startedAt = performance.now();
    const projection = rebuildActivityProjection({ evidence: entries, scope: { kind: "PAGE" }, filter: createFilter(1), readPoint: readPoint(entries) });
    const elapsedMs = performance.now() - startedAt;

    expect(projection.logicalUpdateTotal).toBe(100_000);
    expect(projection.buckets.length).toBeLessThanOrEqual(120);
    expect(projection.timeline.sourcePoints).toEqual([
      expect.objectContaining({ eventId: "event-100000", sequence: 100_000, source: "SERVER" })
    ]);
    expect(projection.timeline.markers).toHaveLength(0);
    expect(projection.timeline.matchingRange).toEqual({ start: 1, end: 100_001 });
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
