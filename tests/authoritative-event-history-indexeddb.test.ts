import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import {
  openEventHistory,
  type EvidenceCandidate
} from "../src/core/event-history-authoritative";
import { serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";

function candidate(id: string, overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    ...overrides
  } as EvidenceCandidate;
}

async function freshHistory(panelSessionId: string) {
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId });
}

describe("IndexedDB authoritative EventHistory", () => {
  it("selects the primary journal before the first offer", async () => {
    const history = await freshHistory("indexed-primary");
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });

    expect(status).toMatchObject({
      capacity: { tier: "NORMAL" },
      fallback: null
    });
    await history.close();
  });

  it("creates exactly the control and evidence stores with only identity and facet indexes", async () => {
    const panelSessionId = "indexed-schema";
    const history = await freshHistory(panelSessionId);
    await history.close();

    const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect([...database.objectStoreNames]).toEqual(["evidence", "historyControl"]);
    const transaction = database.transaction("evidence", "readonly");
    const evidence = transaction.objectStore("evidence");
    expect([...evidence.indexNames]).toEqual(["eventIdentity", "facets"]);
    expect(evidence.index("eventIdentity").unique).toBe(true);
    expect(evidence.index("facets").multiEntry).toBe(true);
    database.close();
  });

  it("batches Capture-order writes at 256 candidates and publishes only after each transaction completes", async () => {
    const history = await freshHistory("indexed-batches");
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const publications: string[] = [];
    const publicationBatchSizes: number[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") {
        publicationBatchSizes.push(publication.evidence.length);
        publications.push(...publication.evidence.map((entry) => entry.eventId));
      }
    });

    const receipts = Array.from({ length: 600 }, (_, index) => history.offer(candidate(`event-${index}`)));
    expect(receipts.every((receipt) => receipt.intake === "QUEUED")).toBe(true);
    expect(publications).toEqual([]);
    await Promise.all(receipts.map((receipt) => receipt.settled));

    const writeTransactions = transactionSpy.mock.calls.filter(([, mode]) => mode === "readwrite");
    expect(writeTransactions).toHaveLength(3);
    expect(publicationBatchSizes).toEqual([256, 256, 88]);
    expect(publications).toEqual(Array.from({ length: 600 }, (_, index) => `event-${index}`));
    transactionSpy.mockRestore();
    await history.close();
  });

  it("rolls back a failed batch and stops the queued tail at the prior boundary", async () => {
    const history = await freshHistory("indexed-abort-tail");
    await history.offer(candidate("already-committed")).settled;
    const failedBatch = [history.offer(candidate("already-committed")), history.offer(candidate("same-batch-new"))];
    const tail = history.offer(candidate("tail-after-abort"));

    const failedResults = await Promise.all(failedBatch.map((receipt) => receipt.settled));
    expect(failedResults).toHaveLength(2);
    for (const result of failedResults) {
      expect(result).toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" }, committedEvidenceBoundary: { sequence: 1 } });
    }
    await expect(tail.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1, eventId: "already-committed" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { total: 1, evidence: [expect.objectContaining({ eventId: "already-committed" })] }
    });
    expect(history.offer(candidate("after-stop")).intake).toBe("REFUSED");
    await history.close();
  });

  it("keeps an oversized candidate alone and starts a new transaction at the soft byte target", async () => {
    const history = await freshHistory("indexed-byte-batches");
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const large = (id: string, size: number): EvidenceCandidate => candidate(id, {
      raw: { payload: "x".repeat(size) }
    } as Partial<EvidenceCandidate>);

    const receipts = [
      history.offer(large("large-one", 600_000)),
      history.offer(large("large-two", 600_000)),
      history.offer(large("oversized", 1_100_000)),
      history.offer(candidate("after-oversized"))
    ];
    await Promise.all(receipts.map((receipt) => receipt.settled));

    const writeTransactions = transactionSpy.mock.calls.filter(([, mode]) => mode === "readwrite");
    expect(writeTransactions).toHaveLength(4);
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [
          expect.objectContaining({ eventId: "large-one" }),
          expect.objectContaining({ eventId: "large-two" }),
          expect.objectContaining({ eventId: "oversized" }),
          expect.objectContaining({ eventId: "after-oversized" })
        ]
      }
    });
    transactionSpy.mockRestore();
    await history.close();
  });

  it("keeps only one IndexedDB write transaction in flight and reads the prior snapshot while it is stalled", async () => {
    const history = await freshHistory("indexed-stalled-transaction");
    const originalAdd = IDBObjectStore.prototype.add;
    let inFlight = 0;
    let maximumInFlight = 0;
    let resolveSnapshot!: (value: Promise<unknown>) => void;
    const snapshotReady = new Promise<Promise<unknown>>((resolve) => { resolveSnapshot = resolve; });
    const addSpy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = originalAdd.apply(this, args);
      if (this.name === "evidence") {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        request.addEventListener("success", () => {
          inFlight -= 1;
        }, { once: true });
        resolveSnapshot(history.read({}));
      }
      return request;
    });

    const first = history.offer(candidate("stalled"));
    const priorSnapshot = await snapshotReady;
    expect(priorSnapshot).toMatchObject({
      ok: true,
      value: { evidence: [], committedEvidenceBoundary: null }
    });
    await expect(first.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    expect(maximumInFlight).toBe(1);
    addSpy.mockRestore();
    await history.close();
  });

  it("keeps reads at the committed snapshot and preserves query parity", async () => {
    const history = await freshHistory("indexed-query");
    const events = [
      candidate("one", {
        client: { id: "client-a", sessionId: "session-a" },
        subscription: { id: "sub-a", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        update: { key: "alpha", command: "ADD", isSnapshot: true }
      }),
      candidate("two", {
        client: { id: "client-a", sessionId: "session-a" },
        subscription: { id: "sub-a", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        update: { key: "beta", command: "UPDATE", isSnapshot: false }
      }),
      candidate("three", {
        client: { id: "client-b", sessionId: "session-b" },
        subscription: { id: "sub-b", mode: "MERGE" },
        item: { name: "quotes", position: 1 }
      })
    ];
    for (const event of events) await history.offer(event).settled;

    await expect(history.read({ filters: { mode: "COMMAND" }, find: "LPH" })).resolves.toMatchObject({
      ok: true,
      value: {
        total: 1,
        evidence: [expect.objectContaining({ eventId: "one" })],
        retainedRange: {
          first: expect.objectContaining({ sequence: 1 }),
          last: expect.objectContaining({ sequence: 3 })
        }
      }
    });
    await expect(history.read({ offsetFromNewest: 1, limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "two" })], total: 3 }
    });
    await expect(history.read({ eventId: "three" })).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "three" })], total: 1 }
    });
    await history.close();
  });

  it("keeps the panel-lifetime boundary across Clear and rejects an atomic identity collision", async () => {
    const history = await freshHistory("indexed-boundary");
    await history.offer(candidate("before-clear")).settled;
    await expect(history.clear()).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [], committedEvidenceBoundary: { sequence: 1, eventId: "before-clear" }, retainedRange: null }
    });
    await expect(history.offer(candidate("after-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2 }
    });

    const duplicate = history.offer(candidate("after-clear"));
    await expect(duplicate.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 2 }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "after-clear", sequence: 2 })] }
    });
    expect(history.offer(candidate("after-abort")).intake).toBe("REFUSED");
    await history.close();
  });

  it("stores replay-complete journal facts separately from sanitized export serialization", async () => {
    const event = candidate("semantic", {
      client: { id: "client-a", semanticValueStates: { status: { state: "requested" } } },
      topology: {
        version: 1,
        kind: "item-update",
        pageEpoch: "page-a",
        captureSequence: 1,
        provenance: { instrumentationSource: "official-public-api" },
        coverage: { status: "complete", getters: {} }
      }
    } as Partial<EvidenceCandidate>);
    const serialized = serializeJournalEvidenceCandidate(event);
    expect(serialized.payload).toContain("semanticValueStates");
    expect(serialized.payload).toContain("topology");
    expect(serialized.bytes).toBe(new TextEncoder().encode(serialized.payload).byteLength);

    const history = await freshHistory("indexed-serializer");
    await history.offer(event).settled;
    const read = await history.read({});
    expect(read).toMatchObject({ ok: true, value: { evidence: [{ candidate: event }] } });
    await history.close();
  });

  it("destructively replaces the known v1 schema and falls back without downgrading unknown newer schema", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const knownName = authoritativeEventDatabaseName("known-v1");
    const known = indexedDB.open(knownName, 1);
    known.onupgradeneeded = () => {
      known.result.createObjectStore("events", { keyPath: "seq" });
      known.result.createObjectStore("eventMeta", { keyPath: "seq" });
      known.result.createObjectStore("eventSearchTokens", { keyPath: ["token", "seq"] });
    };
    await new Promise<void>((resolve, reject) => {
      known.onsuccess = () => { known.result.close(); resolve(); };
      known.onerror = () => reject(known.error);
    });
    const replaced = await openEventHistory({ panelSessionId: "known-v1" });
    let replacedStatus: unknown;
    replaced.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") replacedStatus = publication.status;
    });
    expect(replacedStatus).toMatchObject({ capacity: { tier: "NORMAL" }, fallback: null });
    await replaced.close();

    const newerName = authoritativeEventDatabaseName("newer-schema");
    const newer = indexedDB.open(newerName, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION + 10);
    newer.onupgradeneeded = () => { newer.result.createObjectStore("future"); };
    await new Promise<void>((resolve, reject) => {
      newer.onsuccess = () => { newer.result.close(); resolve(); };
      newer.onerror = () => reject(newer.error);
    });
    const fallback = await openEventHistory({ panelSessionId: "newer-schema" });
    let fallbackStatus: unknown;
    fallback.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") fallbackStatus = publication.status;
    });
    expect(fallbackStatus).toMatchObject({
      capacity: { tier: "LOWER" },
      fallback: "UNKNOWN_NEWER_SCHEMA"
    });
    await fallback.close();
  });

  it("falls back instead of mixing evidence residue with a missing control record", async () => {
    const panelSessionId = "indexed-missing-control";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const name = authoritativeEventDatabaseName(panelSessionId);
    const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const evidence = request.result.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventIdentity", "eventId", { unique: true });
      evidence.createIndex("facets", "facets", { multiEntry: true });
      request.result.createObjectStore("historyControl", { keyPath: "key" });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("evidence", "readwrite");
    transaction.objectStore("evidence").put({
      intervalId: `${panelSessionId}:interval-1`,
      sequence: 1,
      eventId: "residue",
      replayPayload: serializeJournalEvidenceCandidate(candidate("residue")).payload,
      serializedBytes: 1,
      facets: []
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

    const history = await openEventHistory({ panelSessionId });
    let initialStatus: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") initialStatus = publication.status;
    });
    expect(initialStatus).toMatchObject({ capacity: { tier: "LOWER" }, fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
    await history.close();
  });

  it("falls back when control totals disagree with an otherwise valid evidence record", async () => {
    const panelSessionId = "indexed-incoherent-control";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const name = authoritativeEventDatabaseName(panelSessionId);
    const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const evidence = request.result.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventIdentity", "eventId", { unique: true });
      evidence.createIndex("facets", "facets", { multiEntry: true });
      request.result.createObjectStore("historyControl", { keyPath: "key" });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const interval = { id: `${panelSessionId}:interval-1`, ordinal: 1 };
    const serialized = serializeJournalEvidenceCandidate(candidate("coherent-record"));
    const transaction = database.transaction(["historyControl", "evidence"], "readwrite");
    transaction.objectStore("evidence").put({
      intervalId: interval.id,
      sequence: 1,
      eventId: "coherent-record",
      replayPayload: serialized.payload,
      serializedBytes: serialized.bytes,
      facets: []
    });
    transaction.objectStore("historyControl").put({
      key: "control",
      schemaVersion: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
      recordVersion: 1,
      panelSessionId,
      interval,
      nextSequence: 2,
      committedEvidenceBoundary: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" },
      retainedRange: { first: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" }, last: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" } },
      retainedCount: 0,
      replayPayloadBytes: serialized.bytes
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

    const history = await openEventHistory({ panelSessionId });
    let initialStatus: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") initialStatus = publication.status;
    });
    expect(initialStatus).toMatchObject({ capacity: { tier: "LOWER" }, fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
    await history.close();
  });
});
