import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { EvidenceFieldPredicate } from "../src/core/evidence-field-analytics";
const event = (index: number): LightstreamerEventEnvelope => ({ id: `field-${index}`, logicalEventId: index < 2 ? "same-update" : index === 4 ? undefined : `update-${index}`, timestamp: index * 100, direction: "inbound", source: "server", synthetic: false, kind: "item-update",
  client: { id: "client", sessionId: "session" }, subscription: { id: "sub", mode: "COMMAND", fields: ["key", "command", "quantity", "optional", "password", "document"] }, item: { name: "rows", position: 1 },
  update: { isSnapshot: false, key: `key-${index}`, command: "ADD", fields: { key: `key-${index}`, command: "ADD", quantity: index === 3 ? "invalid" : String(index), optional: null, password: "secret-value", document: '{"token":"hidden"}' }, changedFields: index % 2 === 0 ? { quantity: String(index) } : {}, fieldValueStates: { optional: index === 0 ? "concrete" : index === 1 ? "redacted" : "ambiguous-null" } } });
const filter = { revision: 1, text: "", criteria: {}, around: null, unsupported: [] };
describe.each(["memory", "indexeddb", "volatile"] as const)("typed fields and analytics (%s)", tier => {
  it("filters declared fields with explicit certainty/conversion and binds continuation", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `field-predicates-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      await Promise.all(Array.from({ length: 5 }, (_, i) => history.offer(event(i)).settled));
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 1 }, filter };
      const run = (fieldPredicates: EvidenceFieldPredicate[]) => history.query!({ ...request, fieldPredicates });
      expect(await run([{ field: "optional", op: "eq", value: null }])).toMatchObject({ ok: true, value: { totals: { matching: 1 } } });
      expect(await run([{ field: "optional", op: "value-state", state: "ambiguous-null" }])).toMatchObject({ ok: true, value: { totals: { matching: 3 } } });
      expect(await run([{ field: "password", op: "eq", value: "secret-value" }])).toMatchObject({ ok: true, value: { totals: { matching: 0 } } });
      expect(await run([{ field: "document", op: "eq", value: '{"token":"hidden"}' }])).toMatchObject({ ok: true, value: { totals: { matching: 0 } } });
      expect(await run([{ field: "password", op: "value-state", state: "redacted" }])).toMatchObject({ ok: true, value: { totals: { matching: 5 } } });
      expect(await run([{ field: "missing", op: "exists", present: false }])).toMatchObject({ ok: true, value: { totals: { matching: 5 } } });
      expect(await run([{ field: "quantity", op: "changed" }])).toMatchObject({ ok: true, value: { totals: { matching: 3 } } });
      const predicates: EvidenceFieldPredicate[] = [{ field: "quantity", op: "range", type: "number", convert: "number-string", min: 1 }];
      const first = await run(predicates); if (!first.ok) throw new Error(first.problem.message);
      expect(first.value.totals.matching).toBe(3);
      expect(first.value.fieldEvaluation?.numericConversionFailures).toBe(1);
      expect(first.value.page.evidence[0]!.identity.eventId).toBe("field-1");
      const second = await history.query!({ ...request, at: first.value.readPoint, fieldPredicates: predicates, page: { ...request.page, cursor: first.value.page.nextCursor! } });
      expect(second.ok && second.value.page.evidence[0]!.identity.eventId).toBe("field-2");
      expect(await history.query!({ ...request, at: first.value.readPoint, fieldPredicates: [{ field: "quantity", op: "eq", value: "2" }], page: { ...request.page, cursor: first.value.page.nextCursor! } })).toMatchObject({ ok: false });
      expect(await history.query!({ ...request, fieldPredicates: predicates, workBudget: { maxPayloadHydrations: 1 } })).toMatchObject({ ok: false, problem: { code: "QUERY_WORK_BUDGET_EXCEEDED" } });
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
  it("counts explicit logical units with bounded groups and credential-safe field states", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `field-aggregate-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      await Promise.all(Array.from({ length: 5 }, (_, i) => history.offer(event(i)).settled));
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 1 }, filter };
      const result = await history.query!({ ...request, aggregate: { unit: "distinct-logical-updates", groupBy: ["quantity"], maxGroups: 1, timeBucketMs: 200 } });
      expect(result).toMatchObject({ ok: true, value: { aggregate: { count: 3, matchingEvidenceRecords: 5, missingLogicalIds: 1, omittedGroups: 2, omittedGroupRecords: 2, groups: [{ count: 1, bucketStart: 0 }] } } });
      const safe = await history.query!({ ...request, aggregate: { unit: "evidence-records", groupBy: ["password"] } });
      expect(safe).toMatchObject({ ok: true, value: { aggregate: { count: 5, groups: [{ values: [{ field: "password", state: "redacted" }], count: 5 }] } } });
      expect(safe.ok && JSON.stringify(safe.value.aggregate)).not.toContain("secret-value");
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
  it("redacts credentials nested inside encoded JSON strings before filtering or grouping", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `nested-credentials-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      const encoded = JSON.stringify({ nested: JSON.stringify([{ token: "private-guess" }]) });
      const captured = event(0); captured.update!.fields!.document = encoded;
      await history.offer(captured).settled;
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 1 }, filter };
      for (const predicate of [
        { field: "document", op: "eq", value: encoded },
        { field: "document", op: "in", values: [encoded] },
        { field: "document", op: "range", type: "string", min: encoded, max: encoded }
      ] satisfies EvidenceFieldPredicate[]) {
        expect(await history.query!({ ...request, fieldPredicates: [predicate] })).toMatchObject({ ok: true, value: { totals: { matching: 0 } } });
      }
      expect(await history.query!({ ...request, fieldPredicates: [{ field: "document", op: "value-state", state: "redacted" }] })).toMatchObject({ ok: true, value: { totals: { matching: 1 } } });
      const grouped = await history.query!({ ...request, aggregate: { unit: "evidence-records", groupBy: ["document"] } });
      expect(grouped).toMatchObject({ ok: true, value: { aggregate: { groups: [{ values: [{ field: "document", state: "redacted" }], count: 1 }] } } });
      expect(grouped.ok && JSON.stringify(grouped.value.aggregate)).not.toContain("private-guess");
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
});
