import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { typedFacetValue, type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(id: string, sequence: number, key: string, client = "client-1"): LightstreamerEventEnvelope {
  return {
    id, timestamp: sequence, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id, sessionId: "session-1" }, subscription: { id: "subscription-1", mode: "COMMAND" },
    item: { name: "item-1" }, update: { isSnapshot: false, key, fields: { value: sequence } }
  };
}

function filter(criteria: EvidenceFilter["criteria"] = {}): EvidenceFilter {
  return { revision: 1, text: "", criteria, around: null, unsupported: [] };
}

describe("filter-impl-05 memory facet discovery", () => {
  it("omits both polarities on the requested facet while retaining other criteria", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-counterfactual" });
    await history.offer(event("a", 1, "A")).settled;
    await history.offer(event("b", 2, "B")).settled;
    await history.offer(event("c", 3, "A", "client-2")).settled;
    const requested = typedFacetValue("key", "string", "A");
    const result = await history.query!({
      at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...filter({
        key: { include: [requested], exclude: [] },
        mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] }
      }), around: { intervalId: history.status().interval.id, start: 0, end: 3 } },
      discover: [{ facet: "key", size: 10 }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({ matching: 2, inScope: 1 });
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 2, baseEvidenceCount: 2 });
    expect(result.value.discoveries.get("key")?.values.map((entry) => [entry.value.value, entry.count])).toEqual([["A", 1], ["B", 1]]);
  });

  it("returns an exact bounded continuation with a request-bound cursor", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-cursor" });
    for (const [index, key] of ["C", "A", "B"].entries()) await history.offer(event(key, index + 1, key)).settled;
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: filter(), discover: [{ facet: "key", size: 1 }] };
    const first = await history.query!(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const discovery = first.value.discoveries.get("key");
    expect(discovery?.values[0]?.value.value).toBe("A");
    expect(discovery?.nextCursor).toBeTruthy();
    const second = await history.query!({ ...request, discover: [{ facet: "key", size: 1, cursor: discovery?.nextCursor }] });
    expect(second.ok && second.value.discoveries.get("key")?.values[0]?.value.value).toBe("B");
    const stale = await history.query!({ ...request, discover: [{ facet: "key", size: 1, cursor: discovery?.nextCursor }], filter: { ...filter(), text: "different" } });
    expect(stale.ok && stale.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
  });
});
