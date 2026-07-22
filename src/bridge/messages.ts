export const CAPTURE_NAMESPACE = "__LSEW_CAPTURE__" as const;
export const CAPTURE_VERSION = 1 as const;

export const RUNTIME_CAPTURE_MESSAGE = "lsew:capture-message" as const;
export const PANEL_PORT_NAME = "lsew-panel" as const;
export const PANEL_REGISTER_MESSAGE = "lsew:panel-register" as const;
export const PANEL_STATUS_MESSAGE = "lsew:panel-status" as const;
export const PANEL_CAPTURE_MESSAGE = "lsew:panel-capture" as const;
export const PANEL_REINJECT_REQUEST = "lsew:panel-reinject-request" as const;
export const CONTENT_REINJECT_REQUEST = "lsew:content-reinject-request" as const;
export const CONTENT_REINJECT_RESULT = "lsew:content-reinject-result" as const;
export const PAGE_REINJECT_REQUEST = "lsew:page-reinject-request" as const;
export const CONTENT_CAPTURE_SYNC_REQUEST = "lsew:content-capture-sync-request" as const;
export const PAGE_CAPTURE_SYNC_REQUEST = "lsew:page-capture-sync-request" as const;
export const RUNTIME_REINJECT_RESULT = "lsew:runtime-reinject-result" as const;
export const PANEL_REINJECT_RESULT = "lsew:panel-reinject-result" as const;
export const PANEL_VISIBILITY_MESSAGE = "lsew:panel-visibility" as const;

export const CAPTURE_KINDS = [
  "client-created",
  "client-status",
  "subscription-created",
  "subscription-started",
  "subscription-snapshot",
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
};

export type RuntimeCaptureMessage = {
  type: typeof RUNTIME_CAPTURE_MESSAGE;
  message: CaptureMessage;
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

export type PanelVisibilityMessage = {
  type: typeof PANEL_VISIBILITY_MESSAGE;
  visible: boolean;
};

const captureKindSet = new Set<string>(CAPTURE_KINDS);

export function createCaptureMessage<K extends CaptureKind>(
  kind: K,
  payload: CapturePayload,
  timestamp = Date.now()
): CaptureMessage<K> {
  return {
    namespace: CAPTURE_NAMESPACE,
    version: CAPTURE_VERSION,
    kind,
    timestamp,
    payload
  };
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
    isJsonValue(value.payload)
  );
}

export function isRuntimeCaptureMessage(value: unknown): value is RuntimeCaptureMessage {
  return (
    isRecord(value) &&
    value.type === RUNTIME_CAPTURE_MESSAGE &&
    isCaptureMessage(value.message)
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
