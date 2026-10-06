import type { ItemUpdateFieldValueState } from "./event-envelope";
import type { LocalInjectionDocument } from "./local-injection-document";
import type { ExpandedJsonStringFieldValue } from "./json-string-fields";
import { SCENARIO_MAX_ACCOUNTED_BYTES, SCENARIO_MAX_STEPS, type ScenarioTarget } from "./local-injection-scenario";

export type LocalInjectionCandidateMatrixInput = Readonly<{
  target: ScenarioTarget;
  document: LocalInjectionDocument;
  fieldValueStates: Readonly<Record<string, ItemUpdateFieldValueState>>;
  jsonStringFields?: readonly string[];
  key?: string;
  keys?: readonly string[];
  commands?: readonly ("ADD" | "UPDATE" | "DELETE")[];
  assignments?: Readonly<Record<string, readonly ExpandedJsonStringFieldValue[]>>;
  delaysMs?: readonly number[];
}>;

export type LocalInjectionCandidateMatrix = Readonly<{
  version: 1;
  target: ScenarioTarget;
  members: readonly Readonly<{ id: string; document: Readonly<LocalInjectionDocument>; delayMs: number; fieldValueStates: Readonly<Record<string, ItemUpdateFieldValueState>> }>[];
  limitations: readonly string[];
}>;

/** A deterministic expander, not a validator or executor. The caller resolves the
 * exact source/Scope and performs ordinary whole-plan validation before preparation. */
export function expandLocalInjectionCandidateMatrix(input: LocalInjectionCandidateMatrixInput): LocalInjectionCandidateMatrix {
  const fail = (reason: string): never => { throw new Error(`INVALID_CANDIDATE_MATRIX: ${reason}`); };
  if (!input.target.pageEpoch || !input.target.subscriptionId || !input.target.clientId || !input.target.sessionId
    || !["COMMAND", "MERGE", "DISTINCT"].includes(input.target.mode ?? "")) fail("Resolve one exact supported live target before expansion.");
  const schema = input.target.schemaFields;
  if (schema.length === 0 || new Set(schema).size !== schema.length || schema.some(name => !name)) fail("An exact nonempty declared field schema is required.");
  if (schema.length !== Object.keys(input.document.fields).length || schema.some(name => !Object.hasOwn(input.document.fields, name))) fail("The base document must contain exactly the declared fields.");
  if (input.key !== undefined && (input.target.mode !== "COMMAND" || !input.key)) fail("An explicit key applies only to COMMAND and must not be empty.");
  if (input.keys !== undefined && input.key !== undefined) fail("Choose key or keys, not both.");
  if (input.keys !== undefined && (input.target.mode !== "COMMAND" || !Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > 32 || input.keys.some(key => typeof key !== "string" || !key))) fail("Explicit keys require one to 32 nonempty COMMAND keys.");
  const keys = input.keys ?? [input.key ?? input.document.key];
  if (input.commands && input.target.mode !== "COMMAND") fail("A command sequence applies only to COMMAND.");
  const commands = input.commands ?? [input.document.command];
  if (commands.length === 0 || commands.length > SCENARIO_MAX_STEPS || (input.target.mode === "COMMAND" && commands.some(command => !["ADD", "UPDATE", "DELETE"].includes(command ?? "")))) fail("Choose a bounded ordered native command sequence.");
  const delays = input.delaysMs ?? [0];
  if (!delays.length || delays.length > SCENARIO_MAX_STEPS || delays.some(delay => !Number.isSafeInteger(delay) || delay < 0 || delay > 3_600_000)) fail("Delays must be bounded integers from 0 to 3600000 ms.");
  const names = Object.keys(input.assignments ?? {}).sort();
  if (names.length > 32) fail("At most 32 parameter fields may be declared.");
  const encoded = new Set(input.jsonStringFields ?? []);
  const assignments = input.assignments ?? {};
  const validJson = (value: unknown, depth = 0, ancestors = new Set<object>()): boolean => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || depth > 32 || ancestors.has(value)) return false;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    const next = new Set(ancestors).add(value);
    return Object.values(value).every(child => validJson(child, depth + 1, next));
  };
  const valueIsValid = (field: string, value: unknown): boolean => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (!encoded.has(field) || typeof value !== "object" || value === null) return false;
    return validJson(value);
  };
  let count = keys.length * commands.length * delays.length;
  for (const name of names) {
    const values = assignments[name]!;
    if (!schema.includes(name) || (input.target.mode === "COMMAND" && (name === "command" || name === "key"))) fail("Parameter assignments must address declared non-command/non-key fields.");
    if (!Array.isArray(values) || !values.length || values.length > 32 || values.some(value => !valueIsValid(name, value))) fail(`Field ${name} requires one to 32 concrete supported values.`);
    count *= values.length;
    if (count > SCENARIO_MAX_STEPS) fail("Expanded membership exceeds the 100-Step boundary.");
  }
  if (count > SCENARIO_MAX_STEPS) fail("Expanded membership exceeds the 100-Step boundary.");
  for (const field of schema) {
    if ((field === "command" && input.commands) || (field === "key" && (input.key !== undefined || input.keys !== undefined)) || Object.hasOwn(assignments, field)) continue;
    if (input.fieldValueStates[field] !== "concrete" || !valueIsValid(field, input.document.fields[field])) fail(`Field ${field} requires an explicit concrete replacement.`);
  }
  const combinations: Record<string, ExpandedJsonStringFieldValue>[] = [{}];
  for (const name of names) {
    const preceding = combinations.splice(0);
    for (const fields of preceding) for (const value of assignments[name]!) combinations.push({ ...fields, [name]: value });
  }
  const members: LocalInjectionCandidateMatrix["members"][number][] = [];
  let accountedBytes = new TextEncoder().encode(JSON.stringify(input.target)).byteLength;
  for (const key of keys) for (const fields of combinations) for (const delayMs of delays) for (const command of commands) {
    const document: LocalInjectionDocument = { ...input.document, command, key, fields: { ...input.document.fields, ...fields,
      ...(input.target.mode === "COMMAND" && schema.includes("command") ? { command } : {}), ...(input.target.mode === "COMMAND" && schema.includes("key") ? { key } : {}) } };
    const member = { id: `generated-step-${String(members.length + 1).padStart(3, "0")}`, document, delayMs,
      fieldValueStates: Object.fromEntries(schema.map(field => [field, "concrete" as const])) };
    accountedBytes += new TextEncoder().encode(JSON.stringify(member)).byteLength;
    if (accountedBytes > SCENARIO_MAX_ACCOUNTED_BYTES) fail("Expanded preview exceeds the 8 MiB accounted-byte boundary.");
    members.push(member);
  }
  return freezeJson({ version: 1, target: input.target, members, limitations: ["Expansion has no delivery or protected-document effect. Validate the entire ordered plan before preparation.", "Field assignments are concrete values; application-specific constraints are not inferred.", "Native changed fields require exact baseline validation. No randomness is used."] });
}

function freezeJson<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (candidate && typeof candidate === "object") { Object.values(candidate).forEach(freeze); Object.freeze(candidate); }
  };
  freeze(copy);
  return copy;
}
