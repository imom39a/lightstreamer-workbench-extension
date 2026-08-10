export const AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION = 2;
export const AUTHORITATIVE_EVENT_DB_NAME = "lsew-history-session";
export const AUTHORITATIVE_EVENT_DB_KNOWN_LEGACY_SCHEMA_VERSION = 1;
export const AUTHORITATIVE_EVENT_CONTROL_KEY = "control";

const INDEXEDDB_REQUEST_TIMEOUT_MS = 2_000;

export const AUTHORITATIVE_EVENT_STORE_NAMES = {
  historyControl: "historyControl",
  evidence: "evidence"
} as const;

export type AuthoritativeEventDatabase = Readonly<{
  db: IDBDatabase;
  name: string;
}>;

export type AuthoritativeDatabaseOpenFailureCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "UNKNOWN_NEWER_SCHEMA"
  | "OPEN_FAILED";

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
    return AUTHORITATIVE_EVENT_DB_NAME;
  }
  return `lsew-history-${panelSessionId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export async function openAuthoritativeEventDatabase(
  name = AUTHORITATIVE_EVENT_DB_NAME
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

export function deleteAuthoritativeEventDatabase(name = AUTHORITATIVE_EVENT_DB_NAME): Promise<void> {
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
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const database = request.result;
      const version = database.version;
      database.close();
      resolve(version);
    };
    request.onerror = () => reject(new AuthoritativeDatabaseOpenError(
      "OPEN_FAILED",
      `Failed to inspect ${name}.`,
      request.error
    ));
    request.onblocked = () => reject(new AuthoritativeDatabaseOpenError(
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
      database.onversionchange = () => database.close();
      settleResolve({ db: database, name });
    };
  });
}

function upgradeAuthoritativeDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
  oldVersion: number
): void {
  if (oldVersion === AUTHORITATIVE_EVENT_DB_KNOWN_LEGACY_SCHEMA_VERSION) {
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
}
