import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { createIndexedDbEventHistory, transactionDone } from "../src/core/event-history-indexeddb";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import type { EvidenceQueryRequest } from "../src/core/evidence-filter-contract";

const request: EvidenceQueryRequest = { at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 10 }, filter: { revision: 1, text: "keep-category", criteria: {}, around: null, unsupported: [] }, find: { text: "exact-search-needle", scopeToFilter: true, size: 5 } };
const value = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
const event = (index: number) => {
  const item = createEventHistoryWorkloadEvent("ordinary-item-update", index, "exact-index");
  item.timestamp = index + 1;
  item.update!.fields = { ...item.update!.fields, category: index % 2 === 0 ? "keep-category" : "hide-category", text: "exact-search-needle Café 東京😀" };
  return item;
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(name: string, count = 600, retained = 1000) {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const options = { panelSessionId: name, capacity: { maxRetainedCount: retained } };
  const memory = await createMemoryEventHistoryForTests(options), durable = await createIndexedDbEventHistory(options);
  for (const history of [memory, durable]) await Promise.all(Array.from({ length: count }, (_, index) => history.offer(event(index)).settled));
  return { memory, durable };
}

async function changeBlocks(panelSessionId: string, change: (store: IDBObjectStore) => Promise<void> | void) {
  const database = await value(indexedDB.open(authoritativeEventDatabaseName(panelSessionId)));
  try {
    const transaction = database.transaction("searchBlocks", "readwrite");
    const done = transactionDone(transaction, "changing exact search test blocks");
    await change(transaction.objectStore("searchBlocks"));
    await done;
  } finally { database.close(); }
}

test("cold exact Find uses compact rows for complete Scope, Filter and Around without scanning full projections", async () => {
  const { memory, durable } = await setup("find-exact-cold");
  try {
    const base = await memory.query!(request);
    if (!base.ok) throw new Error(base.problem.message);
    const mode = base.value.page.evidence[0]!.facets.mode!;
    const client = base.value.page.evidence[0]!.facets.client!;
    const query = { ...request, filter: { ...request.filter, around: { intervalId: base.value.readPoint.interval.id, start: 101, end: 401 }, criteria: {
      mode: { include: [mode], exclude: [] },
      client: { include: [{ ...client, type: "structural-client", identity: "structural-client", value: client.label }], exclude: [] }
    } } };
    const expected = await memory.query!(query), actual = await durable.query!(query);
    if (!expected.ok || !actual.ok) throw new Error("Cold exact Find failed.");
    expect(actual.value.find).toEqual(expected.value.find);
    expect(actual.value.totals).toEqual({ matching: 300, inScope: 150 });
    expect(actual.value.telemetry?.projectionReads).toBeLessThan(100);
    expect(actual.value.telemetry?.fullEvidencePayloadHydrations).toBe(0);
    const changed = { ...query, find: { ...query.find, text: "CAFÉ  東京😀" } };
    const changedMemory = await memory.query!(changed), changedDurable = await durable.query!(changed);
    expect(changedDurable.ok && changedDurable.value.find).toEqual(changedMemory.ok && changedMemory.value.find);
    expect(changedDurable.ok && changedDurable.value.telemetry?.projectionReads).toBeLessThan(100);
  } finally { await memory.close(); await durable.close(); }
});

test("exact Find preserves Filter text whitespace semantics", async () => {
  const { memory, durable } = await setup("find-exact-filter-whitespace", 40, 100);
  try {
    for (const text of ["CATEGORY keep-category", "category  keep-category", "category\tkeep-category"]) {
      const query = { ...request, filter: { ...request.filter, text } };
      const expected = await memory.query!(query), actual = await durable.query!(query);
      expect(actual.ok && expected.ok).toBe(true);
      if (!actual.ok || !expected.ok) continue;
      expect(actual.value.find).toEqual(expected.value.find);
      expect(actual.value.totals).toEqual(expected.value.totals);
    }
    const normalized = await durable.query!({ ...request, filter: { ...request.filter, text: "category keep-category" } });
    expect(normalized).toMatchObject({ ok: true, value: { totals: { matching: 20 } } });
    const doubled = await durable.query!({ ...request, filter: { ...request.filter, text: "category  keep-category" } });
    expect(doubled).toMatchObject({ ok: true, value: { totals: { matching: 0, inScope: 0 }, find: { total: 0 } } });
  } finally { await memory.close(); await durable.close(); }
});

test("legacy missing exact blocks and partially appended exact suffixes fall back without losing matches", async () => {
  const name = "find-exact-legacy", { memory, durable } = await setup(name);
  try {
    await changeBlocks(name, store => { store.delete(IDBKeyRange.bound(-Number.MAX_SAFE_INTEGER, -1)); });
    const expected = await memory.query!(request), legacy = await durable.query!(request);
    expect(legacy.ok && legacy.value.find).toEqual(expected.ok && expected.value.find);
    expect(legacy.ok && legacy.value.telemetry!.projectionReads!).toBeGreaterThanOrEqual(600);
    for (const history of [memory, durable]) await history.offer(event(600)).settled;
    const appended = await durable.query!(request), appendedMemory = await memory.query!(request);
    expect(appended.ok && appended.value.find).toEqual(appendedMemory.ok && appendedMemory.value.find);
    expect(appended).toMatchObject({ ok: true, value: { find: { total: 301 } } });
  } finally { await memory.close(); await durable.close(); }
});

test("present damaged exact blocks fail closed instead of falling back to a partial answer", async () => {
  const name = "find-exact-corruption", { memory, durable } = await setup(name, 20);
  try {
    await changeBlocks(name, async store => { const block = await value(store.get(-1)); block.textDictionary[0] = "damaged-text"; store.put(block); });
    expect(await durable.query!(request)).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
  } finally { await memory.close(); await durable.close(); }
});

test("exact blocks honor latched appends and erase retained prefixes and Clear atomically", async () => {
  const name = "find-exact-retention", { memory, durable } = await setup(name, 550, 600);
  try {
    const before = await durable.query!(request);
    if (!before.ok) throw new Error(before.problem.message);
    for (const history of [memory, durable]) await history.offer(event(550)).settled;
    const latched = await durable.query!({ ...request, at: before.value.readPoint, find: { ...request.find!, text: "東京😀" } });
    const oracle = await memory.query!({ ...request, at: before.value.readPoint, find: { ...request.find!, text: "東京😀" } });
    expect(latched.ok && latched.value.find).toEqual(oracle.ok && oracle.value.find);
    for (const history of [memory, durable]) await Promise.all(Array.from({ length: 250 }, (_, index) => history.offer(event(551 + index)).settled));
    const boundary = durable.status().retainedRange!.first.sequence;
    await changeBlocks(name, async store => {
      const blocks = await value(store.getAll(IDBKeyRange.bound(-Number.MAX_SAFE_INTEGER, -1)));
      expect(blocks.every(block => block.firstSequence >= boundary)).toBe(true);
      expect(blocks.every(block => block.eventIds.every((id: string) => Number(id.split("-").at(-1)) + 1 >= boundary))).toBe(true);
    });
    const retained = await durable.query!(request), retainedMemory = await memory.query!(request);
    expect(retained.ok && retained.value.find).toEqual(retainedMemory.ok && retainedMemory.value.find);
    await durable.clear();
    await changeBlocks(name, async store => { expect(await value(store.count())).toBe(0); });
    expect(await durable.query!(request)).toMatchObject({ ok: true, value: { find: { total: 0 } } });
  } finally { await memory.close(); await durable.close(); }
});

test("startup rejects a damaged present exact block while legacy absence stays readable", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const name = "find-exact-startup", options = { panelSessionId: name, clearJournal: async () => false };
  const history = await createIndexedDbEventHistory(options);
  await history.offer(event(0)).settled;
  await history.close();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await changeBlocks(name, async store => { const block = await value(store.get(-1)); block.textDictionary[0] = "damaged"; store.put(block); });
  await expect(createIndexedDbEventHistory(options)).rejects.toThrow(/Corrupt exact search/);
  await changeBlocks(name, store => { store.delete(-1); });
  const legacy = await createIndexedDbEventHistory({ panelSessionId: name });
  try { expect(await legacy.query!(request)).toMatchObject({ ok: true, value: { find: { total: 1 } } }); }
  finally { await legacy.close(); }
});
