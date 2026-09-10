import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  COMMAND_RECENT_LIFECYCLE_LIMIT,
  createCommandStateIndex,
  createCommandStateProjections,
  reduceCommandState,
  inspectCommandState,
  validateCommandDraftAgainstState
} from "../src/core/command-state";

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
  it("keeps observed server and local effective COMMAND projections distinct", () => {
    const projections = createCommandStateProjections();
    projections.apply(
      commandEvent("event-1", {
        key: "alpha",
        fields: { command: "ADD", key: "alpha", name: "Alpha", qty: "1", status: "open" }
      })
    );
    projections.apply(
      commandEvent("event-2", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "9", status: "local" },
        changedFields: { qty: "9", status: "local" },
        source: "synthetic",
        synthetic: true
      })
    );

    expect(
      firstItem(projections.snapshot("observed-server")).activeRows[0].fields
    ).toMatchObject({ qty: "1", status: "open" });
    expect(
      firstItem(projections.snapshot("local-effective")).activeRows[0].fields
    ).toMatchObject({ qty: "9", status: "local" });

    projections.apply(
      commandEvent("event-3", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "2", status: "server" },
        changedFields: { qty: "2", status: "server" }
      })
    );

    for (const projection of ["observed-server", "local-effective"] as const) {
      expect(firstItem(projections.snapshot(projection)).activeRows[0].fields).toMatchObject({
        qty: "2",
        status: "server"
      });
    }

    projections.clear();
    expect(projections.snapshot("observed-server").subscriptions).toEqual([]);
    expect(projections.snapshot("local-effective").subscriptions).toEqual([]);
  });

  it("inspects exact key and field state with provenance without coercing ambiguous Server null", () => {
    const projections = createCommandStateProjections();
    projections.apply(commandEvent("server-null", {
      key: "alpha",
      fields: { command: "ADD", key: "alpha", note: null },
      changedFields: { command: "ADD", key: "alpha", note: null }
    }));
    expect(projections.inspect("local-effective", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "alpha", field: "note" }))
      .toMatchObject({ state: "ambiguous-server-null", provenance: { eventId: "server-null", source: "server" } });
    expect(projections.inspect("local-effective", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "alpha", field: "missing" }))
      .toMatchObject({ state: "field-absent", provenance: { eventId: "server-null" } });

    projections.apply(commandEvent("unchanged-null", {
      command: "UPDATE", key: "alpha",
      fields: { command: "UPDATE", key: "alpha", note: null, qty: "2" }, changedFields: { qty: "2" }
    }));
    expect(projections.inspect("local-effective", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "alpha", field: "note" }))
      .toMatchObject({ state: "ambiguous-server-null", provenance: { eventId: "server-null", source: "server" } });

    projections.apply(commandEvent("local-null", {
      command: "UPDATE", key: "alpha",
      fields: { command: "UPDATE", key: "alpha", note: null }, changedFields: { note: null },
      source: "synthetic", synthetic: true
    }));
    expect(projections.inspect("local-effective", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "alpha", field: "note" }))
      .toMatchObject({ state: "concrete", value: null, provenance: { eventId: "local-null", source: "synthetic" } });
    expect(projections.inspect("observed-server", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "alpha" }))
      .toMatchObject({ state: "key-present" });
    expect(projections.inspect("local-effective", { subscriptionId: "subscription-1", item: { name: "scenario.command", position: 1 }, key: "missing" }))
      .toMatchObject({ state: "key-absent" });
  });

  it("deduplicates a successfully projected Local Injection when retained history echoes it", () => {
    const projections = createCommandStateProjections();
    const server = commandEvent("event-dedupe-server", {
      key: "alpha",
      fields: { command: "ADD", key: "alpha", qty: "1" }
    });
    const local = commandEvent("event-dedupe-local", {
      command: "UPDATE",
      key: "alpha",
      fields: { command: "UPDATE", key: "alpha", qty: "9" },
      changedFields: { qty: "9" },
      source: "synthetic",
      synthetic: true
    });

    projections.apply(server);
    projections.apply(local);
    projections.apply(local);

    const row = firstItem(projections.snapshot("local-effective")).activeRows[0];
    expect(row.fields).toMatchObject({ qty: "9" });
    expect(row.lifecycle.map(({ eventId }) => eventId)).toEqual([
      "event-dedupe-server",
      "event-dedupe-local"
    ]);
    expect(firstItem(projections.snapshot("observed-server")).activeRows[0].fields).toMatchObject({
      qty: "1"
    });
  });

  it("retains only a bounded recent lifecycle window while preserving both current projections", () => {
    const projections = createCommandStateProjections();
    const payload = "x".repeat(13_125);
    for (let index = 0; index < 10_000; index += 1) {
      projections.apply(commandEvent(`shared-server-${index}`, {
        command: index === 0 ? "ADD" : "UPDATE",
        key: "alpha",
        fields: { command: index === 0 ? "ADD" : "UPDATE", key: "alpha", payload },
        changedFields: { payload }
      }));
    }

    const observedBeforeLocal = firstItem(projections.snapshot("observed-server")).activeRows[0];
    const localBeforeLocal = firstItem(projections.snapshot("local-effective")).activeRows[0];
    expect(observedBeforeLocal.lifecycle).toHaveLength(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(observedBeforeLocal.lifecycleTotal).toBe(10_000);
    expect(observedBeforeLocal.lifecycleHasOlder).toBe(true);
    expect(localBeforeLocal.lifecycle).toHaveLength(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(localBeforeLocal.lifecycleTotal).toBe(10_000);
    expect(localBeforeLocal.lifecycle[0]?.eventId).toBe(
      `shared-server-${10_000 - COMMAND_RECENT_LIFECYCLE_LIMIT}`
    );
    expect(localBeforeLocal.lifecycle.at(-1)).toEqual(observedBeforeLocal.lifecycle.at(-1));
    expect(Object.isFrozen(observedBeforeLocal.lifecycle[0])).toBe(true);

    projections.apply(commandEvent("shared-local", {
      command: "UPDATE",
      key: "alpha",
      fields: { command: "UPDATE", key: "alpha", payload: "local" },
      changedFields: { payload: "local" },
      source: "synthetic",
      synthetic: true
    }));

    const observedAfterLocal = firstItem(projections.snapshot("observed-server")).activeRows[0];
    const localAfterLocal = firstItem(projections.snapshot("local-effective")).activeRows[0];
    expect(observedAfterLocal.lifecycle).toHaveLength(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(observedAfterLocal.fields.payload).toBe(payload);
    expect(localAfterLocal.lifecycle).toHaveLength(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(localAfterLocal.lifecycleTotal).toBe(10_001);
    expect(localAfterLocal.fields.payload).toBe("local");
    expect(localAfterLocal.lifecycle[0]?.eventId).toBe(
      `shared-server-${10_001 - COMMAND_RECENT_LIFECYCLE_LIMIT}`
    );
    expect(localAfterLocal.lifecycle.at(-1)?.eventId).toBe("shared-local");
  });

  it("keeps 100,000 hot-key updates bounded without weakening current fields or provenance", () => {
    const projections = createCommandStateProjections();
    const updates = 100_000;
    let rollingDigest = 0;

    for (let index = 0; index < updates; index += 1) {
      const command = index === 0 ? "ADD" : "UPDATE";
      const eventId = `hot-${index}`;
      const value = String(index);
      rollingDigest = (rollingDigest * 31 + index) % 1_000_000_007;
      projections.apply(commandEvent(eventId, {
        command,
        key: "hot-key",
        fields: { command, key: "hot-key", value },
        changedFields: { value }
      }));
    }

    const maybeGc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    maybeGc?.();
    const postGcHeapBytes = typeof process !== "undefined" ? process.memoryUsage().heapUsed : null;
    const snapshotStartedAt = performance.now();
    const observed = firstItem(projections.snapshot("observed-server"));
    const local = firstItem(projections.snapshot("local-effective"));
    const snapshotPublicationMs = performance.now() - snapshotStartedAt;
    console.info(JSON.stringify({
      workload: "history-100k-05-hot-key",
      updates,
      recentLifecycleLimit: COMMAND_RECENT_LIFECYCLE_LIMIT,
      observedLifecycleLength: observed.activeRows[0]?.lifecycle.length ?? 0,
      observedLifecycleTotal: observed.activeRows[0]?.lifecycleTotal ?? 0,
      postGcHeapBytes,
      snapshotPublicationMs,
      gcAvailable: maybeGc !== undefined
    }));
    expect(rollingDigest).toBe(282_060_600);
    expect(snapshotPublicationMs).toBeLessThan(1_000);
    expect(observed.activeRows[0]).toMatchObject({
      key: "hot-key",
      fields: { value: "99999" },
      latest: { eventId: "hot-99999", source: "server", synthetic: false }
    });
    expect(local.activeRows[0]).toEqual(observed.activeRows[0]);
    expect(observed.activeRows[0]?.lifecycle.length).toBe(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(observed.activeRows[0]?.lifecycleTotal).toBe(updates);
    expect(observed.activeRows[0]?.lifecycleHasOlder).toBe(true);
    expect(observed.lifecycle.length).toBe(COMMAND_RECENT_LIFECYCLE_LIMIT);
    expect(observed.lifecycleTotal).toBe(updates);
    expect(observed.lifecycleHasOlder).toBe(true);
  });

  it("keeps high key churn proportional to active identities and the bounded recent policy", () => {
    const index = createCommandStateIndex();
    const keyCount = 10_000;
    for (let indexValue = 0; indexValue < keyCount; indexValue += 1) {
      index.apply(commandEvent(`churn-add-${indexValue}`, {
        command: "ADD",
        key: `key-${indexValue}`,
        fields: { command: "ADD", key: `key-${indexValue}`, value: indexValue }
      }));
    }
    for (let indexValue = 0; indexValue < keyCount; indexValue += 2) {
      index.apply(commandEvent(`churn-delete-${indexValue}`, {
        command: "DELETE",
        key: `key-${indexValue}`,
        fields: { command: "DELETE", key: `key-${indexValue}` }
      }));
    }

    const item = firstItem(index.snapshot());
    expect(item.activeRows).toHaveLength(keyCount / 2);
    expect(item.deletedKeys).toHaveLength(keyCount / 2);
    expect(item.activeRows.every((row) => row.lifecycle.length <= COMMAND_RECENT_LIFECYCLE_LIMIT)).toBe(true);
    expect(item.deletedKeys.every((row) => row.lifecycle.length <= COMMAND_RECENT_LIFECYCLE_LIMIT)).toBe(true);
    expect(item.lifecycleTotal).toBe(keyCount + keyCount / 2);
    expect(item.lifecycleHasOlder).toBe(true);
  });

  it("publishes cache-stable bounded snapshots and rebuilds both projections equivalently", () => {
    const events = [
      commandEvent("rebuild-add", { command: "ADD", key: "reused", fields: { command: "ADD", key: "reused", value: "one" } }),
      commandEvent("rebuild-update", { command: "UPDATE", key: "reused", fields: { command: "UPDATE", key: "reused", value: "two" }, changedFields: { value: "two" } }),
      commandEvent("rebuild-delete", { command: "DELETE", key: "reused", fields: { command: "DELETE", key: "reused" } }),
      commandEvent("rebuild-lost-update", { command: "UPDATE", key: "lost", fields: { command: "UPDATE", key: "lost", value: "promoted" } }),
      commandEvent("rebuild-readd", { command: "ADD", key: "reused", fields: { command: "ADD", key: "reused", value: "new-generation" } }),
      commandEvent("rebuild-local", { command: "UPDATE", key: "reused", fields: { command: "UPDATE", key: "reused", value: "local" }, source: "synthetic", synthetic: true })
    ];
    const projections = createCommandStateProjections();
    const index = createCommandStateIndex();
    for (const event of events) {
      projections.apply(event);
      index.apply(event);
    }

    const observedBefore = projections.snapshot("observed-server");
    expect(projections.snapshot("observed-server")).toBe(observedBefore);
    expect(projections.snapshot("local-effective")).toBe(projections.snapshot("local-effective"));
    expect(projections.snapshot("local-effective")).toEqual(index.snapshot());
    expect(observedBefore).toEqual(reduceCommandState(events.filter((event) => !event.synthetic)));
    expect(projections.snapshot("local-effective")).toEqual(reduceCommandState(events));
    const observedReused = firstItem(observedBefore).activeRows.find((row) => row.key === "reused");
    const localReused = firstItem(projections.snapshot("local-effective")).activeRows.find((row) => row.key === "reused");
    expect(observedReused).toMatchObject({
      key: "reused",
      fields: { value: "new-generation" },
      origin: { eventId: "rebuild-readd" }
    });
    expect(localReused?.fields.value).toBe("local");

    projections.clear();
    expect(projections.snapshot("observed-server").subscriptions).toEqual([]);
    expect(projections.snapshot("local-effective").subscriptions).toEqual([]);
  });

  it("matches incremental COMMAND indexing with full reduction", () => {
    const events = [
      commandEvent("event-1", { key: "alpha", snapshot: true }),
      commandEvent("event-2", {
        command: "UPDATE",
        key: "alpha",
        fields: { command: "UPDATE", key: "alpha", name: "Alpha", qty: "5", status: "open" },
        changedFields: { qty: "5" }
      }),
      commandEvent("event-3", { command: "DELETE", key: "alpha", changedFields: { status: "closed" } }),
      commandEvent("event-4", { command: "UPDATE", key: "missing" }),
      commandEvent("event-5", { command: null, key: "missing-command" })
    ];

    const index = createCommandStateIndex();
    for (const event of events) {
      index.apply(event);
    }

    expect(index.snapshot()).toEqual(reduceCommandState(events));
  });

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

  it("materializes active COMMAND subscription items before their first update", () => {
    const started = commandEvent("event-1", {
      kind: "subscription-started",
      subscriptionId: "subscription-19",
      subscriptionItems: ["quiet.orders", "quiet.inventory"]
    });
    started.item = undefined;
    started.update = undefined;

    const state = reduceCommandState([started]);

    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({
      subscriptionId: "subscription-19",
      mode: "COMMAND"
    });
    expect(
      state.subscriptions[0].items.map((item) => ({
        itemName: item.itemName,
        itemPosition: item.itemPosition,
        activeRows: item.activeRows
      }))
    ).toEqual([
      { itemName: "quiet.orders", itemPosition: 1, activeRows: [] },
      { itemName: "quiet.inventory", itemPosition: 2, activeRows: [] }
    ]);
  });

  it("does not materialize a COMMAND subscription before it starts", () => {
    const created = commandEvent("event-1", {
      kind: "subscription-created",
      subscriptionId: "subscription-19",
      subscriptionItems: ["quiet.orders"]
    });
    created.item = undefined;
    created.update = undefined;

    expect(reduceCommandState([created]).subscriptions).toEqual([]);

    const started = {
      ...created,
      id: "event-2",
      kind: "subscription-started" as const
    };
    expect(reduceCommandState([created, started]).subscriptions).toHaveLength(1);
  });

  it.each(["subscription-ended", "subscription-error"] as const)(
    "removes a COMMAND subscription after %s",
    (terminalKind) => {
      const started = commandEvent("event-1", {
        kind: "subscription-started",
        subscriptionId: "subscription-19",
        subscriptionItems: ["quiet.orders"]
      });
      const terminal = commandEvent("event-2", {
        kind: terminalKind,
        subscriptionId: "subscription-19"
      });
      started.item = undefined;
      started.update = undefined;
      terminal.item = undefined;
      terminal.update = undefined;

      expect(reduceCommandState([started, terminal]).subscriptions).toEqual([]);
    }
  );

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

  it("uses the same unambiguous item identity for draft validation and Scenario inspection", () => {
    const state = reduceCommandState([
      commandEvent("event-1", { itemName: null, itemPosition: 1, subscriptionItemGroup: "orders-group", key: "first" }),
      commandEvent("event-2", { itemName: null, itemPosition: 2, subscriptionItemGroup: "orders-group", key: "second" }),
      commandEvent("event-3", { subscriptionId: "named-sub", itemName: null, itemPosition: 1, subscriptionItems: ["orders"], key: "named" })
    ]);
    for (const [subscriptionId, itemName, itemPosition, key] of [
      ["subscription-1", null, 1, "first"],
      ["subscription-1", null, 2, "second"],
      ["subscription-1", "orders-group", 2, "second"],
      ["named-sub", null, 1, "named"]
    ] as const) {
      expect(validateCommandDraftAgainstState({ command: "UPDATE", key }, state, { subscriptionId, itemName, itemPosition }).diagnostics).toEqual([]);
      expect(inspectCommandState(state, { subscriptionId, item: { name: itemName, position: itemPosition }, key }).state).toBe("key-present");
    }
    for (const [itemName, itemPosition, key] of [
      [null, 1, "second"], [null, 2, "first"], ["orders-group", null, "first"], ["wrong-name", 1, "first"]
    ] as const) {
      expect(validateCommandDraftAgainstState({ command: "UPDATE", key }, state, { subscriptionId: "subscription-1", itemName, itemPosition }).diagnostics).toContainEqual(expect.objectContaining({ code: "unknown-key-update" }));
      expect(inspectCommandState(state, { subscriptionId: "subscription-1", item: { name: itemName, position: itemPosition }, key }).state).toBe("key-absent");
    }
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
