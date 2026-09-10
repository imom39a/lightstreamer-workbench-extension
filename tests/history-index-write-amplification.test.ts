import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps index write amplification bounded during a JSON-rich snapshot", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  let postingWrites = 0;
  let multiEntryKeys = 0;
  for (const method of ["add", "put"] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === "facetPostings") postingWrites++;
      for (const name of this.indexNames) {
        const index = this.index(name);
        if (index.multiEntry && typeof index.keyPath === "string") {
          const value = args[0]?.[index.keyPath];
          if (Array.isArray(value)) multiEntryKeys += value.length;
        }
      }
      return original.apply(this, args);
    });
  }
  const history = await createIndexedDbEventHistory({ panelSessionId: "index-write-amplification" });
  try {
    const events = Array.from({ length: 512 }, (_, i) => {
      const event = createEventHistoryWorkloadEvent("ordinary-item-update", i, "throughput");
      const payload = JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, j) => [`field${j}`, `record-${i}-value-${j}-abcdefghijklmnop`])));
      return { ...event, update: { ...event.update!, fields: { ...event.update!.fields, payload }, changedFields: { ...event.update!.changedFields, payload } } };
    });
    const results = await Promise.all(events.map(event => history.offer(event).settled));
    expect(results.every(result => result.outcome === "BECAME_EVIDENCE")).toBe(true);
    expect(history.status().persistence).toMatchObject({ mode: "JOURNAL", failureCount: 0 });
    expect(postingWrites).toBeLessThanOrEqual(events.length * 2);
    expect(multiEntryKeys).toBeLessThanOrEqual(events.length * 64);
  } finally {
    await history.close();
  }
});

it("plans and rolls retention without rereading Evidence payloads", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const history = await createIndexedDbEventHistory({ panelSessionId: "retention-work", capacity: { maxRetainedCount: 1024 } });
  try {
    const event = (i: number) => createEventHistoryWorkloadEvent("ordinary-item-update", i, "retention-work");
    await Promise.all(Array.from({ length: 1024 }, (_, i) => history.offer(event(i)).settled));
    let retentionPayloadCursors = 0;
    const original = IDBObjectStore.prototype.openCursor;
    vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === "evidence") retentionPayloadCursors++;
      return original.apply(this, args);
    });
    await history.offer(event(1024)).settled;
    expect(history.status().persistence).toMatchObject({ mode: "JOURNAL", failureCount: 0 });
    expect(history.status().capacity!.measurements!.retainedCount).toBeLessThan(1024);
    expect(retentionPayloadCursors).toBe(0);
  } finally { await history.close(); }
});
