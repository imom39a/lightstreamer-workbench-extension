import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createEventHistory,
  createInMemoryEventHistory,
  createIndexedDbEventHistory
} from "../src/core/event-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createEventStore, type EventStore } from "../src/core/event-store";

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
