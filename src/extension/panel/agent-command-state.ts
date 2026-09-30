import type { EvidenceIdentity, EvidenceReadPoint } from "../../core/evidence-filter-contract";
import type { CommandEvidenceIdentity, CommandFieldValue, CommandKeyStateRead, CommandProvenance, CommandStateInspectionInput, CommandStateProjection } from "../../core/command-state";
import type { ItemUpdateFieldValueState } from "../../core/event-envelope";
import type { HistoryStatus } from "../../core/event-history-authoritative";
import type { TopologySelectionTarget } from "./topology-view-model";

export type AgentCommandStateInput = Readonly<{
  scopeId: string;
  pageEpoch: string;
  projection: CommandStateProjection;
  item: Readonly<{ name: string | null; position: number | null }>;
  key: string;
  fields?: readonly string[];
  maxBytes?: number;
}>;
export type AgentCommandProvenance = Omit<CommandProvenance, "evidence"> & Readonly<{ evidence?: EvidenceIdentity; evidenceRetained: boolean }>;
export type AgentCommandField = Readonly<{
  name: string;
  state: ItemUpdateFieldValueState | "output-budget";
  value?: CommandFieldValue;
  certainty: "projected" | "last-observed" | "unavailable";
  provenance: AgentCommandProvenance | null;
}>;
export type AgentCommandStateResult = Readonly<{
  status: "error";
  problem: Readonly<{ code: "TARGET_CHANGED" | "INVALID_TARGET" | "INVALID_ARGUMENT" | "PROJECTION_UNAVAILABLE" | "RESULT_BUDGET_EXCEEDED"; message: string }>;
}> | Readonly<{
  status: "ok";
  projection: CommandStateProjection;
  target: Readonly<{ scopeId: string; pageEpoch: string; subscriptionId: string; item: AgentCommandStateInput["item"]; key: string }>;
  readPoint: EvidenceReadPoint;
  presence: Readonly<{ state: "present" | "absent" | "inconclusive"; basis: "row" | "delete" | "clear-snapshot" | "limited-history" | "no-observed-basis"; provenance: AgentCommandProvenance | null }>;
  fields: readonly AgentCommandField[];
  fieldsTotal: number;
  fieldsRequested: number;
  fieldsReturned: number;
  truncated: boolean;
  history: Readonly<{ deletedKeysHasOlder: boolean; lifecycleHasOlder: boolean; diagnosticsHasOlder: boolean }>;
  limitations: readonly string[];
}>;
export type AgentCommandStateContext = Readonly<{
  pageEpoch: string | null;
  disposed: boolean;
  scope: TopologySelectionTarget | null;
  history: HistoryStatus;
  projectionBoundary: CommandEvidenceIdentity | null;
  projectionReady: boolean;
  readKey(projection: CommandStateProjection, input: CommandStateInspectionInput): CommandKeyStateRead;
}>;

const encoder = new TextEncoder();
const DERIVED_LIMITATION = "Derived from accepted Workbench Evidence; this is not authoritative application or server state.";

/** Bounded, exact-target, renderer-neutral read; transport redaction remains the service's responsibility. */
export function readAgentCommandState(input: AgentCommandStateInput, context: AgentCommandStateContext): AgentCommandStateResult {
  const fail = (code: Extract<AgentCommandStateResult, { status: "error" }>["problem"]["code"], message: string): AgentCommandStateResult => ({ status: "error", problem: { code, message } });
  if (context.disposed || input.pageEpoch !== context.pageEpoch) return fail("TARGET_CHANGED", "The inspected page changed. Inspect the current page and Scope again.");
  if (!input.item || (input.item.name === null && input.item.position === null) || (input.item.name !== null && typeof input.item.name !== "string")
    || (input.item.position !== null && (!Number.isSafeInteger(input.item.position) || input.item.position < 1))
    || typeof input.key !== "string" || input.key.length === 0 || !["observed-server", "local-effective"].includes(input.projection)
    || (input.fields && (input.fields.length < 1 || input.fields.length > 32 || new Set(input.fields).size !== input.fields.length || input.fields.some(field => typeof field !== "string" || field.length === 0)))) {
    return fail("INVALID_ARGUMENT", "Choose an exact item name or positive position, opaque nonempty key, projection, and at most 32 unique field names.");
  }
  const maxBytes = input.maxBytes ?? 8192;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 64 * 1024) return fail("INVALID_ARGUMENT", "maxBytes must be between 4096 and 65536.");
  const scope = context.scope;
  if (!scope || (scope.kind !== "subscription" && scope.kind !== "item") || scope.subscription.mode !== "COMMAND"
    || !scope.subscription.active || scope.subscription.historical || !scope.subscription.serverEstablished) {
    return fail("INVALID_TARGET", "Choose a live COMMAND Subscription or item Scope.");
  }
  const matchesItem = (item: { name: string | null; position: number | null }) =>
    (input.item.name === null || input.item.name === item.name) && (input.item.position === null || input.item.position === item.position);
  const item = scope.kind === "item" ? (matchesItem(scope.item) ? scope.item : null) : scope.subscription.items.find(matchesItem);
  if (!item) return fail("INVALID_TARGET", "The exact item does not belong to this Scope.");
  if (!context.projectionReady || context.history.phase === "CLOSED") return fail("PROJECTION_UNAVAILABLE", "The COMMAND projection is recovering or unavailable. Read again after recovery.");
  const read = context.readKey(input.projection, { subscriptionId: scope.subscription.id, item: { name: item.name, position: item.position }, key: input.key });
  const retainedRange = context.history.retainedRange;
  const boundary = context.projectionBoundary;
  const range = retainedRange && boundary && retainedRange.first.sequence <= boundary.sequence ? {
    first: retainedRange.first,
    last: retainedRange.last.sequence <= boundary.sequence ? retainedRange.last : boundary
  } : null;
  // Both canonical memory and durable History query adapters currently use
  // this stable namespace (see their evidenceIdentity/queryReadPoint seams).
  const identity = (reference: CommandEvidenceIdentity): EvidenceIdentity => ({
    ...reference, pageId: reference.pageId ?? reference.intervalId, ownerId: reference.ownerId ?? "memory-event-history"
  });
  const provenance = (source: CommandProvenance | null | undefined): AgentCommandProvenance | null => {
    if (!source) return null;
    const { evidence, ...detail } = source;
    return {
      ...detail,
      ...(evidence ? { evidence: identity(evidence) } : {}),
      evidenceRetained: Boolean(evidence && range && evidence.intervalId === context.history.interval.id
        && evidence.sequence >= range.first.sequence && evidence.sequence <= range.last.sequence)
    };
  };
  const gap = context.history.continuity?.state === "GAPPED" ? context.history.continuity.latestGap : null;
  const afterGap = (source: CommandProvenance | null | undefined) => !gap || Boolean(source?.evidence
    && source.evidence.intervalId === context.history.interval.id && source.evidence.sequence > (gap.afterEvidence?.sequence ?? 0));
  const basis = read.row ? "row" : read.deleted ? "delete" : read.lastClearSnapshot && !read.deletedKeysHasOlder ? "clear-snapshot"
    : read.deletedKeysHasOlder ? "limited-history" : "no-observed-basis";
  const basisProvenance = read.row?.latest ?? read.deleted?.deletedAt ?? (basis === "clear-snapshot" ? read.lastClearSnapshot : null);
  const supportedPresence = read.itemFound && basisProvenance !== null && afterGap(basisProvenance);
  const limitations = [DERIVED_LIMITATION];
  if (gap) limitations.push("An Evidence Gap limits continuity-dependent claims; detail before the latest gap is last-observed projection detail.");
  if (read.deletedKeysHasOlder) limitations.push("Older DELETE tombstones and per-key histories were evicted; an unlisted key does not establish absence or a never-seen history.");
  if (read.lifecycleHasOlder || read.diagnosticsHasOlder) limitations.push("Auxiliary lifecycle or diagnostic detail is bounded; older Evidence is available only while retained.");
  if (!supportedPresence) limitations.push("Current key presence cannot be established from the available projection basis.");
  const selected: string[] = input.fields ? [...input.fields] : [];
  if (!input.fields && read.row) {
    for (const field in read.row.fields) {
      if (!Object.prototype.hasOwnProperty.call(read.row.fields, field)) continue;
      if (selected.length === 32) break;
      selected.push(field);
    }
  }
  const result: Extract<AgentCommandStateResult, { status: "ok" }> = {
    status: "ok", projection: input.projection,
    target: { scopeId: input.scopeId, pageEpoch: input.pageEpoch, subscriptionId: scope.subscription.id, item: { name: item.name, position: item.position }, key: input.key },
    readPoint: { interval: { ...context.history.interval }, committedEvidenceBoundary: boundary ? identity(boundary) : null, retainedRange: range ? { first: identity(range.first), last: identity(range.last) } : null },
    presence: { state: supportedPresence ? read.row ? "present" : "absent" : "inconclusive", basis, provenance: provenance(basisProvenance) },
    fields: [], fieldsTotal: read.fieldsTotal, fieldsRequested: selected.length, fieldsReturned: 0,
    truncated: !input.fields && read.fieldsTotal > selected.length,
    history: { deletedKeysHasOlder: read.deletedKeysHasOlder, lifecycleHasOlder: read.lifecycleHasOlder, diagnosticsHasOlder: read.diagnosticsHasOlder }, limitations
  };
  const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  // Reserve space for the service's result envelope and redaction metadata.
  const budget = maxBytes - 1024;
  if (input.key.length > budget || size(result) > budget) return fail("RESULT_BUDGET_EXCEEDED", "Exact target metadata exceeds this response budget. Use a larger maxBytes.");
  const fields: AgentCommandField[] = [];
  let truncated = result.truncated;
  for (const name of selected) {
    const row = read.row;
    const captured = Boolean(row && Object.prototype.hasOwnProperty.call(row.fields, name));
    const value = captured ? row!.fields[name] : undefined;
    const source = captured ? row!.fieldProvenance[name] ?? row!.latest : null;
    const state = captured ? row!.fieldValueStates[name] ?? (value === null && source?.source === "server" ? "ambiguous-null" : "concrete") : "unavailable";
    let field: AgentCommandField = { name, state, certainty: captured ? afterGap(source) ? "projected" : "last-observed" : "unavailable", provenance: provenance(source), ...(state === "concrete" ? { value } : {}) };
    if (state === "concrete" && typeof value === "string" && value.length > budget) {
      field = { name, state: "output-budget", certainty: "unavailable", provenance: provenance(source) };
      truncated = true;
    }
    if (size({ ...result, fields: [...fields, field], truncated, fieldsReturned: fields.length + 1 }) > budget) {
      if (state !== "concrete") { truncated = true; break; }
      field = { name, state: "output-budget", certainty: "unavailable", provenance: provenance(source) };
      truncated = true;
      if (size({ ...result, fields: [...fields, field], truncated, fieldsReturned: fields.length + 1 }) > budget) break;
    }
    fields.push(field);
  }
  if (fields.length < selected.length) truncated = true;
  return { ...result, fields, fieldsReturned: fields.length, truncated };
}
