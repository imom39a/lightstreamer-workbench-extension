import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createEventStore, createIndexedDbEventStore } from "../src/core/event-store";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";

function event(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: Date.now(),
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update"
  };
}

describe("event store", () => {
  beforeEach(() => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
  });

  it("appends events in order and returns immutable list snapshots", () => {
    const store = createEventStore();

    store.append(event("event-1"));
    store.append(event("event-2"));

    const listed = store.list();
    listed.pop();

    expect(store.list().map((entry) => entry.id)).toEqual(["event-1", "event-2"]);
    expect(store.count()).toBe(2);
  });

  it("notifies subscribers on append and clear", () => {
    const store = createEventStore();
    const notifications: string[] = [];

    store.subscribe((change) => {
      notifications.push(change.type === "append" ? change.event.id : change.type);
    });

    store.append(event("event-1"));
    store.clear();

    expect(notifications).toEqual(["init", "event-1", "clear"]);
    expect(store.count()).toBe(0);
  });

  it("keeps all retained events when the warning threshold is exceeded", () => {
    const store = createEventStore({ warningThreshold: 2 });

    store.append(event("event-1"));
    store.append(event("event-2"));
    store.append(event("event-3"));

    expect(store.list().map((entry) => entry.id)).toEqual(["event-1", "event-2", "event-3"]);
    expect(store.stats()).toMatchObject({
      retained: 3,
      totalAppended: 3,
      warningThreshold: 2,
      warningActive: true
    });
  });

  it("resets warning stats when cleared", () => {
    const store = createEventStore({ warningThreshold: 1 });

    store.append(event("event-1"));
    store.append(event("event-2"));
    store.clear();

    expect(store.list()).toEqual([]);
    expect(store.stats()).toMatchObject({
      retained: 0,
      totalAppended: 0,
      warningThreshold: 1,
      warningActive: false
    });
  });

  it("keeps high-volume event queries bounded at 20,000 retained events", () => {
    const store = createEventStore({ warningThreshold: 10_000 });

    for (let index = 0; index < 20_000; index += 1) {
      store.append({
        ...event(`event-${index}`),
        subscription: {
          id: `sub-${index % 20}`,
          mode: index % 3 === 0 ? "MERGE" : "COMMAND"
        },
        item: { name: `item-${index % 10}`, position: (index % 10) + 1 },
        update: {
          command: index % 5 === 0 ? "UPDATE" : "ADD",
          key: `key-${index % 50}`,
          isSnapshot: index % 7 === 0,
          fields: { command: "ADD", key: `key-${index % 50}`, qty: index },
          changedFields: { qty: index }
        }
      });
    }

    const result = store.queryEvents({
      filters: { mode: "COMMAND", key: "key-1" },
      limit: 25
    });

    expect(store.stats()).toMatchObject({
      retained: 20_000,
      totalAppended: 20_000,
      warningActive: true
    });
    expect(result.total).toBeGreaterThan(25);
    expect(result.events).toHaveLength(25);
    expect(result.events.every((entry) => entry.subscription?.mode === "COMMAND")).toBe(true);
    expect(result.events.every((entry) => entry.update?.key === "key-1")).toBe(true);
  });

  it("queries IndexedDB-backed events through derived indexes and token search", async () => {
    const sessionId = "event-store-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId, warningThreshold: 2 });

    await store.append({
      ...event("event-1"),
      subscription: { id: "sub-1", mode: "COMMAND" },
      item: { name: "item.alpha", position: 1 },
      update: { command: "ADD", key: "alpha", isSnapshot: true }
    });
    await store.append({
      ...event("event-2"),
      subscription: { id: "sub-1", mode: "COMMAND" },
      item: { name: "item.beta", position: 2 },
      update: { command: "UPDATE", key: "beta", isSnapshot: false }
    });
    await store.append({
      ...event("event-3"),
      subscription: { id: "sub-2", mode: "MERGE" },
      item: { name: "item.gamma", position: 3 }
    });

    await expect(store.count()).resolves.toBe(3);
    await expect(store.stats()).resolves.toMatchObject({
      retained: 3,
      totalAppended: 3,
      warningActive: true
    });
    await expect(store.getEventById("event-2")).resolves.toMatchObject({
      id: "event-2"
    });

    const commandEvents = await store.queryEvents({
      filters: { mode: "COMMAND", query: "beta" }
    });
    expect(commandEvents.total).toBe(1);
    expect(commandEvents.events.map((entry) => entry.id)).toEqual(["event-2"]);

    const latestTwo = await store.queryEvents({ limit: 2 });
    expect(latestTwo.total).toBe(3);
    expect(latestTwo.events.map((entry) => entry.id)).toEqual(["event-2", "event-3"]);

    await store.clear();
    await expect(store.count()).resolves.toBe(0);
    store.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });

  it("can reset an IndexedDB-backed session on startup", async () => {
    const sessionId = "event-store-reset-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const firstStore = await createIndexedDbEventStore({ sessionId });

    await firstStore.append(event("event-1"));
    await expect(firstStore.count()).resolves.toBe(1);
    firstStore.close?.();

    const resetStore = await createIndexedDbEventStore({ sessionId, reset: true });
    await expect(resetStore.count()).resolves.toBe(0);

    resetStore.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });

  it("resets an IndexedDB-backed session while another connection is still open", async () => {
    const sessionId = "event-store-open-reset-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const firstStore = await createIndexedDbEventStore({ sessionId });

    await firstStore.append(event("event-1"));
    await expect(firstStore.count()).resolves.toBe(1);

    const resetStore = await createIndexedDbEventStore({ sessionId, reset: true });
    await expect(resetStore.count()).resolves.toBe(0);
    await expect(firstStore.count()).resolves.toBe(0);

    firstStore.close?.();
    resetStore.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });
});
