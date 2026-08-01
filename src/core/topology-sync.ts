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

export type TopologySyncResult =
  | { accepted: true; duplicate?: true }
  | { accepted: false; reason: string };

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
  const completed = new Map<string, { begin: string; complete: string }>();

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
    if (frame.reason !== undefined) {
      const reason = frame.reason;
      const partialStage = stage;
      stage = undefined;
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
      completed.set(frame.syncId, {
        begin: stableFingerprint(partialStage.metadata),
        complete: stableFingerprint(frame)
      });
      trimMap(completed, 128);
      syncStatus = {
        state: "partial",
        retry: true,
        reason,
        ...(frame.coverage.status === "partial"
          ? { coverage: cloneCoverage(frame.coverage) }
          : {})
      };
      return { accepted: true };
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
    try {
      replacement = adapter.hydrate(activePageEpoch, records);
      const tail = [...stage.live.values()]
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
      complete: stableFingerprint(frame)
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
    return { accepted: true };
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
    begin.pageEpoch === frame.pageEpoch &&
    begin.cutoffCaptureSequence === frame.cutoffCaptureSequence &&
    begin.chunkCount === frame.chunkCount &&
    begin.recordCount === frame.recordCount &&
    stableFingerprint(begin.coverage) === stableFingerprint(frame.coverage)
  );
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
      case "establishment":
      case "listener-attachment":
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
