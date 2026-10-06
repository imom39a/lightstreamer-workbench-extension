/** Transport result contracts. Page-owned documents and envelopes remain opaque
 * JSON; identities, capability facts, verdicts and delivery boundaries do not. */
type S = {
  type?: string | string[]; properties?: Record<string, S>; required?: string[];
  additionalProperties?: boolean | S; items?: S; oneOf?: readonly S[];
  anyOf?: readonly S[]; allOf?: readonly S[]; enum?: readonly unknown[]; const?: unknown;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; pattern?: string; if?: S; then?: S;
};
const str: S = { type: "string" };
const bool: S = { type: "boolean" };
const num: S = { type: "number" };
const count: S = { type: "integer", minimum: 0,  };
const opaque: S = { type: "object", additionalProperties: true };
const choice = (...values: unknown[]): S => ({ enum: values });
const nullable = (s: S): S => ({ oneOf: [s, { type: "null" }] });
const array = (items: S, maxItems?: number): S => ({ type: "array", items, ...(maxItems === undefined ? {} : { maxItems }) });
const obj = (properties: Record<string, S>, required = Object.keys(properties), open = false): S => ({ type: "object", properties, required, additionalProperties: open });
const strings = array(str);
const item = obj({ name: nullable(str), position: nullable({ ...count, minimum: 1 }) });
const valueState = choice("concrete", "ambiguous-null", "unavailable", "redacted", "unresolved-wire-difference");
const diagnostic = obj({ code: str, severity: choice("error", "warning", "information"), message: str }, ["code", "severity", "message"], true);
const diagnostics = array(diagnostic);
const target = obj({ pageEpoch: str, clientId: str, sessionId: str, subscriptionId: str, deliveryPath: choice("listener", "wire"), mode: nullable(str) });
const nativeChanges = nullable(obj({ changedFields: strings, fieldValueStates: { type: "object", additionalProperties: valueState }, version: choice(1), policy: choice("captured-bitmap", "native-mode"), basis: str, limitations: strings, refusal: str, baseline: nullable(str) }, ["changedFields", "fieldValueStates", "version", "policy", "basis", "limitations", "baseline"]));
const replayability = obj({ replayable: bool }, ["replayable"], true);
const stepVerdict = obj({ id: str, kind: choice("step"), valid: bool, diagnostics, replayability, nativeChanges }, ["id", "valid", "diagnostics", "nativeChanges"], true);
const checkpointVerdict = { oneOf: [obj({ id: str, kind: choice("checkpoint"), valid: choice(true) }, ["id", "valid"], true), obj({ id: str, kind: choice("checkpoint"), valid: choice(false), reason: str }, ["id", "valid", "reason"], true)] };
const node = obj({ id: str, kind: str, label: str, parentId: nullable(str), lifecycle: str, retired: bool, detail: str }, ["id", "kind", "label"], true);
const capability = obj({ version: choice(1), target: obj({ ...target.properties, item, listenerId: nullable(str) }), supportedModes: array(choice("COMMAND", "MERGE", "DISTINCT"), 3), sourceFree: bool,
  schema: obj({ basis: choice("declared-field-list"), fields: strings, jsonStringFields: strings }), fields: array(obj({ name: str, valueState })),
  changePolicy: obj({ replay: str, generated: str, unavailableBaseline: str, delete: str }),
  limits: obj({ maxScenarioSteps: count, maxScenarioBytes: count, maxCheckpointAssertions: count, maxFieldAssignments: count, maxDelayMs: count, maxAssertionActiveMs: count }), assertions: strings,
  delivery: obj({ contactsServer: choice(false), localEvidence: choice(true), appOutcome: choice("not-observed"), rawSupported: choice(false), limitations: strings }) });
const localOutcome = obj({ disposition: choice("delivered", "blocked", "failed", "partial", "acknowledgement-unknown"), status: choice("success", "stale-target", "listener-error", "wire-error", "bridge-error", "acknowledgement-unknown", "review-blocked"), executionId: str, requestId: nullable(str), timestamp: num, headline: str, detail: str, attemptedCount: count, deliveredCount: count, failedCount: count, limitations: array(opaque) }, ["disposition", "status", "executionId", "requestId", "timestamp"]);
const serverOutcome = obj({ requestId: str, ok: bool, status: choice("processed", "denied", "discarded", "aborted", "unknown", "stale-target", "bridge-error"), timestamp: num, error: str, code: nullable(num), response: nullable(str), sentOnNetwork: nullable(bool) }, ["requestId", "ok", "status", "timestamp"]);
const controlReceipt = obj({ requestId: str, accepted: choice(true), detailsOmitted: str }, ["requestId", "accepted"]);
const localDraft = obj({ draft: nullable(obj({ id: str, phase: str, ready: bool, document: nullable(opaque), diagnostics, nativeChanges }, ["id", "phase", "ready", "nativeChanges"], true)) }, ["draft"], true);

export function preciseAgentSuccess(name: string, identity: S, readPoint: S, assertion: S): S | undefined {
  if (name === "execute_server_injection") return { oneOf: [obj({ requestId: str, state: choice("pending") }), obj({ requestId: str, state: choice("complete"), outcome: serverOutcome, detailsOmitted: str }, ["requestId", "state", "outcome"])] };
  if (name === "recover_server_injection") {
    const common = { token: str, requestId: str, approvalRequired: choice(true), document: nullable(opaque), previewOmitted: str };
    return { oneOf: [obj({ ...common, state: choice("prepared", "approved", "pending", "aborted"), outcome: nullable(serverOutcome) }, ["token", "state", "approvalRequired"]), obj({ ...common, state: choice("complete"), outcome: serverOutcome }, ["token", "state", "approvalRequired", "outcome"])] };
  }
  if (name === "prepare_server_injection") return obj({ token: str, requestId: str, approvalRequired: choice(true), draft: nullable(opaque), outcome: serverOutcome, aborted: choice(true), previewOmitted: str }, ["token", "requestId", "approvalRequired"]);
  const ref = obj({ intervalId: str, sequence: { ...count, minimum: 1 }, eventId: str });
  const settlement = { oneOf: [obj({ state: choice("not-created", "delivered-unretained") }), obj({ state: choice("committed"), reference: ref, identity: nullable(identity), limitation: str }, ["state", "reference", "identity"])] };
  const correlation = obj({ executionId: str, requestId: nullable(str), sourceEventId: nullable(str), scenarioId: str, runId: str, stepId: str, ordinal: count, injectionId: str, targetId: str }, ["executionId", "requestId", "sourceEventId"]);
  const receipt = { oneOf: [
    obj({ state: choice("pending"), requestId: str }, ["state", "requestId"]),
    obj({ state: choice("not-run"), validation: localDraft }),
    obj({ state: choice("complete"), outcome: localOutcome, evidence: settlement, correlation }, ["state", "outcome", "evidence", "correlation"]),
    { oneOf: [obj({ requestId: str, state: choice("prepared", "approved", "pending", "aborted"), approvalRequired: choice(true), outcome: serverOutcome }, ["requestId", "state", "approvalRequired"]), obj({ requestId: str, state: choice("complete"), approvalRequired: choice(true), outcome: serverOutcome })] },
    controlReceipt,
    obj({ requestId: nullable(str), state: choice("unknown", "pending", "not-run", "complete", "prepared", "approved", "aborted"), outcome: { oneOf: [localOutcome, serverOutcome] }, evidence: settlement, detailsOmitted: str }, ["requestId", "state", "detailsOmitted"])
  ] };
  for (const variant of receipt.oneOf) {
    if ("required" in variant && variant.required?.includes("detailsOmitted")) {
      variant.if = { properties: { state: choice("complete") } };
      variant.then = { required: ["outcome"] };
    }
  }
  if (name === "list_panel_sessions" || name === "get_pairing_requests") {
    const entry = name === "list_panel_sessions" ? obj({ panelSessionId: str, connectionId: str, tabId: count, permission: choice("read", "local"), extensionOrigin: str }, ["panelSessionId", "connectionId", "permission"], true)
      : obj({ requestId: str, code: str, expiresAt: num, panelApproved: bool });
    return obj({ items: array(entry), total: count, offset: count, nextOffset: nullable(count) }, ["items"]);
  }
  if (name === "confirm_pairing") return obj({ confirmed: choice(true), requestId: str });
  if (name === "query_diagnostics") {
    const boundary = obj({ intervalId: str, sequence: count });
    const observation = obj({ schemaVersion: choice(1), id: str, code: str, ruleVersion: count, severity: choice("information", "warning", "error"), lifecycle: { oneOf: [obj({ kind: choice("occurrence"), occurrenceId: str, state: choice("observed") }), obj({ kind: choice("condition"), conditionId: str, state: choice("active", "resolved") })] }, affected: obj({ kind: str }, ["kind"], true), observedAt: num, observationBoundary: boundary, observed: str, limitation: str, consequence: str, route: opaque }, undefined, true);
    return obj({ status: choice("complete", "unsupported", "retention-gap", "cleared", "unavailable", "closed"), coverage: choice("complete", "limited", "unavailable"), retention: choice("complete", "limited", "cleared", "unavailable"), through: boundary, observations: array(observation, 100), truncated: bool, nextAfter: nullable(boundary) });
  }
  if (name === "execute_local_injection") return { oneOf: [receipt.oneOf[0], receipt.oneOf[1], receipt.oneOf[2], { ...receipt.oneOf[5], properties: { ...receipt.oneOf[5].properties, outcome: localOutcome } }] };
  if (name === "get_operation") return receipt;
  if (name === "wait_for_operation") return obj({ status: choice("COMPLETE", "TIMED_OUT"), requestId: str, completionBoundary: choice("LOCAL_INJECTION_RECEIPT", "SCENARIO_CONTROL_RECEIPT"), operation: receipt });
  if (name === "control_scenario") return controlReceipt;
  if (name === "finish_agent_document") return obj({ finished: choice(true) });
  if (name === "validate_agent_candidate") {
    const common = { pageEpoch: str, target: nullable(target), limitations: strings, valid: bool, reason: str };
    const full = obj({ ...common, candidates: array(stepVerdict, 100), members: array({ oneOf: [stepVerdict, checkpointVerdict] }, 200), steps: array(stepVerdict, 100), checkpoints: array(checkpointVerdict, 100) }, ["valid", "pageEpoch", "target", "limitations", "checkpoints"], true);
    // Require an actual full detail collection, or the explicit whole-plan omission counts.
    full.anyOf = [{ required: ["candidates"] }, { required: ["members", "steps"] }];
    const compact = obj({ ...common, memberCount: count, stepCount: count, checkpointCount: count, invalidStepCount: count, invalidCheckpointCount: count, detailsOmitted: str }, ["valid", "pageEpoch", "target", "limitations", "memberCount", "stepCount", "checkpointCount", "invalidStepCount", "invalidCheckpointCount", "detailsOmitted"]);
    return { allOf: [{ oneOf: [full, compact] }, { if: { properties: { valid: choice(false) } }, then: { required: ["reason"] } }] };
  }
  if (name === "get_scope") return obj({ node, pageEpoch: nullable(str), localInjection: { oneOf: [obj({ unavailable: str, documentOmitted: str, diagnosticsOmitted: str }, ["unavailable"]), obj({ anchor: obj({ pageEpoch: str, clientId: str, sessionId: str, subscriptionId: str, itemName: nullable(str), itemPosition: nullable(count) }, ["pageEpoch", "clientId", "sessionId", "subscriptionId", "itemName", "itemPosition"], true), capabilities: capability, document: opaque, diagnostics, documentOmitted: str, diagnosticsOmitted: str }, ["anchor", "capabilities"])] } });
  const record = obj({ identity, timestamp: num, fields: { type: "object", additionalProperties: { oneOf: [obj({ state: choice("concrete"), value: {} }), obj({ state: choice("redacted"), redactedValue: {} }, ["state"]), obj({ state: choice("ambiguous-null", "unavailable", "unresolved-wire-difference") })] } }, payload: opaque, payloadOmitted: str, payloadBytes: count }, ["identity", "timestamp"], true);
  if (name === "get_evidence") return obj({ readPoint, coverage: choice("COMPLETE", "LIMITED"), lookup: { oneOf: [obj({ state: choice("RETAINED"), evidence: record }), obj({ state: choice("NOT_RETAINED", "OTHER_INTERVAL"), identity })] } });
  if (name === "get_scenario_trace") {
    const step = obj({ kind: choice("step"), id: str, ready: bool, document: nullable(opaque), nativeChanges, diagnostics, documentOmitted: str, documentBytes: count }, ["kind", "id", "ready"]);
    const checkpoint = obj({ kind: choice("checkpoint"), id: str, name: str, assertions: array(obj({ id: str, kind: str }, ["id", "kind"], true), 16) }, ["kind", "id", "name"]);
    const traceEntry: S = { oneOf: [
      obj({ kind: choice("attempted"), stepId: str, ordinal: count, injectionId: str, outcome: localOutcome, evidence: nullable(ref), retention: choice("NOT_CREATED", "COMMITTED", "DELIVERED_UNRETAINED"), evidenceAvailability: choice("RETAINED", "UNAVAILABLE_AFTER_CLEAR", "NOT_APPLICABLE") }, undefined, true),
      obj({ kind: choice("checkpoint"), checkpointId: str, checkpointName: str, memberOrdinal: count, status: choice("pass", "fail", "inconclusive", "expired", "invalid", "unavailable", "not-evaluable"), startedBoundary: nullable(ref), resultBoundary: nullable(ref) }, undefined, true),
      obj({ kind: choice("not-run"), stepId: str, ordinal: count, reason: choice("RUN STOPPED"), evidence: { type: "null" } }, undefined, true)
    ] };
    const run = obj({ id: str, status: choice("paused", "complete", "stopped"), nextOrdinal: count, trace: array(traceEntry), controlsTotal: count, driftsTotal: count, target: opaque, committedEvidenceSeed: nullable(ref), controls: array(opaque), drifts: array(opaque) }, ["id", "status", "nextOrdinal", "trace", "controlsTotal", "driftsTotal"]);
    return { oneOf: [obj({ value: { type: "null" } }), obj({ phase: str, scenarioId: str, revision: count, offset: count, totalSteps: count, totalMembers: count, totalTrace: count, nextOffset: nullable(count), members: array({ oneOf: [step, checkpoint] }, 200), steps: array(step, 100), run: nullable(run), membershipError: nullable(str), runner: nullable(obj({ phase: str, pauseReason: nullable(str), nextOrdinal: count })), progressRevision: count, pageEpoch: nullable(str), previewOmitted: str }, ["phase", "scenarioId", "revision", "offset", "totalSteps", "totalMembers", "totalTrace", "nextOffset", "members", "steps", "run", "runner", "progressRevision", "pageEpoch"])] };
  }
  if (name === "list_scope") return obj({ total: count, offset: count, nodes: array(node, 100), nextOffset: nullable(count) }, undefined, true);
  if (name === "search_scope") return obj({ snapshot: obj({ pageEpoch: nullable(str), structureRevision: count, history: obj({ intervalId: str, committedSequence: nullable(count), retainedFirstSequence: nullable(count) }) }), boundary: choice("ALL_STRUCTURAL_TOPOLOGY"), match: choice("CASE_INSENSITIVE_SUBSTRING"), text: str, total: count, offset: count, nextCursor: nullable(str), scopes: array(obj({ scopeId: str, kind: str, label: str, path: str, ancestorIds: strings, matchedFields: strings }, undefined, true), 100) }, undefined, true);
  if (name === "search_evidence") return obj({ readPoint, coverage: choice("COMPLETE", "LIMITED"), evaluation: choice("COMPLETE", "UNSUPPORTED_FILTER"), storage: choice("MEMORY_FALLBACK", "INDEXED_DB"), totals: obj({ matching: count, inScope: count }, undefined, true), evidence: array(record, 100), nextCursor: nullable(str) }, undefined, true);
  return undefined;
}
