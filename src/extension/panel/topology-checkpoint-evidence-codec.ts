import {
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_LIMITS,
  TOPOLOGY_LIMITS,
  TOPOLOGY_SYNC_VERSION,
  isTopologyAbsoluteRecord,
  isTopologyObservation,
  isTopologySyncFrame,
  topologySyncUtf8Bytes,
  type TopologyAbsoluteRecord,
  type TopologyObservation,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame,
  type TopologySyncFrame
} from "../../bridge/messages";
import type { TopologyCheckpointEvidenceCandidate } from "../../core/event-history-authoritative";

export type TopologyCheckpointEvidenceCodecRejectionCode =
  | "INVALID_FRAME"
  | "UNSUPPORTED_FRAME_SEQUENCE"
  | "INVALID_CHECKPOINT"
  | "INVALID_CANDIDATE"
  | "UNSUPPORTED_CANDIDATE";

export type TopologyCheckpointEvidenceCodecRejection = Readonly<{
  code: TopologyCheckpointEvidenceCodecRejectionCode;
}>;

export type TopologyCheckpointEvidenceCodecResult =
  | Readonly<{
      ok: true;
      value: TopologyCheckpointEvidenceCandidate;
    }>
  | Readonly<{
      ok: false;
      rejection: TopologyCheckpointEvidenceCodecRejection;
    }>;

/**
 * Encodes one complete, validated synchronization exchange. The exchange is
 * intentionally represented as frames at this boundary; the journal stores a
 * single authoritative checkpoint candidate instead of staging frames.
 */
export function createTopologyCheckpointEvidenceCandidate(
  frames: readonly unknown[],
  observations: readonly unknown[] = []
): TopologyCheckpointEvidenceCodecResult {
  const validated = validateFrameSequence(frames);
  if (!validated.ok) {
    return validated;
  }
  if (!Array.isArray(observations) || observations.some((value) => !isTopologyObservation(value))) {
    return reject("INVALID_CHECKPOINT");
  }

  const normalizedObservations = normalizeObservations(
    observations as readonly TopologyObservation[],
    validated.value.begin.pageEpoch,
    validated.value.begin.cutoffCaptureSequence
  );
  if (!normalizedObservations) {
    return reject("INVALID_CHECKPOINT");
  }

  const checkpoint = createCheckpoint(
    validated.value.begin,
    validated.value.records,
    normalizedObservations,
    validated.value.complete.reason
  );
  const id = topologyCheckpointEvidenceId(validated.value.begin, checkpoint);
  return {
    ok: true,
    value: deepFreeze({
      kind: "topology-checkpoint",
      id,
      checkpoint
    })
  };
}

/**
 * Decodes only codec-shaped candidates. A null result is deliberately the
 * projection boundary: callers must not attempt to apply any reconstructed
 * frame when validation fails.
 */
export function decodeTopologyCheckpointEvidenceCandidate(
  candidate: unknown
): readonly TopologySyncFrame[] | null {
  const parsed = parseCandidate(candidate);
  if (!parsed) {
    return null;
  }

  const frames = createFrames(
    parsed.syncId,
    parsed.panelSessionId,
    parsed.pageEpoch,
    parsed.cutoffCaptureSequence,
    parsed.coverage,
    parsed.records,
    parsed.reason
  );
  const encoded = createTopologyCheckpointEvidenceCandidate(frames, parsed.observations);
  if (!encoded.ok || encoded.value.id !== parsed.id) {
    return null;
  }
  return frames;
}

type ValidatedFrameSequence = Readonly<{
  begin: TopologySyncBeginFrame;
  complete: TopologySyncCompleteFrame;
  records: readonly TopologyAbsoluteRecord[];
}>;

type FrameValidationResult =
  | Readonly<{ ok: true; value: ValidatedFrameSequence }>
  | Readonly<{ ok: false; rejection: TopologyCheckpointEvidenceCodecRejection }>;

type ParsedCandidate = Readonly<{
  id: string;
  syncId: string;
  panelSessionId: string;
  pageEpoch: string;
  cutoffCaptureSequence: number;
  coverage: TopologySyncBeginFrame["coverage"];
  records: readonly TopologyAbsoluteRecord[];
  observations: readonly TopologyObservation[];
  reason?: TopologySyncCompleteFrame["reason"];
}>;

function validateFrameSequence(
  frames: readonly unknown[]
): FrameValidationResult {
  if (!Array.isArray(frames)) {
    return reject("UNSUPPORTED_FRAME_SEQUENCE");
  }
  if (frames.length < 2) {
    return reject("UNSUPPORTED_FRAME_SEQUENCE");
  }

  const begin = frames.find((frame): frame is TopologySyncBeginFrame =>
    isTopologySyncFrame(frame) && frame.type === TOPOLOGY_SYNC_BEGIN
  );
  const complete = frames.find((frame): frame is TopologySyncCompleteFrame =>
    isTopologySyncFrame(frame) && frame.type === TOPOLOGY_SYNC_COMPLETE
  );
  const chunks = frames.filter((frame): frame is TopologySyncChunkFrame =>
    isTopologySyncFrame(frame) && frame.type === TOPOLOGY_SYNC_CHUNK
  );
  if (!begin || !complete || frames.some((frame) => !isTopologySyncFrame(frame))) {
    return reject("INVALID_FRAME");
  }
  if (
    frames.filter((frame) => isTopologySyncFrame(frame) && frame.type === TOPOLOGY_SYNC_BEGIN).length !== 1 ||
    frames.filter((frame) => isTopologySyncFrame(frame) && frame.type === TOPOLOGY_SYNC_COMPLETE).length !== 1 ||
    frames.length !== chunks.length + 2
  ) {
    return reject("UNSUPPORTED_FRAME_SEQUENCE");
  }
  if (!sameMetadata(begin, complete) || chunks.some((chunk) => !sameMetadata(begin, chunk))) {
    return reject("INVALID_CHECKPOINT");
  }
  if (chunks.length !== begin.chunkCount) {
    return reject("INVALID_CHECKPOINT");
  }

  const chunkIndexes = new Set<number>();
  const records = [...chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .flatMap((chunk) => {
      chunkIndexes.add(chunk.chunkIndex);
      return [...chunk.records];
    });
  if (
    chunkIndexes.size !== chunks.length ||
    [...chunkIndexes].some((index, position) => index !== position)
  ) {
    return reject("INVALID_CHECKPOINT");
  }
  const stagedBytes = frames.reduce((total, frame) => total + topologySyncUtf8Bytes(frame as TopologySyncFrame), 0);
  if (!Number.isFinite(stagedBytes) || stagedBytes > TOPOLOGY_SYNC_LIMITS.maxStagedBytes) {
    return reject("INVALID_CHECKPOINT");
  }
  if (
    records.length !== begin.recordCount ||
    records.length > TOPOLOGY_SYNC_LIMITS.maxRecords ||
    !isValidAbsoluteRecordSet(records, begin.pageEpoch, begin.cutoffCaptureSequence)
  ) {
    return reject("INVALID_CHECKPOINT");
  }
  return {
    ok: true,
    value: {
      begin,
      complete,
      records: normalizeRecords(records)
    }
  };
}

function parseCandidate(candidate: unknown): ParsedCandidate | null {
  if (!isPlainRecord(candidate) || candidate.kind !== "topology-checkpoint") {
    return null;
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }
  if (!isPlainRecord(candidate.checkpoint)) return null;
  const checkpoint = candidate.checkpoint;
  const allowedKeys = new Set([
    "syncId",
    "panelSessionId",
    "pageEpoch",
    "cutoffCaptureSequence",
    "coverage",
    "records",
    "observations",
    "reason"
  ]);
  if ([...Object.keys(checkpoint)].some((key) => !allowedKeys.has(key))) {
    return null;
  }
  if (
    typeof checkpoint.syncId !== "string" ||
    checkpoint.syncId.trim() === "" ||
    typeof checkpoint.panelSessionId !== "string" ||
    checkpoint.panelSessionId.trim() === "" ||
    typeof checkpoint.pageEpoch !== "string" ||
    checkpoint.pageEpoch.trim() === "" ||
    !isSafeNonNegativeInteger(checkpoint.cutoffCaptureSequence) ||
    !Array.isArray(checkpoint.records) ||
    checkpoint.records.length > TOPOLOGY_SYNC_LIMITS.maxRecords ||
    checkpoint.records.some((record) => !isTopologyAbsoluteRecord(record)) ||
    !isPlainRecord(checkpoint.coverage)
  ) {
    return null;
  }
  const observations = checkpoint.observations ?? [];
  if (!Array.isArray(observations) || observations.some((observation) => !isTopologyObservation(observation))) {
    return null;
  }
  const records = checkpoint.records as TopologyAbsoluteRecord[];
  const coverage = checkpoint.coverage as TopologySyncBeginFrame["coverage"];
  const pageEpoch = checkpoint.pageEpoch as string;
  const cutoffCaptureSequence = checkpoint.cutoffCaptureSequence as number;
  const reason = checkpoint.reason;
  if (
    (reason !== undefined && reason !== "limit-exceeded" && reason !== "serialization-failed") ||
    !isValidAbsoluteRecordSet(records, pageEpoch, cutoffCaptureSequence) ||
    observations.some(
      (observation) =>
        observation.pageEpoch !== pageEpoch ||
        observation.captureSequence <= cutoffCaptureSequence
    ) ||
    new Set(observations.map((observation) => observation.captureSequence)).size !== observations.length
  ) {
    return null;
  }

  const frames = createFrames(
    checkpoint.syncId,
    checkpoint.panelSessionId,
    pageEpoch,
    cutoffCaptureSequence,
    coverage,
    records,
    reason
  );
  if (frames.some((frame) => !isTopologySyncFrame(frame))) {
    return null;
  }
  return {
    id: candidate.id,
    syncId: checkpoint.syncId,
    panelSessionId: checkpoint.panelSessionId,
    pageEpoch,
    cutoffCaptureSequence,
    coverage,
    records: normalizeRecords(records),
    observations: normalizeObservations(observations, pageEpoch, cutoffCaptureSequence) ?? [],
    ...(reason !== undefined ? { reason } : {})
  };
}

function createCheckpoint(
  begin: TopologySyncBeginFrame,
  records: readonly TopologyAbsoluteRecord[],
  observations: readonly TopologyObservation[],
  reason: TopologySyncCompleteFrame["reason"]
): Readonly<Record<string, unknown>> {
  return {
    syncId: begin.syncId,
    panelSessionId: begin.panelSessionId,
    pageEpoch: begin.pageEpoch,
    cutoffCaptureSequence: begin.cutoffCaptureSequence,
    coverage: { ...begin.coverage, getters: { ...begin.coverage.getters } },
    records: normalizeRecords(records),
    observations: normalizeObservations(observations, begin.pageEpoch, begin.cutoffCaptureSequence) ?? [],
    ...(reason !== undefined ? { reason } : {})
  };
}

function createFrames(
  syncId: string,
  panelSessionId: string,
  pageEpoch: string,
  cutoffCaptureSequence: number,
  coverage: TopologySyncBeginFrame["coverage"],
  records: readonly TopologyAbsoluteRecord[],
  reason?: TopologySyncCompleteFrame["reason"]
): readonly TopologySyncFrame[] {
  const chunks = chunkRecords(records, {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    panelSessionId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: TOPOLOGY_SYNC_LIMITS.maxChunks,
    recordCount: records.length,
    coverage
  });
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    panelSessionId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: chunks.length,
    recordCount: records.length,
    coverage
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    ...chunks.map((chunk, chunkIndex) => ({
      type: TOPOLOGY_SYNC_CHUNK,
      ...metadata,
      chunkIndex,
      records: chunk
    }) satisfies TopologySyncChunkFrame),
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata, ...(reason !== undefined ? { reason } : {}) }
  ];
}

function chunkRecords(
  records: readonly TopologyAbsoluteRecord[],
  metadata: Omit<TopologySyncBeginFrame, "type">
): readonly TopologyAbsoluteRecord[][] {
  const chunks: TopologyAbsoluteRecord[][] = [];
  let current: TopologyAbsoluteRecord[] = [];
  for (const record of records) {
    const next = [...current, record];
    const frame = {
      type: TOPOLOGY_SYNC_CHUNK,
      ...metadata,
      chunkIndex: chunks.length,
      records: next
    } satisfies TopologySyncChunkFrame;
    if (
      current.length > 0 &&
      topologySyncUtf8Bytes(frame) > TOPOLOGY_LIMITS.utf8Bytes
    ) {
      chunks.push(current);
      current = [record];
    } else {
      current = next;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function sameMetadata(
  left: TopologySyncBeginFrame,
  right: TopologySyncFrame
): boolean {
  return (
    left.version === right.version &&
    left.syncId === right.syncId &&
    left.panelSessionId === right.panelSessionId &&
    left.pageEpoch === right.pageEpoch &&
    left.cutoffCaptureSequence === right.cutoffCaptureSequence &&
    left.chunkCount === right.chunkCount &&
    left.recordCount === right.recordCount &&
    canonicalIdentity(left.coverage) === canonicalIdentity(right.coverage)
  );
}

function isValidAbsoluteRecordSet(
  records: readonly TopologyAbsoluteRecord[],
  pageEpoch: string,
  cutoffCaptureSequence: number
): boolean {
  if (records.length === 0) return cutoffCaptureSequence === 0;
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.kind}:${record.id}`;
    if (
      record.pageEpoch !== pageEpoch ||
      record.captureSequence > cutoffCaptureSequence ||
      identities.has(identity)
    ) {
      return false;
    }
    identities.add(identity);
  }
  const hasParent = (kind: TopologyAbsoluteRecord["kind"], id: string | undefined) =>
    id !== undefined && records.some((record) => record.kind === kind && record.id === id);
  const pageRecords = records.filter((record) => record.kind === "page");
  if (pageRecords.length !== 1 || pageRecords[0].id !== pageEpoch) return false;
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
        return hasParent("subscription", record.parentId) && record.subscriptionId === record.parentId;
      case "inferred-child":
        return (
          hasParent("command-generation", record.parentId) &&
          hasParent("subscription", record.subscriptionId)
        );
    }
  });
}

function normalizeRecords(records: readonly TopologyAbsoluteRecord[]): readonly TopologyAbsoluteRecord[] {
  return records
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      left.captureSequence === right.captureSequence
        ? left.id.localeCompare(right.id)
        : left.captureSequence - right.captureSequence
    );
}

function normalizeObservations(
  observations: readonly TopologyObservation[],
  pageEpoch: string,
  cutoffCaptureSequence: number
): readonly TopologyObservation[] | null {
  if (
    observations.some(
      (observation) =>
        observation.pageEpoch !== pageEpoch ||
        observation.captureSequence <= cutoffCaptureSequence
    )
  ) {
    return null;
  }
  return observations
    .map((observation) => ({
      ...observation,
      ...(observation.values ? { values: { ...observation.values } } : {})
    }))
    .sort((left, right) =>
      left.captureSequence === right.captureSequence
        ? left.kind.localeCompare(right.kind)
        : left.captureSequence - right.captureSequence
    );
}

function reject(
  code: TopologyCheckpointEvidenceCodecRejectionCode
): Readonly<{
  ok: false;
  rejection: TopologyCheckpointEvidenceCodecRejection;
}> {
  return { ok: false, rejection: { code } };
}

const TOPOLOGY_CHECKPOINT_ID_COMPONENT_LIMIT = 32;

function topologyCheckpointEvidenceId(
  begin: TopologySyncBeginFrame,
  checkpoint: Readonly<Record<string, unknown>>
): string {
  return [
    "topology-checkpoint",
    `sync-${sanitizeIdComponent(begin.syncId)}`,
    `session-${sanitizeIdComponent(begin.panelSessionId)}`,
    `page-${sanitizeIdComponent(begin.pageEpoch)}`,
    `cutoff-${begin.cutoffCaptureSequence}`,
    `hash-${stableHash64(canonicalIdentity(checkpoint))}`
  ].join(":");
}

function sanitizeIdComponent(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TOPOLOGY_CHECKPOINT_ID_COMPONENT_LIMIT);
  return sanitized || "empty";
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A tagged canonical encoding keeps the evidence ID injective for JSON values, including -0. */
function canonicalIdentity(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : value];
  if (typeof value === "undefined") return ["undefined"];
  if (Array.isArray(value)) return ["array", value.map(canonicalValue)];
  if (typeof value === "object") {
    return [
      "object",
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])])
    ];
  }
  return [typeof value];
}

function stableHash64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
