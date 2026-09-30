import { describe, expect, it, vi } from "vitest";
import { createCommandStateProjections } from "../src/core/command-state";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { readAgentCommandState, type AgentCommandStateContext, type AgentCommandStateInput } from "../src/extension/panel/agent-command-state";
import type { TopologySelectionTarget } from "../src/extension/panel/topology-view-model";

const input: AgentCommandStateInput = { scopeId: "scope", pageEpoch: "page", projection: "observed-server", item: { name: "orders", position: 1 }, key: " row" };
function fixture() {
  const projections = createCommandStateProjections();
  let sequence = 0;
  const apply = (kind: LightstreamerEventEnvelope["kind"], command = "ADD", key = " row", fields: Record<string, string | number | boolean | null> = { command, key, value: "exact" }, synthetic = false, itemName = "orders", itemPosition = 1) => {
    const id = `event-${++sequence}`;
    const evidence = { intervalId: "interval", sequence, eventId: id };
    projections.apply({ id, kind, timestamp: sequence, direction: "inbound", source: synthetic ? "synthetic" : "server", synthetic,
      subscription: { id: "subscription", mode: "COMMAND", items: ["orders", "inventory"] }, item: { name: itemName, position: itemPosition },
      ...(kind === "item-update" ? { update: { command, key, fields, changedFields: fields } } : {}) }, evidence);
    return evidence;
  };
  const boundary = apply("item-update");
  const history = { ...createInMemoryEventHistory().status(), interval: { id: "interval", ordinal: 1 },
    committedEvidenceBoundary: boundary, retainedRange: { first: boundary, last: boundary } };
  const scope = { kind: "item", subscription: { id: "subscription", mode: "COMMAND", active: true, historical: false, serverEstablished: true },
    item: { name: "orders", position: 1 } } as unknown as TopologySelectionTarget;
  const context: AgentCommandStateContext = { pageEpoch: "page", disposed: false, scope, history, projectionBoundary: boundary, projectionReady: true,
    readKey: (projection, target) => projections.readKey(projection, target) };
  return { apply, context, projections };
}

describe("exact COMMAND key agent reads", () => {
  it("returns exact strings and retained provenance through the direct map seam", () => {
    const { projections, context } = fixture();
    const snapshot = vi.spyOn(projections, "snapshot");
    const result = readAgentCommandState(input, context);
    expect(result).toMatchObject({ status: "ok", projection: "observed-server", presence: { state: "present", basis: "row", provenance: { eventId: "event-1", evidence: { sequence: 1 }, evidenceRetained: true } },
      fieldsTotal: 3, fieldsReturned: 3, truncated: false, fields: expect.arrayContaining([{ name: "value", state: "concrete", value: "exact", certainty: "projected", provenance: expect.objectContaining({ eventId: "event-1" }) }]) });
    expect(snapshot).not.toHaveBeenCalled();
    expect(readAgentCommandState({ ...input, key: "row" }, context)).toMatchObject({ presence: { state: "inconclusive", basis: "no-observed-basis" } });
  });

  it("separates Local Effective values and preserves unavailable and ambiguous semantics", () => {
    const { apply, context } = fixture();
    const boundary = apply("item-update", "UPDATE", " row", { command: "UPDATE", key: " row", value: null, unavailable: null }, true);
    const next = { ...context, projectionBoundary: boundary, history: { ...context.history, retainedRange: { first: context.history.retainedRange!.first, last: boundary } } };
    expect(readAgentCommandState({ ...input, fields: ["value"] }, next)).toMatchObject({ fields: [{ value: "exact", state: "concrete" }] });
    expect(readAgentCommandState({ ...input, projection: "local-effective", fields: ["value", "missing"] }, next)).toMatchObject({ fields: [
      { name: "value", state: "concrete", value: null, provenance: { source: "synthetic" } }, { name: "missing", state: "unavailable", certainty: "unavailable" }
    ] });
    const server = apply("item-update", "UPDATE", " row", { key: " row", note: null });
    expect(readAgentCommandState({ ...input, fields: ["note"] }, { ...next, projectionBoundary: server })).toMatchObject({ fields: [{ name: "note", state: "ambiguous-null" }] });
  });

  it("does not claim current presence after a later gap, and supports a later clear basis", () => {
    const { apply, context } = fixture();
    const gap = { interval: context.history.interval, captureOrdinal: 2, eventId: "gap", candidateBytes: 1, occurredAt: 2, dimension: "PENDING_BYTES" as const, afterEvidence: context.projectionBoundary };
    const gapped = { ...context, history: { ...context.history, continuity: { state: "GAPPED" as const, gapCount: 1, firstGap: gap, latestGap: gap } } };
    expect(readAgentCommandState(input, gapped)).toMatchObject({ presence: { state: "inconclusive", basis: "row" }, fields: expect.arrayContaining([expect.objectContaining({ name: "value", certainty: "last-observed" })]) });
    const clear = apply("clear-snapshot");
    expect(readAgentCommandState(input, { ...gapped, projectionBoundary: clear })).toMatchObject({ presence: { state: "absent", basis: "clear-snapshot", provenance: { eventId: clear.eventId } } });
    const unknown = readAgentCommandState({ ...input, key: "unobserved" }, gapped);
    expect(unknown).toMatchObject({ presence: { state: "absent", basis: "clear-snapshot" } });
  });

  it("reports omission and field totals, avoids oversized concrete output, and guards exact targets", () => {
    const { apply, context } = fixture();
    const fields = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`field-${index}`, `value-${index}`]));
    const boundary = apply("item-update", "UPDATE", " row", { ...fields, huge: "x".repeat(100_000) });
    const next = { ...context, projectionBoundary: boundary };
    expect(readAgentCommandState({ ...input, maxBytes: 65536 }, next)).toMatchObject({ fieldsTotal: 46, fieldsReturned: 32, truncated: true });
    const huge = readAgentCommandState({ ...input, fields: ["huge"] }, next);
    expect(huge).toMatchObject({ truncated: true, fields: [{ name: "huge", state: "output-budget", certainty: "unavailable" }] });
    expect(JSON.stringify(huge).length).toBeLessThan(8192);
    expect(readAgentCommandState({ ...input, pageEpoch: "old" }, context)).toMatchObject({ problem: { code: "TARGET_CHANGED" } });
    expect(readAgentCommandState({ ...input, item: { name: null, position: null } }, context)).toMatchObject({ problem: { code: "INVALID_ARGUMENT" } });
    expect(readAgentCommandState({ ...input, item: { name: "other", position: 1 } }, context)).toMatchObject({ problem: { code: "INVALID_TARGET" } });
    expect(readAgentCommandState(input, { ...context, projectionReady: false })).toMatchObject({ problem: { code: "PROJECTION_UNAVAILABLE" } });
  });

  it("restores a fresh empty basis after tombstone eviction without erasing older lifecycle limits or other items", () => {
    const { apply, context, projections } = fixture();
    apply("item-update", "ADD", "other", { key: "other", value: "kept" }, false, "inventory", 2);
    for (let number = 0; number < 2_049; number += 1) {
      apply("item-update", "ADD", `churn-${number}`);
      apply("item-update", "DELETE", `churn-${number}`);
    }
    for (const projection of ["observed-server", "local-effective"] as const) {
      expect(readAgentCommandState({ ...input, projection, key: "unobserved" }, context)).toMatchObject({ presence: { state: "inconclusive", basis: "limited-history" } });
    }
    const clear = apply("clear-snapshot");
    const next = { ...context, projectionBoundary: clear, history: { ...context.history, retainedRange: { first: context.history.retainedRange!.first, last: clear } } };
    for (const projection of ["observed-server", "local-effective"] as const) {
      expect(readAgentCommandState({ ...input, projection, key: "unobserved" }, next)).toMatchObject({ presence: { state: "absent", basis: "clear-snapshot", provenance: { eventId: clear.eventId, evidenceRetained: true } }, history: { deletedKeysHasOlder: false, lifecycleHasOlder: true } });
      expect(projections.readKey(projection, { subscriptionId: "subscription", item: { name: "inventory", position: 2 }, key: "other" }).row?.fields.value).toBe("kept");
    }
    for (let number = 0; number < 2_049; number += 1) {
      apply("item-update", "ADD", `new-churn-${number}`);
      apply("item-update", "DELETE", `new-churn-${number}`);
    }
    expect(readAgentCommandState({ ...input, key: "unobserved" }, next)).toMatchObject({ presence: { state: "inconclusive", basis: "limited-history" }, history: { deletedKeysHasOlder: true } });
  });

  it("never publishes a retained range ahead of the applied projection read point", () => {
    const { context } = fixture();
    expect(readAgentCommandState(input, { ...context, history: { ...context.history, retainedRange: { first: context.history.retainedRange!.first, last: { intervalId: "interval", sequence: 10, eventId: "future" } } } })).toMatchObject({ readPoint: { committedEvidenceBoundary: { sequence: 1 }, retainedRange: { last: { sequence: 1 } } } });
  });
});
