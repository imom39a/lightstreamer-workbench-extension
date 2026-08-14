import type { EvidenceRef } from "./event-history-authoritative";
import type { LocalInjectionDiagnostic, LocalInjectionDocument } from "./local-injection-document";
import type { LocalInjectionOutcome } from "./local-injection-outcome";

export type ScenarioTarget = Readonly<{
  pageEpoch: string | null;
  clientId: string | null;
  sessionId: string | null;
  subscriptionId: string;
  deliveryPath: "listener" | "wire";
  listenerId: string | null;
  mode: string | null;
  schemaFields: readonly string[];
}>;

export type ScenarioEditorState = Readonly<{
  cursor: number;
  selectionFrom: number;
  selectionTo: number;
  scrollTop: number;
  scrollLeft: number;
  compareOpen: boolean;
}>;

export type ScenarioRestorationOrigin = Readonly<{
  scopeId: string | null;
  selectionEventId: string | null;
  focusedEventId: string | null;
  contextId: string | null;
}>;

export type ScenarioDraftInput = Readonly<{
  id: string;
  sourceEventId: string | null;
  sourceRawText: string | null;
  rawText: string;
  document: Readonly<LocalInjectionDocument> | null;
  ready: boolean;
  diagnostics: readonly LocalInjectionDiagnostic[];
  target: ScenarioTarget;
  editor: ScenarioEditorState;
  restorationOrigin: ScenarioRestorationOrigin;
  relativeDelayMs: number;
}>;

export type ScenarioStep = Readonly<{
  id: string;
  draft: ScenarioDraftInput;
}>;

export type LocalInjectionScenario = Readonly<{
  id: string;
  revision: number;
  phase: "edit";
  target: ScenarioTarget;
  steps: readonly ScenarioStep[];
  restorationOrigin: ScenarioRestorationOrigin;
}>;

export type ReviewedScenarioStep = Readonly<{
  id: string;
  ordinal: number;
  sourceEventId: string | null;
  rawText: string;
  document: Readonly<LocalInjectionDocument>;
  relativeDelayMs: number;
}>;

export type ScenarioTraceEntry = Readonly<{
  stepId: string;
  ordinal: number;
  kind: "attempted";
  injectionId: string;
  outcome: LocalInjectionOutcome;
  evidence: Readonly<{ eventId: string }> | null;
}> | Readonly<{
  stepId: string;
  ordinal: number;
  kind: "not-run";
  reason: "RUN STOPPED";
  timestamp: number;
  detail: string;
  evidence: null;
}>;

export type ScenarioRun = Readonly<{
  id: string;
  scenarioId: string;
  scenarioRevision: number;
  target: ScenarioTarget;
  targetFingerprint: string;
  committedEvidenceSeed: EvidenceRef | null;
  steps: readonly ReviewedScenarioStep[];
  status: "paused" | "complete" | "stopped";
  nextOrdinal: number;
  trace: readonly ScenarioTraceEntry[];
}>;

export function createScenarioFromDraft(
  draft: ScenarioDraftInput,
  options: Readonly<{ scenarioId: string }>
): LocalInjectionScenario {
  return freeze({
    id: options.scenarioId,
    revision: 1,
    phase: "edit" as const,
    target: draft.target,
    steps: [{ id: "step-1", draft }],
    restorationOrigin: draft.restorationOrigin
  });
}

export function addScenarioStep(
  scenario: LocalInjectionScenario,
  draft: ScenarioDraftInput
): Readonly<{ ok: true; scenario: LocalInjectionScenario }> | Readonly<{ ok: false; reason: string }> {
  const reason = scenarioTargetIncompatibility(scenario.target, draft.target);
  if (reason) return Object.freeze({ ok: false as const, reason });
  return Object.freeze({
    ok: true as const,
    scenario: freeze({
      ...scenario,
      revision: scenario.revision + 1,
      steps: [...scenario.steps, { id: `step-${scenario.steps.length + 1}`, draft }]
    })
  });
}

export function reviewScenario(
  scenario: LocalInjectionScenario,
  facts: Readonly<{
    runId: string;
    committedEvidenceSeed: EvidenceRef | null;
    targetFingerprint: string;
    activeCommandKeys: readonly string[];
  }>
): Readonly<{ ok: true; run: ScenarioRun }> | Readonly<{ ok: false; reason: string; stepId?: string }> {
  if (scenario.steps.length === 0) return Object.freeze({ ok: false as const, reason: "Add at least one Scenario Step before Review." });
  const keys = new Set(facts.activeCommandKeys);
  const reviewed: ReviewedScenarioStep[] = [];
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index]!;
    const plannedUpdateBecomesValid = step.draft.document?.command === "UPDATE"
      && typeof step.draft.document.key === "string"
      && keys.has(step.draft.document.key)
      && step.draft.diagnostics.length > 0
      && step.draft.diagnostics.every(({ code }) => code === "unknown-key-update");
    if ((!step.draft.ready && !plannedUpdateBecomesValid) || !step.draft.document) {
      return Object.freeze({ ok: false as const, reason: step.draft.diagnostics[0]?.message ?? "Step is not ready for Review.", stepId: step.id });
    }
    const { command, key } = step.draft.document;
    if (scenario.target.mode === "COMMAND" && typeof key === "string") {
      if (command === "ADD") keys.add(key);
      if (command === "UPDATE" && !keys.has(key)) {
        return Object.freeze({ ok: false as const, reason: `UPDATE key "${key}" does not exist at this ordered Step.`, stepId: step.id });
      }
      if (command === "DELETE" && !keys.has(key)) {
        return Object.freeze({ ok: false as const, reason: `DELETE key "${key}" does not exist at this ordered Step.`, stepId: step.id });
      }
      if (command === "DELETE") keys.delete(key);
    }
    reviewed.push({
      id: step.id,
      ordinal: index + 1,
      sourceEventId: step.draft.sourceEventId,
      rawText: step.draft.rawText,
      document: step.draft.document,
      relativeDelayMs: Math.max(0, step.draft.relativeDelayMs)
    });
  }
  return Object.freeze({
    ok: true as const,
    run: freeze({
      id: facts.runId,
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      target: scenario.target,
      targetFingerprint: facts.targetFingerprint,
      committedEvidenceSeed: facts.committedEvidenceSeed,
      steps: reviewed,
      status: "paused" as const,
      nextOrdinal: 1,
      trace: []
    })
  });
}

export async function stepScenarioRun<T extends Readonly<{
  kind: "attempted";
  outcome: LocalInjectionOutcome;
  evidence: Readonly<{ eventId: string }> | null;
}> | Readonly<{ kind: "not-run"; reason: "REVIEW INVALIDATED"; timestamp: number; detail: string }>>(
  run: ScenarioRun,
  adapter: Readonly<{
    injectionId: string;
    execute(input: Readonly<{
      scenarioId: string;
      runId: string;
      stepId: string;
      ordinal: number;
      injectionId: string;
      target: ScenarioTarget;
      document: Readonly<LocalInjectionDocument>;
      sourceEventId: string | null;
    }>): Promise<T>;
  }>
): Promise<ScenarioRun> {
  if (run.status !== "paused") return run;
  const step = run.steps[run.nextOrdinal - 1];
  if (!step) return freeze({ ...run, status: "complete" as const });
  const terminal = await adapter.execute({
    scenarioId: run.scenarioId,
    runId: run.id,
    stepId: step.id,
    ordinal: step.ordinal,
    injectionId: adapter.injectionId,
    target: run.target,
    document: step.document,
    sourceEventId: step.sourceEventId
  });
  if (terminal.kind === "not-run") return freeze({
    ...run,
    status: "stopped" as const,
    trace: [...run.trace, ...run.steps.slice(run.nextOrdinal - 1).map((remaining) => ({
      stepId: remaining.id,
      ordinal: remaining.ordinal,
      kind: "not-run" as const,
      reason: "RUN STOPPED" as const,
      timestamp: terminal.timestamp,
      detail: remaining.ordinal === step.ordinal ? terminal.detail : `RUN STOPPED before Step ${remaining.ordinal}; this Step was not attempted.`,
      evidence: null
    }))]
  });
  const trace: ScenarioTraceEntry = {
    stepId: step.id,
    ordinal: step.ordinal,
    kind: "attempted",
    injectionId: adapter.injectionId,
    outcome: terminal.outcome,
    evidence: terminal.evidence
  };
  const nextOrdinal = run.nextOrdinal + 1;
  const delivered = terminal.outcome.disposition === "delivered" && terminal.evidence !== null;
  const stoppedRemainder: ScenarioTraceEntry[] = delivered ? [] : run.steps.slice(run.nextOrdinal).map((remaining) => ({
    stepId: remaining.id,
    ordinal: remaining.ordinal,
    kind: "not-run" as const,
    reason: "RUN STOPPED" as const,
    timestamp: terminal.outcome.timestamp,
    detail: `RUN STOPPED after Step ${step.ordinal}; this Step was not attempted.`,
    evidence: null
  }));
  return freeze({
    ...run,
    nextOrdinal: delivered ? nextOrdinal : run.nextOrdinal,
    status: delivered
      ? nextOrdinal > run.steps.length ? "complete" as const : "paused" as const
      : "stopped" as const,
    trace: [...run.trace, trace, ...stoppedRemainder]
  });
}

export function scenarioTargetIncompatibility(expected: ScenarioTarget, candidate: ScenarioTarget): string | null {
  if (candidate.pageEpoch !== expected.pageEpoch) return "Different page: Scenario Steps must share the exact Local Injection Target.";
  if (candidate.clientId !== expected.clientId) return "Different Lightstreamer Client: Scenario Steps must share the exact Local Injection Target.";
  if (candidate.sessionId !== expected.sessionId) return "Different Session: Scenario Steps must share the exact Local Injection Target.";
  if (candidate.subscriptionId !== expected.subscriptionId) return "Different Subscription: Scenario Steps must share the exact Local Injection Target.";
  if (candidate.deliveryPath !== expected.deliveryPath || candidate.listenerId !== expected.listenerId) return "Different delivery path: Scenario Steps must share the exact Local Injection Target.";
  if (candidate.mode !== expected.mode) return "Different Subscription mode: Scenario Steps must share the exact Local Injection Target.";
  if (!sameStrings(candidate.schemaFields, expected.schemaFields)) return "Different field schema: Scenario Steps must share a compatible schema.";
  return null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
