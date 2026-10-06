import { AGENT_PROTOCOL_VERSION, AGENT_READ_CONTRACT, AGENT_RESPONSE_CONTRACT, AGENT_TOOLS, validateAgentCall, type AgentArguments, type AgentPermission } from "../../agent/protocol";
import { toBulkShareableEventEnvelope, type LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { EvidenceIdentity, EvidenceReadPoint, DeterministicEvidenceRecord, EvidenceSnapshot } from "../../core/evidence-filter-contract";
import { createScopeSearchIndex, searchScopes, type ScopeSearchIndex, type ScopeSearchNode } from "../../core/scope-search";
import { canonicalizeFilter, createFilter, createTypedFilterValue } from "../../core/evidence-filter-contract";
import type { Filter } from "../../core/filter-algebra";
import type { AgentRuntime, AgentDraftInput, AgentQueryBoundary, AgentScopeSearchSnapshot, AgentScenarioMember, AgentScenarioPlanInput, AgentQueryInput } from "./agent-runtime";
import { cloneCredentialSafe as omitCredentialFields } from "./topology-export";
import { describeAgentStreams } from "./agent-stream-description";
import { waitForAgentEvidence } from "./agent-evidence-wait";
import { FACET_DESCRIPTORS } from "../../core/evidence-facets";
import { agentToolResultBytes, agentToolFailure } from "../../agent/tool-result";
import type { AgentCommandStateInput, AgentCommandStateResult } from "./agent-command-state";
import type { AgentCommandRowsInput } from "./agent-command-rows";
import type { HistoryStatus } from "../../core/event-history-authoritative";
import { reanchorEvidenceQueryCursor } from "../../core/evidence-filter-cursor";
import { reanchorFacetDiscoveryCursor } from "../../core/evidence-filter-discovery";
import { waitForAgentScenario } from "./agent-scenario-wait";
import { agentNativeChangePreview } from "./agent-injection-capabilities";

const SEARCH_CURSOR_LIFETIME_MS = 5 * 60 * 1000;
const DEFAULT_QUERY_WORK = Object.freeze({ maxProjectionReads: 250000, maxPayloadHydrations: 1000, deadlineMs: 15000 });
/** Only these operational fields cross the agent boundary. History may retain a
 * full lastCoherentQuery for its own recovery; it is never part of status. */
export function projectAgentStatus(value: unknown) {
  const status = value as { pageEpoch: string | null; visible: boolean; captureStatus: string; capture: {
    operation: string; coverage: string; firstMissingEventId: string | null; committedEvidenceBoundary: unknown; detail?: string; recovery?: string;
  }; history: HistoryStatus };
  if (!status.capture || !status.history) return {
    pageEpoch: status.pageEpoch ?? null, visible: status.visible ?? false, captureStatus: status.captureStatus ?? "unknown",
    capture: { operation: "UNKNOWN", coverage: "UNAVAILABLE" }, history: { phase: "UNKNOWN", retained: null }
  };
  const capture = status.capture;
  const history = status.history;
  return {
    pageEpoch: status.pageEpoch, visible: status.visible, captureStatus: status.captureStatus,
    capture: { operation: capture.operation, coverage: capture.coverage, firstMissingEventId: capture.firstMissingEventId,
      committedEvidenceBoundary: capture.committedEvidenceBoundary,
      ...(capture.detail ? { detail: capture.detail.slice(0, 256) } : {}),
      ...(capture.recovery ? { recovery: capture.recovery.slice(0, 256) } : {}) },
    history: {
      phase: history.phase, captureOperation: history.captureOperation, interval: history.interval,
      committedEvidenceBoundary: history.committedEvidenceBoundary, retainedRange: history.retainedRange,
      capacity: { tier: history.capacity.tier, state: history.capacity.state, limits: history.capacity.limits, measurements: history.capacity.measurements },
      fallback: history.fallback, captured: history.captured, awaitingAcceptance: history.awaitingAcceptance,
      accepted: history.accepted, notAccepted: history.notAccepted, retained: history.retained,
      retention: history.retention && { policy: history.retention.policy, highWater: history.retention.highWater,
        lowWater: history.retention.lowWater, evicted: history.retention.evicted },
      persistence: history.persistence && { mode: history.persistence.mode, health: history.persistence.health,
        commitAttempts: history.persistence.commitAttempts, retryCount: history.persistence.retryCount,
        failureCount: history.persistence.failureCount, lastFailureAt: history.persistence.lastFailureAt,
        lastProblemCode: history.persistence.lastProblem?.code },
      continuity: history.continuity && { state: history.continuity.state, gapCount: history.continuity.gapCount },
      terminal: history.terminal && { reason: history.terminal.reason, dimension: history.terminal.dimension,
        tier: history.terminal.tier, firstMissingEventId: history.terminal.firstMissingEventId }
    }
  };
}

function compactOversizedAgentResult(name: string, args: AgentArguments, result: unknown, budget: number = AGENT_RESPONSE_CONTRACT.defaultMaxBytes): unknown | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  const omitted = "Preview exceeded the agent response budget. Inspect the existing Workbench document or request a smaller page.";
  if ((name === "prepare_scenario" || name === "get_scenario_trace") && (name === "get_scenario_trace" || typeof value.token === "string")) {
    const scenario = (name === "get_scenario_trace" ? value : value.scenario) as Record<string, unknown> | null;
    if (scenario) {
      const members = (scenario.members as Record<string, unknown>[] | undefined)?.map(member => member.kind === "step"
        ? { kind: "step", id: member.id, ready: member.ready }
        : { kind: "checkpoint", id: member.id, name: member.name }) ?? [];
      const steps = members.filter(member => member.kind === "step");
      const run = scenario.run as Record<string, unknown> | null;
      const compact = { ...(name === "prepare_scenario" ? { token: value.token } : {}), previewOmitted: omitted,
        ...(name === "prepare_scenario" ? { scenario: { ...scenario, members, steps,
          run: run && { id: run.id, status: run.status, nextOrdinal: run.nextOrdinal, trace: run.trace ?? [], controlsTotal: run.controlsTotal, driftsTotal: run.driftsTotal } } }
          : { ...scenario, members, steps, run: run && { id: run.id, status: run.status, nextOrdinal: run.nextOrdinal, trace: run.trace ?? [], controlsTotal: run.controlsTotal, driftsTotal: run.driftsTotal } }) };
      if (agentToolResultBytes(compact) <= budget) return compact;
    }
  }
  if (["prepare_local_injection", "prepare_scenario", "update_agent_document", "recover_agent_document"].includes(name) && typeof value.token === "string") {
    // Preparation and editing can rotate an execution token. Never lose it
    // solely because the optional preview is large.
    return { token: value.token, ...(value.requestId ? { requestId: value.requestId } : {}), ...(value.kind ? { kind: value.kind } : {}), ...(value.consumed !== undefined ? { consumed: value.consumed } : {}), previewOmitted: omitted };
  }
  if (["prepare_server_injection", "recover_server_injection"].includes(name) && typeof value.token === "string") {
    return { ...(value.requestId ? { requestId: value.requestId } : {}), token: value.token,
      ...(value.state ? { state: value.state } : {}), approvalRequired: true,
      ...(value.outcome ? { outcome: value.outcome } : {}), previewOmitted: omitted };
  }
  if (name === "execute_server_injection" && typeof value.requestId === "string") {
    return { requestId: value.requestId, state: value.state ?? "unknown", ...(value.outcome ? { outcome: value.outcome } : {}), detailsOmitted: omitted };
  }
  if (name === "wait_for_operation") {
    const receipt = compactOversizedAgentResult("get_operation", args, value.operation, budget);
    return receipt ? { ...value, operation: receipt } : null;
  }
  if (name === "wait_for_scenario" && value.scenario && typeof value.scenario === "object") {
    const scenario = value.scenario as Record<string, unknown>;
    const run = scenario.run as Record<string, unknown> | null;
    return { ...value, scenario: { phase: scenario.phase, scenarioId: scenario.scenarioId, revision: scenario.revision,
      run: run && { id: run.id, status: run.status, nextOrdinal: run.nextOrdinal, controlsTotal: run.controlsTotal, driftsTotal: run.driftsTotal },
      totalTrace: scenario.totalTrace, runner: scenario.runner, previewOmitted: omitted } };
  }
  if (["execute_local_injection", "get_operation"].includes(name)) {
    const outcome = value.outcome && typeof value.outcome === "object" ? value.outcome as Record<string, unknown> : null;
    const summary = outcome && Object.fromEntries(["disposition", "status", "executionId", "requestId", "timestamp", "attemptedCount", "deliveredCount", "failedCount"].filter(key => outcome[key] !== undefined).map(key => [key, outcome[key]]));
    return { requestId: args.requestId ?? value.requestId ?? outcome?.requestId ?? null, state: value.state ?? "unknown",
      ...(summary ? { outcome: summary } : {}), ...(value.evidence ? { evidence: value.evidence } : {}), detailsOmitted: omitted };
  }
  if (name === "control_scenario") return { requestId: args.requestId ?? value.requestId, accepted: value.accepted, detailsOmitted: omitted };
  if (name === "get_scope") {
    const node = value.node as Record<string, unknown> | undefined;
    const local = value.localInjection as Record<string, unknown> | undefined;
    const base = { node: node && { id: node.id, kind: node.kind, label: node.label, lifecycle: node.lifecycle, retired: node.retired }, pageEpoch: value.pageEpoch,
      localInjection: { ...(local?.anchor ? { anchor: local.anchor } : {}), ...(local?.unavailable ? { unavailable: local.unavailable } : {}),
        ...(local?.capabilities ? { capabilities: local.capabilities } : {}), ...(local?.diagnostics ? { diagnostics: local.diagnostics } : {}), documentOmitted: omitted } };
    if (agentToolResultBytes(base) <= budget) return base;
    return { ...base, localInjection: { ...(local?.anchor ? { anchor: local.anchor } : {}), ...(local?.capabilities ? { capabilities: local.capabilities } : {}),
      ...(local?.unavailable ? { unavailable: local.unavailable } : {}), documentOmitted: omitted,
      diagnosticsOmitted: "Target diagnostics exceeded the response budget; inspect the Scope in Workbench." } };
  }
  return null;
}

/** Summarize the result of a complete ordered validation, never a subset. */
export function summarizeCandidateValidation(result: unknown) {
  const value = result as Record<string, unknown>;
  const members = Array.isArray(value.members) ? value.members as Record<string, unknown>[] : [];
  const steps = Array.isArray(value.steps) ? value.steps as Record<string, unknown>[]
    : Array.isArray(value.candidates) ? value.candidates as Record<string, unknown>[] : [];
  const checkpoints = Array.isArray(value.checkpoints) ? value.checkpoints as Record<string, unknown>[] : [];
  return {
    valid: value.valid, ...(value.reason !== undefined ? { reason: value.reason } : {}),
    pageEpoch: value.pageEpoch, target: value.target, limitations: value.limitations,
    memberCount: members.length || steps.length + checkpoints.length,
    stepCount: steps.length, checkpointCount: checkpoints.length,
    invalidStepCount: steps.filter(step => step.valid === false).length,
    invalidCheckpointCount: checkpoints.filter(checkpoint => checkpoint.valid === false).length,
    detailsOmitted: "Member diagnostics and replayability exceeded the response budget. Use maxBytes for details; this verdict covers the complete ordered plan."
  };
}
type EvidenceSearch = { at: EvidenceReadPoint; after: EvidenceIdentity; boundary: AgentQueryBoundary; queryOptions?: Pick<AgentQueryInput, "sequenceWindow" | "workBudget">; within: "page" | "current-investigation"; scopeId?: string; text: string; size: number; includePayload: boolean; fields?: string[]; maxBytes: number; pageEpoch: unknown; expiresAt: number };
type ScopeSearch = { index: ScopeSearchIndex; snapshot: Omit<AgentScopeSearchSnapshot, "nodes">; text: string; size: number; maxBytes: number; kind?: string; parentScopeId?: string; expiresAt: number };

export function createAgentService(runtime: AgentRuntime, panelSessionId: string, permission: () => AgentPermission) {
  const cursors = new Map<string, { at: EvidenceReadPoint; cursor: string; query?: Omit<AgentQueryInput, "cursor" | "at">; fields?: string[]; maxBytes?: number; pageEpoch?: unknown }>();
  const evidenceSearches = new Map<string, EvidenceSearch>();
  const summaries = new Map<string, { query: AgentQueryInput; facet: string; cursor: string; limit: number; maxBytes: number; at: EvidenceReadPoint; pageEpoch: unknown }>();
  // Multiple page cursors share one bounded Topology snapshot rather than copying it.
  const scopeSearches = new Map<string, ScopeSearch>();
  const scopeCursors = new Map<string, { searchId: string; offset: number }>();
  const commandRowCursors = new Map<string, { input: AgentCommandRowsInput; pageEpoch: string; maxBytes: number }>();
  const requests = new Map<string, { signature: string; kind: "local" | "scenario"; draftId?: string; value: unknown }>();
  const documentRequests = new Map<string, { signature: string; promise: Promise<unknown>; token?: string; fingerprint?: string }>();
  const serverRequests = new Map<string, { signature: string; token: string; state: "prepared" | "approved" | "pending" | "complete" | "aborted"; outcome?: unknown; promise?: Promise<unknown> }>();
  let serverPrepared: { requestId: string; token: string; signature: string; consumed: boolean } | null = null;
  let documentRequestBytes = 0;
  const emergencyControlIds: Partial<Record<"pause" | "stop", string>> = {};
  const waits = new Set<AbortController>();
  const operationListeners = new Set<() => void>();
  const inFlight = new Set<AbortController>();
  let scopeIndexCache: { pageEpoch: string | null; structureRevision: number; nodes: AgentScopeSearchSnapshot["nodes"]; index: ScopeSearchIndex } | null = null;
  let prepared: { token: string; fingerprint: string; kind: "local" | "scenario"; consumed: boolean } | null = null;
  let busy = false;
  let scenarioProgress: { runId: string; signature: string; revision: number } | null = null;
  let grantGeneration = 0;
  const saveNextCursor = (query: AgentQueryInput, readPoint: EvidenceReadPoint, cursor: string | null, fields?: string[], maxBytes?: number): string | null => {
    if (!cursor) return null;
    const opaque = crypto.randomUUID();
    const { at: _at, cursor: _cursor, ...boundQuery } = query;
    cursors.set(opaque, { query: boundQuery, at: readPoint, cursor, fields, maxBytes, pageEpoch: (runtime.status() as { pageEpoch: unknown }).pageEpoch });
    if (cursors.size > 128) cursors.delete(cursors.keys().next().value!);
    return opaque;
  };
  const fingerprint = (scenario: boolean) => {
    if (!scenario) return JSON.stringify([runtime.local().draft?.id, runtime.local().draft?.rawText, runtime.local().draft?.anchor]);
    const definition = runtime.scenario()?.scenario;
    // Cursor, focus and validation presentation do not mutate the execution plan.
    return JSON.stringify(definition ? { id: definition.id, revision: definition.revision, target: definition.target, speed: definition.speed, members: definition.members.map(member => member.kind === "step" ? { id: member.id, rawText: member.draft.rawText, target: member.draft.target, item: member.draft.item, delayMs: member.draft.relativeDelayMs } : member) } : null);
  };
  const snapshot = () => ({ local: safeDraft(runtime.local()), scenario: safeScenario(runtime.scenario()) });
  function currentScenarioProgress() {
    const state = runtime.scenario();
    const run = state?.run;
    const signature = JSON.stringify(run ? [state.phase, run.status, run.nextOrdinal, run.nextMemberIndex,
      run.trace.length, run.controls.length, run.drifts.length, state.runner?.phase, state.runner?.pauseReason,
      state.runner?.activeCheckpoint?.assertions.map(value => [value.assertionId, value.status])] : null);
    if (!run) scenarioProgress = null;
    else if (scenarioProgress?.runId !== run.id) scenarioProgress = { runId: run.id, signature, revision: 0 };
    else if (scenarioProgress.signature !== signature) scenarioProgress = { runId: run.id, signature, revision: scenarioProgress.revision + 1 };
    return { pageEpoch: (runtime.status() as { pageEpoch: string | null }).pageEpoch, runId: run?.id ?? null,
      revision: scenarioProgress?.revision ?? 0, terminal: Boolean(run && ["complete", "stopped"].includes(state!.phase)),
      scenario: safeScenario(state) };
  }
  function refreshOperations() {
    if (![...requests.values()].some(operation => operation.kind === "local" && (operation.value as { state?: string }).state === "pending")) return;
    const draft = runtime.local().draft;
    for (const operation of requests.values()) {
      if (operation.kind !== "local" || (operation.value as { state?: string }).state !== "pending" || !draft || draft.id !== operation.draftId) continue;
      if (draft.outcome) {
        const settlement = draft.outcome.executionId && runtime.localSettlement?.(draft.outcome.executionId);
        operation.value = { state: "complete", outcome: cloneCredentialSafe(draft.outcome),
          ...(settlement ? { evidence: cloneCredentialSafe(settlement.evidence), correlation: cloneCredentialSafe(settlement.correlation) } : {}) };
      }
      else if (draft.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
      if ((operation.value as { state?: string }).state !== "pending") {
        for (const listener of [...operationListeners]) listener();
      }
    }
  }
  async function call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    assertNotCancelled(signal);
    validateAgentCall(name, input);
    const guardedQuery = async (input: AgentQueryInput) => {
      assertNotCancelled(signal);
      const result = await runtime.query({ ...input, workBudget: input.workBudget ?? DEFAULT_QUERY_WORK, signal });
      assertNotCancelled(signal);
      return result;
    };
    const args = input as AgentArguments;
    if (permission() === "off" || args.panelSessionId !== panelSessionId) throw new Error("ACCESS_REVOKED: This Panel Session has not granted agent access.");
    const mutation = AGENT_TOOLS.find(tool => tool.name === name)!.mutation;
    if (mutation && permission() !== "local") throw new Error("ACCESS_REVOKED: This Panel Session grants inspection only.");
    if (busy && mutation && !(name === "control_scenario" && ["pause", "stop"].includes(String(args.action)))) throw new Error("REQUEST_CAPACITY: Another agent operation is preparing a document. Try this mutation again after it settles.");
    refreshOperations();
    if (requests.size >= 256 && ["execute_local_injection", "control_scenario"].includes(name) && !(typeof args.requestId === "string" && requests.has(args.requestId)) && !["pause", "stop"].includes(String(args.action))) throw new Error("OPERATION_BUDGET_EXCEEDED: This Panel Session reached its 256-operation agent limit. Existing outcomes remain readable; pause and stop remain available.");
    switch (name) {
      case "get_status": return { protocolVersion: AGENT_PROTOCOL_VERSION, readContract: AGENT_READ_CONTRACT, responseContract: AGENT_RESPONSE_CONTRACT, panelSessionId, permission: permission(), ...projectAgentStatus(runtime.status()),
        serviceCapacity: { operations: { limit: 256, remaining: Math.max(0, 256 - requests.size), emergencyPauseStop: 2 }, documents: { limit: 128, remaining: 128 - documentRequests.size, byteLimit: 8 * 1024 * 1024, bytes: documentRequestBytes }, waits: { limit: 4, remaining: 4 - waits.size }, documentPreparing: busy, document: prepared ? { kind: prepared.kind, consumed: prepared.consumed, unchanged: prepared.fingerprint === fingerprint(prepared.kind === "scenario") } : null },
        capabilities: AGENT_TOOLS.filter(tool => !["list_panel_sessions", "get_pairing_requests", "confirm_pairing"].includes(tool.name) && (!tool.mutation || permission() === "local") &&
          (!(["recover_agent_document", "recover_server_injection"].includes(tool.name)) || permission() === "local") &&
          (tool.name !== "validate_agent_candidate" || typeof runtime.validateCandidate === "function") &&
          (tool.name !== "prepare_scenario" || typeof runtime.prepareScenarioPlan === "function") &&
          (tool.name !== "query_command_state" || typeof runtime.commandState === "function") &&
          (tool.name !== "query_command_rows" || typeof runtime.commandRows === "function") &&
          (tool.name !== "query_command_keys" || typeof runtime.commandState === "function") &&
          (tool.name !== "generate_agent_candidates" || typeof runtime.generateCandidates === "function") &&
          (tool.name !== "wait_for_scenario" || typeof runtime.subscribeOperations === "function") &&
          (tool.name !== "wait_for_evidence" || typeof runtime.subscribeEvidence === "function") &&
          (tool.name !== "abort_agent_document" || typeof runtime.abortDocument === "function") &&
          (tool.name !== "prepare_server_injection" || typeof runtime.prepareServerInjection === "function") &&
          (tool.name !== "execute_server_injection" || typeof runtime.executeApprovedServerInjection === "function") &&
          (tool.name !== "recover_server_injection" || typeof runtime.serverInjection === "function") &&
          (tool.name !== "abort_server_injection" || typeof runtime.abortServerInjection === "function")).map(tool => tool.name) };
      case "prepare_server_injection": {
        if (permission() !== "local") throw new Error("ACCESS_REVOKED: Server Injection preparation requires the Panel Session's Local access grant; sending still requires a separate human approval.");
        if (!runtime.prepareServerInjection || !runtime.serverInjection) throw new Error("UNSUPPORTED_CAPABILITY: Reviewed agent Server Injection is unavailable in this panel build.");
        const id = String(args.requestId);
        const draft = { sourceEventId: null, target: { pageEpoch: String(args.pageEpoch), clientId: String(args.clientId), sessionId: String(args.sessionId) }, message: String(args.message), sequence: String(args.sequence), delayTimeout: args.delayTimeout as number | null, enqueueWhileDisconnected: args.enqueueWhileDisconnected === true };
        const signature = JSON.stringify(draft);
        const previous = serverRequests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a different Server Injection request.");
          return { requestId: id, token: previous.token, approvalRequired: true, ...(previous.outcome ? { outcome: previous.outcome } : {}), ...(previous.state === "aborted" ? { aborted: true } : {}) };
        }
        if (requests.has(id) || documentRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies another operation.");
        if (serverRequests.size >= 128) throw new Error("DOCUMENT_BUDGET_EXCEEDED: The Server Injection receipt ledger is full.");
        runtime.prepareServerInjection(draft, id);
        const token = crypto.randomUUID();
        serverPrepared = { requestId: id, token, signature, consumed: false };
        serverRequests.set(id, { signature, token, state: "prepared" });
        const snapshot = runtime.serverInjection() as Record<string, unknown>;
        const result = { requestId: id, token, approvalRequired: true, draft: snapshot.draft };
        return agentToolResultBytes(result) <= Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes)
          ? result
          : { requestId: id, token, approvalRequired: true, previewOmitted: "The Client Message preview exceeded maxBytes. Inspect and approve the exact message in Workbench." };
      }
      case "execute_server_injection": {
        const id = String(args.requestId);
        const entry = serverRequests.get(id);
        if (!entry || entry.token !== args.token) throw new Error("TARGET_CHANGED: Server Injection token is unavailable or superseded.");
        if (entry.promise) {
          if (entry.state === "complete") return { requestId: id, state: "complete", outcome: entry.outcome };
          return { requestId: id, state: "complete", outcome: await awaitAgentCall(entry.promise, signal) };
        }
        if (!serverPrepared || serverPrepared.requestId !== id || serverPrepared.token !== args.token) throw new Error("TARGET_CHANGED: Server Injection token is unavailable or superseded.");
        if (serverPrepared.consumed) throw new Error("REQUEST_ID_CONFLICT: This Server Injection request was already consumed.");
        if (!runtime.executeApprovedServerInjection) throw new Error("UNSUPPORTED_CAPABILITY: Server Injection execution is unavailable.");
        const reviewed = runtime.serverInjection?.() as { draft?: { agentRequestId?: string; agentApproved?: boolean } | null } | undefined;
        if (reviewed?.draft?.agentRequestId !== id || reviewed.draft.agentApproved !== true) throw new Error("HUMAN_APPROVAL_REQUIRED: Review and approve this exact Client/Session/message call in Workbench.");
        // The runtime enforces the panel-owned per-message approval fingerprint.
        // Reserve and consume the idempotency receipt before entering runtime code:
        // synchronous throws and lost replies must never make a second send possible.
        serverPrepared.consumed = true;
        entry.state = "pending";
        entry.promise = Promise.resolve().then(() => runtime.executeApprovedServerInjection!(id)).then(
          outcome => { entry.state = "complete"; entry.outcome = cloneCredentialSafe(outcome); return entry.outcome; },
          error => {
            const message = error instanceof Error ? error.message : "The Server Injection result was lost.";
            const provenNotSent = /^(TARGET_CHANGED|HUMAN_APPROVAL_REQUIRED):/.test(message);
            entry.state = "complete";
            entry.outcome = {
              requestId: id,
              ok: false,
              status: provenNotSent ? "stale-target" : "unknown",
              timestamp: Date.now(),
              ...(provenNotSent ? { sentOnNetwork: false } : {}),
              error: provenNotSent ? message : `${message} Do not repeat automatically; recover this receipt before taking action.`
            };
            return entry.outcome;
          }
        );
        return { requestId: id, state: "complete", outcome: await awaitAgentCall(entry.promise, signal) };
      }
      case "recover_server_injection": {
        if (permission() !== "local") throw new Error("ACCESS_REVOKED: Server Injection document recovery requires this Panel Session's Local access grant.");
        const id = args.requestId === undefined ? serverPrepared?.requestId : String(args.requestId);
        if (!id) throw new Error("DOCUMENT_UNKNOWN: No current agent Server Injection document is available.");
        const entry = serverRequests.get(id);
        if (!entry) throw new Error("DOCUMENT_UNKNOWN: This Server Injection request is unknown in the current Panel Session.");
        const current = runtime.serverInjection?.() as { draft?: { id?: string; agentRequestId?: string; value?: unknown; agentApproved?: boolean; outcome?: unknown } | null } | undefined;
        const state = entry.state === "prepared" && current?.draft?.agentRequestId === id && current.draft.agentApproved ? "approved" : entry.state;
        const currentBelongsToRequest = current?.draft?.agentRequestId === id;
        const response = { ...(args.requestId === undefined ? {} : { requestId: id }), token: entry.token, state, approvalRequired: true,
          outcome: entry.outcome ?? (currentBelongsToRequest ? current?.draft?.outcome : null) ?? null,
          ...(currentBelongsToRequest ? { document: current!.draft } : { previewOmitted: "This request is no longer the current document; only its bounded receipt remains." }) };
        return agentToolResultBytes(response) <= Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes)
          ? response
          : { ...(args.requestId === undefined ? {} : { requestId: id }), token: entry.token, state, approvalRequired: true, outcome: entry.outcome ?? null,
              previewOmitted: "The current Client Message preview exceeded maxBytes. Inspect the document in Workbench." };
      }
      case "abort_server_injection": {
        if (!serverPrepared || serverPrepared.token !== args.token || serverPrepared.consumed) throw new Error("TARGET_CHANGED: Only the unchanged unexecuted agent Server Injection can be aborted.");
        if (!runtime.abortServerInjection) throw new Error("UNSUPPORTED_CAPABILITY: This panel cannot abort the Server Injection document.");
        runtime.abortServerInjection(serverPrepared.requestId);
        const entry = serverRequests.get(serverPrepared.requestId);
        if (entry) entry.state = "aborted";
        serverPrepared = null;
        return { aborted: true };
      }
      case "list_scope": {
        const offset = Number(args.offset ?? 0);
        const requested = Number(args.limit ?? 50);
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        let size = requested;
        for (;;) {
          const page = runtime.scopes(offset, size) as { total: number; offset: number; nodes: unknown[] };
          const response = { ...page, nextOffset: offset + page.nodes.length < page.total ? offset + page.nodes.length : null };
          if (agentToolResultBytes(response) <= budget) return response;
          if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Scope exceeds maxBytes. Use search_scope to locate an exact Scope.");
          size = Math.max(1, Math.floor(size / 2));
        }
      }
      case "search_scope": {
        const saved = args.cursor ? scopeCursors.get(String(args.cursor)) : undefined;
        if (args.cursor && !saved) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
        const searchId = saved?.searchId ?? crypto.randomUUID();
        let search = saved ? scopeSearches.get(searchId) : undefined;
        if (saved) {
          if (!search || search.expiresAt <= Date.now()) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
          const status = runtime.status() as { pageEpoch: string | null; history: { interval: { id: string }; retainedRange: { first: { sequence: number } } | null } };
          const first = search.snapshot.history.retainedFirstSequence;
          if (status.pageEpoch !== search.snapshot.pageEpoch || status.history.interval.id !== search.snapshot.history.intervalId
            || (first !== null && (status.history.retainedRange === null || status.history.retainedRange.first.sequence > first))) {
            throw new Error("CURSOR_EXPIRED: Scope search snapshot expired after page change, Clear or retention. Start a new search.");
          }
        } else {
          const { nodes, ...snapshot } = runtime.scopeSearchSnapshot();
          if (!scopeIndexCache || scopeIndexCache.pageEpoch !== snapshot.pageEpoch || scopeIndexCache.structureRevision !== snapshot.structureRevision || scopeIndexCache.nodes !== nodes) {
            scopeIndexCache = { pageEpoch: snapshot.pageEpoch, structureRevision: snapshot.structureRevision, nodes,
              index: createScopeSearchIndex(cloneCredentialSafe(nodes) as readonly ScopeSearchNode[]) };
          }
          const index = scopeIndexCache.index;
          const entries = args.kind === undefined && args.parentScopeId === undefined ? index.entries : index.entries.filter(entry => (args.kind === undefined || entry.node.kind === args.kind) && (args.parentScopeId === undefined || entry.node.parentId === args.parentScopeId));
          search = { index: { entries, totalNodes: entries.length }, snapshot, text: String(args.text).trim(), size: Number(args.limit ?? 25), maxBytes: Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes), kind: args.kind as string | undefined, parentScopeId: args.parentScopeId as string | undefined, expiresAt: Date.now() + SEARCH_CURSOR_LIFETIME_MS };
        }
        let size = search!.size;
        let result = searchScopes(search!.index, search!.text, { offset: saved?.offset ?? 0, limit: size });
        const response = () => ({ snapshot: search!.snapshot, boundary: "ALL_STRUCTURAL_TOPOLOGY", match: "CASE_INSENSITIVE_SUBSTRING", text: search!.text, kind: search!.kind, parentScopeId: search!.parentScopeId, total: result.total, offset: result.offset, nextCursor: result.hasNext ? "00000000-0000-0000-0000-000000000000" : null, scopes: result.matches.map(({ node, path, ancestorIds, matchedFields }) => ({ scopeId: node.id, kind: node.kind, label: node.label, detail: node.detail, lifecycle: node.lifecycle, retired: node.retired, path, ancestorIds, matchedFields })) });
        while (agentToolResultBytes(response()) > search!.maxBytes) {
          if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Scope match exceeds maxBytes. Narrow search or start fresh without cursor to change options.");
          size = Math.max(1, Math.floor(size / 2));
          result = searchScopes(search!.index, search!.text, { offset: saved?.offset ?? 0, limit: size });
        }
        search!.size = size;
        let nextCursor: string | null = null;
        if (result.hasNext) {
          scopeSearches.set(searchId, search!);
          if (scopeSearches.size > 8) scopeSearches.delete(scopeSearches.keys().next().value!);
          nextCursor = crypto.randomUUID();
          scopeCursors.set(nextCursor, { searchId, offset: result.offset + result.matches.length });
          if (scopeCursors.size > 128) scopeCursors.delete(scopeCursors.keys().next().value!);
        }
        return { ...response(), nextCursor };
      }
      case "get_scope": return cloneCredentialSafe(runtime.scope(String(args.scopeId)));
      case "read_bundle": {
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        const operations = args.operations as { id: string; kind: string; args: AgentArguments }[];
        const toolsByKind: Record<string, string> = { evidence: "query_evidence", summary: "summarize_evidence", aggregate: "aggregate_evidence", "command-key": "query_command_state", "command-keys": "query_command_keys", "command-rows": "query_command_rows" };
        const epoch = String(args.pageEpoch);
        const checkPage = () => { assertNotCancelled(signal); if ((runtime.status() as { pageEpoch: string }).pageEpoch !== epoch) throw new Error("TARGET_CHANGED: The inspected page changed during this read bundle."); };
        checkPage();
        const frozen = await guardedQuery({ at: args.at as AgentQueryInput["at"] ?? "LATEST_COMMITTED", scope: { kind: "NONE" }, filter: createFilter(), size: 1, includePayload: false });
        const readPoint = frozen.readPoint;
        const sameBoundary = (point: EvidenceReadPoint) => JSON.stringify([point.interval, point.committedEvidenceBoundary]) === JSON.stringify([readPoint.interval, readPoint.committedEvidenceBoundary]);
        const perRead = Math.max(4096, Math.floor((budget - 2048) / operations.length));
        const createdCursors: string[] = [];
        const results: { id: string; kind: string; status: string; result?: unknown; error?: unknown }[] = [];
        const started = performance.now();
        const workBudget = args.workBudget as NonNullable<AgentQueryInput["workBudget"]> | undefined ?? DEFAULT_QUERY_WORK;
        try {
          for (const operation of operations) {
            checkPage();
            const deadlineMs = (workBudget.deadlineMs ?? DEFAULT_QUERY_WORK.deadlineMs) - (performance.now() - started);
            if (deadlineMs < 1) throw new Error("QUERY_WORK_BUDGET_EXCEEDED: The read bundle reached its elapsed work limit.");
            const name = toolsByKind[operation.kind];
            if (!name) throw new Error("INVALID_ARGUMENT: Unsupported operation in read-only bundle.");
            const options: AgentArguments = { ...operation.args, panelSessionId, maxBytes: perRead,
              ...(operation.kind.startsWith("command-") ? { pageEpoch: epoch } : { at: readPoint, workBudget: { ...workBudget, deadlineMs: Math.max(1, Math.floor(deadlineMs)) } }) };
            try {
              const result = await call(name, options, signal) as { readPoint: EvidenceReadPoint; nextCursor?: string };
              checkPage();
              if (typeof result.nextCursor === "string") createdCursors.push(result.nextCursor);
              if (!result.readPoint || !sameBoundary(result.readPoint)) {
                if (result.nextCursor) { commandRowCursors.delete(result.nextCursor); cursors.delete(result.nextCursor); summaries.delete(result.nextCursor); }
                results.push({ id: operation.id, kind: operation.kind, status: "ALIGNMENT_UNAVAILABLE", error: { code: "READ_BOUNDARY_UNALIGNED", message: "The live projection does not represent this frozen Evidence boundary. Read it separately or start a fresh bundle." } });
              } else results.push({ id: operation.id, kind: operation.kind, status: "OK", result });
            } catch (error) {
              checkPage();
              results.push({ id: operation.id, kind: operation.kind, status: "ERROR", error: agentToolFailure(error).structuredContent.error });
            }
          }
          const response = { status: results.every(result => result.status === "OK") ? "COMPLETE" : "LIMITED", readPoint, pageEpoch: epoch, results,
            work: { maxReads: operations.length, perRead: workBudget }, limitations: ["Every successful result shares this frozen committed Evidence boundary. A live projection that cannot align returns no state.", "Reads are sequential and bounded; the bundle performs no document, Capture or delivery operation."] };
          if (agentToolResultBytes(response) > budget) throw new Error("RESULT_BUDGET_EXCEEDED: The complete read bundle exceeds maxBytes. Use fewer operations/fields or a larger bounded budget.");
          return response;
        } catch (error) {
          for (const cursor of createdCursors) { commandRowCursors.delete(cursor); cursors.delete(cursor); summaries.delete(cursor); }
          throw error;
        }
      }
      case "generate_agent_candidates": {
        if (!runtime.generateCandidates) throw new Error("UNSUPPORTED_CAPABILITY: Candidate generation is unavailable in this panel build.");
        const { panelSessionId: _panel, pageEpoch: _epoch, maxBytes: _max, ...input } = args;
        const matrix = { ...input, base: normalizeAgentDraft(input.base as AgentDraftInput) };
        return cloneCredentialSafe(await runtime.generateCandidates(matrix, String(args.pageEpoch), () => permission() !== "off" && !signal?.aborted));
      }
      case "query_command_state": {
        if (!runtime.commandState) throw new Error("UNSUPPORTED_CAPABILITY: This panel build does not support derived COMMAND state reads.");
        const { panelSessionId: _panelSessionId, ...input } = args;
        const result = runtime.commandState(input as AgentCommandStateInput);
        if (result.status === "error") throw new Error(`${result.problem.code}: ${result.problem.message}`);
        return safeCommandState(result, Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes));
      }
      case "query_command_rows": {
        if (!runtime.commandRows) throw new Error("UNSUPPORTED_CAPABILITY: This panel build cannot page derived COMMAND rows.");
        const saved = args.cursor ? commandRowCursors.get(String(args.cursor)) : undefined;
        if (args.cursor && !saved) throw new Error("CURSOR_EXPIRED: COMMAND row cursor expired. Start a current row read.");
        if (saved && saved.pageEpoch !== (runtime.status() as { pageEpoch: string }).pageEpoch) throw new Error("TARGET_CHANGED: The inspected page changed; restart row discovery.");
        const { panelSessionId: _panel, cursor: _cursor, ...options } = args;
        const input = saved?.input ?? options as AgentCommandRowsInput;
        const budget = saved?.maxBytes ?? Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        const result = runtime.commandRows(input);
        if (result.status === "error") throw new Error(`${result.problem.code}: ${result.problem.message}`);
        const { nextKey: _nextKey, rows: _rows, ...metadata } = result;
        const rows = result.rows.map(row => safeCommandState(row, budget));
        const response = (count: number) => ({ ...metadata, rows: rows.slice(0, count), nextCursor: count < rows.length || result.nextKey ? "00000000-0000-0000-0000-000000000000" : null });
        const count = fitAgentPrefix(rows.length, budget, response, "One COMMAND row exceeds maxBytes. Request fewer fields or a larger budget.");
        let nextCursor: string | null = null;
        if ((count < rows.length || result.nextKey) && count > 0) {
          nextCursor = crypto.randomUUID();
          commandRowCursors.set(nextCursor, { input: { ...input, revision: result.revision, afterKey: result.rows[count - 1]!.target.key }, pageEpoch: input.pageEpoch, maxBytes: budget });
          if (commandRowCursors.size > 128) commandRowCursors.delete(commandRowCursors.keys().next().value!);
        }
        return { ...response(count), nextCursor };
      }
      case "query_command_keys": {
        if (!runtime.commandState) throw new Error("UNSUPPORTED_CAPABILITY: This panel build cannot compare exact COMMAND keys.");
        const { panelSessionId: _panel, keys: _keys, ...input } = args;
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        const rows = (args.keys as string[]).map(key => runtime.commandState!({ ...input, key } as AgentCommandStateInput));
        const first = rows[0]!;
        for (const row of rows) if (row.status === "error") throw new Error(`${row.problem.code}: ${row.problem.message}`);
        if (first.status !== "ok") throw new Error("PROJECTION_UNAVAILABLE: COMMAND comparison is unavailable.");
        const boundary = JSON.stringify([first.readPoint.interval, first.readPoint.committedEvidenceBoundary]);
        if (rows.some(row => row.status !== "ok" || JSON.stringify([row.readPoint.interval, row.readPoint.committedEvidenceBoundary]) !== boundary)) throw new Error("READ_BOUNDARY_UNALIGNED: COMMAND keys did not share one applied Evidence boundary.");
        return { status: "ok", projection: first.projection, readPoint: first.readPoint,
          rows: rows.map(row => safeCommandState(row as Extract<AgentCommandStateResult, { status: "ok" }>, budget)),
          limitations: ["All requested exact keys are compared at one applied boundary. Derived presence is not authoritative server or application state."] };
      }
      case "search_evidence": {
        const saved = args.cursor ? evidenceSearches.get(String(args.cursor)) : undefined;
        if (args.cursor && (!saved || saved.expiresAt <= Date.now())) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
        const pageEpoch = (runtime.status() as { pageEpoch: unknown }).pageEpoch;
        if (saved && saved.pageEpoch !== pageEpoch) throw new Error("CURSOR_EXPIRED: Search cursor expired after page change. Start a new search.");
        const within = saved?.within ?? (args.within === "current-investigation" ? "current-investigation" : "page");
        if (!saved && within === "current-investigation" && args.where !== undefined) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to add where.");
        const boundary = saved?.boundary ?? structuredClone(runtime.queryBoundary(args.scopeId as string | undefined, within === "current-investigation"));
        const text = saved?.text ?? String(args.text).trim();
        const size = saved?.size ?? Number(args.limit ?? 25);
        const includePayload = saved?.includePayload ?? args.includePayload === true;
        const fields = saved?.fields ?? args.fields as string[] | undefined;
        const maxBytes = saved?.maxBytes ?? Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        const readFilter = saved ? boundary.filter : makeReadQuery(runtime, within === "current-investigation" ? { ...args, text: undefined } : args).filter ?? boundary.filter;
        const searchBoundary = { ...boundary, filter: readFilter };
        const at: EvidenceReadPoint | "LATEST_COMMITTED" = saved?.at ?? (args.at as EvidenceReadPoint | "LATEST_COMMITTED" | undefined) ?? "LATEST_COMMITTED";
        const queryOptions = saved?.queryOptions ?? { sequenceWindow: args.sequenceWindow as AgentQueryInput["sequenceWindow"], workBudget: args.workBudget as AgentQueryInput["workBudget"] };
        const result = await guardedQuery({ ...searchBoundary, ...queryOptions, at, size: 1, includePayload: includePayload || Boolean(fields?.length), find: { text, scopeToFilter: true, reveal: false, size, ...(saved ? { after: saved.after } : {}) } });
        if (result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: Evidence search cannot evaluate this investigation. Remove the unsupported Filter criterion or explicitly search within: page.");
        if (!result.find) throw new Error("Evidence search is unavailable at this read point.");
        const records = result.find.results ?? [];
        const evidence = records.map(record => { const projected = projectReadRecord(record, includePayload, fields); return { ...projected, match: safeMatchExplanation(projected, text) }; });
        const hasMore = (count: number) => result.find!.hasMore || count < records.length;
        const response = (count: number) => ({ search: { text, within, ...((saved?.scopeId ?? args.scopeId) ? { scopeId: saved?.scopeId ?? args.scopeId } : {}), match: "CASE_INSENSITIVE_SUBSTRING", order: "OLDEST_FIRST" }, readPoint: result.readPoint, total: result.find!.total, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage, nextCursor: hasMore(count) && count > 0 ? "00000000-0000-0000-0000-000000000000" : null, evidence: evidence.slice(0, count) });
        // Storage already latched the complete count/read point and one bounded
        // match page. Fit its longest permitted prefix in memory; shrinking the
        // response must never rescan history or advance past unreturned matches.
        let count = evidence.length;
        if (agentToolResultBytes(response(count)) > maxBytes) {
          let low = 1, high = count, fitted = 0;
          while (low <= high) {
            assertNotCancelled(signal);
            const middle = Math.floor((low + high) / 2);
            if (agentToolResultBytes(response(middle)) <= maxBytes) { fitted = middle; low = middle + 1; }
            else high = middle - 1;
          }
          if (!fitted) throw new Error("RESULT_BUDGET_EXCEEDED: One search match or search metadata exceeds maxBytes. Request fewer fields or narrow the search; start fresh without cursor to change options.");
          count = fitted;
        }
        assertNotCancelled(signal);
        let nextCursor: string | null = null;
        if (hasMore(count) && count > 0) {
          nextCursor = crypto.randomUUID();
          evidenceSearches.set(nextCursor, { boundary: searchBoundary, queryOptions, within, scopeId: saved?.scopeId ?? args.scopeId as string | undefined, text, size, includePayload, fields, maxBytes, pageEpoch, at: result.readPoint, after: records[count - 1]!.identity, expiresAt: saved?.expiresAt ?? Date.now() + SEARCH_CURSOR_LIFETIME_MS });
          if (evidenceSearches.size > 128) evidenceSearches.delete(evidenceSearches.keys().next().value!);
        }
        return { ...response(count), nextCursor };
      }
      case "query_evidence": {
        let query = makeReadQuery(runtime, args);
        let fields = args.fields as string[] | undefined;
        let maxBytes = Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        if (args.cursor) {
          const suppliedQueryKeys = Object.keys(args).filter(key => !["panelSessionId", "cursor"].includes(key));
          if (suppliedQueryKeys.length) throw new Error("Continue a query with only its cursor; query arguments are bound to the first page.");
          const saved = cursors.get(String(args.cursor));
          if (!saved) throw new Error("CURSOR_EXPIRED: Query cursor expired. Start a new query.");
          if (saved.pageEpoch !== (runtime.status() as { pageEpoch: unknown }).pageEpoch) throw new Error("CURSOR_EXPIRED: Query cursor expired after page change. Start fresh without cursor.");
          query = { ...saved.query!, at: saved.at, cursor: saved.cursor };
          fields = saved.fields;
          maxBytes = saved.maxBytes ?? maxBytes;
        }
        const result = await guardedQuery({ ...query, includePayload: query.includePayload || Boolean(fields?.length), signal });
          if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
        const records = result.page.evidence.map(record => projectReadRecord(record, query.includePayload, fields));
        const metadata = { readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage,
          ...(result.fieldEvaluation ? { fieldEvaluation: result.fieldEvaluation } : {}), ...(result.aggregate ? { aggregate: cloneCredentialSafe(result.aggregate) } : {}),
          ...(query.sequenceWindow ? { sequenceWindow: { after: query.sequenceWindow.after, through: query.sequenceWindow.through ?? result.readPoint.committedEvidenceBoundary?.sequence ?? 0 } } : {}),
          discoveries: cloneCredentialSafe(Object.fromEntries([...result.discoveries].map(([key, value]) => { const { resumeCursor: _resume, ...visible } = value as typeof value & { resumeCursor?: string }; return [key, visible]; }))), omissions: omissions(query.includePayload) };
        const response = (count: number) => ({ ...metadata, evidence: records.slice(0, count), nextCursor: count < records.length || result.page.nextCursor ? "00000000-0000-0000-0000-000000000000" : null });
        const count = fitAgentPrefix(records.length, maxBytes, response, "One Evidence record or query metadata exceeds maxBytes. Narrow the query or request fewer fields.");
        const canonical = shortenedEvidenceCursor(result, count);
        return { ...response(count), nextCursor: saveNextCursor(query, result.readPoint, canonical, fields, maxBytes) };
      }
      case "summarize_evidence": {
        const saved = args.cursor ? summaries.get(String(args.cursor)) : undefined;
        if (args.cursor && (!saved || saved.pageEpoch !== (runtime.status() as { pageEpoch: unknown }).pageEpoch)) throw new Error("CURSOR_EXPIRED: Summary cursor expired. Start fresh without cursor.");
        const query = saved?.query ?? makeReadQuery(runtime, args);
        const facet = saved?.facet ?? args.facet as string | undefined;
        const maxBytes = saved?.maxBytes ?? Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        const effective = saved ? { ...query, at: saved.at } : query;
        const size = saved?.limit ?? Number(args.limit ?? 25);
          const discovery = facet ? [{ facet, size, scopeToFilter: true, ...(saved ? { cursor: saved.cursor } : {}) }] : undefined;
          const result = await guardedQuery({ ...effective, size: 1, includePayload: false, ...(discovery ? { discover: discovery } : {}), signal });
          if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
          const found = facet ? result.discoveries.get(facet) : undefined;
          const values = found?.values.map(entry => ({ value: { facet: entry.value.facet, type: entry.value.type, value: entry.value.value, label: entry.value.label }, count: entry.count })) ?? [];
          const response = (count: number) => ({ readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage,
            countMeaning: "Evidence records, not current COMMAND rows", values: values.slice(0, count), distinctTotal: found?.distinctTotal ?? null,
            ...(facet ? { facet, discoveryState: found?.state ?? "UNAVAILABLE", baseEvidenceCount: found?.baseEvidenceCount ?? null, ...(found?.state === "UNAVAILABLE" ? { reason: found.reason } : {}) } : {}), nextCursor: count < values.length || found?.nextCursor ? "00000000-0000-0000-0000-000000000000" : null as string | null });
          const count = fitAgentPrefix(values.length, maxBytes, response, "One summary value or its metadata exceeds maxBytes. Narrow the query or request fewer facet values.");
          let continuation = found?.nextCursor ?? null;
          if (count < values.length && found?.state === "AVAILABLE") {
            const resume = found.resumeCursor ?? found.nextCursor;
            if (!resume) throw new Error("UNSUPPORTED_CAPABILITY: This history build cannot fit terminal summary pages without losing values.");
            continuation = reanchorFacetDiscoveryCursor(resume, found.values.slice(0, count), values.length - count);
          }
          const fitted = response(count);
            if (continuation) {
              fitted.nextCursor = crypto.randomUUID();
              summaries.set(fitted.nextCursor, { query: effective, facet: facet!, cursor: continuation, limit: size, maxBytes, at: result.readPoint, pageEpoch: (runtime.status() as { pageEpoch: unknown }).pageEpoch });
              if (summaries.size > 128) summaries.delete(summaries.keys().next().value!);
            }
            return fitted;
      }
      case "describe_stream": {
        const query = makeQuery(args, 100, true, "NEWEST_FIRST");
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        if (query.size > 100) throw new Error("Stream descriptions are limited to 100 Evidence records per read point.");
        if (args.cursor) throw new Error("describe_stream summarizes one bounded sample; use query_evidence to continue pages.");
        const result = await guardedQuery({ ...query, signal });
        const allRecords = boundedRecords(result.page.evidence) as DeterministicEvidenceRecord[];
        const response = (count: number) => {
          const records = allRecords.slice(0, count);
          const sampled = records.length;
          const completeSample = count === allRecords.length && result.evaluation === "COMPLETE" && result.coverage === "COMPLETE" && sampled >= result.totals.matching && result.page.nextCursor === null && records.every(record => record.payload !== undefined);
          const profile = describeAgentStreams({ records, limit: Math.max(1, count), readPoint: result.readPoint, completeness: completeSample ? "COMPLETE" : "LIMITED", window: query.order ?? "NEWEST_FIRST" });
          const current = projectAgentStatus(runtime.status());
          return { ...profile, readPoint: result.readPoint, matchingTotal: result.totals.matching, sampled, completeness: profile.completeness,
            nextCursor: count < allRecords.length || result.page.nextCursor ? "00000000-0000-0000-0000-000000000000" : null,
            observationCoverage: current.capture.coverage,
            history: { phase: current.history.phase, retained: current.history.retained, retention: current.history.retention, continuity: current.history.continuity },
            omissions: [...omissions(true), ...(completeSample ? [] : ["The sample or its payload budget is incomplete. Use query_evidence with nextCursor when present, or narrow the query to inspect omitted payloads."])] };
        };
        const count = fitAgentPrefix(allRecords.length, budget, response, "One stream description exceeds maxBytes. Inspect selected fields with query_evidence.");
        return { ...response(count), nextCursor: saveNextCursor({ ...query, includePayload: false }, result.readPoint, shortenedEvidenceCursor(result, count)) };
      }
      case "wait_for_evidence": {
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        if (!runtime.subscribeEvidence) throw new Error("Evidence observation is unavailable in this panel build.");
        if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence or operation waits may run concurrently per Panel Session.");
        const controller = new AbortController();
        const cancel = () => controller.abort();
        waits.add(controller); signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        try {
          const query = makeQuery({ ...args, order: "NEWEST_FIRST" });
          const result = await waitForAgentEvidence({
            status: () => runtime.status() as { pageEpoch: string | null; history: HistoryStatus },
            subscribe: listener => runtime.subscribeEvidence!(listener),
            query: (readSignal, sequenceWindow) => runtime.query({ ...query, at: "LATEST_COMMITTED", sequenceWindow, workBudget: query.workBudget ?? DEFAULT_QUERY_WORK, signal: readSignal })
          }, { after: args.after as EvidenceReadPoint, pageEpoch: String(args.pageEpoch), timeoutMs: Number(args.timeoutMs ?? 10000), signal: controller.signal });
          let evidence = result.evidence.map(record => query.includePayload ? safeRecord(record, 64 * 1024) : compactWaitEvidence(record, args));
          let response = { ...result, evidence, omissions: omissions(query.includePayload) };
          while (agentToolResultBytes(response) > budget && evidence.length > 1) {
            evidence = evidence.slice(0, Math.max(1, Math.floor(evidence.length / 2)));
            response = { ...response, evidence, mayHaveMoreMatches: true };
          }
          if (agentToolResultBytes(response) > budget && query.includePayload && evidence.length) {
            const first = result.evidence[0]!;
            evidence = [compactWaitEvidence(first, args)];
            response = { ...response, evidence, mayHaveMoreMatches: true,
              omissions: [...response.omissions, "Matched Evidence payload exceeded the response budget. Use get_evidence with an explicit maxBytes for this identity."] };
          }
          if (agentToolResultBytes(response) > budget && evidence.length) {
            const first = result.evidence[0]!;
            response = { ...response, evidence: [{ identity: first.identity, timestamp: first.timestamp, facets: {} }], mayHaveMoreMatches: true,
              omissions: [...response.omissions, "Matched Evidence facets exceeded the response budget. Use get_evidence for this identity."] };
          }
          return response;
        } finally { signal?.removeEventListener("abort", cancel); waits.delete(controller); }
      }
      case "aggregate_evidence": {
        const query = makeReadQuery(runtime, { ...args, limit: 1 });
        const result = await guardedQuery({ ...query, aggregate: args.aggregate as AgentQueryInput["aggregate"], discover: [], includePayload: false });
        if (result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: Field aggregation requires a completely evaluable Filter.");
        return cloneCredentialSafe({ readPoint: result.readPoint, totals: result.totals, coverage: result.coverage,
          evaluation: result.evaluation, storage: result.storage, fieldEvaluation: result.fieldEvaluation, aggregate: result.aggregate,
          ...(query.sequenceWindow ? { sequenceWindow: { after: query.sequenceWindow.after, through: query.sequenceWindow.through ?? result.readPoint.committedEvidenceBoundary?.sequence ?? 0 } } : {}),
          limitations: ["Counts cover retained matching Evidence through this boundary, subject to reported Coverage.", "Only declared Item Update fields are evaluated. Credential fields and ambiguous/unavailable values never compare as concrete.", "Distinct logical updates exclude Item Updates with missing logicalEventId; missingLogicalIds reports their Evidence-record count."] });
      }
      case "get_evidence": {
        const includePayload = args.includePayload === true;
        const fields = args.fields as string[] | undefined;
        const result = await guardedQuery({ at: "LATEST_COMMITTED", size: 1, includePayload: includePayload || Boolean(fields?.length), lookup: args.evidence as EvidenceIdentity, signal });
        const response = { readPoint: result.readPoint, coverage: result.coverage, lookup: result.lookup?.state === "RETAINED" ? { state: "RETAINED", evidence: projectReadRecord(result.lookup.evidence, includePayload, fields) } : result.lookup };
        if (agentToolResultBytes(response) > Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes)) throw new Error("RESULT_BUDGET_EXCEEDED: Exact Evidence exceeds maxBytes. Request fewer fields or omit payload.");
        return response;
      }
      case "query_diagnostics": {
        const result = await runtime.diagnostics(args.after as Parameters<AgentRuntime["diagnostics"]>[0], signal);
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        let size = Number(args.limit ?? 50);
        for (;;) {
          const observations = result.observations.slice(0, size);
          const truncated = observations.length < result.observations.length;
          const response = cloneCredentialSafe({ ...result, observations, truncated, nextAfter: truncated && observations.length ? observations.at(-1)!.observationBoundary : null });
          if (agentToolResultBytes(response) <= budget) return response;
          if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Diagnostic Observation exceeds the response budget.");
          size = Math.max(1, Math.floor(size / 2));
        }
      }
      case "update_agent_document": {
        if (!prepared || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Agent document was changed or executed. Inspect the document in Workbench.");
        runtime.edit(agentDocumentText(args.document)!, args.stepId as string | undefined);
        prepared = { ...prepared, token: crypto.randomUUID(), fingerprint: fingerprint(prepared.kind === "scenario") };
        return { token: prepared.token, ...snapshot() };
      }
      case "recover_agent_document": {
        if (permission() !== "local") throw new Error("ACCESS_REVOKED: Document-token recovery requires Local Injection access.");
        const request = args.requestId === undefined ? null : documentRequests.get(String(args.requestId));
        if (args.requestId !== undefined && !request) throw new Error("DOCUMENT_UNKNOWN: This prepare/edit request is unknown in the current Panel Session. Inspect the visible document; this does not prove publication did not occur.");
        if (request) await awaitAgentCall(request.promise, signal);
        if (!prepared || prepared.fingerprint !== fingerprint(prepared.kind === "scenario") || (request && request.token !== prepared.token)) throw new Error("TARGET_CHANGED: The requested agent document is unavailable, superseded or human-edited. Inspect it in Workbench.");
        return { ...(args.requestId === undefined ? {} : { requestId: args.requestId }), token: prepared.token, kind: prepared.kind, consumed: prepared.consumed, ...snapshot() };
      }
      case "abort_agent_document": {
        if (!prepared || args.token !== prepared.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Only the unchanged unexecuted agent document can be aborted.");
        const state = runtime.scenario();
        const unexecuted = prepared.kind === "scenario"
          ? state && ["edit", "review"].includes(state.phase) && !(state.run?.trace.length ?? 0) && !(state.run?.controls.length ?? 0)
          : runtime.local().draft && ["edit", "review"].includes(runtime.local().draft!.phase) && !runtime.local().draft!.outcome;
        if (!unexecuted) throw new Error("TARGET_CHANGED: The document has already started or is unavailable.");
        if (!runtime.abortDocument) throw new Error("UNSUPPORTED_CAPABILITY: This runtime cannot abort an agent document.");
        runtime.abortDocument(); prepared = null;
        return { aborted: true };
      }
      case "prepare_local_injection":
      case "prepare_scenario":
      case "validate_agent_candidate": {
        const ownsBusy = name !== "validate_agent_candidate";
        if (ownsBusy) busy = true;
        try {
          const generation = grantGeneration;
          const stillAuthorized = () => !signal?.aborted && (name === "validate_agent_candidate" ? permission() !== "off" : permission() === "local") && generation === grantGeneration;
          if (name === "validate_agent_candidate") {
            const input = args.members
              ? { kind: "scenario" as const, plan: scenarioPlan(args) }
              : { kind: "draft" as const, draft: normalizeAgentDraft(args.draft as AgentDraftInput) };
            if (input.kind === "draft") validateDraftSource(input.draft);
            const validation = cloneCredentialSafe(await runtime.validateCandidate(input, String(args.pageEpoch), stillAuthorized));
            const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
            return agentToolResultBytes(validation) <= budget ? validation : summarizeCandidateValidation(validation);
          }
          if (name === "prepare_scenario") {
            const plan = scenarioPlan(args);
            if (plan.replace) {
              const current = runtime.scenario()?.scenario;
              if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || current?.id !== plan.replace.scenarioId || current.revision !== plan.replace.revision) throw new Error("TARGET_CHANGED: Only the unchanged agent-owned Scenario can be replaced.");
            }
            await runtime.prepareScenarioPlan(plan, String(args.pageEpoch), stillAuthorized);
            prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(true), kind: "scenario", consumed: false };
            const local = safeDraft(runtime.local());
            let size = 25;
            for (;;) {
              const response = { token: prepared.token, local, scenario: safeScenario(runtime.scenario(), 0, size) };
              if (agentToolResultBytes(response) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return response;
              if (size <= 2) {
                const compact = compactOversizedAgentResult(name, args, response);
                if (compact && agentToolResultBytes(compact) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return compact;
              }
              if (size <= 1) return response; // Final boundary retains the token if even one preview is large.
              size = Math.max(1, Math.floor(size / 2));
            }
          }
          const draft: AgentDraftInput = { scopeId: args.scopeId as string | undefined, evidence: args.evidence as EvidenceIdentity | undefined, document: agentDocumentText(args.document) };
          validateDraftSource(draft);
          await runtime.prepare([draft], false, String(args.pageEpoch), stillAuthorized);
          prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(false), kind: "local", consumed: false };
          return { token: prepared.token, ...snapshot() };
        } finally { if (ownsBusy) busy = false; }
      }
      case "execute_local_injection": {
        const id = String(args.requestId);
        if (documentRequests.has(id) || serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a document publication or Server Injection request.");
        const signature = JSON.stringify([name, args.token]);
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        if (!prepared || prepared.kind !== "local" || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(false)) throw new Error("TARGET_CHANGED: Prepared Draft changed, was consumed, or is unavailable. Inspect the current document in Workbench.");
        if (!(runtime.status() as { visible: boolean }).visible) throw new Error("Show the Workbench panel before injecting.");
        const draft = runtime.local().draft;
        if (!draft?.ready || draft.phase !== "edit") throw new Error("The Draft is not ready for delivery. Inspect its validation in Workbench.");
        prepared.consumed = true;
        const operation = { signature, kind: "local" as const, draftId: draft.id, value: { state: "pending", requestId: id } as unknown };
        requests.set(id, operation); // Reserve before the effect; never retry after a lost reply.
        runtime.execute();
        refreshOperations();
        if (!runtime.local().draft?.outcome && runtime.local().draft?.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
        return operation.value;
      }
      case "get_operation": {
        const id = String(args.requestId);
        const server = serverRequests.get(id);
        if (server) return { requestId: id, state: server.state, approvalRequired: true, ...(server.outcome ? { outcome: server.outcome } : {}) };
        const operation = requests.get(id);
        if (!operation) throw new Error("OPERATION_UNKNOWN: Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
        return operation.value;
      }
      case "wait_for_operation": {
        const requestId = String(args.requestId);
        const operation = requests.get(requestId);
        if (!operation) throw new Error("OPERATION_UNKNOWN: Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
        const response = (status: "COMPLETE" | "TIMED_OUT") => ({ status, requestId,
          completionBoundary: operation.kind === "local" ? "LOCAL_INJECTION_RECEIPT" : "SCENARIO_CONTROL_RECEIPT",
          operation: operation.value });
        const pending = () => operation.kind === "local" && (operation.value as { state?: string }).state === "pending";
        if (!pending()) return response("COMPLETE");
        const timeoutMs = Number(args.timeoutMs ?? 10000);
        if (timeoutMs === 0) return response("TIMED_OUT");
        if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence or operation waits may run concurrently per Panel Session.");
        const controller = new AbortController();
        const cancel = () => controller.abort();
        waits.add(controller); signal?.addEventListener("abort", cancel, { once: true });
        try {
          return await new Promise<ReturnType<typeof response>>((resolve, reject) => {
            let finished = false;
            let unsubscribe = () => {};
            let deadline: ReturnType<typeof setTimeout> | undefined;
            function finish(status?: "COMPLETE" | "TIMED_OUT", failure?: unknown) {
              if (finished) return;
              finished = true;
              clearTimeout(deadline);
              operationListeners.delete(changed);
              unsubscribe();
              controller.signal.removeEventListener("abort", aborted);
              if (status) resolve(response(status));
              else reject(failure ?? new Error("QUERY_CANCELLED: Operation receipt wait was cancelled. Existing outcomes remain readable; no execution was repeated."));
            }
            function aborted() { finish(); }
            function changed() { if (!pending()) finish("COMPLETE"); }
            controller.signal.addEventListener("abort", aborted, { once: true });
            if (signal?.aborted || controller.signal.aborted) { finish(); return; }
            // Subscribe before the second refresh so completion racing setup is
            // observed. This uses notifications and one deadline, no poll loop.
            operationListeners.add(changed);
            try {
              unsubscribe = runtime.subscribeOperations?.(() => refreshOperations()) ?? (() => {});
              if (finished) { unsubscribe(); return; }
              refreshOperations(); changed();
              if (!finished) deadline = setTimeout(() => { refreshOperations(); if (!finished) finish(pending() ? "TIMED_OUT" : "COMPLETE"); }, timeoutMs);
            } catch (error) {
              finish(undefined, error);
            }
          });
        } finally { signal?.removeEventListener("abort", cancel); waits.delete(controller); }
      }
      case "control_scenario": {
        const id = String(args.requestId);
        const signature = JSON.stringify([name, args.runId, args.action]);
        if (serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a Server Injection request.");
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        const current = runtime.scenario();
        if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || !current?.run || current.run.id !== args.runId) throw new Error("TARGET_CHANGED: Reviewed agent Scenario is unavailable or was edited.");
        if (["step", "play"].includes(String(args.action))) {
          if (!(runtime.status() as { visible: boolean }).visible || !["review", "paused"].includes(current.phase)) throw new Error("Scenario must be visible and reviewed or paused before dispatch.");
          prepared.consumed = true;
        }
        const operation = { signature, kind: "scenario" as const, value: { requestId: id, accepted: true } };
        // Keep all earlier receipts: evicting one could let its requestId
        // dispatch again. Reserve one extra ID each for pause and stop.
        const emergencyAction = args.action === "pause" || args.action === "stop" ? args.action : null;
        if (requests.size >= 256) {
          if (!emergencyAction || emergencyControlIds[emergencyAction] || requests.size >= 258) throw new Error("REQUEST_CAPACITY: The Scenario control receipt reserve is full for this action. Existing requestIds remain inspectable.");
          emergencyControlIds[emergencyAction] = id;
        }
        requests.set(id, operation);
        runtime.control(args.action as Parameters<AgentRuntime["control"]>[0]);
        return operation.value;
      }
      case "wait_for_scenario": {
        if (!runtime.subscribeOperations) throw new Error("UNSUPPORTED_CAPABILITY: Scenario progress observation is unavailable in this panel build.");
        if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence, receipt or Scenario waits may run concurrently per Panel Session.");
        const controller = new AbortController();
        const cancel = () => controller.abort();
        waits.add(controller); signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        try {
          return await waitForAgentScenario({ read: currentScenarioProgress, subscribe: listener => runtime.subscribeOperations!(listener) },
            { runId: String(args.runId), pageEpoch: String(args.pageEpoch), ...(args.afterRevision === undefined ? {} : { afterRevision: Number(args.afterRevision) }), timeoutMs: Number(args.timeoutMs ?? 10000), signal: controller.signal });
        } finally { signal?.removeEventListener("abort", cancel); waits.delete(controller); }
      }
      case "get_scenario_trace": {
        let size = Number(args.limit ?? 25);
        const budget = Number(args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
        for (;;) {
          const progress = currentScenarioProgress();
          const trace = safeScenario(runtime.scenario(), Number(args.offset ?? 0), size);
          const response = trace ? { ...trace, progressRevision: progress.revision, pageEpoch: progress.pageEpoch } : null;
          if (agentToolResultBytes(response) <= budget) return response;
          if (size <= 2) {
            const compact = compactOversizedAgentResult(name, args, response, budget);
            if (compact && agentToolResultBytes(compact) <= budget) return compact;
          }
          if (size <= 1) return response; // The final boundary omits its optional preview.
          size = Math.max(1, Math.floor(size / 2));
        }
      }
      case "finish_agent_document": {
        if (!prepared || args.token !== prepared.token || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Agent document is unavailable or was edited.");
        const complete = prepared.kind === "scenario" ? ["complete", "stopped"].includes(runtime.scenario()?.phase ?? "") : runtime.local().draft?.phase === "outcome";
        if (!complete) throw new Error("Only a completed agent document can be finished. Resolve or discard unfinished documents in Workbench.");
        runtime.finish(); prepared = null; return { finished: true };
      }
      default: throw new Error("Tool is unavailable on this Panel Session.");
    }
  }
  return {
    async call(name: string, args: unknown, options?: { signal?: AbortSignal }) {
      const generation = grantGeneration;
      assertNotCancelled(options?.signal);
      const controller = new AbortController();
      const abort = () => controller.abort();
      options?.signal?.addEventListener("abort", abort, { once: true });
      inFlight.add(controller);
      let result: unknown;
      try {
        const input = args as AgentArguments;
        const recoverable = ["prepare_local_injection", "prepare_scenario", "update_agent_document"].includes(name) && typeof input.requestId === "string";
        if (recoverable) {
          validateAgentCall(name, args);
          if (permission() !== "local" || input.panelSessionId !== panelSessionId) throw new Error("ACCESS_REVOKED: Document preparation requires this Panel Session's Local Injection grant.");
          const id = String(input.requestId);
          const signature = JSON.stringify([name, Object.entries(input).filter(([key]) => key !== "requestId").sort(([a], [b]) => a.localeCompare(b))]);
          const existing = documentRequests.get(id);
          if (existing) {
            if (existing.signature !== signature || requests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId belongs to a different document operation.");
            await awaitAgentCall(existing.promise, controller.signal);
            if (!prepared || existing.token !== prepared.token || existing.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: This receipt belongs to a superseded or human-edited document. Inspect its current version.");
            result = { requestId: id, token: prepared.token, kind: prepared.kind, consumed: prepared.consumed, ...snapshot() };
          } else {
            const bytes = new TextEncoder().encode(signature).byteLength;
            if (requests.has(id) || serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies an Injection, control or Server Injection.");
            if (documentRequests.size >= 128 || documentRequestBytes + bytes > 8 * 1024 * 1024) throw new Error("DOCUMENT_BUDGET_EXCEEDED: The Panel Session's bounded document receipt ledger is full. Existing receipts remain readable.");
            const promise = call(name, args, controller.signal);
            const entry: { signature: string; promise: Promise<unknown>; token?: string; fingerprint?: string } = { signature, promise };
            documentRequests.set(id, entry); documentRequestBytes += bytes;
            result = await promise;
            entry.token = (result as { token?: string }).token;
            entry.fingerprint = prepared?.fingerprint;
            result = { ...(result as object), requestId: id };
          }
        } else result = await call(name, args, controller.signal);
        if (generation !== grantGeneration || permission() === "off") throw new Error("ACCESS_REVOKED: Agent access was revoked.");
        assertNotCancelled(controller.signal);
      } catch (error) {
        // A result prepared immediately before cancellation must not leave a
        // continuation that was never published to its caller.
        const cursor = result && typeof result === "object" ? (result as { nextCursor?: unknown }).nextCursor : undefined;
        if (typeof cursor === "string") {
          cursors.delete(cursor); evidenceSearches.delete(cursor); summaries.delete(cursor);
          const scopeCursor = scopeCursors.get(cursor);
          scopeCursors.delete(cursor);
          if (scopeCursor && ![...scopeCursors.values()].some(entry => entry.searchId === scopeCursor.searchId)) scopeSearches.delete(scopeCursor.searchId);
        }
        if (generation !== grantGeneration || permission() === "off") throw new Error("ACCESS_REVOKED: Agent access was revoked.");
        assertNotCancelled(controller.signal);
        throw error;
      } finally {
        options?.signal?.removeEventListener("abort", abort);
        inFlight.delete(controller);
      }
      // Grants can be revoked while a read awaits storage. Do not disclose its result.
      if (permission() === "off" || generation !== grantGeneration) throw new Error("ACCESS_REVOKED: Agent access was revoked.");
      const input = args as AgentArguments;
      const budget = ["query_evidence", "search_evidence", "summarize_evidence", "search_scope", "query_command_rows"].includes(name) && input.cursor
        ? AGENT_RESPONSE_CONTRACT.maxBytes
        : Number(input.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
      if (agentToolResultBytes(result) <= budget) return result;
      const compact = compactOversizedAgentResult(name, input, result, budget);
      if (compact && agentToolResultBytes(compact) <= budget) return compact;
      if (name === "validate_agent_candidate") throw new Error("RESULT_BUDGET_EXCEEDED: Whole-plan validation reason, target or limitations exceed the response budget. Use maxBytes up to 65536 or inspect the candidate in Workbench.");
      throw new Error(name === "execute_local_injection" || name === "control_scenario"
        ? "DELIVERY_UNKNOWN: The operation may have executed, but its response exceeded the agent budget. Inspect its existing requestId; do not retry with a new id."
        : "RESULT_BUDGET_EXCEEDED: Response exceeds the agent budget. Request a smaller page or inspect the exact object in Workbench.");
    },
    refreshOperations,
    revoke() { grantGeneration++; runtime.revokeServerInjectionApproval?.(); cursors.clear(); evidenceSearches.clear(); summaries.clear(); scopeCursors.clear(); scopeSearches.clear(); commandRowCursors.clear(); scopeIndexCache = null; for (const read of inFlight) read.abort(); for (const wait of waits) wait.abort(); if (prepared?.kind === "scenario") runtime.control("pause"); }
  };
}

/** Named projected fields use the same privacy and concrete-value semantics as
 * retained Evidence reads. Presence/provenance stay derived projection facts. */
function safeCommandState(result: Extract<AgentCommandStateResult, { status: "ok" }>, budget: number): unknown {
  // Target identity is opaque and exact. Redaction must never turn one key into
  // another while preserving a presence assertion about the original target.
  const safeTarget = cloneCredentialSafe(result.target);
  if (JSON.stringify(safeTarget) !== JSON.stringify(result.target)) {
    throw new Error("CREDENTIAL_IDENTITY_UNAVAILABLE: This exact COMMAND target contains recognized credential data. Inspect the target in Workbench; this agent read cannot return its identity safely.");
  }
  let redacted = false;
  const fields = result.fields.map(field => {
    const { value, ...metadata } = field;
    if (field.state !== "concrete") return metadata;
    if (value === undefined) return { ...metadata, state: "unavailable", certainty: "unavailable" };
    const safe = cloneCredentialSafe({ [field.name]: value }) as Record<string, unknown>;
    if (!Object.hasOwn(safe, field.name)) {
      redacted = true;
      return { ...metadata, state: "redacted", certainty: "unavailable" };
    }
    if (JSON.stringify(safe[field.name]) !== JSON.stringify(value)) {
      redacted = true;
      return { ...metadata, state: "redacted", certainty: "unavailable", redactedValue: safe[field.name] };
    }
    return { ...metadata, value: safe[field.name] };
  });
  const response = cloneCredentialSafe({ ...result, fields }) as {
    fields: Array<Record<string, unknown>>; fieldsReturned: number; truncated: boolean; limitations: string[];
  };
  if (redacted) response.limitations.push("Recognized credentials are omitted or replaced; redactedValue is a sanitized preview, not an executable concrete field value.");
  // The complete MCP envelope duplicates JSON into text and structured content.
  // Replace individual previews explicitly instead of dropping selected fields
  // or changing presence, read point, provenance, or field-count meanings.
  // If field metadata alone cannot fit, return a bounded prefix with truthful
  // fieldsReturned and truncated rather than an unlabelled partial result.
  while (agentToolResultBytes(response) > budget) {
    let largest = -1, largestBytes = 0;
    response.fields.forEach((field, index) => {
      if (field.value === undefined && field.redactedValue === undefined) return;
      const bytes = agentToolResultBytes(field.value ?? field.redactedValue);
      if (bytes > largestBytes) { largest = index; largestBytes = bytes; }
    });
    if (largest < 0) {
      if (response.fields.length) {
        response.fields.pop();
        response.fieldsReturned = response.fields.length;
        response.truncated = true;
        continue;
      }
      throw new Error("RESULT_BUDGET_EXCEEDED: Exact COMMAND target metadata exceeds maxBytes. Select fewer fields or use a larger maxBytes.");
    }
    const { value: _value, redactedValue: _redactedValue, ...metadata } = response.fields[largest]!;
    response.fields[largest] = { ...metadata, state: "output-budget", certainty: "unavailable" };
    response.truncated = true;
  }
  return response;
}

function safeRecord(record: DeterministicEvidenceRecord, payloadBudget = 256 * 1024) {
  // searchText and summary can contain Client Message text; neither is exported.
  const payloadBytes = record.payload ? new TextEncoder().encode(JSON.stringify(record.payload)).byteLength : 0;
  if (payloadBytes > payloadBudget) return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(record.facets), payloadBytes, payloadOmitted: "Payload exceeds the bounded response budget. Query this exact identity separately or inspect it in Workbench." };
  const payload = record.payload ? toBulkShareableEventEnvelope(record.payload as LightstreamerEventEnvelope) : null;
  // Raw transport text can duplicate a redacted Client Message or credential values.
  const { raw: _raw, ...semantic } = payload ?? {};
  const sanitized = payload ? cloneCredentialSafe(semantic) as LightstreamerEventEnvelope : null;
  if (sanitized?.update && payload?.update?.fields) {
    const safeFields = sanitized.update.fields ?? {};
    const redactedStates = Object.entries(payload.update.fields).filter(([name, value]) =>
      !Object.hasOwn(safeFields, name) || JSON.stringify(safeFields[name]) !== JSON.stringify(value)
    ).map(([name]) => [name, "redacted"] as const);
    if (redactedStates.length) sanitized.update.fieldValueStates = { ...sanitized.update.fieldValueStates, ...Object.fromEntries(redactedStates) };
  }
  return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(record.facets), ...(sanitized ? { payload: sanitized } : {}) };
}
/** Explain only the exported representation: canonical searchText/summary may contain secrets. */
function safeMatchExplanation(evidence: object, query: string) {
  const needle = query.toLowerCase();
  const fields: Array<{ field: string; excerpt: string }> = [];
  let remaining = 4096;
  function visit(value: unknown, path: string, depth = 0): void {
    if (fields.length >= 3 || depth > 16 || remaining-- <= 0) return;
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
        if (fields.length >= 3 || remaining <= 0) break;
      }
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      const found = text.toLowerCase().indexOf(needle);
      if (found < 0) return;
      const start = Math.max(0, found - 32), end = Math.min(text.length, start + 160);
      fields.push({ field: path.slice(0, 200), excerpt: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` });
    }
  }
  visit(evidence, "");
  return { state: fields.length > 0 ? "EXPLAINED" : "NO_SHAREABLE_EXCERPT", fields };
}

function boundedRecords(records: readonly DeterministicEvidenceRecord[]) {
  let remaining = 256 * 1024;
  return records.map(record => {
    const safe = safeRecord(record, Math.min(64 * 1024, remaining));
    if ("payload" in safe) remaining = Math.max(0, remaining - new TextEncoder().encode(JSON.stringify(safe.payload)).byteLength);
    return safe;
  });
}
function compactWaitEvidence(record: DeterministicEvidenceRecord, args: AgentArguments) {
  const requested = (args.filter as { criteria?: readonly { facet: string }[] } | undefined)?.criteria?.map(entry => entry.facet) ?? [];
  const keys = new Set(["kind", "mode", "key", "operation", "phase", "provenance", ...requested]);
  const facets = Object.fromEntries(Object.entries(record.facets).filter(([key]) => keys.has(key)));
  return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(facets) };
}
function projectReadRecord(record: DeterministicEvidenceRecord, includePayload: boolean, fields?: readonly string[]) {
  const facets = Object.fromEntries(Object.entries(record.facets).map(([key, value]) => [key, ["client", "session", "subscription", "item", "listener"].includes(key) ? value?.label : value?.value]));
  const compact = { identity: record.identity, timestamp: record.timestamp, ...facets };
  if (fields?.length) {
    const original = record.payload as LightstreamerEventEnvelope | undefined;
    const safe = original ? toBulkShareableEventEnvelope(original) : undefined;
    const update = safe?.update;
    const projected = Object.fromEntries(fields.map(name => {
      const originalHasValue = original?.update?.fields && Object.hasOwn(original.update.fields, name);
      const safeHasValue = update?.fields && Object.hasOwn(update.fields, name);
      const state = originalHasValue && !safeHasValue ? "redacted" : original?.update?.fieldValueStates?.[name] ?? (safeHasValue ? original?.update?.fields?.[name] === null && original.source === "server" ? "ambiguous-null" : "concrete" : "unavailable");
      const value = update?.fields?.[name];
      const sanitized = state === "concrete" && value !== undefined ? cloneCredentialSafe({ [name]: value }) as Record<string, unknown> : null;
      return [name, state === "concrete" && value !== undefined
        ? Object.hasOwn(sanitized!, name)
          ? JSON.stringify(sanitized![name]) !== JSON.stringify(value)
            ? { state: "redacted", redactedValue: sanitized![name] }
            : { state, value: sanitized![name] }
          : { state: "redacted" }
        : { state }];
    }));
    return { ...compact, fields: projected };
  }
  if (includePayload) {
    const safe = safeRecord(record);
    return { ...compact, ...("payload" in safe ? { payload: safe.payload } : {}), ...("payloadOmitted" in safe ? { payloadOmitted: safe.payloadOmitted, payloadBytes: safe.payloadBytes } : {}) };
  }
  return compact;
}

function makeReadQuery(runtime: AgentRuntime, args: AgentArguments): AgentQueryInput {
  const query = makeQuery(args);
  if (args.within === undefined && args.where === undefined) return query;
  if (args.within === "current-investigation" && (args.where !== undefined || args.filter !== undefined || args.text !== undefined)) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to change filtering.");
  const boundary = structuredClone(runtime.queryBoundary(args.scopeId as string | undefined, args.within === "current-investigation"));
  const where = args.where as Record<string, string[]> | undefined;
  const criteria = { ...boundary.filter.criteria, ...query.filter?.criteria } as Record<string, { include: ReturnType<typeof createTypedFilterValue>[]; exclude: ReturnType<typeof createTypedFilterValue>[] }>;
  for (const [facet, values] of Object.entries(where ?? {})) {
    const descriptor = FACET_DESCRIPTORS.find(candidate => candidate.key === facet);
    if (!descriptor) throw new Error(`Unsupported Evidence facet: ${facet}`);
    criteria[facet] = { include: values.map(value => createTypedFilterValue(facet, descriptor.valueType, value, value)), exclude: [] };
  }
  const filter = canonicalizeFilter({ ...boundary.filter, text: args.text !== undefined || (args.filter as { text?: string } | undefined)?.text !== undefined ? query.filter!.text : boundary.filter.text, criteria, around: (args.filter as { around?: Filter["around"] } | undefined)?.around ?? boundary.filter.around });
  return { ...query, scope: boundary.scope, filter };
}
function safeDraft(local: ReturnType<AgentRuntime["local"]>) {
  if (!local.draft) return local;
  const { rawText: _raw, source: _source, preflightFingerprint: _fingerprint, nativeChanges, ...draft } = local.draft;
  const documentBytes = new TextEncoder().encode(JSON.stringify(draft.document)).byteLength;
  return { ...local, draft: cloneCredentialSafe({ ...draft, nativeChanges: agentNativeChangePreview(nativeChanges), ...(documentBytes > 64 * 1024 ? { document: null, documentOmitted: "Preview exceeds 64 KiB; inspect the visible Workbench Draft.", documentBytes } : {}) }), privacy: "Recognized credential fields are omitted; this is not a general secret detector. Captured redactions are not executable values." };
}
function safeScenario(state: ReturnType<AgentRuntime["scenario"]>, offset = 0, limit = 25) {
  if (!state) return null;
  // Source JSON text can contain credentials; expose reviewed documents, explicit membership and trace only.
  // Final serialized budget fitting decides page size. Explicit maxBytes can
  // retain a larger Step preview when its complete MCP result fits.
  let remaining = 64 * 1024;
  const members = state.scenario.members.slice(offset, offset + limit).map(member => {
    if (member.kind === "checkpoint") return { kind: "checkpoint" as const, id: member.id, name: member.name, assertions: member.assertions };
    const step = member;
    const bytes = new TextEncoder().encode(JSON.stringify(step.draft.document)).byteLength;
    const include = bytes <= remaining;
    if (include) remaining -= bytes;
    const nativeChanges = state.run?.steps.find(reviewed => reviewed.id === step.id)?.nativeChanges;
    return { kind: "step" as const, id: step.id, document: include ? step.draft.document : null, nativeChanges: agentNativeChangePreview(nativeChanges), ...(include ? {} : { documentOmitted: "Preview budget exceeded; inspect the Workbench document or request a smaller page.", documentBytes: bytes }), diagnostics: step.draft.diagnostics, ready: step.draft.ready };
  });
  const steps = members.filter((member): member is Extract<typeof member, { kind: "step" }> => member.kind === "step");
  const run = state.run ? {
    id: state.run.id, target: state.run.target, committedEvidenceSeed: state.run.committedEvidenceSeed,
    status: state.run.status, nextOrdinal: state.run.nextOrdinal, trace: state.run.trace.slice(offset, offset + limit),
    controls: state.run.controls.slice(-25), drifts: state.run.drifts.slice(-25), controlsTotal: state.run.controls.length, driftsTotal: state.run.drifts.length
  } : null;
  const totalSteps = state.scenario.steps.length, totalMembers = state.scenario.members.length, totalTrace = state.run?.trace.length ?? 0;
  return cloneCredentialSafe({ phase: state.phase, scenarioId: state.scenario.id, revision: state.scenario.revision, offset, totalSteps, totalMembers, totalTrace, nextOffset: offset + limit < Math.max(totalMembers, totalTrace) ? offset + limit : null, members, steps, run, membershipError: state.membershipError, runner: state.runner ? { phase: state.runner.phase, pauseReason: state.runner.pauseReason, nextOrdinal: state.runner.nextOrdinal } : null });
}

function makeQuery(args: AgentArguments, defaultLimit = 25, forcePayload = false, defaultOrder: AgentQueryInput["order"] = "OLDEST_FIRST"): AgentQueryInput {
  const inputFilter = args.filter as { text?: string; criteria?: readonly { facet: string; polarity: "include" | "exclude"; type: string; value: string | number | boolean | null; label?: string }[]; around?: Filter["around"] } | undefined;
  const text = inputFilter?.text ?? args.text as string | undefined ?? "";
  const criteria: Record<string, { include: ReturnType<typeof createTypedFilterValue>[]; exclude: ReturnType<typeof createTypedFilterValue>[] }> = {};
  for (const entry of inputFilter?.criteria ?? []) {
    const bucket = criteria[entry.facet] ??= { include: [], exclude: [] };
    bucket[entry.polarity].push(createTypedFilterValue(entry.facet, entry.type, entry.value, entry.label ?? String(entry.value)));
  }
  const queryFilter = canonicalizeFilter({ ...createFilter(), text, criteria, around: inputFilter?.around ?? null });
  const discoveries = (args.discover as readonly { facet: string; search?: string; limit?: number; cursor?: string }[] | undefined)?.map(request => ({ facet: request.facet, ...(request.search === undefined ? {} : { search: request.search }), size: Number(request.limit ?? 25), ...(request.cursor ? { cursor: request.cursor } : {}) }));
  return {
    ...(typeof args.scopeId === "string" ? { scopeId: args.scopeId } : {}),
    size: Number(args.limit ?? defaultLimit),
    adaptivePage: true,
    at: (args.at as EvidenceReadPoint | "LATEST_COMMITTED" | undefined) ?? "LATEST_COMMITTED",
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
    includePayload: forcePayload || args.includePayload === true,
    order: (args.order as AgentQueryInput["order"] | undefined) ?? defaultOrder,
    filter: queryFilter,
    ...(discoveries ? { discover: discoveries } : {}),
    ...(args.sequenceWindow ? { sequenceWindow: args.sequenceWindow as AgentQueryInput["sequenceWindow"] } : {}),
    ...(args.fieldPredicates ? { fieldPredicates: args.fieldPredicates as AgentQueryInput["fieldPredicates"] } : {}),
    ...(args.aggregate ? { aggregate: args.aggregate as AgentQueryInput["aggregate"] } : {}),
    ...(args.workBudget ? { workBudget: args.workBudget as AgentQueryInput["workBudget"] } : {})
  };
}

function fitAgentPrefix(size: number, budget: number, response: (count: number) => unknown, message: string): number {
  if (agentToolResultBytes(response(size)) <= budget) return size;
  let low = 1, high = size - 1, fitted = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (agentToolResultBytes(response(middle)) <= budget) { fitted = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (!fitted) throw new Error(`RESULT_BUDGET_EXCEEDED: ${message}`);
  return fitted;
}
function shortenedEvidenceCursor(result: EvidenceSnapshot, count: number): string | null {
  if (count >= result.page.evidence.length) return result.page.nextCursor;
  const resume = result.page.resumeCursor ?? result.page.nextCursor;
  if (!resume || !count) throw new Error("UNSUPPORTED_CAPABILITY: This history build cannot fit terminal Evidence pages without losing records.");
  return reanchorEvidenceQueryCursor(resume, result.page.evidence[count - 1]!.identity);
}

function scenarioPlan(args: AgentArguments): AgentScenarioPlanInput {
  const members: AgentScenarioMember[] = args.members
    ? (args.members as AgentScenarioMember[]).map(member => member.kind === "step" ? { ...member, ...normalizeAgentDraft(member) } : member)
    : (args.steps as AgentDraftInput[]).map((step, index) => ({ kind: "step", id: `step-${index + 1}`, ...normalizeAgentDraft(step) }));
  const ids = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id)) throw new Error("Scenario member ids must be unique.");
    ids.add(member.id);
    if (member.kind === "step") validateDraftSource(member);
  }
  return { members, ...(args.replace ? { replace: args.replace as AgentScenarioPlanInput["replace"] } : {}) };
}

function validateDraftSource(draft: AgentDraftInput): void {
  if (Boolean(draft.scopeId) === Boolean(draft.evidence)) throw new Error("Provide exactly one live scopeId or retained Evidence identity for each candidate Step.");
}

function agentDocumentText(value: unknown): string | undefined {
  return value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value);
}
function normalizeAgentDraft(draft: AgentDraftInput): AgentDraftInput {
  return { ...draft, ...(draft.document === undefined ? {} : { document: agentDocumentText(draft.document) }) };
}

function omissions(payloadRequested: boolean): string[] {
  return payloadRequested
    ? ["Client Message bodies are redacted; raw transport text is omitted."]
    : ["Item Update payloads were not requested; Client Message bodies and raw transport text are omitted."];
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("QUERY_CANCELLED: Agent call was cancelled. No read result was published.");
}

/** A cancelled duplicate lookup must not cancel the original publication call. */
function awaitAgentCall<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("QUERY_CANCELLED: Document receipt lookup was cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Redact source spans instead of parsing numeric values or reserializing safe
 * application text. JSON is validated first, but its parsed values are never
 * used to reconstruct the string. Nested JSON strings use the same policy. */
function redactEmbeddedJson(source: string, depth: number): string {
  try { JSON.parse(source); } catch { return source; }
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length) offset++; };
  const stringEnd = () => {
    offset++; // opening quote
    while (offset < source.length) {
      const char = source[offset++];
      if (char === "\\") offset++;
      else if (char === '"') break;
    }
  };
  const value = (level: number, omit = false): void => {
    whitespace();
    const start = offset;
    const char = source[offset];
    if (omit || level > 16) {
      // Skip a bounded-out or credential value iteratively. Do not recurse
      // into a discarded subtree: application JSON can be arbitrarily deep.
      if (char === '"') stringEnd();
      else if (char === "{" || char === "[") {
        let nesting = 0;
        do {
          const token = source[offset];
          if (token === '"') stringEnd();
          else {
            if (token === "{" || token === "[") nesting++;
            if (token === "}" || token === "]") nesting--;
            offset++;
          }
        } while (nesting > 0 && offset < source.length);
      } else while (offset < source.length && !/[\s,\]}]/.test(source[offset]!)) offset++;
      edits.push({ start, end: offset, replacement: JSON.stringify(omit ? "[REDACTED:credential]" : "[OMITTED:deeply-nested-data]") });
      return;
    }
    if (char === '"') {
      stringEnd();
      if (!omit && level <= 16) {
        const text = JSON.parse(source.slice(start, offset)) as string;
        const safe = cloneCredentialSafe(text, level + 1);
        if (safe !== text) edits.push({ start, end: offset, replacement: JSON.stringify(safe) });
      }
    } else if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      offset++; whitespace();
      while (source[offset] !== close) {
        let credential = false;
        if (char === "{") {
          const keyStart = offset;
          stringEnd();
          const key = JSON.parse(source.slice(keyStart, offset)) as string;
          credential = !Object.hasOwn(omitCredentialFields({ [key]: true }) as object, key);
          whitespace(); offset++; // colon
        }
        value(level + 1, omit || credential || level > 16);
        whitespace();
        if (source[offset] === ",") { offset++; whitespace(); } else break;
      }
      offset++; // closing delimiter
    } else {
      while (offset < source.length && !/[\s,\]}]/.test(source[offset]!)) offset++;
    }

  };
  value(depth);
  let safe = source;
  for (const edit of edits.reverse()) safe = safe.slice(0, edit.start) + edit.replacement + safe.slice(edit.end);
  return safe;
}

function cloneCredentialSafe(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[OMITTED:deeply-nested-data]";
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) return redactEmbeddedJson(value, depth + 1);
  if (Array.isArray(value)) return value.map(entry => cloneCredentialSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  // Test each property at this level; recursively omitting the whole graph here
  // would duplicate the walk and bypass this function's nesting bound.
  return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(omitCredentialFields({ [key]: true }) as object, key))
    .map(([key, entry]) => [key, cloneCredentialSafe(entry, depth + 1)]));
}
