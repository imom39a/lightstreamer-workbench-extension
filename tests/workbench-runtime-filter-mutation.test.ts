import { describe, expect, it } from "vitest";

import {
  applyFilterMutations,
  createFilter,
  createFilterBuilder,
  createTypedFilterValue,
  type FilterMutation
} from "../src/core/filter-algebra";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

function event(id: string, item: string, timestamp: number) {
  return {
    id, timestamp, direction: "inbound" as const, source: "server" as const, synthetic: false,
    kind: "item-update" as const, client: { id: "client-1" }, subscription: { id: "sub-1", mode: "MERGE" },
    item: { name: item, position: 1 }, update: { fields: { value: id } }
  };
}

async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe("filter-impl-11 revisioned mutation seam", () => {
  it("applies a builder's drafted facet changes without replacing unrelated criteria", () => {
    const item = createTypedFilterValue("item", "string", "orders");
    const mode = createTypedFilterValue("mode", "enum", "COMMAND");
    const current = applyFilterMutations(createFilter(), 1, [
      { type: "add-criterion", facet: "item", value: item },
      { type: "add-criterion", facet: "mode", value: mode }
    ]);
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const builder = createFilterBuilder(current.filter);
    builder.setFacet("item", { include: [createTypedFilterValue("item", "string", "quotes")], exclude: [] });
    const result = builder.apply(current.filter.revision);
    expect(result).toMatchObject({ ok: true, filter: { revision: 3 } });
    if (!result.ok) return;
    expect(result.filter.criteria.item?.include[0]?.value).toBe("quotes");
    expect(result.filter.criteria.mode?.include[0]?.value).toBe("COMMAND");
  });

  it("is atomic and truthful for stale, invalid, duplicate, and opposite-polarity mutations", () => {
    const value = createTypedFilterValue("key", "string", "ABC");
    const initial = createFilter();
    const stale = applyFilterMutations(initial, 2, [{ type: "add-criterion", facet: "key", value }]);
    expect(stale).toMatchObject({ ok: false, filter: initial, problem: { code: "STALE_FILTER_REVISION" } });

    const included = applyFilterMutations(initial, 1, [{ type: "add-criterion", facet: "key", value }]);
    expect(included).toMatchObject({ ok: true, changed: true });
    if (!included.ok) return;
    const duplicate = applyFilterMutations(included.filter, included.filter.revision, [{ type: "add-criterion", facet: "key", value }]);
    expect(duplicate).toMatchObject({ ok: true, changed: false, filter: included.filter });
    const opposite = applyFilterMutations(included.filter, included.filter.revision, [{ type: "set-polarity", facet: "key", value, polarity: "exclude" }]);
    expect(opposite).toMatchObject({ ok: true, changed: true, filter: { revision: included.filter.revision + 1 } });
    const invalid = applyFilterMutations(included.filter, included.filter.revision, [{ type: "clear-facet", facet: "" }]);
    expect(invalid).toMatchObject({ ok: false, filter: included.filter, problem: { code: "INVALID_FILTER_MUTATION" } });
  });

  it("keeps the canonical mutation batch as the only whole-filter compatibility path", () => {
    const operations: FilterMutation[] = [{ type: "reset" }, { type: "set-text", text: "orders" }];
    const result = applyFilterMutations(createFilter(), 1, operations);
    expect(result).toMatchObject({ ok: true, filter: { text: "orders", revision: 2 } });
  });

  it("publishes stale outcomes without changing the coherent runtime Filter and preserves Context", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("alpha-1", "alpha", 1));
    history.offer(event("beta-1", "beta", 2));
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "select-evidence", eventId: "beta-1" });
    runtime.dispatch({ type: "open-context" });
    const revision = runtime.getSnapshot().evidence.investigation.filter.revision;
    const item = createTypedFilterValue("item", "string", "alpha");
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: revision, operations: [{ type: "add-criterion", facet: "item", value: item }] });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria.item?.include[0]?.value).toBe("alpha");
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().context.title).toContain("beta-1");
    expect(runtime.getSnapshot().evidence.hiddenSelection?.eventId).toBe("beta-1");
    const before = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({ type: "reset-filter", expectedRevision: revision, });
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before);
    expect(runtime.getSnapshot().evidence.filterMutation?.state).toBe("stale");
    runtime.dispose();
  });

  it("reveals only query-reported blockers and retains unrelated Filter criteria", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("alpha-1", "alpha", 1));
    history.offer(event("beta-1", "beta", 2));
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "select-evidence", eventId: "beta-1" });
    const revision = runtime.getSnapshot().evidence.investigation.filter.revision;
    const key = createTypedFilterValue("mode", "enum", "MERGE");
    const item = createTypedFilterValue("item", "string", "alpha");
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: revision, operations: [
      { type: "add-criterion", facet: "item", value: item },
      { type: "add-criterion", facet: "mode", value: key }
    ] });
    await settle();
    runtime.dispatch({ type: "reveal-selected-evidence" });
    await settle();
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    expect(filter.criteria.mode?.include).toHaveLength(1);
    expect(filter.criteria.item).toBeUndefined();
    expect(runtime.getSnapshot().evidence.filterMutation?.state).toBe("revealed");
    expect(runtime.getSnapshot().evidence.filterMutation?.removedCriteria).toBe(1);
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("beta-1");
    runtime.dispose();
  });

  it("makes Clear a restoration barrier while preserving ordinary Filter and Find intent", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("alpha-1", "alpha", 1));
    history.offer(event("beta-1", "beta", 2));
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const intervalId = runtime.getSnapshot().evidence.investigation.readPoint?.interval.id;
    const revision = runtime.getSnapshot().evidence.investigation.filter.revision;
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: revision, operations: [
      { type: "set-text", text: "alpha" },
      { type: "set-around", around: { intervalId: intervalId ?? "missing", start: 0, end: 3 } }
    ] });
    runtime.dispatch({ type: "set-find", value: "item update" });
    await settle();
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await settle();
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    expect(filter.text).toBe("alpha");
    expect(filter.around).toBeNull();
    expect(runtime.getSnapshot().evidence.find).toBe("item update");
    expect(runtime.getSnapshot().evidence.investigation.historyInterval?.ordinal).toBe(2);
    expect(runtime.getSnapshot().evidence.restoration.canBack).toBe(false);
    runtime.dispose();
  });

  it("restores committed Filter checkpoints without rewinding Event History", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("alpha-1", "alpha", 1));
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const initialRevision = runtime.getSnapshot().evidence.investigation.filter.revision;
    const item = createTypedFilterValue("item", "string", "alpha");
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: initialRevision, operations: [{ type: "add-criterion", facet: "item", value: item }] });
    await settle();
    const appliedRevision = runtime.getSnapshot().evidence.investigation.filter.revision;
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: appliedRevision, operations: [{ type: "set-text", text: "alpha" }] });
    await settle();
    runtime.dispatch({ type: "back-investigation" });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter.text).toBe("");
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria.item?.include).toHaveLength(1);
    runtime.dispatch({ type: "forward-investigation" });
    await settle();
    expect(runtime.getSnapshot().evidence.investigation.filter.text).toBe("alpha");
    expect(runtime.getSnapshot().evidence.investigation.readPoint?.committedEvidenceBoundary?.sequence).toBe(1);
    runtime.dispose();
  });
});
