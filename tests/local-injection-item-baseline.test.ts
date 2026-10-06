import { describe, expect, it } from "vitest";
import { createNativeItemBaselineIndex } from "../src/core/local-injection-item-baseline";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const target = { pageEpoch: "page", clientId: "client", sessionId: "session", subscriptionId: "sub", item: { name: "item", position: 1 } };
const event = (value: string | null, synthetic = false): LightstreamerEventEnvelope => ({ id: "event", timestamp: 1, direction: "inbound", source: synthetic ? "synthetic" : "server", synthetic, kind: "item-update", client: { id: "client", sessionId: "session" }, subscription: { id: "sub", mode: "MERGE" }, item: target.item, update: { fields: { value } } });

describe("bounded committed item baseline", () => {
  it("reads only exact page/client/session/item identities and retained interval semantics", () => {
    const index = createNativeItemBaselineIndex();
    expect(index.read(target, "interval")).toBeNull();
    index.apply(event("one"), { intervalId: "interval", sequence: 1, eventId: "first" }, "page");
    expect(index.read(target, "interval")?.fields).toEqual({ value: "one" });
    expect(index.read({ ...target, sessionId: "other" }, "interval")).toBeNull();
    expect(index.read(target, "other")).toBeNull();
    expect(index.read(target, "interval", 1)).toBeNull();
    index.apply(event("two", true), { intervalId: "interval", sequence: 2, eventId: "local" }, "page");
    expect(index.read(target, "interval", 1)?.fields.value).toBe("two");
  });

  it("keeps ambiguous server null separate from owned concrete Local null", () => {
    const index = createNativeItemBaselineIndex();
    index.apply(event(null), { intervalId: "interval", sequence: 1, eventId: "server" }, "page");
    expect(index.read(target, "interval")?.fieldValueStates.value).toBe("ambiguous-null");
    index.apply(event(null, true), { intervalId: "interval", sequence: 2, eventId: "local" }, "page");
    expect(index.read(target, "interval")?.fieldValueStates.value).toBe("concrete");
    expect(Object.isFrozen(index.read(target, "interval")?.fields)).toBe(true);
  });

  it("bounds rows and bytes, with eviction or Clear making baselines unavailable", () => {
    const index = createNativeItemBaselineIndex({ maxRows: 1, maxBytes: 1000 });
    index.apply(event("one"), { intervalId: "interval", sequence: 1, eventId: "first" }, "page");
    index.apply({ ...event("two"), item: { name: "other", position: 2 } }, { intervalId: "interval", sequence: 2, eventId: "other" }, "page");
    expect(index.read(target, "interval")).toBeNull();
    expect(index.status().rows).toBe(1);
    expect(index.status().bytes).toBeLessThanOrEqual(1000);
    index.clear();
    expect(index.status().bytes).toBe(0);
    index.apply(event("x".repeat(2000)), { intervalId: "interval", sequence: 3, eventId: "wide" }, "page");
    expect(index.status().rows).toBe(0);
  });
});
