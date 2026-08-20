import { describe, expect, it } from "vitest";

import {
  filterQueryExpectedSequences,
  filterQueryOperationTelemetry,
  heapWorkloadShapes
} from "../benchmarks/event-history-performance-harness";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";

describe("filter-impl-08 performance follow-up", () => {
  it("derives structured and find expectations from the adapter fixture count", () => {
    expect(filterQueryExpectedSequences(5_000)).toEqual([1, 3_843]);
    expect(filterQueryExpectedSequences(10_000)).toEqual([1, 3_843, 7_685]);
  });

  it("uses bounded operation-specific IndexedDB telemetry for find and lookup", () => {
    const find = filterQueryOperationTelemetry({
      telemetry: {
        candidateBound: 0,
        evidenceCursorReads: 512,
        payloadHydrations: 0,
        residualScan: false,
        findCursorBound: 3,
        findCursorReads: 3,
        fullRetainedScan: false
      }
    }, "find", "indexeddb");
    const lookup = filterQueryOperationTelemetry({
      telemetry: {
        candidateBound: 50,
        evidenceCursorReads: 50,
        payloadHydrations: 1,
        residualScan: false,
        lookupPayloadHydrations: 1
      }
    }, "lookup", "indexeddb");

    expect(find).toMatchObject({ candidateBound: 3, projectionReads: 3, payloadHydrations: 0, bounded: true, residualScan: false });
    expect(lookup).toMatchObject({ candidateBound: 1, projectionReads: 0, payloadHydrations: 1, bounded: true, residualScan: false });
  });

  it("rejects missing memory telemetry instead of fabricating bounded work", () => {
    expect(() => filterQueryOperationTelemetry({ telemetry: undefined }, "recent50", "memory"))
      .toThrow(/did not expose bounded telemetry/u);
  });

  it("reports real bounded memory query telemetry from commit-time indexes", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: `filter-impl-08-memory-index-${Date.now()}` });
    try {
      const events = [0, 1, 2].map((index) => createEventHistoryWorkloadEvent("ordinary-item-update", index, "memory-index"));
      await Promise.all(events.map((event) => history.offer(event).settled));
      const result = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "NEWEST_FIRST", size: 2 },
        filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.telemetry).toMatchObject({ candidateBound: 2, projectionReads: 2, fullRetainedScan: false, residualScan: false });
        expect(filterQueryOperationTelemetry({ result, telemetry: result.value.telemetry }, "recent50", "memory"))
          .toMatchObject({ candidateBound: 2, projectionReads: 2, bounded: true, residualScan: false });
      }
    } finally {
      await history.close();
    }
  });

  it("keeps the large JSON fixture out of the IndexedDB retained-heap probe", () => {
    expect(heapWorkloadShapes("indexeddb")).toEqual(["small-lifecycle"]);
    expect(heapWorkloadShapes("indexeddb")).not.toContain("large-json-rich");
    expect(heapWorkloadShapes("memory")).toEqual(["small-lifecycle", "ordinary-item-update"]);
  });
});
