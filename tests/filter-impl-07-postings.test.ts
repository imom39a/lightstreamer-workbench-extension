import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { extractEvidenceFacets } from "../src/core/evidence-facets";
import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import { AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE, createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";

Object.assign(globalThis, { indexedDB: new IDBFactory() });

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

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function legacyFacets(candidate: LightstreamerEventEnvelope): string[] {
  return [
    ["v1", "kind", candidate.kind], ["v1", "clientId", candidate.client?.id ?? null],
    ["v1", "sessionId", candidate.client?.sessionId ?? null], ["v1", "subscriptionId", candidate.subscription?.id ?? null],
    ["v1", "mode", candidate.subscription?.mode ?? null], ["v1", "item", candidate.item?.name ?? null],
    ["v1", "itemPosition", candidate.item?.position ?? null], ["v1", "listenerId", candidate.listener?.id ?? null],
    ["v1", "key", candidate.update?.key ?? null], ["v1", "command", candidate.update?.command ?? null],
    ["v1", "snapshot", Boolean(candidate.update?.isSnapshot)], ["v1", "synthetic", candidate.synthetic]
  ].map((facet) => JSON.stringify(facet));
}

async function readPostings(session: string) {
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
    const session = `filter-impl-07-postings-${Date.now()}-${Math.random()}`;
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    try {
      const candidate = event();
      const expected = extractEvidenceFacets(candidate).selectableValues;
      expect((await history.offer(candidate).settled).outcome).toBe("BECAME_EVIDENCE");

      const postings = await readPostings(session);
      expect(postings).toHaveLength(expected.length);
      expect(postings.map((posting) => (posting as { facetIdentity: string }).facetIdentity).sort())
        .toEqual(expected.map((facet) => facet.identity).sort());
    } finally {
      await history.close();
      await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
    }
  });

  it("does not invent postings for missing facets or topology checkpoints", async () => {
    const session = `filter-impl-07-missing-${Date.now()}-${Math.random()}`;
    const history = await createIndexedDbEventHistory({ panelSessionId: session });
    try {
      const incomplete = event({ id: "empty", subscription: undefined, update: {} });
      await history.offer(incomplete).settled;
      await history.offer({ id: "checkpoint", kind: "topology-checkpoint", checkpoint: {} }).settled;

      const postings = await readPostings(session);
      expect(postings).toHaveLength(extractEvidenceFacets(incomplete).selectableValues.length);
      expect(postings.every((posting) => (posting as { facetIdentity: string }).facetIdentity !== "null")).toBe(true);
    } finally {
      await history.close();
      await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(session));
    }
  });

  it("preserves populated v2 Evidence while rebuilding collision-safe v3 postings", async () => {
    const session = `filter-impl-07-migration-${Date.now()}-${Math.random()}`;
    const name = authoritativeEventDatabaseName(session);
    let database: IDBDatabase | undefined;
    try {
      const candidate = event({ id: "v2-survivor", update: { key: "a,b", command: "ADD", isSnapshot: false } });
      const serialized = serializeJournalEvidenceCandidate(candidate);
      const interval = { id: `${session}:interval-1`, ordinal: 1 };
      const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION - 1);
      request.onupgradeneeded = () => {
        const created = request.result;
        const evidence = created.createObjectStore("evidence", { keyPath: "sequence" });
        evidence.createIndex("eventIdentity", "eventId", { unique: true });
        evidence.createIndex("facets", "facets", { multiEntry: true });
        created.createObjectStore("historyControl", { keyPath: "key" });
        const transaction = request.transaction!;
        evidence.put({ intervalId: interval.id, sequence: 1, eventId: candidate.id, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes: journalAccountedBytes(serialized.bytes), facets: legacyFacets(candidate) });
        transaction.objectStore("historyControl").put({ key: "control", schemaVersion: 2, recordVersion: 3, panelSessionId: session, interval, phase: "RUNNING", terminal: null, nextSequence: 2, committedEvidenceBoundary: { intervalId: interval.id, sequence: 1, eventId: candidate.id }, retainedRange: { first: { intervalId: interval.id, sequence: 1, eventId: candidate.id }, last: { intervalId: interval.id, sequence: 1, eventId: candidate.id } }, retainedCount: 1, replayPayloadBytes: serialized.bytes, accountedBytes: journalAccountedBytes(serialized.bytes) });
      };
      database = await requestValue(request);
      database.close();
      database = undefined;

      const upgraded = await (await import("../src/core/indexeddb/authoritative-event-db")).openAuthoritativeEventDatabase(name);
      database = upgraded.db;
      const transaction = database.transaction(["evidence", "facetPostings"], "readonly");
      const evidence = await requestValue(transaction.objectStore("evidence").get(1));
      const postings = await requestValue(transaction.objectStore("facetPostings").getAll()) as Array<{ token: string; facetIdentity: string }>;
      const expected = extractEvidenceFacets(candidate).selectableValues.map((facet) => ({ token: JSON.stringify([AUTHORITATIVE_EVENT_FACET_POSTING_NAMESPACE, facet.identity]), facetIdentity: facet.identity }));
      expect(evidence).toMatchObject({ eventId: candidate.id, replayPayload: serialized.payload });
      expect(postings.map(({ token, facetIdentity }) => ({ token, facetIdentity })).sort((a, b) => a.token.localeCompare(b.token))).toEqual(expected.sort((a, b) => a.token.localeCompare(b.token)));
    } finally {
      database?.close();
      await deleteAuthoritativeEventDatabase(name);
    }
  });
});
