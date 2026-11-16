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
    expect(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION).toBe(7);
    expect(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).toBe("facetPostings");

    const panelSessionId = `filter-impl-07-schema-${Date.now()}-${Math.random()}`;
    const name = authoritativeEventDatabaseName(panelSessionId);
    let database: Awaited<ReturnType<typeof openAuthoritativeEventDatabase>> | undefined;
    try {
      database = await openAuthoritativeEventDatabase(name);
      expect([...database.db.objectStoreNames].sort()).toEqual(["evidence", "facetAggregates", "facetPostings", "historyControl", "queryProjections", "searchBlocks"]);
      const transaction = database.db.transaction("facetPostings", "readonly");
      const postings = transaction.objectStore("facetPostings");
      expect(postings.keyPath).toEqual(["token", "sequence"]);
      expect([...postings.indexNames]).toEqual(["facet", "sequence", "token"]);
      expect(postings.index("token").keyPath).toBe("token");
      expect(postings.index("token").unique).toBe(false);
      expect(postings.index("facet").keyPath).toBe("facet");
      const aggregates = database.db.transaction("facetAggregates", "readonly").objectStore("facetAggregates");
      expect(aggregates.keyPath).toEqual(["intervalId", "facetIdentity"]);
      expect([...aggregates.indexNames]).toEqual(["intervalFacet"]);
    } finally {
      database?.db.close();
      await deleteAuthoritativeEventDatabase(name);
    }
  });

  it.each([
    { name: "timestamp key path", timestamp: ["wrongTimestamp"], searchTokens: "searchTokens", timestampUnique: false, timestampMultiEntry: false, searchUnique: false, searchMultiEntry: true },
    { name: "timestamp uniqueness", timestamp: "timestamp", searchTokens: "searchTokens", timestampUnique: true, timestampMultiEntry: false, searchUnique: false, searchMultiEntry: true },
    { name: "timestamp multiEntry", timestamp: "timestamp", searchTokens: "searchTokens", timestampUnique: false, timestampMultiEntry: true, searchUnique: false, searchMultiEntry: true },
    { name: "searchTokens key path", timestamp: "timestamp", searchTokens: "wrongTokens", timestampUnique: false, timestampMultiEntry: false, searchUnique: false, searchMultiEntry: true },
    { name: "searchTokens uniqueness", timestamp: "timestamp", searchTokens: "searchTokens", timestampUnique: false, timestampMultiEntry: false, searchUnique: true, searchMultiEntry: true },
    { name: "searchTokens multiEntry", timestamp: "timestamp", searchTokens: "searchTokens", timestampUnique: false, timestampMultiEntry: false, searchUnique: false, searchMultiEntry: false }
  ])("rejects malformed deployed projection index shape: $name", async ({ timestamp, searchTokens, timestampUnique, timestampMultiEntry, searchUnique, searchMultiEntry }) => {
    const panelSessionId = `filter-impl-07-malformed-${Date.now()}-${Math.random()}`;
    const name = authoritativeEventDatabaseName(panelSessionId);
    const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("historyControl", { keyPath: "key" });
      const evidence = database.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventIdentity", "eventId", { unique: true });
      evidence.createIndex("facets", "facets", { multiEntry: true });
      const postings = database.createObjectStore("facetPostings", { keyPath: ["token", "sequence"] });
      postings.createIndex("token", "token", { unique: false });
      const projections = database.createObjectStore("queryProjections", { keyPath: "sequence" });
      projections.createIndex("timestamp", timestamp, { unique: timestampUnique, multiEntry: timestampMultiEntry });
      projections.createIndex("searchTokens", searchTokens, { unique: searchUnique, multiEntry: searchMultiEntry });
    };
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
    await expect(openAuthoritativeEventDatabase(name)).rejects.toMatchObject({ code: "OPEN_FAILED" });
    await deleteAuthoritativeEventDatabase(name);
  });
});
