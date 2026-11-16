import { AGENT_READ_CONTRACT, AGENT_RESPONSE_CONTRACT, type AgentArguments } from "../../../agent/protocol";
import { agentToolResultBytes } from "../../../agent/tool-result";
import type { AgentRuntimeStatus } from "../agent-runtime";

/** Only these operational fields cross the agent boundary. History may retain a
 * full lastCoherentQuery for its own recovery; it is never part of status.
 * Partial runtimes (older builds and focused fakes) report an UNKNOWN status. */
export function projectAgentStatus(status: Partial<AgentRuntimeStatus>) {
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

export function compactOversizedAgentResult(name: string, args: AgentArguments, result: unknown, budget: number = AGENT_RESPONSE_CONTRACT.defaultMaxBytes): unknown | null {
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
    const recovery = { tool: "recover_agent_document", arguments: { ...(value.requestId ? { requestId: value.requestId } : {}), maxBytes: AGENT_READ_CONTRACT.maxBytes },
      fallback: "If the full preview still exceeds the maximum, inspect the existing document in Workbench." };
    const compact = { token: value.token, ...(value.requestId ? { requestId: value.requestId } : {}), ...(value.kind ? { kind: value.kind } : {}), ...(value.consumed !== undefined ? { consumed: value.consumed } : {}), previewOmitted: omitted, recovery };
    const contract = (value.local as { draft?: { documentContract?: unknown } } | undefined)?.draft?.documentContract;
    return contract && agentToolResultBytes({ ...compact, documentContract: contract }) <= budget ? { ...compact, documentContract: contract } : compact;
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
      ...(value.readContext !== undefined ? { readContext: value.readContext } : {}),
      localInjection: { ...(local?.anchor ? { anchor: local.anchor } : {}), ...(local?.unavailable ? { unavailable: local.unavailable } : {}),
        ...(local?.recovery ? { recovery: local.recovery } : {}),
        ...(local?.capabilities ? { capabilities: local.capabilities } : {}), ...(local?.diagnostics ? { diagnostics: local.diagnostics } : {}), documentOmitted: omitted } };
    if (agentToolResultBytes(base) <= budget) return base;
    const diagnosticsOmitted = local?.diagnostics ? { diagnosticsOmitted: "Target diagnostics exceeded the response budget; inspect the Scope in Workbench." } : {};
    const withoutDiagnostics = { ...base, localInjection: { ...(local?.anchor ? { anchor: local.anchor } : {}), ...(local?.capabilities ? { capabilities: local.capabilities } : {}),
      ...(local?.unavailable ? { unavailable: local.unavailable } : {}), documentOmitted: omitted,
      ...(local?.recovery ? { recovery: local.recovery } : {}),
      ...diagnosticsOmitted } };
    if (agentToolResultBytes(withoutDiagnostics) <= budget || value.readContext === undefined) return withoutDiagnostics;
    // Keep investigation schema usable even when a wide injection capability
    // list cannot fit. Omission never changes whether authoring is available.
    const anchor = local?.anchor as Record<string, unknown> | undefined;
    const compactAnchor = anchor && Object.fromEntries(["pageEpoch", "clientId", "sessionId", "subscriptionId", "subscriptionMode", "itemName", "itemPosition", "listenerId", "captureSource", "sourceKind", "executionTarget"].filter(key => anchor[key] !== undefined).map(key => [key, anchor[key]]));
    return { ...base, localInjection: { ...(compactAnchor ? { anchor: compactAnchor } : {}),
      ...(local?.unavailable ? { unavailable: local.unavailable } : {}),
      ...(local?.recovery ? { recovery: local.recovery } : {}),
      ...(local?.capabilities ? { capabilitiesOmitted: "Injection capabilities exceed maxBytes; raise the bounded budget or inspect Workbench before authoring." } : {}),
      documentOmitted: omitted, ...diagnosticsOmitted } };
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
