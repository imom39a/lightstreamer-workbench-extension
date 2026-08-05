import { describe, expect, it, vi } from "vitest";

import { createSubscriptionLocalInjectionRegistry } from "../src/injected/subscription-local-injection";

describe("Subscription-scoped Local Injection", () => {
  it("fans one Logical Update out to every current listener", () => {
    const registry = createSubscriptionLocalInjectionRegistry<{ value: number }>();
    const first = vi.fn();
    const second = vi.fn();
    registry.register("subscription-1", {
      listenerId: "listener-1",
      fieldNames: ["value"],
      deliver: first
    });
    registry.register("subscription-1", {
      listenerId: "listener-2",
      fieldNames: ["value"],
      deliver: second
    });

    const result = registry.deliver("subscription-1", () => ({ value: 42 }));

    expect(result).toEqual({
      ok: true,
      attemptedListenerCount: 2,
      deliveredListenerCount: 2,
      failedListenerCount: 0
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]?.[0]).toBe(second.mock.calls[0]?.[0]);
  });

  it("stops targeting a removed listener without retiring the Subscription", () => {
    const registry = createSubscriptionLocalInjectionRegistry<object>();
    const first = vi.fn();
    const second = vi.fn();
    registry.register("subscription-1", {
      listenerId: "listener-1",
      fieldNames: [],
      deliver: first
    });
    registry.register("subscription-1", {
      listenerId: "listener-2",
      fieldNames: [],
      deliver: second
    });
    registry.unregister("subscription-1", "listener-1");

    expect(registry.hasTarget("subscription-1")).toBe(true);
    expect(registry.deliver("subscription-1", () => ({}))).toEqual({
      ok: true,
      attemptedListenerCount: 1,
      deliveredListenerCount: 1,
      failedListenerCount: 0
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reports a stale Local Injection Target when the Subscription has no listeners", () => {
    const registry = createSubscriptionLocalInjectionRegistry<object>();

    expect(registry.deliver("subscription-1", () => ({}))).toEqual({
      ok: false,
      reason: "stale-target",
      attemptedListenerCount: 0,
      deliveredListenerCount: 0,
      failedListenerCount: 0
    });
  });

  it("continues fan-out after a listener throws and reports the partial failure", () => {
    const registry = createSubscriptionLocalInjectionRegistry<object>();
    const second = vi.fn();
    registry.register("subscription-1", {
      listenerId: "listener-1",
      fieldNames: [],
      deliver() {
        throw new Error("first listener failed");
      }
    });
    registry.register("subscription-1", {
      listenerId: "listener-2",
      fieldNames: [],
      deliver: second
    });

    expect(registry.deliver("subscription-1", () => ({}))).toEqual({
      ok: false,
      reason: "listener-error",
      attemptedListenerCount: 2,
      deliveredListenerCount: 1,
      failedListenerCount: 1,
      error: "first listener failed"
    });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
