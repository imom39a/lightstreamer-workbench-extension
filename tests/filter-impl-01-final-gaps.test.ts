import { describe, expect, it } from "vitest";

import { createEvidenceFilterFixture } from "./support/evidence-filter-fixture";
import {
  createReferenceFilterAdapter,
  createReferenceLifecycleHarness,
  readPointMatches
} from "./support/evidence-filter-reference";
import { getEvidenceFilterPanelScenario, runEvidenceFilterPanelScenario } from "./support/panel-scenarios";

describe("filter-impl-01 final contract gaps", () => {
  it("stores every collision case as accepted Evidence, including absent item values", () => {
    const fixture = createEvidenceFilterFixture();
    const itemValues = fixture.records.map((record) => record.facets.item?.value);
    const keys = fixture.records.map((record) => record.facets.key?.value);

    expect(fixture.records.some((record) => record.facets.client?.value === fixture.cases.collisions.clients[0].value)).toBe(true);
    expect(fixture.records.some((record) => record.facets.client?.value === fixture.cases.collisions.clients[1].value)).toBe(true);
    expect(fixture.records.some((record) => record.facets.session?.value === fixture.cases.collisions.sessions[0].value)).toBe(true);
    expect(fixture.records.some((record) => record.facets.session?.value === fixture.cases.collisions.sessions[1].value)).toBe(true);
    expect(fixture.records.some((record) => record.facets.subscription?.value === "sub-collision-a")).toBe(true);
    expect(fixture.records.some((record) => record.facets.subscription?.value === "sub-collision-b")).toBe(true);
    expect(fixture.records.some((record) => record.facets.listener?.value === fixture.cases.collisions.listeners[0].value)).toBe(true);
    expect(fixture.records.some((record) => record.facets.listener?.value === fixture.cases.collisions.listeners[1].value)).toBe(true);
    expect(keys).toContain("ABC");
    expect(keys).toContain("abc");
    expect(itemValues).toContain(undefined);
    expect(itemValues).toContain("null");
  });

  it("rejects a read point whose page or owner identity changed at the same sequence", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const adapter = createReferenceFilterAdapter(fixture.records);
    const first = await adapter.query({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const boundary = first.value.readPoint.committedEvidenceBoundary;
    expect(boundary).not.toBeNull();
    const rejected = await adapter.query({
      at: { ...first.value.readPoint, committedEvidenceBoundary: { ...boundary!, pageId: "wrong-page", ownerId: "wrong-owner" } },
      page: { order: "OLDEST_FIRST", size: 1 },
      filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
    });
    expect(rejected).toMatchObject({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE" } });
  });

  it("makes terminal reads final, refuses terminal capture, and exposes limited coverage", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const harness = createReferenceLifecycleHarness(fixture.records, { storage: "MEMORY_FALLBACK", coverage: "LIMITED" });
    harness.terminate();
    const result = await harness.query({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 3 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(result.ok && result.value.totals).toEqual({ matching: 3_842, inScope: 3_842 });
    expect(result.ok && result.value.coverage).toBe("LIMITED");
    expect(() => harness.capture(fixture.records[0]!)).toThrow(/terminal/i);
  });

  it("enforces the concrete 5,000-record memory fallback bound", async () => {
    const fixture = createEvidenceFilterFixture();
    const result = await createReferenceFilterAdapter(fixture.records, { storage: "MEMORY_FALLBACK" }).query({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 5_001 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({ matching: 5_000, inScope: 5_000 });
    expect(result.value.page.evidence).toHaveLength(5_000);
    expect(result.value.readPoint.retainedRange?.first.sequence).toBe(5_001);
  });

  it("keeps memory and IndexedDB-shaped adapters equivalent at the contract seam", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 17 }, filter: { revision: 1, text: "risk-reviewed", criteria: {}, around: null, unsupported: [] } };
    const memory = await createReferenceFilterAdapter(fixture.records, { storage: "MEMORY_FALLBACK" }).query(request);
    const indexedDb = await createReferenceFilterAdapter(fixture.records, { storage: "INDEXED_DB" }).query(request);
    expect(memory).toMatchObject({ ok: true });
    expect(indexedDb).toMatchObject({ ok: true });
    if (memory.ok && indexedDb.ok) {
      expect({ ...memory.value, storage: undefined }).toEqual({ ...indexedDb.value, storage: undefined });
    }
  });

  it("runs all nine maintained scenarios against concrete reference outcomes", async () => {
    const ids = [
      "primary-include-exclude-reveal-reset",
      "empty-history",
      "valid-zero-result-conflict",
      "unsupported-criterion",
      "discovery-unavailable",
      "hidden-selection",
      "terminal-history",
      "memory-fallback",
      "high-volume-command-keys"
    ] as const;
    for (const id of ids) {
      const scenario = getEvidenceFilterPanelScenario(id);
      expect(scenario.setupActions).toEqual([]);
      expect(scenario.semanticSetup?.length).toBeGreaterThan(0);
      expect(scenario.capturedEvents).toHaveLength(id === "empty-history" || id === "discovery-unavailable" ? 0 : id === "valid-zero-result-conflict" ? 2 : id === "unsupported-criterion" ? 1 : id === "hidden-selection" ? 3 : id === "terminal-history" ? 4 : 6);
      const result = await runEvidenceFilterPanelScenario(id);
      expect(result.actual).toEqual(result.expected);
    }
  });

  it("compares read-point identities as complete values", () => {
    const fixture = createEvidenceFilterFixture(3_842);
    expect(readPointMatches(fixture.retainedRange.last, { ...fixture.retainedRange.last, pageId: "other" })).toBe(false);
    expect(readPointMatches(fixture.retainedRange.last, fixture.retainedRange.last)).toBe(true);
  });
});
