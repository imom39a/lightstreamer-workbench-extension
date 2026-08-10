export const EVENT_DB_SCHEMA_VERSION = 2;
export const DEFAULT_EVENT_DB_NAME = "lsew-events-session";
export const PANEL_EVENT_DB_PREFIX = "lsew-events-panel-";
export const PANEL_EVENT_DB_GENERATION = "v1";
export const PANEL_JOURNAL_OWNERSHIP_GENERATION = "panel-session-v1";
const PANEL_JOURNAL_LOCK_PREFIX = "lsew:event-journal:";
const INDEXEDDB_REQUEST_TIMEOUT_MS = 2000;

export type EventDatabase = {
  db: IDBDatabase;
  name: string;
  releaseOwnership(): Promise<void>;
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
  eventSearchTokens: "eventSearchTokens",
  ownership: "ownership"
} as const;

export function eventDatabaseName(sessionId?: string | number | null): string {
  if (sessionId === undefined || sessionId === null || sessionId === "") {
    return DEFAULT_EVENT_DB_NAME;
  }
  const normalized = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "-");
  return normalized.startsWith("panel-")
    ? `${PANEL_EVENT_DB_PREFIX}${PANEL_EVENT_DB_GENERATION}-${normalized}`
    : `lsew-events-${normalized}`;
}

export function openEventDatabase(
  name = DEFAULT_EVENT_DB_NAME,
  ownerId?: string
): Promise<EventDatabaseOpenResult> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve({
      ok: false,
      error: new Error("IndexedDB is not available in this context.")
    });
  }

  if (ownerId) {
    return acquireOwnershipLock(name)
      .then((releaseLock) => openDatabase(name, ownerId, releaseLock))
      .catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error : new Error("Could not claim event database ownership.")
      }));
  }

  return openDatabase(name);
}

function openDatabase(
  name: string,
  ownerId?: string,
  releaseLock: (() => void) | null = null
): Promise<EventDatabaseOpenResult> {

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
      if (!result.ok) {
        releaseLock?.();
      }
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

    const finishWithError = (error: unknown): void => {
      settle({
        ok: false,
        error: error instanceof Error ? error : new Error("Could not open event database.")
      });
    };

    const continueOpen = async (): Promise<void> => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      try {
        if (ownerId) {
          await claimOwnership(db, name, ownerId);
        }
      } catch (error) {
        db.close();
        finishWithError(error);
        return;
      }
      settle({
        ok: true,
        database: {
          db,
          name,
          releaseOwnership: () => releaseOwnership(db, name, ownerId, releaseLock)
        }
      });
    };

    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      globalThis.clearTimeout(timeout);
      void continueOpen();
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

export type PanelJournalCleanupResult = {
  confirmed: boolean;
  deleted: string[];
  skippedActive: string[];
  preservedUnknown: string[];
};

type OwnershipReadResult =
  | { readable: true; ownership: { ownerId?: string; generation?: string } | null }
  | { readable: false; error: Error };

export async function sweepAbandonedPanelJournals(): Promise<PanelJournalCleanupResult> {
  const locks = panelJournalLocks();
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function" || !locks) {
    return { confirmed: false, deleted: [], skippedActive: [], preservedUnknown: [] };
  }
  const result: PanelJournalCleanupResult = {
    confirmed: true,
    deleted: [],
    skippedActive: [],
    preservedUnknown: []
  };
  for (const entry of await indexedDB.databases()) {
    const name = entry.name;
    if (!name?.startsWith(PANEL_EVENT_DB_PREFIX)) continue;
    if (panelJournalGeneration(name) !== PANEL_EVENT_DB_GENERATION) {
      result.preservedUnknown.push(name);
      continue;
    }
    const lockResult = await withAvailableLock(name, async () => {
      const ownershipResult = await readOwnership(name);
      if (!ownershipResult.readable) {
        result.confirmed = false;
        result.preservedUnknown.push(name);
        return;
      }
      const ownership = ownershipResult.ownership;
      if (ownership && ownership.generation !== PANEL_JOURNAL_OWNERSHIP_GENERATION) {
        result.preservedUnknown.push(name);
        return;
      }
      try {
        await deleteEventDatabase(name);
        result.deleted.push(name);
      } catch {
        result.confirmed = false;
      }
    });
    if (!lockResult) result.skippedActive.push(name);
  }
  return result;
}

function panelJournalGeneration(name: string): string | null {
  if (!name.startsWith(PANEL_EVENT_DB_PREFIX)) return null;
  const suffix = name.slice(PANEL_EVENT_DB_PREFIX.length);
  return suffix.split("-", 1)[0] ?? null;
}

async function claimOwnership(db: IDBDatabase, name: string, ownerId: string): Promise<void> {
  const transaction = db.transaction(EVENT_STORE_NAMES.ownership, "readwrite");
  const store = transaction.objectStore(EVENT_STORE_NAMES.ownership);
  const existing = await requestToPromise<{ ownerId?: string; generation?: string } | undefined>(
    store.get("journal")
  );
  if (existing && existing.generation !== PANEL_JOURNAL_OWNERSHIP_GENERATION) {
    throw new Error(`Event database ${name} has an unknown ownership generation.`);
  }
  store.put({
    key: "journal",
    ownerId,
    generation: PANEL_JOURNAL_OWNERSHIP_GENERATION,
    claimedAt: Date.now()
  });
  await transactionDone(transaction);
}

async function releaseOwnership(
  db: IDBDatabase,
  name: string,
  ownerId: string | undefined,
  releaseLock: (() => void) | null
): Promise<void> {
  if (!ownerId) return;
  try {
    if (db.objectStoreNames.contains(EVENT_STORE_NAMES.ownership)) {
      const transaction = db.transaction(EVENT_STORE_NAMES.ownership, "readwrite");
      transaction.objectStore(EVENT_STORE_NAMES.ownership).delete("journal");
      await transactionDone(transaction);
    }
  } finally {
    releaseLock?.();
  }
}

async function readOwnership(name: string): Promise<OwnershipReadResult> {
  const opened = await openEventDatabase(name);
  if (!opened.ok) return { readable: false, error: opened.error };
  const db = opened.database.db;
  try {
    if (!db.objectStoreNames.contains(EVENT_STORE_NAMES.ownership)) {
      return { readable: true, ownership: null };
    }
    const transaction = db.transaction(EVENT_STORE_NAMES.ownership, "readonly");
    const completion = transactionDone(transaction);
    const ownership = await requestToPromise<{ ownerId?: string; generation?: string } | undefined>(
      transaction.objectStore(EVENT_STORE_NAMES.ownership).get("journal")
    );
    await completion;
    return { readable: true, ownership: ownership ?? null };
  } catch (error) {
    return {
      readable: false,
      error: error instanceof Error ? error : new Error("Could not read event database ownership.")
    };
  } finally {
    db.close();
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function panelJournalLocks(): LockManager | null {
  const locks = globalThis.navigator?.locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

function acquireOwnershipLock(name: string): Promise<() => void> {
  const locks = panelJournalLocks();
  if (!locks) {
    return Promise.reject(new Error("Panel Session journal coordination is unavailable."));
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolveHeld) => {
      releaseHeld = resolveHeld;
    });
    const timeout = globalThis.setTimeout(() => {
      finished = true;
      reject(new Error(`Acquiring ownership for ${name} timed out.`));
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);
    void locks
      .request(`${PANEL_JOURNAL_LOCK_PREFIX}${name}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          finished = true;
          globalThis.clearTimeout(timeout);
          reject(new Error(`Event database ${name} is already owned.`));
          return;
        }
        if (finished) {
          return;
        }
        finished = true;
        globalThis.clearTimeout(timeout);
        const release = () => releaseHeld();
        resolve(release);
        await held;
      })
      .catch((error) => {
        if (!finished) {
          finished = true;
          globalThis.clearTimeout(timeout);
          reject(error);
        }
      });
  });
}

async function withAvailableLock(name: string, work: () => Promise<void>): Promise<boolean> {
  const locks = panelJournalLocks();
  if (!locks) return false;
  let acquired = false;
  await locks.request(`${PANEL_JOURNAL_LOCK_PREFIX}${name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    acquired = true;
    await work();
  });
  return acquired;
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
  createStore(db, transaction, EVENT_STORE_NAMES.ownership, { keyPath: "key" });
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
