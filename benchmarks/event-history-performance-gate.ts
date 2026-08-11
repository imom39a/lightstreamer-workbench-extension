export const PERFORMANCE_GATE_SCHEMA_VERSION = 2;
export const SAMPLE_COUNT = 3;
export const MIB = 1_048_576;

export const EVENT_HISTORY_PERFORMANCE_LIMITS = {
  indexeddb: {
    sustainedVisibleP95Ms: 100,
    burstFinalBoundaryVisibleMs: 30_000,
    heapDeltaBytes: 8 * MIB,
    heapEventCount: 10_000
  },
  memory: {
    sustainedVisibleP95Ms: 50,
    burstFinalBoundaryVisibleMs: 1_000,
    heapDeltaBytes: 32 * MIB,
    heapEventCount: 5_000
  },
  query: {
    recentPageP95Ms: 50,
    structuredIndexedP95Ms: 100,
    findFullP95Ms: 500,
    longTaskLimitMs: 125,
    relativeRegression: 0.2
  }
} as const;

export const TERMINAL_PENDING_BYTE_EVENT_COUNT = 17;
export const CHECKPOINT_LIVE_CAPTURE_MIN_EVENTS_PER_SECOND = 50;
export const TERMINAL_PENDING_BYTE_ACCEPTED_COUNT = 16;

export type EventHistoryPerformanceAdapter = "indexeddb" | "memory";
export type EventHistoryPerformanceWorkload = "sustained" | "burst";
export type EventHistoryPerformanceShape =
  | "small-lifecycle"
  | "ordinary-item-update"
  | "large-json-rich";

export type EventHistoryPerformanceIdentityEvidence = Readonly<{
  expectedEventIds: readonly string[];
  retainedEventIds: readonly string[];
  publishedEventIds: readonly string[];
}>;

export type EventHistoryPerformanceStorageEstimate = Readonly<{
  source: "navigator.storage.estimate";
  status: "AVAILABLE" | "UNAVAILABLE";
  usageBytes: number | null;
  quotaBytes: number | null;
  failure: Readonly<{ code: string; message: string }> | null;
}>;

export type EventHistoryPerformanceLongTaskReason =
  | Readonly<{ reason: "no-overlap"; startTime: number; duration: number }>
  | Readonly<{ reason: "ambiguous"; overlaps: readonly Readonly<{ phase: "capture" | "commit" | "paint" | "query"; duration: number }>[] }>;

export type EventHistoryPerformanceCell = Readonly<{
  adapter: EventHistoryPerformanceAdapter;
  workload: EventHistoryPerformanceWorkload;
  shape: EventHistoryPerformanceShape;
  sample: number;
  correctness: Readonly<{
    retainedMatchesAccepted: boolean;
    publicationMatchesAccepted: boolean;
    retainedInOrder: boolean;
    publicationInOrder: boolean;
    finalBoundaryCorrect: boolean;
    terminalOutcomeCorrect: boolean;
  }>;
  latency: Readonly<{
    offerToPublicationP95Ms: number;
    offerToVisibleFrameP95Ms: number;
    committedBoundaryToVisibleFrameP95Ms: number;
    finalBoundaryVisibleMs: number | null;
    behindBacklogMs: number;
    recentPageP95Ms: number;
    structuredIndexedP95Ms: number;
    findFullP95Ms: number;
  }>;
  longTasks: Readonly<{
    supported: boolean;
    unattributed: number;
    capture: readonly number[];
    commit: readonly number[];
    paint: readonly number[];
    query: readonly number[];
    unattributedReasons: readonly EventHistoryPerformanceLongTaskReason[];
  }>;
  identityEvidence: EventHistoryPerformanceIdentityEvidence;
  storage: Readonly<{
    transactionCount: number;
    readwriteTransactionCount: number;
    readonlyTransactionCount: number;
    evidenceWriteCount: number;
    controlWriteCount: number;
    facetEntryCount: number;
    indexEntryCount: number;
  }>;
  storageEstimate: EventHistoryPerformanceStorageEstimate;
  accepted: number;
  published: number;
  retained: number;
  workloadFacts: Readonly<{
    expectedCount: number;
    offeredEventsPerSecond: number;
    shapeBytes: number;
    persistedJsonBytes: number;
    indexedDbWritesPerEvent: number;
    searchTokenCount: number;
  }>;
  pressure: Readonly<{
    maxPendingBytes: number;
    maxOldestPendingAgeMs: number;
    transitions: readonly string[];
    limits: Readonly<{ retainedCount: number; retainedBytes: number; pendingBytes: number; pendingAgeMs: number }>;
  }>;
  terminal: Readonly<{
    phase: "RUNNING" | "STOPPED";
    reason: string | null;
    committedEvidenceBoundary: Readonly<{ sequence: number; eventId: string }> | null;
    firstMissingEventId: string | null;
    refusedCount: number;
    discardedCount: number;
  }>;
}>;

export type EventHistoryPerformanceHeapSample = Readonly<{
  adapter: EventHistoryPerformanceAdapter;
  sample: number;
  eventCount: number;
  sessionId: string | null;
  databaseName: string | null;
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }> | null;
  postGcHeapDeltaBytes: number | null;
}>;

export type EventHistoryPerformanceHeapRun = Readonly<{
  adapter: EventHistoryPerformanceAdapter;
  phase: "warmup" | "cleanup";
  sample: number | null;
  eventCount: number;
  retained: number | null;
  sessionId: string | null;
  databaseName: string | null;
  close: Readonly<Record<string, unknown>> | null;
  rootRemoved: boolean;
  frameYielded: boolean;
  gcPasses: number | null;
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }> | null;
}>;

export type EventHistoryPerformanceTerminalScenario = Readonly<{
  adapter: EventHistoryPerformanceAdapter;
  trigger: "PENDING_BYTES" | "PENDING_AGE";
  tier: "NORMAL" | "LOWER";
  terminalReason: "PENDING_BYTE_LIMIT" | "PENDING_AGE_LIMIT";
  terminalReasonCorrect: boolean;
  offeredEventIds: readonly string[];
  acceptedEventIds: readonly string[];
  retainedEventIds: readonly string[];
  publishedEventIds: readonly string[];
  refusedEventIds: readonly string[];
  acceptedCount: number;
  refusedCount: number;
  firstMissingEventId: string;
  committedBoundary: Readonly<{ sequence: number; eventId: string }>;
  terminalPublicationCount: number;
  finalBoundaryCorrect: boolean;
  refusedIdentityCorrect: boolean;
  exactOneTerminalPublication: boolean;
  pressureTransitions: readonly string[];
}>;

export type EventHistoryPerformanceCheckpointScenario = Readonly<{
  name: "representative" | "maximum-2MiB";
  adapter: EventHistoryPerformanceAdapter;
  accepted: boolean;
  retained: number;
  trafficBefore: number;
  trafficAfter: number;
  liveCaptureEventIds: readonly string[];
  retainedEventIds: readonly string[];
  publishedEventIds: readonly string[];
  liveCaptureCount: number;
  liveCaptureStartedAtMs: number;
  liveCaptureEndedAtMs: number;
  liveCaptureDurationMs: number;
  checkpointStagingStartedAtMs: number;
  checkpointStagingEndedAtMs: number;
  checkpointStagingDurationMs: number;
  liveCaptureOverlapMs: number;
  liveCaptureOverlapEventCount: number;
  liveCaptureRateEventsPerSecond: number;
  liveCaptureRateSatisfied: boolean;
  interleavedWhileStaging: boolean;
  canonicalBytes: number;
  committedBoundaryCorrect: boolean;
  batchAcceptedAsOneOversizedUnit: boolean;
}>;

export type EventHistoryPerformanceEnvironment = Readonly<{
  chromeMajor: number;
  platformClass: string;
  architectureClass: string;
  headless: false;
}>;

export type EventHistoryPerformanceReport = Readonly<{
  schemaVersion: typeof PERFORMANCE_GATE_SCHEMA_VERSION;
  source: Readonly<{ revision: string; dirty: false }>;
  environment: EventHistoryPerformanceEnvironment;
  cells: readonly EventHistoryPerformanceCell[];
  terminalScenarios: readonly EventHistoryPerformanceTerminalScenario[];
  checkpointScenarios: readonly EventHistoryPerformanceCheckpointScenario[];
  heapSamples: readonly EventHistoryPerformanceHeapSample[];
  heapRuns: readonly EventHistoryPerformanceHeapRun[];
  lifecycle: Readonly<{
    retainedHeapBytes: readonly number[];
    strictMonotonicGrowth: boolean;
  }>;
}>;

export type EventHistoryPerformanceReference = Readonly<{
  schemaVersion: typeof PERFORMANCE_GATE_SCHEMA_VERSION;
  referenceVersion: string;
  disposition: "ACCEPTED_INITIAL_CLEAN_REFERENCE";
  rationale: string;
  environment: Pick<EventHistoryPerformanceEnvironment, "chromeMajor" | "platformClass" | "architectureClass">;
  cells: readonly EventHistoryPerformanceCell[];
}>;

export type PerformanceGateVerdict = "PASS" | "REVIEW" | "FAIL";

export type PerformanceGateDecision = Readonly<{
  verdict: PerformanceGateVerdict;
  failures: readonly string[];
  reviewReasons: readonly string[];
  checkedCells: number;
  checkedSamples: number;
}>;

const ADAPTERS: readonly EventHistoryPerformanceAdapter[] = ["indexeddb", "memory"];
const WORKLOADS: readonly EventHistoryPerformanceWorkload[] = ["sustained", "burst"];
const SHAPES: readonly EventHistoryPerformanceShape[] = [
  "small-lifecycle",
  "ordinary-item-update",
  "large-json-rich"
];

export function classifyEventHistoryPerformance(
  report: unknown,
  reference?: unknown
): PerformanceGateDecision {
  const failures: string[] = [];
  const reviewReasons: string[] = [];
  const expectedKeys = expectedMatrixKeys();
  const cellsByKey = new Map<string, EventHistoryPerformanceCell[]>();

  if (!isRecord(report)) return failedDecision("Missing or malformed performance report telemetry.");
  if (report.schemaVersion !== PERFORMANCE_GATE_SCHEMA_VERSION) {
    failures.push(`Unsupported report schema: ${String(report.schemaVersion)}.`);
  }
  if (!isPerformanceReport(report)) failures.push("Missing or malformed performance report telemetry.");
  if (failures.length > 0) return decision(failures, reviewReasons, 0, 0);
  const validReport = report as unknown as EventHistoryPerformanceReport;
  if (validReport.source.dirty !== false) failures.push("The performance report was not generated from a clean source revision.");
  if (validReport.environment.headless !== false) {
    failures.push("The performance proof must run in visible Chrome.");
  }
  if (validReport.environment.chromeMajor !== 151) {
    failures.push(`The performance proof must use Chrome for Testing 151, got ${validReport.environment.chromeMajor}.`);
  }
  if (validReport.cells.length !== expectedKeys.size * SAMPLE_COUNT) {
    failures.push(
      `Expected ${expectedKeys.size * SAMPLE_COUNT} matrix samples, received ${validReport.cells.length}.`
    );
  }

  for (const cell of validReport.cells) {
    const key = cellKey(cell);
    const samples = cellsByKey.get(key) ?? [];
    samples.push(cell);
    cellsByKey.set(key, samples);
    validateCell(cell, failures);
    validateStorageTelemetry(cell, failures);
  }

  for (const key of expectedKeys) {
    const samples = cellsByKey.get(key) ?? [];
    const sampleNumbers = samples.map((sample) => sample.sample).sort((left, right) => left - right);
    if (samples.length !== SAMPLE_COUNT || sampleNumbers.join(",") !== "1,2,3") {
      failures.push(`Matrix cell ${key} must contain exactly independent samples 1, 2, and 3.`);
    }
  }

  for (const sample of validReport.cells) {
    const label = cellLabel(sample);
    const limit = EVENT_HISTORY_PERFORMANCE_LIMITS[sample.adapter];
    if (sample.workload === "sustained" && sample.latency.offerToVisibleFrameP95Ms > limit.sustainedVisibleP95Ms) {
      failures.push(`${label} sustained offer-to-visible p95 exceeds ${limit.sustainedVisibleP95Ms} ms.`);
    }
    if (sample.workload === "burst") {
      if (sample.latency.finalBoundaryVisibleMs === null) {
        failures.push(`${label} has no final-boundary visible timing.`);
      } else if (sample.latency.finalBoundaryVisibleMs > limit.burstFinalBoundaryVisibleMs) {
        failures.push(`${label} burst final boundary exceeds ${limit.burstFinalBoundaryVisibleMs} ms.`);
      }
    }
    if (sample.latency.recentPageP95Ms > EVENT_HISTORY_PERFORMANCE_LIMITS.query.recentPageP95Ms) {
      failures.push(`${label} recent-page p95 exceeds 50 ms.`);
    }
    if (sample.latency.structuredIndexedP95Ms > EVENT_HISTORY_PERFORMANCE_LIMITS.query.structuredIndexedP95Ms) {
      failures.push(`${label} structured/indexed p95 exceeds 100 ms.`);
    }
    if (sample.latency.findFullP95Ms > EVENT_HISTORY_PERFORMANCE_LIMITS.query.findFullP95Ms) {
      failures.push(`${label} Find/full p95 exceeds 500 ms.`);
    }
    for (const phase of ["capture", "commit", "paint"] as const) {
      if (sample.longTasks[phase].some((duration) => duration > 50)) {
        failures.push(`${label} has a capture/commit/paint Long Task over 50 ms.`);
      }
    }
    if (!sample.longTasks.supported) failures.push(`${label} does not have supported Long Task telemetry.`);
    if (sample.longTasks.unattributed !== 0) failures.push(`${label} has unattributed Long Task telemetry.`);
    const queryLongTasks = sample.longTasks.query.filter((duration) => duration > 50);
    if (queryLongTasks.some((duration) => duration > EVENT_HISTORY_PERFORMANCE_LIMITS.query.longTaskLimitMs)) {
      failures.push(`${label} has a query Long Task over 125 ms.`);
    }
    const allowedQueryLongTasks = sample.shape === "large-json-rich" ? 1 : 0;
    if (queryLongTasks.length > allowedQueryLongTasks) {
      failures.push(`${label} has too many query Long Tasks over 50 ms.`);
    }
    for (const [name, value] of Object.entries(sample.correctness)) {
      if (value !== true) failures.push(`${label} correctness field ${name} is false.`);
    }
  }

  const heapByAdapter = new Map<EventHistoryPerformanceAdapter, EventHistoryPerformanceHeapSample[]>();
  for (const sample of validReport.heapSamples) {
    const entries = heapByAdapter.get(sample.adapter) ?? [];
    entries.push(sample);
    heapByAdapter.set(sample.adapter, entries);
  }
  for (const adapter of ADAPTERS) {
    const entries = heapByAdapter.get(adapter) ?? [];
    const limit = EVENT_HISTORY_PERFORMANCE_LIMITS[adapter];
    if (entries.length !== SAMPLE_COUNT) {
      failures.push(`Expected three ${adapter} post-GC heap samples.`);
    }
    if (entries.map((entry) => entry.sample).sort((left, right) => left - right).join(",") !== "1,2,3") {
      failures.push(`${adapter} post-GC heap samples must be independent samples 1, 2, and 3.`);
    }
    for (const sample of entries) {
      if (sample.eventCount !== limit.heapEventCount) {
        failures.push(`${adapter} heap sample must contain ${limit.heapEventCount} events.`);
      }
      if (sample.status !== "PASS") {
        failures.push(`${adapter} heap sample ${sample.sample} failed: ${sample.failure?.code ?? "unknown"}: ${sample.failure?.message ?? "missing failure details"}.`);
      }
      if (sample.status === "PASS" && (sample.postGcHeapDeltaBytes === null || sample.postGcHeapDeltaBytes > limit.heapDeltaBytes)) {
        failures.push(`${adapter} post-GC heap delta exceeds ${limit.heapDeltaBytes} bytes.`);
      }
    }
  }
  validateHeapRuns(validReport.heapRuns, validReport.heapSamples, failures);
  validateTerminalScenarios(validReport.terminalScenarios, failures);
  validateCheckpointScenarios(validReport.checkpointScenarios, failures);
  if (validReport.lifecycle.strictMonotonicGrowth) {
    failures.push("Panel Session lifecycle samples show strict monotonic retained-heap growth.");
  }

  if (reference === undefined) {
    failures.push("No separately pinned reference was supplied; a report cannot self-adopt as its reference.");
  } else if (!isPerformanceReference(reference)) {
    failures.push("Missing, malformed, empty, or pending pinned reference telemetry.");
  } else if (failures.length === 0) {
    compareReference(validReport, reference, reviewReasons);
  }

  return decision(failures, reviewReasons, expectedKeys.size, validReport.cells.length);
}

export function validateEventHistoryPerformanceReference(value: unknown): value is EventHistoryPerformanceReference {
  return isPerformanceReference(value);
}

function decision(
  failures: readonly string[],
  reviewReasons: readonly string[],
  checkedCells: number,
  checkedSamples: number
): PerformanceGateDecision {
  return {
    verdict: failures.length > 0 ? "FAIL" : reviewReasons.length > 0 ? "REVIEW" : "PASS",
    failures: Object.freeze([...failures]),
    reviewReasons: Object.freeze([...reviewReasons]),
    checkedCells,
    checkedSamples
  };
}

function failedDecision(message: string): PerformanceGateDecision {
  return decision([message], [], 0, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isPerformanceReport(value: Record<string, unknown>): value is EventHistoryPerformanceReport {
  const source = value.source;
  const environment = value.environment;
  const lifecycle = value.lifecycle;
  const valid = value.schemaVersion === PERFORMANCE_GATE_SCHEMA_VERSION
    && isRecord(source) && typeof source.revision === "string" && source.revision.length > 0 && isBoolean(source.dirty)
    && isRecord(environment) && environment.chromeMajor === 151 && typeof environment.platformClass === "string"
    && typeof environment.architectureClass === "string" && environment.headless === false
    && Array.isArray(value.cells) && value.cells.every(isPerformanceCell)
    && Array.isArray(value.terminalScenarios) && value.terminalScenarios.every(isTerminalScenario)
    && Array.isArray(value.checkpointScenarios) && value.checkpointScenarios.every(isCheckpointScenario)
    && Array.isArray(value.heapSamples) && value.heapSamples.every(isHeapSample)
    && Array.isArray(value.heapRuns) && value.heapRuns.every(isHeapRun)
    && isRecord(lifecycle) && Array.isArray(lifecycle.retainedHeapBytes)
    && lifecycle.retainedHeapBytes.length === SAMPLE_COUNT && lifecycle.retainedHeapBytes.every(isFiniteNumber)
    && isBoolean(lifecycle.strictMonotonicGrowth);
  return valid;
}

function isTerminalScenario(value: unknown): value is EventHistoryPerformanceTerminalScenario {
  if (!isRecord(value) || !ADAPTERS.includes(value.adapter as EventHistoryPerformanceAdapter)
    || !["PENDING_BYTES", "PENDING_AGE"].includes(value.trigger as string)
    || !["NORMAL", "LOWER"].includes(value.tier as string)
    || !["PENDING_BYTE_LIMIT", "PENDING_AGE_LIMIT"].includes(value.terminalReason as string)
    || !Array.isArray(value.offeredEventIds) || value.offeredEventIds.length === 0 || !value.offeredEventIds.every((id) => typeof id === "string" && id.length > 0)
    || !Array.isArray(value.acceptedEventIds) || value.acceptedEventIds.length === 0 || !value.acceptedEventIds.every((id) => typeof id === "string" && id.length > 0)
    || !Array.isArray(value.retainedEventIds) || value.retainedEventIds.length === 0 || !value.retainedEventIds.every((id) => typeof id === "string" && id.length > 0)
    || !Array.isArray(value.publishedEventIds) || value.publishedEventIds.length === 0 || !value.publishedEventIds.every((id) => typeof id === "string" && id.length > 0)
    || !Number.isSafeInteger(value.acceptedCount) || (value.acceptedCount as number) < 1
    || !Number.isSafeInteger(value.refusedCount) || (value.refusedCount as number) < 1
    || !Array.isArray(value.refusedEventIds) || value.refusedEventIds.length === 0 || !value.refusedEventIds.every((id) => typeof id === "string" && id.length > 0)
    || typeof value.firstMissingEventId !== "string" || value.firstMissingEventId.length === 0
    || !Number.isSafeInteger(value.terminalPublicationCount) || (value.terminalPublicationCount as number) < 0
    || !isBoolean(value.terminalReasonCorrect) || !isBoolean(value.finalBoundaryCorrect) || !isBoolean(value.refusedIdentityCorrect)
    || !isBoolean(value.exactOneTerminalPublication) || !Array.isArray(value.pressureTransitions)
    || !value.pressureTransitions.every((entry) => typeof entry === "string")) return false;
  if (!isRecord(value.committedBoundary) || !Number.isSafeInteger(value.committedBoundary.sequence) || typeof value.committedBoundary.eventId !== "string" || value.committedBoundary.eventId.length === 0) return false;
  return true;
}

function isCheckpointScenario(value: unknown): value is EventHistoryPerformanceCheckpointScenario {
  return isRecord(value) && ["representative", "maximum-2MiB"].includes(value.name as string)
    && ADAPTERS.includes(value.adapter as EventHistoryPerformanceAdapter)
    && isBoolean(value.accepted) && Number.isSafeInteger(value.retained) && (value.retained as number) >= 0
    && Number.isSafeInteger(value.trafficBefore) && (value.trafficBefore as number) >= 1
    && Number.isSafeInteger(value.trafficAfter) && (value.trafficAfter as number) >= 1
    && Array.isArray(value.liveCaptureEventIds) && value.liveCaptureEventIds.length > 0
    && value.liveCaptureEventIds.every((id) => typeof id === "string" && id.length > 0)
    && Array.isArray(value.retainedEventIds) && value.retainedEventIds.length > 0
    && value.retainedEventIds.every((id) => typeof id === "string" && id.length > 0)
    && Array.isArray(value.publishedEventIds) && value.publishedEventIds.length > 0
    && value.publishedEventIds.every((id) => typeof id === "string" && id.length > 0)
    && Number.isSafeInteger(value.liveCaptureCount) && (value.liveCaptureCount as number) > 0
    && isFiniteNumber(value.liveCaptureStartedAtMs) && isFiniteNumber(value.liveCaptureEndedAtMs)
    && isFiniteNumber(value.liveCaptureDurationMs) && (value.liveCaptureDurationMs as number) > 0
    && isFiniteNumber(value.checkpointStagingStartedAtMs) && isFiniteNumber(value.checkpointStagingEndedAtMs)
    && isFiniteNumber(value.checkpointStagingDurationMs) && (value.checkpointStagingDurationMs as number) > 0
    && isFiniteNumber(value.liveCaptureOverlapMs) && (value.liveCaptureOverlapMs as number) >= 0
    && Number.isSafeInteger(value.liveCaptureOverlapEventCount) && (value.liveCaptureOverlapEventCount as number) >= 0
    && isFiniteNumber(value.liveCaptureRateEventsPerSecond) && (value.liveCaptureRateEventsPerSecond as number) >= 0
    && isBoolean(value.liveCaptureRateSatisfied) && isBoolean(value.interleavedWhileStaging)
    && Number.isSafeInteger(value.canonicalBytes) && (value.canonicalBytes as number) > 0
    && isBoolean(value.committedBoundaryCorrect) && isBoolean(value.batchAcceptedAsOneOversizedUnit);
}

function validateTerminalScenarios(
  scenarios: readonly EventHistoryPerformanceTerminalScenario[],
  failures: string[]
): void {
  for (const adapter of ADAPTERS) for (const trigger of ["PENDING_BYTES", "PENDING_AGE"] as const) {
    const matches = scenarios.filter((scenario) => scenario.adapter === adapter && scenario.trigger === trigger);
    if (matches.length !== 1) {
      failures.push(`Expected exactly one ${adapter}/${trigger} terminal scenario.`);
      continue;
    }
    const scenario = matches[0]!;
    if (scenario.terminalReason !== (trigger === "PENDING_BYTES" ? "PENDING_BYTE_LIMIT" : "PENDING_AGE_LIMIT") || !scenario.terminalReasonCorrect) failures.push(`${adapter}/${trigger} reported the wrong terminal reason.`);
    if (!scenario.finalBoundaryCorrect || !scenario.refusedIdentityCorrect || !scenario.exactOneTerminalPublication || scenario.terminalPublicationCount !== 1) failures.push(`${adapter}/${trigger} did not prove terminal identity, final boundary, and exactly-one publication.`);
    const offeredIds = scenario.offeredEventIds;
    const acceptedIds = scenario.acceptedEventIds;
    const retainedIds = scenario.retainedEventIds;
    const publishedIds = scenario.publishedEventIds;
    const refusedIds = scenario.refusedEventIds;
    if (scenario.acceptedCount !== acceptedIds.length || scenario.refusedCount !== refusedIds.length || scenario.refusedCount < 1) failures.push(`${adapter}/${trigger} accepted/refused-event accounting is incomplete.`);
    if (new Set(offeredIds).size !== offeredIds.length || new Set(acceptedIds).size !== acceptedIds.length || new Set(retainedIds).size !== retainedIds.length || new Set(publishedIds).size !== publishedIds.length || new Set(refusedIds).size !== refusedIds.length) failures.push(`${adapter}/${trigger} terminal identifier evidence contains duplicates.`);
    if (offeredIds.length !== scenario.acceptedCount + scenario.refusedCount || !identifiersMatch(acceptedIds, offeredIds.slice(0, scenario.acceptedCount)) || !identifiersMatch(refusedIds, offeredIds.slice(scenario.acceptedCount))) failures.push(`${adapter}/${trigger} accepted/refused identifiers do not form the exact offered prefix/suffix.`);
    if (!identifiersMatch(retainedIds, acceptedIds)) failures.push(`${adapter}/${trigger} retained identifiers do not exactly equal accepted identifiers.`);
    if (!identifiersMatch(publishedIds, acceptedIds)) failures.push(`${adapter}/${trigger} published identifiers do not exactly equal accepted identifiers.`);
    if (scenario.committedBoundary.sequence !== scenario.acceptedCount || scenario.committedBoundary.eventId !== acceptedIds.at(-1)) failures.push(`${adapter}/${trigger} committed boundary does not equal the last accepted identifier.`);
    if (scenario.firstMissingEventId !== refusedIds[0]) failures.push(`${adapter}/${trigger} first missing event identity is incorrect.`);
    if (!isValidTerminalPressureTransition(scenario.pressureTransitions)) failures.push(`${adapter}/${trigger} did not report the exact NEAR_LIMIT to EXHAUSTED pressure transition.`);
    if (trigger === "PENDING_BYTES" && (scenario.acceptedCount !== TERMINAL_PENDING_BYTE_ACCEPTED_COUNT || scenario.refusedCount !== TERMINAL_PENDING_BYTE_EVENT_COUNT - TERMINAL_PENDING_BYTE_ACCEPTED_COUNT)) failures.push(`${adapter}/${trigger} did not exercise the exact 17-event, 2 MiB checkpoint pressure workload.`);
    if (trigger === "PENDING_AGE" && (scenario.acceptedCount !== 1 || scenario.refusedCount !== 1)) failures.push(`${adapter}/${trigger} did not exercise the exact one-accepted/one-refused age workload.`);
  }
}

function isValidTerminalPressureTransition(transitions: readonly string[]): boolean {
  const sequence = transitions.join(",");
  return sequence === "NEAR_LIMIT,EXHAUSTED" || sequence === "AVAILABLE,NEAR_LIMIT,EXHAUSTED";
}

function validateCheckpointScenarios(
  scenarios: readonly EventHistoryPerformanceCheckpointScenario[],
  failures: string[]
): void {
  for (const name of ["representative", "maximum-2MiB"] as const) {
    const matches = scenarios.filter((scenario) => scenario.name === name);
    if (matches.length !== 2) failures.push(`Expected NORMAL and LOWER ${name} checkpoint scenarios.`);
    for (const scenario of matches) {
      const liveIdsUnique = new Set(scenario.liveCaptureEventIds).size === scenario.liveCaptureEventIds.length;
      const retainedIdsUnique = new Set(scenario.retainedEventIds).size === scenario.retainedEventIds.length;
      const publishedIdsUnique = new Set(scenario.publishedEventIds).size === scenario.publishedEventIds.length;
      const liveIdsRetained = scenario.liveCaptureEventIds.every((eventId) => scenario.retainedEventIds.includes(eventId));
      const liveIdsPublished = scenario.liveCaptureEventIds.every((eventId) => scenario.publishedEventIds.includes(eventId));
      const liveRetainedInOrder = containsOrderedSubsequence(scenario.retainedEventIds, scenario.liveCaptureEventIds);
      const livePublishedInOrder = containsOrderedSubsequence(scenario.publishedEventIds, scenario.liveCaptureEventIds);
      const liveDuration = scenario.liveCaptureEndedAtMs - scenario.liveCaptureStartedAtMs;
      const stagingDuration = scenario.checkpointStagingEndedAtMs - scenario.checkpointStagingStartedAtMs;
      const overlapStart = Math.max(scenario.liveCaptureStartedAtMs, scenario.checkpointStagingStartedAtMs);
      const overlapEnd = Math.min(scenario.liveCaptureEndedAtMs, scenario.checkpointStagingEndedAtMs);
      const calculatedOverlap = Math.max(0, overlapEnd - overlapStart);
      const durationEvidence = Math.abs(liveDuration - scenario.liveCaptureDurationMs) < 1
        && Math.abs(stagingDuration - scenario.checkpointStagingDurationMs) < 1
        && Math.abs(calculatedOverlap - scenario.liveCaptureOverlapMs) < 1;
      const rate = scenario.liveCaptureDurationMs > 0
        ? scenario.liveCaptureCount * 1_000 / scenario.liveCaptureDurationMs
        : 0;
      if (!scenario.accepted
        || scenario.liveCaptureCount !== scenario.liveCaptureEventIds.length
        || scenario.retained !== scenario.trafficBefore + scenario.trafficAfter + scenario.liveCaptureCount + 1
        || scenario.retainedEventIds.length !== scenario.retained
        || scenario.publishedEventIds.length !== scenario.retained
        || !liveIdsUnique
        || !retainedIdsUnique
        || !publishedIdsUnique
        || !liveIdsRetained
        || !liveIdsPublished
        || !liveRetainedInOrder
        || !livePublishedInOrder
        || !durationEvidence
        || scenario.liveCaptureOverlapMs <= 0
        || scenario.liveCaptureOverlapEventCount < 1
        || scenario.liveCaptureRateEventsPerSecond < CHECKPOINT_LIVE_CAPTURE_MIN_EVENTS_PER_SECOND
        || Math.abs(rate - scenario.liveCaptureRateEventsPerSecond) >= 1
        || !scenario.liveCaptureRateSatisfied
        || !scenario.interleavedWhileStaging
        || !scenario.committedBoundaryCorrect
        || !scenario.batchAcceptedAsOneOversizedUnit) {
        failures.push(`${scenario.adapter}/${name} checkpoint evidence is incomplete: concurrent live capture must overlap staging and sustain at least ${CHECKPOINT_LIVE_CAPTURE_MIN_EVENTS_PER_SECOND} events/sec.`);
      }
      if (name === "maximum-2MiB" && scenario.canonicalBytes < 2 * MIB) failures.push(`${scenario.adapter}/${name} is smaller than the required 2 MiB checkpoint.`);
    }
  }
}

function validateStorageTelemetry(cell: EventHistoryPerformanceCell, failures: string[]): void {
  const label = cellLabel(cell);
  const storage = cell.storage;
  if (cell.adapter === "memory") {
    if (Object.values(storage).some((value) => value !== 0)) failures.push(`${label} reported IndexedDB telemetry for the in-memory adapter.`);
    return;
  }
  if (storage.evidenceWriteCount !== cell.accepted) failures.push(`${label} measured ${storage.evidenceWriteCount} evidence writes for ${cell.accepted} accepted events.`);
  if (storage.indexEntryCount !== storage.evidenceWriteCount + storage.facetEntryCount) failures.push(`${label} measured index amplification does not equal event-identity plus facet entries.`);
  if (storage.controlWriteCount !== storage.readwriteTransactionCount) failures.push(`${label} measured control writes do not match readwrite transaction count.`);
  if (storage.transactionCount !== storage.readwriteTransactionCount + storage.readonlyTransactionCount) failures.push(`${label} measured transaction totals are incoherent.`);
}

function isPerformanceReference(value: unknown): value is EventHistoryPerformanceReference {
  if (!isRecord(value)) return false;
  const environment = value.environment;
  return value.schemaVersion === PERFORMANCE_GATE_SCHEMA_VERSION
    && typeof value.referenceVersion === "string" && value.referenceVersion.length > 0
    && value.disposition === "ACCEPTED_INITIAL_CLEAN_REFERENCE"
    && typeof value.rationale === "string" && value.rationale.trim().length > 0
    && isRecord(environment) && environment.chromeMajor === 151
    && typeof environment.platformClass === "string" && typeof environment.architectureClass === "string"
    && Array.isArray(value.cells) && hasIndependentMatrixSamples(value.cells);
}

function isPerformanceCell(value: unknown): value is EventHistoryPerformanceCell {
  if (!isRecord(value) || !ADAPTERS.includes(value.adapter as EventHistoryPerformanceAdapter)
    || !WORKLOADS.includes(value.workload as EventHistoryPerformanceWorkload)
    || !SHAPES.includes(value.shape as EventHistoryPerformanceShape)
    || !Number.isInteger(value.sample) || (value.sample as number) < 1 || (value.sample as number) > SAMPLE_COUNT) return false;
  const correctness = value.correctness;
  const latency = value.latency;
  const longTasks = value.longTasks;
  const identityEvidence = value.identityEvidence;
  const storage = value.storage;
  const storageEstimate = value.storageEstimate;
  const workloadFacts = value.workloadFacts;
  const pressure = value.pressure;
  const terminal = value.terminal;
  if (!isRecord(correctness) || !["retainedMatchesAccepted", "publicationMatchesAccepted", "retainedInOrder", "publicationInOrder", "finalBoundaryCorrect", "terminalOutcomeCorrect"].every((key) => correctness[key] === true || correctness[key] === false)) return false;
  if (!isRecord(latency) || !["offerToPublicationP95Ms", "offerToVisibleFrameP95Ms", "committedBoundaryToVisibleFrameP95Ms", "behindBacklogMs", "recentPageP95Ms", "structuredIndexedP95Ms", "findFullP95Ms"].every((key) => isFiniteNumber(latency[key]) && (latency[key] as number) >= 0) || !(latency.finalBoundaryVisibleMs === null || (isFiniteNumber(latency.finalBoundaryVisibleMs) && latency.finalBoundaryVisibleMs >= 0))) return false;
  if (!isRecord(longTasks) || !isBoolean(longTasks.supported) || !Number.isSafeInteger(longTasks.unattributed) || (longTasks.unattributed as number) < 0 || !["capture", "commit", "paint", "query"].every((key) => Array.isArray(longTasks[key]) && (longTasks[key] as unknown[]).every((duration) => isFiniteNumber(duration) && duration >= 0)) || !Array.isArray(longTasks.unattributedReasons) || !longTasks.unattributedReasons.every(isLongTaskReason)) return false;
  if (!isIdentityEvidence(identityEvidence)) return false;
  if (!isRecord(storage) || !["transactionCount", "readwriteTransactionCount", "readonlyTransactionCount", "evidenceWriteCount", "controlWriteCount", "facetEntryCount", "indexEntryCount"].every((key) => Number.isSafeInteger(storage[key]) && (storage[key] as number) >= 0)) return false;
  if (!isStorageEstimateTelemetry(storageEstimate)) return false;
  if (!isRecord(workloadFacts) || !["expectedCount", "offeredEventsPerSecond", "shapeBytes", "persistedJsonBytes", "indexedDbWritesPerEvent", "searchTokenCount"].every((key) => isFiniteNumber(workloadFacts[key]) && (workloadFacts[key] as number) >= 0)) return false;
  if (!isRecord(pressure) || !isFiniteNumber(pressure.maxPendingBytes) || !isFiniteNumber(pressure.maxOldestPendingAgeMs) || pressure.maxPendingBytes < 0 || pressure.maxOldestPendingAgeMs < 0 || !Array.isArray(pressure.transitions) || !pressure.transitions.every((entry) => typeof entry === "string") || !isRecord(pressure.limits)) return false;
  if (!isRecord(terminal) || !["RUNNING", "STOPPED"].includes(terminal.phase as string) || !(terminal.reason === null || typeof terminal.reason === "string") || !(terminal.firstMissingEventId === null || typeof terminal.firstMissingEventId === "string") || !Number.isSafeInteger(terminal.refusedCount) || !Number.isSafeInteger(terminal.discardedCount)) return false;
  return ["accepted", "published", "retained"].every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0);
}

function isLongTaskReason(value: unknown): value is EventHistoryPerformanceLongTaskReason {
  if (!isRecord(value) || (value.reason !== "no-overlap" && value.reason !== "ambiguous")) return false;
  if (value.reason === "no-overlap") return isFiniteNumber(value.startTime) && value.startTime >= 0 && isFiniteNumber(value.duration) && value.duration >= 0;
  return Array.isArray(value.overlaps) && value.overlaps.every((overlap) => isRecord(overlap)
    && ["capture", "commit", "paint", "query"].includes(overlap.phase as string)
    && isFiniteNumber(overlap.duration) && overlap.duration > 0);
}

function isIdentityEvidence(value: unknown): value is EventHistoryPerformanceIdentityEvidence {
  if (!isRecord(value)) return false;
  return ["expectedEventIds", "retainedEventIds", "publishedEventIds"].every((key) => {
    const ids = value[key];
    return Array.isArray(ids)
      && ids.length > 0
      && ids.every((id) => typeof id === "string" && id.length > 0)
      && new Set(ids).size === ids.length;
  });
}

function isStorageEstimateTelemetry(value: unknown): value is EventHistoryPerformanceStorageEstimate {
  if (!isRecord(value) || value.source !== "navigator.storage.estimate" || !["AVAILABLE", "UNAVAILABLE"].includes(value.status as string)) return false;
  if (value.status === "AVAILABLE") {
    return value.failure === null
      && isFiniteNumber(value.usageBytes) && value.usageBytes >= 0
      && isFiniteNumber(value.quotaBytes) && value.quotaBytes >= 0;
  }
  return value.usageBytes === null && value.quotaBytes === null
    && isRecord(value.failure) && typeof value.failure.code === "string" && typeof value.failure.message === "string";
}

function isHeapSample(value: unknown): value is EventHistoryPerformanceHeapSample {
  return isRecord(value) && ADAPTERS.includes(value.adapter as EventHistoryPerformanceAdapter)
    && Number.isInteger(value.sample) && (value.sample as number) >= 1 && (value.sample as number) <= SAMPLE_COUNT
    && Number.isSafeInteger(value.eventCount) && (value.eventCount as number) >= 0
    && (value.sessionId === null || typeof value.sessionId === "string")
    && (value.status === "FAIL"
      ? (value.adapter === "indexeddb" ? value.databaseName === null || (typeof value.databaseName === "string" && value.databaseName.length > 0) : value.databaseName === null)
      : (value.adapter === "indexeddb" ? typeof value.databaseName === "string" && value.databaseName.length > 0 : value.databaseName === null))
    && (value.status === "PASS" || value.status === "FAIL")
    && (value.status === "PASS"
      ? value.failure === null && typeof value.sessionId === "string" && value.sessionId.length > 0 && isFiniteNumber(value.postGcHeapDeltaBytes)
      : isRecord(value.failure) && typeof value.failure.code === "string" && typeof value.failure.message === "string" && value.postGcHeapDeltaBytes === null);
}

function isHeapRun(value: unknown): value is EventHistoryPerformanceHeapRun {
  return isRecord(value) && ADAPTERS.includes(value.adapter as EventHistoryPerformanceAdapter)
    && (value.phase === "warmup" || value.phase === "cleanup")
    && (value.sample === null || (Number.isInteger(value.sample) && (value.sample as number) >= 1 && (value.sample as number) <= SAMPLE_COUNT))
    && Number.isSafeInteger(value.eventCount) && (value.eventCount as number) >= 0
    && (value.retained === null || (Number.isSafeInteger(value.retained) && (value.retained as number) >= 0))
    && (value.sessionId === null || typeof value.sessionId === "string")
    && (value.adapter === "indexeddb" ? value.databaseName === null || (typeof value.databaseName === "string" && value.databaseName.length > 0) : value.databaseName === null)
    && (value.close === null || isRecord(value.close))
    && isBoolean(value.rootRemoved)
    && isBoolean(value.frameYielded)
    && (value.gcPasses === null || value.gcPasses === 3)
    && (value.status === "PASS" || value.status === "FAIL")
    && (value.status === "PASS"
      ? value.failure === null && typeof value.sessionId === "string" && value.sessionId.length > 0
        && (value.adapter === "indexeddb" ? typeof value.databaseName === "string" && value.databaseName.length > 0 : value.databaseName === null)
        && value.retained !== null && value.gcPasses === 3 && value.rootRemoved === true && value.frameYielded === true
        && isRecord(value.close) && value.close.ok === true
      : isRecord(value.failure) && typeof value.failure.code === "string" && typeof value.failure.message === "string");
}

function validateHeapRuns(
  runs: readonly EventHistoryPerformanceHeapRun[],
  samples: readonly EventHistoryPerformanceHeapSample[],
  failures: string[]
): void {
  const expectedRuns = ADAPTERS.length * (SAMPLE_COUNT + 1);
  if (runs.length !== expectedRuns) failures.push(`Expected ${expectedRuns} heap warm-up/cleanup evidence records.`);
  const warmups = new Map<EventHistoryPerformanceAdapter, EventHistoryPerformanceHeapRun>();
  const cleanups = new Map<string, EventHistoryPerformanceHeapRun>();
  for (const adapter of ADAPTERS) {
    const adapterRuns = runs.filter((run) => run.adapter === adapter);
    const warmupCount = adapterRuns.filter((run) => run.phase === "warmup" && run.sample === null).length;
    const cleanupSamples = adapterRuns
      .filter((run) => run.phase === "cleanup")
      .map((run) => run.sample)
      .sort((left, right) => Number(left) - Number(right));
    if (warmupCount !== 1) failures.push(`${adapter} heap evidence must contain exactly one warm-up slot.`);
    if (cleanupSamples.join(",") !== "1,2,3") failures.push(`${adapter} heap evidence must contain exactly cleanup slots 1,2,3.`);
  }
  for (const run of runs) {
    const key = `${run.adapter}/${run.phase}/${run.sample ?? "warmup"}`;
    if (run.phase === "warmup") {
      if (warmups.has(run.adapter)) failures.push(`Duplicate ${run.adapter} heap warm-up evidence.`);
      warmups.set(run.adapter, run);
    } else {
      if (cleanups.has(key)) failures.push(`Duplicate ${key} heap cleanup evidence.`);
      cleanups.set(key, run);
    }
    if (run.status !== "PASS") {
      failures.push(`${run.adapter} ${run.phase} heap cleanup failed: ${run.failure?.code ?? "unknown"}: ${run.failure?.message ?? "missing failure details"}.`);
      continue;
    }
    if (run.retained !== run.eventCount) failures.push(`${run.adapter} ${run.phase} heap cleanup retained count mismatch.`);
    const close = run.close;
    if (close === null || close.ok !== true || !isRecord(close.value)
      || close.value.dataDisposition !== "ERASED" || close.value.cleanupDisposition !== "COMPLETE") {
      failures.push(`${run.adapter} ${run.phase} heap cleanup did not confirm ERASED/COMPLETE.`);
    }
  }
  const warmupSessionIds = new Set<string>();
  const warmupDatabaseNames = new Set<string>();
  const measuredSessionIds = new Set<string>();
  const measuredDatabaseNames = new Set<string>();
  for (const adapter of ADAPTERS) {
    const warmup = warmups.get(adapter);
    if (!warmup) {
      failures.push(`Missing ${adapter} heap warm-up evidence.`);
    } else if (warmup.status === "PASS") {
      if (warmup.sessionId === null) failures.push(`Missing ${adapter} warm-up Panel Session identity.`);
      else if (warmupSessionIds.has(warmup.sessionId)) failures.push(`Duplicate heap warm-up Panel Session identity: ${warmup.sessionId}.`);
      else warmupSessionIds.add(warmup.sessionId);
      if (adapter === "indexeddb" && warmup.databaseName !== null) {
        if (warmupDatabaseNames.has(warmup.databaseName)) failures.push(`Duplicate heap warm-up IndexedDB database identity: ${warmup.databaseName}.`);
        else warmupDatabaseNames.add(warmup.databaseName);
      }
    }
    for (let sampleNumber = 1; sampleNumber <= SAMPLE_COUNT; sampleNumber += 1) {
      const sample = samples.find((entry) => entry.adapter === adapter && entry.sample === sampleNumber);
      const cleanup = cleanups.get(`${adapter}/cleanup/${sampleNumber}`);
      if (!sample || !cleanup) {
        failures.push(`Missing ${adapter} heap sample/cleanup slot ${sampleNumber}.`);
        continue;
      }
      if (cleanup.status === "PASS" && sample.status === "PASS") {
        if (sample.sessionId === null || cleanup.sessionId !== sample.sessionId) {
          failures.push(`${adapter} heap sample ${sampleNumber} does not match its cleanup identity.`);
        } else if (measuredSessionIds.has(sample.sessionId)) {
          failures.push(`Duplicate measured heap Panel Session identity: ${sample.sessionId}.`);
        } else {
          measuredSessionIds.add(sample.sessionId);
        }
        if (adapter === "indexeddb" && sample.databaseName !== null) {
          if (cleanup.databaseName !== sample.databaseName) failures.push(`${adapter} heap sample ${sampleNumber} does not match its cleanup database identity.`);
          if (measuredDatabaseNames.has(sample.databaseName)) failures.push(`Duplicate measured heap IndexedDB database identity: ${sample.databaseName}.`);
          else measuredDatabaseNames.add(sample.databaseName);
        }
        const sampleSessionId = sample.sessionId;
        if (sampleSessionId !== null && warmupSessionIds.has(sampleSessionId)) failures.push(`${adapter} measured heap sample reuses warm-up identity: ${sampleSessionId}.`);
        if (sample.databaseName !== null && warmupDatabaseNames.has(sample.databaseName)) failures.push(`${adapter} measured heap sample reuses warm-up database identity: ${sample.databaseName}.`);
      }
    }
  }
}

function hasIndependentMatrixSamples(cells: unknown[]): cells is EventHistoryPerformanceCell[] {
  if (cells.length !== expectedMatrixKeys().size * SAMPLE_COUNT || !cells.every(isPerformanceCell)) return false;
  const byKey = new Map<string, number[]>();
  for (const cell of cells) {
    const samples = byKey.get(cellKey(cell)) ?? [];
    samples.push(cell.sample);
    byKey.set(cellKey(cell), samples);
  }
  return byKey.size === expectedMatrixKeys().size && [...byKey.entries()].every(([key, samples]) =>
    expectedMatrixKeys().has(key) && samples.sort((left, right) => left - right).join(",") === "1,2,3"
  );
}

function validateCell(cell: EventHistoryPerformanceCell, failures: string[]): void {
  const label = cellLabel(cell);
  const numbers = [
    cell.latency.offerToPublicationP95Ms,
    cell.latency.offerToVisibleFrameP95Ms,
    cell.latency.committedBoundaryToVisibleFrameP95Ms,
    cell.latency.behindBacklogMs,
    cell.latency.recentPageP95Ms,
    cell.latency.structuredIndexedP95Ms,
    cell.latency.findFullP95Ms,
    cell.accepted,
    cell.published,
    cell.retained
  ];
  numbers.push(
    cell.storage.transactionCount,
    cell.storage.readwriteTransactionCount,
    cell.storage.readonlyTransactionCount,
    cell.storage.evidenceWriteCount,
    cell.storage.controlWriteCount,
    cell.storage.facetEntryCount,
    cell.storage.indexEntryCount,
    cell.workloadFacts.persistedJsonBytes
  );
  if (cell.latency.finalBoundaryVisibleMs !== null) numbers.push(cell.latency.finalBoundaryVisibleMs);
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    failures.push(`${label} contains incomplete or invalid numeric telemetry.`);
  }
  if (cell.accepted !== cell.published || cell.accepted !== cell.retained) {
    failures.push(`${label} accepted, published, and retained counts differ.`);
  }
  if (cell.accepted !== cell.workloadFacts.expectedCount) {
    failures.push(`${label} accepted count does not match the workload count.`);
  }
  const { expectedEventIds, retainedEventIds, publishedEventIds } = cell.identityEvidence;
  if (expectedEventIds.length !== cell.workloadFacts.expectedCount) failures.push(`${label} expected identifier evidence count is incomplete.`);
  if (retainedEventIds.length !== cell.retained) failures.push(`${label} retained identifier evidence count does not match retained count.`);
  if (publishedEventIds.length !== cell.published) failures.push(`${label} published identifier evidence count does not match published count.`);
  const retainedInOrder = identifiersMatch(retainedEventIds, expectedEventIds);
  const publishedInOrder = identifiersMatch(publishedEventIds, expectedEventIds);
  if (cell.correctness.retainedInOrder !== retainedInOrder) failures.push(`${label} retained identifier order evidence disagrees with correctness.`);
  if (cell.correctness.publicationInOrder !== publishedInOrder) failures.push(`${label} published identifier order evidence disagrees with correctness.`);
  if (cell.correctness.retainedMatchesAccepted !== (retainedEventIds.length === cell.accepted)) failures.push(`${label} retained identifier count evidence disagrees with correctness.`);
  if (cell.correctness.publicationMatchesAccepted !== (publishedEventIds.length === cell.accepted)) failures.push(`${label} published identifier count evidence disagrees with correctness.`);
  if (cell.terminal.phase !== "RUNNING") {
    failures.push(`${label} ended in terminal phase ${cell.terminal.phase}.`);
  }
  if (cell.terminal.reason !== null || cell.terminal.firstMissingEventId !== null) {
    failures.push(`${label} reported a terminal reason or missing event.`);
  }
  if (cell.terminal.refusedCount !== 0 || cell.terminal.discardedCount !== 0) {
    failures.push(`${label} reported refused or discarded events.`);
  }
  for (const phase of ["capture", "commit", "paint", "query"] as const) {
    if (cell.longTasks[phase].some((duration) => !Number.isFinite(duration) || duration < 0)) {
      failures.push(`${label} contains invalid Long Task telemetry.`);
      break;
    }
  }
}

function identifiersMatch(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function containsOrderedSubsequence(container: readonly string[], sequence: readonly string[]): boolean {
  let next = 0;
  for (const id of container) {
    if (id === sequence[next]) next += 1;
    if (next === sequence.length) return true;
  }
  return sequence.length === 0;
}

function compareReference(
  report: EventHistoryPerformanceReport,
  reference: EventHistoryPerformanceReference,
  reviewReasons: string[]
): void {
  if (reference.schemaVersion !== PERFORMANCE_GATE_SCHEMA_VERSION) {
    reviewReasons.push("Pinned reference schema is not comparable.");
    return;
  }
  if (
    reference.environment.chromeMajor !== report.environment.chromeMajor ||
    reference.environment.platformClass !== report.environment.platformClass ||
    reference.environment.architectureClass !== report.environment.architectureClass
  ) {
    reviewReasons.push("The report environment does not match the pinned reference environment.");
    return;
  }
  const referenceByKey = new Map<string, EventHistoryPerformanceCell[]>();
  for (const cell of reference.cells) {
    const samples = referenceByKey.get(cellKey(cell)) ?? [];
    samples.push(cell);
    referenceByKey.set(cellKey(cell), samples);
  }
  for (const current of report.cells) {
    const key = cellKey(current);
    const currentMatching = report.cells.filter((cell) => cellKey(cell) === key);
    const matching = referenceByKey.get(key);
    if (!matching || matching.length < SAMPLE_COUNT) {
      reviewReasons.push(`Pinned reference is missing comparable samples for ${cellLabel(current)}.`);
      continue;
    }
    if (current.sample !== 1) continue;
    const metrics: Array<[string, number, number[]]> = [
      ["offer-to-publication p95", median(currentMatching.map((cell) => cell.latency.offerToPublicationP95Ms)), matching.map((cell) => cell.latency.offerToPublicationP95Ms)],
      ["offer-to-visible p95", median(currentMatching.map((cell) => cell.latency.offerToVisibleFrameP95Ms)), matching.map((cell) => cell.latency.offerToVisibleFrameP95Ms)],
      ["recent-page p95", median(currentMatching.map((cell) => cell.latency.recentPageP95Ms)), matching.map((cell) => cell.latency.recentPageP95Ms)],
      ["structured/indexed p95", median(currentMatching.map((cell) => cell.latency.structuredIndexedP95Ms)), matching.map((cell) => cell.latency.structuredIndexedP95Ms)],
      ["Find/full p95", median(currentMatching.map((cell) => cell.latency.findFullP95Ms)), matching.map((cell) => cell.latency.findFullP95Ms)]
    ];
    if (current.latency.finalBoundaryVisibleMs !== null && current.workload === "burst") {
      metrics.push([
        "burst final boundary",
        median(currentMatching.flatMap((cell) => cell.latency.finalBoundaryVisibleMs === null ? [] : [cell.latency.finalBoundaryVisibleMs])),
        matching.flatMap((cell) => cell.latency.finalBoundaryVisibleMs === null ? [] : [cell.latency.finalBoundaryVisibleMs])
      ]);
    }
    for (const [name, value, referenceValues] of metrics) {
      const referenceMedian = median(referenceValues);
      if (referenceMedian > 0 && value > referenceMedian * (1 + EVENT_HISTORY_PERFORMANCE_LIMITS.query.relativeRegression)) {
        reviewReasons.push(`${cellLabel(current)} ${name} regressed more than 20% from the pinned median.`);
      }
    }
  }
}

function expectedMatrixKeys(): Set<string> {
  return new Set(
    ADAPTERS.flatMap((adapter) =>
      WORKLOADS.flatMap((workload) => SHAPES.map((shape) => `${adapter}/${workload}/${shape}`))
    )
  );
}

function cellKey(cell: Pick<EventHistoryPerformanceCell, "adapter" | "workload" | "shape">): string {
  return `${cell.adapter}/${cell.workload}/${cell.shape}`;
}

function cellLabel(cell: Pick<EventHistoryPerformanceCell, "adapter" | "workload" | "shape" | "sample">): string {
  return `${cellKey(cell)} sample ${cell.sample}`;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}
