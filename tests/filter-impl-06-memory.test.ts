import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { revealFilter } from "../src/core/evidence-filter-selection";
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
  it("uses complete token-posting supersets for substring filters and falls back for phrase filters", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-substring-candidates" });
    const mergeCriterion = typedFacetValue("mode", "enum", "MERGE", "MERGE");
    await history.offer(event("scenario-event-1", 1, 1_000)).settled;
    await history.offer(event("scenario-event-1-passive", 2, 2_000)).settled;
    await history.offer({ ...event("scenario-event-1-command", 3, 3_000), subscription: { id: "subscription-command", mode: "COMMAND" } }).settled;
    await history.offer(event("phrase-merge", 4, 4_000, "scenario event phrase")).settled;
    await history.offer({ ...event("phrase-command", 5, 5_000, "scenario event phrase"), subscription: { id: "subscription-phrase-command", mode: "COMMAND" } }).settled;
    await history.offer(event("long-field-record", 6, 6_000, `${"x".repeat(2_049)} canonical-only-long-token`)).settled;

    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const query = (text: string, criteria: EvidenceFilter["criteria"] = {}) => history.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), text, criteria }
    });

    const prefixWithFacet = await query("scenario-event-1", {
      mode: { include: [mergeCriterion], exclude: [] },
    });
    expect(prefixWithFacet).toMatchObject({
      ok: true,
      value: {
        totals: { matching: 2, inScope: 2 },
        page: { evidence: [
          { identity: { eventId: "scenario-event-1" } },
          { identity: { eventId: "scenario-event-1-passive" } },
        ] },
        telemetry: { fullRetainedScan: false },
      },
    });

    const substring = await query("event-1-pass");
    expect(substring).toMatchObject({
      ok: true,
      value: {
        page: { evidence: [{ identity: { eventId: "scenario-event-1-passive" } }] },
        telemetry: { fullRetainedScan: true },
      },
    });

    const initialFind = await history.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: emptyFilter(),
      find: { text: "scenario-event-1" },
    });
    expect(initialFind).toMatchObject({
      ok: true,
      value: {
        find: {
          total: 3,
          current: null,
          matches: [
            { eventId: "scenario-event-1" },
            { eventId: "scenario-event-1-passive" },
            { eventId: "scenario-event-1-command" },
          ],
        },
        telemetry: { fullRetainedScan: false },
      },
    });

    const phraseWithFacet = await query("scenario event phrase", {
      mode: { include: [mergeCriterion], exclude: [] },
    });
    expect(phraseWithFacet).toMatchObject({
      ok: true,
      value: {
        totals: { matching: 1, inScope: 1 },
        page: { evidence: [{ identity: { eventId: "phrase-merge" } }] },
        telemetry: { fullRetainedScan: true },
      },
    });

    const canonicalOnly = await query("canonical-only-long-token");
    expect(canonicalOnly).toMatchObject({
      ok: true,
      value: {
        page: { evidence: [{ identity: { eventId: "long-field-record" } }] },
        telemetry: { fullRetainedScan: true },
      },
    });
  });

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

  it.each([
    ["pageId", { pageId: "forged-page" }],
    ["ownerId", { ownerId: "forged-owner" }]
  ] as const)("rejects an Around anchor forged by changing %s", async (_component, forged) => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: `filter-impl-06-forged-${_component}` });
    await history.offer(event("one", 1, 10_000)).settled;
    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 10 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const retained = base.value.page.evidence[0]!.identity;
    const anchor = { ...retained, ...forged };
    const result = await history.query!({
      at: base.value.readPoint,
      page: { order: "OLDEST_FIRST", size: 10 },
      filter: { ...emptyFilter(), around: { intervalId: retained.intervalId, start: 5_000, end: 15_000, anchor, anchorSequence: retained.sequence, anchorTimestamp: 10_000 } }
    });
    expect(result).toMatchObject({ ok: false, problem: { code: "AROUND_ANCHOR_UNAVAILABLE" } });
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

  it("reveals only actual blockers and leaves satisfied criteria intact", () => {
    const satisfied = criterion("mode", "MERGE");
    const blocked = criterion("kind", "not-item-update");
    const filter = { ...emptyFilter(), text: "needle", criteria: {
      mode: { include: [satisfied], exclude: [] },
      kind: { include: [blocked], exclude: [] }
    } };
    const revealed = revealFilter(filter, [{ id: "free-text", criterion: "free-text" }, { id: `kind:include:${blocked.identity}`, criterion: { id: `kind:include:${blocked.identity}`, facet: "kind", polarity: "include", value: blocked } }]);
    expect(revealed.text).toBe("");
    expect(revealed.criteria.mode?.include[0]?.identity).toBe(satisfied.identity);
    expect(revealed.criteria.kind?.include).toHaveLength(0);
  });

  it("keeps optional sections available in the terminal final snapshot", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-06-terminal", capacityTier: "LOWER", capacity: { maxRetainedCount: 1, retainedWarningCount: 1 } });
    await history.offer(event("one", 1, 1_000, "terminal-needle")).settled;
    await history.offer(event("two", 2, 2_000, "rejected")).settled;
    const result = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), find: { text: "terminal-needle" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toBe("LIMITED");
    expect(result.value.find).toMatchObject({ total: 1, current: null, previous: null, next: null });
  });
});
