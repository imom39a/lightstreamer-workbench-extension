import { describe, expect, it } from "vitest";

import {
  createEmptyEvidenceFilter,
  createEvidenceFilterFixture,
  DeterministicEvidenceFilterAdapter,
  type EvidenceFilterQueryAdapter,
  type EvidenceQueryRequest,
  typedFacetValue
} from "../src/core/evidence-filter-contract";

function query(adapter: EvidenceFilterQueryAdapter, filter = createEmptyEvidenceFilter(), page: EvidenceQueryRequest["page"] = { order: "OLDEST_FIRST", size: 25 }) {
  return adapter.query({ at: "LATEST_COMMITTED", page, filter });
}

describe("storage-neutral evidence filter seam", () => {
  it("executes include, exclude, free text, and half-open Around filtering with exact totals", async () => {
    const fixture = createEvidenceFilterFixture();
    const adapter = new DeterministicEvidenceFilterAdapter(fixture.records);
    const include = fixture.cases.includeAndExclude.include;
    const exclude = fixture.cases.includeAndExclude.exclude;
    const filter = {
      ...createEmptyEvidenceFilter(),
      text: fixture.cases.freeText,
      criteria: { provenance: { include: [include], exclude: [exclude] } },
      around: fixture.cases.around
    };

    const result = await query(adapter, filter, { order: "OLDEST_FIRST", size: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluation).toBe("COMPLETE");
    expect(result.value.totals).toEqual({ matching: 0, inScope: 0 });
    expect(result.value.page.evidence).toEqual([]);
  });

  it("fails closed for unsupported criteria and reports unavailable discovery", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const adapter = new DeterministicEvidenceFilterAdapter(fixture.records);
    const result = await adapter.query({
      at: "LATEST_COMMITTED",
      page: { order: "NEWEST_FIRST", size: 10 },
      filter: { ...createEmptyEvidenceFilter(), unsupported: [fixture.cases.unsupported] },
      discover: [{ facet: "key", size: 10 }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluation).toBe("UNSUPPORTED_FILTER");
    expect(result.value.totals).toEqual({ matching: 0, inScope: 0 });
    expect(result.value.page.evidence).toHaveLength(0);
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });
  });

  it("supports bounded page and discovery continuation with lookup, blockers, and Find navigation", async () => {
    const fixture = createEvidenceFilterFixture();
    const adapter = new DeterministicEvidenceFilterAdapter(fixture.records);
    const first = await adapter.query({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: 7 },
      filter: createEmptyEvidenceFilter(),
      discover: [{ facet: "key", size: 4 }],
      lookup: fixture.records[500]!.identity,
      find: { text: "risk-reviewed", current: fixture.records[22]!.identity }
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.page.evidence).toHaveLength(7);
    expect(first.value.page.nextCursor).toBe("7");
    expect(first.value.discoveries.get("key")).toMatchObject({ distinctTotal: 3_842, nextCursor: "4" });
    expect(first.value.lookup).toMatchObject({ state: "RETAINED", inScope: true, matchesFilter: true, blockingCriteria: [] });
    expect(first.value.find?.total).toBeGreaterThan(1);
    expect(first.value.find?.next?.sequence).toBeGreaterThan(22);

    const next = await query(adapter, createEmptyEvidenceFilter(), { order: "OLDEST_FIRST", size: 7, cursor: first.value.page.nextCursor ?? undefined });
    expect(next.ok && next.value.page.evidence[0]?.identity.sequence).toBe(8);
  });

  it("keeps typed identities distinct when labels and values collide", () => {
    const lower = typedFacetValue("key", "string", "abc", "ABC");
    const upper = typedFacetValue("key", "string", "ABC", "ABC");
    const missing = typedFacetValue("item", "item", "missing", "null");
    const literalNull = typedFacetValue("item", "item", "null", "null");
    expect(lower.identity).not.toBe(upper.identity);
    expect(missing.identity).not.toBe(literalNull.identity);
  });
});
