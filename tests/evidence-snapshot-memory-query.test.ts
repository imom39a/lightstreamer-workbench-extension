import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(id: string, sequence: number, timestamp = sequence): LightstreamerEventEnvelope {
  return {
    id,
    timestamp,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: "item-1" },
    update: { isSnapshot: false, fields: { value: sequence } }
  };
}

function emptyFilter(): EvidenceFilter {
  return { revision: 1, text: "", criteria: {}, around: null, unsupported: [] };
}

describe("in-memory Evidence Snapshot reads", () => {
  it("rejects a page size above the documented maximum", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-04-page-bound" });
    const result = await history.query!({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: 101 },
      filter: emptyFilter()
    });

    expect(result).toMatchObject({
      ok: false,
      problem: { code: "QUERY_FAILED", message: "Page size must not exceed 100." }
    });
  });

  it("returns one bounded atomic page with exact totals and a frozen read point", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-04" });
    await history.offer(event("event-1", 1)).settled;
    await history.offer(event("event-2", 2)).settled;
    const result = await history.query!({
      at: "LATEST_COMMITTED",
      page: { order: "NEWEST_FIRST", size: 1 },
      filter: { ...emptyFilter(), text: "item-1" }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.page.evidence).toHaveLength(1);
    expect(result.value.page.evidence[0]?.identity.sequence).toBe(2);
    expect(result.value.totals).toEqual({ matching: 2, inScope: 2 });
    expect(result.value.page.nextCursor).toEqual(expect.any(String));
    const continuation = await history.query!({
      at: result.value.readPoint,
      page: { order: "NEWEST_FIRST", size: 1, cursor: result.value.page.nextCursor! },
      filter: { ...emptyFilter(), text: "item-1" }
    });
    expect(continuation.ok && continuation.value.page.evidence[0]?.identity.sequence).toBe(1);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("excludes pending Capture, keeps Scope external to matching, and fails closed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "filter-impl-04-pending",
      commitBatch: async () => gate
    });
    const receipt = history.offer(event("event-1", 1, 10));
    const pending = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), around: { intervalId: history.status().interval.id, start: 0, end: 1 } } });
    expect(pending.ok && pending.value.totals).toEqual({ matching: 0, inScope: 0 });
    release();
    await receipt.settled;

    const scoped = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), around: { intervalId: history.status().interval.id, start: 0, end: 11 } } });
    expect(scoped.ok && scoped.value.totals).toEqual({ matching: 1, inScope: 1 });
    const unsupported = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: { ...emptyFilter(), unsupported: [{ id: "future", label: "Future", reason: "UNSUPPORTED_FACET" }] } });
    expect(unsupported.ok && unsupported.value.totals).toEqual({ matching: 0, inScope: 0 });
  });

  it("invalidates cleared read points while allowing the terminal final read", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-04-lifecycle" });
    await history.offer(event("event-1", 1)).settled;
    const before = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    await history.clear();
    const stale = await history.query!({ at: before.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(stale).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });

  });

  it("exposes caller-immutable discovery collections", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-04-discoveries" });
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(() => (result.value.discoveries as unknown as { set: (...args: unknown[]) => void }).set("key", {
      state: "UNAVAILABLE",
      facet: "key",
      reason: "DISCOVERY_FAILED",
      values: [],
      distinctTotal: null,
      nextCursor: null,
      baseEvidenceCount: null
    })).toThrow();
  });

  it("qualifies lower-capacity fallback coverage while retaining accepted evidence semantics", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "filter-impl-04-lower-tier",
      capacityTier: "LOWER",
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });
    await history.offer(event("event-1", 1)).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });

    expect(result.ok && result.value.coverage).toBe("LIMITED");
    expect(result.ok && result.value.totals).toEqual({ matching: 1, inScope: 1 });
    expect(result.ok && result.value.page.evidence[0]?.identity.eventId).toBe("event-1");
  });

  it("advances a one-record Retained Range while later Capture continues", async () => {
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "filter-impl-04-terminal-snapshot",
      capacityTier: "LOWER",
      capacity: { maxRetainedCount: 1, retainedWarningCount: 1 }
    });
    await history.offer(event("event-1", 1)).settled;
    const crossing = history.offer(event("event-2", 2));
    await expect(crossing.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "event-2" }
    });

    const final = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(final).toMatchObject({
      ok: true,
      value: {
        totals: { matching: 1, inScope: 1 },
        coverage: "LIMITED",
        page: { evidence: [expect.objectContaining({ identity: expect.objectContaining({ eventId: "event-2", sequence: 2 }) })] }
      }
    });
    expect(history.status()).toMatchObject({ phase: "RUNNING", accepted: 2, retained: 1 });
  });
});
