export const DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTIC_RULE_CODE_MAX_LENGTH = 96;
export const DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH = 128;
export const DIAGNOSTIC_TEXT_MAX_LENGTH = 512;
export const DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH = 256;

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

export type DiagnosticInspectionRoute =
  | Readonly<{ kind: "inspect-affected" }>
  | Readonly<{ kind: "inspect-evidence"; evidence: DiagnosticEvidenceBoundary }>
  | Readonly<{ kind: "recover"; action: string }>;

export type DiagnosticResultRef =
  | Readonly<{ kind: "evidence"; intervalId: string; sequence: number; eventId: string }>
  | Readonly<{ kind: "projection"; projection: "topology" | "observed-server-command-state" | "local-effective-command-state"; key: string }>
  | Readonly<{ kind: "injection-outcome"; runId: string; stepId: string }>;

export type DiagnosticObservationInput = Readonly<{
  code: string;
  ruleVersion?: number;
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
  route: DiagnosticInspectionRoute;
  resultRef?: DiagnosticResultRef;
  originalCode?: number;
  safeMessage?: string;
}>;

export type DiagnosticObservation = Readonly<{
  schemaVersion: typeof DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION;
  id: string;
  code: string;
  ruleVersion: number;
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
  route: DiagnosticInspectionRoute;
  resultRef?: DiagnosticResultRef;
  originalCode?: number;
  safeMessage?: string;
}>;

export type DiagnosticObservationBoundary = Readonly<{ intervalId: string; sequence: number }>;
export type DiagnosticObservationCursor = DiagnosticObservationBoundary;

export type DiagnosticObservationQuery = Readonly<{
  after?: DiagnosticObservationBoundary | null;
  through?: DiagnosticObservationBoundary | null;
  codes?: readonly string[];
  minimumSeverity?: DiagnosticSeverity;
  affected?: DiagnosticAffectedIdentity;
}>;

export type DiagnosticObservationReadStatus = "complete" | "unsupported" | "retention-gap" | "cleared" | "unavailable" | "closed";
export type DiagnosticObservationRead = Readonly<{
  status: DiagnosticObservationReadStatus;
  coverage: "complete" | "limited" | "unavailable";
  retention: "complete" | "limited" | "cleared";
  through: DiagnosticObservationBoundary;
  observations: readonly DiagnosticObservation[];
}>;

export type DiagnosticObservationRef = Readonly<{
  schemaVersion: typeof DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION;
  id: string;
  code: string;
  ruleVersion: number;
  severity: DiagnosticSeverity;
  lifecycle: DiagnosticObservation["lifecycle"];
  affected: DiagnosticAffectedIdentity;
  observedAt: number;
  observationBoundary: DiagnosticObservationBoundary;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
  route: DiagnosticInspectionRoute;
  resultRef?: DiagnosticResultRef;
}>;

export type DiagnosticConditionResolution = Readonly<{
  code: string;
  conditionId: string;
  affected: DiagnosticAffectedIdentity;
  observedAt: number;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
}>;

export type DiagnosticObservationJournal = Readonly<{
  observe(input: DiagnosticObservationInput): Promise<DiagnosticObservation>;
  resolveCondition(resolution: DiagnosticConditionResolution): Promise<DiagnosticObservation | null>;
  query(query?: DiagnosticObservationQuery): Promise<DiagnosticObservationRead>;
  replay(): Promise<readonly DiagnosticObservation[]>;
  currentBoundary(): DiagnosticObservationBoundary;
  subscribe(after: DiagnosticObservationBoundary, observer: (observation: DiagnosticObservation) => void): () => void;
}>;

export function createMemoryDiagnosticObservationJournal(
  options: Readonly<{ panelSessionId: string }>
): DiagnosticObservationJournal {
  let sequence = 0;
  const intervalId = `${options.panelSessionId}:diagnostics:interval-1`;
  const records: DiagnosticObservation[] = [];
  const current = new Map<string, DiagnosticObservation>();
  const subscribers = new Set<Readonly<{ after: DiagnosticObservationBoundary; observer: (observation: DiagnosticObservation) => void }>>();

  function commit(
    input: DiagnosticObservationInput,
    state: "observed" | "active" | "resolved"
  ): DiagnosticObservation {
    sequence += 1;
    const lifecycle = input.lifecycle.kind === "occurrence"
      ? Object.freeze({ ...input.lifecycle, state: "observed" as const })
      : Object.freeze({ ...input.lifecycle, state: state === "resolved" ? "resolved" as const : "active" as const });
    const observation = Object.freeze({
      ...normalizeInput(input),
      schemaVersion: DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
      ruleVersion: input.ruleVersion ?? 1,
      id: diagnosticObservationId(input),
      lifecycle,
      affected: Object.freeze({ ...input.affected }),
      observationBoundary: Object.freeze({ intervalId, sequence }),
      evidenceBoundary: input.evidenceBoundary ? Object.freeze({ ...input.evidenceBoundary }) : undefined
    });
    records.push(observation);
    current.set(observation.id, observation);
    for (const subscriber of subscribers) {
      if (isStrictlyAfter(observation.observationBoundary, subscriber.after)) subscriber.observer(observation);
    }
    return observation;
  }

  return Object.freeze({
    async observe(input: DiagnosticObservationInput): Promise<DiagnosticObservation> {
      const id = diagnosticObservationId(input);
      const existing = current.get(id);
      if (existing && equivalentActiveObservation(existing, input)) return existing;
      return commit(input, input.lifecycle.kind === "occurrence" ? "observed" : "active");
    },
    async resolveCondition(resolution: DiagnosticConditionResolution): Promise<DiagnosticObservation | null> {
      const id = diagnosticObservationId({
        ...resolution,
        severity: "information",
        lifecycle: { kind: "condition", conditionId: resolution.conditionId },
        observed: "",
        limitation: "",
        consequence: "",
        route: ""
      });
      const existing = current.get(id);
      if (!existing || existing.lifecycle.kind !== "condition" || existing.lifecycle.state === "resolved") return existing ?? null;
      return commit({
        code: existing.code,
        severity: existing.severity,
        lifecycle: { kind: "condition", conditionId: resolution.conditionId },
        affected: existing.affected,
        observedAt: resolution.observedAt,
        evidenceBoundary: resolution.evidenceBoundary,
        observed: existing.observed,
        limitation: existing.limitation,
        consequence: existing.consequence,
        route: existing.route,
        originalCode: existing.originalCode,
        safeMessage: existing.safeMessage
      }, "resolved");
    },
    async query(query: DiagnosticObservationQuery = {}): Promise<DiagnosticObservationRead> {
      const minimum = severityRank(query.minimumSeverity ?? "information");
      const through = query.through ?? Object.freeze({ intervalId, sequence });
      const observations = Object.freeze(records.filter((observation) =>
        (!query.after || isStrictlyAfter(observation.observationBoundary, query.after))
        && isAtOrBefore(observation.observationBoundary, through)
        && (!query.codes || query.codes.includes(observation.code))
        && severityRank(observation.severity) >= minimum
        && (!query.affected || diagnosticAffectedIdentityEquals(observation.affected, query.affected))
      ));
      return Object.freeze({ status: "complete", coverage: "complete", retention: "complete", through, observations });
    },
    async replay(): Promise<readonly DiagnosticObservation[]> {
      return Object.freeze([...records]);
    },
    currentBoundary(): DiagnosticObservationBoundary {
      return Object.freeze({ intervalId, sequence });
    },
    subscribe(after: DiagnosticObservationBoundary, observer: (observation: DiagnosticObservation) => void): () => void {
      const subscription = Object.freeze({ after: Object.freeze({ ...after }), observer });
      subscribers.add(subscription);
      return () => subscribers.delete(subscription);
    }
  });
}

function equivalentActiveObservation(existing: DiagnosticObservation, input: DiagnosticObservationInput): boolean {
  const expectedState = input.lifecycle.kind === "occurrence" ? "observed" : "active";
  return existing.lifecycle.state === expectedState
    && existing.severity === input.severity
    && existing.observedAt === input.observedAt
    && existing.observed === input.observed
    && existing.limitation === input.limitation
    && existing.consequence === input.consequence
    && JSON.stringify(existing.route) === JSON.stringify(input.route)
    && JSON.stringify(existing.resultRef) === JSON.stringify(input.resultRef)
    && existing.originalCode === input.originalCode
    && existing.safeMessage === input.safeMessage
    && JSON.stringify(existing.evidenceBoundary) === JSON.stringify(input.evidenceBoundary);
}

export function diagnosticSeverityRank(severity: DiagnosticSeverity): number {
  return severity === "error" ? 2 : severity === "warning" ? 1 : 0;
}

function severityRank(severity: DiagnosticSeverity): number {
  return diagnosticSeverityRank(severity);
}

export function diagnosticAffectedIdentityEquals(left: DiagnosticAffectedIdentity, right: DiagnosticAffectedIdentity): boolean {
  return affectedIdentity(left) === affectedIdentity(right);
}

export function diagnosticObservationRef(observation: DiagnosticObservation): DiagnosticObservationRef {
  return Object.freeze({
    schemaVersion: observation.schemaVersion,
    id: observation.id,
    code: observation.code,
    ruleVersion: observation.ruleVersion,
    severity: observation.severity,
    lifecycle: observation.lifecycle,
    affected: observation.affected,
    observedAt: observation.observedAt,
    observationBoundary: observation.observationBoundary,
    evidenceBoundary: observation.evidenceBoundary,
    route: observation.route,
    resultRef: observation.resultRef
  });
}

function isStrictlyAfter(value: DiagnosticObservationBoundary, lower: DiagnosticObservationBoundary): boolean {
  return value.intervalId === lower.intervalId && value.sequence > lower.sequence;
}

function isAtOrBefore(value: DiagnosticObservationBoundary, upper: DiagnosticObservationBoundary): boolean {
  return value.intervalId === upper.intervalId && value.sequence <= upper.sequence;
}

function normalizeInput(input: DiagnosticObservationInput): DiagnosticObservationInput {
  assertRuleCode(input.code);
  assertPositiveInteger(input.ruleVersion ?? 1, "Diagnostic rule version");
  assertPositiveInteger(input.observedAt, "Diagnostic observed timestamp", true);
  assertAffected(input.affected);
  assertText(input.observed, DIAGNOSTIC_TEXT_MAX_LENGTH, "observed fact");
  assertText(input.limitation, DIAGNOSTIC_TEXT_MAX_LENGTH, "observation limitation");
  assertText(input.consequence, DIAGNOSTIC_TEXT_MAX_LENGTH, "diagnostic consequence");
  if (input.safeMessage !== undefined) assertText(input.safeMessage, DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH, "safe diagnostic message");
  if (input.originalCode !== undefined && !Number.isSafeInteger(input.originalCode)) throw new Error("Original diagnostic code must be a safe integer.");
  assertRoute(input.route);
  if (input.resultRef) assertResultRef(input.resultRef);
  return input;
}

function assertRuleCode(code: string): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(code) || code.length > DIAGNOSTIC_RULE_CODE_MAX_LENGTH) {
    throw new Error("Diagnostic rule code must be a bounded stable lowercase code.");
  }
}

function assertText(value: string, maximum: number, label: string): void {
  if (!value || [...value].length > maximum) throw new Error(`Diagnostic ${label} must contain 1 to ${maximum} code points.`);
}

function assertComponent(value: string, label: string): void {
  if (!value || [...value].length > DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be a bounded identity component.`);
  }
}

function assertPositiveInteger(value: number, label: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer.`);
}

function assertAffected(affected: DiagnosticAffectedIdentity): void {
  Object.entries(affected).forEach(([key, value]) => {
    if (typeof value === "string") assertComponent(value, `Affected identity ${key}`);
    if (key === "sequence" && typeof value === "number") assertPositiveInteger(value, "Affected Evidence sequence");
  });
}

function assertRoute(route: DiagnosticInspectionRoute): void {
  if (route.kind === "recover") assertComponent(route.action, "Diagnostic recovery action");
  if (route.kind === "inspect-evidence") assertAffected({ kind: "evidence", ...route.evidence });
}

function assertResultRef(ref: DiagnosticResultRef): void {
  Object.entries(ref).forEach(([key, value]) => {
    if (typeof value === "string") assertComponent(value, `Diagnostic result ${key}`);
    if (key === "sequence" && typeof value === "number") assertPositiveInteger(value, "Diagnostic result Evidence sequence");
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
