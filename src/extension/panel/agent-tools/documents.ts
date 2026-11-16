import { AGENT_RESPONSE_CONTRACT } from "../../../agent/protocol";
import type { AgentDocumentArgument, AgentScenarioMemberArgument, AgentScenarioReplaceArgument, AgentStepArgument } from "../../../agent/tool-arguments";
import { agentToolResultBytes } from "../../../agent/tool-result";
import { waitForAgentScenario } from "../agent-scenario-wait";
import type { AgentDraftInput, AgentScenarioMember, AgentScenarioPlanInput } from "../agent-runtime";
import { compactOversizedAgentResult, summarizeCandidateValidation } from "./compaction";
import { awaitAgentCall, beginAgentWait, type AgentServiceContext, type AgentToolHandlers, type OperationEntry } from "./context";
import { cloneCredentialSafe, safeDraft, safeScenario } from "./redaction";

/** Agent-owned Local Injection Drafts, Scenarios, their receipts and Run control. */
export function createDocumentHandlers(context: AgentServiceContext): AgentToolHandlers {
  const { runtime, permission, state, fingerprint, snapshot, refreshOperations, currentScenarioProgress } = context;
  const { requests, documentRequests, serverRequests, emergencyControlIds, waits, operationListeners } = state;

  /** Human Drafts stay protected: publication requires Local access; validation only an active grant. */
  async function documentWork<T>(kind: "publish" | "validate", signal: AbortSignal | undefined, work: (stillAuthorized: () => boolean) => Promise<T>): Promise<T> {
    const ownsBusy = kind === "publish";
    if (ownsBusy) state.busy = true;
    try {
      const generation = state.grantGeneration;
      const stillAuthorized = () => !signal?.aborted && (kind === "validate" ? permission() !== "off" : permission() === "local") && generation === state.grantGeneration;
      return await work(stillAuthorized);
    } finally { if (ownsBusy) state.busy = false; }
  }

  return {
    async generate_agent_candidates(args, signal) {
      if (!runtime.generateCandidates) throw new Error("UNSUPPORTED_CAPABILITY: Candidate generation is unavailable in this panel build.");
      const { panelSessionId: _panel, pageEpoch: _epoch, maxBytes: _max, ...input } = args;
      const matrix = { ...input, base: normalizeAgentDraft(input.base) };
      return cloneCredentialSafe(await runtime.generateCandidates(matrix, args.pageEpoch, () => permission() !== "off" && !signal?.aborted));
    },
    update_agent_document(args) {
      const prepared = state.prepared;
      if (!prepared || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Agent document was changed or executed. Inspect the document in Workbench.");
      runtime.edit(agentDocumentText(args.document), args.stepId);
      state.prepared = { ...prepared, token: crypto.randomUUID(), fingerprint: fingerprint(prepared.kind === "scenario") };
      return { token: state.prepared.token, ...snapshot() };
    },
    async recover_agent_document(args, signal) {
      if (permission() !== "local") throw new Error("ACCESS_REVOKED: Document-token recovery requires Local Injection access.");
      const request = args.requestId === undefined ? null : documentRequests.get(args.requestId);
      if (args.requestId !== undefined && !request) throw new Error("DOCUMENT_UNKNOWN: This prepare/edit request is unknown in the current Panel Session. Inspect the visible document; this does not prove publication did not occur.");
      if (request) await awaitAgentCall(request.promise, signal);
      const prepared = state.prepared;
      if (!prepared || prepared.fingerprint !== fingerprint(prepared.kind === "scenario") || (request && request.token !== prepared.token)) throw new Error("TARGET_CHANGED: The requested agent document is unavailable, superseded or human-edited. Inspect it in Workbench.");
      return { ...(args.requestId === undefined ? {} : { requestId: args.requestId }), token: prepared.token, kind: prepared.kind, consumed: prepared.consumed, ...snapshot() };
    },
    abort_agent_document(args) {
      const prepared = state.prepared;
      if (!prepared || args.token !== prepared.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Only the unchanged unexecuted agent document can be aborted.");
      const scenario = runtime.scenario();
      const unexecuted = prepared.kind === "scenario"
        ? scenario && ["edit", "review"].includes(scenario.phase) && !(scenario.run?.trace.length ?? 0) && !(scenario.run?.controls.length ?? 0)
        : runtime.local().draft && ["edit", "review"].includes(runtime.local().draft!.phase) && !runtime.local().draft!.outcome;
      if (!unexecuted) throw new Error("TARGET_CHANGED: The document has already started or is unavailable.");
      if (!runtime.abortDocument) throw new Error("UNSUPPORTED_CAPABILITY: This runtime cannot abort an agent document.");
      runtime.abortDocument(); state.prepared = null;
      return { aborted: true };
    },
    validate_agent_candidate(args, signal) {
      return documentWork("validate", signal, async stillAuthorized => {
        const input = args.members
          ? { kind: "scenario" as const, plan: scenarioPlan(args) }
          : { kind: "draft" as const, draft: normalizeAgentDraft(args.draft!) };
        if (input.kind === "draft") validateDraftSource(input.draft);
        const validation = cloneCredentialSafe(await runtime.validateCandidate(input, args.pageEpoch, stillAuthorized));
        const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
        return agentToolResultBytes(validation) <= budget ? validation : summarizeCandidateValidation(validation);
      });
    },
    prepare_scenario(args, signal) {
      return documentWork("publish", signal, async stillAuthorized => {
        const plan = scenarioPlan(args);
        if (plan.replace) {
          const current = runtime.scenario()?.scenario;
          const prepared = state.prepared;
          if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || current?.id !== plan.replace.scenarioId || current.revision !== plan.replace.revision) throw new Error("TARGET_CHANGED: Only the unchanged agent-owned Scenario can be replaced.");
        }
        await runtime.prepareScenarioPlan(plan, args.pageEpoch, stillAuthorized);
        const prepared = state.prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(true), kind: "scenario", consumed: false };
        const local = safeDraft(runtime.local());
        let size = 25;
        for (;;) {
          const response = { token: prepared.token, local, scenario: safeScenario(runtime.scenario(), 0, size) };
          if (agentToolResultBytes(response) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return response;
          if (size <= 2) {
            const compact = compactOversizedAgentResult("prepare_scenario", args, response);
            if (compact && agentToolResultBytes(compact) <= AGENT_RESPONSE_CONTRACT.defaultMaxBytes) return compact;
          }
          if (size <= 1) return response; // Final boundary retains the token if even one preview is large.
          size = Math.max(1, Math.floor(size / 2));
        }
      });
    },
    prepare_local_injection(args, signal) {
      return documentWork("publish", signal, async stillAuthorized => {
        const draft: AgentDraftInput = { scopeId: args.scopeId, evidence: args.evidence, document: args.document === undefined ? undefined : agentDocumentText(args.document) };
        validateDraftSource(draft);
        await runtime.prepare([draft], false, args.pageEpoch, stillAuthorized);
        state.prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(false), kind: "local", consumed: false };
        return { token: state.prepared.token, ...snapshot() };
      });
    },
    execute_local_injection(args) {
      const id = args.requestId;
      if (documentRequests.has(id) || serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a document publication or Server Injection request.");
      const signature = JSON.stringify(["execute_local_injection", args.token]);
      const previous = requests.get(id);
      if (previous) {
        if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
        return previous.value;
      }
      const prepared = state.prepared;
      if (!prepared || prepared.kind !== "local" || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(false)) throw new Error("TARGET_CHANGED: Prepared Draft changed, was consumed, or is unavailable. Inspect the current document in Workbench.");
      if (!runtime.status().visible) throw new Error("Show the Workbench panel before injecting.");
      const draft = runtime.local().draft;
      if (!draft?.ready || draft.phase !== "edit") throw new Error("The Draft is not ready for delivery. Inspect its validation in Workbench.");
      prepared.consumed = true;
      const operation: OperationEntry = { signature, kind: "local", draftId: draft.id, value: { state: "pending", requestId: id } };
      requests.set(id, operation); // Reserve before the effect; never retry after a lost reply.
      runtime.execute();
      refreshOperations();
      if (!runtime.local().draft?.outcome && runtime.local().draft?.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
      return operation.value;
    },
    get_operation(args) {
      const id = args.requestId;
      const server = serverRequests.get(id);
      if (server) return { requestId: id, state: server.state, approvalRequired: true, ...(server.outcome ? { outcome: server.outcome } : {}) };
      const operation = requests.get(id);
      if (!operation) throw new Error("OPERATION_UNKNOWN: Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
      return operation.value;
    },
    async wait_for_operation(args, signal) {
      const requestId = args.requestId;
      const operation = requests.get(requestId);
      if (!operation) throw new Error("OPERATION_UNKNOWN: Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
      const response = (status: "COMPLETE" | "TIMED_OUT") => ({ status, requestId,
        completionBoundary: operation.kind === "local" ? "LOCAL_INJECTION_RECEIPT" : "SCENARIO_CONTROL_RECEIPT",
        operation: operation.value });
      const pending = () => operation.kind === "local" && operation.value.state === "pending";
      if (!pending()) return response("COMPLETE");
      const timeoutMs = args.timeoutMs ?? 10000;
      if (timeoutMs === 0) return response("TIMED_OUT");
      if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence or operation waits may run concurrently per Panel Session.");
      const wait = beginAgentWait(state, signal, false);
      const controller = wait.controller;
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
      } finally { wait.end(); }
    },
    control_scenario(args) {
      const id = args.requestId;
      const signature = JSON.stringify(["control_scenario", args.runId, args.action]);
      if (serverRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a Server Injection request.");
      const previous = requests.get(id);
      if (previous) {
        if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
        return previous.value;
      }
      const current = runtime.scenario();
      const prepared = state.prepared;
      if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || !current?.run || current.run.id !== args.runId) throw new Error("TARGET_CHANGED: Reviewed agent Scenario is unavailable or was edited.");
      if (args.action === "step" || args.action === "play") {
        if (!runtime.status().visible || !["review", "paused"].includes(current.phase)) throw new Error("Scenario must be visible and reviewed or paused before dispatch.");
        prepared.consumed = true;
      }
      const operation: OperationEntry = { signature, kind: "scenario", value: { requestId: id, accepted: true } };
      // Keep all earlier receipts: evicting one could let its requestId
      // dispatch again. Reserve one extra ID each for pause and stop.
      const emergencyAction = args.action === "pause" || args.action === "stop" ? args.action : null;
      if (requests.size >= 256) {
        if (!emergencyAction || emergencyControlIds[emergencyAction] || requests.size >= 258) throw new Error("REQUEST_CAPACITY: The Scenario control receipt reserve is full for this action. Existing requestIds remain inspectable.");
        emergencyControlIds[emergencyAction] = id;
      }
      requests.set(id, operation);
      runtime.control(args.action);
      return operation.value;
    },
    async wait_for_scenario(args, signal) {
      if (!runtime.subscribeOperations) throw new Error("UNSUPPORTED_CAPABILITY: Scenario progress observation is unavailable in this panel build.");
      if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence, receipt or Scenario waits may run concurrently per Panel Session.");
      const wait = beginAgentWait(state, signal, true);
      try {
        return await waitForAgentScenario({ read: currentScenarioProgress, subscribe: listener => runtime.subscribeOperations!(listener) },
          { runId: args.runId, pageEpoch: args.pageEpoch, ...(args.afterRevision === undefined ? {} : { afterRevision: args.afterRevision }), timeoutMs: args.timeoutMs ?? 10000, signal: wait.controller.signal });
      } finally { wait.end(); }
    },
    get_scenario_trace(args) {
      let size = args.limit ?? 25;
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      for (;;) {
        const progress = currentScenarioProgress();
        const trace = safeScenario(runtime.scenario(), args.offset ?? 0, size);
        const response = trace ? { ...trace, progressRevision: progress.revision, pageEpoch: progress.pageEpoch } : null;
        if (agentToolResultBytes(response) <= budget) return response;
        if (size <= 2) {
          const compact = compactOversizedAgentResult("get_scenario_trace", args, response, budget);
          if (compact && agentToolResultBytes(compact) <= budget) return compact;
        }
        if (size <= 1) return response; // The final boundary omits its optional preview.
        size = Math.max(1, Math.floor(size / 2));
      }
    },
    finish_agent_document(args) {
      const prepared = state.prepared;
      if (!prepared || args.token !== prepared.token || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("TARGET_CHANGED: Agent document is unavailable or was edited.");
      const complete = prepared.kind === "scenario" ? ["complete", "stopped"].includes(runtime.scenario()?.phase ?? "") : runtime.local().draft?.phase === "outcome";
      if (!complete) throw new Error("Only a completed agent document can be finished. Resolve or discard unfinished documents in Workbench.");
      runtime.finish(); state.prepared = null; return { finished: true };
    }
  };
}

type ScenarioPlanArguments = Readonly<{ members?: readonly AgentScenarioMemberArgument[]; steps?: readonly AgentStepArgument[]; replace?: AgentScenarioReplaceArgument }>;

function scenarioPlan(args: ScenarioPlanArguments): AgentScenarioPlanInput {
  const members: AgentScenarioMember[] = args.members
    ? args.members.map(member => member.kind === "step" ? normalizeAgentDraft(member) : member)
    : args.steps!.map((step, index) => ({ kind: "step", id: `step-${index + 1}`, ...normalizeAgentDraft(step) }));
  const ids = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id)) throw new Error("Scenario member ids must be unique.");
    ids.add(member.id);
    if (member.kind === "step") validateDraftSource(member);
  }
  return { members, ...(args.replace ? { replace: args.replace } : {}) };
}

function validateDraftSource(draft: AgentDraftInput): void {
  if (Boolean(draft.scopeId) === Boolean(draft.evidence)) throw new Error("Provide exactly one live scopeId or retained Evidence identity for each candidate Step.");
}

function agentDocumentText(value: AgentDocumentArgument): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Typed documents cross into the runtime as their exact JSON text; key order is preserved. */
function normalizeAgentDraft<T extends Readonly<{ document?: AgentDocumentArgument }>>(draft: T): Omit<T, "document"> & { document?: string } {
  return { ...draft, ...(draft.document === undefined ? {} : { document: agentDocumentText(draft.document) }) } as Omit<T, "document"> & { document?: string };
}
