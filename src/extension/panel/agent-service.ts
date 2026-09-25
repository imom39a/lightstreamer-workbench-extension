import { AGENT_MAX_BYTES, AGENT_PROTOCOL_VERSION, AGENT_TOOLS, validateAgentCall, type AgentArguments, type AgentPermission } from "../../agent/protocol";
import { toBulkShareableEventEnvelope, type LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { EvidenceIdentity, EvidenceReadPoint, DeterministicEvidenceRecord } from "../../core/evidence-filter-contract";
import type { AgentRuntime, AgentDraftInput } from "./agent-runtime";
import { cloneCredentialSafe as omitCredentialFields } from "./topology-export";

export function createAgentService(runtime: AgentRuntime, panelSessionId: string, permission: () => AgentPermission) {
  const cursors = new Map<string, { at: EvidenceReadPoint; cursor: string; scopeId?: string; text?: string; size: number; includePayload: boolean }>();
  const requests = new Map<string, { signature: string; kind: "local" | "scenario"; draftId?: string; value: unknown }>();
  let prepared: { token: string; fingerprint: string; kind: "local" | "scenario"; consumed: boolean } | null = null;
  let busy = false;
  let grantGeneration = 0;
  const fingerprint = (scenario: boolean) => {
    if (!scenario) return JSON.stringify([runtime.local().draft?.id, runtime.local().draft?.rawText, runtime.local().draft?.anchor]);
    const definition = runtime.scenario()?.scenario;
    // Cursor, focus and validation presentation do not mutate the execution plan.
    return JSON.stringify(definition ? { id: definition.id, revision: definition.revision, target: definition.target, speed: definition.speed, members: definition.members.map(member => member.kind === "step" ? { id: member.id, rawText: member.draft.rawText, target: member.draft.target, item: member.draft.item, delayMs: member.draft.relativeDelayMs } : member) } : null);
  };
  const snapshot = () => ({ local: safeDraft(runtime.local()), scenario: safeScenario(runtime.scenario()) });
  function refreshOperations() {
    if (![...requests.values()].some(operation => operation.kind === "local" && (operation.value as { state?: string }).state === "pending")) return;
    const draft = runtime.local().draft;
    for (const operation of requests.values()) {
      if (operation.kind !== "local" || !draft || draft.id !== operation.draftId) continue;
      if (draft.outcome) operation.value = { state: "complete", outcome: cloneCredentialSafe(draft.outcome) };
      else if (draft.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
    }
  }
  async function call(name: string, input: unknown): Promise<unknown> {
    validateAgentCall(name, input);
    const args = input as AgentArguments;
    if (permission() === "off" || args.panelSessionId !== panelSessionId) throw new Error("This Panel Session has not granted agent access.");
    const mutation = AGENT_TOOLS.find(tool => tool.name === name)!.mutation;
    if (mutation && permission() !== "local") throw new Error("This Panel Session grants inspection only.");
    if (busy) throw new Error("Another agent operation is preparing a document. Try this read again after it settles.");
    refreshOperations();
    if (requests.size >= 256 && ["execute_local_injection", "control_scenario"].includes(name) && !(typeof args.requestId === "string" && requests.has(args.requestId)) && !["pause", "stop"].includes(String(args.action))) throw new Error("This Panel Session reached its 256-operation agent limit. Existing outcomes remain readable; pause and stop remain available.");
    switch (name) {
      case "get_status": return { protocolVersion: AGENT_PROTOCOL_VERSION, panelSessionId, permission: permission(), ...runtime.status() as object, capabilities: AGENT_TOOLS.filter(tool => tool.name !== "list_panel_sessions" && (!tool.mutation || permission() === "local")).map(tool => tool.name) };
      case "list_scope": return runtime.scopes(Number(args.offset ?? 0), Number(args.limit ?? 50));
      case "get_scope": return cloneCredentialSafe(runtime.scope(String(args.scopeId)));
      case "query_evidence": {
        let query = { scopeId: args.scopeId as string | undefined, text: args.text as string | undefined, size: Number(args.limit ?? 25), includePayload: args.includePayload === true, at: "LATEST_COMMITTED" as "LATEST_COMMITTED" | EvidenceReadPoint, cursor: undefined as string | undefined };
        if (args.cursor) {
          const saved = cursors.get(String(args.cursor));
          if (!saved) throw new Error("Query cursor expired. Start a new query.");
          query = { ...saved, scopeId: saved.scopeId, text: saved.text };
        }
        const result = await runtime.query(query);
        let nextCursor: string | null = null;
        if (result.page.nextCursor) {
          nextCursor = crypto.randomUUID();
          cursors.set(nextCursor, { ...query, at: result.readPoint, cursor: result.page.nextCursor });
          if (cursors.size > 128) cursors.delete(cursors.keys().next().value!);
        }
        return { readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage, nextCursor, evidence: result.page.evidence.map(safeRecord) };
      }
      case "get_evidence": {
        const result = await runtime.query({ at: "LATEST_COMMITTED", size: 1, includePayload: true, lookup: args.evidence as EvidenceIdentity });
        return { readPoint: result.readPoint, coverage: result.coverage, lookup: result.lookup?.state === "RETAINED" ? { state: "RETAINED", evidence: safeRecord(result.lookup.evidence) } : result.lookup };
      }
      case "query_diagnostics": {
        const result = await runtime.diagnostics(args.after as Parameters<AgentRuntime["diagnostics"]>[0]);
        const observations = result.observations.slice(0, Number(args.limit ?? 50));
        const truncated = observations.length < result.observations.length;
        return cloneCredentialSafe({ ...result, observations, truncated, nextAfter: truncated ? observations.at(-1)!.observationBoundary : null });
      }
      case "update_agent_document": {
        if (!prepared || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("Agent document was changed or executed. Inspect the document in Workbench.");
        runtime.edit(String(args.document), args.stepId as string | undefined);
        prepared = { ...prepared, token: crypto.randomUUID(), fingerprint: fingerprint(prepared.kind === "scenario") };
        return { token: prepared.token, ...snapshot() };
      }
      case "prepare_local_injection":
      case "prepare_scenario": {
        busy = true;
        try {
          const scenario = name === "prepare_scenario";
          const generation = grantGeneration;
          await runtime.prepare(scenario ? args.steps as AgentDraftInput[] : [{ scopeId: args.scopeId as string | undefined, evidence: args.evidence as EvidenceIdentity | undefined, document: args.document as string | undefined }], scenario, String(args.pageEpoch), () => permission() === "local" && generation === grantGeneration);
          prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(scenario), kind: scenario ? "scenario" : "local", consumed: false };
          return { token: prepared.token, ...snapshot() };
        } finally { busy = false; }
      }
      case "execute_local_injection": {
        const id = String(args.requestId);
        const signature = JSON.stringify([name, args.token]);
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        if (!prepared || prepared.kind !== "local" || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(false)) throw new Error("Prepared Draft changed, was consumed, or is unavailable. Inspect the current document in Workbench.");
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
        const operation = requests.get(String(args.requestId));
        if (!operation) throw new Error("Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
        return operation.value;
      }
      case "control_scenario": {
        const id = String(args.requestId);
        const signature = JSON.stringify([name, args.runId, args.action]);
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        const current = runtime.scenario();
        if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || !current?.run || current.run.id !== args.runId) throw new Error("Reviewed agent Scenario is unavailable or was edited.");
        if (["step", "play"].includes(String(args.action))) {
          if (!(runtime.status() as { visible: boolean }).visible || !["review", "paused"].includes(current.phase)) throw new Error("Scenario must be visible and reviewed or paused before dispatch.");
          prepared.consumed = true;
        }
        const operation = { signature, kind: "scenario" as const, value: { requestId: id, accepted: true } };
        if (requests.size < 256) requests.set(id, operation);
        runtime.control(args.action as Parameters<AgentRuntime["control"]>[0]);
        return operation.value;
      }
      case "get_scenario_trace": return safeScenario(runtime.scenario(), Number(args.offset ?? 0), Number(args.limit ?? 25));
      case "finish_agent_document": {
        if (!prepared || args.token !== prepared.token || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("Agent document is unavailable or was edited.");
        const complete = prepared.kind === "scenario" ? ["complete", "stopped"].includes(runtime.scenario()?.phase ?? "") : runtime.local().draft?.phase === "outcome";
        if (!complete) throw new Error("Only a completed agent document can be finished. Resolve or discard unfinished documents in Workbench.");
        runtime.finish(); prepared = null; return { finished: true };
      }
      default: throw new Error("Tool is unavailable on this Panel Session.");
    }
  }
  return {
    async call(name: string, args: unknown) {
      const result = await call(name, args);
      // Grants can be revoked while a read awaits storage. Do not disclose its result.
      if (permission() === "off") throw new Error("Agent access was revoked.");
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > AGENT_MAX_BYTES) throw new Error("Response exceeds 512 KiB. Narrow the query, lower its limit, or omit payloads. Mutations are not retried; inspect their existing outcome.");
      return result;
    },
    refreshOperations,
    revoke() { grantGeneration++; if (prepared?.kind === "scenario") runtime.control("pause"); }
  };
}

function safeRecord(record: DeterministicEvidenceRecord) {
  // searchText and summary can contain Client Message text; neither is exported.
  const payload = record.payload ? toBulkShareableEventEnvelope(record.payload as LightstreamerEventEnvelope) : null;
  // Raw transport text can duplicate a redacted Client Message or credential values.
  const { raw: _raw, ...semantic } = payload ?? {};
  return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(record.facets), ...(payload ? { payload: cloneCredentialSafe(semantic) } : {}) };
}
function safeDraft(local: ReturnType<AgentRuntime["local"]>) {
  if (!local.draft) return local;
  const { rawText: _raw, source: _source, preflightFingerprint: _fingerprint, ...draft } = local.draft;
  const documentBytes = new TextEncoder().encode(JSON.stringify(draft.document)).byteLength;
  return { ...local, draft: cloneCredentialSafe({ ...draft, ...(documentBytes > 64 * 1024 ? { document: null, documentOmitted: "Preview exceeds 64 KiB; inspect the visible Workbench Draft.", documentBytes } : {}) }), privacy: "Recognized credential fields are omitted; this is not a general secret detector. Captured redactions are not executable values." };
}
function safeScenario(state: ReturnType<AgentRuntime["scenario"]>, offset = 0, limit = 25) {
  if (!state) return null;
  // Source JSON text can contain credentials; expose reviewed documents, identities and trace only.
  let remaining = 64 * 1024;
  const steps = state.scenario.steps.slice(offset, offset + limit).map(step => {
    const bytes = new TextEncoder().encode(JSON.stringify(step.draft.document)).byteLength;
    const include = bytes <= remaining;
    if (include) remaining -= bytes;
    return { id: step.id, document: include ? step.draft.document : null, ...(include ? {} : { documentOmitted: "Preview budget exceeded; inspect the Workbench document or request a smaller page.", documentBytes: bytes }), diagnostics: step.draft.diagnostics, ready: step.draft.ready };
  });
  const run = state.run ? {
    id: state.run.id, target: state.run.target, committedEvidenceSeed: state.run.committedEvidenceSeed,
    status: state.run.status, nextOrdinal: state.run.nextOrdinal, trace: state.run.trace.slice(offset, offset + limit),
    controls: state.run.controls.slice(-25), drifts: state.run.drifts.slice(-25), controlsTotal: state.run.controls.length, driftsTotal: state.run.drifts.length
  } : null;
  const totalSteps = state.scenario.steps.length, totalTrace = state.run?.trace.length ?? 0;
  return cloneCredentialSafe({ phase: state.phase, scenarioId: state.scenario.id, offset, totalSteps, totalTrace, nextOffset: offset + limit < Math.max(totalSteps, totalTrace) ? offset + limit : null, steps, run, membershipError: state.membershipError, runner: state.runner ? { phase: state.runner.phase, pauseReason: state.runner.pauseReason, nextOrdinal: state.runner.nextOrdinal } : null });
}

function cloneCredentialSafe(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[OMITTED:deeply-nested-data]";
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object") return JSON.stringify(cloneCredentialSafe(parsed, depth + 1));
    } catch { /* Plain application text; no inferred secret detection. */ }
  }
  if (Array.isArray(value)) return value.map(entry => cloneCredentialSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(omitCredentialFields(value) as Record<string, unknown>).map(([key, entry]) => [key, cloneCredentialSafe(entry, depth + 1)]));
}
