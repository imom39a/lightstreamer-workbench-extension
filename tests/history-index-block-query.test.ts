import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createIndexedDbEventHistory, transactionDone } from "../src/core/event-history-indexeddb";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import type { EvidenceQueryRequest } from "../src/core/evidence-filter-contract";

afterEach(() => vi.unstubAllGlobals());

const query = (text: string): EvidenceQueryRequest => ({
  at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 },
  filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }, find: { text }
});
const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

it("keeps exact Find results across blocks, a latched append, retention, and Clear", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const options = { panelSessionId: "block-query-parity", capacity: { maxRetainedCount: 600 } };
  const memory = await createMemoryEventHistoryForTests(options);
  const durable = await createIndexedDbEventHistory(options);
  const event = (index: number) => {
    const entry = createEventHistoryWorkloadEvent("ordinary-item-update", index, "blocks");
    entry.update!.fields = { ...entry.update!.fields, text: index === 260 ? "UNIQUE Needle Café 東京😀 ab😀cd" : "ordinary text" };
    return entry;
  };
  try {
    for (const history of [memory, durable]) await Promise.all(Array.from({ length: 550 }, (_, index) => history.offer(event(index)).settled));
    const point = await durable.query!(query(""));
    if (!point.ok) throw new Error(point.problem.message);
    // Append into an existing block while an earlier read point remains valid.
    for (const history of [memory, durable]) await history.offer(event(550)).settled;
    for (const text of ["unique needle", "CAFÉ  東京😀", "ab\ud83d", "ordinary", "does-not-exist"]) {
      const request = { ...query(text), at: point.value.readPoint };
      const expected = await memory.query!(request), actual = await durable.query!(request);
      if (!expected.ok || !actual.ok) throw new Error("Find failed.");
      expect(actual.value.find).toEqual(expected.value.find);
      if (text === "unique needle") expect(actual.value.telemetry?.findCursorReads).toBeLessThan(550);
    }
    for (const history of [memory, durable]) await Promise.all(Array.from({ length: 250 }, (_, offset) => history.offer(event(551 + offset)).settled));
    const expected = await memory.query!(query("unique needle")), actual = await durable.query!(query("unique needle"));
    if (!expected.ok || !actual.ok) throw new Error("Find after retention failed.");
    expect(actual.value.find).toEqual(expected.value.find);
    expect(actual.value.find?.total).toBe(0);
    for (const history of [memory, durable]) { await history.clear(); await history.offer(event(260)).settled; }
    const afterClear = await durable.query!(query("unique needle"));
    expect(afterClear).toMatchObject({ ok: true, value: { find: { total: 1, matches: [{ eventId: "blocks-ordinary-item-update-260" }] } } });
  } finally { await memory.close(); await durable.close(); }
});

it.each(["missing", "damaged", "wrong interval"])("fails closed for a %s search block", async damage => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const panelSessionId = "search-block-corruption";
  const history = await createIndexedDbEventHistory({ panelSessionId });
  try {
    await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "needle")).settled;
    const database = await requestValue(indexedDB.open(authoritativeEventDatabaseName(panelSessionId)));
    try {
      const transaction = database.transaction("searchBlocks", "readwrite");
      const done = transactionDone(transaction, "damaging test search block");
      const store = transaction.objectStore("searchBlocks");
      const block = await requestValue(store.get(1));
      if (damage === "missing") store.delete(1);
      else {
        if (damage === "damaged") block.bloom[0] ^= 1;
        else block.intervalId = "other";
        store.put(block);
      }
      await done;
    } finally { database.close(); }
    await expect(history.query!(query("needle"))).resolves.toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
  } finally { await history.close(); }
});
