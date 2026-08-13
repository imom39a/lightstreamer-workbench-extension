import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { type EvidenceFilter } from "../src/core/evidence-filter-contract";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function workloadEvent(sequence: number): LightstreamerEventEnvelope {
  return {
    id: `perf-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: { id: "perf-client", sessionId: "perf-session" },
    subscription: { id: "perf-subscription", mode: "COMMAND" },
    item: { name: `item-${sequence % 16}` },
    update: { key: `key-${sequence % 3842}`, command: sequence % 2 ? "ADD" : "DELETE", isSnapshot: false, fields: { value: sequence } }
  };
}

function percentile(samples: readonly number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function emptyFilter(): EvidenceFilter {
  return { revision: 1, text: "", criteria: {}, around: null, unsupported: [] };
}

describe("in-memory Evidence Snapshot performance classes", () => {
  it("keeps recent pages under 50 ms and exact structured reads under 100 ms p95", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "filter-impl-04-performance" });
    const receipts = Array.from({ length: 10_000 }, (_, index) => history.offer(workloadEvent(index + 1)).settled);
    await Promise.all(receipts);
    const empty = emptyFilter();
    const recent: number[] = [];
    const structured: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      let started = performance.now();
      await history.query!({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 50 }, filter: empty });
      recent.push(performance.now() - started);
      started = performance.now();
      await history.query!({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 50 }, filter: { ...empty, criteria: { operation: { include: [{ facet: "operation", type: "enum", value: "ADD", label: "ADD", identity: JSON.stringify(["v1", "operation", "enum", "ADD"]) }], exclude: [] } } } });
      structured.push(performance.now() - started);
    }
    expect(percentile(recent, 0.95)).toBeLessThan(50);
    expect(percentile(structured, 0.95)).toBeLessThan(100);
  });
});
