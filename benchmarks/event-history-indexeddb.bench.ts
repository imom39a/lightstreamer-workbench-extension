import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { bench, expect, vi } from "vitest";

import { createIndexedDbEventHistory as createLegacyIndexedDbEventHistory } from "../src/core/event-history";
import { createIndexedDbEventHistory as createAuthoritativeIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";
import { authoritativeEventDatabaseName, deleteAuthoritativeEventDatabase } from "../src/core/indexeddb/authoritative-event-db";

const CAPTURE_COUNT = 10_000;
const MAX_DURATION_MS = 60_000;

bench(
  "authoritative IndexedDB EventHistory retains 10,000 Evidence records in order",
  async () => {
    const sessionId = "authoritative-event-history-high-volume-benchmark";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(sessionId));
    const history = await createAuthoritativeIndexedDbEventHistory({ panelSessionId: sessionId });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const publicationSizes: number[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") publicationSizes.push(publication.evidence.length);
    });
    transactionSpy.mockClear();
    const startedAt = performance.now();
    try {
      const accepted = Array.from({ length: CAPTURE_COUNT }, (_, index) =>
        history.offer(authoritativeEvent(`authoritative-capture-${index}`)).settled
      );
      expect(transactionSpy).not.toHaveBeenCalled();
      await Promise.all(accepted);
      const retained = await history.read({});
      const durationMs = performance.now() - startedAt;
      expect(retained).toMatchObject({ ok: true, value: { total: CAPTURE_COUNT } });
      expect(retained.ok && retained.value.evidence).toHaveLength(CAPTURE_COUNT);
      expect(retained.ok && retained.value.evidence[0]?.eventId).toBe("authoritative-capture-0");
      expect(retained.ok && retained.value.evidence.at(-1)?.eventId).toBe(`authoritative-capture-${CAPTURE_COUNT - 1}`);
      expect(publicationSizes.reduce((total, size) => total + size, 0)).toBe(CAPTURE_COUNT);
      expect(transactionSpy.mock.calls.filter(([, mode]) => mode === "readwrite")).toHaveLength(Math.ceil(CAPTURE_COUNT / 256));
      expect(durationMs).toBeLessThan(MAX_DURATION_MS);
    } finally {
      await history.close();
      transactionSpy.mockRestore();
      await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(sessionId));
    }
  },
  {
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0
  }
);

bench(
  "legacy IndexedDB EventStore retains 10,000 events as comparison evidence",
  async () => {
    const sessionId = "event-history-high-volume-benchmark";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const history = await createLegacyIndexedDbEventHistory({
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

function authoritativeEvent(id: string): LightstreamerEventEnvelope {
  return event(id);
}
