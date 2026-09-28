import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { createIndexedDbEventHistory, transactionDone } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import type { EvidenceQueryRequest } from "../src/core/evidence-filter-contract";

const request: EvidenceQueryRequest = { at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 2 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }, find: { text: "ordinary", scopeToFilter: true } };
const value = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
const event = (index: number) => createEventHistoryWorkloadEvent("ordinary-item-update", index, "coverage");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(name: string) {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const history = await createIndexedDbEventHistory({ panelSessionId: name });
  await Promise.all(Array.from({ length: 10 }, (_, index) => history.offer(event(index)).settled));
  return history;
}

test("full-range and latched-prefix Find count each covered partition only once per store", async () => {
  const history = await setup("find-range-scan-bound");
  try {
    const count = vi.spyOn(IDBObjectStore.prototype, "count");
    const first = await history.query!(request);
    if (!first.ok) throw new Error(first.problem.message);
    const counts = () => count.mock.calls.flatMap((args, index) => ["evidence", "queryProjections"].includes((count.mock.contexts[index] as IDBObjectStore).name) ? [{ store: (count.mock.contexts[index] as IDBObjectStore).name, range: args[0] }] : []);
    expect(counts()).toEqual([{ store: "queryProjections", range: undefined }, { store: "evidence", range: undefined }]);
    await history.offer(event(10)).settled;
    count.mockClear();
    const subset = await history.query!({ ...request, at: first.value.readPoint });
    expect(subset.ok && subset.value.find).toEqual(first.value.find);
    expect(counts()).toHaveLength(4);
    expect(counts().map(call => call.range instanceof IDBKeyRange ? [call.range.lower, call.range.upper] : null))
      .toEqual([[1, 10], [1, 10], [11, 11], [11, 11]]);
  } finally { await history.close(); }
});

test.each(["evidence", "queryProjections", "both"])("full-range Find rejects same-count %s rows moved outside its boundaries", async damage => {
  const panelSessionId = `find-range-corruption-${damage}`;
  const history = await setup(panelSessionId);
  try {
    const coherent = await history.query!(request);
    expect(coherent.ok).toBe(true);
    const database = await value(indexedDB.open(authoritativeEventDatabaseName(panelSessionId)));
    try {
      const stores = damage === "both" ? ["evidence", "queryProjections"] : [damage];
      const transaction = database.transaction(stores, "readwrite");
      const done = transactionDone(transaction, "damaging coverage test rows");
      await Promise.all(stores.map(async name => {
        const store = transaction.objectStore(name);
        const record = await value(store.get(5));
        store.delete(5); store.put({ ...record, sequence: 0 });
      }));
      await done;
    } finally { database.close(); }
    expect(await history.query!(request)).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
  } finally { await history.close(); }
});

test("full-range Find checks an upper boundary substitution and empty journals", async () => {
  const panelSessionId = "find-upper-range-corruption";
  const history = await setup(panelSessionId);
  try {
    const database = await value(indexedDB.open(authoritativeEventDatabaseName(panelSessionId)));
    try {
      const transaction = database.transaction(["evidence", "queryProjections"], "readwrite");
      const done = transactionDone(transaction, "damaging upper coverage rows");
      await Promise.all(["evidence", "queryProjections"].map(async name => {
        const store = transaction.objectStore(name); const record = await value(store.get(5));
        store.delete(5); store.put({ ...record, sequence: 11 });
      }));
      await done;
    } finally { database.close(); }
    expect(await history.query!(request)).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await history.clear();
    expect(await history.query!(request)).toMatchObject({ ok: true, value: { totals: { matching: 0, inScope: 0 }, find: { total: 0 } } });
  } finally { await history.close(); }
});


test("interior subsets keep exact partition checks and reject damage outside the requested rows", async () => {
  const name = "find-interior-coverage", history = await setup(name);
  try {
    const all = await history.query!({ ...request, page: { order: "OLDEST_FIRST", size: 10 } });
    if (!all.ok) throw new Error(all.problem.message);
    const point = { ...all.value.readPoint, committedEvidenceBoundary: all.value.page.evidence[7]!.identity,
      retainedRange: { first: all.value.page.evidence[2]!.identity, last: all.value.page.evidence[7]!.identity } };
    const count = vi.spyOn(IDBObjectStore.prototype, "count");
    const subset = await history.query!({ ...request, at: point });
    expect(subset).toMatchObject({ ok: true, value: { find: { total: 6 } } });
    const ranges = count.mock.calls.flatMap((args, index) => ["evidence", "queryProjections"].includes((count.mock.contexts[index] as IDBObjectStore).name)
      ? [args[0] instanceof IDBKeyRange ? [args[0].lower, args[0].upper] : null] : []);
    expect(ranges).toEqual([[1, 2], [1, 2], [3, 8], [3, 8], [9, 10], [9, 10]]);
    const database = await value(indexedDB.open(authoritativeEventDatabaseName(name)));
    try {
      const transaction = database.transaction("queryProjections", "readwrite");
      const done = transactionDone(transaction, "damaging outside subset coverage");
      transaction.objectStore("queryProjections").delete(9);
      await done;
    } finally { database.close(); }
    expect(await history.query!({ ...request, at: point })).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
  } finally { await history.close(); }
});

test("an empty latched snapshot remains empty after later appends without omitting coverage validation", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const history = await createIndexedDbEventHistory({ panelSessionId: "find-empty-old-point" });
  try {
    const empty = await history.query!(request);
    if (!empty.ok) throw new Error(empty.problem.message);
    await history.offer(event(0)).settled;
    expect(await history.query!({ ...request, at: empty.value.readPoint })).toMatchObject({ ok: true, value: { find: { total: 0 }, totals: { matching: 0, inScope: 0 } } });
  } finally { await history.close(); }
});
