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
});
