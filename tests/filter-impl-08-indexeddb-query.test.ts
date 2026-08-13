import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { type EvidenceFilter, typedFacetValue } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(id: string, timestamp: number, value: string): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "sub-1", mode: "MERGE" }, item: { name: "item-1" },
    update: { isSnapshot: false, fields: { value } }
  };
}

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

async function histories(name: string) {
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
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
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
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
    expect(discovery.ok && discovery.value.discoveries.get("mode")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });
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
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
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
    expect(shortFind).toMatchObject({ ok: true, value: { find: { total: 3 }, telemetry: { shortFindFallback: false, fullRetainedScan: true } } });
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
      telemetry: { aroundIndexReads: 1, aroundCandidates: 2, fullRetainedScan: true, pageBound: 10 }
    } });
    const isolated = await durable.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), around: { intervalId: "other-interval", start: 0, end: 40_000 } }
    });
    expect(isolated).toMatchObject({ ok: true, value: { totals: { matching: 4, inScope: 0 }, page: { evidence: [] } } });
    await durable.close();
  });

  it("fails closed when a selected projection is missing or corrupt", async () => {
    const panelSessionId = `filter-impl-08-projection-failure-${Date.now()}`;
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
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

  it("fails closed when projection count matches but the retained primary-key range does not", async () => {
    const panelSessionId = `filter-impl-08-range-coverage-${Date.now()}`;
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
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
      projections.delete(2);
      projections.put({ ...(second.result as Record<string, unknown>), sequence: 99 });
    };
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    await expect(durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() }))
      .resolves.toMatchObject({ ok: false, problem: { code: "QUERY_FAILED" } });
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
});
