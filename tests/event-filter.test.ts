import { describe, expect, it } from "vitest";

import { filterEvents, matchesEventFilters } from "../src/core/event-filter";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE,
  EVIDENCE_FILTER_FACETS,
  EVIDENCE_FILTER_LIFECYCLE_CASES,
  EVIDENCE_FILTER_PANEL_SCENARIOS,
  EVIDENCE_FILTER_PANEL_GEOMETRIES,
  MINIMUM_COMMAND_KEY_COUNT,
  createEmptyEvidenceFilter,
  createEvidenceFilterFixture,
  typedFacetValue,
  type EvidenceFilterQueryAdapter,
  type EvidenceSnapshot
} from "../src/core/evidence-filter-contract";
import { EVIDENCE_FILTER_PANEL_SCENARIO_DEFINITIONS } from "./support/panel-scenarios";
import { createReferenceFilterAdapter } from "./support/evidence-filter-reference";

function event(overrides: Partial<LightstreamerEventEnvelope>): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    listener: { id: "listener-1" },
    item: { name: "scenario.snapshot-basic", position: 1 },
    update: {
      isSnapshot: true,
      fields: { command: "ADD", key: "alpha", name: "Alpha", qty: 10 },
      changedFields: { command: "ADD", key: "alpha" },
      command: "ADD",
      key: "alpha"
    },
    raw: { callback: "onItemUpdate" },
    ...overrides
  };
}

describe("event filters", () => {
  it("matches free-text search against a COMMAND key value", () => {
    expect(matchesEventFilters(event({}), { query: "alpha" })).toBe(true);
    expect(matchesEventFilters(event({}), { query: "missing-key" })).toBe(false);
  });

  it("matches field names and field values in free-text search", () => {
    expect(matchesEventFilters(event({}), { query: "qty" })).toBe(true);
    expect(matchesEventFilters(event({}), { query: "Alpha" })).toBe(true);
  });

  it("narrows mode, command, snapshot, synthetic, and kind filters with AND semantics", () => {
    const serverSnapshot = event({});
    const syntheticLive = event({
      id: "event-2",
      source: "synthetic",
      synthetic: true,
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "beta", name: "Beta" },
        changedFields: { name: "Beta" },
        command: "UPDATE",
        key: "beta"
      }
    });

    const visible = filterEvents([serverSnapshot, syntheticLive], {
      mode: "COMMAND",
      command: "ADD",
      snapshot: true,
      synthetic: false,
      kind: "item-update"
    });

    expect(visible).toEqual([serverSnapshot]);
  });

  it("filters by subscription, item, key, and command", () => {
    const matching = event({});
    const other = event({
      id: "event-2",
      subscription: { id: "subscription-2", mode: "COMMAND" },
      item: { name: "scenario.add-update-delete", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "DELETE", key: "beta" },
        changedFields: { command: "DELETE", key: "beta" },
        command: "DELETE",
        key: "beta"
      }
    });

    expect(
      filterEvents([matching, other], {
        subscriptionId: "subscription-1",
        item: "scenario.snapshot-basic",
        key: "alpha",
        command: "ADD"
      })
    ).toEqual([matching]);
  });

  it("defines the collision-safe first-release facet catalog", () => {
    expect(EVIDENCE_FILTER_FACETS).toEqual([
      "client", "session", "subscription", "mode", "kind", "item", "listener", "key", "operation", "phase", "provenance", "observationPath"
    ]);
    const eu = typedFacetValue("item", "item", "sub-command-1:orders.eu", "orders.eu");
    const retired = typedFacetValue("item", "item", "sub-retired-0:orders.eu", "orders.eu");
    expect(eu.label).toBe(retired.label);
    expect(eu.identity).not.toBe(retired.identity);
    const fixture = createEvidenceFilterFixture(3_842);
    expect(fixture.cases.collisions.clients[0]?.label).toBe(fixture.cases.collisions.clients[1]?.label);
    expect(fixture.cases.collisions.clients[0]?.identity).not.toBe(fixture.cases.collisions.clients[1]?.identity);
    expect(fixture.cases.collisions.sessions[0]?.identity).not.toBe(fixture.cases.collisions.sessions[1]?.identity);
    expect(fixture.cases.collisions.listeners[0]?.identity).not.toBe(fixture.cases.collisions.listeners[1]?.identity);
    expect(fixture.cases.collisions.missingItem.identity).not.toBe(fixture.cases.collisions.literalNullItem.identity);
    expect(Object.isFrozen(EVIDENCE_FILTER_FACETS)).toBe(true);
    expect(Object.isFrozen(fixture.records)).toBe(true);
    expect(Object.isFrozen(fixture.records[0]?.identity)).toBe(true);
  });

  it("provides a normal-capacity fixture with all deterministic query cases", () => {
    const fixture = createEvidenceFilterFixture();
    expect(fixture.records).toHaveLength(DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE);
    expect(fixture.distinctCommandKeyCount).toBe(MINIMUM_COMMAND_KEY_COUNT);
    expect(fixture.committedEvidenceBoundary.sequence).toBe(DEFAULT_EVIDENCE_FILTER_FIXTURE_SIZE);
    expect(fixture.retainedRange.first.sequence).toBe(1);
    expect(fixture.cases.includeAndExclude.include.facet).toBe("provenance");
    expect(fixture.cases.freeText).toBe("risk-reviewed");
    expect(fixture.cases.around.end).toBeGreaterThan(fixture.cases.around.start);
    expect(fixture.cases.unsupported.reason).toBe("UNSUPPORTED_FACET");
  });

  it("keeps the atomic query result sections on one explicit read point", () => {
    const query: Parameters<EvidenceFilterQueryAdapter["query"]>[0] = {
      at: "LATEST_COMMITTED",
      page: { order: "NEWEST_FIRST", size: 60 },
      filter: createEmptyEvidenceFilter(),
      discover: [{ facet: "key", size: 100 }],
      find: { text: "risk-reviewed" }
    };
    const snapshot: EvidenceSnapshot = {
      readPoint: {
        interval: { id: "interval-1", ordinal: 1 },
        committedEvidenceBoundary: null,
        retainedRange: null
      },
      page: { evidence: [], nextCursor: null },
      totals: { matching: 0, inScope: 0 },
      discoveries: new Map(),
      lookup: null,
      find: null,
      evaluation: "COMPLETE",
      coverage: "COMPLETE",
      storage: "INDEXED_DB"
    };
    expect(query.at).toBe("LATEST_COMMITTED");
    expect(snapshot.readPoint.interval.id).toBe("interval-1");
    expect(snapshot.page.nextCursor).toBeNull();
    expect(snapshot.totals).toEqual({ matching: 0, inScope: 0 });
  });

  it("represents fail-closed unsupported filters, empty conflicts, and lifecycle read points", () => {
    const fixture = createEvidenceFilterFixture(MINIMUM_COMMAND_KEY_COUNT);
    const empty = createEmptyEvidenceFilter();
    expect(empty.unsupported).toEqual([]);
    expect(fixture.cases.validZeroResult.left.identity).not.toBe(fixture.cases.validZeroResult.right.identity);
    expect(fixture.interval).toEqual({ id: "filter-contract-interval-1", ordinal: 1 });
    expect(fixture.retainedRange.last.sequence).toBe(MINIMUM_COMMAND_KEY_COUNT);
    expect(["HISTORY_INTERVAL_UNAVAILABLE", "READ_POINT_UNAVAILABLE", "QUERY_FAILED"]).toContain("HISTORY_INTERVAL_UNAVAILABLE");
    expect(EVIDENCE_FILTER_LIFECYCLE_CASES).toEqual([
      "clear-invalidates-stale-read-point",
      "terminal-history-final-boundary",
      "lower-capacity-memory-fallback",
      "limited-observation-coverage",
      "concurrent-committed-capture"
    ]);
    expect(EVIDENCE_FILTER_PANEL_SCENARIOS).toHaveLength(9);
    expect(EVIDENCE_FILTER_PANEL_SCENARIOS).toContain("hidden-selection");
    expect(EVIDENCE_FILTER_PANEL_SCENARIOS).toContain("high-volume-command-keys");
    expect(EVIDENCE_FILTER_PANEL_GEOMETRIES.map(({ name }) => name)).toEqual(["compact", "normal", "shallow", "wide"]);
    expect(EVIDENCE_FILTER_PANEL_SCENARIO_DEFINITIONS).toHaveLength(EVIDENCE_FILTER_PANEL_SCENARIOS.length);
    expect(EVIDENCE_FILTER_PANEL_SCENARIO_DEFINITIONS.every((scenario) => scenario.themes.includes("Dark") && scenario.themes.includes("Light"))).toBe(true);
  });
});
