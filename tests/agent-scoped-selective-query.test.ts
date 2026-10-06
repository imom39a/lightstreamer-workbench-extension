import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createMemoryEventHistoryForTests, type EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
import { createEvidenceInvestigationQuery } from "../src/extension/panel/evidence-investigation-query";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(index: number, sessionId = "session-a"): LightstreamerEventEnvelope {
  return { id: `${sessionId}-${index}`, timestamp: index, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client", sessionId }, subscription: { id: index % 2 ? "other" : "same-label", mode: "COMMAND", items: ["rows"], fields: ["key", "command", "quantity"] },
    item: { name: "rows", position: 1 }, update: { isSnapshot: false, key: index % 20 === 0 ? "RARE" : "common", command: "ADD", fields: { key: index % 20 === 0 ? "RARE" : "common", command: "ADD", quantity: index } } };
}

describe.each(["memory", "indexeddb", "volatile"] as const)("selective scoped queries (%s)", tier => {
  it("keeps first/continued rare-key work selective and exact under Capture, excludes, Clear and owner identity", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `scoped-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("unavailable journal"); } } : {}) };
    const history: EventHistory = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      await Promise.all(Array.from({ length: 200 }, (_, i) => history.offer(event(i)).settled));
      await Promise.all(Array.from({ length: 40 }, (_, i) => history.offer(event(i, "session-b")).settled));
      const query = createEvidenceInvestigationQuery({ query: request => history.query!(request) });
      const filter = { ...createFilter(), criteria: { key: { include: [createTypedFilterValue("key", "string", "RARE")], exclude: [] } } };
      const request = { at: "LATEST_COMMITTED" as const, scope: { kind: "ITEM" as const, clientId: "client", sessionId: "session-a", subscriptionId: "same-label", item: "rows", itemPosition: 1 }, filter,
        page: { order: "OLDEST_FIRST" as const, size: 2 }, discover: [] };
      const first = await query.query(request);
      expect(first.ok).toBe(true); if (!first.ok) throw new Error(first.problem.message);
      expect(first.value.totals.matching).toBe(10);
      expect(first.value.telemetry?.projectionReads).toBeLessThan(20);
      expect(first.value.telemetry?.fullRetainedScan).toBe(false);
      expect(first.value.page.evidence.map(record => record.identity.eventId)).toEqual(["session-a-0", "session-a-20"]);
      await history.offer(event(240)).settled;
      const next = await query.query({ ...request, at: first.value.readPoint, page: { ...request.page, cursor: first.value.page.nextCursor! } });
      expect(next.ok).toBe(true); if (!next.ok) throw new Error(next.problem.message);
      expect(next.value.totals.matching).toBe(10);
      expect(next.value.telemetry?.projectionReads).toBeLessThan(20);
      expect(next.value.page.evidence.map(record => record.identity.eventId)).toEqual(["session-a-40", "session-a-60"]);
      // Legacy scalar includes require residual evaluation; an independent key driver remains safe.
      const mixed = await history.query!({ at: first.value.readPoint, page: request.page,
        filter: { revision: 1, text: "", around: null, unsupported: [], criteria: {
          key: { include: [first.value.page.evidence[0]!.facets.key!], exclude: [] },
          subscription: { include: [{ facet: "subscription", type: "string", value: "same-label", label: "same-label", identity: '["v1","subscription","string","same-label"]' }, first.value.page.evidence[0]!.facets.subscription!], exclude: [] }
        } } });
      expect(mixed.ok && mixed.value.totals.matching).toBe(10);
      expect(mixed.ok && mixed.value.telemetry?.projectionReads).toBeLessThan(20);
      const excluded = await query.query({ ...request, filter: { ...filter, criteria: { ...filter.criteria, session: { include: [], exclude: [createTypedFilterValue("session", "string", "session-a")] } } } });
      expect(excluded.ok && excluded.value.totals.matching).toBe(0);
      await history.clear();
      expect(await query.query({ ...request, at: first.value.readPoint })).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
  it("continues plain pages in both directions without scanning retained history", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const history = tier === "memory" ? await createMemoryEventHistoryForTests({ panelSessionId: `plain-${tier}` }) : await createIndexedDbEventHistory({ panelSessionId: `plain-${tier}` });
    try {
      await Promise.all(Array.from({ length: 40 }, (_, i) => history.offer(event(i)).settled));
      for (const order of ["OLDEST_FIRST", "NEWEST_FIRST"] as const) {
        const request = { at: "LATEST_COMMITTED" as const, page: { order, size: 2 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } };
        const first = await history.query!(request); if (!first.ok) throw new Error(first.problem.message);
        const next = await history.query!({ ...request, at: first.value.readPoint, page: { ...request.page, cursor: first.value.page.nextCursor! } });
        expect(next.ok && next.value.page.evidence.map(record => record.identity.sequence)).toEqual(order === "OLDEST_FIRST" ? [3, 4] : [38, 37]);
        expect(next.ok && next.value.telemetry?.projectionReads).toBeLessThan(5);
      }
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
});
