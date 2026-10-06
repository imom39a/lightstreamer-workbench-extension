import { describe, expect, it, vi } from "vitest";
import { createCommandStateProjections } from "../src/core/command-state";
import { readAgentCommandRows, type AgentCommandRowsContext } from "../src/extension/panel/agent-command-rows";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { TopologySelectionTarget } from "../src/extension/panel/topology-view-model";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
describe("bounded current COMMAND row discovery", () => {
  it("pages existing active keys, rejects revision drift and separates local projection without snapshots", () => {
    const projections = createCommandStateProjections();
    const snapshot = vi.spyOn(projections, "snapshot");
    let sequence = 0;
    const apply = (command: string, key: string, synthetic = false, item = "rows") => {
      const id = `rows-${++sequence}`;
      const event: LightstreamerEventEnvelope = { id, timestamp: sequence, direction: "inbound", source: synthetic ? "synthetic" : "server", synthetic, kind: "item-update", subscription: { id: "sub", mode: "COMMAND", items: ["rows", "other"] }, item: { name: item, position: item === "rows" ? 1 : 2 }, update: { command, key, fields: { key, command, value: key } } };
      projections.apply(event, { intervalId: "interval", sequence, eventId: id });
    };
    for (const key of ["a", "b", "c", "d"]) apply("ADD", key);
    apply("DELETE", "b"); apply("ADD", "unrelated", false, "other");
    const input = { subscriptionId: "sub", item: { name: "rows", position: 1 }, limit: 2 };
    const first = projections.readRows("observed-server", input); if (first.status !== "ok") throw new Error(first.code);
    expect(first.keys).toEqual(["a", "c"]); expect(first.total).toBe(3);
    expect(projections.readRows("observed-server", { ...input, afterKey: first.nextKey!, revision: first.revision })).toMatchObject({ status: "ok", keys: ["d"], nextKey: null });
    apply("ADD", "local", true);
    expect(projections.readRows("observed-server", { ...input, afterKey: first.nextKey!, revision: first.revision })).toMatchObject({ status: "ok", keys: ["d"] });
    expect(projections.readRows("local-effective", { ...input, limit: 10 })).toMatchObject({ keys: ["a", "c", "d", "local"], total: 4 });
    apply("UPDATE", "a");
    expect(projections.readRows("observed-server", { ...input, afterKey: first.nextKey!, revision: first.revision })).toMatchObject({ status: "error", code: "PROJECTION_CHANGED" });
    expect(projections.readRows("observed-server", { ...input, limit: 101 })).toMatchObject({ status: "error", code: "INVALID_ARGUMENT" });
    const boundary = { intervalId: "interval", sequence, eventId: `rows-${sequence}` };
    const context: AgentCommandRowsContext = { pageEpoch: "page", disposed: false, projectionReady: true, projectionBoundary: boundary,
      scope: { kind: "subscription", subscription: { id: "sub", mode: "COMMAND", active: true, historical: false, serverEstablished: true, items: [{ name: "rows", position: 1 }] } } as unknown as TopologySelectionTarget,
      history: { ...createInMemoryEventHistory().status(), interval: { id: "interval", ordinal: 1 }, committedEvidenceBoundary: boundary, retainedRange: { first: { intervalId: "interval", sequence: 1, eventId: "rows-1" }, last: boundary } },
      readKey: (projection, target) => projections.readKey(projection, target), readRows: (projection, target) => projections.readRows(projection, target) };
    const rendered = readAgentCommandRows({ scopeId: "scope", pageEpoch: "page", projection: "local-effective", item: input.item, fields: ["value"], limit: 2 }, context);
    expect(rendered).toMatchObject({ status: "ok", total: 4, rows: [{ presence: { state: "present" }, fields: [{ name: "value", value: "a" }] }, { fields: [{ name: "value", value: "c" }] }] });
    expect(readAgentCommandRows({ scopeId: "scope", pageEpoch: "changed", projection: "local-effective", item: input.item }, context)).toMatchObject({ status: "error", problem: { code: "TARGET_CHANGED" } });
    expect(snapshot).not.toHaveBeenCalled();
    projections.clear();
    expect(projections.readRows("observed-server", input)).toMatchObject({ status: "ok", itemFound: false, total: 0, keys: [] });
  });
});
