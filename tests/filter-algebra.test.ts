import { describe, expect, it } from "vitest";

import {
  applyFilterMutations,
  canonicalizeFilter,
  createFilter,
  createTypedFilterValue,
  evaluateFilter,
  filterEquals,
  serializeFilter,
  type FilterMutation
} from "../src/core/filter-algebra";

const record = (overrides: Partial<Parameters<typeof evaluateFilter>[1]> = {}) => ({
  timestamp: 10,
  intervalId: "interval-1",
  searchText: "order abc risk-reviewed",
  facets: {
    kind: createTypedFilterValue("kind", "enum", "item-update"),
    key: createTypedFilterValue("key", "string", "ABC"),
    count: createTypedFilterValue("count", "number", 1),
    enabled: createTypedFilterValue("enabled", "boolean", true)
  },
  ...overrides
});

describe("canonical Filter algebra", () => {
  it("composes same-facet includes with OR and facets with AND", () => {
    const filter = canonicalizeFilter({
      ...createFilter(),
      criteria: {
        kind: {
          include: [createTypedFilterValue("kind", "enum", "item-update"), createTypedFilterValue("kind", "enum", "session-status")],
          exclude: []
        },
        key: { include: [createTypedFilterValue("key", "string", "ABC")], exclude: [] }
      }
    });

    expect(evaluateFilter(filter, record()).matches).toBe(true);
    expect(evaluateFilter(filter, record({ facets: { ...record().facets, kind: createTypedFilterValue("kind", "enum", "session-status") } })).matches).toBe(false);
  });

  it("uses typed case rules and distinguishes number, boolean, null, and missing", () => {
    const enumValue = createTypedFilterValue("kind", "enum", "ITEM-UPDATE");
    expect(enumValue.value).toBe("ITEM-UPDATE");
    expect(createTypedFilterValue("kind", "enum", "item-update").identity).toBe(enumValue.identity);
    expect(createTypedFilterValue("key", "string", "ABC").identity).not.toBe(createTypedFilterValue("key", "string", "abc").identity);
    expect(createTypedFilterValue("value", "number", 1).identity).not.toBe(createTypedFilterValue("value", "boolean", true).identity);
    expect(createTypedFilterValue("value", "null", null).identity).not.toBe(createTypedFilterValue("value", "string", "null").identity);
    expect(evaluateFilter({ ...createFilter(), criteria: { missing: { include: [createTypedFilterValue("missing", "string", "x")], exclude: [] } } }, record()).matches).toBe(false);
  });

  it("canonicalizes, compares, and serializes independently of authoring order", () => {
    const a = createTypedFilterValue("key", "string", "ABC", "Alpha");
    const b = createTypedFilterValue("key", "string", "abc", "Beta");
    const left = canonicalizeFilter({ ...createFilter(), criteria: { key: { include: [b, a], exclude: [a, a] } } });
    const right = canonicalizeFilter({ ...createFilter(), criteria: { key: { include: [a, b], exclude: [a] } } });
    expect(filterEquals(left, right)).toBe(true);
    expect(serializeFilter(left)).toBe(serializeFilter(right));
    expect(Object.isFrozen(left)).toBe(true);
    expect(() => (left as { text: string }).text = "mutated").toThrow();
  });

  it("fails closed for unsupported criteria and keeps Scope outside Filter", () => {
    const filter = canonicalizeFilter({ ...createFilter(), unsupported: [{ id: "future:facet", reason: "unsupported-facet" }] });
    const result = evaluateFilter(filter, record(), () => true);
    expect(result).toMatchObject({ matches: false, evaluation: "UNSUPPORTED_FILTER" });
    expect(evaluateFilter(createFilter(), record(), () => false)).toMatchObject({ matches: false, inScope: false });
  });

  it("applies an atomic, immutable, revision-checked mutation batch", () => {
    const initial = createFilter();
    const operations: FilterMutation[] = [
      { type: "set-text", text: "  ABC " },
      { type: "set-polarity", facet: "key", value: createTypedFilterValue("key", "string", "ABC"), polarity: "include" },
      { type: "set-polarity", facet: "key", value: createTypedFilterValue("key", "string", "ABC"), polarity: "exclude" }
    ];
    const result = applyFilterMutations(initial, 1, operations);
    expect(result).toMatchObject({ ok: true, changed: true, filter: { revision: 2, text: "ABC" } });
    if (!result.ok) return;
    expect(result.filter.criteria.key?.include).toHaveLength(0);
    expect(result.filter.criteria.key?.exclude).toHaveLength(1);
    expect(initial).toEqual(createFilter());
    expect(applyFilterMutations(result.filter, 1, [])).toMatchObject({ ok: false, problem: { code: "STALE_FILTER_REVISION" } });
  });
});
