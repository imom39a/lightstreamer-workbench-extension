import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { extractEvidenceFacets } from "../src/core/evidence-facets";

import {
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase,
  openAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

const session = "filter-impl-07-failure";

afterEach(async () => {
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
});

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

async function countPostings(): Promise<number> {
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
  it("rolls back Evidence and postings together when the unique Evidence identity rejects a batch", async () => {
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    expect((await history.offer(candidate("same-id")).settled).outcome).toBe("BECAME_EVIDENCE");
    const duplicate = await history.offer(candidate("same-id")).settled;
    expect(duplicate.outcome).toBe("NOT_EVIDENCE");
    expect(await countPostings()).toBe(postingCount);
    const read = await history.read({});
    expect(read).toMatchObject({ ok: true, value: { total: 1 } });
    await history.close();
  });

  it("clears postings in the same interval transaction as Evidence", async () => {
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    await history.offer(candidate("clear-me")).settled;
    expect(await countPostings()).toBe(postingCount);
    expect((await history.clear()).ok).toBe(true);
    expect(await countPostings()).toBe(0);
    await history.close();
  });
});
