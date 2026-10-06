import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { AGENT_TOOLS, validateAgentCall } from "../src/agent/protocol";
import { compactAgentSchema } from "../src/agent/schema-compaction";
import { validateScenarioCheckpoint, SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT, SCENARIO_MAX_ASSERTION_ACTIVE_MS, SCENARIO_MAX_MEMBER_ID_LENGTH, SCENARIO_MAX_CHECKPOINT_NAME_LENGTH } from "../src/core/local-injection-scenario-checkpoint";
const ajv = () => new Ajv({ strict: false });
const checkpoint = (assertion: Record<string, unknown>) => ({ kind: "checkpoint" as const, id: "check", name: "Check", assertions: [assertion] });
const assertion = { id: "assert", kind: "correlated-local-evidence-exists", stepId: "step", withinActiveMs: 1 };
const args = (check: unknown) => ({ panelSessionId: "panel", pageEpoch: "epoch", members: [{ kind: "step", id: "step", scopeId: "scope" }, check] });
const validateCheckpoint = (check: unknown) => validateScenarioCheckpoint(check as Parameters<typeof validateScenarioCheckpoint>[0], { targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: ["step"] });

describe("canonical agent protocol closure", () => {
  it("publishes independently resolvable schemas and rejects empty success results for every tool", () => {
    for (const tool of AGENT_TOOLS) {
      const validateInput = ajv().compile(tool.inputSchema);
      const validateOutput = ajv().compile(tool.outputSchema);
      expect(validateInput, tool.name).toBeTypeOf("function");
      expect(validateOutput({}), tool.name).toBe(false);
      expect(validateOutput({ error: { code: "QUERY_FAILED", message: "failure", automaticRetry: false } }), tool.name).toBe(true);
      expect(validateOutput({ error: {} }), tool.name).toBe(false);
    }
  });
  it("agrees at active duration, checkpoint name, assertion ID and assertion count endpoints", () => {
    for (const withinActiveMs of [1, 1.5, SCENARIO_MAX_ASSERTION_ACTIVE_MS]) {
      const check = checkpoint({ ...assertion, withinActiveMs });
      expect(validateCheckpoint(check)).toEqual({ ok: true });
      expect(() => validateAgentCall("validate_agent_candidate", args(check))).not.toThrow();
    }
    const check = { ...checkpoint({ ...assertion, id: "a".repeat(SCENARIO_MAX_MEMBER_ID_LENGTH) }), name: "n".repeat(SCENARIO_MAX_CHECKPOINT_NAME_LENGTH) };
    expect(validateCheckpoint(check)).toEqual({ ok: true });
    expect(() => validateAgentCall("prepare_scenario", args(check))).not.toThrow();
    const many = { ...check, assertions: Array.from({ length: SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT }, (_, i) => ({ ...assertion, id: `a${i}` })) };
    expect(validateCheckpoint(many)).toEqual({ ok: true });
    expect(() => validateAgentCall("validate_agent_candidate", args(many))).not.toThrow();
  });
  it("rejects the same canonical invalid bounds and structural assertions", () => {
    const checks = [checkpoint({ ...assertion, withinActiveMs: 0 }), checkpoint({ ...assertion, withinActiveMs: SCENARIO_MAX_ASSERTION_ACTIVE_MS + 1 }), checkpoint({ ...assertion, id: "a".repeat(SCENARIO_MAX_MEMBER_ID_LENGTH + 1) }), { ...checkpoint(assertion), name: "n".repeat(SCENARIO_MAX_CHECKPOINT_NAME_LENGTH + 1) }, { ...checkpoint(assertion), name: " " }, { ...checkpoint(assertion), assertions: [] }, { ...checkpoint(assertion), assertions: Array.from({ length: SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT + 1 }, (_, i) => ({ ...assertion, id: `a${i}` })) }, checkpoint({ id: "a", kind: "command-key-exists", item: { name: null, position: 0 }, key: "k", expected: "present" })];
    for (const check of checks) {
      expect(validateCheckpoint(check).ok).toBe(false);
      expect(() => validateAgentCall("validate_agent_candidate", args(check))).toThrow();
    }
  });
  it("budgets typed and legacy documents equally across authoring and validation tools", () => {
    const document = { command: "ADD", key: "k", isSnapshot: false, fields: { value: '"'.repeat(20_000) } };
    const oversized = { ...document, fields: { value: "x".repeat(65_536) } };
    for (const candidate of [document, JSON.stringify(document)]) {
      expect(() => validateAgentCall("prepare_local_injection", { panelSessionId: "panel", pageEpoch: "epoch", document: candidate })).not.toThrow();
      expect(() => validateAgentCall("validate_agent_candidate", { panelSessionId: "panel", pageEpoch: "epoch", draft: { scopeId: "scope", document: candidate } })).not.toThrow();
    }
    for (const candidate of [oversized, JSON.stringify(oversized)]) {
      expect(() => validateAgentCall("validate_agent_candidate", { panelSessionId: "panel", pageEpoch: "epoch", draft: { scopeId: "scope", document: candidate } })).toThrow();
      expect(() => validateAgentCall("generate_agent_candidates", { panelSessionId: "panel", pageEpoch: "epoch", base: { scopeId: "scope", document: candidate } })).toThrow();
    }
  });
  it("rejects malformed nested delivery, identity, target and verdict contracts", () => {
    const samples: Record<string, unknown> = {
      get_operation: { state: "complete", outcome: {}, evidence: { state: "committed", reference: {}, identity: {} }, correlation: {} },
      execute_local_injection: { state: "complete", outcome: {}, evidence: { state: "committed", reference: {}, identity: {} }, correlation: {} },
      validate_agent_candidate: { valid: true, pageEpoch: "epoch", target: {}, candidates: [{}], checkpoints: [], limitations: [] },
      get_scope: { node: {}, pageEpoch: "epoch", localInjection: { anchor: {}, capabilities: {} } },
      get_evidence: { readPoint: {}, coverage: "COMPLETE", lookup: { state: "RETAINED", evidence: {} } },
      get_scenario_trace: { phase: "review", scenarioId: "scenario", revision: 1, offset: 0, totalSteps: 1, totalMembers: 1, totalTrace: 0, nextOffset: null, members: [], steps: [], run: {}, runner: null, progressRevision: 0, pageEpoch: "epoch" }
    };
    for (const [name, value] of Object.entries(samples)) expect(ajv().compile(AGENT_TOOLS.find(tool => tool.name === name)!.outputSchema)(value), name).toBe(false);
  });
  it("requires typed completed Server outcomes while preserving prepared and pending receipts", () => {
    const completed = { requestId: "request", state: "complete", outcome: { requestId: "message", ok: true, status: "processed", timestamp: 1 } };
    const validate = ajv().compile(AGENT_TOOLS.find(tool => tool.name === "execute_server_injection")!.outputSchema);
    expect(validate(completed)).toBe(true);
    expect(validate({ ...completed, outcome: {} })).toBe(false);
    expect(validate({ requestId: "request", state: "complete" })).toBe(false);
    expect(validate({ requestId: "request", state: "pending" })).toBe(true);
    const recover = ajv().compile(AGENT_TOOLS.find(tool => tool.name === "recover_server_injection")!.outputSchema);
    expect(recover({ ...completed, token: "token", approvalRequired: true })).toBe(true);
    expect(recover({ ...completed, outcome: {}, token: "token", approvalRequired: true })).toBe(false);
    expect(recover({ state: "prepared", token: "token", approvalRequired: true, outcome: null })).toBe(true);
  });
  it("requires outcomes in compact completed Local and nested Server receipts", () => {
    const pending = { requestId: "request", state: "pending", detailsOmitted: "compact" };
    const complete = { ...pending, state: "complete" };
    const localOutcome = { disposition: "delivered", status: "success", executionId: "execution", requestId: "request", timestamp: 1 };
    const serverOutcome = { requestId: "request", ok: true, status: "processed", timestamp: 1 };
    const wait = (operation: unknown) => ({ status: "COMPLETE", requestId: "request", completionBoundary: "LOCAL_INJECTION_RECEIPT", operation });
    for (const validator of [new Ajv({ strict: false }), new Ajv2020({ strict: false })]) {
      for (const name of ["execute_local_injection", "get_operation", "wait_for_operation"]) {
        const validate = validator.compile(AGENT_TOOLS.find(tool => tool.name === name)!.outputSchema);
        const wrap = name === "wait_for_operation" ? wait : (operation: unknown) => operation;
        expect(validate(wrap(pending)), name).toBe(true);
        expect(validate(wrap(complete)), name).toBe(false);
        expect(validate(wrap({ ...complete, outcome: {} })), name).toBe(false);
        expect(validate(wrap({ ...complete, outcome: localOutcome })), name).toBe(true);
      }
      const operation = validator.compile(AGENT_TOOLS.find(tool => tool.name === "get_operation")!.outputSchema);
      const serverComplete = { requestId: "request", state: "complete", approvalRequired: true };
      expect(operation(serverComplete)).toBe(false);
      expect(operation({ ...serverComplete, outcome: {} })).toBe(false);
      expect(operation({ ...serverComplete, outcome: serverOutcome })).toBe(true);
      expect(operation({ ...serverComplete, state: "pending" })).toBe(true);
    }
  });
  it("preserves conditional, nested, finite-pattern and cardinality rules in closed unions", () => {
    const shared = { type: "string", minLength: 1, maxLength: 256 };
    const branch = (kind: string) => ({ type: "object", properties: { kind: { const: kind }, a: shared, b: shared, c: shared }, required: ["kind", "a"], additionalProperties: false });
    const first = branch("first"), second = branch("second");
    const values = [null, {}, { kind: "first", a: "x" }, { kind: "first", a: "x", b: "x" }, { kind: "first", a: "x", b: "x", c: "x" }, { kind: "first", a: "x", extra: "x" }, { kind: "second", a: "x" }];
    const fixtures = [
      { oneOf: [{ ...first, if: { properties: { kind: { const: "first" } } }, then: { required: ["b"] } }, second] },
      { oneOf: [{ ...first, oneOf: [{ required: ["b"] }, { required: ["c"] }] }, second] },
      { oneOf: [{ ...first, patternProperties: { "^(extra|also)$": shared } }, second] },
      { oneOf: [{ ...first, minProperties: 3 }, second] },
      { oneOf: [{ ...first, required: ["kind", "a", "b", "c"], minProperties: 5 }, second] },
      { oneOf: [{ ...first, maxProperties: 2 }, second] },
      { type: "object", required: ["b"], oneOf: [first, second] },
      { type: "object", minProperties: 3, oneOf: [first, second] },
      { type: "object", maxProperties: 2, oneOf: [first, second] },
      { type: "object", patternProperties: { "^(a|b)$": { minLength: 2 } }, oneOf: [first, second] },
      { type: "object", if: { properties: { kind: { const: "first" } } }, then: { required: ["c"] }, oneOf: [first, second] },
      { type: "object", not: { required: ["c"] }, oneOf: [first, second] }
    ];
    for (const original of fixtures) for (const validator of [new Ajv({ strict: false }), new Ajv2020({ strict: false })]) {
      const input = JSON.stringify(original);
      const before = validator.compile(original), after = validator.compile(compactAgentSchema(original));
      expect(JSON.stringify(original)).toBe(input);
      for (const value of values) expect(after(value), input).toBe(before(value));
    }
  });
  it("compacts reusable fragments without changing accepted object unions", () => {
    const shared = { type: "string", minLength: 1, maxLength: 256 };
    const original = { oneOf: [
      { type: "object", properties: { id: shared, name: shared, kind: { const: "step" }, delay: { type: "integer", minimum: 0 } }, required: ["id", "kind", "delay"], additionalProperties: false },
      { type: "object", properties: { id: shared, name: shared, kind: { const: "checkpoint" }, ready: { type: "boolean" } }, required: ["id", "kind", "ready"], additionalProperties: false }
    ] };
    const compact = compactAgentSchema(original);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(original).length);
    const before = ajv().compile(original), after = ajv().compile(compact);
    for (const value of [{}, null, [], { id: "a", kind: "step", delay: 0 }, { id: "a", name: "Name", kind: "checkpoint", ready: true }, { id: "a", kind: "checkpoint", delay: 0, ready: true }, { id: "a", kind: "step", delay: -1 }, { id: "a", kind: "step", delay: 0, unknown: 1 }]) expect(after(value)).toBe(before(value));
  });
  it("preserves overlapping numeric choices and parent types while compacting disjoint nullable choices", () => {
    const fixtures = [
      { schema: { oneOf: [{ type: "integer" }, { type: "number" }] }, accepted: [1.5], rejected: [1, "x", null] },
      { schema: { type: "integer", oneOf: [{ type: "integer" }, { type: "string" }] }, accepted: [1], rejected: [1.5, "x", null] },
      { schema: { type: "integer", oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] }, accepted: [1], rejected: [-1, 1.5, null] },
      { schema: { type: "integer", anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] }, accepted: [1], rejected: [-1, 1.5, null] }
    ];
    for (const { schema, accepted, rejected } of fixtures) for (const validator of [new Ajv({ strict: false }), new Ajv2020({ strict: false })]) {
      const before = validator.compile(schema), after = validator.compile(compactAgentSchema(schema));
      for (const value of accepted) { expect(before(value)).toBe(true); expect(after(value)).toBe(true); }
      for (const value of rejected) { expect(before(value)).toBe(false); expect(after(value)).toBe(false); }
    }
    for (const schema of [
      { oneOf: [{ type: "integer" }, { type: "null" }] },
      { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
      { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] }
    ]) {
      const compact = compactAgentSchema(schema);
      expect(compact).toHaveProperty("type", ["integer", "null"]);
      expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length);
      for (const validator of [new Ajv({ strict: false }), new Ajv2020({ strict: false })]) {
        const before = validator.compile(schema), after = validator.compile(compact);
        for (const value of [1, 1.5, -1, null, "x", false]) expect(after(value)).toBe(before(value));
      }
    }
  });
});
