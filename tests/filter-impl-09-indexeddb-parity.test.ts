import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import type { EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { type EvidenceFilter, type EvidenceQueryRequest, typedFacetValue } from "../src/core/evidence-filter-contract";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function event(id: string, timestamp: number, key: string, options: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client-collision", sessionId: `session-${id === "one" ? "a" : "b"}` },
    subscription: { id: "subscription-collision", mode: "COMMAND" }, item: { name: "shared-item" }, listener: { id: id === "wire" ? "listener-wire" : "listener-shared" },
    update: { isSnapshot: false, key, command: id === "delete" ? "DELETE" : "ADD", fields: { key, text: `${id}-needle` } }, ...options
  };
}

function publicResult(snapshot: any) {
  return {
    page: snapshot.page, totals: snapshot.totals, discoveries: [...snapshot.discoveries.entries()], lookup: snapshot.lookup,
    find: snapshot.find, evaluation: snapshot.evaluation, coverage: snapshot.coverage
  };
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

describe("filter-impl-09 durable public-result parity", () => {
  it("matches the memory oracle for combined criteria, text, Around, Scope, collisions, and provenance facets", async () => {
    const { memory, durable } = await paired(`filter-impl-09-parity-${Date.now()}`);
    try {
      const same = typedFacetValue("key", "string", "same");
      const other = typedFacetValue("key", "string", "other");
      const requests: EvidenceQueryRequest[] = [
        { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: { ...emptyFilter(), criteria: { key: { include: [same, other], exclude: [other] } } }, discover: [{ facet: "key", size: 10 }] },
        { at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST" as const, size: 10 }, filter: { ...emptyFilter(), text: "wire", criteria: { provenance: { include: [typedFacetValue("provenance", "enum", "SERVER")], exclude: [] }, observationPath: { include: [typedFacetValue("observationPath", "enum", "WIRE")], exclude: [] } } }, discover: [{ facet: "provenance", size: 10 }] },
        { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: { ...emptyFilter(), around: { intervalId: "placeholder", start: 20, end: 51 } }, discover: [{ facet: "listener", size: 10 }] }
      ];
      const point = (await memory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() }));
      expect(point.ok).toBe(true);
      if (!point.ok) throw new Error("Expected paired history read point");
      requests[2] = { ...requests[2], filter: { ...requests[2].filter, around: { ...requests[2].filter.around!, intervalId: point.value.readPoint.interval.id } } };
      for (const request of requests) {
        const expected = await memory.query!({ ...request, at: point.value.readPoint });
        const actual = await durable.query!({ ...request, at: point.value.readPoint });
        expect(actual.ok).toBe(expected.ok);
        if (!expected.ok || !actual.ok) throw new Error("Expected paired query success");
        expect(publicResult(actual.value)).toEqual(publicResult(expected.value));
      }
    } finally { await Promise.all([memory.close(), durable.close()]); }
  });

  it("preserves unsupported/read-point, Clear invalidation, terminal final reads, and lower fallback semantics", async () => {
    const { memory, durable } = await paired(`filter-impl-09-lifecycle-${Date.now()}`);
    const first = await memory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected initial read point");
    const unsupported = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), unsupported: [{ id: "future", label: "Future", reason: "UNSUPPORTED_FACET" }] }, discover: [{ facet: "key", size: 10 }] });
    expect(unsupported).toMatchObject({ ok: true, value: { evaluation: "UNSUPPORTED_FILTER", totals: { matching: 0, inScope: 0 } } });
    expect(unsupported.ok && unsupported.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "UNSUPPORTED_AT_READ_POINT" });
    await Promise.all([memory.clear(), durable.clear()]);
    expect(await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() })).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
    await Promise.all([memory.close(), durable.close()]);

    const lowerName = `filter-impl-09-lower-${Date.now()}`;
    const lowerMemory = await createMemoryEventHistoryForTests({ panelSessionId: lowerName, capacityTier: "LOWER", capacity: { maxRetainedCount: 3 } });
    const lowerDurable = await createIndexedDbEventHistory({ panelSessionId: lowerName, capacityTier: "LOWER", capacity: { maxRetainedCount: 3 } });
    try {
      const lowerCandidates = [event("a", 1, "a"), event("b", 2, "b"), event("c", 3, "c")];
      await Promise.all([offerBatch(lowerMemory, lowerCandidates), offerBatch(lowerDurable, lowerCandidates)]);
      const expected = await lowerMemory.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
      const actual = await lowerDurable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
      expect(actual.ok).toBe(true); expect(expected.ok).toBe(true);
      if (actual.ok && expected.ok) expect(publicResult(actual.value)).toEqual(publicResult(expected.value));
      const fallback = await createMemoryEventHistoryForTests({ panelSessionId: `filter-impl-09-fallback-${Date.now()}`, capacityTier: "LOWER", fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
      const fallbackResult = await fallback.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
      expect(fallbackResult).toMatchObject({ ok: true, value: { storage: "MEMORY_FALLBACK", coverage: "LIMITED" } });
      await fallback.close();
    } finally { await Promise.all([lowerMemory.close(), lowerDurable.close()]); }
  });
});
