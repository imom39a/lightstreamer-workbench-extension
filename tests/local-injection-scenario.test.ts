import { describe, expect, it, vi } from "vitest";

import {
  addScenarioStep,
  createScenarioFromDraft,
  reviewScenario,
  stepScenarioRun,
  type ScenarioDraftInput
} from "../src/core/local-injection-scenario";

const target = Object.freeze({
  pageEpoch: "page-1",
  clientId: "client-1",
  sessionId: "session-1",
  subscriptionId: "sub-1",
  deliveryPath: "listener" as const,
  listenerId: "listener-1",
  mode: "COMMAND",
  schemaFields: Object.freeze(["command", "key", "qty"])
});

function input(id: string, command: "ADD" | "UPDATE", qty: number): ScenarioDraftInput {
  return {
    id,
    sourceEventId: `source-${id}`,
    sourceRawText: `source:${id}`,
    rawText: JSON.stringify({ command, key: "order-7", isSnapshot: false, fields: { command, key: "order-7", qty } }, null, 2),
    document: { command, key: "order-7", isSnapshot: false, fields: { command, key: "order-7", qty } },
    ready: true,
    diagnostics: [],
    target,
    editor: { cursor: 19, selectionFrom: 19, selectionTo: 22, scrollTop: 31, scrollLeft: 0, compareOpen: true },
    restorationOrigin: { scopeId: "sub:1", selectionEventId: `source-${id}`, focusedEventId: `source-${id}`, contextId: `context:source-${id}` },
    relativeDelayMs: 0
  };
}

describe("Local Injection Scenario", () => {
  it("deliberately converts one protected Draft without losing its authoring state", () => {
    const source = input("draft-1", "ADD", 1);
    const scenario = createScenarioFromDraft(source, { scenarioId: "scenario-1" });

    expect(scenario).toMatchObject({
      id: "scenario-1",
      revision: 1,
      phase: "edit",
      target,
      restorationOrigin: source.restorationOrigin,
      steps: [{ id: "step-1", draft: source }]
    });
    expect(scenario.steps[0]?.draft.editor).toEqual(source.editor);
    expect(Object.isFrozen(scenario.steps[0]?.draft)).toBe(true);
  });

  it("adds exactly one compatible captured update and reports a specific incompatibility", () => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const compatible = addScenarioStep(scenario, input("draft-2", "UPDATE", 2));
    expect(compatible.ok).toBe(true);
    if (!compatible.ok) return;
    expect(compatible.scenario.steps.map(({ id }) => id)).toEqual(["step-1", "step-2"]);

    const incompatible = addScenarioStep(compatible.scenario, {
      ...input("draft-3", "UPDATE", 3),
      target: { ...target, sessionId: "session-2" }
    });
    expect(incompatible).toEqual({ ok: false, reason: "Different Session: Scenario Steps must share the exact Local Injection Target." });
    expect(compatible.scenario.steps).toHaveLength(2);
  });

  it("reviews an immutable ordered plan and validates UPDATE against a preceding planned ADD", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, {
      runId: "run-1",
      committedEvidenceSeed: { intervalId: "interval-1", sequence: 41, eventId: "server-41" },
      targetFingerprint: "fingerprint-1",
      activeCommandKeys: []
    });

    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.run).toMatchObject({
      id: "run-1",
      scenarioId: "scenario-1",
      scenarioRevision: 2,
      targetFingerprint: "fingerprint-1",
      committedEvidenceSeed: { sequence: 41 },
      status: "paused",
      nextOrdinal: 1
    });
    expect(reviewed.run.steps.map(({ document }) => document.command)).toEqual(["ADD", "UPDATE"]);
    expect(Object.isFrozen(reviewed.run.steps)).toBe(true);
    expect(Object.isFrozen(reviewed.run.steps[0]?.document)).toBe(true);
  });

  it("uses ordered planned COMMAND state as the sole authority for an otherwise unknown UPDATE", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const unknownUpdate = {
      ...input("draft-2", "UPDATE", 2),
      ready: false,
      diagnostics: [{ category: "semantic" as const, severity: "error" as const, code: "unknown-key-update", message: "Unknown key." }]
    };
    const added = addScenarioStep(first, unknownUpdate);
    if (!added.ok) throw new Error(added.reason);
    expect(reviewScenario(added.scenario, { runId: "run-ordered", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeys: [] })).toMatchObject({ ok: true });
  });

  it("dispatches one Step, waits for Evidence settlement, then pauses with a correlated trace", async () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, {
      runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fingerprint-1", activeCommandKeys: []
    });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    let settle!: (value: { kind: "attempted"; outcome: ReturnType<typeof outcome>; evidence: { eventId: string } }) => void;
    const execute = vi.fn(() => new Promise<{
      kind: "attempted";
      outcome: ReturnType<typeof outcome>;
      evidence: { eventId: string };
    }>((resolve) => { settle = resolve; }));
    const pending = stepScenarioRun(reviewed.run, { execute, injectionId: "injection-1" });
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ stepId: "step-1", ordinal: 1, injectionId: "injection-1" }));
    settle({ kind: "attempted", outcome: outcome("DELIVERED LOCALLY", "delivered"), evidence: { eventId: "local-1" } });
    const next = await pending;
    expect(next).toMatchObject({ status: "paused", nextOrdinal: 2, trace: [{ stepId: "step-1", injectionId: "injection-1", evidence: { eventId: "local-1" } }] });
    expect(next.trace).toHaveLength(1);
  });

  it.each([
    ["partial delivery", "PARTIALLY DELIVERED", "partial", { eventId: "unexpected" }],
    ["unknown delivery", "DELIVERY UNKNOWN", "acknowledgement-unknown", null],
    ["review invalidation", "NOT RUN", "blocked", null],
    ["delivery without retained Evidence", "DELIVERED LOCALLY", "delivered", null]
  ] as const)("stops at the same ordinal after %s instead of advancing", async (_case, headline, disposition, evidence) => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(scenario, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeys: [] });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    const stopped = await stepScenarioRun(reviewed.run, {
      injectionId: "injection-failed",
      execute: async () => ({ kind: "attempted" as const, outcome: outcome(headline, disposition), evidence })
    });
    expect(stopped).toMatchObject({ status: "stopped", nextOrdinal: 1, trace: [
      { kind: "attempted", outcome: { headline, disposition } },
      { kind: "not-run", reason: "RUN STOPPED", detail: expect.stringContaining("not attempted") }
    ] });
  });

  it("records review invalidation and every remaining Step as not run without fake Injection identity", async () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeys: [] });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    const stopped = await stepScenarioRun(reviewed.run, {
      injectionId: "reserved-but-not-attempted",
      execute: async () => ({ kind: "not-run" as const, reason: "REVIEW INVALIDATED" as const, timestamp: 7, detail: "Review invalidated before dispatch." })
    });
    expect(stopped.trace).toEqual([
      expect.objectContaining({ kind: "not-run", stepId: "step-1", timestamp: 7, detail: "Review invalidated before dispatch." }),
      expect.objectContaining({ kind: "not-run", stepId: "step-2", timestamp: 7 })
    ]);
    expect(stopped.trace.every((entry) => !("injectionId" in entry))).toBe(true);
  });
});

function outcome(
  headline: "DELIVERED LOCALLY" | "NOT RUN" | "PARTIALLY DELIVERED" | "DELIVERY UNKNOWN",
  disposition: "delivered" | "blocked" | "partial" | "acknowledgement-unknown"
) {
  return {
    headline,
    disposition,
    status: disposition === "blocked" ? "review-blocked" : disposition === "acknowledgement-unknown" ? "acknowledgement-unknown" : "success",
    executionId: "execution-1",
    requestId: "request-1",
    timestamp: 1,
    detail: `Precise ${headline} detail`,
    attemptedCount: 2,
    deliveredCount: disposition === "partial" ? 1 : 2,
    failedCount: disposition === "partial" ? 1 : 0
  } as const;
}
