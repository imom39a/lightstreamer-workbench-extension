import { describe, expect, it } from "vitest";

import {
  type EvidenceFilterQueryAdapter,
  type EvidenceQueryRequest,
  typedFacetValue
} from "../src/core/evidence-filter-contract";
import { createEmptyEvidenceFilter, createEvidenceFilterFixture } from "./support/evidence-filter-fixture";
import { createReferenceFilterAdapter } from "./support/evidence-filter-reference";


function query(adapter: EvidenceFilterQueryAdapter, filter = createEmptyEvidenceFilter(), page: EvidenceQueryRequest["page"] = { order: "OLDEST_FIRST", size: 25 }) {
  return adapter.query({ at: "LATEST_COMMITTED", page, filter });
}

describe("storage-neutral evidence filter seam", () => {
  it("executes include, exclude, free text, and half-open Around filtering with exact totals", async () => {
    const fixture = createEvidenceFilterFixture();
    const adapter = createReferenceFilterAdapter(fixture.records);
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
    expect(result.value.totals).toEqual({ matching: 420, inScope: 9 });
    expect(result.value.page.evidence).toHaveLength(9);
    expect(result.value.page.evidence.every((record) => record.timestamp >= fixture.cases.around.start && record.timestamp < fixture.cases.around.end)).toBe(true);
  });

  it("fails closed for unsupported criteria and reports unavailable discovery", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const adapter = createReferenceFilterAdapter(fixture.records);
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
    const adapter = createReferenceFilterAdapter(fixture.records);
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

  it("reaches first, middle, and last records through bounded continuation without rendering the workload", async () => {
    const fixture = createEvidenceFilterFixture();
    const adapter = createReferenceFilterAdapter(fixture.records);
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await query(adapter, createEmptyEvidenceFilter(), { order: "OLDEST_FIRST", size: 257, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.page.evidence.length).toBeLessThanOrEqual(257);
      seen.push(...result.value.page.evidence.map((record) => record.identity.sequence));
      cursor = result.value.page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(10_000);
    expect(seen[0]).toBe(1);
    expect(seen[4_999]).toBe(5_000);
    expect(seen.at(-1)).toBe(10_000);
  });

  it("returns Reveal blockers for hidden retained selection and distinguishes another interval", async () => {
    const fixture = createEvidenceFilterFixture();
    const adapter = createReferenceFilterAdapter(fixture.records);
    const selected = fixture.records[500]!.identity;
    const result = await adapter.query({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: 1 },
      filter: { ...createEmptyEvidenceFilter(), text: "does-not-match", around: { intervalId: fixture.interval.id, start: 0, end: 1 } },
      lookup: selected
    });
    expect(result.ok && result.value.lookup).toMatchObject({ state: "RETAINED", inScope: false, matchesFilter: false });
    if (!result.ok || !result.value.lookup || result.value.lookup.state !== "RETAINED") return;
    expect(result.value.lookup.blockingCriteria.map(({ id }) => id)).toEqual(["free-text", "around-evidence"]);
    const other = await adapter.query({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: createEmptyEvidenceFilter(), lookup: { ...selected, intervalId: "other-interval" } });
    expect(other.ok && other.value.lookup).toMatchObject({ state: "OTHER_INTERVAL" });
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
