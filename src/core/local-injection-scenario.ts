import type { EvidenceRef } from "./event-history-authoritative";
import type { LocalInjectionDiagnostic, LocalInjectionDocument } from "./local-injection-document";

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
  injectionId: string;
  outcome: Readonly<{ headline: string }>;
  evidence: Readonly<{ eventId: string }> | null;
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
  const reason = targetIncompatibility(scenario.target, draft.target);
  if (reason) return Object.freeze({ ok: false as const, reason });
  if (scenario.steps.length >= 100) {
    return Object.freeze({ ok: false as const, reason: "Scenario already contains the maximum 100 Steps." });
  }
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
    if (!step.draft.ready || !step.draft.document) {
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
  outcome: Readonly<{ headline: string }>;
  evidence: Readonly<{ eventId: string }> | null;
}>>(
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
  const trace: ScenarioTraceEntry = {
    stepId: step.id,
    ordinal: step.ordinal,
    injectionId: adapter.injectionId,
    outcome: terminal.outcome,
    evidence: terminal.evidence
  };
  const nextOrdinal = run.nextOrdinal + 1;
  return freeze({
    ...run,
    nextOrdinal,
    status: nextOrdinal > run.steps.length ? "complete" as const : "paused" as const,
    trace: [...run.trace, trace]
  });
}

function targetIncompatibility(expected: ScenarioTarget, candidate: ScenarioTarget): string | null {
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
