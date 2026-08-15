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
  return DIAGNOSTIC_TITLES[input.code] ?? input.code;
}

const DIAGNOSTIC_TITLES: Readonly<Record<string, string>> = Object.freeze({
  "ls.sub.raw-snapshot-unavailable": "RAW snapshot unavailable",
  "ls.sub.buffer-not-applicable-mode": "Buffer request not applicable",
  "ls.sub.buffer-not-applicable-unfiltered": "Buffer ignored for unfiltered dispatch",
  "ls.sub.merge-unlimited-buffer-risk": "Unlimited MERGE buffer",
  "ls.sub.distinct-bounded-buffer-risk": "Bounded DISTINCT buffer",
  "ls.sub.command-key-missing": "COMMAND key field missing",
  "ls.sub.command-command-missing": "COMMAND command field missing",
  "ls.sub.2l-field-name-conflict": "Second-level field name conflict",
  "ls.sub.2l-invalid-item": "Invalid second-level item",
  "ls.sub.2l-data-adapter-refused": "Second-level Data Adapter refused",
  "ls.sub.2l-group-schema-refused": "Second-level schema refused",
  "ls.sub.2l-mode-refused": "Second-level mode refused",
  "ls.sub.active-not-established": "Subscription not established",
  "ls.sub.unfiltered-refused": "Unfiltered dispatch refused",
  "ls.sub.2l-unfiltered-refused": "Second-level unfiltered dispatch refused",
  "ls.sub.application-refused": "Subscription refused by application",
  "ls.sub.unfiltered-actually-limited": "Unfiltered Subscription is limited",
  "ls.sub.nonraw-mode-overlap": "Non-RAW mode overlap",
  "ls.subscription.exact-duplicate": "Exact duplicate Subscriptions",
  "ls.subscription.semantic-overlap": "Semantic Subscription overlap",
  "ls.listener.registration-churn": "Listener registration churn",
  "ls.subscription.lifecycle-churn": "Subscription lifecycle churn",
  "workbench.capture.late-attachment": "Capture attached late",
  "workbench.capture.observation-path-limited": "Observation path limited",
  "workbench.history.lower-capacity": "Lower History capacity",
  "workbench.history.terminal": "History reached terminal boundary",
  "workbench.capture.unsupported-shape": "Unsupported captured shape"
});

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
