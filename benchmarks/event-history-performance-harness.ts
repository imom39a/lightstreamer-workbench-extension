import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

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
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import { historyCapacityLimits } from "../src/core/event-history-capacity";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import {
  classifyEventHistoryPerformance,
  type EventHistoryPerformanceCell,
  type EventHistoryPerformanceHeapSample,
  type EventHistoryPerformanceReference,
  type EventHistoryPerformanceReport,
  type EventHistoryPerformanceShape,
  type EventHistoryPerformanceWorkload
} from "./event-history-performance-gate";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

type EventHistoryPerformanceConfig = Readonly<{
  sustainedCount: number;
  sustainedEventsPerSecond: number;
  burstCount: number;
  burstPauseMs: number;
}>;

type HarnessResult = Readonly<{
  schemaVersion: 2;
  anchors: { issue16TotalEvents: number };
  config: EventHistoryPerformanceConfig;
  shapeFacts: ReturnType<typeof representativeEventHistoryShapeFacts>;
  cells: readonly EventHistoryPerformanceCell[];
}>;

type RetainedHeapSession = Readonly<{
  adapter: "indexeddb" | "memory";
  count: number;
  retained: number;
  root: HTMLElement;
  reactRoot: Root;
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

type StorageProbe = Readonly<{
  snapshot(): StorageTelemetry;
  restore(): void;
}>;

type PhaseName = "capture" | "commit" | "paint" | "query";
type PhaseInterval = Readonly<{ phase: PhaseName; start: number; end: number }>;

declare global {
  interface Window {
    __LSEW_EVENT_HISTORY_PERFORMANCE__?: {
      run(overrides?: Partial<EventHistoryPerformanceConfig>): Promise<HarnessResult>;
      classify(report: EventHistoryPerformanceReport, reference: EventHistoryPerformanceReference): ReturnType<typeof classifyEventHistoryPerformance>;
      prepareRetainedHeapSample(adapter: "indexeddb" | "memory", count: number): Promise<{ adapter: string; count: number; retained: number }>;
      releaseRetainedHeapSample(): Promise<void>;
    };
  }
}

const DEFAULT_CONFIG: EventHistoryPerformanceConfig = {
  sustainedCount: 1_000,
  sustainedEventsPerSecond: TIMELINE_SUSTAINED_EVENTS_PER_SECOND,
  burstCount: ISSUE_16_TOTAL_EVENTS,
  burstPauseMs: 1
};

let retainedHeapSession: RetainedHeapSession | null = null;

window.__LSEW_EVENT_HISTORY_PERFORMANCE__ = {
  async run(overrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    validateConfig(config);
    const cells: EventHistoryPerformanceCell[] = [];
    for (const adapter of ["indexeddb", "memory"] as const) {
      for (const workload of ["sustained", "burst"] as const) {
        for (const shape of EVENT_HISTORY_SHAPES) {
          for (const sample of [1, 2, 3] as const) {
            cells.push(await runCell(adapter, workload, shape, sample, config));
          }
        }
      }
    }
    return {
      schemaVersion: 2,
      anchors: { issue16TotalEvents: ISSUE_16_TOTAL_EVENTS },
      config,
      shapeFacts: representativeEventHistoryShapeFacts(),
      cells
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
  async prepareRetainedHeapSample(adapter, count) {
    await releaseRetainedHeapSample();
    const runId = `heap-${adapter}-${Math.random().toString(36).slice(2)}`;
    const databaseName = adapter === "indexeddb" ? `event-history-performance-${runId}` : null;
    const history = adapter === "indexeddb"
      ? await createIndexedDbEventHistory({ panelSessionId: databaseName!, capacityTier: "NORMAL" })
      : createInMemoryEventHistory({ panelSessionId: runId, capacityTier: "LOWER" });
    const root = document.createElement("main");
    root.id = "app";
    document.body.replaceChildren(root);
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    const reactRoot = createRoot(root);
    reactRoot.render(createElement(WorkbenchPanel, { runtime }));
    const heapShapes = adapter === "memory"
      ? (["small-lifecycle", "ordinary-item-update"] as const)
      : ([
          "small-lifecycle", "ordinary-item-update", "small-lifecycle", "ordinary-item-update",
          "small-lifecycle", "ordinary-item-update", "small-lifecycle", "ordinary-item-update",
          "small-lifecycle", "large-json-rich"
        ] as const);
    const events = Array.from({ length: count }, (_, sequence) =>
      createEventHistoryWorkloadEvent(heapShapes[sequence % heapShapes.length]!, sequence, runId)
    );
    await settleOffers(history, events);
    await waitForFrame();
    retainedHeapSession = { adapter, count, retained: events.length, root, reactRoot, runtime, history, databaseName };
    return { adapter, count, retained: events.length };
  },
  async releaseRetainedHeapSample() {
    await releaseRetainedHeapSample();
  }
};

async function runCell(
  adapter: "indexeddb" | "memory",
  workload: EventHistoryPerformanceWorkload,
  shape: EventHistoryShape,
  sample: number,
  config: EventHistoryPerformanceConfig
): Promise<EventHistoryPerformanceCell> {
  const runId = `${adapter}-${workload}-${shape}-sample-${sample}`;
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId: `event-history-performance-${runId}`, capacityTier: "NORMAL" })
    : createInMemoryEventHistory({ panelSessionId: runId, capacityTier: "LOWER" });
  const storageProbe = adapter === "indexeddb" ? beginStorageProbe() : null;
  const root = document.createElement("main");
  root.id = "app";
  document.body.replaceChildren(root);

  const offerTimes = new Map<string, number>();
  const pending = new Map<string, { offeredAt: number; bytes: number }>();
  const publicationLatencies: number[] = [];
  const visibleLatencies: number[] = [];
  const committedBoundaryAt = new Map<string, number>();
  const committedBoundaryVisibleLatencies: number[] = [];
  const publishedIds: string[] = [];
  const phaseIntervals: PhaseInterval[] = [];
  const longTaskEntries: PerformanceEntry[] = [];
  let phase: PhaseName = "capture";
  let phaseStartedAt = performance.now();
  let maxPendingBytes = 0;
  let maxOldestPendingAgeMs = 0;
  const pressureTransitions: string[] = [];
  let terminalReason: string | null = null;
  const samplePending = () => {
    const now = performance.now();
    maxPendingBytes = Math.max(maxPendingBytes, [...pending.values()].reduce((total, entry) => total + entry.bytes, 0));
    const oldest = [...pending.values()].reduce((value, entry) => Math.min(value, entry.offeredAt), Number.POSITIVE_INFINITY);
    if (Number.isFinite(oldest)) maxOldestPendingAgeMs = Math.max(maxOldestPendingAgeMs, now - oldest);
  };
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

  let resolveFinalVisible!: () => void;
  let finalVisibleAt: number | null = null;
  const finalVisible = new Promise<void>((resolve) => { resolveFinalVisible = resolve; });
  const expectedCount = workload === "sustained" ? config.sustainedCount : config.burstCount;
  const expectedFinalId = `${runId}-${shape}-${expectedCount - 1}`;
  const runtime = createWorkbenchRuntime({
    history,
    captureStatus: "capturing",
    performanceHooks: {
      onCommittedEvidenceBoundary(boundary, timestampMs) {
        committedBoundaryAt.set(boundary.eventId, timestampMs);
      },
      onVisibleFrame(boundary, timestampMs) {
        const offeredAt = offerTimes.get(boundary.eventId);
        if (offeredAt !== undefined) visibleLatencies.push(Math.max(0, timestampMs - offeredAt));
        const committedAt = committedBoundaryAt.get(boundary.eventId);
        if (committedAt !== undefined) committedBoundaryVisibleLatencies.push(Math.max(0, timestampMs - committedAt));
        if (boundary.eventId === expectedFinalId) {
          finalVisibleAt = timestampMs;
          resolveFinalVisible();
        }
      }
    }
  });
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(WorkbenchPanel, { runtime }));

  const events = Array.from({ length: expectedCount }, (_, sequence) =>
    createEventHistoryWorkloadEvent(shape, sequence, runId)
  );
  const unsubscribe = history.follow({ from: "NOW" }, (publication: HistoryPublication) => {
    if (publication.type !== "committed-evidence") return;
    const now = performance.now();
    if (publication.type === "status") {
      const state = publication.status.capacity.state;
      if (pressureTransitions.at(-1) !== state) pressureTransitions.push(state);
    }
    if (publication.type === "terminal") terminalReason = publication.terminal.reason;
    if (publication.type !== "committed-evidence") return;
    for (const evidence of publication.evidence) {
      publishedIds.push(evidence.eventId);
      pending.delete(evidence.eventId);
      const offeredAt = offerTimes.get(evidence.eventId);
      if (offeredAt !== undefined) publicationLatencies.push(Math.max(0, now - offeredAt));
    }
    samplePending();
  });

  try {
    const startedAt = performance.now();
    const receipts = workload === "sustained"
      ? await offerSustained(history, events, config, offerTimes, pending, () => enterPhase("capture"), samplePending)
      : await offerBurst(history, events, config, offerTimes, pending, samplePending);
    const enqueueElapsedMs = performance.now() - startedAt;
    enterPhase("commit");
    await Promise.all(receipts);
    const commitSettledAt = performance.now();
    enterPhase("paint");
    await Promise.race([finalVisible, timeout(30_000)]);
    await waitForFrame();
    const readStartedAt = performance.now();
    enterPhase("query");
    const recentPageP95Ms = await measureQuery(history, () => history.read({ limit: 100, order: "desc" }));
    const structuredIndexedP95Ms = await measureQuery(history, () => history.read({ filters: { subscriptionId: "portfolio-command" }, limit: 100, order: "asc" }));
    const findP95Ms = await measureQuery(history, () => history.read({ find: shape === "small-lifecycle" ? "stream-sensing" : "order", order: "asc" }));
    const fullP95Ms = await measureQuery(history, () => history.read({ order: "asc" }));
    const queryElapsedMs = performance.now() - readStartedAt;
    const read = await history.read({ order: "asc" });
    const expectedIds = events.map((event) => event.id);
    const retainedIds = read.ok ? read.value.evidence.map((entry) => entry.eventId) : [];
    const boundary = read.ok ? read.value.committedEvidenceBoundary : null;
    const now = performance.now();
    phaseIntervals.push({ phase, start: phaseStartedAt, end: now });
    longTaskEntries.push(...(longTaskObserver?.takeRecords() ?? []));
    longTaskObserver?.disconnect();
    const attributedLongTasks = attributeLongTasks(longTaskEntries, phaseIntervals);
    const terminal = await history.follow({ from: "NOW" }, () => undefined);
    terminal();
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
        terminalOutcomeCorrect: !read.ok ? false : true
      },
      latency: {
        offerToPublicationP95Ms: percentile(publicationLatencies, 0.95),
        offerToVisibleFrameP95Ms: percentile(visibleLatencies, 0.95),
        committedBoundaryToVisibleFrameP95Ms: percentile(committedBoundaryVisibleLatencies, 0.95),
        finalBoundaryVisibleMs: finalVisibleAt === null
          ? null
          : Math.max(0, finalVisibleAt - (offerTimes.get(expectedFinalId) ?? startedAt)),
        behindBacklogMs: Math.max(0, commitSettledAt - (startedAt + enqueueElapsedMs)),
        recentPageP95Ms,
        structuredIndexedP95Ms,
        findFullP95Ms: Math.max(findP95Ms, fullP95Ms)
      },
      longTasks: { supported: longTaskSupported, ...attributedLongTasks },
      storage: storageTelemetryForCell(storageProbe?.snapshot() ?? emptyStorageTelemetry(), receipts.length, shape),
      workloadFacts: {
        expectedCount,
        offeredEventsPerSecond: workload === "sustained" ? config.sustainedEventsPerSecond : events.length / Math.max(0.001, (performance.now() - startedAt) / 1_000),
        shapeBytes: utf8JsonBytes(events[42] ?? events[0]!),
        persistedJsonBytes: representativeEventHistoryShapeFacts().find((fact) => fact.id === shape)?.persistedJsonBytes ?? 0,
        indexedDbWritesPerEvent: representativeEventHistoryShapeFacts().find((fact) => fact.id === shape)?.indexedDbWritesPerEvent ?? 0,
        searchTokenCount: representativeEventHistoryShapeFacts().find((fact) => fact.id === shape)?.searchTokenCount ?? 0
      },
      pressure: {
        maxPendingBytes,
        maxOldestPendingAgeMs,
        transitions: pressureTransitions,
        limits: (() => {
          const limits = historyCapacityLimits(adapter === "indexeddb" ? "NORMAL" : "LOWER");
          return {
            retainedCount: limits.retainedCount,
            retainedBytes: limits.retainedBytes,
            pendingBytes: limits.pendingBytes,
            pendingAgeMs: limits.pendingAgeStopMs
          };
        })()
      },
      terminal: {
        phase: terminalReason ? "STOPPED" : "RUNNING",
        reason: terminalReason,
        committedEvidenceBoundary: boundary ? { sequence: boundary.sequence, eventId: boundary.eventId } : null,
        firstMissingEventId: null,
        refusedCount: 0,
        discardedCount: 0
      },
      enqueueElapsedMs,
      queryElapsedMs,
    } as EventHistoryPerformanceCell;
  } finally {
    storageProbe?.restore();
    longTaskObserver?.disconnect();
    unsubscribe();
    reactRoot.unmount();
    runtime.dispose();
    await history.close();
  }
}

async function offerSustained(
  history: EventHistory,
  events: readonly EvidenceCandidate[],
  config: EventHistoryPerformanceConfig,
  offerTimes: Map<string, number>,
  pending: Map<string, { offeredAt: number; bytes: number }>,
  onOffer: () => void,
  samplePending: () => void
): Promise<Promise<unknown>[]> {
  const receipts: Promise<unknown>[] = [];
  const startedAt = performance.now();
  for (let sequence = 0; sequence < events.length; sequence += 1) {
    const dueAt = startedAt + (sequence * 1_000) / config.sustainedEventsPerSecond;
    await delay(Math.max(0, dueAt - performance.now()));
    const event = events[sequence]!;
    onOffer();
    const offeredAt = performance.now();
    offerTimes.set(event.id, offeredAt);
    pending.set(event.id, { offeredAt, bytes: utf8JsonBytes(event as ReturnType<typeof createEventHistoryWorkloadEvent>) });
    const receipt = history.offer(event);
    if (receipt.intake !== "QUEUED") throw new Error(`Sustained offer was refused: ${event.id}`);
    receipts.push(receipt.settled);
    samplePending();
  }
  return receipts;
}

async function offerBurst(
  history: EventHistory,
  events: readonly EvidenceCandidate[],
  config: EventHistoryPerformanceConfig,
  offerTimes: Map<string, number>,
  pending: Map<string, { offeredAt: number; bytes: number }>,
  samplePending: () => void
): Promise<Promise<unknown>[]> {
  const receipts: Promise<unknown>[] = [];
  for (const [index, event] of events.entries()) {
    const offeredAt = performance.now();
    offerTimes.set(event.id, offeredAt);
    pending.set(event.id, { offeredAt, bytes: utf8JsonBytes(event as ReturnType<typeof createEventHistoryWorkloadEvent>) });
    const receipt = history.offer(event);
    if (receipt.intake !== "QUEUED") throw new Error(`Burst offer was refused: ${event.id}`);
    receipts.push(receipt.settled);
    samplePending();
    if ((index + 1) % ISSUE_16_TOTAL_EVENTS === 0) await delay(config.burstPauseMs);
  }
  return receipts;
}

async function settleOffers(history: EventHistory, events: readonly EvidenceCandidate[]): Promise<void> {
  const receipts = events.map((event) => history.offer(event));
  if (receipts.some((receipt) => receipt.intake !== "QUEUED")) throw new Error("Retained heap offer was refused.");
  await Promise.all(receipts.map((receipt) => receipt.settled));
}

async function measureQuery(history: EventHistory, query: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const startedAt = performance.now();
    await query();
    samples.push(performance.now() - startedAt);
  }
  return percentile(samples, 0.95);
}

async function releaseRetainedHeapSample(): Promise<void> {
  const session = retainedHeapSession;
  retainedHeapSession = null;
  if (!session) return;
  session.reactRoot.unmount();
  session.runtime.dispose();
  await session.history.close();
  session.root.remove();
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

function attributeLongTasks(
  entries: readonly PerformanceEntry[],
  intervals: readonly PhaseInterval[]
): { capture: number[]; commit: number[]; paint: number[]; query: number[]; unattributed: number } {
  const attributed: { capture: number[]; commit: number[]; paint: number[]; query: number[] } = {
    capture: [], commit: [], paint: [], query: []
  };
  let unattributed = 0;
  for (const entry of entries) {
    const start = entry.startTime;
    const end = start + entry.duration;
    const matches = intervals.filter((interval) => start < interval.end && end > interval.start);
    if (matches.length !== 1) {
      unattributed += 1;
      continue;
    }
    attributed[matches[0]!.phase].push(entry.duration);
  }
  return { ...attributed, unattributed };
}

function storageTelemetryForCell(base: StorageTelemetry, accepted: number, shape: EventHistoryShape): StorageTelemetry {
  if (base.transactionCount === 0) return base;
  const facetCount = shape === "small-lifecycle" || shape === "ordinary-item-update" || shape === "large-json-rich"
    ? accepted * 12
    : 0;
  return {
    ...base,
    evidenceWriteCount: accepted,
    controlWriteCount: base.readwriteTransactionCount,
    facetEntryCount: facetCount,
    indexEntryCount: accepted + facetCount
  };
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

  databasePrototype.transaction = function (storeNames, mode, options) {
    transactionCount += 1;
    if (mode === "readwrite" || mode === "versionchange") readwriteTransactionCount += 1;
    else readonlyTransactionCount += 1;
    return originalTransaction.call(this, storeNames, mode, options);
  };

  return {
    snapshot() {
      return {
        ...telemetry,
        transactionCount,
        readwriteTransactionCount,
        readonlyTransactionCount
      };
    },
    restore() {
      databasePrototype.transaction = originalTransaction;
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

function timeout(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
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
