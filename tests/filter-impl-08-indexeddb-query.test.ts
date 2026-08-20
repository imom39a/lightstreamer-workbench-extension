import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { type EvidenceFilter, typedFacetValue } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { extractEvidenceFacets } from "../src/core/evidence-facets";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
import { toEvidenceQueryRequest } from "../src/extension/panel/evidence-investigation-query";

function event(id: string, timestamp: number, value: string, listenerId?: string): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "sub-1", mode: "MERGE" }, item: { name: "item-1", position: 1 },
    update: { isSnapshot: false, fields: { value } },
    ...(listenerId === undefined ? {} : { listener: { id: listenerId } })
  };
}

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

async function histories(name: string) {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  const memory = await createMemoryEventHistoryForTests({ panelSessionId: name });
  const durable = await createIndexedDbEventHistory({ panelSessionId: name });
  for (const candidate of [event("one", 10_000, "alpha"), event("two", 10_000, "beta"), event("three", 20_000, "alpha")]) {
    await memory.offer(candidate).settled;
    await durable.offer(candidate).settled;
  }
  return { memory, durable };
}

describe("filter-impl-08 IndexedDB Evidence query", () => {
  it("retains the last coherent publication when a later projection is corrupt", async () => {
    const panelSessionId = `filter-impl-08-coherent-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    await durable.offer(event("one", 10_000, "alpha")).settled;
    const first = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const publications: Array<{ lastCoherentQuery?: unknown; problem?: unknown }> = [];
    const stop = durable.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") publications.push(publication.status as typeof publications[number]);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("evidence", "readwrite");
        const get = transaction.objectStore("evidence").get(1);
        get.onsuccess = () => {
          const record = get.result as Record<string, unknown>;
          record.replayPayload = "corrupt-payload";
          transaction.objectStore("evidence").put(record);
        };
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const failed = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), lookup: first.value.page.evidence[0]!.identity });
    expect(failed).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    expect(publications.at(-1)?.lastCoherentQuery).toEqual(first.value);
    stop();
    await durable.close();
  });

  it("matches the memory oracle for page, totals, Around, lookup blockers, and Find", async () => {
    const { memory, durable } = await histories(`filter-impl-08-parity-${Date.now()}`);
    const base = await memory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const identity = base.value.page.evidence[1]!.identity;
    const request = {
      at: base.value.readPoint,
      page: { order: "NEWEST_FIRST" as const, size: 2 },
      filter: { ...emptyFilter(), text: "alpha", around: { intervalId: identity.intervalId, start: 10_000, end: 20_000 } },
      lookup: identity,
      find: { text: "alpha", current: identity }
    };
    const expected = await memory.query!(request);
    const actual = await durable.query!(request);
    expect(actual).toMatchObject({ ok: true, value: { page: expected.ok ? expected.value.page : undefined, totals: expected.ok ? expected.value.totals : undefined, lookup: expected.ok ? expected.value.lookup : undefined, find: expected.ok ? expected.value.find : undefined, evaluation: expected.ok ? expected.value.evaluation : undefined } });
    await durable.close();
  });

  it("keeps structural and canonical Item criteria in memory/IndexedDB parity", async () => {
    const { memory, durable } = await histories(`filter-impl-08-identity-parity-${Date.now()}`);
    const base = createFilter();
    const structural = toEvidenceQueryRequest({
      at: "LATEST_COMMITTED",
      scope: { kind: "ITEM", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1", item: "item-1", itemPosition: 1 },
      filter: base,
      page: { order: "OLDEST_FIRST", size: 10 },
      discover: []
    });
    const structuralBase = await memory.query!(structural);
    const item = structuralBase.ok ? structuralBase.value.page.evidence[0]?.facets.item : undefined;
    expect(item).toBeDefined();
    const canonicalItem = toEvidenceQueryRequest({
      at: "LATEST_COMMITTED",
      scope: { kind: "ITEM", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1", item: "item-1", itemPosition: 1 },
      filter: { ...base, criteria: { item: { include: [createTypedFilterValue("item", "item", item!.value, item!.label)], exclude: [] } } },
      page: { order: "OLDEST_FIRST", size: 10 },
      discover: []
    });
    const listenerEvent = event("listener-event", 30_000, "listener", "listener-1");
    await memory.offer(listenerEvent).settled;
    await durable.offer(listenerEvent).settled;
    for (const request of [structural, canonicalItem]) {
      const expected = await memory.query!(request);
      const actual = await durable.query!(request);
      expect(actual).toMatchObject({ ok: true, value: { page: expected.ok ? expected.value.page : undefined, totals: expected.ok ? expected.value.totals : undefined } });
      expect(actual.ok && actual.value.page.evidence.map((record) => record.identity.eventId)).toEqual(
        expected.ok ? expected.value.page.evidence.map((record) => record.identity.eventId) : []
      );
    }
    const listener = toEvidenceQueryRequest({
      at: "LATEST_COMMITTED",
      scope: { kind: "LISTENER", listenerId: "listener-1" },
      filter: base,
      page: { order: "OLDEST_FIRST", size: 10 },
      discover: []
    });
    const expectedListener = await memory.query!(listener);
    const actualListener = await durable.query!(listener);
    expect(actualListener).toMatchObject({ ok: true, value: { totals: expectedListener.ok ? expectedListener.value.totals : undefined } });
    expect(actualListener.ok && actualListener.value.page.evidence.map((record) => record.identity.eventId)).toEqual(["listener-event"]);
    await Promise.all([memory.close(), durable.close()]);
  });

  it("excludes topology checkpoint Evidence from canonical pages and totals", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const memory = await createMemoryEventHistoryForTests({ panelSessionId: `filter-impl-08-checkpoint-memory-${Date.now()}` });
    const durable = await createIndexedDbEventHistory({ panelSessionId: `filter-impl-08-checkpoint-durable-${Date.now()}` });
    const candidates = [
      event("visible-one", 1, "one"),
      { id: "checkpoint", kind: "topology-checkpoint" as const, checkpoint: { pageEpoch: "checkpoint" } },
      event("visible-two", 2, "two")
    ];
    for (const candidate of candidates) {
      await memory.offer(candidate).settled;
      await durable.offer(candidate).settled;
    }
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: emptyFilter() };
    const expected = await memory.query!(request);
    const actual = await durable.query!(request);
    expect(expected).toMatchObject({ ok: true, value: { totals: { matching: 2, inScope: 2 } } });
    expect(actual).toMatchObject({ ok: true, value: { totals: { matching: 2, inScope: 2 } } });
    expect(actual.ok && actual.value.page.evidence.map((record) => record.identity.eventId)).toEqual(["visible-one", "visible-two"]);
    await Promise.all([memory.close(), durable.close()]);
  });

  it("accepts a retained historical read point after a later commit", async () => {
    const { memory, durable } = await histories(`filter-impl-08-retained-point-${Date.now()}`);
    const firstMemory = await memory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    const firstDurable = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(firstMemory.ok && firstDurable.ok).toBe(true);
    await memory.offer(event("later", 30_000, "later")).settled;
    await durable.offer(event("later", 30_000, "later")).settled;
    if (!firstMemory.ok || !firstDurable.ok) return;
    const memoryAtPoint = await memory.query!({ at: firstMemory.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    const durableAtPoint = await durable.query!({ at: firstDurable.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(memoryAtPoint).toMatchObject({ ok: true, value: { totals: { matching: 3 } } });
    expect(durableAtPoint).toMatchObject({ ok: true, value: { totals: { matching: 3 } } });
    if (memoryAtPoint.ok && durableAtPoint.ok) {
      expect(memoryAtPoint.value.page.evidence.map((record) => record.identity.eventId)).toEqual(["one", "two", "three"]);
      expect(durableAtPoint.value.page.evidence.map((record) => record.identity.eventId)).toEqual(["one", "two", "three"]);
    }
    await Promise.all([memory.close(), durable.close()]);
  });

  it("returns complete payloads only when the full-payload query path is requested", async () => {
    const { memory, durable } = await histories(`filter-impl-08-payload-${Date.now()}`);
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 1 }, filter: emptyFilter(), includePayload: true };
    const expected = await memory.query!(request);
    const actual = await durable.query!(request);
    expect(expected.ok && expected.value.page.evidence[0]?.payload).toMatchObject({ update: { fields: { value: "alpha" } } });
    expect(actual.ok && actual.value.page.evidence[0]?.payload).toMatchObject({ update: { fields: { value: "alpha" } } });
    await Promise.all([memory.close(), durable.close()]);
  });

  it("fails closed for unsupported criteria and rejects a stale read point after Clear", async () => {
    const { memory, durable } = await histories(`filter-impl-08-lifecycle-${Date.now()}`);
    const first = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const unsupported = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), unsupported: [{ id: "unsupported", label: "Unsupported", reason: "UNSUPPORTED_FACET" }] } });
    expect(unsupported).toMatchObject({ ok: true, value: { evaluation: "UNSUPPORTED_FILTER", totals: { matching: 0, inScope: 0 }, page: { evidence: [] } } });
    await durable.clear();
    const stale = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(stale).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    await Promise.all([memory.close(), durable.close()]);
  });

  it("preserves exact facet algebra in the durable adapter", async () => {
    const { durable } = await histories(`filter-impl-08-facets-${Date.now()}`);
    const filter: EvidenceFilter = { ...emptyFilter(), criteria: { mode: { include: [typedFacetValue("mode", "enum", "MERGE")], exclude: [] } } };
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 3, inScope: 3 }, page: { evidence: [{ identity: { eventId: "one" } }] } } });
    await durable.close();
  });

  it("preserves empty-include semantics and applies same-facet exclusion after union", async () => {
    const { durable } = await histories(`filter-impl-08-algebra-${Date.now()}`);
    const result = await durable.query!({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), criteria: {
        mode: { include: [], exclude: [] }
      } }
    });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 3, inScope: 3 } } });
    await durable.close();
  });

  it("publishes bounded-plan telemetry and rejects cursors outside their request-bound read point", async () => {
    const { durable } = await histories(`filter-impl-08-cursor-${Date.now()}`);
    const first = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.telemetry).toMatchObject({ postingReads: 0, payloadHydrations: 0, pageBound: 1 });
    expect(first.value.telemetry?.evidenceCursorReads).toBeLessThanOrEqual(1);
    expect(first.value.page.nextCursor).toBeTypeOf("string");
    const next = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 1, cursor: first.value.page.nextCursor! }, filter: emptyFilter() });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.page.evidence.map((record) => record.identity.eventId)).toEqual(["two"]);
    const malformed = await durable.query!({ at: first.value.readPoint, page: { order: "NEWEST_FIRST", size: 1, cursor: first.value.page.nextCursor! }, filter: emptyFilter() });
    expect(malformed).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    const discovery = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), discover: [{ facet: "mode", size: 10 }] });
    expect(discovery.ok && discovery.value.discoveries.get("mode")).toMatchObject({ state: "AVAILABLE", distinctTotal: 1, baseEvidenceCount: 3 });
    await durable.close();
  });

  it("latches a committed boundary while a later commit arrives", async () => {
    const { durable } = await histories(`filter-impl-08-latch-${Date.now()}`);
    const first = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await durable.offer(event("four", 30_000, "delta")).settled;
    const latched = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(latched).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "one" } }, { identity: { eventId: "two" } }, { identity: { eventId: "three" } }] }, totals: { matching: 3 } } });
    await durable.close();
  });

  it("keeps memory read points bounded like IndexedDB when a later commit arrives", async () => {
    const { memory, durable } = await histories(`filter-impl-08-memory-latch-${Date.now()}`);
    const queryAtLaterCommit = async (history: NonNullable<typeof memory>) => {
      const first = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
      expect(first.ok).toBe(true);
      if (!first.ok) return first;
      await history.offer(event("four", 30_000, "delta")).settled;
      return history.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    };
    const [memoryResult, durableResult] = await Promise.all([queryAtLaterCommit(memory), queryAtLaterCommit(durable)]);
    expect(memoryResult).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "one" } }, { identity: { eventId: "two" } }, { identity: { eventId: "three" } }] }, totals: { matching: 3, inScope: 3 } } });
    expect(durableResult).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "one" } }, { identity: { eventId: "two" } }, { identity: { eventId: "three" } }] }, totals: { matching: 3, inScope: 3 } } });
    await Promise.all([memory.close(), durable.close()]);
  });

  it("keeps Find independent of Filter and validates an Around anchor outside the match set", async () => {
    const { durable } = await histories(`filter-impl-08-independent-${Date.now()}`);
    const base = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const anchor = base.value.page.evidence[0]!.identity;
    const result = await durable.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), text: "beta", around: { intervalId: anchor.intervalId, start: 0, end: 30_000, anchor, anchorSequence: anchor.sequence } },
      find: { text: "alpha", current: anchor }
    });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 1 }, find: { total: 2, current: anchor, next: { eventId: "three" } }, telemetry: { aroundIndexReads: 1, aroundAnchorValidated: true, fullRetainedScan: true } } });
    await durable.close();
  });

  it("uses complete normalized substring Find candidates and a half-open timestamp Around", async () => {
    const panelSessionId = `filter-impl-08-adversarial-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    for (const candidate of [
      event("alpha-one", 10_000, "first"),
      event("alpha-two", 10_000, "duplicate"),
      event("alphabet", 20_000, "phrase value"),
      event("outside", 30_000, "last")
    ]) await durable.offer(candidate).settled;
    const base = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const find = async (text: string) => durable.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: emptyFilter(),
      find: { text }
    });
    const shortFind = await find("lph");
    expect(shortFind).toMatchObject({ ok: true, value: { find: { total: 3 }, telemetry: { shortFindFallback: false, fullRetainedScan: false, findCursorBound: 3, findCursorReads: 3 } } });
    await expect(find("ALPHA")).resolves.toMatchObject({ ok: true, value: { find: { total: 3 } } });
    const shortNormalizedFind = await find("it");
    expect(shortNormalizedFind).toMatchObject({ ok: true, value: { find: { total: 4 }, telemetry: { shortFindFallback: true, fullRetainedScan: true, retainedCount: 4, cursorWorkBound: 4 } } });

    const around = await durable.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), around: { intervalId: base.value.readPoint.interval.id, start: 10_000, end: 20_000 } }
    });
    expect(around).toMatchObject({ ok: true, value: {
      totals: { matching: 4, inScope: 2 },
      page: { evidence: [{ identity: { eventId: "alpha-one" } }, { identity: { eventId: "alpha-two" } }] },
      telemetry: { aroundIndexReads: 1, aroundCandidates: 2, candidateBound: 2, evidenceCursorReads: 2, fullRetainedScan: false, pageBound: 10 }
    } });
    const newestAround = await durable.query!({
      at: base.value.readPoint,
      page: { order: "NEWEST_FIRST", size: 1 },
      filter: { ...emptyFilter(), around: { intervalId: base.value.readPoint.interval.id, start: 10_000, end: 20_000 } }
    });
    expect(newestAround).toMatchObject({ ok: true, value: {
      totals: { matching: 4, inScope: 2 },
      page: { evidence: [{ identity: { eventId: "alpha-two" } }] },
      telemetry: { candidateBound: 2, evidenceCursorReads: 2, fullRetainedScan: false }
    } });
    const isolated = await durable.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), around: { intervalId: "other-interval", start: 0, end: 40_000 } }
    });
    expect(isolated).toMatchObject({ ok: true, value: { totals: { matching: 4, inScope: 0 }, page: { evidence: [] } } });
    await durable.close();
  });

  it("uses a bounded exact-token posting for a hyphenated Find query", async () => {
    const panelSessionId = `filter-impl-08-exact-token-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    try {
      for (let sequence = 1; sequence <= 20; sequence += 1) {
        const key = sequence <= 3 ? "order-00001" : `order-${String(sequence).padStart(5, "0")}`;
        await durable.offer({
          ...event(`order-${sequence}`, sequence, "value"),
          update: { isSnapshot: false, key, fields: { key } }
        }).settled;
      }
      const result = await durable.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 1 },
        filter: emptyFilter(),
        find: { text: "order-00001" }
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          find: { total: 3, matches: [{ eventId: "order-1" }, { eventId: "order-2" }, { eventId: "order-3" }] },
          telemetry: { findCursorBound: 3, findCursorReads: 3, shortFindFallback: false, fullRetainedScan: false }
        }
      });
    } finally {
      await durable.close();
    }
  });

  it("fails closed when a selected projection is missing or corrupt", async () => {
    const panelSessionId = `filter-impl-08-projection-failure-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    await durable.offer(event("one", 10_000, "alpha")).settled;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("queryProjections", "readwrite");
    transaction.objectStore("queryProjections").delete(1);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    const failed = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(failed).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await durable.close();
  });

  it("fails closed when a same-count, same-range projection value is corrupt", async () => {
    const panelSessionId = `filter-impl-08-range-coverage-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    for (const candidate of [event("one", 10_000, "alpha"), event("two", 20_000, "beta"), event("three", 30_000, "gamma")]) {
      await durable.offer(candidate).settled;
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("queryProjections", "readwrite");
    const projections = transaction.objectStore("queryProjections");
    const second = projections.get(2);
    second.onsuccess = () => {
      projections.put({ ...(second.result as Record<string, unknown>), eventId: "corrupt-event-id" });
    };
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    await expect(durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() }))
      .resolves.toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await durable.close();
  });

  it("does not backfill missing projections when reopening a current-schema journal", async () => {
    const panelSessionId = `filter-impl-08-current-schema-corruption-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId, clearJournal: async () => false, closeJournal: async () => undefined });
    await durable.offer(event("one", 10_000, "alpha")).settled;
    const coherent = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(coherent).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "one" } }] } } });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("queryProjections", "readwrite");
    transaction.objectStore("queryProjections").clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    await durable.close();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const reopened = await createIndexedDbEventHistory({ panelSessionId, clearJournal: async () => false, closeJournal: async () => undefined });
    const failed = await reopened.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(failed).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await reopened.close();
  });

  it("backfills projections only while upgrading an old-schema journal", async () => {
    const panelSessionId = `filter-impl-08-old-schema-migration-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const name = authoritativeEventDatabaseName(panelSessionId);
    const candidate = event("legacy", 10_000, "alpha");
    const serialized = serializeJournalEvidenceCandidate(candidate);
    const interval = { id: `${panelSessionId}:interval-1`, ordinal: 1 };
    const request = indexedDB.open(name, 4);
    request.onupgradeneeded = () => {
      const database = request.result;
      const evidence = database.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventIdentity", "eventId", { unique: true });
      evidence.createIndex("facets", "facets", { multiEntry: true });
      const postings = database.createObjectStore("facetPostings", { keyPath: ["token", "sequence"] });
      postings.createIndex("token", "token", { unique: false });
      database.createObjectStore("historyControl", { keyPath: "key" });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const accountedBytes = journalAccountedBytes(serialized.bytes);
    const transaction = database.transaction(["historyControl", "evidence", "facetPostings"], "readwrite");
    transaction.objectStore("evidence").put({ intervalId: interval.id, sequence: 1, eventId: candidate.id, replayPayload: serialized.payload, serializedBytes: serialized.bytes, accountedBytes, facets: [
      ["v1", "kind", "item-update"], ["v1", "clientId", "client-1"], ["v1", "sessionId", "session-1"], ["v1", "subscriptionId", "sub-1"], ["v1", "mode", "MERGE"], ["v1", "item", "item-1"], ["v1", "itemPosition", 1], ["v1", "listenerId", null], ["v1", "key", null], ["v1", "command", null], ["v1", "snapshot", false], ["v1", "synthetic", false]
    ].map((value) => JSON.stringify(value)) });
    for (const value of extractEvidenceFacets(candidate).selectableValues) {
      transaction.objectStore("facetPostings").put({ token: JSON.stringify(["facet-v2", value.identity]), sequence: 1, intervalId: interval.id, eventId: candidate.id, facetIdentity: value.identity });
    }
    transaction.objectStore("historyControl").put({ key: "control", schemaVersion: 2, recordVersion: 3, panelSessionId, interval, phase: "RUNNING", terminal: null, nextSequence: 2, committedEvidenceBoundary: { intervalId: interval.id, sequence: 1, eventId: candidate.id }, retainedRange: { first: { intervalId: interval.id, sequence: 1, eventId: candidate.id }, last: { intervalId: interval.id, sequence: 1, eventId: candidate.id } }, retainedCount: 1, replayPayloadBytes: serialized.bytes, accountedBytes });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();

    const durable = await createIndexedDbEventHistory({ panelSessionId });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(result).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "legacy" } }] } } });
    await durable.close();
  });

  it("binds cursors to discover, lookup, Find, Filter, page shape, and read point", async () => {
    const { durable } = await histories(`filter-impl-08-cursor-bindings-${Date.now()}`);
    const base = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const identity = base.value.page.evidence[0]!.identity;
    const cases = [
      { name: "discover", request: { discover: [{ facet: "mode", size: 10 }] }, altered: { discover: [{ facet: "mode", size: 11 }] } },
      { name: "lookup", request: { lookup: identity }, altered: { lookup: base.value.page.evidence[1]!.identity } },
      { name: "find", request: { find: { text: "alpha" } }, altered: { find: { text: "beta" } } },
      { name: "filter", request: { filter: { ...emptyFilter(), text: "alpha" } }, altered: { filter: { ...emptyFilter(), text: "beta" } } }
    ] as const;
    for (const testCase of cases) {
      const first = await durable.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), ...testCase.request });
      expect(first.ok, testCase.name).toBe(true);
      if (!first.ok || !first.value.page.nextCursor) continue;
      const altered = await durable.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1, cursor: first.value.page.nextCursor }, filter: emptyFilter(), ...testCase.altered });
      expect(altered, testCase.name).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    }
    const page = await durable.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), find: { text: "item" } });
    expect(page.ok).toBe(true);
    if (!page.ok || !page.value.page.nextCursor) return;
    const changedPage = await durable.query!({ at: base.value.readPoint, page: { order: "NEWEST_FIRST", size: 1, cursor: page.value.page.nextCursor }, filter: emptyFilter(), find: { text: "item" } });
    expect(changedPage).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await durable.close();
  });

  it("binds memory cursors to the complete query request", async () => {
    const { memory } = await histories(`filter-impl-08-memory-cursor-${Date.now()}`);
    const first = await memory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(first).toMatchObject({ ok: true, value: { page: { nextCursor: expect.any(String) } } });
    if (!first.ok || !first.value.page.nextCursor) return;
    const altered = await memory.query!({
      at: first.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 1, cursor: first.value.page.nextCursor },
      filter: { ...emptyFilter(), text: "alpha" }
    });
    expect(altered).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
    await memory.close();
  });

  it("keeps memory cursor failures and continuation behavior at the IndexedDB contract boundary", async () => {
    const { memory, durable } = await histories(`filter-impl-08-cursor-parity-${Date.now()}`);
    const runMatrix = async (history: NonNullable<typeof memory>): Promise<void> => {
      const seed = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;
      const selected = seed.value.page.evidence[1]!.identity;
      const cases = [
        { name: "filter", request: {}, altered: { filter: { ...emptyFilter(), text: "alpha" } } },
        { name: "order", request: {}, altered: { page: { order: "NEWEST_FIRST" as const, size: 1 } } },
        { name: "size", request: {}, altered: { page: { order: "OLDEST_FIRST" as const, size: 2 } } },
        { name: "lookup", request: { lookup: selected }, altered: { lookup: seed.value.page.evidence[0]!.identity } },
        { name: "find", request: { find: { text: "alpha" } }, altered: { find: { text: "beta" } } },
        { name: "discoveries", request: { discover: [{ facet: "mode", size: 10 }] }, altered: { discover: [{ facet: "mode", size: 11 }] } }
      ] as const;
      for (const testCase of cases) {
        const first = await history.query!({ at: seed.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), ...testCase.request });
        expect(first.ok, testCase.name).toBe(true);
        if (!first.ok || !first.value.page.nextCursor) continue;
        const continuation = await history.query!({ at: seed.value.readPoint, page: { order: "OLDEST_FIRST", size: 1, cursor: first.value.page.nextCursor }, filter: emptyFilter(), ...testCase.request });
        expect(continuation, `${testCase.name} valid continuation`).toMatchObject({ ok: true, value: { page: { evidence: [{ identity: { eventId: "two" } }] } } });
        const alteredPage = "page" in testCase.altered ? { ...testCase.altered.page, cursor: first.value.page.nextCursor } : { order: "OLDEST_FIRST" as const, size: 1, cursor: first.value.page.nextCursor };
        const altered = await history.query!({ at: seed.value.readPoint, filter: emptyFilter(), ...testCase.altered, page: alteredPage });
        expect(altered, `${testCase.name} altered request`).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
      }
      const malformed = await history.query!({ at: seed.value.readPoint, page: { order: "OLDEST_FIRST", size: 1, cursor: "foreign-cursor" }, filter: emptyFilter() });
      expect(malformed).toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
      await history.offer(event("four", 30_000, "delta")).settled;
      const changedReadPoint = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
      expect(changedReadPoint.ok).toBe(true);
      const oldPoint = await history.query!({ at: seed.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
      expect(oldPoint).toMatchObject({ ok: true });
      await history.clear();
      const cleared = await history.query!({ at: seed.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
      expect(cleared).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    };
    await runMatrix(memory);
    await runMatrix(durable);
    await Promise.all([memory.close(), durable.close()]);
  });
});
