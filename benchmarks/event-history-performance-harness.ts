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
  createIndexedDbEventHistory,
  type EventHistory
} from "../src/core/event-history";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";

type WorkloadKind = "sustained" | "burst";

type EventHistoryPerformanceConfig = {
  sustainedCount: number;
  sustainedEventsPerSecond: number;
  burstCount: number;
  eventsPerBurst: number;
  burstPauseMs: number;
  batchSize: number;
};

type LatencySummary = { count: number; minMs: number; p50Ms: number; p95Ms: number; maxMs: number; samplesMs: number[] };

type WorkloadResult = {
  adapter: "indexeddb" | "memory";
  workload: WorkloadKind;
  shape: EventHistoryShape;
  accepted: number;
  retained: number;
  correctness: {
    published: number;
    retainedMatchesAccepted: boolean;
    publicationMatchesAccepted: boolean;
    retainedInOrder: boolean;
    publicationInOrder: boolean;
  };
  elapsedMs: number;
  enqueueElapsedMs: number;
  queryBehindBacklogMs: number;
  drainElapsedMs: number;
  throughputEventsPerSecond: number;
  offeredEventsPerSecond: number;
  targetOfferedEventsPerSecond: number | null;
  emitterLatenessMs: LatencySummary;
  maxPendingBytes: number;
  maxOldestPendingAgeMs: number;
  commitToHistoryPublicationLatencyMs: LatencySummary;
  transactionBatching: {
    writeTransactions: number;
    eventAddsPerTransaction: LatencySummary;
    writeTransactionDurationMs: LatencySummary;
  };
  queryLatencyMs: Record<"recentPage" | "indexedSubscription" | "fullText" | "idLookup" | "fullHistory", LatencySummary>;
  longTasksOver50Ms: number;
  maxLongTaskMs: number;
  supportedLongTaskObserver: boolean;
};

type HarnessResult = {
  runner: "real-chrome";
  schemaVersion: 1;
  anchors: { issue16TotalEvents: number };
  config: EventHistoryPerformanceConfig;
  shapeFacts: ReturnType<typeof representativeEventHistoryShapeFacts>;
  workloads: WorkloadResult[];
};

type RetainedSessionFacts = {
  adapter: "indexeddb" | "memory";
  count: number;
  retained: number;
  appendElapsedMs: number;
  longTasksOver50Ms: number;
  maxLongTaskMs: number;
  supportedLongTaskObserver: boolean;
  queryLatencyMs: WorkloadResult["queryLatencyMs"];
};

declare global {
  interface Window {
    __LSEW_EVENT_HISTORY_PERFORMANCE__?: {
      run(overrides?: Partial<EventHistoryPerformanceConfig>): Promise<HarnessResult>;
      prepareRetainedHeapSample(
        adapter: "indexeddb" | "memory",
        count: number
      ): Promise<RetainedSessionFacts>;
      releaseRetainedHeapSample(): Promise<void>;
    };
  }
}

const DEFAULT_CONFIG: EventHistoryPerformanceConfig = {
  sustainedCount: 1_000,
  sustainedEventsPerSecond: TIMELINE_SUSTAINED_EVENTS_PER_SECOND,
  burstCount: ISSUE_16_TOTAL_EVENTS,
  eventsPerBurst: ISSUE_16_TOTAL_EVENTS,
  burstPauseMs: 1,
  batchSize: 256
};

let retainedHeapHistory: EventHistory | null = null;
let retainedHeapDatabaseName: string | null = null;

window.__LSEW_EVENT_HISTORY_PERFORMANCE__ = {
  async run(overrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    validateConfig(config);
    const workloads: WorkloadResult[] = [];
    for (const adapter of ["indexeddb", "memory"] as const) {
      for (const workload of ["sustained", "burst"] as const) {
        for (const shape of EVENT_HISTORY_SHAPES) {
          workloads.push(await runWorkload(adapter, workload, shape, config));
        }
      }
    }
    return {
      runner: "real-chrome",
      schemaVersion: 1,
      anchors: { issue16TotalEvents: ISSUE_16_TOTAL_EVENTS },
      config,
      shapeFacts: representativeEventHistoryShapeFacts(),
      workloads
    };
  },
  async prepareRetainedHeapSample(adapter, count) {
    await releaseRetainedHeapSample();
    const runId = `heap-${adapter}-${Math.random().toString(36).slice(2)}`;
    retainedHeapDatabaseName = adapter === "indexeddb" ? `event-history-performance-${runId}` : null;
    retainedHeapHistory = adapter === "indexeddb"
      ? await createIndexedDbEventHistory({ sessionId: retainedHeapDatabaseName, reset: true, batchSize: DEFAULT_CONFIG.batchSize })
      : createInMemoryEventHistory({ batchSize: DEFAULT_CONFIG.batchSize });
    const events = Array.from({ length: count }, (_, sequence) =>
      createEventHistoryWorkloadEvent(EVENT_HISTORY_SHAPES[sequence % EVENT_HISTORY_SHAPES.length] ?? "small-lifecycle", sequence, runId)
    );
    const longTasks: number[] = [];
    const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const observer = longTaskSupported
      ? new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (entry.duration > 50) longTasks.push(entry.duration);
          }
        })
      : null;
    observer?.observe({ entryTypes: ["longtask"] });
    const startedAt = performance.now();
    await Promise.all(events.map((event) => retainedHeapHistory?.append(event).toPromise()));
    const appendElapsedMs = performance.now() - startedAt;
    const stats = await retainedHeapHistory.stats().toPromise();
    const queryLatencyMs = await measureQueries(
      retainedHeapHistory,
      "small-lifecycle",
      runId
    );
    await delay(0);
    for (const entry of observer?.takeRecords() ?? []) {
      if (entry.duration > 50) longTasks.push(entry.duration);
    }
    observer?.disconnect();
    return {
      adapter,
      count,
      retained: stats.retained,
      appendElapsedMs,
      longTasksOver50Ms: longTasks.length,
      maxLongTaskMs: maximum(longTasks),
      supportedLongTaskObserver: longTaskSupported,
      queryLatencyMs
    };
  },
  async releaseRetainedHeapSample() {
    await releaseRetainedHeapSample();
  }
};

async function releaseRetainedHeapSample(): Promise<void> {
  await retainedHeapHistory?.close().toPromise();
  retainedHeapHistory = null;
  if (retainedHeapDatabaseName) await deleteEventDatabase(eventDatabaseName(retainedHeapDatabaseName));
  retainedHeapDatabaseName = null;
}

async function runWorkload(
  adapter: WorkloadResult["adapter"],
  workload: WorkloadKind,
  shape: EventHistoryShape,
  config: EventHistoryPerformanceConfig
): Promise<WorkloadResult> {
  const runId = `${adapter}-${workload}-${shape}-${Math.random().toString(36).slice(2)}`;
  const sessionId = `event-history-performance-${runId}`;
  const pending = new Map<string, { acceptedAt: number; bytes: number }>();
  const visibleLatencies: number[] = [];
  const publishedIds: string[] = [];

  let maxPendingBytes = 0;
  let maxOldestPendingAgeMs = 0;
  let history: EventHistory | null = null;
  let unsubscribe: (() => void) | null = null;
  let transactionProbe: ReturnType<typeof installTransactionProbe> | null = null;
  let longTaskObserver: PerformanceObserver | null = null;

  function samplePending(): void {
    const now = performance.now();
    const entries = [...pending.values()];
    maxPendingBytes = Math.max(maxPendingBytes, entries.reduce((total, item) => total + item.bytes, 0));
    const oldest = entries.reduce(
      (oldestAt, item) => Math.min(oldestAt, item.acceptedAt),
      Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(oldest)) maxOldestPendingAgeMs = Math.max(maxOldestPendingAgeMs, now - oldest);
  }

  try {
    if (adapter === "indexeddb") {
      await deleteEventDatabase(eventDatabaseName(sessionId));
      history = await createIndexedDbEventHistory({ sessionId, reset: true, batchSize: config.batchSize });
    } else {
      history = createInMemoryEventHistory({ batchSize: config.batchSize });
    }
    const activeHistory = history;
    const eventCount = workload === "sustained" ? config.sustainedCount : config.burstCount;
    const preparedEvents = Array.from({ length: eventCount }, (_, sequence) => {
      const event = createEventHistoryWorkloadEvent(shape, sequence, runId);
      return { event, bytes: utf8JsonBytes(event) };
    });
    transactionProbe = installTransactionProbe();
    unsubscribe = activeHistory.subscribe((change) => {
      const events = change.type === "append" ? [change.event] : change.type === "append-batch" ? change.events : [];
      const now = performance.now();
      for (const event of events) {
        publishedIds.push(event.id);
        const pendingEntry = pending.get(event.id);
        if (pendingEntry) {
          const latency = now - pendingEntry.acceptedAt;
          visibleLatencies.push(latency);
          maxOldestPendingAgeMs = Math.max(maxOldestPendingAgeMs, latency);
          // Publication is the measured pending boundary. In-memory append
          // promises settle on a later microtask even though publication is synchronous.
          pending.delete(event.id);
        }
      }
    });

    const longTasks: number[] = [];
    const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    longTaskObserver = longTaskSupported
      ? new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (entry.duration > 50) longTasks.push(entry.duration);
          }
        })
      : null;
    longTaskObserver?.observe({ entryTypes: ["longtask"] });
    const accepted = workload === "sustained"
      ? await appendSustained(activeHistory, preparedEvents, config, pending, samplePending)
      : await appendBursts(activeHistory, preparedEvents, config, pending, samplePending);
    const enqueueElapsedMs = accepted.elapsedMs;
    const backlogQueryStartedAt = performance.now();
    await activeHistory.queryEvents({ limit: 1, order: "desc" }).toPromise();
    const queryBehindBacklogMs = performance.now() - backlogQueryStartedAt;
    const drainStartedAt = performance.now();
    await Promise.all(accepted);
    const drainElapsedMs = performance.now() - drainStartedAt;
    samplePending();
    const stats = await activeHistory.stats().toPromise();
    const queryLatencyMs = await measureQueries(activeHistory, shape, runId);
    const retainedEvents = await activeHistory.list().toPromise();
    const expectedIds = preparedEvents.map(({ event }) => event.id);
    for (const entry of longTaskObserver?.takeRecords() ?? []) {
      if (entry.duration > 50) longTasks.push(entry.duration);
    }
    const elapsedMs = enqueueElapsedMs + queryBehindBacklogMs + drainElapsedMs;
    return {
      adapter,
      workload,
      shape,
      accepted: accepted.length,
      retained: stats.retained,
      correctness: {
        published: publishedIds.length,
        retainedMatchesAccepted: stats.retained === accepted.length,
        publicationMatchesAccepted: publishedIds.length === accepted.length,
        retainedInOrder: idsMatch(retainedEvents.map((event) => event.id), expectedIds),
        publicationInOrder: idsMatch(publishedIds, expectedIds)
      },
      elapsedMs,
      enqueueElapsedMs,
      queryBehindBacklogMs,
      drainElapsedMs,
      throughputEventsPerSecond: (accepted.length * 1_000) / Math.max(1, elapsedMs),
      offeredEventsPerSecond: (accepted.length * 1_000) / Math.max(1, enqueueElapsedMs),
      targetOfferedEventsPerSecond:
        workload === "sustained" ? config.sustainedEventsPerSecond : null,
      emitterLatenessMs: summarize(accepted.emitterLatenessMs),
      maxPendingBytes,
      maxOldestPendingAgeMs,
      commitToHistoryPublicationLatencyMs: summarize(visibleLatencies),
      transactionBatching: transactionProbe.summary(),
      queryLatencyMs,
      longTasksOver50Ms: longTasks.length,
      maxLongTaskMs: maximum(longTasks),
      supportedLongTaskObserver: longTaskSupported
    };
  } finally {
    longTaskObserver?.disconnect();
    unsubscribe?.();
    try {
      await history?.close().toPromise();
      if (adapter === "indexeddb") await deleteEventDatabase(eventDatabaseName(sessionId));
    } finally {
      transactionProbe?.restore();
    }
  }
}

type PreparedWorkloadEvent = {
  event: ReturnType<typeof createEventHistoryWorkloadEvent>;
  bytes: number;
};

type AcceptedAppends = Array<Promise<unknown>> & {
  elapsedMs: number;
  emitterLatenessMs: number[];
};

async function appendSustained(
  history: EventHistory,
  events: readonly PreparedWorkloadEvent[],
  config: EventHistoryPerformanceConfig,
  pending: Map<string, { acceptedAt: number; bytes: number }>,
  sample: () => void
): Promise<AcceptedAppends> {
  const startedAt = performance.now();
  const accepted = [] as unknown as AcceptedAppends;
  accepted.emitterLatenessMs = [];
  let sequence = 0;
  while (sequence < events.length) {
    const due = Math.min(
      events.length,
      Math.max(1, Math.floor(((performance.now() - startedAt) * config.sustainedEventsPerSecond) / 1_000) + 1)
    );
    while (sequence < due) {
      const prepared = events[sequence];
      if (!prepared) throw new Error(`Missing prepared sustained event ${sequence}.`);
      const scheduledAt = startedAt + (sequence * 1_000) / config.sustainedEventsPerSecond;
      accepted.emitterLatenessMs.push(Math.max(0, performance.now() - scheduledAt));
      accepted.push(appendMeasured(history, prepared, pending));
      sequence += 1;
    }
    sample();
    if (sequence < events.length) {
      const nextDueAt = startedAt + (sequence * 1_000) / config.sustainedEventsPerSecond;
      await delay(Math.max(0, nextDueAt - performance.now()));
    }
  }
  accepted.elapsedMs = performance.now() - startedAt;
  return accepted;
}

async function appendBursts(
  history: EventHistory,
  events: readonly PreparedWorkloadEvent[],
  config: EventHistoryPerformanceConfig,
  pending: Map<string, { acceptedAt: number; bytes: number }>,
  sample: () => void
): Promise<AcceptedAppends> {
  const startedAt = performance.now();
  const accepted = [] as unknown as AcceptedAppends;
  accepted.emitterLatenessMs = [];
  for (let sequence = 0; sequence < events.length; sequence += 1) {
    const prepared = events[sequence];
    if (!prepared) throw new Error(`Missing prepared burst event ${sequence}.`);
    accepted.push(appendMeasured(history, prepared, pending));
    if ((sequence + 1) % config.eventsPerBurst === 0 && sequence + 1 < events.length) {
      sample();
      await delay(config.burstPauseMs);
    }
  }
  sample();
  accepted.elapsedMs = performance.now() - startedAt;
  return accepted;
}

function appendMeasured(
  history: EventHistory,
  prepared: PreparedWorkloadEvent,
  pending: Map<string, { acceptedAt: number; bytes: number }>
): Promise<unknown> {
  const { event, bytes } = prepared;
  const acceptedAt = performance.now();
  pending.set(event.id, { acceptedAt, bytes });
  let operation;
  try {
    operation = history.append(event);
  } catch (error) {
    pending.delete(event.id);
    throw error;
  }
  return operation.toPromise().catch((error) => {
    pending.delete(event.id);
    throw error;
  });
}

async function measureQueries(
  history: EventHistory,
  shape: EventHistoryShape,
  runId: string
): Promise<WorkloadResult["queryLatencyMs"]> {
  const repeat = async (run: () => Promise<unknown>): Promise<LatencySummary> => {
    const durations: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const startedAt = performance.now();
      await run();
      durations.push(performance.now() - startedAt);
    }
    return summarize(durations);
  };
  return {
    recentPage: await repeat(() => history.queryEvents({ limit: 100, order: "desc" }).toPromise()),
    indexedSubscription: await repeat(() =>
      history.queryEvents({ filters: { subscriptionId: "portfolio-command" }, limit: 100 }).toPromise()
    ),
    fullText: await repeat(() =>
      history.queryEvents({ filters: { query: shape === "small-lifecycle" ? "stream-sensing" : "order" }, limit: 100 }).toPromise()
    ),
    idLookup: await repeat(() => history.getEventById(`${runId}-${shape}-0`).toPromise()),
    fullHistory: await repeat(() => history.list().toPromise())
  };
}

function installTransactionProbe() {
  const transactionRecords: Array<{ eventAdds: number; startedAt: number; completedAt?: number }> = [];
  const recordByTransaction = new WeakMap<IDBTransaction, (typeof transactionRecords)[number]>();
  const originalTransaction = IDBDatabase.prototype.transaction;
  const originalAdd = IDBObjectStore.prototype.add;
  IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase["transaction"]>) {
    const transaction = originalTransaction.apply(this, args);
    const mode = args[1] ?? "readonly";
    const storeNames = typeof args[0] === "string" ? [args[0]] : Array.from(args[0]);
    if (mode === "readwrite" && storeNames.includes("events")) {
      const record = { eventAdds: 0, startedAt: performance.now() };
      transactionRecords.push(record);
      recordByTransaction.set(transaction, record);
      transaction.addEventListener("complete", () => { record.completedAt = performance.now(); });
    }
    return transaction;
  };
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore["add"]>) {
    const record = recordByTransaction.get(this.transaction);
    if (record && this.name === "events") record.eventAdds += 1;
    return originalAdd.apply(this, args);
  };
  return {
    summary() {
      const writes = transactionRecords.filter((record) => record.eventAdds > 0);
      return {
        writeTransactions: writes.length,
        eventAddsPerTransaction: summarize(writes.map((record) => record.eventAdds)),
        writeTransactionDurationMs: summarize(
          writes.flatMap((record) => record.completedAt === undefined ? [] : [record.completedAt - record.startedAt])
        )
      };
    },
    restore() {
      IDBDatabase.prototype.transaction = originalTransaction;
      IDBObjectStore.prototype.add = originalAdd;
    }
  };
}

function summarize(values: readonly number[]): LatencySummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    samplesMs: [...values]
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function idsMatch(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function validateConfig(config: EventHistoryPerformanceConfig): void {
  for (const value of Object.values(config)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error("Event History performance values must be positive integers.");
  }
}
