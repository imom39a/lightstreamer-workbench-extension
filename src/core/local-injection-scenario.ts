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
  serializedState: Readonly<Record<string, unknown>> | null;
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
  item: Readonly<{ name: string | null; position: number | null }>;
  editor: ScenarioEditorState;
  restorationOrigin: ScenarioRestorationOrigin;
  relativeDelayMs: number;
}>;

export type ScenarioStep = Readonly<{
  kind: "step";
  id: string;
  draft: ScenarioDraftInput;
}>;

export type RemovedScenarioStep = Readonly<{
  step: ScenarioStep;
  index: number;
}>;

export type LocalInjectionScenario = Readonly<{
  id: string;
  revision: number;
  phase: "edit";
  target: ScenarioTarget;
  steps: readonly ScenarioStep[];
  restorationOrigin: ScenarioRestorationOrigin;
  nextStepSequence: number;
  removedSteps: readonly RemovedScenarioStep[];
  accountedBytes: number;
}>;

export const SCENARIO_MAX_STEPS = 100;
export const SCENARIO_MAX_ACCOUNTED_BYTES = 8 * 1024 * 1024;
// Coordinator outcomes are bounded before they reach this module. Reserve their
// complete canonical form (including generated correlation/Evidence identity)
// rather than shortening an already-settled outcome after dispatch.
const SCENARIO_TRACE_RESERVATION_BYTES_PER_INJECTION_MEMBER = 16 * 1024;

export type ScenarioAdmissionContext = Readonly<{ retainedRunBytes?: number }>;

export type ScenarioCapacityRefusal = Readonly<{
  ok: false;
  capacity: "steps" | "bytes";
  reason: string;
}>;

type ScenarioMutation = Readonly<{ ok: true; scenario: LocalInjectionScenario }> | ScenarioCapacityRefusal | Readonly<{ ok: false; reason: string }>;

export type ScenarioMembershipCandidate = Readonly<{
  evidence: EvidenceRef;
  draft: ScenarioDraftInput | null;
  unavailableReason?: string;
}>;

export type ScenarioMembershipPreview = Readonly<{
  scenarioId: string;
  scenarioRevision: number;
  members: readonly Readonly<{
    evidenceId: string;
    evidence: EvidenceRef;
    retainedSequence: number;
    available: boolean;
    reason: string | null;
    draft: ScenarioDraftInput | null;
  }>[];
}>;

export type ReviewedScenarioStep = Readonly<{
  kind: "step";
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
  evidence: EvidenceRef | null;
  detailLimited?: Readonly<{ originalBytes: number; retainedBytes: number }>;
}> | Readonly<{
  stepId: string;
  ordinal: number;
  kind: "not-run";
  reason: "RUN STOPPED";
  timestamp: number;
  detail: string;
  evidence: null;
  detailLimited?: Readonly<{ originalBytes: number; retainedBytes: number }>;
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
  accountedBytes: number;
  traceReservationBytes: number;
}>;

export function createScenarioFromDraft(
  draft: ScenarioDraftInput,
  options: Readonly<{ scenarioId: string }>
): LocalInjectionScenario {
  const initial = {
    id: options.scenarioId,
    revision: 1,
    phase: "edit" as const,
    target: draft.target,
    steps: [{ kind: "step" as const, id: "step-1", draft }],
    restorationOrigin: draft.restorationOrigin,
    nextStepSequence: 2,
    removedSteps: [] as readonly RemovedScenarioStep[],
    accountedBytes: 0
  };
  const accountedBytes = scenarioDefinitionBytes(initial);
  if (accountedBytes > SCENARIO_MAX_ACCOUNTED_BYTES) {
    throw new RangeError("Scenario exceeds the 8 MiB canonical accounted-state limit.");
  }
  return freeze({ ...initial, accountedBytes });
}

export function addScenarioStep(
  scenario: LocalInjectionScenario,
  draft: ScenarioDraftInput,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  const reason = scenarioTargetIncompatibility(scenario.target, draft.target);
  if (reason) return Object.freeze({ ok: false as const, reason });
  return commitScenarioMutation(scenario, {
    steps: [...scenario.steps, { kind: "step", id: `step-${scenario.nextStepSequence}`, draft }],
    nextStepSequence: scenario.nextStepSequence + 1
  }, true, admission.retainedRunBytes ?? 0);
}

export function previewScenarioMembership(
  scenario: LocalInjectionScenario,
  candidates: readonly ScenarioMembershipCandidate[]
): ScenarioMembershipPreview {
  return freeze({
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    members: [...candidates].sort((left, right) => left.evidence.sequence - right.evidence.sequence).map((candidate) => {
      const reason = candidate.unavailableReason
        ?? (candidate.draft ? scenarioTargetIncompatibility(scenario.target, candidate.draft.target) : "Captured Item Update is unavailable for Scenario authoring.");
      return {
        evidenceId: candidate.evidence.eventId,
        evidence: candidate.evidence,
        retainedSequence: candidate.evidence.sequence,
        available: reason === null || reason === undefined,
        reason: reason ?? null,
        draft: candidate.draft
      };
    })
  });
}

export function confirmScenarioMembershipPreview(
  scenario: LocalInjectionScenario,
  preview: ScenarioMembershipPreview,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  if (preview.scenarioId !== scenario.id || preview.scenarioRevision !== scenario.revision) {
    return freeze({ ok: false as const, reason: "Scenario changed after this membership preview. Preview the retained Evidence again." });
  }
  const drafts = preview.members.filter((member) => member.available && member.draft !== null).map((member) => member.draft!);
  const steps = drafts.map((draft, index) => ({ kind: "step" as const, id: `step-${scenario.nextStepSequence + index}`, draft }));
  return commitScenarioMutation(scenario, {
    steps: [...scenario.steps, ...steps],
    nextStepSequence: scenario.nextStepSequence + steps.length
  }, true, admission.retainedRunBytes ?? 0);
}

export function moveScenarioStep(scenario: LocalInjectionScenario, stepId: string, direction: "earlier" | "later", admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const from = scenario.steps.findIndex(({ id }) => id === stepId);
  const to = direction === "earlier" ? from - 1 : from + 1;
  if (from < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  if (to < 0 || to >= scenario.steps.length) return freeze({ ok: false as const, reason: `Scenario Step cannot move ${direction}.` });
  const steps = [...scenario.steps];
  [steps[from], steps[to]] = [steps[to]!, steps[from]!];
  return commitScenarioMutation(scenario, { steps }, true, admission.retainedRunBytes ?? 0);
}

export function duplicateScenarioStep(scenario: LocalInjectionScenario, stepId: string, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  const source = scenario.steps[index]!;
  const duplicate: ScenarioStep = {
    kind: "step",
    id: `step-${scenario.nextStepSequence}`,
    draft: cloneScenarioDraft(source.draft, `${source.draft.id}-copy-${scenario.nextStepSequence}`)
  };
  const steps = [...scenario.steps];
  steps.splice(index + 1, 0, duplicate);
  return commitScenarioMutation(scenario, { steps, nextStepSequence: scenario.nextStepSequence + 1 }, true, admission.retainedRunBytes ?? 0);
}

export function removeScenarioStep(scenario: LocalInjectionScenario, stepId: string, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  if (scenario.steps.length === 1) return freeze({ ok: false as const, reason: "A Scenario must retain at least one Step." });
  const step = scenario.steps[index]!;
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.filter(({ id }) => id !== stepId),
    removedSteps: [...scenario.removedSteps, { step, index }]
  }, true, admission.retainedRunBytes ?? 0);
}

export function undoScenarioStepRemoval(scenario: LocalInjectionScenario, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const removed = scenario.removedSteps.at(-1);
  if (!removed) return freeze({ ok: false as const, reason: "No removed Scenario Step is available to restore." });
  const steps = [...scenario.steps];
  steps.splice(Math.min(removed.index, steps.length), 0, removed.step);
  return commitScenarioMutation(scenario, { steps, removedSteps: scenario.removedSteps.slice(0, -1) }, true, admission.retainedRunBytes ?? 0);
}

export function updateScenarioStepDraft(scenario: LocalInjectionScenario, stepId: string, draft: ScenarioDraftInput, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  const reason = scenarioTargetIncompatibility(scenario.target, draft.target);
  if (reason) return freeze({ ok: false as const, reason });
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.map((step, stepIndex) => stepIndex === index ? { ...step, draft } : step)
  }, true, admission.retainedRunBytes ?? 0);
}

export function updateScenarioStepPresentation(
  scenario: LocalInjectionScenario,
  stepId: string,
  editor: ScenarioEditorState,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.map((step, stepIndex) => stepIndex === index
      ? { ...step, draft: { ...step.draft, editor } }
      : step)
  }, false, admission.retainedRunBytes ?? 0);
}

export function reviewScenario(
  scenario: LocalInjectionScenario,
  facts: Readonly<{
    runId: string;
    committedEvidenceSeed: EvidenceRef | null;
    targetFingerprint: string;
    activeCommandKeysByItem: readonly Readonly<{ item: ScenarioDraftInput["item"]; keys: readonly string[] }>[];
    retainedRunBytes?: number;
  }>
): Readonly<{ ok: true; run: ScenarioRun }> | Readonly<{ ok: false; reason: string; stepId?: string }> {
  if (scenario.steps.length === 0) return Object.freeze({ ok: false as const, reason: "Add at least one Scenario Step before Review." });
  const keysByItem = new Map(facts.activeCommandKeysByItem.map(({ item, keys }) => [itemKey(item), new Set(keys)]));
  const reviewed: ReviewedScenarioStep[] = [];
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index]!;
    const keys = keysByItem.get(itemKey(step.draft.item)) ?? new Set<string>();
    keysByItem.set(itemKey(step.draft.item), keys);
    const plannedCommandBecomesValid = (step.draft.document?.command === "UPDATE" || step.draft.document?.command === "DELETE")
      && typeof step.draft.document.key === "string"
      && keys.has(step.draft.document.key)
      && step.draft.diagnostics.length > 0
      && step.draft.diagnostics.every(({ code }) => code === `unknown-key-${step.draft.document?.command?.toLowerCase()}`);
    if ((!step.draft.ready && !plannedCommandBecomesValid) || !step.draft.document) {
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
      kind: "step",
      id: step.id,
      ordinal: index + 1,
      sourceEventId: step.draft.sourceEventId,
      rawText: step.draft.rawText,
      document: step.draft.document,
      relativeDelayMs: Math.max(0, step.draft.relativeDelayMs)
    });
  }
  const candidate = freeze({
      id: facts.runId,
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      target: scenario.target,
      targetFingerprint: facts.targetFingerprint,
      committedEvidenceSeed: facts.committedEvidenceSeed,
      steps: reviewed,
      status: "paused" as const,
      nextOrdinal: 1,
      trace: [],
      accountedBytes: 0,
      traceReservationBytes: 0
  });
  const admission = scenarioRunAdmission(scenario, candidate, facts.retainedRunBytes ?? 0);
  if (!admission.ok) return Object.freeze({ ok: false as const, reason: admission.reason });
  return Object.freeze({
    ok: true as const,
    run: freeze({ ...candidate, accountedBytes: admission.accountedBytes, traceReservationBytes: admission.traceReservationBytes })
  });
}

export function scenarioRunAdmission(
  scenario: LocalInjectionScenario,
  run: ScenarioRun,
  retainedRunBytes = 0
): Readonly<{ ok: true; accountedBytes: number; traceReservationBytes: number; stepCount: number }>
  | Readonly<{ ok: false; capacity: "bytes"; reason: string }> {
  const traceReservationBytes = run.steps.reduce((bytes, member) => bytes + scenarioMemberTraceReservationBytes(member), 0);
  const { accountedBytes: _runBytes, traceReservationBytes: _traceBytes, trace: _trace, ...immutablePlan } = run;
  const accountedBytes = scenario.accountedBytes + retainedRunBytes + canonicalBytes(immutablePlan) + canonicalBytes(run.trace) + traceReservationBytes;
  if (accountedBytes > SCENARIO_MAX_ACCOUNTED_BYTES) {
    return freeze({ ok: false as const, capacity: "bytes" as const, reason: "Scenario Run would exceed 8 MiB after reserving its immutable plan and append-only Trace; no Run was created." });
  }
  return freeze({ ok: true as const, accountedBytes, traceReservationBytes, stepCount: run.steps.length });
}

function scenarioMemberTraceReservationBytes(member: ReviewedScenarioStep): number {
  switch (member.kind) {
    case "step":
      return SCENARIO_TRACE_RESERVATION_BYTES_PER_INJECTION_MEMBER + canonicalBytes({ stepId: member.id, ordinal: member.ordinal });
  }
}

function itemKey(item: ScenarioDraftInput["item"]): string {
  return item.name !== null ? `name:${item.name}` : `position:${item.position ?? "unknown"}`;
}

export async function stepScenarioRun<T extends Readonly<{
  kind: "attempted";
  outcome: LocalInjectionOutcome;
  evidence: EvidenceRef | null;
}> | Readonly<{ kind: "not-run"; reason: "REVIEW INVALIDATED" | "TARGET NOT RUN"; timestamp: number; detail: string }>>(
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
    trace: [...run.trace, ...run.steps.slice(run.nextOrdinal - 1).map((remaining) => freeze({
      stepId: remaining.id,
      ordinal: remaining.ordinal,
      kind: "not-run" as const,
      reason: "RUN STOPPED" as const,
      timestamp: terminal.timestamp,
      detail: remaining.ordinal === step.ordinal ? terminal.detail : `RUN STOPPED before Step ${remaining.ordinal}; this Step was not attempted.`,
      evidence: null
    }))]
  });
  const trace: ScenarioTraceEntry = freeze({
    stepId: step.id,
    ordinal: step.ordinal,
    kind: "attempted" as const,
    injectionId: adapter.injectionId,
    outcome: terminal.outcome,
    evidence: terminal.evidence
  });
  const nextOrdinal = run.nextOrdinal + 1;
  const delivered = terminal.outcome.disposition === "delivered" && terminal.evidence !== null;
  const stoppedRemainder: ScenarioTraceEntry[] = delivered ? [] : run.steps.slice(run.nextOrdinal).map((remaining) => freeze({
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

export function terminalizeScenarioRun(run: ScenarioRun, timestamp: number, detail = "Scenario returned to Edit before this Step was attempted."): ScenarioRun {
  if (run.status !== "paused") return run;
  return freeze({
    ...run,
    status: "stopped" as const,
    trace: [...run.trace, ...run.steps.slice(run.nextOrdinal - 1).map((remaining) => freeze({
      stepId: remaining.id,
      ordinal: remaining.ordinal,
      kind: "not-run" as const,
      reason: "RUN STOPPED" as const,
      timestamp,
      detail,
      evidence: null
    }))]
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

function commitScenarioMutation(
  scenario: LocalInjectionScenario,
  change: Partial<Pick<LocalInjectionScenario, "steps" | "nextStepSequence" | "removedSteps">>,
  advanceRevision = true,
  retainedRunBytes = 0
): ScenarioMutation {
  const steps = change.steps ?? scenario.steps;
  if (steps.length > SCENARIO_MAX_STEPS) {
    return freeze({ ok: false as const, capacity: "steps" as const, reason: `Scenario admits at most ${SCENARIO_MAX_STEPS} Steps; no membership changed.` });
  }
  const candidate = {
    ...scenario,
    ...change,
    steps,
    revision: scenario.revision + (advanceRevision ? 1 : 0),
    accountedBytes: 0
  };
  const accountedBytes = scenarioDefinitionBytes(candidate);
  if (accountedBytes + retainedRunBytes > SCENARIO_MAX_ACCOUNTED_BYTES) {
    return freeze({ ok: false as const, capacity: "bytes" as const, reason: "Scenario and retained Runs would exceed 8 MiB of canonical accounted state; no membership changed." });
  }
  return freeze({ ok: true as const, scenario: freeze({ ...candidate, accountedBytes }) });
}

function scenarioDefinitionBytes(scenario: Omit<LocalInjectionScenario, "accountedBytes"> | LocalInjectionScenario): number {
  const { accountedBytes: _ignored, ...accounted } = scenario as LocalInjectionScenario;
  return canonicalBytes(accounted);
}

function canonicalBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(canonicalize(value))).byteLength;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function cloneScenarioDraft(draft: ScenarioDraftInput, id: string): ScenarioDraftInput {
  return freeze({
    ...draft,
    id,
    document: draft.document ? cloneJsonValue(draft.document) : null,
    diagnostics: draft.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    target: { ...draft.target, schemaFields: [...draft.target.schemaFields] },
    item: { ...draft.item },
    editor: {
      ...draft.editor,
      serializedState: draft.editor.serializedState ? cloneJsonValue(draft.editor.serializedState) : null
    },
    restorationOrigin: { ...draft.restorationOrigin }
  });
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((child) => cloneJsonValue(child)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneJsonValue(child)])) as T;
  }
  return value;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
