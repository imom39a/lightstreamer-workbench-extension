import { describe, expect, it, vi } from "vitest";

import {
  SCENARIO_MAX_ACCOUNTED_BYTES,
  SCENARIO_MAX_STEPS,
  addScenarioStep,
  confirmScenarioMembershipPreview,
  createScenarioFromDraft,
  duplicateScenarioStep,
  moveScenarioStep,
  previewScenarioMembership,
  removeScenarioStep,
  reviewScenario,
  scenarioRunAdmission,
  stepScenarioRun,
  terminalizeScenarioRun,
  undoScenarioStepRemoval,
  updateScenarioStepDraft,
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

function input(id: string, command: "ADD" | "UPDATE" | "DELETE", qty: number): ScenarioDraftInput {
  return {
    id,
    sourceEventId: `source-${id}`,
    sourceRawText: `source:${id}`,
    rawText: JSON.stringify({ command, key: "order-7", isSnapshot: false, fields: { command, key: "order-7", qty } }, null, 2),
    document: { command, key: "order-7", isSnapshot: false, fields: { command, key: "order-7", qty } },
    ready: true,
    diagnostics: [],
    target,
    item: { name: "orders", position: 1 },
    editor: { cursor: 19, selectionFrom: 19, selectionTo: 22, scrollTop: 31, scrollLeft: 0, compareOpen: true, serializedState: null },
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

  it("previews retained Evidence in stable order and adds only confirmed compatible members atomically", () => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const preview = previewScenarioMembership(scenario, [
      { evidence: { intervalId: "interval-1", sequence: 12, eventId: "evidence-12" }, draft: { ...input("draft-12", "UPDATE", 12), sourceEventId: "evidence-12" } },
      { evidence: { intervalId: "interval-1", sequence: 10, eventId: "evidence-10" }, draft: { ...input("draft-10", "UPDATE", 10), sourceEventId: "evidence-10" } },
      { evidence: { intervalId: "interval-1", sequence: 11, eventId: "evidence-11" }, draft: { ...input("draft-11", "UPDATE", 11), sourceEventId: "evidence-11", target: { ...target, sessionId: "other" } } }
    ]);

    expect(preview.members.map(({ evidenceId, available }) => [evidenceId, available])).toEqual([
      ["evidence-10", true], ["evidence-11", false], ["evidence-12", true]
    ]);
    expect(preview.members[1]?.reason).toContain("Different Session");
    expect(scenario.steps).toHaveLength(1);

    const confirmed = confirmScenarioMembershipPreview(scenario, preview);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.scenario.steps.map(({ draft }) => draft.sourceEventId)).toEqual([
      "source-draft-1", "evidence-10", "evidence-12"
    ]);
    expect(confirmed.scenario.revision).toBe(2);
  });

  it("moves, duplicates, removes, and undoes without changing surviving Step identities or editor state", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const addition = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!addition.ok) throw new Error(addition.reason);
    const originalSecond = addition.scenario.steps[1]!;
    const moved = moveScenarioStep(addition.scenario, originalSecond.id, "earlier");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.scenario.steps.map(({ id }) => id)).toEqual(["step-2", "step-1"]);
    expect(moved.scenario.steps[0]).toBe(originalSecond);

    const duplicated = duplicateScenarioStep(moved.scenario, "step-2");
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.scenario.steps.map(({ id }) => id)).toEqual(["step-2", "step-3", "step-1"]);
    expect(duplicated.scenario.steps[1]?.draft).not.toBe(originalSecond.draft);
    expect(duplicated.scenario.steps[1]?.draft.editor).toEqual(originalSecond.draft.editor);

    const removed = removeScenarioStep(duplicated.scenario, "step-2");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.scenario.steps.map(({ id }) => id)).toEqual(["step-3", "step-1"]);
    const restored = undoScenarioStepRemoval(removed.scenario);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.scenario.steps.map(({ id }) => id)).toEqual(["step-2", "step-3", "step-1"]);
    expect(restored.scenario.steps[0]).toBe(originalSecond);
  });

  it("refuses the exact addition or edit that crosses a hard capacity without partial mutation", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    let scenario = first;
    for (let index = 2; index <= SCENARIO_MAX_STEPS; index += 1) {
      const addition = addScenarioStep(scenario, input(`draft-${index}`, "UPDATE", index));
      if (!addition.ok) throw new Error(addition.reason);
      scenario = addition.scenario;
    }
    const overflow = addScenarioStep(scenario, input("draft-101", "UPDATE", 101));
    expect(overflow).toMatchObject({ ok: false, capacity: "steps" });
    expect(scenario.steps).toHaveLength(100);

    const huge = { ...input("draft-huge", "ADD", 1), rawText: "x".repeat(SCENARIO_MAX_ACCOUNTED_BYTES) };
    expect(() => createScenarioFromDraft(huge, { scenarioId: "too-large" })).toThrow(/8 MiB/);

    const before = scenario.steps[0]!;
    const edited = updateScenarioStepDraft(scenario, before.id, { ...before.draft, rawText: "x".repeat(SCENARIO_MAX_ACCOUNTED_BYTES) });
    expect(edited).toMatchObject({ ok: false, capacity: "bytes" });
    expect(scenario.steps[0]).toBe(before);
  });

  it("refuses duplicate, confirmed multi-add, and Run admission overflow atomically", () => {
    const sized = (id: string, bytes: number): ScenarioDraftInput => ({ ...input(id, "ADD", 1), rawText: "x".repeat(bytes) });
    const duplicateBase = createScenarioFromDraft(sized("duplicate", 5 * 1024 * 1024), { scenarioId: "duplicate-capacity" });
    expect(duplicateScenarioStep(duplicateBase, "step-1")).toMatchObject({ ok: false, capacity: "bytes" });
    expect(duplicateBase.steps).toHaveLength(1);

    let bulkBase = createScenarioFromDraft(sized("bulk-1", 3 * 1024 * 1024), { scenarioId: "bulk-capacity" });
    const second = addScenarioStep(bulkBase, sized("bulk-2", 3 * 1024 * 1024));
    if (!second.ok) throw new Error(second.reason);
    bulkBase = second.scenario;
    const preview = previewScenarioMembership(bulkBase, [
      { evidence: { intervalId: "interval-1", sequence: 3, eventId: "bulk-3" }, draft: sized("bulk-3", 1100 * 1024) },
      { evidence: { intervalId: "interval-1", sequence: 4, eventId: "bulk-4" }, draft: sized("bulk-4", 1100 * 1024) }
    ]);
    expect(confirmScenarioMembershipPreview(bulkBase, preview)).toMatchObject({ ok: false, capacity: "bytes" });
    expect(bulkBase.steps).toHaveLength(2);

    const runBase = createScenarioFromDraft(sized("run", 4 * 1024 * 1024), { scenarioId: "run-capacity" });
    expect(reviewScenario(runBase, { runId: "run-overflow", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] }))
      .toMatchObject({ ok: false, reason: expect.stringContaining("immutable plan") });
  });

  it("uses one Run-admission seam for immutable plan and worst-case append-only trace reservation", () => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const reviewed = reviewScenario(scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const admission = scenarioRunAdmission(scenario, reviewed.run);
    expect(admission).toMatchObject({ ok: true, stepCount: 1 });
    if (admission.ok) {
      expect(admission.traceReservationBytes).toBeGreaterThan(0);
      expect(admission.accountedBytes).toBe(reviewed.run.accountedBytes);
    }
  });

  it("keeps 100 independent representative 500-field Steps within the bounded document", () => {
    const fields = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field_${index}`, `value-${index}`]));
    const large = (id: string): ScenarioDraftInput => ({
      ...input(id, "ADD", 1),
      rawText: JSON.stringify({ command: "ADD", key: id, isSnapshot: false, fields }),
      document: { command: "ADD", key: id, isSnapshot: false, fields },
      editor: { ...input(id, "ADD", 1).editor, cursor: Number(id.replace("draft-", "")), serializedState: { undo: [id], folds: [10] } }
    });
    let scenario = createScenarioFromDraft(large("draft-1"), { scenarioId: "scenario-high-volume" });
    for (let index = 2; index <= 100; index += 1) {
      const addition = addScenarioStep(scenario, large(`draft-${index}`));
      if (!addition.ok) throw new Error(addition.reason);
      scenario = addition.scenario;
    }
    expect(scenario.steps).toHaveLength(100);
    expect(new Set(scenario.steps.map(({ id }) => id)).size).toBe(100);
    expect(new Set(scenario.steps.map(({ draft }) => draft)).size).toBe(100);
    expect(scenario.accountedBytes).toBeLessThan(SCENARIO_MAX_ACCOUNTED_BYTES);
    const moved = moveScenarioStep(scenario, "step-100", "earlier");
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.scenario.steps[98]).toMatchObject({ id: "step-100", draft: { editor: { cursor: 100, serializedState: { undo: ["draft-100"] } } } });
    }
  });

  it("reviews an immutable ordered plan and validates UPDATE against a preceding planned ADD", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, {
      runId: "run-1",
      committedEvidenceSeed: { intervalId: "interval-1", sequence: 41, eventId: "server-41" },
      targetFingerprint: "fingerprint-1",
      activeCommandKeysByItem: []
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
    expect(reviewScenario(added.scenario, { runId: "run-ordered", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] })).toMatchObject({ ok: true });
  });

  it("does not let a planned ADD on one item validate an UPDATE on another item", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const crossItem = {
      ...input("draft-2", "UPDATE", 2),
      item: { name: "other-orders", position: 2 },
      ready: false,
      diagnostics: [{ category: "semantic" as const, severity: "error" as const, code: "unknown-key-update", message: "Unknown key on this item." }]
    };
    const added = addScenarioStep(first, crossItem);
    if (!added.ok) throw new Error(added.reason);
    expect(reviewScenario(added.scenario, {
      runId: "run-cross-item",
      committedEvidenceSeed: null,
      targetFingerprint: "fp",
      activeCommandKeysByItem: []
    })).toMatchObject({ ok: false, stepId: "step-2", reason: "Unknown key on this item." });
  });

  it("validates planned ADD then DELETE only for the same item", () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const plannedDelete = {
      ...input("draft-2", "DELETE", 0),
      ready: false,
      diagnostics: [{ category: "semantic" as const, severity: "error" as const, code: "unknown-key-delete", message: "Unknown key." }]
    };
    const sameItem = addScenarioStep(first, plannedDelete);
    if (!sameItem.ok) throw new Error(sameItem.reason);
    expect(reviewScenario(sameItem.scenario, { runId: "same-item-delete", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] })).toMatchObject({ ok: true });

    const crossItem = addScenarioStep(first, { ...plannedDelete, item: { name: "other-orders", position: 2 } });
    if (!crossItem.ok) throw new Error(crossItem.reason);
    expect(reviewScenario(crossItem.scenario, { runId: "cross-item-delete", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] })).toMatchObject({ ok: false, stepId: "step-2" });
  });

  it("dispatches one Step, waits for Evidence settlement, then pauses with a correlated trace", async () => {
    const first = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(first, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, {
      runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fingerprint-1", activeCommandKeysByItem: []
    });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    let settle!: (value: { kind: "attempted"; outcome: ReturnType<typeof outcome>; evidence: { intervalId: string; sequence: number; eventId: string } }) => void;
    const execute = vi.fn(() => new Promise<{
      kind: "attempted";
      outcome: ReturnType<typeof outcome>;
      evidence: { intervalId: string; sequence: number; eventId: string };
    }>((resolve) => { settle = resolve; }));
    const pending = stepScenarioRun(reviewed.run, { execute, injectionId: "injection-1" });
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ stepId: "step-1", ordinal: 1, injectionId: "injection-1" }));
    settle({ kind: "attempted", outcome: outcome("DELIVERED LOCALLY", "delivered"), evidence: { intervalId: "interval-1", sequence: 42, eventId: "local-1" } });
    const next = await pending;
    expect(next).toMatchObject({ status: "paused", nextOrdinal: 2, trace: [{ stepId: "step-1", injectionId: "injection-1", evidence: { eventId: "local-1" } }] });
    expect(next.trace).toHaveLength(1);
  });

  it.each([
    ["partial delivery", "PARTIALLY DELIVERED", "partial", { intervalId: "interval-1", sequence: 99, eventId: "unexpected" }],
    ["unknown delivery", "DELIVERY UNKNOWN", "acknowledgement-unknown", null],
    ["review invalidation", "NOT RUN", "blocked", null],
    ["delivery without retained Evidence", "DELIVERED LOCALLY", "delivered", null]
  ] as const)("stops at the same ordinal after %s instead of advancing", async (_case, headline, disposition, evidence) => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(scenario, input("draft-2", "UPDATE", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
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
    const reviewed = reviewScenario(added.scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
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

  it("retains the complete settled outcome inside its admitted Trace reservation", async () => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const reviewed = reviewScenario(scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    const run = await stepScenarioRun(reviewed.run, {
      injectionId: "injection-1",
      execute: async () => ({
        kind: "attempted" as const,
        outcome: { ...outcome("DELIVERED LOCALLY", "delivered"), detail: "external-detail".repeat(800) },
        evidence: { intervalId: "interval-1", sequence: 1, eventId: "local-1" }
      })
    });
    expect(run.trace[0]).toMatchObject({ kind: "attempted", outcome: { detail: "external-detail".repeat(800) } });
    expect(new TextEncoder().encode(JSON.stringify(run.trace[0])).byteLength).toBeLessThanOrEqual(run.traceReservationBytes);
  });

  it("atomically refuses a definition mutation against retained Run bytes", () => {
    const scenario = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const retainedRunBytes = SCENARIO_MAX_ACCOUNTED_BYTES - scenario.accountedBytes - 1;
    const result = duplicateScenarioStep(scenario, "step-1", { retainedRunBytes });
    expect(result).toMatchObject({ ok: false, capacity: "bytes" });
    expect(scenario.steps).toHaveLength(1);
  });

  it("terminalizes an abandoned paused Run with exact NOT RUN remainder", async () => {
    const initial = createScenarioFromDraft(input("draft-1", "ADD", 1), { scenarioId: "scenario-1" });
    const added = addScenarioStep(initial, input("draft-2", "ADD", 2));
    if (!added.ok) throw new Error(added.reason);
    const reviewed = reviewScenario(added.scenario, { runId: "run-1", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
    if (!reviewed.ok) throw new Error(reviewed.reason);
    const paused = await stepScenarioRun(reviewed.run, {
      injectionId: "injection-1",
      execute: async () => ({ kind: "attempted" as const, outcome: outcome("DELIVERED LOCALLY", "delivered"), evidence: { intervalId: "i", sequence: 1, eventId: "e" } })
    });
    const archived = terminalizeScenarioRun(paused, 9);
    expect(archived.status).toBe("stopped");
    expect(archived.trace).toEqual([
      expect.objectContaining({ kind: "attempted", stepId: "step-1" }),
      expect.objectContaining({ kind: "not-run", stepId: "step-2", timestamp: 9, evidence: null })
    ]);
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
