import { IDBCursor, IDBDatabase, IDBFactory, IDBIndex, IDBObjectStore, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  AUTHORITATIVE_EVENT_DB_NAME_PREFIX,
  AUTHORITATIVE_EVENT_DB_NAME,
  authoritativeEventDatabaseName,
  authoritativeEventDatabaseRuntime,
  deleteAuthoritativeEventDatabase,
  type AuthoritativeEventDatabaseRuntime
} from "../src/core/indexeddb/authoritative-event-db";
import {
  createInMemoryEventHistory,
  openEventHistory,
  type EvidenceCandidate,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createIndexedDbEventHistory, transactionDone, type IndexedDbEventHistoryOptions } from "../src/core/event-history-indexeddb";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";

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

function itemUpdateFacets(): string[] {
  return [
    ["v1", "kind", "item-update"],
    ["v1", "clientId", null],
    ["v1", "sessionId", null],
    ["v1", "subscriptionId", null],
    ["v1", "mode", null],
    ["v1", "item", null],
    ["v1", "itemPosition", null],
    ["v1", "listenerId", null],
    ["v1", "key", null],
    ["v1", "command", null],
    ["v1", "snapshot", false],
    ["v1", "synthetic", false]
  ].map((value) => JSON.stringify(value));
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function legacyJournalName(panelSessionId: string, schemaVersion: number): string {
  return `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-v${schemaVersion}-${panelSessionId}`;
}

async function createLegacyJournalByName(
  name: string,
  schemaVersion: number,
  markerStore: string,
  markerValue: string
): Promise<void> {
  const request = indexedDB.open(name, schemaVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(markerStore)) {
      database.createObjectStore(markerStore, { keyPath: "id" });
    }
    const transaction = request.transaction;
    if (!transaction) return;
    const store = transaction.objectStore(markerStore);
    store.put({ id: "marker", value: markerValue });
  };
  const database = await requestValue(request);
  database.close();
}

async function createLegacyJournal(panelSessionId: string, schemaVersion: number, markerStore: string, markerValue: string): Promise<void> {
  return createLegacyJournalByName(legacyJournalName(panelSessionId, schemaVersion), schemaVersion, markerStore, markerValue);
}

async function hasLegacyMarker(name: string, markerStore: string, markerValue: string): Promise<boolean> {
  const request = indexedDB.open(name);
  const database = await requestValue(request);
  try {
    if (!database.objectStoreNames.contains(markerStore)) return false;
    const transaction = database.transaction(markerStore, "readonly");
    const value = await requestValue(transaction.objectStore(markerStore).get("marker"));
    return (value as { value: string } | undefined)?.value === markerValue;
  } finally {
    database.close();
  }
}

function legacyOwnerLock(databaseName: string): string {
  return `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-owner-v${AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION}-${databaseName}`;
}

async function createModernJournal(panelSessionId: string, count: number): Promise<void> {
  const name = authoritativeEventDatabaseName(panelSessionId);
  const interval = { id: `${panelSessionId}:interval-1`, ordinal: 1 };
  const request = indexedDB.open(name, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("historyControl")) {
      database.createObjectStore("historyControl", { keyPath: "key" });
    }
    if (!database.objectStoreNames.contains("evidence")) {
      const evidence = database.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventIdentity", "eventId", { unique: true });
      evidence.createIndex("facets", "facets", { multiEntry: true });
    }
  };
  const database = await requestValue(request);
  try {
    const transaction = database.transaction(["historyControl", "evidence"], "readwrite");
    const evidenceStore = transaction.objectStore("evidence");
    let accountedBytes = 0;
    let replayPayloadBytes = 0;
    for (let index = 0; index < count; index += 1) {
      const entry = candidate(`event-${index}`);
      const serialized = serializeJournalEvidenceCandidate(entry);
      replayPayloadBytes += serialized.bytes;
      accountedBytes += journalAccountedBytes(serialized.bytes);
      evidenceStore.add({
        intervalId: interval.id,
        sequence: index + 1,
        eventId: entry.id,
        replayPayload: serialized.payload,
        serializedBytes: serialized.bytes,
        accountedBytes: journalAccountedBytes(serialized.bytes),
        facets: itemUpdateFacets()
      });
    }
    transaction.objectStore("historyControl").put({
      key: "control",
      schemaVersion: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
      recordVersion: 3,
      panelSessionId,
      interval,
      phase: "RUNNING",
      terminal: null,
      nextSequence: count + 1,
      committedEvidenceBoundary: { intervalId: interval.id, sequence: count, eventId: `event-${count - 1}` },
      retainedRange: {
        first: { intervalId: interval.id, sequence: 1, eventId: "event-0" },
        last: { intervalId: interval.id, sequence: count, eventId: `event-${count - 1}` }
      },
      retainedCount: count,
      replayPayloadBytes,
      accountedBytes
    });
    await transactionDone(transaction, "building legacy-modern journal");
  } finally {
    database.close();
  }
}

type TransactionHandlers = {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
};

function transactionStub(abort: () => void, error: Error | null = null): IDBTransaction & TransactionHandlers {
  return {
    abort: vi.fn(abort),
    error,
    oncomplete: null,
    onerror: null,
    onabort: null
  } as unknown as IDBTransaction & TransactionHandlers;
}

async function freshHistory(panelSessionId: string) {
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  Reflect.set(globalThis, "IDBKeyRange", IDBKeyRange);
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId });
}

async function freshIndexedHistory(
  panelSessionId: string,
  options: Omit<IndexedDbEventHistoryOptions, "panelSessionId"> = {}
): Promise<Awaited<ReturnType<typeof createIndexedDbEventHistory>>> {
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  Reflect.set(globalThis, "IDBKeyRange", IDBKeyRange);
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return createIndexedDbEventHistory({ panelSessionId, ...options });
}

type TestEvidenceRecord = {
  intervalId: string;
  sequence: number;
  eventId: string;
  replayPayload: string;
  serializedBytes: number;
  accountedBytes: number;
  facets: string[];
};

async function mutateEvidenceRecord(
  panelSessionId: string,
  sequence: number,
  mutate: (record: TestEvidenceRecord) => TestEvidenceRecord | undefined
): Promise<void> {
  const databaseRequest = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
  const database = await requestValue(databaseRequest);
  try {
    const readTransaction = database.transaction("evidence", "readonly");
    const record = await requestValue(readTransaction.objectStore("evidence").get(sequence)) as TestEvidenceRecord | undefined;
    await transactionDone(readTransaction, "reading test Evidence record");
    if (!record) throw new Error(`Missing test Evidence record ${sequence}.`);
    const writeTransaction = database.transaction("evidence", "readwrite");
    const store = writeTransaction.objectStore("evidence");
    const replacement = mutate(record);
    if (replacement) store.put(replacement);
    else store.delete(sequence);
    await transactionDone(writeTransaction, "mutating test Evidence record");
  } finally {
    database.close();
  }
}

describe("IndexedDB authoritative EventHistory", () => {
  it("takes an immutable offer snapshot and publishes only after the adapter commits it", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const history = await freshIndexedHistory("indexed-offer-snapshot", {
      commitBatch: async () => commitGate
    });
    const publications: HistoryPublication[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    const offered = candidate("immutable-offer", {
      raw: { nested: { value: "before-commit" } }
    }) as LightstreamerEventEnvelope;

    const receipt = history.offer(offered);
    offered.raw = { nested: { value: "after-offer" } };

    expect(publications.some((publication) => publication.type === "committed-evidence")).toBe(false);
    releaseCommit();
    await expect(receipt.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { eventId: "immutable-offer" }
    });
    expect(publications.some((publication) => {
      if (publication.type !== "committed-evidence") return false;
      const committed = publication.evidence[0]?.candidate as LightstreamerEventEnvelope | undefined;
      const raw = committed?.raw as { nested?: { value?: unknown } } | undefined;
      return raw?.nested?.value === "before-commit";
    })).toBe(true);
    await history.close();
  });

  it("reads committed fake-IndexedDB evidence through structured and Find queries", async () => {
    const history = await freshIndexedHistory("indexed-read-query-replay");
    await history.offer(candidate("query-hit", {
      subscription: { id: "query-subscription", mode: "COMMAND" },
      raw: { marker: "needle" }
    })).settled;
    await history.offer(candidate("query-miss", {
      subscription: { id: "query-subscription", mode: "MERGE" },
      raw: { marker: "other" }
    })).settled;

    await expect(history.read({ filters: { mode: "COMMAND" }, find: "needle" })).resolves.toMatchObject({
      ok: true,
      value: {
        total: 1,
        evidence: [expect.objectContaining({ eventId: "query-hit" })]
      }
    });
    await history.close();
  });

  it("replays committed fake-IndexedDB evidence through the follow seam", async () => {
    const history = await freshIndexedHistory("indexed-follow-replay");
    await history.offer(candidate("follow-first")).settled;
    await history.offer(candidate("follow-second")).settled;
    const replayed: string[] = [];
    let resolveReplay!: () => void;
    const replayComplete = new Promise<void>((resolve) => {
      resolveReplay = resolve;
    });

    history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type !== "committed-evidence") return;
      replayed.push(...publication.evidence.map((entry) => entry.eventId));
      if (replayed.length === 2) resolveReplay();
    });

    await replayComplete;
    expect(replayed).toEqual(["follow-first", "follow-second"]);
    await history.close();
  });

  it("round-trips JSON-native and special-tag values through fake IndexedDB", async () => {
    const history = await freshIndexedHistory("indexed-special-tag-replay");
    const specialObject = { __lsewReplayTag: "literal-key", nested: "value" };
    const offered: EvidenceCandidate = {
      id: "special-tag-round-trip",
      kind: "topology-checkpoint",
      checkpoint: {
        json: { alpha: "first", omega: 2, nested: [true, null] },
        special: [undefined, Number.NaN, Infinity, -Infinity, -0, 7n, new Date("2026-08-11T00:00:00.000Z")],
        specialObject
      }
    };

    await expect(history.offer(offered).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    const result = await history.read({ find: "literal-key" });

    expect(result).toMatchObject({ ok: true, value: { total: 1 } });
    if (result.ok) {
      const checkpoint = result.value.evidence[0]?.candidate;
      expect(checkpoint).toEqual(offered);
      expect(checkpoint.kind).toBe("topology-checkpoint");
      const values = checkpoint.kind === "topology-checkpoint" ? checkpoint.checkpoint.special as unknown[] : [];
      expect(values[0]).toBeUndefined();
      expect(Number.isNaN(values[1] as number)).toBe(true);
      expect(values[2]).toBe(Infinity);
      expect(values[3]).toBe(-Infinity);
      expect(Object.is(values[4], -0)).toBe(true);
      expect(values[5]).toBe(7n);
      expect(values[6]).toEqual(new Date("2026-08-11T00:00:00.000Z"));
    }
    await history.close();
  });

  it("uses a reverse primary-key cursor and stops after a recent descending page", async () => {
    const history = await freshIndexedHistory("query-plan-recent");
    for (let index = 0; index < 200; index += 1) {
      await history.offer(createEventHistoryWorkloadEvent("small-lifecycle", index, "query-plan")).settled;
    }

    const openCursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    const continueCursor = vi.spyOn(IDBCursor.prototype, "continue");
    const result = await history.read({ order: "desc", limit: 5 });

    expect(result).toMatchObject({ ok: true, value: { total: 200 } });
    if (result.ok) expect(result.value.evidence.map((entry) => entry.sequence)).toEqual([200, 199, 198, 197, 196]);
    expect(openCursor).toHaveBeenCalledWith(undefined, "prev");
    expect(continueCursor).toHaveBeenCalledTimes(4);
    openCursor.mockRestore();
    continueCursor.mockRestore();
    await history.close();
  });

  it("uses exact facet-index keys while preserving residual Find and ordered totals", async () => {
    const history = await freshIndexedHistory("query-plan-facet");
    for (let index = 0; index < 60; index += 1) {
      await history.offer(candidate(index % 4 === 0 ? `needle-${index}` : `facet-${index}`, {
        subscription: { id: "query-subscription", mode: index % 2 === 0 ? "COMMAND" : "MERGE" },
        raw: index % 4 === 0 ? { marker: "needle" } : { marker: "other" }
      })).settled;
    }

    const openIndexCursor = vi.spyOn(IDBIndex.prototype, "openCursor");
    const result = await history.read({
      order: "desc",
      limit: 3,
      filters: { mode: "COMMAND" },
      find: "needle"
    });

    expect(result).toMatchObject({ ok: true, value: { total: 15 } });
    if (result.ok) expect(result.value.evidence.map((entry) => entry.eventId)).toEqual(["needle-56", "needle-52", "needle-48"]);
    expect(openIndexCursor).toHaveBeenCalledWith(IDBKeyRange.only(JSON.stringify(["v1", "mode", "COMMAND"])), "prev");
    openIndexCursor.mockRestore();
    await history.close();
  });

  it("keeps large JSON structured-query results in parity with the memory seam", async () => {
    const indexed = await freshIndexedHistory("query-plan-large-json");
    const memory = createInMemoryEventHistory({ panelSessionId: "query-plan-large-json-memory" });
    const events = Array.from({ length: 120 }, (_, index) => createEventHistoryWorkloadEvent("large-json-rich", index, "large-query"));
    for (const event of events) {
      await indexed.offer(event).settled;
      await memory.offer(event).settled;
    }
    const query = {
      order: "desc" as const,
      offsetFromNewest: 3,
      limit: 7,
      filters: { subscriptionId: "portfolio-command", mode: "COMMAND" },
      find: "official-public-api"
    };
    const indexedResult = await indexed.read(query);
    const memoryResult = await memory.read(query);
    expect(indexedResult).toMatchObject({ ok: true });
    expect(memoryResult).toMatchObject({ ok: true });
    if (indexedResult.ok && memoryResult.ok) {
      expect(indexedResult.value.total).toBe(memoryResult.value.total);
      expect(indexedResult.value.evidence.map((entry) => entry.eventId)).toEqual(memoryResult.value.evidence.map((entry) => entry.eventId));
    }
    await indexed.close();
    await memory.close();
  });

  it("pages exact facets before reconstructing large IndexedDB payloads", async () => {
    const indexed = await freshIndexedHistory("query-plan-exact-facet-page-before-payload");
    const memory = createInMemoryEventHistory({ panelSessionId: "query-plan-exact-facet-page-before-payload-memory" });
    const events = Array.from({ length: 1_000 }, (_, index) => createEventHistoryWorkloadEvent("large-json-rich", index, "page-before-payload"));
    for (const event of events) {
      await indexed.offer(event).settled;
      await memory.offer(event).settled;
    }

    const payloadReads = vi.spyOn(IDBObjectStore.prototype, "get");
    const queries = [
      { page: { order: "asc" as const, limit: 100 }, expectedReads: 100 },
      { page: { order: "desc" as const, limit: 100 }, expectedReads: 100 },
      { page: { order: "desc" as const, offsetFromNewest: 137, limit: 100 }, expectedReads: 100 },
      { page: { order: "asc" as const, limit: 0 }, expectedReads: 0 },
      { page: { order: "desc" as const, limit: -1 }, expectedReads: 0 },
      { page: { order: "asc" as const, limit: 2_000 }, expectedReads: 1_000 }
    ].map(({ page, expectedReads }) => ({
      query: { ...page, filters: { subscriptionId: "portfolio-command", mode: "COMMAND" } },
      expectedReads
    }));

    try {
      for (const { query, expectedReads } of queries) {
        const readsBefore = payloadReads.mock.calls.length;
        const indexedResult = await indexed.read(query);
        const memoryResult = await memory.read(query);
        expect(indexedResult).toMatchObject({ ok: true });
        expect(memoryResult).toMatchObject({ ok: true });
        if (indexedResult.ok && memoryResult.ok) {
          expect(indexedResult.value.total).toBe(1_000);
          expect(indexedResult.value.total).toBe(memoryResult.value.total);
          expect(indexedResult.value.evidence.map((entry) => entry.eventId)).toEqual(
            memoryResult.value.evidence.map((entry) => entry.eventId)
          );
        }
        expect(payloadReads.mock.calls.length - readsBefore).toBe(expectedReads);
      }
    } finally {
      payloadReads.mockRestore();
      await indexed.close();
      await memory.close();
    }
  }, 15_000);

  it("keeps exact-facet paging in parity for empty facets, malformed boundaries, and candidate kinds", async () => {
    const indexed = await freshIndexedHistory("query-plan-exact-facet-edge-parity");
    const memory = createInMemoryEventHistory({ panelSessionId: "query-plan-exact-facet-edge-parity-memory" });
    const events = [
      candidate("empty-facet-match", {
        client: { id: "", sessionId: "" },
        subscription: { id: "edge-subscription", mode: "COMMAND" }
      }),
      candidate("non-empty-facet-miss", {
        client: { id: "client", sessionId: "session" },
        subscription: { id: "edge-subscription", mode: "COMMAND" }
      }),
      {
        id: "edge-topology",
        kind: "topology-checkpoint" as const,
        checkpoint: { pageEpoch: "edge" }
      }
    ];
    for (const event of events) {
      await indexed.offer(event).settled;
      await memory.offer(event).settled;
    }

    const queries = [
      {
        filters: { clientId: "", sessionId: "", mode: "COMMAND" },
        order: "asc" as const,
        limit: 10
      },
      {
        filters: { mode: "COMMAND" },
        afterSequence: Number.NaN,
        order: "asc" as const,
        limit: 10
      },
      {
        candidateKind: "lightstreamer" as const,
        filters: { kind: "topology-checkpoint" as never },
        order: "asc" as const,
        limit: 10
      }
    ];

    for (const query of queries) {
      const indexedResult = await indexed.read(query);
      const memoryResult = await memory.read(query);
      expect(indexedResult).toMatchObject({ ok: true });
      expect(memoryResult).toMatchObject({ ok: true });
      if (indexedResult.ok && memoryResult.ok) {
        expect(indexedResult.value.total).toBe(memoryResult.value.total);
        expect(indexedResult.value.evidence.map((entry) => entry.eventId)).toEqual(
          memoryResult.value.evidence.map((entry) => entry.eventId)
        );
      }
    }

    await indexed.close();
    await memory.close();
  });

  it("fails closed when an exact-facet page record is missing or mismatches its indexed payload", async () => {
    const missingPanelSessionId = "query-plan-exact-facet-missing-record";
    const missing = await freshIndexedHistory(missingPanelSessionId);
    await missing.offer(candidate("missing-first", { subscription: { id: "corrupt-subscription", mode: "COMMAND" } })).settled;
    await missing.offer(candidate("missing-second", { subscription: { id: "corrupt-subscription", mode: "COMMAND" } })).settled;
    const originalGet = IDBObjectStore.prototype.get;
    const missingGet = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === "evidence" && key === 2) {
        const request = {
          result: undefined,
          error: null,
          onsuccess: null as null | (() => void),
          onerror: null as null | (() => void)
        };
        queueMicrotask(() => request.onsuccess?.());
        return request as unknown as IDBRequest<unknown>;
      }
      return originalGet.call(this, key);
    });
    try {
      await expect(missing.read({ filters: { mode: "COMMAND" }, order: "desc", limit: 1 })).rejects.toThrow(/exact-facet/i);
    } finally {
      missingGet.mockRestore();
    }
    await missing.close();

    const mismatchPanelSessionId = "query-plan-exact-facet-payload-mismatch";
    const mismatch = await freshIndexedHistory(mismatchPanelSessionId);
    const original = candidate("mismatch-record", { subscription: { id: "corrupt-subscription", mode: "COMMAND" } });
    await mismatch.offer(original).settled;
    await mutateEvidenceRecord(mismatchPanelSessionId, 1, (record) => {
      const replacement = candidate("mismatch-record", { subscription: { id: "corrupt-subscription", mode: "MERGE" } });
      const serialized = serializeJournalEvidenceCandidate(replacement);
      return { ...record, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes: journalAccountedBytes(serialized.bytes) };
    });
    await expect(mismatch.read({ filters: { mode: "COMMAND" }, order: "desc", limit: 1 })).rejects.toThrow(/exact-facet|replay|facets|incoherent/i);
    await mismatch.close();
  });

  it("fails closed for every incoherent selected exact-facet record", async () => {
    const corruptions: Array<[string, (record: TestEvidenceRecord) => TestEvidenceRecord]> = [
      ["event-id", (record) => ({ ...record, eventId: "wrong-event-id" })],
      ["serialized-bytes", (record) => ({ ...record, serializedBytes: record.serializedBytes + 1 })],
      ["accounted-bytes", (record) => ({ ...record, accountedBytes: record.accountedBytes + 1 })],
      ["non-string-facet", (record) => ({ ...record, facets: [...record.facets, 42 as unknown as string] })],
      ["incomplete-facets", (record) => ({ ...record, facets: record.facets.filter((value) => value !== JSON.stringify(["v1", "synthetic", false])) })],
      ["malformed-payload", (record) => ({ ...record, replayPayload: "not-json" })]
    ];

    for (const [name, corruption] of corruptions) {
      const panelSessionId = `query-plan-exact-facet-corruption-${name}`;
      const history = await freshIndexedHistory(panelSessionId);
      await history.offer(candidate(`corrupt-${name}`, { subscription: { id: "corrupt-subscription", mode: "COMMAND" } })).settled;
      await mutateEvidenceRecord(panelSessionId, 1, corruption);
      try {
        await expect(history.read({ filters: { mode: "COMMAND" }, order: "desc", limit: 1 })).rejects.toThrow(/incoherent|exact-facet|replay|JSON|token/i);
      } finally {
        await history.close();
      }
    }
  });

  it("defaults deleteAuthoritativeEventDatabase to the same fallback database used by open", async () => {
    const fallbackDbName = authoritativeEventDatabaseName();
    const staleLegacyName = AUTHORITATIVE_EVENT_DB_NAME;
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await Promise.all([
      createLegacyJournalByName(fallbackDbName, 1, "owned", "fallback-db"),
      createLegacyJournalByName(staleLegacyName, 1, "owned", "legacy-db")
    ]);

    await deleteAuthoritativeEventDatabase();

    expect(await hasLegacyMarker(fallbackDbName, "owned", "fallback-db")).toBe(false);
    expect(await hasLegacyMarker(staleLegacyName, "owned", "legacy-db")).toBe(true);
  });

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
    expect(history.storage).toEqual({ mode: "indexeddb" });
    await history.close();
  });

  it("creates exactly the control and evidence stores with only identity and facet indexes", async () => {
    const panelSessionId = "indexed-schema";
    const history = await freshHistory(panelSessionId);

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
    await history.close();
  });

  it("persists the v3 accounting and terminal-state fields as exact durable journal records", async () => {
    const panelSessionId = "indexed-record-v2";
    const history = await freshHistory(panelSessionId);
    const offered = candidate("record-v2");
    await expect(history.offer(offered).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });

    const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
    const database = await requestValue(request);
    const transaction = database.transaction(["historyControl", "evidence"], "readonly");
    const control = await requestValue(transaction.objectStore("historyControl").get("control"));
    const record = await requestValue(transaction.objectStore("evidence").get(1));
    expect(control).toMatchObject({ recordVersion: 3, phase: "RUNNING", terminal: null, retainedCount: 1, accountedBytes: expect.any(Number) });
    expect(Object.keys(control as object).sort()).toEqual([
      "accountedBytes",
      "committedEvidenceBoundary",
      "interval",
      "key",
      "nextSequence",
      "panelSessionId",
      "phase",
      "recordVersion",
      "replayPayloadBytes",
      "retainedCount",
      "retainedRange",
      "schemaVersion",
      "terminal"
    ]);
    expect(record).toMatchObject({ accountedBytes: expect.any(Number) });
    expect(Object.keys(record as object).sort()).toEqual([
      "accountedBytes",
      "eventId",
      "facets",
      "intervalId",
      "replayPayload",
      "sequence",
      "serializedBytes"
    ]);
    expect((record as { accountedBytes: number }).accountedBytes).toBe(
      (record as { serializedBytes: number }).serializedBytes + 8
    );
    expect((record as { accountedBytes: number }).accountedBytes).toBe((control as { accountedBytes: number }).accountedBytes);
    database.close();
    await history.close();
  });

  it("returns identical outcomes for repeated failed close attempts", async () => {
    const history = await freshIndexedHistory("indexed-close-failed", {
      clearJournal: async () => {
        throw new Error("close unavailable");
      }
    });
    const firstClose = await history.close();
    const repeatedClose = await history.close();
    expect(firstClose).toMatchObject({ ok: false, problem: { code: "CLOSE_FAILED" } });
    expect(repeatedClose).toEqual(firstClose);
  });

  it("cuts intake immediately when close is requested during clear", async () => {
    const panelSessionId = "indexed-close-during-clear-cuts-intake";
    let clearStarted!: () => void;
    let clearCalls = 0;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const history = await freshIndexedHistory(panelSessionId, {
      clearJournal: async () => {
        clearCalls += 1;
        if (clearCalls === 1) {
          clearStarted();
          await gate;
        }
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const clear = history.clear();
    await started;
    const close = history.close();
    const duringClear = history.offer(candidate("during-clear"));
    expect(duringClear.intake).toBe("REFUSED");
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "HISTORY_CLOSED" }
    });
    release();
    await expect(clear).resolves.toMatchObject({ ok: true });
    await expect(close).resolves.toMatchObject({ ok: true });
  });

  it("rejects a record whose accounted bytes do not include the exact v1 frame", async () => {
    const panelSessionId = "indexed-invalid-accounted-frame";
    const history = await freshHistory(panelSessionId);
    await expect(history.offer(candidate("invalid-frame-source")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });

    const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
    const database = await requestValue(request);
    const transaction = database.transaction("evidence", "readwrite");
    const store = transaction.objectStore("evidence");
    const record = await requestValue(store.get(1));
    store.put({ ...(record as Record<string, unknown>), accountedBytes: (record as { accountedBytes: number }).accountedBytes - 1 });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

    const reopened = await openEventHistory({ panelSessionId });
    let status: unknown;
    reopened.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });
    expect(status).toMatchObject({ capacity: { tier: "LOWER" }, fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
    await reopened.close();
    await history.close();
  });

  it("preserves replay totals when a reopened journal receives another accounted-byte commit", async () => {
    const panelSessionId = "indexed-reopen-accounting";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
    const history = await openEventHistory({ panelSessionId, byteEstimator: () => 17 });
    await expect(history.offer(candidate("first")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });

    const reopened = await openEventHistory({ panelSessionId, byteEstimator: () => 99 });
    await expect(reopened.offer(candidate("second")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });

    const validated = await openEventHistory({ panelSessionId, byteEstimator: () => 99 });
    await validated.close();
    await reopened.close();
    await history.close();
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

  it("waits for the abort event after a timeout before confirming an aborted transaction", async () => {
    vi.useFakeTimers();
    try {
      let persisted = ["timeout-batch"];
      const publications: string[] = [];
      const transaction = transactionStub(() => { persisted = []; });
      const completed = transactionDone(transaction, "committing Evidence", 10);
      void completed.then(() => { publications.push("timeout-batch"); }, () => undefined);
      let settled = false;
      void completed.then(() => { settled = true; }, () => { settled = true; });

      await vi.advanceTimersByTimeAsync(10);

      expect(transaction.abort).toHaveBeenCalledTimes(1);
      expect(persisted).toEqual([]);
      expect(publications).toEqual([]);
      expect(settled).toBe(false);

      transaction.onabort?.();
      await expect(completed).rejects.toThrow(/Timed out while committing Evidence/);
      expect(publications).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an error after a successful timeout abort until abort is definitive", async () => {
    vi.useFakeTimers();
    try {
      const transaction = transactionStub(() => undefined);
      const completed = transactionDone(transaction, "committing Evidence", 10);
      const outcome: string[] = [];
      void completed.then(
        () => outcome.push("complete"),
        (error: Error) => outcome.push(error.message)
      );

      await vi.advanceTimersByTimeAsync(10);
      transaction.onerror?.();
      await Promise.resolve();
      expect(outcome).toEqual([]);

      transaction.onabort?.();
      await expect(completed).rejects.toThrow(/Timed out while committing Evidence/);
      expect(outcome).toEqual(["Timed out while committing Evidence."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for abort after a non-timeout transaction error and settles once", async () => {
    const transactionError = new Error("IndexedDB transaction failed before abort.");
    const transaction = transactionStub(() => undefined, transactionError);
    const completed = transactionDone(transaction, "committing Evidence", 10_000);
    const outcome: string[] = [];
    let settlementCount = 0;
    void completed.then(
      () => { settlementCount += 1; outcome.push("complete"); },
      (error: Error) => { settlementCount += 1; outcome.push(error.message); }
    );

    transaction.onerror?.();
    await Promise.resolve();
    expect(settlementCount).toBe(0);
    expect(outcome).toEqual([]);

    transaction.onabort?.();
    transaction.oncomplete?.();
    transaction.onerror?.();
    await expect(completed).rejects.toBe(transactionError);
    expect(settlementCount).toBe(1);
    expect(outcome).toEqual([transactionError.message]);
  });

  it.each([
    ["complete", true],
    ["error-before-abort", false],
    ["abort", false]
  ] as const)("waits for the definitive %s event when timeout abort throws", async (terminal, succeeds) => {
    vi.useFakeTimers();
    try {
      const transaction = transactionStub(() => { throw new DOMException("Transaction is inactive.", "InvalidStateError"); });
      const completed = transactionDone(transaction, "committing Evidence", 10);

      await vi.advanceTimersByTimeAsync(10);
      let settled = false;
      void completed.then(() => { settled = true; }, () => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);

      if (terminal === "complete") transaction.oncomplete?.();
      if (terminal === "error-before-abort") {
        transaction.onerror?.();
        await Promise.resolve();
        expect(settled).toBe(false);
        transaction.onabort?.();
      }
      if (terminal === "abort") transaction.onabort?.();

      if (succeeds) await expect(completed).resolves.toBeUndefined();
      else await expect(completed).rejects.toThrow(/transaction (failed|aborted)|Timed out/i);

      transaction.oncomplete?.();
      transaction.onerror?.();
      transaction.onabort?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an oversized candidate alone and starts a new transaction at the soft byte target", async () => {
    const panelSessionId = "indexed-byte-batches";
    const history = await freshHistory(panelSessionId);
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const large = (id: string, size: number): EvidenceCandidate => candidate(id, {
      raw: { payload: "x".repeat(size) }
    } as Partial<EvidenceCandidate>);

    const receipts = [
      history.offer(large("large-one", 600_000)),
      history.offer(large("large-two", 600_000)),
      history.offer(large("oversized", 2_200_000)),
      history.offer(candidate("after-oversized"))
    ];
    await Promise.all(receipts.map((receipt) => receipt.settled));

    const writeTransactions = transactionSpy.mock.calls.filter(([, mode]) => mode === "readwrite");
    expect(writeTransactions).toHaveLength(3);
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
    const database = await requestValue(indexedDB.open(authoritativeEventDatabaseName(panelSessionId)));
    const controlTransaction = database.transaction("historyControl", "readonly");
    const control = await requestValue(controlTransaction.objectStore("historyControl").get("control"));
    const evidenceTransaction = database.transaction("evidence", "readonly");
    const evidenceRecords = await Promise.all(
      [1, 2, 3, 4].map((sequence) => requestValue(evidenceTransaction.objectStore("evidence").get(sequence)))
    );
    database.close();
    const totalSerializedBytes = evidenceRecords.reduce(
      (total, record) => total + ((record as { serializedBytes: number }).serializedBytes ?? 0),
      0
    );
    const totalAccountedBytes = evidenceRecords.reduce(
      (total, record) => total + ((record as { accountedBytes: number }).accountedBytes ?? 0),
      0
    );
    expect(control).toMatchObject({
      replayPayloadBytes: totalSerializedBytes,
      accountedBytes: totalAccountedBytes
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

  it("does not project pending evidence before commit, keeping committed-only reads", async () => {
    let allowCommit!: () => void;
    let commitStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const history = await freshIndexedHistory("indexed-no-precommit-projection", {
      commitBatch: async (batch) => {
        if (batch.some((entry) => entry.id === "stalled")) {
          commitStarted();
          await new Promise<void>((resolve) => {
            allowCommit = resolve;
          });
        }
      }
    });
    const committedEvidence: string[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") {
        committedEvidence.push(...publication.evidence.map((entry) => entry.eventId));
      }
    });

    const pre = await history.offer(candidate("pre"));
    await expect(pre.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "pre" }
    });
    const stalled = history.offer(candidate("stalled"));
    await started;

    let stalledSettled = false;
    void stalled.settled.finally(() => {
      stalledSettled = true;
    });
    expect(stalled.intake).toBe("QUEUED");
    expect(stalledSettled).toBe(false);
    expect(committedEvidence).toEqual(["pre"]);
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [expect.objectContaining({ eventId: "pre", sequence: 1 })],
        total: 1,
        committedEvidenceBoundary: { sequence: 1, eventId: "pre" }
      }
    });

    allowCommit();
    await expect(stalled.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "stalled" }
    });
    expect(committedEvidence).toEqual(["pre", "stalled"]);
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [
          expect.objectContaining({ eventId: "pre" }),
          expect.objectContaining({ eventId: "stalled" })
        ],
        total: 2,
        committedEvidenceBoundary: { sequence: 2, eventId: "stalled" }
      }
    });

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

  it("uses journal cursors for reads and interval replay instead of materializing a mirror", async () => {
    const history = await freshHistory("indexed-cursor-reads");
    await history.offer(candidate("cursor-event")).settled;
    const openCursorSpy = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, "getAll");

    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "cursor-event" })] }
    });
    const replayed: string[] = [];
    let resolveReplay!: () => void;
    const replayComplete = new Promise<void>((resolve) => { resolveReplay = resolve; });
    const unsubscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "committed-evidence") {
        replayed.push(...publication.evidence.map((entry) => entry.eventId));
        resolveReplay();
      }
    });
    await replayComplete;

    expect(openCursorSpy).toHaveBeenCalled();
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(replayed).toEqual(["cursor-event"]);
    unsubscribe();
    openCursorSpy.mockRestore();
    getAllSpy.mockRestore();
    await history.close();
  });

  it("validates startup through a cursor without getAll and hands replay to live Capture exactly once", async () => {
    const panelSessionId = "indexed-replay-handoff";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
    await createModernJournal(panelSessionId, 600);

    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const reopened = await openEventHistory({ panelSessionId });
    expect(getAllSpy).not.toHaveBeenCalled();

    const received: string[] = [];
    let resolveReplay!: () => void;
    const replayComplete = new Promise<void>((resolve) => { resolveReplay = resolve; });
    const unsubscribe = reopened.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "committed-evidence") {
        received.push(...publication.evidence.map((entry) => entry.eventId));
        if (received.length === 601) resolveReplay();
      }
    });
    const live = reopened.offer(candidate("replay-live"));
    await expect(live.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 601 } });
    await replayComplete;
    expect(received).toEqual([...Array.from({ length: 600 }, (_, index) => `event-${index}`), "replay-live"]);

    unsubscribe();
    getAllSpy.mockRestore();
    await reopened.close();
  });

  it("latches a stalled read cursor to the boundary, excluding a post-latch commit", async () => {
    const history = await freshHistory("indexed-stalled-read-cursor");
    await history.offer(candidate("before-latch")).settled;
    const originalContinue = IDBCursor.prototype.continue;
    let heldCursor: IDBCursor | null = null;
    let releaseHeldCursor!: () => void;
    const held = new Promise<void>((resolve) => { releaseHeldCursor = resolve; });
    const continueSpy = vi.spyOn(IDBCursor.prototype, "continue").mockImplementation(function (this: IDBCursor, key?: IDBValidKey) {
      if (heldCursor === null && (this.source as IDBObjectStore).name === "evidence") {
        heldCursor = this;
        releaseHeldCursor();
        return;
      }
      return originalContinue.call(this, key);
    });

    const readPromise = history.read({});
    await held;
    const postLatch = history.offer(candidate("after-latch"));
    releaseHeldCursor();
    originalContinue.call(heldCursor!);
    await expect(postLatch.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await expect(readPromise).resolves.toMatchObject({
      ok: true,
      value: { total: 1, evidence: [expect.objectContaining({ eventId: "before-latch" })], committedEvidenceBoundary: { sequence: 1 } }
    });
    continueSpy.mockRestore();
    await history.close();
  });

  it("does not resolve a read before its readonly transaction completes", async () => {
    const history = await freshHistory("indexed-read-abort");
    await history.offer(candidate("read-abort-before")).settled;
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const openCursorSpy = vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["openCursor"]>
    ) {
      const request = originalOpenCursor.apply(this, args);
      if (this.name === "evidence") {
        request.addEventListener("success", () => {
          if (request.result === null) {
            queueMicrotask(() => {
              try {
                request.transaction?.abort();
              } catch {
                // The transaction may already have completed.
              }
            });
          }
        });
      }
      return request;
    });

    await expect(history.read({})).rejects.toThrow(/aborted|failed/i);

    openCursorSpy.mockRestore();
    await history.close();
  });

  it("isolates observer failure and unsubscribe during journal replay", async () => {
    const history = await freshHistory("indexed-observer-isolation");
    await history.offer(candidate("observer-event")).settled;
    const failing = vi.fn(() => { throw new Error("observer failure"); });
    const healthy: string[] = [];
    history.follow({ from: "CURRENT_INTERVAL_START" }, failing);
    const unsubscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "committed-evidence") healthy.push(...publication.evidence.map((entry) => entry.eventId));
    });
    unsubscribe();
    await history.offer(candidate("after-unsubscribe")).settled;

    expect(failing).toHaveBeenCalled();
    expect(healthy).toEqual([]);
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
    const replacedDatabase = await requestValue(indexedDB.open(knownName, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION));
    expect(replacedDatabase.version).toBe(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
    expect([...replacedDatabase.objectStoreNames]).toEqual(["evidence", "historyControl"]);
    replacedDatabase.close();
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
    const newerDatabase = await requestValue(indexedDB.open(newerName));
    expect(newerDatabase.version).toBe(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION + 10);
    newerDatabase.close();
  });

  it("does not recover recordVersion 1 data from a session-scoped journal", async () => {
    const panelSessionId = "indexed-legacy-record-version";
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
    const serialized = serializeJournalEvidenceCandidate(candidate("legacy-record"));
    const transaction = database.transaction(["historyControl", "evidence"], "readwrite");
    transaction.objectStore("evidence").put({
      intervalId: interval.id,
      sequence: 1,
      eventId: "legacy-record",
      replayPayload: serialized.payload,
      serializedBytes: serialized.bytes,
      facets: itemUpdateFacets()
    });
    transaction.objectStore("historyControl").put({
      key: "control",
      schemaVersion: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
      recordVersion: 1,
      panelSessionId,
      interval,
      nextSequence: 2,
      committedEvidenceBoundary: { intervalId: interval.id, sequence: 1, eventId: "legacy-record" },
      retainedRange: {
        first: { intervalId: interval.id, sequence: 1, eventId: "legacy-record" },
        last: { intervalId: interval.id, sequence: 1, eventId: "legacy-record" }
      },
      retainedCount: 1,
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
    const publications: string[] = [];
    history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "status") initialStatus = publication.status;
      if (publication.type === "committed-evidence") publications.push(...publication.evidence.map((entry) => entry.eventId));
    });
    expect(initialStatus).toMatchObject({
      capacity: { tier: "LOWER" },
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE",
      retained: 0
    });
    expect(publications).toEqual([]);
    await expect(history.offer(candidate("fresh-memory-record")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "fresh-memory-record" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "fresh-memory-record", sequence: 1 })] }
    });
    await history.close();
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
      accountedBytes: serialized.bytes,
      facets: itemUpdateFacets()
    });
    transaction.objectStore("historyControl").put({
      key: "control",
      schemaVersion: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
      recordVersion: 2,
      panelSessionId,
      interval,
      nextSequence: 2,
      committedEvidenceBoundary: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" },
      retainedRange: { first: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" }, last: { intervalId: interval.id, sequence: 1, eventId: "coherent-record" } },
      retainedCount: 0,
      replayPayloadBytes: serialized.bytes,
      accountedBytes: serialized.bytes
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

  it("falls back when the first interval starts with a non-initial sequence", async () => {
    const panelSessionId = "indexed-invalid-initial-sequence";
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
    const serialized = serializeJournalEvidenceCandidate(candidate("invalid-sequence"));
    const facets = [
      ["v1", "kind", "item-update"],
      ["v1", "clientId", null],
      ["v1", "sessionId", null],
      ["v1", "subscriptionId", null],
      ["v1", "mode", null],
      ["v1", "item", null],
      ["v1", "itemPosition", null],
      ["v1", "listenerId", null],
      ["v1", "key", null],
      ["v1", "command", null],
      ["v1", "snapshot", false],
      ["v1", "synthetic", false]
    ].map((value) => JSON.stringify(value));
    const transaction = database.transaction(["historyControl", "evidence"], "readwrite");
    transaction.objectStore("evidence").put({
      intervalId: interval.id,
      sequence: 2,
      eventId: "invalid-sequence",
      replayPayload: serialized.payload,
      serializedBytes: serialized.bytes,
      accountedBytes: serialized.bytes,
      facets
    });
    transaction.objectStore("historyControl").put({
      key: "control",
      schemaVersion: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
      recordVersion: 2,
      panelSessionId,
      interval,
      nextSequence: 3,
      committedEvidenceBoundary: { intervalId: interval.id, sequence: 2, eventId: "invalid-sequence" },
      retainedRange: {
        first: { intervalId: interval.id, sequence: 2, eventId: "invalid-sequence" },
        last: { intervalId: interval.id, sequence: 2, eventId: "invalid-sequence" }
      },
      retainedCount: 1,
      replayPayloadBytes: serialized.bytes,
      accountedBytes: serialized.bytes
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

  it("keeps the prior interval when Clear cannot be confirmed", async () => {
    const history = await freshIndexedHistory("indexed-clear-unconfirmed", {
      clearJournal: async () => {
        return false;
      }
    });
    await expect(history.offer(candidate("retained")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "retained" }
    });

    const publications: unknown[] = [];
    history.follow({ from: "NOW" }, (publication: HistoryPublication) => publications.push(publication));
    await expect(history.clear()).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    expect(publications).toContainEqual(
      expect.objectContaining({
        type: "status",
        problem: expect.objectContaining({ code: "CLEAR_FAILED" })
      })
    );
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "retained" })] }
    });
    await history.close();
  });

  it("terminalizes a clear failure and rejects clear-window capture", async () => {
    const panelSessionId = "indexed-clear-terminal";
    let release!: () => void;
    let clearStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const history = await freshIndexedHistory(panelSessionId, {
      clearJournal: async () => {
        clearStarted();
        await gate;
        throw new Error("clear unavailable");
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const phases: string[] = [];
    history.follow({ from: "NOW" }, (publication: HistoryPublication) => {
      if (publication.type === "status") {
        phases.push(publication.status.phase);
      }
    });
    const clear = history.clear();
    await started;
    let duringClearSettlementCount = 0;
    let afterWindowSettlementCount = 0;
    await expect(history.read({})).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_IN_PROGRESS" }
    });
    const duringClear = history.offer(candidate("during-clear"));
    const afterWindow = history.offer(candidate("after-window"));
    void duringClear.settled.finally(() => {
      duringClearSettlementCount += 1;
    });
    void afterWindow.settled.finally(() => {
      afterWindowSettlementCount += 1;
    });
    expect(duringClear.intake).toBe("QUEUED");
    expect(afterWindow.intake).toBe("QUEUED");
    release();

    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    expect(phases).toContain("DRAINING_TO_STOP");
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(afterWindow.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    expect(duringClearSettlementCount).toBe(1);
    expect(afterWindowSettlementCount).toBe(1);
    const postTerminal = history.offer(candidate("post-terminal"));
    expect(postTerminal.intake).toBe("REFUSED");
    await expect(postTerminal.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        interval: { id: `${panelSessionId}:interval-1` },
        evidence: [{ eventId: "pre-clear", sequence: 1 }],
        committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
      }
    });
    await history.close();
  });

  it("settles clear-window captures as terminal when commit fails while clear waits", async () => {
    const panelSessionId = "indexed-clear-waiting-commit-fails";
    let release!: () => void;
    let commitStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const phases: string[] = [];
    const history = await freshIndexedHistory(panelSessionId, {
      commitBatch: async (batch) => {
        if (batch.some((entry) => entry.id === "in-flight")) {
          commitStarted();
          await gate;
          throw new Error("commit failed");
        }
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "pre-clear" }
    });
    const inFlight = history.offer(candidate("in-flight"));
    await started;
    history.follow({ from: "NOW" }, (publication: HistoryPublication) => {
      if (publication.type === "status") {
        phases.push(publication.status.phase);
      }
    });
    const clear = history.clear();
    const duringClear = history.offer(candidate("during-clear"));
    expect(duringClear.intake).toBe("QUEUED");
    await expect(history.read({})).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_IN_PROGRESS" } });

    let duringClearSettledCount = 0;
    let inFlightSettledCount = 0;
    void duringClear.settled.finally(() => { duringClearSettledCount += 1; });
    void inFlight.settled.finally(() => { inFlightSettledCount += 1; });

    release();
    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "HISTORY_STOPPED" }
    });
    await expect(inFlight.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
    });
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
    });
    expect(inFlightSettledCount).toBe(1);
    expect(duringClearSettledCount).toBe(1);
    const postTerminal = history.offer(candidate("post-terminal"));
    expect(postTerminal.intake).toBe("REFUSED");
    await expect(postTerminal.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        interval: { id: `${panelSessionId}:interval-1` },
        evidence: [{ eventId: "pre-clear", sequence: 1 }],
        committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
      }
    });
    await history.close();
  });

  it("sweeps all recognized known generations across sessions during startup", async () => {
    const panelSessionId = "ownership-cleanup-session";
    const firstLegacySession = "legacy-session-a";
    const secondLegacySession = "legacy-session-b";
    const firstLegacyName = legacyJournalName(firstLegacySession, 1);
    const secondLegacyName = legacyJournalName(secondLegacySession, 1);
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await Promise.all([
      createLegacyJournal(firstLegacySession, 1, "owned-first", "legacy-first"),
      createLegacyJournal(secondLegacySession, 1, "owned-second", "legacy-second")
    ]);

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [
        { name: firstLegacyName, version: 1 },
        { name: secondLegacyName, version: 1 }
      ]),
      requestLock: vi.fn(async (_name, _options, callback) => callback())
    };

    const history = await openEventHistory({ panelSessionId, runtime });
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });
    expect(status).toMatchObject({ fallback: null, capacity: { tier: "NORMAL" } });
    await history.close();

    expect(await hasLegacyMarker(firstLegacyName, "owned-first", "legacy-first")).toBe(false);
    expect(await hasLegacyMarker(secondLegacyName, "owned-second", "legacy-second")).toBe(false);
  });

  it("sweeps pre-ticket07 legacy databases using descriptor version and preserves newer ones", async () => {
    const panelSessionId = "ownership-cleanup-pre-ticket07";
    const legacyName = "lsew-history-foo";
    const newerLegacyName = "lsew-history-bar";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await Promise.all([
      createLegacyJournalByName(legacyName, 1, "owned", "legacy-old"),
      createLegacyJournalByName(newerLegacyName, 3, "owned", "legacy-new")
    ]);

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [
        { name: legacyName, version: 1 },
        { name: newerLegacyName, version: 3 }
      ]),
      requestLock: vi.fn(async (_name, _options, callback) => callback())
    };

    const history = await openEventHistory({ panelSessionId, runtime });
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") {
        status = publication.status;
      }
    });
    await history.close();

    expect((runtime.requestLock as ReturnType<typeof vi.fn>).mock.calls.map((entry) => entry[0])).toContain(
      legacyOwnerLock(legacyName)
    );
    expect((runtime.requestLock as ReturnType<typeof vi.fn>).mock.calls.map((entry) => entry[0])).not.toContain(
      legacyOwnerLock(newerLegacyName)
    );
    expect(await hasLegacyMarker(legacyName, "owned", "legacy-old")).toBe(false);
    expect(await hasLegacyMarker(newerLegacyName, "owned", "legacy-new")).toBe(true);
    expect(status).toMatchObject({ fallback: "UNKNOWN_NEWER_SCHEMA", capacity: { tier: "LOWER" } });
  });

  it("normalizes panel-session identifiers when matching crash residue journals", async () => {
    const unsanitizedPanelSessionId = "ownership session/unsanitized";
    const sanitizedPanelSessionId = authoritativeEventDatabaseName(unsanitizedPanelSessionId).replace(
      `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-v${AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION}-`,
      ""
    );
    const legacyName = legacyJournalName(sanitizedPanelSessionId, 1);
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await createLegacyJournal(sanitizedPanelSessionId, 1, "owned", "unsanitized-legacy");

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [{ name: legacyName, version: 1 }]),
      requestLock: vi.fn(async (_name, _options, callback) => callback())
    };

    const history = await openEventHistory({ panelSessionId: unsanitizedPanelSessionId, runtime });
    await history.close();
    expect(await hasLegacyMarker(legacyName, "owned", "unsanitized-legacy")).toBe(false);
  });

  it("preserves recognized newer schema journals and falls back to memory", async () => {
    const currentPanelSessionId = "ownership-unknown-newer";
    const legacySessionId = "ownership-unknown-other";
    const newerName = legacyJournalName(legacySessionId, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION + 1);
    const legacyName = legacyJournalName(legacySessionId, 1);
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await Promise.all([
      createLegacyJournal(legacySessionId, 1, "owned", "legacy-old"),
      createLegacyJournal(legacySessionId, AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION + 1, "future", "future-stays")
    ]);

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [
        { name: legacyName, version: 1 },
        { name: newerName, version: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION + 1 }
      ]),
      requestLock: vi.fn(async (_name, _options, callback) => callback())
    };

    const history = await openEventHistory({ panelSessionId: currentPanelSessionId, runtime });
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });
    expect(status).toMatchObject({
      capacity: { tier: "LOWER" },
      fallback: "UNKNOWN_NEWER_SCHEMA"
    });
    await history.close();

    expect(await hasLegacyMarker(legacyName, "owned", "legacy-old")).toBe(false);
    expect(await hasLegacyMarker(newerName, "future", "future-stays")).toBe(true);
  });

  it("holds current-journal ownership and blocks a concurrent session", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const panelSessionId = "owner-lock-block";
    const runtime = authoritativeEventDatabaseRuntime();
    const first = await openEventHistory({ panelSessionId, runtime });

    const second = await openEventHistory({ panelSessionId, runtime });
    let secondStatus: unknown;
    second.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") secondStatus = publication.status;
    });
    expect(secondStatus).toMatchObject({
      capacity: { tier: "LOWER" },
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });

    await first.close();
    await second.close();

    const recovered = await openEventHistory({ panelSessionId, runtime });
    let recoveredStatus: unknown;
    recovered.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") recoveredStatus = publication.status;
    });
    expect(recoveredStatus).toMatchObject({ capacity: { tier: "NORMAL" }, fallback: null });
    await recovered.close();
  });

  it("claims self ownership before sweeping concurrent startups' preexisting journals", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const firstPanelSessionId = "ownership-concurrent-first";
    const secondPanelSessionId = "ownership-concurrent-second";
    const firstDatabaseName = authoritativeEventDatabaseName(firstPanelSessionId);
    const secondDatabaseName = authoritativeEventDatabaseName(secondPanelSessionId);
    await Promise.all([
      createModernJournal(firstPanelSessionId, 1),
      createModernJournal(secondPanelSessionId, 1)
    ]);

    const activeLocks = new Set<string>();
    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [
        { name: firstDatabaseName, version: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION },
        { name: secondDatabaseName, version: AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION }
      ]),
      requestLock: vi.fn(async (name, _options, callback) => {
        if (activeLocks.has(name)) return null;
        activeLocks.add(name);
        try {
          return await callback();
        } finally {
          activeLocks.delete(name);
        }
      })
    };

    const [first, second] = await Promise.all([
      openEventHistory({ panelSessionId: firstPanelSessionId, runtime }),
      openEventHistory({ panelSessionId: secondPanelSessionId, runtime })
    ]);

    await expect(first.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [{ sequence: 1, eventId: "event-0" }] }
    });
    await expect(second.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [{ sequence: 1, eventId: "event-0" }] }
    });

    await Promise.all([first.close(), second.close()]);
  });

  it("keeps orphan journals when cleanup lock cannot be acquired", async () => {
    const panelSessionId = "ownership-lock-blocked";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const legacyName = legacyJournalName(panelSessionId, 1);
    await createLegacyJournal(panelSessionId, 1, "owned", "legacy-blocked");

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [{ name: legacyName, version: 1 }]),
      requestLock: vi.fn(async () => null)
    };

    const history = await openEventHistory({ panelSessionId, runtime });
    await history.close();
    expect(await hasLegacyMarker(legacyName, "owned", "legacy-blocked")).toBe(true);
  });

  it("preserves an actively locked peer while still cleaning up true orphan journals", async () => {
    const activePeerSessionId = "ownership-active-peer";
    const activePeerName = legacyJournalName(activePeerSessionId, 1);
    const orphanSessionId = "ownership-true-orphan";
    const orphanName = legacyJournalName(orphanSessionId, 1);
    const currentSessionId = "ownership-second-startup";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await Promise.all([
      createLegacyJournal(activePeerSessionId, 1, "owned", "active-peer"),
      createLegacyJournal(orphanSessionId, 1, "owned", "true-orphan")
    ]);

    const activeLocks = new Set<string>();
    const request = vi.fn(async (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<unknown> | unknown
    ) => {
      if (activeLocks.has(name)) {
        return callback(options.ifAvailable ? null : ({ name, mode: options.mode } as Lock));
      }
      activeLocks.add(name);
      try {
        return await callback({ name, mode: options.mode } as Lock);
      } finally {
        activeLocks.delete(name);
      }
    });
    const originalNavigatorLocks = navigator.locks;
    Reflect.set(navigator, "locks", { request });

    let releaseActivePeer!: () => void;
    const activePeerRelease = new Promise<void>((resolve) => {
      releaseActivePeer = resolve;
    });
    try {
      const runtime = authoritativeEventDatabaseRuntime({
        listDatabases: vi.fn(async () => [
          { name: activePeerName, version: 1 },
          { name: orphanName, version: 1 }
        ])
      });
      const activePeerLock = runtime.requestLock(
        legacyOwnerLock(activePeerName),
        { mode: "exclusive", ifAvailable: false },
        () => activePeerRelease
      );
      await vi.waitFor(() => expect(activeLocks.has(legacyOwnerLock(activePeerName))).toBe(true));

      const history = await createIndexedDbEventHistory({ panelSessionId: currentSessionId, runtime });
      expect(activeLocks.has(legacyOwnerLock(activePeerName))).toBe(true);
      expect(activeLocks.has(legacyOwnerLock(authoritativeEventDatabaseName(currentSessionId)))).toBe(true);
      expect(await hasLegacyMarker(activePeerName, "owned", "active-peer")).toBe(true);
      expect(await hasLegacyMarker(orphanName, "owned", "true-orphan")).toBe(false);

      await history.close();
      releaseActivePeer();
      await activePeerLock;
    } finally {
      Reflect.set(navigator, "locks", originalNavigatorLocks);
    }
  });

  it("falls back to memory when the startup lock throws", async () => {
    const panelSessionId = "startup-lock-error";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const legacyName = legacyJournalName(panelSessionId, 1);
    await createLegacyJournal(panelSessionId, 1, "owned", "legacy-lock-error");

    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [{ name: legacyName, version: 1 }]),
      requestLock: vi.fn(async () => {
        throw new Error("lock request failed");
      })
    };

    const history = await openEventHistory({ panelSessionId, runtime });
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });
    expect(status).toMatchObject({ fallback: "PRIMARY_JOURNAL_UNAVAILABLE", capacity: { tier: "LOWER" } });
    await history.close();
    expect(await hasLegacyMarker(legacyName, "owned", "legacy-lock-error")).toBe(true);
  });

  it("falls back to memory when startup database enumeration fails", async () => {
    const panelSessionId = "startup-list-error";
    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => {
        throw new Error("database listing failed");
      }),
      requestLock: vi.fn(async (_name, _options, callback) => callback())
    };

    const history = await openEventHistory({ panelSessionId, runtime });
    let status: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") status = publication.status;
    });
    expect(status).toMatchObject({ fallback: "PRIMARY_JOURNAL_UNAVAILABLE", capacity: { tier: "LOWER" } });
    await history.close();
  });

  it("supports delayed lock callbacks while deleting orphan journals", async () => {
    const panelSessionId = "startup-lock-late";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const legacyName = legacyJournalName(panelSessionId, 1);
    await createLegacyJournal(panelSessionId, 1, "owned", "legacy-late");

    let notifyStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let release!: () => void;
    const cleanupPermit = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime: AuthoritativeEventDatabaseRuntime = {
      listDatabases: vi.fn(async () => [{ name: legacyName, version: 1 }]),
      requestLock: (async (_name, _options, callback) => {
        notifyStarted();
        await cleanupPermit;
        return callback();
      }) as AuthoritativeEventDatabaseRuntime["requestLock"]
    };

    const historyPromise = createIndexedDbEventHistory({ panelSessionId, runtime });
    await cleanupStarted;
    let historyResolved = false;
    void historyPromise.then(() => {
      historyResolved = true;
    });
    await Promise.resolve();
    expect(historyResolved).toBe(false);
    release();
    const history = await historyPromise;
    await history.close();
    expect(await hasLegacyMarker(legacyName, "owned", "legacy-late")).toBe(false);
  });

  it("releases in-process ownership locks after a cleanup callback failure", async () => {
    const runtime = authoritativeEventDatabaseRuntime();
    const lockName = `${AUTHORITATIVE_EVENT_DB_NAME_PREFIX}-owner-v${AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION}-leak`;
    await expect(
      runtime.requestLock(
        lockName,
        { mode: "exclusive", ifAvailable: false },
        () => Promise.reject(new Error("cleanup callback failed"))
      )
    ).rejects.toThrow("cleanup callback failed");

    await expect(
      runtime.requestLock(
        lockName,
        { mode: "exclusive", ifAvailable: true },
        () => Promise.resolve("recovered")
      )
    ).resolves.toBe("recovered");
  });
});
