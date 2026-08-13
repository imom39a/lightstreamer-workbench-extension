import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
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
});
