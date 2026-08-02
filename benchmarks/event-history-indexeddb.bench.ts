import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { bench, expect, vi } from "vitest";

import { createIndexedDbEventHistory } from "../src/core/event-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";

const CAPTURE_COUNT = 10_000;
const MAX_DURATION_MS = 60_000;

bench(
  "retain 10,000 IndexedDB events in order with bounded batch work",
  async () => {
    const sessionId = "event-history-high-volume-benchmark";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const history = await createIndexedDbEventHistory({
      sessionId,
      reset: true,
      batchSize: 256
    });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const countSpy = vi.spyOn(IDBObjectStore.prototype, "count");
    const notificationSizes: number[] = [];
    history.subscribe((change) => {
      if (change.type === "append") {
        notificationSizes.push(1);
      } else if (change.type === "append-batch") {
        notificationSizes.push(change.events.length);
      }
    });
    transactionSpy.mockClear();
    countSpy.mockClear();
    const startedAt = performance.now();

    try {
      const accepted = Array.from({ length: CAPTURE_COUNT }, (_, index) =>
        history.append(event(`indexed-capture-${index}`)).toPromise()
      );
      expect(transactionSpy).not.toHaveBeenCalled();
      await Promise.all(accepted);
      const stats = await history.stats().toPromise();

      expect(stats).toMatchObject({
        retained: CAPTURE_COUNT,
        totalAppended: CAPTURE_COUNT
      });
      expect(notificationSizes.reduce((total, size) => total + size, 0)).toBe(CAPTURE_COUNT);
      expect(notificationSizes.length).toBeLessThan(100);
      expect(transactionSpy.mock.calls.length).toBeLessThanOrEqual(40);
      expect(countSpy).not.toHaveBeenCalled();

      const retained = await history.list().toPromise();
      const durationMs = performance.now() - startedAt;
      expect(retained).toHaveLength(CAPTURE_COUNT);
      expect(retained[0]?.id).toBe("indexed-capture-0");
      expect(retained.at(-1)?.id).toBe(`indexed-capture-${CAPTURE_COUNT - 1}`);
      expect(durationMs).toBeLessThan(MAX_DURATION_MS);
    } finally {
      await history.close().toPromise();
      transactionSpy.mockRestore();
      countSpy.mockRestore();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  },
  {
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0
  }
);

function event(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update"
  };
}
