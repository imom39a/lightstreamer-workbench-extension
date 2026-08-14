import { describe, expect, it } from "vitest";

import { createEvidenceFilterFixture } from "./support/evidence-filter-fixture";
import {
  createReferenceFilterAdapter,
  createReferenceLifecycleHarness,
  readPointMatches
} from "./support/evidence-filter-reference";
import { getEvidenceFilterPanelScenario, runEvidenceFilterPanelScenario } from "./support/panel-scenarios";

const FILTER_SCENARIO_EXPECTATIONS = Object.freeze({
  "primary-include-exclude-reveal-reset": { totals: { matching: 420, inScope: 9 }, page: 9, evaluation: "COMPLETE", coverage: "COMPLETE", storage: "INDEXED_DB" },
  "empty-history": { totals: { matching: 0, inScope: 0 }, page: 0, retained: null, coverage: "COMPLETE", storage: "INDEXED_DB" },
  "valid-zero-result-conflict": { totals: { matching: 0, inScope: 0 }, page: 0, evaluation: "COMPLETE", coverage: "COMPLETE", storage: "INDEXED_DB" },
  "unsupported-criterion": { totals: { matching: 0, inScope: 0 }, page: 0, evaluation: "UNSUPPORTED_FILTER", coverage: "COMPLETE", storage: "INDEXED_DB" },
  "discovery-unavailable": { totals: { matching: 0, inScope: 0 }, discovery: "UNAVAILABLE", discoveryReason: "NO_CONCRETE_VALUES", coverage: "COMPLETE", storage: "INDEXED_DB" },
  "hidden-selection": { totals: { matching: 0, inScope: 0 }, blockers: ["free-text", "around-evidence"], coverage: "COMPLETE", storage: "INDEXED_DB" },
  "terminal-history": { totals: { matching: 10000, inScope: 10000 }, coverage: "COMPLETE", storage: "INDEXED_DB", phase: "TERMINAL", terminalBoundary: 10000 },
  "memory-fallback": { totals: { matching: 5000, inScope: 5000 }, page: 25, storage: "MEMORY_FALLBACK", coverage: "COMPLETE", first: 5001 },
  "high-volume-command-keys": { totals: { matching: 10000, inScope: 10000 }, discovery: "AVAILABLE", distinctTotal: 3842, coverage: "COMPLETE", storage: "INDEXED_DB" }
} as const);

const FILTER_SCENARIO_IDS = Object.keys(FILTER_SCENARIO_EXPECTATIONS) as Array<keyof typeof FILTER_SCENARIO_EXPECTATIONS>;

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
    for (const id of FILTER_SCENARIO_IDS) {
      const scenario = getEvidenceFilterPanelScenario(id);
      expect(scenario.setupActions).toEqual([]);
      expect(scenario.semanticSetup?.length).toBeGreaterThan(0);
      const contract = (scenario as typeof scenario & { filterContract: { records: readonly unknown[]; fingerprint: string; capturedEventIds: readonly string[] } }).filterContract;
      expect(contract).toBeDefined();
      expect(new Set(scenario.capturedEvents.map((event) => event.id))).toEqual(new Set(contract.capturedEventIds));
      expect(new Set(contract.records.map((record) => JSON.stringify(record))).size).toBe(contract.records.length);
      const result = await runEvidenceFilterPanelScenario(scenario);
      expect(result.actual).toEqual(FILTER_SCENARIO_EXPECTATIONS[id]);
      expect(result.sourceFingerprint).toBe(contract.fingerprint);
    }
  });

  it("gives each maintained filter scenario a distinct source fingerprint", () => {
    const scenarios = FILTER_SCENARIO_IDS.map((id) => getEvidenceFilterPanelScenario(id));
    const contracts = scenarios.map((scenario) => (scenario as typeof scenario & { filterContract: { fingerprint: string } }).filterContract);
    expect(new Set(contracts.map((contract) => contract.fingerprint)).size).toBe(9);
    expect(scenarios.find((scenario) => scenario.id === "empty-history")?.capturedEvents).toHaveLength(0);
    expect(scenarios.find((scenario) => scenario.id === "high-volume-command-keys")?.capturedEvents).toHaveLength(10_000);
    expect(contracts.find((contract, index) => scenarios[index]?.id === "high-volume-command-keys")?.records).toHaveLength(10_000);
  });

  it("compares read-point identities as complete values", () => {
    const fixture = createEvidenceFilterFixture(3_842);
    expect(readPointMatches(fixture.retainedRange.last, { ...fixture.retainedRange.last, pageId: "other" })).toBe(false);
    expect(readPointMatches(fixture.retainedRange.last, fixture.retainedRange.last)).toBe(true);
  });
});
