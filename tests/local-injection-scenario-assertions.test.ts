import { describe, expect, it } from "vitest";

import {
  evaluateScenarioCheckpoint,
  validateScenarioCheckpoint,
  type ScenarioAssertionObservation,
  type ScenarioCommittedBoundarySnapshot
} from "../src/core/local-injection-scenario-checkpoint";
import type { ScenarioCheckpoint } from "../src/core/local-injection-scenario";
import {
  addScenarioCheckpoint,
  addScenarioStep,
  createScenarioFromDraft,
  moveScenarioMember,
  removeScenarioCheckpoint,
  reviewScenario,
  SCENARIO_CHECKPOINT_ASSERTION_TRACE_RESERVATION_BYTES,
  SCENARIO_MAX_RECORDED_ASSERTION_STRING_BYTES,
  type ScenarioDraftInput
} from "../src/core/local-injection-scenario";

const boundary = { intervalId: "interval-1", sequence: 12, eventId: "evidence-12" } as const;

function snapshot(overrides: Partial<ScenarioCommittedBoundarySnapshot> = {}): ScenarioCommittedBoundarySnapshot {
  return Object.freeze({
    boundary,
    intervalId: "interval-1",
    retainedRange: { first: { intervalId: "interval-1", sequence: 1, eventId: "evidence-1" }, last: boundary },
    history: "accepting",
    projection: "live",
    ...overrides
  });
}

function checkpoint(assertions: ScenarioCheckpoint["assertions"]): ScenarioCheckpoint {
  return Object.freeze({ id: "checkpoint-1", kind: "checkpoint", name: "Order committed", assertions });
}

describe("Scenario Checkpoints", () => {
  it("authors stable zero-Injection members, revisions Review, and counts only Injection Steps", () => {
    const target = { pageEpoch: "page", clientId: "client", sessionId: "session", subscriptionId: "sub", deliveryPath: "listener" as const, listenerId: "listener", mode: "COMMAND", schemaFields: ["command", "key"] };
    const draft: ScenarioDraftInput = {
      id: "draft-1", sourceEventId: null, sourceRawText: null,
      rawText: JSON.stringify({ command: "ADD", key: "order-1", fields: { command: "ADD", key: "order-1" } }),
      document: { command: "ADD", key: "order-1", isSnapshot: false, fields: { command: "ADD", key: "order-1" } },
      ready: true, diagnostics: [], target, item: { name: "orders", position: 1 },
      editor: { cursor: 0, selectionFrom: 0, selectionTo: 0, scrollTop: 0, scrollLeft: 0, compareOpen: false, serializedState: null },
      restorationOrigin: { scopeId: null, selectionEventId: null, focusedEventId: null, contextId: null }, relativeDelayMs: 0
    };
    const initial = createScenarioFromDraft(draft, { scenarioId: "scenario-1" });
    const added = addScenarioCheckpoint(initial, {
      id: "checkpoint-1", kind: "checkpoint", name: "Order exists",
      assertions: [{ id: "assertion-1", kind: "correlated-local-evidence-exists", stepId: "step-1" }]
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.scenario.steps).toHaveLength(1);
    expect(added.scenario.members.map(({ kind, id }) => [kind, id])).toEqual([["step", "step-1"], ["checkpoint", "checkpoint-1"]]);
    const moved = moveScenarioMember(added.scenario, "checkpoint-1", "earlier");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.scenario.members[0]?.id).toBe("checkpoint-1");
    expect(reviewScenario(moved.scenario, { runId: "invalid", committedEvidenceSeed: boundary, targetFingerprint: "fp", activeCommandKeysByItem: [] }))
      .toMatchObject({ ok: false, reason: "Checkpoint assertions may reference only an earlier Scenario Step." });

    const removed = removeScenarioCheckpoint(moved.scenario, "checkpoint-1");
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.scenario.members).toHaveLength(1);
  });
  it("rejects diagnostic assertions, future Step references, invalid within windows, and listener counts on wire", () => {
    expect(validateScenarioCheckpoint(null as never, {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<checkpoint>", reason: "Scenario Checkpoint must be an object." });
    expect(validateScenarioCheckpoint({ kind: "checkpoint", id: "", name: "Invalid identity", assertions: [] } as never, {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<checkpoint>", reason: "Scenario Checkpoint requires a non-empty stable identity and checkpoint kind." });
    expect(validateScenarioCheckpoint({ kind: "step", id: "checkpoint-1", name: 42, assertions: null } as never, {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<checkpoint>", reason: "Scenario Checkpoint requires a non-empty stable identity and checkpoint kind." });
    expect(validateScenarioCheckpoint({ kind: "checkpoint", id: "checkpoint-1", name: 42, assertions: [] } as never, {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<checkpoint>", reason: "Scenario Checkpoint name must contain 1 to 256 characters." });
    expect(validateScenarioCheckpoint({ kind: "checkpoint", id: "checkpoint-1", name: "Invalid assertions", assertions: null } as never, {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<checkpoint>", reason: "A Scenario Checkpoint requires 1 to 16 assertions." });
    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "correlated-local-evidence-exists", stepId: "step-2" }]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Checkpoint assertions may reference only an earlier Scenario Step." });

    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "listener-count", stepId: "step-1", count: "delivered", expected: 1 }]), {
      targetMode: "COMMAND", deliveryPath: "wire", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Wire delivery does not expose listener counts; this assertion is unavailable." });

    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-1", expected: "present", withinActiveMs: 0 }]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "within must be a finite active-time duration from 1 to 300000 ms." });

    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "diagnostic-presence" } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Unsupported Scenario Assertion kind." });

    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "prior-injection-outcome", stepId: "step-1", expectedDisposition: "unknown" } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Injection Outcome expectation is unsupported." });
    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "listener-count", stepId: "step-1", count: "guessed", expected: 1 } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Listener count must select attempted or delivered." });
    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-1", expected: "maybe" } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "COMMAND key expectation must select present or absent." });
    expect(validateScenarioCheckpoint(checkpoint([null] as never), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "<missing>", reason: "Scenario Assertion must be an object." });
    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "correlated-local-evidence-exists" } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "Checkpoint assertions may reference only an earlier Scenario Step." });
    expect(validateScenarioCheckpoint(checkpoint([{ id: "a", kind: "command-key-exists", item: { name: 42, position: null }, key: "order-1", expected: "present" } as never]), {
      targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step-1"]
    })).toEqual({ ok: false, assertionId: "a", reason: "COMMAND assertion requires an exact item name or positive item position." });
  });

  it("compares JSON primitives by exact type and distinguishes own absence from concrete null", () => {
    const assertions = checkpoint([
      { id: "same", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "qty", expected: 1 },
      { id: "null", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "note", expected: null },
      { id: "absent", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "missing", expected: null }
    ]);
    const observations: ScenarioAssertionObservation = {
      priorOutcomes: new Map(),
      correlatedLocalEvidence: new Map(),
      inspectCommand: ({ field }) => field === "qty"
        ? { state: "concrete", value: 1, certainty: "certain", provenance: "correlated-local", evidence: boundary }
        : field === "note"
          ? { state: "concrete", value: null, certainty: "certain", provenance: "correlated-local", evidence: boundary }
          : { state: "field-absent", certainty: "certain", provenance: "correlated-local", evidence: boundary }
    };
    const result = evaluateScenarioCheckpoint(assertions, snapshot(), observations, 25);
    expect(result.assertions.map(({ status }) => status)).toEqual(["pass", "pass", "fail"]);
    expect(result.assertions[2]).toMatchObject({ observed: { state: "field-absent" } });

    const mismatch = evaluateScenarioCheckpoint(checkpoint([
      { id: "typed", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "qty", expected: "1" }
    ]), snapshot(), observations, 25);
    expect(mismatch.assertions[0]).toMatchObject({ status: "fail", observed: { state: "concrete", value: 1 } });
  });

  it("treats ambiguous server null as not evaluable and correlated Local null as concrete", () => {
    const assertion = checkpoint([{ id: "null", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "note", expected: null }]);
    const common = { priorOutcomes: new Map(), correlatedLocalEvidence: new Map() };
    expect(evaluateScenarioCheckpoint(assertion, snapshot(), {
      ...common,
      inspectCommand: () => ({ state: "ambiguous-server-null", certainty: "ambiguous", provenance: "server", evidence: boundary })
    }, 0).assertions[0]?.status).toBe("not-evaluable");
    expect(evaluateScenarioCheckpoint(assertion, snapshot(), {
      ...common,
      inspectCommand: () => ({ state: "concrete", value: null, certainty: "certain", provenance: "correlated-local", evidence: boundary })
    }, 0).assertions[0]?.status).toBe("pass");
  });

  it("bounds a near-limit observed primitive in the persistent Trace without changing comparison truth", () => {
    const observedValue = "🧭".repeat(3 * 1024 * 1024);
    const evaluation = evaluateScenarioCheckpoint(checkpoint([
      { id: "large", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "payload", expected: "different" }
    ]), snapshot(), {
      priorOutcomes: new Map(),
      correlatedLocalEvidence: new Map(),
      inspectCommand: () => ({ state: "concrete", value: observedValue, certainty: "certain", provenance: "local-effective", evidence: boundary })
    }, 0);

    expect(evaluation.status).toBe("fail");
    expect(evaluation.assertions[0]?.observed.valueLimited).toMatchObject({
      originalBytes: new TextEncoder().encode(observedValue).byteLength,
      retainedBytes: SCENARIO_MAX_RECORDED_ASSERTION_STRING_BYTES,
      comparison: "different"
    });
    expect(new TextEncoder().encode(String(evaluation.assertions[0]?.observed.value)).byteLength).toBeLessThanOrEqual(SCENARIO_MAX_RECORDED_ASSERTION_STRING_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(evaluation)).byteLength).toBeLessThan(SCENARIO_CHECKPOINT_ASSERTION_TRACE_RESERVATION_BYTES);

    const equal = evaluateScenarioCheckpoint(checkpoint([
      { id: "large-equal", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "payload", expected: observedValue }
    ]), snapshot(), {
      priorOutcomes: new Map(), correlatedLocalEvidence: new Map(),
      inspectCommand: () => ({ state: "concrete", value: observedValue, certainty: "certain", provenance: "local-effective", evidence: boundary })
    }, 0);
    expect(equal.assertions[0]).toMatchObject({ status: "pass", observed: { valueLimited: { comparison: "equal" } } });
  });

  it("keeps eventual assertions waiting as a conjunction until one common committed boundary satisfies all", () => {
    const assertions = checkpoint([
      { id: "evidence", kind: "correlated-local-evidence-exists", stepId: "step-1", withinActiveMs: 500 },
      { id: "key", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-1", expected: "present", withinActiveMs: 500 }
    ]);
    const result = evaluateScenarioCheckpoint(assertions, snapshot(), {
      priorOutcomes: new Map(),
      correlatedLocalEvidence: new Map([["step-1", boundary]]),
      inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: boundary })
    }, 100);
    expect(result.status).toBe("waiting");
    expect(result.assertions.map(({ status }) => status)).toEqual(["waiting", "waiting"]);
    expect(result.boundary).toEqual(boundary);
    const expired = evaluateScenarioCheckpoint(checkpoint([
      { id: "first", kind: "correlated-local-evidence-exists", stepId: "step-1", withinActiveMs: 50 },
      { id: "second", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-1", expected: "present", withinActiveMs: 100 }
    ]), snapshot(), {
      priorOutcomes: new Map(), correlatedLocalEvidence: new Map(),
      inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: boundary })
    }, 50, 0);
    expect(expired).toMatchObject({
      status: "expired",
      assertions: [
        { assertionId: "first", status: "expired" },
        { assertionId: "second", status: "waiting" }
      ]
    });
    const commonBoundaryMiss = evaluateScenarioCheckpoint(checkpoint([
      { id: "short", kind: "correlated-local-evidence-exists", stepId: "step-1", withinActiveMs: 50 },
      { id: "long", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-1", expected: "present", withinActiveMs: 100 }
    ]), snapshot(), {
      priorOutcomes: new Map(), correlatedLocalEvidence: new Map([["step-1", boundary]]),
      inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: boundary })
    }, 50, 0);
    expect(commonBoundaryMiss).toMatchObject({
      status: "expired",
      assertions: [
        { assertionId: "short", status: "expired" },
        { assertionId: "long", status: "waiting" }
      ]
    });
  });

  it("fails closed when History or projection cannot supply an applied committed boundary", () => {
    const assertion = checkpoint([{ id: "evidence", kind: "correlated-local-evidence-exists", stepId: "step-1" }]);
    const observations = { priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: boundary } as const) };
    expect(evaluateScenarioCheckpoint(assertion, snapshot({ history: "unavailable" }), observations, 0).status).toBe("unavailable");
    expect(evaluateScenarioCheckpoint(assertion, snapshot({ projection: "recovering" }), observations, 0).status).toBe("unavailable");
  });

  it("reviews 100 independent Steps and 100 collapsed Checkpoints within the bounded document", () => {
    const target = { pageEpoch: "page", clientId: "client", sessionId: "session", subscriptionId: "sub", deliveryPath: "listener" as const, listenerId: "listener", mode: "COMMAND", schemaFields: ["command", "key", "qty"] };
    const makeDraft = (index: number): ScenarioDraftInput => {
      const command = "ADD" as const;
      const fields = Object.fromEntries(Array.from({ length: 500 }, (_, field) => [`field_${field}`, `value-${index}-${field}`]));
      const document = { command, key: `order-${index}`, isSnapshot: false, fields: { command, key: `order-${index}`, ...fields } };
      return { id: `draft-${index}`, sourceEventId: null, sourceRawText: null, rawText: JSON.stringify(document), document, ready: true, diagnostics: [], target, item: { name: "orders", position: 1 }, editor: { cursor: index, selectionFrom: index, selectionTo: index, scrollTop: 0, scrollLeft: 0, compareOpen: false, serializedState: null }, restorationOrigin: { scopeId: null, selectionEventId: null, focusedEventId: null, contextId: null }, relativeDelayMs: 0 };
    };
    const started = performance.now();
    let scenario = createScenarioFromDraft(makeDraft(1), { scenarioId: "high-volume" });
    for (let index = 1; index <= 100; index += 1) {
      if (index > 1) {
        const step = addScenarioStep(scenario, makeDraft(index));
        if (!step.ok) throw new Error(step.reason);
        scenario = step.scenario;
      }
      const added = addScenarioCheckpoint(scenario, { id: `checkpoint-${index}`, kind: "checkpoint", name: `Checkpoint ${index}`, assertions: [{ id: `assertion-${index}`, kind: "correlated-local-evidence-exists", stepId: `step-${index}` }] });
      if (!added.ok) throw new Error(added.reason);
      scenario = added.scenario;
    }
    const reviewed = reviewScenario(scenario, { runId: "high-volume-run", committedEvidenceSeed: boundary, targetFingerprint: "fp", activeCommandKeysByItem: [] });
    if (!reviewed.ok) throw new Error(`${reviewed.reason} scenario=${scenario.accountedBytes}`);
    expect(scenario.steps).toHaveLength(100);
    expect(scenario.members).toHaveLength(200);
    expect(reviewed.run.members).toHaveLength(200);
    expect(scenario.accountedBytes).toBeLessThan(8 * 1024 * 1024);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
