import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  openAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

afterEach(async () => {
  // The tests use unique database names and close their handles explicitly.
});

describe("filter-impl-07 IndexedDB schema", () => {
  it("opens the versioned posting layout with an isolated token namespace", async () => {
    expect(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION).toBe(3);
    expect(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).toBe("facetPostings");

    const database = await openAuthoritativeEventDatabase(`lsew-filter-impl-07-schema-${Date.now()}`);
    expect([...database.db.objectStoreNames].sort()).toEqual(["evidence", "facetPostings", "historyControl"]);
    const transaction = database.db.transaction("facetPostings", "readonly");
    const postings = transaction.objectStore("facetPostings");
    expect(postings.keyPath).toEqual(["token", "sequence"]);
    expect([...postings.indexNames]).toEqual(["token"]);
    expect(postings.index("token").keyPath).toBe("token");
    expect(postings.index("token").unique).toBe(false);
    database.db.close();
  });
});
