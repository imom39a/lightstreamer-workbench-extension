import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const event = (index: number): LightstreamerEventEnvelope => ({
  id: `lifetime-${index}`, timestamp: index, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
  client: { id: "client", sessionId: "session" }, subscription: { id: "sub", mode: "COMMAND", items: ["rows"], fields: ["key", "command", "quantity"] },
  item: { name: "rows", position: 1 }, update: { isSnapshot: false, key: "row", command: "ADD", fields: { key: "row", command: "ADD", quantity: index } }
});
const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 2 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } };

async function seed(history: EventHistory, start = 0, count = 512): Promise<void> {
  await Promise.all(Array.from({ length: count }, (_, index) => history.offer(event(start + index)).settled));
}

async function expectFreshQueriesAgreeWithHistory(history: EventHistory): Promise<void> {
  const raw = await history.read({});
  if (!raw.ok) throw new Error(raw.problem.message);
  const identities = raw.value.evidence.map(entry => entry.eventId);
  expect(identities.length).toBeGreaterThan(0);
  for (const order of ["OLDEST_FIRST", "NEWEST_FIRST"] as const) {
    const fresh = await history.query!({ ...request, page: { ...request.page, order } });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) throw new Error(fresh.problem.message);
    expect(fresh.value.evaluation).toBe("COMPLETE");
    expect(fresh.value.totals.matching).toBe(identities.length);
    expect(fresh.value.page.evidence.map(entry => entry.identity.eventId)).toEqual((order === "OLDEST_FIRST" ? identities : [...identities].reverse()).slice(0, 2));
    if (identities.length > 2) {
      const continued = await history.query!({ ...request, at: fresh.value.readPoint, page: { ...request.page, order, cursor: fresh.value.page.nextCursor! } });
      expect(continued.ok && continued.value.page.evidence.map(entry => entry.identity.eventId)).toEqual((order === "OLDEST_FIRST" ? identities : [...identities].reverse()).slice(2, 4));
    }
  }
}

afterEach(() => vi.useRealTimers());

describe("materialized memory query lifetime", () => {
  it("does not repopulate the shared index after Clear and new Capture while yielding", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "query-clear-lifetime" });
    try {
      await seed(history);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const pending = history.query!({ ...request, discover: [{ facet: "key", size: 5 }] });
      // The materializer synchronously reaches its first 256-record yield.
      expect(vi.getTimerCount()).toBe(1);
      expect(await history.clear()).toMatchObject({ ok: true });
      expect(await history.offer(event(999)).settled).toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 513 } });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
      await expectFreshQueriesAgreeWithHistory(history);
    } finally { await history.close(); }
  });

  it("does not restore an evicted prefix when retention advances while yielding", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "query-retention-lifetime", capacity: { maxRetainedCount: 512 } });
    try {
      await seed(history);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const pending = history.query!({ ...request, discover: [{ facet: "key", size: 5 }] });
      expect(vi.getTimerCount()).toBe(1);
      await seed(history, 512);
      const retained = await history.read({});
      expect(retained.ok && retained.value.retainedRange!.first.sequence).toBeGreaterThan(512);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE" } });
      await expectFreshQueriesAgreeWithHistory(history);
    } finally { await history.close(); }
  });

  it("keeps cancellation explicit without changing retained queries", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "query-cancel-lifetime" });
    try {
      await seed(history);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const controller = new AbortController();
      const pending = history.query!({ ...request, discover: [{ facet: "key", size: 5 }], signal: controller.signal });
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
      await expectFreshQueriesAgreeWithHistory(history);
    } finally { await history.close(); }
  });
});
