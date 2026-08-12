import {
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_LIMITS,
  TOPOLOGY_SYNC_VERSION,
  isTopologyObservation,
  type TopologyAbsoluteRecord,
  type TopologyCoverage,
  type TopologyCoverageReason,
  type TopologyGetterCoverage,
  type TopologyObservation,
  type TopologySyncChunkFrame,
  type TopologySyncFrame,
  type TopologySyncCompleteFrame,
  type TopologySyncMetadata
} from "../../bridge/messages";
import { type LightstreamerEventEnvelope } from "../../core/event-envelope";
import {
  type CommittedEvidence,
  type TopologyCheckpointEvidenceCandidate
} from "../../core/event-history-authoritative";
import { createTopologyCheckpointEvidenceCandidate } from "./topology-checkpoint-evidence-codec";
import {
  createTopologyStateIndex,
  type TopologyClient,
  type TopologyState,
  type TopologyStateIndex
} from "../../core/topology-state";
import {
  createTopologySyncCoordinator,
  type TopologySyncStatus
} from "../../core/topology-sync";
import {
  createPanelTopologySyncAdapter,
  resetPanelTopologyObservations,
  snapshotPanelTopologyState
} from "./topology-sync-adapter";
import {
  topologyClientKey,
  topologyCommandGenerationKey,
  topologyInferredChildKey,
  topologyItemKey,
  topologyListenerKey,
  topologySessionKey,
  topologySubscriptionKey
} from "./topology-view-model";

export type TopologyProjectionStatus = {
  semanticActive: boolean;
  syncState: TopologySyncStatus["state"] | "legacy";
  coverage: TopologyCoverage | null;
};

export type TopologyProjectionResult = {
  accepted: boolean;
  resetConsumerState: boolean;
  duplicate?: boolean;
  candidate?: TopologyCheckpointEvidenceCandidate;
};

export type TopologyProjection = {
  replaceHistory(events: readonly LightstreamerEventEnvelope[]): void;
  applySyncFrame(frame: TopologySyncFrame): TopologyProjectionResult;
  ingestCommittedEvidence(
    evidence: CommittedEvidence | readonly CommittedEvidence[]
  ): TopologyProjectionResult;
  snapshot(): TopologyState;
  scopeStructureRevision(): number;
  sensitiveStructureRevision(): number;
  status(): TopologyProjectionStatus;
  resetCurrentObservations(): void;
  clearHistory(): void;
  clear(): void;
};

const MAX_RETAINED_SEMANTIC_EVENTS = 4_096;
const MAX_RETIRED_PAGE_EPOCHS = 16;

const DEFAULT_COVERAGE: TopologyCoverage = { status: "complete", getters: {} };

/** Owns legacy reconstruction, semantic live projection, checkpoint sync, and history merging. */
export function createTopologyProjection(): TopologyProjection {
  const legacyIndex = createTopologyStateIndex();
  const legacyLiveFallbackIndex = createTopologyStateIndex();
  const semanticEvents = new Map<string, LightstreamerEventEnvelope>();
  const retainedSemanticEvents = new Map<string, LightstreamerEventEnvelope>();
  const syncAdapter = createPanelTopologySyncAdapter((observation) => {
    const key = semanticEventKey(observation);
    const event = semanticEvents.get(key);
    semanticEvents.delete(key);
    return event;
  });
  let generation = 0;
  let syncCoordinator = createTopologySyncCoordinator("panel:legacy", syncAdapter);
  let stagedSync: {
    metadata: TopologySyncFrame;
    frames: TopologySyncFrame[];
    observations: Map<number, TopologyObservation>;
  } | undefined;
  let stagedSyncStatus: TopologySyncStatus = { state: "idle", retry: false };
  let semanticActive = false;
  let coverage: TopologyCoverage | null = null;
  const retiredPageEpochs = new Set<string>();
  const preservedHistory = new Map<string, TopologyClient>();
  const staleSemanticEventIds = new Set<string>();
  const retainedSemanticEventIds = new Set<string>();
  let materializedStateDirty = true;
  let materializedScopeStructureDirty = true;
  let materializedState: TopologyState | null = null;
  let materializedScopeStructureKeys: readonly string[] = [];
  let scopeStructureRevision = 0;
  let sensitiveStructureRevision = 0;
  let usingLegacyLiveFallback = false;

  function invalidateMaterializedState(scopeStructureMayHaveChanged = true): void {
    materializedStateDirty = true;
    materializedScopeStructureDirty ||= scopeStructureMayHaveChanged;
  }

  function activatePage(pageEpoch: string): TopologyProjectionResult {
    if (retiredPageEpochs.has(pageEpoch)) {
      return { accepted: false, resetConsumerState: false };
    }
    const resetConsumerState =
      !semanticActive || syncCoordinator.pageEpoch() !== pageEpoch;
    if (resetConsumerState) {
      if (semanticActive) {
        rememberHistory(snapshotPanelTopologyState(syncCoordinator.snapshot()));
        retiredPageEpochs.add(syncCoordinator.pageEpoch());
        trimSet(retiredPageEpochs, MAX_RETIRED_PAGE_EPOCHS);
        legacyLiveFallbackIndex.clear();
      }
      syncCoordinator.retirePageEpoch(pageEpoch);
      semanticEvents.clear();
      retainedSemanticEvents.clear();
      retainedSemanticEventIds.clear();
    }
    semanticActive = true;
    return { accepted: true, resetConsumerState };
  }

  function applyCommittedCapture(event: LightstreamerEventEnvelope): TopologyProjectionResult {
    const scopeStructureMayHaveChanged = eventMayChangeScopeStructure(
      event,
      materializedState
    );
    if (eventMayChangeSensitiveStructure(event, scopeStructureMayHaveChanged)) {
      sensitiveStructureRevision += 1;
    }
    const observation = event.topology;
    if (!observation) {
      legacyLiveFallbackIndex.ingest(event);
      invalidateMaterializedState(scopeStructureMayHaveChanged);
      return { accepted: true, resetConsumerState: false };
    }
    const activation = activatePage(observation.pageEpoch);
    if (!activation.accepted) {
      staleSemanticEventIds.add(event.id);
      trimSet(staleSemanticEventIds, MAX_RETAINED_SEMANTIC_EVENTS);
      return activation;
    }
    coverage = observation.coverage;
    retainedSemanticEventIds.add(event.id);
    trimSet(retainedSemanticEventIds, MAX_RETAINED_SEMANTIC_EVENTS);
    const key = semanticEventKey(observation);
    retainedSemanticEvents.set(key, event);
    trimMap(retainedSemanticEvents, MAX_RETAINED_SEMANTIC_EVENTS);
    semanticEvents.set(key, event);
    trimMap(semanticEvents, MAX_RETAINED_SEMANTIC_EVENTS);
    if (
      stagedSync &&
      observation.pageEpoch === stagedSync.metadata.pageEpoch &&
      observation.captureSequence > stagedSync.metadata.cutoffCaptureSequence
    ) {
      stagedSync.observations.set(observation.captureSequence, observation);
    }
    syncCoordinator.applyLive(observation);
    invalidateMaterializedState(scopeStructureMayHaveChanged);
    return activation;
  }

  function applyCommittedHistory(event: LightstreamerEventEnvelope): boolean {
    const scopeStructureMayHaveChanged = eventMayChangeScopeStructure(
      event,
      materializedState
    );
    if (eventMayChangeSensitiveStructure(event, scopeStructureMayHaveChanged)) {
      sensitiveStructureRevision += 1;
    }
    const belongsToCurrentPage = !staleSemanticEventIds.delete(event.id);
    const wasSemanticCapture = retainedSemanticEventIds.delete(event.id);
    legacyIndex.ingest(event);
    if (belongsToCurrentPage && !wasSemanticCapture) {
      legacyLiveFallbackIndex.ingest(event);
    }
    invalidateMaterializedState(scopeStructureMayHaveChanged);
    return belongsToCurrentPage;
  }

  function ingestCommittedTopologyEvent(
    event: LightstreamerEventEnvelope
  ): TopologyProjectionResult {
    const captureResult = applyCommittedCapture(event);
    if (captureResult.accepted) {
      legacyIndex.ingest(event);
      return captureResult;
    }

    const scopeStructureMayHaveChanged = eventMayChangeScopeStructure(
      event,
      materializedState
    );
    const belongsToCurrentPage = !staleSemanticEventIds.delete(event.id);
    const wasSemanticCapture = retainedSemanticEventIds.delete(event.id);
    legacyIndex.ingest(event);
    if (belongsToCurrentPage && !wasSemanticCapture) {
      legacyLiveFallbackIndex.ingest(event);
    }
    invalidateMaterializedState(scopeStructureMayHaveChanged);
    return captureResult;
  }

  function applyCommittedCheckpoint(
    candidate: TopologyCheckpointEvidenceCandidate
  ): TopologyProjectionResult {
    const reconstructed = reconstructCheckpointFrames(candidate);
    if (!reconstructed) {
      return { accepted: false, resetConsumerState: false };
    }

    const retained = [...retainedSemanticEvents.values()]
      .filter(
        (event) =>
          event.topology?.pageEpoch === reconstructed.metadata.pageEpoch &&
          event.topology?.captureSequence > reconstructed.cutoffCaptureSequence
      )
      .sort(
        (left, right) =>
          (left.topology?.captureSequence ?? 0) - (right.topology?.captureSequence ?? 0)
      );
    const replayObservations = new Map<string, TopologyObservation>(
      reconstructed.observations.map((observation) => [
        semanticEventKey(observation),
        observation
      ])
    );
    const retainedEvents = new Map<string, LightstreamerEventEnvelope>();
    for (const event of retained) {
      if (event.topology) {
        const key = semanticEventKey(event.topology);
        replayObservations.set(key, event.topology);
        retainedEvents.set(key, event);
      }
    }
    const beginResult = applyCommittedSyncFrame(reconstructed.begin);
    if (!beginResult.accepted) return beginResult;
    if (beginResult.duplicate) return beginResult;
    for (const chunk of reconstructed.chunks) {
      const chunkResult = applyCommittedSyncFrame(chunk);
      if (!chunkResult.accepted) {
        return chunkResult;
      }
    }
    const completeResult = applyCommittedSyncFrame(reconstructed.complete);
    if (!completeResult.accepted) {
      return completeResult;
    }
    dropCommittedEventsAtOrBelowCutoff(
      reconstructed.metadata.pageEpoch,
      reconstructed.cutoffCaptureSequence
    );

    for (const observation of [...replayObservations.values()].sort(
      (left, right) => left.captureSequence - right.captureSequence
    )) {
      const key = semanticEventKey(observation);
      const event = retainedEvents.get(key);
      if (event) {
        semanticEvents.set(key, event);
      }
      const replayResult = syncCoordinator.applyLive(observation);
      if (!replayResult.accepted) {
        return { accepted: false, resetConsumerState: false };
      }
    }
    return completeResult;
  }

  function dropCommittedEventsAtOrBelowCutoff(
    pageEpoch: string,
    cutoffCaptureSequence: number
  ): void {
    for (const [key, event] of semanticEvents) {
      if (
        event.topology?.pageEpoch === pageEpoch &&
        (event.topology.captureSequence ?? -1) <= cutoffCaptureSequence
      ) {
        semanticEvents.delete(key);
      }
    }
    for (const [key, event] of retainedSemanticEvents) {
      if (
        event.topology?.pageEpoch === pageEpoch &&
        (event.topology.captureSequence ?? -1) <= cutoffCaptureSequence
      ) {
        retainedSemanticEvents.delete(key);
      }
    }
  }

  function ingestCommittedEvidence(
    evidence: CommittedEvidence | readonly CommittedEvidence[]
  ): TopologyProjectionResult {
    const entries = Array.isArray(evidence) ? evidence : [evidence];
    let resetConsumerState = false;

    for (const entry of entries) {
      const result = ingestCommittedEvidenceEntry(entry);
      if (!result.accepted) {
        return {
          accepted: false,
          resetConsumerState: resetConsumerState || result.resetConsumerState
        };
      }
      resetConsumerState ||= result.resetConsumerState;
    }

    return { accepted: true, resetConsumerState };
  }

  function ingestCommittedEvidenceEntry(
    entry: CommittedEvidence
  ): TopologyProjectionResult {
    if (isTopologyCheckpointEvidenceCandidate(entry.candidate)) {
      return applyCommittedCheckpoint(entry.candidate);
    }
    if (entry.candidate.topology) {
      return ingestCommittedTopologyEvent(entry.candidate);
    }
    return {
      accepted: applyCommittedHistory(entry.candidate as LightstreamerEventEnvelope),
      resetConsumerState: false
    };
  }

  function replaceHistory(events: readonly LightstreamerEventEnvelope[]): void {
    sensitiveStructureRevision += 1;
    legacyIndex.clear();
    if (!semanticActive) {
      legacyLiveFallbackIndex.clear();
    }
    for (const event of events) {
      legacyIndex.ingest(event);
      if (!semanticActive) {
        legacyLiveFallbackIndex.ingest(event);
      }
    }
    invalidateMaterializedState();
  }

  function applySyncFrame(frame: TopologySyncFrame): TopologyProjectionResult {
    const result = stageSyncFrame(frame);
    if (!result.accepted || !result.candidate) {
      return result;
    }
    return { ...result, candidate: result.candidate };
  }

  function stageSyncFrame(frame: TopologySyncFrame): TopologyProjectionResult {
    const reject = (reason: string): TopologyProjectionResult => {
      stagedSyncStatus = { state: "partial", retry: true, reason };
      return { accepted: false, resetConsumerState: false };
    };

    if (frame.type === TOPOLOGY_SYNC_BEGIN) {
      if (stagedSync) {
        return sameSyncFrame(stagedSync.frames[0], frame)
          ? { accepted: true, resetConsumerState: false }
          : reject("conflicting-stage");
      }
      stagedSync = {
        metadata: frame,
        frames: [frame],
        observations: new Map()
      };
      stagedSyncStatus = { state: "staging", retry: false, coverage: frame.coverage };
      coverage = frame.coverage;
      return { accepted: true, resetConsumerState: false };
    }

    if (!stagedSync || !sameSyncMetadata(stagedSync.metadata, frame)) {
      return reject(
        frame.type === TOPOLOGY_SYNC_CHUNK
          ? "unknown-or-conflicting-chunk"
          : "unknown-or-conflicting-complete"
      );
    }

    if (frame.type === TOPOLOGY_SYNC_CHUNK) {
      const previous = stagedSync.frames.find(
        (candidate) =>
          candidate.type === TOPOLOGY_SYNC_CHUNK &&
          candidate.chunkIndex === frame.chunkIndex
      );
      if (previous) {
        return sameSyncFrame(previous, frame)
          ? { accepted: true, resetConsumerState: false }
          : reject("conflicting-duplicate-chunk");
      }
      stagedSync.frames.push(frame);
      return { accepted: true, resetConsumerState: false };
    }

    const previousComplete = stagedSync.frames.find(
      (candidate) => candidate.type === TOPOLOGY_SYNC_COMPLETE
    );
    if (previousComplete) {
      return sameSyncFrame(previousComplete, frame)
        ? { accepted: true, resetConsumerState: false }
        : reject("conflicting-completed-sync");
    }

    stagedSync.frames.push(frame);
    const encoded = createTopologyCheckpointEvidenceCandidate(
      stagedSync.frames,
      [...stagedSync.observations.values()]
    );
    stagedSync = undefined;
    if (!encoded.ok) {
      stagedSyncStatus = {
        state: "partial",
        retry: true,
        reason: encoded.rejection.code,
        coverage: frame.coverage
      };
      return { accepted: false, resetConsumerState: false };
    }

    stagedSyncStatus = {
      state: frame.coverage.status === "partial" ? "partial" : "complete",
      retry: frame.coverage.status === "partial",
      ...(frame.coverage.status === "partial" ? { coverage: frame.coverage } : {})
    };
    coverage = frame.coverage;
    return {
      accepted: true,
      resetConsumerState: false,
      candidate: encoded.value
    };
  }

  function applyCommittedSyncFrame(frame: TopologySyncFrame): TopologyProjectionResult {
    sensitiveStructureRevision += 1;
    const activation = activatePage(frame.pageEpoch);
    if (!activation.accepted) {
      return activation;
    }
    coverage = frame.coverage;
    if (frame.type === TOPOLOGY_SYNC_BEGIN) {
      rememberHistory(snapshotPanelTopologyState(syncCoordinator.snapshot()));
      const result = syncCoordinator.begin(frame);
      if (!result.accepted) {
        return { accepted: false, resetConsumerState: activation.resetConsumerState };
      }
      if (result.duplicate) {
        return {
          accepted: true,
          resetConsumerState: activation.resetConsumerState,
          duplicate: true
        };
      }
    } else if (frame.type === TOPOLOGY_SYNC_CHUNK) {
      const result = syncCoordinator.acceptChunk(frame);
      if (!result.accepted) {
        return { accepted: false, resetConsumerState: activation.resetConsumerState };
      }
    } else {
      const result = syncCoordinator.complete(frame);
      if (!result.accepted) {
        return { accepted: false, resetConsumerState: activation.resetConsumerState };
      }
      if (syncCoordinator.status().state !== "partial") {
        for (const [key, event] of semanticEvents) {
          if (
            event.topology?.pageEpoch === frame.pageEpoch &&
            event.topology.captureSequence <= frame.cutoffCaptureSequence
          ) {
            semanticEvents.delete(key);
          }
        }
      }
    }
    if (syncCoordinator.status().state === "partial") {
      replayRetainedEvents(frame.pageEpoch);
    }
    invalidateMaterializedState();
    return activation;
  }

  function replayRetainedEvents(pageEpoch: string): void {
    const retained = [...semanticEvents.values()]
      .filter((event) => event.topology?.pageEpoch === pageEpoch)
      .sort(
        (left, right) =>
          (left.topology?.captureSequence ?? 0) -
          (right.topology?.captureSequence ?? 0)
      );
    for (const event of retained) {
      if (event.topology) {
        syncCoordinator.applyLive(event.topology);
      }
    }
  }

  function activeIndex(): TopologyStateIndex {
    return semanticActive ? syncCoordinator.snapshot() : legacyIndex;
  }

  function currentMaterializedState(): TopologyState {
    if (!materializedStateDirty && materializedState) {
      return materializedState;
    }
    const activeState = snapshotPanelTopologyState(activeIndex());
    let selectedState = activeState;
    usingLegacyLiveFallback = false;
    if (semanticActive) {
      const fallbackState = legacyLiveFallbackIndex.snapshot();
      usingLegacyLiveFallback = fallbackPreservesAndExtendsStructure(
        activeState,
        fallbackState
      );
      if (usingLegacyLiveFallback) selectedState = fallbackState;
    }
    materializedState = mergePreservedHistory(selectedState);
    if (materializedScopeStructureDirty) {
      const nextStructureKeys = [...topologyStructuralKeys(materializedState, false)];
      if (!sameOrderedKeys(materializedScopeStructureKeys, nextStructureKeys)) {
        scopeStructureRevision += 1;
      }
      materializedScopeStructureKeys = nextStructureKeys;
      materializedScopeStructureDirty = false;
    }
    materializedStateDirty = false;
    return materializedState;
  }

  function rememberHistory(state: TopologyState): void {
    for (const client of state.clients) {
      const historicalSessions = client.sessions.filter((session) => session.historical);
      if (historicalSessions.length === 0) continue;
      const previous = preservedHistory.get(client.id);
      const sessions = new Map(
        previous?.sessions.map((session) => [session.key, session]) ?? []
      );
      for (const session of historicalSessions) {
        sessions.set(session.key, session);
      }
      preservedHistory.set(client.id, {
        ...client,
        waitingSubscriptions: [],
        sessions: [...sessions.values()]
          .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
          .slice(0, 5)
      });
    }
  }

  function mergePreservedHistory(state: TopologyState): TopologyState {
    if (!semanticActive || preservedHistory.size === 0) {
      return state;
    }
    const clients = new Map(state.clients.map((client) => [client.id, client]));
    for (const [clientId, historicalClient] of preservedHistory) {
      const current = clients.get(clientId);
      if (!current) {
        clients.set(clientId, historicalClient);
        continue;
      }
      const sessions = new Map(current.sessions.map((session) => [session.key, session]));
      for (const session of historicalClient.sessions) {
        if (!sessions.has(session.key)) sessions.set(session.key, session);
      }
      clients.set(clientId, { ...current, sessions: [...sessions.values()] });
    }
    const mergedClients = [...clients.values()];
    return {
      ...state,
      clients: mergedClients,
      clientCount: mergedClients.length,
      historicalSessionCount: mergedClients
        .flatMap((client) => client.sessions)
        .filter((session) => session.historical).length
    };
  }

  function resetSemanticProjection(): void {
    generation += 1;
    syncCoordinator = createTopologySyncCoordinator(
      `panel:legacy:${generation}`,
      syncAdapter
    );
    stagedSync = undefined;
    stagedSyncStatus = { state: "idle", retry: false };
    semanticActive = false;
    coverage = null;
    semanticEvents.clear();
    retainedSemanticEvents.clear();
    retiredPageEpochs.clear();
    preservedHistory.clear();
    staleSemanticEventIds.clear();
    retainedSemanticEventIds.clear();
    legacyLiveFallbackIndex.clear();
    usingLegacyLiveFallback = false;
    invalidateMaterializedState();
  }

  return {
    replaceHistory,
    applySyncFrame,
    ingestCommittedEvidence,

    snapshot() {
      return currentMaterializedState();
    },

    scopeStructureRevision() {
      currentMaterializedState();
      return scopeStructureRevision;
    },

    sensitiveStructureRevision() {
      return sensitiveStructureRevision;
    },

    status() {
      currentMaterializedState();
      if (usingLegacyLiveFallback) {
        return {
          semanticActive: false,
          syncState: "legacy",
          coverage: null
        };
      }
      return {
        semanticActive,
        syncState: semanticActive
          ? syncCoordinator.status().state
          : stagedSyncStatus.state === "idle"
            ? "legacy"
            : stagedSyncStatus.state,
        coverage
      };
    },

    resetCurrentObservations() {
      resetPanelTopologyObservations(activeIndex());
      legacyLiveFallbackIndex.resetCurrentObservations();
      invalidateMaterializedState();
    },

    clearHistory() {
      sensitiveStructureRevision += 1;
      activeIndex().clearHistory();
      legacyLiveFallbackIndex.clearHistory();
      preservedHistory.clear();
      invalidateMaterializedState();
    },

    clear() {
      sensitiveStructureRevision += 1;
      legacyIndex.clear();
      resetSemanticProjection();
    }
  };
}

type CommittedCheckpointMetadata = TopologySyncMetadata & {
  chunkCount: number;
  recordCount: number;
};

type ReconstructedCommittedCheckpoint = {
  metadata: CommittedCheckpointMetadata;
  begin: TopologySyncFrame;
  chunks: TopologySyncChunkFrame[];
  complete: TopologySyncCompleteFrame;
  cutoffCaptureSequence: number;
  observations: TopologyObservation[];
};

function reconstructCheckpointFrames(
  evidence: TopologyCheckpointEvidenceCandidate
): ReconstructedCommittedCheckpoint | null {
  const checkpoint = evidence.checkpoint;
  if (!isRecord(checkpoint)) {
    return null;
  }

  const pageEpoch =
    stringValue(checkpoint.pageEpoch) ??
    derivePageEpochFromRecords(checkpoint.records);
  if (!pageEpoch) {
    return null;
  }

  const records = parseAbsoluteRecords(checkpoint.records);
  if (records === null) {
    return null;
  }

  const syncId = stringValue(checkpoint.syncId) ?? evidence.id;
  const panelSessionId = stringValue(checkpoint.panelSessionId) ?? `topology-checkpoint:${syncId}`;
  const cutoffCaptureSequence =
    intValue(checkpoint.cutoffCaptureSequence) ??
    Math.max(0, ...records.map((record) => record.captureSequence));
  if (cutoffCaptureSequence < 0) {
    return null;
  }

  const observations = parseCheckpointObservations(
    checkpoint.observations,
    pageEpoch,
    cutoffCaptureSequence
  );
  if (!observations) {
    return null;
  }

  const coverage = parseCoverage(checkpoint.coverage) ?? DEFAULT_COVERAGE;
  const chunkedRecords = chunkAbsoluteRecords(records);
  const recordCount = records.length;
  const chunkCount = chunkedRecords.length;

  const metadata: CommittedCheckpointMetadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    panelSessionId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount,
    recordCount,
    coverage
  };

  return {
    metadata,
    cutoffCaptureSequence,
    begin: {
      type: TOPOLOGY_SYNC_BEGIN,
      ...metadata
    },
    chunks: chunkedRecords.map((records, chunkIndex) => ({
      type: TOPOLOGY_SYNC_CHUNK,
      ...metadata,
      chunkIndex,
      records
    })),
    complete: {
      type: TOPOLOGY_SYNC_COMPLETE,
      ...metadata,
      ...(checkpoint.reason === "limit-exceeded" || checkpoint.reason === "serialization-failed"
        ? { reason: checkpoint.reason }
        : {})
    },
    observations
  };
}

function chunkAbsoluteRecords(records: readonly TopologyAbsoluteRecord[]): TopologyAbsoluteRecord[][] {
  if (records.length === 0) {
    return [];
  }
  const chunks: TopologyAbsoluteRecord[][] = [];
  for (let start = 0; start < records.length; start += TOPOLOGY_SYNC_LIMITS.maxRecords) {
    chunks.push(records.slice(start, start + TOPOLOGY_SYNC_LIMITS.maxRecords));
  }
  return chunks;
}

function derivePageEpochFromRecords(records: unknown): string | null {
  const entries =
    records === undefined || !Array.isArray(records)
      ? []
      : records.filter(isRecord).filter((record) =>
          typeof record.pageEpoch === "string" && record.pageEpoch.length > 0
        )
      ;
  const firstEpoch = entries.at(0)?.pageEpoch;
  return typeof firstEpoch === "string" && firstEpoch.length > 0 ? firstEpoch : null;
}

function parseAbsoluteRecords(
  rawRecords: unknown
): TopologyAbsoluteRecord[] | null {
  if (!Array.isArray(rawRecords)) {
    return null;
  }
  const records: TopologyAbsoluteRecord[] = [];
  for (const rawRecord of rawRecords) {
    if (!isTopologyAbsoluteRecord(rawRecord)) {
      return null;
    }
    records.push(rawRecord);
  }
  return records;
}

function parseCheckpointObservations(
  rawObservations: unknown,
  pageEpoch: string,
  cutoffCaptureSequence: number
): TopologyObservation[] | null {
  if (rawObservations === undefined) {
    return [];
  }
  if (!Array.isArray(rawObservations)) {
    return null;
  }

  const observations: TopologyObservation[] = [];
  const captureSequences = new Set<number>();
  for (const rawObservation of rawObservations) {
    if (
      !isTopologyObservation(rawObservation) ||
      rawObservation.pageEpoch !== pageEpoch ||
      rawObservation.captureSequence <= cutoffCaptureSequence ||
      captureSequences.has(rawObservation.captureSequence)
    ) {
      return null;
    }
    captureSequences.add(rawObservation.captureSequence);
    observations.push(rawObservation);
  }
  return observations.sort((left, right) => left.captureSequence - right.captureSequence);
}

function isTopologyAbsoluteRecord(
  value: unknown
): value is TopologyAbsoluteRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.kind === "string" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.pageEpoch === "string" &&
    value.pageEpoch.length > 0 &&
    typeof value.captureSequence === "number" &&
    Number.isSafeInteger(value.captureSequence) &&
    value.captureSequence >= 0
  );
}

function isTopologyCheckpointEvidenceCandidate(
  candidate: TopologyCheckpointEvidenceCandidate | LightstreamerEventEnvelope
): candidate is TopologyCheckpointEvidenceCandidate {
  return candidate.kind === "topology-checkpoint";
}

function parseCoverage(value: unknown): TopologyCoverage | null {
  if (!isRecord(value)) {
    return null;
  }
  const getters =
    isRecord(value.getters) ?
      value.getters
    : null;
  if (!getters) {
    return null;
  }
  const status = stringValue(value.status);
  if (status !== "complete" && status !== "partial") {
    return null;
  }
  return {
    status,
    getters: Object.fromEntries(
      Object.entries(getters).filter(([, reason]) =>
        isTopologyGetterCoverage(reason)
      ) as Array<[string, TopologyGetterCoverage]>
    ),
    ...(typeof value.reason === "string" && isTopologyCoverageReason(value.reason)
      ? { reason: value.reason }
      : {}),
    ...(typeof value.context === "string" ? { context: value.context } : {})
  };
}

function isTopologyCoverageReason(value: unknown): value is TopologyCoverageReason {
  return value === "getter-missing" ||
    value === "getter-threw" ||
    value === "late-attachment" ||
    value === "unsupported-shape" ||
    value === "out-of-scope-frame" ||
    value === "limit-exceeded" ||
    value === "sanitization-failed";
}

function isTopologyGetterCoverage(value: unknown): value is TopologyGetterCoverage {
  return value === "available" || value === "missing" || value === "threw";
}

function intValue(candidate: unknown): number | null {
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : null;
}

function stringValue(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

function sameSyncFrame(left: TopologySyncFrame, right: TopologySyncFrame): boolean {
  return (
    left.type === right.type &&
    left.syncId === right.syncId &&
    left.panelSessionId === right.panelSessionId &&
    left.pageEpoch === right.pageEpoch &&
    left.cutoffCaptureSequence === right.cutoffCaptureSequence &&
    left.chunkCount === right.chunkCount &&
    left.recordCount === right.recordCount &&
    JSON.stringify(left.coverage) === JSON.stringify(right.coverage) &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

function sameSyncMetadata(left: TopologySyncFrame, right: TopologySyncFrame): boolean {
  return (
    left.syncId === right.syncId &&
    left.panelSessionId === right.panelSessionId &&
    left.pageEpoch === right.pageEpoch &&
    left.cutoffCaptureSequence === right.cutoffCaptureSequence &&
    left.chunkCount === right.chunkCount &&
    left.recordCount === right.recordCount &&
    JSON.stringify(left.coverage) === JSON.stringify(right.coverage)
  );
}

function fallbackPreservesAndExtendsStructure(
  semanticState: TopologyState,
  fallbackState: TopologyState
): boolean {
  const semanticKeys = topologyStructuralKeys(semanticState);
  const fallbackKeys = topologyStructuralKeys(fallbackState);
  return (
    fallbackKeys.size > semanticKeys.size &&
    [...semanticKeys].every((key) => fallbackKeys.has(key))
  );
}

function topologyStructuralKeys(
  state: TopologyState,
  includeNonScopeNodes = true
): Set<string> {
  const keys = new Set<string>();
  const addSubscription = (
    client: TopologyClient | null,
    session: TopologyClient["sessions"][number] | null,
    subscription: TopologyState["unassignedSubscriptions"][number]
  ): void => {
    keys.add(topologySubscriptionKey(client, session, subscription));
    for (const item of subscription.items) {
      keys.add(topologyItemKey(client, session, subscription, item));
      for (const listenerId of item.listenerIds) {
        keys.add(
          topologyListenerKey(client, session, subscription, item, listenerId)
        );
      }
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        keys.add(
          topologyListenerKey(client, session, subscription, null, listenerId)
        );
      }
    }
    if (includeNonScopeNodes) {
      for (const generation of subscription.commandGenerations) {
        keys.add(
          topologyCommandGenerationKey(client, session, subscription, generation)
        );
        for (const child of generation.inferredChildren) {
          keys.add(
            topologyInferredChildKey(
              client,
              session,
              subscription,
              generation,
              child
            )
          );
        }
      }
    }
  };

  for (const client of state.clients) {
    keys.add(topologyClientKey(client));
    for (const subscription of client.waitingSubscriptions) {
      addSubscription(client, null, subscription);
    }
    for (const session of client.sessions) {
      keys.add(topologySessionKey(client, session));
      for (const subscription of session.subscriptions) {
        addSubscription(client, session, subscription);
      }
    }
  }
  for (const subscription of state.unassignedSubscriptions) {
    addSubscription(null, null, subscription);
  }
  return keys;
}

/**
 * Item updates are the topology hot path. They cannot change Scope membership
 * when every referenced owner is already present at the exact active path and
 * the listener is already attached to the item. Unknown or partial ownership
 * remains structural so this optimization can never hide a new Scope node.
 */
function eventMayChangeScopeStructure(
  event: LightstreamerEventEnvelope,
  state: TopologyState | null
): boolean {
  if (event.kind !== "item-update" || !state) return true;

  const clientId = event.client?.id;
  const sessionId = event.client?.sessionId;
  const subscriptionId = event.subscription?.id;
  if (!clientId || !sessionId || !subscriptionId) return true;

  const client = state.clients.find((candidate) => candidate.id === clientId);
  const session = client?.sessions.find(
    (candidate) =>
      candidate.id === sessionId && candidate.active && !candidate.historical
  );
  const subscription = session?.subscriptions.find(
    (candidate) =>
      candidate.id === subscriptionId &&
      candidate.active &&
      candidate.serverEstablished
  );
  if (!subscription) return true;

  const configuredItems = event.subscription?.items;
  if (
    configuredItems &&
    !sameOrderedKeys(subscription.configuredItems ?? [], configuredItems)
  ) {
    return true;
  }

  const itemName = event.item?.name;
  const itemPosition = event.item?.position;
  if (itemName === undefined && itemPosition === undefined) {
    return event.listener?.id
      ? !subscription.listeners.some(
          (listener) => listener.id === event.listener?.id
        )
      : false;
  }
  const item = subscription.items.find(
    (candidate) =>
      (itemName === undefined || candidate.name === itemName) &&
      (itemPosition === undefined || candidate.position === itemPosition)
  );
  if (!item) return true;

  const listenerId = event.listener?.id;
  return listenerId
    ? !subscription.listeners.some((listener) => listener.id === listenerId) ||
        !item.listenerIds.includes(listenerId)
    : false;
}

function eventMayChangeSensitiveStructure(
  event: LightstreamerEventEnvelope,
  scopeStructureMayHaveChanged: boolean
): boolean {
  if (scopeStructureMayHaveChanged) return true;
  const subscription = event.subscription;
  return Boolean(
    event.client?.serverAddress !== undefined ||
    event.client?.serverInstanceAddress !== undefined ||
    event.client?.clientIp !== undefined ||
    subscription?.fields ||
    subscription?.fieldSchema !== undefined ||
    subscription?.commandSecondLevelFields ||
    subscription?.commandSecondLevelFieldSchema !== undefined ||
    event.update?.command ||
    event.update?.key
  );
}

function semanticEventKey(
  observation: Pick<TopologyObservation, "pageEpoch" | "captureSequence">
): string {
  return `${observation.pageEpoch}:${observation.captureSequence}`;
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function sameOrderedKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function trimSet<T>(set: Set<T>, limit: number): void {
  while (set.size > limit) {
    const oldest = set.values().next().value as T | undefined;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}
