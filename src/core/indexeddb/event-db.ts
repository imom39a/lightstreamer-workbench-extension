export const EVENT_DB_SCHEMA_VERSION = 1;
export const DEFAULT_EVENT_DB_NAME = "lsew-events-session";
const INDEXEDDB_REQUEST_TIMEOUT_MS = 2000;

export type EventDatabase = {
  db: IDBDatabase;
  name: string;
};

export type EventDatabaseOpenResult =
  | {
      ok: true;
      database: EventDatabase;
    }
  | {
      ok: false;
      error: Error;
    };

export const EVENT_STORE_NAMES = {
  events: "events",
  eventMeta: "eventMeta",
  eventSearchTokens: "eventSearchTokens"
} as const;

export function eventDatabaseName(sessionId?: string | number | null): string {
  if (sessionId === undefined || sessionId === null || sessionId === "") {
    return DEFAULT_EVENT_DB_NAME;
  }
  return `lsew-events-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function openEventDatabase(name = DEFAULT_EVENT_DB_NAME): Promise<EventDatabaseOpenResult> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve({
      ok: false,
      error: new Error("IndexedDB is not available in this context.")
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const request = indexedDB.open(name, EVENT_DB_SCHEMA_VERSION);
    const timeout = globalThis.setTimeout(() => {
      settle({
        ok: false,
        error: new Error(`Opening ${name} timed out.`)
      });
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);

    function settle(result: EventDatabaseOpenResult): void {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(result);
    }

    request.onupgradeneeded = () => {
      upgradeEventDatabase(request.result, request.transaction);
    };

    request.onerror = () => {
      settle({
        ok: false,
        error: request.error ?? new Error("Failed to open IndexedDB event database.")
      });
    };

    request.onblocked = () => {
      settle({
        ok: false,
        error: new Error(`Opening ${name} was blocked by another connection.`)
      });
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      settle({
        ok: true,
        database: {
          db,
          name
        }
      });
    };
  });
}

export function deleteEventDatabase(name = DEFAULT_EVENT_DB_NAME): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.deleteDatabase(name);
    const timeout = globalThis.setTimeout(() => {
      settle(() => reject(new Error(`Deleting ${name} timed out.`)));
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);

    function settle(complete: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      complete();
    }

    request.onsuccess = () => settle(resolve);
    request.onerror = () => {
      settle(() => reject(request.error ?? new Error(`Failed to delete ${name}.`)));
    };
    request.onblocked = () => {
      settle(() => reject(new Error(`Deleting ${name} was blocked by an open connection.`)));
    };
  });
}

function upgradeEventDatabase(db: IDBDatabase, transaction: IDBTransaction | null): void {
  const events = createStore(db, transaction, EVENT_STORE_NAMES.events, {
    keyPath: "seq",
    autoIncrement: true
  });
  createIndex(events, "id", "id", { unique: true });

  const eventMeta = createStore(db, transaction, EVENT_STORE_NAMES.eventMeta, {
    keyPath: "seq"
  });
  for (const index of [
    "id",
    "timestamp",
    "kind",
    "subscriptionId",
    "subscriptionMode",
    "itemName",
    "commandKey",
    "commandValue",
    "isSnapshot",
    "synthetic"
  ]) {
    createIndex(eventMeta, index, index);
  }

  const searchTokens = createStore(db, transaction, EVENT_STORE_NAMES.eventSearchTokens, {
    keyPath: ["token", "seq"]
  });
  createIndex(searchTokens, "token", "token");
  createIndex(searchTokens, "seq", "seq");
}

function createStore(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  name: string,
  options: IDBObjectStoreParameters
): IDBObjectStore {
  if (db.objectStoreNames.contains(name)) {
    if (!transaction) {
      throw new Error(`Cannot upgrade existing store ${name} without a versionchange transaction.`);
    }
    return transaction.objectStore(name);
  }
  return db.createObjectStore(name, options);
}

function createIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}
