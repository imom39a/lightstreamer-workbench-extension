// Each Panel Session opens a database named after its own random identity and
// never recovers another session's journal, so an existing database at an
// older schema can only be residue. It is deleted and recreated rather than
// migrated (v8 dropped the unused searchTokens projection index).
export const AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION = 8;
// The ownership lock name predates schema v8 and stays stable across schema
// bumps so the guarded sweep and a running panel always contend on one lock.
export const AUTHORITATIVE_EVENT_OWNERSHIP_LOCK_VERSION = 7;
// The application identity predates the posting-store schema. Keep this
// logical name stable so schema upgrades happen in the deployed database.
export const AUTHORITATIVE_EVENT_DB_IDENTITY_VERSION = 2;
export const AUTHORITATIVE_EVENT_DB_NAME_PREFIX = "lsew-events-panel";
export const AUTHORITATIVE_EVENT_DB_NAME = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-session`;
export const AUTHORITATIVE_EVENT_CONTROL_KEY = "control";

const FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_PREFIX = "session";
const FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-v${AUTHORITATIVE_EVENT_DB_IDENTITY_VERSION}-${FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_PREFIX}`;

const INDEXEDDB_REQUEST_TIMEOUT_MS = 2_000;
export const AUTHORITATIVE_EVENT_STORE_NAMES = {
  historyControl: "historyControl",
  evidence: "evidence",
  facetPostings: "facetPostings",
  queryProjections: "queryProjections",
  facetAggregates: "facetAggregates",
  searchBlocks: "searchBlocks"
} as const;

type IndexedDatabaseDescriptor = Readonly<{ name?: string; version?: number }>;

type AuthoritativeEventDatabaseLockOptions = Readonly<{
  mode: "exclusive";
  ifAvailable?: boolean;
}>;

export type AuthoritativeEventDatabaseRuntime = Readonly<{
  listDatabases: () => Promise<readonly IndexedDatabaseDescriptor[]>;
  requestLock: <T>(
    name: string,
    options: AuthoritativeEventDatabaseLockOptions,
    callback: () => Promise<T> | T
  ) => Promise<T | null>;
}>;

export type AuthoritativeEventDatabaseIdentity = Readonly<{
  panelSessionId: string;
  schemaVersion: number;
  name: string;
}>;

const AUTHORITATIVE_EVENT_DATABASE_NAME_RE = /^lsew-events-panel-v(\d+)-(.+)$/;

const inProcessOwnershipLocks = new Set<string>();

function sanitizePanelSessionId(panelSessionId: string): string {
  return panelSessionId.replace(/[^A-Za-z0-9_-]/g, "-");
}

export type AuthoritativeEventDatabase = Readonly<{
  db: IDBDatabase;
  name: string;
}>;

/** Compact facet identity catalog; exact observations remain in facetPostings. */
export type AuthoritativeFacetAggregateRecord = Readonly<{
  intervalId: string;
  facet: string;
  facetIdentity: string;
  type: string;
  value: string;
  label: string;
}>;

export type AuthoritativeDatabaseOpenFailureCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "UNKNOWN_NEWER_SCHEMA"
  | "OPEN_FAILED"
  | "STARTUP_SWEEP_FAILED"
  | "OWNERSHIP_COULD_NOT_BE_CONFIRMED";

export class AuthoritativeDatabaseOpenError extends Error {
  readonly code: AuthoritativeDatabaseOpenFailureCode;

  constructor(code: AuthoritativeDatabaseOpenFailureCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AuthoritativeDatabaseOpenError";
    this.code = code;
  }
}

export function authoritativeEventDatabaseName(panelSessionId?: string | null): string {
  if (!panelSessionId) {
    return FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID;
  }
  return `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-v${AUTHORITATIVE_EVENT_DB_IDENTITY_VERSION}-${sanitizePanelSessionId(panelSessionId)}`;
}

export function parseAuthoritativeEventDatabaseName(name: string): AuthoritativeEventDatabaseIdentity | null {
  const match = AUTHORITATIVE_EVENT_DATABASE_NAME_RE.exec(name);
  if (!match) {
    return null;
  }
  const schemaVersion = Number(match[1]);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return null;
  }
  return {
    panelSessionId: match[2],
    schemaVersion,
    name
  };
}

function requestBrowserLock<T>(
  name: string,
  options: AuthoritativeEventDatabaseLockOptions,
  callback: () => Promise<T> | T
): Promise<T | null> {
  return navigator.locks.request(name, { ...options, mode: options.mode }, (lock) => {
    if (lock === null) {
      return null;
    }
    return callback();
  }) as Promise<T | null>;
}

function requestInProcessLock<T>(
  name: string,
  options: AuthoritativeEventDatabaseLockOptions,
  callback: () => Promise<T> | T
): Promise<T | null> {
  if (options.ifAvailable && inProcessOwnershipLocks.has(name)) {
    return Promise.resolve(null);
  }
  if (!options.ifAvailable && inProcessOwnershipLocks.has(name)) {
    return Promise.reject(new Error(`Cannot acquire exclusive ownership of ${name}: ownership is already held.`));
  }
  inProcessOwnershipLocks.add(name);
  return (async () => {
    const value = await callback();
    inProcessOwnershipLocks.delete(name);
    return value;
  })().catch((error) => {
    inProcessOwnershipLocks.delete(name);
    throw error;
  });
}

export function authoritativeEventDatabaseRuntime(overrides: Partial<AuthoritativeEventDatabaseRuntime> = {}): AuthoritativeEventDatabaseRuntime {
  const listDatabases = overrides.listDatabases
    ?? ((): Promise<readonly IndexedDatabaseDescriptor[]> => {
      if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") {
        return Promise.resolve([]);
      }
      return indexedDB.databases();
    });

  const browserLockRequest = (
    typeof navigator !== "undefined"
      ? (navigator as { locks?: { request: AuthoritativeEventDatabaseRuntime["requestLock"] } }).locks?.request
      : undefined
  );
  const requestLock = overrides.requestLock
    ?? (typeof navigator !== "undefined" && typeof browserLockRequest === "function"
      ? requestBrowserLock
      : requestInProcessLock);

  return { listDatabases, requestLock };
}

export async function openAuthoritativeEventDatabase(
  name = FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID
): Promise<AuthoritativeEventDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new AuthoritativeDatabaseOpenError(
      "INDEXEDDB_UNAVAILABLE",
      "IndexedDB is not available in this context."
    );
  }

  const existingVersion = await inspectDatabaseVersion(name);
  if (existingVersion > AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION) {
    throw new AuthoritativeDatabaseOpenError(
      "UNKNOWN_NEWER_SCHEMA",
      `Database ${name} uses unsupported schema version ${existingVersion}.`
    );
  }

  return openAtCurrentSchema(name);
}

export function deleteAuthoritativeEventDatabase(
  name = FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID,
  timeoutMs = INDEXEDDB_REQUEST_TIMEOUT_MS
): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.deleteDatabase(name);
    const timeout = globalThis.setTimeout(() => {
      settle(() => reject(new Error(`Deleting ${name} timed out.`)));
    }, timeoutMs);

    function settle(done: () => void): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      done();
    }

    request.onsuccess = () => settle(resolve);
    request.onerror = () => settle(() => reject(request.error ?? new Error(`Failed to delete ${name}.`)));
    request.onblocked = () => settle(() => reject(new Error(`Deleting ${name} was blocked.`)));
  });
}

function inspectDatabaseVersion(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(name);
    const timeout = globalThis.setTimeout(() => {
      settleReject(new AuthoritativeDatabaseOpenError("OPEN_FAILED", `Inspecting ${name} timed out.`));
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);

    function settleResolve(version: number): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(version);
    }

    function settleReject(error: AuthoritativeDatabaseOpenError): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      reject(error);
    }

    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      const version = database.version;
      database.close();
      settleResolve(version);
    };
    request.onerror = () => settleReject(new AuthoritativeDatabaseOpenError(
      "OPEN_FAILED",
      `Failed to inspect ${name}.`,
      request.error
    ));
    request.onblocked = () => settleReject(new AuthoritativeDatabaseOpenError(
      "OPEN_FAILED",
      `Inspecting ${name} was blocked.`
    ));
  });
}

function openAtCurrentSchema(name: string): Promise<AuthoritativeEventDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
    const timeout = globalThis.setTimeout(() => {
      settleReject(new AuthoritativeDatabaseOpenError("OPEN_FAILED", `Opening ${name} timed out.`));
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);

    function settleResolve(database: AuthoritativeEventDatabase): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(database);
    }

    function settleReject(error: AuthoritativeDatabaseOpenError): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      reject(error);
    }

    request.onupgradeneeded = (event) => {
      try {
        upgradeAuthoritativeDatabase(request.result, (event as IDBVersionChangeEvent).oldVersion);
      } catch (error) {
        request.transaction?.abort();
        settleReject(new AuthoritativeDatabaseOpenError("OPEN_FAILED", `Failed to upgrade ${name}.`, error));
      }
    };
    request.onerror = () => settleReject(new AuthoritativeDatabaseOpenError(
      "OPEN_FAILED",
      `Failed to open ${name}.`,
      request.error
    ));
    request.onblocked = () => settleReject(new AuthoritativeDatabaseOpenError(
      "OPEN_FAILED",
      `Opening ${name} was blocked.`
    ));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      try {
        validateAuthoritativeDatabaseShape(database);
        settleResolve({ db: database, name });
      } catch (error) {
        database.close();
        settleReject(new AuthoritativeDatabaseOpenError("OPEN_FAILED", `Database ${name} has an unsupported shape.`, error));
      }
    };
  });
}

function validateAuthoritativeDatabaseShape(database: IDBDatabase): void {
  const stores = [...database.objectStoreNames].sort();
  const expectedStores = Object.values(AUTHORITATIVE_EVENT_STORE_NAMES).sort();
  if (stores.length !== expectedStores.length || stores.some((name, index) => name !== expectedStores[index])) {
    throw new Error("Authoritative Event History requires exactly the versioned history, facet, projection, and aggregate stores.");
  }
  const transaction = database.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES), "readonly");
  const control = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl);
  if (control.keyPath !== "key") throw new Error("The historyControl store must be keyed by key.");
  const evidence = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  if (evidence.keyPath !== "sequence") throw new Error("The evidence store must be keyed by sequence.");
  const indexes = [...evidence.indexNames].sort();
  if (indexes.length !== 2 || indexes[0] !== "eventIdentity" || indexes[1] !== "facets") {
    throw new Error("The evidence store must have exactly the eventIdentity and facets indexes.");
  }
  const identity = evidence.index("eventIdentity");
  const facets = evidence.index("facets");
  if (identity.keyPath !== "eventId" || !identity.unique || facets.keyPath !== "facets" || !facets.multiEntry) {
    throw new Error("The evidence indexes do not match the authoritative schema.");
  }
  const postings = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings);
  if (JSON.stringify(postings.keyPath) !== JSON.stringify(["token", "sequence"])) {
    throw new Error("The facet posting store must use the versioned token and sequence key.");
  }
  if (postings.indexNames.length !== 3 || !postings.indexNames.contains("token") || !postings.indexNames.contains("facet") || !postings.indexNames.contains("sequence")) {
    throw new Error("The facet posting store must have exactly the token, facet, and sequence indexes.");
  }
  const token = postings.index("token");
  if (token.keyPath !== "token" || token.unique) {
    throw new Error("The facet posting token index does not match the authoritative schema.");
  }
  const facet = postings.index("facet");
  if (facet.keyPath !== "facet" || facet.unique || facet.multiEntry) {
    throw new Error("The facet posting facet index does not match the authoritative schema.");
  }
  const blockSequence = postings.index("sequence");
  if (blockSequence.keyPath !== "sequence" || blockSequence.unique || blockSequence.multiEntry) {
    throw new Error("The facet block sequence index does not match the authoritative schema.");
  }
  const projections = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections);
  if (projections.keyPath !== "sequence") throw new Error("The query projection store must be keyed by sequence.");
  if (projections.indexNames.length !== 1 || !projections.indexNames.contains("timestamp")) {
    throw new Error("The query projection store must have exactly the timestamp index.");
  }
  const timestamp = projections.index("timestamp");
  if (timestamp.keyPath !== "timestamp" || timestamp.unique || timestamp.multiEntry) {
    throw new Error("The timestamp projection index does not match the authoritative schema.");
  }
  const aggregates = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
  const searchBlocks = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.searchBlocks);
  if (searchBlocks.keyPath !== "sequence" || searchBlocks.indexNames.length !== 0) throw new Error("The search block store is incomplete.");
  if (JSON.stringify(aggregates.keyPath) !== JSON.stringify(["intervalId", "facetIdentity"])) {
    throw new Error("The facet aggregate store must be keyed by interval and typed facet identity.");
  }
  if (aggregates.indexNames.length !== 1 || !aggregates.indexNames.contains("intervalFacet")) {
    throw new Error("The facet aggregate store must have exactly the interval/facet index.");
  }
  const intervalFacet = aggregates.index("intervalFacet");
  if (JSON.stringify(intervalFacet.keyPath) !== JSON.stringify(["intervalId", "facet"]) || intervalFacet.unique || intervalFacet.multiEntry) {
    throw new Error("The facet aggregate interval/facet index does not match the authoritative schema.");
  }
}

/**
 * Create the current schema. A database left at any older version is residue
 * (no Panel Session reopens another session's journal), so its stores are
 * deleted and recreated instead of migrated.
 */
function upgradeAuthoritativeDatabase(database: IDBDatabase, oldVersion: number): void {
  if (oldVersion > 0) {
    for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);
  }
  database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, { keyPath: "key" });
  const evidence = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, { keyPath: "sequence" });
  evidence.createIndex("eventIdentity", "eventId", { unique: true });
  evidence.createIndex("facets", "facets", { multiEntry: true });
  const postings = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, { keyPath: ["token", "sequence"] });
  postings.createIndex("token", "token", { unique: false });
  postings.createIndex("facet", "facet", { unique: false });
  postings.createIndex("sequence", "sequence", { unique: false });
  const projections = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections, { keyPath: "sequence" });
  projections.createIndex("timestamp", "timestamp", { unique: false });
  const aggregates = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates, { keyPath: ["intervalId", "facetIdentity"] });
  aggregates.createIndex("intervalFacet", ["intervalId", "facet"], { unique: false });
  database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.searchBlocks, { keyPath: "sequence" });
}
