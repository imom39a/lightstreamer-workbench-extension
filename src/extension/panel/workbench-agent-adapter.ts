import type { CaptureStatus } from "../../bridge/messages";
import type { CommandStateProjections } from "../../core/command-state";
import type { DiagnosticObservationJournal } from "../../core/diagnostic-observation";
import type { LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { EventHistory, EvidenceRef, HistoryStatus } from "../../core/event-history-authoritative";
import type { EvidenceIdentity } from "../../core/evidence-filter-contract";
import { createFilter, type Filter } from "../../core/filter-algebra";
import { classifyInjectionSourceFieldExecutability } from "../../core/item-update-value-semantics";
import { expandJsonStringFields } from "../../core/json-string-fields";
import { expandLocalInjectionCandidateMatrix } from "../../core/local-injection-candidate-matrix";
import type { NativeChangeContext, NativeReviewedChangeFacts } from "../../core/local-injection-change-semantics";
import {
  applyLocalInjectionDocumentToDraft,
  createLocalInjectionDocumentFromDraft,
  type LocalInjectionDiagnostic
} from "../../core/local-injection-document";
import {
  addScenarioCheckpoint,
  addScenarioStep,
  admitScenarioValidation,
  createScenarioFromDraft,
  reviewScenario,
  scenarioTargetIncompatibility,
  type LocalInjectionScenario,
  type ScenarioDraftInput
} from "../../core/local-injection-scenario";
import { validateScenarioCheckpoint } from "../../core/local-injection-scenario-checkpoint";
import { readAgentCommandRows } from "./agent-command-rows";
import { readAgentCommandState } from "./agent-command-state";
import { agentNativeChangePreview, describeAgentInjectionTarget } from "./agent-injection-capabilities";
import type {
  AgentCandidateInput,
  AgentDraftInput,
  AgentLocalSettlement,
  AgentRuntime,
  AgentScenarioMember,
  AgentScenarioPlanInput,
  AgentScopeSearchSnapshot
} from "./agent-runtime";
import { describeAgentSourceContext } from "./agent-source-context";
import type { CommittedEvidencePipelineFollowerState } from "./committed-evidence-pipeline";
import type { EvidenceInvestigationQuery } from "./evidence-investigation-query";
import {
  agentTarget,
  authoredDraftFromScope,
  candidateReplayability,
  cloneReinjectionDraft,
  emptyScenarioCaptureWorkspace,
  lightstreamerPayload,
  localInjectionReady,
  type LocalInjectionDraftState,
  type LocalInjectionEntryIntent,
  type ScenarioNativeChangeStep,
  type ScenarioState,
  type WorkbenchLocalInjectionAnchor
} from "./local-injection-draft-state";
import type { LocalInjectionExecutionCoordinator } from "./local-injection-execution-coordinator";
import type { ServerInjectionController } from "./server-injection-controller";
import { structuralEvidenceScope } from "./structural-evidence-scope";
import type { TopologyProjection } from "./topology-projection";
import { findTopologySelection } from "./topology-view-model";
import type {
  WorkbenchCaptureSnapshot,
  WorkbenchCommand,
  WorkbenchLocalInjectionSnapshot,
  WorkbenchRetentionSnapshot,
  WorkbenchSnapshot
} from "./workbench-runtime";

/**
 * The runtime state and operations the agent adapter reads and drives. The
 * runtime implements it directly; every Panel Session invariant (visibility,
 * page epoch, protected-document exclusivity) is still checked here before an
 * agent call changes a Draft or Scenario.
 *
 * Mutable members are the protected Local Injection Draft and Scenario slots
 * that agent preparation fills. They are the remaining coupling to the
 * runtime's Local Injection and Scenario lifecycles.
 */
export interface WorkbenchAgentAdapterHost {
  readonly disposed: boolean;
  readonly visible: boolean;
  readonly currentPageEpoch: string | null;
  readonly captureStatus: CaptureStatus;
  readonly scopeId: string | null;
  readonly canonicalFilter: Filter;
  readonly history: EventHistory;
  readonly historyStatus: HistoryStatus;
  readonly clearState: WorkbenchRetentionSnapshot["clearState"];
  readonly committedEvidenceBoundary: EvidenceRef | null;
  readonly commandProjectionEvidenceBoundary: EvidenceIdentity | null;
  readonly commandStateProjections: CommandStateProjections;
  readonly topologyProjection: TopologyProjection;
  /** Non-null while committed projections are being rebuilt; agent reads treat that as not ready. */
  readonly projectionRecovery: unknown;
  readonly scenarioFollowerPhase: CommittedEvidencePipelineFollowerState["progress"]["phase"];
  readonly diagnosticObservations: DiagnosticObservationJournal;
  readonly diagnosticObservationSettlement: Promise<void>;
  readonly evidenceQuery: EvidenceInvestigationQuery;
  readonly localInjectionExecutionCoordinator: LocalInjectionExecutionCoordinator;
  readonly agentLocalSettlements: ReadonlyMap<string, AgentLocalSettlement>;
  readonly serverInjection: ServerInjectionController;

  localInjectionDraft: LocalInjectionDraftState | null;
  localInjectionBlockedEntry: LocalInjectionEntryIntent | null;
  localInjectionDiscardConfirmation: boolean;
  localInjectionEntryError: string | null;
  localInjectionSequence: number;
  scenarioState: ScenarioState | null;

  subscribe(listener: () => void): () => void;
  dispatch(command: WorkbenchCommand): void;
  commitTransition(): void;
  captureSnapshot(): WorkbenchCaptureSnapshot;
  scopeSnapshot(): WorkbenchSnapshot["scope"];
  agentScopeSearchSnapshot(): AgentScopeSearchSnapshot;
  localInjectionSnapshot(): WorkbenchLocalInjectionSnapshot;

  createLocalInjectionCandidate(
    intent: LocalInjectionEntryIntent,
    sourceOverride?: LightstreamerEventEnvelope,
    options?: Readonly<{ id?: string; recordError?: boolean }>
  ): LocalInjectionDraftState | null;
  refreshLocalInjectionValidation(draft: LocalInjectionDraftState): void;
  validateLocalInjectionTarget(anchor: WorkbenchLocalInjectionAnchor): LocalInjectionDiagnostic[];
  localInjectionFingerprint(draft: LocalInjectionDraftState, changeContext?: NativeChangeContext): string;
  setLocalInjectionJson(text: string): void;
  executeLocalInjection(): void;
  finishLocalInjection(): void;
  convertLocalInjectionToScenario(): void;

  scenarioDraftInput(draft: LocalInjectionDraftState, ready?: boolean): ScenarioDraftInput;
  scenarioTargetFingerprint(draft: LocalInjectionDraftState): string;
  scenarioCurrentListenerIds(draft: LocalInjectionDraftState): readonly string[];
  scenarioNativeChanges(
    steps: readonly ScenarioNativeChangeStep[],
    drafts: ReadonlyMap<string, LocalInjectionDraftState>
  ): ReadonlyMap<string, NativeReviewedChangeFacts>;
  activeCommandKeys(anchor: WorkbenchLocalInjectionAnchor): readonly string[];
  reviewCurrentScenario(): void;
  setScenarioStepJson(stepId: string, text: string): void;
  finishScenario(): void;
}

/**
 * Builds the panel's AgentRuntime: read-only Scope, Evidence, COMMAND and
 * diagnostic reads plus agent-prepared Local Injection, Scenario, and Server
 * Injection documents. Agent preparation never bypasses the visible Panel
 * Session or the human approval latch for Server Injection.
 */
export function createWorkbenchAgentAdapter(host: WorkbenchAgentAdapterHost): AgentRuntime {
  const adapter: AgentRuntime = {
    status: () => ({ pageEpoch: host.currentPageEpoch, visible: host.visible, captureStatus: host.captureStatus, capture: host.captureSnapshot(), history: host.history.status() }),
    commandState: input => readAgentCommandState(input, {
      pageEpoch: host.currentPageEpoch,
      disposed: host.disposed,
      scope: findTopologySelection(host.topologyProjection.snapshot(), input.scopeId),
      history: host.history.status(),
      projectionBoundary: host.commandProjectionEvidenceBoundary,
      projectionReady: host.projectionRecovery === null && host.scenarioFollowerPhase === "LIVE",
      readKey: (projection, target) => host.commandStateProjections.readKey(projection, target)
    }),
    commandRows: input => readAgentCommandRows(input, {
      pageEpoch: host.currentPageEpoch, disposed: host.disposed, scope: findTopologySelection(host.topologyProjection.snapshot(), input.scopeId),
      history: host.history.status(), projectionBoundary: host.commandProjectionEvidenceBoundary,
      projectionReady: host.projectionRecovery === null && host.scenarioFollowerPhase === "LIVE",
      readRows: (projection, target) => host.commandStateProjections.readRows(projection, target),
      readKey: (projection, target) => host.commandStateProjections.readKey(projection, target)
    }),
    scopes: (offset, limit) => {
      const scope = host.scopeSnapshot();
      return { total: scope.structure.length, offset, nodes: scope.structure.slice(offset, offset + limit).map(node => scope.resolveNode(node.id)) };
    },
    scope: (id, options) => {
      const scope = host.scopeSnapshot();
      const node = scope.resolveNode(id);
      if (!node) throw new Error("TARGET_RETIRED: Scope is unavailable in this Panel Session. Locate a current Scope before reading it.");
      const target = findTopologySelection(host.topologyProjection.snapshot(), id);
      const candidate = authoredDraftFromScope(target, host.currentPageEpoch);
      return { node, pageEpoch: host.currentPageEpoch, readContext: describeAgentSourceContext(id, target, options), localInjection: candidate ? { anchor: candidate.anchor,
        capabilities: describeAgentInjectionTarget(candidate.anchor, candidate.draft),
        document: createLocalInjectionDocumentFromDraft(candidate.draft), diagnostics: host.validateLocalInjectionTarget(candidate.anchor) }
        : { unavailable: "Source-free authoring requires one live COMMAND, MERGE or DISTINCT item with a declared field list and current delivery context. RAW is unsupported; captured Evidence can describe other supported targets.",
          recovery: {
            evidence: { tool: "query_evidence", arguments: { scopeId: id, where: { kind: ["ITEM-UPDATE"] }, limit: 1, order: "NEWEST_FIRST" } },
            target: node.kind === "subscription"
              ? { tool: "search_scope", arguments: { kind: "item", parentScopeId: id, text: node.label } }
              : { tool: "list_scope", arguments: { offset: 0, limit: 25 } },
            preparation: "Use a matching retained evidence.identity with prepare_local_injection and the current pageEpoch. Preparation copies the exact editable field schema; inspect target diagnostics before execution."
          } } };
    },
    scopeSearchSnapshot: () => host.agentScopeSearchSnapshot(),
    queryBoundary: (scopeId, useCurrentInvestigation = false) => {
      const id = useCurrentInvestigation ? host.scopeId : scopeId;
      const target = id ? findTopologySelection(host.topologyProjection.snapshot(), id) : null;
      if (id && !target) throw new Error("TARGET_RETIRED: Scope is unavailable. Locate a current Scope before reading it.");
      return { scope: structuralEvidenceScope(target), filter: useCurrentInvestigation ? host.canonicalFilter : createFilter() };
    },
    query: async (input) => {
      const target = input.scopeId ? findTopologySelection(host.topologyProjection.snapshot(), input.scopeId) : null;
      if (input.scopeId && !target) throw new Error("TARGET_RETIRED: Scope is unavailable. Locate a current Scope before reading it.");
      const result = await host.evidenceQuery.query({
        at: input.at, scope: input.scope ?? (input.scopeId ? structuralEvidenceScope(target) : { kind: "PAGE" }),
        filter: input.filter ?? { ...createFilter(), text: input.text ?? "" },
        ...(input.find ? { find: input.find } : {}),
        page: { order: input.order ?? "OLDEST_FIRST", size: input.size, ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.adaptivePage ? { adaptiveSize: true } : {}) },
        discover: input.discover ?? [], includePayload: input.includePayload, signal: input.signal, workBudget: input.workBudget, sequenceWindow: input.sequenceWindow,
        fieldPredicates: input.fieldPredicates, aggregate: input.aggregate,
        ...(input.lookup ? { lookup: input.lookup } : {})
      });
      if (!result.ok) throw new Error(`${result.problem.code}: ${result.problem.message}`);
      return result.value;
    },
    subscribeOperations: listener => host.subscribe(listener),
    subscribeEvidence: listener => {
      // History notification is independent of UI publication/visibility. Runtime
      // publication also wakes waits when the inspected page identity changes.
      const history = host.history.follow({ from: "NOW" }, () => listener());
      const runtime = host.subscribe(listener);
      return () => { history(); runtime(); };
    },
    diagnostics: async (after, signal) => {
      const assertCurrent = () => { if (signal?.aborted) throw new Error("QUERY_CANCELLED: Diagnostic read was cancelled."); };
      assertCurrent();
      await host.diagnosticObservationSettlement;
      assertCurrent();
      const result = await host.diagnosticObservations.query({ after, through: host.diagnosticObservations.currentBoundary() });
      assertCurrent();
      return result;
    },
    validateCandidate: (input, pageEpoch, stillAuthorized) => validateAgentCandidate(input, pageEpoch, stillAuthorized),
    generateCandidates: async (input, pageEpoch, stillAuthorized) => {
      const available = () => {
        if (!stillAuthorized()) throw new Error("ACCESS_REVOKED: Candidate generation was cancelled or access revoked.");
        if (host.disposed || !host.visible || host.currentPageEpoch !== pageEpoch) throw new Error("TARGET_CHANGED: Candidate generation requires the current visible page.");
      };
      available();
      const { candidate } = await resolveAgentCandidate("matrix", input.base, available);
      if (!candidate.document) throw new Error("INVALID_CANDIDATE_MATRIX: The base document is not valid.");
      const matrix = expandLocalInjectionCandidateMatrix({ ...input, target: host.scenarioDraftInput(candidate).target,
        document: candidate.document, fieldValueStates: candidate.nativeChanges?.fieldValueStates ?? candidate.baseDraft.fieldValueStates,
        jsonStringFields: expandJsonStringFields(candidate.baseDraft.fields).encodedFieldNames });
      const members: Extract<AgentScenarioMember, { kind: "step" }>[] = matrix.members.map(member => ({ kind: "step", id: member.id,
        ...(input.base.evidence ? { evidence: input.base.evidence } : { scopeId: input.base.scopeId }),
        document: JSON.stringify(member.document), delayMs: member.delayMs }));
      const validation = await validateAgentCandidate({ kind: "scenario", plan: { members } }, pageEpoch, stillAuthorized);
      available();
      return { ...matrix, members: members.map(member => ({ ...member, document: JSON.parse(member.document!) })), validation };
    },
    prepareScenarioPlan: (input, pageEpoch, stillAuthorized) => prepareAgentScenarioPlan(input, pageEpoch, stillAuthorized),
    prepare: (steps, scenario, pageEpoch, stillAuthorized) => prepareAgentDrafts(steps, scenario, pageEpoch, stillAuthorized),
    edit: (document, stepId) => {
      if (host.scenarioState) {
        if (!stepId || !host.scenarioState.scenario.steps.some(step => step.id === stepId)) throw new Error("Choose an exact Scenario Step.");
        host.dispatch({ type: "edit-scenario" });
        host.setScenarioStepJson(stepId, document);
        host.reviewCurrentScenario();
      } else host.setLocalInjectionJson(document);
    },
    local: () => host.localInjectionSnapshot(),
    scenario: () => host.scenarioState ? {
      phase: host.scenarioState.phase, scenario: host.scenarioState.scenario,
      run: host.scenarioState.run, runner: host.scenarioState.runnerSnapshot,
      membershipError: host.scenarioState.membershipError
    } : null,
    execute: () => host.executeLocalInjection(),
    localSettlement: executionId => host.agentLocalSettlements.get(executionId) ?? null,
    control: (action) => {
      const types = { step: "step-next-scenario", play: "play-scenario", pause: "pause-scenario", stop: "stop-scenario", "re-review": "re-review-scenario" } as const;
      host.dispatch({ type: types[action] });
    },
    finish: () => host.scenarioState ? host.finishScenario() : host.finishLocalInjection(),
    prepareServerInjection: (draft, requestId) => host.serverInjection.prepareForAgent(draft, requestId),
    serverInjection: () => host.serverInjection.snapshot(),
    executeApprovedServerInjection: requestId => host.serverInjection.executeApprovedForAgent(requestId),
    abortServerInjection: requestId => host.serverInjection.abortForAgent(requestId),
    revokeServerInjectionApproval: () => host.serverInjection.revokeAgentApproval(),
    abortDocument: () => {
      if (host.scenarioState) {
        if (!["edit", "review"].includes(host.scenarioState.phase) || (host.scenarioState.run?.trace.length ?? 0) > 0) throw new Error("TARGET_CHANGED: Only an unexecuted Scenario can be aborted.");
        host.finishScenario();
      } else {
        const draft = host.localInjectionDraft;
        if (!draft || !["edit", "review"].includes(draft.phase) || draft.outcome || draft.executionId) throw new Error("TARGET_CHANGED: Only an unexecuted Draft can be aborted.");
        host.localInjectionDraft = null;
        host.localInjectionBlockedEntry = null;
        host.localInjectionDiscardConfirmation = false;
        host.localInjectionEntryError = null;
        host.commitTransition();
      }
    }
  };

  async function validateAgentCandidate(input: AgentCandidateInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<unknown> {
    const available = () => {
      if (!stillAuthorized()) throw new Error("ACCESS_REVOKED: Agent access was revoked while validating the candidate.");
      if (host.disposed || !host.visible || host.currentPageEpoch !== pageEpoch) throw new Error("TARGET_CHANGED: Page changed or panel is hidden/closed. Inspect the current target again.");
    };
    const validate = async (id: string, draft: AgentDraftInput) => {
      available();
      return resolveAgentCandidate(id, draft, available);
    };
    available();
      if (input.kind === "draft") {
        const built = await validate("candidate", input.draft);
        const candidate = built.candidate;
        const diagnostics = [...candidate.documentDiagnostics, ...candidate.targetDiagnostics];
        const replayability = candidateReplayability(candidate, built.replayability);
        const valid = localInjectionReady(candidate) && !candidate.nativeChanges?.semantics.refusal && replayability.replayable;
        const reason = candidate.nativeChanges?.semantics.refusal
          ?? diagnostics.find(diagnostic => diagnostic.severity === "error")?.message
          ?? (!replayability.replayable ? "One or more captured fields require an explicit concrete Draft value." : "Draft is not ready for Local Injection.");
        return Object.freeze({ valid, ...(!valid ? { reason } : {}), pageEpoch, target: agentTarget(candidate), candidates: [{ id: "candidate", kind: "step", valid, diagnostics, replayability, nativeChanges: agentNativeChangePreview(candidate.nativeChanges) }], checkpoints: [], limitations: ["Validation does not inspect arbitrary page state or DOM."] });
      }
      const members: unknown[] = [];
      const builtById = new Map<string, LocalInjectionDraftState>();
      const steps: Array<{ id: string; valid: boolean; diagnostics: readonly LocalInjectionDiagnostic[]; nativeChanges: ReturnType<typeof agentNativeChangePreview> }> = [];
      const checkpoints: Array<{ id: string; valid: boolean; reason?: string }> = [];
      const earlierStepIds: string[] = [];
      const seen = new Set<string>();
      let target: LocalInjectionDraftState | null = null;
      let definition: LocalInjectionScenario | null = null;
      let valid = true;
      for (const member of input.plan.members) {
        if (!member.id || member.id.length > 256 || seen.has(member.id)) throw new Error("Scenario member identities must be unique and contain 1 to 256 characters.");
        seen.add(member.id);
        if (member.kind === "step") {
          const built = await validate(member.id, member);
          const candidate = built.candidate;
          const incompatibility = target ? scenarioTargetIncompatibility(host.scenarioDraftInput(target).target, host.scenarioDraftInput(candidate).target) : null;
          if (incompatibility) throw new Error(incompatibility);
          target ??= candidate;
          builtById.set(member.id, candidate);
          if (!definition) definition = createScenarioFromDraft(host.scenarioDraftInput(candidate), { scenarioId: "agent-validation", stepId: member.id });
          else {
            const added = addScenarioStep(definition, host.scenarioDraftInput(candidate), { retainedRunBytes: 0 }, member.id);
            if (!added.ok) throw new Error(added.reason);
            definition = added.scenario;
          }
          const diagnostics = [...candidate.documentDiagnostics, ...candidate.targetDiagnostics];
          const replayability = candidateReplayability(candidate, built.replayability);
          const independentlyInvalid = diagnostics.some(diagnostic => diagnostic.severity === "error" && !["unknown-key-update", "unknown-key-delete"].includes(diagnostic.code));
          const step = { kind: "step", id: member.id, valid: replayability.replayable && !independentlyInvalid, diagnostics, replayability, nativeChanges: agentNativeChangePreview(candidate.nativeChanges) };
          steps.push(step); members.push(step); earlierStepIds.push(member.id); valid &&= step.valid;
        } else {
          if (!target) throw new Error("A Scenario Checkpoint must follow at least one explicit Step.");
          const checkpoint = { id: member.id, kind: "checkpoint" as const, name: member.name, assertions: member.assertions };
          const checked = validateScenarioCheckpoint(checkpoint, { targetMode: target.anchor.subscriptionMode, deliveryPath: target.anchor.executionTarget === "captured-listener" ? "listener" : "wire", earlierStepIds });
          const result = { id: member.id, kind: "checkpoint", valid: checked.ok, reason: checked.ok ? undefined : checked.reason };
          if (checked.ok && definition) {
            const added = addScenarioCheckpoint(definition, checkpoint, { retainedRunBytes: 0 });
            if (!added.ok) throw new Error(added.reason);
            definition = added.scenario;
          }
          checkpoints.push(result); members.push(result); valid &&= checked.ok;
        }
      }
      if (!steps.length) throw new Error("A Scenario requires at least one explicit Step.");
      const diagnostics = [...builtById.values()].flatMap(candidate => [...candidate.documentDiagnostics, ...candidate.targetDiagnostics]);
      if (definition && valid) {
        const ordered = admitScenarioValidation(definition, definition.steps.map(step => ({ ...step, draft: host.scenarioDraftInput(builtById.get(step.id)!) })), { retainedRunBytes: 0 });
        if (!ordered.ok) valid = false;
        else {
          const keys = [...builtById.values()].map(candidate => ({ item: { name: candidate.anchor.itemName, position: candidate.anchor.itemPosition }, keys: host.activeCommandKeys(candidate.anchor) }));
          const preflight = reviewScenario(ordered.scenario, { runId: "agent-validation", committedEvidenceSeed: host.committedEvidenceBoundary, targetFingerprint: host.scenarioTargetFingerprint(target!), listenerIds: host.scenarioCurrentListenerIds(target!), historyAccepting: host.historyStatus.phase === "RUNNING" && host.scenarioFollowerPhase === "LIVE" && host.projectionRecovery === null, clearInProgress: host.clearState !== "idle", activeCommandKeysByItem: keys, nativeChangesByStepId: host.scenarioNativeChanges(ordered.scenario.steps, builtById), diagnosticObservationBoundary: host.diagnosticObservations.currentBoundary() });
          if (preflight.ok) {
            for (const reviewed of preflight.run.steps) {
              const step = steps.find(step => step.id === reviewed.id);
              if (step) step.nativeChanges = agentNativeChangePreview(reviewed.nativeChanges);
            }
          }
          if (!preflight.ok) {
            valid = false;
            return Object.freeze({ valid, reason: `${preflight.stepId ? `${preflight.stepId}: ` : ""}${preflight.reason}`, pageEpoch, target: target ? agentTarget(target) : null, members, steps, checkpoints, limitations: ["Validation does not inspect arbitrary page state or DOM.", "Checkpoint assertions observe only Workbench-owned Injection, Evidence, COMMAND projection, or diagnostic facts."] });
          }
        }
      }
      const refusal = !valid
        ? checkpoints.find(checkpoint => !checkpoint.valid)?.reason
          ?? steps.find(step => !step.valid)?.diagnostics.find(diagnostic => diagnostic.severity === "error")?.message
          ?? "One or more Steps have invalid Source replayability or an ordered Scenario preflight failure."
        : undefined;
      return Object.freeze({ valid, ...(refusal ? { reason: refusal } : {}), pageEpoch, target: target ? agentTarget(target) : null, members, steps, checkpoints, limitations: ["Validation does not inspect arbitrary page state or DOM.", "Checkpoint assertions observe only Workbench-owned Injection, Evidence, COMMAND projection, or diagnostic facts."] });
  }

  async function resolveAgentCandidate(id: string, draft: AgentDraftInput, available: () => void) {
    if (Boolean(draft.scopeId) === Boolean(draft.evidence)) throw new Error("Choose exactly one Scope or Evidence source for each Step.");
    let source: LightstreamerEventEnvelope | undefined;
    if (draft.evidence) {
      const result = await adapter.query({ at: "LATEST_COMMITTED", size: 1, includePayload: true, lookup: draft.evidence });
      if (result.lookup?.state !== "RETAINED") throw new Error("Source Evidence is no longer retained.");
      source = lightstreamerPayload(result.lookup.evidence.payload) ?? undefined;
      if (!source) throw new Error("Source has no complete Item Update payload.");
    }
    available();
    const candidate = host.createLocalInjectionCandidate(draft.evidence
      ? { kind: "selected-event", eventId: draft.evidence.eventId }
      : { kind: "scope-author", scopeId: draft.scopeId! }, source, { id: `agent-draft-${id}`, recordError: false });
    if (!candidate) throw new Error("TARGET_RETIRED: Local Injection target is unavailable or incompatible with the selected source. Inspect a current target before preparing another document.");
    if (draft.document !== undefined) {
      candidate.rawText = draft.document;
      host.refreshLocalInjectionValidation(candidate);
    }
    candidate.relativeDelayMs = draft.delayMs ?? 0;
    const replayability = source?.update
      ? classifyInjectionSourceFieldExecutability(source.update).map(field => ({ field: field.field, classification: field.classification, reason: "reason" in field ? field.reason : undefined }))
      : [];
    return { id, candidate, replayability };
  }

  async function prepareAgentScenarioPlan(input: AgentScenarioPlanInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<void> {
    await prepareAgentScenarioPlanInternal(input, pageEpoch, stillAuthorized);
  }

  async function prepareAgentScenarioPlanInternal(input: AgentScenarioPlanInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<void> {
    const available = () => {
      if (!stillAuthorized()) throw new Error("ACCESS_REVOKED: Agent access was revoked while preparing the Scenario.");
      if (host.disposed || !host.visible || host.currentPageEpoch !== pageEpoch) throw new Error("TARGET_CHANGED: Page changed or panel is hidden/closed. Inspect the current target again.");
      if (host.localInjectionDraft || host.serverInjection.active) throw new Error("A protected Draft already exists. Finish it in Workbench before creating a Scenario.");
      if (host.scenarioState) {
        const existing = host.scenarioState;
        const replace = input.replace;
        if (!replace || replace.scenarioId !== existing.scenario.id || replace.revision !== existing.scenario.revision || !["edit", "review"].includes(existing.phase) || (existing.run?.trace.length ?? 0) > 0) {
          throw new Error("A protected Scenario already exists. Replace only the exact unexecuted agent-owned Scenario revision or finish it in Workbench.");
        }
      } else if (input.replace) throw new Error("The Scenario selected for replacement is no longer available.");
    };
    available();
    if (input.members[0]?.kind !== "step") throw new Error("A Scenario must begin with an explicit Injection Step.");
    const built: Array<{ member: AgentScenarioMember; draft?: LocalInjectionDraftState }> = [];
    for (const member of input.members) {
      available();
      if (member.kind === "step") {
        const resolved = await resolveAgentCandidate(member.id, member, available);
        const candidate = resolved.candidate;
        if (!candidateReplayability(candidate, resolved.replayability).replayable) throw new Error(`${member.id}: captured Source fields require concrete replacement or permitted removal.`);
        built.push({ member, draft: candidate });
      } else built.push({ member });
    }
    available();
    const first = built[0]?.draft;
    if (!first) throw new Error("A Scenario requires at least one explicit Step.");
    let definition = createScenarioFromDraft(host.scenarioDraftInput(first), { scenarioId: `local-injection-scenario-${crypto.randomUUID()}`, stepId: built[0]!.member.id });
    const drafts = new Map<string, LocalInjectionDraftState>([[definition.steps[0]!.id, first]]);
    let earlier: string[] = [definition.steps[0]!.id];
    for (const entry of built.slice(1)) {
      available();
      if (entry.member.kind === "step") {
        const candidate = entry.draft!;
        const addition = addScenarioStep(definition, host.scenarioDraftInput(candidate), { retainedRunBytes: 0 }, entry.member.id);
        if (!addition.ok) throw new Error(addition.reason);
        definition = addition.scenario;
        drafts.set(entry.member.id, candidate);
        earlier.push(entry.member.id);
      } else {
        const checkpoint = { kind: "checkpoint" as const, id: entry.member.id, name: entry.member.name, assertions: entry.member.assertions };
        const checked = validateScenarioCheckpoint(checkpoint, { targetMode: definition.target.mode, deliveryPath: definition.target.deliveryPath, earlierStepIds: earlier });
        if (!checked.ok) throw new Error(checked.reason);
        const added = addScenarioCheckpoint(definition, checkpoint, { retainedRunBytes: 0 });
        if (!added.ok) throw new Error(added.reason);
        definition = added.scenario;
      }
    }
    available();
    const ordered = admitScenarioValidation(definition, definition.steps.map(step => ({ ...step, draft: host.scenarioDraftInput(drafts.get(step.id)!) })), { retainedRunBytes: 0 });
    if (!ordered.ok) throw new Error(ordered.reason);
    const commandKeys = [...drafts.values()].map(draft => ({ item: { name: draft.anchor.itemName, position: draft.anchor.itemPosition }, keys: host.activeCommandKeys(draft.anchor) }));
    const preflight = reviewScenario(ordered.scenario, { runId: "agent-preflight", committedEvidenceSeed: host.committedEvidenceBoundary, targetFingerprint: host.scenarioTargetFingerprint(first), listenerIds: host.scenarioCurrentListenerIds(first), historyAccepting: host.historyStatus.phase === "RUNNING" && host.scenarioFollowerPhase === "LIVE" && host.projectionRecovery === null, clearInProgress: host.clearState !== "idle", activeCommandKeysByItem: commandKeys, nativeChangesByStepId: host.scenarioNativeChanges(ordered.scenario.steps, drafts), diagnosticObservationBoundary: host.diagnosticObservations.currentBoundary() });
    if (!preflight.ok) throw new Error(`${preflight.stepId ? `${preflight.stepId}: ` : ""}${preflight.reason}`);
    for (const [index, reviewedStep] of preflight.run.steps.entries()) {
      const draft = drafts.get(reviewedStep.id)!;
      const executionDraft = applyLocalInjectionDocumentToDraft(draft.baseDraft, reviewedStep.document, draft.explicitConcreteFields, reviewedStep.nativeChanges?.context);
      const review = host.localInjectionExecutionCoordinator.review({
        fingerprint: host.localInjectionFingerprint(draft, reviewedStep.nativeChanges?.context), executionTarget: draft.anchor.executionTarget,
        document: reviewedStep.document, draft: cloneReinjectionDraft(executionDraft),
        correlation: { scenarioId: preflight.run.scenarioId, runId: preflight.run.id, stepId: reviewedStep.id, ordinal: index + 1, targetId: draft.anchor.subscriptionId }
      });
      if (review.kind === "refused") throw new Error(`${reviewedStep.id}: ${review.reason}`);
    }
    available();
    host.scenarioState = { phase: "edit", parked: false, discardConfirmation: false, scenario: ordered.scenario, drafts, run: null, reviews: new Map(), membershipError: null, invalidPrimitiveAssertionIds: new Set(), pickerOpen: false, captureWorkspace: emptyScenarioCaptureWorkspace(), membershipPreview: null, focusedMemberId: ordered.scenario.members[0]!.id, focusedStepId: ordered.scenario.steps[0]!.id, removedDrafts: new Map(), priorRuns: [], retainedRunBytes: 0, runner: null, runnerSnapshot: null, serverInterleaves: [] };
    host.localInjectionDraft = null;
    host.reviewCurrentScenario();
    if (host.scenarioState?.phase !== "review") throw new Error(host.scenarioState?.membershipError ?? "Scenario Review could not be completed.");
  }

  async function prepareAgentDrafts(inputs: AgentDraftInput[], scenario: boolean, pageEpoch: string, stillAuthorized: () => boolean): Promise<void> {
    const available = () => {
      if (!stillAuthorized()) throw new Error("ACCESS_REVOKED: Agent access was revoked while preparing the document.");
      if (host.disposed || !host.visible || host.currentPageEpoch !== pageEpoch) throw new Error("TARGET_CHANGED: Page changed or panel is hidden/closed. Inspect the current target again.");
      if (host.localInjectionDraft || host.scenarioState || host.serverInjection.active) throw new Error("A protected Draft or Scenario already exists. Finish it in Workbench before creating another.");
    };
    available();
    const candidates: LocalInjectionDraftState[] = [];
    for (const input of inputs) {
      if (Boolean(input.scopeId) === Boolean(input.evidence)) throw new Error("Choose exactly one Scope or Evidence source for each Step.");
      let source: LightstreamerEventEnvelope | undefined;
      if (input.evidence) {
        const identity = input.evidence;
        const result = await adapter.query({ at: "LATEST_COMMITTED", size: 1, includePayload: true, lookup: identity });
        if (result.lookup?.state !== "RETAINED") throw new Error("Source Evidence is no longer retained.");
        source = lightstreamerPayload(result.lookup.evidence.payload) ?? undefined;
        if (!source) throw new Error("Source has no complete Item Update payload.");
      }
      available();
      const candidate = host.createLocalInjectionCandidate(input.evidence ? { kind: "selected-event", eventId: input.evidence.eventId } : { kind: "scope-author", scopeId: input.scopeId! }, source);
      if (!candidate) throw new Error(host.localInjectionEntryError ?? "Local Injection target is unavailable.");
      if (input.document !== undefined) {
        candidate.rawText = input.document;
        // Match ordinary editor semantics: only concrete user-supplied replacements become executable.
        host.refreshLocalInjectionValidation(candidate);
      }
      candidate.relativeDelayMs = input.delayMs ?? 0;
      candidates.push(candidate);
    }
    available();
    if (scenario) {
      // Validate membership and capacity before publishing any document.
      let definition = createScenarioFromDraft(host.scenarioDraftInput(candidates[0]!), { scenarioId: `local-injection-scenario-${++host.localInjectionSequence}` });
      for (const candidate of candidates.slice(1)) {
        const added = addScenarioStep(definition, host.scenarioDraftInput(candidate), { retainedRunBytes: 0 });
        if (!added.ok) throw new Error(added.reason);
        definition = added.scenario;
      }
      host.localInjectionDraft = candidates[0]!;
      host.convertLocalInjectionToScenario();
      const state = host.scenarioState!;
      state.scenario = definition;
      state.drafts = new Map(definition.steps.map((step, index) => [step.id, candidates[index]!]));
      state.focusedStepId = definition.steps[0]!.id;
      state.focusedMemberId = state.focusedStepId;
      host.reviewCurrentScenario();
    } else {
      host.localInjectionDraft = candidates[0]!;
      host.commitTransition();
    }
  }

  return adapter;
}
