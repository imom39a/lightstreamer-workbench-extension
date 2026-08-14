import { describe, expect, it, vi } from "vitest";

import { createSubscriptionLocalInjectionRegistry } from "../src/injected/subscription-local-injection";
import { stepScenarioRun, type ScenarioRun } from "../src/core/local-injection-scenario";

function oneStepScenarioRun(): ScenarioRun {
  const target = Object.freeze({ pageEpoch: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1", deliveryPath: "listener" as const, listenerId: "listener-1", mode: "COMMAND", schemaFields: Object.freeze(["command", "key", "value"]) });
  const steps = Object.freeze([{ kind: "step" as const, id: "step-1", ordinal: 1, sourceEventId: null, rawText: "{}", document: Object.freeze({ command: "UPDATE" as const, key: "order-1", isSnapshot: false, fields: Object.freeze({ command: "UPDATE", key: "order-1", value: 2 }) }), relativeDelayMs: 0 }]);
  return Object.freeze({
    id: "run-listener", scenarioId: "scenario-listener", scenarioRevision: 1, target, targetFingerprint: "listener-fingerprint", committedEvidenceSeed: null,
    steps, members: steps,
    status: "paused" as const, nextOrdinal: 1, nextMemberIndex: 0, trace: Object.freeze([]), accountedBytes: 1, traceReservationBytes: 1, controlReservationBytes: 1, speed: 1 as const, controls: Object.freeze([]),
    authorizations: Object.freeze([{ id: "auth-1", kind: "INITIAL_REVIEW" as const, targetFingerprint: "listener-fingerprint", listenerIds: Object.freeze(["listener-1", "listener-2"]), committedEvidenceBoundary: null, authorizedRemainingFromOrdinal: 1, activeOffsetMs: 0 }]),
    drifts: Object.freeze([])
  });
}

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

  it("feeds exact real-listener partial counts into a Scenario terminal record without fabricating Evidence", async () => {
    const registry = createSubscriptionLocalInjectionRegistry<object>();
    registry.register("subscription-1", { listenerId: "listener-1", fieldNames: [], deliver() { throw new Error("first listener failed"); } });
    registry.register("subscription-1", { listenerId: "listener-2", fieldNames: [], deliver: vi.fn() });

    const delivered = registry.deliver("subscription-1", () => ({}));
    const run = await stepScenarioRun(oneStepScenarioRun(), {
      injectionId: "injection-listener",
      execute: async () => ({
        kind: "attempted" as const,
        outcome: {
          disposition: "partial" as const, headline: "PARTIALLY DELIVERED" as const, status: "listener-error" as const,
          executionId: "execution-listener", requestId: "request-listener", timestamp: 42, detail: !delivered.ok && delivered.reason === "listener-error" ? delivered.error : "unexpected delivery result",
          attemptedCount: delivered.attemptedListenerCount, deliveredCount: delivered.deliveredListenerCount, failedCount: delivered.failedListenerCount
        },
        evidence: { intervalId: "must-not", sequence: 99, eventId: "must-not" }
      })
    });

    expect(run).toMatchObject({ status: "stopped", nextOrdinal: 1, trace: [{
      kind: "attempted", retention: "NOT_CREATED", evidence: null,
      outcome: { attemptedCount: 2, deliveredCount: 1, failedCount: 1 }
    }] });
  });
});
