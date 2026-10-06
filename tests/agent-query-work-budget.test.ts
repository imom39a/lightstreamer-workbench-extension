import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { reanchorEvidenceQueryCursor } from "../src/core/evidence-filter-cursor";
import { reanchorFacetDiscoveryCursor } from "../src/core/evidence-filter-discovery";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const event = (index: number): LightstreamerEventEnvelope => ({ id: `work-${index}`, timestamp: index, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update", client: { id: "client", sessionId: "session" }, subscription: { id: "sub", mode: "COMMAND" }, item: { name: "rows", position: 1 }, update: { isSnapshot: false, key: `key-${index}`, command: "ADD", fields: { key: `key-${index}`, command: "ADD", wide: '\\"\n'.repeat(400) } } });
const filter = { revision: 1, text: "", criteria: {}, around: null, unsupported: [] };

describe.each(["memory", "indexeddb", "volatile"] as const)("query computation budgets (%s)", tier => {
  it("fails explicitly on scan/hydration budgets and leaves exact totals absent", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `work-budget-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      await Promise.all(Array.from({ length: 12 }, (_, i) => history.offer(event(i)).settled));
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 6 }, filter };
      const scan = await history.query!({ ...request, filter: { ...filter, text: "absent short expression" }, workBudget: { maxProjectionReads: 2 } });
      expect(scan).toMatchObject({ ok: false, problem: { code: "QUERY_WORK_BUDGET_EXCEEDED" } });
      expect("value" in scan).toBe(false);
      expect(await history.query!({ ...request, includePayload: true, workBudget: { maxPayloadHydrations: 2 } })).toMatchObject({ ok: false, problem: { code: "QUERY_WORK_BUDGET_EXCEEDED" } });
      expect(await history.query!({ ...request, workBudget: { deadlineMs: 0 } })).toMatchObject({ ok: false, problem: { code: "QUERY_WORK_BUDGET_EXCEEDED" } });
      const window = await history.query!({ ...request, sequenceWindow: { after: 8, through: 11 }, workBudget: { maxProjectionReads: 4 } });
      expect(window.ok && window.value.totals.matching).toBe(3);
      expect(window.ok && window.value.page.evidence.map(record => record.identity.sequence)).toEqual([9, 10, 11]);
      expect(await history.query!({ ...request, sequenceWindow: { after: 11, through: 11 } })).toMatchObject({ ok: true, value: { totals: { matching: 0 }, page: { evidence: [] } } });
      expect(await history.query!({ ...request, sequenceWindow: { after: 11, through: 100 } })).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
      const healthy = await history.query!(request);
      expect(healthy.ok && healthy.value.totals.matching).toBe(12);
      if (!healthy.ok) throw new Error(healthy.problem.message);
      const identity = healthy.value.page.evidence[0]!.identity;
      const reference = { intervalId: identity.intervalId, sequence: identity.sequence, eventId: identity.eventId };
      expect(await history.resolveIdentity!(reference)).toEqual(identity);
      expect(await history.resolveIdentity!({ ...reference, eventId: "different-event" })).toBeNull();
      expect(await history.resolveIdentity!({ ...reference, sequence: 1000 })).toBeNull();
      await history.clear();
      expect(await history.resolveIdentity!(reference)).toBeNull();
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
  it("refuses a retained sequence window overtaken by retention", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `window-retention-${tier}`, capacity: { maxRetainedCount: 4 }, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      for (let i = 0; i < 8; i++) await history.offer(event(i)).settled;
      expect(await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 2 }, filter, sequenceWindow: { after: 0 } })).toMatchObject({ ok: false, problem: { code: "SEQUENCE_WINDOW_UNAVAILABLE" } });
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
  it("reanchors terminal Evidence and discovery pages without skipping omitted tails", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { panelSessionId: `fit-prefix-${tier}`, ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("journal unavailable"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    try {
      await Promise.all(Array.from({ length: 6 }, (_, i) => history.offer(event(i)).settled));
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 6, adaptiveSize: true }, filter };
      const initial = await history.query!(request); if (!initial.ok) throw new Error(initial.problem.message);
      expect(initial.value.page.nextCursor).toBeNull();
      const windowRequest = { ...request, at: initial.value.readPoint, page: { ...request.page, size: 2 }, sequenceWindow: { after: 1, through: 5 } };
      const windowFirst = await history.query!(windowRequest); if (!windowFirst.ok) throw new Error(windowFirst.problem.message);
      expect(windowFirst.value.totals.matching).toBe(4);
      expect(windowFirst.value.page.evidence.map(record => record.identity.sequence)).toEqual([2, 3]);
      const windowNext = await history.query!({ ...windowRequest, page: { ...windowRequest.page, cursor: windowFirst.value.page.nextCursor! } });
      expect(windowNext.ok && windowNext.value.page.evidence.map(record => record.identity.sequence)).toEqual([4, 5]);
      expect(await history.query!({ ...windowRequest, sequenceWindow: { after: 0, through: 5 }, page: { ...windowRequest.page, cursor: windowFirst.value.page.nextCursor! } })).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
      const next = await history.query!({ ...request, at: initial.value.readPoint, page: { ...request.page, cursor: reanchorEvidenceQueryCursor(initial.value.page.resumeCursor!, initial.value.page.evidence[1]!.identity) } });
      expect(next.ok && next.value.page.evidence.map(record => record.identity.eventId)).toEqual(["work-2", "work-3", "work-4", "work-5"]);
      const discovery = { facet: "key", size: 6, scopeToFilter: true };
      const summary = await history.query!({ ...request, discover: [discovery] }); if (!summary.ok) throw new Error(summary.problem.message);
      const found = summary.value.discoveries.get("key")!; if (found.state !== "AVAILABLE") throw new Error("Discovery unavailable");
      expect(found.nextCursor).toBeNull();
      const prefix = found.values.slice(0, 2);
      const continued = await history.query!({ ...request, at: summary.value.readPoint, discover: [{ ...discovery, cursor: reanchorFacetDiscoveryCursor(found.resumeCursor!, prefix, found.values.length - prefix.length) }] });
      const tail = continued.ok ? continued.value.discoveries.get("key") : undefined;
      expect(tail?.state).toBe("AVAILABLE");
      expect(tail?.values.map(value => value.value.value)).toEqual(["key-2", "key-3", "key-4", "key-5"]);
    } finally { await history.close(); vi.unstubAllGlobals(); }
  });
});

it("yields a memory residual scan so a queued cancellation interrupts it", async () => {
  const history = await createMemoryEventHistoryForTests({ panelSessionId: "cooperative-memory-scan" });
  try {
    await Promise.all(Array.from({ length: 1024 }, (_, i) => history.offer(event(i)).settled));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 2 }, filter: { ...filter, text: "xx" }, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
  } finally { await history.close(); }
});
