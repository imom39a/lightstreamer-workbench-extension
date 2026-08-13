import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(sequence: number): LightstreamerEventEnvelope {
  return {
    id: `filter-06-perf-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: { id: "filter-06-client", sessionId: "filter-06-session" },
    subscription: { id: "filter-06-subscription", mode: "COMMAND" },
    item: { name: `item-${sequence % 32}` },
    update: {
      key: `key-${sequence % 3842}`,
      command: sequence % 2 ? "ADD" : "DELETE",
      isSnapshot: false,
      fields: { value: sequence % 17 === 0 ? "needle" : `value-${sequence}` }
    }
  };
}

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function p95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

describe("filter-impl-06 residual query performance", () => {
  it.each(["NORMAL", "LOWER"] as const)("keeps Around, residual free text, selected lookup, and complete Find under 500 ms p95 at the %s tier", async (capacityTier) => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: `filter-impl-06-perf-${capacityTier}`, capacityTier });
    await Promise.all(Array.from({ length: 10_000 }, (_, index) => history.offer(event(index + 1)).settled));
    const base = await history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter() });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const retained = base.value.page.evidence[0]!.identity;
    const around = { intervalId: retained.intervalId, start: 0, end: 10_000, anchor: retained, anchorSequence: retained.sequence, anchorTimestamp: 1 };
    const current = base.value.page.evidence[0]!.identity;
    const samples: Record<string, number[]> = { around: [], text: [], lookup: [], find: [] };

    for (let sample = 0; sample < 10; sample += 1) {
      const measure = async (name: keyof typeof samples, request: Parameters<NonNullable<typeof history.query>>[0]) => {
        const started = performance.now();
        const result = await history.query!(request);
        samples[name]!.push(performance.now() - started);
        expect(result.ok).toBe(true);
      };
      await measure("around", { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: { ...emptyFilter(), around } });
      await measure("text", { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: { ...emptyFilter(), text: "needle" } });
      await measure("lookup", { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { ...emptyFilter(), text: "missing" }, lookup: retained });
      await measure("find", { at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: emptyFilter(), find: { text: "needle", current } });
    }

    for (const [operation, durations] of Object.entries(samples)) {
      expect(p95(durations), `${capacityTier} ${operation} p95`).toBeLessThanOrEqual(500);
    }
  }, 30_000);
});
