import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  EVENT_HISTORY_SHAPES,
  ISSUE_16_TOTAL_EVENTS,
  TIMELINE_SUSTAINED_EVENTS_PER_SECOND,
  createEventHistoryWorkloadEvent,
  representativeEventHistoryShapeFacts,
  utf8JsonBytes
} from "../benchmarks/event-history-workloads";

describe("Event History benchmark workloads", () => {
  const projectRoot =
    basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();

  it("uses deterministic, distinct, persistable representative event shapes", () => {
    const events = EVENT_HISTORY_SHAPES.map((shape) =>
      createEventHistoryWorkloadEvent(shape, 42, "deterministic")
    );

    expect(events.map((event) => event.id)).toEqual([
      "deterministic-small-lifecycle-42",
      "deterministic-ordinary-item-update-42",
      "deterministic-large-json-rich-42"
    ]);
    expect(events.map(utf8JsonBytes)).toEqual([318, 810, 13_128]);
    expect(events[0]?.kind).toBe("client-status");
    expect(events[1]?.update?.changedFields).toMatchObject({
      qty: "27",
      status: "live-update",
      version: "43"
    });
    expect(events[2]?.update?.jsonPatches?.["/order/metrics"]).toBeTruthy();
  });

  it("records a meaningful size range without application data", () => {
    const facts = representativeEventHistoryShapeFacts();
    const sizes = facts.map((fact) => fact.persistedJsonBytes);

    expect(facts.map((fact) => fact.id)).toEqual([...EVENT_HISTORY_SHAPES]);
    expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
    expect(sizes[2]).toBeGreaterThan(4_000);
    expect(sizes).toEqual([315, 807, 13_125]);
    expect(facts.map((fact) => fact.searchTokenCount)).toEqual([23, 50, 141]);
    expect(facts.map((fact) => fact.indexedDbWritesPerEvent)).toEqual([25, 52, 143]);
    expect(ISSUE_16_TOTAL_EVENTS).toBe(1_692);
  });

  it("keeps fixture and deterministic Timeline workload anchors tied to their sources", async () => {
    const fixture = await readFile(
      resolve(projectRoot, "fixtures/lightstreamer/pages/fixture-client.js"),
      "utf8"
    );
    const groupsMatch = fixture.match(/const ISSUE_16_GROUPS = (\[[\s\S]*?\]);/u);
    expect(groupsMatch?.[1]).toBeTruthy();
    const groups = Function(`"use strict"; return (${groupsMatch?.[1]});`)() as Array<{
      expectedEvents: number;
    }>;
    expect(groups.reduce((total, group) => total + group.expectedEvents, 0)).toBe(
      ISSUE_16_TOTAL_EVENTS
    );

    const scenarios = await readFile(
      resolve(projectRoot, "tests/support/panel-scenarios.ts"),
      "utf8"
    );
    expect(scenarios).toMatch(/intervalMs:\s*20/u);
    expect(TIMELINE_SUSTAINED_EVENTS_PER_SECOND).toBe(50);
  });
});
