import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { EVIDENCE_FACET_KEYS } from "../src/core/evidence-facets";
import { typedFacetValue, type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(id: string, sequence: number, key: string, client = "client-1"): LightstreamerEventEnvelope {
  return {
    id, timestamp: sequence, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id: client, sessionId: "session-1" }, subscription: { id: "subscription-1", mode: "COMMAND", items: ["item-1"], fields: ["value"] },
    listener: { id: "listener-1" },
    item: { name: "item-1" }, update: { isSnapshot: false, key, command: "ADD", fields: { value: sequence } }
  };
}

function tokenPayload(token: string): Record<string, unknown> {
  const padded = token.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((token.length + 3) % 4);
  return JSON.parse(atob(padded));
}

function token(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
        key: { include: [requested], exclude: [typedFacetValue("key", "string", "not-present")] },
        mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] }
      }), around: { intervalId: history.status().interval.id, start: 0, end: 3 } },
      discover: [{ facet: "key", size: 10 }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({ matching: 2, inScope: 1 });
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 2, baseEvidenceCount: 2 });
    expect(result.value.discoveries.get("key")?.values.map((entry) => [entry.value.value, entry.count])).toEqual([["A", 1], ["B", 1], ["not-present", 0]]);
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
    await history.offer({ ...event("one", 1, "alpha"), update: { ...event("one", 1, "alpha").update, command: undefined } }).settled;
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

  it("keeps discovery search independent from Find state and a later passive Capture", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-find-capture-independence" });
    await history.offer(event("first", 1, "alpha")).settled;
    const read = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), find: { text: "first" }, discover: [{ facet: "key", search: "alp", size: 10 }] });
    expect(read.ok && read.value.find).toBeNull();
    expect(read.ok && read.value.discoveries.get("key")?.values.map((entry) => entry.value.value)).toEqual(["alpha"]);
    await history.offer(event("second", 2, "beta")).settled;
    expect(read.ok && read.value.page.evidence).toHaveLength(1);
    expect(read.ok && read.value.discoveries.get("key")?.distinctTotal).toBe(1);
    const later = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), find: { text: "second" }, discover: [{ facet: "key", search: "bet", size: 10 }] });
    expect(later.ok && later.value.find).toBeNull();
    expect(later.ok && later.value.discoveries.get("key")?.values.map((entry) => entry.value.value)).toEqual(["beta"]);
  });

  it("reports unsupported discovery locally while preserving the atomic page result", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-unavailable" });
    await history.offer(event("one", 1, "one")).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...filter(), unsupported: [{ id: "future", label: "future", reason: "UNSUPPORTED_FACET" }] }, discover: [{ facet: "key", size: 10 }] });
    expect(result.ok && result.value.totals).toEqual({ matching: 0, inScope: 0 });
    expect(result.ok && result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });
  });

  it("discovers every catalog facet through the production memory query and keeps typed identities distinct", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-all-facets" });
    await history.offer(event("one", 1, "same", "same")).settled;
    await history.offer({ ...event("two", 2, "same", "same"), subscription: { id: "subscription-2", mode: "MERGE" } }).settled;
    for (const facet of EVIDENCE_FACET_KEYS) {
      const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet, size: 10 }] });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.discoveries.get(facet)?.state).toBe("AVAILABLE");
    }
    const modes = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "mode", size: 10 }] });
    expect(modes.ok && modes.value.discoveries.get("mode")?.values.map((entry) => entry.value.identity)).toEqual([
      JSON.stringify(["v1", "mode", "enum", "COMMAND"]), JSON.stringify(["v1", "mode", "enum", "MERGE"])
    ]);
  });

  it("pins an observed off-page active value, including one outside label search, without changing totals", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-pins" });
    for (const [sequence, key] of ["alpha", "middle", "omega"].entries()) await history.offer(event(key, sequence + 1, key)).settled;
    const active = typedFacetValue("key", "string", "omega");
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: filter({ key: { include: [active], exclude: [] } }), discover: [{ facet: "key", search: "alp", size: 1 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discoveries.get("key")).toMatchObject({ distinctTotal: 1 });
    expect(result.value.discoveries.get("key")?.values).toContainEqual(expect.objectContaining({ value: active, count: 1, pinned: true }));
  });

  it("rejects malformed, cross-request, cross-read-point, and forged oversized cursors locally", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-cursor-validation" });
    for (const [sequence, key] of ["a", "b", "c"].entries()) await history.offer(event(key, sequence + 1, key)).settled;
    const base = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: filter(), discover: [{ facet: "key", size: 1 }] };
    const first = await history.query!(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cursor = first.value.discoveries.get("key")?.nextCursor ?? "";
    const payload = tokenPayload(cursor);
    const invalid = ["not-a-token", token({ ...payload, facet: "mode" }), token({ ...payload, size: 2 }), token({ ...payload, position: 99 })];
    for (const cursorValue of invalid) {
      const result = await history.query!({ ...base, discover: [{ facet: "key", size: 1, cursor: cursorValue }] });
      expect(result.ok && result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    }
    await history.offer(event("d", 4, "d")).settled;
    const stale = await history.query!({ ...base, discover: [{ facet: "key", size: 1, cursor }] });
    expect(stale.ok && stale.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
  });

  it("isolates an injected discovery planner failure from page and exact totals", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-05-discovery-failure", discovery: { fail: () => { throw new Error("planner exploded"); } } });
    await history.offer(event("one", 1, "one")).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: filter(), discover: [{ facet: "key", size: 10 }] });
    expect(result.ok && result.value.page.evidence).toHaveLength(1);
    expect(result.ok && result.value.totals).toEqual({ matching: 1, inScope: 1 });
    expect(result.ok && result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
  });

  it("reaches bounded pages across the normal and lower high-cardinality memory tiers", async () => {
    const tiers = [{ panelSessionId: "filter-impl-05-normal-workload" }, { panelSessionId: "filter-impl-05-lower-workload", capacityTier: "LOWER" as const, capacity: { maxRetainedCount: 5_000 } }];
    for (const [historyIndex, options] of tiers.entries()) {
      const count = historyIndex === 0 ? 10_000 : 5_000;
      let maxCandidates = 0;
      const observed = await createMemoryEventHistoryForTests({ ...options, panelSessionId: `filter-impl-05-bound-${historyIndex}`, discovery: { onResult: (stats) => { maxCandidates = Math.max(maxCandidates, stats.materializedCandidates); expect(stats.materializedCandidates).toBeLessThanOrEqual(stats.materializationBound); } } });
      for (let sequence = 0; sequence < count; sequence += 1) await observed.offer(event(`bound-${sequence}`, sequence + 1, `key-${sequence % 3_842}`)).settled;
      const samples: number[] = [];
      const first = await observed.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: filter(), discover: [{ facet: "key", size: 100 }] });
      for (let sample = 0; sample < 5; sample += 1) { const started = performance.now(); await observed.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: filter(), discover: [{ facet: "key", size: 100 }] }); samples.push(performance.now() - started); }
      samples.sort((left, right) => left - right);
      const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] ?? 0;
      console.log(`[filter-impl-05] tier=${historyIndex === 0 ? "NORMAL" : "LOWER"} records=${count} distinct=3842 p95Ms=${p95.toFixed(2)} materializedMax=${maxCandidates}`);
      expect(p95).toBeLessThan(500);
      expect(first.ok && first.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 3_842 });
      if (!first.ok) continue;
      const reachable = new Set<string>();
      let discovery = first.value.discoveries.get("key");
      while (discovery?.state === "AVAILABLE") {
        for (const entry of discovery.values) reachable.add(entry.value.identity);
        if (!discovery.nextCursor) break;
        const next = await observed.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 100 }, filter: filter(), discover: [{ facet: "key", size: 100, cursor: discovery.nextCursor }] });
        discovery = next.ok ? next.value.discoveries.get("key") : undefined;
      }
      expect(reachable).toHaveLength(3_842);
      expect(maxCandidates).toBeLessThanOrEqual(100);
    }
  }, 30_000);
});
