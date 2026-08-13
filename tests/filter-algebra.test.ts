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
import { toCanonicalFilter } from "../src/core/event-filter";

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
    expect(evaluateFilter(filter, record({ facets: { ...record().facets, kind: createTypedFilterValue("kind", "enum", "session-status"), key: createTypedFilterValue("key", "string", "different") } })).matches).toBe(false);
  });

  it("uses typed case rules and distinguishes number, boolean, null, and missing", () => {
    const enumValue = createTypedFilterValue("kind", "enum", "ITEM-UPDATE");
    expect(enumValue.value).toBe("ITEM-UPDATE");
    expect(createTypedFilterValue("kind", "enum", "item-update").identity).toBe(enumValue.identity);
    expect(createTypedFilterValue("key", "string", "ABC").identity).not.toBe(createTypedFilterValue("key", "string", "abc").identity);
    expect(createTypedFilterValue("value", "number", 1).identity).not.toBe(createTypedFilterValue("value", "boolean", true).identity);
    expect(createTypedFilterValue("value", "null", null).identity).not.toBe(createTypedFilterValue("value", "string", "null").identity);
    expect(evaluateFilter({ ...createFilter(), criteria: { missing: { include: [createTypedFilterValue("missing", "string", "x")], exclude: [] } } }, record()).matches).toBe(false);
    expect(() => createTypedFilterValue("value", "number", Number.NaN)).toThrow();
    expect(() => createTypedFilterValue("value", "string", true as never)).toThrow();
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
    expect(() => canonicalizeFilter({ ...createFilter(), around: { intervalId: "interval-1", start: 2, end: 2 } })).toThrow();
  });

  it("applies an atomic, immutable, revision-checked mutation batch", () => {
    const initial = createFilter();
    const operations: FilterMutation[] = [
      { type: "set-text", text: "  ABC " },
      { type: "set-polarity", facet: "key", value: createTypedFilterValue("key", "string", "ABC"), polarity: "include" },
      { type: "set-polarity", facet: "key", value: createTypedFilterValue("key", "string", "ABC"), polarity: "exclude" }
    ];
    const result = applyFilterMutations(initial, 1, operations);
    expect(result).toMatchObject({ ok: true, changed: true, filter: { revision: 2, text: "abc" } });
    if (!result.ok) return;
    expect(result.filter.criteria.key?.include).toHaveLength(0);
    expect(result.filter.criteria.key?.exclude).toHaveLength(1);
    expect(initial).toEqual(createFilter());
    expect(applyFilterMutations(result.filter, 1, [])).toMatchObject({ ok: false, problem: { code: "STALE_FILTER_REVISION" } });
  });

  it("keeps the temporary scalar compatibility adapter separate from the new algebra", () => {
    const filter = toCanonicalFilter({ query: "  Alpha ", mode: "command", snapshot: false, itemPosition: 2 });
    expect(filter.text).toBe("alpha");
    expect(filter.criteria.mode?.include[0]?.value).toBe("COMMAND");
    expect(filter.criteria.phase?.include[0]?.value).toBe("LIVE");
    expect(filter.criteria["legacy:item-position"]?.include[0]?.value).toBe(2);
  });

  it("preserves the revision for empty, idempotent, and duplicate no-op batches", () => {
    const value = createTypedFilterValue("key", "string", "ABC");
    const initial = canonicalizeFilter({
      ...createFilter(),
      text: "abc",
      criteria: { key: { include: [value], exclude: [] } }
    });

    for (const operations of [
      [],
      [{ type: "set-text", text: " ABC " }],
      [{ type: "add-criterion", facet: "key", value }],
      [{ type: "add-criterion", facet: "key", value }, { type: "add-criterion", facet: "key", value }]
    ] satisfies readonly FilterMutation[][]) {
      const result = applyFilterMutations(initial, initial.revision, operations);
      expect(result).toMatchObject({ ok: true, changed: false, filter: { revision: initial.revision } });
    }
  });

  it("uses typed identity rather than labels and chooses the smallest duplicate label", () => {
    const alpha = createTypedFilterValue("key", "string", "ABC", "Zulu");
    const beta = createTypedFilterValue("key", "string", "ABC", "Alpha");
    const left = canonicalizeFilter({ ...createFilter(), criteria: { key: { include: [alpha, beta], exclude: [] } } });
    const right = canonicalizeFilter({ ...createFilter(), criteria: { key: { include: [beta, alpha], exclude: [] } } });
    expect(left.criteria.key?.include).toEqual([expect.objectContaining({ identity: alpha.identity, label: "Alpha" })]);
    expect(filterEquals(left, right)).toBe(true);
    expect(serializeFilter(left)).toBe(serializeFilter(right));
  });

  it("orders unsupported criteria deterministically through detail and optional fields", () => {
    const left = canonicalizeFilter({ ...createFilter(), unsupported: [
      { id: "x", reason: "same", detail: "z" },
      { id: "x", reason: "same", detail: "a" },
      { id: "x", reason: "same", facet: "facet-b" },
      { id: "x", reason: "same", facet: "facet-a" }
    ] });
    const right = canonicalizeFilter({ ...createFilter(), unsupported: [...left.unsupported].reverse() });
    expect(serializeFilter(left)).toBe(serializeFilter(right));
    expect(left.unsupported.map((criterion) => criterion.detail ?? criterion.facet)).toEqual(["a", "z", "facet-a", "facet-b"]);
  });

  it("rejects malformed criterion mutations and invalid facet clearing atomically", () => {
    const value = createTypedFilterValue("key", "string", "ABC");
    const initial = canonicalizeFilter({ ...createFilter(), criteria: { key: { include: [value], exclude: [] } } });
    const forged = { ...value, facet: "other" } as typeof value;
    expect(applyFilterMutations(initial, 1, [{ type: "remove-criterion", facet: "key", value: forged }])).toMatchObject({
      ok: false, filter: initial, problem: { code: "INVALID_FILTER_MUTATION" }
    });
    expect(applyFilterMutations(initial, 1, [{ type: "clear-facet", facet: "" }])).toMatchObject({
      ok: false, filter: initial, problem: { code: "INVALID_FILTER_MUTATION" }
    });
  });

  it("preserves explicit legacy null criteria while distinguishing missing from null", () => {
    const legacy = toCanonicalFilter({ clientId: null, sessionId: null });
    expect(legacy.criteria.client?.include[0]?.type).toBe("null");
    expect(legacy.criteria.session?.include[0]?.value).toBeNull();
    const filter = canonicalizeFilter({ ...createFilter(), criteria: { value: {
      include: [createTypedFilterValue("value", "null", null)], exclude: [createTypedFilterValue("value", "null", null)]
    } } });
    expect(evaluateFilter(filter, record()).matches).toBe(false);
    expect(evaluateFilter(filter, record({ facets: { ...record().facets, value: createTypedFilterValue("value", "null", null) } })).matches).toBe(false);
    const include = canonicalizeFilter({ ...createFilter(), criteria: { value: { include: [createTypedFilterValue("value", "null", null)], exclude: [] } } });
    expect(evaluateFilter(include, record()).matches).toBe(false);
    expect(evaluateFilter(include, record({ facets: { ...record().facets, value: createTypedFilterValue("value", "null", null) } })).matches).toBe(true);
  });

  it("supports every mutation and preserves stale or invalid atomic state", () => {
    const value = createTypedFilterValue("key", "string", "ABC");
    const initial = createFilter();
    const add = applyFilterMutations(initial, 1, [{ type: "add-criterion", facet: "key", value }]);
    expect(add).toMatchObject({ ok: true, changed: true, filter: { revision: 2 } });
    if (!add.ok) return;
    const remove = applyFilterMutations(add.filter, 2, [{ type: "remove-criterion", facet: "key", value }]);
    expect(remove).toMatchObject({ ok: true, changed: true });
    const around = applyFilterMutations(remove.ok ? remove.filter : add.filter, 3, [{ type: "set-around", around: { intervalId: "i", start: 1, end: 4 } }]);
    expect(around).toMatchObject({ ok: true, changed: true });
    const cleared = applyFilterMutations(around.ok ? around.filter : add.filter, 4, [{ type: "clear-around" }, { type: "set-text", text: " hello " }]);
    expect(cleared).toMatchObject({ ok: true, changed: true, filter: { text: "hello" } });
    const reset = applyFilterMutations(cleared.ok ? cleared.filter : add.filter, 5, [{ type: "reset" }]);
    expect(reset).toMatchObject({ ok: true, changed: true, filter: { text: "", around: null } });
    const stale = applyFilterMutations(add.filter, 1, [{ type: "set-text", text: "bad" }]);
    expect(stale).toMatchObject({ ok: false, filter: add.filter, problem: { code: "STALE_FILTER_REVISION" } });
  });

  it("keeps algebra composition, Scope, immutability, and round trips stable", () => {
    const a = createTypedFilterValue("kind", "enum", "a");
    const b = createTypedFilterValue("kind", "enum", "b");
    const left = canonicalizeFilter({ ...createFilter(), criteria: { kind: { include: [a, b], exclude: [b] } } });
    const right = canonicalizeFilter({ ...createFilter(), criteria: { kind: { exclude: [b], include: [b, a] } } });
    expect(filterEquals(left, right)).toBe(true);
    expect(evaluateFilter(left, record({ facets: { ...record().facets, kind: a } }), () => true).matches).toBe(true);
    expect(evaluateFilter(left, record({ facets: { ...record().facets, kind: b } }), () => true).matches).toBe(false);
    expect(evaluateFilter(left, record({ facets: { ...record().facets, kind: a } }), () => false)).toMatchObject({ inScope: false, matches: false });
    const source = { ...left, criteria: { ...left.criteria, kind: { ...left.criteria.kind!, include: [...left.criteria.kind!.include] } } };
    const stable = canonicalizeFilter(source);
    const mutableInclude = source.criteria.kind!.include as Array<typeof a>;
    mutableInclude.push(a);
    expect(stable.criteria.kind?.include).toHaveLength(2);
    expect(serializeFilter(canonicalizeFilter(JSON.parse(serializeFilter(left))))).toBe(serializeFilter(left));
  });
});
