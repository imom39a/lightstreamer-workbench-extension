import type { DiagnosticAffectedIdentity, DiagnosticObservationInput } from "./diagnostic-observation";

export type DiagnosticObservationPresentation = Readonly<{
  id: string;
  code: string;
  severity: "Information" | "Warning" | "Error";
  title: string;
  affected: string;
  observed: string;
  limitation: string;
  consequence: string;
  route?: Readonly<{ kind: "inspect-evidence"; eventId: string; label: string }>;
}>;

export function presentDiagnosticObservation(input: DiagnosticObservationInput): DiagnosticObservationPresentation {
  const route = input.route.kind === "inspect-evidence"
    ? { kind: "inspect-evidence" as const, eventId: input.route.evidence.eventId, label: "Inspect supporting Evidence" }
    : undefined;
  return Object.freeze({
    id: input.lifecycle.kind === "occurrence" ? input.lifecycle.occurrenceId : input.lifecycle.conditionId,
    code: input.code,
    severity: input.severity === "information" ? "Information" : input.severity === "warning" ? "Warning" : "Error",
    title: titleFor(input),
    affected: affectedLabel(input.affected),
    observed: `${input.observed}${input.safeMessage ? ` Message: ${input.safeMessage}` : ""}`,
    limitation: input.limitation,
    consequence: input.consequence,
    ...(route ? { route } : {})
  });
}

function titleFor(input: DiagnosticObservationInput): string {
  if (input.code === "ls.client.server-error") return `Server error${input.originalCode === undefined ? "" : ` ${input.originalCode}`}`;
  if (input.code === "ls.client.server-keepalive") return "Server keepalive observed";
  return input.code;
}

function affectedLabel(affected: DiagnosticAffectedIdentity): string {
  switch (affected.kind) {
    case "page": return `Page ${affected.pageId}`;
    case "client": return `Client ${affected.clientId}`;
    case "session": return `Session ${affected.sessionId}`;
    case "subscription": return `Subscription ${affected.subscriptionId}`;
    case "item": return `Item ${affected.item}`;
    case "evidence": return `Evidence ${affected.eventId}`;
    case "unavailable": return "Affected runtime object unavailable";
  }
}
