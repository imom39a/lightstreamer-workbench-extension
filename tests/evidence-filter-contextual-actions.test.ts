import { describe, expect, it } from "vitest";

import {
  applyFilterMutations,
  createFilter,
  createTypedFilterValue,
  type FilterMutation
} from "../src/core/filter-algebra";
import { createEvidenceFilterActionDescriptors, filterMutationsForAction } from "../src/core/evidence-filter-actions";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

function selectedEvent(): LightstreamerEventEnvelope {
  return {
    id: "evidence-1",
    timestamp: 10_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    captureSource: "listener",
    kind: "item-update",
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    item: { name: "orders", position: 1 },
    listener: { id: "listener-1" },
    update: { key: "order-1", command: "ADD", isSnapshot: false }
  };
}

const identity = {
  intervalId: "interval-1",
  pageId: "page-1",
  ownerId: "history-1",
  sequence: 42,
  eventId: "evidence-1"
} as const;

describe("filter-impl-14 typed contextual filter actions", () => {
  it("exposes typed Include and Exclude actions for the shared facet descriptors", () => {
    const actions = createEvidenceFilterActionDescriptors(selectedEvent(), {
      identity,
      timestamp: 10_000,
      retained: true,
      retainedIntervalId: "interval-1"
    });

    const clientInclude = actions.find((action) => action.kind === "include" && action.facet === "client");
    const clientExclude = actions.find((action) => action.kind === "exclude" && action.facet === "client");
    const operationInclude = actions.find((action) => action.kind === "include" && action.facet === "operation");

    expect(clientInclude).toMatchObject({
      kind: "include",
      facet: "client",
      label: "Include Client client-1"
    });
    expect(clientInclude?.value?.identity).toBe(JSON.stringify(["v1", "client", "client", JSON.stringify(["owner-v1", "page", "page-1", "client", "client-1"])]));
    expect(clientInclude?.facetDescriptor?.label).toBe("Client");
    expect(clientExclude?.value?.identity).toBe(clientInclude?.value?.identity);
    expect(operationInclude?.facetDescriptor?.label).toBe("COMMAND operation");
  });

  it("generates canonical Include and Exclude mutations without label parsing", () => {
    const actions = createEvidenceFilterActionDescriptors(selectedEvent(), { identity, timestamp: 10_000, retained: true, retainedIntervalId: "interval-1" });
    const include = actions.find((action) => action.kind === "include" && action.facet === "key");
    const exclude = actions.find((action) => action.kind === "exclude" && action.facet === "key");
    if (!include || !exclude) throw new Error("Expected typed key actions.");

    expect(filterMutationsForAction(include)).toEqual<readonly FilterMutation[]>([
      { type: "add-criterion", facet: "key", value: include.value!, polarity: "include" }
    ]);
    expect(filterMutationsForAction(exclude)).toEqual<readonly FilterMutation[]>([
      { type: "add-criterion", facet: "key", value: exclude.value!, polarity: "exclude" }
    ]);
  });

  it("replaces only the prior Around criterion and preserves unrelated criteria", () => {
    const unrelated = createTypedFilterValue("provenance", "enum", "SERVER");
    const oldAround = { intervalId: "interval-1", start: 0, end: 5_000 };
    const base = applyFilterMutations(createFilter(), 1, [
      { type: "add-criterion", facet: "provenance", value: unrelated },
      { type: "set-around", around: oldAround }
    ]);
    if (!base.ok) throw new Error("Expected the base Filter mutation to apply.");
    const around = createEvidenceFilterActionDescriptors(selectedEvent(), { identity, timestamp: 10_000, retained: true, retainedIntervalId: "interval-1" })
      .find((action) => action.kind === "around");
    if (!around) throw new Error("Expected an Around action.");

    const result = applyFilterMutations(base.filter, base.filter.revision, filterMutationsForAction(around));
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.filter.criteria.provenance?.include).toEqual([unrelated]);
    expect(result.filter.around).toEqual({ intervalId: "interval-1", start: 5_000, end: 15_000 });
  });

  it("does not expose Around for a missing, retired, or different-interval selection", () => {
    expect(createEvidenceFilterActionDescriptors(selectedEvent(), { identity, timestamp: 10_000, retained: false, retainedIntervalId: "interval-1" })
      .some((action) => action.kind === "around")).toBe(false);
    expect(createEvidenceFilterActionDescriptors(selectedEvent(), { identity: { ...identity, intervalId: "old-interval" }, timestamp: 10_000, retained: true, retainedIntervalId: "interval-1" })
      .some((action) => action.kind === "around")).toBe(false);
    expect(createEvidenceFilterActionDescriptors(selectedEvent(), { timestamp: 10_000, retained: true })
      .some((action) => action.kind === "around")).toBe(false);
  });

  it("applies a selected Context action through the expected-revision runtime command", async () => {
    const history = createAuthoritativeHistory();
    history.offer(selectedEvent());
    const runtime = createWorkbenchRuntime({ history });
    await settleRuntime();
    runtime.dispatch({ type: "select-evidence", eventId: "evidence-1" });
    await settleRuntime();

    const snapshot = runtime.getSnapshot();
    const action = snapshot.context.filterActions?.find((candidate) => candidate.kind === "include" && candidate.facet === "key");
    expect(action).toBeDefined();
    if (!action) return;
    runtime.dispatch({
      type: "apply-contextual-filter-action",
      expectedRevision: snapshot.evidence.investigation.filter.revision,
      action
    });
    await settleRuntime();

    const applied = runtime.getSnapshot().evidence.investigation.filter;
    expect(applied.criteria.key?.include[0]?.label).toBe("order-1");
    expect(runtime.getSnapshot().context.filterActions?.some((candidate) => candidate.id === action.id)).toBe(true);
    runtime.dispose();
  });

  it("keeps hidden selection and Context while an Exclude action moves visible focus, then reveals minimally", async () => {
    const history = createAuthoritativeHistory();
    history.offer(selectedEvent());
    history.offer({
      ...selectedEvent(),
      id: "evidence-2",
      timestamp: 10_001,
      update: { key: "order-2", command: "ADD", isSnapshot: false }
    });
    const runtime = createWorkbenchRuntime({ history });
    await settleRuntime();
    runtime.dispatch({ type: "select-evidence", eventId: "evidence-1" });
    runtime.dispatch({ type: "open-context" });
    await settleRuntime();
    const before = runtime.getSnapshot();
    const action = before.context.filterActions?.find((candidate) => candidate.kind === "exclude" && candidate.facet === "key");
    expect(action).toBeDefined();
    if (!action) return;
    runtime.dispatch({ type: "apply-contextual-filter-action", expectedRevision: before.evidence.investigation.filter.revision, action });
    await settleRuntime();

    expect(runtime.getSnapshot().selectionEventId).toBe("evidence-1");
    expect(runtime.getSnapshot().context.kind).toBe("evidence");
    expect(runtime.getSnapshot().evidence.hiddenSelection).toMatchObject({ eventId: "evidence-1", canReveal: true });
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("evidence-2");

    runtime.dispatch({ type: "reveal-selected-evidence" });
    await settleRuntime();
    expect(runtime.getSnapshot().evidence.hiddenSelection).toBeNull();
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria.key).toBeUndefined();
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("evidence-1");
    runtime.dispose();
  });

  it("publishes the canonical stale outcome when a contextual action uses an old revision", async () => {
    const history = createAuthoritativeHistory();
    history.offer(selectedEvent());
    const runtime = createWorkbenchRuntime({ history });
    await settleRuntime();
    runtime.dispatch({ type: "select-evidence", eventId: "evidence-1" });
    await settleRuntime();
    const before = runtime.getSnapshot();
    const action = before.context.filterActions?.find((candidate) => candidate.kind === "include" && candidate.facet === "key");
    if (!action) throw new Error("Expected a contextual action.");
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: before.evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "external" }] });
    runtime.dispatch({ type: "apply-contextual-filter-action", expectedRevision: before.evidence.investigation.filter.revision, action });
    expect(runtime.getSnapshot().evidence.filterMutation.state).toBe("stale");
    expect(runtime.getSnapshot().evidence.investigation.filter.text).toBe("external");
    runtime.dispose();
  });
});

async function settleRuntime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
