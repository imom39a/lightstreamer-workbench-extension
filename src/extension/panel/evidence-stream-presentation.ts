import type { LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { WorkbenchEvidence } from "./workbench-runtime";

export type EvidenceCodeFamily = "tlcp" | "workbench";

export type EvidenceCodeDefinition = Readonly<{
  code: string;
  label: string;
  description: string;
  family: EvidenceCodeFamily;
}>;

export const EVIDENCE_CODE_DEFINITIONS: readonly EvidenceCodeDefinition[] = Object.freeze([
  { code: "U", label: "Update", description: "Item update; the TLCP U notification carries snapshot and live data.", family: "tlcp" },
  { code: "SUBOK", label: "Subscription active", description: "A non-COMMAND subscription is active.", family: "tlcp" },
  { code: "SUBCMD", label: "COMMAND subscription active", description: "A COMMAND subscription is active.", family: "tlcp" },
  { code: "UNSUB", label: "Unsubscribed", description: "The subscription ended.", family: "tlcp" },
  { code: "EOS", label: "End of snapshot", description: "The item snapshot is complete.", family: "tlcp" },
  { code: "CS", label: "Clear snapshot", description: "The item snapshot was cleared.", family: "tlcp" },
  { code: "OV", label: "Overflow", description: "One or more item updates were lost.", family: "tlcp" },
  { code: "C+", label: "Client observed", description: "Workbench captured a Lightstreamer client.", family: "workbench" },
  { code: "C~", label: "Client status", description: "Workbench captured a client status change.", family: "workbench" },
  { code: "S+", label: "Subscription observed", description: "Workbench captured subscription configuration before activation.", family: "workbench" },
  { code: "S~", label: "Subscription restored", description: "Workbench restored an already-active subscription into panel state.", family: "workbench" },
  { code: "SF", label: "Real max frequency", description: "Workbench captured the max update frequency accepted by the server.", family: "workbench" },
  { code: "S!", label: "Subscription error", description: "Workbench captured a subscription error callback.", family: "workbench" },
  { code: "L+", label: "Listener added", description: "Workbench observed a subscription listener being added.", family: "workbench" },
  { code: "L−", label: "Listener removed", description: "Workbench observed a subscription listener being removed.", family: "workbench" },
  { code: "?", label: "Unknown event", description: "The captured event kind is unavailable or unrecognized.", family: "workbench" },
  { code: "ERR", label: "Server error", description: "Workbench captured a server error notification.", family: "workbench" },
  { code: "KA", label: "Keepalive", description: "Workbench captured a keepalive notification.", family: "workbench" },
  { code: "M+", label: "Client Message sent", description: "Workbench captured an outbound Client Message.", family: "workbench" },
  { code: "M✓", label: "Client Message processed", description: "Workbench captured a processed Client Message outcome.", family: "workbench" },
  { code: "M!", label: "Client Message denied", description: "Workbench captured a denied Client Message outcome.", family: "workbench" },
  { code: "M−", label: "Client Message discarded", description: "Workbench captured a discarded Client Message outcome.", family: "workbench" },
  { code: "M×", label: "Client Message error", description: "Workbench captured a Client Message error outcome.", family: "workbench" },
  { code: "M∅", label: "Client Message aborted", description: "Workbench captured an aborted Client Message outcome.", family: "workbench" }
]);

export type EvidenceStreamData = Readonly<{
  fields: Readonly<Record<string, unknown>>;
  decodedJsonFields: readonly string[];
  fieldsTruncated: boolean;
}>;

export type EvidenceStreamPresentation = Readonly<{
  code: string;
  codeFamily: EvidenceCodeFamily;
  identity: string | null;
  data: EvidenceStreamData;
  jsonString: string;
  previewTruncated: boolean;
}>;

const PREVIEW_LIMIT = 8 * 1024;
const JSON_PARSE_LIMIT = 8 * 1024;

export function evidenceStreamPresentation(
  event: WorkbenchEvidence,
  mode: "readable" | "raw"
): EvidenceStreamPresentation {
  const raw = event.raw;
  const definition = definitionFor(raw);
  const selected = selectedFields(raw, mode);
  const preview = boundedPreview(selected.fields);
  const serializedPreview = JSON.stringify(preview.value);
  const serialized = serializedPreview.length > PREVIEW_LIMIT
    ? `${serializedPreview.slice(0, PREVIEW_LIMIT - 1)}…`
    : serializedPreview;
  return Object.freeze({
    code: definition.code,
    codeFamily: definition.family,
    identity: eventIdentity(raw),
    data: Object.freeze({ fields: Object.freeze(preview.value as Record<string, unknown>), decodedJsonFields: selected.decodedJsonFields, fieldsTruncated: selected.fieldsTruncated }),
    jsonString: serialized,
    previewTruncated: selected.fieldsTruncated || preview.truncated || serialized !== serializedPreview
  });
}

function definitionFor(event: LightstreamerEventEnvelope): EvidenceCodeDefinition {
  const code = codeFor(event);
  return EVIDENCE_CODE_DEFINITIONS.find((definition) => definition.code === code)
    ?? EVIDENCE_CODE_DEFINITIONS.find((definition) => definition.code === "?")!;
}

function codeFor(event: LightstreamerEventEnvelope): string {
  switch (event.kind) {
    case "item-update": return "U";
    case "subscription-started": return event.subscription?.mode?.toUpperCase() === "COMMAND" ? "SUBCMD" : "SUBOK";
    case "subscription-ended": return "UNSUB";
    case "end-of-snapshot": return "EOS";
    case "clear-snapshot": return "CS";
    case "lost-updates": return "OV";
    case "client-created": return "C+";
    case "client-status": return "C~";
    case "subscription-created": return "S+";
    case "subscription-snapshot": return "S~";
    case "subscription-frequency": return "SF";
    case "subscription-error": return "S!";
    case "listener-added": return "L+";
    case "listener-removed": return "L−";
    case "server-error": return "ERR";
    case "server-keepalive": return "KA";
    case "client-message-sent": return "M+";
    case "client-message-processed": return "M✓";
    case "client-message-denied": return "M!";
    case "client-message-discarded": return "M−";
    case "client-message-error": return "M×";
    case "client-message-aborted": return "M∅";
    default: return "?";
  }
}

function eventIdentity(event: LightstreamerEventEnvelope): string | null {
  if (!event || typeof event.kind !== "string") return null;
  if (event.kind === "item-update" && event.update?.key !== undefined && event.update.key !== null && event.update.key !== "") return event.update.key;
  if (["item-update", "end-of-snapshot", "clear-snapshot", "lost-updates"].includes(event.kind)) {
    return event.item?.name ?? (event.item?.position === null || event.item?.position === undefined ? null : `item ${event.item.position}`);
  }
  if (["client-created", "client-status"].includes(event.kind)) return event.client?.id ?? null;
  if (["subscription-created", "subscription-started", "subscription-snapshot", "subscription-frequency", "subscription-ended", "subscription-error", "listener-added", "listener-removed"].includes(event.kind)) return event.subscription?.id ?? null;
  if (["server-error", "server-keepalive"].includes(event.kind)) return event.subscription?.id ?? event.client?.id ?? null;
  if (event.kind?.startsWith("client-message-")) return event.client?.id ?? null;
  return null;
}

type SelectedFields = Readonly<{ fields: Record<string, unknown>; decodedJsonFields: readonly string[]; fieldsTruncated: boolean }>;

function selectedFields(event: LightstreamerEventEnvelope, mode: "readable" | "raw"): SelectedFields {
  let fields: Record<string, unknown>;
  let fieldsTruncated = false;
  if (event.kind === "item-update") {
    const selected = boundedFieldMap(event.update?.fields);
    fields = selected.fields;
    fieldsTruncated = selected.truncated;
    if (event.update?.lostUpdates !== undefined && event.update.lostUpdates !== null && !Object.hasOwn(fields, "lostUpdates")) fields.lostUpdates = event.update.lostUpdates;
  }
  else if (event.kind === "server-error") fields = { ...(event.serverError ?? {}) };
  else if (event.kind === "server-keepalive") fields = { ...(event.keepalive ?? {}) };
  else if (event.clientMessage) {
    const message = event.clientMessage;
    fields = {
      id: message.id,
      sequence: message.sequence,
      outcome: message.outcome,
      outcomeAvailability: message.outcomeAvailability,
      messageState: message.messageState,
      sentOnNetwork: message.sentOnNetwork,
      code: message.code
    };
  } else if (event.kind === "subscription-frequency") fields = { id: event.subscription?.id, requestedMaxFrequency: event.subscription?.requestedMaxFrequency, realMaxFrequency: event.subscription?.realMaxFrequency };
  else if (event.kind === "subscription-error") fields = { id: event.subscription?.id, error: event.serverError?.message, errorCode: event.serverError?.code, messageState: event.serverError?.messageState };
  else if (event.update) {
    const selected = boundedFieldMap(event.update.fields);
    fields = selected.fields;
    fieldsTruncated = selected.truncated;
    if (event.update.lostUpdates !== undefined && event.update.lostUpdates !== null && !Object.hasOwn(fields, "lostUpdates")) fields.lostUpdates = event.update.lostUpdates;
  }
  else if (event.subscription) fields = { id: event.subscription.id, mode: event.subscription.mode, active: event.subscription.active, subscribed: event.subscription.subscribed, listenerCount: event.subscription.listenerCount };
  else if (event.client) fields = { id: event.client.id, status: event.client.status, sessionId: event.client.sessionId };
  else fields = { kind: event.kind };

  const decodedJsonFields: string[] = [];
  if (mode === "readable") {
    let parseBudget = JSON_PARSE_LIMIT;
    let fieldCount = 0;
    for (const key in fields) {
      if (fieldCount++ >= 128) break;
      const value = fields[key];
      if (typeof value !== "string" || value.length > parseBudget) continue;
      const trimmed = value.trim();
      if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) continue;
      parseBudget -= value.length;
      try {
        fields[key] = JSON.parse(trimmed);
        decodedJsonFields.push(key);
      } catch {
        // Preserve the captured string when it is not valid JSON.
      }
    }
  }
  return { fields: Object.freeze(fields), decodedJsonFields: Object.freeze(decodedJsonFields), fieldsTruncated };
}

function boundedFieldMap(source: Record<string, unknown> | undefined): Readonly<{ fields: Record<string, unknown>; truncated: boolean }> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!source) return { fields: result, truncated: false };
  let count = 0;
  let truncated = false;
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue;
    if (count++ >= 128) { truncated = true; break; }
    const safeKey = key.length > 256 ? `${key.slice(0, 255)}…` : key;
    if (safeKey !== key) truncated = true;
    Object.defineProperty(result, safeKey, { value: source[key], enumerable: true, writable: true, configurable: true });
  }
  return { fields: result, truncated };
}

type PreviewResult = Readonly<{ value: unknown; truncated: boolean }>;
type PreviewBudget = { chars: number; nodes: number; truncated: boolean; seen: WeakSet<object> };

function boundedPreview(fields: Record<string, unknown>): PreviewResult {
  const budget: PreviewBudget = { chars: PREVIEW_LIMIT, nodes: 512, truncated: false, seen: new WeakSet<object>() };
  return { value: boundedValue(fields, budget, 0), truncated: budget.truncated };
}

function boundedValue(value: unknown, budget: PreviewBudget, depth: number): unknown {
  if (budget.nodes-- <= 0 || budget.chars <= 0) { budget.truncated = true; return "[preview truncated]"; }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "undefined") { budget.truncated = true; return "[undefined]"; }
  if (typeof value === "string") {
    if (value.length <= budget.chars) { budget.chars -= value.length; return value; }
    budget.truncated = true;
    const result = value.slice(0, Math.max(0, budget.chars - 1)) + "…";
    budget.chars = 0;
    return result;
  }
  if (typeof value !== "object") return String(value);
  if (depth >= 6 || budget.seen.has(value)) { budget.truncated = true; return "[object omitted]"; }
  budget.seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      if (budget.chars <= 0 || budget.nodes <= 0) { budget.truncated = true; break; }
      result.push(boundedValue(entry, budget, depth + 1));
    }
    if (result.length < value.length) budget.truncated = true;
    return result;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (count++ >= 128 || budget.chars <= 0 || budget.nodes <= 0) { budget.truncated = true; break; }
    if (key.length >= budget.chars) {
      budget.truncated = true;
      break;
    }
    budget.chars -= key.length;
    const safeKey = key.length > 256 ? `${key.slice(0, 255)}…` : key;
    if (safeKey !== key) budget.truncated = true;
    Object.defineProperty(result, safeKey, { value: boundedValue((value as Record<string, unknown>)[key], budget, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
