import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createEventStore } from "../src/core/event-store";

function event(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: Date.now(),
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update"
  };
}

describe("event store", () => {
  it("appends events in order and returns immutable list snapshots", () => {
    const store = createEventStore();

    store.append(event("event-1"));
    store.append(event("event-2"));

    const listed = store.list();
    listed.pop();

    expect(store.list().map((entry) => entry.id)).toEqual(["event-1", "event-2"]);
    expect(store.count()).toBe(2);
  });

  it("notifies subscribers on append and clear", () => {
    const store = createEventStore();
    const notifications: string[][] = [];

    store.subscribe((events) => {
      notifications.push(events.map((entry) => entry.id));
    });

    store.append(event("event-1"));
    store.clear();

    expect(notifications).toEqual([[], ["event-1"], []]);
    expect(store.count()).toBe(0);
  });

  it("bounds retained events when maxEvents is configured", () => {
    const store = createEventStore({ maxEvents: 2 });

    store.append(event("event-1"));
    store.append(event("event-2"));
    store.append(event("event-3"));

    expect(store.list().map((entry) => entry.id)).toEqual(["event-2", "event-3"]);
  });
});
