import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { extractEvidenceFacets } from "../src/core/evidence-facets";

import {
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase,
  openAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

const candidate = (id: string) => ({
  id,
  timestamp: 1_700_000_000_000,
  direction: "inbound" as const,
  source: "server" as const,
  captureSource: "listener" as const,
  synthetic: false,
  kind: "item-update" as const,
  update: { key: "key", command: "ADD" }
});
const postingCount = extractEvidenceFacets(candidate("count")).selectableValues.length;

async function countPostings(session: string): Promise<number> {
  const database = await openAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
  const request = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, "readonly")
    .objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).count();
  const count = await new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.db.close();
  return count;
}

describe("filter-impl-07 posting failure safety", () => {
  it("does not write Evidence or postings for a duplicate retained identity", async () => {
    const session = `filter-impl-07-failure-${Date.now()}-${Math.random()}`;
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    try {
      expect((await history.offer(candidate("same-id")).settled).outcome).toBe("BECAME_EVIDENCE");
      const duplicate = await history.offer(candidate("same-id")).settled;
      expect(duplicate).toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "INVALID_CANDIDATE", dimension: "EVENT_IDENTITY" }
      });
      expect(await countPostings(session)).toBe(postingCount);
      const read = await history.read({});
      expect(read).toMatchObject({ ok: true, value: { total: 1 } });
      expect(history.status()).toMatchObject({ phase: "RUNNING", persistence: { mode: "JOURNAL", health: "HEALTHY" } });
    } finally {
      await history.close();
      await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
    }
  });

  it("clears postings in the same interval transaction as Evidence", async () => {
    const session = `filter-impl-07-clear-${Date.now()}-${Math.random()}`;
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    try {
      await history.offer(candidate("clear-me")).settled;
      expect(await countPostings(session)).toBe(postingCount);
      expect((await history.clear()).ok).toBe(true);
      expect(await countPostings(session)).toBe(0);
    } finally {
      await history.close();
      await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
    }
  });
});
