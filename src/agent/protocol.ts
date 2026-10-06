import { MAX_EVIDENCE_REF_COMPONENT_UTF8_BYTES } from "../core/event-history-authoritative";
import { compactAgentSchema } from "./schema-compaction";
import { preciseAgentSuccess } from "./result-schemas";
import { SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT, SCENARIO_MAX_MEMBER_ID_LENGTH, SCENARIO_MAX_CHECKPOINT_NAME_LENGTH, SCENARIO_MAX_ASSERTION_ACTIVE_MS, validateScenarioCheckpoint } from "../core/local-injection-scenario-checkpoint";
import { DIAGNOSTIC_RULE_CODE_MAX_LENGTH } from "../core/diagnostic-observation";
import { FACET_DESCRIPTORS } from "../core/evidence-facets";
/** Shared, transport-independent agent contract. Application text is untrusted data. */
export const AGENT_PROTOCOL_VERSION = 1;
export type Message = Record<string, unknown>;
export const AGENT_MAX_BYTES = 512 * 1024;
export const AGENT_READ_CONTRACT = Object.freeze({ version: 2, defaultMaxBytes: 8192, maxBytes: 65536 });
/** Budget the complete MCP CallToolResult, including its text and structured copies. */
export const AGENT_RESPONSE_CONTRACT = Object.freeze({ defaultMaxBytes: 8192, maxBytes: 65536 });
export type AgentPermission = "off" | "read" | "local";
export type AgentArguments = Record<string, unknown>;
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema; items?: Schema; oneOf?: readonly Schema[]; enum?: readonly unknown[]; const?: unknown; minimum?: number; maximum?: number; maxLength?: number; minLength?: number; maxItems?: number; minItems?: number; pattern?: string };
const text = { type: "string", minLength: 1, maxLength: 2048 };
const memberId: Schema = { type: "string", minLength: 1, maxLength: SCENARIO_MAX_MEMBER_ID_LENGTH, pattern: "\\S" };
const integer = (maximum: number): Schema => ({ type: "integer", minimum: 0, maximum });
const number = (maximum = Number.MAX_SAFE_INTEGER): Schema => ({ type: "number", minimum: 0, maximum });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
const evidenceRefPart: Schema = { type: "string", minLength: 1, maxLength: MAX_EVIDENCE_REF_COMPONENT_UTF8_BYTES };
const identity = object({ intervalId: evidenceRefPart, pageId: text, ownerId: text, sequence: { ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 }, eventId: evidenceRefPart }, ["intervalId", "pageId", "ownerId", "sequence", "eventId"]);
const readPoint: Schema = object({
  interval: object({ id: text, ordinal: { ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 } }, ["id", "ordinal"]),
  committedEvidenceBoundary: { oneOf: [{ type: "null" }, identity] },
  retainedRange: { oneOf: [{ type: "null" }, object({ first: identity, last: identity }, ["first", "last"])] }
}, ["interval", "committedEvidenceBoundary", "retainedRange"]);
const scalar = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };
const typedDocument: Schema = object({ command: { oneOf: [{ type: "string" }, { type: "null" }] }, key: { oneOf: [{ type: "string" }, { type: "null" }] }, isSnapshot: { type: "boolean" }, fields: { type: "object", additionalProperties: true } }, ["command", "key", "isSnapshot", "fields"]);
const documentInput: Schema = { oneOf: [{ type: "string", maxLength: 64 * 1024 }, typedDocument] };
const criterion = object({ facet: text, polarity: { type: "string", enum: ["include", "exclude"] }, type: text, value: scalar, label: { type: "string", maxLength: 2048 } }, ["facet", "polarity", "type", "value"]);
const around = object({ intervalId: text, start: number(), end: number() }, ["intervalId", "start", "end"]);
const filter = object({ text: { type: "string", maxLength: 2048 }, criteria: { type: "array", maxItems: 100, items: criterion }, around });
const discovery = object({ facet: text, search: { type: "string", maxLength: 2048 }, limit: { ...integer(100), minimum: 1 }, cursor: text }, ["facet"]);
const within = { type: "string", enum: ["page", "current-investigation"] };
const choices: Schema = { type: "array", minItems: 1, maxItems: 100, items: text };
const where = object(Object.fromEntries(["kind", "mode", "key", "operation", "phase", "provenance"].map(facet => [facet, choices])));
const fields: Schema = { type: "array", minItems: 1, maxItems: 32, items: text };
const maxBytes: Schema = { type: "integer", minimum: 4096, maximum: AGENT_READ_CONTRACT.maxBytes };
const workBudget = object({
  maxProjectionReads: { ...integer(1_000_000), minimum: 1 },
  maxPayloadHydrations: { ...integer(1_000_000), minimum: 1 },
  deadlineMs: { ...integer(30_000), minimum: 1 }
});
const sequenceWindow = object({ after: integer(Number.MAX_SAFE_INTEGER), through: integer(Number.MAX_SAFE_INTEGER) }, ["after"]);
const fieldName: Schema = { type: "string", minLength: 1, maxLength: 256 };
const fieldPredicate: Schema = { oneOf: [
  object({ field: fieldName, op: { type: "string", enum: ["eq"] }, value: scalar }, ["field", "op", "value"]),
  object({ field: fieldName, op: { type: "string", enum: ["in"] }, values: { type: "array", minItems: 1, maxItems: 32, items: scalar } }, ["field", "op", "values"]),
  object({ field: fieldName, op: { type: "string", enum: ["exists"] }, present: { type: "boolean" } }, ["field", "op"]),
  object({ field: fieldName, op: { type: "string", enum: ["value-state"] }, state: { type: "string", enum: ["concrete", "ambiguous-null", "unavailable", "redacted", "unresolved-wire-difference"] } }, ["field", "op", "state"]),
  object({ field: fieldName, op: { type: "string", enum: ["changed"] }, changed: { type: "boolean" } }, ["field", "op"]),
  object({ field: fieldName, op: { type: "string", enum: ["range"] }, type: { type: "string", enum: ["number"] }, convert: { type: "string", enum: ["number-string"] }, min: { type: "number" }, max: { type: "number" } }, ["field", "op", "type"]),
  object({ field: fieldName, op: { type: "string", enum: ["range"] }, type: { type: "string", enum: ["string"] }, min: { type: "string" }, max: { type: "string" } }, ["field", "op", "type"])
] };
const fieldPredicates: Schema = { type: "array", maxItems: 32, items: fieldPredicate };
const aggregate = object({ unit: { type: "string", enum: ["evidence-records", "distinct-logical-updates"] },
  groupBy: { type: "array", minItems: 1, maxItems: 4, items: fieldName }, timeBucketMs: { ...integer(86400000), minimum: 1 }, maxGroups: { ...integer(100), minimum: 1 } }, ["unit"]);
const querySchema = {
  scopeId: text, within, text: { type: "string", maxLength: 2048 }, filter, where, fields, maxBytes, workBudget, sequenceWindow, fieldPredicates,
  limit: { ...integer(100), minimum: 1 }, cursor: text, includePayload: { type: "boolean" },
  order: { type: "string", enum: ["NEWEST_FIRST", "OLDEST_FIRST"] }, at: { oneOf: [{ type: "string", enum: ["LATEST_COMMITTED"] }, readPoint] },
  discover: { type: "array", maxItems: 10, items: discovery }
};
const streamSchema = Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["cursor", "discover", "includePayload", "within", "where", "fields", "maxBytes"].includes(key)));
const summarySchema = Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["discover", "includePayload", "fields", "order"].includes(key)));
const stepSource = { scopeId: text, evidence: identity, document: documentInput, delayMs: integer(3600000) };
const assertionItem = object({ name: { oneOf: [{ type: "string", minLength: 1, maxLength: 2048 }, { type: "null" }] }, position: { oneOf: [{ ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 }, { type: "null" }] } }, ["name", "position"]);
const assertionId: Schema = { type: "string", minLength: 1, maxLength: SCENARIO_MAX_MEMBER_ID_LENGTH };
const assertion = { type: "object", oneOf: [
  object({ id: assertionId, kind: { type: "string", enum: ["prior-injection-outcome"] }, stepId: memberId, expectedDisposition: { type: "string", enum: ["delivered"] } }, ["id", "kind", "stepId", "expectedDisposition"]),
  object({ id: assertionId, kind: { type: "string", enum: ["listener-count"] }, stepId: memberId, count: { type: "string", enum: ["attempted", "delivered"] }, expected: integer(Number.MAX_SAFE_INTEGER) }, ["id", "kind", "stepId", "count", "expected"]),
  object({ id: assertionId, kind: { type: "string", enum: ["correlated-local-evidence-exists"] }, stepId: { type: "string", minLength: 1, maxLength: 256 }, withinActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "stepId"]),
  object({ id: assertionId, kind: { type: "string", enum: ["local-evidence-field-equals"] }, stepId: memberId, field: fieldName, expected: scalar, withinActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "stepId", "field", "expected"]),
  object({ id: assertionId, kind: { type: "string", enum: ["server-item-update-absent"] }, item: assertionItem, duringActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "item", "duringActiveMs"]),
  object({ id: assertionId, kind: { type: "string", enum: ["command-key-exists"] }, item: assertionItem, key: { type: "string", minLength: 1, maxLength: 2048 }, expected: { type: "string", enum: ["present", "absent"] }, withinActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "item", "key", "expected"]),
  object({ id: assertionId, kind: { type: "string", enum: ["command-field-equals"] }, item: assertionItem, key: { type: "string", minLength: 1, maxLength: 2048 }, field: { type: "string", minLength: 1, maxLength: 2048 }, expected: scalar, withinActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "item", "key", "field", "expected"]),
  object({ id: assertionId, kind: { type: "string", enum: ["diagnostic-observation-exists"] }, contractVersion: { type: "integer", enum: [1] }, ruleCode: { type: "string", minLength: 1, maxLength: DIAGNOSTIC_RULE_CODE_MAX_LENGTH, pattern: "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$" }, lifecycle: { type: "string", enum: ["occurrence", "condition"] }, minimumSeverity: { type: "string", enum: ["information", "warning", "error"] }, affected: { type: "object", oneOf: [
    object({ kind: { type: "string", enum: ["unavailable"] }, reason: { type: "string", enum: ["page-identity-unavailable"] } }, ["kind", "reason"]),
    object({ kind: { type: "string", enum: ["page"] }, pageId: text }, ["kind", "pageId"]),
    object({ kind: { type: "string", enum: ["client"] }, pageId: text, clientId: text }, ["kind", "pageId", "clientId"]),
    object({ kind: { type: "string", enum: ["session"] }, pageId: text, clientId: text, sessionId: text }, ["kind", "pageId", "clientId", "sessionId"]),
    object({ kind: { type: "string", enum: ["subscription"] }, pageId: text, clientId: text, sessionId: text, subscriptionId: text }, ["kind", "pageId", "clientId", "subscriptionId"]),
    object({ kind: { type: "string", enum: ["item"] }, pageId: text, clientId: text, subscriptionId: text, item: text }, ["kind", "pageId", "clientId", "subscriptionId", "item"]),
    object({ kind: { type: "string", enum: ["evidence"] }, intervalId: text, sequence: integer(Number.MAX_SAFE_INTEGER), eventId: text }, ["kind", "intervalId", "sequence", "eventId"])
  ] }, withinActiveMs: { type: "number", minimum: 1, maximum: SCENARIO_MAX_ASSERTION_ACTIVE_MS } }, ["id", "kind", "contractVersion", "ruleCode", "lifecycle", "minimumSeverity", "affected"])
] } as Schema;
const scenarioMember: Schema = { type: "object", oneOf: [
  object({ kind: { type: "string", enum: ["step"] }, id: memberId, ...stepSource }, ["kind", "id"]),
  object({ kind: { type: "string", enum: ["checkpoint"] }, id: memberId, name: { type: "string", minLength: 1, maxLength: SCENARIO_MAX_CHECKPOINT_NAME_LENGTH, pattern: "\\S" }, assertions: { type: "array", minItems: 1, maxItems: SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT, items: assertion } }, ["kind", "id", "name", "assertions"])
] };
const sourceProperties: Record<string, Schema> = { scopeId: text, evidence: identity, document: documentInput };
const source = object(sourceProperties);
const nullableRecord: Schema = { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] };
const previewOmitted = { type: "string", maxLength: 2048 };
const documentPreviewSuccess: Schema = { type: "object", additionalProperties: true, oneOf: [
  { type: "object", additionalProperties: true, required: ["token", "local", "scenario"], properties: { token: text, local: nullableRecord, scenario: nullableRecord, requestId: text } },
  { type: "object", additionalProperties: true, required: ["token", "previewOmitted"], properties: { token: text, kind: { type: "string", enum: ["local", "scenario"] }, consumed: { type: "boolean" }, requestId: text, previewOmitted } }
] };
const recoverDocumentSuccess: Schema = { type: "object", additionalProperties: true, oneOf: [
  { type: "object", additionalProperties: true, required: ["token", "kind", "consumed", "local", "scenario"], properties: { token: text, kind: { type: "string", enum: ["local", "scenario"] }, consumed: { type: "boolean" }, requestId: text, local: nullableRecord, scenario: nullableRecord } },
  { type: "object", additionalProperties: true, required: ["token", "previewOmitted"], properties: { token: text, kind: { type: "string", enum: ["local", "scenario"] }, consumed: { type: "boolean" }, requestId: text, previewOmitted } }
] };
const statusServiceCapacity = object({
  operations: object({ limit: { type: "integer", enum: [256] }, remaining: integer(256), emergencyPauseStop: { type: "integer", enum: [2] } }, ["limit", "remaining", "emergencyPauseStop"]),
  documents: object({ limit: { type: "integer", enum: [128] }, remaining: integer(128), byteLimit: { type: "integer", enum: [8 * 1024 * 1024] }, bytes: integer(8 * 1024 * 1024) }, ["limit", "remaining", "byteLimit", "bytes"]),
  waits: object({ limit: { type: "integer", enum: [4] }, remaining: integer(4) }, ["limit", "remaining"]),
  documentPreparing: { type: "boolean" },
  document: { oneOf: [object({ kind: { type: "string", enum: ["local", "scenario"] }, consumed: { type: "boolean" }, unchanged: { type: "boolean" } }, ["kind", "consumed", "unchanged"]), { type: "null" }] }
}, ["operations", "documents", "waits", "documentPreparing", "document"]);
const commandTarget = { scopeId: text, pageEpoch: text, projection: { type: "string", enum: ["observed-server", "local-effective"] },
  item: object({ name: { oneOf: [text, { type: "null" }] }, position: { oneOf: [{ ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 }, { type: "null" }] } }, ["name", "position"]), fields, maxBytes };
const commandReadTarget = object({ scopeId: text, pageEpoch: text, subscriptionId: text, item: commandTarget.item }, ["scopeId", "pageEpoch", "subscriptionId", "item"]);
const commandKeySuccess: Schema = {
  type: "object", additionalProperties: true,
  required: ["status", "projection", "target", "readPoint", "presence", "fields", "fieldsTotal", "fieldsRequested", "fieldsReturned", "truncated", "history", "limitations"],
  properties: {
    status: { type: "string", enum: ["ok"] }, projection: commandTarget.projection,
    target: object({ ...commandReadTarget.properties, key: text }, [...commandReadTarget.required!, "key"]), readPoint,
    presence: object({ state: { type: "string", enum: ["present", "absent", "inconclusive"] }, basis: { type: "string", enum: ["row", "delete", "clear-snapshot", "limited-history", "no-observed-basis"] }, provenance: nullableRecord }, ["state", "basis", "provenance"]),
    fields: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: true, required: ["name", "state", "certainty", "provenance"], properties: {
      name: text, state: { type: "string", enum: ["concrete", "ambiguous-null", "unavailable", "redacted", "unresolved-wire-difference", "output-budget"] },
      certainty: { type: "string", enum: ["projected", "last-observed", "unavailable"] }, provenance: nullableRecord, value: {}
    } } },
    fieldsTotal: integer(Number.MAX_SAFE_INTEGER), fieldsRequested: integer(32), fieldsReturned: integer(32), truncated: { type: "boolean" },
    history: object({ deletedKeysHasOlder: { type: "boolean" }, lifecycleHasOlder: { type: "boolean" }, diagnosticsHasOlder: { type: "boolean" } }, ["deletedKeysHasOlder", "lifecycleHasOlder", "diagnosticsHasOlder"]),
    limitations: { type: "array", items: { type: "string" } }
  }
};
const bundleResultIdentity = { id: memberId, kind: { type: "string", enum: ["evidence", "summary", "aggregate", "command-key", "command-keys", "command-rows"] } };
const bundleResult: Schema = { oneOf: [
  object({ ...bundleResultIdentity, status: { type: "string", enum: ["OK"] }, result: { type: "object", additionalProperties: true } }, ["id", "kind", "status", "result"]),
  object({ ...bundleResultIdentity, status: { type: "string", enum: ["ERROR", "ALIGNMENT_UNAVAILABLE"] }, error: { type: "object", additionalProperties: true, required: ["code", "message"], properties: { code: text, message: { type: "string" }, automaticRetry: { type: "boolean", const: false } } } }, ["id", "kind", "status", "error"])
] };
const bundleQuery = Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["at", "cursor", "workBudget", "maxBytes", "discover"].includes(key)));
const bundleCommand = Object.fromEntries(Object.entries(commandTarget).filter(([key]) => !["pageEpoch", "maxBytes"].includes(key)));
const bundleOperation: Schema = { oneOf: [
  object({ id: memberId, kind: { type: "string", enum: ["evidence"] }, args: object(bundleQuery) }, ["id", "kind", "args"]),
  object({ id: memberId, kind: { type: "string", enum: ["summary"] }, args: object({ ...Object.fromEntries(Object.entries(bundleQuery).filter(([key]) => !["fields", "includePayload", "order"].includes(key))), facet: { type: "string", enum: FACET_DESCRIPTORS.map(entry => entry.key) } }) }, ["id", "kind", "args"]),
  object({ id: memberId, kind: { type: "string", enum: ["aggregate"] }, args: object({ ...Object.fromEntries(Object.entries(bundleQuery).filter(([key]) => !["fields", "includePayload", "order", "limit"].includes(key))), aggregate }, ["aggregate"]) }, ["id", "kind", "args"]),
  object({ id: memberId, kind: { type: "string", enum: ["command-key"] }, args: object({ ...bundleCommand, key: text }, ["scopeId", "projection", "item", "key"]) }, ["id", "kind", "args"]),
  object({ id: memberId, kind: { type: "string", enum: ["command-keys"] }, args: object({ ...bundleCommand, keys: { type: "array", minItems: 1, maxItems: 32, items: text } }, ["scopeId", "projection", "item", "keys"]) }, ["id", "kind", "args"]),
  object({ id: memberId, kind: { type: "string", enum: ["command-rows"] }, args: object({ ...bundleCommand, limit: { ...integer(100), minimum: 1 } }, ["scopeId", "projection", "item"]) }, ["id", "kind", "args"])
] };
const rawInputSchemas = new Map<string, Schema>();
export const AGENT_TOOLS = [
  tool("list_panel_sessions", "List exact inspected Panel Sessions. Page with offset/limit; restart if connections change.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("get_pairing_requests", "List authenticated pairing comparisons. The user must compare and approve in Workbench before confirmation.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("confirm_pairing", "Confirm the exact comparison code after human approval in Workbench; then select a Panel Session.", { requestId: text, code: { type: "string", minLength: 9, maxLength: 9 } }, ["requestId", "code"], true),
  tool("get_status", "Read capability, Capture, Coverage, retention, read budgets and remaining service capacity.", {}),
  tool("list_scope", "Page structural clients, Sessions, Subscriptions and items; continue with nextOffset.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("search_scope", "Search all structural Scopes without UI effects. Continue with only panelSessionId/cursor.", { text, kind: { type: "string", enum: ["page", "client", "session", "subscription", "item", "listener"] }, parentScopeId: text, limit: { ...integer(100), minimum: 1 }, cursor: text, maxBytes }),
  tool("get_scope", "Read source/mode, item and declared fields via readContext, independently of injection. Page with schema.nextOffset as fieldOffset. Authoring capabilities/recovery are separate.", { scopeId: text, fieldOffset: integer(Number.MAX_SAFE_INTEGER), fieldLimit: { ...integer(32), minimum: 1 }, maxBytes }, ["scopeId"]),
  tool("read_bundle", "Run 1–8 fixed read-only queries at one Evidence boundary. COMMAND reads require alignment; each error is explicit.", { pageEpoch: text, at: querySchema.at, operations: { type: "array", minItems: 1, maxItems: 8, items: bundleOperation }, workBudget, maxBytes }, ["pageEpoch", "operations"]),
  tool("generate_agent_candidates", "Expand a deterministic single-target matrix and validate the ordered plan. Publishes no document or Injection.", {
    pageEpoch: text, base: source, key: text, keys: { type: "array", minItems: 1, maxItems: 32, items: text },
    commands: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", enum: ["ADD", "UPDATE", "DELETE"] } },
    assignments: { type: "object", additionalProperties: { type: "array", minItems: 1, maxItems: 32, items: {} } },
    delaysMs: { type: "array", minItems: 1, maxItems: 100, items: integer(3600000) }, maxBytes
  }, ["pageEpoch", "base"]),
  tool("query_command_state", "Read an exact derived COMMAND key at its applied Evidence boundary. Limited history can make presence inconclusive.", {
    scopeId: text, pageEpoch: text, projection: { type: "string", enum: ["observed-server", "local-effective"] },
    item: object({ name: { oneOf: [text, { type: "null" }] }, position: { oneOf: [{ ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 }, { type: "null" }] } }, ["name", "position"]),
    key: text, fields, maxBytes
  }, ["scopeId", "pageEpoch", "projection", "item", "key"]),
  tool("query_command_rows", "Page active COMMAND rows; continue with only panelSessionId/cursor. Revision drift requires a new read.", { ...commandTarget, limit: { ...integer(100), minimum: 1 }, cursor: text }),
  tool("query_command_keys", "Compare up to 32 exact COMMAND keys at one boundary with field certainty. Unknown keys do not prove absence.", { ...commandTarget, keys: { type: "array", minItems: 1, maxItems: 32, items: text } }, ["scopeId", "pageEpoch", "projection", "item", "keys"]),
  tool("query_evidence", "Read scoped Evidence. where filters facets; fieldPredicates AND declared fields (no JSON paths). Select fields/payload; continue with only panelSessionId/cursor.", querySchema),
  tool("search_evidence", "Search scoped Evidence text. Excerpts use returned fields; NO_SHAREABLE_EXCERPT.reason explains omissions, not redaction or identity. Continue with only panelSessionId/cursor.", { text, within, scopeId: text, where, fields, maxBytes, workBudget, sequenceWindow, at: querySchema.at, limit: { ...integer(100), minimum: 1 }, cursor: text, includePayload: { type: "boolean" } }),
  tool("summarize_evidence", "Count retained matching Evidence and optional facet values. Historical keys are not active COMMAND rows.", { ...summarySchema, facet: { type: "string", enum: FACET_DESCRIPTORS.map(entry => entry.key) } }),
  tool("aggregate_evidence", "Aggregate declared fields/time buckets with explicit Evidence or logical-update units and reported omissions/uncertainty.", {
    ...Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["fields", "includePayload", "cursor", "limit", "discover", "order"].includes(key))), aggregate
  }, ["aggregate"]),
  tool("describe_stream", "Profile sampled types/JSON shapes; names: get_scope.readContext. Check omissions. Budget errors give measured maxBytes. scopeIdentity is not scopeId.", { ...streamSchema, limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("wait_for_evidence", "Wait ≤20 seconds for committed Evidence after a read point. Coverage and boundary limit absence/app conclusions.", { after: readPoint, pageEpoch: text, timeoutMs: integer(20000), scopeId: text, text: querySchema.text, filter, limit: querySchema.limit, includePayload: { type: "boolean" }, maxBytes, workBudget }, ["after", "pageEpoch"]),
  tool("get_evidence", "Read one retained identity; prefer selected fields. Full payload is opt-in. Budget errors give measured maxBytes. Client Message bodies and credentials remain redacted.", { evidence: identity, fields, includePayload: { type: "boolean" }, maxBytes }, ["evidence"]),
  tool("query_diagnostics", "Read normalized Diagnostic Observations; continue with nextAfter. Limited coverage cannot prove absence.", { after: object({ intervalId: text, sequence: integer(Number.MAX_SAFE_INTEGER) }, ["intervalId", "sequence"]), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("update_agent_document", "Edit the unchanged agent Draft/Step using typed/JSON input and current token; returns a rotated token.", { token: text, document: documentInput, stepId: memberId, requestId: text, maxBytes }, ["token", "document"], true),
  tool("prepare_local_injection", "Prepare a visible Draft from exact Evidence or live supported item Scope. Omit document to copy the source's complete editable template first. Returned documentContract describes required fields and expanded JSON. Does not inject.", { ...sourceProperties, pageEpoch: text, requestId: text, maxBytes }, ["pageEpoch"], true),
  tool("prepare_server_injection", "Prepare an exact Client/Session message for visible human review. Local access does not approve sending.", { pageEpoch: text, clientId: text, sessionId: text, message: { type: "string", minLength: 1, maxLength: 64 * 1024 }, sequence: text, delayTimeout: { oneOf: [{ type: "null" }, integer(Number.MAX_SAFE_INTEGER)] }, enqueueWhileDisconnected: { type: "boolean" }, requestId: text, maxBytes }, ["pageEpoch", "clientId", "sessionId", "message", "sequence", "delayTimeout", "enqueueWhileDisconnected", "requestId"], true),
  tool("execute_server_injection", "Send once only after a human approves this exact Client/Session/message/options in Workbench. Same requestId returns its receipt; no resend.", { token: text, requestId: text }, ["token", "requestId"], true),
  tool("recover_server_injection", "Read the exact agent Server Injection preparation or send receipt by requestId; without it, read the current agent-owned document. Never sends.", { requestId: text, maxBytes }),
  tool("abort_server_injection", "Discard the unchanged unexecuted agent Server Injection by its current token. Cannot send or approve.", { token: text }, ["token"], true),
  tool("execute_local_injection", "Execute a reviewed Local Injection once. Inspect the same requestId after uncertainty; never retry delivery with a new id.", { token: text, requestId: text }, ["token", "requestId"], true),
  tool("get_operation", "Read an existing Local/Server Injection outcome or Scenario control receipt without repeating it. Use wait_for_scenario for Run progress.", { requestId: text, maxBytes }, ["requestId"]),
  tool("wait_for_operation", "Wait ≤20 seconds for a Local/control receipt, not Run completion. Read Server receipts with get_operation; never repeat effects.", { requestId: text, timeoutMs: integer(20000), maxBytes }, ["requestId"]),
  tool("wait_for_scenario", "Wait for an exact Run/revision change or terminal state. Cancellation/revocation ends the wait; timeout proves no progress.", { runId: text, pageEpoch: text, afterRevision: integer(Number.MAX_SAFE_INTEGER), timeoutMs: integer(20000), maxBytes }, ["runId", "pageEpoch"]),
  tool("validate_agent_candidate", "Validate a Draft or ordered plan without publication. Compact results preserve whole-plan verdict/reason/counts.", { pageEpoch: text, draft: source, members: { type: "array", minItems: 1, maxItems: 200, items: scenarioMember }, replace: object({ scenarioId: text, revision: integer(Number.MAX_SAFE_INTEGER) }, ["scenarioId", "revision"]), maxBytes }, ["pageEpoch"]),
  tool("prepare_scenario", "Prepare one ordered target with explicit Steps/Checkpoints for review. Human Drafts remain protected.", { pageEpoch: text, members: { type: "array", minItems: 1, maxItems: 200, items: scenarioMember }, steps: { type: "array", minItems: 1, maxItems: 100, items: object({ ...sourceProperties, delayMs: integer(3600000) }) }, replace: object({ scenarioId: text, revision: integer(Number.MAX_SAFE_INTEGER) }, ["scenarioId", "revision"]), requestId: text, maxBytes }, ["pageEpoch"], true),
  tool("recover_agent_document", "Recover the current agent Draft/Scenario or exact requestId receipt after a lost reply. Use maxBytes for an omitted editable preview. Does not inject.", { requestId: text, maxBytes }),
  tool("abort_agent_document", "Discard only the unchanged unexecuted agent document with its current token; human content remains protected.", { token: text }, ["token"], true),
  tool("control_scenario", "Control an exact reviewed Run; step/play may deliver. Hidden panels pause; use requestId receipts and inspect Run progress.", { runId: text, requestId: text, action: { type: "string", enum: ["step", "play", "pause", "stop", "re-review"] } }, ["runId", "requestId", "action"], true),
  tool("get_scenario_trace", "Page Scenario members and immutable Run trace. This does not assert application or server state.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("finish_agent_document", "Finish only the unchanged completed agent document; human edits and unfinished operations remain protected.", { token: text }, ["token"], true)
] as const;

function missingAgentResultSchema(name: string): never {
  throw new Error(`Tool ${name} requires an explicit agent success contract.`);
}
function tool(name: string, description: string, properties: Record<string, Schema>, required: string[] = [], mutation = false) {
  const global = ["list_panel_sessions", "get_pairing_requests", "confirm_pairing"].includes(name);
  const successSchema = preciseAgentSuccess(name, identity, readPoint, assertion) ?? (name === "get_status" ? { type: "object", additionalProperties: true, required: ["protocolVersion", "panelSessionId", "permission", "capabilities", "readContract", "responseContract", "pageEpoch", "visible", "capture", "history", "serviceCapacity"], properties: { protocolVersion: { const: AGENT_PROTOCOL_VERSION }, panelSessionId: text, permission: { enum: ["read", "local"] }, capabilities: { type: "array", items: text }, readContract: { type: "object", required: ["version", "defaultMaxBytes", "maxBytes"] }, responseContract: { type: "object", required: ["defaultMaxBytes", "maxBytes"] }, pageEpoch: { oneOf: [text, { type: "null" }] }, visible: { type: "boolean" }, capture: { type: "object", required: ["operation", "coverage"] }, history: { type: "object", required: ["phase", "retained"] }, serviceCapacity: statusServiceCapacity } }
  : name === "abort_server_injection" ? object({ aborted: { type: "boolean", enum: [true] } }, ["aborted"])
  : name === "prepare_local_injection" || name === "prepare_scenario" || name === "update_agent_document" ? documentPreviewSuccess
  : name === "recover_agent_document" ? recoverDocumentSuccess
  : name === "abort_agent_document" ? object({ aborted: { type: "boolean", enum: [true] } }, ["aborted"])
  : name === "query_command_state" ? commandKeySuccess
  : name === "query_command_rows" ? {
    type: "object", additionalProperties: true, required: ["status", "revision", "total", "projection", "target", "readPoint", "rows", "nextCursor"], properties: {
      status: { type: "string", enum: ["ok"] }, revision: integer(Number.MAX_SAFE_INTEGER), total: integer(Number.MAX_SAFE_INTEGER),
      projection: commandTarget.projection, target: commandReadTarget, readPoint,
      rows: { type: "array", maxItems: 100, items: commandKeySuccess }, nextCursor: { oneOf: [text, { type: "null" }] }
    }
  } : name === "query_command_keys" ? {
    type: "object", additionalProperties: true, required: ["status", "projection", "readPoint", "rows", "limitations"], properties: {
      status: { type: "string", enum: ["ok"] }, projection: commandTarget.projection, readPoint,
      rows: { type: "array", minItems: 1, maxItems: 32, items: commandKeySuccess }, limitations: { type: "array", items: { type: "string" } }
    }
  } : name === "read_bundle" ? {
    type: "object", additionalProperties: true, required: ["status", "readPoint", "pageEpoch", "results", "work", "limitations"], properties: {
      status: { type: "string", enum: ["COMPLETE", "LIMITED"] }, readPoint, pageEpoch: text,
      results: { type: "array", minItems: 1, maxItems: 8, items: bundleResult }, work: object({ maxReads: { ...integer(8), minimum: 1 }, perRead: workBudget }, ["maxReads", "perRead"]),
      limitations: { type: "array", items: { type: "string" } }
    }
  }
  : name === "query_evidence" ? {
    type: "object", additionalProperties: true, required: ["readPoint", "totals", "coverage", "evaluation", "storage", "discoveries", "nextCursor", "evidence", "omissions"], properties: {
      readPoint, totals: { type: "object", additionalProperties: true, required: ["matching", "inScope"] }, coverage: { type: "string", enum: ["COMPLETE", "LIMITED"] },
      evaluation: { type: "string", enum: ["COMPLETE", "UNSUPPORTED_FILTER"] }, storage: { type: "string", enum: ["INDEXED_DB", "MEMORY_FALLBACK"] }, discoveries: { type: "object", additionalProperties: true },
      nextCursor: { oneOf: [{ type: "null" }, { type: "string", maxLength: 8192 }] }, evidence: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, omissions: { type: "array", maxItems: 100, items: text }
    }
  } : name === "aggregate_evidence" ? {
    type: "object", additionalProperties: true, required: ["readPoint", "totals", "coverage", "evaluation", "storage", "fieldEvaluation", "aggregate", "limitations"], properties: {
      readPoint, totals: { type: "object", required: ["matching", "inScope"], additionalProperties: true }, coverage: { type: "string", enum: ["COMPLETE", "LIMITED"] },
      evaluation: { type: "string", enum: ["COMPLETE"] }, storage: { type: "string", enum: ["INDEXED_DB", "MEMORY_FALLBACK"] },
      fieldEvaluation: object({ numericConversionFailures: integer(Number.MAX_SAFE_INTEGER), unavailableFields: integer(Number.MAX_SAFE_INTEGER) }, ["numericConversionFailures", "unavailableFields"]),
      aggregate: object({ unit: { type: "string", enum: ["evidence-records", "distinct-logical-updates"] }, count: integer(Number.MAX_SAFE_INTEGER), matchingEvidenceRecords: integer(Number.MAX_SAFE_INTEGER), missingLogicalIds: integer(Number.MAX_SAFE_INTEGER),
        groups: { type: "array", maxItems: 100, items: { type: "object", required: ["values", "count"], additionalProperties: true } }, omittedGroups: integer(Number.MAX_SAFE_INTEGER), omittedGroupRecords: integer(Number.MAX_SAFE_INTEGER)
      }, ["unit", "count", "matchingEvidenceRecords", "missingLogicalIds", "groups", "omittedGroups", "omittedGroupRecords"]),
      limitations: { type: "array", items: { type: "string" }, maxItems: 10 }
    }
  } : name === "generate_agent_candidates" ? {
    type: "object", required: ["version", "target", "members", "validation", "limitations"], additionalProperties: true, properties: {
      version: { type: "integer", enum: [1] }, target: { type: "object", additionalProperties: true },
      members: { type: "array", minItems: 1, maxItems: 100, items: object({ kind: { type: "string", enum: ["step"] }, id: memberId, ...stepSource }, ["kind", "id", "document", "delayMs"]) },
      validation: { type: "object", required: ["valid", "pageEpoch", "target", "limitations"], additionalProperties: true }, limitations: { type: "array", maxItems: 10, items: { type: "string" } }
    }
  } : name === "summarize_evidence" ? {
    type: "object", additionalProperties: true, required: ["readPoint", "totals", "coverage", "evaluation", "storage", "countMeaning", "values", "distinctTotal", "nextCursor"], properties: {
      readPoint, totals: { type: "object", additionalProperties: true, required: ["matching", "inScope"] },
      coverage: { type: "string", enum: ["COMPLETE", "LIMITED"] }, evaluation: { type: "string", enum: ["COMPLETE", "UNSUPPORTED_FILTER"] },
      storage: { type: "string", enum: ["INDEXED_DB", "MEMORY_FALLBACK"] }, countMeaning: text,
      facet: { type: "string", enum: FACET_DESCRIPTORS.map(entry => entry.key) },
      values: { type: "array", maxItems: 100, items: object({ value: object({ facet: text, type: text, value: scalar, label: { type: "string" } }, ["facet", "type", "value", "label"]), count: integer(Number.MAX_SAFE_INTEGER) }, ["value", "count"]) },
      distinctTotal: { oneOf: [{ type: "null" }, integer(Number.MAX_SAFE_INTEGER)] },
      nextCursor: { oneOf: [{ type: "null" }, text] }
    }
  } : name === "describe_stream" ? {
    type: "object", additionalProperties: true, required: ["readPoint", "matchingTotal", "sampled", "completeness", "nextCursor", "omissions"], properties: {
      readPoint, matchingTotal: integer(Number.MAX_SAFE_INTEGER), sampled: integer(100), completeness: { type: "string", enum: ["COMPLETE", "LIMITED"] },
      nextCursor: { oneOf: [{ type: "null" }, { type: "string", maxLength: 8192 }] }, omissions: { type: "array", maxItems: 100, items: text }
    }
  } : name === "wait_for_evidence" ? {
    type: "object", additionalProperties: true, required: ["status", "reason", "after", "readPoint", "evidence", "mayHaveMoreMatches"], properties: {
      status: { type: "string", enum: ["MATCHED", "TIMED_OUT", "CANCELLED", "HISTORY_CHANGED", "HISTORY_INCOMPLETE", "HISTORY_UNAVAILABLE", "TARGET_CHANGED", "QUERY_FAILED"] },
      reason: { type: "string" }, after: readPoint, readPoint: { oneOf: [{ type: "null" }, readPoint] },
      evidence: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, mayHaveMoreMatches: { type: "boolean" }
    }
  } : name === "wait_for_scenario" ? {
    type: "object", additionalProperties: true, required: ["status", "runId", "pageEpoch", "revision", "scenario", "reason"], properties: {
      status: { type: "string", enum: ["CHANGED", "TERMINAL", "TIMED_OUT", "UNAVAILABLE"] }, runId: text, pageEpoch: text,
      revision: integer(Number.MAX_SAFE_INTEGER), scenario: nullableRecord, reason: { type: "string", maxLength: 2048 }
    }
  } : missingAgentResultSchema(name));
  // SDK clients also validate structuredContent when isError is true. Keep the
  // machine-readable failure envelope valid for every declared output schema.
  const failureSchema: Schema = { type: "object", required: ["error"], properties: { error: {
    type: "object", required: ["code", "message", "automaticRetry"], properties: {
      code: { type: "string" }, message: { type: "string" }, automaticRetry: { type: "boolean", const: false }
    }
  } } };
  const outputSchema = { type: "object", anyOf: [successSchema, failureSchema] };
  const destructive = ["execute_local_injection", "execute_server_injection", "control_scenario", "finish_agent_document", "abort_agent_document", "abort_server_injection"].includes(name);
  const openWorld = ["execute_local_injection", "execute_server_injection", "control_scenario"].includes(name);
  const inputSchema = object(global ? properties : { panelSessionId: text, ...properties }, global ? required : ["panelSessionId", ...required]);
  rawInputSchemas.set(name, inputSchema);
  return { name, description, inputSchema: compactAgentSchema(inputSchema), outputSchema: compactAgentSchema(outputSchema), annotations: { readOnlyHint: !mutation, destructiveHint: destructive, idempotentHint: !["execute_local_injection", "execute_server_injection", "control_scenario"].includes(name), openWorldHint: openWorld }, mutation };
}
export function validateAgentCall(name: string, args: unknown): asserts args is AgentArguments {
  const definition = AGENT_TOOLS.find(tool => tool.name === name);
  if (!definition) throw new Error("Unknown Workbench tool.");
  validate(rawInputSchemas.get(name)!, args, "arguments");
  const input = args as AgentArguments;
  if (["validate_agent_candidate", "prepare_scenario"].includes(name) && Array.isArray(input.members)) {
    const earlierStepIds: string[] = [];
    for (const member of input.members as Array<Record<string, unknown>>) {
      if (member.kind === "step") { earlierStepIds.push(String(member.id)); continue; }
      const checked = validateScenarioCheckpoint(member as unknown as Parameters<typeof validateScenarioCheckpoint>[0], { targetMode: "COMMAND", deliveryPath: "listener", earlierStepIds: [...earlierStepIds, ...(member.assertions as Array<{ stepId?: string }>).flatMap(assertion => assertion.stepId === undefined ? [] : [assertion.stepId])] });
      if (!checked.ok) throw new Error(`INVALID_ARGUMENT: ${checked.reason}`);
    }
  }
  if (name === "read_bundle") {
    const operations = input.operations as { id: string }[];
    if (new Set(operations.map(operation => operation.id)).size !== operations.length) throw new Error("INVALID_ARGUMENT: Read bundle operation identities must be unique.");
  }
  if (name === "generate_agent_candidates" && input.key !== undefined && input.keys !== undefined) throw new Error("INVALID_ARGUMENT: Choose key or keys for candidate generation.");
  if (["query_evidence", "search_evidence", "summarize_evidence", "aggregate_evidence"].includes(name) && input.cursor === undefined) {
    if (input.scopeId === undefined && input.within === undefined) throw new Error("SCOPE_REQUIRED: supply an exact scopeId, within:page, or within:current-investigation. Find scopeIds with search_scope.");
    if (input.scopeId !== undefined && input.within === "current-investigation") throw new Error("INVALID_ARGUMENT: current-investigation already defines Scope; omit scopeId or start a scoped query.");
  }
  if (input.fields !== undefined && input.includePayload === true) throw new Error("INVALID_ARGUMENT: choose fields or includePayload:true, not both.");
  if (["query_command_state", "query_command_keys", "query_command_rows"].includes(name) && input.cursor === undefined) {
    for (const key of ["scopeId", "pageEpoch", "projection", "item"]) if (input[key] === undefined) throw new Error(`INVALID_ARGUMENT: ${key} is required for an exact COMMAND read.`);
    const item = input.item as { name: string | null; position: number | null };
    if (item.name === null && item.position === null) throw new Error("INVALID_ARGUMENT: provide an exact item name or position.");
  }
  if (name === "query_command_rows" && input.cursor && Object.keys(input).some(key => !["panelSessionId", "cursor"].includes(key))) throw new Error("QUERY_OPTIONS_CHANGED: Continue a COMMAND row read with only its cursor.");
  if (name === "query_command_keys" && new Set(input.keys as string[]).size !== (input.keys as string[]).length) throw new Error("INVALID_ARGUMENT: COMMAND keys must be unique.");
  if (Array.isArray(input.fields) && new Set(input.fields).size !== input.fields.length) throw new Error("INVALID_ARGUMENT: fields must contain unique exact field names.");
  if (input.where && ((input.filter as { criteria?: unknown[] } | undefined)?.criteria?.length ?? 0) > 0) throw new Error("INVALID_ARGUMENT: choose where or filter.criteria, not both.");
  if (input.within === "current-investigation" && (input.where !== undefined || input.filter !== undefined || (name !== "search_evidence" && input.text !== undefined))) {
    throw new Error("INVALID_ARGUMENT: current-investigation preserves the human Filter. Use an exact scopeId or within:page to supply different filters; search_evidence text searches inside the preserved Filter.");
  }
  if (name === "search_scope" || name === "search_evidence") {
    if (input.cursor !== undefined) {
      if (Object.keys(input).some(key => key !== "panelSessionId" && key !== "cursor")) throw new Error("QUERY_OPTIONS_CHANGED: continue with only panelSessionId and cursor; start a new search without cursor to change options.");
    } else if (typeof input.text !== "string" || input.text.trim().length === 0) {
      throw new Error("Search text must contain at least one non-whitespace character.");
    }
  }
  if (name === "validate_agent_candidate" && (Object.prototype.hasOwnProperty.call(args as object, "draft") === Object.prototype.hasOwnProperty.call(args as object, "members"))) throw new Error("arguments: provide exactly one of draft or members.");
  if (name === "prepare_scenario" && (Object.prototype.hasOwnProperty.call(args as object, "steps") === Object.prototype.hasOwnProperty.call(args as object, "members"))) throw new Error("arguments: provide exactly one of members or legacy steps.");
  if (name === "prepare_server_injection" && typeof input.message === "string" && new TextEncoder().encode(input.message).byteLength > 64 * 1024) throw new Error("DOCUMENT_BUDGET_EXCEEDED: A Client Message body may contain at most 64 KiB.");
  for (const candidate of collectDocumentInputs(name, input)) {
    if (typeof candidate === "string" && new TextEncoder().encode(candidate).byteLength > 64 * 1024) throw new Error("DOCUMENT_BUDGET_EXCEEDED: A document may contain at most 64 KiB.");
    if (candidate !== undefined && typeof candidate !== "string" && new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 64 * 1024) throw new Error("DOCUMENT_BUDGET_EXCEEDED: A document may contain at most 64 KiB.");
  }
  if (["query_evidence", "search_evidence", "summarize_evidence", "describe_stream", "aggregate_evidence"].includes(name)) validateQueryCrossFields(args as AgentArguments);
  if (name === "wait_for_evidence") validateQueryCrossFields({ ...args as AgentArguments, at: (args as AgentArguments).after });
  if (new TextEncoder().encode(JSON.stringify(args)).byteLength > AGENT_MAX_BYTES) throw new Error("Request exceeds the 512 KiB limit.");
}
function collectDocumentInputs(name: string, input: AgentArguments): unknown[] {
  if (name === "prepare_local_injection" || name === "update_agent_document") return [input.document];
  if (name === "validate_agent_candidate" && input.draft) return [(input.draft as AgentArguments).document];
  if (name === "generate_agent_candidates" && input.base) return [(input.base as AgentArguments).document];
  if (name === "prepare_scenario" || name === "validate_agent_candidate") {
    const members = Array.isArray(input.members) ? input.members as AgentArguments[] : [];
    const steps = Array.isArray(input.steps) ? input.steps as AgentArguments[] : [];
    return [...members, ...steps].filter(member => member.kind !== "checkpoint").map(member => member.document);
  }
  return [];
}

/** Derive urgent admission from the validated operation, never a caller flag. */
export function isReservedAgentCall(name: string, args: unknown): boolean {
  if (["get_status", "get_operation", "recover_agent_document", "recover_server_injection"].includes(name)) return true;
  if (name !== "control_scenario" || !args || typeof args !== "object") return false;
  const action = (args as AgentArguments).action;
  return action === "pause" || action === "stop";
}

/** Classify a lost reply by what the operation could have changed. */
export function agentTimeoutCode(name: string, args: unknown): "DELIVERY_UNKNOWN" | "DOCUMENT_PUBLICATION_UNKNOWN" | "CONTROL_OUTCOME_UNKNOWN" | "QUERY_FAILED" {
  if (name === "execute_local_injection" || name === "execute_server_injection") return "DELIVERY_UNKNOWN";
  if (name === "control_scenario" && args && typeof args === "object" && ["step", "play", "re-review"].includes(String((args as AgentArguments).action))) return "DELIVERY_UNKNOWN";
  if (name === "control_scenario") return "CONTROL_OUTCOME_UNKNOWN";
  if (["prepare_local_injection", "prepare_server_injection", "prepare_scenario", "update_agent_document", "abort_agent_document", "abort_server_injection", "finish_agent_document"].includes(name)) return "DOCUMENT_PUBLICATION_UNKNOWN";
  return "QUERY_FAILED";
}
function validate(schema: Schema, value: unknown, path: string): void {
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) { try { validate(candidate, value, path); matches++; } catch { /* Each variant is a strict independent schema. */ } }
    if (matches !== 1) throw new Error(`${path}: expected exactly one supported shape.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: unsupported value.`);
  if (Object.hasOwn(schema, "const") && schema.const !== value) throw new Error(`${path}: unsupported value.`);
  if (schema.type === "null") { if (value !== null) throw new Error(`${path}: expected null.`); return; }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${path}: expected plain object.`);
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`${path}.${key}: required.`);
    for (const [key, entry] of Object.entries(record)) {
      const child = Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (!child) {
        if (schema.additionalProperties === true) continue;
        if (!schema.additionalProperties || typeof schema.additionalProperties === "boolean") throw new Error(`${path}: unknown property.`);
        validate(schema.additionalProperties, entry, `${path}.${key}`);
      } else validate(child, entry, `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100)) throw new Error(`${path}: invalid array size.`);
    value.forEach((entry, i) => validate(schema.items!, entry, `${path}[${i}]`));
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error(`${path}: invalid string.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value as string)) throw new Error(`${path}: invalid string pattern.`);
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || (value as number) < (schema.minimum ?? 0) || (value as number) > (schema.maximum ?? Infinity)) throw new Error(`${path}: invalid integer.`);
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path}: invalid number.`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path}: expected boolean.`);
}
function validateQueryCrossFields(args: AgentArguments): void {
  if (args.cursor && Object.keys(args).some(key => !["panelSessionId", "cursor"].includes(key))) throw new Error("QUERY_OPTIONS_CHANGED: continue with only panelSessionId and cursor; start a new query without cursor to change options, optionally preserving at.");
  const point = args.at;
  const window = args.sequenceWindow as { after: number; through?: number } | undefined;
  if (window?.through !== undefined && window.through < window.after) throw new Error("INVALID_ARGUMENT: sequenceWindow.through must be at or after its exclusive after boundary.");
  for (const predicate of args.fieldPredicates as { op: string; min?: string | number; max?: string | number }[] ?? []) {
    if (predicate.op === "range" && ((predicate.min === undefined && predicate.max === undefined) || (predicate.min !== undefined && predicate.max !== undefined && predicate.min > predicate.max))) throw new Error("INVALID_ARGUMENT: a field range requires ordered inclusive min/max bounds.");
  }
  if (args.fieldPredicates && Array.isArray(args.discover) && args.discover.length) throw new Error("UNSUPPORTED_CAPABILITY: Field predicates require a separate same-boundary read from facet discovery.");
  if (point && typeof point === "object") {
  const value = point as { interval: { id: string }; committedEvidenceBoundary: { intervalId: string; sequence: number } | null; retainedRange: { first: { intervalId: string; sequence: number }; last: { intervalId: string; sequence: number } } | null };
    const intervalId = value.interval.id;
    if (value.committedEvidenceBoundary && value.committedEvidenceBoundary.intervalId !== intervalId) throw new Error("arguments.at.committedEvidenceBoundary must belong to the read-point interval.");
    if (value.retainedRange && (value.retainedRange.first.intervalId !== intervalId || value.retainedRange.last.intervalId !== intervalId || value.retainedRange.first.sequence > value.retainedRange.last.sequence)) throw new Error("arguments.at.retainedRange is inconsistent with its read-point interval or order.");
    if (value.committedEvidenceBoundary && value.retainedRange && value.committedEvidenceBoundary.sequence < value.retainedRange.last.sequence) throw new Error("arguments.at committed boundary precedes its retained range.");
  }
  const filterValue = args.filter as { text?: string; criteria?: readonly { facet: string; polarity: string; type: string; value: unknown; label?: string }[]; around?: { intervalId: string; start: number; end: number } } | undefined;
  if (filterValue?.around) {
    if (filterValue.around.start >= filterValue.around.end) throw new Error("arguments.filter.around must be a non-empty half-open timestamp range.");
  }
  for (const entry of filterValue?.criteria ?? []) {
    const descriptor = FACET_DESCRIPTORS.find(value => value.key === entry.facet);
    if (!descriptor || descriptor.valueType !== entry.type) throw new Error("arguments.filter.criteria: unsupported facet or value type; use a discovered canonical facet value.");
  }
  const discoveries = args.discover as { facet: string }[] | undefined;
  if (discoveries && (new Set(discoveries.map(value => value.facet)).size !== discoveries.length || discoveries.some(value => !FACET_DESCRIPTORS.some(descriptor => descriptor.key === value.facet)))) throw new Error("arguments.discover: each supported facet may occur only once.");
  if (filterValue?.text !== undefined && args.text !== undefined && filterValue.text !== args.text) throw new Error("arguments.text and arguments.filter.text must match when both are supplied.");
}
