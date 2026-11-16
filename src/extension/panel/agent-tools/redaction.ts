import { toBulkShareableEventEnvelope, type LightstreamerEventEnvelope } from "../../../core/event-envelope";
import type { DeterministicEvidenceRecord } from "../../../core/evidence-filter-contract";
import type { AgentFilterArgument } from "../../../agent/tool-arguments";
import { agentToolResultBytes } from "../../../agent/tool-result";
import { cloneCredentialSafe as omitCredentialFields } from "../topology-export";
import type { AgentCommandStateResult } from "../agent-command-state";
import type { AgentRuntime } from "../agent-runtime";
import { agentNativeChangePreview, describeAgentDocument } from "../agent-injection-capabilities";

/** Credential-safe projections of runtime state and Evidence for the agent boundary. */

/** Named projected fields use the same privacy and concrete-value semantics as
 * retained Evidence reads. Presence/provenance stay derived projection facts. */
export function safeCommandState(result: Extract<AgentCommandStateResult, { status: "ok" }>, budget: number): unknown {
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

export function safeRecord(record: DeterministicEvidenceRecord, payloadBudget = 256 * 1024) {
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
export function safeMatchExplanation(evidence: object, query: string, reason: "PAYLOAD_NOT_REQUESTED" | "NO_MATCH_IN_REQUESTED_FIELDS" | "NO_MATCH_IN_SHAREABLE_REPRESENTATION") {
  const needle = query.toLowerCase();
  const fields: Array<{ field: string; excerpt: string }> = [];
  let remaining = 4096;
  let scanLimited = false;
  function visit(value: unknown, path: string, depth = 0): void {
    if (fields.length >= 3) return;
    if (depth > 16 || remaining-- <= 0) { scanLimited = true; return; }
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
        if (remaining <= 0) { scanLimited = true; break; }
        if (fields.length >= 3) break;
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
  return { state: fields.length > 0 ? "EXPLAINED" : "NO_SHAREABLE_EXCERPT", ...(fields.length ? {} : { reason: scanLimited ? "EXCERPT_SCAN_LIMIT" : reason }), fields };
}

export function boundedRecords(records: readonly DeterministicEvidenceRecord[]) {
  let remaining = 256 * 1024;
  return records.map(record => {
    const safe = safeRecord(record, Math.min(64 * 1024, remaining));
    if ("payload" in safe) remaining = Math.max(0, remaining - new TextEncoder().encode(JSON.stringify(safe.payload)).byteLength);
    return safe;
  });
}
export function compactWaitEvidence(record: DeterministicEvidenceRecord, args: Readonly<{ filter?: AgentFilterArgument }>) {
  const requested = args.filter?.criteria?.map(entry => entry.facet) ?? [];
  const keys = new Set(["kind", "mode", "key", "operation", "phase", "provenance", ...requested]);
  const facets = Object.fromEntries(Object.entries(record.facets).filter(([key]) => keys.has(key)));
  return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(facets) };
}
export function projectReadRecord(record: DeterministicEvidenceRecord, includePayload: boolean, fields?: readonly string[]) {
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

export function safeDraft(local: ReturnType<AgentRuntime["local"]>) {
  if (!local.draft) return local;
  const { rawText: _raw, source: _source, preflightFingerprint: _fingerprint, nativeChanges, ...draft } = local.draft;
  const documentBytes = new TextEncoder().encode(JSON.stringify(draft.document)).byteLength;
  const template = local.draft.source?.rawText ? JSON.parse(local.draft.source.rawText) as { fields: Record<string, unknown> } : draft.document;
  const jsonFields = template ? Object.entries(template.fields).filter(([, value]) => value !== null && typeof value === "object").map(([name]) => name) : null;
  return { ...local, draft: cloneCredentialSafe({ ...draft, documentContract: describeAgentDocument(draft.anchor.fieldSchema, jsonFields, draft.anchor.subscriptionMode), nativeChanges: agentNativeChangePreview(nativeChanges), ...(documentBytes > 64 * 1024 ? { document: null, documentOmitted: "Preview exceeds 64 KiB; inspect the visible Workbench Draft.", documentBytes } : {}) }), privacy: "Recognized credential fields are omitted; this is not a general secret detector. Captured redactions are not executable values." };
}
export function safeScenario(state: ReturnType<AgentRuntime["scenario"]>, offset = 0, limit = 25) {
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

export function cloneCredentialSafe(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[OMITTED:deeply-nested-data]";
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) return redactEmbeddedJson(value, depth + 1);
  if (Array.isArray(value)) return value.map(entry => cloneCredentialSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  // Test each property at this level; recursively omitting the whole graph here
  // would duplicate the walk and bypass this function's nesting bound.
  return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(omitCredentialFields({ [key]: true }) as object, key))
    .map(([key, entry]) => [key, cloneCredentialSafe(entry, depth + 1)]));
}
