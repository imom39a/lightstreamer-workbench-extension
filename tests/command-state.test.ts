import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { reduceCommandState, validateCommandDraftAgainstState } from "../src/core/command-state";

type Fields = NonNullable<LightstreamerEventEnvelope["update"]>["fields"];

function commandEvent(
  id: string,
  overrides: {
    subscriptionId?: string;
    itemName?: string | null;
    itemPosition?: number | null;
    command?: string | null;
    key?: string | null;
    fields?: Fields;
    changedFields?: Fields;
    snapshot?: boolean;
    source?: LightstreamerEventEnvelope["source"];
    synthetic?: boolean;
    kind?: LightstreamerEventEnvelope["kind"];
    mode?: string | null;
    subscriptionItems?: string[];
    subscriptionItemGroup?: string | null;
  } = {}
): LightstreamerEventEnvelope {
  const command: string | null = Object.prototype.hasOwnProperty.call(overrides, "command")
    ? overrides.command ?? null
    : "ADD";
  const key: string | null = Object.prototype.hasOwnProperty.call(overrides, "key")
    ? overrides.key ?? null
    : "alpha";
  const mode = Object.prototype.hasOwnProperty.call(overrides, "mode") ? overrides.mode : "COMMAND";
  const itemName: string | null = Object.prototype.hasOwnProperty.call(overrides, "itemName")
    ? overrides.itemName ?? null
    : "scenario.command";
  const itemPosition: number | null = Object.prototype.hasOwnProperty.call(overrides, "itemPosition")
    ? overrides.itemPosition ?? null
    : 1;
  return {
    id,
    timestamp: 1_700_000_000_000 + Number(id.replace(/\D/g, "") || 0),
    direction: "inbound",
    source: overrides.source ?? "server",
    synthetic: overrides.synthetic ?? false,
    kind: overrides.kind ?? "item-update",
    subscription: {
      id: overrides.subscriptionId ?? "subscription-1",
      mode,
      items: overrides.subscriptionItems,
      itemGroup: overrides.subscriptionItemGroup,
      fields: ["command", "key", "name", "qty", "status"]
    },
    listener: { id: "listener-1" },
    item: {
      name: itemName,
      position: itemPosition
    },
    update: {
      isSnapshot: overrides.snapshot ?? false,
      command,
      key,
      fields: overrides.fields ?? {
        command,
        key,
        name: `${key}-name`,
        qty: "1",
        status: "open"
      },
      changedFields: overrides.changedFields ?? { command, key }
    }
  };
}

function firstItem(state: ReturnType<typeof reduceCommandState>) {
  return state.subscriptions[0].items[0];
}

describe("COMMAND state reducer", () => {
  it("covers CMD-01 and D-08 by grouping current COMMAND rows by subscription, item, and key", () => {
    const state = reduceCommandState([
      commandEvent("event-1", { subscriptionId: "subscription-1", itemName: "scenario.a", key: "alpha" }),
      commandEvent("event-2", {
        subscriptionId: "subscription-1",
        itemName: "scenario.a",
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "5", status: "open" },
        changedFields: { qty: "5" }
      }),
      commandEvent("event-3", { subscriptionId: "subscription-1", itemName: "scenario.b", key: "alpha" }),
      commandEvent("event-4", { subscriptionId: "subscription-2", itemName: "scenario.a", key: "beta" }),
      commandEvent("event-ignored", { kind: "client-status", mode: "COMMAND", key: "ignored" }),
      commandEvent("event-merge", { mode: "MERGE", key: "ignored" })
    ]);

    expect(state.subscriptions.map((group) => group.subscriptionId)).toEqual(["subscription-1", "subscription-2"]);
    expect(state.subscriptions[0].items.map((group) => group.itemId)).toEqual([
      "name:scenario.a",
      "name:scenario.b"
    ]);
    expect(state.subscriptions[0].items[0].activeRows.map((row) => row.key)).toEqual(["alpha"]);
    expect(state.subscriptions[0].items[1].activeRows.map((row) => row.key)).toEqual(["alpha"]);
    expect(state.subscriptions[1].items[0].activeRows.map((row) => row.key)).toEqual(["beta"]);

    const alpha = state.subscriptions[0].items[0].activeRows[0];
    expect(alpha.fields).toEqual({
      command: "UPDATE",
      key: "alpha",
      name: "Alpha",
      qty: "5",
      status: "open"
    });
    expect(alpha.lifecycle).toHaveLength(2);
    expect(alpha.lifecycle[1]).toMatchObject({
      eventId: "event-2",
      originalCommand: "UPDATE",
      effectiveCommand: "UPDATE",
      changedFields: { qty: "5" }
    });
  });

  it("uses prior subscription metadata for listener-captured server updates with id-only subscription payloads", () => {
    const firstServerUpdate = {
      ...commandEvent("event-2", {
        command: "ADD",
        key: "alpha",
        snapshot: true,
        fields: { command: "ADD", key: "alpha", name: "Alpha", qty: "1", status: "snapshot" }
      }),
      subscription: { id: "subscription-1" }
    };
    const secondServerUpdate = {
      ...commandEvent("event-3", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "2", status: "live" },
        changedFields: { qty: "2", status: "live" }
      }),
      subscription: { id: "subscription-1" }
    };

    const state = reduceCommandState([
      commandEvent("event-1", { kind: "subscription-started", mode: "COMMAND" }),
      firstServerUpdate,
      secondServerUpdate
    ]);

    const alpha = firstItem(state).activeRows[0];
    expect(state.subscriptions[0]).toMatchObject({
      subscriptionId: "subscription-1",
      mode: "COMMAND",
      subscription: {
        fields: ["command", "key", "name", "qty", "status"]
      }
    });
    expect(alpha).toMatchObject({
      key: "alpha",
      fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "2", status: "live" },
      origin: { eventId: "event-2", source: "server", synthetic: false, isSnapshot: true },
      latest: { eventId: "event-3", source: "server", synthetic: false, isSnapshot: false }
    });
    expect(alpha.lifecycle.map((entry) => entry.eventId)).toEqual(["event-2", "event-3"]);
  });

  it("resolves unnamed item updates through subscription item metadata before grouping", () => {
    const state = reduceCommandState([
      commandEvent("event-1", {
        subscriptionId: "subscription-2",
        itemName: null,
        itemPosition: 1,
        subscriptionItems: ["orderDetails.STORE_NYC_001", "healthCheck.SYS_MONITOR"],
        key: "order-1"
      }),
      commandEvent("event-2", {
        subscriptionId: "subscription-2",
        itemName: null,
        itemPosition: 2,
        subscriptionItems: ["orderDetails.STORE_NYC_001", "healthCheck.SYS_MONITOR"],
        key: "health-1"
      }),
      commandEvent("event-3", {
        subscriptionId: "subscription-3",
        itemName: null,
        itemPosition: 1,
        subscriptionItems: ["inventorySearch.STORE_NYC_001"],
        key: "inventory-1"
      })
    ]);

    expect(state.subscriptions.map((group) => group.subscriptionId)).toEqual([
      "subscription-2",
      "subscription-3"
    ]);
    expect(state.subscriptions[0].items.map((group) => group.itemName)).toEqual([
      "orderDetails.STORE_NYC_001",
      "healthCheck.SYS_MONITOR"
    ]);
    expect(state.subscriptions[0].items.map((group) => group.itemId)).toEqual([
      "name:orderDetails.STORE_NYC_001",
      "name:healthCheck.SYS_MONITOR"
    ]);
    expect(state.subscriptions[1].items[0]).toMatchObject({
      itemId: "name:inventorySearch.STORE_NYC_001",
      itemName: "inventorySearch.STORE_NYC_001",
      itemPosition: 1
    });
  });

  it("tracks each position independently when a Lightstreamer item group has no item list names", () => {
    const state = reduceCommandState([
      commandEvent("event-1", {
        subscriptionId: "subscription-6",
        itemName: null,
        itemPosition: 1,
        subscriptionItemGroup: "salesActivity.STORE_NYC_001",
        key: "invoice-1",
        fields: {
          command: "ADD",
          key: "invoice-1",
          name: "Invoice",
          qty: "1",
          status: "open"
        }
      }),
      commandEvent("event-2", {
        subscriptionId: "subscription-6",
        itemName: null,
        itemPosition: 2,
        subscriptionItemGroup: "salesActivity.STORE_NYC_001",
        key: "expense-1",
        fields: {
          command: "ADD",
          key: "expense-1",
          name: "Expense",
          qty: "1",
          status: "open"
        }
      })
    ]);

    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0].items).toHaveLength(2);
    expect(state.subscriptions[0].items.map((group) => group.itemId)).toEqual([
      "group:salesActivity.STORE_NYC_001:position:1",
      "group:salesActivity.STORE_NYC_001:position:2"
    ]);
    expect(state.subscriptions[0].items.map((group) => group.itemName)).toEqual([
      "salesActivity.STORE_NYC_001",
      "salesActivity.STORE_NYC_001"
    ]);
    expect(state.subscriptions[0].items.map((group) => group.itemPosition)).toEqual([1, 2]);
    expect(state.subscriptions[0].items.map((group) => group.activeRows.map((row) => row.key))).toEqual([
      ["invoice-1"],
      ["expense-1"]
    ]);
  });

  it("covers CMD-02, D-01, D-06, D-07, and D-11 for ADD, UPDATE, DELETE, snapshot ADD, and lifecycle tombstones", () => {
    const state = reduceCommandState([
      commandEvent("event-1", {
        command: "ADD",
        key: "alpha",
        fields: { command: "ADD", key: "alpha", name: "Alpha", qty: "1", status: "open" }
      }),
      commandEvent("event-2", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "2", status: "open" },
        changedFields: { qty: "2" }
      }),
      commandEvent("event-3", {
        command: "DELETE",
        key: "alpha",
        fields: { command: "DELETE", key: "alpha", name: "Alpha", qty: "2", status: "closed" },
        changedFields: { status: "closed" }
      }),
      commandEvent("event-4", {
        command: "ADD",
        key: "snap-1",
        snapshot: true,
        fields: { command: "ADD", key: "snap-1", name: "Snapshot", qty: "9", status: "open" }
      })
    ]);

    const item = firstItem(state);
    expect(item.activeRows.map((row) => row.key)).toEqual(["snap-1"]);
    expect(item.deletedKeys.map((row) => row.key)).toEqual(["alpha"]);
    expect(item.deletedKeys[0].lifecycle.map((entry) => entry.effectiveCommand)).toEqual([
      "ADD",
      "UPDATE",
      "DELETE"
    ]);
    expect(item.activeRows[0]).toMatchObject({
      key: "snap-1",
      origin: { label: "snapshot", eventId: "event-4" },
      latest: { label: "snapshot", eventId: "event-4" }
    });
  });

  it("covers CMD-03 and D-10 by keeping row origin provenance separate from latest live or synthetic provenance", () => {
    const state = reduceCommandState([
      commandEvent("event-1", {
        command: "ADD",
        key: "alpha",
        snapshot: true,
        fields: { command: "ADD", key: "alpha", name: "Alpha", qty: "1", status: "open" }
      }),
      commandEvent("event-2", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "2", status: "open" },
        changedFields: { qty: "2" }
      }),
      commandEvent("event-3", {
        command: "UPDATE",
        key: "alpha",
        source: "synthetic",
        synthetic: true,
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "3", status: "open" },
        changedFields: { qty: "3" }
      })
    ]);

    const alpha = firstItem(state).activeRows[0];
    expect(alpha.origin).toMatchObject({ label: "snapshot", eventId: "event-1" });
    expect(alpha.latest).toMatchObject({ label: "synthetic-live", eventId: "event-3" });
    expect(alpha.lifecycle.map((entry) => entry.provenance.label)).toEqual([
      "snapshot",
      "live",
      "synthetic-live"
    ]);
  });

  it("covers D-02 through D-05 with diagnostics for malformed and inconsistent COMMAND updates", () => {
    const state = reduceCommandState([
      commandEvent("event-1", { command: null, key: "missing-command" }),
      commandEvent("event-2", { command: "ADD", key: null }),
      commandEvent("event-3", { command: "UPSERT", key: "bad-command" }),
      commandEvent("event-4", { command: "DELETE", key: "ghost" }),
      commandEvent("event-5", {
        command: "UPDATE",
        key: "promoted",
        fields: { command: "UPDATE", key: "promoted", name: "Promoted", qty: "7", status: "open" }
      }),
      commandEvent("event-6", { command: "UPDATE", key: "snap-update", snapshot: true }),
      commandEvent("event-7", { command: "DELETE", key: "snap-delete", snapshot: true })
    ]);

    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-command",
      "missing-key",
      "unsupported-command",
      "unknown-key-delete",
      "unknown-key-update",
      "snapshot-update",
      "snapshot-delete"
    ]);
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-command",
          severity: "error",
          serverLikeMessage: expect.stringContaining("Missing mandatory parameter"),
          explanation: expect.stringContaining("command"),
          suggestion: expect.stringContaining("ADD")
        }),
        expect.objectContaining({
          code: "unknown-key-update",
          severity: "warning",
          serverLikeMessage: expect.stringContaining("Unexpected UPDATE"),
          explanation: expect.stringContaining("missing key"),
          suggestion: expect.stringContaining("ADD")
        }),
        expect.objectContaining({
          code: "snapshot-update",
          severity: "warning",
          explanation: expect.stringContaining("snapshot"),
          suggestion: expect.stringContaining("ADD")
        })
      ])
    );

    const item = firstItem(state);
    expect(item.activeRows.map((row) => row.key)).toEqual(["promoted"]);
    expect(item.activeRows[0].lifecycle[0]).toMatchObject({
      originalCommand: "UPDATE",
      effectiveCommand: "ADD",
      diagnosticCodes: ["unknown-key-update"]
    });
    expect(item.deletedKeys).toEqual([]);
  });
});

describe("COMMAND draft validation", () => {
  it("validates synthetic drafts against current state without auto-correcting command or key values per D-05 and D-14", () => {
    const state = reduceCommandState([
      commandEvent("event-1", { command: "ADD", key: "alpha" }),
      commandEvent("event-2", { command: "DELETE", key: "deleted" })
    ]);

    expect(
      validateCommandDraftAgainstState({ command: "UPDATE", key: "missing", isSnapshot: false }, state, {
        subscriptionId: "subscription-1",
        itemName: "scenario.command"
      }).diagnostics
    ).toEqual([expect.objectContaining({ code: "unknown-key-update", suggestion: expect.stringContaining("ADD") })]);

    expect(
      validateCommandDraftAgainstState({ command: "DELETE", key: "missing", isSnapshot: false }, state, {
        subscriptionId: "subscription-1",
        itemName: "scenario.command"
      }).diagnostics
    ).toEqual([expect.objectContaining({ code: "unknown-key-delete", severity: "warning" })]);

    expect(
      validateCommandDraftAgainstState({ command: null, key: "alpha", isSnapshot: false }, state, {
        subscriptionId: "subscription-1",
        itemName: "scenario.command"
      }).diagnostics
    ).toEqual([expect.objectContaining({ code: "missing-command", field: "command" })]);
  });
});
