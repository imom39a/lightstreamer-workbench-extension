import { describe, expect, it } from "vitest";

import { filterEvents, matchesEventFilters } from "../src/core/event-filter";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

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
});
