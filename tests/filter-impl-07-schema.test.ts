import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase,
  openAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

describe("filter-impl-07 IndexedDB schema", () => {
  it("opens the versioned posting layout with an isolated token namespace", async () => {
    expect(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION).toBe(3);
    expect(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).toBe("facetPostings");

    const panelSessionId = `filter-impl-07-schema-${Date.now()}-${Math.random()}`;
    const name = authoritativeEventDatabaseName(panelSessionId);
    let database: Awaited<ReturnType<typeof openAuthoritativeEventDatabase>> | undefined;
    try {
      database = await openAuthoritativeEventDatabase(name);
      expect([...database.db.objectStoreNames].sort()).toEqual(["evidence", "facetPostings", "historyControl"]);
      const transaction = database.db.transaction("facetPostings", "readonly");
      const postings = transaction.objectStore("facetPostings");
      expect(postings.keyPath).toEqual(["token", "sequence"]);
      expect([...postings.indexNames]).toEqual(["token"]);
      expect(postings.index("token").keyPath).toBe("token");
      expect(postings.index("token").unique).toBe(false);
    } finally {
      database?.db.close();
      await deleteAuthoritativeEventDatabase(name);
    }
  });
});
