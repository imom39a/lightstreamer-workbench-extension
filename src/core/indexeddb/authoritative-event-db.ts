import { extractEvidenceFacets } from "../evidence-facets";
import { deserializeJournalEvidenceCandidate } from "../event-history-serialization";

export const AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION = 3;
export const AUTHORITATIVE_EVENT_DB_NAME_PREFIX = "lsew-events-panel";
export const AUTHORITATIVE_EVENT_DB_NAME = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-session`;
export const AUTHORITATIVE_EVENT_DB_KNOWN_LEGACY_SCHEMA_VERSION = 1;
export const AUTHORITATIVE_EVENT_CONTROL_KEY = "control";

const FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_PREFIX = "session";
const FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-${AUTHORITATIVE_EVENT_DB_KNOWN_LEGACY_SCHEMA_VERSION}-${FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_PREFIX}`;

const INDEXEDDB_REQUEST_TIMEOUT_MS = 2_000;
export const AUTHORITATIVE_EVENT_STORE_NAMES = {
  historyControl: "historyControl",
  evidence: "evidence",
  facetPostings: "facetPostings"
} as const;

const AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE = "facet-v2";
const AUTHORITATIVE_EVENT_FACET_COUNT = 12;

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
  return `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-v${AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION}-${sanitizePanelSessionId(panelSessionId)}`;
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

export function deleteAuthoritativeEventDatabase(name = FALLBACK_AUTHORITATIVE_EVENT_DB_SESSION_ID): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.deleteDatabase(name);
    const timeout = globalThis.setTimeout(() => {
      settle(() => reject(new Error(`Deleting ${name} timed out.`)));
    }, INDEXEDDB_REQUEST_TIMEOUT_MS);

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
        upgradeAuthoritativeDatabase(request.result, request.transaction, (event as IDBVersionChangeEvent).oldVersion);
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
  const expectedStores = [AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, AUTHORITATIVE_EVENT_STORE_NAMES.historyControl].sort();
  if (stores.length !== expectedStores.length || stores.some((name, index) => name !== expectedStores[index])) {
    throw new Error("Authoritative Event History requires exactly the historyControl and evidence stores.");
  }
  const transaction = database.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.evidence, AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, AUTHORITATIVE_EVENT_STORE_NAMES.historyControl], "readonly");
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
  if (postings.indexNames.length !== 1 || !postings.indexNames.contains("token")) {
    throw new Error("The facet posting store must have exactly the token index.");
  }
  const token = postings.index("token");
  if (token.keyPath !== "token" || token.unique) {
    throw new Error("The facet posting token index does not match the authoritative schema.");
  }
}

function upgradeAuthoritativeDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
  oldVersion: number
): void {
  if (oldVersion > 0 && oldVersion < 2) {
    for (const name of [...database.objectStoreNames]) {
      database.deleteObjectStore(name);
    }
  }
  if (!database.objectStoreNames.contains(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl)) {
    database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, { keyPath: "key" });
  }
  const evidence = database.objectStoreNames.contains(AUTHORITATIVE_EVENT_STORE_NAMES.evidence)
    ? transaction?.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence)
    : database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, { keyPath: "sequence" });
  if (!evidence) {
    throw new Error("Authoritative evidence store is unavailable during upgrade.");
  }
  if (!evidence.indexNames.contains("eventIdentity")) {
    evidence.createIndex("eventIdentity", "eventId", { unique: true });
  }
  if (!evidence.indexNames.contains("facets")) {
    evidence.createIndex("facets", "facets", { multiEntry: true });
  }
  const postings = database.objectStoreNames.contains(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings)
    ? transaction?.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings)
    : database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, { keyPath: ["token", "sequence"] });
  if (!postings) {
    throw new Error("The facet posting store is unavailable during upgrade.");
  }
  if (!postings.indexNames.contains("token")) {
    postings.createIndex("token", "token", { unique: false });
  }
  if (oldVersion === 2) {
    rebuildFacetPostingsFromEvidence(transaction!, postings);
  }
}

type MigrationEvidenceRecord = Readonly<{
  intervalId: string;
  sequence: number;
  eventId: string;
  replayPayload: string;
}>;

function rebuildFacetPostingsFromEvidence(transaction: IDBTransaction, postings: IDBObjectStore): void {
  const evidence = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  const request = evidence.openCursor();
  request.onerror = () => transaction.abort();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    try {
      const record = cursor.value as MigrationEvidenceRecord;
      const candidate = deserializeJournalEvidenceCandidate(record.replayPayload);
      if (candidate.kind !== "topology-checkpoint") {
        for (const facet of extractEvidenceFacets(candidate).selectableValues.slice(0, AUTHORITATIVE_EVENT_FACET_COUNT).map((entry) => entry.identity)) {
          postings.add({
            token: JSON.stringify([AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE, facet]),
            sequence: record.sequence,
            intervalId: record.intervalId,
            eventId: record.eventId,
            facetIdentity: facet
          });
        }
      }
      cursor.continue();
    } catch {
      transaction.abort();
    }
  };
}
