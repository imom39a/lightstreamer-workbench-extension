import type { EvidenceRef } from "./event-history-authoritative";
import type {
  ScenarioAssertion,
  ScenarioCheckpoint,
  ScenarioPrimitive
} from "./local-injection-scenario";
export const SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT = 16;
import type { LocalInjectionOutcome } from "./local-injection-outcome";

export type ScenarioAssertionStatus = "pass" | "fail" | "waiting" | "expired" | "invalid" | "unavailable" | "not-evaluable";
export type ScenarioObservationCertainty = "certain" | "ambiguous" | "unavailable";
export type ScenarioObservationProvenance = "injection-outcome" | "committed-local-evidence" | "correlated-local" | "local-effective" | "server" | "wire" | "history";

export type ScenarioCommandInspection = Readonly<{
  state: "key-present" | "key-absent" | "field-absent" | "concrete" | "ambiguous-server-null" | "redacted" | "unavailable" | "unresolved-wire";
  value?: ScenarioPrimitive;
  certainty: ScenarioObservationCertainty;
  provenance: ScenarioObservationProvenance;
  evidence: EvidenceRef | null;
}>;

export type ScenarioCommittedBoundarySnapshot = Readonly<{
  boundary: EvidenceRef | null;
  intervalId: string | null;
  retainedRange: Readonly<{ first: EvidenceRef; last: EvidenceRef }> | null;
  history: "accepting" | "unavailable" | "closed";
  projection: "live" | "recovering" | "failed";
}>;

export type ScenarioCommittedBoundaryFeed = Readonly<{
  snapshot(): ScenarioCommittedBoundarySnapshot;
  subscribe(after: EvidenceRef | null, listener: (snapshot: ScenarioCommittedBoundarySnapshot) => void): () => void;
}>;

export type ScenarioAssertionObservation = Readonly<{
  priorOutcomes: ReadonlyMap<string, LocalInjectionOutcome>;
  correlatedLocalEvidence: ReadonlyMap<string, EvidenceRef>;
  inspectCommand(input: Readonly<{
    item: Readonly<{ name: string | null; position: number | null }>;
    key: string;
    field?: string;
  }>): ScenarioCommandInspection;
}>;

export type ScenarioAssertionObserved = Readonly<{
  state: string;
  value?: ScenarioPrimitive | number | string;
  certainty: ScenarioObservationCertainty;
  provenance: ScenarioObservationProvenance;
  evidence: EvidenceRef | null;
}>;

export type ScenarioAssertionResult = Readonly<{
  assertionId: string;
  kind: ScenarioAssertion["kind"];
  status: ScenarioAssertionStatus;
  expected: Readonly<Record<string, unknown>>;
  observed: ScenarioAssertionObserved;
  relatedEvidence: readonly EvidenceRef[];
}>;

export type ScenarioCheckpointEvaluation = Readonly<{
  checkpointId: string;
  checkpointName: string;
  status: ScenarioAssertionStatus;
  activeOffsetMs: number;
  boundary: EvidenceRef | null;
  assertions: readonly ScenarioAssertionResult[];
}>;

export function validateScenarioCheckpoint(
  checkpoint: ScenarioCheckpoint,
  context: Readonly<{ targetMode: string | null; deliveryPath: "listener" | "wire"; earlierStepIds: readonly string[] }>
): Readonly<{ ok: true }> | Readonly<{ ok: false; assertionId: string; reason: string }> {
  if (checkpoint.name.trim().length < 1 || checkpoint.name.length > 256) {
    return frozen({ ok: false, assertionId: "<checkpoint>", reason: "Scenario Checkpoint name must contain 1 to 256 characters." });
  }
  if (checkpoint.assertions.length < 1 || checkpoint.assertions.length > SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT) {
    return frozen({ ok: false, assertionId: "<checkpoint>", reason: `A Scenario Checkpoint requires 1 to ${SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT} assertions.` });
  }
  const ids = new Set<string>();
  for (const rawAssertion of checkpoint.assertions as readonly unknown[]) {
    if (typeof rawAssertion !== "object" || rawAssertion === null || Array.isArray(rawAssertion)) {
      return frozen({ ok: false, assertionId: "<missing>", reason: "Scenario Assertion must be an object." });
    }
    const assertion = rawAssertion as Partial<ScenarioAssertion> & { id?: unknown; kind?: unknown; withinActiveMs?: unknown; stepId?: unknown };
    const assertionId = typeof assertion.id === "string" ? assertion.id : "<missing>";
    if (typeof assertion.id !== "string" || assertion.id.length === 0 || assertion.id.length > 256 || ids.has(assertion.id)) {
      return frozen({ ok: false, assertionId, reason: "Scenario Assertion identities must be non-empty and stable within the Checkpoint." });
    }
    ids.add(assertion.id);
    if (!isAssertionKind(assertion.kind)) return frozen({ ok: false, assertionId, reason: "Unsupported Scenario Assertion kind." });
    const requiresStep = assertion.kind === "prior-injection-outcome" || assertion.kind === "listener-count" || assertion.kind === "correlated-local-evidence-exists";
    if (requiresStep && (typeof assertion.stepId !== "string" || !context.earlierStepIds.includes(assertion.stepId))) {
      return frozen({ ok: false, assertionId, reason: "Checkpoint assertions may reference only an earlier Scenario Step." });
    }
    if (assertion.kind === "prior-injection-outcome" && !["delivered", "partial", "failed", "acknowledgement-unknown", "blocked"].includes(assertion.expectedDisposition as string)) {
      return frozen({ ok: false, assertionId, reason: "Injection Outcome expectation is unsupported." });
    }
    if (assertion.kind === "listener-count" && context.deliveryPath === "wire") {
      return frozen({ ok: false, assertionId, reason: "Wire delivery does not expose listener counts; this assertion is unavailable." });
    }
    if (assertion.kind === "listener-count" && assertion.count !== "attempted" && assertion.count !== "delivered") {
      return frozen({ ok: false, assertionId, reason: "Listener count must select attempted or delivered." });
    }
    if (assertion.kind === "listener-count" && (typeof assertion.expected !== "number" || !Number.isSafeInteger(assertion.expected) || assertion.expected < 0)) {
      return frozen({ ok: false, assertionId, reason: "Listener count expectation must be a non-negative safe integer." });
    }
    if ((assertion.kind === "command-key-exists" || assertion.kind === "command-field-equals") && context.targetMode !== "COMMAND") {
      return frozen({ ok: false, assertionId, reason: "COMMAND State assertions require a COMMAND Subscription target." });
    }
    if (assertion.kind === "command-key-exists" && assertion.expected !== "present" && assertion.expected !== "absent") {
      return frozen({ ok: false, assertionId, reason: "COMMAND key expectation must select present or absent." });
    }
    if ((assertion.kind === "command-key-exists" || assertion.kind === "command-field-equals") && (typeof assertion.key !== "string" || assertion.key.length === 0)) {
      return frozen({ ok: false, assertionId, reason: "COMMAND key must not be empty." });
    }
    if (assertion.kind === "command-key-exists" || assertion.kind === "command-field-equals") {
      const item = assertion.item as unknown;
      const itemRecord = typeof item === "object" && item !== null && !Array.isArray(item)
        ? item as Readonly<Record<string, unknown>>
        : null;
      const name = itemRecord?.name;
      const position = itemRecord?.position;
      const validName = typeof name === "string" && name.length > 0;
      const validPosition = typeof position === "number" && Number.isSafeInteger(position) && position >= 1;
      const validShape = itemRecord !== null
        && (name === null || typeof name === "string")
        && (position === null || validPosition);
      if (!validShape || (!validName && !validPosition)) {
        return frozen({ ok: false, assertionId, reason: "COMMAND assertion requires an exact item name or positive item position." });
      }
    }
    if (assertion.kind === "command-field-equals" && (typeof assertion.field !== "string" || assertion.field.length === 0 || !isJsonPrimitive(assertion.expected))) {
      return frozen({ ok: false, assertionId, reason: "Primitive equality requires a named field and one finite JSON primitive expectation." });
    }
    if (assertion.withinActiveMs !== undefined) {
      const allowed = assertion.kind === "correlated-local-evidence-exists"
        || (assertion.kind === "command-key-exists" && assertion.expected === "present")
        || assertion.kind === "command-field-equals";
      if (!allowed) return frozen({ ok: false, assertionId, reason: "within is available only for positive Evidence, key-exists, or primitive-equality assertions." });
      if (typeof assertion.withinActiveMs !== "number" || !Number.isFinite(assertion.withinActiveMs) || assertion.withinActiveMs < 1 || assertion.withinActiveMs > 300_000) {
        return frozen({ ok: false, assertionId, reason: "within must be a finite active-time duration from 1 to 300000 ms." });
      }
    }
  }
  return frozen({ ok: true });
}

export function evaluateScenarioCheckpoint(
  checkpoint: ScenarioCheckpoint,
  boundary: ScenarioCommittedBoundarySnapshot,
  observation: ScenarioAssertionObservation,
  activeOffsetMs: number,
  startedActiveOffsetMs = activeOffsetMs
): ScenarioCheckpointEvaluation {
  if (boundary.history !== "accepting" || boundary.projection !== "live") {
    return unavailableEvaluation(checkpoint, boundary.boundary, activeOffsetMs);
  }
  const independentlyEvaluated = checkpoint.assertions.map((assertion) => {
    const evaluated = evaluateAssertion(assertion, observation);
    const withinActiveMs = "withinActiveMs" in assertion ? assertion.withinActiveMs : undefined;
    const elapsed = activeOffsetMs - startedActiveOffsetMs;
    if (withinActiveMs !== undefined && ((evaluated.status === "waiting" && elapsed >= withinActiveMs) || (evaluated.status === "pass" && elapsed > withinActiveMs))) {
      return frozen({ ...evaluated, status: "expired" as const });
    }
    return evaluated;
  });
  const hasTerminalFailure = independentlyEvaluated.some(({ status }) => status !== "pass" && status !== "waiting");
  const waiting = independentlyEvaluated.some(({ status }) => status === "waiting");
  // Eventual assertions are a conjunction at one boundary. A fact that was true
  // earlier is not banked while another assertion is still waiting.
  const assertions = waiting && !hasTerminalFailure
    ? independentlyEvaluated.map((result, index) => {
      if (result.status !== "pass") return result;
      const assertion = checkpoint.assertions[index];
      const withinActiveMs = "withinActiveMs" in assertion ? assertion.withinActiveMs : undefined;
      return withinActiveMs !== undefined && activeOffsetMs - startedActiveOffsetMs >= withinActiveMs
        ? frozen({ ...result, status: "expired" as const })
        : frozen({ ...result, status: "waiting" as const });
    })
    : independentlyEvaluated;
  const terminalAfterConjunction = assertions.some(({ status }) => status !== "pass" && status !== "waiting");
  const status: ScenarioAssertionStatus = hasTerminalFailure || terminalAfterConjunction
    ? assertions.find(({ status: candidate }) => candidate !== "pass" && candidate !== "waiting")!.status
    : waiting ? "waiting" : "pass";
  return frozen({
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name,
    status,
    activeOffsetMs,
    boundary: boundary.boundary,
    assertions
  });
}

function evaluateAssertion(assertion: ScenarioAssertion, observation: ScenarioAssertionObservation): ScenarioAssertionResult {
  switch (assertion.kind) {
    case "prior-injection-outcome": {
      const outcome = observation.priorOutcomes.get(assertion.stepId);
      return result(assertion, outcome?.disposition === assertion.expectedDisposition ? "pass" : "fail", { state: outcome ? "outcome" : "absent", value: outcome?.disposition, certainty: "certain", provenance: "injection-outcome", evidence: null }, []);
    }
    case "listener-count": {
      const outcome = observation.priorOutcomes.get(assertion.stepId);
      const value = assertion.count === "attempted" ? outcome?.attemptedCount : outcome?.deliveredCount;
      if (value === undefined || value === null) return result(assertion, "unavailable", { state: "listener-count-unavailable", certainty: "unavailable", provenance: "wire", evidence: null }, []);
      return result(assertion, value === assertion.expected ? "pass" : "fail", { state: "listener-count", value, certainty: "certain", provenance: "injection-outcome", evidence: null }, []);
    }
    case "correlated-local-evidence-exists": {
      const evidence = observation.correlatedLocalEvidence.get(assertion.stepId) ?? null;
      return result(assertion, evidence ? "pass" : assertion.withinActiveMs ? "waiting" : "fail", { state: evidence ? "committed" : "absent", certainty: "certain", provenance: "committed-local-evidence", evidence }, evidence ? [evidence] : []);
    }
    case "command-key-exists": {
      const inspected = observation.inspectCommand({ item: assertion.item, key: assertion.key });
      const nonEvaluable = inspectionTerminalStatus(inspected);
      if (nonEvaluable) return result(assertion, nonEvaluable, inspected, inspected.evidence ? [inspected.evidence] : []);
      const present = inspected.state === "key-present" || inspected.state === "concrete" || inspected.state === "field-absent";
      const matches = assertion.expected === (present ? "present" : "absent");
      return result(assertion, matches ? "pass" : assertion.withinActiveMs ? "waiting" : "fail", inspected, inspected.evidence ? [inspected.evidence] : []);
    }
    case "command-field-equals": {
      const inspected = observation.inspectCommand({ item: assertion.item, key: assertion.key, field: assertion.field });
      const nonEvaluable = inspectionTerminalStatus(inspected);
      if (nonEvaluable) return result(assertion, nonEvaluable, inspected, inspected.evidence ? [inspected.evidence] : []);
      const matches = inspected.state === "concrete" && Object.is(inspected.value, assertion.expected);
      return result(assertion, matches ? "pass" : assertion.withinActiveMs ? "waiting" : "fail", inspected, inspected.evidence ? [inspected.evidence] : []);
    }
  }
}

function inspectionTerminalStatus(inspection: ScenarioCommandInspection): ScenarioAssertionStatus | null {
  if (inspection.state === "ambiguous-server-null") return "not-evaluable";
  if (inspection.state === "redacted" || inspection.state === "unresolved-wire" || inspection.state === "unavailable") return "unavailable";
  return null;
}

function result(
  assertion: ScenarioAssertion,
  status: ScenarioAssertionStatus,
  observed: ScenarioAssertionObserved,
  relatedEvidence: readonly EvidenceRef[]
): ScenarioAssertionResult {
  return frozen({ assertionId: assertion.id, kind: assertion.kind, status, expected: expectedFor(assertion), observed, relatedEvidence: [...relatedEvidence] });
}

function expectedFor(assertion: ScenarioAssertion): Readonly<Record<string, unknown>> {
  switch (assertion.kind) {
    case "prior-injection-outcome": return { disposition: assertion.expectedDisposition };
    case "listener-count": return { count: assertion.count, value: assertion.expected };
    case "correlated-local-evidence-exists": return { exists: true };
    case "command-key-exists": return { key: assertion.expected };
    case "command-field-equals": return { primitive: assertion.expected };
  }
}

function unavailableEvaluation(checkpoint: ScenarioCheckpoint, boundary: EvidenceRef | null, activeOffsetMs: number): ScenarioCheckpointEvaluation {
  return frozen({
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name,
    status: "unavailable",
    activeOffsetMs,
    boundary,
    assertions: checkpoint.assertions.map((assertion) => result(assertion, "unavailable", { state: "committed-boundary-unavailable", certainty: "unavailable", provenance: "history", evidence: boundary }, boundary ? [boundary] : []))
  });
}

function isAssertionKind(value: unknown): value is ScenarioAssertion["kind"] {
  return value === "prior-injection-outcome" || value === "listener-count" || value === "correlated-local-evidence-exists" || value === "command-key-exists" || value === "command-field-equals";
}

function isJsonPrimitive(value: unknown): value is ScenarioPrimitive {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
