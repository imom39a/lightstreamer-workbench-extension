import { describe, expect, it } from "vitest";
import { expandLocalInjectionCandidateMatrix, type LocalInjectionCandidateMatrixInput } from "../src/core/local-injection-candidate-matrix";

const input = (): LocalInjectionCandidateMatrixInput => ({
  target: { pageEpoch: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1", deliveryPath: "listener", listenerId: "listener-1", mode: "COMMAND", schemaFields: ["command", "key", "value"] },
  document: { command: "UPDATE", key: "original", isSnapshot: false, fields: { command: "UPDATE", key: "original", value: "captured" } },
  fieldValueStates: { command: "concrete", key: "concrete", value: "concrete" }, key: "fresh",
  commands: ["ADD", "UPDATE", "DELETE"], assignments: { value: [null, ""] }, delaysMs: [0, 10]
});

describe("deterministic candidate matrix", () => {
  it("expands bounded explicit keys before assignments, delays and command order", () => {
    const source = { ...input(), key: undefined, keys: ["alpha", "beta"] };
    const expanded = expandLocalInjectionCandidateMatrix(source);
    expect(expanded.members).toHaveLength(24);
    expect(expanded.members.map(member => member.document.key)).toEqual([...Array(12).fill("alpha"), ...Array(12).fill("beta")]);
    expect(expanded.members[12]?.document.fields.key).toBe("beta");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, key: "other" })).toThrow("not both");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, keys: [] })).toThrow("one to 32");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, keys: Array(33).fill("a") })).toThrow("one to 32");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, keys: Array(9).fill("a") })).toThrow("100-Step");
  });

  it("expands a stable immutable exact-target preview and leaves the input unchanged", () => {
    const source = input();
    const before = JSON.stringify(source);
    const expanded = expandLocalInjectionCandidateMatrix(source);
    expect(expanded).toEqual(expandLocalInjectionCandidateMatrix(source));
    expect(expanded.members).toHaveLength(12);
    expect(expanded.members.slice(0, 3).map(member => [member.document.command, member.document.key, member.document.fields.value, member.delayMs])).toEqual([["ADD", "fresh", null, 0], ["UPDATE", "fresh", null, 0], ["DELETE", "fresh", null, 0]]);
    expect(expanded.members[3]?.delayMs).toBe(10);
    expect(expanded.members[6]?.document.fields.value).toBe("");
    expect(expanded.target).toEqual(source.target);
    expect(Object.isFrozen(expanded.members[0]?.document.fields)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("requires explicit concrete replacements for uncertain values", () => {
    const source = input();
    const uncertain = { ...source, assignments: undefined, fieldValueStates: { ...source.fieldValueStates, value: "redacted" as const } };
    expect(() => expandLocalInjectionCandidateMatrix(uncertain)).toThrow("explicit concrete replacement");
    expect(expandLocalInjectionCandidateMatrix({ ...uncertain, assignments: { value: ["replacement"] } }).members[0]?.fieldValueStates.value).toBe("concrete");
  });

  it("rejects unsupported or ambiguous target schemas and invalid parameter values", () => {
    const source = input();
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, target: { ...source.target, mode: "RAW" } })).toThrow("exact supported");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, target: { ...source.target, sessionId: null } })).toThrow("exact supported");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, assignments: { unknown: [1] } })).toThrow("declared");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, assignments: { value: [] } })).toThrow("one to 32");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, assignments: { value: [Number.NaN] } })).toThrow("supported values");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, assignments: { value: [{ x: undefined } as never] }, jsonStringFields: ["value"] })).toThrow("supported values");
  });

  it("enforces expanded Step, delay and byte bounds before returning a preview", () => {
    const source = input();
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, delaysMs: Array.from({ length: 17 }, (_, i) => i) })).toThrow("100-Step");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, delaysMs: [-1] })).toThrow("Delays");
    expect(() => expandLocalInjectionCandidateMatrix({ ...source, commands: ["ADD"], delaysMs: [0], assignments: { value: ["x".repeat(8 * 1024 * 1024)] } })).toThrow("8 MiB");
  });

  it("supports exact non-COMMAND fields while refusing a command sequence", () => {
    const source = input();
    const merge = { ...source, target: { ...source.target, mode: "MERGE", schemaFields: ["value"] }, document: { command: null, key: null, isSnapshot: true, fields: { value: "old" } }, commands: undefined, key: undefined };
    expect(expandLocalInjectionCandidateMatrix(merge).members[0]?.document).toEqual({ command: null, key: null, isSnapshot: true, fields: { value: null } });
    expect(() => expandLocalInjectionCandidateMatrix({ ...merge, commands: ["ADD"] })).toThrow("only to COMMAND");
    const ordinaryNames = { ...merge, target: { ...merge.target, schemaFields: ["command", "key"] }, document: { command: null, key: null, isSnapshot: false, fields: { command: "ordinary", key: "ordinary" } }, assignments: { command: ["value"], key: ["field"] } };
    expect(expandLocalInjectionCandidateMatrix(ordinaryNames).members[0]?.document).toEqual({ command: null, key: null, isSnapshot: false, fields: { command: "value", key: "field" } });
  });
});
