export const DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION = 1 as const;

export type DiagnosticSeverity = "information" | "warning" | "error";

export type DiagnosticEvidenceBoundary = Readonly<{
  intervalId: string;
  sequence: number;
  eventId: string;
}>;

export type DiagnosticAffectedIdentity =
  | Readonly<{ kind: "page"; pageId: string }>
  | Readonly<{ kind: "client"; pageId: string; clientId: string }>
  | Readonly<{ kind: "session"; pageId: string; clientId: string; sessionId: string }>
  | Readonly<{ kind: "subscription"; pageId: string; clientId: string; sessionId?: string; subscriptionId: string }>
  | Readonly<{ kind: "item"; pageId: string; clientId: string; subscriptionId: string; item: string }>
  | Readonly<{ kind: "evidence"; intervalId: string; sequence: number; eventId: string }>;

export type DiagnosticObservationInput = Readonly<{
  code: string;
  severity: DiagnosticSeverity;
  lifecycle:
    | Readonly<{ kind: "occurrence"; occurrenceId: string }>
    | Readonly<{ kind: "condition"; conditionId: string }>;
  affected: DiagnosticAffectedIdentity;
  observedAt: number;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
  observed: string;
  limitation: string;
  consequence: string;
  route: string;
  originalCode?: number;
  safeMessage?: string;
}>;

export type DiagnosticObservation = Readonly<{
  schemaVersion: typeof DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION;
  id: string;
  code: string;
  severity: DiagnosticSeverity;
  lifecycle:
    | Readonly<{ kind: "occurrence"; occurrenceId: string; state: "observed" }>
    | Readonly<{ kind: "condition"; conditionId: string; state: "active" | "resolved" }>;
  affected: DiagnosticAffectedIdentity;
  observedAt: number;
  observationBoundary: Readonly<{ intervalId: string; sequence: number }>;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
  observed: string;
  limitation: string;
  consequence: string;
  route: string;
  originalCode?: number;
  safeMessage?: string;
}>;

export type DiagnosticObservationJournal = Readonly<{
  observe(input: DiagnosticObservationInput): Promise<DiagnosticObservation>;
}>;

export function createMemoryDiagnosticObservationJournal(
  options: Readonly<{ panelSessionId: string }>
): DiagnosticObservationJournal {
  let sequence = 0;
  const intervalId = `${options.panelSessionId}:diagnostics:interval-1`;
  return Object.freeze({
    async observe(input: DiagnosticObservationInput): Promise<DiagnosticObservation> {
      sequence += 1;
      const lifecycle = input.lifecycle.kind === "occurrence"
        ? Object.freeze({ ...input.lifecycle, state: "observed" as const })
        : Object.freeze({ ...input.lifecycle, state: "active" as const });
      return Object.freeze({
        ...input,
        schemaVersion: DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
        id: diagnosticObservationId(input),
        lifecycle,
        affected: Object.freeze({ ...input.affected }),
        observationBoundary: Object.freeze({ intervalId, sequence }),
        evidenceBoundary: input.evidenceBoundary ? Object.freeze({ ...input.evidenceBoundary }) : undefined
      });
    }
  });
}

function diagnosticObservationId(input: DiagnosticObservationInput): string {
  const lifecycleId = input.lifecycle.kind === "occurrence"
    ? `occurrence:${input.lifecycle.occurrenceId}`
    : `condition:${input.lifecycle.conditionId}`;
  return `diag:${input.code}:${lifecycleId}:${affectedIdentity(input.affected)}`;
}

function affectedIdentity(affected: DiagnosticAffectedIdentity): string {
  switch (affected.kind) {
    case "page": return `page:${affected.pageId}`;
    case "client": return `client:${affected.pageId}:${affected.clientId}`;
    case "session": return `session:${affected.pageId}:${affected.clientId}:${affected.sessionId}`;
    case "subscription": return `subscription:${affected.pageId}:${affected.clientId}:${affected.sessionId ?? "-"}:${affected.subscriptionId}`;
    case "item": return `item:${affected.pageId}:${affected.clientId}:${affected.subscriptionId}:${affected.item}`;
    case "evidence": return `evidence:${affected.intervalId}:${affected.sequence}:${affected.eventId}`;
  }
}
