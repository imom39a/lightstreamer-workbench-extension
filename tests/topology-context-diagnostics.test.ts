import { describe, expect, it } from "vitest";

import {
  evaluateTopologyContextDiagnostics,
  type TopologyContextDiagnosticInput,
  type TopologySubscriptionFact
} from "../src/core/topology-context-diagnostics";
import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";

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
    expect(historical.observations[0]?.observed).toContain("historical active-at-boundary");
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

  it.each([
    ["listener", "ls.listener.registration-churn"],
    ["subscription", "ls.subscription.lifecycle-churn"]
  ] as const)("reports bounded %s churn without claiming intent", (kind, code) => {
    const base = input([]);
    const changeEvidence = Object.freeze({ intervalId: "history-1", sequence: 25, eventId: `${kind}-change-25` });
    const result = evaluateTopologyContextDiagnostics({
      ...base,
      churnWindows: Object.freeze([{
        id: `${kind}-window-1`,
        kind,
        affected: Object.freeze({ kind: "subscription" as const, pageId: "page", clientId: "client", sessionId: "session", subscriptionId: "sub-a" }),
        startedAt: 2_000,
        endedAt: 12_000,
        threshold: 6,
        totalChanges: 8,
        retainedChanges: Object.freeze([
          { operation: "add" as const, evidence: changeEvidence },
          { operation: "remove" as const, evidence: { ...changeEvidence, sequence: 26, eventId: `${kind}-change-26` } }
        ]),
        current: true,
        complete: false,
        lateAttachment: true
      }])
    });

    expect(result.observations).toEqual([
      expect.objectContaining({
        code,
        severity: "information",
        lifecycle: { kind: "condition", conditionId: `${kind}:sub-a:${kind}-window-1` },
        observed: expect.stringContaining("8 captured add/remove changes from 2000 through 12000 (10000 ms)"),
        limitation: expect.stringMatching(/bounded.*incomplete.*attached after/i),
        route: { kind: "inspect-evidence", evidence: { ...changeEvidence, sequence: 26, eventId: `${kind}-change-26` } }
      })
    ]);
    expect(`${result.observations[0]?.observed} ${result.observations[0]?.consequence}`).not.toMatch(/leak|bug|intent|health/i);
  });

  it("keeps closed churn as one occurrence and resolves the prior current window", () => {
    const base = input([]);
    const churn = Object.freeze({
      id: "window",
      kind: "listener" as const,
      affected: Object.freeze({ kind: "subscription" as const, pageId: "page", clientId: "client", subscriptionId: "sub" }),
      startedAt: 0,
      endedAt: 10_000,
      threshold: 4,
      totalChanges: 4,
      retainedChanges: Object.freeze([{ operation: "add" as const, evidence }]),
      current: true,
      complete: true,
      lateAttachment: false
    });
    const current = evaluateTopologyContextDiagnostics({ ...base, churnWindows: [churn] });
    const closed = evaluateTopologyContextDiagnostics({ ...base, churnWindows: [{ ...churn, current: false }] }, current.observations);
    expect(closed.observations[0]?.lifecycle).toEqual({ kind: "occurrence", occurrenceId: "window" });
    expect(closed.resolutions).toEqual([expect.objectContaining({ code: "ls.listener.registration-churn" })]);
  });

  it("fails closed for unbounded, unsupported, below-threshold, or evidence-free churn windows", () => {
    const base = input([]);
    const window = {
      id: "window",
      kind: "listener" as const,
      affected: Object.freeze({ kind: "page" as const, pageId: "page" }),
      startedAt: 0,
      endedAt: 10_000,
      threshold: 6,
      totalChanges: 5,
      retainedChanges: Object.freeze([{ operation: "add" as const, evidence }]),
      current: true,
      complete: true,
      lateAttachment: false
    };
    expect(evaluateTopologyContextDiagnostics({ ...base, churnWindows: [window] }).observations).toEqual([]);
    expect(evaluateTopologyContextDiagnostics({ ...base, churnWindows: [{ ...window, totalChanges: 8, endedAt: 60_001 }] }).observations).toEqual([]);
    expect(evaluateTopologyContextDiagnostics({ ...base, churnWindows: [{ ...window, totalChanges: 8, retainedChanges: [] }] }).observations).toEqual([]);
  });

  it.each([
    [{ kind: "late-attachment", attachedAt: 900, detail: "page activity before attachment was not observed", weakens: ["pre-attachment-churn", "topology-completeness"] }, "workbench.capture.late-attachment", "information"],
    [{ kind: "observation-path", path: "wire", detail: "listener registrations are not observable on this path", weakens: ["listener-presence", "update-delivery-attribution"] }, "workbench.capture.observation-path-limited", "information"],
    [{ kind: "history-capacity", state: "lower-capacity", detail: "the memory tier has a smaller fixed envelope", weakens: ["future-evidence-retention"] }, "workbench.history.lower-capacity", "information"],
    [{ kind: "history-capacity", state: "terminal", detail: "later captured candidates were refused", weakens: ["history-after-terminal-boundary"] }, "workbench.history.terminal", "error"],
    [{ kind: "unsupported-shape", shape: "subscription-vNext", detail: "configuration fields could not be normalized", weakens: ["subscription-configuration"] }, "workbench.capture.unsupported-shape", "warning"]
  ] as const)("scopes %s to the exact conclusions it weakens", (specific, code, severity) => {
    const base = input([]);
    const [observation] = evaluateTopologyContextDiagnostics({
      ...base,
      limitations: Object.freeze([{
        id: `limit-${code}`,
        affected: Object.freeze({ kind: "subscription" as const, pageId: "page", clientId: "client", sessionId: "session", subscriptionId: "sub" }),
        current: true,
        evidence,
        ...specific
      }])
    }).observations;

    expect(observation).toMatchObject({
      code,
      severity,
      lifecycle: { kind: "condition", conditionId: `limit-${code}` },
      affected: expect.objectContaining({ kind: "subscription", subscriptionId: "sub" }),
      route: { kind: "inspect-evidence", evidence }
    });
    expect(observation.limitation).toContain([...specific.weakens].sort().join(", "));
    expect(observation.limitation).toContain("does not globally degrade unrelated Workbench conclusions");
  });

  it("turns a cleared limitation into a deterministic resolution and retains a historical limitation occurrence", () => {
    const base = input([]);
    const limitation = Object.freeze({
      id: "late-attach",
      kind: "late-attachment" as const,
      affected: Object.freeze({ kind: "page" as const, pageId: "page" }),
      current: true,
      attachedAt: 500,
      detail: "earlier page activity was not observed",
      weakens: Object.freeze(["pre-attachment-churn" as const])
    });
    const current = evaluateTopologyContextDiagnostics({ ...base, limitations: [limitation] });
    expect(evaluateTopologyContextDiagnostics(base, current.observations).resolutions).toEqual([
      expect.objectContaining({ code: "workbench.capture.late-attachment", conditionId: "late-attach" })
    ]);
    expect(evaluateTopologyContextDiagnostics({ ...base, limitations: [{ ...limitation, current: false }] }).observations[0]?.lifecycle)
      .toEqual({ kind: "occurrence", occurrenceId: "late-attach" });
  });

  it("does not create a generic limitation when no conclusion is weakened", () => {
    const base = input([]);
    expect(evaluateTopologyContextDiagnostics({
      ...base,
      limitations: [{
        id: "empty",
        kind: "observation-path",
        affected: { kind: "page", pageId: "page" },
        current: true,
        path: "wire",
        detail: "wire path",
        weakens: []
      }]
    }).observations).toEqual([]);
  });

  it("deduplicates repeated immutable facts and bounds composite identities and captured detail", () => {
    const longId = "subscription-".repeat(9);
    const first = subscription(`${longId}a`);
    const second = subscription(`${longId}b`);
    const base = input([first, first, second, second]);
    const limitation = {
      id: "limit",
      kind: "unsupported-shape" as const,
      affected: first.affected,
      current: true,
      shape: "shape",
      detail: "detail ".repeat(200),
      weakens: ["subscription-configuration" as const]
    };
    const result = evaluateTopologyContextDiagnostics({ ...base, limitations: [limitation, limitation] });

    expect(result.observations.filter(({ code }) => code === "ls.subscription.exact-duplicate")).toHaveLength(1);
    expect(result.observations.filter(({ code }) => code === "workbench.capture.unsupported-shape")).toHaveLength(1);
    expect(result.observations.every(({ lifecycle }) => {
      const identity = lifecycle.kind === "condition" ? lifecycle.conditionId : lifecycle.occurrenceId;
      return [...identity].length <= 128;
    })).toBe(true);
    expect(result.observations.every(({ observed, limitation: limit, consequence }) =>
      [observed, limit, consequence].every((text) => [...text].length <= 512))).toBe(true);
  });

  it("commits and resolves producer output through the normalized Diagnostic Observation journal", async () => {
    const source = input([subscription("sub-a"), subscription("sub-b")]);
    const evaluation = evaluateTopologyContextDiagnostics(source);
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel" });
    const committed = await Promise.all(evaluation.observations.map((observation) => journal.observe(observation)));
    const cleared = evaluateTopologyContextDiagnostics(input([subscription("sub-a")]), evaluation.observations);
    const resolved = await Promise.all(cleared.resolutions.map((resolution) => journal.resolveCondition(resolution)));

    expect(committed[0]).toMatchObject({ code: "ls.subscription.exact-duplicate", lifecycle: { state: "active" } });
    expect(resolved[0]).toMatchObject({ code: "ls.subscription.exact-duplicate", lifecycle: { state: "resolved" } });
    expect((await journal.replay()).map(({ lifecycle }) => lifecycle.state)).toEqual(["active", "resolved"]);
  });
});
