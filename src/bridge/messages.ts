export const CAPTURE_NAMESPACE = "__LSEW_CAPTURE__" as const;
export const CAPTURE_VERSION = 1 as const;
export const TOPOLOGY_OBSERVATION_VERSION = 1 as const;
export const TOPOLOGY_SYNC_VERSION = 1 as const;

export const TOPOLOGY_LIMITS = Object.freeze({
  valueString: 4_096,
  diagnosticContext: 256,
  arrayEntries: 1_024,
  objectKeys: 128,
  depth: 8,
  utf8Bytes: 262_144
});

export const TOPOLOGY_SYNC_LIMITS = Object.freeze({
  maxChunks: 256,
  maxRecords: 16_384,
  maxStagedBytes: 2_097_152,
  maxBufferedLive: 16_384
});

export const RUNTIME_CAPTURE_MESSAGE = "lsew:capture-message" as const;
export const RUNTIME_TOPOLOGY_SYNC_FRAME = "lsew:topology-sync-frame" as const;
export const PANEL_PORT_NAME = "lsew-panel" as const;
export const PANEL_REGISTER_MESSAGE = "lsew:panel-register" as const;
export const PANEL_STATUS_MESSAGE = "lsew:panel-status" as const;
export const PANEL_CAPTURE_MESSAGE = "lsew:panel-capture" as const;
export const PANEL_TOPOLOGY_SYNC_FRAME = "lsew:panel-topology-sync-frame" as const;
export const PANEL_REINJECT_REQUEST = "lsew:panel-reinject-request" as const;
export const CONTENT_REINJECT_REQUEST = "lsew:content-reinject-request" as const;
export const CONTENT_REINJECT_RESULT = "lsew:content-reinject-result" as const;
export const PAGE_REINJECT_REQUEST = "lsew:page-reinject-request" as const;
export const CONTENT_CAPTURE_SYNC_REQUEST = "lsew:content-capture-sync-request" as const;
export const PAGE_CAPTURE_SYNC_REQUEST = "lsew:page-capture-sync-request" as const;
export const TOPOLOGY_SYNC_BEGIN = "lsew:topology-sync-begin" as const;
export const TOPOLOGY_SYNC_CHUNK = "lsew:topology-sync-chunk" as const;
export const TOPOLOGY_SYNC_COMPLETE = "lsew:topology-sync-complete" as const;
export const RUNTIME_REINJECT_RESULT = "lsew:runtime-reinject-result" as const;
export const PANEL_REINJECT_RESULT = "lsew:panel-reinject-result" as const;
export const PANEL_VISIBILITY_MESSAGE = "lsew:panel-visibility" as const;
export const PAGE_REINJECTION_BRIDGE_GLOBAL = "__LSEW_REINJECTION_BRIDGE__" as const;
export const PAGE_REINJECTION_BRIDGE_VERSION = 1 as const;

export const CAPTURE_KINDS = [
  "client-created",
  "client-status",
  "subscription-created",
  "subscription-started",
  "subscription-snapshot",
  "subscription-frequency",
  "subscription-ended",
  "subscription-error",
  "listener-added",
  "listener-removed",
  "item-update",
  "end-of-snapshot",
  "lost-updates",
  "clear-snapshot"
] as const;

export type CaptureKind = (typeof CAPTURE_KINDS)[number];
export type CaptureStatus = "idle" | "bridge connected" | "capturing" | "bridge disconnected";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type CapturePayload = JsonObject;

export const TOPOLOGY_VALUE_STATES = [
  "requested",
  "real",
  "inferred",
  "unknown",
  "unavailable",
  "redacted",
  "not-applicable"
] as const;

export const TOPOLOGY_COVERAGE_REASONS = [
  "getter-missing",
  "getter-threw",
  "late-attachment",
  "unsupported-shape",
  "out-of-scope-frame",
  "limit-exceeded",
  "sanitization-failed"
] as const;

export type TopologyValueState = (typeof TOPOLOGY_VALUE_STATES)[number];
export type TopologyCoverageReason = (typeof TOPOLOGY_COVERAGE_REASONS)[number];
export type TopologyValue<T extends JsonValue = JsonValue> =
  | { state: "requested" | "real" | "inferred"; value: T }
  | {
      state: "unknown" | "unavailable" | "redacted" | "not-applicable";
      reason?: TopologyCoverageReason;
      context?: string;
    };
export type TopologyGetterCoverage = "available" | "missing" | "threw";
export type TopologyCoverage = {
  status: "complete" | "partial";
  getters: Record<string, TopologyGetterCoverage>;
  reason?: TopologyCoverageReason;
  context?: string;
};
export type TopologyProvenance = { instrumentationSource: "official-public-api" };
export type TopologyEvidenceRecord = Record<string, JsonValue | TopologyValue>;

export const TOPOLOGY_OBSERVATION_KINDS = [
  "client-created",
  "client-status",
  "session-established",
  "session-absent",
  "subscription-created",
  "subscription-active",
  "subscription-established",
  "subscription-started",
  "subscription-snapshot",
  "subscription-frequency",
  "subscription-ended",
  "subscription-error",
  "listener-added",
  "listener-removed",
  "listener-attached",
  "listener-detached",
  "item-update",
  "end-of-snapshot",
  "lost-updates",
  "clear-snapshot",
  "callback-update",
  "callback-error",
  "callback-loss",
  "callback-eos",
  "callback-clear",
  "item-observed",
  "snapshot-observed",
  "command-key-generation",
  "second-level-observed"
] as const;
export type TopologyObservationKind = (typeof TOPOLOGY_OBSERVATION_KINDS)[number];

export const TOPOLOGY_CAPTURE_KIND_COMPATIBILITY: Readonly<
  Record<CaptureKind, readonly TopologyObservationKind[]>
> = Object.freeze({
  "client-created": ["client-created"],
  "client-status": ["client-status", "session-established", "session-absent"],
  "subscription-created": ["subscription-created"],
  "subscription-started": ["subscription-started", "subscription-active", "subscription-established"],
  "subscription-snapshot": ["subscription-snapshot", "snapshot-observed"],
  "subscription-frequency": ["subscription-frequency"],
  "subscription-ended": ["subscription-ended"],
  "subscription-error": ["subscription-error", "callback-error"],
  "listener-added": ["listener-added", "listener-attached"],
  "listener-removed": ["listener-removed", "listener-detached"],
  "item-update": [
    "item-update",
    "callback-update",
    "item-observed",
    "command-key-generation",
    "second-level-observed"
  ],
  "end-of-snapshot": ["end-of-snapshot", "callback-eos", "snapshot-observed"],
  "lost-updates": ["lost-updates", "callback-loss"],
  "clear-snapshot": ["clear-snapshot", "callback-clear"]
});

export type TopologyObservation = {
  version: typeof TOPOLOGY_OBSERVATION_VERSION;
  kind: TopologyObservationKind;
  pageEpoch: string;
  captureSequence: number;
  provenance: TopologyProvenance;
  coverage: TopologyCoverage;
  client?: TopologyEvidenceRecord;
  subscription?: TopologyEvidenceRecord;
  item?: TopologyEvidenceRecord;
  listener?: TopologyEvidenceRecord;
  listenerAttachment?: TopologyEvidenceRecord;
  dispatch?: TopologyEvidenceRecord;
  delivery?: TopologyEvidenceRecord;
  values?: Record<string, TopologyValue>;
};

export type TopologyAbsoluteRecordKind =
  | "page"
  | "client"
  | "session"
  | "subscription"
  | "establishment"
  | "listener-attachment"
  | "item"
  | "command-generation"
  | "inferred-child"
  | "aggregate";

export type TopologyAbsoluteRecord = {
  kind: TopologyAbsoluteRecordKind;
  id: string;
  pageEpoch: string;
  captureSequence: number;
  parentId?: string;
  clientId?: string;
  subscriptionId?: string;
  clientActive?: boolean;
  serverEstablished?: boolean;
  values?: JsonObject;
};

type TopologySyncMetadata = {
  version: typeof TOPOLOGY_SYNC_VERSION;
  syncId: string;
  pageEpoch: string;
  cutoffCaptureSequence: number;
  chunkCount: number;
  recordCount: number;
  coverage: TopologyCoverage;
};
export type TopologySyncBeginFrame = TopologySyncMetadata & { type: typeof TOPOLOGY_SYNC_BEGIN };
export type TopologySyncChunkFrame = TopologySyncMetadata & {
  type: typeof TOPOLOGY_SYNC_CHUNK;
  chunkIndex: number;
  records: readonly TopologyAbsoluteRecord[];
};
export type TopologySyncCompleteFrame = TopologySyncMetadata & {
  type: typeof TOPOLOGY_SYNC_COMPLETE;
  reason?: "limit-exceeded" | "serialization-failed";
};
export type TopologySyncFrame =
  | TopologySyncBeginFrame
  | TopologySyncChunkFrame
  | TopologySyncCompleteFrame;

export type ReinjectionFieldValue = string | number | boolean | null;
export type ReinjectionFields = Record<string, ReinjectionFieldValue>;
export type PageReinjectionExecutionTarget = "captured-listener" | "captured-wire";

export type ReinjectionDraftPayload = {
  sourceEventId: string;
  executionTarget: PageReinjectionExecutionTarget;
  target: {
    subscriptionId: string;
    listenerId: string | null;
  };
  item: {
    name?: string | null;
    position?: number | null;
  };
  command: string | null;
  key: string | null;
  fields: ReinjectionFields;
  changedFields: ReinjectionFields;
  isSnapshot: boolean;
  provenance: JsonObject;
};

export type ReinjectionRequestMessage =
  | PanelReinjectRequestMessage
  | ContentReinjectRequestMessage
  | PageReinjectRequestMessage;

export type PanelReinjectRequestMessage = {
  type: typeof PANEL_REINJECT_REQUEST;
  requestId: string;
  draft: ReinjectionDraftPayload;
};

export type ContentReinjectRequestMessage = {
  type: typeof CONTENT_REINJECT_REQUEST;
  requestId: string;
  draft: ReinjectionDraftPayload;
};

export type PageReinjectRequestMessage = {
  type: typeof PAGE_REINJECT_REQUEST;
  requestId: string;
  draft: ReinjectionDraftPayload;
};

export type ContentCaptureSyncRequestMessage = {
  type: typeof CONTENT_CAPTURE_SYNC_REQUEST;
};

export type PageCaptureSyncRequestMessage = {
  type: typeof PAGE_CAPTURE_SYNC_REQUEST;
};

export type ReinjectionResultStatus =
  | "success"
  | "stale-target"
  | "listener-error"
  | "wire-error"
  | "bridge-error";

export type ReinjectionResult = {
  requestId: string;
  ok: boolean;
  status: ReinjectionResultStatus;
  timestamp: number;
  error?: string;
};

export type RuntimeReinjectResultMessage = {
  type: typeof RUNTIME_REINJECT_RESULT;
  result: ReinjectionResult;
};

export type ContentReinjectResultMessage = {
  type: typeof CONTENT_REINJECT_RESULT;
  result: ReinjectionResult;
};

export type PanelReinjectResultMessage = {
  type: typeof PANEL_REINJECT_RESULT;
  result: ReinjectionResult;
};

export type CaptureMessage<K extends CaptureKind = CaptureKind> = {
  namespace: typeof CAPTURE_NAMESPACE;
  version: typeof CAPTURE_VERSION;
  kind: K;
  timestamp: number;
  payload: CapturePayload;
  topology?: TopologyObservation;
};

export type RuntimeCaptureMessage = {
  type: typeof RUNTIME_CAPTURE_MESSAGE;
  message: CaptureMessage;
};

export type RuntimeTopologySyncFrameMessage = {
  type: typeof RUNTIME_TOPOLOGY_SYNC_FRAME;
  frame: TopologySyncFrame;
};

export type PanelRegisterMessage = {
  type: typeof PANEL_REGISTER_MESSAGE;
  tabId: number;
};

export type PanelStatusMessage = {
  type: typeof PANEL_STATUS_MESSAGE;
  status: CaptureStatus;
};

export type PanelCaptureMessage = {
  type: typeof PANEL_CAPTURE_MESSAGE;
  message: CaptureMessage;
};

export type PanelTopologySyncFrameMessage = {
  type: typeof PANEL_TOPOLOGY_SYNC_FRAME;
  frame: TopologySyncFrame;
};

export type PanelVisibilityMessage = {
  type: typeof PANEL_VISIBILITY_MESSAGE;
  visible: boolean;
};

const captureKindSet = new Set<string>(CAPTURE_KINDS);

export function createCaptureMessage<K extends CaptureKind>(
  kind: K,
  payload: CapturePayload,
  timestamp = Date.now(),
  topology?: TopologyObservation
): CaptureMessage<K> {
  const message: CaptureMessage<K> = {
    namespace: CAPTURE_NAMESPACE,
    version: CAPTURE_VERSION,
    kind,
    timestamp,
    payload
  };
  if (topology !== undefined) {
    message.topology = topology;
  }
  return message;
}

export function isCaptureMessage(value: unknown): value is CaptureMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.namespace === CAPTURE_NAMESPACE &&
    value.version === CAPTURE_VERSION &&
    typeof value.kind === "string" &&
    captureKindSet.has(value.kind) &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    isRecord(value.payload) &&
    isJsonValue(value.payload) &&
    (value.topology === undefined ||
      isTopologyObservationForCapture(value.kind as CaptureKind, value.topology))
  );
}

export function isTopologyObservationForCapture(
  captureKind: CaptureKind,
  value: unknown
): value is TopologyObservation {
  return (
    isTopologyObservation(value) &&
    (TOPOLOGY_CAPTURE_KIND_COMPATIBILITY[captureKind] as readonly string[]).includes(value.kind)
  );
}

export function isTopologyObservation(value: unknown): value is TopologyObservation {
  return (
    isBoundedTopologyTree(value) &&
    isRecord(value) &&
    value.version === TOPOLOGY_OBSERVATION_VERSION &&
    typeof value.kind === "string" &&
    (TOPOLOGY_OBSERVATION_KINDS as readonly string[]).includes(value.kind) &&
    isNonEmptyString(value.pageEpoch) &&
    isSafePositiveInteger(value.captureSequence) &&
    isTopologyProvenance(value.provenance) &&
    isTopologyCoverage(value.coverage) &&
    [
      value.client,
      value.subscription,
      value.item,
      value.listener,
      value.listenerAttachment,
      value.dispatch,
      value.delivery
    ].every((entry) => entry === undefined || isTopologyEvidenceRecord(entry)) &&
    (value.values === undefined ||
      (isRecord(value.values) && Object.values(value.values).every(isTopologyValue)))
  );
}

export function isRuntimeCaptureMessage(value: unknown): value is RuntimeCaptureMessage {
  return (
    isRecord(value) &&
    value.type === RUNTIME_CAPTURE_MESSAGE &&
    isCaptureMessage(value.message)
  );
}

export function isRuntimeTopologySyncFrameMessage(
  value: unknown
): value is RuntimeTopologySyncFrameMessage {
  return (
    isRecord(value) &&
    value.type === RUNTIME_TOPOLOGY_SYNC_FRAME &&
    isTopologySyncFrame(value.frame)
  );
}

export function isPanelRegisterMessage(value: unknown): value is PanelRegisterMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_REGISTER_MESSAGE &&
    typeof value.tabId === "number" &&
    Number.isInteger(value.tabId)
  );
}

export function isPanelStatusMessage(value: unknown): value is PanelStatusMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_STATUS_MESSAGE &&
    isCaptureStatus(value.status)
  );
}

export function isPanelCaptureMessage(value: unknown): value is PanelCaptureMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_CAPTURE_MESSAGE &&
    isCaptureMessage(value.message)
  );
}

export function isPanelTopologySyncFrameMessage(
  value: unknown
): value is PanelTopologySyncFrameMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_TOPOLOGY_SYNC_FRAME &&
    isTopologySyncFrame(value.frame)
  );
}

export function isPanelVisibilityMessage(value: unknown): value is PanelVisibilityMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_VISIBILITY_MESSAGE &&
    typeof value.visible === "boolean"
  );
}

export function isReinjectionDraftPayload(value: unknown): value is ReinjectionDraftPayload {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.item)) {
    return false;
  }

  return (
    isNonEmptyString(value.sourceEventId) &&
    isPageReinjectionExecutionTarget(value.executionTarget) &&
    isNonEmptyString(value.target.subscriptionId) &&
    (value.executionTarget === "captured-wire"
      ? value.target.listenerId === null || isNonEmptyString(value.target.listenerId)
      : isNonEmptyString(value.target.listenerId)) &&
    (value.item.name === undefined || value.item.name === null || typeof value.item.name === "string") &&
    (value.item.position === undefined ||
      value.item.position === null ||
      (typeof value.item.position === "number" && Number.isInteger(value.item.position))) &&
    (isNonEmptyString(value.item.name) ||
      (typeof value.item.position === "number" && Number.isInteger(value.item.position))) &&
    isNullableNonEmptyString(value.command) &&
    isNullableNonEmptyString(value.key) &&
    isReinjectionFields(value.fields) &&
    Object.keys(value.fields).length > 0 &&
    isReinjectionFields(value.changedFields) &&
    typeof value.isSnapshot === "boolean" &&
    isRecord(value.provenance) &&
    isJsonValue(value.provenance)
  );
}

function isPageReinjectionExecutionTarget(
  value: unknown
): value is PageReinjectionExecutionTarget {
  return value === "captured-listener" || value === "captured-wire";
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

export function isPanelReinjectRequestMessage(value: unknown): value is PanelReinjectRequestMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_REINJECT_REQUEST &&
    isNonEmptyString(value.requestId) &&
    isReinjectionDraftPayload(value.draft)
  );
}

export function isContentReinjectRequestMessage(
  value: unknown
): value is ContentReinjectRequestMessage {
  return (
    isRecord(value) &&
    value.type === CONTENT_REINJECT_REQUEST &&
    isNonEmptyString(value.requestId) &&
    isReinjectionDraftPayload(value.draft)
  );
}

export function isPageReinjectRequestMessage(value: unknown): value is PageReinjectRequestMessage {
  return (
    isRecord(value) &&
    value.type === PAGE_REINJECT_REQUEST &&
    isNonEmptyString(value.requestId) &&
    isReinjectionDraftPayload(value.draft)
  );
}

export function isContentCaptureSyncRequestMessage(
  value: unknown
): value is ContentCaptureSyncRequestMessage {
  return isRecord(value) && value.type === CONTENT_CAPTURE_SYNC_REQUEST;
}

export function isPageCaptureSyncRequestMessage(
  value: unknown
): value is PageCaptureSyncRequestMessage {
  return isRecord(value) && value.type === PAGE_CAPTURE_SYNC_REQUEST;
}

export function isTopologySyncFrame(value: unknown): value is TopologySyncFrame {
  if (
    !isRecord(value) ||
    value.version !== TOPOLOGY_SYNC_VERSION ||
    !isNonEmptyString(value.syncId) ||
    !isNonEmptyString(value.pageEpoch) ||
    !isSafeNonNegativeInteger(value.cutoffCaptureSequence) ||
    !isSafeNonNegativeInteger(value.chunkCount) ||
    value.chunkCount > TOPOLOGY_SYNC_LIMITS.maxChunks ||
    !isSafeNonNegativeInteger(value.recordCount) ||
    value.recordCount > TOPOLOGY_SYNC_LIMITS.maxRecords ||
    (value.cutoffCaptureSequence === 0 &&
      (value.chunkCount !== 0 || value.recordCount !== 0)) ||
    !isTopologyCoverage(value.coverage) ||
    !isWithinTopologyByteLimit(value)
  ) {
    return false;
  }

  if (value.type === TOPOLOGY_SYNC_BEGIN) {
    return true;
  }
  if (value.type === TOPOLOGY_SYNC_COMPLETE) {
    return (
      value.reason === undefined ||
      value.reason === "limit-exceeded" ||
      value.reason === "serialization-failed"
    );
  }
  return (
    value.type === TOPOLOGY_SYNC_CHUNK &&
    isSafeNonNegativeInteger(value.chunkIndex) &&
    value.chunkIndex < value.chunkCount &&
    Array.isArray(value.records) &&
    value.records.length <= TOPOLOGY_SYNC_LIMITS.maxRecords &&
    value.records.every(isTopologyAbsoluteRecord)
  );
}

export function isTopologyAbsoluteRecord(value: unknown): value is TopologyAbsoluteRecord {
  return (
    isBoundedTopologyTree(value) &&
    isRecord(value) &&
    typeof value.kind === "string" &&
    [
      "page",
      "client",
      "session",
      "subscription",
      "establishment",
      "listener-attachment",
      "item",
      "command-generation",
      "inferred-child",
      "aggregate"
    ].includes(value.kind) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.pageEpoch) &&
    isSafePositiveInteger(value.captureSequence) &&
    (value.parentId === undefined || isNonEmptyString(value.parentId)) &&
    (value.clientId === undefined || isNonEmptyString(value.clientId)) &&
    (value.subscriptionId === undefined || isNonEmptyString(value.subscriptionId)) &&
    (value.clientActive === undefined || typeof value.clientActive === "boolean") &&
    (value.serverEstablished === undefined || typeof value.serverEstablished === "boolean") &&
    (value.values === undefined ||
      (isRecord(value.values) &&
        Object.values(value.values).every(isTopologySemanticValue)))
  );
}

export function topologySyncUtf8Bytes(value: TopologySyncFrame | TopologyAbsoluteRecord): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isRuntimeReinjectResultMessage(
  value: unknown
): value is RuntimeReinjectResultMessage {
  return (
    isRecord(value) &&
    value.type === RUNTIME_REINJECT_RESULT &&
    isReinjectionResult(value.result)
  );
}

export function isContentReinjectResultMessage(
  value: unknown
): value is ContentReinjectResultMessage {
  return (
    isRecord(value) &&
    value.type === CONTENT_REINJECT_RESULT &&
    isReinjectionResult(value.result)
  );
}

export function isPanelReinjectResultMessage(value: unknown): value is PanelReinjectResultMessage {
  return (
    isRecord(value) &&
    value.type === PANEL_REINJECT_RESULT &&
    isReinjectionResult(value.result)
  );
}

function isCaptureStatus(value: unknown): value is CaptureStatus {
  return (
    value === "idle" ||
    value === "bridge connected" ||
    value === "capturing" ||
    value === "bridge disconnected"
  );
}

function isReinjectionFields(value: unknown): value is ReinjectionFields {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([fieldName, fieldValue]) => {
    return (
      fieldName.trim() !== "" &&
      (fieldValue === null ||
        typeof fieldValue === "string" ||
        typeof fieldValue === "number" ||
        typeof fieldValue === "boolean") &&
      (typeof fieldValue !== "number" || Number.isFinite(fieldValue))
    );
  });
}

function isReinjectionResult(value: unknown): value is ReinjectionResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.requestId) &&
    typeof value.ok === "boolean" &&
    isReinjectionResultStatus(value.status) &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isReinjectionResultStatus(value: unknown): value is ReinjectionResultStatus {
  return (
    value === "success" ||
    value === "stale-target" ||
    value === "listener-error" ||
    value === "wire-error" ||
    value === "bridge-error"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTopologyProvenance(value: unknown): value is TopologyProvenance {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.instrumentationSource === "official-public-api"
  );
}

function isTopologyCoverage(value: unknown): value is TopologyCoverage {
  return (
    isRecord(value) &&
    (value.status === "complete" || value.status === "partial") &&
    isRecord(value.getters) &&
    Object.values(value.getters).every(
      (entry) => entry === "available" || entry === "missing" || entry === "threw"
    ) &&
    (value.reason === undefined ||
      (TOPOLOGY_COVERAGE_REASONS as readonly unknown[]).includes(value.reason)) &&
    (value.context === undefined ||
      (typeof value.context === "string" &&
        codePointLength(value.context) <= TOPOLOGY_LIMITS.diagnosticContext))
  );
}

function isTopologyEvidenceRecord(value: unknown): value is TopologyEvidenceRecord {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isTopologySemanticValue(entry))
  );
}

function isTopologyValue(value: unknown): value is TopologyValue {
  if (
    !isRecord(value) ||
    typeof value.state !== "string" ||
    !(TOPOLOGY_VALUE_STATES as readonly string[]).includes(value.state)
  ) {
    return false;
  }
  if (value.state === "requested" || value.state === "real" || value.state === "inferred") {
    return value.value !== undefined && isTopologySemanticValue(value.value);
  }
  return (
    value.value === undefined &&
    (value.reason === undefined ||
      (TOPOLOGY_COVERAGE_REASONS as readonly unknown[]).includes(value.reason)) &&
    (value.context === undefined ||
      (typeof value.context === "string" &&
        codePointLength(value.context) <= TOPOLOGY_LIMITS.diagnosticContext))
  );
}

function isTopologySemanticValue(value: unknown): value is JsonValue | TopologyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isTopologySemanticValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "state")) {
    return isTopologyValue(value);
  }
  return Object.values(value).every(isTopologySemanticValue);
}

function isBoundedTopologyTree(value: unknown): boolean {
  try {
    return (
      isBoundedTopologyNode(value, 1, new WeakSet<object>()) &&
      isWithinTopologyByteLimit(value)
    );
  } catch {
    return false;
  }
}

function isBoundedTopologyNode(
  value: unknown,
  depth: number,
  activePath: WeakSet<object>
): boolean {
  if (depth > TOPOLOGY_LIMITS.depth) {
    return false;
  }
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return codePointLength(value) <= TOPOLOGY_LIMITS.valueString;
  }
  if (typeof value !== "object" || activePath.has(value)) {
    return false;
  }
  activePath.add(value);
  try {
    if (Array.isArray(value)) {
      return (
        value.length <= TOPOLOGY_LIMITS.arrayEntries &&
        value.every((entry) => isBoundedTopologyNode(entry, depth + 1, activePath))
      );
    }
    const keys = Object.keys(value);
    return (
      keys.length <= TOPOLOGY_LIMITS.objectKeys &&
      keys.every(
        (key) =>
          !isForbiddenTopologyKey(key) &&
          codePointLength(key) <= TOPOLOGY_LIMITS.valueString &&
          isBoundedTopologyNode(
            (value as Record<string, unknown>)[key],
            depth + 1,
            activePath
          )
      )
    );
  } finally {
    activePath.delete(value);
  }
}

function isForbiddenTopologyKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return new Set([
    "authorization",
    "proxyauthorization",
    "cookie",
    "setcookie",
    "password",
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "headers",
    "httpextraheaders"
  ]).has(normalized);
}

function isWithinTopologyByteLimit(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= TOPOLOGY_LIMITS.utf8Bytes;
  } catch {
    return false;
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, seen));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  return Object.values(value).every((entry) => isJsonValue(entry, seen));
}
