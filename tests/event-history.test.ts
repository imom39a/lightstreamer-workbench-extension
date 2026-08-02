import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createEventHistory,
  createInMemoryEventHistory,
  createIndexedDbEventHistory
} from "../src/core/event-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createEventStore, type EventStore } from "../src/core/event-store";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";

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

describe("event history", () => {
  it("retains a high-volume capture in order with bounded subscriber work", async () => {
    const history = createInMemoryEventHistory({ batchSize: 256 });
    const notificationSizes: number[] = [];
    history.subscribe((change) => {
      if (change.type === "append") {
        notificationSizes.push(1);
      } else if (change.type === "append-batch") {
        notificationSizes.push(change.events.length);
      }
    });

    const accepted = Array.from({ length: 10_000 }, (_, index) =>
      history.append(event(`capture-${index}`)).toPromise()
    );
    await Promise.all(accepted);
    const stats = await history.stats().toPromise();

    expect((await history.list().toPromise()).map((entry) => entry.id)).toEqual(
      Array.from({ length: 10_000 }, (_, index) => `capture-${index}`)
    );
    expect(stats).toMatchObject({ retained: 10_000, totalAppended: 10_000 });
    expect(notificationSizes.reduce((total, size) => total + size, 0)).toBe(10_000);
    expect(notificationSizes.length).toBeLessThan(100);

    await history.close().toPromise();
  });

  it("settles queued events before clear and close without allowing them to reappear", async () => {
    const history = createInMemoryEventHistory({ batchSize: 2 });
    const first = history.append(event("queued-before-clear"));
    const clear = history.clear();

    await expect(first.toPromise()).resolves.toMatchObject({ id: "queued-before-clear" });
    await expect(clear.toPromise()).resolves.toBeUndefined();
    await expect(history.count().toPromise()).resolves.toBe(0);

    const final = history.append({
      ...event("successful-local-injection"),
      source: "synthetic",
      synthetic: true
    });
    const close = history.close();

    await expect(final.toPromise()).resolves.toMatchObject({
      id: "successful-local-injection"
    });
    await expect(close.toPromise()).resolves.toBeUndefined();
  });

  it("retains a high-volume IndexedDB capture in order without per-event count work", async () => {
    const sessionId = "event-history-high-volume";
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

    try {
      const accepted = Array.from({ length: 10_000 }, (_, index) =>
        history.append(event(`indexed-capture-${index}`)).toPromise()
      );
      expect(transactionSpy).not.toHaveBeenCalled();
      await Promise.all(accepted);
      const stats = await history.stats().toPromise();

      expect(stats).toMatchObject({ retained: 10_000, totalAppended: 10_000 });
      expect(notificationSizes.reduce((total, size) => total + size, 0)).toBe(10_000);
      expect(notificationSizes.length).toBeLessThan(100);
      expect(transactionSpy.mock.calls.length).toBeLessThanOrEqual(40);
      expect(countSpy).not.toHaveBeenCalled();

      const retained = await history.list().toPromise();
      expect(retained).toHaveLength(10_000);
      expect(retained[0]?.id).toBe("indexed-capture-0");
      expect(retained.at(-1)?.id).toBe("indexed-capture-9999");
    } finally {
      await history.close().toPromise();
      transactionSpy.mockRestore();
      countSpy.mockRestore();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  }, 60_000);

  it("does not resurrect queued IndexedDB events across clear and close", async () => {
    const sessionId = "event-history-clear-close-barrier";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const history = await createIndexedDbEventHistory({
      sessionId,
      reset: true,
      batchSize: 2
    });

    try {
      const queued = history.append(event("queued-indexed-event"));
      const cleared = history.clear();
      await expect(queued.toPromise()).resolves.toMatchObject({ id: "queued-indexed-event" });
      await expect(cleared.toPromise()).resolves.toBeUndefined();
      await expect(history.count().toPromise()).resolves.toBe(0);

      const retained = history.append({
        ...event("retained-before-close"),
        source: "synthetic",
        synthetic: true
      });
      const closed = history.close();
      await expect(retained.toPromise()).resolves.toMatchObject({ id: "retained-before-close" });
      await expect(closed.toPromise()).resolves.toBeUndefined();

      const reopened = await createIndexedDbEventHistory({ sessionId });
      await expect(reopened.list().toPromise()).resolves.toMatchObject([
        expect.objectContaining({ id: "retained-before-close" })
      ]);
      await reopened.close().toPromise();
    } finally {
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("presents one completion contract over the in-memory implementation", async () => {
    const history = createInMemoryEventHistory();
    const notifications: string[] = [];
    history.subscribe((change) => notifications.push(change.type));

    const appendResult = history.append(event("event-1"));
    const queryResult = history.queryEvents();
    const statsResult = history.stats();

    expect(appendResult).toEqual(expect.objectContaining({ receive: expect.any(Function) }));
    expect(queryResult).toEqual(expect.objectContaining({ receive: expect.any(Function) }));
    expect(statsResult).toEqual(expect.objectContaining({ receive: expect.any(Function) }));
    await expect(appendResult.toPromise()).resolves.toMatchObject({ id: "event-1" });
    await expect(queryResult.toPromise()).resolves.toMatchObject({
      events: [expect.objectContaining({ id: "event-1" })],
      total: 1
    });
    await expect(history.getEventById("event-1").toPromise()).resolves.toMatchObject({
      id: "event-1"
    });
    await expect(history.list().toPromise()).resolves.toHaveLength(1);
    await expect(history.count().toPromise()).resolves.toBe(1);
    await expect(statsResult.toPromise()).resolves.toMatchObject({
      retained: 1,
      totalAppended: 1
    });
    expect(notifications).toEqual(["init", "append"]);

    await history.clear().toPromise();
    await expect(history.count().toPromise()).resolves.toBe(0);
    await expect(history.close().toPromise()).resolves.toBeUndefined();
  });

  it("uses the same completion contract over IndexedDB", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const history = await createIndexedDbEventHistory({
      sessionId: "event-history-contract",
      reset: true
    });

    await expect(history.append(event("indexed-event")).toPromise()).resolves.toMatchObject({
      id: "indexed-event"
    });
    await expect(history.queryEvents().toPromise()).resolves.toMatchObject({
      events: [expect.objectContaining({ id: "indexed-event" })],
      total: 1
    });
    await expect(history.close().toPromise()).resolves.toBeUndefined();
  });

  it("turns synchronous backend failures into rejected history operations", async () => {
    const backend = createEventStore() as EventStore;
    backend.queryEvents = () => {
      throw new Error("backend unavailable");
    };
    const history = createEventHistory(backend);

    const operation = history.queryEvents();
    let receivedError: unknown = null;
    expect(() =>
      operation.receive(
        () => undefined,
        (error) => {
          receivedError = error;
        }
      )
    ).not.toThrow();
    expect(receivedError).toEqual(new Error("backend unavailable"));
    await expect(operation.toPromise()).rejects.toThrow("backend unavailable");
  });
});
