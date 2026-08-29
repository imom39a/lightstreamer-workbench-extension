import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import type { EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import {
  AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase,
  openAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import { type EvidenceFilter, type EvidenceQueryRequest, type EvidenceSnapshot, typedFacetValue } from "../src/core/evidence-filter-contract";
import { canonicalEvidenceSearchTextWithExtraction, EVIDENCE_FACET_KEYS, extractEvidenceFacets, FACET_DESCRIPTORS, normalizeEvidenceSearchText } from "../src/core/evidence-facets";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function event(id: string, timestamp: number, key: string, options: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client-collision", sessionId: `session-${id === "one" ? "a" : "b"}` },
    subscription: { id: "subscription-collision", mode: "COMMAND" }, item: { name: "shared-item" }, listener: { id: id === "wire" ? "listener-wire" : "listener-shared" },
    update: { isSnapshot: false, key, command: id === "delete" ? "DELETE" : "ADD", fields: { key, text: `${id}-needle` } }, ...options
  };
}

function publicResult(snapshot: EvidenceSnapshot) {
  return {
    readPoint: snapshot.readPoint,
    page: snapshot.page,
    totals: snapshot.totals,
    discoveries: [...snapshot.discoveries.entries()],
    lookup: snapshot.lookup,
    find: snapshot.find,
    evaluation: snapshot.evaluation,
    coverage: snapshot.coverage,
    storage: snapshot.storage,
    telemetry: snapshot.telemetry ?? null
  };
}

/** Storage and adapter telemetry are intentionally different public facts. */
function comparablePublicResult(snapshot: EvidenceSnapshot) {
  const result = publicResult(snapshot);
  return { ...result, storage: "PARITY" as const, telemetry: null };
}

function expectPublicParity(actual: EvidenceSnapshot, expected: EvidenceSnapshot): void {
  expect(comparablePublicResult(actual)).toEqual(comparablePublicResult(expected));
  expect(actual.storage).toBe("INDEXED_DB");
  expect(expected.storage).toBe("MEMORY_FALLBACK");
  expect(expected.telemetry).toEqual(expect.objectContaining({
    elapsedMs: expect.any(Number),
    candidateBound: expect.any(Number),
    projectionReads: expect.any(Number),
    fullRetainedScan: expect.any(Boolean),
    residualScan: expect.any(Boolean)
  }));
  expect(actual.telemetry).toEqual(expect.objectContaining({
    elapsedMs: expect.any(Number),
    payloadHydrations: expect.any(Number),
    postingReads: expect.any(Number),
    projectionReads: expect.any(Number)
  }));
}

async function offerBatch(history: EventHistory, candidates: readonly LightstreamerEventEnvelope[]): Promise<void> {
  const receipts = candidates.map((candidate) => history.offer(candidate));
  expect(receipts.every((receipt) => receipt.intake === "QUEUED")).toBe(true);
  const results = await Promise.all(receipts.map((receipt) => receipt.settled));
  expect(results.every((result) => result.outcome === "BECAME_EVIDENCE")).toBe(true);
}

async function paired(name: string) {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  const memory = await createMemoryEventHistoryForTests({ panelSessionId: name });
  const durable = await createIndexedDbEventHistory({ panelSessionId: name });
  const candidates = [
    event("one", 10, "same"), event("two", 20, "same"), event("delete", 30, "other"),
    event("wire", 40, "wire", { captureSource: "wire" }), event("local", 50, "local", { source: "synthetic", synthetic: true }),
    event("collision", 60, "same", { client: { id: "client-collision", sessionId: "session-c" } })
  ];
  await Promise.all([offerBatch(memory, candidates), offerBatch(durable, candidates)]);
  return { memory, durable, candidates };
}

function requestAt(readPoint: EvidenceSnapshot["readPoint"] | "LATEST_COMMITTED", filter: EvidenceFilter, discover?: EvidenceQueryRequest["discover"]): EvidenceQueryRequest {
  return { at: readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter, ...(discover ? { discover } : {}) };
}

function exactLegacyFacets(candidate: LightstreamerEventEnvelope): string[] {
  const facet = (name: string, value: unknown): string => JSON.stringify(["v1", name, value]);
  return [
    facet("kind", candidate.kind), facet("clientId", candidate.client?.id ?? null),
    facet("sessionId", candidate.client?.sessionId ?? null), facet("subscriptionId", candidate.subscription?.id ?? null),
    facet("mode", candidate.subscription?.mode ?? null), facet("item", candidate.item?.name ?? null),
    facet("itemPosition", candidate.item?.position ?? null), facet("listenerId", candidate.listener?.id ?? null),
    facet("key", candidate.update?.key ?? null), facet("command", candidate.update?.command ?? null),
    facet("snapshot", Boolean(candidate.update?.isSnapshot)), facet("synthetic", candidate.synthetic)
  ];
}

function querySearchTokens(value: string): string[] {
  const normalized = normalizeEvidenceSearchText(value);
  const codePoints = Array.from(normalized);
  const trigrams = codePoints.length < 3 ? [] : codePoints.slice(0, -2).map((_, index) => codePoints.slice(index, index + 3).join(""));
  return [...new Set([...normalized.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean), ...trigrams])];
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`${label} failed.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`${label} aborted.`));
  });
}

async function createLegacyV5Fixture(panelSessionId: string, candidates: readonly LightstreamerEventEnvelope[], corruptReplayPayload = false): Promise<string> {
  const name = authoritativeEventDatabaseName(panelSessionId);
  const interval = { id: `${panelSessionId}:interval-1`, ordinal: 1 };
  const request = indexedDB.open(name, 5);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, { keyPath: "key" });
    const evidence = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence, { keyPath: "sequence" });
    evidence.createIndex("eventIdentity", "eventId", { unique: true });
    evidence.createIndex("facets", "facets", { multiEntry: true });
    const postings = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings, { keyPath: ["token", "sequence"] });
    postings.createIndex("token", "token", { unique: false });
    const projections = database.createObjectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections, { keyPath: "sequence" });
    projections.createIndex("timestamp", "timestamp", { unique: false });
    projections.createIndex("searchTokens", "searchTokens", { unique: false, multiEntry: true });
  };
  const database = await requestValue(request);
  const transaction = database.transaction(Object.values(AUTHORITATIVE_EVENT_STORE_NAMES).filter((store) => store !== AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates), "readwrite");
  let replayPayloadBytes = 0;
  let accountedBytes = 0;
  for (const [index, candidate] of candidates.entries()) {
    const sequence = index + 1;
    const serialized = serializeJournalEvidenceCandidate(candidate);
    const replayPayload = corruptReplayPayload && index === 0 ? "{corrupt-legacy-replay" : serialized.payload;
    const accounted = journalAccountedBytes(serialized.bytes);
    replayPayloadBytes += serialized.bytes;
    accountedBytes += accounted;
    transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).add({
      intervalId: interval.id, sequence, eventId: candidate.id, replayPayload, serializedBytes: serialized.bytes, accountedBytes: accounted, facets: exactLegacyFacets(candidate)
    });
    const identity = { intervalId: interval.id, pageId: interval.id, ownerId: "memory-event-history", sequence, eventId: candidate.id };
    const context = { identity, pageId: interval.id, listenerOwner: identity.ownerId, summary: candidate.kind };
    const extracted = extractEvidenceFacets(candidate, context);
    const searchText = canonicalEvidenceSearchTextWithExtraction(candidate, context, extracted);
    transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.queryProjections).add({
      sequence, intervalId: interval.id, eventId: candidate.id, timestamp: candidate.timestamp, summary: candidate.kind,
      searchText, searchTokens: querySearchTokens(searchText), facets: extracted.facets
    });
    for (const value of extracted.selectableValues.slice(0, 12)) {
      transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.facetPostings).add({
        token: JSON.stringify(["facet-v2", value.identity]), sequence, intervalId: interval.id, eventId: candidate.id, facetIdentity: value.identity
      });
    }
  }
  const last = candidates.at(-1);
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put({
    key: "control", schemaVersion: 2, recordVersion: 3, panelSessionId, interval, phase: "RUNNING", terminal: null,
    nextSequence: candidates.length + 1,
    committedEvidenceBoundary: last ? { intervalId: interval.id, sequence: candidates.length, eventId: last.id } : null,
    retainedRange: last ? { first: { intervalId: interval.id, sequence: 1, eventId: candidates[0]!.id }, last: { intervalId: interval.id, sequence: candidates.length, eventId: last.id } } : null,
    retainedCount: candidates.length, replayPayloadBytes, accountedBytes
  });
  await transactionDone(transaction, "creating the legacy v5 fixture");
  database.close();
  return name;
}

async function databaseShape(name: string): Promise<{ version: number; stores: string[] }> {
  const database = await requestValue(indexedDB.open(name));
  try {
    return { version: database.version, stores: [...database.objectStoreNames].sort() };
  } finally {
    database.close();
  }
}

describe("filter-impl-09 durable public-result parity", () => {
  it("preserves Item Update field certainty through memory and IndexedDB replay and Clear", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const name = `item-update-field-certainty-${Date.now()}`;
    const memory = await createMemoryEventHistoryForTests({ panelSessionId: name });
    const durable = await createIndexedDbEventHistory({ panelSessionId: name });
    const candidate = event("certainty", 1, "alpha", {
      update: {
        fields: { key: "alpha", nullable: null, secret: "[redacted]" },
        changedFields: { nullable: null, secret: "[redacted]" },
        fieldValueStates: {
          key: "concrete",
          nullable: "ambiguous-null",
          secret: "redacted",
          patch: "unresolved-wire-difference"
        },
        changedFieldValueStates: {
          nullable: "ambiguous-null",
          secret: "redacted"
        }
      }
    });
    try {
      await Promise.all([offerBatch(memory, [candidate]), offerBatch(durable, [candidate])]);
      const request = { ...requestAt("LATEST_COMMITTED", emptyFilter()), includePayload: true };
      const [memoryResult, durableResult] = await Promise.all([
        memory.query!(request),
        durable.query!(request)
      ]);
      expect(memoryResult.ok).toBe(true);
      expect(durableResult.ok).toBe(true);
      if (!memoryResult.ok || !durableResult.ok) throw new Error("Expected replay queries");
      const expectedStates = {
        key: "concrete",
        nullable: "ambiguous-null",
        secret: "redacted",
        patch: "unresolved-wire-difference"
      };
      expect((memoryResult.value.page.evidence[0]?.payload as LightstreamerEventEnvelope)
        .update?.fieldValueStates).toEqual(expectedStates);
      expect((durableResult.value.page.evidence[0]?.payload as LightstreamerEventEnvelope)
        .update?.fieldValueStates).toEqual(expectedStates);
      expect((memoryResult.value.page.evidence[0]?.payload as LightstreamerEventEnvelope)
        .update?.changedFieldValueStates).toEqual({
          nullable: "ambiguous-null",
          secret: "redacted"
        });
      expect((durableResult.value.page.evidence[0]?.payload as LightstreamerEventEnvelope)
        .update?.changedFieldValueStates).toEqual({
          nullable: "ambiguous-null",
          secret: "redacted"
        });

      await Promise.all([memory.clear(), durable.clear()]);
      const [clearedMemory, clearedDurable] = await Promise.all([
        memory.query!(requestAt("LATEST_COMMITTED", emptyFilter())),
        durable.query!(requestAt("LATEST_COMMITTED", emptyFilter()))
      ]);
      expect(clearedMemory.ok && clearedMemory.value.page.evidence).toEqual([]);
      expect(clearedDurable.ok && clearedDurable.value.page.evidence).toEqual([]);
    } finally {
      await Promise.all([memory.close(), durable.close()]);
      await deleteAuthoritativeEventDatabase(name);
    }
  });

  it("matches the memory oracle across every facet, query shape, provenance, conflict, and selected-evidence path", async () => {
    const { memory, durable } = await paired(`filter-impl-09-parity-${Date.now()}`);
    try {
      const pointResult = await memory.query!(requestAt("LATEST_COMMITTED", emptyFilter()));
      expect(pointResult.ok).toBe(true);
      if (!pointResult.ok) throw new Error("Expected paired history read point");
      const readPoint = pointResult.value.readPoint;
      const same = typedFacetValue("key", "string", "same");
      const other = typedFacetValue("key", "string", "other");
      const selected = pointResult.value.page.evidence[0]!.identity;
      const requests: EvidenceQueryRequest[] = [
        requestAt(readPoint, { ...emptyFilter(), criteria: { key: { include: [same, other], exclude: [other] } } }, [{ facet: "key", size: 10 }]),
        requestAt(readPoint, { ...emptyFilter(), criteria: { key: { include: [], exclude: [other] } } }, [{ facet: "key", size: 10 }]),
        { ...requestAt(readPoint, emptyFilter(), [{ facet: "provenance", size: 10 }]), page: { order: "NEWEST_FIRST", size: 10 }, filter: { ...emptyFilter(), text: "wire", criteria: { provenance: { include: [typedFacetValue("provenance", "enum", "SERVER")], exclude: [] }, observationPath: { include: [typedFacetValue("observationPath", "enum", "WIRE")], exclude: [] } } } },
        requestAt(readPoint, { ...emptyFilter(), criteria: { provenance: { include: [typedFacetValue("provenance", "enum", "SERVER")], exclude: [] }, observationPath: { include: [typedFacetValue("observationPath", "enum", "LISTENER")], exclude: [] } } }, [{ facet: "observationPath", size: 10 }]),
        requestAt(readPoint, { ...emptyFilter(), criteria: { provenance: { include: [typedFacetValue("provenance", "enum", "LOCAL")], exclude: [] } } }, [{ facet: "provenance", size: 10 }]),
        requestAt(readPoint, { ...emptyFilter(), around: { intervalId: readPoint.interval.id, start: 20, end: 51 } }, [{ facet: "listener", size: 10 }]),
        requestAt(readPoint, emptyFilter(), [{ facet: "key", size: 10 }]),
        { ...requestAt(readPoint, emptyFilter()), lookup: selected, find: { text: "needle", current: selected } }
      ];
      for (const facet of EVIDENCE_FACET_KEYS) requests.push(requestAt(readPoint, emptyFilter(), [{ facet, size: 10 }]));
      for (const request of requests) {
        const expected = await memory.query!(request);
        const actual = await durable.query!(request);
        expect(actual.ok).toBe(expected.ok);
        if (!expected.ok || !actual.ok) throw new Error("Expected paired query success");
        expectPublicParity(actual.value, expected.value);
      }

      for (const facet of EVIDENCE_FACET_KEYS) {
        const descriptor = FACET_DESCRIPTORS.find((candidate) => candidate.key === facet);
        if (!descriptor) throw new Error(`Expected a descriptor for ${facet}`);
        const absent = typedFacetValue(facet, descriptor.valueType, "absent-from-evidence");
        const request = requestAt(readPoint, { ...emptyFilter(), criteria: { [facet]: { include: [absent], exclude: [] } } }, [{ facet, size: 10 }]);
        const expected = await memory.query!(request);
        const actual = await durable.query!(request);
        expect(expected.ok).toBe(true);
        expect(actual.ok).toBe(true);
        if (!expected.ok || !actual.ok) throw new Error(`Expected absent ${facet} query success`);
        expectPublicParity(actual.value, expected.value);
      }
    } finally { await Promise.all([memory.close(), durable.close()]); }
  });

  it("preserves unsupported/read-point, Clear invalidation, rolling retention, and lower fallback semantics", async () => {
    const { memory, durable } = await paired(`filter-impl-09-lifecycle-${Date.now()}`);
    const first = await memory.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected initial read point");
    const unsupportedRequest = requestAt(first.value.readPoint, { ...emptyFilter(), unsupported: [{ id: "future", label: "Future", reason: "UNSUPPORTED_FACET" }] }, [{ facet: "key", size: 10 }]);
    const unsupported = await durable.query!(unsupportedRequest);
    expect(unsupported).toMatchObject({ ok: true, value: { evaluation: "UNSUPPORTED_FILTER", totals: { matching: 0, inScope: 0 }, storage: "INDEXED_DB" } });
    expect(unsupported.ok && unsupported.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });

    await Promise.all([memory.clear(), durable.clear()]);
    const oldMemory = await memory.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    const oldDurable = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(oldMemory).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    expect(oldDurable).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    const clearedExpected = await memory.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
    const clearedActual = await durable.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
    expect(clearedExpected.ok).toBe(true);
    expect(clearedActual).toMatchObject({ ok: true });
    if (clearedExpected.ok && clearedActual.ok) expectPublicParity(clearedActual.value, clearedExpected.value);
    await Promise.all([memory.close(), durable.close()]);

    const lowerName = `filter-impl-09-lower-${Date.now()}`;
    const lowerMemory = await createMemoryEventHistoryForTests({ panelSessionId: lowerName, capacityTier: "LOWER", capacity: { maxRetainedCount: 1, retainedWarningCount: 1 } });
    const lowerDurable = await createIndexedDbEventHistory({ panelSessionId: lowerName, capacityTier: "LOWER", capacity: { maxRetainedCount: 1, retainedWarningCount: 1 } });
    try {
      const firstCandidate = event("lower-one", 1, "lower-one");
      const secondCandidate = event("lower-two", 2, "lower-two");
      const firstReceipts = [lowerMemory.offer(firstCandidate), lowerDurable.offer(firstCandidate)];
      expect((await Promise.all(firstReceipts.map((receipt) => receipt.settled))).every((result) => result.outcome === "BECAME_EVIDENCE")).toBe(true);
      const crossingReceipts = [lowerMemory.offer(secondCandidate), lowerDurable.offer(secondCandidate)];
      const crossingResults = await Promise.all(crossingReceipts.map((receipt) => receipt.settled));
      expect(crossingResults.every((result) => result.outcome === "BECAME_EVIDENCE")).toBe(true);
      expect(lowerMemory.status()).toMatchObject({ phase: "RUNNING", accepted: 2, retained: 1 });
      expect(lowerDurable.status()).toMatchObject({ phase: "RUNNING", accepted: 2, retained: 1 });
      const lowerExpected = await lowerMemory.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
      const lowerActual = await lowerDurable.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
      expect(lowerExpected.ok).toBe(true);
      expect(lowerActual.ok).toBe(true);
      if (lowerExpected.ok && lowerActual.ok) {
        expectPublicParity(lowerActual.value, lowerExpected.value);
        expect(lowerActual.value.coverage).toBe("LIMITED");
        expect(lowerActual.value.page.evidence[0]?.identity).toMatchObject({ eventId: "lower-two", sequence: 2 });
      }
    } finally { await Promise.all([lowerMemory.close(), lowerDurable.close()]); }

    const fallback = await createMemoryEventHistoryForTests({ panelSessionId: `filter-impl-09-fallback-${Date.now()}`, capacityTier: "LOWER", fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
    try {
      const fallbackResult = await fallback.query!(requestAt("LATEST_COMMITTED", emptyFilter(), [{ facet: "key", size: 10 }]));
      expect(fallbackResult).toMatchObject({ ok: true, value: { storage: "MEMORY_FALLBACK", coverage: "LIMITED" } });
      expect(fallbackResult.ok && fallbackResult.value.telemetry).toEqual(expect.objectContaining({ fullRetainedScan: true, residualScan: true }));
    } finally { await fallback.close(); }
  });

  it("migrates a real legacy-v5 journal by rebuilding current postings and aggregates with parity", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const panelSessionId = `filter-impl-09-legacy-${Date.now()}`;
    const name = await createLegacyV5Fixture(panelSessionId, [event("legacy-one", 10, "legacy-one"), event("legacy-two", 20, "legacy-two")]);
    const before = await databaseShape(name);
    expect(before.version).toBe(5);
    expect(before.stores).not.toContain(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
    const memory = await createMemoryEventHistoryForTests({ panelSessionId });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    try {
      const after = await databaseShape(name);
      expect(after.version).toBe(AUTHORITATIVE_EVENT_DB_SCHEMA_VERSION);
      expect(after.stores).toContain(AUTHORITATIVE_EVENT_STORE_NAMES.facetAggregates);
      const candidates = [event("legacy-one", 10, "legacy-one"), event("legacy-two", 20, "legacy-two")];
      await offerBatch(memory, candidates);
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] };
      const expected = await memory.query!(request);
      const actual = await durable.query!(request);
      expect(expected.ok).toBe(true);
      expect(actual.ok).toBe(true);
      if (expected.ok && actual.ok) expectPublicParity(actual.value, expected.value);
    } finally {
      await Promise.all([memory.close(), durable.close()]);
      await deleteAuthoritativeEventDatabase(name);
    }
  });

  it("fails closed when a legacy-v5 replay payload cannot rebuild current postings", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const name = await createLegacyV5Fixture(`filter-impl-09-legacy-corrupt-${Date.now()}`, [event("legacy-corrupt", 10, "legacy-corrupt")], true);
    try {
      await expect(openAuthoritativeEventDatabase(name)).rejects.toMatchObject({ code: "OPEN_FAILED" });
    } finally {
      await deleteAuthoritativeEventDatabase(name);
    }
  });
});
