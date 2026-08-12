export type PerformanceOperationState = "pending" | "resolved" | "rejected" | "missing";
export type PerformanceOperationRequestTimeout = Readonly<{
  phase: string;
  timeoutMs: number;
  ceilingMs: number;
}>;
export type PerformanceOperationProgress = Readonly<{
  operationId: string | null;
  phase: "cells" | "terminal" | "checkpoint" | "heap" | "lifecycle";
  stage: string;
  substage: string;
  sequence: number;
  pageElapsedMs: number;
  sample: number | null;
  trigger: "PENDING_BYTES" | "PENDING_AGE" | null;
  scenario: string | null;
  cellIndex: number | null;
  cellTotal: 36;
  adapter: HeapAdapter | null;
  workload: "sustained" | "burst" | null;
  shape: "small-lifecycle" | "ordinary-item-update" | "large-json-rich" | null;
  workloadPhase: "capture" | "commit" | "paint" | "query" | null;
  offered: number | null;
  settled: number | null;
  query: string | null;
  runtimeDiagnostics?: PerformanceRuntimeDiagnostics;
}>;

export type PerformanceEvidenceRef = Readonly<{
  intervalId: string;
  sequence: number;
  eventId: string;
}>;
export type PerformanceRuntimeDiagnostics = Readonly<{
  expectedFinalId: string;
  disposed: boolean;
  visible: boolean;
  committedEvidenceBoundary: PerformanceEvidenceRef | null;
  renderedEvidenceBoundary: PerformanceEvidenceRef | null;
  pendingVisibleCount: number;
  pendingVisibleHead: PerformanceEvidenceRef | null;
  pendingVisibleTail: PerformanceEvidenceRef | null;
  evidenceQueryPending: boolean;
  passiveRefreshPending: boolean;
  queryGeneration: number;
  liveEvidenceTotal: number;
  liveEvidenceTail: Readonly<{ eventId: string }> | null;
  lastEvidenceQueryError: string | null;
  documentVisibilityState: "hidden" | "visible" | "prerender" | "unavailable";
  visibleFrameHeartbeat: number;
  lastVisibleFrameAtMs: number | null;
  panel: Readonly<{
    rootMounted: boolean;
    subscriptionActive: boolean;
    lastLayoutEffectSnapshotVersion: number | null;
    lastLayoutEffectBoundary: PerformanceEvidenceRef | null;
    animationFramePending: boolean;
    animationFrameRequestCount: number;
    lastAnimationFrameRequestedAtMs: number | null;
    animationFrameCallbackCount: number;
    lastAnimationFrameCallbackAtMs: number | null;
    animationFrameCancelCount: number;
  }>;
}>;

export type HeapAdapter = "indexeddb" | "memory";
export type HeapSession = Readonly<{
  adapter: HeapAdapter;
  eventCount: number;
  phase: "warmup" | "sample";
  sample: number | null;
  retained: number;
  sessionId: string;
  databaseName: string | null;
}>;
export type HeapGcSample = Readonly<{ usedSize: number; gcPasses: 3 }>;
export type HeapGcRequestOptions = Readonly<{
  deadlineMs?: number;
  requestCeilingMs?: number;
  now?: () => number;
}>;
export type HeapRecord = Readonly<{
  adapter: HeapAdapter;
  sample: number;
  eventCount: number;
  sessionId: string | null;
  databaseName: string | null;
  retained?: number;
  baselineUsedSizeBytes: number | null;
  retainedUsedSizeBytes: number | null;
  postGcHeapDeltaBytes: number | null;
}>;
export type HeapSample = HeapRecord & Readonly<{
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }> | null;
}>;
export type HeapCloseOutcome = Readonly<{
  ok: boolean;
  value?: Readonly<{ dataDisposition: "ERASED" | "ERASURE_UNCONFIRMED"; cleanupDisposition: "COMPLETE" | "DEFERRED" }>;
  problem?: Readonly<{ code: string; message: string }>;
}>;
export type HeapRun = Readonly<{
  adapter: HeapAdapter;
  phase: "warmup" | "cleanup";
  sample: number | null;
  eventCount: number;
  retained: number | null;
  sessionId: string | null;
  databaseName: string | null;
  close: HeapCloseOutcome | null;
  rootRemoved: boolean;
  frameYielded: boolean;
  gcPasses: 3 | null;
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }> | null;
}>;

export type PerformanceCleanupEvidence = Readonly<{
  adapter: "indexeddb" | "memory";
  phase: "warmup" | "cleanup";
  sample: number | null;
  eventCount: number;
  retained: number | null;
  sessionId: string | null;
  databaseName: string | null;
  close: Readonly<Record<string, unknown>> | null;
  disposeError: string | null;
  rootRemoved: boolean;
  frameYielded: boolean;
  gcPasses: 3 | null;
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }> | null;
}>;

export type PerformanceOperationStatus = Readonly<{
  operationId: string | null;
  state: PerformanceOperationState;
  elapsedMs: number;
  heartbeat: number;
  lastHeartbeatAt: number | null;
  lastRequestTimeout?: PerformanceOperationRequestTimeout;
  progress?: PerformanceOperationProgress;
  progressSequence?: number | null;
  progressAgeMs?: number | null;
  progressAgeCeilingMs?: number | null;
  lastProgressObservedAt?: number | null;
  progressStageKey?: string | null;
  progressStageAgeMs?: number | null;
  progressStageDeadlineMs?: number | null;
  result?: unknown;
  error?: Readonly<{
    name: string;
    message: string;
    stack: string | null;
    code?: string;
    progress?: PerformanceOperationProgress;
    cleanupEvidence?: PerformanceCleanupEvidence;
  }>;
}>;

export const PERFORMANCE_OPERATION_KEY: string;
export const FORCED_GC_PASSES: 3;

export class PerformanceOperationTimeout extends Error {
  readonly status: PerformanceOperationStatus;
}

export function collectHeapAfterRepeatedGc(
  cdp: { request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> },
  passes?: 3,
  options?: HeapGcRequestOptions
): Promise<HeapGcSample>;

export function releaseHeapSessionWithCleanup(input: {
  release(): Promise<unknown>;
  removeRoot(): Promise<boolean>;
  yieldFrame(): Promise<boolean>;
  forceGc(): Promise<HeapGcSample>;
}): Promise<Readonly<{
  usedSize: number;
  gcPasses: 3;
  closeOutcome: unknown;
  rootRemoved: true;
  frameYielded: true;
}>>;

export function runPageOperation(
  cdp: { request(method: string, params?: Record<string, unknown>): Promise<unknown> },
  expression: string,
  options?: {
    deadlineMs?: number;
    pollIntervalMs?: number;
    requestCeilingMs?: number;
    operationId?: string;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    onHeartbeat?: (status: PerformanceOperationStatus) => void;
  }
): Promise<unknown>;

export function runHeapMeasurementPlan(input: {
  adapters?: readonly HeapAdapter[];
  eventCounts: Readonly<{ indexeddb?: number; memory?: number }>;
  sampleCount?: number;
  prepare(input: Readonly<{ adapter: HeapAdapter; eventCount: number; phase: "warmup" | "sample"; sample: number | null }>): Promise<HeapSession>;
  forceGc(input: Readonly<{ adapter: HeapAdapter; eventCount: number; phase: string; sample: number | null }>): Promise<HeapGcSample>;
  record(input: Readonly<{ adapter: HeapAdapter; eventCount: number; sample: number; session: HeapSession; baseline: HeapGcSample; retained: HeapGcSample }>): Promise<HeapRecord> | HeapRecord;
  close(session: HeapSession): Promise<HeapCloseOutcome>;
  removeRoot(session: HeapSession): Promise<boolean>;
  yieldFrame(input: Readonly<{ adapter: HeapAdapter; eventCount: number; phase: string; sample: number | null }>): Promise<boolean>;
}): Promise<Readonly<{
  heapSamples: readonly HeapSample[];
  heapRuns: readonly HeapRun[];
}>>;

export function createTimeoutDiagnostic(input: {
  generatedAt: string;
  source: Readonly<{ revision: string; dirty: boolean }>;
  runner: Readonly<Record<string, unknown>>;
  environment: Readonly<Record<string, unknown>>;
  referencePath: string;
  deadlineMs: number;
  operation: PerformanceOperationStatus;
}): Readonly<Record<string, unknown>>;
