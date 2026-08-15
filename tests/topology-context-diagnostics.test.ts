import { describe, expect, it } from "vitest";

import {
  evaluateTopologyContextDiagnostics,
  type TopologyContextDiagnosticInput,
  type TopologySubscriptionFact
} from "../src/core/topology-context-diagnostics";

const evidence = Object.freeze({ intervalId: "history-1", sequence: 20, eventId: "topology-20" });

function subscription(id: string, patch: Partial<TopologySubscriptionFact> = {}): TopologySubscriptionFact {
  return Object.freeze({
    affected: Object.freeze({ kind: "subscription", pageId: "page", clientId: "client", sessionId: "session", subscriptionId: id }),
    current: true,
    activeAtBoundary: true,
    configuration: Object.freeze({
      mode: "MERGE",
      items: Object.freeze({ kind: "list", values: Object.freeze(["item-1"]) }),
      fields: Object.freeze({ kind: "list", values: Object.freeze(["price", "size"]) }),
      dataAdapter: "QUOTE_ADAPTER",
      selector: null,
      requestedSnapshot: "yes",
      requestedMaxFrequency: 2,
      requestedBufferSize: 5,
      secondLevelFields: Object.freeze({ kind: "unset" }),
      secondLevelDataAdapter: null
    }),
    evidence,
    ...patch
  });
}

function input(subscriptions: readonly TopologySubscriptionFact[]): TopologyContextDiagnosticInput {
  return Object.freeze({
    boundary: Object.freeze({ observedAt: 1_000, sequence: 20, evidence }),
    subscriptions: Object.freeze([...subscriptions]),
    churnWindows: Object.freeze([]),
    limitations: Object.freeze([])
  });
}

describe("topology Context diagnostics", () => {
  it("reports exact duplicates as one stable current condition with both identities and no health score", () => {
    const result = evaluateTopologyContextDiagnostics(input([
      subscription("sub-b"),
      subscription("sub-a")
    ]));

    expect(result.observations).toEqual([
      expect.objectContaining({
        code: "ls.subscription.exact-duplicate",
        severity: "information",
        lifecycle: { kind: "condition", conditionId: "sub-a:sub-b" },
        affected: expect.objectContaining({ kind: "subscription", subscriptionId: "sub-a" }),
        evidenceBoundary: evidence,
        route: { kind: "inspect-evidence", evidence }
      })
    ]);
    expect(result.observations[0]?.observed).toContain("sub-a");
    expect(result.observations[0]?.observed).toContain("sub-b");
    expect(result.observations[0]?.observed).toContain("Matching configuration");
    expect(JSON.stringify(result)).not.toMatch(/health score|application intent/i);
  });

  it("keeps semantic overlap separate and names matching and differing configuration", () => {
    const first = subscription("sub-a");
    const second = subscription("sub-b", {
      configuration: Object.freeze({
        ...first.configuration,
        requestedBufferSize: 50,
        requestedMaxFrequency: "unfiltered"
      })
    });
    const [observation] = evaluateTopologyContextDiagnostics(input([first, second])).observations;

    expect(observation).toMatchObject({
      code: "ls.subscription.semantic-overlap",
      severity: "information",
      lifecycle: { kind: "condition", conditionId: "sub-a:sub-b" }
    });
    expect(observation.observed).toContain("Matching configuration: mode, items, fields, Data Adapter, selector");
    expect(observation.observed).toContain("Differing configuration: requested maximum frequency, requested buffer size");
    expect(observation.limitation).toMatch(/may be intentional/i);
  });

  it("emits historical comparisons as occurrences and current comparisons as resolvable conditions", () => {
    const first = subscription("sub-a");
    const second = subscription("sub-b");
    const current = evaluateTopologyContextDiagnostics(input([first, second]));
    const historical = evaluateTopologyContextDiagnostics(input([
      { ...first, current: false },
      { ...second, current: false }
    ]));

    expect(current.observations[0]?.lifecycle).toEqual({ kind: "condition", conditionId: "sub-a:sub-b" });
    expect(historical.observations[0]?.lifecycle).toEqual({ kind: "occurrence", occurrenceId: "topology-20:sub-a:sub-b" });
    expect(evaluateTopologyContextDiagnostics(input([first]), current.observations).resolutions).toEqual([
      expect.objectContaining({ code: "ls.subscription.exact-duplicate", conditionId: "sub-a:sub-b" })
    ]);
  });

  it("does not claim duplicate or overlap when configuration is unavailable, inactive, or cross-Session", () => {
    const first = subscription("sub-a");
    const unavailable = subscription("sub-b", {
      configuration: Object.freeze({
        ...first.configuration,
        fields: Object.freeze({ kind: "unavailable", reason: "wire-fallback" })
      })
    });
    const inactive = subscription("sub-c", { activeAtBoundary: false });
    const otherSession = subscription("sub-d", {
      affected: Object.freeze({ kind: "subscription", pageId: "page", clientId: "client", sessionId: "other", subscriptionId: "sub-d" })
    });

    expect(evaluateTopologyContextDiagnostics(input([first, unavailable, inactive, otherSession])).observations).toEqual([]);
  });
});
