import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { typedFacetValue, type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { EVIDENCE_FACET_KEYS } from "../src/core/evidence-facets";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function event(id: string, key: string, mode = "COMMAND"): LightstreamerEventEnvelope {
  return {
    id, timestamp: Number(id.replace(/\D/g, "")) || 1, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id: `client-${id}`, sessionId: `session-${id}` },
    subscription: { id: `subscription-${id}`, mode }, item: { name: "items" },
    listener: { id: `listener-${id}` },
    update: { isSnapshot: false, key, command: "ADD", fields: { key } }
  };
}

async function setup(name: string, candidates: readonly LightstreamerEventEnvelope[]) {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  const memory = await createMemoryEventHistoryForTests({ panelSessionId: name });
  const durable = await createIndexedDbEventHistory({ panelSessionId: name });
  for (const candidate of candidates) {
    await memory.offer(candidate).settled;
    await durable.offer(candidate).settled;
  }
  return { memory, durable };
}

describe("filter-impl-09 IndexedDB facet discovery", () => {
  it("matches memory, pages every value, and pins an active zero-count value", async () => {
    const candidates = Array.from({ length: 130 }, (_, index) => event(`event-${index}`, `key-${String(index).padStart(3, "0")}`));
    const { memory, durable } = await setup(`filter-impl-09-pages-${Date.now()}`, candidates);
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 17 }, filter: { ...emptyFilter(), criteria: { key: { include: [typedFacetValue("key", "string", "key-999")], exclude: [] } } }, discover: [{ facet: "key", size: 17 }] };
    const expected = await memory.query!(request);
    const actual = await durable.query!(request);
    expect(actual).toMatchObject({ ok: true });
    if (!expected.ok || !actual.ok) return;
    expect(actual.value.discoveries.get("key")).toEqual(expected.value.discoveries.get("key"));
    const first = actual.value.discoveries.get("key");
    expect(first).toMatchObject({ state: "AVAILABLE", distinctTotal: 130, baseEvidenceCount: 130 });
    if (!first || first.state !== "AVAILABLE" || !first.nextCursor) return;
    const seen = new Set(first.values.map((entry) => entry.value.identity));
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page = await durable.query!({ ...request, discover: [{ facet: "key", size: 17, cursor }] });
      expect(page.ok).toBe(true);
      if (!page.ok) break;
      const discovery = page.value.discoveries.get("key");
      expect(discovery?.state).toBe("AVAILABLE");
      if (!discovery || discovery.state !== "AVAILABLE") break;
      discovery.values.forEach((entry) => seen.add(entry.value.identity));
      cursor = discovery.nextCursor;
    }
    expect(seen.size).toBe(131);
    expect(seen.has(typedFacetValue("key", "string", "key-999").identity)).toBe(true);
    await Promise.all([memory.close(), durable.close()]);
  }, 20_000);

  it("keeps ZERO_BASE, NO_CONCRETE_VALUES, and discovery failure isolated", async () => {
    const name = `filter-impl-09-states-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one", "MERGE")]);
    const zero = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { client: { include: [typedFacetValue("client", "client", "missing")], exclude: [] } } }, discover: [{ facet: "key", size: 10 }] });
    expect(zero).toMatchObject({ ok: true, value: { totals: { matching: 0 } } });
    if (zero.ok) expect(zero.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "ZERO_BASE", baseEvidenceCount: 0 });
    const noConcrete = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "operation", size: 10 }] });
    expect(noConcrete.ok && noConcrete.value.discoveries.get("operation")).toMatchObject({ state: "UNAVAILABLE", reason: "NO_CONCRETE_VALUES", baseEvidenceCount: 1 });

    await durable.close();
  });

  it("fails discovery closed when a posting used by the counterfactual base is corrupt", async () => {
    const name = `filter-impl-09-corrupt-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(name));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("facetPostings", "readwrite");
        const store = transaction.objectStore("facetPostings");
        const read = store.getAll();
        read.onsuccess = () => {
          const posting = read.result.find((candidate) => String((candidate as Record<string, unknown>).facetIdentity).includes('"key"')) as Record<string, unknown> | undefined;
          if (!posting) { reject(new Error("No posting found")); return; }
          posting.facetIdentity = JSON.stringify(["v1", "key", "corrupt"]);
          store.put(posting);
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] } } }, discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    if (result.ok) expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("fails discovery closed when a matching posting has the wrong event identity", async () => {
    const name = `filter-impl-09-event-id-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(name));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("facetPostings", "readwrite");
        const store = transaction.objectStore("facetPostings");
        const read = store.getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const posting = read.result.find((candidate) => (candidate as Record<string, unknown>).facetIdentity === typedFacetValue("key", "string", "one").identity) as Record<string, unknown> | undefined;
          if (!posting) { reject(new Error("No key posting found")); return; }
          posting.eventId = "event-2";
          store.put(posting);
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] } } }, discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    if (result.ok) expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("fails discovery closed for same-interval out-of-range postings while preserving base totals", async () => {
    const name = `filter-impl-09-range-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(name));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("facetPostings", "readwrite");
        const store = transaction.objectStore("facetPostings");
        const read = store.getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const legitimate = read.result.find((candidate) => (candidate as Record<string, unknown>).facetIdentity === typedFacetValue("key", "string", "one").identity) as Record<string, unknown> | undefined;
          if (!legitimate) { reject(new Error("No key posting found")); return; }
          store.put({ ...legitimate, sequence: 99 });
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2, inScope: 2 }, page: { evidence: [{ identity: { sequence: 1 } }, { identity: { sequence: 2 } }] } } });
    if (result.ok) expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("ignores valid postings belonging to a genuinely different interval", async () => {
    const name = `filter-impl-09-other-interval-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one")]);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(name));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("facetPostings", "readwrite");
        const store = transaction.objectStore("facetPostings");
        const read = store.getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const legitimate = read.result.find((candidate) => (candidate as Record<string, unknown>).facetIdentity === typedFacetValue("key", "string", "one").identity) as Record<string, unknown> | undefined;
          if (!legitimate) { reject(new Error("No key posting found")); return; }
          store.put({ ...legitimate, intervalId: `${name}:interval-0`, sequence: 2, eventId: "prior-interval" });
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result.ok && result.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 1 });
    await durable.close();
  });

  it.each(["missing", "malformed"])("fails no-counterfactual discovery closed for %s discovered-facet postings", async (corruption) => {
    const name = `filter-impl-09-no-counterfactual-${corruption}-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one")]);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(authoritativeEventDatabaseName(name));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("facetPostings", "readwrite");
        const store = transaction.objectStore("facetPostings");
        const read = store.getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const posting = read.result.find((candidate) => (candidate as Record<string, unknown>).facetIdentity === typedFacetValue("key", "string", "one").identity) as Record<string, unknown> | undefined;
          if (!posting) { reject(new Error("No key posting found")); return; }
          if (corruption === "missing") store.delete([posting.token as string, posting.sequence as number]);
          else {
            posting.eventId = "";
            store.put(posting);
          }
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 1 } } });
    if (result.ok) expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("keeps durable discovery parity across the full catalog with typed absent and concrete identities", async () => {
    const name = `filter-impl-09-catalog-${Date.now()}`;
    const candidates = [event("event-1", "one", "COMMAND"), { ...event("event-2", "two", "MERGE"), update: { isSnapshot: true, key: "two", command: "DELETE", fields: { key: "two" } } }];
    const { memory, durable } = await setup(name, candidates);
    for (const facet of EVIDENCE_FACET_KEYS) {
      const base = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: emptyFilter(), discover: [{ facet, size: 10 }] };
      const expectedBase = await memory.query!(base);
      const actualBase = await durable.query!(base);
      expect(actualBase.ok && expectedBase.ok && actualBase.value.discoveries.get(facet)).toEqual(expectedBase.ok && expectedBase.value.discoveries.get(facet));
      if (!expectedBase.ok) continue;
      const concrete = expectedBase.value.discoveries.get(facet)?.state === "AVAILABLE" ? expectedBase.value.discoveries.get(facet)?.values[0]?.value : undefined;
      for (const value of [concrete, typedFacetValue(facet, "string", "absent")]) {
        if (!value) continue;
        const request = { ...base, filter: { ...emptyFilter(), criteria: { [facet]: { include: [value], exclude: [] } } } };
        const expected = await memory.query!(request);
        const actual = await durable.query!(request);
        expect(actual.ok && expected.ok && actual.value.discoveries.get(facet)).toEqual(expected.ok && expected.value.discoveries.get(facet));
      }
    }
    const listener = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "listener", size: 10 }] });
    expect(listener.ok && listener.value.discoveries.get("listener")).toMatchObject({ state: "AVAILABLE", distinctTotal: 2 });
    await Promise.all([memory.close(), durable.close()]);
  });
});
