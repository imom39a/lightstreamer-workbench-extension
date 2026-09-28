import { describe, expect, it } from "vitest";
import {
  addScenarioCheckpoint,
  addScenarioStep,
  confirmScenarioMembershipPreview,
  createScenarioFromDraft,
  duplicateScenarioStep,
  previewScenarioMembership,
  removeScenarioStep,
  undoScenarioStepRemoval,
  type ScenarioDraftInput
} from "../src/core/local-injection-scenario";

const target = {
  pageEpoch: "page-1",
  clientId: "client-1",
  sessionId: "session-1",
  subscriptionId: "subscription-1",
  deliveryPath: "listener" as const,
  listenerId: "listener-1",
  mode: "COMMAND",
  schemaFields: ["command", "key", "qty"]
};

function draft(id: string): ScenarioDraftInput {
  return {
    id,
    sourceEventId: `event-${id}`,
    sourceRawText: null,
    rawText: JSON.stringify({ command: "ADD", key: id, isSnapshot: false, fields: { qty: "1" } }),
    document: { command: "ADD", key: id, isSnapshot: false, fields: { qty: "1" } },
    ready: true,
    diagnostics: [],
    target,
    item: { name: "orders", position: 1 },
    editor: { cursor: 0, selectionFrom: 0, selectionTo: 0, scrollTop: 0, scrollLeft: 0, compareOpen: false, serializedState: null },
    restorationOrigin: { scopeId: null, selectionEventId: null, focusedEventId: null, contextId: null },
    relativeDelayMs: 0
  };
}

const evidence = (sequence: number, eventId: string) => ({ intervalId: "interval-1", sequence, eventId });

describe("collision-free Scenario member identities", () => {
  it("skips explicit Step IDs in add and duplicate while keeping the sequence monotonic", () => {
    const initial = createScenarioFromDraft(draft("first"), { scenarioId: "scenario-1", stepId: "step-2" });
    const added = addScenarioStep(initial, draft("second"));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.scenario.steps.map(step => step.id)).toEqual(["step-2", "step-3"]);
    expect(added.scenario.nextStepSequence).toBe(4);

    const duplicated = duplicateScenarioStep(added.scenario, "step-2");
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.scenario.steps.map(step => step.id)).toEqual(["step-2", "step-4", "step-3"]);
    expect(duplicated.scenario.nextStepSequence).toBe(5);
  });

  it("allocates membership Steps around explicit Step and Checkpoint identities", () => {
    const initial = createScenarioFromDraft(draft("first"), { scenarioId: "scenario-membership", stepId: "step-2" });
    const checkpoint = addScenarioCheckpoint(initial, {
      kind: "checkpoint", id: "step-3", name: "after first", assertions: []
    });
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    const preview = previewScenarioMembership(checkpoint.scenario, [
      { evidence: evidence(2, "event-2"), draft: draft("member-2") },
      { evidence: evidence(3, "event-3"), draft: draft("member-3") }
    ]);
    const confirmed = confirmScenarioMembershipPreview(checkpoint.scenario, preview);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.scenario.steps.map(step => step.id)).toEqual(["step-2", "step-4", "step-5"]);
    expect(confirmed.scenario.nextStepSequence).toBe(6);
  });

  it("reserves removed Step IDs for undo and rejects explicit reuse until restoration", () => {
    const initial = createScenarioFromDraft(draft("first"), { scenarioId: "scenario-undo" });
    const added = addScenarioStep(initial, draft("second"));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = removeScenarioStep(added.scenario, "step-2");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;

    expect(addScenarioStep(removed.scenario, draft("reuse"), {}, "step-2")).toMatchObject({ ok: false, reason: expect.stringContaining("already in use") });
    const checkpoint = addScenarioCheckpoint(removed.scenario, { kind: "checkpoint", id: "step-3", name: "reserved", assertions: [] });
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    const newStep = addScenarioStep(checkpoint.scenario, draft("new"));
    expect(newStep.ok).toBe(true);
    if (!newStep.ok) return;
    expect(newStep.scenario.steps.map(step => step.id)).toEqual(["step-1", "step-4"]);
    const restored = undoScenarioStepRemoval(newStep.scenario);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.scenario.steps.map(step => step.id)).toEqual(["step-1", "step-2", "step-4"]);
    expect(new Set(restored.scenario.members.map(member => member.id)).size).toBe(restored.scenario.members.length);
  });
});
