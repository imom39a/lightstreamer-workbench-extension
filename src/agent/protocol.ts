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
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; oneOf?: readonly Schema[]; enum?: readonly unknown[]; minimum?: number; maximum?: number; maxLength?: number; minLength?: number; maxItems?: number; minItems?: number };
const text = { type: "string", minLength: 1, maxLength: 2048 };
const integer = (maximum: number): Schema => ({ type: "integer", minimum: 0, maximum });
const number = (maximum = Number.MAX_SAFE_INTEGER): Schema => ({ type: "number", minimum: 0, maximum });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
const identity = object({ intervalId: text, pageId: text, ownerId: text, sequence: integer(Number.MAX_SAFE_INTEGER), eventId: text }, ["intervalId", "pageId", "ownerId", "sequence", "eventId"]);
const readPoint: Schema = object({
  interval: object({ id: text, ordinal: integer(Number.MAX_SAFE_INTEGER) }, ["id", "ordinal"]),
  committedEvidenceBoundary: { oneOf: [{ type: "null" }, identity] },
  retainedRange: { oneOf: [{ type: "null" }, object({ first: identity, last: identity }, ["first", "last"])] }
}, ["interval", "committedEvidenceBoundary", "retainedRange"]);
const scalar = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };
const criterion = object({ facet: text, polarity: { type: "string", enum: ["include", "exclude"] }, type: text, value: scalar, label: { type: "string", maxLength: 2048 } }, ["facet", "polarity", "type", "value"]);
const around = object({ intervalId: text, start: number(), end: number() }, ["intervalId", "start", "end"]);
const filter = object({ text: { type: "string", maxLength: 2048 }, criteria: { type: "array", maxItems: 100, items: criterion }, around });
const discovery = object({ facet: text, search: { type: "string", maxLength: 2048 }, limit: { ...integer(100), minimum: 1 }, cursor: text }, ["facet"]);
const within = { type: "string", enum: ["page", "current-investigation"] };
const choices: Schema = { type: "array", minItems: 1, maxItems: 100, items: text };
const where = object(Object.fromEntries(["kind", "mode", "key", "operation", "phase", "provenance"].map(facet => [facet, choices])));
const fields: Schema = { type: "array", minItems: 1, maxItems: 32, items: text };
const maxBytes: Schema = { type: "integer", minimum: 4096, maximum: AGENT_READ_CONTRACT.maxBytes };
const querySchema = {
  scopeId: text, within, text: { type: "string", maxLength: 2048 }, filter, where, fields, maxBytes,
  limit: { ...integer(100), minimum: 1 }, cursor: text, includePayload: { type: "boolean" },
  order: { type: "string", enum: ["NEWEST_FIRST", "OLDEST_FIRST"] }, at: { oneOf: [{ type: "string", enum: ["LATEST_COMMITTED"] }, readPoint] },
  discover: { type: "array", maxItems: 10, items: discovery }
};
const streamSchema = Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["cursor", "discover", "includePayload", "within", "where", "fields", "maxBytes"].includes(key)));
const summarySchema = Object.fromEntries(Object.entries(querySchema).filter(([key]) => !["discover", "includePayload", "fields", "order"].includes(key)));
const stepSource = { scopeId: text, evidence: identity, document: { type: "string", maxLength: 64 * 1024 }, delayMs: integer(3600000) };
const assertionItem = object({ name: { oneOf: [{ type: "string", maxLength: 2048 }, { type: "null" }] }, position: { oneOf: [{ ...integer(Number.MAX_SAFE_INTEGER) }, { type: "null" }] } }, ["name", "position"]);
const assertion = { type: "object", oneOf: [
  object({ id: text, kind: { type: "string", enum: ["prior-injection-outcome"] }, stepId: text, expectedDisposition: { type: "string", enum: ["delivered", "blocked", "failed", "partial", "acknowledgement-unknown"] } }, ["id", "kind", "stepId", "expectedDisposition"]),
  object({ id: text, kind: { type: "string", enum: ["listener-count"] }, stepId: text, count: { type: "string", enum: ["attempted", "delivered"] }, expected: integer(Number.MAX_SAFE_INTEGER) }, ["id", "kind", "stepId", "count", "expected"]),
  object({ id: text, kind: { type: "string", enum: ["correlated-local-evidence-exists"] }, stepId: text, withinActiveMs: integer(3600000) }, ["id", "kind", "stepId"]),
  object({ id: text, kind: { type: "string", enum: ["command-key-exists"] }, item: assertionItem, key: { type: "string", maxLength: 2048 }, expected: { type: "string", enum: ["present", "absent"] }, withinActiveMs: integer(3600000) }, ["id", "kind", "item", "key", "expected"]),
  object({ id: text, kind: { type: "string", enum: ["command-field-equals"] }, item: assertionItem, key: { type: "string", maxLength: 2048 }, field: { type: "string", maxLength: 2048 }, expected: scalar, withinActiveMs: integer(3600000) }, ["id", "kind", "item", "key", "field", "expected"]),
  object({ id: text, kind: { type: "string", enum: ["diagnostic-observation-exists"] }, contractVersion: { type: "integer", enum: [1] }, ruleCode: text, lifecycle: { type: "string", enum: ["occurrence", "condition"] }, minimumSeverity: { type: "string", enum: ["information", "warning", "error"] }, affected: { type: "object", oneOf: [
    object({ kind: { type: "string", enum: ["unavailable"] }, reason: { type: "string", enum: ["page-identity-unavailable"] } }, ["kind", "reason"]),
    object({ kind: { type: "string", enum: ["page"] }, pageId: text }, ["kind", "pageId"]),
    object({ kind: { type: "string", enum: ["client"] }, pageId: text, clientId: text }, ["kind", "pageId", "clientId"]),
    object({ kind: { type: "string", enum: ["session"] }, pageId: text, clientId: text, sessionId: text }, ["kind", "pageId", "clientId", "sessionId"]),
    object({ kind: { type: "string", enum: ["subscription"] }, pageId: text, clientId: text, sessionId: text, subscriptionId: text }, ["kind", "pageId", "clientId", "subscriptionId"]),
    object({ kind: { type: "string", enum: ["item"] }, pageId: text, clientId: text, subscriptionId: text, item: text }, ["kind", "pageId", "clientId", "subscriptionId", "item"]),
    object({ kind: { type: "string", enum: ["evidence"] }, intervalId: text, sequence: integer(Number.MAX_SAFE_INTEGER), eventId: text }, ["kind", "intervalId", "sequence", "eventId"])
  ] }, withinActiveMs: integer(3600000) }, ["id", "kind", "contractVersion", "ruleCode", "lifecycle", "minimumSeverity", "affected"])
] } as Schema;
const scenarioMember: Schema = { type: "object", oneOf: [
  object({ kind: { type: "string", enum: ["step"] }, id: text, ...stepSource }, ["kind", "id"]),
  object({ kind: { type: "string", enum: ["checkpoint"] }, id: text, name: { type: "string", minLength: 1, maxLength: 128 }, assertions: { type: "array", maxItems: 16, items: assertion } }, ["kind", "id", "name", "assertions"])
] };
const sourceProperties: Record<string, Schema> = { scopeId: text, evidence: identity, document: { type: "string", maxLength: 64 * 1024 } };
const source = object(sourceProperties);
export const AGENT_TOOLS = [
  tool("list_panel_sessions", "List available Workbench Panel Sessions. Open panels connect automatically by default with inspection and Local Injection access. Choose the exact browser tab; never infer that the first session is the intended target. Supply offset and/or limit for a byte-bounded live page with nextOffset; repeat from offset 0 if connections change while paging.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("get_pairing_requests", "Optional authenticated mode only: list pending connections and short comparison codes. Default authentication-off connections need no pairing; use list_panel_sessions instead. For authenticated requests, show the code and ask the user to compare it in Workbench and click Approve. Returns no inspected-page data. Supply offset and/or limit for a byte-bounded live page with nextOffset.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("confirm_pairing", "Optional authenticated mode only: confirm the exact comparison code after the user approves it in Workbench. Cannot approve on the user's behalf. Default authentication-off connections skip this tool. Then use list_panel_sessions to identify the exact tab.", { requestId: text, code: { type: "string", minLength: 9, maxLength: 9 } }, ["requestId", "code"], true),
  tool("get_status", "Read capabilities, readContract version and response budgets, page epoch, Capture, Coverage, retention and committed Evidence boundary. New read options require readContract.version 2 on the connected panel.", {}),
  tool("list_scope", "Read a byte-bounded page of clients, Sessions, Subscriptions and items without changing UI selection. Continue at nextOffset when present.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("search_scope", "Locate structural Scopes by text, optional kind and parentScopeId. Returns exact scopeIds for subsequent reads, not COMMAND keys. Search includes collapsed branches and never changes human selection. Continue with only panelSessionId and cursor; start fresh to change options.", { text, kind: { type: "string", enum: ["page", "client", "session", "subscription", "item", "listener"] }, parentScopeId: text, limit: { ...integer(100), minimum: 1 }, cursor: text, maxBytes }),
  tool("get_scope", "Inspect one exact Scope and its Local Injection target, schema and availability. Use maxBytes for larger reviewed details.", { scopeId: text, maxBytes }, ["scopeId"]),
  tool("query_command_state", "Inspect one exact COMMAND key at the applied Evidence boundary for a live Subscription/item Scope and page epoch. Choose observed-server or local-effective projection explicitly. This is derived state, never Authoritative COMMAND State. Presence can be inconclusive after gaps or missing prior basis. Fields retain value states and provenance; omitted historical detail is explicit. No UI selection or application state changes. Default 8192-byte result, at most 32 fields; use maxBytes for bounded larger details.", {
    scopeId: text, pageEpoch: text, projection: { type: "string", enum: ["observed-server", "local-effective"] },
    item: object({ name: { oneOf: [text, { type: "null" }] }, position: { oneOf: [{ ...integer(Number.MAX_SAFE_INTEGER), minimum: 1 }, { type: "null" }] } }, ["name", "position"]),
    key: text, fields, maxBytes
  }, ["scopeId", "pageEpoch", "projection", "item", "key"]),
  tool("query_evidence", "Read compact matching Evidence in an explicit scopeId or within:page/current-investigation. where uses OR within each facet and AND between facets. fields selects exact Item Update field names; includePayload:true explicitly requests the full permitted envelope instead. Default serialized MCP result budget is 8192 bytes; limit is a maximum, not a guaranteed page size. Prefer summarize_evidence for counts/distinct keys. Continue with only panelSessionId and cursor; start fresh without cursor to change options, optionally preserving at. Does not change human investigation.", querySchema),
  tool("search_evidence", "Search text within an explicit scopeId or within:page/current-investigation, with the same where, fields, at read point and response budget as query_evidence. Matches are case-insensitive substrings; returned excerpts use permitted fields only. Default 8192-byte result, compact records, no payload. Continue with only panelSessionId and cursor; start fresh to narrow or change options. Does not change human investigation.", { text, within, scopeId: text, where, fields, maxBytes, at: querySchema.at, limit: { ...integer(100), minimum: 1 }, cursor: text, includePayload: { type: "boolean" } }),
  tool("summarize_evidence", "Count retained matching Evidence in an explicit Scope without returning events. Optional facet returns indexed distinct values and Evidence-record counts. Historical COMMAND key values are not currently active rows, and item count is not key count. Shares where/filter/text/at with query_evidence. Default 8192-byte result; continue with only panelSessionId and cursor at the same read point. No payload hydration or client-side event enumeration is needed.", { ...summarySchema, facet: { type: "string", enum: FACET_DESCRIPTORS.map(entry => entry.key) } }),
  tool("describe_stream", "Summarize Lightstreamer Subscription and item-update streams from a bounded retained Evidence sample. Profiles report sample coverage and exact matching totals; continue with query_evidence when the sample is incomplete.", { ...streamSchema, limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("wait_for_evidence", "Wait up to 20 seconds for matching committed Evidence after an exact read point, without blocking other tools. Results distinguish matched, timeout, cancellation, changed target/history, incomplete history and query failure. This is not proof of app behavior or event absence. Always inspect the returned read point.", { after: readPoint, pageEpoch: text, timeoutMs: integer(20000), scopeId: text, text: querySchema.text, filter, limit: querySchema.limit, includePayload: { type: "boolean" }, maxBytes }, ["after", "pageEpoch"]),
  tool("get_evidence", "Look up one exact retained Evidence identity. Defaults to compact metadata; fields selects exact Item Update field names. Use includePayload:true only when the full permitted envelope is necessary. Default serialized MCP result budget is 8192 bytes. Client Message bodies and credentials remain redacted.", { evidence: identity, fields, includePayload: { type: "boolean" }, maxBytes }, ["evidence"]),
  tool("query_diagnostics", "Read normalized Diagnostic Observations after a boundary. Continue with nextAfter when truncated. Missing observations prove nothing when coverage is limited.", { after: object({ intervalId: text, sequence: integer(Number.MAX_SAFE_INTEGER) }, ["intervalId", "sequence"]), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("update_agent_document", "Correct an unexecuted agent-owned Draft or Scenario Step using JSON document text. Requires its current token. Human edits cause a conflict. Returns a replacement token and validation.", { token: text, document: { type: "string", maxLength: 64 * 1024 }, stepId: text }, ["token", "document"], true),
  tool("prepare_local_injection", "Create a visible Local Injection Draft from exact Evidence or a live COMMAND Scope. document is optional JSON text with command, key, isSnapshot and fields. Returns an immutable execution token; does not inject.", { ...sourceProperties, pageEpoch: text }, ["pageEpoch"], true),
  tool("execute_local_injection", "Execute a prepared Local Injection once. Reuse requestId only to retrieve this operation; an unknown delivery must never be retried with a new id. Delivery does not prove app behavior.", { token: text, requestId: text }, ["token", "requestId"], true),
  tool("get_operation", "Read a prior Local Injection outcome or Scenario control receipt without repeating delivery. For Scenario progress use get_scenario_trace.", { requestId: text, maxBytes }, ["requestId"]),
  tool("wait_for_operation", "Wait up to 20 seconds for one existing operation receipt to complete without repeating execution. Returns COMPLETE or TIMED_OUT with the current receipt. A Scenario control receipt acknowledges the control only; inspect get_scenario_trace for Run progress. Unknown receipts do not prove that delivery did not occur. Cancellation and revoked access end the wait.", { requestId: text, timeoutMs: integer(20000), maxBytes }, ["requestId"]),
  tool("validate_agent_candidate", "Validate a source-grounded Draft candidate or explicit Scenario plan without publishing or changing protected Drafts or Scenarios. Large results retain whole-plan validity, reason, target and counts while omitting member details; maxBytes can request up to 64 KiB of details.", { pageEpoch: text, draft: source, members: { type: "array", minItems: 1, maxItems: 200, items: scenarioMember }, replace: object({ scenarioId: text, revision: integer(Number.MAX_SAFE_INTEGER) }, ["scenarioId", "revision"]), maxBytes }, ["pageEpoch"]),
  tool("prepare_scenario", "Validate and review an ordered single-target Scenario plan of explicit Step and Checkpoint members. Every member has a stable id; checkpoints carry explicit assertions. Candidate validation does not publish into protected human Drafts.", { pageEpoch: text, members: { type: "array", minItems: 1, maxItems: 200, items: scenarioMember }, steps: { type: "array", minItems: 1, maxItems: 100, items: object({ ...sourceProperties, delayMs: integer(3600000) }) }, replace: object({ scenarioId: text, revision: integer(Number.MAX_SAFE_INTEGER) }, ["scenarioId", "revision"]) }, ["pageEpoch"], true),
  tool("control_scenario", "Control the exact reviewed Scenario. step dispatches at most one Step; play uses its frozen delays. Hidden panels pause. Drift needs explicit re-review. Mutating calls require unique requestId; repetitions return their original receipt.", { runId: text, requestId: text, action: { type: "string", enum: ["step", "play", "pause", "stop", "re-review"] } }, ["runId", "requestId", "action"], true),
  tool("get_scenario_trace", "Read a page of current Scenario Steps and Run trace; continue with nextOffset. Controls and drift show the latest 25 with totals. This is not an assertion about app DOM or server state.", { offset: integer(100000), limit: { ...integer(100), minimum: 1 }, maxBytes }),
  tool("finish_agent_document", "Finish the agent-owned completed Draft or Scenario. Cannot discard human edits or an unfinished operation.", { token: text }, ["token"], true)
] as const;

function tool(name: string, description: string, properties: Record<string, Schema>, required: string[] = [], mutation = false) {
  const global = ["list_panel_sessions", "get_pairing_requests", "confirm_pairing"].includes(name);
  const successSchema = name === "query_evidence" ? {
    type: "object", additionalProperties: true, required: ["readPoint", "totals", "coverage", "evaluation", "storage", "discoveries", "nextCursor", "evidence", "omissions"], properties: {
      readPoint, totals: { type: "object", additionalProperties: true, required: ["matching", "inScope"] }, coverage: { type: "string", enum: ["COMPLETE", "LIMITED"] },
      evaluation: { type: "string", enum: ["COMPLETE", "UNSUPPORTED_FILTER"] }, storage: { type: "string", enum: ["INDEXED_DB", "MEMORY_FALLBACK"] }, discoveries: { type: "object", additionalProperties: true },
      nextCursor: { oneOf: [{ type: "null" }, { type: "string", maxLength: 8192 }] }, evidence: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, omissions: { type: "array", maxItems: 100, items: text }
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
  } : { type: "object", additionalProperties: true };
  // SDK clients also validate structuredContent when isError is true. Keep the
  // machine-readable failure envelope valid for every declared output schema.
  const failureSchema = object({ error: object({ code: text, message: { type: "string" }, automaticRetry: { type: "boolean", enum: [false] } }, ["code", "message", "automaticRetry"]) }, ["error"]);
  const outputSchema = { type: "object", anyOf: [successSchema, failureSchema] };
  return { name, description, inputSchema: object(global ? properties : { panelSessionId: text, ...properties }, global ? required : ["panelSessionId", ...required]), outputSchema, annotations: { readOnlyHint: !mutation, destructiveHint: mutation, idempotentHint: !mutation, openWorldHint: false }, mutation };
}
export function validateAgentCall(name: string, args: unknown): asserts args is AgentArguments {
  const definition = AGENT_TOOLS.find(tool => tool.name === name);
  if (!definition) throw new Error("Unknown Workbench tool.");
  validate(definition.inputSchema, args, "arguments");
  const input = args as AgentArguments;
  if (["query_evidence", "search_evidence", "summarize_evidence"].includes(name) && input.cursor === undefined) {
    if (input.scopeId === undefined && input.within === undefined) throw new Error("SCOPE_REQUIRED: supply an exact scopeId, within:page, or within:current-investigation. Find scopeIds with search_scope.");
    if (input.scopeId !== undefined && input.within === "current-investigation") throw new Error("INVALID_ARGUMENT: current-investigation already defines Scope; omit scopeId or start a scoped query.");
  }
  if (input.fields !== undefined && input.includePayload === true) throw new Error("INVALID_ARGUMENT: choose fields or includePayload:true, not both.");
  if (name === "query_command_state") {
    const item = input.item as { name: string | null; position: number | null };
    if (item.name === null && item.position === null) throw new Error("INVALID_ARGUMENT: provide an exact item name or position.");
  }
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
  if (["query_evidence", "search_evidence", "summarize_evidence", "describe_stream"].includes(name)) validateQueryCrossFields(args as AgentArguments);
  if (name === "wait_for_evidence") validateQueryCrossFields({ ...args as AgentArguments, at: (args as AgentArguments).after });
  if (new TextEncoder().encode(JSON.stringify(args)).byteLength > AGENT_MAX_BYTES) throw new Error("Request exceeds the 512 KiB limit.");
}
function validate(schema: Schema, value: unknown, path: string): void {
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) { try { validate(candidate, value, path); matches++; } catch { /* Each variant is a strict independent schema. */ } }
    if (matches !== 1) throw new Error(`${path}: expected exactly one supported shape.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: unsupported value.`);
  if (schema.type === "null") { if (value !== null) throw new Error(`${path}: expected null.`); return; }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${path}: expected plain object.`);
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`${path}.${key}: required.`);
    for (const [key, entry] of Object.entries(record)) {
      const child = Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (!child) throw new Error(`${path}: unknown property.`);
      validate(child, entry, `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100)) throw new Error(`${path}: invalid array size.`);
    value.forEach((entry, i) => validate(schema.items!, entry, `${path}[${i}]`));
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error(`${path}: invalid string.`);
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || (value as number) < (schema.minimum ?? 0) || (value as number) > (schema.maximum ?? Infinity)) throw new Error(`${path}: invalid integer.`);
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path}: invalid number.`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path}: expected boolean.`);
}
function validateQueryCrossFields(args: AgentArguments): void {
  if (args.cursor && Object.keys(args).some(key => !["panelSessionId", "cursor"].includes(key))) throw new Error("QUERY_OPTIONS_CHANGED: continue with only panelSessionId and cursor; start a new query without cursor to change options, optionally preserving at.");
  const point = args.at;
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
