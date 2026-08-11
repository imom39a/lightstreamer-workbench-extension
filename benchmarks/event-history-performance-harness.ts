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
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
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
  TERMINAL_PENDING_BYTE_EVENT_COUNT,
  type EventHistoryPerformanceCell,
  type EventHistoryPerformanceCheckpointScenario,
  type EventHistoryPerformanceHeapSample,
  type EventHistoryPerformanceReference,
  type EventHistoryPerformanceReport,
  type EventHistoryPerformanceShape,
  type EventHistoryPerformanceTerminalScenario,
  type EventHistoryPerformanceWorkload
} from "./event-history-performance-gate";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";
import { createWorkbenchRuntime, type WorkbenchRuntimePerformanceHooks } from "../src/extension/panel/workbench-runtime";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

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
  terminalScenarios: readonly EventHistoryPerformanceTerminalScenario[];
  checkpointScenarios: readonly EventHistoryPerformanceCheckpointScenario[];
}>;

type RetainedHeapSession = Readonly<{
  adapter: "indexeddb" | "memory";
  count: number;
  retained: number;
  root: HTMLElement;
  disposePanel: () => void;
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
    const terminalScenarios: EventHistoryPerformanceTerminalScenario[] = [];
    for (const adapter of ["indexeddb", "memory"] as const) {
      for (const trigger of ["PENDING_BYTES", "PENDING_AGE"] as const) {
        terminalScenarios.push(await runTerminalScenario(adapter, trigger));
      }
    }
    const checkpointScenarios: EventHistoryPerformanceCheckpointScenario[] = [];
    for (const adapter of ["indexeddb", "memory"] as const) {
      for (const name of ["representative", "maximum-2MiB"] as const) {
        checkpointScenarios.push(await runCheckpointScenario(adapter, name));
      }
    }
    return {
      schemaVersion: 2,
      anchors: { issue16TotalEvents: ISSUE_16_TOTAL_EVENTS },
      config,
      shapeFacts: representativeEventHistoryShapeFacts(),
      cells,
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
    const panel = await mountProductionPanel(history, undefined, root);
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
    retainedHeapSession = { adapter, count, retained: events.length, root: panel.root, disposePanel: panel.disposePanel, runtime: panel.runtime, history, databaseName };
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
  let terminalPublication: Extract<HistoryPublication, { type: "terminal" }>['terminal'] | null = null;
  let unsubscribe: () => void = () => undefined;
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
  const panel = await mountProductionPanel(history, {
      onCommittedEvidenceBoundary(boundary, timestampMs) {
        committedBoundaryAt.set(boundary.eventId, timestampMs);
      },
      onVisibleFrame(_boundary, timestampMs, coveredBoundaries) {
        for (const coveredBoundary of coveredBoundaries) {
          const offeredAt = offerTimes.get(coveredBoundary.eventId);
          if (offeredAt !== undefined) visibleLatencies.push(Math.max(0, timestampMs - offeredAt));
          const committedAt = committedBoundaryAt.get(coveredBoundary.eventId);
          if (committedAt !== undefined) committedBoundaryVisibleLatencies.push(Math.max(0, timestampMs - committedAt));
          if (coveredBoundary.eventId === expectedFinalId) {
            finalVisibleAt = timestampMs;
            resolveFinalVisible();
          }
        }
      }
    }, root);
  const events = Array.from({ length: expectedCount }, (_, sequence) =>
    createEventHistoryWorkloadEvent(shape, sequence, runId)
  );
  unsubscribe = history.follow({ from: "NOW" }, (publication: HistoryPublication) => {
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
      storage: storageTelemetryForCell(storageProbe?.snapshot() ?? emptyStorageTelemetry()),
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
  } finally {
    storageProbe?.restore();
    longTaskObserver?.disconnect();
    unsubscribe();
    panel.disposePanel();
    await history.close();
  }
}

async function runTerminalScenario(
  adapter: "indexeddb" | "memory",
  trigger: "PENDING_BYTES" | "PENDING_AGE"
): Promise<EventHistoryPerformanceTerminalScenario> {
  const tier = adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const;
  let releaseCommit = (): void => undefined;
  const blockedCommit = new Promise<void>((resolve) => { releaseCommit = resolve; });
  const panelSessionId = `event-history-terminal-${adapter}-${trigger.toLowerCase()}`;
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId, capacityTier: tier, ...(trigger === "PENDING_AGE" ? { commitBatch: () => blockedCommit } : {}) })
    : createInMemoryEventHistory({ panelSessionId, capacityTier: tier, ...(trigger === "PENDING_AGE" ? { commitBatch: () => blockedCommit } : {}) });
  const terminals: Array<Extract<HistoryPublication, { type: "terminal" }>> = [];
  const pressureTransitions: string[] = [];
  const unsubscribe = history.follow({ from: "NOW" }, (publication) => {
    if (publication.type === "terminal") terminals.push(publication);
    if (publication.type === "status") {
      const state = publication.status.capacity.state;
      if (pressureTransitions.at(-1) !== state) pressureTransitions.push(state);
    }
  });
  const receipts: Array<{ id: string; receipt: ReturnType<EventHistory["offer"]> }> = [];
  const firstEvent = createEventHistoryWorkloadEvent("large-json-rich", 0, `${panelSessionId}-accepted`);
  if (trigger === "PENDING_BYTES") {
    const events = Array.from({ length: TERMINAL_PENDING_BYTE_EVENT_COUNT }, (_, index) =>
      createStagedTopologyCheckpointCandidate(`${panelSessionId}-${index}`, "terminal-pressure", TERMINAL_CHECKPOINT_PAYLOAD_BYTES)
    );
    for (const event of events) receipts.push({ id: event.id, receipt: history.offer(event) });
  } else {
    receipts.push({ id: firstEvent.id, receipt: history.offer(firstEvent) });
    await delay((tier === "NORMAL" ? 30_000 : 5_000) + 150);
    const refused = createEventHistoryWorkloadEvent("small-lifecycle", 1, `${panelSessionId}-refused`);
    receipts.push({ id: refused.id, receipt: history.offer(refused) });
    releaseCommit();
  }
  const outcomes = await Promise.all(receipts.map(({ receipt }) => receipt.settled));
  const accepted = outcomes.filter((outcome) => outcome.outcome === "BECAME_EVIDENCE");
  const refused = receipts.filter((entry, index) => outcomes[index]?.outcome === "NOT_EVIDENCE");
  const read = await history.read({ order: "asc" });
  const terminal = terminals.at(-1)?.terminal ?? null;
  unsubscribe();
  await history.close();
  const finalEvidence = read.ok ? read.value.evidence.at(-1) ?? null : null;
  const expectedFirstMissing = trigger === "PENDING_BYTES" ? refused[0]?.id ?? null : null;
  const refusedIdentityCorrect = trigger === "PENDING_BYTES"
    ? terminal?.firstMissingEventId === expectedFirstMissing
    : terminal?.firstMissingEventId === null && refused.length === 1 && outcomes.at(-1)?.outcome === "NOT_EVIDENCE";
  return {
    adapter,
    trigger,
    tier,
    terminalReason: trigger === "PENDING_BYTES" ? "PENDING_BYTE_LIMIT" : "PENDING_AGE_LIMIT",
    terminalReasonCorrect: terminal?.reason === (trigger === "PENDING_BYTES" ? "PENDING_BYTE_LIMIT" : "PENDING_AGE_LIMIT"),
    acceptedCount: accepted.length,
    refusedCount: refused.length,
    refusedEventIds: refused.map((entry) => entry.id),
    firstMissingEventId: terminal?.firstMissingEventId ?? null,
    committedBoundary: terminal?.committedEvidenceBoundary ? { sequence: terminal.committedEvidenceBoundary.sequence, eventId: terminal.committedEvidenceBoundary.eventId } : null,
    terminalPublicationCount: terminals.length,
    finalBoundaryCorrect: terminal !== null && terminal.committedEvidenceBoundary?.sequence === accepted.length && finalEvidence?.eventId === terminal.committedEvidenceBoundary.eventId,
    refusedIdentityCorrect,
    exactOneTerminalPublication: terminals.length === 1,
    pressureTransitions
  };
}

async function runCheckpointScenario(
  adapter: "indexeddb" | "memory",
  name: "representative" | "maximum-2MiB"
): Promise<EventHistoryPerformanceCheckpointScenario> {
  const tier = adapter === "indexeddb" ? "NORMAL" as const : "LOWER" as const;
  const history = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId: `event-history-checkpoint-${adapter}-${name}`, capacityTier: tier })
    : createInMemoryEventHistory({ panelSessionId: `event-history-checkpoint-${adapter}-${name}`, capacityTier: tier });
  const candidate = createStagedTopologyCheckpointCandidate(
    `checkpoint-${adapter}-${name}`,
    `sync-${name}`,
    name === "representative" ? 64 * 1_024 : TERMINAL_CHECKPOINT_PAYLOAD_BYTES
  );
  const serialized = serializeJournalEvidenceCandidate(candidate);
  const publications: HistoryPublication[] = [];
  const unsubscribe = history.follow({ from: "NOW" }, (publication) => publications.push(publication));
  const trafficBefore = Array.from({ length: 4 }, (_, index) =>
    createEventHistoryWorkloadEvent("ordinary-item-update", index, `${adapter}-${name}-before`)
  );
  const trafficAfter = Array.from({ length: 4 }, (_, index) =>
    createEventHistoryWorkloadEvent("ordinary-item-update", index, `${adapter}-${name}-after`)
  );
  await Promise.all(trafficBefore.map((event) => history.offer(event).settled));
  const receipt = history.offer(candidate);
  const outcome = await receipt.settled;
  await Promise.all(trafficAfter.map((event) => history.offer(event).settled));
  const read = await history.read({ order: "asc" });
  const committedPublication = publications.find((publication) =>
    publication.type === "committed-evidence" && publication.evidence.some((entry) => entry.eventId === candidate.id)
  );
  const publishedOrder = publications
    .filter((publication): publication is Extract<HistoryPublication, { type: "committed-evidence" }> => publication.type === "committed-evidence")
    .flatMap((publication) => publication.evidence.map((entry) => entry.eventId));
  const candidateIndex = publishedOrder.indexOf(candidate.id);
  const trafficBeforeIds = trafficBefore.map((event) => event.id);
  const trafficAfterIds = trafficAfter.map((event) => event.id);
  unsubscribe();
  await history.close();
  return {
    name,
    adapter,
    accepted: outcome.outcome === "BECAME_EVIDENCE",
    retained: read.ok ? read.value.total : 0,
    trafficBefore: trafficBefore.length,
    trafficAfter: trafficAfter.length,
    interleaved: publications.some((publication) =>
      publication.type === "committed-evidence" &&
      publication.evidence.some((entry) => entry.eventId === candidate.id) &&
      candidateIndex > -1 &&
      trafficBeforeIds.every((eventId) => publishedOrder.indexOf(eventId) < candidateIndex) &&
      trafficAfterIds.every((eventId) => publishedOrder.indexOf(eventId) > candidateIndex)
    ),
    canonicalBytes: journalAccountedBytes(serialized.bytes),
    committedBoundaryCorrect: outcome.outcome === "BECAME_EVIDENCE" && outcome.evidence.eventId === candidate.id,
    batchAcceptedAsOneOversizedUnit: committedPublication?.type === "committed-evidence" && committedPublication.evidence.length === 1
  };
}

export function createStagedTopologyCheckpointCandidate(
  seed: string,
  syncId: string,
  minimumCanonicalBytes: number
): EvidenceCandidate {
  const pageEpoch = `page-${seed}`;
  const panelSessionId = "panel-00000000-0000-4000-8000-000000000099";
  const coverage: TopologyCoverage = { status: "complete", getters: {} };
  const recordCount = minimumCanonicalBytes >= TERMINAL_CHECKPOINT_PAYLOAD_BYTES ? 6_500 : 230;
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
  const projection = createTopologyProjection();
  let candidate: EvidenceCandidate | undefined;
  for (const frame of frames) {
    if (frame.type === TOPOLOGY_SYNC_COMPLETE) {
      for (const observation of observations) projection.ingestCapture(observation);
    }
    const result = projection.applySyncFrame(frame);
    if (result.candidate) candidate = result.candidate;
  }
  return candidate;
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
    pending.set(event.id, { offeredAt, bytes: journalAccountedBytes(serializeJournalEvidenceCandidate(event).bytes) });
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
    pending.set(event.id, { offeredAt, bytes: journalAccountedBytes(serializeJournalEvidenceCandidate(event).bytes) });
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

async function mountProductionPanel(
  history: EventHistory,
  performanceHooks: WorkbenchRuntimePerformanceHooks | undefined = undefined,
  root: HTMLElement = document.createElement("main")
): Promise<{
  root: HTMLElement;
  runtime: ReturnType<typeof createWorkbenchRuntime>;
  disposePanel: () => void;
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
  disposePanel();
  throw new Error("Production panel mount did not render its React boundary.");
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
  session.disposePanel();
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
