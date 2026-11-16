import { AGENT_RESPONSE_CONTRACT, AGENT_TOOLS, isAgentToolName, validateAgentCall, type AgentArguments, type AgentPermission, type AgentToolArguments, type AgentToolName } from "../../agent/protocol";
import type { EvidenceReadPoint } from "../../core/evidence-filter-contract";
import type { AgentRuntime, AgentQueryInput } from "./agent-runtime";
import { agentToolResultBytes } from "../../agent/tool-result";
import { BoundedMap } from "../../core/bounded-map";
import { DEFAULT_QUERY_WORK, assertNotCancelled, awaitAgentCall, type AgentServiceContext, type AgentServiceState, type AgentToolHandler, type AgentToolHandlers, type DocumentRequestEntry } from "./agent-tools/context";
import { compactOversizedAgentResult } from "./agent-tools/compaction";
import { cloneCredentialSafe, safeDraft, safeScenario } from "./agent-tools/redaction";
import { createScopeHandlers } from "./agent-tools/scope";
import { createEvidenceHandlers } from "./agent-tools/evidence";
import { createCommandHandlers } from "./agent-tools/command";
import { createServerInjectionHandlers } from "./agent-tools/server-injection";
import { createDocumentHandlers } from "./agent-tools/documents";

export { projectAgentStatus, summarizeCandidateValidation } from "./agent-tools/compaction";

export function createAgentService(runtime: AgentRuntime, panelSessionId: string, permission: () => AgentPermission) {
  const state: AgentServiceState = {
    cursors: new BoundedMap(128),
    evidenceSearches: new BoundedMap(128),
    summaries: new BoundedMap(128),
    scopeSearches: new BoundedMap(8),
    scopeCursors: new BoundedMap(128),
    commandRowCursors: new BoundedMap(128),
    requests: new Map(),
    documentRequests: new Map(),
    serverRequests: new Map(),
    emergencyControlIds: {},
    waits: new Set(),
    operationListeners: new Set(),
    inFlight: new Set(),
    serverPrepared: null,
    documentRequestBytes: 0,
    scopeIndexCache: null,
    prepared: null,
    busy: false,
    scenarioProgress: null,
    grantGeneration: 0
  };
  const { cursors, evidenceSearches, summaries, scopeSearches, scopeCursors, commandRowCursors, requests, documentRequests, serverRequests, waits, operationListeners, inFlight } = state;
  const saveNextCursor = (query: AgentQueryInput, readPoint: EvidenceReadPoint, cursor: string | null, fields?: readonly string[], maxBytes?: number): string | null => {
    if (!cursor) return null;
    const opaque = crypto.randomUUID();
    const { at: _at, cursor: _cursor, ...boundQuery } = query;
    cursors.set(opaque, { query: boundQuery, at: readPoint, cursor, fields, maxBytes, pageEpoch: runtime.status().pageEpoch });
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
    const scenario = runtime.scenario();
    const run = scenario?.run;
    const signature = JSON.stringify(run ? [scenario.phase, run.status, run.nextOrdinal, run.nextMemberIndex,
      run.trace.length, run.controls.length, run.drifts.length, scenario.runner?.phase, scenario.runner?.pauseReason,
      scenario.runner?.activeCheckpoint?.assertions.map(value => [value.assertionId, value.status])] : null);
    const progress = state.scenarioProgress;
    if (!run) state.scenarioProgress = null;
    else if (progress?.runId !== run.id) state.scenarioProgress = { runId: run.id, signature, revision: 0 };
    else if (progress.signature !== signature) state.scenarioProgress = { runId: run.id, signature, revision: progress.revision + 1 };
    return { pageEpoch: runtime.status().pageEpoch, runId: run?.id ?? null,
      revision: state.scenarioProgress?.revision ?? 0, terminal: Boolean(run && ["complete", "stopped"].includes(scenario!.phase)),
      scenario: safeScenario(scenario) };
  }
  function refreshOperations() {
    if (![...requests.values()].some(operation => operation.kind === "local" && operation.value.state === "pending")) return;
    const draft = runtime.local().draft;
    for (const operation of requests.values()) {
      if (operation.kind !== "local" || operation.value.state !== "pending" || !draft || draft.id !== operation.draftId) continue;
      if (draft.outcome) {
        const settlement = draft.outcome.executionId && runtime.localSettlement?.(draft.outcome.executionId);
        operation.value = { state: "complete", outcome: cloneCredentialSafe(draft.outcome),
          ...(settlement ? { evidence: cloneCredentialSafe(settlement.evidence), correlation: cloneCredentialSafe(settlement.correlation) } : {}) };
      }
      else if (draft.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
      if (operation.value.state !== "pending") {
        for (const listener of [...operationListeners]) listener();
      }
    }
  }
  const guardedQuery = async (input: AgentQueryInput, signal?: AbortSignal) => {
    assertNotCancelled(signal);
    const result = await runtime.query({ ...input, workBudget: input.workBudget ?? DEFAULT_QUERY_WORK, signal });
    assertNotCancelled(signal);
    return result;
  };
  const context: AgentServiceContext = { runtime, panelSessionId, permission, state, dispatch: call, guardedQuery, saveNextCursor, fingerprint, snapshot, currentScenarioProgress, refreshOperations };
  const handlers: AgentToolHandlers = {
    ...createScopeHandlers(context),
    ...createEvidenceHandlers(context),
    ...createCommandHandlers(context),
    ...createServerInjectionHandlers(context),
    ...createDocumentHandlers(context)
  };
  /** The single typed seam: call() has already run validateAgentCall for this exact tool name. */
  function runTool<N extends AgentToolName>(name: N, input: AgentArguments, signal: AbortSignal | undefined): unknown {
    const handler: AgentToolHandler<N> | undefined = handlers[name];
    if (!handler) throw new Error("Tool is unavailable on this Panel Session.");
    return handler(input as AgentToolArguments<N>, signal);
  }

  async function call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    assertNotCancelled(signal);
    validateAgentCall(name, input);
    // Admission reads the generic validated envelope before the tool-specific shape.
    const args: AgentArguments = input;
    if (permission() === "off" || args.panelSessionId !== panelSessionId) throw new Error("ACCESS_REVOKED: This Panel Session has not granted agent access.");
    const mutation = AGENT_TOOLS.find(tool => tool.name === name)!.mutation;
    if (mutation && permission() !== "local") throw new Error("ACCESS_REVOKED: This Panel Session grants inspection only.");
    const emergencyControl = args.action === "pause" || args.action === "stop";
    if (state.busy && mutation && !(name === "control_scenario" && emergencyControl)) throw new Error("REQUEST_CAPACITY: Another agent operation is preparing a document. Try this mutation again after it settles.");
    refreshOperations();
    if (requests.size >= 256 && ["execute_local_injection", "control_scenario"].includes(name) && !(typeof args.requestId === "string" && requests.has(args.requestId)) && !emergencyControl) throw new Error("OPERATION_BUDGET_EXCEEDED: This Panel Session reached its 256-operation agent limit. Existing outcomes remain readable; pause and stop remain available.");
    if (!isAgentToolName(name)) throw new Error("Tool is unavailable on this Panel Session.");
    return await runTool(name, args, signal);
  }
  return {
    async call(name: string, args: unknown, options?: { signal?: AbortSignal }) {
      const generation = state.grantGeneration;
      assertNotCancelled(options?.signal);
      const controller = new AbortController();
      const abort = () => controller.abort();
      options?.signal?.addEventListener("abort", abort, { once: true });
      inFlight.add(controller);
      let result: unknown;
      try {
        // Unvalidated until the recoverable branch or the inner call checks it.
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
            const prepared = state.prepared;
            if (!prepared || existing.token !== prepared.token || existing.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: This receipt belongs to a superseded or human-edited document. Inspect its current version.");
            result = { requestId: id, token: prepared.token, kind: prepared.kind, consumed: prepared.consumed, ...snapshot() };
          } else {
            const bytes = new TextEncoder().encode(signature).byteLength;
            if (requests.has(id) || serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies an Injection, control or Server Injection.");
            if (documentRequests.size >= 128 || state.documentRequestBytes + bytes > 8 * 1024 * 1024) throw new Error("DOCUMENT_BUDGET_EXCEEDED: The Panel Session's bounded document receipt ledger is full. Existing receipts remain readable.");
            const promise = call(name, args, controller.signal);
            const entry: DocumentRequestEntry = { signature, promise };
            documentRequests.set(id, entry); state.documentRequestBytes += bytes;
            result = await promise;
            entry.token = (result as { token?: string }).token;
            entry.fingerprint = state.prepared?.fingerprint;
            result = { ...(result as object), requestId: id };
          }
        } else result = await call(name, args, controller.signal);
        if (generation !== state.grantGeneration || permission() === "off") throw new Error("ACCESS_REVOKED: Agent access was revoked.");
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
        if (generation !== state.grantGeneration || permission() === "off") throw new Error("ACCESS_REVOKED: Agent access was revoked.");
        assertNotCancelled(controller.signal);
        throw error;
      } finally {
        options?.signal?.removeEventListener("abort", abort);
        inFlight.delete(controller);
      }
      // Grants can be revoked while a read awaits storage. Do not disclose its result.
      if (permission() === "off" || generation !== state.grantGeneration) throw new Error("ACCESS_REVOKED: Agent access was revoked.");
      const input = args as AgentArguments;
      const budget = ["query_evidence", "search_evidence", "summarize_evidence", "search_scope", "query_command_rows"].includes(name) && input.cursor
        ? AGENT_RESPONSE_CONTRACT.maxBytes
        : Number(input.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
      if (agentToolResultBytes(result) <= budget) return result;
      const compact = compactOversizedAgentResult(name, input, result, budget);
      if (compact && agentToolResultBytes(compact) <= budget) return compact;
      if (name === "get_scope") throw new Error("RESULT_BUDGET_EXCEEDED: Scope exceeds maxBytes. Retry get_scope with fieldLimit:1 or maxBytes up to 65536. Page names with schema.nextOffset/fieldOffset; inspect oversized details in Workbench.");
      if (name === "validate_agent_candidate") throw new Error("RESULT_BUDGET_EXCEEDED: Whole-plan validation reason, target or limitations exceed the response budget. Use maxBytes up to 65536 or inspect the candidate in Workbench.");
      throw new Error(name === "execute_local_injection" || name === "control_scenario"
        ? "DELIVERY_UNKNOWN: The operation may have executed, but its response exceeded the agent budget. Inspect its existing requestId; do not retry with a new id."
        : "RESULT_BUDGET_EXCEEDED: Response exceeds the agent budget. Request a smaller page or inspect the exact object in Workbench.");
    },
    refreshOperations,
    revoke() { state.grantGeneration++; runtime.revokeServerInjectionApproval?.(); cursors.clear(); evidenceSearches.clear(); summaries.clear(); scopeCursors.clear(); scopeSearches.clear(); commandRowCursors.clear(); state.scopeIndexCache = null; for (const read of inFlight) read.abort(); for (const wait of waits) wait.abort(); if (state.prepared?.kind === "scenario") runtime.control("pause"); }
  };
}
