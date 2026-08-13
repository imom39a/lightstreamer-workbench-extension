import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { typedFacetValue, type EvidenceFilter } from "../src/core/evidence-filter-contract";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function event(sequence: number, key = `key-${sequence}`): LightstreamerEventEnvelope {
  return {
    id: `history-100k-02-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: "item-1" },
    update: { isSnapshot: false, key, fields: { sequence, key } }
  };
}

describe("history-100k-02 bounded IndexedDB continuation", () => {
  it("uses a stable keyset anchor for forward and backward pages", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const history = await createIndexedDbEventHistory({ panelSessionId: `history-100k-02-keyset-${Date.now()}` });
    try {
      for (let sequence = 1; sequence <= 200; sequence += 1) await history.offer(event(sequence)).settled;

      const first = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 5 },
        filter: emptyFilter()
      });
      expect(first.ok).toBe(true);
      if (!first.ok || first.value.page.nextCursor === null) return;

      const cursor = JSON.parse(decodeURIComponent(first.value.page.nextCursor)) as { v?: number; anchor?: { sequence?: number } };
      expect(cursor.v).toBe(3);
      expect(cursor.anchor?.sequence).toBe(5);

      const second = await history.query!({
        at: first.value.readPoint,
        page: { order: "OLDEST_FIRST", size: 5, cursor: first.value.page.nextCursor },
        filter: emptyFilter()
      });
      expect(second.ok && second.value.page.evidence[0]?.identity.sequence).toBe(6);
      expect(second.ok && second.value.telemetry?.evidenceCursorReads).toBeLessThanOrEqual(6);

      const newest = await history.query!({
        at: first.value.readPoint,
        page: { order: "NEWEST_FIRST", size: 5 },
        filter: emptyFilter()
      });
      expect(newest.ok && newest.value.page.evidence[0]?.identity.sequence).toBe(200);
      if (!newest.ok || newest.value.page.nextCursor === null) return;
      const previous = await history.query!({
        at: first.value.readPoint,
        page: { order: "NEWEST_FIRST", size: 5, cursor: newest.value.page.nextCursor },
        filter: emptyFilter()
      });
      expect(previous.ok && previous.value.page.evidence[0]?.identity.sequence).toBe(195);
    } finally {
      await history.close();
    }
  });

  it("cancels exact query work before it can publish a snapshot", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const controller = new AbortController();
    controller.abort();
    const memory = await createMemoryEventHistoryForTests({ panelSessionId: `history-100k-02-cancel-memory-${Date.now()}` });
    const durable = await createIndexedDbEventHistory({ panelSessionId: `history-100k-02-cancel-idb-${Date.now()}` });
    try {
      const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 5 }, filter: emptyFilter(), signal: controller.signal };
      await expect(memory.query!(request)).resolves.toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
      await expect(durable.query!(request)).resolves.toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
    } finally {
      await Promise.all([memory.close(), durable.close()]);
    }
  });

  it("selects one selective posting driver and evaluates compound residual criteria", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const history = await createIndexedDbEventHistory({ panelSessionId: `history-100k-02-driver-${Date.now()}` });
    try {
      for (let sequence = 1; sequence <= 200; sequence += 1) await history.offer(event(sequence, sequence === 137 ? "rare-key" : "common-key")).settled;
      const result = await history.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: {
          ...emptyFilter(),
          criteria: {
            key: { include: [typedFacetValue("key", "string", "rare-key")], exclude: [] },
            mode: { include: [], exclude: [typedFacetValue("mode", "enum", "MERGE")] }
          }
        }
      });
      expect(result).toMatchObject({ ok: true, value: { totals: { matching: 0, inScope: 0 } } });
      expect(result.ok && result.value.telemetry).toMatchObject({ postingDriver: "key", postingDriverCandidateCount: 1, payloadHydrations: 0 });
    } finally {
      await history.close();
    }
  });
});
