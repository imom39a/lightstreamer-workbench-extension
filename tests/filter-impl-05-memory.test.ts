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
    const second = await history.query!({ ...request, discover: [{ facet: "key", size: 1, cursor: discovery?.nextCursor ?? undefined }] });
    expect(second.ok && second.value.discoveries.get("key")?.values[0]?.value.value).toBe("B");
    const stale = await history.query!({ ...request, discover: [{ facet: "key", size: 1, cursor: discovery?.nextCursor ?? undefined }], filter: { ...filter(), text: "different" } });
    expect(stale.ok && stale.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
  });

  it("searches labels, pins an active retired value, and distinguishes empty states", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-states" });
    await history.offer(event("one", 1, "alpha")).settled;
    const activeRetired = typedFacetValue("key", "string", "retired", "Retired key");
    const base = { ...filter({ key: { include: [activeRetired], exclude: [] } }) };
    const pinned = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: base, discover: [{ facet: "key", size: 10 }] });
    expect(pinned.ok && pinned.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 1 });
    expect(pinned.ok && pinned.value.discoveries.get("key")?.values.find((entry) => entry.value.identity === activeRetired.identity)).toMatchObject({ count: 0, pinned: true });

    const searched = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "key", search: "ALP", size: 10 }] });
    expect(searched.ok && searched.value.discoveries.get("key")?.values.map((entry) => entry.value.label)).toEqual(["alpha"]);

    const zeroBase = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...filter(), text: "missing" }, discover: [{ facet: "key", size: 10 }] });
    expect(zeroBase.ok && zeroBase.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "ZERO_BASE", baseEvidenceCount: 0 });

    const noConcrete = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "operation", size: 10 }] });
    expect(noConcrete.ok && noConcrete.value.discoveries.get("operation")).toMatchObject({ state: "UNAVAILABLE", reason: "NO_CONCRETE_VALUES", baseEvidenceCount: 1 });
  });

  it("keeps discovery and page on the same committed read point", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-latch" });
    await history.offer(event("first", 1, "first")).settled;
    const before = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "key", size: 10 }] });
    expect(before.ok).toBe(true);
    await history.offer(event("second", 2, "second")).settled;
    if (!before.ok) return;
    expect(before.value.totals).toEqual({ matching: 1, inScope: 1 });
    expect(before.value.discoveries.get("key")?.distinctTotal).toBe(1);
    const later = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "key", size: 10 }] });
    expect(later.ok && later.value.discoveries.get("key")?.distinctTotal).toBe(2);
  });

  it("reports unsupported discovery locally while preserving the atomic page result", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-unavailable" });
    await history.offer(event("one", 1, "one")).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...filter(), unsupported: [{ id: "future", label: "future", reason: "UNSUPPORTED_FACET" }] }, discover: [{ facet: "key", size: 10 }] });
    expect(result.ok && result.value.totals).toEqual({ matching: 0, inScope: 0 });
    expect(result.ok && result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });
  });

  it("reaches bounded pages across the normal and lower high-cardinality memory tiers", async () => {
    const histories = await Promise.all([
      createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-normal-workload" }),
      createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-lower-workload", capacityTier: "LOWER", capacity: { maxRetainedCount: 5_000 } })
    ]);
    for (const history of histories) {
      const count = 5_000;
      for (let sequence = 0; sequence < count; sequence += 1) await history.offer(event(`workload-${sequence}`, sequence + 1, `key-${sequence % 3_842}`)).settled;
      const started = performance.now();
      const first = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: filter(), discover: [{ facet: "key", size: 1 }] });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(500);
      expect(first.ok && first.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 3_842 });
      if (!first.ok) continue;
      const discovery = first.value.discoveries.get("key");
      const middle = await history.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: filter(), discover: [{ facet: "key", size: 1, cursor: discovery?.nextCursor ?? undefined }] });
      expect(middle.ok && middle.value.discoveries.get("key")?.values).toHaveLength(1);
    }
  }, 30_000);
});
