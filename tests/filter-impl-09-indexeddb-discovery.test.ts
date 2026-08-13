import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { typedFacetValue, type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { EVIDENCE_FACET_KEYS, FACET_DESCRIPTORS } from "../src/core/evidence-facets";
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

async function mutateFacetAggregate(
  name: string,
  mutate: (aggregate: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(authoritativeEventDatabaseName(name));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("facetAggregates", "readwrite");
      const store = transaction.objectStore("facetAggregates");
      const read = store.getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const aggregate = read.result.find((candidate) => (candidate as Record<string, unknown>).facet === "key") as Record<string, unknown> | undefined;
        if (!aggregate) {
          reject(new Error("No facet aggregate found"));
          return;
        }
        store.put(mutate(aggregate));
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("Facet aggregate mutation aborted."));
      };
    };
  });
}

type RawFacetPosting = Record<string, unknown> & Readonly<{ token: string; sequence: number }>;

async function mutateFacetPosting(
  name: string,
  predicate: (posting: RawFacetPosting) => boolean,
  mutate: (posting: RawFacetPosting) => RawFacetPosting | undefined
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(authoritativeEventDatabaseName(name));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("facetPostings", "readwrite");
      const store = transaction.objectStore("facetPostings");
      const finish = (error?: unknown): void => {
        database.close();
        if (error === undefined) resolve();
        else reject(error);
      };
      const read = store.getAll();
      read.onerror = () => finish(read.error ?? new Error("Reading facet postings failed."));
      read.onsuccess = () => {
        const posting = read.result.find((candidate) => predicate(candidate as RawFacetPosting)) as RawFacetPosting | undefined;
        if (!posting) {
          try { transaction.abort(); } catch { /* the transaction may already be settled */ }
          finish(new Error("No matching facet posting found."));
          return;
        }
        const replacement = mutate(posting);
        if (replacement === undefined) store.delete([posting.token, posting.sequence]);
        else store.put(replacement);
      };
      transaction.oncomplete = () => finish();
      transaction.onerror = () => finish(transaction.error ?? new Error("Facet posting mutation failed."));
      transaction.onabort = () => finish(transaction.error ?? new Error("Facet posting mutation aborted."));
    };
  });
}

describe("filter-impl-09 IndexedDB facet discovery", () => {
  it("matches memory, pages every value, and pins an active zero-count value", async () => {
    const candidates = Array.from({ length: 130 }, (_, index) => event(`event-${index}`, `key-${String(index).padStart(3, "0")}`));
    const { memory, durable } = await setup(`filter-impl-09-pages-${Date.now()}`, candidates);
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 17 }, filter: { ...emptyFilter(), criteria: { key: { include: [typedFacetValue("key", "string", "key-999")], exclude: [] } } }, discover: [{ facet: "key", size: 17 }] };
    const expected = await memory.query!(request);
    const actual = await durable.query!(request);
    expect(expected.ok).toBe(true);
    expect(actual).toMatchObject({ ok: true });
    if (!expected.ok || !actual.ok) throw new Error("Expected memory and IndexedDB queries to succeed");
    expect(actual.value.discoveries.get("key")).toEqual(expected.value.discoveries.get("key"));
    const first = actual.value.discoveries.get("key");
    expect(first).toMatchObject({ state: "AVAILABLE", distinctTotal: 130, baseEvidenceCount: 130 });
    expect(first?.state).toBe("AVAILABLE");
    expect(first?.nextCursor).not.toBeNull();
    if (!first || first.state !== "AVAILABLE" || !first.nextCursor) throw new Error("Expected the first discovery page to have a cursor");
    const seen = new Set(first.values.map((entry) => entry.value.identity));
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page = await durable.query!({ ...request, discover: [{ facet: "key", size: 17, cursor }] });
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error("Expected every discovery page query to succeed");
      const discovery = page.value.discoveries.get("key");
      expect(discovery?.state).toBe("AVAILABLE");
      if (!discovery || discovery.state !== "AVAILABLE") throw new Error("Expected every discovery page to be available");
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
    expect(zero.ok).toBe(true);
    if (!zero.ok) throw new Error("Expected zero-base query to succeed");
    expect(zero.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "ZERO_BASE", baseEvidenceCount: 0 });
    const invalidZeroCursor = await durable.query!({ at: zero.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { client: { include: [typedFacetValue("client", "client", "missing")], exclude: [] } } }, discover: [{ facet: "key", size: 10, cursor: "not-a-cursor" }] });
    expect(invalidZeroCursor).toMatchObject({ ok: true });
    expect(invalidZeroCursor.ok && invalidZeroCursor.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    const noConcrete = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "operation", size: 10 }] });
    expect(noConcrete.ok).toBe(true);
    if (!noConcrete.ok) throw new Error("Expected no-concrete-values query to succeed");
    expect(noConcrete.value.discoveries.get("operation")).toMatchObject({ state: "UNAVAILABLE", reason: "NO_CONCRETE_VALUES", baseEvidenceCount: 1 });

    await durable.close();
  });

  it("fails discovery closed when a posting used by the counterfactual base is corrupt", async () => {
    const name = `filter-impl-09-corrupt-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await mutateFacetPosting(name, (posting) => String(posting.facetIdentity).includes('"key"'), (posting) => ({ ...posting, facetIdentity: JSON.stringify(["v1", "key", "corrupt"]) }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] } } }, discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected corrupt-posting query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("fails discovery closed when a matching posting has the wrong event identity", async () => {
    const name = `filter-impl-09-event-id-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await mutateFacetPosting(name, (posting) => posting.facetIdentity === typedFacetValue("key", "string", "one").identity, (posting) => ({ ...posting, eventId: "event-2" }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), criteria: { mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] } } }, discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected wrong-event-id query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it.each([
    ["forged", "forged-event-id"],
    ["moved", "event-2"]
  ] as const)("fails aggregate discovery closed when a posting has a %s event identity", async (_kind, eventId) => {
    const name = `filter-impl-09-aggregate-event-id-${_kind}-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await mutateFacetPosting(name, (posting) => posting.facetIdentity === typedFacetValue("key", "string", "one").identity, (posting) => ({ ...posting, eventId }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected aggregate event-id query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it.each(["type", "identity-source"] as const)("fails discovery closed when the aggregate %s is corrupt", async (corruption) => {
    const name = "filter-impl-09-aggregate-" + corruption + "-" + Date.now();
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await mutateFacetAggregate(name, (aggregate) => {
      if (corruption === "type") return { ...aggregate, type: "forged-type" };
      return { ...aggregate, facetIdentity: "forged-observation-source" };
    });
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected aggregate-corruption query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("fails discovery closed for same-interval out-of-range postings while preserving base totals", async () => {
    const name = `filter-impl-09-range-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one"), event("event-2", "two")]);
    await mutateFacetPosting(name, (posting) => posting.facetIdentity === typedFacetValue("key", "string", "one").identity, (posting) => ({ ...posting, sequence: 99 }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 2, inScope: 2 }, page: { evidence: [{ identity: { sequence: 1 } }, { identity: { sequence: 2 } }] } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected same-interval range query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
    await durable.close();
  });

  it("ignores valid postings belonging to a genuinely different interval", async () => {
    const name = `filter-impl-09-other-interval-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one")]);
    await mutateFacetPosting(name, (posting) => posting.facetIdentity === typedFacetValue("key", "string", "one").identity, (posting) => ({ ...posting, intervalId: `${name}:interval-0`, sequence: 2, eventId: "prior-interval" }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected cross-interval query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 1 });
    await durable.close();
  });

  it("filters aggregate observations to the requested historical read point", async () => {
    const name = "filter-impl-09-historical-" + Date.now();
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId: name });
    try {
      await durable.offer(event("event-1", "one")).settled;
      const first = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("Expected the first historical read point");
      await durable.offer(event("event-2", "two")).settled;
      const historical = await durable.query!({ at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
      expect(historical).toMatchObject({ ok: true, value: { totals: { matching: 1 }, page: { evidence: [{ identity: { eventId: "event-1" } }] } } });
      expect(historical.ok).toBe(true);
      if (!historical.ok) throw new Error("Expected the historical query to succeed");
      expect(historical.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 1, baseEvidenceCount: 1 });
      const discovery = historical.value.discoveries.get("key");
      if (discovery?.state === "AVAILABLE") {
        expect(discovery.values.map((entry) => entry.value.value)).toEqual(["one"]);
      }
      expect(historical.value.telemetry).toMatchObject({ fullEvidencePayloadHydrations: 0, discoveryEvidencePayloadHydrations: 0 });
    } finally {
      await durable.close();
    }
  });

  it.each(["missing", "malformed"])("fails no-counterfactual discovery closed for %s discovered-facet postings", async (corruption) => {
    const name = `filter-impl-09-no-counterfactual-${corruption}-${Date.now()}`;
    const { durable } = await setup(name, [event("event-1", "one")]);
    await mutateFacetPosting(name, (posting) => posting.facetIdentity === typedFacetValue("key", "string", "one").identity, (posting) => corruption === "missing" ? undefined : ({ ...posting, eventId: "" }));
    const result = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "key", size: 10 }] });
    expect(result).toMatchObject({ ok: true, value: { totals: { matching: 1 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected no-counterfactual query to succeed");
    expect(result.value.discoveries.get("key")).toMatchObject({ state: "UNAVAILABLE", reason: "DISCOVERY_FAILED" });
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
      expect(expectedBase.ok).toBe(true);
      expect(actualBase.ok).toBe(true);
      if (!expectedBase.ok || !actualBase.ok) throw new Error(`Expected catalog ${facet} queries to succeed`);
      expect(actualBase.value.discoveries.get(facet)).toEqual(expectedBase.value.discoveries.get(facet));
      const concrete = expectedBase.value.discoveries.get(facet)?.state === "AVAILABLE" ? expectedBase.value.discoveries.get(facet)?.values[0]?.value : undefined;
      const valueType = FACET_DESCRIPTORS.find((descriptor) => descriptor.key === facet)?.valueType;
      if (!valueType) throw new Error(`Expected a descriptor for catalog facet ${facet}`);
      const values = concrete ? [concrete, typedFacetValue(facet, valueType, "absent")] : [typedFacetValue(facet, valueType, "absent")];
      for (const value of values) {
        const request = { ...base, filter: { ...emptyFilter(), criteria: { [facet]: { include: [value], exclude: [] } } } };
        const expected = await memory.query!(request);
        const actual = await durable.query!(request);
        expect(expected.ok, `catalog ${facet} filtered query for ${value.identity}`).toBe(true);
        expect(actual.ok).toBe(true);
        if (!expected.ok || !actual.ok) throw new Error(`Expected catalog ${facet} filtered query for ${value.identity} to succeed: ${expected.ok ? "memory-ok" : expected.problem.code}/${actual.ok ? "indexeddb-ok" : actual.problem.code}`);
        expect(actual.value.discoveries.get(facet)).toEqual(expected.value.discoveries.get(facet));
      }
    }
    const listener = await durable.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter(), discover: [{ facet: "listener", size: 10 }] });
    expect(listener.ok).toBe(true);
    if (!listener.ok) throw new Error("Expected listener query to succeed");
    expect(listener.value.discoveries.get("listener")).toMatchObject({ state: "AVAILABLE", distinctTotal: 2 });
    await Promise.all([memory.close(), durable.close()]);
  });
});
