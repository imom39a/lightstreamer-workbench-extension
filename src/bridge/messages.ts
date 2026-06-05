export const CAPTURE_NAMESPACE = "__LSEW_CAPTURE__" as const;
export const CAPTURE_VERSION = 1 as const;

export const RUNTIME_CAPTURE_MESSAGE = "lsew:capture-message" as const;
export const PANEL_PORT_NAME = "lsew-panel" as const;
export const PANEL_REGISTER_MESSAGE = "lsew:panel-register" as const;
export const PANEL_STATUS_MESSAGE = "lsew:panel-status" as const;
export const PANEL_CAPTURE_MESSAGE = "lsew:panel-capture" as const;
export const PANEL_REINJECT_REQUEST = "lsew:panel-reinject-request" as const;
export const CONTENT_REINJECT_REQUEST = "lsew:content-reinject-request" as const;
export const PAGE_REINJECT_REQUEST = "lsew:page-reinject-request" as const;
export const RUNTIME_REINJECT_RESULT = "lsew:runtime-reinject-result" as const;
export const PANEL_REINJECT_RESULT = "lsew:panel-reinject-result" as const;

export const CAPTURE_KINDS = [
  "client-created",
  "client-status",
  "subscription-created",
  "subscription-started",
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

export type ReinjectionDraftPayload = {
  sourceEventId: string;
  target: {
    subscriptionId: string;
    listenerId: string;
  };
  item: {
    name?: string | null;
    position?: number | null;
  };
  command: string;
  key: string;
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

export type ReinjectionResultStatus =
  | "success"
  | "stale-target"
  | "listener-error"
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

export function isReinjectionDraftPayload(value: unknown): value is ReinjectionDraftPayload {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.item)) {
    return false;
  }

  return (
    isNonEmptyString(value.sourceEventId) &&
    isNonEmptyString(value.target.subscriptionId) &&
    isNonEmptyString(value.target.listenerId) &&
    (value.item.name === undefined || value.item.name === null || typeof value.item.name === "string") &&
    (value.item.position === undefined ||
      value.item.position === null ||
      (typeof value.item.position === "number" && Number.isInteger(value.item.position))) &&
    (isNonEmptyString(value.item.name) ||
      (typeof value.item.position === "number" && Number.isInteger(value.item.position))) &&
    isNonEmptyString(value.command) &&
    isNonEmptyString(value.key) &&
    isReinjectionFields(value.fields) &&
    Object.keys(value.fields).length > 0 &&
    isReinjectionFields(value.changedFields) &&
    typeof value.isSnapshot === "boolean" &&
    isRecord(value.provenance) &&
    isJsonValue(value.provenance)
  );
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

export function isRuntimeReinjectResultMessage(
  value: unknown
): value is RuntimeReinjectResultMessage {
  return (
    isRecord(value) &&
    value.type === RUNTIME_REINJECT_RESULT &&
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
