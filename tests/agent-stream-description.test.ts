import { describe, expect, it } from "vitest";
import type { DeterministicEvidenceRecord } from "../src/core/evidence-filter-contract";
import { AGENT_STREAM_DISCOVERY_LIMITS, describeAgentStreams } from "../src/extension/panel/agent-stream-description";

function record(sequence: number, update: Record<string, unknown> | null, options: { subscription?: string; item?: string | null; position?: number; client?: string; session?: string; page?: string; listener?: string; kind?: string; logicalEventId?: string; facets?: DeterministicEvidenceRecord["facets"] } = {}): DeterministicEvidenceRecord {
  const payload = {
    kind: options.kind ?? (update ? "item-update" : "subscription-started"),
    client: { id: options.client ?? "client-1", sessionId: options.session ?? "session-1" },
    subscription: { id: options.subscription ?? "sub-1", fields: ["command", "key", "qty"] },
    item: { ...(options.item === null ? {} : { name: options.item ?? "orders" }), position: options.position ?? 1 },
    listener: { id: options.listener ?? "listener-1" },
    ...(options.logicalEventId ? { logicalEventId: options.logicalEventId } : {}),
    ...(update ? { update } : {})
  };
  return { identity: { intervalId: "interval-1", pageId: options.page ?? "page-1", ownerId: "owner-1", sequence, eventId: `event-${sequence}` }, timestamp: sequence, summary: "DO NOT READ", searchText: "DO NOT READ", facets: options.facets ?? {}, payload };
}

describe("agent stream description", () => {
  it("keeps declared fields separate and describes heterogeneous observed types and JSON string shapes", () => {
    const rows = [
      record(1, { fields: { qty: 12, active: true, details: '{"side":"buy","meta":{"lot":4}}' }, changedFields: { qty: 12 } }),
      record(2, { fields: { qty: "12", details: '[{"side":"sell"}]' }, fieldValueStates: { qty: "concrete" } }, { listener: "listener-2" }),
      record(3, { fields: { maybe: null, hidden: "must-not-show" }, fieldValueStates: { maybe: "ambiguous-null", hidden: "redacted" } })
    ];
    const result = describeAgentStreams({ records: rows, declaredFields: [{ subscriptionIdentity: JSON.stringify(["agent-subscription-v1", "page-1", "client-1", "session-1", "sub-1"]), fields: ["declared", "qty"] }] });
    expect(result.streams).toHaveLength(1);
    const stream = result.streams[0];
    expect(stream.declaredFields).toEqual(["command", "declared", "key", "qty"]);
    expect(stream.observedFields.find(field => field.name === "qty")).toMatchObject({ types: ["number", "string"], states: ["concrete"] });
    expect(stream.observedFields.find(field => field.name === "details")?.jsonShapes).toEqual([
      "json-array array[{side:string}]",
      'json-object {meta:{lot:number},side:string}'
    ]);
    expect(stream.observedFields.find(field => field.name === "maybe")).toMatchObject({ types: [], states: ["ambiguous-null"] });
    expect(stream.observedFields.find(field => field.name === "hidden")).toMatchObject({ types: [], states: ["redacted"] });
    expect(JSON.stringify(result)).not.toContain("must-not-show");
    expect(JSON.stringify(result)).not.toContain("DO NOT READ");
  });

  it("counts Evidence records and Update Deliveries without claiming unidentified Logical Update deduplication", () => {
    const result = describeAgentStreams({ records: [
      record(1, { command: "ADD", fields: { qty: 1 } }, { logicalEventId: "logical-1" }),
      record(2, { command: "ADD", fields: { qty: 1 } }, { listener: "listener-2", logicalEventId: "logical-1" }),
      record(3, { command: "UPDATE", fields: { qty: 2 } }),
      record(4, null)
    ] });
    expect(result.totals).toEqual({ evidenceRecords: 4, itemUpdateEvidenceRecords: 3, identifiedLogicalUpdates: 1, unidentifiedLogicalUpdateDeliveries: 1 });
    expect(result.streams[0]).toMatchObject({ evidenceRecords: 4, itemUpdateEvidenceRecords: 3, identifiedLogicalUpdates: 1, unidentifiedLogicalUpdateDeliveries: 1 });
    expect(result.streams[0].examples.map(example => example.operation).sort()).toEqual(["ADD", "UPDATE", null].sort());
  });

  it("selects references across kinds, operations, and observed shapes with exact Evidence identities", () => {
    const input = [
      record(1, { command: "ADD", fields: { a: 1 } }),
      record(2, { command: "UPDATE", fields: { b: "x" } }),
      record(3, null, { kind: "subscription-started" }),
      record(4, { command: "DELETE", fields: { key: "secret-value" } })
    ];
    const result = describeAgentStreams({ records: input });
    expect(result.streams[0].examples.map(example => example.identity).sort((a, b) => a.sequence - b.sequence)).toEqual(input.map(row => row.identity));
    expect(new Set(result.streams[0].examples.map(example => example.kind))).toEqual(new Set(["item-update", "subscription-started"]));
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("distinguishes JSON-encoded shape variants in representative Evidence references", () => {
    const input = [
      record(1, { command: "UPDATE", fields: { payload: '{"side":"buy"}' } }),
      record(2, { command: "UPDATE", fields: { payload: '[{"side":"sell"}]' } })
    ];
    const result = describeAgentStreams({ records: input });
    expect(result.streams[0].examples.map(example => example.identity)).toEqual(input.map(row => row.identity));
    expect(new Set(result.streams[0].examples.map(example => example.shape)).size).toBe(2);
    expect(result.streams[0].observedFields.find(field => field.name === "payload")?.types).toEqual(["string"]);
  });

  it("keeps subscriptions and items separate", () => {
    const result = describeAgentStreams({ records: [record(1, { fields: { a: 1 } }), record(2, { fields: { b: 2 } }, { subscription: "sub-2" }), record(3, { fields: { c: 3 } }, { item: "fills" })] });
    expect(result.streams.map(stream => [stream.subscriptionId, stream.item])).toEqual([["sub-1", "fills"], ["sub-1", "orders"], ["sub-2", "orders"]]);
  });

  it("keeps reused subscription ids in different client and page scopes separate", () => {
    const result = describeAgentStreams({ records: [
      record(1, { fields: { qty: 1 } }, { client: "client-a", session: "session-a", item: null }),
      record(2, { fields: { qty: 2 } }, { client: "client-b", session: "session-b", item: null }),
      record(3, { fields: { qty: 3 } }, { client: "client-a", session: "session-a", page: "page-2", item: null })
    ] });
    expect(result.streams).toHaveLength(3);
    expect(new Set(result.streams.map(stream => stream.scopeIdentity)).size).toBe(3);
    expect(result.streams.every(stream => stream.item === null && stream.itemPosition === 1)).toBe(true);
  });

  it("omits oversized canonical identities without truncating or colliding them", () => {
    const oversizedIdentity = "s".repeat(AGENT_STREAM_DISCOVERY_LIMITS.identityBytes + 1);
    const row = record(1, { fields: { qty: 1 } }, { facets: {
      subscription: { facet: "subscription", type: "identity", value: "sub-1", label: "sub-1", identity: oversizedIdentity }
    } });
    const result = describeAgentStreams({ records: [row], completeness: "COMPLETE" });
    expect(result.streams).toEqual([]);
    expect(result.profileOmissions.identities).toBeGreaterThan(0);
    expect(result.profileOmissions.streams).toBeGreaterThan(0);
    expect(result.completeness).toBe("LIMITED");
    expect(JSON.stringify(result)).not.toContain(oversizedIdentity);
  });

  it("reports bounded raw mode, provenance, and phase enum values", () => {
    const facet = (name: "mode" | "provenance" | "phase", value: string) => ({ facet: name, type: "enum", value, label: value, identity: value });
    const result = describeAgentStreams({ records: [
      record(1, { fields: { qty: 1 } }, { facets: { mode: facet("mode", "COMMAND"), provenance: facet("provenance", "SERVER"), phase: facet("phase", "LIVE") } }),
      record(2, { fields: { qty: 2 } }, { facets: { mode: facet("mode", "MERGE"), provenance: facet("provenance", "LOCAL"), phase: facet("phase", "SNAPSHOT") } })
    ] });
    expect(result.streams[0]).toMatchObject({
      modes: ["COMMAND", "MERGE"],
      provenances: ["LOCAL", "SERVER"],
      phases: ["LIVE", "SNAPSHOT"]
    });
  });

  it("bounds Unicode JSON shapes and wide example signatures in UTF-8 bytes", () => {
    const wideJson = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`字段${index}${"界".repeat(14)}`, index]));
    const wideFields = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`字段${index}${"界".repeat(35)}`, index]));
    const result = describeAgentStreams({ records: [
      record(1, { fields: { payload: JSON.stringify(wideJson), ...wideFields } })
    ], completeness: "COMPLETE" });
    const stream = result.streams[0];
    const encodedJsonShape = stream.observedFields.find(field => field.name === "payload")?.jsonShapes[0];
    expect(encodedJsonShape).toBeDefined();
    expect(new TextEncoder().encode(encodedJsonShape!).byteLength).toBeLessThanOrEqual(AGENT_STREAM_DISCOVERY_LIMITS.shapeBytes);
    expect(stream.examples[0].shape.endsWith("…")).toBe(true);
    expect(new TextEncoder().encode(stream.examples[0].shape).byteLength).toBeLessThanOrEqual(AGENT_STREAM_DISCOVERY_LIMITS.shapeBytes);
    expect(result.profileOmissions.jsonShapes).toBeGreaterThan(0);
    expect(result.completeness).toBe("LIMITED");
  });

  it("treats concrete null on Local Evidence as a concrete null type", () => {
    const local = record(1, { fields: { value: null } }, { kind: "item-update" });
    (local.payload as any).synthetic = true;
    (local.payload as any).source = "synthetic";
    const result = describeAgentStreams({ records: [local] });
    expect(result.streams[0].observedFields.find(field => field.name === "value")).toMatchObject({ types: ["null"], states: ["concrete"] });
  });

  it("caps aggregate JSON parse work and marks the bounded profile incomplete", () => {
    const encoded = JSON.stringify({ value: "x".repeat(9_000) });
    const rows = Array.from({ length: 80 }, (_, index) => record(index + 1, { fields: { payload: encoded } }));
    const result = describeAgentStreams({ records: rows, limit: 80, completeness: "COMPLETE" });
    expect(result.profileOmissions.jsonShapes).toBeGreaterThan(0);
    expect(result.sample.capped).toBe(true);
    expect(result.completeness).toBe("LIMITED");
  });

  it("bounds page, fields, names, JSON parsing, depth, shape nodes, streams, and examples", () => {
    const huge = "{" + '"private":"'.concat("x".repeat(AGENT_STREAM_DISCOVERY_LIMITS.jsonBytes), '"}');
    const wide = Object.fromEntries(Array.from({ length: AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream + 20 }, (_, i) => [`f${i}`, i]));
    const rows = Array.from({ length: AGENT_STREAM_DISCOVERY_LIMITS.records + 1 }, (_, i) => record(i + 1, { command: `OP-${i}`, fields: { payload: huge, ...wide } }));
    const result = describeAgentStreams({ records: rows, limit: rows.length, completeness: "COMPLETE" });
    expect(result.sample).toMatchObject({ evidenceRecords: AGENT_STREAM_DISCOVERY_LIMITS.records, requestedLimit: AGENT_STREAM_DISCOVERY_LIMITS.records, capped: true });
    expect(result.completeness).toBe("LIMITED");
    expect(result.profileOmissions.evidenceRecords).toBe(1);
    expect(result.profileOmissions.fields).toBeGreaterThan(0);
    expect(result.streams[0].observedFields.length).toBeLessThanOrEqual(AGENT_STREAM_DISCOVERY_LIMITS.fieldsPerStream);
    expect(result.streams[0].examples.length).toBeLessThanOrEqual(AGENT_STREAM_DISCOVERY_LIMITS.examplesPerStream);
    expect(result.streams[0].observedFields.find(field => field.name === "payload")?.jsonShapes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("x".repeat(100));
  });

  it("retains caller read point and completeness metadata", () => {
    const readPoint = { interval: { id: "interval-1", ordinal: 2 }, committedEvidenceBoundary: null, retainedRange: null } as const;
    const result = describeAgentStreams({ records: [], readPoint, window: "OLDEST_FIRST", completeness: "LIMITED" });
    expect(result.readPoint).toEqual(readPoint);
    expect(result.completeness).toBe("LIMITED");
    expect(result.sample).toMatchObject({ evidenceRecords: 0, window: "OLDEST_FIRST", capped: false });
  });
});
