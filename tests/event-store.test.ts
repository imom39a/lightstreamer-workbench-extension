import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOPOLOGY_OBSERVATION_VERSION,
  type TopologyObservation
} from "../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createIndexedDbEventRepository } from "../src/core/event-repository";
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

    const partialSearchEvents = await store.queryEvents({
      filters: { query: "alp" }
    });
    expect(partialSearchEvents.total).toBe(1);
    expect(partialSearchEvents.events.map((entry) => entry.id)).toEqual(["event-1"]);

    const latestTwo = await store.queryEvents({ limit: 2 });
    expect(latestTwo.total).toBe(3);
    expect(latestTwo.events.map((entry) => entry.id)).toEqual(["event-2", "event-3"]);

    await store.clear();
    await expect(store.count()).resolves.toBe(0);
    store.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });

  it("keeps structural residual filtering and bounded totals in parity across memory and IndexedDB", async () => {
    const sessionId = "event-store-structural-filter-parity-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const memory = createEventStore();
    const indexed = await createIndexedDbEventStore({ sessionId });
    const events = [
      {
        ...event("structural-1"),
        client: { id: "client-a", sessionId: "session-a" },
        subscription: { id: "sub-a", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        listener: { id: "listener-a" }
      },
      {
        ...event("structural-2"),
        client: { id: "client-a", sessionId: "session-a" },
        subscription: { id: "sub-a", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        listener: { id: "listener-a" }
      },
      {
        ...event("structural-other"),
        client: { id: "client-b", sessionId: "session-b" },
        subscription: { id: "sub-b", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        listener: { id: "listener-b" }
      }
    ] satisfies LightstreamerEventEnvelope[];
    for (const captured of events) {
      memory.append(captured);
      await indexed.append(captured);
    }
    const getSpy = vi.spyOn(IDBObjectStore.prototype, "get");
    const query = {
      filters: {
        clientId: "client-a",
        sessionId: "session-a",
        subscriptionId: "sub-a",
        item: "orders",
        itemPosition: 1,
        listenerId: "listener-a"
      },
      limit: 1,
      offset: 0,
      order: "asc" as const
    };

    const memoryResult = memory.queryEvents(query);
    const indexedResult = await indexed.queryEvents(query);
    expect(indexedResult).toEqual(memoryResult);
    expect(indexedResult).toMatchObject({ total: 2 });
    expect(indexedResult.events.map(({ id }) => id)).toEqual(["structural-2"]);
    expect(getSpy).toHaveBeenCalledTimes(1);

    getSpy.mockRestore();
    indexed.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });

  it("keeps topology in subscriber memory but never crosses the repository boundary", async () => {
    const sessionId = "event-store-topology-boundary-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId });
    const topology: TopologyObservation = {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "item-update",
      pageEpoch: "page-a",
      captureSequence: 42,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "complete", getters: {} },
      subscription: { id: "sub-a" }
    };
    const original: LightstreamerEventEnvelope = {
      ...event("event-with-topology"),
      client: {
        id: "client-a",
        status: "CONNECTED:WS-STREAMING",
        semanticValueStates: { status: { state: "real" } }
      },
      subscription: {
        id: "sub-a",
        mode: "COMMAND",
        semanticValueStates: { mode: { state: "requested" } }
      },
      update: { command: "ADD", key: "alpha" },
      topology
    };
    const appendedNotifications: LightstreamerEventEnvelope[] = [];
    store.subscribe((change) => {
      if (change.type === "append") {
        appendedNotifications.push(change.event);
      }
    });

    try {
      const appended = await store.append(original);

      expect(appended).not.toHaveProperty("topology");
      expect(appended.client).not.toHaveProperty("semanticValueStates");
      expect(appended.subscription).not.toHaveProperty("semanticValueStates");
      expect(appended).toMatchObject({
        client: { id: "client-a", status: "CONNECTED:WS-STREAMING" },
        subscription: { id: "sub-a", mode: "COMMAND" },
        update: { command: "ADD", key: "alpha" }
      });
      expect(appendedNotifications).toEqual([original]);
      expect(appendedNotifications[0]?.topology).toBe(topology);
      expect(original.topology).toBe(topology);
      await expect(store.getEventById(original.id)).resolves.not.toHaveProperty("topology");
      const listed = await store.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty("topology");
      expect(listed[0]?.client).not.toHaveProperty("semanticValueStates");
      expect(listed[0]?.subscription).not.toHaveProperty("semanticValueStates");
      const queried = await store.queryEvents();
      expect(queried.total).toBe(1);
      expect(queried.events).toHaveLength(1);
      expect(queried.events[0]).not.toHaveProperty("topology");
    } finally {
      await store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("sanitizes semantic evidence at the direct IndexedDB repository boundary", async () => {
    const sessionId = "event-repository-semantic-boundary-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const repository = await createIndexedDbEventRepository(sessionId);
    const original: LightstreamerEventEnvelope = {
      ...event("direct-repository-event"),
      client: {
        id: "client-a",
        adapterSet: "DEMO",
        semanticValueStates: { adapterSet: { state: "requested" } }
      },
      subscription: {
        id: "sub-a",
        mode: "MERGE",
        semanticValueStates: { mode: { state: "requested" } }
      },
      topology: {
        version: TOPOLOGY_OBSERVATION_VERSION,
        kind: "item-update",
        pageEpoch: "page-a",
        captureSequence: 1,
        provenance: { instrumentationSource: "official-public-api" },
        coverage: { status: "complete", getters: {} }
      }
    };

    try {
      const appended = await repository.appendEvent(original);
      expect(appended).not.toHaveProperty("topology");
      expect(appended.client).not.toHaveProperty("semanticValueStates");
      expect(appended.subscription).not.toHaveProperty("semanticValueStates");
      expect(appended).toMatchObject({
        client: { id: "client-a", adapterSet: "DEMO" },
        subscription: { id: "sub-a", mode: "MERGE" }
      });
      const stored = await repository.getEventById(original.id);
      expect(stored).not.toHaveProperty("topology");
      expect(stored?.client).not.toHaveProperty("semanticValueStates");
      expect(stored?.subscription).not.toHaveProperty("semanticValueStates");
    } finally {
      repository.close();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
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

  it("clears an IndexedDB-backed session when close cleanup is enabled", async () => {
    const sessionId = "event-store-close-cleanup-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId, clearOnClose: true });

    await store.append(event("event-1"));
    await expect(store.count()).resolves.toBe(1);

    await store.close?.();

    const reopenedStore = await createIndexedDbEventStore({ sessionId });
    await expect(reopenedStore.count()).resolves.toBe(0);

    reopenedStore.close?.();
    await deleteEventDatabase(eventDatabaseName(sessionId));
  });

  it("pages unfiltered IndexedDB queries without reading every metadata row", async () => {
    const sessionId = "event-store-cursor-page-test";
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, "getAll");
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId });

    try {
      await store.append(event("event-1"));
      await store.append(event("event-2"));
      await store.append(event("event-3"));

      const latestTwo = await store.queryEvents({ limit: 2 });

      expect(latestTwo.total).toBe(3);
      expect(latestTwo.events.map((entry) => entry.id)).toEqual(["event-2", "event-3"]);
      expect(getAllSpy).not.toHaveBeenCalled();
    } finally {
      getAllSpy.mockRestore();
      store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("reads an unfiltered IndexedDB count, page, and hydration from one transaction snapshot", async () => {
    const sessionId = "event-store-consistent-page-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");

    try {
      await store.append(event("event-1"));
      await store.append(event("event-2"));
      await store.append(event("event-3"));
      transactionSpy.mockClear();

      const result = await store.queryEvents({ limit: 2 });

      expect(result).toMatchObject({ total: 3 });
      expect(result.events.map((entry) => entry.id)).toEqual(["event-2", "event-3"]);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(transactionSpy.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining(["events", "eventMeta"])
      );
    } finally {
      transactionSpy.mockRestore();
      store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("reads filtered IndexedDB metadata, total, page, and hydration from one transaction snapshot", async () => {
    const sessionId = "event-store-consistent-filtered-page-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");

    try {
      await store.append({
        ...event("event-1"),
        subscription: { id: "sub-1", mode: "COMMAND" }
      });
      await store.append({
        ...event("event-2"),
        subscription: { id: "sub-1", mode: "COMMAND" }
      });
      await store.append({
        ...event("event-3"),
        subscription: { id: "sub-2", mode: "MERGE" }
      });
      transactionSpy.mockClear();

      const result = await store.queryEvents({
        filters: { mode: "COMMAND" },
        limit: 1
      });

      expect(result).toMatchObject({ total: 2 });
      expect(result.events.map((entry) => entry.id)).toEqual(["event-2"]);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(transactionSpy.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining(["events", "eventMeta"])
      );
      expect(transactionSpy.mock.calls[0]?.[1]).toBe("readonly");
    } finally {
      transactionSpy.mockRestore();
      store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("reads full-text IndexedDB matches, total, page, and hydration from one transaction snapshot", async () => {
    const sessionId = "event-store-consistent-full-text-page-test";
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");

    try {
      await store.append({
        ...event("event-1"),
        item: { name: "matching-alpha", position: 1 }
      });
      await store.append({
        ...event("event-2"),
        item: { name: "matching-alpha", position: 2 }
      });
      await store.append({
        ...event("event-3"),
        item: { name: "other", position: 3 }
      });
      transactionSpy.mockClear();

      const result = await store.queryEvents({
        filters: { query: "matching-alpha" },
        limit: 1
      });

      expect(result).toMatchObject({ total: 2 });
      expect(result.events.map((entry) => entry.id)).toEqual(["event-2"]);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(transactionSpy.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining(["events", "eventMeta"])
      );
      expect(transactionSpy.mock.calls[0]?.[1]).toBe("readonly");
    } finally {
      transactionSpy.mockRestore();
      store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
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
