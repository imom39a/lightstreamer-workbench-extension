import {
  EVENT_HISTORY_SHAPES,
  type EventHistoryShape,
  ISSUE_16_TOTAL_EVENTS,
  TIMELINE_SUSTAINED_EVENTS_PER_SECOND,
  createEventHistoryWorkloadEvent,
  representativeEventHistoryShapeFacts,
  utf8JsonBytes
} from "./event-history-workloads";
import {
  createInMemoryEventHistory,
  type EvidenceCandidate,
  type EventHistory,
  type HistoryPublication,
  type CloseResult,
  type Outcome
} from "../src/core/event-history-authoritative";
import { historyCapacityLimits } from "../src/core/event-history-capacity";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import {
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_LIMITS,
  TOPOLOGY_SYNC_VERSION,
  TOPOLOGY_OBSERVATION_VERSION,
  topologySyncUtf8Bytes,
  type TopologyAbsoluteRecord,
  type TopologyCoverage,
  type TopologyObservation,
  type TopologySyncFrame
} from "../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  classifyEventHistoryPerformance,
  EVENT_HISTORY_PERFORMANCE_PROOF_MODES,
  CHECKPOINT_LIVE_CAPTURE_MAX_EVENT_GAP_MS,
  CHECKPOINT_LIVE_CAPTURE_MIN_EVENTS_PER_SECOND,
  CHECKPOINT_LIVE_CAPTURE_MIN_OVERLAP_MS,
  TERMINAL_PENDING_BYTE_EVENT_COUNT,
  isExactQueryPage,
  type EventHistoryPerformanceCell,
  type EventHistoryPerformanceFrameProof,
  type EventHistoryPerformanceQueryCell,
  type EventHistoryPerformanceCheckpointScenario,
  type EventHistoryPerformanceHeapSample,
  type EventHistoryPerformanceStorageEstimate,
  type EventHistoryPerformanceReference,
  type EventHistoryPerformanceReport,
  type EventHistoryPerformanceProofMode,
  type EventHistoryPerformanceShape,
  type EventHistoryPerformanceTerminalScenario,
  type EventHistoryPerformanceWorkload
} from "./event-history-performance-gate";
import { typedFacetValue, type EvidenceQueryRequest } from "../src/core/evidence-filter-contract";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntimePerformanceDiagnostics,
  type WorkbenchRuntimePerformanceHooks
} from "../src/extension/panel/workbench-runtime";
import {
  createTopologyCheckpointEvidenceCandidate,
  decodeTopologyCheckpointEvidenceCandidate
} from "../src/extension/panel/topology-checkpoint-evidence-codec";

type EventHistoryPerformanceConfig = Readonly<{
  sustainedCount: number;
  sustainedEventsPerSecond: number;
  burstCount: number;
  burstPauseMs: number;
}>;

/** Keep each synchronous burst offer task below the Long Task envelope. */
export const EVENT_HISTORY_BURST_OFFER_CHUNK_SIZE = 64;
/** Yield before a burst offer task reaches the 50 ms Long Task threshold. */
export const EVENT_HISTORY_BURST_OFFER_BUDGET_MS = 35;

export type BurstOfferScheduleOptions<T> = Readonly<{
  events: readonly T[];
  eventsPerBurst: number;
  chunkSize?: number;
  maxChunkDurationMs?: number;
  now?: () => number;
  offer: (event: T, index: number) => void;
  yieldBetweenChunks: () => Promise<void>;
  pauseBetweenBursts?: () => Promise<void>;
}>;

/**
 * Run bursts in capture order while yielding between bounded synchronous
 * chunks. The caller controls the actual yield and pause primitives so the
 * schedule remains usable by both the browser harness and deterministic tests.
 */
export async function runBurstOfferSchedule<T>(options: BurstOfferScheduleOptions<T>): Promise<void> {
  const eventsPerBurst = Math.max(1, Math.floor(options.eventsPerBurst));
  const chunkSize = Math.min(
    EVENT_HISTORY_BURST_OFFER_CHUNK_SIZE,
    Math.max(1, Math.floor(options.chunkSize ?? EVENT_HISTORY_BURST_OFFER_CHUNK_SIZE))
  );
  const chunkBudgetMs = Math.max(0, options.maxChunkDurationMs ?? EVENT_HISTORY_BURST_OFFER_BUDGET_MS);
  const readNow = options.now ?? (() => performance.now());
  const now = (): number => {
    const value = readNow();
    return Number.isFinite(value) ? value : 0;
  };
  let sequence = 0;
  while (sequence < options.events.length) {
    const burstEnd = Math.min(options.events.length, sequence + eventsPerBurst);
    let chunkStartedAt = now();
    let chunkCount = 0;
    while (sequence < burstEnd) {
      const event = options.events[sequence];
      if (event === undefined) throw new Error(`Missing burst event ${sequence}.`);
      options.offer(event, sequence);
      sequence += 1;
      chunkCount += 1;
      const elapsedMs = Math.max(0, now() - chunkStartedAt);
      if (sequence < burstEnd && (chunkCount >= chunkSize || elapsedMs >= chunkBudgetMs)) {
        await options.yieldBetweenChunks();
        chunkStartedAt = now();
        chunkCount = 0;
      }
    }
    if (sequence < options.events.length && options.pauseBetweenBursts) {
      await options.pauseBetweenBursts();
    }
  }
}

async function yieldBurstOfferMacrotask(): Promise<void> {
  if (typeof MessageChannel === "function") {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
    return;
  }
  await delay(0);
}

export type HarnessSelection = Readonly<
  | { id: string; kind: "matrix"; adapter: "indexeddb" | "memory"; workload: "sustained" | "burst"; firstCellIndex: number; collectAfterFinal: boolean; pageToken: string; cellOffset?: number }
  | { id: "scenarios"; kind: "scenarios"; pageToken: string }
  | { id: "filter-impl-08-query"; kind: "filter-impl-08"; pageToken: string }
>;

export type HarnessProgressInput = Readonly<{
  operationId: string | null;
  phase: "cells" | "terminal" | "checkpoint" | "heap" | "lifecycle";
  stage: string;
  substage: string;
  sample: number | null;
  trigger: "PENDING_BYTES" | "PENDING_AGE" | null;
  scenario: string | null;
  cellIndex: number | null;
  cellTotal: 36;
  adapter: "indexeddb" | "memory" | null;
  workload: "sustained" | "burst" | null;
  shape: EventHistoryShape | null;
  workloadPhase: "capture" | "commit" | "paint" | "query" | "hygiene" | null;
  offered: number | null;
  settled: number | null;
  query: string | null;
  runtimeDiagnostics?: HarnessRuntimeDiagnostics;
}>;

export type HarnessRuntimeDiagnostics = WorkbenchRuntimePerformanceDiagnostics & Readonly<{
  expectedFinalId: string;
}>;

export type HarnessProgress = HarnessProgressInput & Readonly<{
  sequence: number;
  pageElapsedMs: number;
}>;

export type HarnessScenarioTestHooks = Readonly<{
  afterPanelMount?: (history: EventHistory) => void;
  cleanupOverrides?: Readonly<{
    disposePanel?: (disposePanel: () => void | Promise<void>) => void | Promise<void>;
    removeRoot?: (removeRoot: () => boolean) => boolean;
  }>;
}>;

const CHECKPOINT_LIVE_CAPTURE_EVENT_COUNT = 300;
const CHECKPOINT_LIVE_CAPTURE_INTERVAL_MS = 4;
const CHECKPOINT_LIVE_CAPTURE_TARGET_OVERLAP_MS = 1_100;

export type CheckpointLiveCaptureMeasurement = Readonly<{
  liveCaptureCount: number;
  liveCaptureEventTimesMs: readonly number[];
  liveCaptureStartedAtMs: number;
  liveCaptureEndedAtMs: number;
  liveCaptureDurationMs: number;
  checkpointStagingStartedAtMs: number;
  checkpointStagingEndedAtMs: number;
  checkpointStagingDurationMs: number;
  liveCaptureOverlapMs: number;
  liveCaptureOverlapEventCount: number;
  liveCaptureMaxInterEventGapMs: number;
  liveCaptureRateEventsPerSecond: number;
  liveCaptureRateSatisfied: boolean;
  interleavedWhileStaging: boolean;
}>;

export function measureCheckpointLiveCapture(
  input: Readonly<{
    checkpointStagingStartedAtMs: number;
    checkpointStagingEndedAtMs: number;
    liveCaptureEventTimesMs: readonly number[];
  }>
): CheckpointLiveCaptureMeasurement {
  const liveCaptureStartedAtMs = input.liveCaptureEventTimesMs[0] ?? 0;
  const liveCaptureEndedAtMs = input.liveCaptureEventTimesMs.at(-1) ?? liveCaptureStartedAtMs;
  const liveCaptureDurationMs = Math.max(0, liveCaptureEndedAtMs - liveCaptureStartedAtMs);
  const checkpointStagingDurationMs = Math.max(0, input.checkpointStagingEndedAtMs - input.checkpointStagingStartedAtMs);
  const overlapStart = Math.max(liveCaptureStartedAtMs, input.checkpointStagingStartedAtMs);
  const overlapEnd = Math.min(liveCaptureEndedAtMs, input.checkpointStagingEndedAtMs);
  const liveCaptureOverlapMs = Math.max(0, overlapEnd - overlapStart);
  const liveCaptureOverlapEventCount = input.liveCaptureEventTimesMs.filter((timestamp) =>
    timestamp >= input.checkpointStagingStartedAtMs && timestamp < input.checkpointStagingEndedAtMs
  ).length;
  const liveCaptureCount = input.liveCaptureEventTimesMs.length;
  const liveCaptureMaxInterEventGapMs = input.liveCaptureEventTimesMs.slice(1).reduce(
    (maximum, timestamp, index) => Math.max(maximum, timestamp - input.liveCaptureEventTimesMs[index]!),
    0
  );
  const liveCaptureRateEventsPerSecond = liveCaptureDurationMs > 0
    ? liveCaptureCount * 1_000 / liveCaptureDurationMs
    : 0;
  const liveCaptureRateSatisfied = liveCaptureRateEventsPerSecond >= CHECKPOINT_LIVE_CAPTURE_MIN_EVENTS_PER_SECOND;
  return {
    liveCaptureCount,
    liveCaptureEventTimesMs: [...input.liveCaptureEventTimesMs],
    liveCaptureStartedAtMs,
    liveCaptureEndedAtMs,
    liveCaptureDurationMs,
    checkpointStagingStartedAtMs: input.checkpointStagingStartedAtMs,
    checkpointStagingEndedAtMs: input.checkpointStagingEndedAtMs,
    checkpointStagingDurationMs,
    liveCaptureOverlapMs,
    liveCaptureOverlapEventCount,
    liveCaptureMaxInterEventGapMs,
    liveCaptureRateEventsPerSecond,
    liveCaptureRateSatisfied,
    interleavedWhileStaging: liveCaptureOverlapMs > 0
      && liveCaptureOverlapEventCount > 0
      && liveCaptureDurationMs >= CHECKPOINT_LIVE_CAPTURE_MIN_OVERLAP_MS
      && checkpointStagingDurationMs >= CHECKPOINT_LIVE_CAPTURE_MIN_OVERLAP_MS
      && liveCaptureOverlapMs >= CHECKPOINT_LIVE_CAPTURE_MIN_OVERLAP_MS
      && liveCaptureMaxInterEventGapMs <= CHECKPOINT_LIVE_CAPTURE_MAX_EVENT_GAP_MS
      && liveCaptureRateSatisfied
  };
}

const PERFORMANCE_OPERATION_KEY = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
// These are local fail-closed ceilings for one page stage. They are deliberately
// generous for the retained workloads and never extend the one-hour operation deadline.
const STAGE_DEADLINES_MS = Object.freeze({
  cellOffer: 120_000,
  cellReceipts: 120_000,
  query: 30_000,
  queryTotal: 120_000,
  read: 30_000,
  close: 30_000,
  terminalReceipts: 120_000,
  checkpointReceipts: 120_000,
  heapWarmupReceipts: 240_000,
  heapSampleReceipts: 240_000,
  visibleFrame: 30_000,
  frame: 30_000
});

export class HarnessStageTimeout extends Error {
  readonly code = "HARNESS_STAGE_TIMEOUT";
  readonly stage: string;
  readonly timeoutMs: number;
  readonly progress: HarnessProgress;

  constructor(stage: string, timeoutMs: number, progress: HarnessProgress) {
    super(`Harness stage ${stage} exceeded its ${timeoutMs} ms deadline.`);
    this.name = "HarnessStageTimeout";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    this.progress = progress;
  }
}

export type HarnessStageGuard = Readonly<{
  isActive(): boolean;
  invalidate(): void;
}>;

export function createHarnessStageGuard(operationId: string | null = null): HarnessStageGuard {
  let active = true;
  return {
    isActive: () => {
      if (!active || operationId === null) return active;
      const operation = (globalThis as unknown as Record<string, unknown>)[PERFORMANCE_OPERATION_KEY];
      return operation !== null
        && typeof operation === "object"
        && (operation as { operationId?: unknown }).operationId === operationId
        && (operation as { state?: unknown }).state === "pending";
    },
    invalidate: () => { active = false; }
  };
}

let harnessProgressSequence = 0;

function currentHarnessOperationId(): string | null {
  const operation = (globalThis as unknown as Record<string, unknown>)[PERFORMANCE_OPERATION_KEY];
  return operation && typeof operation === "object" && typeof (operation as { operationId?: unknown }).operationId === "string"
    ? (operation as { operationId: string }).operationId
    : null;
}

function observeHarnessProgress(progress: HarnessProgressInput): HarnessProgress {
  const operation = (globalThis as unknown as Record<string, unknown>)[PERFORMANCE_OPERATION_KEY];
  const startedAt = operation && typeof operation === "object" && typeof (operation as { startedAt?: unknown }).startedAt === "number"
    ? (operation as { startedAt: number }).startedAt
    : performance.now();
  return {
    ...progress,
    sequence: ++harnessProgressSequence,
    pageElapsedMs: Math.max(0, performance.now() - startedAt)
  };
}

export function publishHarnessProgress(progress: HarnessProgressInput): HarnessProgress {
  const operation = (globalThis as unknown as Record<string, unknown>)[PERFORMANCE_OPERATION_KEY];
  if (operation && typeof operation === "object"
    && progress.operationId !== null
    && (operation as { operationId?: unknown }).operationId !== progress.operationId) {
    return {
      ...progress,
      sequence: ++harnessProgressSequence,
      pageElapsedMs: 0
    };
  }
  const observed = observeHarnessProgress(progress);
  if (!operation || typeof operation !== "object") return observed;
  const record = operation as { state?: unknown; progress?: unknown };
  if (record.state === "pending") record.progress = observed;
  return observed;
}

function publishStageProgress(progress: HarnessProgressInput, guard: HarnessStageGuard | undefined): HarnessProgress | null {
  if (guard && !guard.isActive()) return null;
  return publishHarnessProgress(progress);
}

function normalizeHarnessError(
  error: unknown,
  stage: string,
  progress: HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined
): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const record = normalized as Error & { stage?: string; progress?: HarnessProgress };
  record.stage ??= stage;
  record.progress ??= guard && !guard.isActive()
    ? observeHarnessProgress(progress)
    : publishHarnessProgress(progress);
  return normalized;
}

export function withStageDeadline<T>(
  operation: PromiseLike<T> | T,
  stage: string,
  timeoutMs: number,
  progress: () => HarnessProgressInput,
  onTimeout: (() => void) | undefined = undefined,
  guard: HarnessStageGuard | undefined = undefined
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      const timeoutInput = progress();
      const timeoutProgress = guard && !guard.isActive()
        ? observeHarnessProgress(timeoutInput)
        : publishHarnessProgress(timeoutInput);
      guard?.invalidate();
      reject(new HarnessStageTimeout(stage, timeoutMs, timeoutProgress));
    }, timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        guard?.invalidate();
        if (error && typeof error === "object" && "progress" in error) reject(error);
        else reject(normalizeHarnessError(error, stage, progress(), guard));
      }
    );
  });
}

export type ReceiptStageState = Readonly<{
  terminal: boolean;
  retired: boolean;
  settled: number;
  pending: number;
}>;

export type ReceiptStageController<T> = Readonly<{
  promise: Promise<T[]>;
  state(): ReceiptStageState;
  retire(): void;
}>;

export function createReceiptStageController<T>(
  receipts: readonly PromiseLike<T>[],
  stage: string,
  progress: (settled: number) => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined
): ReceiptStageController<T> {
  let settled = 0;
  let pending = receipts.length;
  let terminal = false;
  let retired = false;
  let values: T[] | null = new Array<T>(receipts.length);
  let progressCallback: ((settled: number) => HarnessProgressInput) | null = progress;
  let resolveAggregate: ((value: T[]) => void) | null = null;
  let rejectAggregate: ((error: unknown) => void) | null = null;
  const promise = new Promise<T[]>((resolve, reject) => {
    resolveAggregate = resolve;
    rejectAggregate = reject;
  });
  const release = (): void => {
    values = null;
    progressCallback = null;
    resolveAggregate = null;
    rejectAggregate = null;
  };
  const complete = (): void => {
    if (terminal) return;
    terminal = true;
    const result = values ? values.slice() : [];
    const resolve = resolveAggregate;
    release();
    resolve?.(result);
  };
  const retire = (): void => {
    if (terminal) {
      retired = true;
      release();
      return;
    }
    terminal = true;
    retired = true;
    release();
  };
  receipts.forEach((receipt, index) => {
    Promise.resolve(receipt).then(
      (value) => {
        if (terminal) return;
        settled += 1;
        pending -= 1;
        const progressCallbackNow = progressCallback;
        if (progressCallbackNow) publishStageProgress(progressCallbackNow(settled), guard);
        if (values) values[index] = value;
        if (pending === 0) complete();
      },
      (error: unknown) => {
        if (terminal) return;
        terminal = true;
        retired = true;
        settled += 1;
        pending -= 1;
        const progressCallbackNow = progressCallback;
        const contextual = normalizeHarnessError(
          error,
          stage,
          progressCallbackNow ? progressCallbackNow(settled) : {
            operationId: null,
            phase: "heap",
            stage,
            substage: stage,
            sample: null,
            trigger: null,
            scenario: null,
            cellIndex: null,
            cellTotal: 36,
            adapter: null,
            workload: null,
            shape: null,
            workloadPhase: null,
            offered: null,
            settled,
            query: null
          },
          guard
        );
        const reject = rejectAggregate;
        release();
        reject?.(contextual);
      }
    );
  });
  if (pending === 0) complete();
  return { promise, state: () => ({ terminal, retired, settled, pending }), retire };
}

export function settleReceiptStage<T>(
  receipts: readonly PromiseLike<T>[],
  stage: string,
  timeoutMs: number,
  progress: (settled: number) => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined
): Promise<T[]> {
  const controller = createReceiptStageController(receipts, stage, progress, guard);
  return withStageDeadline(
    controller.promise,
    stage,
    timeoutMs,
    () => progress(controller.state().settled),
    controller.retire,
    guard
  );
}

export type PendingTelemetryEntry = Readonly<{ offeredAt: number; bytes: number }>;

export type PendingTelemetrySnapshot = Readonly<{
  pendingCount: number;
  pendingBytes: number;
  maxPendingCount: number;
  maxPendingBytes: number;
  maxOldestPendingAgeMs: number;
}>;

export type PendingTelemetryTracker = Readonly<{
  add(id: string, entry: PendingTelemetryEntry): void;
  settle(id: string): void;
  refuse(id: string): void;
  sample(): void;
  snapshot(): PendingTelemetrySnapshot;
  diagnostics(): Readonly<{ sampleCount: number; oldestQueueAdvances: number }>;
}>;

type PendingQueueEntry = Readonly<{ id: string; entry: PendingTelemetryEntry }>;

export function createPendingTelemetryTracker(now: () => number = () => performance.now()): PendingTelemetryTracker {
  const pending = new Map<string, PendingTelemetryEntry>();
  const oldestQueue: PendingQueueEntry[] = [];
  let oldestQueueHead = 0;
  let pendingCount = 0;
  let pendingBytes = 0;
  let maxPendingCount = 0;
  let maxPendingBytes = 0;
  let maxOldestPendingAgeMs = 0;
  let sampleCount = 0;
  let oldestQueueAdvances = 0;

  const remove = (id: string): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    pendingCount -= 1;
    pendingBytes -= entry.bytes;
  };

  return {
    add(id, entry) {
      remove(id);
      pending.set(id, entry);
      oldestQueue.push({ id, entry });
      pendingCount += 1;
      pendingBytes += entry.bytes;
    },
    settle: remove,
    refuse: remove,
    sample() {
      sampleCount += 1;
      maxPendingCount = Math.max(maxPendingCount, pendingCount);
      maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
      while (oldestQueueHead < oldestQueue.length) {
        const queued = oldestQueue[oldestQueueHead]!;
        if (pending.get(queued.id) === queued.entry) break;
        oldestQueueHead += 1;
        oldestQueueAdvances += 1;
      }
      const oldest = oldestQueue[oldestQueueHead]?.entry;
      if (oldest) maxOldestPendingAgeMs = Math.max(maxOldestPendingAgeMs, Math.max(0, now() - oldest.offeredAt));
    },
    snapshot() {
      return { pendingCount, pendingBytes, maxPendingCount, maxPendingBytes, maxOldestPendingAgeMs };
    },
    diagnostics() {
      return { sampleCount, oldestQueueAdvances };
    }
  };
}

type HarnessResult = Readonly<{
  schemaVersion: 2;
  proofMode: EventHistoryPerformanceProofMode;
  frameProof: EventHistoryPerformanceFrameProof;
  anchors: { issue16TotalEvents: number };
  config: EventHistoryPerformanceConfig;
  shapeFacts: ReturnType<typeof representativeEventHistoryShapeFacts>;
  cells: readonly EventHistoryPerformanceCell[];
  cellCleanupGc: readonly InterCellGcEvidence[];
  terminalScenarios: readonly EventHistoryPerformanceTerminalScenario[];
  checkpointScenarios: readonly EventHistoryPerformanceCheckpointScenario[];
}>;

export type InterCellGcEvidence = Readonly<{
  afterCellIndex: number;
  gcPasses: 3;
  phase: "BETWEEN_CELLS";
}>;

export type QuerySampleGcEvidence = Readonly<{
  query: string;
  afterSample: 1 | 2;
  gcPasses: 3;
  phase: "BETWEEN_QUERY_SAMPLES";
}>;

type RetainedHeapSession = Readonly<{
  operationId: string | null;
  adapter: "indexeddb" | "memory";
  count: number;
  retained: number;
  sessionId: string;
  root: HTMLElement;
  disposePanel: () => void | Promise<void>;
  runtime: ReturnType<typeof createWorkbenchRuntime>;
  history: EventHistory;
  databaseName: string | null;
}>;

type StorageTelemetry = Readonly<{
  transactionCount: number;
  readwriteTransactionCount: number;
  readonlyTransactionCount: number;
  evidenceWriteCount: number;
  controlWriteCount: number;
  facetEntryCount: number;
  indexEntryCount: number;
}>;

const TERMINAL_CHECKPOINT_PAYLOAD_BYTES = 2 * 1_048_576;

type StorageProbe = Readonly<{
  snapshot(): StorageTelemetry;
  restore(): void;
}>;

type PhaseName = "capture" | "commit" | "paint" | "query" | "hygiene";
type PhaseInterval = Readonly<{ phase: PhaseName; start: number; end: number }>;

export type UnattributedLongTaskReason = Readonly<
  | { reason: "no-overlap"; startTime: number; duration: number }
  | { reason: "ambiguous"; overlaps: readonly Readonly<{ phase: PhaseName; duration: number }>[] }
>;

export type LongTaskAttribution = Readonly<{
  capture: readonly number[];
  commit: readonly number[];
  paint: readonly number[];
  query: readonly number[];
  hygiene: readonly number[];
  unattributed: number;
  unattributedReasons: readonly UnattributedLongTaskReason[];
}>;

export type HeapPreparationCleanupEvidence = Readonly<{
  adapter: "indexeddb" | "memory";
  phase: "warmup" | "cleanup";
  sample: number | null;
  eventCount: number;
  retained: number | null;
  sessionId: string | null;
  databaseName: string | null;
  close: unknown;
  disposeError: string | null;
  rootRemoved: boolean;
  frameYielded: boolean;
  gcPasses: number | null;
  status: "PASS" | "FAIL";
  failure: Readonly<{ code: string; message: string }>;
}>;

export type HarnessCleanupEvidence = Readonly<{
  stage: string;
  unsubscribeAttempted: boolean;
  unsubscribeError: string | null;
  disposeAttempted: boolean;
  disposeError: string | null;
  rootRemovalAttempted: boolean;
  rootRemoved: boolean;
  rootError: string | null;
  closeAttempted: boolean;
  close: unknown;
  closeError: string | null;
}>;

export async function cleanupHarnessResources(input: Readonly<{
  history: EventHistory;
  stage: string;
  guard: HarnessStageGuard;
  progress: () => HarnessProgressInput;
  unsubscribe?: () => void;
    disposePanel?: () => void | Promise<void>;
  removeRoot?: () => boolean | void;
  restoreStorage?: () => void;
  disconnectObserver?: () => void;
}>): Promise<HarnessCleanupEvidence> {
  let unsubscribeError: string | null = null;
  let disposeError: string | null = null;
  let rootError: string | null = null;
  let closeError: string | null = null;
  let close: unknown = null;
  let rootRemoved = false;
  const unsubscribeAttempted = input.unsubscribe !== undefined;
  const disposeAttempted = input.disposePanel !== undefined;
  const rootRemovalAttempted = input.removeRoot !== undefined;

  try { input.restoreStorage?.(); } catch (error) { closeError = `restoreStorage: ${error instanceof Error ? error.message : String(error)}`; }
  try { input.disconnectObserver?.(); } catch (error) { closeError ??= `disconnectObserver: ${error instanceof Error ? error.message : String(error)}`; }
  if (input.unsubscribe) {
    try { input.unsubscribe(); } catch (error) { unsubscribeError = error instanceof Error ? error.message : String(error); }
  }
  if (input.disposePanel) {
    try { await input.disposePanel(); } catch (error) { disposeError = error instanceof Error ? error.message : String(error); }
  }
  if (input.removeRoot) {
    try {
      const result = input.removeRoot();
      rootRemoved = result === undefined ? true : result;
    } catch (error) {
      rootError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const closeOperation = input.history.close();
    close = await withStageDeadline(
      closeOperation,
      `${input.stage}-cleanup-close`,
      STAGE_DEADLINES_MS.close,
      input.progress,
      undefined,
      input.guard
    );
    if (close && typeof close === "object" && "ok" in close && close.ok !== true) {
      closeError ??= "Event History close returned a non-success outcome.";
    }
  } catch (error) {
    closeError = error instanceof Error ? error.message : String(error);
    close = {
      ok: false,
      problem: {
        code: error instanceof HarnessStageTimeout ? "CLEANUP_CLOSE_TIMEOUT" : "CLEANUP_CLOSE_FAILED",
        message: closeError
      }
    };
  }
  return {
    stage: input.stage,
    unsubscribeAttempted,
    unsubscribeError,
    disposeAttempted,
    disposeError,
    rootRemovalAttempted,
    rootRemoved,
    rootError,
    closeAttempted: true,
    close,
    closeError
  };
}

export async function bestEffortHeapPreparationCleanup(input: Readonly<{
  adapter: "indexeddb" | "memory";
  eventCount: number;
  phase: "warmup" | "sample";
  sample: number | null;
  sessionId: string;
  databaseName: string | null;
  originalError: unknown;
  disposePanel: () => void | Promise<void>;
  closeHistory: () => Promise<unknown>;
  removeRoot: () => void;
  yieldFrame: () => Promise<void>;
  progress?: () => HarnessProgressInput;
  guard?: HarnessStageGuard;
}>): Promise<HeapPreparationCleanupEvidence> {
  let disposeError: string | null = null;
  let close: unknown = null;
  let rootRemoved = false;
  let frameYielded = false;
  const cleanupFailures: string[] = [];
  const cleanupProgress = (): HarnessProgressInput => input.progress?.() ?? {
    operationId: null,
    phase: "heap",
    stage: `${input.phase}-cleanup`,
    substage: `${input.phase}-cleanup`,
    sample: input.phase === "warmup" ? null : input.sample,
    trigger: null,
    scenario: null,
    cellIndex: null,
    cellTotal: 36,
    adapter: input.adapter,
    workload: null,
    shape: null,
    workloadPhase: null,
    offered: input.eventCount,
    settled: null,
    query: null
  };
  try {
    await input.disposePanel();
  } catch (error) {
    disposeError = error instanceof Error ? error.message : String(error);
    cleanupFailures.push(`disposePanel: ${disposeError}`);
  }
  try {
    close = await withStageDeadline(
      input.closeHistory(),
      `${input.phase}-cleanup-close`,
      STAGE_DEADLINES_MS.close,
      cleanupProgress,
      undefined,
      input.guard
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    close = {
      ok: false,
      problem: {
        code: error instanceof HarnessStageTimeout ? "CLEANUP_CLOSE_TIMEOUT" : "CLEANUP_CLOSE_FAILED",
        message
      }
    };
    cleanupFailures.push(`closeHistory: ${message}`);
  }
  try {
    input.removeRoot();
    rootRemoved = true;
  } catch (error) {
    cleanupFailures.push(`removeRoot: ${error instanceof Error ? error.message : String(error)}`);
    rootRemoved = false;
  }
  try {
    await withStageDeadline(
      input.yieldFrame(),
      `${input.phase}-cleanup-frame`,
      STAGE_DEADLINES_MS.frame,
      cleanupProgress,
      undefined,
      input.guard
    );
    frameYielded = true;
  } catch (error) {
    cleanupFailures.push(`yieldFrame: ${error instanceof Error ? error.message : String(error)}`);
    frameYielded = false;
  }
  return {
    adapter: input.adapter,
    phase: input.phase === "warmup" ? "warmup" as const : "cleanup" as const,
    sample: input.phase === "warmup" ? null : input.sample,
    eventCount: input.eventCount,
    retained: null,
    sessionId: input.sessionId,
    databaseName: input.databaseName,
    close,
    disposeError,
    rootRemoved,
    frameYielded,
    gcPasses: null,
    status: "FAIL" as const,
    failure: {
      code: "PREPARE_FAILED",
      message: [
        input.originalError instanceof Error ? input.originalError.message : String(input.originalError),
        ...cleanupFailures
      ].join("; ")
    }
  };
}

export async function closeHeapSessionWithEvidence(input: Readonly<{
    disposePanel: () => void | Promise<void>;
  closeHistory: () => Promise<Outcome<CloseResult>>;
}>): Promise<unknown> {
  let disposeError: { code: string; message: string } | null = null;
  let closeOutcome: Outcome<CloseResult> | null = null;
  let closeError: { code: string; message: string } | null = null;
  try {
    await input.disposePanel();
  } catch (error) {
    disposeError = { code: "PANEL_DISPOSE_FAILED", message: error instanceof Error ? error.message : String(error) };
  }
  try {
    closeOutcome = await input.closeHistory();
  } catch (error) {
    closeError = { code: "CLOSE_FAILED", message: error instanceof Error ? error.message : String(error) };
  }
  if (!disposeError && !closeError) return closeOutcome;
  const problem = disposeError ?? closeError!;
  return {
    ok: false,
    problem: {
      code: problem.code,
      message: [disposeError?.message, closeError?.message].filter(Boolean).join("; ")
    },
    ...(closeOutcome ? { closeOutcome } : {}),
    ...(disposeError ? { disposeError } : {}),
    ...(closeError ? { closeError } : {})
  };
}

declare global {
  interface Window {
    __LSEW_EVENT_HISTORY_PERFORMANCE__?: {
      run(overrides?: Partial<EventHistoryPerformanceConfig>, selection?: HarnessSelection, proofMode?: EventHistoryPerformanceProofMode): Promise<HarnessResult & { selection: HarnessSelection | null }>;
      classify(report: EventHistoryPerformanceReport, reference: EventHistoryPerformanceReference): ReturnType<typeof classifyEventHistoryPerformance>;
      prepareRetainedHeapSample(adapter: "indexeddb" | "memory", count: number, phase: "warmup" | "sample", sample: number | null, proofMode?: EventHistoryPerformanceProofMode): Promise<{ adapter: string; count: number; retained: number; sessionId: string; databaseName: string | null; phase: "warmup" | "sample"; sample: number | null }>;
      releaseRetainedHeapSample(): Promise<unknown>;
      removeRetainedHeapRoot(): Promise<boolean>;
      yieldRetainedHeapFrame(proofMode?: EventHistoryPerformanceProofMode): Promise<boolean>;
    };
  }
}

const DEFAULT_CONFIG: EventHistoryPerformanceConfig = {
  sustainedCount: 1_000,
  sustainedEventsPerSecond: TIMELINE_SUSTAINED_EVENTS_PER_SECOND,
  burstCount: ISSUE_16_TOTAL_EVENTS,
  burstPauseMs: 1
};

export type FilterQueryOperationName = "recent50" | "recent100" | "structured50" | "structured100" | "find" | "lookup" | "around";

export type FilterQueryOperationTelemetry = Readonly<{
  candidateBound: number;
  projectionReads: number;
  payloadHydrations: number;
  bounded: boolean;
  residualScan: boolean;
}>;

export function longTasksStartingDuringQuery(
  entries: readonly Readonly<Pick<PerformanceEntry, "startTime" | "duration">>[],
  startedAt: number,
  completedAt: number
): readonly number[] {
  return entries
    .filter((entry) => entry.startTime >= startedAt && entry.startTime <= completedAt)
    .map((entry) => entry.duration);
}

/** The structured query fixture has three keys only when the adapter retains all 10,000 events. */
export function filterQueryExpectedSequences(count: number): readonly number[] {
  return [1, 3_843, 7_685].filter((sequence) => sequence <= count);
}

/** Normalize adapter query evidence to the operation-specific gate contract. */
export function filterQueryOperationTelemetry(
  measurement: { telemetry?: any; result?: any },
  name: FilterQueryOperationName,
  adapter: "indexeddb" | "memory"
): FilterQueryOperationTelemetry {
  const telemetry = measurement.telemetry;
  if (!telemetry) {
    throw new Error(`The ${adapter} ${name} query did not expose bounded telemetry.`);
  }
  if (name === "find") {
    const residualScan = Boolean(telemetry.residualScan || telemetry.fullRetainedScan);
    return {
      candidateBound: telemetry.findCursorBound ?? telemetry.candidateBound ?? 0,
      projectionReads: telemetry.findCursorReads ?? 0,
      payloadHydrations: telemetry.payloadHydrations ?? 0,
      bounded: !residualScan,
      residualScan
    };
  }
  if (name === "lookup") {
    const residualScan = Boolean(telemetry.residualScan);
    return {
      candidateBound: 1,
      projectionReads: 0,
      payloadHydrations: telemetry.payloadHydrations ?? 0,
      bounded: !residualScan,
      residualScan
    };
  }
  const residualScan = Boolean(telemetry.residualScan);
  return {
    candidateBound: telemetry.candidateBound ?? 0,
    projectionReads: telemetry.evidenceCursorReads ?? 0,
    payloadHydrations: telemetry.payloadHydrations ?? 0,
    bounded: !residualScan,
    residualScan
  };
}

export function heapWorkloadShapes(adapter: "indexeddb" | "memory"): readonly EventHistoryShape[] {
  return adapter === "memory"
    ? ["small-lifecycle", "ordinary-item-update"]
    : ["small-lifecycle"];
}

let retainedHeapSession: RetainedHeapSession | null = null;
let retainedHeapSequence = 0;

export function validateHarnessSelection(selection: HarnessSelection | undefined): HarnessSelection | null {
  if (selection === undefined) return null;
  if (typeof selection.pageToken !== "string" || selection.pageToken.length === 0) {
    throw new Error("Performance shard requires a non-empty page token.");
  }
  if (selection.kind === "scenarios") {
    if (selection.id !== "scenarios") throw new Error("Performance scenario shard identity is invalid.");
    return selection;
  }
  if (selection.kind === "filter-impl-08") {
    if (selection.id !== "filter-impl-08-query") throw new Error("filter-impl-08 query shard identity is invalid.");
    return selection;
  }
  const expected = [
    ["matrix-indexeddb-sustained", "indexeddb", "sustained", 1, true],
    ["matrix-indexeddb-burst", "indexeddb", "burst", 10, true],
    ["matrix-memory-sustained", "memory", "sustained", 19, true],
    ["matrix-memory-burst", "memory", "burst", 28, false]
  ] as const;
  if (selection.cellOffset !== undefined && (!Number.isSafeInteger(selection.cellOffset) || selection.cellOffset < 1 || selection.cellOffset > 9)) {
    throw new Error("Performance matrix cell offset is invalid.");
  }
  if (!expected.some(([id, adapter, workload, firstCellIndex, collectAfterFinal]) => {
    const selectedCellNeedsCleanup = selection.cellOffset !== undefined
      && selection.cellOffset < 9
      && collectAfterFinal === false;
    return selection.id === id && selection.adapter === adapter && selection.workload === workload
      && selection.firstCellIndex === firstCellIndex
      && selection.collectAfterFinal === (selectedCellNeedsCleanup ? true : collectAfterFinal);
  })) throw new Error("Performance matrix shard identity is invalid.");
  return selection;
}

function validatePerformanceProofMode(
  proofMode: EventHistoryPerformanceProofMode | undefined
): EventHistoryPerformanceProofMode {
  const resolved = proofMode ?? EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME;
  if (
    resolved !== EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
    && resolved !== EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT
  ) {
    throw new Error(`Unsupported Event History performance proof mode: ${String(resolved)}.`);
  }
  return resolved;
}

async function runFilterQueryCell(
  adapter: "indexeddb" | "memory",
  sample: number,
  operationId: string | null,
  guard: HarnessStageGuard
): Promise<EventHistoryPerformanceQueryCell> {
  const count = adapter === "indexeddb" ? 10_000 : 5_000;
  const runId = `filter-query-${adapter}-${sample}`;
  const publishQueryProgress = (stage: string, substage: string, offered: number | null, settled: number | null, query: string | null = null): void => {
    publishHarnessProgress({
      operationId,
      phase: "cells",
      stage,
      substage,
      sample,
      trigger: null,
      scenario: null,
      cellIndex: null,
      cellTotal: 36,
      adapter,
      workload: null,
      shape: null,
      workloadPhase: "query",
      offered,
      settled,
      query
    });
  };
  publishQueryProgress("filter-query-fixture", "history-create", 0, 0);
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId: runId, capacityTier: "NORMAL" })
    : createInMemoryEventHistory({ panelSessionId: runId, capacityTier: "LOWER" });
  const events = Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const base = createEventHistoryWorkloadEvent("ordinary-item-update", index, runId) as LightstreamerEventEnvelope & { update?: { key?: string; fields?: Record<string, unknown> } };
    const key = `order-${String(((sequence - 1) % 3_842) + 1).padStart(5, "0")}`;
    return {
      ...base,
      id: `${runId}-event-${sequence}`,
      timestamp: 1_700_000_000_000 + sequence,
      update: base.update ? {
        ...base.update,
        key,
        fields: { ...base.update.fields, key }
      } : base.update
    } as LightstreamerEventEnvelope;
  });
  try {
    publishQueryProgress("filter-query-fixture", "offer", events.length, 0);
    const receipts = events.map((event) => history.offer(event));
    const heartbeat = setInterval(() => publishQueryProgress("filter-query-fixture", "receipt-settlement", events.length, null), 1_000);
    try {
      await Promise.all(receipts.map((receipt) => receipt.settled));
    } finally {
      clearInterval(heartbeat);
    }
    publishQueryProgress("filter-query-fixture", "receipts-settled", events.length, events.length);
    if (!guard.isActive()) throw new Error("Filter query benchmark was cancelled.");
    const firstRequest = (pageSize: number): EvidenceQueryRequest => ({
      at: "LATEST_COMMITTED",
      page: { order: "NEWEST_FIRST", size: pageSize },
      filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }
    });
    const structuredValue = typedFacetValue("key", "string", "order-00001");
    const structuredRequest = (pageSize: number): EvidenceQueryRequest => ({
      at: "LATEST_COMMITTED",
      page: { order: "OLDEST_FIRST", size: pageSize },
      filter: { revision: 1, text: "", criteria: { key: { include: [structuredValue], exclude: [] } }, around: null, unsupported: [] }
    });
    let longTaskObserverSupported = true;
    const timings = async (name: string, request: EvidenceQueryRequest): Promise<{ p95: number; result: any; telemetry: any; longTasks: number[]; gc: QuerySampleGcEvidence[] }> => {
      const samples: number[] = [];
      const gc: QuerySampleGcEvidence[] = [];
      const operationTelemetry: any[] = [];
      const longTasks: number[] = [];
      let result: any;
      for (let index = 0; index < 3; index += 1) {
        publishQueryProgress(`filter-query-${name}`, `${name}-sample-${index + 1}`, events.length, events.length, name);
        const entries: PerformanceEntry[] = [];
        const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
        longTaskObserverSupported = longTaskObserverSupported && supported;
        const observer = supported ? new PerformanceObserver((list) => entries.push(...list.getEntries())) : null;
        observer?.observe({ entryTypes: ["longtask"] });
        const started = performance.now();
        result = await history.query!(request);
        const completed = performance.now();
        publishQueryProgress(`filter-query-${name}`, `${name}-sample-${index + 1}-complete`, events.length, events.length, name);
        samples.push(completed - started);
        await delay(0);
        entries.push(...(observer?.takeRecords() ?? []));
        observer?.disconnect();
        longTasks.push(...longTasksStartingDuringQuery(entries, started, completed).filter((duration) => duration > 50));
        operationTelemetry.push(result.ok ? result.value.telemetry : null);
        if (index < 2) gc.push(await collectGarbageBetweenQuerySamples(name, (index + 1) as 1 | 2, guard));
      }
      return { p95: percentile(samples, 0.95), result, telemetry: operationTelemetry.at(-1), longTasks, gc };
    };
    const recent50 = await timings("recent50", firstRequest(50));
    const recent100 = await timings("recent100", firstRequest(100));
    const structured50 = await timings("structured50", structuredRequest(50));
    const structured100 = await timings("structured100", structuredRequest(100));
    if (!recent50.result.ok || !recent100.result.ok || !structured50.result.ok || !structured100.result.ok) throw new Error("Filter query benchmark base query failed.");
    const recent = recent100.result.value;
    const structured = structured100.result.value;
    const selected = recent.page.evidence[0]?.identity;
    if (!selected) throw new Error("Filter query benchmark did not return a selected identity.");
    const findMeasurement = await timings("find", { ...firstRequest(50), filter: { ...firstRequest(50).filter, criteria: { key: { include: [typedFacetValue("key", "string", "does-not-exist")], exclude: [] } }, around: null }, find: { text: "order-00001" } });
    const lookupMeasurement = await timings("lookup", { ...firstRequest(50), lookup: selected });
    const aroundMeasurement = await timings("around", { ...firstRequest(50), filter: { ...firstRequest(50).filter, around: { intervalId: selected.intervalId, start: 1_700_000_001_000, end: 1_700_000_002_000 } } });
    if (!findMeasurement.result.ok || !lookupMeasurement.result.ok || !aroundMeasurement.result.ok) throw new Error("Filter query benchmark optional probe failed.");
    const exactPage = (measurement: any, size: number, expected: readonly number[]) => measurement.result.value.page.evidence.length === Math.min(size, expected.length) && measurement.result.value.page.evidence.every((record: any, index: number) => record.identity.sequence === expected[index] && record.identity.eventId === `${runId}-event-${expected[index]}`);
    const recentExpected = Array.from({ length: count }, (_, index) => count - index);
    const structuredExpected = filterQueryExpectedSequences(count);
    const aroundExpected = Array.from({ length: 1_000 }, (_, index) => {
      const sequence = 1_999 - index;
      return { sequence, eventId: `${runId}-event-${sequence}` };
    });
    return {
      adapter,
      sample,
      fixture: { eventCount: count, distinctCommandKeyCount: 3_842 },
      latency: {
        recentSimplePage50P95Ms: recent50.p95,
        recentSimplePage100P95Ms: recent100.p95,
        structuredPage50P95Ms: structured50.p95,
        structuredPage100P95Ms: structured100.p95,
        findP95Ms: findMeasurement.p95,
        lookupP95Ms: lookupMeasurement.p95,
        aroundP95Ms: aroundMeasurement.p95
      },
      correctness: {
        totalsExact: recent50.result.value.totals.matching === count && recent100.result.value.totals.matching === count && structured50.result.value.totals.matching === structuredExpected.length && structured100.result.value.totals.matching === structuredExpected.length && aroundMeasurement.result.value.totals.matching === count && aroundMeasurement.result.value.totals.inScope === 1_000,
        orderExact: exactPage(recent50, 50, recentExpected) && exactPage(recent100, 100, recentExpected) && exactPage(structured50, 50, structuredExpected) && exactPage(structured100, 100, structuredExpected),
        collisionExact: structured.page.evidence.length === structuredExpected.length && structured.page.evidence.every((record: any, index: number) => record.identity.eventId === `${runId}-event-${structuredExpected[index]}`),
        findIndependent: findMeasurement.result.value.find?.total === structuredExpected.length && findMeasurement.result.value.find?.matches?.map((entry: any) => entry.sequence).join(",") === structuredExpected.join(",") && findMeasurement.result.value.totals.matching === 0,
        lookupExact: lookupMeasurement.result.value.lookup?.state === "RETAINED" && lookupMeasurement.result.value.lookup.evidence.payload !== undefined,
        aroundExact: aroundMeasurement.result.value.totals.matching === count
          && aroundMeasurement.result.value.totals.inScope === 1_000
          && isExactQueryPage(aroundMeasurement.result.value.page, aroundExpected.slice(0, 50))
      },
      telemetry: { operations: { recent50: filterQueryOperationTelemetry(recent50, "recent50", adapter), recent100: filterQueryOperationTelemetry(recent100, "recent100", adapter), structured50: filterQueryOperationTelemetry(structured50, "structured50", adapter), structured100: filterQueryOperationTelemetry(structured100, "structured100", adapter), find: filterQueryOperationTelemetry(findMeasurement, "find", adapter), lookup: filterQueryOperationTelemetry(lookupMeasurement, "lookup", adapter), around: filterQueryOperationTelemetry(aroundMeasurement, "around", adapter) } },
      longTasks: [...recent50.longTasks, ...recent100.longTasks, ...structured50.longTasks, ...structured100.longTasks, ...findMeasurement.longTasks, ...lookupMeasurement.longTasks, ...aroundMeasurement.longTasks],
      longTaskObserverSupported,
      querySampleGc: [...recent50.gc, ...recent100.gc, ...structured50.gc, ...structured100.gc, ...findMeasurement.gc, ...lookupMeasurement.gc, ...aroundMeasurement.gc]
    };
  } finally {
    await history.close();
  }
}

window.__LSEW_EVENT_HISTORY_PERFORMANCE__ = {
  async run(overrides = {}, requestedSelection, requestedProofMode) {
    const operationId = currentHarnessOperationId();
    const runGuard = createHarnessStageGuard(operationId);
    const selection = validateHarnessSelection(requestedSelection);
    const proofMode = validatePerformanceProofMode(requestedProofMode);
    const config = { ...DEFAULT_CONFIG, ...overrides };
    validateConfig(config);
    const cells: EventHistoryPerformanceCell[] = [];
    const cellCleanupGc: InterCellGcEvidence[] = [];
    const selectedCellOffset = selection?.kind === "matrix" ? selection.cellOffset ?? null : null;
    let cellIndex = selection?.kind === "matrix" ? selection.firstCellIndex - 1 : 0;
    let shardCellCount = 0;
    const adapters = selection?.kind === "matrix" ? [selection.adapter] as const : ["indexeddb", "memory"] as const;
    for (const adapter of adapters) {
      const workloads = selection?.kind === "matrix" ? [selection.workload] as const : ["sustained", "burst"] as const;
      for (const workload of workloads) {
        for (const shape of EVENT_HISTORY_SHAPES) {
          for (const sample of [1, 2, 3] as const) {
            if (selection?.kind === "scenarios" || selection?.kind === "filter-impl-08") continue;
            if (!runGuard.isActive()) throw new Error("Performance harness run was cancelled.");
            shardCellCount += 1;
            if (selectedCellOffset !== null && shardCellCount !== selectedCellOffset) continue;
            cellIndex = selection?.kind === "matrix"
              ? selection.firstCellIndex + shardCellCount - 1
              : cellIndex + 1;
            publishHarnessProgress({
              operationId,
              phase: "cells",
              stage: "cell-start",
              substage: "cell-start",
              sample,
              trigger: null,
              scenario: null,
              cellIndex,
              cellTotal: 36,
              adapter,
              workload,
              shape,
              workloadPhase: null,
              offered: 0,
              settled: 0,
              query: null
            });
            const collectAfterCell = selection?.kind !== "matrix"
              ? cellIndex < 36
              : selectedCellOffset !== null
                ? selection.collectAfterFinal
                : shardCellCount < 9 || selection.collectAfterFinal;
            if (!collectAfterCell) {
              cells.push(await runCell(adapter, workload, shape, sample, config, cellIndex, operationId, runGuard, proofMode));
              continue;
            }
            const completed = await runCellThenCollectGarbage(
              () => runCell(adapter, workload, shape, sample, config, cellIndex, operationId, runGuard, proofMode),
              cellIndex,
              runGuard,
              async (afterCellIndex, guard) => {
                publishHarnessProgress({
                  operationId,
                  phase: "cells",
                  stage: "cell-cleanup-gc",
                  substage: "cell-cleanup-gc",
                  sample,
                  trigger: null,
                  scenario: null,
                  cellIndex: afterCellIndex,
                  cellTotal: 36,
                  adapter,
                  workload,
                  shape,
                  workloadPhase: null,
                  offered: null,
                  settled: null,
                  query: null
                });
                return collectGarbageBetweenCells(afterCellIndex, guard);
              }
            );
            cells.push(completed.cell);
            cellCleanupGc.push(completed.gc);
          }
        }
      }
    }
    const terminalScenarios: EventHistoryPerformanceTerminalScenario[] = [];
    const runsScenarioShard = selection === undefined || selection?.kind === "scenarios";
    if (runsScenarioShard) for (const adapter of ["indexeddb", "memory"] as const) {
      for (const trigger of ["PENDING_BYTES", "PENDING_AGE"] as const) {
        if (!runGuard.isActive()) throw new Error("Performance harness run was cancelled.");
        publishHarnessProgress({
          operationId,
          phase: "terminal",
          stage: trigger,
          substage: trigger,
          sample: null,
          trigger,
          scenario: null,
          cellIndex: null,
          cellTotal: 36,
          adapter,
          workload: null,
          shape: null,
          workloadPhase: null,
          offered: null,
          settled: null,
          query: null
        });
        terminalScenarios.push(await runTerminalScenario(adapter, trigger, operationId, runGuard));
      }
    }
    const checkpointScenarios: EventHistoryPerformanceCheckpointScenario[] = [];
    const queryCells: EventHistoryPerformanceQueryCell[] = [];
    if (runsScenarioShard || selection?.kind === "filter-impl-08") {
      for (const adapter of ["indexeddb", "memory"] as const) {
        for (const sample of [1, 2, 3] as const) {
          queryCells.push(await runFilterQueryCell(adapter, sample, operationId, runGuard));
        }
      }
    }
    if (runsScenarioShard) for (const adapter of ["indexeddb", "memory"] as const) {
      for (const name of ["representative", "maximum-2MiB"] as const) {
        if (!runGuard.isActive()) throw new Error("Performance harness run was cancelled.");
        publishHarnessProgress({
          operationId,
          phase: "checkpoint",
          stage: name,
          substage: name,
          sample: null,
          trigger: null,
          scenario: name,
          cellIndex: null,
          cellTotal: 36,
          adapter,
          workload: null,
          shape: null,
          workloadPhase: null,
          offered: null,
          settled: null,
          query: null
        });
        checkpointScenarios.push(await runCheckpointScenario(adapter, name, operationId, runGuard));
      }
    }
    return {
      schemaVersion: 2,
      proofMode,
      frameProof: proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT
        ? {
            publicationBoundary: "react-layout-commit-dom-publication",
            compositorFrameMeasured: false,
            coherent: true,
            missingBoundaryCount: 0
          }
        : {
            publicationBoundary: "visible-compositor-frame",
            compositorFrameMeasured: true,
            coherent: true,
            missingBoundaryCount: 0
          },
      selection,
      anchors: { issue16TotalEvents: ISSUE_16_TOTAL_EVENTS },
      config,
      shapeFacts: representativeEventHistoryShapeFacts(),
      cells,
      queryCells,
      cellCleanupGc,
      terminalScenarios,
      checkpointScenarios
    };
  },
  classify(report, reference) {
    try {
      return classifyEventHistoryPerformance(report, reference);
    } catch (error) {
      return {
        verdict: "FAIL",
        failures: [`Classifier threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`],
        reviewReasons: [],
        checkedCells: 0,
        checkedSamples: 0
      };
    }
  },
  async prepareRetainedHeapSample(adapter, count, phase, sample, requestedProofMode) {
    const proofMode = validatePerformanceProofMode(requestedProofMode);
    if (retainedHeapSession) throw new Error("A retained heap session is already active; cleanup must complete before the next sample.");
    const runId = `heap-${adapter}-${phase}-${sample ?? "warmup"}-${retainedHeapSequence += 1}`;
    const operationId = currentHarnessOperationId();
    const heapGuard = createHarnessStageGuard(operationId);
    const databaseName = adapter === "indexeddb" ? authoritativeEventDatabaseName(runId) : null;
    const root = document.createElement("main");
    let panel: Awaited<ReturnType<typeof mountProductionPanel>> | null = null;
    let history: EventHistory | null = null;
    try {
      history = adapter === "indexeddb"
        ? await createIndexedDbEventHistory({ panelSessionId: runId, capacityTier: "NORMAL" })
        : createInMemoryEventHistory({ panelSessionId: runId, capacityTier: "LOWER" });
      if (!heapGuard.isActive()) throw new Error("Heap preparation was cancelled.");
      root.id = "app";
      document.body.replaceChildren(root);
      panel = await mountProductionPanel(history, undefined, root);
      if (!heapGuard.isActive()) throw new Error("Heap preparation was cancelled.");
      const heapShapes = heapWorkloadShapes(adapter);
      const events = Array.from({ length: count }, (_, sequence) =>
        createEventHistoryWorkloadEvent(heapShapes[sequence % heapShapes.length]!, sequence, runId)
      );
      const offered = events.length;
      const heapProgress = (settled: number | null = null): HarnessProgressInput => ({
        operationId,
        phase: "heap",
        stage: `${phase}-receipt-settlement`,
        substage: `${phase}-receipt-settlement`,
        sample,
        trigger: null,
        scenario: null,
        cellIndex: null,
        cellTotal: 36,
        adapter,
        workload: null,
        shape: null,
        workloadPhase: null,
        offered,
        settled,
        query: null
      });
      publishStageProgress(heapProgress(), heapGuard);
      await settleOffers(
        history,
        events,
        `${phase}-heap-receipts`,
        phase === "warmup" ? STAGE_DEADLINES_MS.heapWarmupReceipts : STAGE_DEADLINES_MS.heapSampleReceipts,
        heapProgress,
        heapGuard
      );
      const retained = await releaseHeapWorkloadCandidates(
        events,
        () => waitForBoundedHygieneBoundary(`${phase}-frame`, heapProgress, proofMode, heapGuard)
      );
      if (!heapGuard.isActive()) throw new Error("Heap preparation was cancelled.");
      retainedHeapSession = { operationId, adapter, count, retained, sessionId: runId, root: panel.root, disposePanel: panel.disposePanel, runtime: panel.runtime, history, databaseName };
      return { adapter, count, retained, sessionId: runId, databaseName, phase, sample };
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const cleanupEvidence = await bestEffortHeapPreparationCleanup({
        adapter,
        eventCount: count,
        phase,
        sample,
        sessionId: runId,
        databaseName,
        originalError,
        disposePanel: () => panel?.disposePanel(),
        closeHistory: () => history ? history.close() : Promise.resolve(null),
        removeRoot: () => root.remove(),
        yieldFrame: () => waitForBoundedHygieneBoundary(`${phase}-cleanup-frame`, () => ({
          operationId,
          phase: "heap",
          stage: `${phase}-cleanup-frame`,
          substage: `${phase}-cleanup-frame`,
          sample,
          trigger: null,
          scenario: null,
          cellIndex: null,
          cellTotal: 36,
          adapter,
          workload: null,
          shape: null,
          workloadPhase: null,
          offered: count,
          settled: null,
          query: null
        }), proofMode),
        progress: () => ({
          operationId,
          phase: "heap",
          stage: `${phase}-cleanup`,
          substage: `${phase}-cleanup`,
          sample,
          trigger: null,
          scenario: null,
          cellIndex: null,
          cellTotal: 36,
          adapter,
          workload: null,
          shape: null,
          workloadPhase: null,
          offered: count,
          settled: null,
          query: null
        }),
        guard: heapGuard
      });
      Object.assign(originalError, { code: "PREPARE_FAILED", cleanupEvidence });
      throw originalError;
    }
  },
  async releaseRetainedHeapSample() {
    const session = retainedHeapSession;
    if (!session) throw new Error("No retained heap session is active.");
    return closeHeapSessionWithEvidence({
      disposePanel: session.disposePanel,
      closeHistory: () => session.history.close()
    });
  },
  async removeRetainedHeapRoot() {
    const session = retainedHeapSession;
    if (!session) return false;
    session.root.remove();
    retainedHeapSession = null;
    return !session.root.isConnected;
  },
  async yieldRetainedHeapFrame(requestedProofMode) {
    const proofMode = validatePerformanceProofMode(requestedProofMode);
    const operationId = currentHarnessOperationId();
    await waitForBoundedHygieneBoundary("heap-retained-frame", () => ({
      operationId,
      phase: "heap",
      stage: "retained-frame",
      substage: "retained-frame",
      sample: null,
      trigger: null,
      scenario: null,
      cellIndex: null,
      cellTotal: 36,
      adapter: null,
      workload: null,
      shape: null,
      workloadPhase: "paint",
      offered: null,
      settled: null,
      query: null
    }), proofMode);
    return true;
  }
};

export async function runCellThenCollectGarbage<T>(
  runMeasuredCell: () => Promise<T>,
  afterCellIndex: number,
  guard: HarnessStageGuard,
  collect: (afterCellIndex: number, guard: HarnessStageGuard) => Promise<InterCellGcEvidence> = collectGarbageBetweenCells
): Promise<Readonly<{ cell: T; gc: InterCellGcEvidence }>> {
  const cell = await runMeasuredCell();
  const gc = await collect(afterCellIndex, guard);
  return Object.freeze({ cell, gc });
}

export async function collectGarbageBetweenCells(
  afterCellIndex: number,
  guard: HarnessStageGuard,
  collect: (() => void) | null = (globalThis as typeof globalThis & { gc?: () => void }).gc ?? null
): Promise<InterCellGcEvidence> {
  if (!guard.isActive()) throw new Error("Inter-cell garbage collection was cancelled.");
  if (typeof collect !== "function") {
    throw new Error("Inter-cell garbage collection requires Chrome --expose-gc support.");
  }
  await delay(0);
  if (!guard.isActive()) throw new Error("Inter-cell garbage collection was cancelled.");
  for (let pass = 0; pass < 3; pass += 1) collect();
  return Object.freeze({ afterCellIndex, gcPasses: 3, phase: "BETWEEN_CELLS" });
}

async function runCell(
  adapter: "indexeddb" | "memory",
  workload: EventHistoryPerformanceWorkload,
  shape: EventHistoryShape,
  sample: number,
  config: EventHistoryPerformanceConfig,
  cellIndex: number,
  operationId: string | null,
  runGuard: HarnessStageGuard,
  proofMode: EventHistoryPerformanceProofMode = EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
): Promise<EventHistoryPerformanceCell> {
  const runId = `${adapter}-${workload}-${shape}-sample-${sample}`;
  const cancellationProgress = (): HarnessProgressInput => ({
    operationId,
    phase: "cells",
    stage: "cleanup",
    substage: "cleanup",
    sample,
    trigger: null,
    scenario: null,
    cellIndex,
    cellTotal: 36,
    adapter,
    workload,
    shape,
    workloadPhase: null,
    offered: null,
    settled: null,
    query: null
  });
  if (!runGuard.isActive()) throw new Error("Event History cell was cancelled.");
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId: `event-history-performance-${runId}`, capacityTier: "NORMAL" })
    : createInMemoryEventHistory({ panelSessionId: runId, capacityTier: "LOWER" });
  if (!runGuard.isActive()) {
    const failure = new Error("Event History cell was cancelled after history acquisition.");
    Object.assign(failure, {
      cleanupEvidence: await cleanupHarnessResources({ history, stage: `cell-${cellIndex}`, guard: runGuard, progress: cancellationProgress })
    });
    throw failure;
  }
  const storageProbe = adapter === "indexeddb" ? beginStorageProbe() : null;
  const root = document.createElement("main");
  root.id = "app";
  document.body.replaceChildren(root);

  const offerTimes = new Map<string, number>();
  const pending = createPendingTelemetryTracker();
  const publicationLatencies: number[] = [];
  const visibleLatencies: number[] = [];
  const layoutCommitLatencies: number[] = [];
  const committedBoundaryAt = new Map<string, number>();
  const committedBoundaryVisibleLatencies: number[] = [];
  const committedBoundaryLayoutCommitLatencies: number[] = [];
  const layoutCommittedEventIds = new Set<string>();
  const publishedIds: string[] = [];
  const phaseIntervals: PhaseInterval[] = [];
  const longTaskEntries: PerformanceEntry[] = [];
  let phase: PhaseName = "capture";
  let phaseStartedAt = performance.now();
  let offeredCount = 0;
  let settledCount = 0;
  const expectedCount = workload === "sustained" ? config.sustainedCount : config.burstCount;
  const expectedFinalId = `${runId}-${shape}-${expectedCount - 1}`;
  let panel: Awaited<ReturnType<typeof mountProductionPanel>> | null = null;
  let layoutCommitCoherent = true;
  const runtimeDiagnostics = (): HarnessRuntimeDiagnostics | undefined => {
    const diagnostics = panel?.runtime.getPerformanceDiagnostics?.();
    return diagnostics ? { expectedFinalId, ...diagnostics } : undefined;
  };
  const progress = (stage: string, workloadPhase: PhaseName | null = phase, query: string | null = null): HarnessProgressInput => ({
    operationId,
    phase: "cells",
    stage,
    substage: stage,
    sample,
    trigger: null,
    scenario: null,
    cellIndex,
    cellTotal: 36,
    adapter,
    workload,
    shape,
    workloadPhase,
    offered: offeredCount,
    settled: settledCount,
    query,
    ...(() => {
      if (stage !== "visible-frame" && stage !== "layout-commit" && query !== "final-read") return {};
      const diagnostics = runtimeDiagnostics();
      return diagnostics ? { runtimeDiagnostics: diagnostics } : {};
    })()
  });
  const updateProgress = (stage: string, workloadPhase: PhaseName | null = phase, query: string | null = null): void => {
    publishStageProgress(progress(stage, workloadPhase, query), runGuard);
  };
  const pressureTransitions: string[] = [];
  let terminalReason: string | null = null;
  let terminalPublication: Extract<HistoryPublication, { type: "terminal" }>['terminal'] | null = null;
  let unsubscribe: (() => void) | undefined;
  const samplePending = () => pending.sample();
  const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
  const longTaskObserver = longTaskSupported
    ? new PerformanceObserver((entries) => {
        longTaskEntries.push(...entries.getEntries());
      })
    : null;
  longTaskObserver?.observe({ entryTypes: ["longtask"] });

  const enterPhase = (next: PhaseName): void => {
    if (next === phase) return;
    const now = performance.now();
    phaseIntervals.push({ phase, start: phaseStartedAt, end: now });
    phase = next;
    phaseStartedAt = now;
  };

  let resolveFinalPublication!: () => void;
  let finalPublicationAt: number | null = null;
  const finalPublication = new Promise<void>((resolve) => { resolveFinalPublication = resolve; });
  const cleanupSetupFailure = async (error: unknown): Promise<never> => {
    const failure = error instanceof Error ? error : new Error(String(error));
    Object.assign(failure, {
      cleanupEvidence: await cleanupHarnessResources({
        history,
        stage: `cell-${cellIndex}`,
        guard: runGuard,
        progress: cancellationProgress,
        unsubscribe,
        disposePanel: panel?.disposePanel,
        removeRoot: () => {
          root.remove();
          return !root.isConnected;
        },
        restoreStorage: () => storageProbe?.restore(),
        disconnectObserver: () => longTaskObserver?.disconnect()
      })
    });
    throw failure;
  };
  try {
    const performanceHooks: WorkbenchRuntimePerformanceHooks = {
      onCommittedEvidenceBoundary(boundary, timestampMs) {
        if (!runGuard.isActive()) return;
        committedBoundaryAt.set(boundary.eventId, timestampMs);
      },
      ...(proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
        ? {
            onVisibleFrame(_boundary: any, timestampMs: number, coveredBoundaries: readonly any[]) {
              if (!runGuard.isActive()) return;
              for (const coveredBoundary of coveredBoundaries) {
                const offeredAt = offerTimes.get(coveredBoundary.eventId);
                if (offeredAt !== undefined) visibleLatencies.push(Math.max(0, timestampMs - offeredAt));
                const committedAt = committedBoundaryAt.get(coveredBoundary.eventId);
                if (committedAt !== undefined) committedBoundaryVisibleLatencies.push(Math.max(0, timestampMs - committedAt));
                if (coveredBoundary.eventId === expectedFinalId) {
                  finalPublicationAt = timestampMs;
                  resolveFinalPublication();
                }
              }
            }
          }
        : {
            onLayoutCommit(_boundary: any, timestampMs: number, coveredBoundaries: readonly any[]) {
              if (!runGuard.isActive()) return;
              if (!root.isConnected || !root.querySelector(".workbench-react")) layoutCommitCoherent = false;
              for (const coveredBoundary of coveredBoundaries) {
                layoutCommittedEventIds.add(coveredBoundary.eventId);
                const offeredAt = offerTimes.get(coveredBoundary.eventId);
                if (offeredAt !== undefined) layoutCommitLatencies.push(Math.max(0, timestampMs - offeredAt));
                const committedAt = committedBoundaryAt.get(coveredBoundary.eventId);
                if (committedAt !== undefined) committedBoundaryLayoutCommitLatencies.push(Math.max(0, timestampMs - committedAt));
                if (coveredBoundary.eventId === expectedFinalId) {
                  finalPublicationAt = timestampMs;
                  resolveFinalPublication();
                }
              }
            }
          })
    };
    panel = await mountProductionPanel(history, performanceHooks, root);
  } catch (error) {
    await cleanupSetupFailure(error);
  }
  if (!runGuard.isActive()) {
    await cleanupSetupFailure(new Error("Event History cell was cancelled after panel acquisition."));
  }
  const events = Array.from({ length: expectedCount }, (_, sequence) =>
    createEventHistoryWorkloadEvent(shape, sequence, runId)
  );
  const expectedIds = events.map((event) => event.id);
  const workloadFactScalars = captureCellWorkloadFactScalars(shape, events[42] ?? events[0]!);
  try {
    unsubscribe = history.follow({ from: "NOW" }, (publication: HistoryPublication) => {
      if (!runGuard.isActive()) return;
      if (publication.type === "status") {
        const state = publication.status.capacity.state;
        if (pressureTransitions.at(-1) !== state) pressureTransitions.push(state);
        return;
      }
      if (publication.type === "terminal") {
        terminalReason = publication.terminal.reason;
        terminalPublication = publication.terminal;
      }
      if (publication.type !== "committed-evidence") return;
      const now = performance.now();
      for (const evidence of publication.evidence) {
        publishedIds.push(evidence.eventId);
        pending.settle(evidence.eventId);
        const offeredAt = offerTimes.get(evidence.eventId);
        if (offeredAt !== undefined) publicationLatencies.push(Math.max(0, now - offeredAt));
      }
      samplePending();
      updateProgress("receipt-settled", "commit");
    });
  } catch (error) {
    await cleanupSetupFailure(error);
  }

  let primaryFailure: Error | null = null;
  try {
    const startedAt = performance.now();
    const receipts = workload === "sustained"
      ? await withStageDeadline(
        offerSustained(history, events, config, offerTimes, pending, () => {
          if (!runGuard.isActive()) return;
          enterPhase("capture");
          offeredCount += 1;
          updateProgress("offer", "capture");
        }, samplePending, runGuard),
        `cell-${cellIndex}-offer`,
        STAGE_DEADLINES_MS.cellOffer,
        () => progress("offer", "capture"),
        undefined,
        runGuard
      )
      : await withStageDeadline(
        offerBurst(history, events, config, offerTimes, pending, () => {
          if (!runGuard.isActive()) return;
          offeredCount += 1;
          updateProgress("offer", "capture");
        }, samplePending, runGuard),
        `cell-${cellIndex}-offer`,
        STAGE_DEADLINES_MS.cellOffer,
        () => progress("offer", "capture"),
        undefined,
        runGuard
      );
    const enqueueElapsedMs = performance.now() - startedAt;
    enterPhase("commit");
    updateProgress("receipt-settlement", "commit");
    await settleReceiptStage(
      receipts,
      `cell-${cellIndex}-receipts`,
      STAGE_DEADLINES_MS.cellReceipts,
      (settled) => {
        if (!runGuard.isActive()) return progress("receipt-settlement", "commit");
        settledCount = settled;
        return progress("receipt-settlement", "commit");
      },
      runGuard
    );
    const commitSettledAt = performance.now();
    enterPhase("paint");
    const publicationStage = proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
      ? "visible-frame"
      : "layout-commit";
    updateProgress(publicationStage, "paint");
    await withStageDeadline(
      finalPublication,
      `cell-${cellIndex}-${publicationStage}`,
      STAGE_DEADLINES_MS.visibleFrame,
      () => progress(publicationStage, "paint"),
      undefined,
      runGuard
    );
    if (proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.NON_INTERACTIVE_LAYOUT_COMMIT) {
      if (!layoutCommitCoherent || layoutCommitLatencies.length === 0 || layoutCommittedEventIds.size !== expectedCount) {
        throw new Error(
          `Cell ${cellIndex} did not produce coherent production React DOM publication for every committed boundary `
          + `(coherent=${layoutCommitCoherent}, boundaries=${layoutCommittedEventIds.size}/${expectedCount}).`
        );
      }
    }
    // The journal owns immutable deserialized Evidence after settlement. Drop
    // the caller-owned large workload payloads before repeated queries so the
    // final memory cell measures the journal rather than two complete copies.
    events.length = 0;
    await waitForBoundedHygieneBoundary(
      `cell-${cellIndex}-frame`,
      () => progress("frame", "paint"),
      proofMode,
      runGuard
    );
    const readStartedAt = performance.now();
    enterPhase("query");
    const querySampleGc: QuerySampleGcEvidence[] = [];
    const queryMeasurements = await withStageDeadline((async () => {
      const recentPageP95Ms = await measureQuery(history, () => history.read({ limit: 100, order: "desc" }), "recent-page", () => progress("query", "query", "recent-page"), runGuard, querySampleGc, collectGarbageBetweenQuerySamples, enterPhase);
      const emptyFilter = {
        revision: 1,
        text: "",
        criteria: {},
        around: null,
        unsupported: []
      };
      const structuredFilter = {
        ...emptyFilter,
        criteria: { mode: { include: [typedFacetValue("mode", "enum", "COMMAND")], exclude: [] } }
      };
      const structuredIndexedP95Ms = await measureQuery(
        history,
        () => history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: structuredFilter }),
        "structured-indexed",
        () => progress("query", "query", "structured-indexed"),
        runGuard,
        querySampleGc,
        collectGarbageBetweenQuerySamples,
        enterPhase
      );
      const findP95Ms = await measureQuery(
        history,
        () => history.query!({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 100 }, filter: emptyFilter, find: { text: shape === "small-lifecycle" ? "stream-sensing" : "order", scopeToFilter: true } }),
        "find",
        () => progress("query", "query", "find"),
        runGuard,
        querySampleGc,
        collectGarbageBetweenQuerySamples,
        enterPhase
      );
      const full = await measureAuthoritativeFullQuery(history, () => progress("query", "query", "full"), runGuard, querySampleGc, collectGarbageBetweenQuerySamples, enterPhase);
      return { recentPageP95Ms, structuredIndexedP95Ms, findP95Ms, fullP95Ms: full.p95Ms, read: full.read };
    })(), `cell-${cellIndex}-query`, STAGE_DEADLINES_MS.queryTotal, () => progress("query", "query", "all"), undefined, runGuard);
    const { recentPageP95Ms, structuredIndexedP95Ms, findP95Ms, fullP95Ms, read } = queryMeasurements;
    const queryElapsedMs = performance.now() - readStartedAt;
    const retainedIds = read.ok ? read.value.evidence.map((entry) => entry.eventId) : [];
    const boundary = read.ok ? read.value.committedEvidenceBoundary : null;
    const now = performance.now();
    phaseIntervals.push({ phase, start: phaseStartedAt, end: now });
    longTaskEntries.push(...(longTaskObserver?.takeRecords() ?? []));
    longTaskObserver?.disconnect();
    const attributedLongTasks = attributeLongTasks(longTaskEntries, phaseIntervals);
    const storageEstimate = await withStageDeadline(
      captureStorageEstimate(),
      `cell-${cellIndex}-storage-estimate`,
      STAGE_DEADLINES_MS.read,
      () => progress("storage-estimate", "query", "storage-estimate"),
      undefined,
      runGuard
    );
    const terminal = terminalPublication as Extract<HistoryPublication, { type: "terminal" }>['terminal'] | null;
    const firstMissingEventId = terminal?.firstMissingEventId ?? null;
    const refusedCount = terminal?.rejected.count ?? 0;
    const discardedCount = terminal?.discarded.count ?? 0;
    return {
      adapter,
      workload,
      shape: shape as EventHistoryPerformanceShape,
      sample,
      accepted: receipts.length,
      published: publishedIds.length,
      retained: read.ok ? read.value.total : 0,
      correctness: {
        retainedMatchesAccepted: read.ok && read.value.total === receipts.length,
        publicationMatchesAccepted: publishedIds.length === receipts.length,
        retainedInOrder: idsMatch(retainedIds, expectedIds),
        publicationInOrder: idsMatch(publishedIds, expectedIds),
        finalBoundaryCorrect: boundary?.eventId === expectedFinalId && boundary?.sequence === expectedCount,
        terminalOutcomeCorrect: read.ok && terminalReason === null &&
          boundary?.eventId === expectedFinalId && boundary.sequence === expectedCount &&
          firstMissingEventId === null && refusedCount === 0 && discardedCount === 0
      },
      identityEvidence: {
        expectedEventIds: expectedIds,
        retainedEventIds: retainedIds,
        publishedEventIds: publishedIds
      },
      querySampleGc,
      latency: {
        offerToPublicationP95Ms: percentile(publicationLatencies, 0.95),
        offerToVisibleFrameP95Ms: percentile(
          proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
            ? visibleLatencies
            : layoutCommitLatencies,
          0.95
        ),
        committedBoundaryToVisibleFrameP95Ms: percentile(
          proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME
            ? committedBoundaryVisibleLatencies
            : committedBoundaryLayoutCommitLatencies,
          0.95
        ),
        finalBoundaryVisibleMs: finalPublicationAt === null
          ? null
          : Math.max(0, finalPublicationAt - (offerTimes.get(expectedFinalId) ?? startedAt)),
        behindBacklogMs: Math.max(0, commitSettledAt - (startedAt + enqueueElapsedMs)),
        recentPageP95Ms,
        structuredIndexedP95Ms,
        findFullP95Ms: Math.max(findP95Ms, fullP95Ms)
      },
      longTasks: { supported: longTaskSupported, ...attributedLongTasks },
      storage: storageTelemetryForCell(storageProbe?.snapshot() ?? emptyStorageTelemetry()),
      storageEstimate,
      workloadFacts: {
        expectedCount,
        offeredEventsPerSecond: workload === "sustained"
          ? config.sustainedEventsPerSecond
          : burstOfferedEventsPerSecond(expectedCount, enqueueElapsedMs),
        ...workloadFactScalars
      },
      pressure: {
        maxPendingBytes: pending.snapshot().maxPendingBytes,
        maxOldestPendingAgeMs: pending.snapshot().maxOldestPendingAgeMs,
        transitions: pressureTransitions,
        limits: (() => {
          const limits = historyCapacityLimits(adapter === "indexeddb" ? "NORMAL" : "LOWER");
          return {
            retainedCount: limits.maxRetainedCount,
            retainedBytes: limits.maxRetainedBytes,
            pendingBytes: limits.pendingStopBytes,
            pendingAgeMs: limits.pendingAgeStopMs
          };
        })()
      },
      terminal: {
        phase: terminalReason ? "STOPPED" : "RUNNING",
        reason: terminalReason,
        committedEvidenceBoundary: boundary ? { sequence: boundary.sequence, eventId: boundary.eventId } : null,
        firstMissingEventId,
        refusedCount,
        discardedCount
      },
      enqueueElapsedMs,
      queryElapsedMs,
    } as EventHistoryPerformanceCell;
  } catch (error) {
    primaryFailure = normalizeHarnessError(error, `cell-${cellIndex}`, progress("failed", phase), runGuard);
    throw primaryFailure;
  } finally {
    const cleanupEvidence = await cleanupHarnessResources({
      history,
      stage: `cell-${cellIndex}`,
      guard: runGuard,
      progress: () => progress("close", null),
      unsubscribe,
      disposePanel: panel?.disposePanel,
      removeRoot: () => {
        root.remove();
        return !root.isConnected;
      },
      restoreStorage: () => storageProbe?.restore(),
      disconnectObserver: () => longTaskObserver?.disconnect()
    });
    const cleanupMessage = cleanupEvidence.unsubscribeError
      ?? cleanupEvidence.disposeError
      ?? cleanupEvidence.rootError
      ?? cleanupEvidence.closeError;
    if (primaryFailure) {
      Object.assign(primaryFailure, { cleanupEvidence });
    } else if (cleanupMessage) {
      const cleanupFailure = new Error(cleanupMessage);
      Object.assign(cleanupFailure, { cleanupEvidence });
      throw cleanupFailure;
    }
  }
}

export function captureCellWorkloadFactScalars(
  shape: EventHistoryShape,
  representativeEvent: LightstreamerEventEnvelope
): Readonly<{
  shapeBytes: number;
  persistedJsonBytes: number;
  indexedDbWritesPerEvent: number;
  searchTokenCount: number;
}> {
  const shapeFact = representativeEventHistoryShapeFacts().find((fact) => fact.id === shape);
  return Object.freeze({
    shapeBytes: utf8JsonBytes(representativeEvent),
    persistedJsonBytes: shapeFact?.persistedJsonBytes ?? 0,
    indexedDbWritesPerEvent: shapeFact?.indexedDbWritesPerEvent ?? 0,
    searchTokenCount: shapeFact?.searchTokenCount ?? 0
  });
}

export function burstOfferedEventsPerSecond(expectedCount: number, enqueueElapsedMs: number): number {
  return expectedCount / Math.max(0.001, enqueueElapsedMs / 1_000);
}

export async function runTerminalScenario(
  adapter: "indexeddb" | "memory",
  trigger: "PENDING_BYTES" | "PENDING_AGE",
  operationId: string | null,
  guard: HarnessStageGuard
): Promise<EventHistoryPerformanceTerminalScenario> {
  if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
  const tier = adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const;
  let releaseCommit = (): void => undefined;
  const blockedCommit = new Promise<void>((resolve) => { releaseCommit = resolve; });
  const panelSessionId = `event-history-terminal-${adapter}-${trigger.toLowerCase()}`;
  const progress = (
    stage = `${trigger}-receipt-settlement`,
    offered: number | null = null,
    settled: number | null = null
  ): HarnessProgressInput => ({
    operationId,
    phase: "terminal",
    stage,
    substage: stage,
    sample: null,
    trigger,
    scenario: null,
    cellIndex: null,
    cellTotal: 36,
    adapter,
    workload: null,
    shape: null,
    workloadPhase: null,
    offered,
    settled,
    query: null
  });
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId, capacityTier: tier, ...(trigger === "PENDING_AGE" ? { commitBatch: () => blockedCommit } : {}) })
    : createInMemoryEventHistory({ panelSessionId, capacityTier: tier, ...(trigger === "PENDING_AGE" ? { commitBatch: () => blockedCommit } : {}) });
  if (!guard.isActive()) {
    const failure = new Error("Terminal scenario was cancelled after history acquisition.");
    Object.assign(failure, {
      cleanupEvidence: await cleanupHarnessResources({ history, stage: `terminal-${adapter}-${trigger}`, guard, progress })
    });
    throw failure;
  }
  const terminals: Array<Extract<HistoryPublication, { type: "terminal" }>> = [];
  const publishedEventIds: string[] = [];
  const pressureTransitions: string[] = [];
  let unsubscribe: (() => void) | undefined;
  let followCompleted = false;
  try {
    unsubscribe = history.follow({ from: "NOW" }, (publication) => {
      if (!guard.isActive()) return;
      if (publication.type === "terminal") terminals.push(publication);
      if (publication.type === "status") {
        const state = publication.status.capacity.state;
        if (pressureTransitions.at(-1) !== state) pressureTransitions.push(state);
      }
      if (publication.type === "committed-evidence") {
        publishedEventIds.push(...publication.evidence.map((evidence) => evidence.eventId));
      }
    });
    followCompleted = true;
    const receipts: Array<{ id: string; receipt: ReturnType<EventHistory["offer"]> }> = [];
    const firstEvent = createEventHistoryWorkloadEvent("large-json-rich", 0, `${panelSessionId}-accepted`);
    if (trigger === "PENDING_BYTES") {
      const events = Array.from({ length: TERMINAL_PENDING_BYTE_EVENT_COUNT }, (_, index) =>
        createStagedTopologyCheckpointCandidate(`${panelSessionId}-${index}`, "terminal-pressure", TERMINAL_CHECKPOINT_PAYLOAD_BYTES)
      );
      if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
      for (const event of events) {
        if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
        receipts.push({ id: event.id, receipt: history.offer(event) });
      }
    } else {
      if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
      receipts.push({ id: firstEvent.id, receipt: history.offer(firstEvent) });
      await delay((tier === "NORMAL" ? 30_000 : 5_000) + 150);
      if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
      const refused = createEventHistoryWorkloadEvent("small-lifecycle", 1, `${panelSessionId}-refused`);
      receipts.push({ id: refused.id, receipt: history.offer(refused) });
      releaseCommit();
    }
    publishStageProgress(progress(), guard);
    const outcomes = await settleReceiptStage(
      receipts.map(({ receipt }) => receipt.settled),
      `terminal-${adapter}-${trigger}-receipts`,
      STAGE_DEADLINES_MS.terminalReceipts,
      (settled) => progress(`${trigger}-receipt-settlement`, receipts.length, settled),
      guard
    );
  const accepted = outcomes.filter((outcome) => outcome.outcome === "BECAME_EVIDENCE");
  const refused = receipts.filter((entry, index) => outcomes[index]?.outcome === "NOT_EVIDENCE");
  const offeredEventIds = receipts.map((entry) => entry.id);
  const acceptedEventIds = receipts.filter((_entry, index) => outcomes[index]?.outcome === "BECAME_EVIDENCE").map((entry) => entry.id);
  const refusedEventIds = refused.map((entry) => entry.id);
  if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
  publishStageProgress({ ...progress(), stage: `${trigger}-read` }, guard);
  const read = await withStageDeadline(
    history.read({ order: "asc" }),
    `terminal-${adapter}-${trigger}-read`,
    STAGE_DEADLINES_MS.read,
    () => ({ ...progress(), stage: `${trigger}-read` }),
    undefined,
    guard
  );
  const terminal = terminals.at(-1)?.terminal ?? null;
  unsubscribe?.();
  unsubscribe = undefined;
  if (!guard.isActive()) throw new Error("Terminal scenario was cancelled.");
  const closeOutcome = await withStageDeadline(
    history.close(),
    `terminal-${adapter}-${trigger}-close`,
    STAGE_DEADLINES_MS.close,
    () => ({ ...progress(), stage: `${trigger}-close` }),
    undefined,
    guard
  );
  if (closeOutcome.ok !== true) throw new Error(`Terminal ${adapter}/${trigger} Event History close failed.`);
  const finalEvidence = read.ok ? read.value.evidence.at(-1) ?? null : null;
  const retainedEventIds = read.ok ? read.value.evidence.map((entry) => entry.eventId) : [];
  const boundaryEvidence = terminal?.committedEvidenceBoundary
    ? { sequence: terminal.committedEvidenceBoundary.sequence, eventId: terminal.committedEvidenceBoundary.eventId }
    : { sequence: 0, eventId: "" };
  const expectedFirstMissing = refusedEventIds[0] ?? "";
  const refusedIdentityCorrect = terminal?.firstMissingEventId === expectedFirstMissing
    && refused.length === 1
    && outcomes.at(-1)?.outcome === "NOT_EVIDENCE";
    return {
    adapter,
    trigger,
    tier,
    terminalReason: trigger === "PENDING_BYTES" ? "PENDING_BYTE_LIMIT" : "PENDING_AGE_LIMIT",
    terminalReasonCorrect: terminal?.reason === (trigger === "PENDING_BYTES" ? "PENDING_BYTE_LIMIT" : "PENDING_AGE_LIMIT"),
    offeredEventIds,
    acceptedEventIds,
    retainedEventIds,
    publishedEventIds,
    refusedEventIds,
    acceptedCount: accepted.length,
    refusedCount: refused.length,
    firstMissingEventId: terminal?.firstMissingEventId ?? "",
    committedBoundary: boundaryEvidence,
    terminalPublicationCount: terminals.length,
    finalBoundaryCorrect: terminal !== null && terminal.committedEvidenceBoundary?.sequence === accepted.length && finalEvidence?.eventId === terminal.committedEvidenceBoundary.eventId,
    refusedIdentityCorrect,
    exactOneTerminalPublication: terminals.length === 1,
    pressureTransitions
    };
  } catch (error) {
    const failure = followCompleted
      ? normalizeHarnessError(error, `terminal-${adapter}-${trigger}`, progress(), guard)
      : error instanceof Error ? error : new Error(String(error));
    const resourceCleanup = await cleanupHarnessResources({
      history,
      stage: `terminal-${adapter}-${trigger}`,
      guard,
      progress: () => ({ ...progress(), stage: `${trigger}-cleanup` }),
      unsubscribe
    });
    Object.assign(failure, {
      cleanupEvidence: {
        ...resourceCleanup,
        adapter,
        phase: "cleanup" as const,
        sample: null,
        eventCount: 0,
        retained: null,
        sessionId: panelSessionId,
        databaseName: adapter === "indexeddb" ? authoritativeEventDatabaseName(panelSessionId) : null,
        close: resourceCleanup.close,
        disposeError: resourceCleanup.disposeError,
        rootRemoved: resourceCleanup.rootRemoved,
        frameYielded: false,
        gcPasses: null,
        status: "FAIL" as const,
        failure: { code: failure.name, message: failure.message }
      }
    });
    throw failure;
  }
}

export async function runCheckpointScenario(
  adapter: "indexeddb" | "memory",
  name: "representative" | "maximum-2MiB",
  operationId: string | null,
  guard: HarnessStageGuard,
  hooks: HarnessScenarioTestHooks = {}
): Promise<EventHistoryPerformanceCheckpointScenario> {
  const tier = adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const;
  const panelSessionId = `event-history-checkpoint-${adapter}-${name}`;
  const progress = (stage: string, offered: number | null = null, settled: number | null = null): HarnessProgressInput => ({
    operationId,
    phase: "checkpoint",
    stage,
    substage: stage,
    sample: null,
    trigger: null,
    scenario: name,
    cellIndex: null,
    cellTotal: 36,
    adapter,
    workload: null,
    shape: null,
    workloadPhase: null,
    offered,
    settled,
    query: null
  });
  const candidate = createStagedTopologyCheckpointCandidate(
    `checkpoint-${adapter}-${name}`,
    `sync-${name}`,
    name === "representative" ? 64 * 1_024 : TERMINAL_CHECKPOINT_PAYLOAD_BYTES
  );
  if (candidate.kind !== "topology-checkpoint") throw new Error(`Checkpoint ${adapter}/${name} has an invalid candidate kind.`);
  const checkpointFrames = decodeTopologyCheckpointEvidenceCandidate(candidate);
  if (!checkpointFrames) throw new Error(`Checkpoint ${adapter}/${name} did not decode into sync frames.`);
  let expectedCheckpointEventIds = [candidate.id];
  if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled before history acquisition.");
  const serialized = serializeJournalEvidenceCandidate(candidate);
  const rawHistory = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId, capacityTier: tier })
    : createInMemoryEventHistory({ panelSessionId, capacityTier: tier });
  const offeredEventIds: string[] = [];
  let resolveCompleteOffered!: () => void;
  const completeOffered = new Promise<void>((resolve) => { resolveCompleteOffered = resolve; });
  // Observe every offer made through the same history instance used by the
  // mounted production runtime. This includes the runtime's sole validated
  // COMPLETE candidate and keeps offer evidence independent from follow().
  const history: EventHistory = {
    storage: rawHistory.storage,
    status: rawHistory.status.bind(rawHistory),
    offer(candidate) {
      offeredEventIds.push(candidate.id);
      const receipt = rawHistory.offer(candidate);
      if (candidate.kind === "topology-checkpoint") {
        expectedCheckpointEventIds = [candidate.id];
        resolveCompleteOffered();
      }
      return receipt;
    },
    read: rawHistory.read.bind(rawHistory),
    clear: rawHistory.clear.bind(rawHistory),
    follow: rawHistory.follow.bind(rawHistory),
    close: rawHistory.close.bind(rawHistory)
  };
  if (!guard.isActive()) {
    const failure = new Error("Checkpoint scenario was cancelled after history acquisition.");
    Object.assign(failure, {
      cleanupEvidence: await cleanupHarnessResources({ history, stage: `checkpoint-${adapter}-${name}`, guard, progress: () => progress(`${name}-cleanup`) })
    });
    throw failure;
  }
  const trafficBefore = Array.from({ length: 4 }, (_, index) =>
    createEventHistoryWorkloadEvent("ordinary-item-update", index, `${adapter}-${name}-before`)
  );
  const trafficAfter = Array.from({ length: 4 }, (_, index) =>
    createEventHistoryWorkloadEvent("ordinary-item-update", index, `${adapter}-${name}-after`)
  );
  const liveCaptureEvents = Array.from({ length: CHECKPOINT_LIVE_CAPTURE_EVENT_COUNT }, (_, index) =>
    createEventHistoryWorkloadEvent("ordinary-item-update", index, `${adapter}-${name}-live`)
  );
  const liveCaptureEventIdSet = new Set(liveCaptureEvents.map((event) => event.id));
  const productionObservedLiveEventIds: string[] = [];
  const productionObservedLiveEventTimesMs: number[] = [];
  const productionPublishedEventIds: string[] = [];
  const observedProductionLiveIds = new Set<string>();
  let candidateObserved = false;
  let stagingStartedAtMs: number | null = null;
  let stagingEndedAtMs: number | null = null;
  let resolveStagingStart!: () => void;
  let resolveStagingEnd!: () => void;
  const stagingStartObservation = new Promise<void>((resolve) => { resolveStagingStart = resolve; });
  const stagingEndObservation = new Promise<void>((resolve) => { resolveStagingEnd = resolve; });
  let resolveProductionObservation!: () => void;
  const productionObservation = new Promise<void>((resolve) => { resolveProductionObservation = resolve; });
  let resolveLiveCaptureObservation!: () => void;
  const liveCaptureObservation = new Promise<void>((resolve) => { resolveLiveCaptureObservation = resolve; });
  const root = document.createElement("main");
  let panel: Awaited<ReturnType<typeof mountProductionPanel>> | null = null;
  const cleanupDisposePanel = async (): Promise<void> => {
    if (!panel) return;
    const disposePanel = panel.disposePanel;
    hooks.cleanupOverrides?.disposePanel
      ? await hooks.cleanupOverrides.disposePanel(disposePanel)
      : await disposePanel();
  };
  const cleanupRemoveRoot = (): boolean => {
    const removeRoot = (): boolean => {
      root.remove();
      return !root.isConnected;
    };
    return hooks.cleanupOverrides?.removeRoot
      ? hooks.cleanupOverrides.removeRoot(removeRoot)
      : removeRoot();
  };
  try {
    panel = await mountProductionPanel(history, {
      onCommittedEvidenceBoundary(boundary, timestampMs) {
        if (!guard.isActive()) return;
        productionPublishedEventIds.push(boundary.eventId);
        if (boundary.eventId === expectedCheckpointEventIds[0]) {
          candidateObserved = true;
        }
        if (liveCaptureEventIdSet.has(boundary.eventId) && !observedProductionLiveIds.has(boundary.eventId)) {
          observedProductionLiveIds.add(boundary.eventId);
          productionObservedLiveEventIds.push(boundary.eventId);
          productionObservedLiveEventTimesMs.push(timestampMs);
          if (productionObservedLiveEventIds.length === liveCaptureEvents.length) resolveLiveCaptureObservation();
        }
        if (candidateObserved && productionObservedLiveEventIds.length === liveCaptureEvents.length) {
          resolveProductionObservation();
        }
      },
      onCheckpointStagingStart(syncId, timestampMs) {
        if (syncId !== candidate.checkpoint.syncId || stagingStartedAtMs !== null) return;
        stagingStartedAtMs = timestampMs;
        resolveStagingStart();
      },
      onCheckpointStagingEnd(syncId, timestampMs) {
        if (syncId !== candidate.checkpoint.syncId || stagingEndedAtMs !== null) return;
        stagingEndedAtMs = timestampMs;
        resolveStagingEnd();
      }
    }, root);
    hooks.afterPanelMount?.(history);
    if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled after panel acquisition.");
    publishStageProgress(progress(`${name}-traffic-before`, trafficBefore.length, 0), guard);
  await settleReceiptStage(
    trafficBefore.map((event) => {
      if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled.");
      return history.offer(event).settled;
    }),
    `checkpoint-${adapter}-${name}-before`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    (settled) => progress(`${name}-traffic-before`, trafficBefore.length, settled),
    guard
  );
  if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled.");
  panel!.runtime.dispatch({ type: "apply-topology-sync-frame", frame: checkpointFrames[0]! });
  await withStageDeadline(
    stagingStartObservation,
    `checkpoint-${adapter}-${name}-production-panel-staging-start`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-staging-start`, 1, 1),
    undefined,
    guard
  );
  const checkpointStagingStartedAtMs = stagingStartedAtMs;
  if (checkpointStagingStartedAtMs === null) throw new Error(`Checkpoint ${adapter}/${name} missing production staging start.`);
  const liveCaptureEventIds: string[] = [];
  const offeredLiveCaptureEventTimesMs: number[] = [];
  const liveReceiptPromises: Array<Promise<Readonly<{ ok: true; value: unknown } | { ok: false; error: unknown }>>> = [];
  const checkpointChunks = checkpointFrames.slice(1, -1).filter((frame): frame is Extract<TopologySyncFrame, { type: typeof TOPOLOGY_SYNC_CHUNK }> =>
    frame.type === TOPOLOGY_SYNC_CHUNK
  );
  const checkpointChunkInterval = Math.max(1, Math.floor(CHECKPOINT_LIVE_CAPTURE_EVENT_COUNT / Math.max(1, checkpointChunks.length)));
  let nextCheckpointChunk = 0;
  for (let index = 0; index < CHECKPOINT_LIVE_CAPTURE_EVENT_COUNT; index += 1) {
    if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled during live capture.");
    const event = liveCaptureEvents[index]!;
    const offeredAt = performance.now();
    const liveReceipt = history.offer(event);
    if (liveReceipt.intake !== "QUEUED") throw new Error(`Checkpoint ${adapter}/${name} live capture event was refused.`);
    liveCaptureEventIds.push(event.id);
    offeredLiveCaptureEventTimesMs.push(offeredAt);
    liveReceiptPromises.push(Promise.resolve(liveReceipt.settled).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ));
    publishStageProgress(progress(`${name}-live-capture`, index + 1, null), guard);
    await delay(CHECKPOINT_LIVE_CAPTURE_INTERVAL_MS);
    if ((index + 1) % checkpointChunkInterval === 0 && nextCheckpointChunk < checkpointChunks.length) {
      panel!.runtime.dispatch({ type: "apply-topology-sync-frame", frame: checkpointChunks[nextCheckpointChunk++]! });
    }
  }
  while (nextCheckpointChunk < checkpointChunks.length) {
    panel!.runtime.dispatch({ type: "apply-topology-sync-frame", frame: checkpointChunks[nextCheckpointChunk++]! });
  }
  await withStageDeadline(
    liveCaptureObservation,
    `checkpoint-${adapter}-${name}-production-live-capture`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-production-live-capture`, productionObservedLiveEventIds.length, liveCaptureEvents.length),
    undefined,
    guard
  );
  const productionLiveSpanMs = productionObservedLiveEventTimesMs.at(-1)! - productionObservedLiveEventTimesMs[0]!;
  const productionLiveMaxGapMs = productionObservedLiveEventTimesMs.slice(1).reduce(
    (maximum, timestamp, index) => Math.max(maximum, timestamp - productionObservedLiveEventTimesMs[index]!),
    0
  );
  if (productionLiveSpanMs < CHECKPOINT_LIVE_CAPTURE_TARGET_OVERLAP_MS) {
    throw new Error(`Checkpoint ${adapter}/${name} production live capture spanned ${productionLiveSpanMs} ms before COMPLETE; expected at least ${CHECKPOINT_LIVE_CAPTURE_TARGET_OVERLAP_MS} ms.`);
  }
  if (productionLiveMaxGapMs > CHECKPOINT_LIVE_CAPTURE_MAX_EVENT_GAP_MS) {
    throw new Error(`Checkpoint ${adapter}/${name} production live capture gap ${productionLiveMaxGapMs} ms exceeded ${CHECKPOINT_LIVE_CAPTURE_MAX_EVENT_GAP_MS} ms before COMPLETE.`);
  }
  panel!.runtime.dispatch({ type: "apply-topology-sync-frame", frame: checkpointFrames.at(-1)! });
  await withStageDeadline(
    completeOffered,
    `checkpoint-${adapter}-${name}-complete-receipt`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-complete-receipt`, 1, 1),
    undefined,
    guard
  );
  const liveSettlements = await withStageDeadline(
    Promise.all(liveReceiptPromises),
    `checkpoint-${adapter}-${name}-live-receipts`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-live-capture-settle`, liveCaptureEventIds.length, liveCaptureEventIds.length),
    undefined,
    guard
  );
  const rejectedLiveSettlement = liveSettlements.find((settlement) => !settlement.ok);
  if (rejectedLiveSettlement && !rejectedLiveSettlement.ok) throw rejectedLiveSettlement.error;
  await withStageDeadline(
    productionObservation,
    `checkpoint-${adapter}-${name}-production-panel-observation`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-production-panel-observation`, productionObservedLiveEventIds.length, liveCaptureEvents.length),
    undefined,
    guard
  );
  await withStageDeadline(
    stagingEndObservation,
    `checkpoint-${adapter}-${name}-production-panel-staging-end`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    () => progress(`${name}-staging-end`, 1, 1),
    undefined,
    guard
  );
  const checkpointStagingEndedAtMs = stagingEndedAtMs;
  if (checkpointStagingEndedAtMs === null) throw new Error(`Checkpoint ${adapter}/${name} missing production staging end.`);
  await settleReceiptStage(
    trafficAfter.map((event) => {
      if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled.");
      return history.offer(event).settled;
    }),
    `checkpoint-${adapter}-${name}-after`,
    STAGE_DEADLINES_MS.checkpointReceipts,
    (settled) => progress(`${name}-traffic-after`, trafficAfter.length, settled),
    guard
  );
  if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled.");
  const read = await withStageDeadline(
    history.read({ order: "asc" }),
    `checkpoint-${adapter}-${name}-read`,
    STAGE_DEADLINES_MS.read,
    () => progress(`${name}-read`),
    undefined,
    guard
  );
  const publishedOrder = productionPublishedEventIds;
  const retainedEventIds = read.ok ? read.value.evidence.map((entry) => entry.eventId) : [];
  const publishedEventIds = publishedOrder;
  const liveCapture = measureCheckpointLiveCapture({
    checkpointStagingStartedAtMs,
    checkpointStagingEndedAtMs,
    liveCaptureEventTimesMs: productionObservedLiveEventTimesMs
  });
  const expectedEventIds = [
    ...trafficBefore.map((event) => event.id),
    ...liveCaptureEventIds,
    expectedCheckpointEventIds[0]!,
    ...trafficAfter.map((event) => event.id)
  ];
  const offeredCheckpointEventIds = offeredEventIds.filter((eventId) => eventId === expectedCheckpointEventIds[0]);
  if (!guard.isActive()) throw new Error("Checkpoint scenario was cancelled.");
  const cleanupEvidence = await cleanupHarnessResources({
    history,
    stage: `checkpoint-${adapter}-${name}`,
    guard,
    progress: () => progress(`${name}-cleanup`),
    disposePanel: panel ? cleanupDisposePanel : undefined,
    removeRoot: cleanupRemoveRoot
  });
  const closeOutcome = cleanupEvidence.close;
  const closeSucceeded = closeOutcome !== null
    && typeof closeOutcome === "object"
    && "ok" in closeOutcome
    && closeOutcome.ok === true;
  const cleanupSuccessful = cleanupEvidence.unsubscribeError === null
    && cleanupEvidence.disposeAttempted
    && cleanupEvidence.disposeError === null
    && cleanupEvidence.rootRemovalAttempted
    && cleanupEvidence.rootRemoved
    && cleanupEvidence.rootError === null
    && cleanupEvidence.closeAttempted
    && closeSucceeded
    && cleanupEvidence.closeError === null;
  if (!cleanupSuccessful) {
    const cleanupFailure = new Error(`Checkpoint ${adapter}/${name} cleanup evidence was incomplete.`);
    Object.assign(cleanupFailure, { cleanupEvidence });
    throw cleanupFailure;
  }
    return {
    name,
    adapter,
    accepted: candidateObserved,
    retained: read.ok ? read.value.total : 0,
    trafficBefore: trafficBefore.length,
    trafficAfter: trafficAfter.length,
    liveCaptureEventIds,
    productionObservedLiveEventIds,
    productionObservedLiveEventTimesMs,
    observationProvenance: "production-panel-committed-evidence-hook",
    expectedCheckpointEventIds,
    offeredCheckpointEventIds,
    offeredEventIds,
    offeredLiveCaptureEventTimesMs,
    retainedEventIds,
    publishedEventIds,
    expectedEventIds,
    ...liveCapture,
    interleavedWhileStaging: liveCapture.interleavedWhileStaging && candidateObserved,
    canonicalBytes: journalAccountedBytes(serialized.bytes),
    committedBoundaryCorrect: candidateObserved,
    batchAcceptedAsOneOversizedUnit: candidateObserved
    };
  } catch (error) {
    const failure = normalizeHarnessError(error, `checkpoint-${adapter}-${name}`, progress(`${name}-failed`), guard);
    const existingCleanupEvidence = error instanceof Error && "cleanupEvidence" in error
      ? (error as Error & { cleanupEvidence?: HarnessCleanupEvidence }).cleanupEvidence
      : undefined;
    const resourceCleanup = existingCleanupEvidence ?? await cleanupHarnessResources({
      history,
      stage: `checkpoint-${adapter}-${name}`,
      guard,
      progress: () => progress(`${name}-cleanup`),
      disposePanel: panel ? cleanupDisposePanel : undefined,
      removeRoot: cleanupRemoveRoot
    });
    Object.assign(failure, {
      cleanupEvidence: {
        ...resourceCleanup,
        adapter,
        phase: "cleanup" as const,
        sample: null,
        eventCount: trafficBefore.length + trafficAfter.length + CHECKPOINT_LIVE_CAPTURE_EVENT_COUNT + 1,
        retained: null,
        sessionId: `event-history-checkpoint-${adapter}-${name}`,
        databaseName: adapter === "indexeddb"
          ? authoritativeEventDatabaseName(`event-history-checkpoint-${adapter}-${name}`)
          : null,
        close: resourceCleanup.close,
        disposeError: resourceCleanup.disposeError,
        rootRemoved: resourceCleanup.rootRemoved,
        frameYielded: false,
        gcPasses: null,
        status: "FAIL" as const,
        failure: { code: failure.name, message: failure.message }
      }
    });
    throw failure;
  }
}

export function createStagedTopologyCheckpointCandidate(
  seed: string,
  syncId: string,
  minimumCanonicalBytes: number
): EvidenceCandidate {
  const pageEpoch = `page-${seed}`;
  const panelSessionId = "panel-00000000-0000-4000-8000-000000000099";
  const coverage: TopologyCoverage = { status: "complete", getters: {} };
  const recordCount = minimumCanonicalBytes >= TERMINAL_CHECKPOINT_PAYLOAD_BYTES ? 6_500 : 64;
  let lastStagedBytes = 0;
  let lastBaseBytes = 0;
  for (let paddingLength = 64; paddingLength <= 256; paddingLength += 8) {
    const baseRecords = createCheckpointRecords(pageEpoch, recordCount, paddingLength, 0);
    const baseFrames = createCheckpointFrames(syncId, panelSessionId, pageEpoch, coverage, baseRecords);
    lastStagedBytes = baseFrames.reduce((total, frame) => total + topologySyncUtf8Bytes(frame), 0);
    if (lastStagedBytes > TOPOLOGY_SYNC_LIMITS.maxStagedBytes) continue;
    const baseCandidate = stageCheckpointCandidate(baseFrames, []);
    if (!baseCandidate) continue;
    const baseBytes = journalAccountedBytes(serializeJournalEvidenceCandidate(baseCandidate).bytes);
    lastBaseBytes = baseBytes;
    const extraPaddingLength = minimumCanonicalBytes - baseBytes;
    if (extraPaddingLength >= 0 && extraPaddingLength <= 4_096) {
      const records = createCheckpointRecords(pageEpoch, recordCount, paddingLength, extraPaddingLength);
      const frames = createCheckpointFrames(syncId, panelSessionId, pageEpoch, coverage, records);
      const stagedBytes = frames.reduce((total, frame) => total + topologySyncUtf8Bytes(frame), 0);
      lastStagedBytes = stagedBytes;
      if (stagedBytes <= TOPOLOGY_SYNC_LIMITS.maxStagedBytes) {
        const candidate = stageCheckpointCandidate(frames, []);
        if (candidate && journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes) === minimumCanonicalBytes) {
          return candidate;
        }
      }
    }
    if (minimumCanonicalBytes <= baseBytes) continue;

    const oneObservation = createCheckpointObservationEvent(pageEpoch, recordCount + 1, 0);
    const oneObservationCandidate = stageCheckpointCandidate(baseFrames, [oneObservation]);
    if (!oneObservationCandidate) continue;
    const oneObservationBytes = journalAccountedBytes(serializeJournalEvidenceCandidate(oneObservationCandidate).bytes);
    const observationOverhead = oneObservationBytes - baseBytes;
    if (observationOverhead <= 0) continue;
    let observationCount = Math.max(
      1,
      Math.ceil((minimumCanonicalBytes - baseBytes - observationOverhead) / (4_096 + observationOverhead))
    );
    for (let adjustment = 0; adjustment < 4; adjustment += 1) {
      const prefixObservations = createCheckpointObservationEvents(
        pageEpoch,
        recordCount,
        observationCount,
        4_096,
        0
      );
      const prefixCandidate = stageCheckpointCandidate(baseFrames, prefixObservations);
      if (!prefixCandidate) break;
      const prefixBytes = journalAccountedBytes(serializeJournalEvidenceCandidate(prefixCandidate).bytes);
      if (prefixBytes > minimumCanonicalBytes) {
        observationCount -= 1;
        continue;
      }
      if (prefixBytes + 4_096 < minimumCanonicalBytes) {
        observationCount += 1;
        continue;
      }
      let low = 0;
      let high = 4_096;
      while (low <= high) {
        const padding = Math.floor((low + high) / 2);
        const observations = createCheckpointObservationEvents(
          pageEpoch,
          recordCount,
          observationCount,
          4_096,
          padding
        );
        const candidate = stageCheckpointCandidate(baseFrames, observations);
        if (!candidate) break;
        const bytes = journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes);
        if (bytes === minimumCanonicalBytes) return candidate;
        if (bytes < minimumCanonicalBytes) low = padding + 1;
        else high = padding - 1;
      }
      break;
    }
  }
  throw new Error(`Could not construct a codec-valid ${minimumCanonicalBytes}-byte topology checkpoint for ${seed}; last base bytes ${lastBaseBytes}, last staged bytes ${lastStagedBytes}.`);
}

function stageCheckpointCandidate(
  frames: readonly TopologySyncFrame[],
  observations: readonly LightstreamerEventEnvelope[]
): EvidenceCandidate | undefined {
  // Performance fixture: build codec-valid checkpoint evidence without
  // advancing the production topology projection before Evidence commits.
  const result = createTopologyCheckpointEvidenceCandidate(
    frames,
    observations.flatMap((observation) => observation.topology ? [observation.topology] : [])
  );
  return result.ok ? result.value : undefined;
}

function createCheckpointObservationEvents(
  pageEpoch: string,
  cutoffCaptureSequence: number,
  count: number,
  fullPaddingLength: number,
  finalPaddingLength: number
): LightstreamerEventEnvelope[] {
  return Array.from({ length: count }, (_, index) =>
    createCheckpointObservationEvent(
      pageEpoch,
      cutoffCaptureSequence + index + 1,
      index === count - 1 ? finalPaddingLength : fullPaddingLength
    )
  );
}

function createCheckpointObservationEvent(
  pageEpoch: string,
  captureSequence: number,
  paddingLength: number
): LightstreamerEventEnvelope {
  const topology: TopologyObservation = {
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind: "item-update",
    pageEpoch,
    captureSequence,
    timestamp: captureSequence,
    provenance: { instrumentationSource: "official-public-api" },
    coverage: { status: "complete", getters: {} },
    values: { padding: { state: "real", value: "x".repeat(paddingLength) } }
  };
  return {
    id: `checkpoint-live-${pageEpoch}-${captureSequence}`,
    timestamp: captureSequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    topology
  };
}

function createCheckpointRecords(
  pageEpoch: string,
  recordCount: number,
  paddingLength: number,
  extraPaddingLength: number
): TopologyAbsoluteRecord[] {
  const cutoffCaptureSequence = recordCount;
  const page: TopologyAbsoluteRecord = { kind: "page", id: pageEpoch, pageEpoch, captureSequence: 1 };
  const client: TopologyAbsoluteRecord = { kind: "client", id: "checkpoint-client", pageEpoch, captureSequence: 2, parentId: pageEpoch, clientActive: true };
  const subscription: TopologyAbsoluteRecord = {
    kind: "subscription",
    id: "checkpoint-subscription",
    pageEpoch,
    captureSequence: 3,
    parentId: client.id,
    clientId: client.id,
    clientActive: true,
    serverEstablished: true
  };
  const padding = "x".repeat(paddingLength);
  const aggregates = Array.from({ length: Math.max(0, recordCount - 3) }, (_, index) => ({
    kind: "aggregate" as const,
    id: `checkpoint-aggregate-${index}`,
    pageEpoch,
    captureSequence: index + 4,
    parentId: subscription.id,
    subscriptionId: subscription.id,
    values: { padding: `${padding}${index === 0 ? "x".repeat(extraPaddingLength) : ""}` }
  }));
  if (aggregates.at(-1)?.captureSequence !== cutoffCaptureSequence) {
    throw new Error("Topology checkpoint record cutoff is incoherent.");
  }
  return [page, client, subscription, ...aggregates];
}

function createCheckpointFrames(
  syncId: string,
  panelSessionId: string,
  pageEpoch: string,
  coverage: TopologyCoverage,
  records: readonly TopologyAbsoluteRecord[]
): TopologySyncFrame[] {
  const chunkSize = 500;
  const chunks = Array.from({ length: Math.ceil(records.length / chunkSize) }, (_, index) =>
    records.slice(index * chunkSize, (index + 1) * chunkSize)
  );
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION as 2,
    syncId,
    panelSessionId,
    pageEpoch,
    cutoffCaptureSequence: records.at(-1)?.captureSequence ?? 0,
    chunkCount: chunks.length,
    recordCount: records.length,
    coverage
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    ...chunks.map((chunk, chunkIndex) => ({ type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex, records: chunk })),
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  ];
}

export async function offerSustained(
  history: EventHistory,
  events: readonly EvidenceCandidate[],
  config: EventHistoryPerformanceConfig,
  offerTimes: Map<string, number>,
  pending: PendingTelemetryTracker,
  onOffer: () => void,
  samplePending: () => void,
  guard: HarnessStageGuard | undefined = undefined
): Promise<Promise<unknown>[]> {
  const receipts: Promise<unknown>[] = [];
  const startedAt = performance.now();
  for (let sequence = 0; sequence < events.length; sequence += 1) {
    if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
    const dueAt = startedAt + (sequence * 1_000) / config.sustainedEventsPerSecond;
    await delay(Math.max(0, dueAt - performance.now()));
    if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
    const event = events[sequence]!;
    onOffer();
    if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
    const offeredAt = performance.now();
    offerTimes.set(event.id, offeredAt);
    pending.add(event.id, { offeredAt, bytes: journalAccountedBytes(serializeJournalEvidenceCandidate(event).bytes) });
    const receipt = history.offer(event);
    if (receipt.intake !== "QUEUED") {
      pending.refuse(event.id);
      throw new Error(`Sustained offer was refused: ${event.id}`);
    }
    receipts.push(receipt.settled);
    samplePending();
  }
  return receipts;
}

export async function offerBurst(
  history: EventHistory,
  events: readonly EvidenceCandidate[],
  config: EventHistoryPerformanceConfig,
  offerTimes: Map<string, number>,
  pending: PendingTelemetryTracker,
  onOffer: () => void,
  samplePending: () => void,
  guard: HarnessStageGuard | undefined = undefined
): Promise<Promise<unknown>[]> {
  const receipts: Promise<unknown>[] = [];
  await runBurstOfferSchedule({
    events,
    eventsPerBurst: ISSUE_16_TOTAL_EVENTS,
    offer(event) {
      if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
      onOffer();
      if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
      const offeredAt = performance.now();
      offerTimes.set(event.id, offeredAt);
      pending.add(event.id, { offeredAt, bytes: journalAccountedBytes(serializeJournalEvidenceCandidate(event).bytes) });
      const receipt = history.offer(event);
      if (receipt.intake !== "QUEUED") {
        pending.refuse(event.id);
        throw new Error(`Burst offer was refused: ${event.id}`);
      }
      receipts.push(receipt.settled);
      samplePending();
    },
    async yieldBetweenChunks() {
      samplePending();
      await yieldBurstOfferMacrotask();
    },
    async pauseBetweenBursts() {
      samplePending();
      await delay(config.burstPauseMs);
    }
  });
  return receipts;
}

export async function settleOffers(
  history: EventHistory,
  events: readonly EvidenceCandidate[],
  stage: string,
  timeoutMs: number,
  progress: (settled: number) => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined
): Promise<void> {
  const receipts = events.map((event) => {
    if (guard && !guard.isActive()) throw new Error("Harness offer stage was invalidated.");
    return history.offer(event);
  });
  if (receipts.some((receipt) => receipt.intake !== "QUEUED")) throw new Error("Retained heap offer was refused.");
  await settleReceiptStage(receipts.map((receipt) => receipt.settled), stage, timeoutMs, progress, guard);
}

/**
 * Releases caller-owned workload payloads before the retained heap frame while
 * preserving the scalar count used as measurement identity.
 */
export async function releaseHeapWorkloadCandidates(
  candidates: EvidenceCandidate[],
  yieldRetainedFrame: () => Promise<void>
): Promise<number> {
  const retained = candidates.length;
  candidates.length = 0;
  await yieldRetainedFrame();
  return retained;
}

async function mountProductionPanel(
  history: EventHistory,
  performanceHooks: WorkbenchRuntimePerformanceHooks | undefined = undefined,
  root: HTMLElement = document.createElement("main")
): Promise<{
  root: HTMLElement;
  runtime: ReturnType<typeof createWorkbenchRuntime>;
  disposePanel: () => void | Promise<void>;
}> {
  root.id = "app";
  document.body.replaceChildren(root);
  let runtime: ReturnType<typeof createWorkbenchRuntime> | null = null;
  const disposePanel = mountWorkbenchPanel(root, {
    openHistory: async () => history,
    createRuntime: (options) => {
      runtime = createWorkbenchRuntime({
        ...options,
        captureStatus: "capturing",
        performanceHooks
      });
      return runtime;
    },
    connectBridge: () => ({
      reinjectDraft: async () => {
        throw new Error("Performance harness does not execute injections.");
      },
      disconnect() {}
    })
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (runtime && root.querySelector(".workbench-react")) {
      return { root, runtime, disposePanel };
    }
    await delay(0);
  }
  await disposePanel();
  throw new Error("Production panel mount did not render its React boundary.");
}

export async function measureQuery(
  history: EventHistory,
  query: () => Promise<unknown>,
  queryName: string,
  progress: () => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined,
  gcEvidence?: QuerySampleGcEvidence[],
  collectGc: typeof collectGarbageBetweenQuerySamples = collectGarbageBetweenQuerySamples,
  transitionPhase?: (phase: "query" | "hygiene") => void
): Promise<number> {
  return (await measureQueryWithLastResult(history, query, queryName, progress, guard, gcEvidence, collectGc, transitionPhase)).p95Ms;
}

async function measureQueryWithLastResult<T>(
  _history: EventHistory,
  query: () => Promise<T>,
  queryName: string,
  progress: () => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined,
  gcEvidence?: QuerySampleGcEvidence[],
  collectGc: typeof collectGarbageBetweenQuerySamples = collectGarbageBetweenQuerySamples,
  transitionPhase?: (phase: "query" | "hygiene") => void
): Promise<Readonly<{ p95Ms: number; result: T }>> {
  const samples: number[] = [];
  let result!: T;
  for (let index = 0; index < 3; index += 1) {
    publishStageProgress(progress(), guard);
    const startedAt = performance.now();
    result = await withStageDeadline(query(), `query-${queryName}-${index + 1}`, STAGE_DEADLINES_MS.query, progress, undefined, guard);
    if (guard && !guard.isActive()) throw new Error(`Query stage ${queryName} was invalidated.`);
    samples.push(performance.now() - startedAt);
    if (index < 2 && gcEvidence) {
      result = undefined as T;
      transitionPhase?.("hygiene");
      try {
        gcEvidence.push(await collectGc(queryName, (index + 1) as 1 | 2, guard));
      } finally {
        transitionPhase?.("query");
      }
    }
  }
  return { p95Ms: percentile(samples, 0.95), result };
}

export async function measureAuthoritativeFullQuery(
  history: EventHistory,
  progress: () => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined,
  gcEvidence?: QuerySampleGcEvidence[],
  collectGc: typeof collectGarbageBetweenQuerySamples = collectGarbageBetweenQuerySamples,
  transitionPhase?: (phase: "query" | "hygiene") => void
): Promise<Readonly<{ p95Ms: number; read: Awaited<ReturnType<EventHistory["read"]>> }>> {
  const measurement = await measureQueryWithLastResult(
    history,
    () => history.read({ order: "asc" }),
    "full",
    progress,
    guard,
    gcEvidence,
    collectGc,
    transitionPhase
  );
  return { p95Ms: measurement.p95Ms, read: measurement.result };
}

export async function collectGarbageBetweenQuerySamples(
  query: string,
  afterSample: 1 | 2,
  guard: HarnessStageGuard | undefined,
  collect: (() => void) | null = (globalThis as typeof globalThis & { gc?: () => void }).gc ?? null
): Promise<QuerySampleGcEvidence> {
  if (guard && !guard.isActive()) throw new Error(`Query stage ${query} was invalidated before garbage collection.`);
  if (typeof collect !== "function") throw new Error("Inter-query garbage collection requires Chrome --expose-gc support.");
  await delay(0);
  if (guard && !guard.isActive()) throw new Error(`Query stage ${query} was invalidated before garbage collection.`);
  for (let pass = 0; pass < 3; pass += 1) collect();
  return Object.freeze({ query, afterSample, gcPasses: 3, phase: "BETWEEN_QUERY_SAMPLES" });
}

function emptyStorageTelemetry(): StorageTelemetry {
  return {
    transactionCount: 0,
    readwriteTransactionCount: 0,
    readonlyTransactionCount: 0,
    evidenceWriteCount: 0,
    controlWriteCount: 0,
    facetEntryCount: 0,
    indexEntryCount: 0
  };
}

export async function captureStorageEstimate(
  storage: Pick<StorageManager, "estimate"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage
): Promise<EventHistoryPerformanceStorageEstimate> {
  if (!storage || typeof storage.estimate !== "function") {
    return {
      source: "navigator.storage.estimate",
      status: "UNAVAILABLE",
      usageBytes: null,
      quotaBytes: null,
      failure: { code: "STORAGE_ESTIMATE_UNAVAILABLE", message: "navigator.storage.estimate is unavailable." }
    };
  }
  try {
    const estimate = await storage.estimate();
    const usage = estimate.usage;
    const quota = estimate.quota;
    if (typeof usage !== "number" || !Number.isFinite(usage) || usage < 0 || typeof quota !== "number" || !Number.isFinite(quota) || quota < 0) {
      return {
        source: "navigator.storage.estimate",
        status: "UNAVAILABLE",
        usageBytes: null,
        quotaBytes: null,
        failure: { code: "STORAGE_ESTIMATE_INVALID", message: "navigator.storage.estimate returned invalid usage or quota." }
      };
    }
    return {
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: usage,
      quotaBytes: quota,
      failure: null
    };
  } catch (error) {
    return {
      source: "navigator.storage.estimate",
      status: "UNAVAILABLE",
      usageBytes: null,
      quotaBytes: null,
      failure: { code: "STORAGE_ESTIMATE_FAILED", message: error instanceof Error ? error.message : String(error) }
    };
  }
}

export function attributeLongTasks(
  entries: readonly PerformanceEntry[],
  intervals: readonly PhaseInterval[]
): LongTaskAttribution {
  const attributed: { capture: number[]; commit: number[]; paint: number[]; query: number[]; hygiene: number[] } = {
    capture: [], commit: [], paint: [], query: [], hygiene: []
  };
  let unattributed = 0;
  const unattributedReasons: UnattributedLongTaskReason[] = [];
  for (const entry of entries) {
    const start = entry.startTime;
    const end = start + entry.duration;
    const overlaps = intervals
      .map((interval) => ({
        phase: interval.phase,
        duration: Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start))
      }))
      .filter(({ duration }) => duration > 0);
    if (overlaps.length === 0) {
      unattributed += 1;
      unattributedReasons.push({ reason: "no-overlap", startTime: start, duration: entry.duration });
      continue;
    }
    const greatestOverlap = Math.max(...overlaps.map(({ duration }) => duration));
    const greatest = overlaps.filter(({ duration }) => duration === greatestOverlap);
    if (greatest.length !== 1) {
      unattributed += 1;
      unattributedReasons.push({ reason: "ambiguous", overlaps: greatest });
      continue;
    }
    attributed[greatest[0]!.phase].push(entry.duration);
  }
  return { ...attributed, unattributed, unattributedReasons };
}

function storageTelemetryForCell(base: StorageTelemetry): StorageTelemetry {
  return base;
}

function beginStorageProbe(): StorageProbe {
  const databasePrototype = IDBDatabase.prototype as unknown as {
    transaction: (...args: unknown[]) => IDBTransaction;
  };
  const originalTransaction = databasePrototype.transaction;
  const telemetry = emptyStorageTelemetry();
  let transactionCount = 0;
  let readwriteTransactionCount = 0;
  let readonlyTransactionCount = 0;
  let evidenceWriteCount = 0;
  let controlWriteCount = 0;
  let facetEntryCount = 0;
  let indexEntryCount = 0;

  databasePrototype.transaction = function (storeNames, mode, options) {
    transactionCount += 1;
    if (mode === "readwrite" || mode === "versionchange") readwriteTransactionCount += 1;
    else readonlyTransactionCount += 1;
    return originalTransaction.call(this, storeNames, mode, options);
  };
  const objectStorePrototype = IDBObjectStore.prototype as unknown as {
    add: (...args: unknown[]) => IDBRequest;
    put: (...args: unknown[]) => IDBRequest;
  };
  const originalAdd = objectStorePrototype.add;
  const originalPut = objectStorePrototype.put;
  objectStorePrototype.add = function (value, key) {
    if ((this as unknown as IDBObjectStore).name === "evidence") {
      const record = value as { facets?: unknown[] };
      evidenceWriteCount += 1;
      const facets = Array.isArray(record.facets) ? record.facets.length : 0;
      facetEntryCount += facets;
      indexEntryCount += facets + 1;
    }
    return originalAdd.call(this, value, key);
  };
  objectStorePrototype.put = function (value, key) {
    if ((this as unknown as IDBObjectStore).name === "historyControl") controlWriteCount += 1;
    return originalPut.call(this, value, key);
  };

  return {
    snapshot() {
      return {
        ...telemetry,
        transactionCount,
        readwriteTransactionCount,
        readonlyTransactionCount,
        evidenceWriteCount,
        controlWriteCount,
        facetEntryCount,
        indexEntryCount
      };
    },
    restore() {
      databasePrototype.transaction = originalTransaction;
      objectStorePrototype.add = originalAdd;
      objectStorePrototype.put = originalPut;
    }
  };
}

function idsMatch(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? Number.NaN;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export function waitForBoundedFrame(
  stage: string,
  progress: () => HarnessProgressInput,
  guard: HarnessStageGuard | undefined = undefined
): Promise<void> {
  publishStageProgress(progress(), guard);
  return withStageDeadline(
    waitForFrame(),
    stage,
    STAGE_DEADLINES_MS.frame,
    progress,
    undefined,
    guard
  );
}

/**
 * Yield for post-publication query/heap hygiene. This is not a publication
 * proof: headed mode keeps the historical rAF yield, while the locked-console
 * proof uses a bounded macrotask because headless Chrome may suppress rAF.
 */
export function waitForBoundedHygieneBoundary(
  stage: string,
  progress: () => HarnessProgressInput,
  proofMode: EventHistoryPerformanceProofMode = EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME,
  guard: HarnessStageGuard | undefined = undefined
): Promise<void> {
  if (proofMode === EVENT_HISTORY_PERFORMANCE_PROOF_MODES.HEADED_VISIBLE_FRAME) {
    return waitForBoundedFrame(stage, progress, guard);
  }
  publishStageProgress(progress(), guard);
  return withStageDeadline(
    new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
    stage,
    STAGE_DEADLINES_MS.frame,
    progress,
    undefined,
    guard
  );
}

function validateConfig(config: EventHistoryPerformanceConfig): void {
  if (config.sustainedEventsPerSecond !== TIMELINE_SUSTAINED_EVENTS_PER_SECOND) {
    throw new Error("The sustained workload must offer exactly 50 events per second.");
  }
  if (config.burstCount !== ISSUE_16_TOTAL_EVENTS) {
    throw new Error("The release gate burst must contain exactly 1,692 events.");
  }
  if (!Number.isInteger(config.sustainedCount) || config.sustainedCount <= 0) {
    throw new Error("The sustained workload count must be a positive integer.");
  }
}
