import type { EvidenceRef } from "./event-history-authoritative";
import type { DiagnosticAffectedIdentity, DiagnosticObservationBoundary } from "./diagnostic-observation";
import type { LocalInjectionDiagnostic, LocalInjectionDocument } from "./local-injection-document";
import type { LocalInjectionOutcome } from "./local-injection-outcome";
import { validateScenarioCheckpoint } from "./local-injection-scenario-checkpoint";

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

export type ScenarioPrimitive = string | number | boolean | null;

export type ScenarioAssertion = Readonly<{
  id: string;
  kind: "prior-injection-outcome";
  stepId: string;
  expectedDisposition: LocalInjectionOutcome["disposition"];
}> | Readonly<{
  id: string;
  kind: "listener-count";
  stepId: string;
  count: "attempted" | "delivered";
  expected: number;
}> | Readonly<{
  id: string;
  kind: "correlated-local-evidence-exists";
  stepId: string;
  withinActiveMs?: number;
}> | Readonly<{
  id: string;
  kind: "command-key-exists";
  item: ScenarioDraftInput["item"];
  key: string;
  expected: "present" | "absent";
  withinActiveMs?: number;
}> | Readonly<{
  id: string;
  kind: "command-field-equals";
  item: ScenarioDraftInput["item"];
  key: string;
  field: string;
  expected: ScenarioPrimitive;
  withinActiveMs?: number;
}> | Readonly<{
  id: string;
  kind: "diagnostic-observation-exists";
  contractVersion: 1;
  ruleCode: string;
  lifecycle: "occurrence" | "condition";
  minimumSeverity: "information" | "warning" | "error";
  affected: DiagnosticAffectedIdentity;
  withinActiveMs?: number;
}>;

export type ScenarioCheckpoint = Readonly<{
  id: string;
  kind: "checkpoint";
  name: string;
  assertions: readonly ScenarioAssertion[];
}>;

export type ScenarioMember = ScenarioStep | ScenarioCheckpoint;

export type RemovedScenarioStep = Readonly<{
  step: ScenarioStep;
  index: number;
  memberIndex?: number;
}>;

export type LocalInjectionScenario = Readonly<{
  id: string;
  revision: number;
  phase: "edit";
  target: ScenarioTarget;
  steps: readonly ScenarioStep[];
  members: readonly ScenarioMember[];
  restorationOrigin: ScenarioRestorationOrigin;
  nextStepSequence: number;
  removedSteps: readonly RemovedScenarioStep[];
  accountedBytes: number;
  speed: ScenarioSpeed;
}>;

export const SCENARIO_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type ScenarioSpeed = typeof SCENARIO_SPEEDS[number];

export const SCENARIO_MAX_STEPS = 100;
export const SCENARIO_MAX_ACCOUNTED_BYTES = 8 * 1024 * 1024;
export const SCENARIO_MAX_RECORDED_ASSERTION_STRING_BYTES = 1_024;
export const SCENARIO_CHECKPOINT_TRACE_SHELL_RESERVATION_BYTES = 4_096;
export const SCENARIO_CHECKPOINT_ASSERTION_TRACE_RESERVATION_BYTES = 4_096;
// Coordinator outcomes are bounded before they reach this module. Reserve their
// complete canonical form (including generated correlation/Evidence identity)
// rather than shortening an already-settled outcome after dispatch.
const SCENARIO_TRACE_RESERVATION_BYTES_PER_INJECTION_MEMBER = 13 * 1024;
export const SCENARIO_BASE_CONTROL_RECORDS = 128;
export const SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD = 512;
export const SCENARIO_MAX_LEDGER_RECORDS = 8;
export const SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD = 8 * 1024;

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

export type ReviewedScenarioCheckpoint = Readonly<{
  kind: "checkpoint";
  id: string;
  memberOrdinal: number;
  name: string;
  assertions: readonly ScenarioAssertion[];
}>;

export type ReviewedScenarioMember = ReviewedScenarioStep | ReviewedScenarioCheckpoint;

export type ScenarioAuthorizationBoundary = Readonly<{
  id: string;
  kind: "INITIAL_REVIEW" | "DRIFT_REVIEW";
  targetFingerprint: string;
  listenerIds: readonly string[];
  committedEvidenceBoundary: EvidenceRef | null;
  diagnosticObservationBoundary: DiagnosticObservationBoundary | null;
  authorizedRemainingFromOrdinal: number;
  activeOffsetMs: number;
}>;

export type ScenarioDriftRecord = Readonly<{
  id: string;
  kind: "LISTENER_SET" | "SERVER_ITEM_UPDATE" | "MIXED";
  detectedBeforeOrdinal: number;
  activeOffsetMs: number;
  addedListenerIds: readonly string[];
  removedListenerIds: readonly string[];
  evidence: EvidenceRef | null;
  detail: string;
}>;

export type ScenarioTraceEntry = Readonly<{
  stepId: string;
  ordinal: number;
  kind: "attempted";
  injectionId: string;
  outcome: LocalInjectionOutcome;
  evidence: EvidenceRef | null;
  retention: "NOT_CREATED" | "COMMITTED" | "DELIVERED_UNRETAINED";
  evidenceAvailability: "RETAINED" | "UNAVAILABLE_AFTER_CLEAR" | "NOT_APPLICABLE";
  assertion: "NOT_EVALUATED";
  timing?: ScenarioTraceTiming;
  detailLimited?: Readonly<{ originalBytes: number; retainedBytes: number }>;
}> | Readonly<{
  checkpointId: string;
  checkpointName: string;
  memberOrdinal: number;
  kind: "checkpoint";
  status: "pass" | "fail" | "expired" | "invalid" | "unavailable" | "not-evaluable";
  startedActiveOffsetMs: number;
  settledActiveOffsetMs: number;
  startedBoundary: EvidenceRef | null;
  resultBoundary: EvidenceRef | null;
  evidenceAvailability: "RETAINED" | "UNAVAILABLE_AFTER_CLEAR" | "NOT_APPLICABLE";
  diagnosticAvailability: "RETAINED" | "UNAVAILABLE_AFTER_CLEAR" | "NOT_APPLICABLE";
  assertions: readonly import("./local-injection-scenario-checkpoint").ScenarioAssertionResult[];
}> | Readonly<{
  stepId: string;
  ordinal: number;
  kind: "not-run";
  reason: "RUN STOPPED";
  timestamp: number;
  detail: string;
  evidence: null;
  assertion: "NOT_EVALUATED";
  detailLimited?: Readonly<{ originalBytes: number; retainedBytes: number }>;
}>;

export type ScenarioTraceTiming = Readonly<{
  originalDelayMs: number;
  scaledDelayMs: number;
  plannedDispatchActiveOffsetMs: number;
  actualDispatchActiveOffsetMs: number;
  settlementActiveOffsetMs: number;
  latenessMs: number;
  manualOverride: boolean;
  bypassedDelayMs: number;
}>;

export type ScenarioControlRecord = Readonly<{
  sequence: number;
  kind: "PLAY" | "PAUSE" | "RESUME" | "STEP NEXT" | "STOP" | "HIDDEN AUTO-PAUSE";
  activeOffsetMs: number;
  reason: "USER" | "HIDDEN" | "DRIFT" | null;
  detail: string;
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
  members: readonly ReviewedScenarioMember[];
  status: "paused" | "complete" | "stopped";
  nextOrdinal: number;
  nextMemberIndex: number;
  trace: readonly ScenarioTraceEntry[];
  accountedBytes: number;
  traceReservationBytes: number;
  controlReservationBytes: number;
  speed: ScenarioSpeed;
  controls: readonly ScenarioControlRecord[];
  authorizations: readonly ScenarioAuthorizationBoundary[];
  drifts: readonly ScenarioDriftRecord[];
}>;

export function createScenarioFromDraft(
  draft: ScenarioDraftInput,
  options: Readonly<{ scenarioId: string }>
): LocalInjectionScenario {
  const firstStep: ScenarioStep = { kind: "step", id: "step-1", draft };
  const initial = {
    id: options.scenarioId,
    revision: 1,
    phase: "edit" as const,
    target: draft.target,
    steps: [firstStep],
    members: [firstStep],
    restorationOrigin: draft.restorationOrigin,
    nextStepSequence: 2,
    removedSteps: [] as readonly RemovedScenarioStep[],
    accountedBytes: 0,
    speed: 1 as const
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
  const step: ScenarioStep = { kind: "step", id: `step-${scenario.nextStepSequence}`, draft };
  return commitScenarioMutation(scenario, {
    steps: [...scenario.steps, step],
    members: [...scenario.members, step],
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
    members: [...scenario.members, ...steps],
    nextStepSequence: scenario.nextStepSequence + steps.length
  }, true, admission.retainedRunBytes ?? 0);
}

export function moveScenarioStep(scenario: LocalInjectionScenario, stepId: string, direction: "earlier" | "later", admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  if (!scenario.steps.some(({ id }) => id === stepId)) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  const moved = moveScenarioMember(scenario, stepId, direction, admission);
  if (!moved.ok && moved.reason.startsWith("Scenario member cannot move")) {
    return freeze({ ok: false as const, reason: `Scenario Step cannot move ${direction}.` });
  }
  return moved;
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
  const members = [...scenario.members];
  members.splice(members.findIndex(({ id }) => id === stepId) + 1, 0, duplicate);
  return commitScenarioMutation(scenario, { steps, members, nextStepSequence: scenario.nextStepSequence + 1 }, true, admission.retainedRunBytes ?? 0);
}

export function removeScenarioStep(scenario: LocalInjectionScenario, stepId: string, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  if (scenario.steps.length === 1) return freeze({ ok: false as const, reason: "A Scenario must retain at least one Step." });
  const step = scenario.steps[index]!;
  const memberIndex = scenario.members.findIndex(({ id }) => id === stepId);
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.filter(({ id }) => id !== stepId),
    members: scenario.members.filter(({ id }) => id !== stepId),
    removedSteps: [...scenario.removedSteps, { step, index, memberIndex }]
  }, true, admission.retainedRunBytes ?? 0);
}

export function undoScenarioStepRemoval(scenario: LocalInjectionScenario, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const removed = scenario.removedSteps.at(-1);
  if (!removed) return freeze({ ok: false as const, reason: "No removed Scenario Step is available to restore." });
  const steps = [...scenario.steps];
  steps.splice(Math.min(removed.index, steps.length), 0, removed.step);
  const members = [...scenario.members];
  members.splice(Math.min(removed.memberIndex ?? removed.index, members.length), 0, removed.step);
  return commitScenarioMutation(scenario, { steps, members, removedSteps: scenario.removedSteps.slice(0, -1) }, true, admission.retainedRunBytes ?? 0);
}

export function updateScenarioStepDraft(scenario: LocalInjectionScenario, stepId: string, draft: ScenarioDraftInput, admission: ScenarioAdmissionContext = {}): ScenarioMutation {
  const index = scenario.steps.findIndex(({ id }) => id === stepId);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Step is unavailable." });
  const reason = scenarioTargetIncompatibility(scenario.target, draft.target);
  if (reason) return freeze({ ok: false as const, reason });
  const updated: ScenarioStep = { ...scenario.steps[index]!, draft };
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.map((step, stepIndex) => stepIndex === index ? updated : step),
    members: scenario.members.map((member) => member.kind === "step" && member.id === stepId ? updated : member)
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
  const updated: ScenarioStep = { ...scenario.steps[index]!, draft: { ...scenario.steps[index]!.draft, editor } };
  return commitScenarioMutation(scenario, {
    steps: scenario.steps.map((step, stepIndex) => stepIndex === index ? updated : step),
    members: scenario.members.map((member) => member.kind === "step" && member.id === stepId ? updated : member)
  }, false, admission.retainedRunBytes ?? 0);
}

export function admitScenarioValidation(
  scenario: LocalInjectionScenario,
  steps: readonly ScenarioStep[],
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  if (steps.length !== scenario.steps.length || steps.some((step, index) => step.id !== scenario.steps[index]?.id)) {
    return freeze({ ok: false as const, reason: "Scenario validation must preserve the exact ordered Step identities." });
  }
  const draftsById = new Map(steps.map((step) => [step.id, step]));
  return commitScenarioMutation(scenario, {
    steps,
    members: scenario.members.map((member) => member.kind === "step" ? draftsById.get(member.id) ?? member : member)
  }, false, admission.retainedRunBytes ?? 0);
}

export function addScenarioCheckpoint(
  scenario: LocalInjectionScenario,
  checkpoint: ScenarioCheckpoint,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  if (scenario.members.some(({ id }) => id === checkpoint.id)) return freeze({ ok: false as const, reason: "Scenario member identity is already in use." });
  return commitScenarioMutation(scenario, { members: [...scenario.members, checkpoint] }, true, admission.retainedRunBytes ?? 0);
}

export function moveScenarioMember(
  scenario: LocalInjectionScenario,
  memberId: string,
  direction: "earlier" | "later",
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  const from = scenario.members.findIndex(({ id }) => id === memberId);
  const to = direction === "earlier" ? from - 1 : from + 1;
  if (from < 0) return freeze({ ok: false as const, reason: "Scenario member is unavailable." });
  if (to < 0 || to >= scenario.members.length) return freeze({ ok: false as const, reason: `Scenario member cannot move ${direction}.` });
  const members = [...scenario.members];
  [members[from], members[to]] = [members[to]!, members[from]!];
  const steps = members.filter((member): member is ScenarioStep => member.kind === "step");
  return commitScenarioMutation(scenario, { members, steps }, true, admission.retainedRunBytes ?? 0);
}

export function removeScenarioCheckpoint(
  scenario: LocalInjectionScenario,
  checkpointId: string,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  const checkpoint = scenario.members.find((member) => member.kind === "checkpoint" && member.id === checkpointId);
  if (!checkpoint) return freeze({ ok: false as const, reason: "Scenario Checkpoint is unavailable." });
  return commitScenarioMutation(scenario, { members: scenario.members.filter(({ id }) => id !== checkpointId) }, true, admission.retainedRunBytes ?? 0);
}

export function updateScenarioCheckpoint(
  scenario: LocalInjectionScenario,
  checkpoint: ScenarioCheckpoint,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  const index = scenario.members.findIndex((member) => member.kind === "checkpoint" && member.id === checkpoint.id);
  if (index < 0) return freeze({ ok: false as const, reason: "Scenario Checkpoint is unavailable." });
  const members = [...scenario.members];
  members[index] = checkpoint;
  return commitScenarioMutation(scenario, { members }, true, admission.retainedRunBytes ?? 0);
}

export function reviewScenario(
  scenario: LocalInjectionScenario,
  facts: Readonly<{
    runId: string;
    committedEvidenceSeed: EvidenceRef | null;
    targetFingerprint: string;
    activeCommandKeysByItem: readonly Readonly<{ item: ScenarioDraftInput["item"]; keys: readonly string[] }>[];
    listenerIds?: readonly string[];
    historyAccepting?: boolean;
    clearInProgress?: boolean;
    activeOffsetMs?: number;
    retainedRunBytes?: number;
    diagnosticObservationBoundary?: DiagnosticObservationBoundary | null;
  }>
): Readonly<{ ok: true; run: ScenarioRun }> | Readonly<{ ok: false; reason: string; stepId?: string }> {
  if (facts.historyAccepting === false || facts.clearInProgress) {
    return Object.freeze({ ok: false as const, reason: "Scenario Review requires Event History to be RUNNING and accepting; Clear must be idle." });
  }
  if (scenario.steps.length === 0) return Object.freeze({ ok: false as const, reason: "Add at least one Scenario Step before Review." });
  const keysByItem = new Map(facts.activeCommandKeysByItem.map(({ item, keys }) => [itemKey(item), new Set(keys)]));
  const reviewed: ReviewedScenarioStep[] = [];
  const reviewedMembers: ReviewedScenarioMember[] = [];
  const earlierStepIds: string[] = [];
  for (let memberIndex = 0; memberIndex < scenario.members.length; memberIndex += 1) {
    const member = scenario.members[memberIndex]!;
    if (member.kind === "checkpoint") {
      if (member.assertions.some(({ kind }) => kind === "diagnostic-observation-exists") && !facts.diagnosticObservationBoundary) {
        return Object.freeze({ ok: false as const, reason: "Diagnostic Observation assertions require an available authorization boundary." });
      }
      const validity = validateScenarioCheckpoint(member, {
        targetMode: scenario.target.mode,
        deliveryPath: scenario.target.deliveryPath,
        earlierStepIds
      });
      if (!validity.ok) return Object.freeze({ ok: false as const, reason: validity.reason });
      reviewedMembers.push({
        kind: "checkpoint",
        id: member.id,
        memberOrdinal: memberIndex + 1,
        name: member.name,
        assertions: member.assertions
      });
      continue;
    }
    const step = member;
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
      ordinal: reviewed.length + 1,
      sourceEventId: step.draft.sourceEventId,
      rawText: step.draft.rawText,
      document: step.draft.document,
      relativeDelayMs: Math.max(0, step.draft.relativeDelayMs)
    });
    reviewedMembers.push(reviewed.at(-1)!);
    earlierStepIds.push(step.id);
  }
  const candidate = freeze({
      id: facts.runId,
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      target: scenario.target,
      targetFingerprint: facts.targetFingerprint,
      committedEvidenceSeed: facts.committedEvidenceSeed,
      steps: reviewed,
      members: reviewedMembers,
      status: "paused" as const,
      nextOrdinal: 1,
      nextMemberIndex: 0,
      trace: [],
      accountedBytes: 0,
      traceReservationBytes: 0,
      controlReservationBytes: 0,
      speed: scenario.speed,
      controls: [],
      authorizations: [freeze({
        id: `${facts.runId}:authorization:1`,
        kind: "INITIAL_REVIEW" as const,
        targetFingerprint: facts.targetFingerprint,
        listenerIds: [...(facts.listenerIds ?? (scenario.target.listenerId ? [scenario.target.listenerId] : []))].sort(),
        committedEvidenceBoundary: facts.committedEvidenceSeed,
        diagnosticObservationBoundary: facts.diagnosticObservationBoundary ?? null,
        authorizedRemainingFromOrdinal: 1,
        activeOffsetMs: facts.activeOffsetMs ?? 0
      })],
      drifts: []
  });
  const oversizedAuthorization = candidate.authorizations.find((record) => canonicalBytes(record) > SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD);
  if (oversizedAuthorization) {
    return Object.freeze({
      ok: false as const,
      reason: `Scenario authorization requires ${canonicalBytes(oversizedAuthorization)} canonical bytes, exceeding its ${SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD}-byte bounded ledger record; no Run was created.`
    });
  }
  const admission = scenarioRunAdmission(scenario, candidate, facts.retainedRunBytes ?? 0);
  if (!admission.ok) return Object.freeze({ ok: false as const, reason: admission.reason });
  return Object.freeze({
    ok: true as const,
    run: freeze({ ...candidate, accountedBytes: admission.accountedBytes, traceReservationBytes: admission.traceReservationBytes, controlReservationBytes: admission.controlReservationBytes })
  });
}

export function updateScenarioSpeed(
  scenario: LocalInjectionScenario,
  speed: ScenarioSpeed,
  admission: ScenarioAdmissionContext = {}
): ScenarioMutation {
  if (!SCENARIO_SPEEDS.includes(speed)) return freeze({ ok: false as const, reason: "Choose a supported Scenario speed." });
  const candidate = { ...scenario, speed, revision: scenario.revision + 1, accountedBytes: 0 };
  const accountedBytes = scenarioDefinitionBytes(candidate);
  if (accountedBytes + (admission.retainedRunBytes ?? 0) > SCENARIO_MAX_ACCOUNTED_BYTES) {
    return freeze({ ok: false as const, capacity: "bytes" as const, reason: "Scenario and retained Runs would exceed 8 MiB of canonical accounted state; speed did not change." });
  }
  return freeze({ ok: true as const, scenario: freeze({ ...candidate, accountedBytes }) });
}

export function scenarioRunAdmission(
  scenario: LocalInjectionScenario,
  run: ScenarioRun,
  retainedRunBytes = 0
): Readonly<{ ok: true; accountedBytes: number; traceReservationBytes: number; controlReservationBytes: number; stepCount: number }>
  | Readonly<{ ok: false; capacity: "bytes"; reason: string }> {
  const traceReservationBytes = run.members.reduce((bytes, member) => bytes + scenarioMemberTraceReservationBytes(member), 0);
  const { accountedBytes: _runBytes, traceReservationBytes: _traceBytes, controlReservationBytes: _controlBytes, trace: _trace, controls: _controls, steps: _derivedSteps, ...immutablePlan } = run;
  const ledgerReservationBytes = SCENARIO_MAX_LEDGER_RECORDS * SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD;
  const currentRunBaseBytes = scenario.accountedBytes + canonicalBytes(immutablePlan) + canonicalBytes(run.trace) + traceReservationBytes + ledgerReservationBytes;
  const totalBaseAccountedBytes = retainedRunBytes + currentRunBaseBytes;
  const availableControlRecords = Math.floor((SCENARIO_MAX_ACCOUNTED_BYTES - totalBaseAccountedBytes) / SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD);
  const minimumControlRecords = run.members.length + 2;
  if (availableControlRecords < minimumControlRecords) {
    return freeze({ ok: false as const, capacity: "bytes" as const, reason: "Scenario Run would exceed 8 MiB after reserving its immutable plan and append-only Trace; no Run was created." });
  }
  const desiredControlRecords = Math.max(SCENARIO_BASE_CONTROL_RECORDS, minimumControlRecords);
  const controlReservationBytes = Math.min(desiredControlRecords, availableControlRecords) * SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD;
  const accountedBytes = currentRunBaseBytes + controlReservationBytes;
  return freeze({ ok: true as const, accountedBytes, traceReservationBytes, controlReservationBytes, stepCount: run.steps.length });
}

function scenarioMemberTraceReservationBytes(member: ReviewedScenarioMember): number {
  switch (member.kind) {
    case "step":
      return SCENARIO_TRACE_RESERVATION_BYTES_PER_INJECTION_MEMBER + canonicalBytes({ stepId: member.id, ordinal: member.ordinal });
    case "checkpoint":
      // The immutable member accounts for the expected values copied into the
      // result. Runtime observations are capped before they enter the Trace.
      return SCENARIO_CHECKPOINT_TRACE_SHELL_RESERVATION_BYTES + canonicalBytes(member) + member.assertions.length * SCENARIO_CHECKPOINT_ASSERTION_TRACE_RESERVATION_BYTES;
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
  const member = run.members[run.nextMemberIndex];
  const step = member?.kind === "step" ? member : undefined;
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
    trace: [...run.trace, ...run.members.slice(run.nextMemberIndex).filter((remaining): remaining is ReviewedScenarioStep => remaining.kind === "step").map((remaining) => freeze({
      stepId: remaining.id,
      ordinal: remaining.ordinal,
      kind: "not-run" as const,
      reason: "RUN STOPPED" as const,
      timestamp: terminal.timestamp,
      detail: remaining.ordinal === step.ordinal ? terminal.detail : `RUN STOPPED before Step ${remaining.ordinal}; this Step was not attempted.`,
      evidence: null,
      assertion: "NOT_EVALUATED" as const
    }))]
  });
  const retainedEvidence = terminal.outcome.disposition === "delivered" ? terminal.evidence : null;
  const trace: ScenarioTraceEntry = freeze({
    stepId: step.id,
    ordinal: step.ordinal,
    kind: "attempted" as const,
    injectionId: adapter.injectionId,
    outcome: terminal.outcome,
    evidence: retainedEvidence,
    retention: retainedEvidence !== null
      ? "COMMITTED" as const
      : terminal.outcome.disposition === "delivered" ? "DELIVERED_UNRETAINED" as const : "NOT_CREATED" as const,
    evidenceAvailability: retainedEvidence !== null ? "RETAINED" as const : "NOT_APPLICABLE" as const,
    assertion: "NOT_EVALUATED" as const
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
    evidence: null,
    assertion: "NOT_EVALUATED" as const
  }));
  return freeze({
    ...run,
    nextOrdinal: delivered ? nextOrdinal : run.nextOrdinal,
    nextMemberIndex: delivered ? run.nextMemberIndex + 1 : run.nextMemberIndex,
    status: delivered
      ? run.nextMemberIndex + 1 >= run.members.length ? "complete" as const : "paused" as const
      : "stopped" as const,
    trace: [...run.trace, trace, ...stoppedRemainder]
  });
}

export function appendScenarioDrift(
  run: ScenarioRun,
  drift: Omit<ScenarioDriftRecord, "id" | "detectedBeforeOrdinal"> & Partial<Pick<ScenarioDriftRecord, "id" | "detectedBeforeOrdinal">>
): ScenarioRun {
  if (run.authorizations.length + run.drifts.length >= SCENARIO_MAX_LEDGER_RECORDS) return run;
  const record = freeze({
    ...drift,
    id: drift.id ?? `${run.id}:drift:${run.drifts.length + 1}`,
    detectedBeforeOrdinal: drift.detectedBeforeOrdinal ?? run.nextOrdinal,
    addedListenerIds: [...drift.addedListenerIds].sort(),
    removedListenerIds: [...drift.removedListenerIds].sort()
  });
  if (canonicalBytes(record) > SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD) return run;
  return freeze({ ...run, drifts: [...run.drifts, record] });
}

export function appendScenarioAuthorization(
  run: ScenarioRun,
  input: Readonly<{
    targetFingerprint: string;
    listenerIds: readonly string[];
    committedEvidenceBoundary: EvidenceRef | null;
    diagnosticObservationBoundary?: DiagnosticObservationBoundary | null;
    activeOffsetMs: number;
  }>
): ScenarioRun {
  if (run.authorizations.length + run.drifts.length >= SCENARIO_MAX_LEDGER_RECORDS) return run;
  const authorization = freeze({
    id: `${run.id}:authorization:${run.authorizations.length + 1}`,
    kind: "DRIFT_REVIEW" as const,
    targetFingerprint: input.targetFingerprint,
    listenerIds: [...input.listenerIds].sort(),
    committedEvidenceBoundary: input.committedEvidenceBoundary,
    diagnosticObservationBoundary: input.diagnosticObservationBoundary ?? null,
    authorizedRemainingFromOrdinal: run.nextOrdinal,
    activeOffsetMs: input.activeOffsetMs
  });
  if (canonicalBytes(authorization) > SCENARIO_LEDGER_RESERVATION_BYTES_PER_RECORD) return run;
  return freeze({
    ...run,
    targetFingerprint: input.targetFingerprint,
    authorizations: [...run.authorizations, authorization]
  });
}

export function markScenarioEvidenceUnavailableAfterClear(run: ScenarioRun): ScenarioRun {
  if (run.status === "paused") return run;
  let changed = false;
  const trace = run.trace.map((entry) => {
    if (entry.kind === "checkpoint" && entry.evidenceAvailability === "RETAINED") {
      changed = true;
      return freeze({
        ...entry,
        evidenceAvailability: "UNAVAILABLE_AFTER_CLEAR" as const,
        diagnosticAvailability: entry.diagnosticAvailability === "RETAINED" ? "UNAVAILABLE_AFTER_CLEAR" as const : entry.diagnosticAvailability
      });
    }
    if (entry.kind === "checkpoint" && entry.diagnosticAvailability === "RETAINED") {
      changed = true;
      return freeze({ ...entry, diagnosticAvailability: "UNAVAILABLE_AFTER_CLEAR" as const });
    }
    if (entry.kind !== "attempted" || entry.evidence === null || entry.evidenceAvailability !== "RETAINED") return entry;
    changed = true;
    return freeze({ ...entry, evidenceAvailability: "UNAVAILABLE_AFTER_CLEAR" as const });
  });
  return changed ? freeze({ ...run, trace }) : run;
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
      evidence: null,
      assertion: "NOT_EVALUATED" as const
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
  change: Partial<Pick<LocalInjectionScenario, "steps" | "members" | "nextStepSequence" | "removedSteps">>,
  advanceRevision = true,
  retainedRunBytes = 0
): ScenarioMutation {
  const steps = change.steps ?? scenario.steps;
  const members = change.members ?? scenario.members;
  if (steps.length > SCENARIO_MAX_STEPS) {
    return freeze({ ok: false as const, capacity: "steps" as const, reason: `Scenario admits at most ${SCENARIO_MAX_STEPS} Steps; no membership changed.` });
  }
  const candidate = {
    ...scenario,
    ...change,
    steps,
    members,
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
  // `steps` is a compatibility projection of the canonical ordered `members`
  // collection and must not be charged twice.
  const { accountedBytes: _ignored, steps: _derivedSteps, ...accounted } = scenario as LocalInjectionScenario;
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
