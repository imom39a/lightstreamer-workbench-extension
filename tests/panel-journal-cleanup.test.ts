import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIndexedDbEventStore } from "../src/core/event-store";
import {
  EVENT_STORE_NAMES,
  PANEL_EVENT_DB_PREFIX,
  PANEL_JOURNAL_OWNERSHIP_GENERATION,
  eventDatabaseName,
  openEventDatabase,
  sweepAbandonedPanelJournals
} from "../src/core/indexeddb/event-db";

const panelA = "panel-00000000-0000-4000-8000-0000000000a1";
const panelB = "panel-00000000-0000-4000-8000-0000000000b2";
const panelC = "panel-00000000-0000-4000-8000-0000000000c3";

describe("guarded Panel Session journal cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deletes recognized orphan journals but preserves unknown generations", async () => {
    const indexedDb = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks: createLockManager() });
    await writeOwnership(eventDatabaseName(panelA), PANEL_JOURNAL_OWNERSHIP_GENERATION, panelA);
    const futureName = `${PANEL_EVENT_DB_PREFIX}v2-${panelB}`;
    await writeOwnership(futureName, "future-generation", panelB);
    const noMarker = await openEventDatabase(eventDatabaseName(panelC));
    if (!noMarker.ok) throw noMarker.error;
    noMarker.database.db.close();

    const result = await sweepAbandonedPanelJournals();

    expect(result).toMatchObject({
      confirmed: true,
      deleted: [eventDatabaseName(panelA), eventDatabaseName(panelC)],
      skippedActive: [],
      preservedUnknown: [futureName]
    });
    expect(await indexedDb.databases()).toEqual([
      { name: futureName, version: 2 }
    ]);
  });

  it("preserves a recognized journal whose future schema cannot be opened", async () => {
    const indexedDb = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks: createLockManager() });
    const futureSchemaName = eventDatabaseName(panelC);
    const futureLegacyName = "lsew-events-1700000000001";
    const request = indexedDb.open(futureSchemaName, 3);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => undefined;
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const legacyRequest = indexedDb.open(futureLegacyName, 3);
    await new Promise<void>((resolve, reject) => {
      legacyRequest.onupgradeneeded = () => undefined;
      legacyRequest.onsuccess = () => {
        legacyRequest.result.close();
        resolve();
      };
      legacyRequest.onerror = () => reject(legacyRequest.error);
    });

    const result = await sweepAbandonedPanelJournals();

    expect(result).toMatchObject({
      confirmed: false,
      deleted: [],
      skippedActive: [],
      preservedUnknown: [futureSchemaName, futureLegacyName]
    });
    expect(await indexedDb.databases()).toEqual([
      { name: futureSchemaName, version: 3 },
      { name: futureLegacyName, version: 3 }
    ]);
  });

  it("deletes pre-Panel Session numeric journals but preserves unrecognized legacy names", async () => {
    const indexedDb = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks: createLockManager() });
    const legacyName = "lsew-events-1700000000000";
    const unrecognizedName = "lsew-events-1700000000000-copy";
    const legacy = await openEventDatabase(legacyName);
    if (!legacy.ok) throw legacy.error;
    legacy.database.db.close();
    const unrecognized = await openEventDatabase(unrecognizedName);
    if (!unrecognized.ok) throw unrecognized.error;
    unrecognized.database.db.close();

    const result = await sweepAbandonedPanelJournals();

    expect(result).toMatchObject({
      confirmed: true,
      deleted: [legacyName],
      skippedActive: [],
      preservedUnknown: [unrecognizedName]
    });
    expect(await indexedDb.databases()).toEqual([{ name: unrecognizedName, version: 2 }]);
  });

  it("keeps the ownership lock through the owned database handle close", async () => {
    const indexedDb = new IDBFactory();
    const locks = createLockManager();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks });
    const name = eventDatabaseName(panelA);
    const opened = await openEventDatabase(name, panelA);
    if (!opened.ok) throw opened.error;

    const originalClose = opened.database.db.close.bind(opened.database.db);
    const close = vi.spyOn(opened.database.db, "close").mockImplementation(() => {
      expect(locks.isHeld(`lsew:event-journal:${name}`)).toBe(true);
      originalClose();
    });

    await opened.database.releaseOwnership();

    expect(close).toHaveBeenCalledTimes(1);
    expect(locks.isHeld(`lsew:event-journal:${name}`)).toBe(false);
  });

  it("does not expose a database until its ownership lock is acquired", async () => {
    const indexedDb = new IDBFactory();
    const locks = createGatedLockManager();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks });

    let settled = false;
    const opening = openEventDatabase(eventDatabaseName(panelA), panelA).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    locks.release();
    const opened = await opening;
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      await opened.database.releaseOwnership();
      opened.database.db.close();
    }
  });

  it("clears and closes a journal so a later sweep can remove it", async () => {
    const indexedDb = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks: createLockManager() });

    const store = await createIndexedDbEventStore({ sessionId: panelA, clearOnClose: true });
    if (!store.close) throw new Error("IndexedDB event store must expose close().");
    await store.close();

    const result = await sweepAbandonedPanelJournals();

    expect(result.deleted).toEqual([eventDatabaseName(panelA)]);
    expect(await indexedDb.databases()).toEqual([]);
  });

  it("cannot claim or leave a handle after lock acquisition times out", async () => {
    vi.useFakeTimers();
    const indexedDb = new IDBFactory();
    const locks = createDelayedLockManager();
    const openSpy = vi.spyOn(indexedDb, "open");
    vi.stubGlobal("indexedDB", indexedDb);
    vi.stubGlobal("navigator", { locks });

    const opening = openEventDatabase(eventDatabaseName(panelA), panelA);
    await vi.advanceTimersByTimeAsync(2001);
    const result = await opening;
    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: expect.stringContaining("timed out") }) });
    expect(openSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(locks.active).toBe(false);
    expect(await indexedDb.databases()).toEqual([]);
    vi.useRealTimers();
  });

  it("closes a late IndexedDB success after the open timeout released ownership", async () => {
    vi.useFakeTimers();
    const locks = createLockManager();
    const lateDatabase = {
      close: vi.fn(),
      transaction: vi.fn(() => {
        throw new Error("late success must not claim ownership");
      })
    };
    const delayedIndexedDb = createDelayedIndexedDb(lateDatabase, 3000);
    vi.stubGlobal("indexedDB", delayedIndexedDb);
    vi.stubGlobal("navigator", { locks });

    const opening = openEventDatabase(eventDatabaseName(panelA), panelA);
    await vi.advanceTimersByTimeAsync(2001);
    const result = await opening;
    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: expect.stringContaining("timed out") }) });

    await vi.advanceTimersByTimeAsync(1000);
    expect(lateDatabase.transaction).not.toHaveBeenCalled();
    expect(lateDatabase.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("skips a journal whose owner still holds the coordination lock", async () => {
    const indexedDb = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDb);
    const locks = createLockManager();
    vi.stubGlobal("navigator", { locks });
    const opened = await openEventDatabase(eventDatabaseName(panelA), panelA);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await sweepAbandonedPanelJournals();

    expect(result).toMatchObject({
      confirmed: true,
      deleted: [],
      skippedActive: [eventDatabaseName(panelA)],
      preservedUnknown: []
    });
    expect((await indexedDb.databases()).some(({ name }) => name === eventDatabaseName(panelA))).toBe(true);

    await opened.database.releaseOwnership();
    opened.database.db.close();
  });

  it("reports unavailable coordination so the caller can select memory", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", {});

    await expect(createIndexedDbEventStore({ sessionId: panelA })).rejects.toThrow(
      "Panel Session journal coordination is unavailable"
    );
    await expect(sweepAbandonedPanelJournals()).resolves.toMatchObject({ confirmed: false });
  });
});

async function writeOwnership(name: string, generation: string, ownerId: string): Promise<void> {
  const opened = await openEventDatabase(name);
  if (!opened.ok) throw opened.error;
  const transaction = opened.database.db.transaction(EVENT_STORE_NAMES.ownership, "readwrite");
  transaction.objectStore(EVENT_STORE_NAMES.ownership).put({
    key: "journal",
    generation,
    ownerId
  });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  opened.database.db.close();
}

function createLockManager(): LockManager & { isHeld(name: string): boolean } {
  const owners = new Map<string, () => void>();
  return {
    request(name, optionsOrCallback, maybeCallback) {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
      return Promise.resolve().then(async () => {
        if (owners.has(name)) {
          return callback(null);
        }
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        owners.set(name, release);
        try {
          return await callback({ name, mode: "exclusive" } as Lock);
        } finally {
          owners.delete(name);
          release();
        }
      });
    },
    query() {
      return Promise.resolve({ held: {}, pending: {} });
    },
    isHeld(name: string) {
      return owners.has(name);
    }
  } as LockManager & { isHeld(name: string): boolean };
}

function createGatedLockManager(): LockManager & { release(): void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    request(_name, optionsOrCallback, maybeCallback) {
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
      return gate.then(() => callback({ name: "gated", mode: "exclusive" } as Lock));
    },
    query() {
      return Promise.resolve({ held: {}, pending: {} });
    }
  } as LockManager & { release(): void };
}

function createDelayedLockManager(): LockManager & { active: boolean } {
  const manager = {
    active: false,
    request(_name: string, _options: unknown, callback: (lock: Lock) => Promise<unknown>) {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          manager.active = true;
          try {
            resolve(await callback({ name: "delayed", mode: "exclusive" }));
          } catch (error) {
            reject(error);
          } finally {
            manager.active = false;
          }
        }, 5000);
      });
    },
    query() {
      return Promise.resolve({ held: {}, pending: {} });
    }
  };
  return manager as unknown as LockManager & { active: boolean };
}

function createDelayedIndexedDb(
  database: { close: () => void; transaction: () => never },
  delay: number
): IDBFactory {
  const request = {
    result: database,
    error: null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null,
    onblocked: null,
    onupgradeneeded: null
  };
  setTimeout(() => request.onsuccess?.(new Event("success")), delay);
  return {
    open() {
      return request;
    },
    deleteDatabase() {
      throw new Error("not used");
    },
    databases() {
      return Promise.resolve([]);
    },
    cmp() {
      return 0;
    }
  } as unknown as IDBFactory;
}
