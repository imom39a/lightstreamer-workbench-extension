import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { typedFacetValue, type EvidenceFilter, type EvidenceIdentity } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(id: string, sequence: number, timestamp: number, value = "alpha"): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    kind: "item-update", client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "MERGE" }, item: { name: "item-1" },
    update: { isSnapshot: false, fields: { value } }
  };
}

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });
const criterion = (facet: string, value: string) => typedFacetValue(facet, "string", value, value);

describe("filter-impl-06 memory selection planner", () => {
  it("looks up retained selected Evidence immutably and reports exact canonical blockers", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-lookup" });
    await history.offer(event("one", 1, 1_000, "alpha")).settled;
    const first = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const selected = first.value.page.evidence[0]!.identity;
    const result = await history.query!({
      at: first.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), text: "missing", criteria: { kind: { include: [criterion("kind", "not-item-update")], exclude: [] } } },
      lookup: selected
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.lookup || result.value.lookup.state !== "RETAINED") return;
    expect(result.value.lookup.inScope).toBe(true);
    expect(result.value.lookup.matchesFilter).toBe(false);
    expect(result.value.lookup.blockingCriteria.map((blocker) => blocker.id)).toEqual(["free-text", "kind:include:[\"v1\",\"kind\",\"string\",\"not-item-update\"]"]);
    expect(Object.isFrozen(result.value.lookup.evidence)).toBe(true);
  });

  it("derives and clips an anchored half-open Around range, preserving equal timestamps by sequence", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-around" });
    await history.offer(event("one", 1, 10_000)).settled;
    await history.offer(event("two", 2, 10_000)).settled;
    await history.offer(event("three", 3, 15_000)).settled;
    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const anchor = base.value.page.evidence[1]!.identity;
    const result = await history.query!({
      at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), around: { intervalId: anchor.intervalId, start: 5_000, end: 15_000, anchor, anchorSequence: anchor.sequence, anchorTimestamp: 10_000 } }
    });
    expect(result.ok && result.value.page.evidence.map((record) => record.identity.sequence)).toEqual([1, 2]);
  });

  it("finds independently of Filter and keeps a valid current hit", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-find" });
    await history.offer(event("one", 1, 1_000, "needle")).settled;
    await history.offer(event("two", 2, 2_000, "needle")).settled;
    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { ...emptyFilter(), text: "does-not-match" } });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const currentResult = await history.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(currentResult.ok).toBe(true);
    if (!currentResult.ok) return;
    const current = currentResult.value;
    const currentIdentity = current.page.evidence[0]!.identity;
    const result = await history.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: { ...emptyFilter(), text: "does-not-match" }, find: { text: "needle", current: currentIdentity } });
    expect(result.ok && result.value.totals).toEqual({ matching: 0, inScope: 0 });
    expect(result.ok && result.value.find).toMatchObject({ total: 2, current: { sequence: 1 }, previous: null, next: { sequence: 2 } });
  });

  it("classifies missing and other-interval selection, and preserves terminal/fallback semantics", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-lifecycle", capacityTier: "LOWER", fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
    const missing: EvidenceIdentity = { intervalId: "other", pageId: "other", ownerId: "memory-event-history", sequence: 1, eventId: "gone" };
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), lookup: missing });
    expect(result.ok && result.value.lookup).toMatchObject({ state: "OTHER_INTERVAL", identity: missing });
    expect(result.ok && result.value.coverage).toBe("LIMITED");
    expect(result.ok && result.value.storage).toBe("MEMORY_FALLBACK");
  });

  it("keeps unsupported blockers visible for retained selection and chooses the nearest surviving Find hit", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-minimal-reveal" });
    await history.offer(event("one", 1, 1_000, "needle")).settled;
    await history.offer(event("two", 2, 2_000, "other")).settled;
    await history.offer(event("three", 3, 3_000, "needle")).settled;
    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const selected = base.value.page.evidence[0]!.identity;
    const unsupported = await history.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: { ...emptyFilter(), unsupported: [{ id: "future", label: "Future", reason: "UNSUPPORTED_FACET" }] }, lookup: selected });
    expect(unsupported.ok && unsupported.value.lookup).toMatchObject({ state: "RETAINED", matchesFilter: false, blockingCriteria: [{ id: "future" }] });
    const missingCurrent = { ...selected, sequence: 2, eventId: "retired" };
    const found = await history.query!({ at: base.value.readPoint, page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), find: { text: "needle", current: missingCurrent } });
    expect(found.ok && found.value.find).toMatchObject({ total: 2, current: { sequence: 1 }, next: { sequence: 3 } });
  });

  it("rejects an Around anchor that is not retained in the latched interval", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-stale-anchor" });
    await history.offer(event("one", 1, 1_000)).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { ...emptyFilter(), around: { intervalId: "wrong", start: 0, end: 2_000, anchor: { intervalId: "wrong", pageId: "wrong", ownerId: "memory-event-history", sequence: 1, eventId: "gone" }, anchorSequence: 1, anchorTimestamp: 1_000 } } });
    expect(result).toMatchObject({ ok: false, problem: { code: "AROUND_ANCHOR_UNAVAILABLE" } });
  });
});
