export const DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTIC_RULE_CODE_MAX_LENGTH = 96;
export const DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH = 128;
export const DIAGNOSTIC_TEXT_MAX_LENGTH = 512;
export const DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH = 256;
export const DIAGNOSTIC_MAX_RETAINED_OBSERVATIONS = 5_000;
export const DIAGNOSTIC_MAX_RETAINED_BYTES = 16 * 1_048_576;

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
  ruleVersion?: number;
  lifecycle?: "occurrence" | "condition";
  minimumSeverity?: DiagnosticSeverity;
  affected?: DiagnosticAffectedIdentity;
}>;

export type DiagnosticObservationFeedPublication =
  | Readonly<{ type: "observation"; observation: DiagnosticObservation }>
  | Readonly<{ type: "status"; status: Exclude<DiagnosticObservationReadStatus, "complete">; boundary: DiagnosticObservationBoundary }>;

export type DiagnosticObservationReadStatus = "complete" | "unsupported" | "retention-gap" | "cleared" | "unavailable" | "closed";
export type DiagnosticObservationRead = Readonly<{
  status: DiagnosticObservationReadStatus;
  coverage: "complete" | "limited" | "unavailable";
  retention: "complete" | "limited" | "cleared" | "unavailable";
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
  subscribe(after: DiagnosticObservationBoundary, observer: (publication: DiagnosticObservationFeedPublication) => void): () => void;
  discardRetainedThrough(boundary: DiagnosticObservationBoundary): Promise<void>;
  clear(): Promise<DiagnosticObservationBoundary>;
  close(): Promise<void>;
}>;

export function createMemoryDiagnosticObservationJournal(
  options: Readonly<{ panelSessionId: string; maxRetainedObservations?: number; maxRetainedBytes?: number }>
): DiagnosticObservationJournal {
  return createDiagnosticObservationJournal(options.panelSessionId, emptyPersistedState(), async () => undefined, () => undefined, options);
}

export function createUnavailableDiagnosticObservationJournal(options: Readonly<{
  panelSessionId: string;
  status: "unsupported" | "unavailable";
}>): DiagnosticObservationJournal {
  assertComponent(options.panelSessionId, "Panel Session identity");
  const boundary = Object.freeze({ intervalId: diagnosticIntervalId(options.panelSessionId, 1), sequence: 0 });
  const rejected = (): never => { throw new Error(`Diagnostic Observation journal is ${options.status}.`); };
  return Object.freeze({
    async observe(): Promise<DiagnosticObservation> { return rejected(); },
    async resolveCondition(): Promise<DiagnosticObservation | null> { return rejected(); },
    async query(query: DiagnosticObservationQuery = {}): Promise<DiagnosticObservationRead> {
      return readWithStatus(options.status, "unavailable", "unavailable", query.through ?? boundary, []);
    },
    async replay(): Promise<readonly DiagnosticObservation[]> { return Object.freeze([]); },
    currentBoundary(): DiagnosticObservationBoundary { return boundary; },
    subscribe(_after: DiagnosticObservationBoundary, observer: (publication: DiagnosticObservationFeedPublication) => void): () => void {
      observer(Object.freeze({ type: "status", status: options.status, boundary }));
      return () => undefined;
    },
    async discardRetainedThrough(): Promise<void> { return rejected(); },
    async clear(): Promise<DiagnosticObservationBoundary> { return rejected(); },
    async close(): Promise<void> { return undefined; }
  });
}

type PersistedDiagnosticState = {
  intervalOrdinal: number;
  sequence: number;
  retainedThrough: number;
  records: DiagnosticObservation[];
};

type DiagnosticIndexedDbOptions = Readonly<{
  panelSessionId: string;
  indexedDB?: IDBFactory;
  maxRetainedObservations?: number;
  maxRetainedBytes?: number;
}>;

export async function openIndexedDbDiagnosticObservationJournal(
  options: DiagnosticIndexedDbOptions
): Promise<DiagnosticObservationJournal> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new Error("IndexedDB is unavailable for Diagnostic Observations.");
  const databaseName = `lsew-diagnostics-v${DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION}-${boundedDatabaseComponent(options.panelSessionId)}`;
  const database = await openDiagnosticDatabase(factory, databaseName);
  const persisted = await readDiagnosticState(database) ?? emptyPersistedState();
  return createDiagnosticObservationJournal(options.panelSessionId, persisted, async (state) => {
    await writeDiagnosticState(database, state);
  }, () => database.close(), options);
}

function emptyPersistedState(): PersistedDiagnosticState {
  return { intervalOrdinal: 1, sequence: 0, retainedThrough: 0, records: [] };
}

function createDiagnosticObservationJournal(
  panelSessionId: string,
  initial: PersistedDiagnosticState,
  persist: (state: PersistedDiagnosticState) => Promise<void>,
  closeStorage: () => void = () => undefined,
  capacity: Readonly<{ maxRetainedObservations?: number; maxRetainedBytes?: number }> = {}
): DiagnosticObservationJournal {
  assertComponent(panelSessionId, "Panel Session identity");
  let intervalOrdinal = initial.intervalOrdinal;
  let sequence = initial.sequence;
  let retainedThrough = initial.retainedThrough;
  let intervalId = diagnosticIntervalId(panelSessionId, intervalOrdinal);
  const records: DiagnosticObservation[] = initial.records.map(freezeObservation);
  const current = new Map<string, DiagnosticObservation>();
  for (const observation of records) current.set(observation.id, observation);
  const subscribers = new Set<Readonly<{ after: DiagnosticObservationBoundary; observer: (publication: DiagnosticObservationFeedPublication) => void }>>();
  let closed = false;
  let mutationTail: Promise<void> = Promise.resolve();
  const maxRetainedObservations = boundedCapacity(capacity.maxRetainedObservations, DIAGNOSTIC_MAX_RETAINED_OBSERVATIONS, "Diagnostic Observation count capacity");
  const maxRetainedBytes = boundedCapacity(capacity.maxRetainedBytes, DIAGNOSTIC_MAX_RETAINED_BYTES, "Diagnostic Observation byte capacity");

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function commit(
    input: DiagnosticObservationInput,
    state: "observed" | "active" | "resolved"
  ): Promise<DiagnosticObservation> {
    assertOpen(closed);
    const normalized = normalizeInput(input);
    const nextSequence = sequence + 1;
    const lifecycle = normalized.lifecycle.kind === "occurrence"
      ? Object.freeze({ ...normalized.lifecycle, state: "observed" as const })
      : Object.freeze({ ...normalized.lifecycle, state: state === "resolved" ? "resolved" as const : "active" as const });
    const observation = freezeObservation({
      ...normalized,
      schemaVersion: DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
      ruleVersion: normalized.ruleVersion ?? 1,
      id: diagnosticObservationId(normalized),
      lifecycle,
      observationBoundary: { intervalId, sequence: nextSequence }
    });
    const retained = retainDiagnosticCapacity([...records, observation], retainedThrough, maxRetainedObservations, maxRetainedBytes);
    await persist({ intervalOrdinal, sequence: nextSequence, retainedThrough: retained.retainedThrough, records: retained.records });
    sequence = nextSequence;
    retainedThrough = retained.retainedThrough;
    records.splice(0, records.length, ...retained.records);
    rebuildCurrent(current, records);
    for (const subscriber of subscribers) {
      if (subscriber.after.intervalId === intervalId && subscriber.after.sequence < retainedThrough) {
        subscriber.observer(Object.freeze({ type: "status", status: "retention-gap", boundary: Object.freeze({ intervalId, sequence: retainedThrough }) }));
      }
      if (isStrictlyAfter(observation.observationBoundary, subscriber.after)) subscriber.observer(Object.freeze({ type: "observation", observation }));
    }
    return observation;
  }

  return Object.freeze({
    observe(input: DiagnosticObservationInput): Promise<DiagnosticObservation> {
      return enqueue(async () => {
        assertOpen(closed);
        normalizeInput(input);
        const id = diagnosticObservationId(input);
        const existing = current.get(id);
        if (existing && input.lifecycle.kind === "occurrence") return existing;
        if (existing && equivalentActiveObservation(existing, input)) return existing;
        return commit(input, input.lifecycle.kind === "occurrence" ? "observed" : "active");
      });
    },
    resolveCondition(resolution: DiagnosticConditionResolution): Promise<DiagnosticObservation | null> {
      return enqueue(async () => {
        assertOpen(closed);
        const id = diagnosticObservationId({
          ...resolution,
          severity: "information",
          lifecycle: { kind: "condition", conditionId: resolution.conditionId },
          observed: "",
          limitation: "",
          consequence: "",
          route: { kind: "inspect-affected" }
        });
        const existing = current.get(id);
        if (!existing || existing.lifecycle.kind !== "condition" || existing.lifecycle.state === "resolved") return existing ?? null;
        return commit({
          code: existing.code,
          ruleVersion: existing.ruleVersion,
          severity: existing.severity,
          lifecycle: { kind: "condition", conditionId: resolution.conditionId },
          affected: existing.affected,
          observedAt: resolution.observedAt,
          evidenceBoundary: resolution.evidenceBoundary,
          observed: existing.observed,
          limitation: existing.limitation,
          consequence: existing.consequence,
          route: existing.route,
          resultRef: existing.resultRef,
          originalCode: existing.originalCode,
          safeMessage: existing.safeMessage
        }, "resolved");
      });
    },
    async query(query: DiagnosticObservationQuery = {}): Promise<DiagnosticObservationRead> {
      const through = query.through ?? Object.freeze({ intervalId, sequence });
      if (closed) return readWithStatus("closed", "unavailable", "unavailable", through, []);
      if ((query.after && query.after.intervalId !== intervalId) || through.intervalId !== intervalId) {
        return readWithStatus("cleared", "limited", "cleared", through, []);
      }
      const minimum = severityRank(query.minimumSeverity ?? "information");
      const observations = Object.freeze(records.filter((observation) =>
        (!query.after || isStrictlyAfter(observation.observationBoundary, query.after))
        && isAtOrBefore(observation.observationBoundary, through)
        && (!query.codes || query.codes.includes(observation.code))
        && (query.ruleVersion === undefined || observation.ruleVersion === query.ruleVersion)
        && (!query.lifecycle || observation.lifecycle.kind === query.lifecycle)
        && severityRank(observation.severity) >= minimum
        && (!query.affected || diagnosticAffectedIdentityEquals(observation.affected, query.affected))
      ));
      const gap = (query.after?.sequence ?? 0) < retainedThrough;
      return readWithStatus(gap ? "retention-gap" : "complete", gap ? "limited" : "complete", gap ? "limited" : "complete", through, observations);
    },
    async replay(): Promise<readonly DiagnosticObservation[]> {
      return Object.freeze([...records]);
    },
    currentBoundary(): DiagnosticObservationBoundary {
      return Object.freeze({ intervalId, sequence });
    },
    subscribe(after: DiagnosticObservationBoundary, observer: (publication: DiagnosticObservationFeedPublication) => void): () => void {
      assertOpen(closed);
      const subscription = Object.freeze({ after: Object.freeze({ ...after }), observer });
      subscribers.add(subscription);
      if (after.intervalId !== intervalId) {
        observer(Object.freeze({ type: "status", status: "cleared", boundary: Object.freeze({ intervalId, sequence }) }));
      } else {
        if (after.sequence < retainedThrough) {
          observer(Object.freeze({ type: "status", status: "retention-gap", boundary: Object.freeze({ intervalId, sequence: retainedThrough }) }));
        }
        for (const observation of records) {
          if (isStrictlyAfter(observation.observationBoundary, after)) observer(Object.freeze({ type: "observation", observation }));
        }
      }
      return () => subscribers.delete(subscription);
    },
    discardRetainedThrough(boundary: DiagnosticObservationBoundary): Promise<void> {
      return enqueue(async () => {
        assertOpen(closed);
        if (boundary.intervalId !== intervalId) return;
        const nextRetainedThrough = Math.max(retainedThrough, Math.min(boundary.sequence, sequence));
        const nextRecords = records.filter((observation) => observation.observationBoundary.sequence > nextRetainedThrough);
        await persist({ intervalOrdinal, sequence, retainedThrough: nextRetainedThrough, records: nextRecords });
        retainedThrough = nextRetainedThrough;
        records.splice(0, records.length, ...nextRecords);
        rebuildCurrent(current, records);
        for (const subscriber of subscribers) {
          if (subscriber.after.intervalId === intervalId && subscriber.after.sequence < retainedThrough) {
            subscriber.observer(Object.freeze({ type: "status", status: "retention-gap", boundary: Object.freeze({ intervalId, sequence: retainedThrough }) }));
          }
        }
      });
    },
    clear(): Promise<DiagnosticObservationBoundary> {
      return enqueue(async () => {
        assertOpen(closed);
        const nextIntervalOrdinal = intervalOrdinal + 1;
        const nextIntervalId = diagnosticIntervalId(panelSessionId, nextIntervalOrdinal);
        await persist({ intervalOrdinal: nextIntervalOrdinal, sequence: 0, retainedThrough: 0, records: [] });
        intervalOrdinal = nextIntervalOrdinal;
        intervalId = nextIntervalId;
        sequence = 0;
        retainedThrough = 0;
        records.splice(0);
        current.clear();
        for (const subscriber of subscribers) {
          subscriber.observer(Object.freeze({ type: "status", status: "cleared", boundary: Object.freeze({ intervalId, sequence }) }));
        }
        return Object.freeze({ intervalId, sequence });
      });
    },
    close(): Promise<void> {
      return enqueue(async () => {
        if (closed) return;
        for (const subscriber of subscribers) {
          subscriber.observer(Object.freeze({ type: "status", status: "closed", boundary: Object.freeze({ intervalId, sequence }) }));
        }
        subscribers.clear();
        closeStorage();
        closed = true;
      });
    }
  });
}

function readWithStatus(
  status: DiagnosticObservationReadStatus,
  coverage: DiagnosticObservationRead["coverage"],
  retention: DiagnosticObservationRead["retention"],
  through: DiagnosticObservationBoundary,
  observations: readonly DiagnosticObservation[]
): DiagnosticObservationRead {
  return Object.freeze({ status, coverage, retention, through: Object.freeze({ ...through }), observations: Object.freeze([...observations]) });
}

function diagnosticIntervalId(panelSessionId: string, ordinal: number): string {
  return `${panelSessionId}:diagnostics:interval-${ordinal}`;
}

function rebuildCurrent(current: Map<string, DiagnosticObservation>, records: readonly DiagnosticObservation[]): void {
  current.clear();
  for (const observation of records) current.set(observation.id, observation);
}

function boundedCapacity(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  assertPositiveInteger(resolved, label);
  return resolved;
}

function retainDiagnosticCapacity(
  candidate: DiagnosticObservation[],
  previousRetainedThrough: number,
  maximumCount: number,
  maximumBytes: number
): Readonly<{ records: DiagnosticObservation[]; retainedThrough: number }> {
  let retainedThrough = previousRetainedThrough;
  let bytes = candidate.reduce((total, observation) => total + new TextEncoder().encode(JSON.stringify(observation)).byteLength, 0);
  while (candidate.length > maximumCount || bytes > maximumBytes) {
    const removed = candidate.shift();
    if (!removed) break;
    bytes -= new TextEncoder().encode(JSON.stringify(removed)).byteLength;
    retainedThrough = Math.max(retainedThrough, removed.observationBoundary.sequence);
  }
  return { records: candidate, retainedThrough };
}

function equivalentActiveObservation(existing: DiagnosticObservation, input: DiagnosticObservationInput): boolean {
  const expectedState = input.lifecycle.kind === "occurrence" ? "observed" : "active";
  return existing.lifecycle.state === expectedState
    && existing.severity === input.severity
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
  const lifecycleId = input.lifecycle.kind === "occurrence" ? input.lifecycle.occurrenceId : input.lifecycle.conditionId;
  assertComponent(lifecycleId, "Diagnostic lifecycle identity");
  if (input.evidenceBoundary) assertAffected({ kind: "evidence", ...input.evidenceBoundary });
  assertText(input.observed, DIAGNOSTIC_TEXT_MAX_LENGTH, "observed fact");
  assertText(input.limitation, DIAGNOSTIC_TEXT_MAX_LENGTH, "observation limitation");
  assertText(input.consequence, DIAGNOSTIC_TEXT_MAX_LENGTH, "diagnostic consequence");
  if (input.safeMessage !== undefined) assertText(input.safeMessage, DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH, "safe diagnostic message");
  if (input.originalCode !== undefined && !Number.isSafeInteger(input.originalCode)) throw new Error("Original diagnostic code must be a safe integer.");
  assertRoute(input.route);
  if (input.resultRef) assertResultRef(input.resultRef);
  return Object.freeze({
    code: input.code,
    ruleVersion: input.ruleVersion,
    severity: input.severity,
    lifecycle: Object.freeze({ ...input.lifecycle }),
    affected: Object.freeze({ ...input.affected }),
    observedAt: input.observedAt,
    evidenceBoundary: input.evidenceBoundary ? Object.freeze({ ...input.evidenceBoundary }) : undefined,
    observed: input.observed,
    limitation: input.limitation,
    consequence: input.consequence,
    route: freezeRoute(input.route),
    resultRef: input.resultRef ? Object.freeze({ ...input.resultRef }) : undefined,
    originalCode: input.originalCode,
    safeMessage: input.safeMessage
  });
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
    ? `occurrence:${encodeURIComponent(input.lifecycle.occurrenceId)}`
    : `condition:${encodeURIComponent(input.lifecycle.conditionId)}`;
  return `diag:${input.code}:${lifecycleId}:${affectedIdentity(input.affected)}`;
}

function affectedIdentity(affected: DiagnosticAffectedIdentity): string {
  const part = (value: string | number): string => encodeURIComponent(String(value));
  switch (affected.kind) {
    case "page": return `page:${part(affected.pageId)}`;
    case "client": return `client:${part(affected.pageId)}:${part(affected.clientId)}`;
    case "session": return `session:${part(affected.pageId)}:${part(affected.clientId)}:${part(affected.sessionId)}`;
    case "subscription": return `subscription:${part(affected.pageId)}:${part(affected.clientId)}:${part(affected.sessionId ?? "-")}:${part(affected.subscriptionId)}`;
    case "item": return `item:${part(affected.pageId)}:${part(affected.clientId)}:${part(affected.subscriptionId)}:${part(affected.item)}`;
    case "evidence": return `evidence:${part(affected.intervalId)}:${part(affected.sequence)}:${part(affected.eventId)}`;
  }
}

function freezeRoute(route: DiagnosticInspectionRoute): DiagnosticInspectionRoute {
  return route.kind === "inspect-evidence"
    ? Object.freeze({ kind: route.kind, evidence: Object.freeze({ ...route.evidence }) })
    : Object.freeze({ ...route });
}

function freezeObservation(observation: DiagnosticObservation): DiagnosticObservation {
  return Object.freeze({
    ...observation,
    lifecycle: Object.freeze({ ...observation.lifecycle }),
    affected: Object.freeze({ ...observation.affected }),
    observationBoundary: Object.freeze({ ...observation.observationBoundary }),
    evidenceBoundary: observation.evidenceBoundary ? Object.freeze({ ...observation.evidenceBoundary }) : undefined,
    route: freezeRoute(observation.route),
    resultRef: observation.resultRef ? Object.freeze({ ...observation.resultRef }) : undefined
  });
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error("Diagnostic Observation journal is closed.");
}

function boundedDatabaseComponent(value: string): string {
  assertComponent(value, "Panel Session identity");
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function openDiagnosticDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("diagnosticState")) request.result.createObjectStore("diagnosticState");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Diagnostic Observation journal."));
  });
}

function readDiagnosticState(database: IDBDatabase): Promise<PersistedDiagnosticState | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("diagnosticState", "readonly");
    const request = transaction.objectStore("diagnosticState").get("state");
    request.onsuccess = () => resolve((request.result as PersistedDiagnosticState | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read Diagnostic Observations."));
  });
}

function writeDiagnosticState(database: IDBDatabase, state: PersistedDiagnosticState): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("diagnosticState", "readwrite");
    transaction.objectStore("diagnosticState").put(state, "state");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not persist Diagnostic Observations."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Diagnostic Observation persistence was aborted."));
  });
}
