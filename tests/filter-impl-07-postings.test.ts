import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { extractEvidenceFacets } from "../src/core/evidence-facets";
import {
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

const session = "filter-impl-07-postings";

afterEach(async () => {
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
});

function event(overrides: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "sub-1", mode: "COMMAND" },
    update: { key: "key-1", command: "ADD", isSnapshot: true },
    ...overrides
  };
}

async function readPostings() {
  const database = await (await import("../src/core/indexeddb/authoritative-event-db")).openAuthoritativeEventDatabase(
    authoritativeEventDatabaseName(session)
  );
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, "readonly");
  const request = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).getAll();
  const result = await new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
  });
  database.db.close();
  return result;
}

describe("filter-impl-07 bounded facet postings", () => {
  it("writes canonical typed postings atomically with accepted Evidence", async () => {
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    const candidate = event();
    const expected = extractEvidenceFacets(candidate).selectableValues;
    expect((await history.offer(candidate).settled).outcome).toBe("BECAME_EVIDENCE");

    const postings = await readPostings();
    expect(postings).toHaveLength(expected.length);
    expect(postings.map((posting) => (posting as { facetIdentity: string }).facetIdentity).sort())
      .toEqual(expected.map((facet) => facet.identity).sort());
    await history.close();
  });

  it("does not invent postings for missing facets or topology checkpoints", async () => {
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    const incomplete = event({ id: "empty", subscription: undefined, update: {} });
    await history.offer(incomplete).settled;
    await history.offer({ id: "checkpoint", kind: "topology-checkpoint", checkpoint: {} }).settled;

    const postings = await readPostings();
    expect(postings).toHaveLength(extractEvidenceFacets(incomplete).selectableValues.length);
    expect(postings.every((posting) => (posting as { facetIdentity: string }).facetIdentity !== "null")).toBe(true);
    await history.close();
  });
});
