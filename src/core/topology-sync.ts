import {
  TOPOLOGY_SYNC_LIMITS,
  topologySyncUtf8Bytes,
  type TopologyAbsoluteRecord,
  type TopologyCoverage,
  type TopologyObservation,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame
} from "../bridge/messages";
import type { TopologyCheckpointEvidenceCandidate } from "./event-history-authoritative";

export type TopologySyncResult =
  | { accepted: true; duplicate?: true; candidate?: TopologyCheckpointEvidenceCandidate }
  | { accepted: false; reason: string; candidate?: undefined };

export type TopologySyncStatus = {
  state: "idle" | "staging" | "complete" | "partial" | "retired";
  retry: boolean;
  reason?: string;
  coverage?: TopologyCoverage;
};

export type TopologySynchronizedState = {
  pageEpoch: string;
  records: readonly TopologyAbsoluteRecord[];
  observations: readonly TopologyObservation[];
};

/** Adapter seam for projecting an absolute checkpoint plus semantic live tail. */
export type TopologySyncAdapter<T> = {
  empty(pageEpoch: string): T;
  hydrate(pageEpoch: string, records: readonly TopologyAbsoluteRecord[]): T;
  applyLive(current: T, observation: TopologyObservation): T;
};

export type TopologySyncCoordinator<T> = {
  begin(frame: TopologySyncBeginFrame): TopologySyncResult;
  acceptChunk(frame: TopologySyncChunkFrame): TopologySyncResult;
  complete(frame: TopologySyncCompleteFrame): TopologySyncResult;
  applyLive(observation: TopologyObservation): TopologySyncResult;
  retirePageEpoch(nextPageEpoch: string): void;
  pageEpoch(): string;
  status(): TopologySyncStatus;
  snapshot(): T;
};

type Stage = {
  metadata: TopologySyncBeginFrame;
  chunks: Map<number, readonly TopologyAbsoluteRecord[]>;
  stagedBytes: number;
  live: Map<number, { fingerprint: string; observation: TopologyObservation }>;
};

const defaultAdapter: TopologySyncAdapter<TopologySynchronizedState> = {
  empty(pageEpoch) {
    return { pageEpoch, records: [], observations: [] };
  },
  hydrate(pageEpoch, records) {
    return { pageEpoch, records: [...records], observations: [] };
  },
  applyLive(current, observation) {
    return { ...current, observations: [...current.observations, observation] };
  }
};

export function createTopologySyncCoordinator(
  initialPageEpoch: string
): TopologySyncCoordinator<TopologySynchronizedState>;
export function createTopologySyncCoordinator<T>(
  initialPageEpoch: string,
  adapter: TopologySyncAdapter<T>
): TopologySyncCoordinator<T>;
export function createTopologySyncCoordinator<T>(
  initialPageEpoch: string,
  adapter: TopologySyncAdapter<T> = defaultAdapter as TopologySyncAdapter<T>
): TopologySyncCoordinator<T> {
  let activePageEpoch = initialPageEpoch;
  let current = adapter.empty(activePageEpoch);
  let stage: Stage | undefined;
  let syncStatus: TopologySyncStatus = { state: "idle", retry: false };
  let acceptedCutoff: number | null = null;
  const appliedLive = new Map<number, string>();
  const completed = new Map<
    string,
    Readonly<{
      begin: string;
      complete: string;
      candidate: TopologyCheckpointEvidenceCandidate;
    }>
  >();

  function reject(reason: string): TopologySyncResult {
    return { accepted: false, reason };
  }

  function drainLive(failedStage: Stage): string | undefined {
    for (const [sequence, entry] of [...failedStage.live.entries()].sort(
      ([left], [right]) => left - right
    )) {
      const previous = appliedLive.get(sequence);
      if (previous !== undefined) {
        if (previous !== entry.fingerprint) {
          return "conflicting-live-sequence";
        }
        continue;
      }
      try {
        current = adapter.applyLive(current, entry.observation);
      } catch {
        return "live-tail-apply-failed";
      }
      appliedLive.set(sequence, entry.fingerprint);
    }
    trimMap(appliedLive, TOPOLOGY_SYNC_LIMITS.maxBufferedLive);
    return undefined;
  }

  function abortStage(reason: string): TopologySyncResult {
    const failedStage = stage;
    stage = undefined;
    const finalReason = failedStage ? drainLive(failedStage) ?? reason : reason;
    syncStatus = {
      state: "partial",
      retry: true,
      reason: finalReason,
      ...(failedStage?.metadata.coverage.status === "partial"
        ? { coverage: cloneCoverage(failedStage.metadata.coverage) }
        : {})
    };
    return { accepted: false, reason: finalReason };
  }

  function begin(frame: TopologySyncBeginFrame): TopologySyncResult {
    if (frame.pageEpoch !== activePageEpoch) {
      return { accepted: false, reason: "stale-page-epoch" };
    }
    if (
      acceptedCutoff !== null &&
      frame.cutoffCaptureSequence < acceptedCutoff
    ) {
      return reject("stale-checkpoint");
    }
    const fingerprint = stableFingerprint(frame);
    const prior = completed.get(frame.syncId);
    if (prior) {
      return prior.begin === fingerprint
        ? { accepted: true, duplicate: true }
        : reject("conflicting-completed-sync");
    }
    if (stage) {
      return stage.metadata.syncId === frame.syncId &&
        stableFingerprint(stage.metadata) === fingerprint
        ? { accepted: true, duplicate: true }
        : reject("conflicting-stage");
    }
    stage = {
      metadata: frame,
      chunks: new Map(),
      stagedBytes: 0,
      live: new Map()
    };
    syncStatus = { state: "staging", retry: false };
    return { accepted: true };
  }

  function acceptChunk(frame: TopologySyncChunkFrame): TopologySyncResult {
    if (!stage || !sameMetadata(stage.metadata, frame)) {
      return reject("unknown-or-conflicting-chunk");
    }
    const frameBytes = topologySyncUtf8Bytes(frame);
    if (
      !Number.isFinite(frameBytes) ||
      frameBytes > TOPOLOGY_SYNC_LIMITS.maxStagedBytes ||
      stage.stagedBytes + frameBytes > TOPOLOGY_SYNC_LIMITS.maxStagedBytes
    ) {
      return abortStage("staged-byte-limit");
    }
    const previous = stage.chunks.get(frame.chunkIndex);
    if (previous) {
      return stableFingerprint(previous) === stableFingerprint(frame.records)
        ? { accepted: true, duplicate: true }
        : reject("conflicting-duplicate-chunk");
    }
    const stagedRecordCount = [...stage.chunks.values()].reduce(
      (count, records) => count + records.length,
      frame.records.length
    );
    if (
      stage.chunks.size >= TOPOLOGY_SYNC_LIMITS.maxChunks ||
      stagedRecordCount > TOPOLOGY_SYNC_LIMITS.maxRecords
    ) {
      return abortStage("staging-limit");
    }
    stage.chunks.set(frame.chunkIndex, [...frame.records]);
    stage.stagedBytes += frameBytes;
    return { accepted: true };
  }

  function complete(frame: TopologySyncCompleteFrame): TopologySyncResult {
    const prior = completed.get(frame.syncId);
    if (prior) {
      return prior.complete === stableFingerprint(frame)
        ? { accepted: true, duplicate: true }
        : { accepted: false, reason: "conflicting-completed-sync" };
    }
    if (!stage || !sameMetadata(stage.metadata, frame)) {
      return reject("unknown-or-conflicting-complete");
    }
    const partialReason =
      frame.reason ?? (frame.coverage.status === "partial" ? frame.coverage.reason : undefined);
    const isPartialCheckpoint =
      partialReason !== undefined || frame.coverage.status === "partial";

    if (isPartialCheckpoint) {
      const partialStage = stage;
      if (!partialStage) {
        return reject("unknown-or-conflicting-complete");
      }
      stage = undefined;
      const observations = [...partialStage.live.values()]
        .map(({ observation }) => observation)
        .sort((left, right) => left.captureSequence - right.captureSequence);
      const liveError = drainLive(partialStage);
      if (liveError) {
        syncStatus = {
          state: "partial",
          retry: true,
          reason: liveError,
          ...(frame.coverage.status === "partial"
            ? { coverage: cloneCoverage(frame.coverage) }
            : {})
        };
        return { accepted: false, reason: liveError };
      }

      if (partialStage.chunks.size !== partialStage.metadata.chunkCount) {
        return abortStage("missing-chunks");
      }
      const partialRecords = [...partialStage.chunks.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([, records]) => records);
      if (partialRecords.length !== partialStage.metadata.recordCount) {
        return abortStage("record-count-mismatch");
      }
      if (!isValidAbsoluteRecordSet(partialRecords, activePageEpoch, partialStage.metadata.cutoffCaptureSequence)) {
        return abortStage("invalid-record-set");
      }
      let replacement: T;
      try {
        replacement = adapter.hydrate(activePageEpoch, partialRecords);
        for (const observation of observations) {
          replacement = adapter.applyLive(replacement, observation);
        }
      } catch {
        return abortStage("invalid-record-set");
      }

      current = replacement;
      acceptedCutoff =
        acceptedCutoff === null
          ? partialStage.metadata.cutoffCaptureSequence
          : Math.max(acceptedCutoff, partialStage.metadata.cutoffCaptureSequence);
      appliedLive.clear();
      for (const [sequence, entry] of partialStage.live) {
        appliedLive.set(sequence, entry.fingerprint);
      }
      const candidate = buildTopologyCheckpointCandidate(
        frame,
        partialRecords,
        observations
      );
      completed.set(frame.syncId, {
        begin: stableFingerprint(partialStage.metadata),
        complete: stableFingerprint(frame),
        candidate
      });
      trimMap(completed, 128);
      syncStatus = {
        state: "partial",
        retry: true,
        ...(partialReason !== undefined ? { reason: partialReason } : {}),
        ...(frame.coverage.status === "partial"
          ? { coverage: cloneCoverage(frame.coverage) }
          : {})
      };
      return { accepted: true, candidate };
    }

    if (stage.chunks.size !== stage.metadata.chunkCount) {
      return abortStage("missing-chunks");
    }
    const records = [...stage.chunks.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, entries]) => entries);
    if (records.length !== stage.metadata.recordCount) {
      return abortStage("record-count-mismatch");
    }
    if (!isValidAbsoluteRecordSet(records, activePageEpoch, stage.metadata.cutoffCaptureSequence)) {
      return abortStage("invalid-record-set");
    }

    let replacement: T;
    let tail: TopologyObservation[] = [];
    try {
      replacement = adapter.hydrate(activePageEpoch, records);
      tail = [...stage.live.values()]
        .map(({ observation }) => observation)
        .sort((left, right) => left.captureSequence - right.captureSequence);
      for (const observation of tail) {
        replacement = adapter.applyLive(replacement, observation);
      }
    } catch {
      return abortStage("invalid-record-set");
    }

    const completedBegin = stableFingerprint(stage.metadata);
    current = replacement;
    const candidate = buildTopologyCheckpointCandidate(frame, records, tail);
    acceptedCutoff =
      acceptedCutoff === null
        ? stage.metadata.cutoffCaptureSequence
        : Math.max(acceptedCutoff, stage.metadata.cutoffCaptureSequence);
    appliedLive.clear();
    for (const [sequence, entry] of stage.live) {
      appliedLive.set(sequence, entry.fingerprint);
    }
    completed.set(frame.syncId, {
      begin: completedBegin,
      complete: stableFingerprint(frame),
      candidate
    });
    trimMap(completed, 128);
    stage = undefined;
    syncStatus = {
      state: "complete",
      retry: false,
      ...(frame.coverage.status === "partial"
        ? { coverage: cloneCoverage(frame.coverage) }
        : {})
    };
    return { accepted: true, candidate };
  }

  function applyLive(observation: TopologyObservation): TopologySyncResult {
    if (observation.pageEpoch !== activePageEpoch) {
      return { accepted: false, reason: "stale-page-epoch" };
    }
    if (acceptedCutoff !== null && observation.captureSequence <= acceptedCutoff) {
      return { accepted: true, duplicate: true };
    }
    if (stage && observation.captureSequence <= stage.metadata.cutoffCaptureSequence) {
      return { accepted: true, duplicate: true };
    }
    const fingerprint = stableFingerprint(observation);
    const target = stage ? stage.live : appliedLive;
    const previous = target.get(observation.captureSequence);
    const previousFingerprint = typeof previous === "string" ? previous : previous?.fingerprint;
    if (previousFingerprint !== undefined) {
      return previousFingerprint === fingerprint
        ? { accepted: true, duplicate: true }
        : reject("conflicting-live-sequence");
    }
    if (stage) {
      if (stage.live.size >= TOPOLOGY_SYNC_LIMITS.maxBufferedLive) {
        return abortStage("live-buffer-limit");
      }
      stage.live.set(observation.captureSequence, { fingerprint, observation });
      return { accepted: true };
    }
    current = adapter.applyLive(current, observation);
    appliedLive.set(observation.captureSequence, fingerprint);
    trimMap(appliedLive, TOPOLOGY_SYNC_LIMITS.maxBufferedLive);
    return { accepted: true };
  }

  function retirePageEpoch(nextPageEpoch: string): void {
    if (nextPageEpoch === activePageEpoch) {
      return;
    }
    activePageEpoch = nextPageEpoch;
    current = adapter.empty(nextPageEpoch);
    stage = undefined;
    acceptedCutoff = null;
    appliedLive.clear();
    completed.clear();
    syncStatus = { state: "retired", retry: false };
  }

  return {
    begin,
    acceptChunk,
    complete,
    applyLive,
    retirePageEpoch,
    pageEpoch: () => activePageEpoch,
    status: () => ({
      ...syncStatus,
      ...(syncStatus.coverage
        ? { coverage: cloneCoverage(syncStatus.coverage) }
        : {})
    }),
    snapshot: () => current
  };
}

function sameMetadata(
  begin: TopologySyncBeginFrame,
  frame: TopologySyncChunkFrame | TopologySyncCompleteFrame
): boolean {
  return (
    begin.syncId === frame.syncId &&
    begin.panelSessionId === frame.panelSessionId &&
    begin.pageEpoch === frame.pageEpoch &&
    begin.cutoffCaptureSequence === frame.cutoffCaptureSequence &&
    begin.chunkCount === frame.chunkCount &&
    begin.recordCount === frame.recordCount &&
    stableFingerprint(begin.coverage) === stableFingerprint(frame.coverage)
  );
}

function buildTopologyCheckpointCandidate(
  frame: TopologySyncCompleteFrame,
  records: readonly TopologyAbsoluteRecord[],
  observations: readonly TopologyObservation[]
): TopologyCheckpointEvidenceCandidate {
  const normalizedRecords = normalizeTopologyAbsoluteRecords(records);
  const normalizedObservations = normalizeTopologyObservations(observations);
  const checkpoint = {
    pageEpoch: frame.pageEpoch,
    cutoffCaptureSequence: frame.cutoffCaptureSequence,
    coverage: cloneCoverage(frame.coverage),
    records: normalizedRecords,
    observations: normalizedObservations,
    ...(frame.reason !== undefined ? { reason: frame.reason } : {})
  };
  const acceptedTimestamp = stableHash(checkpoint);
  return deepFreeze({
    kind: "topology-checkpoint",
    id: `topology-checkpoint:${stableFingerprint(frame)}:${acceptedTimestamp}`,
    checkpoint: deepFreeze({
      ...checkpoint,
      acceptedTimestamp
    })
  });
}

function stagedRecords(stage: Stage): TopologyAbsoluteRecord[] {
  return [...stage.chunks.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, entries]) => entries);
}

function normalizeTopologyAbsoluteRecords(
  records: readonly TopologyAbsoluteRecord[]
): readonly TopologyAbsoluteRecord[] {
  return records
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      left.captureSequence === right.captureSequence
        ? left.id.localeCompare(right.id)
        : left.captureSequence - right.captureSequence
    )
    .map((record) => deepFreeze(record));
}

function normalizeTopologyObservations(
  observations: readonly TopologyObservation[]
): readonly TopologyObservation[] {
  return [...observations]
    .sort((left, right) => {
      if (left.captureSequence !== right.captureSequence) {
        return left.captureSequence - right.captureSequence;
      }
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      return String(left.subscription?.id ?? "").localeCompare(String(right.subscription?.id ?? ""));
    })
    .map((observation: TopologyObservation) => ({
      ...observation,
      values: observation.values ? { ...observation.values } : undefined
    }))
    .map((observation: TopologyObservation) => deepFreeze(observation));
}

function isValidAbsoluteRecordSet(
  records: readonly TopologyAbsoluteRecord[],
  pageEpoch: string,
  cutoff: number
): boolean {
  if (records.length === 0) {
    return cutoff === 0;
  }
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.kind}:${record.id}`;
    if (
      record.pageEpoch !== pageEpoch ||
      record.captureSequence > cutoff ||
      identities.has(identity)
    ) {
      return false;
    }
    identities.add(identity);
  }
  const hasParent = (kind: TopologyAbsoluteRecord["kind"], id: string | undefined) =>
    id !== undefined && records.some((record) => record.kind === kind && record.id === id);
  const pageRecords = records.filter((record) => record.kind === "page");
  if (pageRecords.length !== 1 || pageRecords[0].id !== pageEpoch) {
    return false;
  }
  return records.every((record) => {
    switch (record.kind) {
      case "page":
        return record.parentId === undefined;
      case "client":
        return hasParent("page", record.parentId);
      case "session":
        return hasParent("client", record.parentId) && record.clientId === record.parentId;
      case "subscription":
        return (
          hasParent("client", record.parentId) &&
          record.clientId === record.parentId &&
          typeof record.clientActive === "boolean" &&
          typeof record.serverEstablished === "boolean"
        );
      case "listener-attachment":
        return (
          (hasParent("subscription", record.parentId) &&
            record.subscriptionId === record.parentId) ||
          (hasParent("client", record.parentId) &&
            record.clientId === record.parentId &&
            record.subscriptionId === undefined)
        );
      case "establishment":
      case "item":
      case "command-generation":
      case "aggregate":
        return (
          hasParent("subscription", record.parentId) &&
          record.subscriptionId === record.parentId
        );
      case "inferred-child":
        return (
          hasParent("command-generation", record.parentId) &&
          hasParent("subscription", record.subscriptionId)
        );
    }
  });
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function cloneCoverage(coverage: TopologyCoverage): TopologyCoverage {
  return { ...coverage, getters: { ...coverage.getters } };
}

function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    map.delete(map.keys().next().value as K);
  }
}

function stableHash(value: unknown): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(stableFingerprint(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
