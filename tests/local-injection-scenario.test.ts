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
    editor: { cursor: 19, selectionFrom: 19, selectionTo: 22, scrollTop: 31, compareOpen: true },
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

  it("dispatches one Step, waits for Evidence settlement, then pauses with a correlated trace", async () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, {
      runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fingerprint-1", activeCommandKeys: []
    });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    let settle!: (value: { outcome: { headline: "DELIVERED LOCALLY" }; evidence: { eventId: string } }) => void;
    const execute = vi.fn(() => new Promise<{
      outcome: { headline: "DELIVERED LOCALLY" };
      evidence: { eventId: string };
    }>((resolve) => { settle = resolve; }));
    const pending = stepScenarioRun(reviewed.run, { execute, injectionId: "injection-1" });
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ stepId: "step-1", ordinal: 1, injectionId: "injection-1" }));
    settle({ outcome: { headline: "DELIVERED LOCALLY" }, evidence: { eventId: "local-1" } });
    const next = await pending;
    expect(next).toMatchObject({ status: "paused", nextOrdinal: 2, trace: [{ stepId: "step-1", injectionId: "injection-1", evidence: { eventId: "local-1" } }] });
    expect(next.trace).toHaveLength(1);
  });
});
